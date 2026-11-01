/**
 * changed-files.ts — what differs between the commit an index was built at and the worktree.
 *
 * The delta is the committed difference from the index's commit to HEAD plus whatever is
 * uncommitted, restricted to the project directory. It is a tripwire for verification and the
 * number in the user's message; the engine's own incremental update is what makes content current.
 *
 * Every VCS call goes through `io.run` (no shell), takes the no-optional-locks form and an
 * explicit directory. Paths from VCS output that are absolute or climb out of the project are
 * dropped.
 */

import { isAbsolute, join } from "node:path";

import { mergeChanged } from "../core/worktree";
import type { RunResult } from "../setup/check";
import type { WorktreeIo } from "./ports";

const VCS_TIMEOUT_MS = 30_000;
/** Stdout kept from a listing the parsers read whole (the run-process default is 64 KiB). */
const MAX_VCS_STDOUT = 32 * 1024 * 1024;

/** NUL-separated tokens; the empty token a trailing NUL leaves is dropped. */
function tokens(out: string): string[] {
  const parts = out.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * `git diff --name-status -z --no-renames`: `STATUS NUL path NUL` per entry. With renames
 * off every entry has one path; a stray `R` or `C` record (two paths) is still read whole.
 */
export function parseNameStatusZ(out: string): string[] {
  const parts = tokens(out);
  const paths: string[] = [];
  for (let at = 0; at < parts.length; ) {
    const status = parts[at] ?? "";
    const width = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (let k = 1; k <= width; k += 1) {
      const path = parts[at + k];
      if (path !== undefined && path !== "") paths.push(path);
    }
    at += 1 + width;
  }
  return paths;
}

/**
 * `git status --porcelain=v1 -z --untracked-files=all`: `XY path NUL`; a rename or copy is
 * followed by a second token, the original path, and contributes BOTH paths.
 */
export function parsePorcelainZ(out: string): string[] {
  const parts = tokens(out);
  const paths: string[] = [];
  for (let at = 0; at < parts.length; at += 1) {
    const entry = parts[at] ?? "";
    if (entry.length < 4 || entry[2] !== " ") continue;
    const path = entry.slice(3);
    if (path !== "") paths.push(path);
    if (entry[0] === "R" || entry[0] === "C" || entry[1] === "R" || entry[1] === "C") {
      const original = parts[at + 1];
      if (original !== undefined && original !== "") paths.push(original);
      at += 1;
    }
  }
  return paths;
}

/** Inside the project: relative, no `..` segment. */
function safeRel(rel: string): boolean {
  if (rel === "" || isAbsolute(rel)) return false;
  return !rel.split("/").includes("..");
}

function underAny(rel: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const r = root.replace(/\/+$/u, "");
    return rel === r || rel.startsWith(`${r}/`);
  });
}

/**
 * One VCS call, bounded by the caller's remaining budget as well as its own cap. With no time
 * left the VCS is not started and the answer is a timeout, which every caller reads as "the
 * VCS did not answer".
 */
async function runVcs(
  io: WorktreeIo,
  argv: readonly string[],
  cwd: string,
  remainingMs: (() => number) | undefined,
  extra: { maxStdoutBytes?: number } = {},
): Promise<RunResult> {
  const timeoutMs = Math.min(VCS_TIMEOUT_MS, remainingMs?.() ?? VCS_TIMEOUT_MS);
  if (timeoutMs <= 0) return { exitCode: null, signal: null, stdout: "", stderr: "", timedOut: true };
  return io.run(argv, { cwd, timeoutMs, ...extra });
}

/** The VCS's path prefix of `dir` inside its repository ("" at the root, "pkg/" in a subdirectory). */
async function prefixOf(io: WorktreeIo, dir: string, remainingMs?: () => number): Promise<string | undefined> {
  const r = await runVcs(io, ["git", "--no-optional-locks", "-C", dir, "rev-parse", "--show-prefix"], dir, remainingMs);
  if (r.spawnError !== undefined || r.timedOut || r.exitCode !== 0) return undefined;
  return r.stdout.replace(/\r?\n$/u, "");
}

/** Repository-relative paths made relative to the project; entries outside it are dropped. */
function toProjectRelative(paths: readonly string[], prefix: string): string[] {
  const out: string[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length);
    if (safeRel(rel)) out.push(rel);
  }
  return out;
}

/**
 * Every path `dir` has uncommitted (modified, staged, untracked, both sides of a rename),
 * relative to `dir`. undefined when the VCS cannot answer. Run in main for its dirty set and
 * in the worktree for the catch-up. `remainingMs` bounds each call by the caller's budget; a
 * caller that already knows the project `prefix` passes it and saves a call.
 */
export async function uncommittedPaths(
  io: WorktreeIo,
  dir: string,
  opts: { remainingMs?: () => number; prefix?: string } = {},
): Promise<string[] | undefined> {
  const prefix = opts.prefix ?? (await prefixOf(io, dir, opts.remainingMs));
  if (prefix === undefined) return undefined;
  const status = await runVcs(
    io,
    ["git", "--no-optional-locks", "-C", dir, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."],
    dir,
    opts.remainingMs,
    { maxStdoutBytes: MAX_VCS_STDOUT },
  );
  // A cut-off listing would put the NUL parser mid-token: treat it as "the VCS did not answer".
  if (status.spawnError !== undefined || status.timedOut || status.exitCode !== 0 || status.truncated === true) {
    return undefined;
  }
  return toProjectRelative(parsePorcelainZ(status.stdout), prefix);
}

/**
 * What changed in the worktree since `baseCommit`, classified by what is on disk now.
 * `engineWide: true` when the base commit is unknown or not in the object store, or the VCS
 * did not answer: the changed set is then whatever could be read, and the engine's own update
 * decides what is current. Paths under `owned` (the engine's own files, e.g. its ignore file
 * that shows as untracked) are never source changes and are dropped.
 */
export async function changedFiles(
  io: WorktreeIo,
  a: { worktreeDir: string; baseCommit: string | undefined; owned?: readonly string[]; remainingMs?: () => number },
): Promise<{ changed: string[]; deleted: string[]; engineWide: boolean }> {
  const owned = a.owned ?? [];
  let engineWide = false;

  let committed: string[] = [];
  const prefix = await prefixOf(io, a.worktreeDir, a.remainingMs);
  if (prefix === undefined) engineWide = true;

  if (a.baseCommit === undefined || a.baseCommit === "") {
    engineWide = true;
  } else if (prefix !== undefined) {
    const known = await runVcs(
      io,
      ["git", "--no-optional-locks", "-C", a.worktreeDir, "cat-file", "-e", `${a.baseCommit}^{commit}`],
      a.worktreeDir,
      a.remainingMs,
    );
    if (known.spawnError !== undefined || known.timedOut || known.exitCode !== 0) {
      engineWide = true;
    } else {
      const diff = await runVcs(
        io,
        [
          "git", "--no-optional-locks", "-C", a.worktreeDir, "diff", "--name-status", "-z", "--no-renames",
          a.baseCommit, "HEAD", "--", ".",
        ],
        a.worktreeDir,
        a.remainingMs,
        { maxStdoutBytes: MAX_VCS_STDOUT },
      );
      if (diff.spawnError !== undefined || diff.timedOut || diff.exitCode !== 0 || diff.truncated === true) {
        engineWide = true;
      } else {
        committed = toProjectRelative(parseNameStatusZ(diff.stdout), prefix);
      }
    }
  }

  // The prefix is already known when the VCS answered: no second `rev-parse`.
  const status =
    prefix === undefined
      ? undefined
      : await uncommittedPaths(io, a.worktreeDir, { prefix, ...(a.remainingMs === undefined ? {} : { remainingMs: a.remainingMs }) });
  if (status === undefined) engineWide = true;
  const uncommitted = status ?? [];

  const keep = (rel: string): boolean => !underAny(rel, owned);
  const merged = mergeChanged(
    { committed: committed.filter(keep), uncommitted: uncommitted.filter(keep) },
    (rel) => io.lstatKind(join(a.worktreeDir, rel)),
  );
  return { ...merged, engineWide };
}
