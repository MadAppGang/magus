/**
 * Black box tests for magus-version-check.ts, the dev plugin's SessionStart hook that
 * reports an installed magus CLI which is behind the registry's `magus-cli` latest.
 *
 * Written from the spec's "Behaviour contract" only; the hook source was not read.
 * Every scenario spawns the hook exactly as hooks.json does
 * (`bun --env-file=/dev/null --config=/dev/null <script>`) with a REPLACED environment:
 *   PATH                 temp dirs holding fake executables, nothing else
 *   HOME, XDG_CACHE_HOME temp dirs (XDG_CACHE_HOME deliberately absent in one case)
 *   npm_config_registry  a Bun.serve on 127.0.0.1 that counts and records requests
 * Otherwise the hook runs with the environment Claude Code gives it, so bun's own
 * writes count towards "no writes outside the cache file" exactly as in production.
 *
 * The hook is spawned with Bun.spawn (async), never spawnSync: a synchronous spawn would
 * block this process's event loop and the in-process fake registry could never answer.
 * stdout/stderr go to files rather than pipes, so a grandchild that outlives the hook
 * cannot hold a pipe open and distort the timing measurements.
 *
 * Assumptions (also recorded in the session test plan):
 *   A2  the "`magus upgrade` is not enough" wording is not pinned; any sentence naming
 *       `magus upgrade` together with a negation is accepted.
 *   A3  the contract names the cache file but not its content, so cache AGE is simulated
 *       by the file's mtime only. No internal field name is guessed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

const HOOK = join(import.meta.dir, "magus-version-check.ts");
const HOOKS_JSON = join(import.meta.dir, "hooks.json");
const REGISTERED_COMMAND =
  "bun --env-file=/dev/null --config=/dev/null ${CLAUDE_PLUGIN_ROOT}/hooks/magus-version-check.ts";
/** The same flags hooks.json uses, in the same order. */
const BUN_FLAGS = ["--env-file=/dev/null", "--config=/dev/null"];

type Manager = "bun" | "pnpm" | "npm";
const COMMANDS: Record<Manager, string> = {
  bun: "bun add -g magus-cli@latest",
  pnpm: "pnpm add -g magus-cli@latest",
  npm: "npm install -g magus-cli@latest",
};

// The bare-name forms the output must never contain, assembled from parts so this file
// never contains them literally.
const BARE_AT = ["magus", "latest"].join("@");
const BARE_G = "-g " + "magus" + " ";

const LATEST_PATH = "/magus-cli/latest";
const CACHE_REL = join("magus-dev", "magus-version-check.json");

const BUDGET_MS = 3000; // "finishes within 3 seconds"
const PER_CALL_MS = 1500; // "each external call gets its own timeout of 1.5 s or less"
const PER_CALL_TOLERANCE_MS = 400;
const HOUR_S = 3600;

const SPAWN_GUARD_MS = 15_000; // hard kill for a hook that never exits
const T = 30_000; // per-test timeout

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) {
    try {
      cleanups.pop()!();
    } catch {
      // best effort
    }
  }
});

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

interface Sandbox {
  /** Removed after the test. */
  base: string;
  /** Everything the hook may see. Snapshotted by the write check. */
  root: string;
  /** argv logs and captured stdout/stderr — outside root on purpose. */
  logs: string;
  home: string;
  /** XDG_CACHE_HOME (pre-created, empty). */
  cache: string;
  /** cwd of the hook. */
  project: string;
  /** An empty PATH dir. */
  empty: string;
}

let seq = 0;

function sandbox(): Sandbox {
  const base = mkdtempSync(join(tmpdir(), "mvc-"));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  for (const marker of ["/.bun/", "bun/bin", "/install/global/node_modules/", "/pnpm/"]) {
    if (base.includes(marker)) {
      throw new Error(`test setup invalid: temp dir ${base} already contains ${marker}`);
    }
  }
  const root = join(base, "sandbox");
  const sb: Sandbox = {
    base,
    root,
    logs: join(base, "logs"),
    home: join(root, "home"),
    cache: join(root, "xdg-cache"),
    project: join(root, "project"),
    empty: join(root, "empty-bin"),
  };
  for (const d of [sb.logs, sb.home, sb.cache, sb.project, sb.empty]) {
    mkdirSync(d, { recursive: true });
  }
  return sb;
}

function writeExe(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/** A `magus` that logs its argv (one line per call) and prints `output`. */
function magusScript(log: string, output: string): string {
  return `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nprintf '%s\\n' '${output}'\n`;
}

/** A `magus` that logs its argv and then hangs for 10 s as a single process. */
function hangingMagusScript(log: string): string {
  return `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec /bin/sleep 10\n`;
}

interface Fake {
  /** The directory to put on PATH. */
  dir: string;
  /** The argv log of this fake magus. */
  log: string;
}

/** A plain executable `magus` in `<root>/<rel>` (default path has no `bun` in it). */
function plainMagus(sb: Sandbox, output: string, rel = "opt/tools/bin"): Fake {
  const dir = join(sb.root, rel);
  const log = join(sb.logs, `magus-${++seq}.log`);
  writeExe(join(dir, "magus"), magusScript(log, output));
  return { dir, log };
}

function hangingMagus(sb: Sandbox, rel = "opt/slow/bin"): Fake {
  const dir = join(sb.root, rel);
  const log = join(sb.logs, `magus-${++seq}.log`);
  writeExe(join(dir, "magus"), hangingMagusScript(log));
  return { dir, log };
}

/**
 * A package-manager layout: `<pkgDir>/package.json` + `<pkgDir>/bin/magus.js`, with a
 * `magus` symlink in `linkDir` pointing at bin/magus.js. `binOutput` is what the
 * executable prints for `--version`.
 */
function packageLayout(
  sb: Sandbox,
  opts: { pkgDir: string; linkDir: string; pkg: Record<string, unknown>; binOutput: string },
): Fake {
  const pkgDir = join(sb.root, opts.pkgDir);
  const linkDir = join(sb.root, opts.linkDir);
  const log = join(sb.logs, `magus-${++seq}.log`);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(opts.pkg, null, 2));
  const bin = join(pkgDir, "bin", "magus.js");
  writeExe(bin, magusScript(log, opts.binOutput));
  mkdirSync(linkDir, { recursive: true });
  symlinkSync(bin, join(linkDir, "magus"));
  return { dir: linkDir, log };
}

/**
 * bun global install. The symlink sits in `<root>/links` — a dir with no `bun` in its
 * name — so only the REAL path carries `/.bun/`. The executable prints a decoy version.
 */
function bunLayout(sb: Sandbox, version: string, decoy = "magus v9.9.9"): Fake {
  return packageLayout(sb, {
    pkgDir: "home/.bun/install/global/node_modules/magus-cli",
    linkDir: "links",
    pkg: { name: "magus-cli", version, bin: { magus: "bin/magus.js" } },
    binOutput: decoy,
  });
}

/** npm global install (`<prefix>/lib/node_modules/<name>`, link in `<prefix>/bin`). */
function npmLayout(
  sb: Sandbox,
  opts: { name?: string; version: string; binOutput?: string; linkDir?: string },
): Fake {
  const name = opts.name ?? "magus-cli";
  return packageLayout(sb, {
    pkgDir: `npm-global/lib/node_modules/${name}`,
    linkDir: opts.linkDir ?? "npm-global/bin",
    pkg: { name, version: opts.version, bin: { magus: "bin/magus.js" } },
    binOutput: opts.binOutput ?? "magus v9.9.9",
  });
}

/**
 * Bun global install under a custom BUN_INSTALL (`<root>/bunhome`). Neither `/.bun/` nor
 * `bun/bin` occurs in the real path (`bunhome/bin` is not `bun/bin`), so only
 * `/install/global/node_modules/` can identify it as bun-owned.
 */
function customBunInstallLayout(sb: Sandbox, version: string, decoy = "magus v9.9.9"): Fake {
  return packageLayout(sb, {
    pkgDir: "bunhome/install/global/node_modules/magus-cli",
    linkDir: "bunhome/bin",
    pkg: { name: "magus-cli", version, bin: { magus: "bin/magus.js" } },
    binOutput: decoy,
  });
}

/**
 * pnpm global install: `<PNPM_HOME>/global/5/node_modules/magus-cli` is itself a symlink
 * into the virtual store `.pnpm/magus-cli@<v>/node_modules/magus-cli`, and the PATH entry
 * links through node_modules. The link dir has no `pnpm` in its name.
 */
function pnpmLayout(sb: Sandbox, version: string, decoy = "magus v9.9.9"): Fake {
  const store = `Library/pnpm/global/5/.pnpm/magus-cli@${version}/node_modules/magus-cli`;
  const fake = packageLayout(sb, {
    pkgDir: store,
    linkDir: "links-pm",
    pkg: { name: "magus-cli", version, bin: { magus: "bin/magus.js" } },
    binOutput: decoy,
  });
  const nodeModules = join(sb.root, "Library/pnpm/global/5/node_modules");
  mkdirSync(nodeModules, { recursive: true });
  symlinkSync(join(sb.root, store), join(nodeModules, "magus-cli"));
  rmSync(join(fake.dir, "magus"));
  symlinkSync(join(nodeModules, "magus-cli", "bin", "magus.js"), join(fake.dir, "magus"));
  return fake;
}

/**
 * A `magus` that is itself a bun script (absolute bun shebang), so running
 * `magus --version` starts a second bun process in whatever cwd the hook gives it.
 */
function bunScriptMagus(sb: Sandbox, output: string, rel = "opt/jsmagus/bin"): Fake {
  const dir = join(sb.root, rel);
  const log = join(sb.logs, `magus-${++seq}.log`);
  writeExe(
    join(dir, "magus"),
    `#!${process.execPath}\n` +
      `require("node:fs").appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");\n` +
      `console.log(${JSON.stringify(output)});\n`,
  );
  return { dir, log };
}

type Preload = "throws" | "prints" | "missing" | "sleeps";

/**
 * Writes `<project>/bunfig.toml` with a top-level `preload`. Every preload except
 * `missing` first appends to a marker log outside the sandbox, so a preload that ran is
 * visible even when it changed nothing else. Returns the marker path.
 */
function writeBunfig(sb: Sandbox, kind: Preload): string {
  const marker = join(sb.logs, `preload-${++seq}.log`);
  if (kind === "missing") {
    writeFileSync(join(sb.project, "bunfig.toml"), 'preload = ["./does-not-exist.ts"]\n');
    return marker;
  }
  const effect: Record<Exclude<Preload, "missing">, string> = {
    throws: 'throw new Error("bunfig preload ran");',
    prints: 'console.log("PRELOAD RAN");',
    sleeps: "Bun.sleepSync(4000);",
  };
  writeFileSync(join(sb.project, "bunfig.toml"), 'preload = ["./p.ts"]\n');
  writeFileSync(
    join(sb.project, "p.ts"),
    `import { appendFileSync } from "node:fs";\n` +
      `appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${kind}\n`)});\n` +
      `${effect[kind]}\n`,
  );
  return marker;
}

function logLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Fake registry
// ---------------------------------------------------------------------------

type Mode =
  | { kind: "ok"; version: unknown }
  | { kind: "status"; code: number }
  | { kind: "raw"; body: string }
  | { kind: "hang" };

interface Registry {
  /** Base URL, no trailing slash. */
  url: string;
  mode: Mode;
  /** Path of every request received, in order. */
  paths: string[];
  readonly count: number;
}

const JSON_HEADERS = { "content-type": "application/json" };

function registry(initial: Mode, prefix = ""): Registry {
  const state: { mode: Mode; paths: string[] } = { mode: initial, paths: [] };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      state.paths.push(path);
      const m = state.mode;
      if (m.kind === "hang") return new Promise<Response>(() => {});
      if (path !== `${prefix}${LATEST_PATH}`) {
        return new Response('{"error":"Not found"}', { status: 404, headers: JSON_HEADERS });
      }
      if (m.kind === "status") return new Response("{}", { status: m.code, headers: JSON_HEADERS });
      if (m.kind === "raw") return new Response(m.body, { status: 200, headers: JSON_HEADERS });
      return new Response(JSON.stringify({ name: "magus-cli", version: m.version }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    },
  });
  cleanups.push(() => server.stop(true));
  return {
    url: `http://127.0.0.1:${server.port}`,
    get mode() {
      return state.mode;
    },
    set mode(m: Mode) {
      state.mode = m;
    },
    paths: state.paths,
    get count() {
      return state.paths.length;
    },
  };
}

/** A URL on 127.0.0.1 where nothing listens. */
function closedRegistryUrl(): string {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const url = `http://127.0.0.1:${s.port}`;
  s.stop(true);
  return url;
}

const ok = (version: unknown): Mode => ({ kind: "ok", version });

// ---------------------------------------------------------------------------
// Running the hook
// ---------------------------------------------------------------------------

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

interface RunOpts {
  path: string[];
  registry: string;
  /** undefined → sb.cache; null → XDG_CACHE_HOME absent; string → that value. */
  xdg?: string | null;
  stdin?: string;
}

function sessionStartPayload(sb: Sandbox): string {
  return JSON.stringify({
    session_id: "mvc-test-session",
    transcript_path: join(sb.project, "transcript.jsonl"),
    cwd: sb.project,
    hook_event_name: "SessionStart",
    source: "startup",
  });
}

async function runHook(sb: Sandbox, opts: RunOpts): Promise<Run> {
  const env: Record<string, string> = {
    PATH: opts.path.join(":"),
    HOME: sb.home,
    npm_config_registry: opts.registry,
  };
  if (opts.xdg !== null) env.XDG_CACHE_HOME = opts.xdg ?? sb.cache;

  const id = ++seq;
  const outPath = join(sb.logs, `run-${id}.stdout`);
  const errPath = join(sb.logs, `run-${id}.stderr`);
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");
  const t0 = performance.now();
  const proc = Bun.spawn({
    cmd: [process.execPath, ...BUN_FLAGS, HOOK],
    cwd: sb.project,
    env,
    stdin: new TextEncoder().encode(opts.stdin ?? sessionStartPayload(sb)),
    stdout: outFd,
    stderr: errFd,
  });
  const guard = setTimeout(() => proc.kill("SIGKILL"), SPAWN_GUARD_MS);
  const code = await proc.exited;
  const ms = performance.now() - t0;
  clearTimeout(guard);
  closeSync(outFd);
  closeSync(errFd);
  return {
    code,
    stdout: readFileSync(outPath, "utf8"),
    stderr: readFileSync(errPath, "utf8"),
    ms,
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function expectSilent(r: Run): void {
  expect(r.code).toBe(0);
  expect(r.stdout).toBe("");
  expect(r.stderr).toBe("");
}

/** `v` appears as a whole version: not a prefix of 7.3.10, not a suffix of 17.3.1. */
function hasVersion(msg: string, v: string): boolean {
  return new RegExp(`(?<![\\d.])${v.replace(/\./g, "\\.")}(?!\\.?\\d)`).test(msg);
}

const NEGATION =
  /\bnot\b|n['’]t\b|\bcannot\b|\bnever\b|\bno longer\b|\binsufficient\b|\bwithout\b/i;

/** A2: some sentence names `magus upgrade` and negates it. Version dots do not split. */
function saysUpgradeIsNotEnough(msg: string): boolean {
  return msg
    .split(/[.!?](?=\s|$)|\n/)
    .some((sentence) => sentence.includes("magus upgrade") && NEGATION.test(sentence));
}

function expectNoBareName(stdout: string): void {
  expect(stdout.includes(BARE_AT)).toBe(false);
  expect(stdout.includes(BARE_G)).toBe(false);
}

interface StaleWant {
  installed: string;
  latest: string;
  via: Manager;
}

interface StaleOutput {
  systemMessage: string;
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

function expectStale(r: Run, want: StaleWant): StaleOutput {
  expect(r.code).toBe(0);
  expect(r.stderr).toBe("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout.trim());
  } catch {
    throw new Error(`stdout is not exactly one JSON value:\n---\n${r.stdout}\n---`);
  }
  expect(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)).toBe(true);
  const obj = parsed as StaleOutput;
  expect(typeof obj.systemMessage).toBe("string");
  expect(obj.hookSpecificOutput?.hookEventName).toBe("SessionStart");
  expect(typeof obj.hookSpecificOutput?.additionalContext).toBe("string");

  const cmd = COMMANDS[want.via];
  const others = (Object.keys(COMMANDS) as Manager[])
    .filter((m) => m !== want.via)
    .map((m) => COMMANDS[m]);
  const fields: Array<[string, string]> = [
    ["systemMessage", obj.systemMessage],
    ["additionalContext", obj.hookSpecificOutput.additionalContext],
  ];
  for (const [field, msg] of fields) {
    const where = `${field}: ${JSON.stringify(msg)}`;
    if (!hasVersion(msg, want.installed)) throw new Error(`installed ${want.installed} missing — ${where}`);
    if (!hasVersion(msg, want.latest)) throw new Error(`latest ${want.latest} missing — ${where}`);
    if (!msg.includes(cmd)) throw new Error(`command "${cmd}" missing — ${where}`);
    for (const other of others) {
      if (msg.includes(other)) throw new Error(`wrong command "${other}" present — ${where}`);
    }
    if (!saysUpgradeIsNotEnough(msg)) {
      throw new Error(`no statement that \`magus upgrade\` is not enough — ${where}`);
    }
  }
  expectNoBareName(r.stdout);
  return obj;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("magus-version-check: registration", () => {
  test("TEST-00: the hook script exists", () => {
    expect(existsSync(HOOK)).toBe(true);
  });

  test("TEST-01: hooks.json registers it under SessionStart with matcher startup", () => {
    const cfg = JSON.parse(readFileSync(HOOKS_JSON, "utf8")) as {
      hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string }> }>>;
    };
    const commands = (cfg.hooks?.SessionStart ?? [])
      .filter((g) => g.matcher === "startup")
      .flatMap((g) => g.hooks ?? [])
      .filter((h) => h.type === "command")
      .map((h) => h.command);
    expect(commands).toContain(REGISTERED_COMMAND);
  });
});

describe("magus-version-check: stale output", () => {
  test("TEST-02: stale via `magus --version` in a plain dir → npm command, one JSON object", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    const r = await runHook(sb, { path: [sb.empty, m.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
    expect(reg.count).toBeGreaterThanOrEqual(1);
    expect([...new Set(reg.paths)]).toEqual([LATEST_PATH]);
  }, T);

  test("TEST-03: bun global layout → package.json version wins over --version, bun command", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = bunLayout(sb, "7.2.0");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.2.0", latest: "7.3.1", via: "bun" });
    expect(r.stdout).not.toContain("9.9.9");
  }, T);

  test("TEST-04: npm global layout → package.json version wins, npm command", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = npmLayout(sb, { version: "7.0.0" });
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.0.0", latest: "7.3.1", via: "npm" });
    expect(r.stdout).not.toContain("9.9.9");
  }, T);

  test("TEST-05: a package.json not named magus-cli is ignored → falls back to --version", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = npmLayout(sb, { name: "magus", version: "9.9.9", binOutput: "magus v7.1.0" });
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
  }, T);

  test("TEST-06: a real path containing bun/bin (no /.bun/) → bun command", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0", "opt/bun/bin");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "bun" });
  }, T);

  test("TEST-07: the REAL path decides the command, not the link's own location", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    // The link sits in a `.bun/bin` dir but resolves into an npm layout.
    const m = npmLayout(sb, { version: "7.0.0", linkDir: "home/.bun/bin" });
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.0.0", latest: "7.3.1", via: "npm" });
  }, T);

  test("TEST-08: the FIRST X.Y.Z in --version output is the installed version", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    // The last match (99.0.0) would read as ahead and produce silence.
    const m = plainMagus(sb, "magus v7.1.0 (runtime 99.0.0)");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
  }, T);

  test("TEST-09: the first magus on PATH is the one checked", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const first = plainMagus(sb, "magus v7.1.0", "first/bin");
    const second = plainMagus(sb, "magus v9.9.9", "second/bin");
    const r = await runHook(sb, { path: [first.dir, second.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
  }, T);

  test("TEST-10: garbage on stdin does not change the result (inputs come from the environment)", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url, stdin: "{not json" });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
  }, T);
});

describe("magus-version-check: semver comparison", () => {
  const STALE: Array<[string, string, string]> = [
    ["TEST-11", "7.9.0", "7.10.0"],
    ["TEST-12", "7.3.1", "7.3.10"],
    ["TEST-13", "6.99.99", "7.0.0"],
  ];
  for (const [id, installed, latest] of STALE) {
    test(`${id}: installed ${installed} < latest ${latest} → stale`, async () => {
      const sb = sandbox();
      const reg = registry(ok(latest));
      const m = plainMagus(sb, `magus v${installed}`);
      const r = await runHook(sb, { path: [m.dir], registry: reg.url });
      expectStale(r, { installed, latest, via: "npm" });
    }, T);
  }

  const SILENT: Array<[string, string, string, string]> = [
    ["TEST-14", "7.3.1", "7.3.1", "up to date"],
    ["TEST-15", "7.4.0", "7.3.1", "ahead"],
    ["TEST-16", "7.10.0", "7.9.0", "ahead, numeric not lexicographic"],
    ["TEST-17", "10.0.0", "9.99.99", "ahead by major"],
  ];
  for (const [id, installed, latest, why] of SILENT) {
    test(`${id}: installed ${installed} vs latest ${latest} (${why}) → silent`, async () => {
      const sb = sandbox();
      const reg = registry(ok(latest));
      const m = plainMagus(sb, `magus v${installed}`);
      const r = await runHook(sb, { path: [m.dir], registry: reg.url });
      expectSilent(r);
    }, T);
  }
});

describe("magus-version-check: silent paths", () => {
  test("TEST-18: no magus on PATH → silent, exit 0", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const r = await runHook(sb, { path: [sb.empty], registry: reg.url });
    expectSilent(r);
  }, T);

  test("TEST-19: magus on PATH is a dangling symlink → silent, exit 0", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const dir = join(sb.root, "broken/bin");
    mkdirSync(dir, { recursive: true });
    symlinkSync(join(sb.root, "nowhere", "magus.js"), join(dir, "magus"));
    const r = await runHook(sb, { path: [dir], registry: reg.url });
    expectSilent(r);
  }, T);

  test("TEST-20: registry unreachable → silent, exit 0", async () => {
    const sb = sandbox();
    const m = plainMagus(sb, "magus v7.1.0");
    const r = await runHook(sb, { path: [m.dir], registry: closedRegistryUrl() });
    expectSilent(r);
  }, T);

  const REGISTRY_FAILURES: Array<[string, string, Mode]> = [
    ["TEST-21", "HTTP 500", { kind: "status", code: 500 }],
    // Truncated: still contains a version string, so scraping instead of parsing shows up.
    ["TEST-22", "invalid JSON", { kind: "raw", body: '{"name":"magus-cli","version":"7.3.1"' }],
    ["TEST-23", "JSON without a version field", { kind: "raw", body: '{"name":"magus-cli"}' }],
    ["TEST-24", "an unparseable version", ok("banana")],
  ];
  for (const [id, what, mode] of REGISTRY_FAILURES) {
    test(`${id}: registry answers ${what} → silent, exit 0`, async () => {
      const sb = sandbox();
      const reg = registry(mode);
      const m = plainMagus(sb, "magus v7.1.0");
      const r = await runHook(sb, { path: [m.dir], registry: reg.url });
      expectSilent(r);
      expect(reg.count).toBeGreaterThanOrEqual(1); // the failure was actually exercised
    }, T);
  }

  test("TEST-25: installed version unparseable → silent, exit 0", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus development build");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectSilent(r);
  }, T);
});

describe("magus-version-check: registry URL", () => {
  const CASES: Array<[string, string, string, string]> = [
    ["TEST-26", "trailing slash on the origin", "", "/"],
    ["TEST-27", "a path prefix, no trailing slash", "/npm", "/npm"],
    ["TEST-28", "a path prefix with a trailing slash", "/npm", "/npm/"],
  ];
  for (const [id, what, prefix, suffix] of CASES) {
    test(`${id}: npm_config_registry with ${what} → <registry>/magus-cli/latest`, async () => {
      const sb = sandbox();
      const reg = registry(ok("7.3.1"), prefix);
      const m = plainMagus(sb, "magus v7.1.0");
      const r = await runHook(sb, { path: [m.dir], registry: reg.url + suffix });
      expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
      expect([...new Set(reg.paths)]).toEqual([`${prefix}${LATEST_PATH}`]);
    }, T);
  }
});

describe("magus-version-check: cache", () => {
  test("TEST-29: a successful fetch is cached at the contract path; a second run within 24 h makes zero requests and uses the cached value", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    const r1 = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r1, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
    expect(existsSync(join(sb.cache, CACHE_REL))).toBe(true);
    const afterFirst = reg.count;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    reg.mode = ok("7.5.0");
    const r2 = await runHook(sb, { path: [m.dir], registry: reg.url });
    expect(reg.count).toBe(afterFirst);
    expectStale(r2, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
    expect(r2.stdout).not.toContain("7.5.0");
  }, T);

  test("TEST-30: an up-to-date result is cached too", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.3.1");
    expectSilent(await runHook(sb, { path: [m.dir], registry: reg.url }));
    expect(existsSync(join(sb.cache, CACHE_REL))).toBe(true);
    const afterFirst = reg.count;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    expectSilent(await runHook(sb, { path: [m.dir], registry: reg.url }));
    expect(reg.count).toBe(afterFirst);
  }, T);

  test("TEST-31: without XDG_CACHE_HOME the cache lives under $HOME/.cache", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    const r1 = await runHook(sb, { path: [m.dir], registry: reg.url, xdg: null });
    expectStale(r1, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
    expect(existsSync(join(sb.home, ".cache", CACHE_REL))).toBe(true);
    expect(existsSync(join(sb.cache, "magus-dev"))).toBe(false);
    const afterFirst = reg.count;
    const r2 = await runHook(sb, { path: [m.dir], registry: reg.url, xdg: null });
    expect(reg.count).toBe(afterFirst);
    expectStale(r2, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
  }, T);

  const NOT_CACHED: Array<[string, string, Mode]> = [
    ["TEST-32", "HTTP 500", { kind: "status", code: 500 }],
    ["TEST-33", "invalid JSON", { kind: "raw", body: '{"name":"magus-cli","version":"7.3.1"' }],
    ["TEST-34", "no response (timeout)", { kind: "hang" }],
  ];
  for (const [id, what, failing] of NOT_CACHED) {
    test(`${id}: a failed fetch (${what}) is not cached — the next run fetches again`, async () => {
      const sb = sandbox();
      const reg = registry(failing);
      const m = plainMagus(sb, "magus v7.1.0");
      expectSilent(await runHook(sb, { path: [m.dir], registry: reg.url }));
      const afterFirst = reg.count;
      expect(afterFirst).toBeGreaterThanOrEqual(1);

      reg.mode = ok("7.3.1");
      const r2 = await runHook(sb, { path: [m.dir], registry: reg.url });
      expect(reg.count).toBeGreaterThan(afterFirst);
      expectStale(r2, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
    }, T);
  }

  test("TEST-35: a cache file older than 24 h (by mtime, assumption A3) triggers a fetch", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    expectStale(await runHook(sb, { path: [m.dir], registry: reg.url }), {
      installed: "7.1.0",
      latest: "7.3.1",
      via: "npm",
    });
    const cacheFile = join(sb.cache, CACHE_REL);
    expect(existsSync(cacheFile)).toBe(true);
    const old = Date.now() / 1000 - 25 * HOUR_S;
    utimesSync(cacheFile, old, old);
    const afterFirst = reg.count;

    reg.mode = ok("7.5.0");
    const r2 = await runHook(sb, { path: [m.dir], registry: reg.url });
    expect(reg.count).toBeGreaterThan(afterFirst);
    expectStale(r2, { installed: "7.1.0", latest: "7.5.0", via: "npm" });
  }, T);

  test("TEST-36: a cache file aged 23 h (by mtime) is still fresh", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    expectStale(await runHook(sb, { path: [m.dir], registry: reg.url }), {
      installed: "7.1.0",
      latest: "7.3.1",
      via: "npm",
    });
    const cacheFile = join(sb.cache, CACHE_REL);
    const aged = Date.now() / 1000 - 23 * HOUR_S;
    utimesSync(cacheFile, aged, aged);
    const afterFirst = reg.count;

    reg.mode = ok("7.5.0");
    const r2 = await runHook(sb, { path: [m.dir], registry: reg.url });
    expect(reg.count).toBe(afterFirst);
    expectStale(r2, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
  }, T);

  test("TEST-37: a corrupt cache file is not trusted — the registry is asked", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    const cacheFile = join(sb.cache, CACHE_REL);
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, "this is not json {{{");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expect(reg.count).toBeGreaterThanOrEqual(1);
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
  }, T);
});

describe("magus-version-check: timeouts", () => {
  test("TEST-38: a registry that never answers → finishes under 3 s, silent, exit 0", async () => {
    const sb = sandbox();
    const reg = registry({ kind: "hang" });
    const m = plainMagus(sb, "magus v7.1.0");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectSilent(r);
    expect(r.ms).toBeLessThan(BUDGET_MS);
    expect(reg.count).toBeGreaterThanOrEqual(1); // the hang was actually exercised
  }, T);

  test("TEST-39: the registry call has its own timeout of at most 1.5 s", async () => {
    const sb = sandbox();
    const reg = registry({ kind: "hang" });
    const m = plainMagus(sb, "magus v7.1.0");
    const hang = await runHook(sb, { path: [m.dir], registry: reg.url, xdg: join(sb.root, "cache-hang") });
    const calls = reg.count;
    expect(calls).toBeGreaterThanOrEqual(1);

    reg.mode = ok("7.3.1");
    const base = await runHook(sb, { path: [m.dir], registry: reg.url, xdg: join(sb.root, "cache-base") });
    expect(base.code).toBe(0);
    expect(hang.ms - base.ms).toBeLessThanOrEqual(calls * PER_CALL_MS + PER_CALL_TOLERANCE_MS);
  }, T);

  test("TEST-40: `magus --version` that sleeps 10 s → finishes under 3 s, silent, exit 0", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = hangingMagus(sb);
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectSilent(r);
    expect(r.ms).toBeLessThan(BUDGET_MS);
    expect(logLines(m.log).length).toBeGreaterThanOrEqual(1); // the hang was actually exercised
  }, T);

  test("TEST-41: the `magus --version` call has its own timeout of at most 1.5 s", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const slow = hangingMagus(sb);
    const hang = await runHook(sb, { path: [slow.dir], registry: reg.url, xdg: join(sb.root, "cache-hang") });
    const calls = logLines(slow.log).length;
    expect(calls).toBeGreaterThanOrEqual(1);

    const fast = plainMagus(sb, "magus v7.1.0");
    const base = await runHook(sb, { path: [fast.dir], registry: reg.url, xdg: join(sb.root, "cache-base") });
    expect(base.code).toBe(0);
    expect(hang.ms - base.ms).toBeLessThanOrEqual(calls * PER_CALL_MS + PER_CALL_TOLERANCE_MS);
  }, T);
});

describe("magus-version-check: side effects and robustness", () => {
  /** Every path under `dir`: files by size + mtime, dirs by existence, links by target. */
  function snapshot(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (p: string): void => {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.set(p, `link:${readlinkSync(p)}`);
      else if (st.isDirectory()) {
        out.set(p, "dir");
        for (const e of readdirSync(p)) walk(join(p, e));
      } else out.set(p, `file:${st.size}:${st.mtimeMs}`);
    };
    walk(dir);
    return out;
  }

  test("TEST-42: nothing is written outside the cache file", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const plain = plainMagus(sb, "magus v7.1.0");
    // A package layout too, so package.json and the link are inside the snapshot.
    npmLayout(sb, { version: "7.0.0" });
    const cacheDir = join(sb.cache, "magus-dev");
    const cacheFile = join(sb.cache, CACHE_REL);

    const before = snapshot(sb.root);
    const r = await runHook(sb, { path: [plain.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
    const after = snapshot(sb.root);

    const added = [...after.keys()].filter((p) => !before.has(p)).sort();
    const removed = [...before.keys()].filter((p) => !after.has(p));
    const changed = [...before.keys()].filter((p) => after.has(p) && after.get(p) !== before.get(p));
    expect(added).toEqual([cacheDir, cacheFile].sort());
    expect(removed).toEqual([]);
    expect(changed).toEqual([]);
  }, T);

  test("TEST-43: no install or uninstall is attempted", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    const tools = join(sb.root, "tools/bin");
    const toolLogs: Record<string, string> = {};
    for (const tool of ["bun", "bunx", "npm", "npx", "pnpm", "yarn"]) {
      const log = join(sb.logs, `${tool}.log`);
      toolLogs[tool] = log;
      writeExe(join(tools, tool), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`);
    }
    const r = await runHook(sb, { path: [m.dir, tools], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });

    const INSTALL_VERB = /(^|\s)(add|install|i|uninstall|remove|rm|un|update|upgrade|link|dlx|exec)(\s|$)/;
    for (const [tool, log] of Object.entries(toolLogs)) {
      const offending = logLines(log).filter((l) => INSTALL_VERB.test(l));
      expect({ tool, offending }).toEqual({ tool, offending: [] });
    }
    for (const line of logLines(m.log)) expect(line).toBe("--version");
  }, T);

  test("TEST-44: magus is only ever invoked as `magus --version`", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
    const lines = logLines(m.log);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) expect(line).toBe("--version");
  }, T);

  test("TEST-45: an unwritable cache root does not fail the session", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0");
    const notADir = join(sb.root, "cache-is-a-file");
    writeFileSync(notADir, "regular file, not a directory");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url, xdg: notADir });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    // The contract does not say whether a cache-write failure suppresses the message:
    // either silence or the valid stale object is acceptable, nothing else.
    if (r.stdout !== "") expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
  }, T);

  test("TEST-46: bare-name forms never appear, for any of the three commands", async () => {
    const layouts: Record<Manager, (sb: Sandbox) => Fake> = {
      bun: (sb) => bunLayout(sb, "7.0.0"),
      pnpm: (sb) => pnpmLayout(sb, "7.0.0"),
      npm: (sb) => npmLayout(sb, { version: "7.0.0" }),
    };
    for (const via of Object.keys(layouts) as Manager[]) {
      const sb = sandbox();
      const reg = registry(ok("7.3.1"));
      const m = layouts[via](sb);
      const r = await runHook(sb, { path: [m.dir], registry: reg.url });
      expectStale(r, { installed: "7.0.0", latest: "7.3.1", via });
      expectNoBareName(r.stdout);
    }
  }, T);
});

describe("magus-version-check: bunfig.toml in the session cwd", () => {
  // The hook runs with cwd = the user's project. A bunfig.toml there must not affect the
  // hook or any bun process it starts. Each case runs once WITHOUT the file (baseline,
  // own cache dir) and once WITH it (fresh cache dir, so the fetch path runs under the
  // bunfig too), and requires the second run to match the first byte for byte.
  const PRELOADS: Array<[Preload, string]> = [
    ["throws", "throws"],
    ["prints", "prints to stdout"],
    ["missing", "names a missing file"],
    ["sleeps", "sleeps 4 s"],
  ];

  async function baselineThenBunfig(
    sb: Sandbox,
    kind: Preload,
    path: string[],
    registryUrl: string,
  ): Promise<{ base: Run; withFile: Run; marker: string }> {
    const base = await runHook(sb, { path, registry: registryUrl, xdg: join(sb.root, "cache-base") });
    const marker = writeBunfig(sb, kind);
    const withFile = await runHook(sb, { path, registry: registryUrl, xdg: join(sb.root, "cache-bunfig") });
    return { base, withFile, marker };
  }

  function expectUnaffected(withFile: Run, base: Run, marker: string): void {
    expect(withFile.code).toBe(0);
    expect(withFile.stderr).toBe("");
    expect(withFile.stdout).toBe(base.stdout);
    expect(withFile.ms).toBeLessThan(BUDGET_MS);
    expect(logLines(marker)).toEqual([]); // the preload never ran, in any process
  }

  PRELOADS.forEach(([kind, what], i) => {
    test(`TEST-${47 + i}: stale setup, bunfig preload that ${what} → output unchanged`, async () => {
      const sb = sandbox();
      const reg = registry(ok("7.3.1"));
      const m = plainMagus(sb, "magus v7.1.0");
      const { base, withFile, marker } = await baselineThenBunfig(sb, kind, [m.dir], reg.url);
      expectStale(base, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
      expectUnaffected(withFile, base, marker);
      expectStale(withFile, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
    }, T);
  });

  PRELOADS.forEach(([kind, what], i) => {
    test(`TEST-${51 + i}: up-to-date setup, bunfig preload that ${what} → still silent`, async () => {
      const sb = sandbox();
      const reg = registry(ok("7.3.1"));
      const m = plainMagus(sb, "magus v7.3.1");
      const { base, withFile, marker } = await baselineThenBunfig(sb, kind, [m.dir], reg.url);
      expectSilent(base);
      expectUnaffected(withFile, base, marker);
      expectSilent(withFile);
    }, T);
  });

  // "This covers every bun process the hook starts": here `magus` is itself a bun script,
  // so `magus --version` is a second bun process started by the hook.
  PRELOADS.forEach(([kind, what], i) => {
    test(`TEST-${55 + i}: magus is a bun script, bunfig preload that ${what} → output unchanged`, async () => {
      const sb = sandbox();
      const reg = registry(ok("7.3.1"));
      const m = bunScriptMagus(sb, "magus v7.1.0");
      const { base, withFile, marker } = await baselineThenBunfig(sb, kind, [m.dir], reg.url);
      expectStale(base, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
      expectUnaffected(withFile, base, marker);
      expectStale(withFile, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
    }, T);
  });
});

describe("magus-version-check: package manager, first match wins", () => {
  test("TEST-59: Bun global under a custom BUN_INSTALL (/install/global/node_modules/) → bun command", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = customBunInstallLayout(sb, "7.2.0");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.2.0", latest: "7.3.1", via: "bun" });
    expect(r.stdout).not.toContain("9.9.9");
  }, T);

  test("TEST-60: pnpm global (virtual store behind node_modules) → pnpm command, package.json version", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = pnpmLayout(sb, "7.0.0");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.0.0", latest: "7.3.1", via: "pnpm" });
    expect(r.stdout).not.toContain("9.9.9");
  }, T);

  test("TEST-61: a pnpm shim executable in PNPM_HOME (/pnpm/, --version) → pnpm command", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0", "Library/pnpm");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "pnpm" });
  }, T);

  test("TEST-62: a real path matching both /pnpm/ and bun/bin → bun, the first rule, wins", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0", "Library/pnpm/tools/bun/bin");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "bun" });
  }, T);

  test("TEST-63: `pnpm` in a path segment name without the /pnpm/ form → npm command", async () => {
    const sb = sandbox();
    const reg = registry(ok("7.3.1"));
    const m = plainMagus(sb, "magus v7.1.0", "opt/mypnpm-tools/bin");
    const r = await runHook(sb, { path: [m.dir], registry: reg.url });
    expectStale(r, { installed: "7.1.0", latest: "7.3.1", via: "npm" });
  }, T);
});
