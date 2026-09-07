import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  detectPhase,
  evaluate,
  evaluateStop,
  PHASE_ARTIFACTS,
  resolveSession,
  type Deps,
} from "./phase-completion-validator.ts";

const SESSION = "ai-docs/sessions/dev-feature-x";
const HOOK = join(import.meta.dir, "phase-completion-validator.ts");

/** Deps backed by a plain map of path → contents. Absent key means missing. */
function fakeDeps(files: Record<string, string>, dirty: string[] = []): Deps {
  return {
    sizeOf: (p) => (p in files ? Buffer.byteLength(files[p]) : null),
    read: (p) => (p in files ? files[p] : null),
    sessions: () => [SESSION],
    dirtyPaths: () => dirty,
  };
}

/** Build a phase's required files at exactly the sizes/patterns it demands. */
function satisfying(phase: string): Record<string, string> {
  const pad = (n: number) => "x".repeat(n);
  switch (phase) {
    case "phase3":
      return {
        // Step 3.9 of phase3-planning writes context.json and architecture.md
        // together, at every depth. Neither is depth-grouped.
        [`${SESSION}/context.json`]: pad(400),
        [`${SESSION}/architecture.md`]: pad(600),
        [`${SESSION}/reviews/plan-review/consolidated.md`]: "verdict " + pad(300),
        [`${SESSION}/reviews/plan-review/claude-internal.md`]: "review " + pad(200),
      };
    case "phase4":
      return { [`${SESSION}/implementation-log.md`]: "Completed " + pad(200) };
    case "phase5":
      return {
        [`${SESSION}/reviews/code-review/consolidated.md`]:
          "## Verdict\n\nCONDITIONAL " + pad(200),
        [`${SESSION}/reviews/code-review/claude-internal.md`]:
          "review " + pad(100),
        // The capture the reviewers read. Complete means it has bytes in it.
        [`${SESSION}/code-changes.diff`]: "diff --git a/x b/x\n+x\n",
      };
    case "phase6":
      return { [`${SESSION}/tests/test-plan.md`]: pad(100) };
    default:
      return {};
  }
}

describe("detectPhase", () => {
  test("matches explicit phase numbers", () => {
    expect(detectPhase("Phase 4: build the thing")).toBe("phase4");
    expect(detectPhase("phase7")).toBe("phase7");
  });

  test("matches phase names without a number", () => {
    expect(detectPhase("Implementation of the parser")).toBe("phase4");
    expect(detectPhase("Code review pass")).toBe("phase5");
  });

  test("returns null for ordinary tasks", () => {
    expect(detectPhase("Fix the login redirect")).toBeNull();
    expect(detectPhase(undefined)).toBeNull();
  });
});

describe("resolveSession — must not guess", () => {
  test("uses an explicit override", () => {
    expect(resolveSession(["a", "b"], "/chosen")).toEqual({ path: "/chosen" });
  });

  test("accepts a single unambiguous candidate", () => {
    expect(resolveSession(["only"])).toEqual({ path: "only" });
  });

  test("declines to choose between several (the newest-mtime bug)", () => {
    expect(resolveSession(["a", "b"])).toEqual({ ambiguous: true });
  });

  test("returns null when there are none", () => {
    expect(resolveSession([])).toBeNull();
  });
});

describe("evaluate — allows anything it is unsure about", () => {
  test("non-phase task", () => {
    expect(
      evaluate({ subject: "Fix a typo", status: "completed" }, fakeDeps({})),
    ).toBeNull();
  });

  test("no session on disk", () => {
    const deps = { ...fakeDeps({}), sessions: () => [] };
    expect(
      evaluate({ subject: "Phase 4", status: "completed" }, deps),
    ).toBeNull();
  });

  test("several sessions open — refuses to guess rather than block wrongly", () => {
    const deps = { ...fakeDeps({}), sessions: () => ["a", "b"] };
    expect(
      evaluate({ subject: "Phase 4", status: "completed" }, deps),
    ).toBeNull();
  });

  test("status that is neither in_progress nor completed", () => {
    expect(
      evaluate({ subject: "Phase 4", status: "pending" }, fakeDeps({})),
    ).toBeNull();
  });

  test("phase with no artifact spec (phase0)", () => {
    expect(
      evaluate({ subject: "Phase 0 init", status: "completed" }, fakeDeps({})),
    ).toBeNull();
  });
});

describe("evaluate — blocks a phase completed with nothing behind it", () => {
  test("missing artifacts are named individually", () => {
    const msg = evaluate(
      { subject: "Phase 3 planning", status: "completed" },
      fakeDeps({}),
    );
    expect(msg).toContain("BLOCKED");
    expect(msg).toContain("missing architecture.md");
    // NOT the plan-review pair. Those are Full-depth artifacts behind a group,
    // and nothing in this session touched either — so the run simply did not go
    // that deep. Demanding them here is what made every Standard run look
    // abandoned. The grouped-artifact tests below pin both halves of that rule.
    expect(msg).not.toContain("reviews/plan-review/");
  });

  test("a file that exists but is too small still blocks", () => {
    const msg = evaluate(
      { subject: "Phase 3", status: "completed" },
      fakeDeps({ [`${SESSION}/architecture.md`]: "tiny" }),
    );
    expect(msg).toContain("architecture.md is 4 bytes, expected at least 500");
  });

  test("a file that exists at size but lacks required content blocks", () => {
    const files = satisfying("phase3");
    files[`${SESSION}/reviews/plan-review/consolidated.md`] = "y".repeat(300);
    const msg = evaluate({ subject: "Phase 3", status: "completed" }, fakeDeps(files));
    expect(msg).toContain("does not look complete");
  });

  test("fully satisfied phase 3 passes", () => {
    expect(
      evaluate(
        { subject: "Phase 3", status: "completed" },
        fakeDeps(satisfying("phase3")),
      ),
    ).toBeNull();
  });
});

describe("evidence checks — presence is not proof", () => {
  test("phase 4 blocks when the log exists but nothing changed", () => {
    const msg = evaluate(
      { subject: "Phase 4 implementation", status: "completed" },
      fakeDeps(satisfying("phase4"), []),
    );
    expect(msg).toContain("no working-tree changes");
  });

  test("phase 4 passes once the tree actually changed", () => {
    expect(
      evaluate(
        { subject: "Phase 4 implementation", status: "completed" },
        fakeDeps(satisfying("phase4"), ["src/parser.ts"]),
      ),
    ).toBeNull();
  });

  test("phase 5 blocks on a review with a heading but no verdict", () => {
    const files = {
      [`${SESSION}/reviews/code-review/consolidated.md`]:
        "## Verdict\n\nlooks fine to me " + "x".repeat(200),
    };
    const msg = evaluate({ subject: "Phase 5", status: "completed" }, fakeDeps(files));
    expect(msg).toContain("states no verdict");
  });

  test("phase 5 passes with a real verdict token", () => {
    expect(
      evaluate(
        { subject: "Phase 5", status: "completed" },
        fakeDeps(satisfying("phase5")),
      ),
    ).toBeNull();
  });

  test("phase 5 blocks when the internal review was never written", () => {
    const files = satisfying("phase5");
    delete files[`${SESSION}/reviews/code-review/claude-internal.md`];
    const msg = evaluate({ subject: "Phase 5", status: "completed" }, fakeDeps(files));
    expect(msg).toContain("missing reviews/code-review/claude-internal.md");
  });

  test("phase 5 blocks a PASS written over a 0-byte diff — a review that reviewed nothing", () => {
    // Both review files present, a verdict stated, and the capture the
    // reviewers read is empty. Until code-changes.diff became a required
    // artifact this cleared the gate: three different capture designs each
    // produced exactly this 0-byte file, and every one of them was passed.
    const files = satisfying("phase5");
    files[`${SESSION}/reviews/code-review/consolidated.md`] =
      "## Verdict\n\nPASS " + "x".repeat(200);
    files[`${SESSION}/code-changes.diff`] = "";
    const msg = evaluate({ subject: "Phase 5", status: "completed" }, fakeDeps(files));
    expect(msg).not.toBeNull(); // null here means the gate let it through
    expect(msg).toContain("code-changes.diff is 0 bytes, expected at least 1");
  });

  test("phase 5 passes once the diff has a byte in it", () => {
    // Exactly one byte — pins the floor as "has bytes", not a diff shape.
    const files = satisfying("phase5");
    files[`${SESSION}/reviews/code-review/consolidated.md`] =
      "## Verdict\n\nPASS " + "x".repeat(200);
    files[`${SESSION}/code-changes.diff`] = "+";
    expect(
      evaluate({ subject: "Phase 5", status: "completed" }, fakeDeps(files)),
    ).toBeNull();
  });

  test("phase 6 blocks when no test file was touched, despite tests existing in repo", () => {
    const msg = evaluate(
      { subject: "Phase 6 testing", status: "completed" },
      fakeDeps(satisfying("phase6"), ["src/parser.ts", "README.md"]),
    );
    expect(msg).toContain("no test files added or modified");
  });

  test("phase 6 passes when a test file was actually written", () => {
    expect(
      evaluate(
        { subject: "Phase 6 testing", status: "completed" },
        fakeDeps(satisfying("phase6"), ["src/parser.test.ts"]),
      ),
    ).toBeNull();
    expect(
      evaluate(
        { subject: "Phase 6 testing", status: "completed" },
        fakeDeps(satisfying("phase6"), ["pkg/thing_test.go"]),
      ),
    ).toBeNull();
  });
});

describe("evaluate — phase ordering on in_progress", () => {
  test("blocks phase 4 while phase 3 is incomplete", () => {
    const msg = evaluate(
      { subject: "Phase 4", status: "in_progress" },
      fakeDeps({}),
    );
    expect(msg).toContain("cannot start");
    expect(msg).toContain("phase3");
  });

  test("allows phase 4 once phase 3 artifacts exist", () => {
    expect(
      evaluate(
        { subject: "Phase 4", status: "in_progress" },
        fakeDeps(satisfying("phase3")),
      ),
    ).toBeNull();
  });

  test("allows a phase with no declared predecessors", () => {
    expect(
      evaluate({ subject: "Phase 3", status: "in_progress" }, fakeDeps({})),
    ).toBeNull();
  });
});

/**
 * The marshalling layer. These pin the two things the old validator got wrong:
 * input arrives on stdin, and blocking is exit 2.
 */
describe("process contract", () => {
  function run(payload: unknown, cwd = "/nonexistent-path-for-test") {
    return spawnSync("bun", [HOOK], {
      input: JSON.stringify(payload),
      encoding: "utf-8",
      timeout: 20_000,
      env: { ...process.env, CLAUDE_SESSION_PATH: "" },
    });
  }

  test("reads the payload from stdin and exits 0 for an ordinary task", () => {
    const r = run({
      hook_event_name: "PreToolUse",
      tool_name: "TaskUpdate",
      tool_input: { subject: "Fix a typo", status: "completed" },
      cwd: "/tmp",
    });
    expect(r.status).toBe(0);
  });

  test("empty stdin allows rather than crashing", () => {
    const r = spawnSync("bun", [HOOK], { input: "", encoding: "utf-8", timeout: 20_000 });
    expect(r.status).toBe(0);
  });

  test("malformed stdin allows rather than crashing", () => {
    const r = spawnSync("bun", [HOOK], {
      input: "{not json",
      encoding: "utf-8",
      timeout: 20_000,
    });
    expect(r.status).toBe(0);
  });

  test("blocks with exit 2 and prints the reason to stdout", () => {
    const r = spawnSync("bun", [HOOK], {
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "TaskUpdate",
        tool_input: { subject: "Phase 3 planning", status: "completed" },
        cwd: "/tmp",
      }),
      encoding: "utf-8",
      timeout: 20_000,
      env: { ...process.env, CLAUDE_SESSION_PATH: "/tmp/definitely-not-a-session" },
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("BLOCKED");
    expect(r.stdout).toContain("architecture.md");
  });
});


// ── evaluateStop: the live gate ────────────────────────────────────────────────
//
// The PreToolUse:TaskUpdate gate is dead on current models (the tool no longer exists),
// so this is the one that actually fires. These tests exist to prove it CAN fail —
// a gate that cannot fail is not a gate, and the one it replaced spent months in that
// state without anyone noticing.

describe("evaluateStop", () => {
  const STOP_SESSION = "/tmp/dev-feature-stop";

  /** Deps where `present` names the artifact files that exist, each 4 KB. */
  const depsWith = (present: string[]): Deps => ({
    sizeOf: (path) => (present.some((f) => path.endsWith(f)) ? 4096 : null),
    read: (path) =>
      present.some((f) => path.endsWith(f))
        // Must satisfy every phase's content patterns, or a COMPLETE phase reads as
        // partial and the "does not block" tests fail for the wrong reason.
        ? "# artifact\n\nstatus: PASS\n\nmodel review analysis: issue, concern,\n" +
          "verdict, recommendation, requirement, criteria, acceptance, risk,\n" +
          "architecture, component, test, coverage, scenario, evidence, summary\n\n" +
          "## Section\n\n- item\n"
        : null,
    sessions: () => [STOP_SESSION],
    dirtyPaths: () => ["src/thing.ts", "src/thing.test.ts"],
  });

  test("no session at all → allow (not every turn is a /dev:dev run)", () => {
    const deps = { ...depsWith([]), sessions: () => [] };
    expect(evaluateStop(deps)).toBeNull();
  });

  test("no artifacts anywhere → allow (nothing was started)", () => {
    expect(evaluateStop(depsWith([]))).toBeNull();
  });

  test("several open sessions → allow rather than guess which one", () => {
    const deps = {
      ...depsWith([]),
      sessions: () => ["/tmp/dev-feature-a", "/tmp/dev-feature-b"],
    };
    expect(evaluateStop(deps)).toBeNull();
  });

  test("A HALF-DONE PHASE BLOCKS — the whole point of the gate", () => {
    // Phase 5 declares two required artifacts and neither is depth-grouped, so
    // supplying exactly one is unambiguously "begun and abandoned". Phase 3
    // cannot express this any more: its second and third artifacts are Full-depth
    // only, so a lone architecture.md is a COMPLETE Standard run.
    const phase5 = PHASE_ARTIFACTS["phase5"];
    expect(phase5.required.length).toBeGreaterThan(1);
    expect(phase5.required.every((a) => a.group === undefined)).toBe(true);

    const message = evaluateStop(depsWith([phase5.required[0].file]));
    expect(message).not.toBeNull();
    expect(message).toContain("INCOMPLETE PHASE");
    expect(message).toContain(phase5.name);
    expect(message).toContain(STOP_SESSION);
  });

  test("a fully complete phase does not block", () => {
    const phase3 = PHASE_ARTIFACTS["phase3"];
    const all = phase3.required.map((a) => a.file);
    const message = evaluateStop(depsWith(all));
    // Any complaint must not be about phase3; other phases are absent, not partial.
    if (message !== null) expect(message).not.toContain(phase3.name);
  });

  test("the block names what is missing, not just that something is", () => {
    const phase5 = PHASE_ARTIFACTS["phase5"];
    const message = evaluateStop(depsWith([phase5.required[0].file]));
    expect(message).toContain(phase5.required[1].file);
  });
});

/**
 * The three defects this file could not previously express.
 *
 * All three made the hook fire on a CORRECTLY completed run, and one of them
 * made that fire impossible to acknowledge. A Stop hook repeats every turn, so
 * a false positive is not a one-off annoyance — it is a warning that trains
 * people to ignore warnings.
 */
describe("depth groups, and the acknowledgement that had to work", () => {
  const SESSION_PATH = "/tmp/dev-feature-depth";
  const BODY =
    "# artifact\n\nstatus: PASS\n\nmodel review analysis: issue, concern,\n" +
    "verdict, recommendation, requirement, criteria, acceptance, risk,\n" +
    "architecture, component, test, coverage, scenario, evidence, summary\n\n" +
    "## Section\n\n- item\n";

  const deps = (present: string[], dirty: string[] = []): Deps => ({
    sizeOf: (path) => (present.some((f) => path.endsWith(f)) ? 4096 : null),
    read: (path) => (present.some((f) => path.endsWith(f)) ? BODY : null),
    sessions: () => [SESSION_PATH],
    dirtyPaths: () => dirty,
  });

  test("a Standard run — context.json + architecture.md — is COMPLETE, not abandoned", () => {
    // The false positive. `/dev:dev` Standard is specified as single-model, so
    // it writes the Step 3.9 pair and never `reviews/plan-review/*`. Requiring
    // them made every Standard run report as a half-finished Full run.
    expect(evaluateStop(deps(["context.json", "architecture.md"]))).toBeNull();
  });

  test("but a Full run that wrote ONE review file is still caught", () => {
    // The other half of the rule — the group is required as soon as anything in
    // it exists, so genuinely abandoning the multi-model review still reports.
    const message = evaluateStop(
      deps(["context.json", "architecture.md", "reviews/plan-review/consolidated.md"]),
    );
    expect(message).not.toBeNull();
    expect(message).toContain("reviews/plan-review/claude-internal.md");
  });

  test("skip-reason.md actually suppresses, rather than being advice", () => {
    // The advisory told the reader to write this file and then never read it,
    // so the warning could not be acknowledged and repeated every turn. Found
    // by writing the file and watching the identical message return.
    const partial = deps([
      "context.json",
      "architecture.md",
      "reviews/plan-review/consolidated.md",
    ]);
    expect(evaluateStop(partial)).not.toBeNull();

    const acknowledged = deps([
      "context.json",
      "architecture.md",
      "reviews/plan-review/consolidated.md",
      "skip-reason.md",
    ]);
    expect(evaluateStop(acknowledged)).toBeNull();
  });

  test("the advice the message gives is advice the hook honours", () => {
    // Pins message and behaviour together: if someone drops the skip-reason
    // check, this fails rather than silently reverting to unsilenceable advice.
    const message = evaluateStop(
      deps(["context.json", "architecture.md", "reviews/plan-review/consolidated.md"]),
    );
    expect(message).toContain("skip-reason.md");
  });

  test("an implementation log is judged by size, not by vocabulary", () => {
    // The old check required /Phase|Step|Started|Completed|Created|Modified/,
    // which scored a real 15KB log at zero because it said "Landed in its
    // stated order" instead — while a shorter, emptier log containing "Step"
    // passed. A completion gate must not reward wording.
    const log = PHASE_ARTIFACTS["phase4"].required.find(
      (a) => a.file === "implementation-log.md",
    );
    expect(log).toBeDefined();
    expect(log?.patterns).toBeUndefined();
  });
});

describe("phase 3 gates the session context", () => {
  // `context.json` was written by Phase 3 from the beginning and checked by
  // nothing: no code in the repo read it, and it was in no phase spec. So a run
  // that produced an empty one, or none, cleared this gate and failed in Phase 4
  // where a missing loadout reads as an agent problem rather than a Phase 3 one.
  test("context.json is required, ungrouped, and size-gated", () => {
    const ctx = PHASE_ARTIFACTS["phase3"].required.find((a) => a.file === "context.json");
    expect(ctx).toBeDefined();
    expect(ctx?.minSize).toBe(200);
    // Ungrouped: every depth writes it, so it is never conditionally required.
    expect(ctx?.group).toBeUndefined();
    // No content patterns — shape is gated by `bun scripts/check-context-schema.ts`,
    // which validates the v2 schema properly instead of grepping for words.
    expect(ctx?.patterns).toBeUndefined();
  });

  test("a phase 3 with architecture.md but no context.json blocks", () => {
    const msg = evaluate(
      { subject: "Phase 3 planning", status: "completed" },
      fakeDeps({ [`${SESSION}/architecture.md`]: "x".repeat(600) }),
    );
    expect(msg).toContain("BLOCKED");
    expect(msg).toContain("missing context.json");
  });
});
