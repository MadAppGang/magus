/**
 * ports.ts — the ONE IO surface of the worktree index inheritance.
 *
 * Extends the read-only `CheckIo` so the same fake serves the evaluator and the use case.
 * Mutating methods reject with an `Error` carrying `code` (the errno or a short tag), except
 * `removeTree`, which never rejects: a tree that is already gone is the outcome wanted.
 */

import type { FileKind, IndexSource } from "../core/index-descriptor";
import type { CheckIo, RunOptions, RunResult } from "../setup/check";

export interface WorktreeIo extends CheckIo {
  /** No shell. SIGTERM, then SIGKILL, at `timeoutMs`. */
  run(argv: readonly string[], opts: RunOptions): Promise<RunResult>;
  now(): number;
  /** Size and mtime of a regular file (after symlinks); undefined otherwise. Never throws. */
  statFile(path: string): { size: number; mtimeMs: number } | undefined;
  /** What is at `path` itself, NOT following a symlink (a symlink is "other"). Never throws. */
  lstatKind(path: string): FileKind;
  mkdirp(path: string): Promise<void>;
  /** Atomic: temp file in the same directory, then rename. */
  writeText(path: string, text: string): Promise<void>;
  /** Plain copy of a regular file. Rejects if `to` exists. */
  copyFile(from: string, to: string): Promise<void>;
  /** Recursive, no symlink follow. Never rejects. */
  removeTree(path: string): Promise<void>;
  /** VACUUM INTO a sibling of `to`, renamed onto `to` when complete. In-process; the source is opened for
   *  reading (read-only, or read-write on a database at rest with no pending `-wal`/`-journal`, which writes
   *  nothing to it). Rejects if `to` exists. */
  sqliteSnapshot(from: string, to: string): Promise<void>;
  /** PRAGMA integrity_check on the file; false on any doubt. */
  sqliteIntegrity(path: string): Promise<boolean>;
  /** Opened for reading, never writing the database file (see `sqliteSnapshot`); the caller close()s it. */
  openIndexSource(root: string): IndexSource;
  /** Exclusive-create lock file holding a timestamp. Polls until `waitMs`, then {ok:false}. A lock file older
   *  than `staleMs` is reclaimed. */
  acquireLock(
    path: string,
    o: { staleMs: number; waitMs: number },
  ): Promise<{ ok: true; release(): Promise<void> } | { ok: false }>;
}
