/**
 * rg-shim-removal.ts — the code-search 8.1 `rg` shim: how `status` reports it, and
 * `remove-rg-shim`, which deletes it.
 *
 * Up to 8.1, code-search shipped a ripgrep shim that a user could put at
 * `~/.local/bin/rg`, together with `env.USE_BUILTIN_RIPGREP: "0"` in the user settings so
 * the Grep tool would prefer it. The shim never reached an engine (it ran Claude Code's
 * own embedded ripgrep), and code-search no longer ships it. A machine that installed it
 * keeps a file this plugin no longer maintains, sitting ahead of every other `rg` on PATH.
 *
 * WHAT COUNTS AS OURS: a REGULAR file (lstat, never a symlink) at `<home>/.local/bin/rg`
 * whose first 512 bytes hold the line `# OWNER=code-search`, terminated within those bytes
 * (or ending the file). Anything else at that path belongs to someone else: mnemex writes
 * `# OWNER=mnemex`, and a real ripgrep binary has no such line. It is never touched.
 *
 * `remove-rg-shim`, in this order:
 *   1. Find the shim. None → nothing to do (exit 0). Not ours → `rg_shim_foreign` (exit 1),
 *      nothing changed.
 *   2. When the user layer's `env.USE_BUILTIN_RIPGREP` is exactly `"0"`, preview that edit
 *      first, so a settings file the writer would refuse stops the command before the shim
 *      is deleted rather than after.
 *   3. Delete the shim, after checking that the path still names the file step 1 read.
 *   4. Only then, and only because THIS run removed a marked shim, delete
 *      `env.USE_BUILTIN_RIPGREP` from the user layer when it is still exactly `"0"`. A
 *      `"0"` with no marked shim is somebody's deliberate setting (they may have their own
 *      `rg` on PATH): `status` reports it and nothing here changes it.
 *
 * Claude Code reads `USE_BUILTIN_RIPGREP` and resolves `rg` once, at startup, so running
 * sessions keep using whatever they started with: the summary says to restart them.
 */

import { join } from "node:path";

import { layerPath } from "../../mcp/setup/check";
import type { SetupContext, SetupIo } from "./io";
import { failed, type Outcome } from "./report";
import { editSettingsFile, type Json, type SettingsEdit } from "./settings-writer";

export const RG_SHIM_COMMAND = "remove-rg-shim";
/** The marker line a code-search shim carries in its header. */
export const RG_SHIM_OWNER_LINE = "# OWNER=code-search";
/** How much of the file's head is searched for the marker. */
export const RG_SHIM_HEAD_BYTES = 512;
export const RIPGREP_ENV = "USE_BUILTIN_RIPGREP";
/** The only value `remove-rg-shim` deletes: what the 8.1 install instructions set. */
export const RIPGREP_ENV_OFF = "0";

/** `status` line when the 8.1 shim is installed. */
export const RG_SHIM_FINDING = "rg shim from code-search 8.1 at ~/.local/bin/rg";
/** `status` line when the user layer prefers a system rg but no code-search shim exists. */
export const RIPGREP_ENV_WITHOUT_SHIM =
  'USE_BUILTIN_RIPGREP is "0" in user settings and no code-search rg shim is installed; the Grep tool needs an rg on PATH';
export const RESTART_GREP_SESSIONS = "restart sessions that use the Grep tool";

export function rgShimPath(home: string): string {
  return join(home, ".local", "bin", "rg");
}

/**
 * The marker test, pure. A line counts only when it is complete inside the head: a longer
 * owner value cut at byte 512 (`# OWNER=code-search-fork`) must not read as ours.
 */
export function headHasOwnerLine(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, RG_SHIM_HEAD_BYTES);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head);
  const lines: string[] = text.split("\n");
  // The last element is complete only if the whole file fit in the head.
  const complete: string[] = bytes.length <= RG_SHIM_HEAD_BYTES ? lines : lines.slice(0, -1);
  return complete.some((line: string) => line.replace(/\r$/u, "") === RG_SHIM_OWNER_LINE);
}

/** The `OWNER=` value from a foreign shim's head, for the refusal message. */
function ownerOf(bytes: Uint8Array): string | undefined {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, RG_SHIM_HEAD_BYTES));
  const match = /^# OWNER=(\S+)/mu.exec(text);
  return match?.[1];
}

export type RgShimState =
  | { kind: "absent"; path: string }
  /** `id` pins the object that was read, so the delete can prove it is the same one. */
  | { kind: "ours"; path: string; id: string }
  | { kind: "other"; path: string; why: string };

export function findRgShim(io: SetupIo, home: string): RgShimState {
  const path = rgShimPath(home);
  const info = io.lstatInfo(path);
  if (info === undefined) {
    // lstat failed. Missing is the common case; a path we cannot even stat is not ours.
    return io.lstatKind(path) === "missing" ? { kind: "absent", path } : { kind: "other", path, why: "it cannot be inspected" };
  }
  if (info.type !== "file") return { kind: "other", path, why: `it is a ${info.type}, not a regular file` };
  const bytes = io.readBytes(path);
  if (bytes === undefined) return { kind: "other", path, why: "it cannot be read" };
  if (headHasOwnerLine(bytes)) return { kind: "ours", path, id: info.id };
  const owner = ownerOf(bytes);
  return { kind: "other", path, why: owner === undefined ? "it carries no code-search marker" : `its owner is ${owner}` };
}

/** The user layer's `env.USE_BUILTIN_RIPGREP`, as written; undefined when unset or unreadable. */
export function userRipgrepEnv(io: SetupIo, ctx: SetupContext): unknown {
  const text = io.readText(layerPath("user", ctx.home, ctx.projectDir));
  if (text === undefined) return undefined;
  try {
    const root: unknown = JSON.parse(text);
    if (!isPlainObject(root)) return undefined;
    const env = root["env"];
    return isPlainObject(env) ? env[RIPGREP_ENV] : undefined;
  } catch {
    return undefined;
  }
}

/** What `status` says about the 8.1 shim. Reads only; changes nothing. */
export interface RgShimReport {
  /** `RG_SHIM_FINDING` when the marked shim is installed. */
  finding?: string;
  /** `RIPGREP_ENV_WITHOUT_SHIM` when the user layer says `"0"` and no marked shim exists. */
  envWithoutShim?: string;
}

export function rgShimReport(io: SetupIo, ctx: SetupContext): RgShimReport {
  const state = findRgShim(io, ctx.home);
  if (state.kind === "ours") return { finding: RG_SHIM_FINDING };
  if (userRipgrepEnv(io, ctx) === RIPGREP_ENV_OFF) return { envWithoutShim: RIPGREP_ENV_WITHOUT_SHIM };
  return {};
}

/** Deletes the key only while it is still exactly `"0"`; drops an `env` left empty. */
const deleteRipgrepEnv: SettingsEdit = (root: Json) => {
  const env = root["env"];
  if (env === undefined) return undefined;
  if (!isPlainObject(env)) {
    return {
      code: "settings_malformed",
      message: `"env" in the user settings is not an object; the file was not changed.`,
      remedy: `Fix "env" by hand, then run ${RG_SHIM_COMMAND} again.`,
    };
  }
  if (env[RIPGREP_ENV] !== RIPGREP_ENV_OFF) return undefined;
  delete env[RIPGREP_ENV];
  if (Object.keys(env).length === 0) delete root["env"];
  return undefined;
};

export interface RemoveRgShimOptions {
  dryRun: boolean;
}

export function removeRgShim(io: SetupIo, ctx: SetupContext, opts: RemoveRgShimOptions): Outcome {
  const command = RG_SHIM_COMMAND;
  const state = findRgShim(io, ctx.home);

  if (state.kind === "absent") {
    const note = userRipgrepEnv(io, ctx) === RIPGREP_ENV_OFF ? [RIPGREP_ENV_WITHOUT_SHIM] : [];
    return {
      command,
      ok: true,
      exitCode: 0,
      summary: `${command}: no rg shim at ~/.local/bin/rg; nothing to remove.`,
      ...(opts.dryRun ? { dryRun: true } : {}),
      actions: [],
      ...(note.length > 0 ? { details: note } : {}),
      data: { path: state.path, removed: false, envDeleted: false },
    };
  }

  if (state.kind === "other") {
    return failed(command, {
      code: "rg_shim_foreign",
      message: `${state.path} is not code-search's rg shim (${state.why}); it was left alone.`,
      remedy: `${command} removes only a file marked "${RG_SHIM_OWNER_LINE}". If you installed this rg yourself, keep or remove it by hand.`,
      path: state.path,
    }, { data: { path: state.path, removed: false, envDeleted: false } });
  }

  const settingsPath = layerPath("user", ctx.home, ctx.projectDir);
  const clearEnv = userRipgrepEnv(io, ctx) === RIPGREP_ENV_OFF;
  const actions = [`delete ${state.path}`];
  if (clearEnv) {
    // Step 2: a settings file the writer would refuse stops us before anything changes.
    const preview = editSettingsFile(io, settingsPath, deleteRipgrepEnv, true);
    if (!preview.ok) return failed(command, preview.failure, { data: { path: state.path, removed: false, envDeleted: false } });
    if (preview.changed) actions.push(`${preview.path}: delete env.${RIPGREP_ENV}`);
  }

  if (opts.dryRun) {
    return {
      command,
      ok: true,
      exitCode: 0,
      summary: `${command}: would remove the ${RG_SHIM_FINDING}.`,
      dryRun: true,
      actions,
      data: { path: state.path, removed: false, envDeleted: false },
    };
  }

  // Step 3: the name must still point at the object that was read and judged ours.
  if (io.lstatInfo(state.path)?.id !== state.id) {
    return failed(command, {
      code: "rg_shim_changed",
      message: `${state.path} changed while ${command} was checking it; nothing was removed.`,
      remedy: `Run ${command} again.`,
      path: state.path,
    }, { data: { path: state.path, removed: false, envDeleted: false } });
  }
  try {
    io.unlink(state.path);
  } catch (error) {
    return failed(command, {
      code: "rg_shim_remove_failed",
      message: `Could not delete ${state.path}: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`,
      path: state.path,
    }, { data: { path: state.path, removed: false, envDeleted: false } });
  }

  // Step 4: only because this run removed a marked shim.
  let envDeleted = false;
  if (clearEnv) {
    const result = editSettingsFile(io, settingsPath, deleteRipgrepEnv, false);
    if (!result.ok) {
      return failed(command, {
        ...result.failure,
        message: `Removed ${state.path}, but ${result.failure.message}`,
      }, { actions: [`delete ${state.path}`], data: { path: state.path, removed: true, envDeleted: false } });
    }
    envDeleted = result.changed;
  }

  return {
    command,
    ok: true,
    exitCode: 0,
    summary: `${command}: removed the ${RG_SHIM_FINDING}; ${RESTART_GREP_SESSIONS}.`,
    actions: envDeleted ? actions : [`delete ${state.path}`],
    data: { path: state.path, removed: true, envDeleted },
  };
}

function isPlainObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
