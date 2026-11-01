/**
 * index-measurement.ts — Step 1 of MTL-153: what an engine's index actually does when it is
 * copied into a linked git worktree.
 *
 * The `index` descriptor in `mcp/adapters/catalog.ts` is a set of CLAIMS about an engine
 * (paths are relative, the index records its commit, the engine's own incremental update
 * catches a copy up, ...). A claim read off a README rots; this file MEASURES each one against
 * the real engine, on a scratch repo, and the descriptor is then declared from the numbers.
 * `measure-index.ts` is the command line over it, and the descriptor-equals-measurement test
 * (written later) re-runs it.
 *
 * What one engine's measurement does, in order:
 *   1. a scratch repo, the engine's own projectStep, the index it leaves behind;
 *   2. a LINKED worktree at the same commit and a throwaway copy of the index into it;
 *   3. every text value of the copy searched for the original's absolute prefix, and a query
 *      served from the copy;
 *   4. how the index records "built at commit X, with these dirty paths";
 *   5. edit, add, delete and file-to-directory swap in the worktree, then the candidate
 *      `update`: added found, deleted gone, modified re-indexed, an unchanged copy touching
 *      zero files, a main-dirty file re-indexed from the worktree's content;
 *   6. what `update` writes (all inside the owned allowlist, sidecars included), whether the
 *      engine locks, the exact argv, durations.
 *
 * The copy is the production `copyIndex` (`copyIndexProduction`). Engine knowledge (query shapes, the table that
 * holds the commit) lives in the probes below and nowhere in production code.
 *
 * No test file is created by this module. It spawns the engine binaries and git; nothing is
 * installed and nothing outside the scratch root is written (the engines' own per-user state,
 * e.g. a telemetry queue, is recorded as `outsideProjectWrites`).
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { CATALOG, withProjectDir, type CatalogEntry } from "../mcp/adapters/catalog";
import type { CopyRecipe } from "../mcp/core/index-descriptor";
import { makeNodeWorktreeIo } from "../mcp/worktree/node-io";
import { copyIndex } from "../mcp/worktree/snapshot";

// ---------------------------------------------------------------------------------
// Process and filesystem helpers
// ---------------------------------------------------------------------------------

export interface RunResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
  /** spawn itself failed (binary missing, cwd missing). */
  spawnError?: string;
}

export interface RunOpts {
  cwd: string;
  timeoutMs?: number;
  env?: Readonly<Record<string, string | undefined>>;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/** No shell. SIGTERM at the timeout, SIGKILL two seconds later. */
export function runCommand(argv: readonly string[], opts: RunOpts): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    if (cmd === undefined) {
      resolve({ code: null, signal: null, stdout: "", stderr: "", ms: 0, timedOut: false, spawnError: "empty argv" });
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, NO_COLOR: "1", CI: "1", ...opts.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ code: null, signal: null, stdout: "", stderr: "", ms: 0, timedOut: false, spawnError: String(e) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    const term = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(term);
      resolve({ code: null, signal: null, stdout, stderr, ms: Date.now() - started, timedOut, spawnError: String(e) });
    });
    child.on("close", (code, signal) => {
      clearTimeout(term);
      resolve({ code, signal, stdout, stderr, ms: Date.now() - started, timedOut });
    });
  });
}

/** True when `binary` is an executable file in some PATH directory. */
export function onPath(binary: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    try {
      accessSync(join(dir, binary), constants.X_OK);
      return true;
    } catch {
      // next directory
    }
  }
  return false;
}

const GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } as const;

/** Hermetic git: no user config, no signing, no hooks. */
export function git(cwd: string, ...args: string[]): Promise<RunResult> {
  return runCommand(
    ["git", "-c", "user.email=measure@example.invalid", "-c", "user.name=measure", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, env: GIT_ENV },
  );
}

export interface FileFact {
  size: number;
  mtimeMs: number;
  sha1: string;
}

/** Every file (and symlink) under `root`, POSIX-relative, skipping a top-level `.git`. No symlink follow. */
export function walkFiles(root: string, rel = ""): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (rel === "" && e.name === ".git") continue;
    if (e.isDirectory()) out.push(...walkFiles(root, r));
    else out.push(r);
  }
  return out.sort();
}

export function snapshotTree(root: string, only?: string): Map<string, FileFact> {
  const snap = new Map<string, FileFact>();
  for (const rel of walkFiles(root, only ?? "")) {
    try {
      const abs = join(root, rel);
      const st = lstatSync(abs);
      const sha1 = st.isFile() && st.size <= 64 * 1024 * 1024 ? createHash("sha1").update(readFileSync(abs)).digest("hex") : `link-or-big:${st.size}`;
      snap.set(rel, { size: st.size, mtimeMs: st.mtimeMs, sha1 });
    } catch {
      // vanished between listing and stat: treated as absent
    }
  }
  return snap;
}

export interface TreeDiff {
  created: string[];
  modified: string[];
  /** Same bytes, new mtime: the engine rewrote the file with identical content. */
  touchedOnly: string[];
  deleted: string[];
}

export function diffSnapshots(before: Map<string, FileFact>, after: Map<string, FileFact>): TreeDiff {
  const d: TreeDiff = { created: [], modified: [], touchedOnly: [], deleted: [] };
  for (const [p, a] of after) {
    const b = before.get(p);
    if (b === undefined) d.created.push(p);
    else if (b.sha1 !== a.sha1) d.modified.push(p);
    else if (b.mtimeMs !== a.mtimeMs) d.touchedOnly.push(p);
  }
  for (const p of before.keys()) if (!after.has(p)) d.deleted.push(p);
  return d;
}

const inside = (p: string, roots: readonly string[]): boolean => roots.some((r) => p === r || p.startsWith(`${r}/`));

// ---------------------------------------------------------------------------------
// SQLite, without a type dependency on bun-types/sqlite
// ---------------------------------------------------------------------------------

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  values(...params: unknown[]): unknown[][];
  run(...params: unknown[]): unknown;
}
interface SqliteDb {
  query(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteOptions {
  readonly?: boolean;
  readwrite?: boolean;
  create?: boolean;
}
type SqliteCtor = new (p: string, o?: SqliteOptions) => SqliteDb;

async function sqliteCtor(): Promise<SqliteCtor> {
  // A variable specifier keeps `tsc` from resolving a module the tsconfig does not type.
  const spec = "bun:sqlite";
  return ((await import(spec)) as { Database: SqliteCtor }).Database;
}

/** The mode a reader opens an index in. `create` is the only mode that may make a new file. */
export type SqliteMode = "readonly" | "readwrite-existing" | "create";

/**
 * MEASURED: `bun:sqlite` refuses a `readonly` open of a WAL-mode database that has no `-wal`
 * and `-shm` beside it ("unable to open database file"), which is the state of every index at
 * rest. So a reader here tries `readonly` first and falls back to `readwrite-existing`, which
 * opens the existing file read-write without creating it; SQLite then makes (and on close
 * removes) the two sidecars. `openModeFinding` in the measurement records both outcomes.
 */
async function openSqlite(path: string, mode: SqliteMode | boolean): Promise<SqliteDb> {
  const Database = await sqliteCtor();
  const m: SqliteMode = mode === true ? "readonly" : mode === false ? "create" : mode;
  if (m === "create") return new Database(path);
  if (m === "readwrite-existing") return new Database(path, { readwrite: true, create: false });
  try {
    const db = new Database(path, { readonly: true });
    db.query("SELECT count(*) FROM sqlite_master").values();
    return db;
  } catch {
    return new Database(path, { readwrite: true, create: false });
  }
}

/** What a plain read-only open of this database does. Never throws. */
export async function probeOpenModes(path: string): Promise<{ readonly: string; readwriteExisting: string; sidecarsLeftBehind: string[] }> {
  const Database = await sqliteCtor();
  const outcome = (fn: () => void): string => {
    try {
      fn();
      return "ok";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  const readonly = outcome(() => {
    const db = new Database(path, { readonly: true });
    try {
      db.query("SELECT count(*) FROM sqlite_master").values();
    } finally {
      db.close();
    }
  });
  const readwriteExisting = outcome(() => {
    const db = new Database(path, { readwrite: true, create: false });
    try {
      db.query("SELECT count(*) FROM sqlite_master").values();
    } finally {
      db.close();
    }
  });
  const left = ["-wal", "-shm"].filter((s) => existsSync(`${path}${s}`));
  return { readonly, readwriteExisting, sidecarsLeftBehind: left };
}

function isSqliteFile(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(16);
      readSync(fd, buf, 0, 16, 0);
      return buf.toString("latin1") === "SQLite format 3\0";
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** `-wal`, `-shm`, journal, lock, pid, socket, log and temp names: never part of a copy. */
export const SIDECAR_PATTERN = /(-wal|-shm|-journal|\.lock|\.lck|\.pid|\.sock|\.log|\.tmp|\.temp|\.swp)$|(^|\/)(lock|daemon\.[a-z]+)$/u;

// ---------------------------------------------------------------------------------
// The copy: production `copyIndex`
// ---------------------------------------------------------------------------------

/**
 * Copies an engine's index with the PRODUCTION `copyIndex`, so the measurement exercises the
 * code that ships. An engine whose catalog entry declares a `copy` recipe is copied with that
 * recipe. An engine with no declaration (a candidate being measured, e.g. one that turns out
 * not copyable) gets a candidate recipe built from its probe: every non-sidecar file under its
 * index roots, the SQLite database last as the marker, `inspect` trusting the files. Returns
 * the copied files in copy order; a failed copy is thrown so the `step` records it.
 */
export async function copyIndexProduction(
  entry: CatalogEntry,
  probe: EngineProbe,
  from: string,
  to: string,
): Promise<string[]> {
  const declared = entry.index;
  let recipe: CopyRecipe;
  let marker: string;
  if (declared?.worktrees === "copy") {
    recipe = declared.copy;
    marker = declared.path;
  } else {
    const files = probe.indexRoots.flatMap((root) => walkFiles(from, root)).filter((rel) => !SIDECAR_PATTERN.test(rel));
    const sqlite = files.filter((rel) => isSqliteFile(join(from, rel)));
    const ordered = [...files.filter((rel) => !sqlite.includes(rel)), ...sqlite];
    marker = ordered[ordered.length - 1] ?? "";
    recipe = {
      store: probe.store,
      include: ordered,
      inspect: () => ({ complete: true }),
      updateRefreshesModified: true,
      isIndexable: () => false,
      indexedFiles: () => undefined,
      update: probe.update,
    };
  }
  const result = await copyIndex(makeNodeWorktreeIo(process.env), { recipe, marker, fromProjectDir: from, toProjectDir: to });
  if (!result.ok) throw new Error(`copyIndex failed at ${result.stage}: ${result.reason}`);
  return [...recipe.include];
}

// ---------------------------------------------------------------------------------
// Searching an index for the original's absolute prefix
// ---------------------------------------------------------------------------------

export interface PrefixHit {
  file: string;
  prefix: string;
  /** Occurrences in the raw bytes. */
  rawCount: number;
  /** For a SQLite file: the table.column values that contain the prefix. */
  columns: { table: string; column: string; rows: number }[];
}

function countOccurrences(buf: Buffer, needle: string): number {
  let n = 0;
  let at = buf.indexOf(needle);
  while (at !== -1) {
    n += 1;
    at = buf.indexOf(needle, at + needle.length);
  }
  return n;
}

/** Raw byte scan of every file under `roots`, plus a per-column scan of each SQLite database. */
export async function scanForPrefix(dir: string, roots: readonly string[], prefixes: readonly string[]): Promise<PrefixHit[]> {
  const hits: PrefixHit[] = [];
  for (const root of roots) {
    for (const rel of walkFiles(dir, root)) {
      const abs = join(dir, rel);
      let bytes: Buffer;
      try {
        bytes = readFileSync(abs);
      } catch {
        continue;
      }
      for (const prefix of prefixes) {
        const rawCount = countOccurrences(bytes, prefix);
        const columns: PrefixHit["columns"] = [];
        if (isSqliteFile(abs)) {
          const db = await openSqlite(abs, true);
          try {
            const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").values();
            for (const [tname] of tables) {
              const cols = db.query(`PRAGMA table_info("${String(tname)}")`).values();
              for (const c of cols) {
                const cname = String(c[1]);
                try {
                  const r = db
                    .query(`SELECT count(*) FROM "${String(tname)}" WHERE instr(CAST("${cname}" AS TEXT), ?) > 0`)
                    .values(prefix);
                  const rows = Number(r[0]?.[0] ?? 0);
                  if (rows > 0) columns.push({ table: String(tname), column: cname, rows });
                } catch {
                  // a virtual table that cannot be scanned column-wise: the raw scan covers it
                }
              }
            }
          } finally {
            db.close();
          }
        }
        if (rawCount > 0 || columns.length > 0) hits.push({ file: rel, prefix, rawCount, columns });
      }
    }
  }
  return hits;
}

/**
 * Positive control for the scanner: a planted prefix in a raw file and in a SQLite column MUST
 * be found, or "zero hits" in a real index would mean nothing.
 */
export async function scannerControl(scratch: string): Promise<{ raw: boolean; sqliteColumn: boolean }> {
  const dir = join(scratch, "scanner-control");
  mkdirSync(join(dir, "idx"), { recursive: true });
  const planted = "/planted/original/prefix";
  writeFileSync(join(dir, "idx/plain.json"), JSON.stringify({ source: `${planted}/src/a.ts` }));
  const db = await openSqlite(join(dir, "idx/db.sqlite"), false);
  try {
    db.query("CREATE TABLE t (id INTEGER, path TEXT)").run();
    db.query("INSERT INTO t VALUES (1, ?)").run(`${planted}/src/b.ts`);
  } finally {
    db.close();
  }
  const hits = await scanForPrefix(dir, ["idx"], [planted]);
  return {
    raw: hits.some((h) => h.file === "idx/plain.json" && h.rawCount > 0),
    sqliteColumn: hits.some((h) => h.file === "idx/db.sqlite" && h.columns.some((c) => c.table === "t" && c.column === "path")),
  };
}

// ---------------------------------------------------------------------------------
// Engine probes: the only place engine specifics live
// ---------------------------------------------------------------------------------

export interface RecordedState {
  /** Whether the index records the commit it was built at. */
  commitRecorded: boolean;
  commit?: string;
  /** Whether the index records which paths were indexed with uncommitted content. */
  dirtyRecorded: boolean;
  dirtyPaths?: string[];
  /** The engine's own "this index is whole" flag, when it has one. */
  complete?: boolean;
  /** Where in the index the above was read, for the report. */
  source: string;
}

export interface EngineProbe {
  id: string;
  /** Binaries the measurement spawns. */
  requires: readonly string[];
  /** Candidate owned directories (project-relative): everything the engine writes lives here. */
  indexRoots: readonly string[];
  store: "sqlite" | "file";
  /** The candidate incremental command: literal argv, cwd = the project dir. */
  update: readonly string[];
  /** Per-user directories the engine may write outside the project (recorded, not owned). */
  globalDirs: readonly string[];
  /** Seed a ~13 MB source file to see whether the engine caps what it indexes. Slow engines leave it off. */
  oversizeProbe?: boolean;
  /** The engine's state record, read straight from the index files. */
  readState(projectDir: string): Promise<RecordedState>;
  /** path -> a string that changes when the engine re-indexes that file. undefined: not enumerable. */
  fingerprints(projectDir: string): Promise<Map<string, string> | undefined>;
  /** path -> content digest the engine recorded, when it records one comparable with sha256. */
  contentDigests(projectDir: string): Promise<Map<string, string> | undefined>;
  /** Does the index mention `term` (a symbol the scenario planted)? */
  has(projectDir: string, term: string): Promise<boolean>;
  /** The engine's own query, raw: what a user sees. */
  sampleQuery(projectDir: string, term: string): Promise<{ code: number | null; text: string }>;
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

function findKeys(value: unknown, pattern: RegExp, path = "$", out: { path: string; value: unknown }[] = []): { path: string; value: unknown }[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (pattern.test(k)) out.push({ path: `${path}.${k}`, value: v });
      findKeys(v, pattern, `${path}.${k}`, out);
    }
  }
  return out;
}

const codegraphProbe: EngineProbe = {
  id: "codegraph",
  requires: ["codegraph"],
  indexRoots: [".codegraph"],
  store: "sqlite",
  update: ["codegraph", "sync"],
  globalDirs: [join(homedir(), ".codegraph")],
  oversizeProbe: true,
  async readState(projectDir) {
    const dbPath = join(projectDir, ".codegraph/codegraph.db");
    if (!existsSync(dbPath)) return { commitRecorded: false, dirtyRecorded: false, source: "no database" };
    const db = await openSqlite(dbPath, true);
    try {
      const meta = new Map<string, string>();
      for (const row of db.query("SELECT * FROM project_metadata").values()) meta.set(String(row[0]), String(row[1]));
      const commit = meta.get("indexed_at_commit");
      const dirtyRaw = meta.get("indexed_dirty_paths");
      let dirtyPaths: string[] | undefined;
      if (dirtyRaw !== undefined) {
        try {
          const parsed = JSON.parse(dirtyRaw) as { paths?: unknown };
          if (Array.isArray(parsed.paths)) dirtyPaths = parsed.paths.map(String);
        } catch {
          // unparsable: dirty state is unrecorded
        }
      }
      return {
        commitRecorded: commit !== undefined && commit !== "",
        ...(commit !== undefined ? { commit } : {}),
        dirtyRecorded: dirtyPaths !== undefined,
        ...(dirtyPaths !== undefined ? { dirtyPaths } : {}),
        complete: meta.get("index_state") === "complete",
        source: "codegraph.db project_metadata: indexed_at_commit, indexed_dirty_paths, index_state",
      };
    } finally {
      db.close();
    }
  },
  async fingerprints(projectDir) {
    const dbPath = join(projectDir, ".codegraph/codegraph.db");
    if (!existsSync(dbPath)) return undefined;
    const db = await openSqlite(dbPath, true);
    try {
      const m = new Map<string, string>();
      for (const r of db.query("SELECT path, content_hash, indexed_at FROM files").values()) m.set(String(r[0]), `${String(r[1])}|${String(r[2])}`);
      return m;
    } finally {
      db.close();
    }
  },
  async contentDigests(projectDir) {
    const db = await openSqlite(join(projectDir, ".codegraph/codegraph.db"), true);
    try {
      const m = new Map<string, string>();
      for (const r of db.query("SELECT path, content_hash FROM files").values()) m.set(String(r[0]), String(r[1]));
      return m;
    } finally {
      db.close();
    }
  },
  async has(projectDir, term) {
    const r = await runCommand(["codegraph", "query", "-p", projectDir, "-j", term], { cwd: projectDir, timeoutMs: 60_000 });
    try {
      return collectStrings(JSON.parse(r.stdout)).some((s) => s.includes(term));
    } catch {
      return false;
    }
  },
  async sampleQuery(projectDir, term) {
    const r = await runCommand(["codegraph", "query", "-p", projectDir, "-j", term], { cwd: projectDir, timeoutMs: 60_000 });
    return { code: r.code, text: r.stdout };
  },
};

const graphifyProbe: EngineProbe = {
  id: "graphify",
  requires: ["graphify"],
  indexRoots: ["graphify-out"],
  store: "file",
  update: ["graphify", "update", ".", "--no-cluster"],
  globalDirs: [join(homedir(), ".graphify")],
  async readState(projectDir) {
    const files = walkFiles(projectDir, "graphify-out").filter((f) => f.endsWith(".json") && !f.includes("/cache/"));
    const commitKeys: string[] = [];
    const dirtyKeys: string[] = [];
    for (const f of files) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(join(projectDir, f), "utf8"));
      } catch {
        continue;
      }
      for (const k of findKeys(parsed, /commit|head|revision|sha/iu)) commitKeys.push(`${f}:${k.path}`);
      for (const k of findKeys(parsed, /dirty|uncommitted/iu)) dirtyKeys.push(`${f}:${k.path}`);
    }
    return {
      commitRecorded: commitKeys.length > 0,
      dirtyRecorded: dirtyKeys.length > 0,
      source: `keys scanned in ${files.join(", ")}; commit-like keys: [${commitKeys.join(", ")}]; dirty-like keys: [${dirtyKeys.join(", ")}]`,
    };
  },
  async fingerprints(projectDir) {
    const manifest = join(projectDir, "graphify-out/manifest.json");
    if (!existsSync(manifest)) return undefined;
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(parsed)) m.set(k, JSON.stringify(v));
    return m;
  },
  async contentDigests() {
    return undefined;
  },
  async has(projectDir, term) {
    const graph = join(projectDir, "graphify-out/graph.json");
    if (!existsSync(graph)) return false;
    const parsed = JSON.parse(readFileSync(graph, "utf8")) as { nodes?: { id?: unknown; label?: unknown }[] };
    return (parsed.nodes ?? []).some((n) => String(n.label ?? "").includes(term) || String(n.id ?? "").includes(term));
  },
  async sampleQuery(projectDir, term) {
    const r = await runCommand(["graphify", "query", term, "--graph", "graphify-out/graph.json"], { cwd: projectDir, timeoutMs: 60_000 });
    return { code: r.code, text: r.stdout };
  },
};

/** The engines this harness can measure: the catalog entries with a projectStep, minus the exempt. */
export const PROBES: Readonly<Record<string, EngineProbe>> = { codegraph: codegraphProbe, graphify: graphifyProbe };

/** Catalog engines that are not measured, and why. */
export const EXEMPT: Readonly<Record<string, string>> = {
  mnemex: "declared engine-managed: nothing is copied, the engine serves the worktree",
  serena: "no projectStep: there is no index to copy",
};

export function measurableEngineIds(): string[] {
  return Object.keys(PROBES).filter((id) => (CATALOG as Record<string, CatalogEntry>)[id]?.projectStep !== undefined);
}

// ---------------------------------------------------------------------------------
// CODE_SEARCH_MEASURE_REQUIRE
// ---------------------------------------------------------------------------------

/** `all`, or a comma list of ids. Empty or unset: nothing is required (an absent engine is `absent`). */
export function requiredEngines(env: Readonly<Record<string, string | undefined>>): "all" | ReadonlySet<string> {
  const raw = (env.CODE_SEARCH_MEASURE_REQUIRE ?? "").trim();
  if (raw === "all") return "all";
  return new Set(raw.split(",").map((s) => s.trim()).filter((s) => s !== ""));
}

export function isRequired(id: string, env: Readonly<Record<string, string | undefined>>): boolean {
  const req = requiredEngines(env);
  return req === "all" || req.has(id);
}

// ---------------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------------

export interface UpdateRun {
  label: string;
  argv: string[];
  cwd: "main" | "worktree";
  exitCode: number | null;
  timedOut: boolean;
  ms: number;
  stdoutTail: string;
  stderrTail: string;
  /** Files the engine wrote, by path, split at the owned allowlist. */
  writtenInsideOwned: string[];
  writtenOutsideOwned: string[];
  sidecarsSeen: string[];
  /** Files that appeared during the run and were gone after it (lock/temp files). */
  transientFiles: string[];
  /** Paths whose engine fingerprint changed, appeared or vanished. */
  reindexed: string[];
  outsideProjectWrites: string[];
}

export interface QueryChecks {
  [term: string]: { before: boolean; after: boolean };
}

export interface EngineMeasurement {
  engine: string;
  status: "measured";
  version: string | undefined;
  platform: string;
  /** Verdict: every rule a `copy` descriptor needs held. */
  copyable: boolean;
  /** Which rules failed, empty when copyable. */
  failures: string[];
  catalogProjectStep: { argv: string[]; marker: string };
  init: { exitCode: number | null; ms: number; createdInMain: string[]; gitStatusAfterInit: string[] };
  pathsRelative: boolean;
  prefixScan: { prefixes: string[]; hits: PrefixHit[]; scannerControl: { raw: boolean; sqliteColumn: boolean } };
  copy: { copiedFiles: string[]; ms: number; sidecarsInCopy: string[]; gitStatusInWorktree: string[] };
  /** SQLite stores only: what a `readonly` open and a `readwrite-existing` open do on an index at rest. */
  sqliteOpenModes?: { main: Awaited<ReturnType<typeof probeOpenModes>>; copy: Awaited<ReturnType<typeof probeOpenModes>> };
  queryFromCopy: { term: string; foundInCopy: boolean; leaksOriginalPrefix: boolean; sample: string };
  stateRecording: {
    inMain: RecordedState;
    inCopy: RecordedState;
    afterCommitInWorktree: RecordedState;
    afterMainRefresh: RecordedState;
    worktreeHead: string;
    mainDirtyAfterEdit: RecordedState;
  };
  enumerable: { files: number; paths: string[] } | { files: "not enumerable" };
  isIndexable: { path: string; sizeBytes: number; indexed: boolean }[];
  unchangedCopy: { touched: string[]; touchesZero: boolean };
  changeScenario: { queries: QueryChecks; expectedReindexed: string[]; reindexed: string[]; untouchedButReindexed: string[]; removedFromIndex: string[]; docsOnlyReindexed: boolean };
  mainDirty: { path: string; foundWorktreeContentAfterUpdate: boolean; staleDirtyContentGone: boolean; digestMatchesWorktree: boolean | undefined; reindexed: boolean };
  updates: UpdateRun[];
  /** Union over all runs. */
  writes: { insideOwned: string[]; outsideOwned: string[]; sidecars: string[]; outsideProject: string[] };
  lock: { transientLockFiles: string[]; concurrent: { exitCodes: (number | null)[]; mentionsLock: boolean; bothFilesIndexedAfter: boolean } };
  daemon: {
    started: boolean;
    updateExitCode: number | null;
    createdBesideIndex: string[];
    indexWritesDuringDaemon: string[];
    pidFiles: string[];
    /** Unix sockets the engine's process made outside the project (in the user temp dir). */
    socketsOutsideProject: string[];
  };
  durationsMs: Record<string, number>;
  /** The values the catalog `index` descriptor would carry, derived from the numbers above. */
  proposedDescriptor:
    | {
        worktrees: "copy";
        path: string;
        paths: "relative";
        incremental: true;
        owned: string[];
        copy: { store: "sqlite" | "file"; include: string[]; updateRefreshesModified: true; update: string[] };
      }
    | { worktrees: "none"; reason: string[] };
  steps: Record<string, string>;
}

export type MeasureOutcome = EngineMeasurement | { engine: string; status: "absent"; missing: string[] };

const tail = (s: string, n = 600): string => (s.length <= n ? s : `...${s.slice(s.length - n)}`);

function seedFiles(oversize: boolean): Record<string, string | Buffer> {
  const fn = (name: string, n: number): string => `export function ${name}(x: number): number {\n  return x + ${n};\n}\nexport const ${name}Value = ${name}(1);\n`;
  const big: string[] = [];
  for (let i = 0; i < 30_000; i++) big.push(`export const big${i} = ${i};`);
  return {
    // only `ignored.ts` is git-ignored: dist/, build/, vendor/ and node_modules/ are TRACKED below,
    // so whether the engine skips them by directory name is measured, not assumed
    ".gitignore": "ignored.ts\n",
    "dist/out.js": "function distFn() { return 1 }\n",
    "build/b.js": "function buildFn() { return 1 }\n",
    "vendor/v.js": "function vendorDirFn() { return 1 }\n",
    "src/a.test.ts": "export function aTestFn() { return 1 }\n",
    "types/t.d.ts": "export declare function dtsFn(): number;\n",
    "ext/x.mjs": "export function mjsFn() { return 1 }\n",
    "ext/x.kt": "fun ktFn(): Int = 1\n",
    "ext/x.swift": "func swiftFn() -> Int { 1 }\n",
    "ext/x.php": "<?php function phpFn() { return 1; }\n",
    "ext/x.cs": "class X { int CsFn() { return 1; } }\n",
    "ext/x.cpp": "int cppFn() { return 1; }\n",
    "ext/x.json": '{"a":1}\n',
    "src/a.ts": fn("alphaFn", 1),
    "src/b.ts": fn("betaOriginal", 2),
    "src/c.ts": fn("gammaFn", 3),
    "src/dir/d.ts": fn("deltaFn", 4),
    "src/swap.ts": fn("swapFn", 5),
    "src/keep.ts": fn("keepFn", 6),
    "README.md": "# scratch\n\nA readme.\n",
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}\n',
    "data.json": '{"rows":[1,2,3]}\n',
    "image.png": Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37) % 251)),
    "big.ts": `${big.join("\n")}\n`,
    // oversize probe: does the engine cap the size of a file it indexes?
    ...(oversize ? { "huge.ts": `${Array.from({ length: 15 }, () => big).flat().join("\n")}\n` } : {}),
    // one tiny file per extension, so `isIndexable` is a measured table and not a guess
    "ext/x.py": "def py_fn():\n    return 1\n",
    "ext/x.go": "package x\n\nfunc GoFn() int { return 1 }\n",
    "ext/x.rs": "pub fn rs_fn() -> i32 { 1 }\n",
    "ext/x.js": "function jsFn() { return 1 }\nmodule.exports = { jsFn }\n",
    "ext/x.tsx": "export function TsxFn() { return null }\n",
    "ext/x.java": "public class X { public int javaFn() { return 1; } }\n",
    "ext/x.rb": "def rb_fn\n  1\nend\n",
    "ext/x.c": "int c_fn(void) { return 1; }\n",
    "ext/x.sh": "sh_fn() { echo 1; }\n",
    "ext/x.css": ".a { color: red; }\n",
    "ext/x.html": "<html><body><p>hi</p></body></html>\n",
    "ext/x.yaml": "key: value\n",
    "ext/x.md": "# heading\n",
    "ext/app.min.js": "function minFn(){return 1}\n",
    "ignored.ts": fn("ignoredFn", 7),
    "node_modules/pkg/index.js": "exports.vendoredFn = function vendoredFn() { return 1 }\n",
  };
}

function writeSeed(dir: string, files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

const fnSource = (name: string, n: number): string => `export function ${name}(x: number): number {\n  return x + ${n};\n}\nexport const ${name}Value = ${name}(1);\n`;

function listNames(dir: string, rel: string): string[] {
  const out: string[] = [];
  try {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      out.push(r);
      if (e.isDirectory()) out.push(...listNames(dir, r));
    }
  } catch {
    // the directory is not there (yet)
  }
  return out;
}

async function watchTransient<T>(dir: string, roots: readonly string[], fn: () => Promise<T>): Promise<{ value: T; transient: string[] }> {
  const before = new Set(roots.flatMap((r) => listNames(dir, r)));
  const seen = new Set<string>();
  const timer = setInterval(() => {
    for (const r of roots) for (const n of listNames(dir, r)) seen.add(n);
  }, 3);
  let value: T;
  try {
    value = await fn();
  } finally {
    clearInterval(timer);
  }
  const after = new Set(roots.flatMap((r) => listNames(dir, r)));
  return { value, transient: [...seen].filter((n) => !before.has(n) && !after.has(n)).sort() };
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Signal 0: is there a process with this pid (and may we signal it)? */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Does this pid provably belong to the scratch project at `dir`? Its working directory is inside
 * it, or its command line names it. Anything that cannot be established is "no": a daemon left
 * running is a leak this harness reports, a process of the user's that is killed is not.
 */
function belongsToScratch(pid: number, dir: string, dirReal: string): boolean {
  const inside = (p: string): boolean => p === dirReal || p.startsWith(`${dirReal}/`) || p === dir || p.startsWith(`${dir}/`);
  try {
    if (inside(realpathSync(`/proc/${pid}/cwd`))) return true;
  } catch {
    // No /proc (macOS): ask lsof below.
  }
  const lsof = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8", timeout: 5000 });
  if (lsof.status === 0) {
    for (const line of lsof.stdout.split("\n")) {
      if (line.startsWith("n") && inside(line.slice(1))) return true;
    }
  }
  const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5000 });
  return ps.status === 0 && (ps.stdout.includes(dirReal) || ps.stdout.includes(dir));
}

/**
 * Stops the processes named by `*.pid` files under `roots` of a scratch project (SIGTERM, then
 * SIGKILL) and removes the unix sockets those processes name. A pid file holds either a bare
 * integer or a JSON object with `pid` and `socketPath`. A pid is signalled only when it provably
 * belongs to the scratch project (see `belongsToScratch`), the SIGKILL only if it is still alive,
 * and a socket is removed only when it is a socket inside the scratch tree or named by such a
 * process. Returns what it found, for the report.
 */
async function reapPidFiles(dir: string, roots: readonly string[]): Promise<{ pidFiles: string[]; sockets: string[] }> {
  // Only a process that PROVES it belongs to this scratch project is signalled, and only a socket
  // that process (or the scratch tree) owns is removed: a pid in a file can be stale and recycled,
  // and a socket path is engine-written text.
  const pids = new Map<number, string | undefined>();
  const pidFiles: string[] = [];
  for (const root of roots) {
    for (const rel of walkFiles(dir, root)) {
      if (!rel.endsWith(".pid")) continue;
      pidFiles.push(rel);
      try {
        const text = readFileSync(join(dir, rel), "utf8").trim();
        let pid = Number.parseInt(text, 10);
        let socketPath: string | undefined;
        if (text.startsWith("{")) {
          const parsed = JSON.parse(text) as { pid?: unknown; socketPath?: unknown };
          pid = typeof parsed.pid === "number" ? parsed.pid : Number.NaN;
          if (typeof parsed.socketPath === "string") socketPath = parsed.socketPath;
        }
        if (Number.isInteger(pid) && pid > 1 && pid !== process.pid) pids.set(pid, socketPath);
      } catch {
        // unreadable pid file: nothing to stop
      }
    }
  }
  const scratchReal = realpathOrSelf(dir);
  const ours = new Map<number, string | undefined>();
  for (const [pid, socketPath] of pids) {
    if (alive(pid) && belongsToScratch(pid, dir, scratchReal)) ours.set(pid, socketPath);
  }
  const ownedAtStart = new Set(ours.keys());
  for (const sig of ["SIGTERM", "SIGKILL"] as const) {
    for (const pid of ours.keys()) {
      // The second signal goes only to a process that is still there (and still ours).
      if (!alive(pid)) {
        ours.delete(pid);
        continue;
      }
      if (sig === "SIGKILL" && !belongsToScratch(pid, dir, scratchReal)) {
        ours.delete(pid);
        continue;
      }
      try {
        process.kill(pid, sig);
      } catch {
        ours.delete(pid); // already gone
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  // A socket is removed only when it is a socket, and either lies inside the scratch tree or was
  // named by a process proven to be ours.
  const sockets = new Set<string>();
  for (const [pid, socketPath] of pids) {
    if (socketPath === undefined) continue;
    sockets.add(socketPath);
    const kind = (() => {
      try {
        return lstatSync(socketPath);
      } catch {
        return undefined;
      }
    })();
    if (kind === undefined || !kind.isSocket()) continue;
    const insideScratch = realpathOrSelf(dirname(socketPath)).startsWith(`${scratchReal}/`);
    const named = ownedAtStart.has(pid);
    if (insideScratch || named) rmSync(socketPath, { force: true });
  }
  return { pidFiles: pidFiles.sort(), sockets: [...sockets].sort() };
}

function globalSnapshot(dirs: readonly string[]): Map<string, FileFact> {
  const m = new Map<string, FileFact>();
  for (const d of dirs) for (const [k, v] of snapshotTree(d)) m.set(`${d}/${k}`, v);
  return m;
}

export interface MeasureOptions {
  scratchRoot?: string;
  keep?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}

/** Measures one engine end to end. Never throws for an engine misbehaving: a failed step is recorded. */
export async function measureEngine(id: string, options: MeasureOptions = {}): Promise<MeasureOutcome> {
  const probe = PROBES[id];
  const entry = (CATALOG as Record<string, CatalogEntry>)[id];
  if (probe === undefined || entry?.projectStep === undefined) throw new Error(`no probe for engine "${id}"`);
  const projectStep = entry.projectStep;
  const missing = probe.requires.filter((b) => !onPath(b, options.env ?? process.env));
  if (missing.length > 0) return { engine: id, status: "absent", missing };

  const scratchBase = options.scratchRoot ?? process.env.CODE_SEARCH_MEASURE_SCRATCH ?? tmpdir();
  mkdirSync(scratchBase, { recursive: true });
  const root = mkdtempSync(join(scratchBase, `measure-${id}-`));
  const steps: Record<string, string> = {};
  const durations: Record<string, number> = {};
  const failures: string[] = [];
  const updates: UpdateRun[] = [];
  const owned = [...probe.indexRoots];

  const step = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      const v = await fn();
      steps[name] = "ok";
      return v;
    } catch (e) {
      steps[name] = `error: ${e instanceof Error ? e.message : String(e)}`;
      return fallback;
    }
  };

  try {
    const main = join(root, "main");
    mkdirSync(main, { recursive: true });
    const seed = seedFiles(probe.oversizeProbe === true);
    writeSeed(main, seed);
    await git(main, "init", "-q", "-b", "main", ".");
    await git(main, "add", "-A");
    await git(main, "commit", "-q", "-m", "seed");
    const headOf = async (dir: string): Promise<string> => (await git(dir, "rev-parse", "HEAD")).stdout.trim();
    const statusOf = async (dir: string): Promise<string[]> =>
      (await git(dir, "--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all")).stdout.split("\n").filter((l) => l !== "");
    const baseHead = await headOf(main);

    const versionRun = await runCommand(entry.versionProbe.argv, { cwd: main, timeoutMs: 30_000 });
    const version = entry.versionProbe.pattern.exec(versionRun.stdout)?.[1];

    // ---- 1. the engine's own projectStep ------------------------------------------------
    const projectArgv = [...withProjectDir(projectStep.argv, main), ...(projectStep.unattended ?? [])];
    const treeBeforeInit = snapshotTree(main);
    const initRun = await runCommand(projectArgv, { cwd: main });
    durations.init = initRun.ms;
    const createdInMain = diffSnapshots(treeBeforeInit, snapshotTree(main)).created;
    const gitStatusAfterInit = await statusOf(main);
    if (initRun.code !== 0 || !existsSync(join(main, projectStep.marker))) {
      failures.push(`projectStep failed (exit ${String(initRun.code)}): ${tail(initRun.stderr || initRun.stdout, 300)}`);
    }

    // Before ANY reader has opened it: what a plain read-only open does on an index at rest.
    const openModesMain =
      probe.store === "sqlite" && existsSync(join(main, projectStep.marker))
        ? await step("open-modes-main", () => probeOpenModes(join(main, projectStep.marker)), undefined)
        : undefined;

    // ---- 2. the update runner, with write/lock/reindex observation ----------------------
    const runUpdate = async (label: string, dir: string, where: "main" | "worktree"): Promise<UpdateRun> => {
      // Our own reads of the index come BEFORE the first snapshot and AFTER the last, so a
      // sidecar a reader makes is never booked as something `update` wrote.
      const fpBefore = (await probe.fingerprints(dir)) ?? new Map<string, string>();
      const treeBefore = snapshotTree(dir);
      const globalBefore = globalSnapshot(probe.globalDirs);
      const { value: res, transient } = await watchTransient(dir, owned, () => runCommand(probe.update, { cwd: dir, timeoutMs: 120_000 }));
      const treeAfter = snapshotTree(dir);
      const diff = diffSnapshots(treeBefore, treeAfter);
      const fpAfter = (await probe.fingerprints(dir)) ?? new Map<string, string>();
      const globalDiff = diffSnapshots(globalBefore, globalSnapshot(probe.globalDirs));
      const written = [...diff.created, ...diff.modified, ...diff.touchedOnly, ...diff.deleted];
      const reindexed = new Set<string>();
      for (const [p, fp] of fpAfter) if (fpBefore.get(p) !== fp) reindexed.add(p);
      for (const p of fpBefore.keys()) if (!fpAfter.has(p)) reindexed.add(p);
      const run: UpdateRun = {
        label,
        argv: [...probe.update],
        cwd: where,
        exitCode: res.code,
        timedOut: res.timedOut,
        ms: res.ms,
        stdoutTail: tail(res.stdout),
        stderrTail: tail(res.stderr),
        writtenInsideOwned: written.filter((p) => inside(p, owned)).sort(),
        writtenOutsideOwned: written.filter((p) => !inside(p, owned)).sort(),
        sidecarsSeen: [...new Set([...written, ...transient].filter((p) => SIDECAR_PATTERN.test(p)))].sort(),
        transientFiles: transient,
        reindexed: [...reindexed].sort(),
        outsideProjectWrites: [...globalDiff.created, ...globalDiff.modified, ...globalDiff.touchedOnly, ...globalDiff.deleted].sort(),
      };
      updates.push(run);
      return run;
    };

    // ---- 3. clean copy -> worktree A (unchanged copy touches zero files) -----------------
    const cleanState = await step("state-main", () => probe.readState(main), { commitRecorded: false, dirtyRecorded: false, source: "unread" } as RecordedState);
    const indexableTable = await step(
      "enumerate",
      async () => {
        const fp = await probe.fingerprints(main);
        const present = fp === undefined ? undefined : new Set(fp.keys());
        const rows = Object.entries(seed).map(([path, content]) => ({
          path,
          sizeBytes: Buffer.byteLength(content),
          indexed: present?.has(path) ?? false,
        }));
        return { present, rows };
      },
      { present: undefined as Set<string> | undefined, rows: [] as { path: string; sizeBytes: number; indexed: boolean }[] },
    );

    const wtA = join(root, "wt-clean");
    await git(main, "worktree", "add", "-q", "-b", "wt-clean", wtA, "HEAD");
    const t0 = Date.now();
    const copiedFiles = await step("copy", () => copyIndexProduction(entry, probe, main, wtA), [] as string[]);
    durations.copy = Date.now() - t0;
    const gitStatusInWorktree = await statusOf(wtA);
    const sidecarsInCopy = walkFiles(wtA).filter((p) => inside(p, owned) && SIDECAR_PATTERN.test(p));
    const copyOpenModes =
      probe.store === "sqlite" ? await step("open-modes-copy", () => probeOpenModes(join(wtA, projectStep.marker)), undefined) : undefined;
    const sqliteOpenModes = openModesMain !== undefined && copyOpenModes !== undefined ? { main: openModesMain, copy: copyOpenModes } : undefined;

    // 3a. prefix search over the copy, and a query served from it
    const prefixes = [...new Set([main, realpathSync(main), root, realpathSync(root)])];
    const control = await step("scanner-control", () => scannerControl(root), { raw: false, sqliteColumn: false });
    if (!control.raw || !control.sqliteColumn) failures.push("prefix scanner failed its positive control");
    const hits = await step("prefix-scan", () => scanForPrefix(wtA, owned, prefixes), [] as PrefixHit[]);
    const pathsRelative = hits.length === 0 && control.raw && control.sqliteColumn;
    if (hits.length > 0) failures.push(`index holds the original's absolute prefix (${hits.length} hit(s))`);

    const stateInCopy = await step("state-copy", () => probe.readState(wtA), { commitRecorded: false, dirtyRecorded: false, source: "unread" } as RecordedState);
    const queryTerm = "alphaFn";
    const sample = await step("query-copy", () => probe.sampleQuery(wtA, queryTerm), { code: null, text: "" });
    const foundInCopy = await step("query-copy-has", () => probe.has(wtA, queryTerm), false);
    const leaksOriginalPrefix = prefixes.some((p) => sample.text.includes(p));
    if (!foundInCopy) failures.push("a query from the copy did not find a symbol of the committed tree");
    if (leaksOriginalPrefix) failures.push("a query from the copy returned the original's absolute prefix");

    // 3b. update on the unchanged copy
    const fpCopy = (await probe.fingerprints(wtA)) ?? new Map<string, string>();
    const unchangedRun = await runUpdate("unchanged-copy", wtA, "worktree");
    durations.updateUnchanged = unchangedRun.ms;
    const touched = unchangedRun.reindexed;
    void fpCopy;
    const touchesZero = unchangedRun.exitCode === 0 && touched.length === 0;
    if (unchangedRun.exitCode !== 0) failures.push(`update on an unchanged copy exited ${String(unchangedRun.exitCode)}`);
    if (!touchesZero) failures.push(`update on an unchanged copy touched ${touched.length} file(s): ${touched.slice(0, 6).join(", ")}`);

    // ---- 4. worktree B: edit, add, delete, file -> directory swap ------------------------
    const wtB = join(root, "wt-change");
    await git(main, "worktree", "add", "-q", "-b", "wt-change", wtB, "HEAD");
    await step("copy-b", () => copyIndexProduction(entry, probe, main, wtB), [] as string[]);
    const terms = {
      added: "newCommittedFn",
      modified: "alphaCommitted",
      deleted: "gammaFn",
      swapGone: "swapFn",
      swapNew: "swapInnerFn",
      untracked: "untrackedFn",
      dirEdit: "dirEditFn",
    };
    const before: Record<string, boolean> = {};
    for (const [k, t] of Object.entries(terms)) before[k] = await step(`pre-${k}`, () => probe.has(wtB, t), false);

    writeFileSync(join(wtB, "src/a.ts"), `${seed["src/a.ts"] as string}${fnSource("alphaCommitted", 11)}`);
    writeFileSync(join(wtB, "src/new1.ts"), fnSource("newCommittedFn", 12));
    rmSync(join(wtB, "src/c.ts"));
    rmSync(join(wtB, "src/swap.ts"));
    mkdirSync(join(wtB, "src/swap"), { recursive: true });
    writeFileSync(join(wtB, "src/swap/inner.ts"), fnSource("swapInnerFn", 13));
    await git(wtB, "add", "-A");
    await git(wtB, "commit", "-q", "-m", "change");
    // uncommitted on top of the commit: an edit, an untracked file, a docs-only edit
    writeFileSync(join(wtB, "src/dir/d.ts"), `${seed["src/dir/d.ts"] as string}${fnSource("dirEditFn", 14)}`);
    writeFileSync(join(wtB, "src/untracked.ts"), fnSource("untrackedFn", 15));
    writeFileSync(join(wtB, "README.md"), "# scratch\n\nA readme, edited.\n");
    const wtBHead = await headOf(wtB);

    const changeRun = await runUpdate("changed-worktree", wtB, "worktree");
    durations.updateChanged = changeRun.ms;
    const after: Record<string, boolean> = {};
    for (const [k, t] of Object.entries(terms)) after[k] = await step(`post-${k}`, () => probe.has(wtB, t), false);
    const queries: QueryChecks = {};
    for (const k of Object.keys(terms)) queries[terms[k as keyof typeof terms]] = { before: before[k] === true, after: after[k] === true };

    const expectedReindexed = ["src/a.ts", "src/new1.ts", "src/swap/inner.ts", "src/dir/d.ts", "src/untracked.ts"];
    const removedExpected = ["src/c.ts", "src/swap.ts"];
    const fpB = await probe.fingerprints(wtB);
    const removedFromIndex = fpB === undefined ? [] : removedExpected.filter((p) => !fpB.has(p));
    const mustBeUntouched = ["src/keep.ts", "src/b.ts"];
    const untouchedButReindexed = changeRun.reindexed.filter((p) => mustBeUntouched.includes(p));
    const docsOnlyReindexed = changeRun.reindexed.includes("README.md");
    if (changeRun.exitCode !== 0) failures.push(`update after changes exited ${String(changeRun.exitCode)}`);
    if (!(after.added === true && before.added === false)) failures.push("a file added in the worktree was not found after update");
    if (!(after.modified === true && before.modified === false)) failures.push("a modified file was not re-indexed (new symbol not found)");
    if (!(after.deleted === false && before.deleted === true)) failures.push("a deleted file is still in the index after update");
    if (!(after.swapNew === true && after.swapGone === false)) failures.push("a file replaced by a directory was not handled by update");
    if (!(after.untracked === true && after.dirEdit === true)) failures.push("uncommitted worktree changes were not picked up by update");
    if (untouchedButReindexed.length > 0) failures.push(`update re-indexed unchanged files: ${untouchedButReindexed.join(", ")}`);
    const stateAfterWorktreeCommit = await step("state-after-commit", () => probe.readState(wtB), { commitRecorded: false, dirtyRecorded: false, source: "unread" } as RecordedState);

    // ---- 5. main-dirty file: the copy holds main's uncommitted content --------------------
    writeFileSync(join(main, "src/b.ts"), fnSource("betaDirtyV1", 21));
    const mainDirtyRun = await runUpdate("main-dirty", main, "main");
    durations.updateMainDirty = mainDirtyRun.ms;
    const mainDirtyState = await step("state-main-dirty", () => probe.readState(main), { commitRecorded: false, dirtyRecorded: false, source: "unread" } as RecordedState);
    const wtC = join(root, "wt-dirty");
    await git(main, "worktree", "add", "-q", "-b", "wt-dirty", wtC, "HEAD");
    await step("copy-c", () => copyIndexProduction(entry, probe, main, wtC), [] as string[]);
    const dirtyBefore = await step("dirty-before", () => probe.has(wtC, "betaDirtyV1"), false);
    const fpC0 = (await probe.fingerprints(wtC)) ?? new Map<string, string>();
    const dirtyRun = await runUpdate("worktree-of-dirty-main", wtC, "worktree");
    const originalFound = await step("dirty-original", () => probe.has(wtC, "betaOriginal"), false);
    const dirtyGone = !(await step("dirty-gone", () => probe.has(wtC, "betaDirtyV1"), true));
    const digests = await probe.contentDigests(wtC);
    const worktreeDigest = createHash("sha256").update(readFileSync(join(wtC, "src/b.ts"))).digest("hex");
    const digestMatches = digests === undefined ? undefined : digests.get("src/b.ts") === worktreeDigest;
    const fpC1 = (await probe.fingerprints(wtC)) ?? new Map<string, string>();
    const bReindexed = fpC0.get("src/b.ts") !== fpC1.get("src/b.ts");
    if (!(dirtyBefore && originalFound && dirtyGone && bReindexed)) failures.push("a file dirty in main was not re-indexed from the worktree's content");
    if (dirtyRun.exitCode !== 0) failures.push(`update on a copy of a dirty main exited ${String(dirtyRun.exitCode)}`);

    // ---- 6. main refresh: commit the dirty edit plus a new file, update main ---------------
    writeFileSync(join(main, "src/refresh.ts"), fnSource("refreshFn", 22));
    await git(main, "add", "-A");
    await git(main, "commit", "-q", "-m", "second");
    const mainHead2 = await headOf(main);
    const refreshRun = await runUpdate("main-refresh", main, "main");
    durations.updateMainRefresh = refreshRun.ms;
    const stateAfterRefresh = await step("state-refresh", () => probe.readState(main), { commitRecorded: false, dirtyRecorded: false, source: "unread" } as RecordedState);
    const refreshFound = await step("refresh-has", () => probe.has(main, "refreshFn"), false);
    if (!refreshFound) failures.push("main's own update did not index a file committed since the build");

    // ---- 7. does the engine lock? two concurrent updates in one project -------------------
    writeFileSync(join(wtC, "src/c1.ts"), fnSource("concurrentOneFn", 31));
    writeFileSync(join(wtC, "src/c2.ts"), fnSource("concurrentTwoFn", 32));
    const treeBeforeConcurrent = snapshotTree(wtC);
    const concurrent = await watchTransient(wtC, owned, () =>
      Promise.all([runCommand(probe.update, { cwd: wtC, timeoutMs: 120_000 }), runCommand(probe.update, { cwd: wtC, timeoutMs: 120_000 })]),
    );
    const lockText = concurrent.value.map((r) => `${r.stdout}\n${r.stderr}`).join("\n");
    const mentionsLock = /\block(ed)?\b|already (running|in progress)|busy|another/iu.test(lockText);
    const bothIndexed = (await step("c1", () => probe.has(wtC, "concurrentOneFn"), false)) && (await step("c2", () => probe.has(wtC, "concurrentTwoFn"), false));
    const concurrentDiff = diffSnapshots(treeBeforeConcurrent, snapshotTree(wtC));
    for (const p of [...concurrentDiff.created, ...concurrentDiff.modified]) if (!inside(p, owned) && p !== "src/c1.ts" && p !== "src/c2.ts") failures.push(`concurrent update wrote outside owned: ${p}`);

    // ---- 8. a live engine process on main (its MCP server / daemon) -----------------------
    let daemonReaped: { pidFiles: string[]; sockets: string[] } = { pidFiles: [], sockets: [] };
    const daemon = await step(
      "daemon",
      async () => {
        const startArgv = entry.start;
        const argv = withProjectDir(startArgv, main);
        let child: ChildProcess | undefined;
        const before = new Set(owned.flatMap((r) => listNames(main, r)));
        let started = false;
        let outcome: { updateExitCode: number | null; createdBesideIndex: string[]; indexWritesDuringDaemon: string[] } | undefined;
        try {
          child = spawn(argv[0] as string, argv.slice(1), { cwd: main, env: { ...process.env, NO_COLOR: "1" }, stdio: ["pipe", "ignore", "ignore"] });
          started = true;
          await new Promise((r) => setTimeout(r, 3000));
          writeFileSync(join(main, "src/daemon.ts"), fnSource("daemonFn", 41));
          const run = await runUpdate("main-with-engine-process-running", main, "main");
          const beside = owned.flatMap((r) => listNames(main, r)).filter((n) => !before.has(n));
          outcome = { updateExitCode: run.exitCode, createdBesideIndex: beside.sort(), indexWritesDuringDaemon: run.writtenInsideOwned };
        } finally {
          // This child only, then the pids the engine itself wrote into OUR scratch index
          // directory (a daemon outlives its parent). Never a name-based kill.
          child?.stdin?.end();
          child?.kill("SIGTERM");
          await new Promise((r) => setTimeout(r, 800));
          const reaped = await reapPidFiles(main, owned);
          daemonReaped = reaped;
        }
        return {
          started,
          updateExitCode: outcome?.updateExitCode ?? null,
          createdBesideIndex: outcome?.createdBesideIndex ?? [],
          indexWritesDuringDaemon: outcome?.indexWritesDuringDaemon ?? [],
          pidFiles: daemonReaped.pidFiles,
          socketsOutsideProject: daemonReaped.sockets,
        };
      },
      {
        started: false,
        updateExitCode: null as number | null,
        createdBesideIndex: [] as string[],
        indexWritesDuringDaemon: [] as string[],
        pidFiles: [] as string[],
        socketsOutsideProject: [] as string[],
      },
    );

    // ---- verdict --------------------------------------------------------------------------
    if (!stateInCopy.commitRecorded) failures.push("the index does not record the commit it was built at");
    if (!stateInCopy.dirtyRecorded) failures.push("the index does not record which paths were dirty when it was built");
    if (stateInCopy.commitRecorded && stateInCopy.commit !== baseHead) failures.push("the recorded commit is not the commit that was indexed");
    if (stateAfterWorktreeCommit.commitRecorded && stateAfterWorktreeCommit.commit !== wtBHead) failures.push("after update in the worktree the recorded commit is not the worktree HEAD");
    if (stateAfterRefresh.commitRecorded && stateAfterRefresh.commit !== mainHead2) failures.push("after update in main the recorded commit is not main's HEAD");
    if (fpB === undefined) failures.push("the index cannot enumerate its files");

    const allRuns = updates;
    const insideOwned = [...new Set(allRuns.flatMap((u) => u.writtenInsideOwned))].sort();
    const outsideOwned = [...new Set(allRuns.flatMap((u) => u.writtenOutsideOwned))].sort();
    const sidecars = [...new Set([...allRuns.flatMap((u) => u.sidecarsSeen), ...concurrent.transient.filter((p) => SIDECAR_PATTERN.test(p))])].sort();
    const outsideProject = [...new Set(allRuns.flatMap((u) => u.outsideProjectWrites))].sort();
    if (outsideOwned.length > 0) failures.push(`update wrote outside the owned allowlist: ${outsideOwned.slice(0, 6).join(", ")}`);

    const marker = projectStep.marker;
    const include = [...new Set([...copiedFiles.filter((p) => p !== marker), marker])];
    const copyable = failures.length === 0;
    const proposed: EngineMeasurement["proposedDescriptor"] = copyable
      ? {
          worktrees: "copy",
          path: marker,
          paths: "relative",
          incremental: true,
          owned,
          copy: { store: probe.store, include, updateRefreshesModified: true, update: [...probe.update] },
        }
      : { worktrees: "none", reason: failures };

    const result: EngineMeasurement = {
      engine: id,
      status: "measured",
      version,
      platform: `${process.platform}-${process.arch}`,
      copyable,
      failures,
      catalogProjectStep: { argv: [...projectArgv], marker },
      init: { exitCode: initRun.code, ms: initRun.ms, createdInMain, gitStatusAfterInit },
      pathsRelative,
      prefixScan: { prefixes, hits, scannerControl: control },
      copy: { copiedFiles, ms: durations.copy ?? 0, sidecarsInCopy, gitStatusInWorktree },
      ...(sqliteOpenModes !== undefined ? { sqliteOpenModes } : {}),
      queryFromCopy: { term: queryTerm, foundInCopy, leaksOriginalPrefix, sample: tail(sample.text, 400) },
      stateRecording: {
        inMain: cleanState,
        inCopy: stateInCopy,
        afterCommitInWorktree: stateAfterWorktreeCommit,
        afterMainRefresh: stateAfterRefresh,
        worktreeHead: wtBHead,
        mainDirtyAfterEdit: mainDirtyState,
      },
      enumerable: indexableTable.present === undefined ? { files: "not enumerable" } : { files: indexableTable.present.size, paths: [...indexableTable.present].sort() },
      isIndexable: indexableTable.rows,
      unchangedCopy: { touched, touchesZero },
      changeScenario: { queries, expectedReindexed, reindexed: changeRun.reindexed, untouchedButReindexed, removedFromIndex, docsOnlyReindexed },
      mainDirty: { path: "src/b.ts", foundWorktreeContentAfterUpdate: originalFound, staleDirtyContentGone: dirtyGone, digestMatchesWorktree: digestMatches, reindexed: bReindexed },
      updates,
      writes: { insideOwned, outsideOwned, sidecars, outsideProject },
      lock: {
        transientLockFiles: [...new Set([...allRuns.flatMap((u) => u.transientFiles), ...concurrent.transient])].filter((p) => /lock/iu.test(p)).sort(),
        concurrent: { exitCodes: concurrent.value.map((r) => r.code), mentionsLock, bothFilesIndexedAfter: bothIndexed },
      },
      daemon,
      durationsMs: durations,
      proposedDescriptor: proposed,
      steps,
    };
    return result;
  } finally {
    if (!(options.keep ?? process.env.CODE_SEARCH_MEASURE_KEEP === "1")) {
      // linked worktrees live under `root`, so removing it removes them with the repo
      rmSync(root, { recursive: true, force: true });
    }
  }
}
