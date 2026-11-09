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
/** A ticket id: `#229`, `229`, `owner/repo#229`, `ABC-7`. */
const TICKET_RE = /^[A-Za-z0-9#][A-Za-z0-9/#._-]{0,79}$/;
/** A ticket URL: https, no whitespace, quotes or backslashes. */
const TICKET_URL_RE = /^https:\/\/[^\s'"\\]{1,400}$/;
/** A variable the launcher may put in front of the launch command. */
const ENV_KEY_RE = /^ORCHESTRATOR_[A-Z_]+$/;

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
  "model",
  "effort",
  "launch",
  "deliver-to",
  "lock",
  "mux",
  "ticket",
  "ticket-url",
]);
const BOOLEAN_FLAGS = new Set(["no-wait", "dry-run", "print-line"]);
const DELIVER_FLAGS = new Set(["deliver-to", "prompt", "lock", "mux"]);
/** Flags that only make sense when a window or tab is opened, so never with `--print-line`. */
const NOT_WITH_PRINT_LINE = ["prompt", "session", "no-wait", "dry-run"] as const;

/** The two terminal multiplexers the launcher can open a ticket in. */
export type Multiplexer = "tmux" | "herdr";

function isMultiplexer(value: string): value is Multiplexer {
  return value === "tmux" || value === "herdr";
}

/** Arguments for opening a window or tab (stage 1). */
export interface StartArgs {
  mode: "start";
  name: string;
  colour: Colour;
  /** Text typed into Claude Code once it is up; "" when none was given. */
  prompt: string;
  dir?: string;
  session?: string;
  model?: string;
  effort?: string;
  /** Launch command from `--launch`, else from `ORCHESTRATOR_LAUNCH`; absent means the default launch. */
  launch?: string;
  /** The ticket the session works, as given to `--ticket`. */
  ticket?: string;
  /** The ticket's URL from `--ticket-url`. */
  ticketUrl?: string;
  noWait: boolean;
  dryRun: boolean;
}

/** Arguments for `--print-line`: run the checkout guards and print the line, open nothing. */
export interface PrintLineArgs {
  mode: "print-line";
  name: string;
  colour: Colour;
  dir?: string;
  model?: string;
  effort?: string;
  launch?: string;
  ticket?: string;
  ticketUrl?: string;
}

/** Arguments for the detached second stage that types the prompt. */
export interface DeliverArgs {
  mode: "deliver";
  pane: string;
  prompt: string;
  /** The multiplexer the pane lives in. */
  mux: Multiplexer;
  lock?: string;
}

export type ParseResult = { ok: true; args: StartArgs | PrintLineArgs | DeliverArgs } | { ok: false; error: string };

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
 * `--dir` or `--session`, an invalid `--ticket`
 * (`^[A-Za-z0-9#][A-Za-z0-9/#._-]{0,79}$`: `#229`, `229`, `owner/repo#229`,
 * `ABC-7`) or `--ticket-url` (`^https://` and up to 400 characters with no
 * whitespace, quote or backslash). `--ticket` and `--ticket-url` are accepted
 * both when starting a window and with `--print-line`.
 *
 * With `--deliver-to <pane>` the result is `DeliverArgs`; only `--prompt`,
 * `--lock` and `--mux` may accompany it, and `--mux` is required with a value
 * of exactly `tmux` or `herdr`. `--lock` or `--mux` without `--deliver-to` is
 * an error.
 *
 * With `--print-line` the result is `PrintLineArgs`; `--prompt`, `--session`,
 * `--no-wait`, `--dry-run` and `--deliver-to` may not accompany it.
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
    const mux = values.get("mux");
    if (mux === undefined) return { ok: false, error: "--deliver-to needs --mux tmux or --mux herdr" };
    if (!isMultiplexer(mux)) return { ok: false, error: `invalid --mux ${quote(mux)}; one of: tmux herdr` };
    const lock = values.get("lock");
    return {
      ok: true,
      args: { mode: "deliver", pane, prompt: values.get("prompt") ?? "", mux, ...(lock ? { lock } : {}) },
    };
  }
  if (values.has("lock")) return { ok: false, error: "--lock is internal and only valid with --deliver-to" };
  if (values.has("mux")) return { ok: false, error: "--mux is internal and only valid with --deliver-to" };

  const printLine = booleans.has("print-line");
  if (printLine) {
    for (const key of NOT_WITH_PRINT_LINE) {
      if (values.has(key) || booleans.has(key)) return { ok: false, error: `--${key} cannot be combined with --print-line` };
    }
  }

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

  for (const key of ["dir", "session"]) {
    if (values.get(key) === "") return { ok: false, error: `--${key} needs a value` };
  }

  const ticket = values.get("ticket");
  if (ticket !== undefined && !TICKET_RE.test(ticket)) return { ok: false, error: `invalid ticket ${quote(ticket)}` };
  const ticketUrl = values.get("ticket-url");
  if (ticketUrl !== undefined && !TICKET_URL_RE.test(ticketUrl)) {
    return { ok: false, error: `invalid ticket URL ${quote(ticketUrl)}: https://, no spaces, quotes or backslashes` };
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

  const dir = values.get("dir");
  if (printLine) {
    const lineArgs: PrintLineArgs = { mode: "print-line", name, colour };
    if (dir !== undefined) lineArgs.dir = dir;
    if (model !== undefined) lineArgs.model = model;
    if (effort !== undefined) lineArgs.effort = effort;
    if (launch !== undefined) lineArgs.launch = launch;
    if (ticket !== undefined) lineArgs.ticket = ticket;
    if (ticketUrl !== undefined) lineArgs.ticketUrl = ticketUrl;
    return { ok: true, args: lineArgs };
  }

  const args: StartArgs = {
    mode: "start",
    name,
    colour,
    prompt: values.get("prompt") ?? "",
    noWait: booleans.has("no-wait"),
    dryRun: booleans.has("dry-run"),
  };
  const session = values.get("session");
  if (dir !== undefined) args.dir = dir;
  if (session !== undefined) args.session = session;
  if (model !== undefined) args.model = model;
  if (effort !== undefined) args.effort = effort;
  if (launch !== undefined) args.launch = launch;
  if (ticket !== undefined) args.ticket = ticket;
  if (ticketUrl !== undefined) args.ticketUrl = ticketUrl;
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

/** What the launch command typed into a new pane needs. */
export interface LaunchSpec {
  name: string;
  colour: Colour;
  model?: string;
  effort?: string;
  /** A launch command; absent means the default `claude -w` launch. */
  launch?: string;
  /**
   * Variables put in front of the launch as prefix assignments, in order:
   * `ORCHESTRATOR_CLAIM`, and `ORCHESTRATOR_STATE_DIR` when the launcher has one.
   */
  env?: ReadonlyArray<readonly [string, string]>;
}

/**
 * The prefix assignments for `env`: `K='v' ` for each pair, in order, every
 * value single-quoted with each `'` written as `'\''`; `""` when `env` is
 * absent or empty.
 *
 * Throws an Error when a key does not match `^ORCHESTRATOR_[A-Z_]+$`, is
 * `ORCHESTRATOR_LAUNCH` (that variable names the launch command, so the prefix
 * may never set it), or a value contains a newline or NUL.
 */
export function envPrefix(env: ReadonlyArray<readonly [string, string]> | undefined): string {
  if (env === undefined) return "";
  let prefix = "";
  for (const [key, value] of env) {
    if (!ENV_KEY_RE.test(key)) throw new Error(`invalid launch variable ${quote(key)}`);
    if (key === "ORCHESTRATOR_LAUNCH") throw new Error("ORCHESTRATOR_LAUNCH names the launch command and cannot be set in front of it");
    if (/[\n\0]/.test(value)) throw new Error(`the value of ${key} contains a newline or NUL`);
    prefix += `${key}=${shellQuote(value)} `;
  }
  return prefix;
}

/**
 * Builds the `<launch>` part of the shell line alone. By default:
 *
 *   CLAUDE_WT_NAME=<name> CLAUDE_WT_COLOUR=<colour> claude -w <name> -n <name> [--model M] [--effort E] '/color <colour>'
 *
 * With `launch` set it is `<launch> <name> <colour>`, followed by
 * ` -- --model M --effort E` (only the flags given) when either is given.
 *
 * Either form is preceded by `envPrefix(spec.env)`, e.g.
 * `ORCHESTRATOR_CLAIM='l-…' wt <name> <colour>`. In bash and zsh a prefix
 * assignment before a command or a shell function reaches its children for that
 * call only. An absent or empty `env` gives exactly the line without it.
 *
 * Throws an Error when any field fails the pattern `parseArgs` enforces, or
 * `envPrefix` would throw, so a value that could break the shell line never
 * reaches it.
 */
export function buildLaunch(spec: LaunchSpec): string {
  return envPrefix(spec.env) + buildBareLaunch(spec);
}

function buildBareLaunch(spec: LaunchSpec): string {
  if (!NAME_RE.test(spec.name)) throw new Error(`invalid name ${quote(spec.name)}`);
  if (!isColour(spec.colour)) throw new Error(`invalid colour ${quote(String(spec.colour))}`);
  if (spec.model !== undefined && !MODEL_RE.test(spec.model)) throw new Error(`invalid model ${quote(spec.model)}`);
  if (spec.effort !== undefined && !EFFORT_RE.test(spec.effort)) throw new Error(`invalid effort ${quote(spec.effort)}`);
  if (spec.launch !== undefined && !LAUNCH_RE.test(spec.launch)) throw new Error(`invalid launch ${quote(spec.launch)}`);

  const flags: string[] = [];
  if (spec.model !== undefined) flags.push("--model", spec.model);
  if (spec.effort !== undefined) flags.push("--effort", spec.effort);

  return spec.launch === undefined
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
}

/**
 * Builds the shell line typed into a new ticket window or tab:
 *
 *   git pull --ff-only && { ! command -v magus >/dev/null 2>&1 || magus update || echo "…"; } && <launch>
 *
 * `magus update` runs only where `magus` is installed, and its failure is
 * reported and does not stop the line. `<launch>` is `buildLaunch(spec)`, and
 * this throws exactly when that does.
 */
export function buildLaunchLine(spec: LaunchSpec): string {
  return (
    "git pull --ff-only && " +
    '{ ! command -v magus >/dev/null 2>&1 || magus update || echo "ticket-window: magus update failed; continuing without it"; } && ' +
    buildLaunch(spec)
  );
}

/** Wraps a value in single quotes for a POSIX shell, writing each `'` as `'\''`. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Builds the shell line a manager types into a child's pane:
 *
 *   cd '<dir>' && git pull --ff-only && <launch>
 *
 * `<launch>` is `buildLaunch(spec)`; there is no `magus update` step. `dir` is
 * single-quoted with every `'` written as `'\''`.
 *
 * Throws an Error when `dir` is not absolute or contains a newline or NUL, or
 * when `buildLaunch` would throw.
 */
export function buildChildLine(spec: LaunchSpec & { dir: string }): string {
  if (!spec.dir.startsWith("/")) throw new Error(`checkout path must be absolute: ${quote(spec.dir)}`);
  if (/[\n\0]/.test(spec.dir)) throw new Error(`checkout path contains a newline or NUL: ${quote(spec.dir)}`);
  const launch = buildLaunch(spec);
  return `cd ${shellQuote(spec.dir)} && git pull --ff-only && ${launch}`;
}

/** Result of `detectMultiplexer`. */
export type MultiplexerDetection = { ok: true; mux: Multiplexer } | { ok: false; error: string };

/**
 * Decides which multiplexer the caller runs in.
 *
 * A non-empty `ORCHESTRATOR_MULTIPLEXER` decides alone: `tmux` needs a
 * non-empty `TMUX`, `herdr` a non-empty `HERDR_PANE_ID`, and any other value is
 * an error; `probeHerdr` is not called. Otherwise a herdr claim
 * (`HERDR_ENV === "1"` and a non-empty `HERDR_PANE_ID`) is confirmed by calling
 * `probeHerdr` exactly once; `true` means herdr. herdr is checked before tmux
 * because herdr inherits `TMUX` when it runs inside tmux. Failing that, a
 * non-empty `TMUX` means tmux, and anything else is the error
 * `not inside tmux or herdr`. An exception from `probeHerdr` counts as `false`.
 * Never throws.
 */
export function detectMultiplexer(
  env: Readonly<Record<string, string | undefined>>,
  probeHerdr: () => boolean,
): MultiplexerDetection {
  const forced = env.ORCHESTRATOR_MULTIPLEXER;
  if (forced) {
    if (forced === "tmux") {
      return env.TMUX ? { ok: true, mux: "tmux" } : { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=tmux, but not inside tmux (TMUX is unset)" };
    }
    if (forced === "herdr") {
      return env.HERDR_PANE_ID
        ? { ok: true, mux: "herdr" }
        : { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=herdr, but not inside herdr (HERDR_PANE_ID is unset)" };
    }
    return { ok: false, error: `invalid ORCHESTRATOR_MULTIPLEXER ${quote(forced)}; one of: tmux herdr` };
  }
  if (env.HERDR_ENV === "1" && env.HERDR_PANE_ID) {
    let confirmed = false;
    try {
      confirmed = probeHerdr();
    } catch {
      confirmed = false;
    }
    if (confirmed) return { ok: true, mux: "herdr" };
  }
  if (env.TMUX) return { ok: true, mux: "tmux" };
  return { ok: false, error: "not inside tmux or herdr" };
}

/**
 * The argv that opens a herdr tab at `dir`, labelled `name`, in workspace
 * `workspace`, without moving the user's focus:
 *
 *   herdr tab create --workspace <workspace> --cwd <dir> --label <name> --no-focus
 *
 * Throws an Error when `workspace` is empty, `dir` is not absolute, or `name`
 * fails the window name pattern.
 */
export function buildHerdrTabCreate(spec: { dir: string; name: string; workspace: string }): string[] {
  if (spec.workspace === "") throw new Error("herdr workspace id is empty");
  if (!spec.dir.startsWith("/")) throw new Error(`checkout path must be absolute: ${quote(spec.dir)}`);
  if (!NAME_RE.test(spec.name)) throw new Error(`invalid name ${quote(spec.name)}`);
  return ["herdr", "tab", "create", "--workspace", spec.workspace, "--cwd", spec.dir, "--label", spec.name, "--no-focus"];
}

/** Reads `obj[k1][k2]…` as a string (`""` included), or `null` when it is missing or not a string. */
function stringAt(obj: unknown, ...keys: string[]): string | null {
  let cur: unknown = obj;
  for (const key of keys) {
    if (typeof cur !== "object" || cur === null) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : null;
}

/** Reads `obj[k1][k2]…` as a non-empty string, or `null`. */
function nonEmptyStringAt(obj: unknown, ...keys: string[]): string | null {
  const value = stringAt(obj, ...keys);
  return value === "" ? null : value;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parses the JSON `herdr tab create` prints. `tabId` is `result.tab.tab_id`;
 * `paneId` is `result.root_pane.pane_id`, or `null` when that is missing (the
 * caller then finds the tab's pane with `herdrPaneOfTab`). Returns `null` for
 * output that is not JSON or carries no string `tab_id`. Never throws.
 */
export function parseHerdrTabCreate(stdout: string): { tabId: string; paneId: string | null } | null {
  const data = parseJson(stdout);
  const tabId = stringAt(data, "result", "tab", "tab_id");
  if (tabId === null) return null;
  return { tabId, paneId: stringAt(data, "result", "root_pane", "pane_id") };
}

/**
 * Finds the first pane of tab `tabId` in the JSON `herdr pane list` prints
 * (`result.panes[]`, each with `pane_id` and `tab_id`). `null` when none
 * matches or the output is not that shape. Never throws.
 */
export function herdrPaneOfTab(stdout: string, tabId: string): string | null {
  const panes = (parseJson(stdout) as { result?: { panes?: unknown } } | undefined)?.result?.panes;
  if (!Array.isArray(panes)) return null;
  for (const pane of panes) {
    if (nonEmptyStringAt(pane, "tab_id") === tabId) {
      const id = nonEmptyStringAt(pane, "pane_id");
      if (id !== null) return id;
    }
  }
  return null;
}

/** What the launcher reads about one herdr pane. */
export interface HerdrPane {
  paneId: string;
  tabId: string | null;
  workspaceId: string | null;
  cwd: string | null;
}

/**
 * Parses the JSON `herdr pane current` and `herdr pane get <pane>` print
 * (`result.pane`). Returns `null` for output that is not JSON or has no string
 * `result.pane.pane_id`; the other fields are `null` when missing. Never throws.
 */
export function parseHerdrPane(stdout: string): HerdrPane | null {
  const data = parseJson(stdout);
  const paneId = stringAt(data, "result", "pane", "pane_id");
  if (paneId === null) return null;
  return {
    paneId,
    tabId: stringAt(data, "result", "pane", "tab_id"),
    workspaceId: stringAt(data, "result", "pane", "workspace_id"),
    cwd: stringAt(data, "result", "pane", "cwd"),
  };
}

/**
 * The argv that types `line` into a herdr pane's interactive shell and presses
 * Enter: `herdr pane run <pane> <line>`. Throws an Error when `pane` is empty
 * or `line` contains a newline.
 */
export function buildHerdrRun(pane: string, line: string): string[] {
  if (pane === "") throw new Error("herdr pane id is empty");
  if (line.includes("\n")) throw new Error("the line to run contains a newline");
  return ["herdr", "pane", "run", pane, line];
}

/** The text `claude -w` prints when it refuses to start in a folder that is not trusted yet. */
const TRUST_ERROR = "Workspace trust not yet accepted";

/**
 * True exactly when `screen` contains `Workspace trust not yet accepted`
 * (case-sensitive, on any line). The caller joins wrapped lines before
 * passing the screen, so the phrase is never split across lines.
 */
export function screenShowsTrustError(screen: string): boolean {
  return screen.includes(TRUST_ERROR);
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
