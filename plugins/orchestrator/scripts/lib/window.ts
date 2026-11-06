// Pure core of ticket-window.ts. No IO: nothing here reads the clock, the
// environment, the filesystem or the process table. Time, environment values,
// the home directory and pid liveness are passed in by the caller, so every
// function is a plain mapping from its arguments to its result.

import { join } from "node:path";

/** The nine tokens Claude Code's `/color` accepts. */
const COLOURS = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan", "default"] as const;

export type Colour = (typeof COLOURS)[number];

/** Window and worktree name: lower case, starts alphanumeric, at most 48 characters. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/;
/** A launch command: words of safe characters separated by single spaces. */
const LAUNCH_RE = /^[A-Za-z0-9_./~-]+( [A-Za-z0-9_./~=-]+)*$/;
const MODEL_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const EFFORT_RE = /^[a-z]+$/;

/** A lock whose holder recorded a start longer ago than this is stale. */
const LOCK_MAX_AGE_MS = 16 * 60_000;
/** A lock directory without its info file is fresh (still being written) for this long. */
const LOCK_FRESH_WITHOUT_INFO_MS = 5_000;

const VALUE_FLAGS = new Set([
  "name",
  "colour",
  "color",
  "prompt",
  "dir",
  "session",
  "split",
  "model",
  "effort",
  "launch",
  "deliver-to",
  "lock",
]);
const BOOLEAN_FLAGS = new Set(["no-wait", "dry-run"]);
const DELIVER_FLAGS = new Set(["deliver-to", "prompt", "lock"]);

/** Arguments for opening a window or pane (stage 1). */
export interface StartArgs {
  mode: "start";
  name: string;
  colour: Colour;
  /** Text typed into Claude Code once it is up; "" when none was given. */
  prompt: string;
  dir?: string;
  session?: string;
  split?: string;
  model?: string;
  effort?: string;
  /** Launch command from `--launch`, else from `ORCHESTRATOR_LAUNCH`; absent means the default launch. */
  launch?: string;
  noWait: boolean;
  dryRun: boolean;
}

/** Arguments for the detached second stage that types the prompt. */
export interface DeliverArgs {
  mode: "deliver";
  pane: string;
  prompt: string;
  lock?: string;
}

export type ParseResult = { ok: true; args: StartArgs | DeliverArgs } | { ok: false; error: string };

/**
 * Parses the command-line arguments that follow the script path.
 *
 * - `argv`: the arguments only (for example `process.argv.slice(2)`). Every flag
 *   is `--flag value` or a bare boolean `--flag`; a value is always the next
 *   argument, taken literally, even when it is empty or starts with `--`.
 * - `env`: the environment. Only `ORCHESTRATOR_LAUNCH` is read, and only when
 *   `--launch` is absent; an empty value counts as unset.
 *
 * Returns `{ ok: true, args }` or `{ ok: false, error }` with a one-line reason;
 * every value echoed from the input is quoted as a JSON string, so a control
 * character in it is escaped rather than breaking the line. Never throws.
 * Errors: an unknown flag (including `--project`), a positional argument, a
 * flag given twice (`--colour` and `--color` count as the same flag),
 * a value flag with nothing after it, a missing or invalid `--name` or `--colour`,
 * an invalid `--model` (`^[a-z0-9][a-z0-9._-]*$`, any case) or `--effort`
 * (`^[a-z]+$`), an invalid launch command (from either source), an empty
 * `--dir`, `--session` or `--split`.
 *
 * With `--deliver-to <pane>` the result is `DeliverArgs`; only `--prompt` and
 * `--lock` may accompany it. `--lock` without `--deliver-to` is an error.
 */
export function parseArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): ParseResult {
  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) return { ok: false, error: `unexpected argument ${quote(token)}` };
    const flag = token.slice(2);
    const key = flag === "color" ? "colour" : flag;
    if (VALUE_FLAGS.has(flag)) {
      if (values.has(key)) return { ok: false, error: `--${flag} given more than once` };
      const value = argv[i + 1];
      if (value === undefined) return { ok: false, error: `--${flag} needs a value` };
      values.set(key, value);
      i++;
    } else if (BOOLEAN_FLAGS.has(flag)) {
      if (booleans.has(flag)) return { ok: false, error: `--${flag} given more than once` };
      booleans.add(flag);
    } else {
      return { ok: false, error: `unknown flag ${quote(token)}` };
    }
  }

  const pane = values.get("deliver-to");
  if (pane !== undefined) {
    for (const key of [...values.keys(), ...booleans]) {
      if (!DELIVER_FLAGS.has(key)) return { ok: false, error: `--${key} cannot be combined with --deliver-to` };
    }
    if (pane === "") return { ok: false, error: "--deliver-to needs a pane" };
    const lock = values.get("lock");
    return { ok: true, args: { mode: "deliver", pane, prompt: values.get("prompt") ?? "", ...(lock ? { lock } : {}) } };
  }
  if (values.has("lock")) return { ok: false, error: "--lock is internal and only valid with --deliver-to" };

  const name = values.get("name");
  const colour = values.get("colour");
  if (name === undefined) return { ok: false, error: "--name is required" };
  if (colour === undefined) return { ok: false, error: "--colour is required" };
  if (!NAME_RE.test(name)) {
    return {
      ok: false,
      error: `invalid name ${quote(name)}: lower-case letters, digits, dot, underscore, hyphen; starts with a letter or digit; at most 48 characters`,
    };
  }
  if (!isColour(colour)) return { ok: false, error: `invalid colour ${quote(colour)}; one of: ${COLOURS.join(" ")}` };

  const model = values.get("model");
  if (model !== undefined && !MODEL_RE.test(model)) return { ok: false, error: `invalid model ${quote(model)}` };
  const effort = values.get("effort");
  if (effort !== undefined && !EFFORT_RE.test(effort)) return { ok: false, error: `invalid effort ${quote(effort)}` };

  for (const key of ["dir", "session", "split"]) {
    if (values.get(key) === "") return { ok: false, error: `--${key} needs a value` };
  }

  const launchFlag = values.get("launch");
  const launchEnv = env.ORCHESTRATOR_LAUNCH;
  const launch = launchFlag ?? (launchEnv ? launchEnv : undefined);
  if (launch !== undefined && !LAUNCH_RE.test(launch)) {
    const source = launchFlag !== undefined ? "--launch" : "ORCHESTRATOR_LAUNCH";
    return {
      ok: false,
      error: `invalid launch command ${quote(launch)} from ${source}: words of letters, digits and _ . / ~ - separated by single spaces (= allowed after the first word)`,
    };
  }

  const args: StartArgs = {
    mode: "start",
    name,
    colour,
    prompt: values.get("prompt") ?? "",
    noWait: booleans.has("no-wait"),
    dryRun: booleans.has("dry-run"),
  };
  const dir = values.get("dir");
  const session = values.get("session");
  const split = values.get("split");
  if (dir !== undefined) args.dir = dir;
  if (session !== undefined) args.session = session;
  if (split !== undefined) args.split = split;
  if (model !== undefined) args.model = model;
  if (effort !== undefined) args.effort = effort;
  if (launch !== undefined) args.launch = launch;
  return { ok: true, args };
}

/**
 * Quotes a user-supplied value for an error message as a JSON string, so a
 * newline or other control character is escaped and the message stays on one line.
 */
function quote(value: string): string {
  return JSON.stringify(value);
}

function isColour(value: string): value is Colour {
  return (COLOURS as readonly string[]).includes(value);
}

/**
 * Maps the output of `git rev-parse --path-format=absolute --git-common-dir`
 * to the repository's main checkout.
 *
 * Surrounding whitespace (the trailing newline) and trailing slashes are
 * ignored. A path ending in `/.git` returns that path without `/.git`, the same
 * answer from the main checkout and from any of its worktrees. Returns `null`
 * when there is no main checkout to name: an empty or relative input, or a
 * common dir not named `.git` (a bare repository, a submodule's module dir).
 * Never throws.
 */
export function mainCheckoutFromCommonDir(commonDir: string): string | null {
  const trimmed = commonDir.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("/")) return null;
  if (!trimmed.endsWith("/.git")) return null;
  const checkout = trimmed.slice(0, -"/.git".length);
  return checkout === "" ? "/" : checkout;
}

/** What the shell line typed into the new pane needs. */
export interface LaunchSpec {
  name: string;
  colour: Colour;
  model?: string;
  effort?: string;
  /** A launch command; absent means the default `claude -w` launch. */
  launch?: string;
}

/**
 * Builds the shell line typed into the new pane:
 *
 *   git pull --ff-only && { ! command -v magus >/dev/null 2>&1 || magus update || echo "…"; } && <launch>
 *
 * `magus update` runs only where `magus` is installed, and its failure is
 * reported and does not stop the line. `<launch>` is, by default:
 *
 *   CLAUDE_WT_NAME=<name> CLAUDE_WT_COLOUR=<colour> claude -w <name> -n <name> [--model M] [--effort E] '/color <colour>'
 *
 * With `launch` set it is `<launch> <name> <colour>`, followed by
 * ` -- --model M --effort E` (only the flags given) when either is given.
 *
 * Throws an Error when any field fails the pattern `parseArgs` enforces, so a
 * value that could break the shell line never reaches it.
 */
export function buildLaunchLine(spec: LaunchSpec): string {
  if (!NAME_RE.test(spec.name)) throw new Error(`invalid name ${quote(spec.name)}`);
  if (!isColour(spec.colour)) throw new Error(`invalid colour ${quote(String(spec.colour))}`);
  if (spec.model !== undefined && !MODEL_RE.test(spec.model)) throw new Error(`invalid model ${quote(spec.model)}`);
  if (spec.effort !== undefined && !EFFORT_RE.test(spec.effort)) throw new Error(`invalid effort ${quote(spec.effort)}`);
  if (spec.launch !== undefined && !LAUNCH_RE.test(spec.launch)) throw new Error(`invalid launch ${quote(spec.launch)}`);

  const flags: string[] = [];
  if (spec.model !== undefined) flags.push("--model", spec.model);
  if (spec.effort !== undefined) flags.push("--effort", spec.effort);

  const launch =
    spec.launch === undefined
      ? [
          `CLAUDE_WT_NAME=${spec.name}`,
          `CLAUDE_WT_COLOUR=${spec.colour}`,
          "claude",
          "-w",
          spec.name,
          "-n",
          spec.name,
          ...flags,
          `'/color ${spec.colour}'`,
        ].join(" ")
      : [spec.launch, spec.name, spec.colour, ...(flags.length > 0 ? ["--", ...flags] : [])].join(" ");

  return (
    "git pull --ff-only && " +
    '{ ! command -v magus >/dev/null 2>&1 || magus update || echo "ticket-window: magus update failed; continuing without it"; } && ' +
    launch
  );
}

/**
 * Returns the lock directory for one main checkout: `<stateDir>/locks/<key>`,
 * where `<key>` is the checkout path with trailing slashes dropped, every run
 * of characters other than letters, digits, `_` and `-` replaced by one `-`,
 * and leading or trailing `-` trimmed. Case is kept. One checkout always maps
 * to one key, so two starts in the same checkout share a lock.
 *
 * Throws an Error when `checkout` is not absolute or leaves an empty key (`/`).
 */
export function lockPathFor(stateDirPath: string, checkout: string): string {
  if (!checkout.startsWith("/")) throw new Error(`checkout path must be absolute: ${quote(checkout)}`);
  const key = checkout
    .replace(/\/+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (key === "") throw new Error(`no lock key for checkout ${quote(checkout)}`);
  return join(stateDirPath, "locks", key);
}

/**
 * Returns the directory holding the log and the locks: `ORCHESTRATOR_STATE_DIR`
 * from `env` when set and non-empty, else `<home>/.claude/orchestrator`.
 * Trailing slashes are dropped.
 *
 * Throws an Error when the chosen path is not absolute (a relative
 * `ORCHESTRATOR_STATE_DIR`, or an empty or relative `home` when that is used).
 */
export function stateDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const fromEnv = env.ORCHESTRATOR_STATE_DIR;
  if (fromEnv) {
    if (!fromEnv.startsWith("/")) throw new Error(`ORCHESTRATOR_STATE_DIR must be an absolute path: ${quote(fromEnv)}`);
    return fromEnv.replace(/\/+$/, "") || "/";
  }
  if (!home.startsWith("/")) throw new Error(`home directory must be an absolute path: ${quote(home)}`);
  return join(home, ".claude", "orchestrator");
}

/**
 * True when a pane's `#{pane_current_command}` names a Claude Code TUI, which
 * reports its version string (`2.1.300`) as the foreground command. Surrounding
 * whitespace is ignored; anything other than three dot-separated numbers
 * (`zsh`, `node`, `2.1`, `v2.1.300`) is false.
 */
export function isClaudeForeground(paneCurrentCommand: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(paneCurrentCommand.trim());
}

/**
 * True when the prompt still sits unsubmitted in Claude Code's input box.
 *
 * `screen` is the captured pane text, lines separated by `\n`. The input box is
 * the last line whose first non-blank character is `❯`; the answer is whether
 * that line contains the first 40 characters of `prompt`. False when no such
 * line exists or `prompt` is empty. Used to decide on one more Enter, never on
 * typing the prompt again.
 */
export function promptStillInInput(screen: string, prompt: string): boolean {
  if (prompt === "") return false;
  const input = screen
    .split("\n")
    .filter((line) => line.trimStart().startsWith("❯"))
    .pop();
  return input !== undefined && input.includes(prompt.slice(0, 40));
}

/** What the caller observed about an existing lock directory. */
export interface LockObservation {
  /** Contents of `<lock>/info.json`, or `null` when that file does not exist. */
  infoText: string | null;
  /** The lock directory's mtime in ms since the epoch, or `null` when the directory is gone. */
  lockMtimeMs: number | null;
  /** The current time in ms since the epoch. */
  now: number;
  /** Whether a process with this pid is alive. Called only for a well-formed info file in an existing lock directory. */
  pidAlive: (pid: number) => boolean;
}

/**
 * Decides whether an existing lock may be taken over.
 *
 * The info file is well formed when it is JSON with a positive integer `pid`
 * and a finite numeric `since` (ms since the epoch). Then the lock is stale
 * when `now - since` exceeds 16 minutes or `pidAlive(pid)` is false, and live
 * otherwise. With no info file, a lock directory younger than 5 seconds is live
 * (its holder is still writing the file) and an older one is stale. A malformed
 * info file, or a lock directory that is gone (whatever the info file says), is
 * stale; `pidAlive` is not called for a gone directory. Never throws: an
 * exception from `pidAlive` counts as a dead holder.
 */
export function lockIsStale(obs: LockObservation): boolean {
  if (obs.lockMtimeMs === null) return true;
  if (obs.infoText === null) return obs.now - obs.lockMtimeMs >= LOCK_FRESH_WITHOUT_INFO_MS;
  let info: unknown;
  try {
    info = JSON.parse(obs.infoText);
  } catch {
    return true;
  }
  if (typeof info !== "object" || info === null) return true;
  const { pid, since } = info as { pid?: unknown; since?: unknown };
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return true;
  if (typeof since !== "number" || !Number.isFinite(since)) return true;
  if (obs.now - since > LOCK_MAX_AGE_MS) return true;
  try {
    return !obs.pidAlive(pid);
  } catch {
    return true;
  }
}
