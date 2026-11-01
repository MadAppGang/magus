/**
 * node-io.ts — the real `WorktreeIo`.
 *
 * Plain `node:fs` plus Bun's in-process SQLite. SQLite is loaded lazily through
 * `createRequire`, because the plugin's typecheck carries only the `bun-types` pieces it
 * needs (see tsconfig.json) and `bun:sqlite` is not among them. This module implements
 * `VACUUM INTO`, so it is the one generic module allowed to speak SQL.
 *
 * Every mutating method rejects with an `Error` carrying `code`, except `removeTree`.
 */

import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import type { Env, FileKind, IndexSource } from "../core/index-descriptor";
import type { CheckIo, RunOptions, RunResult } from "../setup/check";
import { makeNodeCheckIo } from "../setup/node-io";
import { runProcess } from "../transport/run-process";
import { acquireLockFile } from "./lock";
import type { WorktreeIo } from "./ports";

interface SqliteDb {
  query(sql: string): { values(): unknown[][] };
  run(sql: string, params?: unknown[]): unknown;
  close(): void;
}
type SqliteCtor = new (path: string, options?: { readonly?: boolean; readwrite?: boolean; create?: boolean }) => SqliteDb;

let sqliteCtor: SqliteCtor | undefined;
/**
 * Opens an index to READ it. MEASURED (Step 1): `bun:sqlite` refuses a `readonly` open of a
 * WAL-mode database that has no `-wal` and `-shm` beside it, which is every index at rest;
 * the failure shows on the first query. So `readonly` is tried first and, when it cannot read,
 * the existing file is opened `readwrite` without `create` (SQLite then makes the two sidecars
 * next to it: the accepted change in main). Only SELECTs and `VACUUM INTO` run on the handle.
 *
 * The read-write open is allowed ONLY for a database at rest: a read-write connection that
 * finds an uncheckpointed `-wal` (or a hot `-journal`) recovers it and, on close, checkpoints it
 * into the database file, changing main's bytes (MEASURED: the file hash changed). So when either
 * sidecar holds content, the failure of the read-only open is rethrown and the index reads as
 * unusable; a read-only open never writes the database file.
 */
function openSqliteReadOnly(path: string): SqliteDb {
  if (sqliteCtor === undefined) {
    const load = createRequire(import.meta.url);
    sqliteCtor = (load("bun:sqlite") as { Database: SqliteCtor }).Database;
  }
  try {
    const db = new sqliteCtor(path, { readonly: true });
    try {
      db.query("SELECT count(*) FROM sqlite_master").values();
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  } catch (error) {
    if (hasPendingJournal(path)) throw error;
    return new sqliteCtor(path, { readwrite: true, create: false });
  }
}

/** True when a `-wal` with content or any `-journal` sits beside the database: a read-write open would write it. */
function hasPendingJournal(path: string): boolean {
  try {
    if (statSync(`${path}-wal`).size > 0) return true;
  } catch {
    // No -wal.
  }
  return lstatKind(`${path}-journal`) !== "missing";
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function lstatKind(path: string): FileKind {
  try {
    const stats = lstatSync(path);
    if (stats.isFile()) return "file";
    if (stats.isDirectory()) return "directory";
    return "other";
  } catch {
    return "missing";
  }
}

/** `root/rel` when `rel` stays inside `root`, else undefined. */
function under(root: string, rel: string): string | undefined {
  if (isAbsolute(rel)) return undefined;
  const target = join(root, rel);
  const back = relative(root, target);
  if (back === "" || back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) return undefined;
  return target;
}

function makeIndexSource(root: string): IndexSource {
  const open = new Map<string, SqliteDb>();
  return {
    exists(rel: string): boolean {
      const path = under(root, rel);
      if (path === undefined) return false;
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
    sqlite(rel: string) {
      const path = under(root, rel);
      if (path === undefined) return undefined;
      let db = open.get(path);
      if (db === undefined) {
        try {
          if (!statSync(path).isFile()) return undefined;
          db = openSqliteReadOnly(path);
        } catch {
          return undefined;
        }
        open.set(path, db);
      }
      const handle = db;
      return {
        query(sql: string): readonly (readonly unknown[])[] {
          return handle.query(sql).values();
        },
      };
    },
    json(rel: string): unknown | undefined {
      const path = under(root, rel);
      if (path === undefined) return undefined;
      try {
        return JSON.parse(readFileSync(path, "utf8")) as unknown;
      } catch {
        return undefined;
      }
    },
    close(): void {
      for (const db of open.values()) {
        try {
          db.close();
        } catch {
          // Already closed.
        }
      }
      open.clear();
    },
  };
}

export function makeNodeWorktreeIo(env: Env = process.env): WorktreeIo {
  const read: CheckIo = makeNodeCheckIo(env);
  let counter = 0;

  return {
    ...read,
    run(argv: readonly string[], opts: RunOptions): Promise<RunResult> {
      // The engine's own launcher may run the real worker as its child: a timeout must end both.
      return runProcess(argv, { ...opts, ownProcessGroup: true }, env);
    },
    now: () => Date.now(),
    statFile(path: string): { size: number; mtimeMs: number } | undefined {
      try {
        const stats = statSync(path);
        return stats.isFile() ? { size: stats.size, mtimeMs: stats.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    },
    lstatKind,
    async mkdirp(path: string): Promise<void> {
      mkdirSync(path, { recursive: true });
    },
    async writeText(path: string, text: string): Promise<void> {
      mkdirSync(dirname(path), { recursive: true });
      counter += 1;
      const temp = `${path}.${process.pid}.${Date.now().toString(36)}.${counter}.tmp`;
      try {
        writeFileSync(temp, text, { encoding: "utf8", mode: 0o600 });
        renameSync(temp, path);
      } catch (error) {
        rmSync(temp, { force: true });
        throw error;
      }
    },
    async copyFile(from: string, to: string): Promise<void> {
      if (lstatKind(from) !== "file") throw codedError("ENOTREG", "source is not a regular file");
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to, constants.COPYFILE_EXCL);
    },
    async removeTree(path: string): Promise<void> {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // The caller checks whether the path is gone; this never rejects.
      }
    },
    async sqliteSnapshot(from: string, to: string): Promise<void> {
      if (lstatKind(to) !== "missing") throw codedError("EEXIST", "destination exists");
      mkdirSync(dirname(to), { recursive: true });
      // Written to a sibling and renamed onto `to`: a run killed mid-copy never leaves a
      // truncated file at the real (marker) name, which the facade and the engine would read.
      counter += 1;
      const temp = `${to}.tmp-${process.pid}-${counter}`;
      let db: SqliteDb | undefined;
      try {
        db = openSqliteReadOnly(from);
        db.run("VACUUM INTO ?", [temp]);
        db.close();
        db = undefined;
        renameSync(temp, to);
      } catch (error) {
        rmSync(temp, { force: true });
        if (error instanceof Error && (error as { code?: unknown }).code === undefined) {
          Object.assign(error, { code: "SQLITE" });
        }
        throw error;
      } finally {
        try {
          db?.close();
        } catch {
          // Already closed.
        }
      }
    },
    async sqliteIntegrity(path: string): Promise<boolean> {
      let db: SqliteDb | undefined;
      try {
        db = openSqliteReadOnly(path);
        const rows = db.query("PRAGMA integrity_check").values();
        return rows.length === 1 && rows[0]?.[0] === "ok";
      } catch {
        return false;
      } finally {
        try {
          db?.close();
        } catch {
          // Already closed.
        }
      }
    },
    openIndexSource: makeIndexSource,
    acquireLock(path: string, o: { staleMs: number; waitMs: number }) {
      return acquireLockFile(path, o);
    },
  };
}
