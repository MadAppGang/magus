#!/usr/bin/env bun
/**
 * PreToolUse:TaskUpdate — refuse to mark a `/dev:dev` phase complete when its
 * artifacts do not exist, and refuse to start a phase whose prerequisites are
 * unmet.
 *
 * Replaces scripts/phase-completion-validator.js, which never ran: it read
 * `process.env.CLAUDE_TOOL_INPUT`, a variable Claude Code does not set, so it
 * always took the "no input" branch and exited 0. It also used `exit 1` to
 * block, which is a hook *error* — logged, tool proceeds. Both are fixed here.
 *
 * Protocol: JSON payload on stdin. Exit 0 allows, exit 2 blocks with the reason
 * on stdout. Any failure inside this hook allows — a broken validator must never
 * be able to wedge the user.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readHookInput, allow, deny } from "./lib/hook-io.ts";

// ── Phase model ─────────────────────────────────────────────────────────────

interface Artifact {
  file: string;
  minSize: number;
  patterns?: RegExp[];
}

interface PhaseSpec {
  name: string;
  required: Artifact[];
  evidence?: EvidenceCheck;
}

/** Named evidence checks — things a file's existence alone cannot prove. */
type EvidenceCheck =
  | "implementationProducedChanges"
  | "reviewReachedVerdict"
  | "testsWereWritten"
  | "validationReported";

export const PHASE_ARTIFACTS: Record<string, PhaseSpec> = {
  phase1: {
    name: "Requirements + Validation Setup",
    required: [
      { file: "requirements.md", minSize: 100 },
      { file: "validation-criteria.md", minSize: 50 },
      { file: "iteration-config.json", minSize: 50 },
    ],
  },
  phase3: {
    name: "Multi-Model Planning",
    required: [
      { file: "architecture.md", minSize: 500 },
      {
        file: "reviews/plan-review/consolidated.md",
        minSize: 200,
        patterns: [/model|review|analysis|issue|concern|verdict/i],
      },
      {
        file: "reviews/plan-review/claude-internal.md",
        minSize: 100,
        patterns: [/review|analysis|issue|concern|recommendation/i],
      },
    ],
  },
  phase4: {
    name: "Implementation",
    required: [
      {
        file: "implementation-log.md",
        minSize: 100,
        patterns: [/Phase|Step|Started|Completed|Created|Modified/],
      },
    ],
    evidence: "implementationProducedChanges",
  },
  phase5: {
    name: "Code Review",
    required: [
      { file: "reviews/code-review/consolidated.md", minSize: 200 },
      // Phase 5 writes this in step 5.5 exactly as phase 3 does, but only phase 3
      // required it — so a reviewer that produced nothing cleared the gate on the
      // consolidation alone, and the consolidation is written by a different agent
      // that cannot tell an absent review from an empty one.
      {
        file: "reviews/code-review/claude-internal.md",
        minSize: 100,
        patterns: [/review|analysis|issue|concern|recommendation/i],
      },
    ],
    evidence: "reviewReachedVerdict",
  },
  phase6: {
    name: "Unit Testing",
    required: [{ file: "tests/test-plan.md", minSize: 50 }],
    evidence: "testsWereWritten",
  },
  phase7: {
    name: "Real Validation",
    required: [
      {
        file: "validation/result.md",
        minSize: 100,
        patterns: [/status.*:.*PASS|status.*:.*FAIL/i],
      },
    ],
    evidence: "validationReported",
  },
  phase8: {
    name: "Completion",
    required: [{ file: "report.md", minSize: 500 }],
  },
};

/** A phase may not start until these predecessors have verified artifacts. */
export const PHASE_DEPENDENCIES: Record<string, string[]> = {
  phase4: ["phase3"],
  phase5: ["phase4"],
  phase6: ["phase4"],
  phase7: ["phase6"],
};

const PHASE_PATTERNS: Array<{ pattern: RegExp; phase: string }> = [
  { pattern: /phase\s*0/i, phase: "phase0" },
  { pattern: /phase\s*1|requirements|validation setup/i, phase: "phase1" },
  { pattern: /phase\s*2|research/i, phase: "phase2" },
  { pattern: /phase\s*3|planning|architecture/i, phase: "phase3" },
  { pattern: /phase\s*4|implementation/i, phase: "phase4" },
  { pattern: /phase\s*5|code review/i, phase: "phase5" },
  { pattern: /phase\s*6|testing|unit test/i, phase: "phase6" },
  { pattern: /phase\s*7|validation|real validation/i, phase: "phase7" },
  { pattern: /phase\s*8|completion|report/i, phase: "phase8" },
];

export function detectPhase(subject: string | undefined): string | null {
  if (!subject) return null;
  for (const { pattern, phase } of PHASE_PATTERNS) {
    if (pattern.test(subject)) return phase;
  }
  return null;
}

// ── Injected environment (so tests need no filesystem or git) ───────────────

export interface Deps {
  /** Byte size of a file, or null when absent. */
  sizeOf: (path: string) => number | null;
  /** File contents, or null when unreadable. */
  read: (path: string) => string | null;
  /**
   * Candidate feature-session directories. The caller decides how to find
   * these; `resolveSession` below refuses to guess between several.
   */
  sessions: () => string[];
  /** Paths git reports as added/modified/untracked in the working tree. */
  dirtyPaths: () => string[];
}

/**
 * Pick the session this task belongs to.
 *
 * The original picked whichever directory had the newest mtime, which silently
 * validated the wrong session whenever two features were open. There is no
 * field on a TaskUpdate payload identifying the session, so: honour an explicit
 * override, accept a single unambiguous candidate, and otherwise decline to
 * choose (returning null, which allows the update).
 */
export function resolveSession(
  sessions: string[],
  override?: string,
): { path: string } | { ambiguous: true } | null {
  if (override) return { path: override };
  if (sessions.length === 1) return { path: sessions[0] };
  if (sessions.length > 1) return { ambiguous: true };
  return null;
}

// ── Evidence checks ─────────────────────────────────────────────────────────

const TEST_FILE = /(^|\/)[^/]*([._-](test|spec)\.[a-z]+|_test\.[a-z]+)$/i;

function runEvidence(
  check: EvidenceCheck,
  sessionPath: string,
  deps: Deps,
): string | null {
  switch (check) {
    case "implementationProducedChanges": {
      // Existence of a log proves nothing; implementation must touch the tree.
      const dirty = deps.dirtyPaths();
      if (dirty.length === 0) {
        return "no working-tree changes — implementation must produce code changes";
      }
      return null;
    }

    case "reviewReachedVerdict": {
      // The original passed on any heading containing the word "verdict".
      // Require the verdict itself.
      const body = deps.read(join(sessionPath, "reviews/code-review/consolidated.md"));
      if (body === null) return "consolidated code review is unreadable";
      if (!/\b(PASS|FAIL|CONDITIONAL)\b/.test(body)) {
        return "code review states no verdict — expected PASS, FAIL or CONDITIONAL";
      }
      return null;
    }

    case "testsWereWritten": {
      // The original ran `find` across the whole repo, so any pre-existing test
      // file anywhere satisfied it. Require tests among the changes this work
      // actually produced.
      const touchedTests = deps.dirtyPaths().filter((p) => TEST_FILE.test(p));
      if (touchedTests.length === 0) {
        return "no test files added or modified in the working tree";
      }
      return null;
    }

    case "validationReported": {
      const body = deps.read(join(sessionPath, "validation/result.md"));
      if (body === null) return "validation result is unreadable";
      if (!/status\s*:?\s*\**\s*(PASS|FAIL)/i.test(body)) {
        return "validation result records no PASS/FAIL status";
      }
      return null;
    }
  }
}

// ── Core decision ───────────────────────────────────────────────────────────

function checkArtifacts(
  spec: PhaseSpec,
  sessionPath: string,
  deps: Deps,
): string[] {
  const errors: string[] = [];
  for (const artifact of spec.required) {
    const full = join(sessionPath, artifact.file);
    const size = deps.sizeOf(full);
    if (size === null) {
      errors.push(`missing ${artifact.file}`);
      continue;
    }
    if (size < artifact.minSize) {
      errors.push(
        `${artifact.file} is ${size} bytes, expected at least ${artifact.minSize}`,
      );
      continue;
    }
    if (artifact.patterns) {
      const body = deps.read(full) ?? "";
      for (const pattern of artifact.patterns) {
        if (!pattern.test(body)) {
          errors.push(`${artifact.file} does not look complete (no ${pattern})`);
        }
      }
    }
  }
  return errors;
}

/**
 * Pure decision function — returns the block message, or null to allow.
 *
 * Every uncertain path returns null. This hook exists to catch a phase marked
 * done with nothing behind it, not to police ambiguity.
 */
export function evaluate(
  input: { subject?: string; status?: string },
  deps: Deps,
  sessionOverride?: string,
): string | null {
  const phase = detectPhase(input.subject);
  if (!phase) return null; // not a phase task

  const resolved = resolveSession(deps.sessions(), sessionOverride);
  if (resolved === null) return null; // no session → nothing to verify against
  if ("ambiguous" in resolved) return null; // several open → refuse to guess

  const sessionPath = resolved.path;

  if (input.status === "in_progress") {
    const predecessors = PHASE_DEPENDENCIES[phase];
    if (!predecessors) return null;
    const unmet: string[] = [];
    for (const pred of predecessors) {
      const spec = PHASE_ARTIFACTS[pred];
      if (!spec) continue;
      if (checkArtifacts(spec, sessionPath, deps).length > 0) {
        unmet.push(`${pred} (${spec.name})`);
      }
    }
    if (unmet.length === 0) return null;
    return [
      `BLOCKED: cannot start ${PHASE_ARTIFACTS[phase]?.name ?? phase} yet.`,
      `Incomplete prerequisite: ${unmet.join(", ")}.`,
      `Session: ${sessionPath}`,
    ].join("\n");
  }

  if (input.status !== "completed") return null;

  const spec = PHASE_ARTIFACTS[phase];
  if (!spec) return null; // phase has no artifacts to check (phase0, phase2)

  const errors = checkArtifacts(spec, sessionPath, deps);
  if (spec.evidence) {
    const evidenceError = runEvidence(spec.evidence, sessionPath, deps);
    if (evidenceError) errors.push(evidenceError);
  }
  if (errors.length === 0) return null;

  return [
    `BLOCKED: cannot complete ${spec.name}.`,
    ...errors.map((e) => `  - ${e}`),
    `Session: ${sessionPath}`,
  ].join("\n");
}

/**
 * Stop-event decision: is any phase HALF DONE?
 *
 * WHY THIS EXISTS ALONGSIDE `evaluate`.
 *
 * `evaluate` runs on `PreToolUse:TaskUpdate` and refuses to let a phase be marked
 * complete without its artifacts. That trigger is dead. `TaskCreate/Update/List/Get` and
 * `TodoWrite` were removed from Opus 4.8, Sonnet 5, Fable 5, Mythos 5 and newer in Claude
 * Code 2.1.233, so the tool is never called and the hook never fires. Measured with a
 * control rather than read from the changelog:
 *
 *   --model claude-sonnet-5   -> TaskCreate available? no
 *   --model claude-sonnet-4-6 -> TaskCreate available? yes
 *
 * The gate was therefore inert on every model this repo actually runs, while the command
 * text still promised it was enforced.
 *
 * WHAT REPLACED IT. `Stop` still fires, so the check moved there — but a Stop hook cannot
 * see "the agent is marking phase 3 complete", because no such event exists any more. It
 * can only see the artifacts on disk. So the question changes shape:
 *
 *   evaluate      "you are claiming this phase is done — is it?"
 *   evaluateStop  "you are ending the turn — is any phase half done?"
 *
 * A PARTIAL phase is the signal. A phase with none of its artifacts was never started; a
 * phase with all of them finished. One with SOME is a phase that was begun and abandoned,
 * which is exactly the shape of the failure this file was written to catch.
 *
 * Every uncertain path still returns null. This blocks a turn, which is disruptive, so it
 * fires only when the evidence is unambiguous.
 */
export function evaluateStop(deps: Deps, sessionOverride?: string): string | null {
  const resolved = resolveSession(deps.sessions(), sessionOverride);
  if (resolved === null) return null; // no session -> not a /dev:dev run
  if ("ambiguous" in resolved) return null; // several open -> refuse to guess

  const sessionPath = resolved.path;
  const partial: string[] = [];

  for (const [phase, spec] of Object.entries(PHASE_ARTIFACTS)) {
    if (spec.required.length === 0) continue;

    // Presence is counted from the FILES, never from the error list. One artifact can
    // produce several errors — missing, too small, and a content pattern that did not
    // match are separate strings — so `errors.length` does not correspond to artifacts
    // and cannot stand in for "how many are there". The first version of this loop
    // compared `errors.length === spec.required.length` to mean "none present", and a
    // unit test caught it scoring a COMPLETE phase as abandoned: every file existed, two
    // content patterns failed, and the arithmetic happened to line up.
    const present = spec.required.filter(
      (a) => deps.sizeOf(join(sessionPath, a.file)) !== null,
    ).length;
    if (present === 0) continue; // never started

    const errors = checkArtifacts(spec, sessionPath, deps);
    if (errors.length === 0) continue; // finished

    partial.push(`  - ${spec.name} (${phase}): ${errors.join("; ")}`);
  }

  if (partial.length === 0) return null;

  return [
    `INCOMPLETE PHASE: a /dev:dev phase was started and left without its artifacts.`,
    ...partial,
    `Session: ${sessionPath}`,
    `Finish the artifacts, or write a skip-reason.md saying why the phase was abandoned.`,
    `(Advisory: this does not block the turn. If the phase is still in progress, ignore it.)`,
  ].join("\n");
}

// ── Entry point ─────────────────────────────────────────────────────────────

function liveDeps(cwd: string): Deps {
  return {
    sizeOf: (p) => {
      try {
        return statSync(p).size;
      } catch {
        return null;
      }
    },
    read: (p) => {
      try {
        return readFileSync(p, "utf-8");
      } catch {
        return null;
      }
    },
    sessions: () => {
      const dir = join(cwd, "ai-docs/sessions");
      if (!existsSync(dir)) return [];
      try {
        return readdirSync(dir)
          .filter((d) => d.startsWith("dev-feature-"))
          .map((d) => join(dir, d));
      } catch {
        return [];
      }
    },
    dirtyPaths: () => {
      const r = spawnSync("git", ["status", "--porcelain"], {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
      });
      if (r.status !== 0 || !r.stdout) return [];
      return r.stdout
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
    },
  };
}

function main(): void {
  const input = readHookInput();
  if (!input) allow(); // no or unparseable payload → allow

  const cwd = input.cwd ?? process.cwd();

  // `--stop` is the live path.
  //
  // ADVISORY, NOT BLOCKING — and that is a correction, not a preference.
  //
  // The first version called `deny()`, which is the PreToolUse convention: write the
  // reason to stdout and exit 2. Run live, it produced this on EVERY turn of a healthy
  // /dev:dev run:
  //
  //   ⎿ Stop hook error: [bun .../phase-completion-validator.ts --stop]: No stderr output
  //
  // Two distinct faults, and the second is the one that matters.
  //
  // 1. Wrong stream. A Stop hook's exit-2 reason is read from STDERR, not stdout, so the
  //    message vanished and Claude Code reported an empty hook error.
  //
  // 2. Wrong trigger. `Stop` fires at the end of EVERY assistant turn, including while
  //    work is still in progress — the observed run fired it five times while the agent
  //    was legitimately waiting on a subagent. Mid-run, a phase in progress is PARTIAL by
  //    definition, so "some artifacts but not all" cannot distinguish "being worked on"
  //    from "abandoned". The information simply is not present at Stop time.
  //
  // That is the same class of error this hook was rewritten to fix. The old
  // PreToolUse:TaskUpdate trigger could never fire; this one fired constantly and wrongly.
  // A gate is only as good as the moment it is attached to.
  //
  // So it now REPORTS instead of blocking: the model sees the incomplete phase and can
  // act, and a long-running turn is never interrupted. Enforcement was traded for
  // correctness deliberately — a blocking gate that fires on healthy runs gets disabled by
  // whoever hits it first, which is worse than an advisory one that is right.
  if (process.argv.includes("--stop")) {
    let stopMessage: string | null = null;
    try {
      stopMessage = evaluateStop(liveDeps(cwd), process.env.CLAUDE_SESSION_PATH);
    } catch {
      process.exit(0); // any internal error → stay silent
    }
    if (stopMessage) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "Stop",
            additionalContext: stopMessage,
          },
        }),
      );
    }
    process.exit(0);
  }

  const subject = input.toolInput.subject;
  const status = input.toolInput.status;

  let message: string | null = null;
  try {
    message = evaluate(
      {
        subject: typeof subject === "string" ? subject : undefined,
        status: typeof status === "string" ? status : undefined,
      },
      liveDeps(cwd),
      process.env.CLAUDE_SESSION_PATH,
    );
  } catch {
    allow(); // any internal error → allow
  }

  if (message) deny(message);
  allow();
}

// Run only when executed directly, so the test file can import the pure parts.
if (import.meta.main) main();
