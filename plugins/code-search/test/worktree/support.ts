/**
 * support.ts — black-box child-process test harness for tests/test/worktree/.
 *
 * Drives the plugin strictly through child processes (hooks in hooks.json,
 * scripts/setup/cli.ts, and mcp/server.ts over stdio). Never imports new modules at
 * the top level so the identical suite runs against both the current tree and an
 * extracted baseline commit (validation 10 negative control).
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

export const SOURCE_PLUGIN_ROOT =
  process.env["CODE_SEARCH_TEST_PLUGIN_ROOT"] ?? join(import.meta.dir, "..", "..");

const BUN_DIR = dirname(process.execPath);

export type DescriptorMode =
  | "copy"
  | "copy-no-indexed-set"
  | "engine-managed"
  | "none"
  | "untouched";

export interface WorktreeScenario {
  root: string;
  pluginDir: string;
  home: string;
  cacheDir: string;
  binDir: string;
  engineLogFile: string;
  mainDir: string;
  wtDir: string;
  env: Record<string, string>;
}

const activeScratch: string[] = [];
const activeChildren: ChildProcess[] = [];

export async function cleanupScenarios(): Promise<void> {
  for (const child of activeChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin?.end();
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          if (child.pid !== undefined) {
            try {
              process.kill(child.pid, "SIGKILL");
            } catch {
              // ignore
            }
          }
          resolve();
        }, 1_000);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }
  for (const dir of activeScratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = Buffer.from(input, "utf8");
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= BigInt(bytes[i]!);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function git(cwd: string, args: readonly string[]): string {
  const res = spawnSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
    {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
      encoding: "utf8",
    },
  );
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${res.stderr}`);
  }
  return res.stdout.trim();
}

const FAKE_CODEGRAPH_SCRIPT = `#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const argv = process.argv.slice(2);
const cwd = process.cwd();
const logFile = process.env["FAKE_ENGINE_LOG"] ?? "";

function logEvent(entry: Record<string, unknown>): void {
  if (!logFile) return;
  appendFileSync(logFile, JSON.stringify({ cwd, argv, ...entry }) + "\\n");
}

function walkTsFiles(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full, root));
    } else if (entry.isFile() && /\\.(?:ts|tsx|js|jsx|py|go|rs)$/u.test(entry.name)) {
      out.push(relative(root, full).replace(/\\\\/gu, "/"));
    }
  }
  return out.sort();
}

function gitHead(dir: string): string {
  const r = spawnSync("git", ["--no-optional-locks", "-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

function gitDirtyIndexable(dir: string): string[] {
  const r = spawnSync("git", ["--no-optional-locks", "-C", dir, "status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "utf8" });
  if (r.status !== 0) return [];
  const parts = r.stdout.split("\\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const rec = parts[i];
    if (!rec || rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    if (xy.includes("R") || xy.includes("C")) i += 1;
    if (/\\.(?:ts|tsx|js|jsx|py|go|rs)$/u.test(path) && !path.startsWith(".claude/worktrees/")) {
      out.push(path);
    }
  }
  return [...new Set(out)].sort();
}

if (argv[0] === "init" || argv[0] === "sync" || argv[0] === "index") {
  const isMain = process.env["FAKE_MAIN_DIR"] === cwd;
  if (isMain && process.env["FAKE_HOLD_MAIN_MS"]) {
    const ms = Number(process.env["FAKE_HOLD_MAIN_MS"]);
    Bun.sleepSync(ms);
  }
  if (!isMain && process.env["FAKE_HOLD_WT_MS"]) {
    const ms = Number(process.env["FAKE_HOLD_WT_MS"]);
    Bun.sleepSync(ms);
  }
  if (isMain && process.env["FAKE_FAIL_MAIN_REFRESH"] === "1") {
    logEvent({ action: "main-refresh-failed", files: [] });
    process.exit(1);
  }
  if (!isMain && process.env["FAKE_FAIL_WT_CATCHUP"] === "1") {
    logEvent({ action: "wt-catchup-failed", files: [] });
    process.exit(1);
  }
  if (!isMain && process.env["FAKE_HANG_WT_CATCHUP"] === "1") {
    Bun.sleepSync(60_000);
    process.exit(0);
  }

  const dbDir = join(cwd, ".codegraph");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, "codegraph.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE IF NOT EXISTS project_metadata (key TEXT PRIMARY KEY, value TEXT);");
  db.exec("CREATE TABLE IF NOT EXISTS indexed_files (path TEXT PRIMARY KEY, content TEXT);");

  const existingRows = db.query("SELECT path, content FROM indexed_files").all() as { path: string; content: string }[];
  const existingMap = new Map(existingRows.map((r) => [r.path, r.content]));
  const diskFiles = walkTsFiles(cwd);
  const diskSet = new Set(diskFiles);
  const processed: string[] = [];

  for (const [oldPath] of existingMap) {
    if (!diskSet.has(oldPath)) {
      if (process.env["FAKE_KEEP_DELETED"] !== "1") {
        db.query("DELETE FROM indexed_files WHERE path = ?").run(oldPath);
      }
      processed.push(oldPath);
    }
  }

  for (const rel of diskFiles) {
    const content = readFileSync(join(cwd, rel), "utf8");
    if (existingMap.get(rel) !== content) {
      if (process.env["FAKE_SKIP_CHANGED"] !== "1") {
        db.query("INSERT OR REPLACE INTO indexed_files (path, content) VALUES (?, ?)").run(rel, content);
      }
      processed.push(rel);
    }
  }

  const head = gitHead(cwd);
  const dirty = gitDirtyIndexable(cwd);
  const completeVal = process.env["FAKE_INCOMPLETE_INDEX"] === "1" ? "0" : "1";
  const meta: [string, string][] = [
    ["complete", completeVal],
    ["status", completeVal === "1" ? "complete" : "building"],
    ["git_head", head],
    ["commit", head],
    ["head_commit", head],
    ["last_commit", head],
    ["dirty_paths", JSON.stringify(dirty)],
    ["dirty_files", JSON.stringify(dirty)],
    ["indexed_at", new Date().toISOString()],
  ];
  for (const [k, v] of meta) {
    db.query("INSERT OR REPLACE INTO project_metadata (key, value) VALUES (?, ?)").run(k, v);
  }
  db.close();
  logEvent({ action: argv[0], isMain, files: processed, head });
  process.exit(0);
}

if (argv[0] === "serve") {
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\\n");
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id === undefined || msg.id === null) continue;
      if (msg.method === "initialize") {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "codegraph", version: "1.6.0" },
          },
        });
      } else if (msg.method === "tools/list") {
        const shortNames = [
          "explore",
          "node",
          "search",
          "callers",
          "callees",
          "impact",
          "files",
          "status",
        ];
        const names = shortNames.map((n) => "codegraph" + "_" + n);
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: names.map((name) => ({ name, description: name, inputSchema: { type: "object" } })),
          },
        });
      } else if (msg.method === "tools/call") {
        const toolName = msg.params?.name ?? "";
        const args = msg.params?.arguments ?? {};
        const query = String(args.query ?? args.symbol ?? args.name ?? "");
        const dbPath = join(cwd, ".codegraph", "codegraph.db");
        if (!existsSync(dbPath)) {
          send({
            jsonrpc: "2.0",
            id: msg.id,
            result: { content: [{ type: "text", text: "No results found" }], isError: false },
          });
          continue;
        }
        const db = new Database(dbPath, { readonly: true });
        const rows = db.query("SELECT path, content FROM indexed_files").all() as { path: string; content: string }[];
        db.close();
        const hits = rows.filter((r) => r.content.includes(query) || r.path.includes(query));
        if (hits.length === 0) {
          send({
            jsonrpc: "2.0",
            id: msg.id,
            result: { content: [{ type: "text", text: \`No results found for "\${query}"\` }], isError: false },
          });
        } else {
          const blocks = hits.map((h) => \`**\${query}** (function)\\n\${h.path}:1\\n\\\`\${h.content.trim().split("\\n")[0] ?? ""}\\\`\`);
          const text = \`**Search Results (\${hits.length} found)**\\n\\n\${blocks.join("\\n\\n")}\\n\`;
          send({
            jsonrpc: "2.0",
            id: msg.id,
            result: { content: [{ type: "text", text }], isError: false },
          });
        }
      } else {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not found" } });
      }
    }
  });
}
`;

const FAKE_MNEMEX_SCRIPT = `#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let nl: number;
  while ((nl = buf.indexOf("\\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === undefined || msg.id === null) continue;
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mnemex", version: "0.31.2" },
        },
      });
    } else if (msg.method === "tools/list") {
      const names = ["search", "symbol", "context", "callers", "callees", "impact", "index_status"];
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: names.map((name) => ({ name, description: name, inputSchema: { type: "object" } })),
        },
      });
    } else if (msg.method === "tools/call") {
      const cannotAnswer = process.env["FAKE_MNEMEX_EMPTY"] === "1";
      const mainDir = process.env["FAKE_MAIN_DIR"] ?? process.cwd();
      const mainMarker = join(mainDir, ".mnemex", "index.db");
      const hasMainIndex = !cannotAnswer && existsSync(mainMarker);
      if (msg.params?.name === "index_status") {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  hasMainIndex
                    ? {
                        initialized: true,
                        indexedFileCount: 5,
                        indexDbLastIndexed: "2026-08-26T02:59:43.233Z",
                        lastIndexed: "2026-08-26T02:59:43.233Z",
                        freshness: "fresh",
                        filesChanged: [],
                        reindexingInProgress: false,
                      }
                    : {
                        initialized: true,
                        indexedFileCount: 0,
                        indexDbLastIndexed: null,
                        lastIndexed: null,
                        freshness: "stale",
                        filesChanged: [],
                        reindexingInProgress: false,
                      },
                ),
              },
            ],
            isError: false,
          },
        });
      } else {
        const toolName = msg.params?.name ?? "";
        const args = msg.params?.arguments ?? {};
        const q = String(args.query ?? args.name ?? args.symbol ?? "");
        if (toolName === "symbol") {
          const definitions = hasMainIndex
            ? [{ file: "src/base.ts", line: 1, startLine: 1, endLine: 3, name: q, kind: "function", signature: \`export function \${q}(): string\` }]
            : [];
          send({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    hasMainIndex
                      ? {
                          found: true,
                          symbol: { file: "src/base.ts", line: 1, startLine: 1, endLine: 3, name: q, kind: "function", signature: \`export function \${q}(): string\` },
                          definitions,
                          results: definitions,
                          freshness: "fresh",
                          lastIndexed: "2026-08-26T02:59:43.233Z",
                          filesChanged: [],
                          reindexingInProgress: false,
                        }
                      : {
                          error: \`Symbol \${q} not found in the index.\`,
                        },
                  ),
                },
              ],
              isError: false,
            },
          });
        } else {
          const results = hasMainIndex
            ? [{ file: "src/base.ts", line: 1, score: 0.95, snippet: \`export function \${q}() {}\`, symbol: q }]
            : [];
          send({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    results,
                    totalMatches: results.length,
                    freshness: hasMainIndex ? "fresh" : "stale",
                    lastIndexed: hasMainIndex ? "2026-08-26T02:59:43.233Z" : null,
                    filesChanged: [],
                    reindexingInProgress: false,
                  }),
                },
              ],
              isError: false,
            },
          });
        }
      }
    } else {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not found" } });
    }
  }
});
`;

function catalogPatchStatement(mode: DescriptorMode): string {
  if (mode === "untouched") return "";
  if (mode === "none") {
    return `\ndelete (CATALOG.codegraph as Record<string, unknown>).index;\ndelete (CATALOG.graphify as Record<string, unknown>).index;\n`;
  }
  if (mode === "engine-managed") {
    return `\n(CATALOG.mnemex as Record<string, unknown>).index = { worktrees: "engine-managed", path: ".mnemex/index.db" };\n`;
  }
  const indexedFilesBody =
    mode === "copy-no-indexed-set"
      ? `return undefined;`
      : `const db = source.sqlite(".codegraph/codegraph.db");
      if (!db) return undefined;
      try {
        const rows = db.query("SELECT path FROM indexed_files");
        const out = new Set<string>();
        for (const r of rows) {
          if (typeof r[0] === "string") out.add(r[0]);
        }
        return out;
      } catch {
        return undefined;
      }`;

  return `
;(CATALOG.codegraph as Record<string, unknown>).index = {
  worktrees: "copy",
  path: ".codegraph/codegraph.db",
  owned: [".codegraph"],
  paths: "relative",
  incremental: true,
  copy: {
    store: "sqlite",
    include: [".codegraph/codegraph.db"],
    inspect(source: { sqlite(rel: string): { query(sql: string): readonly (readonly unknown[])[] } | undefined }) {
      const db = source.sqlite(".codegraph/codegraph.db");
      if (!db) return { complete: false };
      try {
        const rows = db.query("SELECT key, value FROM project_metadata");
        const map = new Map<string, string>();
        for (const r of rows) {
          if (typeof r[0] === "string" && typeof r[1] === "string") map.set(r[0], r[1]);
        }
        if (map.get("complete") !== "1") return { complete: false };
        const commit = map.get("git_head");
        const dirtyRaw = map.get("dirty_paths");
        if (!commit || dirtyRaw === undefined) return { complete: false };
        return { complete: true, commit, dirtyPaths: JSON.parse(dirtyRaw) as string[] };
      } catch {
        return { complete: false };
      }
    },
    updateRefreshesModified: true,
    isIndexable(rel: string, sizeBytes: number | undefined) {
      if (sizeBytes !== undefined && sizeBytes > 1024 * 1024) return false;
      return /\\.(?:ts|tsx|js|jsx|py|go|rs)$/u.test(rel);
    },
    indexedFiles(source: { sqlite(rel: string): { query(sql: string): readonly (readonly unknown[])[] } | undefined }) {
      ${indexedFilesBody}
    },
    update: ["codegraph", "sync"],
  },
};
`;
}

export function createScenario(opts?: {
  descriptorMode?: DescriptorMode;
  createWorktree?: boolean;
}): WorktreeScenario {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cs-wt-int-")));
  activeScratch.push(root);

  const pluginDir = join(root, "plugin");
  const home = join(root, "home");
  const cacheDir = join(root, "cache");
  const binDir = join(root, "bin");
  const engineLogFile = join(root, "engine.log");
  const mainDir = join(root, "main");
  const wtDir = join(root, "wt");

  mkdirSync(pluginDir, { recursive: true });
  for (const sub of ["hooks", "mcp", "scripts", "assets", "skills", ".claude-plugin"]) {
    if (existsSync(join(SOURCE_PLUGIN_ROOT, sub))) {
      cpSync(join(SOURCE_PLUGIN_ROOT, sub), join(pluginDir, sub), { recursive: true });
    }
  }

  const patch = catalogPatchStatement(opts?.descriptorMode ?? "copy");
  if (patch) {
    const catalogPath = join(pluginDir, "mcp", "adapters", "catalog.ts");
    writeFileSync(catalogPath, `${readFileSync(catalogPath, "utf8")}\n${patch}`, "utf8");
  }

  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), "{}");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const cgBin = join(binDir, "codegraph");
  writeFileSync(cgBin, FAKE_CODEGRAPH_SCRIPT, { mode: 0o755 });
  chmodSync(cgBin, 0o755);

  const mnBin = join(binDir, "mnemex");
  writeFileSync(mnBin, FAKE_MNEMEX_SCRIPT, { mode: 0o755 });
  chmodSync(mnBin, 0o755);

  const grBin = join(binDir, "graphify-mcp");
  writeFileSync(grBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(grBin, 0o755);

  mkdirSync(join(mainDir, "src"), { recursive: true });
  mkdirSync(join(mainDir, ".claude"), { recursive: true });
  writeFileSync(join(mainDir, ".gitignore"), ".claude/settings.local.json\n.codegraph/\n.mnemex/\ngraphify-out/\n");
  writeFileSync(
    join(mainDir, "src", "base.ts"),
    "export function baseSymbol(): string {\n  return 'base';\n}\n",
  );
  writeFileSync(
    join(mainDir, "src", "removable.ts"),
    "export function removableSymbol(): string {\n  return 'removable';\n}\n",
  );

  git(mainDir, ["init", "-b", "main"]);
  git(mainDir, ["add", "."]);
  git(mainDir, ["commit", "-m", "initial commit"]);

  if (opts?.createWorktree !== false) {
    git(mainDir, ["worktree", "add", "-b", "feat-wt", wtDir]);
  }

  const env: Record<string, string> = {
    PATH: `${binDir}:${BUN_DIR}:/usr/bin:/bin`,
    HOME: home,
    XDG_CACHE_HOME: cacheDir,
    TMPDIR: root,
    CLAUDE_PLUGIN_ROOT: pluginDir,
    CLAUDE_PROJECT_DIR: wtDir,
    FAKE_ENGINE_LOG: engineLogFile,
    FAKE_MAIN_DIR: mainDir,
    DO_NOT_TRACK: "1",
  };

  return {
    root,
    pluginDir,
    home,
    cacheDir,
    binDir,
    engineLogFile,
    mainDir,
    wtDir,
    env,
  };
}

export function configureMainLocal(
  s: WorktreeScenario,
  engineId: string | false,
  setup: "active" | "dismissed" = "active",
  targetDir = s.mainDir,
): void {
  mkdirSync(join(targetDir, ".claude"), { recursive: true });
  const engines: Record<string, unknown> = {};
  if (typeof engineId === "string") {
    if (engineId === "codegraph") {
      engines["codegraph"] = {
        command: "codegraph",
        args: ["serve", "--mcp"],
        env: {
          CODEGRAPH_MCP_TOOLS: "explore,node,search,callers,callees,impact,files,status",
          DO_NOT_TRACK: "1",
        },
      };
    } else if (engineId === "mnemex") {
      engines["mnemex"] = { command: "mnemex", args: ["--mcp"] };
    } else if (engineId === "graphify") {
      engines["graphify"] = { command: "graphify-mcp", args: ["graphify-out/graph.json"] };
    } else {
      engines[engineId] = { command: engineId, args: [] };
    }
  }
  writeFileSync(
    join(targetDir, ".claude", "settings.local.json"),
    JSON.stringify({ "code-search": { engine: engineId, engines, setup } }, null, 2),
  );
}

export function buildMainCodegraphIndex(s: WorktreeScenario, projectDir = s.mainDir): void {
  const res = spawnSync(join(s.binDir, "codegraph"), ["init"], {
    cwd: projectDir,
    env: { ...process.env, ...s.env },
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`fake codegraph init failed: ${res.stderr}`);
  }
}

export function readEngineLogs(s: WorktreeScenario): {
  cwd: string;
  argv: string[];
  action: string;
  isMain?: boolean;
  files: string[];
  head?: string;
}[] {
  if (!existsSync(s.engineLogFile)) return [];
  return readFileSync(s.engineLogFile, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

export function clearEngineLogs(s: WorktreeScenario): void {
  rmSync(s.engineLogFile, { force: true });
}

interface HookEntry {
  matcher?: string;
  hooks: { command: string }[];
}

export interface HookRunResult {
  ran: boolean;
  rc: number | null;
  stdout: string;
  stderr: string;
  systemMessage?: string;
  additionalContext?: string;
}

export function runNamedHook(
  s: WorktreeScenario,
  scriptName: string,
  opts?: { projectDir?: string; extraEnv?: Record<string, string | undefined>; source?: string },
): HookRunResult {
  const hooksPath = join(s.pluginDir, "hooks", "hooks.json");
  const hooksDoc = JSON.parse(readFileSync(hooksPath, "utf8")) as {
    hooks: Record<string, HookEntry[]>;
  };
  const found = (hooksDoc.hooks["SessionStart"] ?? [])
    .flatMap((e) => e.hooks)
    .find((h) => h.command.includes(scriptName));
  if (!found) {
    // Baseline without worktree-start.ts in hooks.json: observed "no hook, no output".
    return { ran: false, rc: 0, stdout: "", stderr: "" };
  }
  const projectDir = opts?.projectDir ?? s.wtDir;
  const env: Record<string, string> = { ...s.env, CLAUDE_PROJECT_DIR: projectDir };
  for (const [k, v] of Object.entries(opts?.extraEnv ?? {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const r = spawnSync("/bin/sh", ["-c", found.command], {
    cwd: projectDir,
    env,
    input: JSON.stringify({
      session_id: "sess-1",
      cwd: projectDir,
      hook_event_name: "SessionStart",
      source: opts?.source ?? "startup",
    }),
    encoding: "utf8",
  });
  let systemMessage: string | undefined;
  let additionalContext: string | undefined;
  const trimmed = (r.stdout ?? "").trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        systemMessage?: string;
        additionalContext?: string;
        hookSpecificOutput?: { additionalContext?: string };
      };
      systemMessage = parsed.systemMessage;
      additionalContext =
        parsed.hookSpecificOutput?.additionalContext ?? parsed.additionalContext;
    } catch {
      // leave undefined
    }
  }
  return {
    ran: true,
    rc: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    systemMessage,
    additionalContext,
  };
}

export function runSessionStart(
  s: WorktreeScenario,
  opts?: { projectDir?: string; extraEnv?: Record<string, string | undefined> },
): {
  worktreeStart: HookRunResult;
  offerSetup: HookRunResult;
  combinedSystemMessage: string;
  combinedContext: string;
} {
  const worktreeStart = runNamedHook(s, "worktree-start.ts", opts);
  const offerSetup = runNamedHook(s, "offer-setup.ts", opts);
  const combinedSystemMessage = [worktreeStart.systemMessage, offerSetup.systemMessage]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join("\n");
  const combinedContext = [worktreeStart.additionalContext, offerSetup.additionalContext]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join("\n");
  return { worktreeStart, offerSetup, combinedSystemMessage, combinedContext };
}

export function runSetupStatus(
  s: WorktreeScenario,
  projectDir = s.wtDir,
): { headline: string; codes: string[]; messages: string[]; raw: Record<string, unknown> } {
  const cliPath = join(s.pluginDir, "scripts", "setup.ts");
  const r = spawnSync(
    process.execPath,
    ["--env-file=/dev/null", "--config=/dev/null", cliPath, "status", "--json", "--project", projectDir],
    {
      cwd: projectDir,
      env: { ...s.env, CLAUDE_PROJECT_DIR: projectDir },
      encoding: "utf8",
    },
  );
  if (r.status !== 0) {
    throw new Error(`setup status exited ${String(r.status)}: ${r.stderr} ${r.stdout}`);
  }
  const parsed = JSON.parse(r.stdout) as {
    data?: {
      report?: {
        headline?: string;
        state?: { headline?: string; findings?: { code: string; message: string }[] };
        findings?: { code: string; message: string }[];
      };
    };
  };
  const report = parsed.data?.report ?? {};
  const state = report.state ?? report;
  const findings = state.findings ?? report.findings ?? [];
  return {
    headline: state.headline ?? report.headline ?? "",
    codes: findings.map((f) => f.code),
    messages: findings.map((f) => f.message),
    raw: parsed as unknown as Record<string, unknown>,
  };
}

export function resolveStateMeta(
  s: WorktreeScenario,
  projectDir = s.wtDir,
): { statePath: string; incarnation: string; lockPath: string } {
  const wtModule = join(s.pluginDir, "mcp", "core", "worktree.ts");
  const lockPath = join(
    s.cacheDir,
    "magus",
    "code-search",
    "locks",
    `${fnv1a64Hex(realpathSync(s.mainDir))}.lock`,
  );
  if (existsSync(wtModule)) {
    const probeScript = `
      import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
      import { resolveWorktree, worktreeStatePath } from ${JSON.stringify(wtModule)};
      const read = {
        readText(p) { try { return readFileSync(p, "utf8"); } catch { return undefined; } },
        kind(p) { try { const st = statSync(p); return st.isFile() ? "file" : st.isDirectory() ? "directory" : "other"; } catch { return "missing"; } },
        realpath(p) { try { return realpathSync(p); } catch { return undefined; } },
        mtimeMs(p) { try { return lstatSync(p).mtimeMs; } catch { return undefined; } },
      };
      const layout = resolveWorktree(${JSON.stringify(projectDir)}, read);
      const statePath = worktreeStatePath(${JSON.stringify(s.env)}, ${JSON.stringify(s.home)}, ${JSON.stringify(projectDir)});
      process.stdout.write(JSON.stringify({ statePath, incarnation: layout.kind === "linked" ? layout.incarnation : "inc-fallback" }));
    `;
    const r = spawnSync(process.execPath, ["--env-file=/dev/null", "--config=/dev/null", "-e", probeScript], {
      cwd: s.pluginDir,
      env: s.env,
      encoding: "utf8",
    });
    if (r.status === 0 && r.stdout.trim().startsWith("{")) {
      const data = JSON.parse(r.stdout.trim()) as { statePath: string; incarnation: string };
      return { ...data, lockPath };
    }
  }
  return {
    statePath: join(
      s.cacheDir,
      "magus",
      "code-search",
      "worktrees",
      `${fnv1a64Hex(realpathSync(projectDir))}.json`,
    ),
    incarnation: "inc-fallback",
    lockPath,
  };
}

export async function callMcpCodeSearch(
  s: WorktreeScenario,
  query: string,
  projectDir = s.wtDir,
): Promise<{ text: string; isError: boolean }> {
  const serverPath = join(s.pluginDir, "mcp", "server.ts");
  const child = spawn(
    process.execPath,
    ["--env-file=/dev/null", "--config=/dev/null", serverPath],
    {
      cwd: projectDir,
      env: { ...s.env, CLAUDE_PROJECT_DIR: projectDir },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  activeChildren.push(child);

  let buf = "";
  const pending = new Map<number, (msg: Record<string, unknown>) => void>();
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as Record<string, unknown>;
      if (typeof msg["id"] === "number") {
        pending.get(msg["id"])?.(msg);
        pending.delete(msg["id"]);
      }
    }
  });

  const rpc = (id: number, method: string, params?: unknown) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 20_000);
      pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`,
      );
    });

  await rpc(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "wt-integration-qa", version: "1.0.0" },
  });
  child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const reply = await rpc(2, "tools/call", {
    name: "code_search",
    arguments: { query },
  });
  const result = reply["result"] as
    | { content?: { type: string; text: string }[]; isError?: boolean }
    | undefined;
  const text = (result?.content ?? []).map((c) => c.text).join("");
  const isError = result?.isError === true;

  child.stdin?.end();
  child.kill("SIGTERM");
  return { text, isError };
}

export function snapshotTree(
  dir: string,
  opts?: { ignoreSidecars?: boolean; ignoreOwned?: readonly string[] },
): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(curr: string): void {
    for (const entry of readdirSync(curr, { withFileTypes: true })) {
      const full = join(curr, entry.name);
      const rel = relative(dir, full).replace(/\\/gu, "/");
      if (rel === ".git" || rel.startsWith(".git/worktrees/")) continue;
      if (opts?.ignoreSidecars && (rel.endsWith("-wal") || rel.endsWith("-shm"))) continue;
      if (
        opts?.ignoreOwned?.some((o) => {
          const clean = o.replace(/\/+$/u, "");
          return rel === clean || rel.startsWith(`${clean}/`);
        })
      ) {
        continue;
      }
      const st = lstatSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        out[rel] = readFileSync(full).toString("hex");
      }
    }
  }
  walk(dir);
  return out;
}
