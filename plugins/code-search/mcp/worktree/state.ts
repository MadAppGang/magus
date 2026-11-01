/**
 * state.ts — the VCS-aware safety checks around deleting an engine's index.
 *
 * Rollback is the only deletion this feature performs. It deletes the files the engine's
 * `owned` allowlist names, in one worktree, and never a file the VCS tracks: a committed
 * engine config is the user's, not ours. When the VCS cannot say, nothing is deleted.
 */

import { isAbsolute, join, relative, sep } from "node:path";

import type { WorktreeIo } from "./ports";

const VCS_TIMEOUT_MS = 15_000;

export type OwnedTracking = "clean" | "tracked" | "unknown";

/**
 * What the VCS says about `owned`: `tracked` (a tracked file sits under an `owned` path),
 * `unknown` (it did not answer in time, or at all) or `clean`. `--literal-pathspecs`: an owned
 * name is a path, never a pathspec pattern. `remainingMs`, when given, bounds the call by the
 * caller's budget; no time left is `unknown` without starting the VCS.
 */
export async function ownedTrackedState(
  io: WorktreeIo,
  a: { projectDir: string; owned: readonly string[]; remainingMs?: () => number },
): Promise<OwnedTracking> {
  // With no pathspec, ls-files would list the whole tree: an empty allowlist protects nothing.
  if (a.owned.length === 0) return "clean";
  const timeoutMs = Math.min(VCS_TIMEOUT_MS, a.remainingMs?.() ?? VCS_TIMEOUT_MS);
  if (timeoutMs <= 0) return "unknown";
  const result = await io.run(
    ["git", "--no-optional-locks", "--literal-pathspecs", "ls-files", "-z", "--", ...a.owned],
    { cwd: a.projectDir, timeoutMs },
  );
  if (result.spawnError !== undefined || result.timedOut || result.exitCode !== 0) return "unknown";
  return result.stdout.length > 0 ? "tracked" : "clean";
}

/**
 * True when the VCS lists a tracked file under any `owned` path, or when it cannot answer
 * (fails closed).
 */
export async function ownedTracked(
  io: WorktreeIo,
  a: { projectDir: string; owned: readonly string[]; remainingMs?: () => number },
): Promise<boolean> {
  return (await ownedTrackedState(io, a)) !== "clean";
}

/** Project-relative and staying inside the project dir. */
function withinProject(projectDir: string, rel: string): boolean {
  if (rel === "" || isAbsolute(rel)) return false;
  const back = relative(projectDir, join(projectDir, rel));
  return back !== "" && back !== ".." && !back.startsWith(`..${sep}`) && !isAbsolute(back);
}

/**
 * The ONE rollback. It calls `ownedTracked` first: if true it deletes NOTHING and returns
 * ok:false. Otherwise it removes each `owned` path, marker first, in the worktree's project
 * dir. ok:false when the marker could not be removed. Callers have already passed
 * `containedKind`.
 */
export async function rollbackIndex(
  io: WorktreeIo,
  a: { projectDir: string; owned: readonly string[]; marker: string },
): Promise<{ ok: boolean }> {
  if (await ownedTracked(io, { projectDir: a.projectDir, owned: a.owned })) return { ok: false };

  if (!withinProject(a.projectDir, a.marker)) return { ok: false };
  const markerPath = join(a.projectDir, a.marker);
  const markerGone = () => io.lstatKind(markerPath) === "missing";

  // The marker goes first and is verified at once: while it survives, the rest of `owned` stays,
  // so the half-removed index is never left looking valid.
  await io.removeTree(markerPath);
  if (!markerGone()) return { ok: false };

  for (const rel of a.owned) {
    // A malformed descriptor entry (absolute, `..`) is never deleted.
    if (rel === a.marker || !withinProject(a.projectDir, rel)) continue;
    await io.removeTree(join(a.projectDir, rel));
  }
  return { ok: markerGone() };
}
