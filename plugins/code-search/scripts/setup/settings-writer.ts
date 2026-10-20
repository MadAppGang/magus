/**
 * settings-writer.ts — every settings file write the setup CLI makes, and the two
 * subcommands that are nothing but a settings write: `configure` and `dismiss`. The one
 * other writer is `remove-rg-shim` (rg-shim-removal.ts), which deletes the user layer's
 * `env.USE_BUILTIN_RIPGREP` through the same `editSettingsFile`.
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
 *   6. Pin the object the target names under a private hard link (the guard). If its
 *      bytes differ from what step 3 read, or the target no longer names it, someone else
 *      wrote it meanwhile → `settings_changed_concurrently`, temp removed, nothing written.
 *   7. Rename the temp over the target (a target that did not exist is created with
 *      `link`, which refuses a name that appeared meanwhile; on a filesystem without hard
 *      links, with an exclusive open, which refuses it too). If the guard's bytes changed
 *      by then, another program wrote the file in place inside the window: its version is
 *      put back and the result is `settings_changed_concurrently`, never success. What
 *      stays open: a writer that replaces the target BY RENAME in the microseconds between
 *      the identity check and this rename (no atomic swap is reachable from Node).
 *      A process killed mid-write can leave `.<name>.<suffix>.tmp` or `.guard` beside the
 *      target. Both carry the target's own mode (the guard IS the old file's inode), so
 *      nothing is exposed that the settings file did not already expose; they are not
 *      swept, because deleting by name pattern inside ~/.claude is the riskier act.
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
 * A MAGUS-PROFILED PROJECT (`.claude/profiles.json` exists): `.claude/settings.json` is
 * magus's generated output and profiles.json is the one source of truth, so a
 * project-layer write (configure or dismiss) goes ONLY into
 * `profiles[<active>].settings["code-search"]` in profiles.json, through the same A4 write.
 * settings.json is never written on that route and never a fallback. The active profile
 * is `.claude/profiles/active.json` `profile` (no marker → `profile_not_active`); magus
 * must be on PATH before anything is written (`magus_missing`). `magus profile list`
 * (cwd = project, no shell) runs once before profiles.json is read and once after the
 * write to regenerate settings.json, which must then carry exactly what was written
 * (`profile_render_failed`, `profile_not_rendered`). A dry run starts no magus process.
 * The value is absent while a profile without it is active. The local and user layers,
 * and projects without profiles.json, are written directly and make no magus call.
 *
 * SHADOWING (A1): before writing, the three layers are merged with the edited text in
 * place of the target. If the merged value of a key to be written is not what would be
 * written, a more specific layer overrides it, and the command fails `layer_shadowed`
 * naming that file, with nothing written. Writing first would leave a change with no
 * effect in this project, and on the user layer an effect in every other project.
 */

import { basename, dirname, join } from "node:path";

import { catalogEntry } from "../../mcp/adapters/catalog";
import { enabledLayers, layerPath, LAYER_NAMES, whichOnPath, type LayerName } from "../../mcp/setup/check";
import { loadSettings, SETTINGS_KEY } from "../../mcp/core/settings";
import type { SetupContext, SetupIo } from "./io";
import {
  failed,
  processFailure,
  processSucceeded,
  type Failure,
  type Outcome,
  type ProcessFailure,
} from "./report";

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

  // 6-7. Replace exactly the object step 3 read, or nothing.
  const concurrent = (): EditResult =>
    refuse(
      "settings_changed_concurrently",
      `${path} changed while this command was editing it; nothing was written.`,
      "Run the command again.",
    );
  const done: EditResult = { ok: true, path, changed: true, text };

  // No file at step 3: link() creates the name and refuses an existing one, so a file
  // another program created meanwhile is never replaced. A filesystem without hard links
  // (FAT/exFAT, most SMB and FUSE mounts) creates it with an exclusive open instead: the
  // same refusal of a name that appeared, but not atomic, so a reader may see the file
  // while its bytes are still being written.
  if (before === undefined) {
    try {
      io.link(temp, path);
    } catch (error) {
      if (errorCode(error) === "EEXIST") return concurrent();
      return createExclusively(io, path, text, done, concurrent, refuse, errorText(error));
    } finally {
      io.removeQuietly(temp);
    }
    return done;
  }

  // A file at step 3. Pin the object the path names NOW under a private hard link (the
  // guard): it must hold exactly `before`, and the path must still name it (dev:ino)
  // immediately before the rename. A writer that changes the file in place between that
  // check and the rename writes into the pinned object, so the guard still shows it
  // afterwards: its version is put back and the edit is refused, never reported as done.
  // Residual: a writer that REPLACES the path by rename in the microseconds between the
  // identity check and this rename is overwritten. An atomic swap (renameat2
  // RENAME_EXCHANGE, renamex_np RENAME_SWAP) would close it; Node exposes neither.
  const guard = join(dir, `.${basename(path)}.${io.uniqueSuffix()}.guard`);
  try {
    io.link(path, guard);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      io.removeQuietly(temp);
      return concurrent();
    }
    // A filesystem without hard links: the same checks, without the after-the-fact one.
    const id = io.lstatInfo(path)?.id;
    if (io.readText(path) !== before || id === undefined || io.lstatInfo(path)?.id !== id) {
      io.removeQuietly(temp);
      return concurrent();
    }
    return replace(io, temp, path, done, refuse);
  }
  let keepGuard = false;
  try {
    const pinned = io.lstatInfo(guard)?.id;
    if (pinned === undefined || io.readText(guard) !== before || io.lstatInfo(path)?.id !== pinned) {
      io.removeQuietly(temp);
      return concurrent();
    }
    const replaced = replace(io, temp, path, done, refuse);
    if (!replaced.ok) return replaced;
    if (io.readText(guard) === before) return done;
    // Changed in place in the window: the other program's version is in the guard.
    try {
      io.rename(guard, path);
      return refuse(
        "settings_changed_concurrently",
        `${path} was changed by another program while this command replaced it; its version was put back and this edit was not applied.`,
        "Run the command again.",
      );
    } catch (error) {
      keepGuard = true;
      return refuse(
        "settings_changed_concurrently",
        `${path} was changed by another program while this command replaced it, and its version could not be put back ` +
          `(${errorText(error)}). It is kept in ${guard}; compare it with ${path} by hand.`,
      );
    }
  } finally {
    if (!keepGuard) io.removeQuietly(guard);
  }
}

/**
 * Step 7 for a new file where `link` failed for a reason other than EEXIST: create the
 * name with O_EXCL and write the text into it. An existing name is never replaced
 * (EEXIST → `settings_changed_concurrently`). When the open succeeded but the write did
 * not, the partial file is ours only while it still holds a prefix of `text`: then it is
 * removed; anything else at the name belongs to another program and is left alone.
 */
function createExclusively(
  io: SetupIo,
  path: string,
  text: string,
  done: EditResult,
  concurrent: () => EditResult,
  refuse: (code: string, message: string, remedy?: string) => EditResult,
  linkError: string,
): EditResult {
  try {
    io.writeNew(path, text, 0o600);
    return done;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return concurrent();
    const syscall = (error as { syscall?: unknown } | null)?.syscall;
    if (syscall !== "open") {
      const now = io.readText(path);
      if (now === text) return done; // every byte is there; only the mode change failed
      if (now !== undefined && text.startsWith(now)) io.removeQuietly(path);
    }
    return refuse(
      "settings_write_failed",
      `Could not create ${path}: a hard link failed (${linkError}) and so did an exclusive create (${errorText(error)}).`,
    );
  }
}

/** The final rename of step 7; the temp is gone afterwards either way. */
function replace(
  io: SetupIo,
  temp: string,
  path: string,
  done: EditResult,
  refuse: (code: string, message: string, remedy?: string) => EditResult,
): EditResult {
  try {
    io.rename(temp, path);
    return done;
  } catch (error) {
    io.removeQuietly(temp);
    return refuse("settings_write_failed", `Could not replace ${path}: ${errorText(error)}`);
  }
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
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

export async function configure(io: SetupIo, ctx: SetupContext, target: string, opts: ConfigureOptions): Promise<Outcome> {
  const command = `configure ${target}`;
  const invalid = invalidSettingsLayer(io, ctx, command, opts.dryRun);
  if (invalid !== undefined) return invalid;
  const { layer, path: layerFile } = targetFor(io, ctx, "configure", opts.layer);
  const profile = layer === "project" ? profileTarget(io, ctx, command, opts.dryRun) : undefined;
  if (profile !== undefined && "outcome" in profile) return profile.outcome;
  const path = profile?.path ?? layerFile;
  const keyPrefix = profile === undefined ? SETTINGS_KEY : `profiles.${profile.id}.settings.${SETTINGS_KEY}`;
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
    actions.push(`${path}: ${keyPrefix}.engine = false, ${keyPrefix}.setup = "active"`);
  } else {
    const entry = catalogEntry(target);
    if (entry === undefined) throw new TypeError(`configure: ${target} is not a catalog id`); // parser guards this
    const wanted = JSON.parse(JSON.stringify(entry.settings)) as Json;
    actions.push(`${path}: ${keyPrefix}.engine = "${target}", ${keyPrefix}.setup = "active"`);
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
        actions.push(`${path}: ${keyPrefix}.engines.${target} = ${canonical(wanted)}`);
      }
      return undefined;
    };
    written.push(
      { kind: "block", key: "engine", value: target },
      { kind: "block", key: "setup", value: "active" },
      { kind: "engineBlock", id: target, value: wanted },
    );
  }

  return profile === undefined
    ? applyAndCheck(io, ctx, command, path, layer, edit, written, opts.dryRun, actions)
    : applyToProfile(io, ctx, command, profile, layer, edit, written, opts.dryRun, actions);
}

// ---------------------------------------------------------------------------
// dismiss
// ---------------------------------------------------------------------------

export interface DismissOptions {
  layer?: "local" | "project";
  dryRun: boolean;
}

export async function dismiss(io: SetupIo, ctx: SetupContext, opts: DismissOptions): Promise<Outcome> {
  const invalid = invalidSettingsLayer(io, ctx, "dismiss", opts.dryRun);
  if (invalid !== undefined) return invalid;
  const { layer, path: layerFile } = targetFor(io, ctx, "dismiss", opts.layer);
  const profile = layer === "project" ? profileTarget(io, ctx, "dismiss", opts.dryRun) : undefined;
  if (profile !== undefined && "outcome" in profile) return profile.outcome;
  const path = profile?.path ?? layerFile;
  const keyPrefix = profile === undefined ? SETTINGS_KEY : `profiles.${profile.id}.settings.${SETTINGS_KEY}`;
  const edit: SettingsEdit = (root) => {
    const block = childObject(root, SETTINGS_KEY, path);
    if ("code" in block) return block;
    block.value["setup"] = "dismissed";
    return undefined;
  };
  const written: WrittenKey[] = [{ kind: "block", key: "setup", value: "dismissed" }];
  const actions = [`${path}: ${keyPrefix}.setup = "dismissed"`];
  return profile === undefined
    ? applyAndCheck(io, ctx, "dismiss", path, layer, edit, written, opts.dryRun, actions)
    : applyToProfile(io, ctx, "dismiss", profile, layer, edit, written, opts.dryRun, actions);
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

// ---------------------------------------------------------------------------
// A magus-profiled project: the project layer is the active profile
// ---------------------------------------------------------------------------

/** Deadline for one `magus profile list`. magus loads the project's .env, which can block. */
const MAGUS_RENDER_TIMEOUT_MS = 60_000;

export interface ProfileTarget {
  /** `.claude/profiles.json`, as named. */
  path: string;
  /** The profile active in this checkout (`.claude/profiles/active.json` `profile`). */
  id: string;
  /** The magus binary found on PATH. */
  magus: string;
}

/**
 * Where a project-layer write goes in a magus-profiled project, or a refusal that wrote
 * nothing; undefined when the project has no `.claude/profiles.json`. Starts no process.
 * The active profile is the checkout's marker, never the manifest's `default`: with no
 * marker magus regenerates nothing, so a write to `default` would never reach settings.json.
 */
function profileTarget(
  io: SetupIo,
  ctx: SetupContext,
  command: string,
  dryRun: boolean,
): ProfileTarget | { outcome: Outcome } | undefined {
  const path = join(ctx.projectDir, ".claude", "profiles.json");
  if (io.kind(path) !== "file") return undefined;
  const refuse = (failure: Failure): { outcome: Outcome } => ({
    outcome: failed(command, failure, dryRun ? { dryRun: true } : {}),
  });

  const text = io.readText(path);
  if (text === undefined) {
    return refuse({ code: "settings_unreadable", message: `${path} exists but could not be read; nothing was written.`, path });
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return refuse({
      code: "settings_malformed",
      message: `${path} is not valid JSON (${errorText(error)}); nothing was written.`,
      remedy: `Fix ${path} by hand, then run the command again.`,
      path,
    });
  }
  const profiles = isPlainObject(manifest) ? manifest["profiles"] : undefined;
  if (!isPlainObject(profiles)) {
    return refuse({
      code: "settings_malformed",
      message: `"profiles" in ${path} is missing or not an object; nothing was written.`,
      remedy: `Fix "profiles" in ${path} by hand, then run the command again.`,
      path,
    });
  }

  const markerPath = join(ctx.projectDir, ".claude", "profiles", "active.json");
  const id = parseObject(io.readText(markerPath))?.["profile"];
  if (typeof id !== "string") {
    return refuse({
      code: "profile_not_active",
      message: "This project uses magus profiles, but no profile is active in this checkout; nothing was written.",
      remedy: `Run magus update in ${ctx.projectDir}, then run this again.`,
      path: markerPath,
    });
  }
  if (!Object.hasOwn(profiles, id)) {
    const ids = Object.keys(profiles);
    return refuse(
      ids.length === 0
        ? {
            code: "profile_not_active",
            message: `This project uses magus profiles, but ${path} defines none; nothing was written.`,
            remedy: `Add a profile to ${path} with magus, then run this again.`,
            path,
          }
        : {
            code: "profile_not_active",
            message: `This project uses magus profiles, but the profile active in this checkout, "${id}", is not in ${path}; nothing was written.`,
            remedy: `Run magus profile switch <profile> in ${ctx.projectDir} (profiles: ${ids.join(", ")}), then run this again.`,
            path,
          },
    );
  }

  const magus = whichOnPath("magus", io.env["PATH"], io);
  if (magus === undefined) {
    return refuse({
      code: "magus_missing",
      message: "Settings in this project are generated by magus from .claude/profiles.json, and magus is not on PATH; nothing was written.",
      remedy: "Install magus (bun add -g magus-cli), or use --layer local.",
      path,
    });
  }
  return { path, id, magus };
}

/** `edit`, applied to `profiles[<id>].settings` of a profiles.json root instead of the root. */
function scopeToProfile(edit: SettingsEdit, target: ProfileTarget): SettingsEdit {
  return (root) => {
    const profiles = root["profiles"];
    if (!isPlainObject(profiles)) {
      return {
        code: "settings_malformed",
        message: `"profiles" in ${target.path} is missing or not an object; the file was not changed.`,
        remedy: `Fix "profiles" in ${target.path} by hand, then run the command again.`,
      };
    }
    const entry = Object.hasOwn(profiles, target.id) ? profiles[target.id] : undefined;
    if (entry === undefined) {
      return {
        code: "profile_not_active",
        message: `The profile active in this checkout, "${target.id}", is no longer in ${target.path}; the file was not changed.`,
        remedy: "Run magus profile switch <profile> in this project, then run this again.",
      };
    }
    const profile = childObject(profiles, target.id, target.path);
    if ("code" in profile) return profile;
    const settings = childObject(profile.value, "settings", target.path);
    if ("code" in settings) return settings;
    return edit(settings.value);
  };
}

/** The `code-search` block of profile `id` in a profiles.json text. */
function profileBlock(text: string, id: string): unknown {
  const entry = parseObject(text)?.["profiles"];
  if (!isPlainObject(entry)) return undefined;
  const profile = entry[id];
  if (!isPlainObject(profile) || !isPlainObject(profile["settings"])) return undefined;
  return profile["settings"][SETTINGS_KEY];
}

/** settings.json as magus will render it: today's file with the profile's block in place. */
function predictedRender(io: SetupIo, settingsPath: string, block: unknown): string {
  const next: Json = { ...(parseObject(io.readText(settingsPath)) ?? {}) };
  if (block === undefined) delete next[SETTINGS_KEY];
  else next[SETTINGS_KEY] = block;
  return `${JSON.stringify(next, null, 2)}\n`;
}

/** `magus profile list` in the project: regenerates settings.json. A failure as R8, or undefined. */
async function renderProfiles(io: SetupIo, ctx: SetupContext, target: ProfileTarget): Promise<ProcessFailure | undefined> {
  const argv = [target.magus, "profile", "list"];
  const result = await io.run(argv, { cwd: ctx.projectDir, timeoutMs: MAGUS_RENDER_TIMEOUT_MS });
  return processSucceeded(result) ? undefined : processFailure(argv, result);
}

/** What settings.json carries for one written key. */
function renderedValue(root: Json | undefined, key: WrittenKey): unknown {
  const block = root?.[SETTINGS_KEY];
  if (!isPlainObject(block)) return undefined;
  if (key.kind === "block") return block[key.key];
  return isPlainObject(block["engines"]) ? block["engines"][key.id] : undefined;
}

/**
 * The profile route of `applyAndCheck`: write the active profile in profiles.json, have
 * magus regenerate settings.json, and prove settings.json carries what was written.
 * settings.json itself is never written here. A dry run starts no magus process.
 */
async function applyToProfile(
  io: SetupIo,
  ctx: SetupContext,
  command: string,
  target: ProfileTarget,
  layer: LayerName,
  edit: SettingsEdit,
  written: readonly WrittenKey[],
  dryRun: boolean,
  actions: string[],
): Promise<Outcome> {
  const settingsPath = layerPath("project", ctx.home, ctx.projectDir);
  const scoped = scopeToProfile(edit, target);
  const regenerate = `Run magus profile list in ${ctx.projectDir} to regenerate .claude/settings.json.`;

  // What this project ran on before magus touched anything: the preflight below can
  // regenerate settings.json, and a change it makes is a change the user must restart for.
  const liveBeforePreflight = dryRun ? undefined : parseObject(io.readText(settingsPath))?.[SETTINGS_KEY];

  // Preflight: proves magus works before anything is written, and lets magus take in any
  // edit still pending in settings.json before profiles.json is read.
  if (!dryRun) {
    const preflight = await renderProfiles(io, ctx, target);
    if (preflight !== undefined) {
      return failed(
        command,
        {
          code: "profile_render_failed",
          message: `magus could not regenerate ${settingsPath} from ${target.path}; nothing was written.`,
          remedy: `${regenerate} Fix what it reports, then run this again.`,
          path: target.path,
          process: preflight,
        },
        { restartRequired: false, data: { path: target.path, layer, profile: target.id, changed: false } },
      );
    }
  }

  const actionsBefore = actions.length;
  const preview = editSettingsFile(io, target.path, scoped, true);
  if (!preview.ok) return failed(command, preview.failure);
  const block = profileBlock(preview.text, target.id);
  const shadow = findShadow(io, ctx, settingsPath, predictedRender(io, settingsPath, block), written, true);
  if (shadow !== undefined) {
    // The preflight may already have regenerated settings.json, so only profiles.json is
    // known untouched.
    if (!dryRun) shadow.message = `${shadow.message} Nothing was written to ${target.path}.`;
    return failed(command, shadow, {
      ...(dryRun ? { dryRun: true } : {}),
      actions,
      restartRequired: false,
      data: { path: preview.path, layer, profile: target.id, changed: false },
    });
  }

  actions.length = actionsBefore;
  const result = dryRun ? preview : editSettingsFile(io, target.path, scoped, false);
  if (!result.ok) return failed(command, result.failure);
  const where = `profile "${target.id}" in ${result.path}`;
  const data = { path: result.path, layer, profile: target.id, changed: result.changed };

  if (dryRun) {
    return {
      command,
      ok: true,
      exitCode: 0,
      summary: result.changed
        ? `${command}: would write ${where}; magus would regenerate ${settingsPath}.`
        : `${command}: ${where} already says this; nothing written.`,
      dryRun: true,
      actions: result.changed ? actions : [],
      restartRequired: false,
      data,
    };
  }

  const liveBefore = parseObject(io.readText(settingsPath))?.[SETTINGS_KEY];
  if (!result.changed && canonical(liveBefore) === canonical(block)) {
    if (canonical(liveBeforePreflight) !== canonical(liveBefore)) {
      return {
        command,
        ok: true,
        exitCode: 0,
        summary: `${command}: ${where} already says this; magus regenerated ${settingsPath}, which did not.`,
        actions: [`magus profile list (in ${ctx.projectDir}): regenerated ${settingsPath}`],
        restartRequired: true,
        data: { ...data, regenerated: settingsPath },
      };
    }
    return {
      command,
      ok: true,
      exitCode: 0,
      summary: `${command}: ${where} already says this, and so does ${settingsPath}; nothing written.`,
      actions: [],
      restartRequired: false,
      data,
    };
  }

  const done = result.changed ? actions : [];
  const render = await renderProfiles(io, ctx, target);
  if (render !== undefined) {
    return failed(
      command,
      {
        code: "profile_render_failed",
        message: result.changed
          ? `Wrote ${where}, but magus could not regenerate ${settingsPath}, so this project does not use it yet.`
          : `${where} already says this, but magus could not regenerate ${settingsPath}, so this project does not use it yet.`,
        remedy: regenerate,
        path: result.path,
        process: render,
      },
      { actions: done, restartRequired: false, data },
    );
  }

  const live = parseObject(io.readText(settingsPath));
  for (const key of written) {
    const value = renderedValue(live, key);
    if (canonical(value) === canonical(key.value)) continue;
    return failed(
      command,
      {
        code: "profile_not_rendered",
        message:
          `${where} sets ${SETTINGS_KEY}.${key.kind === "block" ? key.key : `engines.${key.id}`} to ${canonical(key.value)}, but after magus regenerated ` +
          `${settingsPath} it has ${value === undefined ? "nothing there" : canonical(value)}, so this project does not use the new value.`,
        remedy: `Run magus profile list in ${ctx.projectDir}, then compare ${settingsPath} with ${where}.`,
        path: settingsPath,
      },
      { actions: done, restartRequired: false, data: { ...data, regenerated: settingsPath } },
    );
  }

  return {
    command,
    ok: true,
    exitCode: 0,
    summary: result.changed
      ? `${command}: wrote ${where}; magus regenerated ${settingsPath}.`
      : `${command}: ${where} already says this; magus regenerated ${settingsPath}.`,
    actions: [...done, `magus profile list (in ${ctx.projectDir}): regenerated ${settingsPath}`],
    restartRequired: true,
    data: { ...data, regenerated: settingsPath },
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
