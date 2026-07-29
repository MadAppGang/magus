import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  detectPhase,
  evaluate,
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
        [`${SESSION}/architecture.md`]: pad(600),
        [`${SESSION}/reviews/plan-review/consolidated.md`]: "verdict " + pad(300),
        [`${SESSION}/reviews/plan-review/claude-internal.md`]: "review " + pad(200),
      };
    case "phase4":
      return { [`${SESSION}/implementation-log.md`]: "Completed " + pad(200) };
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
    expect(msg).toContain("missing reviews/plan-review/consolidated.md");
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
    const files = {
      [`${SESSION}/reviews/code-review/consolidated.md`]:
        "## Verdict\n\nCONDITIONAL " + "x".repeat(200),
    };
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
