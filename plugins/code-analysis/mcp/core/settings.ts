/**
 * settings.ts — the layered project-settings reader.
 *
 * Three layers, lowest precedence first, later wins:
 *   1. <home>/.claude/settings.json
 *   2. <projectDir>/.claude/settings.json
 *   3. <projectDir>/.claude/settings.local.json
 *
 * Pure: the filesystem arrives as an injected `SettingsIo`, which is what makes the
 * whole merge testable with plain objects and no processes. No node: import here —
 * paths are joined as POSIX strings, because the only paths this module builds are
 * ones it also hands straight back to the caller.
 *
 * "Skipped silently" means silent to stdout, not invisible: nothing throws, nothing
 * reaches stdout, startup proceeds — and every layer's status is recorded so
 * renderHealth can print all three. A typo'd settings.local.json that makes the
 * engine vanish with no explanation is the exact silent-failure class this facade
 * exists to remove.
 */

import type { BackendNote } from "./ports";

export const SETTINGS_KEY = "code-analysis";

/** Engine ids and settings keys: no underscores, no hyphens, 2..12 chars. */
export const ENGINE_ID_PATTERN = /^[a-z][a-z0-9]{1,11}$/u;

/** Ratchets. Settings may lower these and never raise them. */
export const MAX_PER_ENGINE_CEILING = 3;
export const MAX_TOTAL_CEILING = 6;
export const LIMIT_CEILING = 200;

/**
 * Upper bound on `engines.<id>.callTimeoutMs`, and it is chosen against the OUTER
 * deadline, not against any engine's speed.
 *
 * The per-call deadline is a diagnostic device: when it fires the facade returns a
 * `backend_unavailable` note naming the engine and the number it waited. That note is
 * the entire value. If the deadline sits at or above whatever deadline governs the
 * session around it, the session is killed or failed FIRST and the note never exists —
 * a clean per-call error degrades into "the run died", which is strictly less
 * information.
 *
 * 240_000 is set against the tightest outer deadline this facade is known to run
 * under: the `benches/code-search` scenarios carry a latency check at 300_000 ms (a
 * graded FAIL) inside a 600s session timeout (a hard kill). Four minutes leaves a
 * minute of headroom below the latency guard, so the note is produced, rendered and
 * graded rather than truncated by the harness.
 *
 * Raising this means finding an outer deadline it must still clear and saying which.
 */
export const CALL_TIMEOUT_CEILING_MS = 240_000;

/** Stand-in path for the two project layers when CLAUDE_PROJECT_DIR is unset. Kept
 *  in the report array so renderHealth always prints three rows and a human can see
 *  that the project layers were not merely empty — they were never consulted. */
export const PROJECT_DIR_UNSET = "(CLAUDE_PROJECT_DIR unset)";

export interface EngineSpec {
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  /**
   * Per-call deadline for THIS engine's MCP requests, handshake included, in
   * milliseconds. Unset means the transport's own default (30_000).
   *
   * One global constant cannot serve every engine. Serena drives a language server:
   * no network, no cold index, ~6s for a symbol lookup — and if it ever needs more
   * than 30s something is genuinely broken and must fail loudly. Mnemex cold-starts,
   * opens a multi-hundred-megabyte index and embeds the query over the network before
   * it can answer at all. Raising the default for everyone would hide the first
   * engine's hang to accommodate the second's honest work, which is the exact failure
   * this timeout exists to catch.
   *
   * Read ONLY by the composition root, which turns it into `McpClientOptions.callMs`.
   * An adapter never reads it: transport configuration is not adapter vocabulary.
   */
  callTimeoutMs?: number;
}

export interface PassthroughSettings {
  enabled: boolean;
  maxPerEngine: number;
  maxTotal: number;
}
export interface GrepSettings {
  route: boolean;
}
export interface LimitSettings {
  default: number;
  max: number;
}

export interface CodeAnalysisSettings {
  engine?: string;
  engines: Readonly<Record<string, EngineSpec>>;
  passthrough: PassthroughSettings;
  grep: GrepSettings;
  limits: LimitSettings;
}

export type LayerStatus =
  | "read"
  | "absent"
  | "unreadable"
  | "malformed"
  | "no-block"
  | "wrong-shape";

export interface LayerReport {
  path: string;
  status: LayerStatus;
}

export interface SettingsLoad {
  settings: CodeAnalysisSettings;
  layers: readonly LayerReport[];
  notes: readonly BackendNote[];
}

export const DEFAULTS: CodeAnalysisSettings = {
  engines: {},
  passthrough: { enabled: false, maxPerEngine: 3, maxTotal: 6 },
  grep: { route: true },
  limits: { default: 20, max: 200 },
};

/** The three layer paths, in precedence order (lowest first). Pure. */
export function settingsLayerPaths(home: string, projectDir?: string): string[] {
  const paths = [`${trimSlash(home)}/.claude/settings.json`];
  if (projectDir !== undefined && projectDir !== "") {
    const dir = trimSlash(projectDir);
    paths.push(`${dir}/.claude/settings.json`, `${dir}/.claude/settings.local.json`);
  }
  return paths;
}

/**
 * The merge, isolated so it can be tested with plain objects and no filesystem.
 * Each element is one layer's already-extracted `code-analysis` block, lowest first;
 * `undefined` (or anything that is not a plain object) is a layer that said nothing.
 *
 * MERGE DEPTH IS EXACTLY TWO. At depth three and below the winning layer's value is
 * taken whole, which is why `engines.<id>` — a record of objects — is replaced
 * wholesale including its `env`, while `passthrough`/`grep`/`limits` — records of
 * scalars — appear to merge per key. One rule, two behaviours falling out of the
 * value type. If `env` merged per key, a project layer could only ever ADD an
 * environment variable and never remove one set in ~/.claude/settings.json.
 */
export function mergeSettingsLayers(raw: readonly (unknown | undefined)[]): {
  settings: CodeAnalysisSettings;
  dropped: string[];
} {
  const engines: Record<string, unknown> = {};
  const passthrough: Record<string, unknown> = {};
  const grep: Record<string, unknown> = {};
  const limits: Record<string, unknown> = {};
  let engine: unknown;

  for (const layer of raw) {
    if (!isPlainObject(layer)) continue;
    if ("engine" in layer) engine = layer["engine"];
    assignShallow(engines, layer["engines"]);
    assignShallow(passthrough, layer["passthrough"]);
    assignShallow(grep, layer["grep"]);
    assignShallow(limits, layer["limits"]);
  }

  const dropped: string[] = [];
  const settings: CodeAnalysisSettings = {
    engines: validateEngines(engines, dropped),
    passthrough: validatePassthrough(passthrough, dropped),
    grep: validateGrep(grep, dropped),
    limits: validateLimits(limits, dropped),
  };

  // An `engine` naming an id with no entry SURVIVES: registry.ts turns that into a
  // backend_unavailable note that can name the missing entry. Silently blanking it
  // here would leave the user staring at a tier-0-only tool list with no cause.
  if (engine !== undefined) {
    if (typeof engine === "string" && ENGINE_ID_PATTERN.test(engine)) settings.engine = engine;
    else dropped.push("engine");
  }

  return { settings, dropped };
}

export interface SettingsIo {
  home: string;
  projectDir?: string;
  /** Returns undefined for absent OR unreadable. Never throws. */
  readFileText(path: string): string | undefined;
}

export function loadSettings(io: SettingsIo): SettingsLoad {
  const paths = settingsLayerPaths(io.home, io.projectDir);
  const layers: LayerReport[] = [];
  const blocks: (unknown | undefined)[] = [];

  for (const path of paths) {
    const { status, block } = readLayer(io, path);
    layers.push({ path, status });
    blocks.push(block);
  }
  // Always three rows, even with no project dir — see PROJECT_DIR_UNSET.
  while (layers.length < 3) layers.push({ path: PROJECT_DIR_UNSET, status: "absent" });

  const { settings, dropped } = mergeSettingsLayers(blocks);

  const notes: BackendNote[] = [];
  for (const layer of layers) {
    if (layer.status === "read" || layer.status === "absent" || layer.status === "no-block") {
      continue;
    }
    notes.push({
      level: "degraded",
      code: "settings_ignored",
      message: `${layer.path} was skipped (${layer.status}); its ${SETTINGS_KEY} settings are not in effect.`,
      remedy: `Check that ${layer.path} is valid JSON with a "${SETTINGS_KEY}" object at the top level.`,
    });
  }
  if (dropped.length > 0) {
    notes.push({
      level: "degraded",
      code: "settings_ignored",
      message: `Dropped or clamped invalid ${SETTINGS_KEY} settings: ${dropped.join(", ")}.`,
    });
  }

  return { settings, layers, notes };
}

// ---------------------------------------------------------------------------
// Layer reading
// ---------------------------------------------------------------------------

function readLayer(
  io: SettingsIo,
  path: string,
): { status: LayerStatus; block: unknown | undefined } {
  let text: string | undefined;
  try {
    text = io.readFileText(path);
  } catch {
    // SettingsIo.readFileText promises never to throw. `unreadable` is what an io
    // that breaks that promise looks like — a real fs wrapper that forgot a catch on
    // EACCES — and it must not take the server down with it.
    return { status: "unreadable", block: undefined };
  }
  if (text === undefined) return { status: "absent", block: undefined };

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { status: "malformed", block: undefined };
  }
  if (!isPlainObject(root)) return { status: "wrong-shape", block: undefined };
  if (!(SETTINGS_KEY in root)) return { status: "no-block", block: undefined };

  const block = root[SETTINGS_KEY];
  if (!isPlainObject(block)) return { status: "wrong-shape", block: undefined };
  return { status: "read", block };
}

// ---------------------------------------------------------------------------
// Validation — every rejection drops the offending value and records its id.
// None throws, none blocks startup.
// ---------------------------------------------------------------------------

function validateEngines(raw: Record<string, unknown>, dropped: string[]): Record<string, EngineSpec> {
  const out: Record<string, EngineSpec> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!ENGINE_ID_PATTERN.test(id)) {
      dropped.push(`engines.${id}`);
      continue;
    }
    if (!isPlainObject(value)) {
      dropped.push(`engines.${id}`);
      continue;
    }
    const command = value["command"];
    if (typeof command !== "string" || command.trim() === "") {
      dropped.push(`engines.${id}.command`);
      continue;
    }
    const spec: EngineSpec = { command };

    const args = value["args"];
    if (args !== undefined) {
      if (Array.isArray(args) && args.every((a) => typeof a === "string")) {
        spec.args = args as readonly string[];
      } else {
        dropped.push(`engines.${id}.args`);
      }
    }
    const env = value["env"];
    if (env !== undefined) {
      if (isPlainObject(env) && Object.values(env).every((v) => typeof v === "string")) {
        spec.env = env as Readonly<Record<string, string>>;
      } else {
        dropped.push(`engines.${id}.env`);
      }
    }
    const cwd = value["cwd"];
    if (cwd !== undefined) {
      if (typeof cwd === "string" && cwd !== "") spec.cwd = cwd;
      else dropped.push(`engines.${id}.cwd`);
    }
    // REJECTED, NOT CLAMPED — the one numeric setting here that is not a ratchet.
    // `passthrough` and `limits` clamp because a too-large budget is still a workable
    // budget. A deadline is different: silently substituting 240_000 for a requested
    // 600_000 leaves the operator reading one number in their settings file while a
    // different one governs the call, which is the silent mismatch this whole field
    // was added to remove. Dropping it falls back to the documented 30_000 default and
    // says so, naming the value it refused.
    const callTimeoutMs = value["callTimeoutMs"];
    if (callTimeoutMs !== undefined) {
      if (
        typeof callTimeoutMs === "number" &&
        Number.isInteger(callTimeoutMs) &&
        callTimeoutMs > 0 &&
        callTimeoutMs <= CALL_TIMEOUT_CEILING_MS
      ) {
        spec.callTimeoutMs = callTimeoutMs;
      } else {
        dropped.push(`engines.${id}.callTimeoutMs (${describeValue(callTimeoutMs)})`);
      }
    }
    out[id] = spec;
  }
  return out;
}

function validatePassthrough(raw: Record<string, unknown>, dropped: string[]): PassthroughSettings {
  const enabled = readBool(raw["enabled"], DEFAULTS.passthrough.enabled, "passthrough.enabled", dropped);
  return {
    enabled,
    maxPerEngine: readClamped(
      raw["maxPerEngine"],
      DEFAULTS.passthrough.maxPerEngine,
      0,
      MAX_PER_ENGINE_CEILING,
      "passthrough.maxPerEngine",
      dropped,
    ),
    maxTotal: readClamped(
      raw["maxTotal"],
      DEFAULTS.passthrough.maxTotal,
      0,
      MAX_TOTAL_CEILING,
      "passthrough.maxTotal",
      dropped,
    ),
  };
}

function validateGrep(raw: Record<string, unknown>, dropped: string[]): GrepSettings {
  return { route: readBool(raw["route"], DEFAULTS.grep.route, "grep.route", dropped) };
}

function validateLimits(raw: Record<string, unknown>, dropped: string[]): LimitSettings {
  const max = readClamped(raw["max"], DEFAULTS.limits.max, 1, LIMIT_CEILING, "limits.max", dropped);
  const def = readClamped(raw["default"], DEFAULTS.limits.default, 1, max, "limits.default", dropped);
  return { default: def, max };
}

function readBool(value: unknown, fallback: boolean, id: string, dropped: string[]): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  dropped.push(id);
  return fallback;
}

function readClamped(
  value: unknown,
  fallback: number,
  lo: number,
  hi: number,
  id: string,
  dropped: string[],
): number {
  if (value === undefined) return clamp(fallback, lo, hi);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    dropped.push(id);
    return clamp(fallback, lo, hi);
  }
  const whole = Math.trunc(value);
  const clamped = clamp(whole, lo, hi);
  if (clamped !== value) dropped.push(id);
  return clamped;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

/**
 * The offending value, short enough to put in a note and specific enough to grep for
 * in the settings file that produced it.
 *
 * A dropped id alone ("engines.mnemex.callTimeoutMs") tells an operator WHICH key was
 * refused but not which of the three layers wrote the value they are looking at, and a
 * merged settings tree can easily hold two. Quoting the value back closes that.
 * Truncated, because a rejected value can be an arbitrarily large object.
 */
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  let rendered: string;
  try {
    rendered = JSON.stringify(value) ?? String(value);
  } catch {
    // A cyclic or otherwise unstringifiable value. Its type is still worth reporting.
    rendered = Object.prototype.toString.call(value);
  }
  return rendered.length > 40 ? `${rendered.slice(0, 40)}…` : rendered;
}

// ---------------------------------------------------------------------------
// Shared shape helpers
// ---------------------------------------------------------------------------

/** A JSON object, and not an array. `typeof null === "object"` is the classic hole. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Depth-2 shallow merge: the later layer's key replaces the earlier layer's. */
function assignShallow(target: Record<string, unknown>, source: unknown): void {
  if (!isPlainObject(source)) return;
  for (const [key, value] of Object.entries(source)) target[key] = value;
}

function trimSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}
