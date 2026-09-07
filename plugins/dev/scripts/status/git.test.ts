/**
 * Real git, throwaway repositories: a bare "origin", a main checkout, and a linked worktree
 * under `.claude/worktrees/` so `managedByClaude` is exercised for real. The pushed /
 * merged / remote-branch-gone transitions are the ones the gate reads, and each is
 * asserted before AND after the transition so a check that could not fail is caught.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect } from "./collect.ts";
import { collectGit, defaultRunner, parseStatus, parseTrailers } from "./git.ts";
import type { Runner } from "./types.ts";

/** Nothing from the machine: no global config, no system config, and no
 *  `~/.config/git/ignore` (git reads that XDG file even when the global config is
 *  nulled; this machine's hides `.claude/settings.local.json`). */
const XDG = mkdtempSync(join(tmpdir(), "dev-status-xdg-"));
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  XDG_CONFIG_HOME: XDG,
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

let base: string;
let work: string;
let wt: string;
const OPTS = { fetch: true, fetchTimeoutMs: 10_000 };
// Same nulled global config as the test's own git calls: a machine-wide gitignore (this
// one hides `.claude/`) must not decide what the collector sees.
const run = defaultRunner({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", XDG_CONFIG_HOME: XDG });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "dev-status-git-"));
  const remote = join(base, "remote.git");
  work = join(base, "work");
  git(base, "init", "--bare", "-b", "main", remote);
  git(base, "init", "-b", "main", work);
  writeFileSync(join(work, "README.md"), "hello\n");
  git(work, "add", "README.md");
  git(work, "commit", "-q", "-m", "init");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-q", "-u", "origin", "main");
  wt = join(work, ".claude", "worktrees", "feat");
  git(work, "worktree", "add", "-q", "-b", "worktree-feat", wt);
  writeFileSync(join(wt, "feat.txt"), "feature\n");
  git(wt, "add", "feat.txt");
  git(wt, "commit", "-q", "-m", "feat: add feature\n\n[gstack-context]\nDecisions: use bun\nRemaining: docs\nTried: python first, too slow\n[/gstack-context]");
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(XDG, { recursive: true, force: true });
});

describe("collectGit on a real worktree", () => {
  test("identity: linked, Claude-managed, on its branch, base from merge-base", () => {
    const g = collectGit(wt, run, OPTS);
    expect(g.isRepo).toBe(true);
    expect(g.worktree.linked).toBe(true);
    expect(g.worktree.managedByClaude).toBe(true);
    expect(g.worktree.name).toBe("feat");
    expect(g.branch).toBe("worktree-feat");
    expect(g.defaultBranch).toBe("main");
    expect(g.baseSource).toBe("merge-base");
    expect(g.commits.map((c) => c.subject)).toEqual(["feat: add feature"]);
    expect(g.trailers).toEqual({ decisions: ["use bun"], remaining: ["docs"], tried: ["python first, too slow"] });
  });

  test("the main checkout is not linked", () => {
    expect(collectGit(work, run, OPTS).worktree.linked).toBe(false);
  });

  test("before push: no upstream, not merged, remote branch absent → gate NOT_SAFE", () => {
    const g = collectGit(wt, run, OPTS);
    expect(g.upstream).toBeUndefined();
    expect(g.mergedIntoDefault).toBe(false);
    expect(g.remoteBranchExists).toBe(false);
    expect(g.fetched).toBe(true);
    const b = collect({ cwd: wt, transcript: false, gh: false, run, configDir: join(base, "no-config") });
    expect(b.gate.verdict).toBe("NOT_SAFE");
    expect(b.gate.checks[2]?.fix).toBe("git push -u origin worktree-feat");
  });

  test("dirty tree is reported by kind, and machine-owned paths never count as dirty", () => {
    writeFileSync(join(wt, "scratch.txt"), "x\n");
    writeFileSync(join(wt, "feat.txt"), "feature changed\n");
    // What the dev plugin's Stop hook and /dev:status themselves leave behind in a
    // checkout that does not gitignore them — measured in the DST-1 bench.
    mkdirSync(join(wt, ".claude", ".coaching"), { recursive: true });
    writeFileSync(join(wt, ".claude", ".coaching", "state.json"), "{}\n");
    writeFileSync(join(wt, ".claude", "settings.local.json"), "{}\n");
    mkdirSync(join(wt, "ai-docs", "sessions", "status"), { recursive: true });
    writeFileSync(join(wt, "ai-docs", "sessions", "status", "x.md"), "# r\n");
    const g = collectGit(wt, run, { ...OPTS, fetch: false });
    expect(g.dirty.tracked).toEqual(["feat.txt"]);
    expect(g.dirty.untracked).toEqual(["scratch.txt"]);
    expect(g.dirty.machineOwned.sort()).toEqual([".claude/.coaching/state.json", ".claude/settings.local.json", "ai-docs/sessions/status/x.md"]);
    // Negative control: a user's own file under .claude/ is still dirty.
    writeFileSync(join(wt, ".claude", "mine.md"), "keep\n");
    expect(collectGit(wt, run, { ...OPTS, fetch: false }).dirty.untracked.sort()).toEqual([".claude/mine.md", "scratch.txt"]);
    git(wt, "checkout", "--", "feat.txt");
    rmSync(join(wt, "scratch.txt"));
    rmSync(join(wt, ".claude"), { recursive: true });
    rmSync(join(wt, "ai-docs"), { recursive: true });
    // Only machine-owned leftovers → the gate treats the tree as clean.
    mkdirSync(join(wt, ".claude", ".coaching"), { recursive: true });
    writeFileSync(join(wt, ".claude", ".coaching", "state.json"), "{}\n");
    const b = collect({ cwd: wt, transcript: false, gh: false, run, configDir: join(base, "no-config") });
    expect(b.gate.checks[1]?.result).toBe("pass");
    expect(b.gate.checks[1]?.evidence).toContain("ignored 1 machine-owned");
    rmSync(join(wt, ".claude"), { recursive: true });
  });

  test("after push: upstream set, nothing unpushed, remote branch exists → gate UNKNOWN without a PR", () => {
    git(wt, "push", "-q", "-u", "origin", "worktree-feat");
    const g = collectGit(wt, run, OPTS);
    expect(g.upstream).toBe("origin/worktree-feat");
    expect(g.unpushed).toEqual([]);
    expect(g.remoteBranchExists).toBe(true);
    const gh: Runner = (cmd, args, o) => (cmd === "gh" ? { ok: true, code: 0, stdout: "[]", stderr: "", timedOut: false, missing: false } : run(cmd, args, o));
    const b = collect({ cwd: wt, transcript: false, run: gh, configDir: join(base, "no-config") });
    expect(b.pr.none).toBe(true);
    expect(b.gate.verdict).toBe("UNKNOWN");
  });

  test("a merged PR answered by gh makes it SAFE_WITH_CONFIRMATION until the commits land on main", () => {
    const gh: Runner = (cmd, args, o) =>
      cmd === "gh"
        ? { ok: true, code: 0, stdout: JSON.stringify([{ number: 3, url: "u", state: "MERGED", mergedAt: "2026-09-08T12:00:00Z", mergeCommit: { oid: "abc" } }]), stderr: "", timedOut: false, missing: false }
        : run(cmd, args, o);
    const b = collect({ cwd: wt, transcript: false, run: gh, configDir: join(base, "no-config") });
    expect(b.pr.state).toBe("MERGED");
    expect(b.gate.verdict).toBe("SAFE_WITH_CONFIRMATION");
    expect(b.gate.discards?.length).toBe(1);
  });

  test("after merge to main and remote branch deletion: merged by ancestry → SAFE from git alone", () => {
    git(work, "merge", "-q", "--no-edit", "worktree-feat");
    git(work, "push", "-q", "origin", "main");
    git(work, "push", "-q", "origin", "--delete", "worktree-feat");
    const g = collectGit(wt, run, OPTS);
    expect(g.mergedIntoDefault).toBe(true);
    expect(g.remoteBranchExists).toBe(false);
    expect(g.upstreamGone).toBe(true);
    expect(g.unpushed).toEqual([]);
    const gh: Runner = (cmd, args, o) => (cmd === "gh" ? { ok: true, code: 0, stdout: "[]", stderr: "", timedOut: false, missing: false } : run(cmd, args, o));
    const b = collect({ cwd: wt, transcript: false, run: gh, configDir: join(base, "no-config") });
    expect(b.gate.verdict).toBe("SAFE");
    expect(b.gate.removal).toBe('ExitWorktree({ action: "remove" })');
  });

  test("negative control: one new commit after the merge flips it back to NOT_SAFE", () => {
    writeFileSync(join(wt, "more.txt"), "more\n");
    git(wt, "add", "more.txt");
    git(wt, "commit", "-q", "-m", "more");
    const g = collectGit(wt, run, OPTS);
    expect(g.mergedIntoDefault).toBe(false);
    expect(g.unpushed.map((c) => c.subject)).toEqual(["more"]);
    const b = collect({ cwd: wt, transcript: false, gh: false, run, configDir: join(base, "no-config") });
    expect(b.gate.verdict).toBe("NOT_SAFE");
    expect(b.gate.reasons).toContain("unpushed commits");
  });

  test("a directory that is not a repository degrades to NOT_APPLICABLE", () => {
    const g = collectGit(tmpdir(), run, OPTS);
    expect(g.isRepo).toBe(false);
    const b = collect({ cwd: tmpdir(), transcript: false, gh: false, run, configDir: join(base, "no-config") });
    expect(b.gate.verdict).toBe("NOT_APPLICABLE");
  });
});

describe("parsers", () => {
  test("parseStatus reads the branch header and splits tracked from untracked", () => {
    const s = parseStatus("## feat...origin/feat [ahead 2, behind 1]\n M a.ts\n?? b.md\nA  c.ts\n");
    expect(s).toEqual({ branch: "feat", detached: false, upstream: "origin/feat", upstreamGone: false, ahead: 2, behind: 1, tracked: ["a.ts", "c.ts"], untracked: ["b.md"] });
    expect(parseStatus("## HEAD (no branch)\n").detached).toBe(true);
    expect(parseStatus("## main\n").upstream).toBeUndefined();
    expect(parseStatus("## feat...origin/feat [gone]\n").upstreamGone).toBe(true);
  });

  test("parseTrailers takes single-line and continued values, ignores other trailers", () => {
    const t = parseTrailers(["WIP: x\n\n[gstack-context]\nDecisions: a\n  - b\nRemaining:\n  - c\nSkill: /ship\nTried: d\n[/gstack-context]\nCo-Authored-By: someone"]);
    expect(t).toEqual({ decisions: ["a", "b"], remaining: ["c"], tried: ["d"] });
    expect(parseTrailers(["plain body"])).toEqual({ decisions: [], remaining: [], tried: [] });
  });
});
