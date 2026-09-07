import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { classifyCommand, judgeResult, parseTranscript, parseTranscriptText, turnFromPrompt } from "./transcript.ts";

const TESTDATA = join(import.meta.dir, "testdata", "session.jsonl");

describe("parseTranscript over the measured record shapes", () => {
  const f = parseTranscript(TESTDATA);

  test("parses and survives malformed and unknown lines", () => {
    expect(f.parsed).toBe(true);
    expect(f.skippedReason).toBeUndefined();
    expect(f.sessionId).toBe("sess-1");
  });

  test("native records: title, worktree, pr-link, cost", () => {
    expect(f.title).toBe("status-command-test");
    expect(f.worktree).toEqual({ path: "/repo/.claude/worktrees/status", name: "status", branch: "worktree-status", originalBranch: "main", baseCommit: "abc123" });
    expect(f.prLink).toEqual({ number: 42, url: "https://github.com/org/repo/pull/42", repository: "org/repo" });
    expect(f.cost?.totalCostUSD).toBe(1.25);
    expect(f.cost?.linesAdded).toBe(300);
  });

  test("where we started: the first prompt, unwrapped from the slash-command tags", () => {
    expect(f.firstPrompt).toBe("/investigate Build the status command");
    expect(f.startedAt).toBe("2026-09-08T10:00:00.000Z");
  });

  test("turns: user prompts only — not tool results, sidechains, local-command output or the compaction summary", () => {
    expect(f.turns.map((t) => t.kind)).toEqual(["command", "prompt", "prompt"]);
    expect(f.turns[0]).toMatchObject({ command: "investigate", text: "Build the status command" });
    expect(f.turns[1]?.text).toBe("Now implement it, tests first.");
  });

  test("a message typed mid-turn (queue-operation enqueue) is a turn; a queued task notification is not", () => {
    expect(f.turns[2]).toEqual({ at: "2026-09-08T10:15:00.000Z", kind: "prompt", text: "do not forget to run real evals" });
    expect(f.lastAt).toBe("2026-09-08T10:15:05.000Z");
  });

  test("decisions: AskUserQuestion paired with the structured answer, rejected options kept", () => {
    expect(f.decisions).toHaveLength(1);
    expect(f.decisions[0]).toMatchObject({
      at: "2026-09-08T10:02:00.000Z",
      header: "Scope",
      question: "D1 — Scope of /dev:status",
      chosen: "A) Command + hook",
      rejected: ["B) Command only"],
    });
  });

  test("plan: file named by plan mode, then edited, then approved", () => {
    expect(f.planFile).toBe("/home/u/.claude/plans/build-status-happy-otter.md");
    expect(f.planEvents.map((p) => p.kind)).toEqual(["file", "edit", "approved"]);
  });

  test("verification: failing run, passing run, commit, and a push with no result yet", () => {
    expect(f.verifications.map((v) => [v.kind, v.ok])).toEqual([
      ["test", false],
      ["test", true],
      ["commit", true],
      ["push", null],
    ]);
    expect(f.verifications[0]?.detail).toBe("2 fail");
    expect(f.verifications[1]?.detail).toBe("12 pass");
  });

  test("compaction points keep the opening of what survived", () => {
    expect(f.compactions).toHaveLength(1);
    expect(f.compactions[0]?.summary).toContain("Primary Request and Intent");
  });

  test("friction: every tool error, named by tool", () => {
    expect(f.friction.map((x) => x.tool)).toEqual(["Bash", "Read"]);
    expect(f.friction[1]?.error).toBe("File does not exist.");
  });

  test("delegations and the session directories this session wrote to", () => {
    expect(f.delegations).toEqual([{ at: "2026-09-08T10:10:00.000Z", agent: "Explore", description: "Explore hooks" }]);
    expect(f.sessionDirs).toEqual(["ai-docs/sessions/dev-feature-status-20260908-100600-abcd1234"]);
  });

  test("last assistant text", () => {
    expect(f.lastAssistantText).toBe("Done. Tests pass.");
  });
});

describe("degradation", () => {
  test("a missing transcript yields parsed:false with a reason, not a throw", () => {
    const f = parseTranscript("/nonexistent/path.jsonl");
    expect(f.parsed).toBe(false);
    expect(f.skippedReason).toBe("transcript not found");
    expect(f.turns).toEqual([]);
  });

  test("an empty transcript parses to empty facts", () => {
    const f = parseTranscriptText("", "x");
    expect(f.parsed).toBe(true);
    expect(f.decisions).toEqual([]);
  });

  test("negative control: an AskUserQuestion with no answer is not a decision", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { content: [{ type: "tool_use", id: "q", name: "AskUserQuestion", input: { questions: [{ question: "x?", options: [] }] } }] },
    });
    expect(parseTranscriptText(line, "x").decisions).toEqual([]);
  });
});

describe("classifyCommand", () => {
  test.each([
    ["bun test plugins/dev", "test"],
    ["bun run check:all", "check"],
    ["git commit -m x", "commit"],
    ["git push", "push"],
    ["gh pr create --fill", "pr"],
    ["go test ./...", "test"],
    ["npx tsc --noEmit", "typecheck"],
    ["ls -la", null],
    ["git status", null],
    // Measured false positive: a file read that merely names a checker script.
    ["sed -n 1,70p plugins/dev/scripts/outer-loop.test.ts; echo \"=== check-types\"; sed -n 1,60p scripts/check-types.ts", null],
    ["bun test plugins/dev/scripts/status > /tmp/t.log 2>&1; echo \"exit=$?\"; grep fail /tmp/t.log", "test"],
    ["cd sub && time bun run check:all", "check"],
    ["FOO=1 npx tsc --noEmit", "typecheck"],
    ["git add -A && git commit -m x && git push", "commit"],
  ])("%s → %s", (cmd, kind) => {
    expect(classifyCommand(cmd)).toBe(kind as never);
  });
});

describe("judgeResult", () => {
  test("is_error wins", () => {
    expect(judgeResult(true, " 12 pass").ok).toBe(false);
  });
  test("a fail count fails, zero fails passes", () => {
    expect(judgeResult(false, " 3 pass\n 1 fail").ok).toBe(false);
    expect(judgeResult(false, " 3 pass\n 0 fail")).toEqual({ ok: true, detail: "3 pass" });
  });
  test("TypeScript errors and non-zero exit codes fail", () => {
    expect(judgeResult(false, "src/x.ts(3,1): error TS2322: nope").ok).toBe(false);
    expect(judgeResult(false, "Exit code 1").ok).toBe(false);
  });
  test("silence is a pass", () => {
    expect(judgeResult(false, "")).toEqual({ ok: true, detail: undefined });
  });
});

describe("turnFromPrompt", () => {
  test("drops local command output and interruptions", () => {
    expect(turnFromPrompt("<local-command-stdout>x</local-command-stdout>", "t")).toBeNull();
    expect(turnFromPrompt("[Request interrupted by user]", "t")).toBeNull();
    expect(turnFromPrompt("   ", "t")).toBeNull();
  });
});
