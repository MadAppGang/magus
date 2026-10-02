/**
 * settings-writer.ts — every settings file write the setup CLI makes, and the two
 * subcommands that are nothing but a settings write: `configure` and `dismiss`.
 *
 * BEFORE ANY WRITE (A22): `configure` and `dismiss` read all three layers
 * and refuse `settings_invalid`, writing nothing, while any of them is invalid JSON or has
 * a wrong-shaped `code-search` block (`invalidSettingsLayer`).
 *
 * THE WRITE (A4), in this order, no step skippable:
 *   1. Resolve the target through symlinks and write the RESOLVED file, so a symlinked
 *      settings file stays a symlink.
 *   2. A target that exists and is not a regular file → `settings_not_regular_file`.
 *   3. Malformed JSON, or JSON that is not an object → refuse, never overwrite.
 *   4. Apply the edit to a copy. No change → write nothing at all.
 *   5. Write a temp file in the target's own directory with the original's mode
 *      (a new file gets 0600: settings files hold credentials).
 *   6. Re-read the target. If its bytes differ from what step 3 read, someone else wrote
 *      it meanwhile → `settings_changed_concurrently`, temp removed, nothing written.
 *   7. Rename the temp over the target.
 *
 * WHICH FILE (A5):
 *   configure  the most specific layer where
 *              `enabledPlugins["code-search@<marketplace>"]` is true
 *              (local, then project, then user); none → local.
 *   dismiss    always a PROJECT file: `.claude/settings.json` when the
 *              plugin is enabled at project scope, else
 *              `.claude/settings.local.json`. Never the user file.
 *   `--layer` overrides both.
 *
 * A magus-profiled project renders `.claude/settings.json` from `.claude/profiles.json`.
 * magus does not drop a `code-search` key written there: its reconcile step absorbs any
 * non-plugin settings key into the ACTIVE profile's `settings` (committed with
 * profiles.json) and renders it back. It is absent while a different profile is active.
 *
 * SHADOWING (A1): before writing, the three layers are merged with the edited text in
 * place of the target. If the merged value of a key to be written is not what would be
 * written, a more specific layer overrides it, and the command fails `layer_shadowed`
 * naming that file, with nothing written. Writing first would leave a change with no
 * effect in this project, and on the user layer an effect in every other project.
 */

import { basename, dirname, join } from "node:path";

import { catalogEntry } from "../../mcp/adapters/catalog";
import { enabledLayers, layerPath, LAYER_NAMES, type LayerName } from "../../mcp/setup/check";
import { loadSettings, SETTINGS_KEY } from "../../mcp/core/settings";
import type { SetupContext, SetupIo } from "./io";
import { failed, type Failure, type Outcome } from "./report";

// ---------------------------------------------------------------------------
// Target file
// ---------------------------------------------------------------------------

export type WritePurpose = "configure" | "dismiss";

export function targetLayer(
  purpose: WritePurpose,
  flag: LayerName | undefined,
  enabledIn: readonly LayerName[],
): LayerName {
  if (flag !== undefined) return flag;
  if (purpose === "dismiss") return enabledIn.includes("project") ? "project" : "local";
  for (const layer of ["local", "project", "user"] as const) {
    if (enabledIn.includes(layer)) return layer;
  }
  return "local";
}

export function targetFor(
  io: SetupIo,
  ctx: SetupContext,
  purpose: WritePurpose,
  flag: LayerName | undefined,
): { layer: LayerName; path: string } {
  const layer = targetLayer(purpose, flag, enabledLayers(io, ctx.home, ctx.projectDir));
  return { layer, path: layerPath(layer, ctx.home, ctx.projectDir) };
}

// ---------------------------------------------------------------------------
// Refusal while any layer is invalid (A22)
// ---------------------------------------------------------------------------

/**
 * `settings_invalid` when any of the three layers exists and is not valid JSON, is not a
 * JSON object, or carries a `code-search` value that is not an object. `configure` and
 * `dismiss` call this before anything else: with a layer unreadable
 * as settings, the CLI cannot know where the plugin is enabled or whether a write would
 * be shadowed, so it writes nothing, dry run included.
 *
 * The verdict comes from `loadSettings`, the same reader `status` reports from, so the
 * two cannot disagree about which layer is invalid. Every invalid layer is named; the
 * failure's `path` and remedy point at the first, in precedence order (user first).
 */
export function invalidSettingsLayer(io: SetupIo, ctx: SetupContext, command: string, dryRun: boolean): Outcome | undefined {
  const load = loadSettings({ home: ctx.home, projectDir: ctx.projectDir, readFileText: (path) => io.readText(path) });
  const invalid = load.layers.filter((layer) => layer.status === "malformed" || layer.status === "wrong-shape");
  const first = invalid[0];
  if (first === undefined) return undefined;

  const describe = (path: string): string => `${path}: ${invalidReason(io.readText(path))}`;
  const others = invalid.slice(1).map((layer) => `Also invalid: ${describe(layer.path)}`);
  return failed(
    command,
    {
      code: "settings_invalid",
      message: `${describe(first.path)}; nothing was written.`,
      remedy: `Fix the JSON in ${first.path}, then run this again.`,
      path: first.path,
    },
    { ...(dryRun ? { dryRun: true } : {}), ...(others.length > 0 ? { details: others } : {}) },
  );
}

/** Why `text` is not a usable settings file: the parser's own error, or the wrong shape. */
function invalidReason(text: string | undefined): string {
  if (text === undefined) return "could not be read";
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (error) {
    return `not valid JSON (${errorText(error)})`;
  }
  if (!isPlainObject(root)) return "the top level is not a JSON object";
  return `"${SETTINGS_KEY}" is ${describeJsonType(root[SETTINGS_KEY])}, not an object`;
}

function describeJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

export type Json = Record<string, unknown>;

/** Mutates `root` in place, or returns a refusal; a refusal writes nothing. */
export type SettingsEdit = (root: Json) => Failure | undefined;

export type EditResult =
  | {
      ok: true;
      /** The file actually written (symlinks resolved). */
      path: string;
      changed: boolean;
      /** The file's content after the edit (what was, or would be, written). */
      text: string;
    }
  | { ok: false; failure: Failure };

export function editSettingsFile(io: SetupIo, requested: string, edit: SettingsEdit, dryRun: boolean): EditResult {
  const refuse = (code: string, message: string, remedy?: string): EditResult => ({
    ok: false,
    failure: remedy === undefined ? { code, message, path: requested } : { code, message, remedy, path: requested },
  });

  // 1-2. Resolve, and refuse anything that is not a regular file.
  let path = requested;
  const entry = io.lstatKind(requested);
  if (entry === "symlink") {
    const real = io.realpath(requested);
    if (real === undefined) {
      return refuse("settings_not_regular_file", `${requested} is a symlink whose target does not exist.`);
    }
    path = real;
  }
  const kind = entry === "symlink" ? io.kind(path) : entry === "file" || entry === "missing" ? entry : "other";
  if (kind !== "file" && kind !== "missing") {
    return refuse("settings_not_regular_file", `${path} exists and is not a regular file; it is left untouched.`);
  }

  // 3. Parse. A file we cannot parse is never overwritten.
  const before = kind === "file" ? io.readText(path) : undefined;
  if (kind === "file" && before === undefined) {
    return refuse("settings_unreadable", `${path} exists but could not be read.`);
  }
  let root: Json = {};
  if (before !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(before);
    } catch (error) {
      return refuse(
        "settings_malformed",
        `${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}); it was not changed.`,
        `Fix ${path} by hand, then run the command again.`,
      );
    }
    if (!isPlainObject(parsed)) {
      return refuse("settings_malformed", `${path} is JSON but not an object; it was not changed.`);
    }
    root = parsed;
  }

  // 4. Edit a copy; a no-op writes nothing.
  const next = JSON.parse(JSON.stringify(root)) as Json;
  const refusal = edit(next);
  if (refusal !== undefined) return { ok: false, failure: { path, ...refusal } };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (JSON.stringify(next) === JSON.stringify(root)) {
    return { ok: true, path, changed: false, text: before ?? text };
  }
  if (dryRun) return { ok: true, path, changed: true, text };

  // 5. Temp file beside the target, original mode.
  const dir = dirname(path);
  try {
    io.mkdirp(dir);
  } catch (error) {
    return refuse("settings_write_failed", `Could not create ${dir}: ${errorText(error)}`);
  }
  const mode = before === undefined ? 0o600 : (io.modeOf(path) ?? 0o600);
  const temp = join(dir, `.${basename(path)}.${io.uniqueSuffix()}.tmp`);
  try {
    io.writeNew(temp, text, mode);
  } catch (error) {
    io.removeQuietly(temp);
    return refuse("settings_write_failed", `Could not write ${temp}: ${errorText(error)}`);
  }

  // 6. Did anyone else write the target since step 3?
  const now = io.kind(path) === "file" ? io.readText(path) : undefined;
  if (now !== before) {
    io.removeQuietly(temp);
    return refuse(
      "settings_changed_concurrently",
      `${path} changed while this command was editing it; nothing was written.`,
      "Run the command again.",
    );
  }

  // 7. Replace.
  try {
    io.rename(temp, path);
  } catch (error) {
    io.removeQuietly(temp);
    return refuse("settings_write_failed", `Could not replace ${path}: ${errorText(error)}`);
  }
  return { ok: true, path, changed: true, text };
}

// ---------------------------------------------------------------------------
// Shadowing
// ---------------------------------------------------------------------------

export type WrittenKey =
  | { kind: "block"; key: "engine" | "setup"; value: unknown }
  | { kind: "engineBlock"; id: string; value: unknown };

/**
 * The first written key a more specific layer overrides, as a `layer_shadowed` failure.
 *
 * `targetPath` is the layer path as named (not symlink-resolved) and `targetText` its
 * content after the edit — so a dry run can predict the answer without writing.
 */
export function findShadow(
  io: SetupIo,
  ctx: SetupContext,
  targetPath: string,
  targetText: string,
  written: readonly WrittenKey[],
  dryRun = false,
): Failure | undefined {
  const wrote = dryRun ? "would be written" : "was written";
  const effect = dryRun ? "the write would have no effect" : "the write has no effect";
  const readText = (path: string): string | undefined => (path === targetPath ? targetText : io.readText(path));
  const merged = loadSettings({ home: ctx.home, projectDir: ctx.projectDir, readFileText: readText }).settings;

  const layers = LAYER_NAMES.map((layer) => {
    const path = layerPath(layer, ctx.home, ctx.projectDir);
    return { layer, path, root: parseObject(readText(path)) };
  });

  for (const key of written) {
    const effective = key.kind === "block" ? merged[key.key] : merged.engines[key.id];
    if (canonical(effective) === canonical(key.value)) continue;

    const where = [...layers].reverse().find((l) => hasKey(l.root, key));
    const label = describeKey(key);
    if (where === undefined || where.path === targetPath) {
      return {
        code: "layer_shadowed",
        message: `${label} ${wrote} to ${targetPath}, but the merged settings do not carry it.`,
        path: targetPath,
      };
    }
    return {
      code: "layer_shadowed",
      message:
        `${label} ${wrote} to ${targetPath}, but ${where.path} sets it to ` +
        `${JSON.stringify(effective)} and that file wins, so ${effect}.`,
      remedy: `Remove it from ${where.path}, or run the command again with --layer ${where.layer}.`,
      path: where.path,
    };
  }
  return undefined;
}

function hasKey(root: Json | undefined, key: WrittenKey): boolean {
  if (root === undefined) return false;
  const block = root[SETTINGS_KEY];
  if (!isPlainObject(block)) return false;
  if (key.kind === "block") return key.key in block;
  return isPlainObject(block["engines"]) && key.id in block["engines"];
}

function describeKey(key: WrittenKey): string {
  if (key.kind === "block") return `${SETTINGS_KEY}.${key.key} = ${JSON.stringify(key.value)}`;
  return `${SETTINGS_KEY}.engines.${key.id}`;
}

// ---------------------------------------------------------------------------
// configure <engine|none>
// ---------------------------------------------------------------------------

export interface ConfigureOptions {
  layer?: LayerName;
  replace: boolean;
  dryRun: boolean;
}

export function configure(io: SetupIo, ctx: SetupContext, target: string, opts: ConfigureOptions): Outcome {
  const command = `configure ${target}`;
  const invalid = invalidSettingsLayer(io, ctx, command, opts.dryRun);
  if (invalid !== undefined) return invalid;
  const { layer, path } = targetFor(io, ctx, "configure", opts.layer);
  const written: WrittenKey[] = [];
  const actions: string[] = [];

  let edit: SettingsEdit;
  if (target === "none") {
    edit = (root) => {
      const block = childObject(root, SETTINGS_KEY, path);
      if ("code" in block) return block;
      block.value["engine"] = false;
      block.value["setup"] = "active";
      return undefined;
    };
    written.push(
      { kind: "block", key: "engine", value: false },
      { kind: "block", key: "setup", value: "active" },
    );
    actions.push(`${path}: ${SETTINGS_KEY}.engine = false, ${SETTINGS_KEY}.setup = "active"`);
  } else {
    const entry = catalogEntry(target);
    if (entry === undefined) throw new TypeError(`configure: ${target} is not a catalog id`); // parser guards this
    const wanted = JSON.parse(JSON.stringify(entry.settings)) as Json;
    actions.push(`${path}: ${SETTINGS_KEY}.engine = "${target}", ${SETTINGS_KEY}.setup = "active"`);
    edit = (root) => {
      const block = childObject(root, SETTINGS_KEY, path);
      if ("code" in block) return block;
      block.value["engine"] = target;
      block.value["setup"] = "active";
      const engines = childObject(block.value, "engines", path);
      if ("code" in engines) return engines;
      const existing = engines.value[target];
      if (existing === undefined || canonical(existing) !== canonical(wanted)) {
        if (existing !== undefined && !opts.replace) {
          return {
            code: "engine_block_differs",
            message:
              `${path} already has a different ${SETTINGS_KEY}.engines.${target} block; it was not changed.\n` +
              `  in the file: ${canonical(existing)}\n` +
              `  catalog:     ${canonical(wanted)}`,
            remedy: "Keep yours, or run the command again with --replace to write the catalog block.",
          };
        }
        engines.value[target] = wanted;
        actions.push(`${path}: ${SETTINGS_KEY}.engines.${target} = ${canonical(wanted)}`);
      }
      return undefined;
    };
    written.push(
      { kind: "block", key: "engine", value: target },
      { kind: "block", key: "setup", value: "active" },
      { kind: "engineBlock", id: target, value: wanted },
    );
  }

  return applyAndCheck(io, ctx, command, path, layer, edit, written, opts.dryRun, actions);
}

// ---------------------------------------------------------------------------
// dismiss
// ---------------------------------------------------------------------------

export interface DismissOptions {
  layer?: "local" | "project";
  dryRun: boolean;
}

export function dismiss(io: SetupIo, ctx: SetupContext, opts: DismissOptions): Outcome {
  const invalid = invalidSettingsLayer(io, ctx, "dismiss", opts.dryRun);
  if (invalid !== undefined) return invalid;
  const { layer, path } = targetFor(io, ctx, "dismiss", opts.layer);
  const edit: SettingsEdit = (root) => {
    const block = childObject(root, SETTINGS_KEY, path);
    if ("code" in block) return block;
    block.value["setup"] = "dismissed";
    return undefined;
  };
  return applyAndCheck(
    io,
    ctx,
    "dismiss",
    path,
    layer,
    edit,
    [{ kind: "block", key: "setup", value: "dismissed" }],
    opts.dryRun,
    [`${path}: ${SETTINGS_KEY}.setup = "dismissed"`],
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Write, then prove the write is the effective value. */
export function applyAndCheck(
  io: SetupIo,
  ctx: SetupContext,
  command: string,
  path: string,
  layer: LayerName,
  edit: SettingsEdit,
  written: readonly WrittenKey[],
  dryRun: boolean,
  actions: string[],
): Outcome {
  // Predict shadowing BEFORE writing. A shadowed write has no effect here, but on the user
  // layer it still changes every other project, so a write that would be shadowed is
  // refused with nothing written. `edit` appends to `actions`, so the preview's entries
  // are dropped before the real run appends them again.
  const actionsBefore = actions.length;
  const preview = editSettingsFile(io, path, edit, true);
  if (!preview.ok) return failed(command, preview.failure);
  const shadow = findShadow(io, ctx, path, preview.text, written, true);
  if (shadow !== undefined) {
    if (!dryRun) shadow.message = `${shadow.message} Nothing was written.`;
    return failed(command, shadow, {
      ...(dryRun ? { dryRun: true } : {}),
      actions,
      restartRequired: false,
      data: { path: preview.path, layer, changed: false },
    });
  }

  actions.length = actionsBefore;
  const result = dryRun ? preview : editSettingsFile(io, path, edit, false);
  if (!result.ok) return failed(command, result.failure);
  const data = { path: result.path, layer, changed: result.changed };

  const summary = !result.changed
    ? `${command}: ${result.path} already says this; nothing written.`
    : dryRun
      ? `${command}: would write ${result.path} (${layer} layer).`
      : `${command}: wrote ${result.path} (${layer} layer).`;
  return {
    command,
    ok: true,
    exitCode: 0,
    summary,
    ...(dryRun ? { dryRun: true } : {}),
    actions: result.changed ? actions : [],
    restartRequired: !dryRun && result.changed,
    data,
  };
}

/** `parent[key]` as an object, created when absent; a refusal when it is anything else. */
function childObject(parent: Json, key: string, path: string): { value: Json } | Failure {
  const current = parent[key];
  if (current === undefined) {
    const created: Json = {};
    parent[key] = created;
    return { value: created };
  }
  if (isPlainObject(current)) return { value: current };
  return {
    code: "settings_malformed",
    message: `"${key}" in ${path} is not an object; the file was not changed.`,
    remedy: `Fix "${key}" in ${path} by hand, then run the command again.`,
  };
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(text: string | undefined): Json | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** JSON with sorted keys: equality that ignores key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? "undefined";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isPlainObject(value)) {
    const out: Json = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
