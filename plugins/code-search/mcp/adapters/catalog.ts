/**
 * catalog.ts — the ONE table of per-engine setup facts.
 *
 * How each engine is installed, upgraded, started, probed for a version, prepared for a
 * project, and what the settings block that starts it looks like. The adapters render
 * their remedy text from here, and the setup CLI runs these argv arrays. Nothing else in
 * this plugin may spell an install command; a second copy is how the two drift.
 *
 * It lives under adapters/ because core/ must never learn an engine id
 * (`core/imports.test.ts`). Its keys must equal `ENGINE_IDS` in `./index.ts`.
 *
 * ---------------------------------------------------------------------------------
 * EVERY FACT HERE WAS READ OFF A RUNNING INSTALL, NOT A README.
 *
 * Verified 2026-09-27 on macOS arm64 against mnemex 0.36.1, serena 1.7.0, codegraph 1.6.0
 * and graphify (package `graphifyy`) 0.9.50. Version-probe output and the index markers
 * were observed or read from the installed source; each entry's comment says which.
 * Install commands come from the upstream READMEs and the adapters' own verified remedies.
 * No `curl | sh` installer is used anywhere, even where upstream offers one.
 *
 * All argv arrays run WITHOUT a shell. `shellQuote` exists only to print them for a human.
 */

import type { IndexDescriptor, IndexSource, IndexState } from "../core/index-descriptor";
import type { EngineSpec } from "../core/settings";

/** The package manager an engine installs through. It is also the prerequisite. */
export type PackageManager = "bun" | "npm" | "uv";

export interface Prerequisite {
  /** Binary that must be on PATH before an install can run. */
  binary: string;
  /** Where the user installs it themselves. This plugin never pipes a script to a shell. */
  docsUrl: string;
}

export const PREREQUISITES: Readonly<Record<PackageManager, Prerequisite>> = {
  bun: { binary: "bun", docsUrl: "https://bun.sh/docs/installation" },
  npm: { binary: "npm", docsUrl: "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm" },
  uv: { binary: "uv", docsUrl: "https://docs.astral.sh/uv/getting-started/installation/" },
};

/**
 * Stands for the project directory inside an argv. Printed bare in remedies, where the
 * reader substitutes it; replaced with the real directory by `withProjectDir` before
 * anything runs.
 */
export const PROJECT_DIR_PLACEHOLDER = "<path>";

export interface VersionProbe {
  argv: readonly string[];
  /** Applied to stdout. Group 1 is the version. */
  pattern: RegExp;
}

export interface ProjectStep {
  /** Run with the project directory as cwd. May contain `PROJECT_DIR_PLACEHOLDER`. */
  argv: readonly string[];
  /** Appended when the setup CLI runs the step with no TTY. Not printed in remedies,
   *  where a person at a terminal answers the prompts themselves. */
  unattended?: readonly string[];
  /** Project-relative POSIX path whose existence proves the step has run. */
  marker: string;
  /** What running it costs, stated before the user is asked. */
  cost: string;
}

export interface EngineAbout {
  what: string;
  pros: string;
  cons: string;
}

/** The published package, for latest-version lookups and the uv tool receipt. */
export interface PackageRef {
  registry: "npm" | "pypi";
  name: string;
  /** Extras the install names, which the receipt must still record. */
  extras?: readonly string[];
}

export interface CatalogEntry {
  packageManager: PackageManager;
  package: PackageRef;
  install: readonly string[];
  /** Through the INSTALLING package manager, never the engine's own self-updater, so a
   *  binary found outside that manager's bin dir can be refused rather than half-upgraded. */
  upgrade: readonly string[];
  /** Every binary the install must put on PATH. The first is the one the settings start. */
  binaries: readonly string[];
  versionProbe: VersionProbe;
  /** Absent when the engine needs nothing per project. */
  projectStep?: ProjectStep;
  /**
   * How a new linked worktree gets this engine's index. Absent means "today's flow": the
   * normal setup question builds it from zero. Present ONLY for an engine whose copy recipe was
   * measured on a real install (`test-support/measure-index.ts`); the declared values must
   * equal that measurement field for field.
   */
  index?: IndexDescriptor;
  /** The MCP server start command as a person would type it: `settings.command` plus the
   *  leading `settings.args`. What remedies print. */
  start: readonly string[];
  /** The production `engines.<id>` block `configure` writes. */
  settings: EngineSpec;
  about: EngineAbout;
}

// ---------------------------------------------------------------------------------
// The four engines
// ---------------------------------------------------------------------------------

const MNEMEX_START = ["mnemex", "--mcp"] as const;

const mnemex = {
  packageManager: "bun",
  package: { registry: "npm", name: "mnemex" },
  install: ["bun", "install", "-g", "mnemex"],
  upgrade: ["bun", "install", "-g", "mnemex@latest"],
  binaries: ["mnemex"],
  // Observed: `mnemex v0.36.1`. It then races an update check against a 2 s timer and may
  // print a second "Update available" block, so only the first line is parsed.
  versionProbe: { argv: ["mnemex", "--version"], pattern: /^mnemex v(\d+\.\d+\.\d+)/mu },
  // Marker read from the installed source: PROJECT_CONFIG_DIR ".mnemex" + INDEX_DB_FILE
  // "index.db". A project `indexDir` override moves it; the default is what is checked.
  projectStep: {
    argv: ["mnemex", "index"],
    marker: ".mnemex/index.db",
    cost: "Embeds every file through a paid embedding API (a credential is required) and writes an index into .mnemex/ that grows with the codebase.",
  },
  // The ticket's declaration, not a measurement: mnemex finds the main project's index
  // itself, so a new worktree copies nothing and gets no setup question while main has one.
  index: { worktrees: "engine-managed", path: ".mnemex/index.db" },
  start: MNEMEX_START,
  settings: {
    command: MNEMEX_START[0],
    args: MNEMEX_START.slice(1),
    // mnemex's own switch, matching plugins/mnemex/.mcp.json.
    env: { MNEMEX_LSP: "true" },
    // The slow engine by construction: a cold start opens a multi-hundred-MB index and
    // embeds the query over the network before it can answer. 30 s (the transport
    // default) cuts that off on an honest first call; 120 s is what the live suite runs it
    // at, and stays well under CALL_TIMEOUT_CEILING_MS.
    callTimeoutMs: 120_000,
  },
  about: {
    what: "Semantic and structural search: embeds the code and builds a symbol graph ranked by PageRank.",
    pros: "Answers questions phrased in words, not only symbol names; callers, callees, call trees and impact.",
    cons: "Indexing calls a paid embedding API and needs a credential; the index must be rebuilt as code changes and can be large.",
  },
} satisfies CatalogEntry;

const SERENA_START = [
  "serena",
  "start-mcp-server",
  "--context",
  "claude-code",
  "--project-from-cwd",
] as const;

const serena = {
  packageManager: "uv",
  package: { registry: "pypi", name: "serena-agent" },
  install: ["uv", "tool", "install", "-p", "3.13", "serena-agent"],
  upgrade: ["uv", "tool", "upgrade", "serena-agent"],
  binaries: ["serena"],
  // Observed: `Serena 1.7.0`. An eager click flag with no side effect.
  versionProbe: { argv: ["serena", "--version"], pattern: /^Serena (\d+\.\d+\.\d+)/mu },
  // NO project step, verified in the installed source: `--project-from-cwd` finds the
  // project by `.git` or `.serena/project.yml` and autogenerates project.yml on
  // activation. `serena init` only writes the machine-wide ~/.serena config, which
  // `start-mcp-server` also autogenerates when missing.
  start: SERENA_START,
  settings: {
    command: SERENA_START[0],
    // All three headless flags are needed: with only `--open-web-dashboard False` serena
    // 1.7.0 still registers an `open_dashboard` tool. See live-engines.test.ts.
    args: [
      ...SERENA_START.slice(1),
      "--enable-web-dashboard",
      "False",
      "--open-web-dashboard",
      "False",
      "--enable-gui-log-window",
      "False",
    ],
    // No network and no cold index: a symbol lookup measured ~6 s. The transport's 30 s
    // is kept deliberately, so a hung language server fails loudly (settings.ts,
    // EngineSpec.callTimeoutMs) instead of being waited out.
    callTimeoutMs: 30_000,
  },
  about: {
    what: "Symbol lookup through language servers (LSP), the same machinery an editor uses.",
    pros: "No index step and no network; precise definitions, references and implementations.",
    cons: "Needs Python 3.13 via uv; starts a language server per session, so the first call takes seconds; finds names, not concepts.",
  },
} satisfies CatalogEntry;

const CODEGRAPH_START = ["codegraph", "serve", "--mcp"] as const;

// ---- codegraph's `index` descriptor: every value below was MEASURED (codegraph 1.6.2, macOS
// arm64) by `bun test-support/measure-index.ts codegraph`, not read from a README ----
const CODEGRAPH_DB = ".codegraph/codegraph.db";

/**
 * Measured: the index holds only project-relative paths (no occurrence of the original's
 * absolute prefix in any byte or SQLite column of a copy), records the commit it was built at
 * (`indexed_at_commit`) and the paths it indexed with uncommitted content
 * (`indexed_dirty_paths`, JSON `{commit, paths}`), and flags a whole index with
 * `index_state = 'complete'`. Any of the three missing or inconsistent is "doubt".
 */
function inspectCodegraph(source: IndexSource): IndexState {
  const db = source.sqlite(CODEGRAPH_DB);
  if (db === undefined) return { complete: false };
  try {
    const meta = new Map<string, string>();
    for (const row of db.query("SELECT key, value FROM project_metadata")) meta.set(String(row[0]), String(row[1]));
    const commit = meta.get("indexed_at_commit");
    const dirtyRaw = meta.get("indexed_dirty_paths");
    if (meta.get("index_state") !== "complete" || commit === undefined || commit === "" || dirtyRaw === undefined) return { complete: false };
    const dirty = JSON.parse(dirtyRaw) as { commit?: unknown; paths?: unknown };
    if (dirty.commit !== commit || !Array.isArray(dirty.paths) || !dirty.paths.every((p) => typeof p === "string")) return { complete: false };
    return { complete: true, commit, dirtyPaths: dirty.paths as string[] };
  } catch {
    return { complete: false };
  }
}

/**
 * Measured on 1.6.2: indexed are .ts .tsx .js .mjs .py .go .rs .java .rb .c .cpp .cs .kt
 * .swift .php .yaml (also .d.ts, .test.ts and .min.js); not indexed are .md .json .css .html
 * .sh, lockfiles and binaries. A tracked file under dist/, build/, vendor/ or node_modules/ is
 * skipped by directory name, and there is no size cap up to the 13 MB probed. The predicate
 * errs toward "not indexable": it also drops every hidden directory and a few unmeasured
 * build-output names, because claiming a path indexable that the engine skips would fail
 * verification, while dropping one only skips a check.
 */
const CODEGRAPH_INDEXED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".py", ".go", ".rs", ".java", ".rb", ".c", ".cpp", ".cs", ".kt", ".swift", ".php", ".yaml",
]);
const CODEGRAPH_SKIPPED_DIRS: ReadonlySet<string> = new Set([
  "node_modules", "dist", "build", "vendor", "out", "target", "coverage", "__pycache__", "venv", "bower_components",
]);

function isCodegraphIndexable(rel: string): boolean {
  const segments = rel.split("/");
  const file = segments.pop() ?? "";
  if (segments.some((s) => CODEGRAPH_SKIPPED_DIRS.has(s) || s.startsWith("."))) return false;
  const dot = file.lastIndexOf(".");
  return dot > 0 && CODEGRAPH_INDEXED_EXTENSIONS.has(file.slice(dot));
}

function codegraphIndexedFiles(source: IndexSource): ReadonlySet<string> | undefined {
  const db = source.sqlite(CODEGRAPH_DB);
  if (db === undefined) return undefined;
  try {
    return new Set(db.query("SELECT path FROM files").map((row) => String(row[0])));
  } catch {
    return undefined;
  }
}

const codegraph = {
  packageManager: "npm",
  package: { registry: "npm", name: "@colbymchenry/codegraph" },
  install: ["npm", "install", "-g", "@colbymchenry/codegraph"],
  upgrade: ["npm", "install", "-g", "@colbymchenry/codegraph@latest"],
  binaries: ["codegraph"],
  // Observed: a bare `1.6.0`.
  versionProbe: { argv: ["codegraph", "--version"], pattern: /^(\d+\.\d+\.\d+)/mu },
  // Marker from the installed typings: "initialized" requires both .codegraph/ and
  // codegraph.db. `codegraph init --help`: "-y, --yes  Non-interactive: skip every prompt
  // and take the defaults (for scripts / CI / container bootstraps)" — the CLI has no TTY.
  projectStep: {
    argv: ["codegraph", "init"],
    unattended: ["-y"],
    marker: ".codegraph/codegraph.db",
    cost: "Parses the project locally into a SQLite database in .codegraph/; no network, no credential.",
  },
  index: {
    worktrees: "copy",
    path: CODEGRAPH_DB,
    // The whole directory: besides the database the engine writes -wal/-shm, codegraph.lock,
    // and (while an MCP server runs) daemon.log, daemon.pid and writer.pid. All measured inside it.
    owned: [".codegraph"],
    paths: "relative",
    incremental: true,
    copy: {
      store: "sqlite",
      // The directory's own .gitignore first (without it git lists the copied database as an
      // untracked file), the marker last.
      include: [".codegraph/.gitignore", CODEGRAPH_DB],
      inspect: inspectCodegraph,
      updateRefreshesModified: true,
      isIndexable: (rel) => isCodegraphIndexable(rel),
      indexedFiles: codegraphIndexedFiles,
      // cwd = the project dir; `sync` with no path syncs it. Measured: exit 0 and "Already up
      // to date" on an unchanged copy (touches zero files), re-indexes a changed file from the
      // worktree's content, drops deleted files and a file replaced by a directory. Its own
      // lock (codegraph.lock) makes a second concurrent run exit 1.
      update: ["codegraph", "sync"],
    },
  },
  start: CODEGRAPH_START,
  settings: {
    command: CODEGRAPH_START[0],
    args: CODEGRAPH_START.slice(1),
    // Without this the server lists ONE tool and hides the other seven. The values are
    // unprefixed short names; the tools they open are prefixed. Both are correct.
    env: { CODEGRAPH_MCP_TOOLS: "explore,node,search,callers,callees,impact,files,status" },
    // A local SQLite FTS lookup with no service behind it. Past 30 s it is broken.
    callTimeoutMs: 30_000,
  },
  about: {
    what: "A SQLite code graph with full-text search, built locally.",
    pros: "Free and offline; callers, callees and impact from a real call graph.",
    cons: "Needs a one-time init per project, which adds a .codegraph/ directory; its index must be refreshed as code changes.",
  },
} satisfies CatalogEntry;

const GRAPHIFY_START = ["graphify-mcp", "graphify-out/graph.json"] as const;

const graphify = {
  packageManager: "uv",
  // The `[mcp]` extra is what installs the `mcp` library the server imports. The
  // `graphify-mcp` script itself is unconditional, so its presence on PATH does NOT prove
  // the extra was installed. uv records extras in the tool receipt, so an upgrade keeps it,
  // and the setup check reads the receipt rather than the PATH.
  package: { registry: "pypi", name: "graphifyy", extras: ["mcp"] },
  install: ["uv", "tool", "install", "graphifyy[mcp]"],
  upgrade: ["uv", "tool", "upgrade", "graphifyy"],
  binaries: ["graphify-mcp", "graphify"],
  // Observed: `graphify 0.9.50` on stdout. A stale-skill warning may appear on stderr.
  versionProbe: { argv: ["graphify", "--version"], pattern: /^graphify (\d+\.\d+\.\d+)/mu },
  // `--no-cluster` keeps it deterministic and free: clustering names communities with an LLM.
  projectStep: {
    argv: ["graphify", "update", PROJECT_DIR_PLACEHOLDER, "--no-cluster"],
    marker: "graphify-out/graph.json",
    cost: "Parses the project locally into graphify-out/graph.json; no network, no credential with --no-cluster.",
  },
  start: GRAPHIFY_START,
  settings: {
    command: GRAPHIFY_START[0],
    // The graph file, relative to the project the server is started in.
    args: GRAPHIFY_START.slice(1),
    // Reads one JSON graph from disk. Past 30 s it is broken.
    callTimeoutMs: 30_000,
  },
  about: {
    what: "A deterministic AST graph of the project, with no vector store.",
    pros: "Free, offline and deterministic; dependencies, dependents and paths between symbols.",
    cons: "Returns locations only, never source; no impact analysis; the graph must be rebuilt after changes and adds a graphify-out/ directory.",
  },
} satisfies CatalogEntry;

/**
 * Keys are engine ids and must equal `ENGINE_IDS`. Order matches `ADAPTERS`.
 *
 * `satisfies`, not an annotation, so an adapter reading its own entry sees the fields it
 * relies on (a `projectStep`, a named env var) as present rather than optional.
 */
export const CATALOG = {
  codegraph,
  graphify,
  mnemex,
  serena,
} as const satisfies Readonly<Record<string, CatalogEntry>>;

export type CatalogId = keyof typeof CATALOG;

// ---------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------

/** Characters that need no quoting in a POSIX shell word. */
const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/u;
/** Characters that keep their special meaning inside double quotes. */
const DOUBLE_QUOTE_UNSAFE = /["$`\\!]/u;

/**
 * An argv as ONE copy-pasteable command line, for display only.
 *
 * A plain word is printed bare; `PROJECT_DIR_PLACEHOLDER` is printed bare because the
 * reader substitutes it; anything else is double-quoted, which is how `"graphifyy[mcp]"`
 * survives zsh's glob expansion; and a word double quotes cannot hold safely is
 * single-quoted with the POSIX `'\''` escape.
 */
export function shellQuote(argv: readonly string[]): string {
  return argv.map(quoteWord).join(" ");
}

function quoteWord(word: string): string {
  if (word === PROJECT_DIR_PLACEHOLDER) return word;
  if (SAFE_WORD.test(word)) return word;
  if (!DOUBLE_QUOTE_UNSAFE.test(word)) return `"${word}"`;
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/** The argv to actually run: every `PROJECT_DIR_PLACEHOLDER` replaced with `projectDir`. */
export function withProjectDir(argv: readonly string[], projectDir: string): string[] {
  return argv.map((word) => (word === PROJECT_DIR_PLACEHOLDER ? projectDir : word));
}

/** The catalog entry for an id this build ships, or undefined. Never a near-match. */
export function catalogEntry(id: string): CatalogEntry | undefined {
  const table: Readonly<Record<string, CatalogEntry>> = CATALOG;
  return Object.hasOwn(table, id) ? table[id] : undefined;
}
