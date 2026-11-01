/**
 * lock.ts — one exclusive lock file, with a plain timeout.
 *
 * Exclusive create (`wx`) of a file holding the creation time in ms plus a unique suffix. A
 * holder that is still alive is waited for until `waitMs`; a lock file older than `staleMs`
 * belongs to a dead run and is reclaimed, by one waiter at a time (see `reclaimStale`). No
 * pid tracking, no liveness probing: the staleness bound is above the hook's own timeout, so
 * a live holder is never reclaimed.
 */

import { mkdirSync, openSync, closeSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export interface LockOptions {
  staleMs: number;
  waitMs: number;
}

export interface LockClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type LockResult = { ok: true; release(): Promise<void> } | { ok: false };

const POLL_MS = 50;

const realClock: LockClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Age basis of an existing lock: the timestamp it holds, else the file's mtime. */
function lockedAt(path: string): { text: string | undefined; at: number | undefined } {
  let text: string | undefined;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { text: undefined, at: undefined };
  }
  const parsed = Number.parseInt(text.trim(), 10);
  if (Number.isFinite(parsed)) return { text, at: parsed };
  try {
    return { text, at: statSync(path).mtimeMs };
  } catch {
    return { text, at: undefined };
  }
}

function tryCreate(path: string, stamp: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, stamp);
  } finally {
    closeSync(fd);
  }
  return true;
}

/** A reclaim guard older than this was left by a reclaimer that died inside its few-microsecond section. */
const GUARD_STALE_MS = 10_000;

/**
 * Removes the stale lock `path` (whose content was `seenText`), once, for ONE reclaimer.
 *
 * Reading the lock and unlinking it are two steps, and between them another waiter can finish
 * its own reclaim and create a fresh lock, which an unguarded unlink would then delete. So the
 * check and the unlink run inside an exclusive guard file (`<lock>.reclaim`, created with `wx`):
 * the section is synchronous, only the guard's holder may be in it, and it re-reads the lock
 * and unlinks only if it is still the stale one it saw. Every other waiter sees the guard,
 * does not reclaim, and polls. A true return means the stale lock is gone and the caller may
 * try the exclusive create; it does not mean the caller holds the lock.
 */
function reclaimStale(path: string, seenText: string | undefined, clock: LockClock): boolean {
  const guard = `${path}.reclaim`;
  const token = uniqueStamp(clock);
  let held: boolean;
  try {
    held = tryCreate(guard, token);
  } catch {
    return false;
  }
  if (!held) {
    // A guard that outlived its section belongs to a dead reclaimer; drop it so the next poll can reclaim.
    const guardAge = lockedAt(guard).at;
    if (guardAge !== undefined && clock.now() - guardAge > GUARD_STALE_MS) {
      try {
        unlinkSync(guard);
      } catch {
        // Already gone.
      }
    }
    return false;
  }
  try {
    // Still the very lock that was seen? A different text (or none) means it was replaced or released.
    if (lockedAt(path).text !== seenText) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  } finally {
    // Only our own guard.
    if (lockedAt(guard).text === token) {
      try {
        unlinkSync(guard);
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * `<ms>:<pid>:<random>`. Age is read from the leading integer; the rest keeps two holders
 * created in the same millisecond from owning each other's file.
 */
function uniqueStamp(clock: LockClock): string {
  return `${clock.now()}:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
}

export async function acquireLockFile(
  path: string,
  o: LockOptions,
  clock: LockClock = realClock,
): Promise<LockResult> {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // An unusable directory fails the create below the same way.
  }
  const start = clock.now();

  for (;;) {
    const stamp = uniqueStamp(clock);
    let created = false;
    try {
      created = tryCreate(path, stamp);
    } catch {
      // Cannot create the lock at all (permissions, missing mount): nobody can hold it.
      return { ok: false };
    }
    if (created) {
      return {
        ok: true,
        async release(): Promise<void> {
          // Only remove a lock that is still ours: a reclaimed one belongs to its new holder.
          if (lockedAt(path).text !== stamp) return;
          try {
            unlinkSync(path);
          } catch {
            // Already gone.
          }
        },
      };
    }

    const seen = lockedAt(path);
    if (seen.at !== undefined && clock.now() - seen.at > o.staleMs && reclaimStale(path, seen.text, clock)) {
      continue;
    }

    if (clock.now() - start >= o.waitMs) return { ok: false };
    await clock.sleep(Math.min(POLL_MS, Math.max(1, o.waitMs - (clock.now() - start))));
  }
}
