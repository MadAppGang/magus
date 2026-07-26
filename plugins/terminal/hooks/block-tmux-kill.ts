#!/usr/bin/env bun
/**
 * PreToolUse hook for the Bash tool. Blocks two classes of dangerous raw `tmux`
 * invocations that the MCP tools' own safeguards do not cover:
 *
 *   1. `tmux kill-server` — destroys ALL sessions and running processes.
 *   2. `tmux send-keys` / `kill-pane` / `split-window` targeting a pane whose
 *      FOREGROUND process is not a bare shell (e.g. another `claude` session, a
 *      REPL, or an editor). send-keys feeds the pane's foreground process — if
 *      that's `claude`, your "shell command" becomes a PROMPT to a sibling
 *      agent; if it's a REPL/editor, the keys are interpreted by that program.
 *      (See terminal-interaction SKILL.md §1b "Occupancy Safety".)
 *
 * Protocol: reads the Bash tool input JSON on stdin. Exit 0 = allow, exit 2 =
 * block (Claude Code surfaces stdout/stderr to the model on exit 2).
 *
 * Design:
 *   - Foreground command is read via `tmux display-message -p -t <pane>
 *     '#{pane_current_command}'`, which reflects the pane tty's foreground
 *     process group — the same signal the tmux-mcp binary computes natively.
 *   - SHELL ALLOWLIST, not a REPL denylist: only known bare shells are allowed,
 *     so any unrecognized interactive program defaults to blocked.
 *   - FAIL-OPEN on resolution failure: if a target pane can't be resolved (pane
 *     gone, unreachable server, malformed target), ALLOW — a guard that cannot
 *     see must never break a legitimate flow.
 *   - No override flag by design: target a shell pane, or have the user run the
 *     command themselves. NOTE: the MCP send-keys/kill-pane tools do NOT perform
 *     an occupancy check — they are not a guarded alternative to this path; only
 *     mcp__tmux__split-pane is occupancy-safe (it never returns an occupied pane).
 */

import { readFileSync } from "fs";
import { spawnSync } from "child_process";

/** Shells that are safe send-keys / split / kill targets (login forms included). */
const SHELL_ALLOWLIST =
  /^-?(zsh|bash|fish|sh|dash|ksh|tcsh|csh)$/i;

/** tmux verbs that write to or destroy a pane (and thus need an occupancy check). */
const TARGETING_VERBS = /\b(send-keys|kill-pane|split-window)\b/;

export interface TmuxTarget {
  /** The `-t` target token (pane id, e.g. "%34", or a target spec). */
  target: string;
  /** Extra args to reach the same server: ["-L", "name"] or ["-S", "/path"]. */
  socketArgs: string[];
}

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

/** Tokenize a clause into argv-like tokens, honoring single/double quotes. */
export function tokenize(clause: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clause)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
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

/**
 * Resolve a target pane's foreground command via tmux. Returns the trimmed
 * command name, or "" when it cannot be resolved (caller treats "" as fail-open).
 * Side-effecting; kept separate from the pure parsers above so they stay
 * unit-testable without a live tmux server.
 */
export function resolveForeground(t: TmuxTarget): string {
  const res = spawnSync(
    "tmux",
    [...t.socketArgs, "display-message", "-p", "-t", t.target, "#{pane_current_command}"],
    { encoding: "utf-8", timeout: 2000 },
  );
  if (res.status !== 0 || !res.stdout) return "";
  return res.stdout.trim();
}

function blockMessage(target: string, fg: string): string {
  return [
    `BLOCKED: raw 'tmux' would target pane '${target}', whose foreground process is '${fg}' — not a shell.`,
    ``,
    `send-keys feeds the pane's foreground process: keys sent to a '${fg}' pane are`,
    `interpreted by that program, NOT typed at a shell prompt. If the foreground is`,
    `'claude' you would inject a prompt into a sibling agent's session; killing or`,
    `splitting it disrupts that agent.`,
    ``,
    `Do this instead:`,
    `  - Target a pane whose foreground is a bare shell (zsh/bash/fish), or`,
    `  - Create your own pane (mcp__tmux__split-pane reuses/creates a shell pane and`,
    `    never returns an occupied one), label it 'claude-helper', and act only on that.`,
    `  - If you must act on this exact pane, ask the user to confirm and run the tmux`,
    `    command themselves. (Note: mcp__tmux__send-keys / kill-pane do NOT check`,
    `    occupancy — they would write to / kill this same pane with no guard.)`,
  ].join("\n");
}

/**
 * Pure decision function — returns the block message, or null to allow.
 * `lookup` is injected so tests can run without a live tmux server.
 */
export function evaluate(
  command: string,
  lookup: (t: TmuxTarget) => string,
  hasTmux: () => boolean,
): string | null {
  if (isKillServer(command)) {
    return [
      "BLOCKED: tmux kill-server would destroy all sessions and running processes.",
      "If you really need this, ask the user to run it manually.",
    ].join("\n");
  }

  if (!/\btmux\b/.test(command) || !TARGETING_VERBS.test(command)) return null;
  if (!hasTmux()) return null; // can't resolve foreground → fail open

  for (const t of extractTmuxTargets(command)) {
    const fg = lookup(t);
    if (!fg) continue;            // unresolved → fail open for this target
    if (isShell(fg)) continue;    // bare shell → safe
    return blockMessage(t.target, fg);
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

  const hasTmux = () =>
    spawnSync("tmux", ["-V"], { encoding: "utf-8", timeout: 2000 }).status === 0;

  const message = evaluate(command, resolveForeground, hasTmux);
  if (message) {
    console.log(message);
    process.exit(2);
  }
  process.exit(0);
}

// Run only when executed directly (not when imported by the test file).
if (import.meta.main) main();
