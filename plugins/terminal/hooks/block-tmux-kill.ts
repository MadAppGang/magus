#!/usr/bin/env bun
/**
 * PreToolUse hook for the Bash tool. Blocks raw `tmux` and `herdr` invocations
 * that the MCP tools' own safeguards do not cover:
 *
 *   1. `tmux kill-server` — destroys ALL sessions and running processes.
 *   2. `tmux send-keys` / `kill-pane` / `split-window` targeting a pane whose
 *      FOREGROUND process is not a bare shell (e.g. another `claude` session, a
 *      REPL, or an editor). send-keys feeds the pane's foreground process — if
 *      that's `claude`, your "shell command" becomes a PROMPT to a sibling
 *      agent; if it's a REPL/editor, the keys are interpreted by that program.
 *      (See terminal-interaction SKILL.md §1b "Occupancy Safety".)
 *   3. `herdr server stop` and `herdr session stop <NAME>` — they close every
 *      pane and agent in the server, or in that named session.
 *   4. `herdr pane send-text|send-keys|run|close <PANE>` into a pane whose
 *      foreground process group leader is not a bare shell, read from
 *      `herdr pane process-info` (the leader's argv0).
 *   5. `herdr agent prompt|send-keys <TARGET>` when the target resolves to an
 *      agent through `herdr agent get`: these verbs always type into an agent.
 *
 * Protocol: reads the Bash tool input JSON on stdin. Exit 0 = allow, exit 2 =
 * block (Claude Code surfaces stdout/stderr to the model on exit 2).
 *
 * Design:
 *   - tmux: the foreground command is read via `tmux display-message -p -t <pane>
 *     '#{pane_current_command}'`, which reflects the pane tty's foreground
 *     process group — the same signal the tmux-mcp binary computes natively.
 *   - Words are split as the shell splits them: quotes are joined and removed,
 *     so `--session="work"` reads as `--session=work`. Nothing is expanded.
 *   - herdr: the command word is herdr when it is a path ending in `herdr`,
 *     `$HERDR_BIN_PATH`, or a `$NAME` whose value is such a path, after any
 *     `VAR=value` words and any env, sudo, timeout, nice, nohup, command or exec
 *     prefix with its options.
 *   - herdr: a clause is read as `herdr [globals] <noun> <verb> [verb options]
 *     <TARGET> [payload…]`, the way herdr's argument parser reads it. Globals and
 *     verb options are skipped in both `--opt value` and `--opt=value` form, `--`
 *     ends options, and `-h`/`--help` exempts the clause only before the first
 *     positional, where it is a real help query; after the target it is payload.
 *     A `--machine` or `--remote` clause addresses another machine and is not
 *     looked up here. `$HERDR_PANE_ID` as a target resolves to this hook's own
 *     pane; any other `$…` target cannot be resolved.
 *   - SHELL ALLOWLIST, not a REPL denylist: only known bare shells are allowed,
 *     so any unrecognized interactive program defaults to blocked.
 *   - FAIL-OPEN on resolution failure: if a target cannot be resolved (pane
 *     gone, unreachable server, no herdr binary, unparseable answer, malformed
 *     target), ALLOW — a guard that cannot see must never break a legitimate flow.
 *   - One budget: every lookup, tmux and herdr, shares one deadline, each call
 *     is capped, and at most three targets are looked up per command, so the
 *     hook decides well inside its registered timeout; targets past the budget
 *     fail open.
 *   - Cheap: the herdr branch spawns nothing unless a clause's command word is
 *     `herdr` and a guarded verb is present. `herdr pane split` is not guarded.
 *   - No override flag by design: target a shell pane, or have the user run the
 *     command themselves. The guarded alternative is the MCP surface, which
 *     addresses panes by slot and never hands out an id: open-pane, send-keys and
 *     close-pane (`mcp__plugin_terminal_mux__*`) act only on slots the server
 *     placed and owns, so they cannot reach a sibling agent's pane at all. This
 *     hook exists for the raw `tmux … -t <target>` or `herdr pane … <target>` an
 *     agent types into Bash — the one path where a pane id is still in play.
 */

import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { basename } from "path";
import { parseProcessInfo, resolveHerdrBin } from "./lib/mux-core.ts";

/** Shells that are safe send-keys / split / kill targets (login forms included). */
const SHELL_ALLOWLIST =
  /^-?(zsh|bash|fish|sh|dash|ksh|tcsh|csh)$/i;

/** tmux verbs that write to or destroy a pane (and thus need an occupancy check). */
const TARGETING_VERBS = /\b(send-keys|kill-pane|split-window)\b/;

/** herdr pane verbs that type into or close a pane. */
const HERDR_PANE_VERBS = new Set(["send-text", "send-keys", "run", "close"]);
/** herdr agent verbs that type into an agent. */
const HERDR_AGENT_VERBS = new Set(["prompt", "send-keys"]);
/** Global options that take a value, before the noun. */
const HERDR_GLOBALS_WITH_VALUE = new Set(["--session", "--machine", "--remote", "--remote-keybindings"]);
/** Globals that point the clause at another machine. */
const HERDR_REMOTE_GLOBALS = new Set(["--machine", "--remote"]);
/** Verb options that take a value, before the target (`agent prompt`). */
const HERDR_VERB_OPTIONS_WITH_VALUE = new Set(["--until", "--timeout"]);
const HELP_FLAGS = new Set(["-h", "--help"]);

/** Every lookup, tmux and herdr, shares this deadline. */
const LOOKUP_BUDGET_MS = 3500;
/** One lookup call never runs longer than this. */
const LOOKUP_CALL_CAP_MS = 2000;
/** At most this many targets are looked up per command; the rest fail open. */
const MAX_LOOKUPS = 3;

export interface TmuxTarget {
  /** The `-t` target token (pane id, e.g. "%34", or a target spec). */
  target: string;
  /** Extra args to reach the same server: ["-L", "name"] or ["-S", "/path"]. */
  socketArgs: string[];
}

export interface HerdrTarget {
  kind: "pane" | "agent";
  verb: "send-text" | "send-keys" | "run" | "close" | "prompt";
  target: string;
  /** [] or ["--session", S]. */
  sessionArgs: string[];
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Split a (possibly chained) command string into individual shell clauses.
 * Splits on ; && || | and newlines. Deliberately simple — this is a safety
 * pre-filter, not a shell parser; over-splitting only ever yields more clauses
 * to inspect, never fewer.
 */
export function splitClauses(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]/g)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Tokenize a clause into the words the shell would pass on, without evaluating
 * anything: unquoted text, '…' and "…" segments, $'…' and $"…" are joined into
 * one word until unquoted whitespace, so `--session="work"` is `--session=work`
 * and `"a b"` is one word. A backslash escapes the next character outside
 * quotes, and a quote, backslash, `$` or backtick inside double quotes. `$NAME` is kept
 * as written. An unterminated quote runs to the end of the clause.
 */
export function tokenize(clause: string): string[] {
  const tokens: string[] = [];
  let word = "";
  let inWord = false;
  let i = 0;
  const n = clause.length;
  while (i < n) {
    const c = clause[i] as string;
    if (c === "$" && clause[i + 1] === "'") {
      // ANSI-C quoting: backslash escapes, up to the next unescaped quote.
      inWord = true;
      i += 2;
      while (i < n && clause[i] !== "'") {
        if (clause[i] === "\\" && i + 1 < n) {
          const e = clause[i + 1] as string;
          word += e === "n" ? "\n" : e === "t" ? "\t" : e;
          i += 2;
          continue;
        }
        word += clause[i];
        i++;
      }
      i++;
      continue;
    }
    if (c === "$" && clause[i + 1] === '"') {
      // Locale quoting reads as double quotes.
      i++;
      continue;
    }
    if (c === "'") {
      const end = clause.indexOf("'", i + 1);
      const stop = end === -1 ? n : end;
      word += clause.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      inWord = true;
      i++;
      while (i < n && clause[i] !== '"') {
        const e = clause[i + 1];
        if (clause[i] === "\\" && e !== undefined && '"\\$`\n'.includes(e)) {
          if (e !== "\n") word += e;
          i += 2;
          continue;
        }
        word += clause[i];
        i++;
      }
      i++;
      continue;
    }
    if (c === "\\") {
      const e = clause[i + 1];
      if (e !== undefined && e !== "\n") {
        word += e;
        inWord = true;
      }
      i += 2;
      continue;
    }
    if (/\s/.test(c)) {
      if (inWord) tokens.push(word);
      word = "";
      inWord = false;
      i++;
      continue;
    }
    word += c;
    inWord = true;
    i++;
  }
  if (inWord) tokens.push(word);
  return tokens;
}

/**
 * For each tmux send-keys/kill-pane/split-window clause that carries an explicit
 * `-t` target, return the target plus the socket args needed to reach its
 * server. Clauses without a targeting verb, or without an explicit `-t`, are
 * skipped (no attributable victim pane → nothing to guard).
 */
export function extractTmuxTargets(command: string): TmuxTarget[] {
  const out: TmuxTarget[] = [];
  for (const clause of splitClauses(command)) {
    if (!/\btmux\b/.test(clause)) continue;
    if (!TARGETING_VERBS.test(clause)) continue;

    const tokens = tokenize(clause);
    let target = "";
    let socketArgs: string[] = [];
    let prev = "";

    for (const tok of tokens) {
      if (prev === "-L") { socketArgs = ["-L", tok]; prev = ""; continue; }
      if (prev === "-S") { socketArgs = ["-S", tok]; prev = ""; continue; }
      if (prev === "-t") { target = tok; prev = ""; continue; }

      if (tok === "-L" || tok === "-S" || tok === "-t") { prev = tok; continue; }
      if (tok.startsWith("-L")) { socketArgs = ["-L", tok.slice(2)]; continue; }
      if (tok.startsWith("-S")) { socketArgs = ["-S", tok.slice(2)]; continue; }
      if (tok.startsWith("-t=")) { target = tok.slice(3); continue; }
      if (tok.startsWith("-t")) { target = tok.slice(2); continue; }
    }

    if (target) out.push({ target, socketArgs });
  }
  return out;
}

/** True when `tmux kill-server` appears as a command (any whitespace/flags). */
export function isKillServer(command: string): boolean {
  // Allow any server-selection flags + their args between `tmux` and the verb
  // (e.g. `-L default`, `-S /tmp/sock`). Non-greedy over intervening tokens.
  return /(^|;|&&|\|)[ \t]*tmux[ \t]+(\S+[ \t]+)*?kill-server\b/.test(command);
}

/** A foreground command name is "safe" iff it is an allowlisted bare shell. */
export function isShell(foregroundCmd: string): boolean {
  return SHELL_ALLOWLIST.test(foregroundCmd.trim());
}

/** One herdr clause, read as herdr's argument parser reads it. */
interface HerdrClause {
  noun: string;
  verb: string;
  /** The first positional after the verb and its options; null when there is none. */
  target: string | null;
  sessionArgs: string[];
  /** `--machine` or `--remote` named another machine. */
  remote: boolean;
}

/**
 * Commands that run the command after them: the options of each that take a
 * value, and how many positionals come before the command (timeout's duration).
 */
const WRAPPERS: Readonly<Record<string, { withValue: ReadonlySet<string>; positionals: number }>> = {
  env: { withValue: new Set(["-u", "--unset", "-C", "--chdir", "-P", "-S", "--split-string"]), positionals: 0 },
  sudo: {
    withValue: new Set([
      "-u", "--user", "-g", "--group", "-h", "--host", "-C", "--close-from", "-D", "--chdir", "-p", "--prompt",
      "-r", "--role", "-t", "--type", "-U", "--other-user", "-T", "--command-timeout", "-R", "--chroot",
    ]),
    positionals: 0,
  },
  timeout: { withValue: new Set(["-s", "--signal", "-k", "--kill-after"]), positionals: 1 },
  nice: { withValue: new Set(["-n", "--adjustment"]), positionals: 0 },
  nohup: { withValue: new Set(), positionals: 0 },
  command: { withValue: new Set(), positionals: 0 },
  exec: { withValue: new Set(["-a"]), positionals: 0 },
};

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Whether a command word runs herdr: a path whose basename is `herdr`,
 * `$HERDR_BIN_PATH` / `${HERDR_BIN_PATH}`, or any `$NAME` whose value in `env`
 * is such a path.
 */
function isHerdrWord(word: string, env: Env): boolean {
  if (basename(word) === "herdr") return true;
  const m = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/.exec(word);
  const name = m?.[1] ?? m?.[2];
  if (name === undefined) return false;
  if (name === "HERDR_BIN_PATH") return true;
  const value = env[name];
  return value !== undefined && value !== "" && basename(value) === "herdr";
}

/**
 * Skips one wrapper's options and positionals, from `tokens[i]` (just after the
 * wrapper's name). Returns the index of the wrapped command word, or null when
 * the wrapper runs nothing (`command -v`). `env -S <string>` splits its string
 * into words, so those are spliced in place.
 */
function skipWrapper(name: string, tokens: string[], i: number): number | null {
  const spec = WRAPPERS[name] as (typeof WRAPPERS)[string];
  let positionals = spec.positionals;
  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (token === "--") return i + 1 + positionals;
    if (ASSIGNMENT.test(token) && name !== "timeout" && name !== "nice") {
      i++;
      continue;
    }
    if (!isOption(token)) {
      if (positionals === 0) return i;
      positionals--;
      i++;
      continue;
    }
    if (name === "command" && /^-[a-zA-Z]*[vV]/.test(token)) return null;
    let option = token;
    let inline: string | undefined;
    let takesValue = false;
    if (token.startsWith("--")) {
      [option, inline] = splitOption(token);
      takesValue = spec.withValue.has(option);
    } else {
      // A short cluster: the first letter that takes a value takes the rest of the token, or the next one.
      for (let k = 1; k < token.length; k++) {
        const short = `-${token[k]}`;
        if (spec.withValue.has(short)) {
          option = short;
          takesValue = true;
          inline = k + 1 < token.length ? token.slice(k + 1) : undefined;
          break;
        }
      }
    }
    if (!takesValue) {
      i++;
      continue;
    }
    const value = inline ?? tokens[i + 1];
    const used = inline === undefined ? 2 : 1;
    if (name === "env" && (option === "-S" || option === "--split-string") && value !== undefined) {
      tokens.splice(i, used, ...tokenize(value));
      continue;
    }
    i += used;
  }
  return i;
}

/**
 * The arguments after `herdr` when the clause's command word is herdr, else
 * null. Leading `VAR=value` words and the wrappers in WRAPPERS (env, sudo,
 * timeout, nice, nohup, command, exec) with their options are skipped, in any
 * nesting.
 */
function herdrArgs(clause: string, env: Env): string[] | null {
  const tokens = tokenize(clause);
  let i = 0;
  for (;;) {
    while (i < tokens.length && ASSIGNMENT.test(tokens[i] ?? "")) i++;
    const word = tokens[i];
    if (word === undefined) return null;
    const wrapper = basename(word);
    if (!Object.hasOwn(WRAPPERS, wrapper)) break;
    const next = skipWrapper(wrapper, tokens, i + 1);
    if (next === null) return null;
    i = next;
  }
  const word = tokens[i];
  if (word === undefined || !isHerdrWord(word, env)) return null;
  return tokens.slice(i + 1);
}

/** Cheap pre-filter: a command that can run herdr names it, or names a variable. */
const HERDR_HINT = /herdr|\$/i;

/** `--opt=value` → ["--opt", "value"]; `--opt` → ["--opt", undefined]. */
function splitOption(token: string): [string, string | undefined] {
  const eq = token.indexOf("=");
  return eq === -1 ? [token, undefined] : [token.slice(0, eq), token.slice(eq + 1)];
}

function isOption(token: string): boolean {
  return token.startsWith("-") && token !== "-";
}

/**
 * Reads `[globals] <noun> <verb> [verb options] <TARGET>`. Null for a help
 * query (`-h`/`--help` before the first positional) and for a clause with no
 * noun or verb. Nothing after the target is inspected: it is payload.
 */
function parseHerdrClause(args: readonly string[]): HerdrClause | null {
  let i = 0;
  let sessionArgs: string[] = [];
  let remote = false;

  while (i < args.length) {
    const token = args[i] as string;
    if (HELP_FLAGS.has(token)) return null;
    if (token === "--") { i++; break; }
    if (!isOption(token)) break;
    const [name, inline] = splitOption(token);
    if (HERDR_GLOBALS_WITH_VALUE.has(name)) {
      const value = inline ?? args[i + 1];
      i += inline === undefined ? 2 : 1;
      if (name === "--session" && value !== undefined) sessionArgs = ["--session", value];
      if (HERDR_REMOTE_GLOBALS.has(name)) remote = true;
      continue;
    }
    i++;
  }

  const noun = args[i++];
  if (noun === undefined) return null;

  let verb: string | undefined;
  while (i < args.length) {
    const token = args[i++] as string;
    if (HELP_FLAGS.has(token)) return null;
    if (token === "--") { verb = args[i++]; break; }
    if (isOption(token)) continue;
    verb = token;
    break;
  }
  if (verb === undefined) return null;

  let target: string | null = null;
  while (i < args.length) {
    const token = args[i] as string;
    if (HELP_FLAGS.has(token)) return null;
    if (token === "--") { target = args[i + 1] ?? null; break; }
    if (isOption(token)) {
      const [name, inline] = splitOption(token);
      i += HERDR_VERB_OPTIONS_WITH_VALUE.has(name) && inline === undefined ? 2 : 1;
      continue;
    }
    target = token;
    break;
  }
  return { noun, verb, target, sessionArgs, remote };
}

/** Every parsed herdr clause in a command. */
function herdrClauses(command: string, env: Env): HerdrClause[] {
  const out: HerdrClause[] = [];
  for (const clause of splitClauses(command)) {
    const args = herdrArgs(clause, env);
    if (args === null) continue;
    const parsed = parseHerdrClause(args);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

type EstateStop = { kind: "server" } | { kind: "session"; name: string };

/** `herdr [globals] server stop` and `herdr [globals] session stop <NAME>` clauses. */
function herdrEstateStops(command: string, env: Env): EstateStop[] {
  if (!HERDR_HINT.test(command) || !/\bstop\b/.test(command)) return [];
  return herdrClauses(command, env).flatMap((c): EstateStop[] => {
    if (c.verb !== "stop") return [];
    if (c.noun === "server") return [{ kind: "server" }];
    if (c.noun === "session" && c.target !== null) return [{ kind: "session", name: c.target }];
    return [];
  });
}

/** Per clause: `herdr [globals] server stop` or `herdr [globals] session stop <NAME>`. `env` resolves a `$NAME` command word. */
export function isHerdrEstateStop(command: string, env: Env = {}): boolean {
  return herdrEstateStops(command, env).length > 0;
}

/**
 * `$HERDR_PANE_ID` / `${HERDR_PANE_ID}` → this hook's own pane; any other `$…`
 * cannot be resolved (null, fail open); a literal target as given.
 */
function resolveTargetWord(target: string, env: Env): string | null {
  if (target === "$HERDR_PANE_ID" || target === "${HERDR_PANE_ID}") return env.HERDR_PANE_ID || null;
  if (target.startsWith("$")) return null;
  return target;
}

/**
 * The pane and agent targets of guarded herdr clauses: `pane send-text|send-keys|
 * run|close` and `agent prompt|send-keys`. Help queries, remote clauses,
 * clauses without a target and unresolvable `$…` targets yield nothing.
 */
export function extractHerdrTargets(command: string, env: Env = {}): HerdrTarget[] {
  if (!HERDR_HINT.test(command)) return [];
  const out: HerdrTarget[] = [];
  for (const clause of herdrClauses(command, env)) {
    if (clause.remote || clause.target === null) continue;
    let kind: HerdrTarget["kind"];
    if (clause.noun === "pane" && HERDR_PANE_VERBS.has(clause.verb)) kind = "pane";
    else if (clause.noun === "agent" && HERDR_AGENT_VERBS.has(clause.verb)) kind = "agent";
    else continue;
    const target = resolveTargetWord(clause.target, env);
    if (target === null) continue;
    out.push({ kind, verb: clause.verb as HerdrTarget["verb"], target, sessionArgs: clause.sessionArgs });
  }
  return out;
}

/**
 * Resolve a target pane's foreground command via tmux. Returns the trimmed
 * command name, or "" when it cannot be resolved (caller treats "" as fail-open).
 * Side-effecting; kept separate from the pure parsers above so they stay
 * unit-testable without a live tmux server.
 */
export function resolveForeground(t: TmuxTarget, timeoutMs: number = LOOKUP_CALL_CAP_MS): string {
  const res = spawnSync(
    "tmux",
    [...t.socketArgs, "display-message", "-p", "-t", t.target, "#{pane_current_command}"],
    { encoding: "utf-8", timeout: timeoutMs },
  );
  if (res.status !== 0 || !res.stdout) return "";
  return res.stdout.trim();
}

/** The agent name in an `agent get` answer, or "". */
function agentNameOf(answer: string): string {
  try {
    const data = JSON.parse(answer) as { result?: { agent?: { agent?: unknown } } };
    const name = data.result?.agent?.agent;
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

/**
 * Resolve a herdr target: for a pane, the basename of its foreground process
 * group leader's argv0; for an agent, the agent's name. "" when it cannot be
 * resolved (caller treats "" as fail-open). Side-effecting.
 */
export function resolveHerdrTarget(t: HerdrTarget, bin: string, timeoutMs: number = LOOKUP_CALL_CAP_MS): string {
  const verbArgs = t.kind === "pane" ? ["pane", "process-info", "--pane", t.target] : ["agent", "get", t.target];
  const res = spawnSync(bin, [...t.sessionArgs, ...verbArgs], { encoding: "utf-8", timeout: timeoutMs });
  if (res.error || res.status === null) return "";
  if (t.kind === "agent") return res.status === 0 ? agentNameOf(res.stdout ?? "") : "";
  const answer = res.status === 0 ? (res.stdout ?? "") : (res.stderr ?? "");
  const probe = parseProcessInfo(answer, res.status);
  if (probe === null || typeof probe === "string") return "";
  const argv0 = probe.leader?.argv0 ?? "";
  return argv0 ? basename(argv0) : "";
}

/** A process title that is a bare version string, as Claude Code sets its own. */
const VERSION_TITLE = /^\d+\.\d+\.\d+\S*$/;

/**
 * A foreground name as the block message shows it. Claude Code sets its process
 * title to its version, so tmux reports a Claude Code pane as e.g. '2.1.327';
 * that reads as `Claude Code (2.1.327)`. Any other name is shown as reported.
 */
export function displayForeground(fg: string): string {
  return VERSION_TITLE.test(fg) ? `Claude Code (${fg})` : fg;
}

/** Why typing into a non-shell is refused; shared by the tmux and herdr pane messages. */
function explanation(fg: string): string[] {
  return [
    `send-keys feeds the pane's foreground process: keys sent to a '${displayForeground(fg)}' pane are`,
    `interpreted by that program, NOT typed at a shell prompt. If the foreground is`,
    `'claude' you would inject a prompt into a sibling agent's session; killing or`,
    `splitting it disrupts that agent.`,
  ];
}

function blockMessage(target: string, fg: string): string {
  return [
    `BLOCKED: raw 'tmux' would target pane '${target}', whose foreground process is '${displayForeground(fg)}' — not a shell.`,
    ``,
    ...explanation(fg),
    ``,
    `Do this instead:`,
    `  - Use the MCP tools, which address panes by slot and never expose an id:`,
    `    mcp__plugin_terminal_mux__open-pane opens (or reuses) a helper slot the server`,
    `    owns, mcp__plugin_terminal_mux__send-keys types into it, and`,
    `    mcp__plugin_terminal_mux__close-pane closes it. None of them can reach this pane.`,
    `  - Target a pane whose foreground is a bare shell (zsh/bash/fish), or`,
    `  - If you must act on this exact pane, ask the user to confirm and run the tmux`,
    `    command themselves.`,
  ].join("\n");
}

const HERDR_ALTERNATIVES = [
  `Do this instead:`,
  `  - For an orchestrator child, use child-pane.ts (send, prompt, close); it checks the pane first.`,
  `  - For a helper process, use the terminal plugin's slot tools (mcp__plugin_terminal_mux__open-pane,`,
  `    send-keys, close-pane); they never reach another agent's pane.`,
];

function herdrPaneMessage(t: HerdrTarget, fg: string): string {
  return [
    `BLOCKED: raw 'herdr pane ${t.verb}' would target pane '${t.target}', whose foreground process is '${displayForeground(fg)}' — not a shell.`,
    ``,
    ...explanation(fg),
    ``,
    ...HERDR_ALTERNATIVES,
    `  - If you must act on this exact pane, ask the user to confirm and run the herdr command themselves.`,
  ].join("\n");
}

function herdrAgentMessage(t: HerdrTarget, agent: string): string {
  return [
    `BLOCKED: raw 'herdr agent ${t.verb}' would type into agent '${t.target}' (${agent}).`,
    ``,
    `herdr agent ${t.verb} delivers its input to that agent's session as a prompt or key`,
    `presses, never to a shell.`,
    ``,
    ...HERDR_ALTERNATIVES,
    `If you really need this, ask the user to run it manually.`,
  ].join("\n");
}

function estateStopMessage(stop: EstateStop): string {
  const first =
    stop.kind === "server"
      ? "BLOCKED: herdr server stop would close every pane and agent in this herdr server."
      : `BLOCKED: herdr session stop would close every pane and agent in session '${stop.name}'.`;
  return [first, "If you really need this, ask the user to run it manually."].join("\n");
}

/**
 * Pure decision function — returns the block message, or null to allow.
 * The lookups are injected so tests can run without a live tmux or herdr.
 * `herdrLookup` answers a pane's leader argv0 or an agent's name, "" when
 * unresolved. At most MAX_LOOKUPS targets are looked up across both.
 */
export function evaluate(
  command: string,
  lookup: (t: TmuxTarget) => string,
  hasTmux: () => boolean,
  herdrLookup: (t: HerdrTarget) => string = () => "",
  hasHerdr: () => boolean = () => false,
  env: Env = {},
): string | null {
  if (isKillServer(command)) {
    return [
      "BLOCKED: tmux kill-server would destroy all sessions and running processes.",
      "If you really need this, ask the user to run it manually.",
    ].join("\n");
  }

  const stop = herdrEstateStops(command, env)[0];
  if (stop) return estateStopMessage(stop);

  let looked = 0;
  // hasTmux false → can't resolve the foreground → fail open for tmux targets.
  if (/\btmux\b/.test(command) && TARGETING_VERBS.test(command) && hasTmux()) {
    for (const t of extractTmuxTargets(command)) {
      if (looked >= MAX_LOOKUPS) return null;
      looked++;
      const fg = lookup(t);
      if (!fg) continue;            // unresolved → fail open for this target
      if (isShell(fg)) continue;    // bare shell → safe
      return blockMessage(t.target, fg);
    }
  }

  const herdrTargets = extractHerdrTargets(command, env);
  if (herdrTargets.length === 0 || looked >= MAX_LOOKUPS || !hasHerdr()) return null;
  for (const t of herdrTargets) {
    if (looked >= MAX_LOOKUPS) return null;
    looked++;
    const found = herdrLookup(t);
    if (!found) continue;           // unresolved → fail open for this target
    if (t.kind === "agent") return herdrAgentMessage(t, found);
    if (isShell(found)) continue;
    return herdrPaneMessage(t, found);
  }
  return null;
}

function main(): void {
  let command = "";
  try {
    const input = readFileSync("/dev/stdin", "utf-8");
    const payload = JSON.parse(input) as { tool_input?: { command?: string } };
    command = payload.tool_input?.command ?? "";
  } catch {
    process.exit(0); // unparseable input → never block
  }
  if (!command) process.exit(0);

  const deadline = Date.now() + LOOKUP_BUDGET_MS;
  const timeLeft = (): number => Math.min(LOOKUP_CALL_CAP_MS, deadline - Date.now());

  const hasTmux = (): boolean => {
    const ms = timeLeft();
    return ms > 0 && spawnSync("tmux", ["-V"], { encoding: "utf-8", timeout: ms }).status === 0;
  };
  const tmuxLookup = (t: TmuxTarget): string => {
    const ms = timeLeft();
    return ms > 0 ? resolveForeground(t, ms) : "";
  };

  const env = process.env;
  let herdrBin: string | null | undefined;
  const bin = (): string | null => {
    if (herdrBin === undefined) herdrBin = resolveHerdrBin(env, env.HOME || homedir());
    return herdrBin;
  };
  const hasHerdr = (): boolean => bin() !== null;
  const herdrLookup = (t: HerdrTarget): string => {
    const path = bin();
    const ms = timeLeft();
    return path !== null && ms > 0 ? resolveHerdrTarget(t, path, ms) : "";
  };

  const message = evaluate(command, tmuxLookup, hasTmux, herdrLookup, hasHerdr, env);
  if (message) {
    console.log(message);
    process.exit(2);
  }
  process.exit(0);
}

// Run only when executed directly (not when imported by the test file).
if (import.meta.main) main();
