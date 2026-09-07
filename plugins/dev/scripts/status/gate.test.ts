import { describe, expect, test } from "bun:test";
import { evaluateGate, type GateInput } from "./gate.ts";
import { emptyGit } from "./git.ts";
import type { GitFacts, PrFacts } from "./types.ts";

/** A clean, pushed, merged Claude-managed worktree — the SAFE baseline every other case mutates. */
function safeGit(): GitFacts {
  const g = emptyGit();
  g.isRepo = true;
  g.root = "/repo/.claude/worktrees/feat";
  g.branch = "worktree-feat";
  g.upstream = "origin/worktree-feat";
  g.defaultBranch = "main";
  g.fetched = true;
  g.commits = [{ sha: "a1b2c3d4e5", subject: "feat: thing", at: "2026-09-08T10:00:00Z" }];
  g.mergedIntoDefault = true;
  g.remoteBranchExists = false;
  g.worktree = { linked: true, managedByClaude: true, name: "feat", gitDir: "/repo/.git/worktrees/feat", commonDir: "/repo/.git" };
  return g;
}

const merged: PrFacts = { available: true, number: 7, state: "MERGED", mergedAt: "2026-09-08T11:00:00Z", mergeCommit: "deadbeefcafe" };

function input(over: Partial<GateInput> = {}): GateInput {
  return { git: safeGit(), pr: merged, otherSessions: [], lockHeldByOther: false, ...over };
}

describe("worktree gate verdicts", () => {
  test("SAFE: clean, pushed, PR merged, commits on default", () => {
    const g = evaluateGate(input());
    expect(g.verdict).toBe("SAFE");
    expect(g.removal).toBe('ExitWorktree({ action: "remove" })');
    expect(g.checks.map((c) => c.result)).toEqual(["pass", "pass", "pass", "pass", "pass", "pass"]);
  });

  test("negative control: the same worktree with one unpushed commit is NOT_SAFE", () => {
    const git = safeGit();
    git.unpushed = [{ sha: "ffff0000", subject: "wip", at: "" }];
    const g = evaluateGate(input({ git }));
    expect(g.verdict).toBe("NOT_SAFE");
    expect(g.reasons).toContain("unpushed commits");
    expect(g.checks[2]?.fix).toBe("git push");
    expect(g.removal).toBeUndefined();
  });

  test("NOT_SAFE: dirty tree lists the files and the fix", () => {
    const git = safeGit();
    git.dirty = { tracked: ["a.ts"], untracked: ["b.md"], machineOwned: [".claude/.coaching/state.json"] };
    const g = evaluateGate(input({ git }));
    expect(g.verdict).toBe("NOT_SAFE");
    expect(g.checks[1]?.evidence).toContain("a.ts, b.md");
  });

  test("NOT_SAFE: PR still open, with failing checks named", () => {
    const pr: PrFacts = { available: true, number: 7, state: "OPEN", checks: { total: 3, passing: 1, failing: 1, pending: 1 } };
    const git = safeGit();
    git.mergedIntoDefault = false;
    const g = evaluateGate(input({ pr, git }));
    expect(g.verdict).toBe("NOT_SAFE");
    expect(g.checks[3]?.fix).toContain("fix the 1 failing check");
  });

  test("NOT_SAFE: another live session in the worktree", () => {
    const g = evaluateGate(input({ otherSessions: [{ pid: 4242, sessionId: "other-session", cwd: "/repo/.claude/worktrees/feat", name: "sibling" }] }));
    expect(g.verdict).toBe("NOT_SAFE");
    expect(g.checks[5]?.evidence).toContain("sibling (pid 4242)");
  });

  test("NOT_SAFE: lock held by another live process", () => {
    expect(evaluateGate(input({ lockHeldByOther: true })).verdict).toBe("NOT_SAFE");
  });

  test("UNKNOWN: gh unavailable and no git-only proof of a merge", () => {
    const git = safeGit();
    git.mergedIntoDefault = false;
    git.remoteBranchExists = true;
    const g = evaluateGate(input({ git, pr: { available: false, reason: "gh is not installed" } }));
    expect(g.verdict).toBe("UNKNOWN");
    expect(g.reasons[0]).toContain("gh is not installed");
  });

  test("UNKNOWN: pushed but no PR yet", () => {
    const git = safeGit();
    git.mergedIntoDefault = false;
    git.remoteBranchExists = true;
    const g = evaluateGate(input({ git, pr: { available: true, none: true } }));
    expect(g.verdict).toBe("UNKNOWN");
    expect(g.checks[3]?.fix).toContain("gh pr create");
  });

  test("SAFE_WITH_CONFIRMATION: squash-merged PR, commits not ancestors of default", () => {
    const git = safeGit();
    git.mergedIntoDefault = false;
    const g = evaluateGate(input({ git }));
    expect(g.verdict).toBe("SAFE_WITH_CONFIRMATION");
    expect(g.discards).toEqual(["a1b2c3d feat: thing"]);
    expect(g.removal).toContain("discard_changes: true");
  });

  test("SAFE by git alone: remote branch gone and HEAD on default, no PR record", () => {
    const g = evaluateGate(input({ pr: { available: true, none: true } }));
    expect(g.verdict).toBe("SAFE");
    expect(g.reasons[0]).toContain("merged detected from git alone");
  });

  test("SAFE: an empty worktree (no commits, nothing to merge) can always go", () => {
    const git = safeGit();
    git.commits = [];
    git.upstream = undefined;
    git.mergedIntoDefault = null;
    const g = evaluateGate(input({ git, pr: { available: true, none: true } }));
    expect(g.verdict).toBe("SAFE");
  });

  test("SAFE: an empty worktree with gh unavailable — measured in the DST-1 probe as a wrong UNKNOWN", () => {
    const git = safeGit();
    git.commits = [];
    git.upstream = undefined;
    git.defaultBranch = undefined;
    git.mergedIntoDefault = null;
    git.remoteBranchExists = null;
    const g = evaluateGate(input({ git, pr: { available: false, reason: "gh disabled (--no-gh)" } }));
    expect(g.verdict).toBe("SAFE");
    expect(g.checks[3]?.result).toBe("skip");
    expect(g.checks[3]?.evidence).toContain("nothing to merge");
  });

  test("negative control: the same gh-unavailable worktree WITH a commit stays UNKNOWN", () => {
    const git = safeGit();
    git.upstream = "origin/worktree-feat";
    git.mergedIntoDefault = false;
    git.remoteBranchExists = true;
    const g = evaluateGate(input({ git, pr: { available: false, reason: "gh disabled (--no-gh)" } }));
    expect(g.verdict).toBe("UNKNOWN");
  });

  test("hand-made worktree gets manual removal commands, never ExitWorktree", () => {
    const git = safeGit();
    git.worktree.managedByClaude = false;
    git.root = "/elsewhere/feat";
    const g = evaluateGate(input({ git }));
    expect(g.verdict).toBe("SAFE");
    expect(g.removal).toBe('from the main checkout: git worktree remove "/elsewhere/feat" && git branch -d worktree-feat');
  });

  test("NOT_APPLICABLE: the main checkout, and a non-repo", () => {
    const git = safeGit();
    git.worktree.linked = false;
    expect(evaluateGate(input({ git })).verdict).toBe("NOT_APPLICABLE");
    expect(evaluateGate(input({ git: emptyGit() })).verdict).toBe("NOT_APPLICABLE");
  });
});
