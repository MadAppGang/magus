import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyGit } from "./git.ts";
import { nextCommand, nothingToReport, renderHead, whatIsStale } from "./render.ts";
import { liveSessionsIn, projectSlug, resolveSession } from "./sessions.ts";
import { readTasks } from "./tasks.ts";
import { emptyFacts } from "./transcript.ts";
import type { Bundle } from "./types.ts";

function bundle(over: Partial<Bundle> = {}): Bundle {
  const git = emptyGit();
  git.isRepo = true;
  git.branch = "worktree-x";
  git.defaultBranch = "main";
  git.fetched = true;
  return {
    generatedAt: "2026-09-08T12:00:00.000Z",
    cwd: "/repo/.claude/worktrees/x",
    sessionId: "abcdef12-0000",
    transcript: { ...emptyFacts("/t.jsonl"), parsed: true },
    git,
    pr: { available: true, none: true },
    otherSessions: [],
    tasks: [],
    devSessions: [],
    gate: { verdict: "NOT_APPLICABLE", checks: [], reasons: [] },
    errors: [],
    ...over,
  };
}

describe("nothingToReport", () => {
  test("a fresh clean session injects nothing", () => {
    expect(nothingToReport(bundle())).toBe(true);
  });
  test("one decision is enough to report", () => {
    const b = bundle();
    b.transcript.decisions.push({ at: "t", question: "q", chosen: "a", rejected: [] });
    expect(nothingToReport(b)).toBe(false);
  });
  test("an uncommitted file is enough to report", () => {
    const b = bundle();
    b.git.dirty.untracked.push("x.ts");
    expect(nothingToReport(b)).toBe(false);
  });
});

describe("renderHead", () => {
  test("leads with the three lines and names decisions with rejected options", () => {
    const b = bundle();
    b.transcript.firstPrompt = "Build the status command";
    b.transcript.decisions.push({ at: "2026-09-08T10:02:00.000Z", header: "Scope", question: "D1", chosen: "A", rejected: ["B", "C"] });
    b.transcript.verifications.push({ at: "2026-09-08T10:07:00.000Z", kind: "test", command: "bun test", ok: false, detail: "2 fail" });
    const out = renderHead(b, { maxChars: 4000, source: "compact" });
    expect(out.startsWith("## Status re-injected after compact")).toBe(true);
    expect(out).toContain("**Where you are:**");
    expect(out).toContain("**What's stale:**");
    expect(out).toContain("**Next command:** fix the failing test");
    expect(out).toContain("[Scope] D1 → **A** (rejected: B, C)");
    expect(out).toContain("`bun test` → FAILED (2 fail)");
  });

  test("truncates at a line boundary and says so", () => {
    const b = bundle();
    for (let i = 0; i < 40; i++) b.transcript.decisions.push({ at: "t", question: `question number ${i} with some length to it`, chosen: "yes", rejected: ["no"] });
    const out = renderHead(b, { maxChars: 600 });
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out.endsWith("… (truncated; run /dev:status for the full report)")).toBe(true);
  });

  test("a failing run followed by a passing run of the same kind is not 'fix the failing test'", () => {
    const b = bundle();
    b.git.dirty.tracked.push("a.ts");
    b.transcript.verifications.push({ at: "t1", kind: "test", command: "bun test", ok: false, detail: "6 fail" });
    expect(nextCommand(b)).toBe("fix the failing test (`bun test`)");
    b.transcript.verifications.push({ at: "t2", kind: "test", command: "bun test", ok: true, detail: "64 pass" });
    expect(nextCommand(b)).toBe("run the tests, then commit");
  });

  test("next command follows the shipping order: commit, push, PR, merge, remove", () => {
    const b = bundle();
    b.git.dirty.tracked.push("a.ts");
    expect(nextCommand(b)).toBe("run the tests, then commit");
    b.git.dirty.tracked = [];
    b.git.unpushed.push({ sha: "abc", subject: "x", at: "" });
    expect(nextCommand(b)).toBe("git push -u origin worktree-x");
    b.git.unpushed = [];
    b.git.commits.push({ sha: "abc", subject: "x", at: "" });
    expect(nextCommand(b)).toBe("gh pr create --fill");
    b.pr = { available: true, number: 5, state: "OPEN" };
    expect(nextCommand(b)).toBe("wait for PR #5 to merge");
    b.pr = { available: true, number: 5, state: "MERGED" };
    b.gate = { verdict: "SAFE", checks: [], reasons: [] };
    expect(nextCommand(b)).toContain("worktree can go");
  });

  test("staleness names a plan older than the last commit", () => {
    const b = bundle();
    b.git.commits.push({ sha: "abc", subject: "x", at: "2026-09-08T11:00:00.000Z" });
    b.transcript.verifications.push({ at: "2026-09-08T11:30:00.000Z", kind: "test", command: "bun test", ok: true });
    b.planFile = { path: "/p.md", exists: true, modifiedAt: "2026-09-08T09:00:00.000Z" };
    expect(whatIsStale(b)).toContain("plan file predates the last commit");
  });
});

describe("sessions and tasks", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-status-sessions-"));
  const cwd = join(dir, "wt");
  mkdirSync(cwd);

  test("projectSlug matches Claude Code's directory naming", () => {
    expect(projectSlug("/Users/x/repo/.claude/worktrees/status")).toBe("-Users-x-repo--claude-worktrees-status");
  });

  test("resolveSession: argument, then env, then the sessions file, then the newest transcript", () => {
    const proj = join(dir, "projects", projectSlug(cwd));
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "sid-arg.jsonl"), "{}\n");
    writeFileSync(join(proj, "sid-env.jsonl"), "{}\n");
    mkdirSync(join(dir, "sessions"));
    // A pid no process can have (macOS caps at 99998), so this record never counts as live below.
    writeFileSync(join(dir, "sessions", "4000001.json"), JSON.stringify({ pid: 4_000_001, sessionId: "sid-file", cwd }));

    expect(resolveSession({ explicit: "sid-arg", cwd, env: {}, configDir: dir })).toEqual({ id: "sid-arg", source: "argument", transcriptPath: join(proj, "sid-arg.jsonl") });
    expect(resolveSession({ cwd, env: { CLAUDE_CODE_SESSION_ID: "sid-env" }, configDir: dir }).source).toBe("env");
    expect(resolveSession({ cwd, env: { CLAUDE_PID: "4000001" }, configDir: dir })).toMatchObject({ id: "sid-file", source: "sessions-file" });
    expect(resolveSession({ cwd, env: {}, configDir: dir }).source).toBe("newest-transcript");
    expect(resolveSession({ cwd: join(dir, "nowhere"), env: {}, configDir: dir }).id).toBeUndefined();
  });

  test("liveSessionsIn: same cwd and alive counts, self and dead pids do not", () => {
    writeFileSync(join(dir, "sessions", "alive.json"), JSON.stringify({ pid: process.pid, sessionId: "other", cwd, name: "sibling", status: "busy" }));
    writeFileSync(join(dir, "sessions", "dead.json"), JSON.stringify({ pid: 4_000_000, sessionId: "dead", cwd }));
    writeFileSync(join(dir, "sessions", "self.json"), JSON.stringify({ pid: process.pid, sessionId: "me", cwd }));
    writeFileSync(join(dir, "sessions", "elsewhere.json"), JSON.stringify({ pid: process.pid, sessionId: "far", cwd: join(dir, "other") }));
    const live = liveSessionsIn(cwd, "me", dir);
    expect(live.map((s) => s.sessionId)).toEqual(["other"]);
    expect(live[0]?.name).toBe("sibling");
  });

  test("readTasks reads one task per file and tolerates a bad one", () => {
    const t = join(dir, "tasks", "sid-arg");
    mkdirSync(t, { recursive: true });
    writeFileSync(join(t, "1.json"), JSON.stringify({ id: "1", subject: "first", status: "completed", blocks: ["2"], blockedBy: [] }));
    writeFileSync(join(t, "2.json"), JSON.stringify({ id: "2", subject: "second", status: "pending", blockedBy: ["1"] }));
    writeFileSync(join(t, "3.json"), "not json");
    expect(readTasks("sid-arg", dir).map((x) => [x.id, x.status, x.blockedBy])).toEqual([["1", "completed", []], ["2", "pending", ["1"]]]);
    expect(readTasks("missing", dir)).toEqual([]);
  });

  test("cleanup", () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
