/**
 * gate.ts — is the search merge on, for this project and this moment? (D12)
 *
 * Pure, and shared by every reader of the switches: the server (per request), the
 * SessionStart hook (whether to write the source line) and the redirect hook (whether to
 * step aside for `grep`). Each caller gathers its own inputs; this module only decides.
 *
 * Two switches turn the merge off: `code-search.grep.route: false` in settings, and
 * `CODE_SEARCH_MERGE=0`, which may come from a process environment or from a settings
 * layer's `env`. A `0` from any source closes the gate (`combineGateEnv`).
 */

import { catalogEntry } from "../adapters/catalog";
import { mergeSettingsLayers, SETTINGS_KEY, type CodeAnalysisSettings } from "../core/settings";

/**
 * "An engine is configured", the ONE definition (review round 1, internal M3): an engine
 * id this plugin ships an adapter for, with an `engines` entry for it. That is the static
 * half of what the registry resolves (`resolveEngine`): an id with no entry, or with no
 * shipped adapter (review round 5), never builds an engine, so no server binds and no
 * facade answers. The server, the SessionStart hook, the redirect hook and setup status
 * all ask this function; the server also requires the registry to have built the engine.
 *
 * "Ships an adapter" is read from the catalog (`catalogEntry`), pure data the hooks can
 * load at no cost; `gate.test.ts` pins its ids to the adapter table's (`ENGINE_IDS`).
 */
export function engineConfigured(settings: Pick<CodeAnalysisSettings, "engine" | "engines">): boolean {
  // Own properties only: `engines` is a plain object, and an id like `constructor` passes
  // the engine-id pattern while naming an Object.prototype member (review round 4).
  return (
    typeof settings.engine === "string" &&
    Object.hasOwn(settings.engines, settings.engine) &&
    catalogEntry(settings.engine) !== undefined
  );
}

export const KILL_SWITCH = "CODE_SEARCH_MERGE";

export type GateClosed = "win32" | "kill-switch" | "route-off" | "no-engine";

export function mergeGate(i: {
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
  route: boolean;
  engineConfigured: boolean;
}): undefined | GateClosed {
  if (i.platform === "win32") return "win32";
  // Exactly "0", as the sourced script tests it: the two sides must agree on what off is.
  if (i.env[KILL_SWITCH] === "0") return "kill-switch";
  if (!i.route) return "route-off";
  if (!i.engineConfigured) return "no-engine";
  return undefined;
}

/** One environment view for `mergeGate`: the kill switch is `"0"` when any source says
 *  `"0"`, else the first source's value that is set. */
export function combineGateEnv(
  ...envs: readonly Readonly<Record<string, string | undefined>>[]
): Record<string, string | undefined> {
  const values = envs.map((env) => env[KILL_SWITCH]);
  if (values.includes("0")) return { [KILL_SWITCH]: "0" };
  return { [KILL_SWITCH]: values.find((value) => value !== undefined) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The gate's settings inputs from raw layer texts, lowest precedence first (the order
 * `settingsLayerPaths` returns). `undefined` is an absent layer; a layer that is not a
 * JSON object says nothing, as `loadSettings` treats it.
 *
 * `route` comes from the `code-search` blocks through `mergeSettingsLayers`, so it is
 * validated exactly as the server's own settings are. `env` is Claude Code's top-level
 * `env`, merged per key with the later layer winning. String values only, plus numbers
 * as their decimal text.
 */
export function gateSettings(texts: readonly (string | undefined)[]): {
  route: boolean;
  env: Record<string, string>;
  /** `engineConfigured` over the same merged `code-search` blocks. */
  engineConfigured: boolean;
} {
  const blocks: unknown[] = [];
  const env: Record<string, string> = {};
  for (const text of texts) {
    if (text === undefined) {
      blocks.push(undefined);
      continue;
    }
    let root: unknown;
    try {
      root = JSON.parse(text);
    } catch {
      blocks.push(undefined);
      continue;
    }
    if (!isPlainObject(root)) {
      blocks.push(undefined);
      continue;
    }
    blocks.push(root[SETTINGS_KEY]);
    const layerEnv = root["env"];
    if (!isPlainObject(layerEnv)) continue;
    for (const [key, value] of Object.entries(layerEnv)) {
      if (typeof value === "string") env[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) env[key] = String(value);
    }
  }
  const settings = mergeSettingsLayers(blocks).settings;
  return { route: settings.grep.route, env, engineConfigured: engineConfigured(settings) };
}
