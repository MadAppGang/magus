/**
 * Git facts for /dev:status: branch, upstream, dirty tree, unpushed and branch commits,
 * worktree identity and lock, and whether HEAD already landed on the default branch.
 *
 * Every command runs through an injectable `Runner` so tests can drive it against a
 * throwaway repository or a fake, and so timeouts are enforced per call — a hook with a
 * 5-second budget cannot afford `git fetch` hanging on a dead network.
 *
 * "Merged" is read the way Claude Code's own worktree reuse reads it: HEAD is an ancestor
 * of `origin/<default>`, and the remote branch is gone. A squash or rebase merge breaks
 * the ancestry test while the PR record still says MERGED; gate.ts handles that case.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Commit, GitFacts, RunResult, Runner, Trailers } from "./types.ts";

/** `extraEnv` lets a test null the global git config so the machine's own excludes
 *  (this one ignores `.claude/` globally) cannot change what the test observes. */
export function defaultRunner(extraEnv: NodeJS.ProcessEnv = {}): Runner {
  return (cmd, args, opts) => {
    const r = spawnSync(cmd, args, {
      cwd: opts?.cwd,
      encoding: "utf-8",
      timeout: opts?.timeoutMs ?? 10_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", ...extraEnv },
    });
    const err = r.error as (Error & { code?: string }) | undefined;
    const timedOut = err?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
    return {
      ok: r.status === 0 && !err,
      code: r.status,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      timedOut,
      missing: err?.code === "ENOENT",
    };
  };
}

export interface GitOptions {
  /** Run `git fetch origin <default>` and `git ls-remote` (network). Off in the hook. */
  fetch: boolean;
  fetchTimeoutMs: number;
  /** Base commit the worktree was cut from, if the transcript knows it. */
  baseHint?: string;
}

const RS = "\x1e";
const US = "\x1f";

export function parseTrailers(bodies: string[]): Trailers {
  const out: Trailers = { decisions: [], remaining: [], tried: [] };
  const keyOf = (k: string): keyof Trailers | null => {
    const l = k.toLowerCase();
    if (l === "decisions" || l === "decision") return "decisions";
    if (l === "remaining") return "remaining";
    if (l === "tried") return "tried";
    return null;
  };
  for (const body of bodies) {
    const lines = body.split("\n");
    let current: keyof Trailers | null = null;
    for (const raw of lines) {
      const m = raw.match(/^\s*([A-Za-z]+):\s*(.*)$/);
      const key = m ? keyOf(m[1]!) : null;
      if (m && key) {
        current = key;
        if (m[2]!.trim()) out[key].push(m[2]!.trim());
        continue;
      }
      if (m && !key) {
        current = null; // a different trailer (Skill:, Co-Authored-By:) ends the value
        continue;
      }
      if (current && /^\s+\S|^\s*-\s+/.test(raw)) {
        out[current].push(raw.trim().replace(/^-\s+/, ""));
        continue;
      }
      if (!raw.trim()) current = null;
    }
  }
  return out;
}

function parseLog(stdout: string): { commits: Commit[]; bodies: string[] } {
  const commits: Commit[] = [];
  const bodies: string[] = [];
  for (const rec of stdout.split(RS)) {
    const parts = rec.replace(/^\n/, "").split(US);
    if (parts.length < 3 || !parts[0]!.trim()) continue;
    commits.push({ sha: parts[0]!.trim(), subject: parts[1] ?? "", at: parts[2] ?? "" });
    if (parts[3]?.trim()) bodies.push(parts[3]);
  }
  return { commits, bodies };
}

/** `git status --porcelain --branch` header: `## branch...upstream [ahead 1, behind 2]`. */
export function parseStatus(stdout: string): {
  branch?: string;
  detached: boolean;
  upstream?: string;
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  tracked: string[];
  untracked: string[];
} {
  const out = {
    branch: undefined as string | undefined,
    detached: false,
    upstream: undefined as string | undefined,
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    tracked: [] as string[],
    untracked: [] as string[],
  };
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    if (line.startsWith("## ")) {
      const h = line.slice(3);
      if (h.startsWith("HEAD (no branch)") || h.startsWith("No commits yet")) {
        out.detached = h.startsWith("HEAD");
        out.branch = h.startsWith("No commits yet on ") ? h.slice("No commits yet on ".length) : undefined;
        continue;
      }
      const m = h.match(/^([^.\s]+(?:\.[^.\s]+)*?)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?$/);
      if (m) {
        out.branch = m[1];
        out.upstream = m[2];
        const flags = m[3] ?? "";
        out.ahead = Number(flags.match(/ahead (\d+)/)?.[1] ?? 0);
        out.behind = Number(flags.match(/behind (\d+)/)?.[1] ?? 0);
        out.upstreamGone = /\bgone\b/.test(flags);
      }
      continue;
    }
    const xy = line.slice(0, 2);
    const path = line.slice(3);
    if (xy === "??") out.untracked.push(path);
    else if (xy !== "!!") out.tracked.push(path);
  }
  return out;
}

/**
 * Untracked paths that Claude Code or a plugin writes into a checkout on its own. In this
 * repository they are gitignored; in a fresh repository they are not, and measured in the
 * DST-1 bench they made every worktree "dirty" (`.claude/.coaching/` from the dev plugin's
 * Stop hook) and pushed the real reason for a verdict out of the first line.
 */
export const MACHINE_OWNED = [
  /^\.claude\/\.coaching\//,
  /^\.claude\/\.status\//,
  /^\.claude\/settings\.local\.json$/,
  /^\.claude\/worktrees\//,
  /^ai-docs\/sessions\//,
  /^\.mnemex\//,
  /^\.claudemem\//,
];

export const isMachineOwned = (path: string): boolean => MACHINE_OWNED.some((rx) => rx.test(path));

export function emptyGit(): GitFacts {
  return {
    isRepo: false,
    detached: false,
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    dirty: { tracked: [], untracked: [], machineOwned: [] },
    unpushed: [],
    commits: [],
    fetched: false,
    mergedIntoDefault: null,
    remoteBranchExists: null,
    worktree: { linked: false, managedByClaude: false },
    trailers: { decisions: [], remaining: [], tried: [] },
    errors: [],
  };
}

export function collectGit(cwd: string, run: Runner, opts: GitOptions): GitFacts {
  const g = emptyGit();
  const git = (args: string[], timeoutMs = 10_000): RunResult => run("git", args, { cwd, timeoutMs });
  const first = (r: RunResult) => r.stdout.trim().split("\n")[0]?.trim() ?? "";

  const inside = git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.missing) {
    g.errors.push("git is not installed");
    return g;
  }
  if (!inside.ok || first(inside) !== "true") return g;
  g.isRepo = true;

  g.root = first(git(["rev-parse", "--show-toplevel"]));
  g.headSha = first(git(["rev-parse", "HEAD"])) || undefined;
  const gitDir = resolve(cwd, first(git(["rev-parse", "--git-dir"])));
  const commonDir = resolve(cwd, first(git(["rev-parse", "--git-common-dir"])));
  g.worktree.gitDir = gitDir;
  g.worktree.commonDir = commonDir;
  g.worktree.linked = gitDir !== commonDir;
  g.worktree.managedByClaude = g.worktree.linked && /\/\.claude\/worktrees\/[^/]+$/.test(g.root ?? "");
  if (g.worktree.linked) {
    g.worktree.name = basename(gitDir);
    try {
      if (existsSync(`${gitDir}/locked`)) {
        const reason = readFileSync(`${gitDir}/locked`, "utf-8").trim();
        g.worktree.lockReason = reason;
        const pid = reason.match(/\bpid (\d+)/)?.[1];
        if (pid) g.worktree.lockPid = Number(pid);
      }
      if (existsSync(`${gitDir}/CLAUDE_BASE`)) g.worktree.claudeBase = readFileSync(`${gitDir}/CLAUDE_BASE`, "utf-8").trim() || undefined;
    } catch (e) {
      g.errors.push(`worktree metadata unreadable: ${(e as Error).message}`);
    }
  }

  // -uall lists untracked FILES rather than collapsing a directory to `dir/`, so a
  // machine-owned path can be told apart from a user's file in the same directory.
  const st = git(["status", "--porcelain", "--branch", "-uall"]);
  if (st.ok) {
    const s = parseStatus(st.stdout);
    g.branch = s.branch;
    g.detached = s.detached;
    g.upstream = s.upstream;
    g.upstreamGone = s.upstreamGone;
    g.ahead = s.ahead;
    g.behind = s.behind;
    g.dirty = {
      tracked: s.tracked,
      untracked: s.untracked.filter((p) => !isMachineOwned(p)),
      machineOwned: s.untracked.filter(isMachineOwned),
    };
  } else g.errors.push(`git status failed: ${st.stderr.trim()}`);

  // Default branch: origin/HEAD when set, else whichever of main/master origin has.
  const head = first(git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]));
  if (head.startsWith("origin/")) g.defaultBranch = head.slice("origin/".length);
  else
    for (const cand of ["main", "master"])
      if (git(["rev-parse", "--verify", "-q", `refs/remotes/origin/${cand}`]).ok) {
        g.defaultBranch = cand;
        break;
      }

  if (opts.fetch && g.defaultBranch) {
    const f = git(["fetch", "--quiet", "origin", g.defaultBranch], opts.fetchTimeoutMs);
    g.fetched = f.ok;
    if (!f.ok) g.errors.push(f.timedOut ? `git fetch timed out after ${opts.fetchTimeoutMs} ms` : `git fetch failed: ${f.stderr.trim()}`);
  }

  // Unpushed: what the upstream lacks; with no live upstream (never pushed, or the remote
  // branch deleted after a merge), what origin/<default> lacks.
  const pushTarget = g.upstream && !g.upstreamGone ? "@{u}" : g.defaultBranch ? `refs/remotes/origin/${g.defaultBranch}` : undefined;
  if (pushTarget) {
    const up = git(["log", `--format=%H${US}%s${US}%aI${US}%b${RS}`, `${pushTarget}..HEAD`]);
    if (up.ok) g.unpushed = parseLog(up.stdout).commits;
  }

  // Base of the branch, most trustworthy source first.
  const isCommit = (sha: string | undefined) => !!sha && git(["cat-file", "-e", `${sha}^{commit}`]).ok;
  if (isCommit(g.worktree.claudeBase)) {
    g.base = g.worktree.claudeBase;
    g.baseSource = "CLAUDE_BASE";
  } else if (isCommit(opts.baseHint)) {
    g.base = opts.baseHint;
    g.baseSource = "worktree-state";
  } else if (g.defaultBranch) {
    const mb = first(git(["merge-base", "HEAD", `refs/remotes/origin/${g.defaultBranch}`]));
    if (mb) {
      g.base = mb;
      g.baseSource = "merge-base";
    }
  }
  if (g.base) {
    const lg = git(["log", `--format=%H${US}%s${US}%aI${US}%b${RS}`, `${g.base}..HEAD`]);
    if (lg.ok) {
      const parsed = parseLog(lg.stdout);
      g.commits = parsed.commits;
      g.trailers = parseTrailers(parsed.bodies);
    }
  }

  if (g.defaultBranch) {
    const anc = git(["merge-base", "--is-ancestor", "HEAD", `refs/remotes/origin/${g.defaultBranch}`]);
    g.mergedIntoDefault = anc.code === 0 ? true : anc.code === 1 ? false : null;
  }

  if (g.branch && !g.detached) {
    if (opts.fetch) {
      const ls = git(["ls-remote", "--exit-code", "--heads", "origin", g.branch], opts.fetchTimeoutMs);
      g.remoteBranchExists = ls.code === 0 ? true : ls.code === 2 ? false : null;
      if (ls.timedOut) g.errors.push(`git ls-remote timed out after ${opts.fetchTimeoutMs} ms`);
    } else {
      g.remoteBranchExists = git(["rev-parse", "--verify", "-q", `refs/remotes/origin/${g.branch}`]).ok ? true : null;
    }
  }

  return g;
}
