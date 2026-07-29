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
    required: [{ file: "reviews/code-review/consolidated.md", minSize: 200 }],
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
