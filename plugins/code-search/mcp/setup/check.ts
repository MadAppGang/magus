/**
 * check.ts — the ONE evaluator of "is code-search set up in this project".
 *
 * The SessionStart hook, `scripts/setup/status.ts` and `mcp/server.ts` all call it, so
 * the three surfaces cannot disagree about which state holds or how to phrase the
 * question. Dependency direction: `scripts/` and `hooks/` import this; this imports
 * nothing from either.
 *
 * ALL IO IS INJECTED through `CheckIo`, and the split is the contract:
 *
 *   fast path (`evaluateSetup`)  settings reads, PATH lookups, file stats. ZERO process
 *                                spawns, ZERO fetches — it never touches `io.run` or
 *                                `io.fetchText`. The hook runs it on every session start
 *                                inside a 5 s budget.
 *   deep (`checkSetup`, deep)    adds the engine's version probe.
 *   updates (checkUpdates)       adds the npm / PyPI latest-version lookups, 5 s each.
 *
 * States are evaluated in `SETUP_STATE_ORDER`; the first that holds is the headline and
 * every problem found is still listed in `findings`.
 *
 * The ripgrep shim is not evaluated here: it runs the host's embedded ripgrep and never
 * reaches an engine, so it is no part of setup. `core/health.ts` keeps its assessor
 * (`assessRipgrep`), which has no production caller.
 */

import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { CATALOG, catalogEntry, shellQuote, type CatalogEntry } from "../adapters/catalog";
import {
  loadSettings,
  settingsLayerPaths,
  type EngineSpec,
  type LayerReport,
  type SetupPreference,
} from "../core/settings";
import {
  NEEDS_SETUP,
  SETUP_COMMAND,
  SETUP_STATE_ORDER,
  setupAdvice,
  type SetupAdvice,
  type SetupFinding,
  type SetupFindingCode,
  type SetupState,
  type SetupStateId,
} from "../core/setup-state";

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

export interface RunOptions {
  cwd?: string;
  timeoutMs: number;
  /** Merged over the parent's environment. */
  env?: Readonly<Record<string, string>>;
}

export interface RunResult {
  /** null when the process was killed by a signal or never started. */
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be started at all (ENOENT, EACCES). */
  spawnError?: string;
}

export type PathKind = "missing" | "file" | "directory" | "other";

export interface CheckIo {
  /** The process environment: PATH, UV_TOOL_DIR, XDG_DATA_HOME. */
  env: Readonly<Record<string, string | undefined>>;
  /** undefined for absent OR unreadable. Never throws. */
  readText(path: string): string | undefined;
  /** undefined for absent OR unreadable. Never throws. */
  readBytes(path: string): Uint8Array | undefined;
  /** What is at `path` after following symlinks. Never throws. */
  kind(path: string): PathKind;
  /** A regular file (after symlinks) with an execute bit for this user. Never throws. */
  isExecutable(path: string): boolean;
  /** undefined when it cannot be resolved. Never throws. */
  realpath(path: string): string | undefined;
  /** Deep only. The fast path must never call it. */
  run?(argv: readonly string[], opts: RunOptions): Promise<RunResult>;
  /** Updates only. Resolves undefined on any failure, including the timeout. */
  fetchText?(url: string, timeoutMs: number): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Paths and commands every surface names
// ---------------------------------------------------------------------------

export function setupSkillPath(pluginRoot: string): string {
  return join(pluginRoot, "skills", "setup", "SKILL.md");
}

export function setupScriptPath(pluginRoot: string): string {
  return join(pluginRoot, "scripts", "setup.ts");
}

/**
 * A copy-pasteable invocation of the setup CLI. `--env-file=/dev/null` because bun
 * autoloads a `.env` from the cwd before any user code runs, and a project whose `.env`
 * is a FIFO would hang it; `--config=/dev/null` for the same reason with `bunfig.toml`.
 */
export function setupCliCommand(pluginRoot: string, args: readonly string[]): string {
  return shellQuote(["bun", "--env-file=/dev/null", "--config=/dev/null", setupScriptPath(pluginRoot), ...args]);
}

export function dismissCommandFor(pluginRoot: string, projectDir: string): string {
  return setupCliCommand(pluginRoot, ["dismiss", "--project", projectDir]);
}

/** The three settings layers by name, lowest precedence first. */
export type LayerName = "user" | "project" | "local";
export const LAYER_NAMES: readonly LayerName[] = ["user", "project", "local"];

export function layerPath(layer: LayerName, home: string, projectDir: string): string {
  const [user, project, local] = settingsLayerPaths(home, projectDir);
  const path = layer === "user" ? user : layer === "project" ? project : local;
  if (path === undefined) throw new TypeError(`layerPath: no path for ${layer}`);
  return path;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface CheckInput {
  pluginRoot: string;
  projectDir: string;
  home: string;
  /** Adds the version probe. */
  deep?: boolean;
  /** Adds latest-version lookups (and the version probe they compare against). */
  checkUpdates?: boolean;
}

export interface EngineReport {
  id: string;
  /** The id is one this build ships. */
  known: boolean;
  /** Settings carry an `engines.<id>` block. */
  hasBlock: boolean;
  command?: string;
  /** Where `command` resolved, when it did. */
  commandPath?: string;
  /** For engines installed with extras: whether uv's receipt still records them.
   *  Absent when no receipt was found (nothing is claimed either way). */
  extrasRecorded?: boolean;
  receiptPath?: string;
  /** Project-relative marker, when the engine has a project step. */
  indexMarker?: string;
  indexed?: boolean;
  /** Deep/updates only. */
  version?: string;
  latest?: string;
}

export interface SetupReport extends SetupState {
  pluginRoot: string;
  projectDir: string;
  home: string;
  layers: readonly LayerReport[];
  engine?: string | false;
  setup?: SetupPreference;
  /** Settings layers where `enabledPlugins["code-search@<marketplace>"]` is true. */
  enabledIn: readonly LayerName[];
  engineReport?: EngineReport;
  deep: boolean;
  /** Present exactly when the headline prompts. */
  advice?: SetupAdvice;
}

// ---------------------------------------------------------------------------
// Fast path
// ---------------------------------------------------------------------------

/**
 * The fast check. Synchronous by construction: it has no way to await a process or a
 * fetch, which is what keeps the hook inside its budget.
 */
export function evaluateSetup(input: CheckInput, io: CheckIo): SetupReport {
  const findings: SetupFinding[] = [];
  const { pluginRoot, projectDir, home } = input;
  const add = (finding: SetupFinding): void => {
    findings.push(finding);
  };

  const load = loadSettings({ home, projectDir, readFileText: (path) => io.readText(path) });

  for (const layer of load.layers) {
    if (layer.status === "malformed" || layer.status === "wrong-shape" || layer.status === "unreadable") {
      add({
        code: "settings_invalid",
        level: "problem",
        message: `${layer.path} is ${layer.status}, so none of its code-search settings are in effect.`,
        path: layer.path,
      });
    }
  }

  const { engine, setup, engines } = load.settings;
  const report: Omit<SetupReport, "headline" | "findings"> = {
    pluginRoot,
    projectDir,
    home,
    layers: load.layers,
    enabledIn: enabledLayers(io, home, projectDir),
    deep: false,
  };
  if (engine !== undefined) report.engine = engine;
  if (setup !== undefined) report.setup = setup;

  // `none` is terminal: the user chose Grep, Glob and Read as they come.
  if (engine === undefined) {
    add({
      code: "unconfigured",
      level: "problem",
      message: "No engine is configured for this project.",
      remedy: SETUP_COMMAND,
    });
  } else if (engine !== false) {
    report.engineReport = evaluateEngine(engine, engines, input, io, add);
  }

  return finish(report, findings, input);
}

/**
 * The full check: the fast path, then whatever `deep` and `checkUpdates` add. The only
 * entry point that may spawn or fetch, and only through the injected `io`.
 */
export async function checkSetup(input: CheckInput, io: CheckIo): Promise<SetupReport> {
  const fast = evaluateSetup(input, io);
  if (input.deep !== true && input.checkUpdates !== true) return fast;

  const findings: SetupFinding[] = [...fast.findings];
  const report: Omit<SetupReport, "headline" | "findings" | "advice"> = { ...fast, deep: input.deep === true };
  delete (report as Partial<SetupReport>).advice;

  if (io.run === undefined) throw new TypeError("checkSetup: deep checks need io.run");

  const engineReport = report.engineReport;
  const entry = engineReport === undefined ? undefined : catalogEntry(engineReport.id);
  if (engineReport !== undefined && entry !== undefined && engineReport.commandPath !== undefined) {
    const version = await probeVersion(entry, input, io);
    if (version !== undefined) engineReport.version = version;

    if (input.checkUpdates === true) {
      const latest = await latestVersion(entry, io);
      if (latest !== undefined) engineReport.latest = latest;
      if (version !== undefined && latest !== undefined && compareVersions(version, latest) < 0) {
        findings.push({
          code: "engine_behind",
          level: "info",
          message: `${engineReport.id} ${version} is installed; ${latest} is the latest release.`,
          remedy: setupCliCommand(input.pluginRoot, ["upgrade", engineReport.id]),
        });
      }
    }
  }

  return finish(report, findings, input);
}

// ---------------------------------------------------------------------------
// Settings layers, read raw for the key that lives outside the code-search block
// ---------------------------------------------------------------------------

/** Settings layers where `enabledPlugins["code-search@<marketplace>"]` is true. */
export function enabledLayers(io: CheckIo, home: string, projectDir: string): LayerName[] {
  const out: LayerName[] = [];
  for (const layer of LAYER_NAMES) {
    const root = parseObject(io.readText(layerPath(layer, home, projectDir)));
    const enabled = root?.["enabledPlugins"];
    if (!isPlainObject(enabled)) continue;
    const on = Object.entries(enabled).some(([id, value]) => id.startsWith("code-search@") && value === true);
    if (on) out.push(layer);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function evaluateEngine(
  id: string,
  engines: Readonly<Record<string, EngineSpec>>,
  input: CheckInput,
  io: CheckIo,
  add: (finding: SetupFinding) => void,
): EngineReport {
  const entry = catalogEntry(id);
  const spec = engines[id];
  const report: EngineReport = { id, known: entry !== undefined, hasBlock: spec !== undefined };
  const cli = (args: readonly string[]): string => setupCliCommand(input.pluginRoot, args);

  if (entry === undefined) {
    add({
      code: "engine_unknown",
      level: "problem",
      message: `"${id}" is not an engine this plugin ships (it ships ${SHIPPED_ENGINE_IDS.join(", ")}).`,
      remedy: SETUP_COMMAND,
    });
    return report;
  }
  if (spec === undefined) {
    add({
      code: "engine_unknown",
      level: "problem",
      message: `The engine is "${id}", but no settings layer has an engines.${id} block to start it with.`,
      remedy: cli(["configure", id]),
    });
    return report;
  }

  report.command = spec.command;
  const commandPath = resolveCommand(spec, input.projectDir, io);
  if (commandPath === undefined) {
    add({
      code: "engine_missing",
      level: "problem",
      message: `${spec.command}, which starts ${id}, is not on PATH.`,
      remedy: cli(["install", id]),
    });
  } else {
    report.commandPath = commandPath;
    const extras = entry.package.extras;
    if (extras !== undefined && extras.length > 0) {
      const receipt = findUvReceipt(commandPath, entry.package.name, input.home, io);
      if (receipt !== undefined) {
        report.receiptPath = receipt.path;
        report.extrasRecorded = receiptRecordsExtras(receipt.text, entry.package.name, extras);
        if (!report.extrasRecorded) {
          add({
            code: "engine_missing",
            level: "problem",
            message:
              `${entry.package.name} is installed without the [${extras.join(",")}] extra ` +
              `(uv receipt ${receipt.path}), so ${spec.command} cannot start.`,
            remedy: cli(["install", id]),
            path: receipt.path,
          });
        }
      }
    }
  }

  const step = entry.projectStep;
  if (step !== undefined) {
    report.indexMarker = step.marker;
    const markerPath = join(input.projectDir, step.marker);
    report.indexed = io.kind(markerPath) !== "missing";
    if (!report.indexed) {
      add({
        code: "index_missing",
        level: "problem",
        message: `${id} has not been set up for this project: ${step.marker} does not exist.`,
        remedy: cli(["index", id]),
        path: markerPath,
      });
    }
  }
  return report;
}

/**
 * Where the engine's `command` resolves, the way `spawn` will resolve it: a path is taken
 * as it stands (relative to the server's cwd), a bare name is looked up on PATH — the
 * engine's own `env.PATH` when its settings set one, since that is the PATH spawn uses.
 */
function resolveCommand(spec: EngineSpec, projectDir: string, io: CheckIo): string | undefined {
  if (spec.command.includes("/")) {
    const path = isAbsolute(spec.command) ? spec.command : resolve(spec.cwd ?? projectDir, spec.command);
    return io.isExecutable(path) ? path : undefined;
  }
  return whichOnPath(spec.command, spec.env?.["PATH"] ?? io.env["PATH"], io);
}

/** PATH lookup with plain file stats. No process, no shell. */
export function whichOnPath(name: string, pathEnv: string | undefined, io: CheckIo): string | undefined {
  if (pathEnv === undefined || pathEnv === "") return undefined;
  for (const dir of pathEnv.split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    if (io.isExecutable(candidate)) return candidate;
  }
  return undefined;
}

/**
 * uv's tool receipt for `packageName`: first beside the resolved binary
 * (`<tool dir>/<package>/bin/<binary>` → `<tool dir>/<package>/uv-receipt.toml`), then in
 * uv's default tool directory. No `uv` process — the fast path spawns nothing.
 */
function findUvReceipt(
  binaryPath: string,
  packageName: string,
  home: string,
  io: CheckIo,
): { path: string; text: string } | undefined {
  const candidates: string[] = [];
  const real = io.realpath(binaryPath);
  if (real !== undefined && basename(dirname(real)) === "bin") {
    candidates.push(join(dirname(dirname(real)), "uv-receipt.toml"));
  }
  const dataHome = io.env["XDG_DATA_HOME"] ?? join(home, ".local", "share");
  const toolDir = io.env["UV_TOOL_DIR"] ?? join(dataHome, "uv", "tools");
  candidates.push(join(toolDir, packageName, "uv-receipt.toml"));

  for (const path of candidates) {
    const text = io.readText(path);
    if (text !== undefined) return { path, text };
  }
  return undefined;
}

/**
 * For an engine installed with extras: whether uv's receipt beside `binaryPath` still
 * records them. undefined when the engine names no extras or no receipt was found —
 * then nothing is claimed either way.
 */
export function extrasRecorded(
  entry: CatalogEntry,
  binaryPath: string,
  home: string,
  io: CheckIo,
): boolean | undefined {
  const extras = entry.package.extras;
  if (extras === undefined || extras.length === 0) return undefined;
  const receipt = findUvReceipt(binaryPath, entry.package.name, home, io);
  return receipt === undefined ? undefined : receiptRecordsExtras(receipt.text, entry.package.name, extras);
}

/** `requirements = [{ name = "graphifyy", extras = ["mcp"] }]` names every extra. */
export function receiptRecordsExtras(text: string, packageName: string, extras: readonly string[]): boolean {
  for (const table of text.matchAll(/\{[^{}]*\}/gu)) {
    const body = table[0];
    const name = /\bname\s*=\s*"([^"]+)"/u.exec(body)?.[1];
    if (name !== packageName) continue;
    const list = /\bextras\s*=\s*\[([^\]]*)\]/u.exec(body)?.[1] ?? "";
    const recorded = new Set([...list.matchAll(/"([^"]+)"/gu)].map((m) => m[1]));
    return extras.every((extra) => recorded.has(extra));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deep: the engine's version
// ---------------------------------------------------------------------------

const VERSION_PROBE_TIMEOUT_MS = 15_000;
export const UPDATE_LOOKUP_TIMEOUT_MS = 5_000;

/** The FIRST line of stdout only: mnemex may append an update notice after ~2 s. */
async function probeVersion(entry: CatalogEntry, input: CheckInput, io: CheckIo): Promise<string | undefined> {
  const run = io.run;
  if (run === undefined) return undefined;
  const result = await run(entry.versionProbe.argv, { cwd: input.home, timeoutMs: VERSION_PROBE_TIMEOUT_MS });
  if (result.spawnError !== undefined) return undefined;
  return parseVersionLine(result.stdout, entry.versionProbe.pattern);
}

export function parseVersionLine(stdout: string, pattern: RegExp): string | undefined {
  const first = stdout.split("\n", 1)[0] ?? "";
  return new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(first.trim())?.[1];
}

async function latestVersion(entry: CatalogEntry, io: CheckIo): Promise<string | undefined> {
  const fetchText = io.fetchText;
  if (fetchText === undefined) return undefined;
  const { registry, name } = entry.package;
  const url =
    registry === "npm" ? `https://registry.npmjs.org/${name}/latest` : `https://pypi.org/pypi/${name}/json`;
  const body = await fetchText(url, UPDATE_LOOKUP_TIMEOUT_MS);
  const root = parseObject(body);
  if (root === undefined) return undefined;
  const version = registry === "npm" ? root["version"] : (isPlainObject(root["info"]) ? root["info"]["version"] : undefined);
  return typeof version === "string" && /^\d+\.\d+\.\d+/u.test(version) ? version : undefined;
}

/** Numeric x.y.z comparison; a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => (/^(\d+)\.(\d+)\.(\d+)/u.exec(v)?.slice(1) ?? []).map(Number);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Headline and advice
// ---------------------------------------------------------------------------

function finish(
  report: Omit<SetupReport, "headline" | "findings">,
  findings: SetupFinding[],
  input: CheckInput,
): SetupReport {
  const problemCodes = new Set<SetupFindingCode>(
    findings.filter((f) => f.level === "problem").map((f) => f.code),
  );
  const headline = headlineOf(report.setup, report.engine, problemCodes);
  const out: SetupReport = { ...report, headline, findings };

  if (NEEDS_SETUP.has(headline)) {
    const first = findings.find((f) => f.level === "problem" && f.code === headline);
    const advice = setupAdvice({
      state: headline,
      summary: first?.message ?? headline,
      skillPath: setupSkillPath(input.pluginRoot),
      dismissCommand: dismissCommandFor(input.pluginRoot, input.projectDir),
    });
    if (advice !== undefined) out.advice = advice;
  }
  return out;
}

function headlineOf(
  setup: SetupPreference | undefined,
  engine: string | false | undefined,
  problems: ReadonlySet<SetupFindingCode>,
): SetupStateId {
  for (const state of SETUP_STATE_ORDER) {
    if (state === "dismissed" && setup === "dismissed") return state;
    if (state === "none" && engine === false) return state;
    if (state !== "ready" && problems.has(state as SetupFindingCode)) return state;
  }
  return "ready";
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Catalog ids, re-exported so scripts need not reach into adapters for them. */
export const SHIPPED_ENGINE_IDS: readonly string[] = Object.keys(CATALOG);
