// The multiplexer facts every caller shares: where this session lives (tmux or
// herdr), how to read herdr's `pane process-info` answer and the `ps` table, and
// where the herdr binary is. Pure apart from the binary lookup, which reads the
// filesystem: every other fact is passed in.
//
// It imports only Node built-ins, never a relative path, so a plugin that needs
// these rules can carry a byte-identical copy of this file instead of importing
// across plugin roots.
//
// The terminal plugin carries such a copy, and scripts/check-terminal-contract.ts
// scans it line by line like every other terminal file. So nothing here, not
// even a comment or an example, spells a pane, tab, window or session id or a
// token that contract forbids; examples live in the specs, which are not copied.

import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";

export type Multiplexer = "tmux" | "herdr";

/** One `foreground_processes` entry of a process-info answer. */
export interface ForegroundProcess {
  pid: number;
  /** The program as started; "" when the answer gives none. */
  argv0: string;
  /** The process name the kernel reports, which a program may set itself; "" when absent. */
  name: string;
}

/** What `herdr pane process-info --pane $HERDR_PANE_ID` showed. */
export interface HerdrPaneProcs {
  shellPid: number;
  foregroundPids: number[];
  /** The foreground process group's leader: the entry whose pid is `foreground_process_group_id`; null when absent. */
  leader: ForegroundProcess | null;
}

/**
 * The probe's result: the pane's processes; "absent" when a running herdr
 * answered `pane_not_found`; "no-server" when herdr answered
 * `server_not_running`; null for every other failure (timeout, spawn failure,
 * permission, any other error code, unparseable) and when the probe was not run.
 */
export type HerdrProbe = HerdrPaneProcs | "absent" | "no-server" | null;

/** How many parent links `ancestry` follows at most. */
const ANCESTRY_MAX_STEPS = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function foregroundOf(value: unknown): ForegroundProcess | null {
  if (!isRecord(value) || !Number.isInteger(value.pid)) return null;
  return {
    pid: value.pid as number,
    argv0: typeof value.argv0 === "string" ? value.argv0 : "",
    name: typeof value.name === "string" ? value.name : "",
  };
}

/**
 * Parses a process-info answer, from stdout or, for an error, stderr (`.result.process_info.shell_pid`,
 * `.foreground_processes[]`, `.foreground_process_group_id`). `.error.code`
 * "pane_not_found" → "absent", "server_not_running" → "no-server"; any other
 * error, a failed exit or unparseable text → null. Never throws.
 */
export function parseProcessInfo(answer: string, exitCode: number | null): HerdrProbe {
  const data = parseJson(answer);
  if (!isRecord(data)) return null;
  if (isRecord(data.error)) {
    if (data.error.code === "pane_not_found") return "absent";
    if (data.error.code === "server_not_running") return "no-server";
    return null;
  }
  if (exitCode !== 0 || !isRecord(data.result)) return null;
  const info = data.result.process_info;
  if (!isRecord(info) || !Number.isInteger(info.shell_pid)) return null;
  const foreground = (Array.isArray(info.foreground_processes) ? info.foreground_processes : []).flatMap((p) => {
    const entry = foregroundOf(p);
    return entry === null ? [] : [entry];
  });
  const group = info.foreground_process_group_id;
  const leader = Number.isInteger(group) ? (foreground.find((p) => p.pid === group) ?? null) : null;
  return { shellPid: info.shell_pid as number, foregroundPids: foreground.map((p) => p.pid), leader };
}

/** `ps -axo pid=,ppid=` → pid → ppid. Malformed lines are skipped. */
export function parsePsTable(stdout: string): Map<number, number> {
  const table = new Map<number, number>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) table.set(Number(match[1]), Number(match[2]));
  }
  return table;
}

/** The pids from `pid` up to 1, at most 32 parent links, `pid` first. A cycle ends the walk. */
export function ancestry(table: ReadonlyMap<number, number>, pid: number): number[] {
  const chain = [pid];
  const seen = new Set([pid]);
  let current = pid;
  for (let step = 0; step < ANCESTRY_MAX_STEPS && current !== 1; step++) {
    const parent = table.get(current);
    if (parent === undefined || parent <= 0 || seen.has(parent)) break;
    chain.push(parent);
    seen.add(parent);
    current = parent;
  }
  return chain;
}

/**
 * Whether herdr hosts this process: the claimed pane's shell, or a foreground
 * process of that pane, is in this process's ancestry. "absent" → false.
 * "no-server" → false when the socket file is gone, else unknown. A probe that
 * says nothing, or a process table that could not be read (`ancestors` null),
 * → unknown (null). `socketGone` is true only when HERDR_SOCKET_PATH is
 * non-empty and no file exists at it.
 */
export function herdrHostsSelf(probe: HerdrProbe, ancestors: readonly number[] | null, socketGone: boolean): boolean | null {
  if (probe === null) return null;
  if (probe === "absent") return false;
  if (probe === "no-server") return socketGone ? false : null;
  if (ancestors === null) return null;
  return ancestors.includes(probe.shellPid) || probe.foregroundPids.some((pid) => ancestors.includes(pid));
}

export interface SessionMuxFacts {
  /** Read: ORCHESTRATOR_MULTIPLEXER, HERDR_ENV, HERDR_PANE_ID, TMUX. */
  env: Readonly<Record<string, string | undefined>>;
  /**
   * `herdrHostsSelf`'s answer; null = unknown, and then the environment is
   * trusted. Under a force it decides only the nesting reported.
   */
  hostsSelf: boolean | null;
}

export type Nesting = "herdr-in-tmux" | "tmux-in-herdr" | null;

export type SessionMux =
  | { ok: true; mux: Multiplexer; source: "forced" | "detected"; nesting: Nesting }
  | { ok: false; error: string };

/** The error `detectSessionMux` gives a session that runs in neither multiplexer. */
export const NOT_IN_A_MULTIPLEXER = "not inside tmux or herdr";

/** Whether herdr's variables are present: HERDR_ENV is "1" and HERDR_PANE_ID is set. */
export function herdrEnvPresent(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.HERDR_ENV === "1" && Boolean(env.HERDR_PANE_ID);
}

/**
 * Which multiplexer runs inside which, when both multiplexers' variables are
 * present: herdr hosting this process means herdr runs inside the tmux whose
 * variables it inherited, and herdr shown not to host it means tmux runs
 * inside herdr. Unknown, or not both present, says nothing.
 */
function nestingOf(tmuxIn: boolean, herdrEnv: boolean, hostsSelf: boolean | null): Nesting {
  if (!(tmuxIn && herdrEnv)) return null;
  if (hostsSelf === true) return "herdr-in-tmux";
  if (hostsSelf === false) return "tmux-in-herdr";
  return null;
}

/**
 * Where this session lives. A non-empty ORCHESTRATOR_MULTIPLEXER decides the
 * multiplexer alone; `hostsSelf` then decides only the nesting reported.
 * Otherwise herdr's variables win unless herdr was shown not to host this
 * process, because herdr inherits TMUX when it runs inside tmux; then TMUX
 * means tmux. Never throws.
 */
export function detectSessionMux(facts: SessionMuxFacts): SessionMux {
  const { env, hostsSelf } = facts;
  const forced = env.ORCHESTRATOR_MULTIPLEXER;
  const tmuxIn = Boolean(env.TMUX);
  const herdrEnv = herdrEnvPresent(env);
  if (forced) {
    if (forced === "tmux") {
      return tmuxIn
        ? { ok: true, mux: "tmux", source: "forced", nesting: nestingOf(tmuxIn, herdrEnv, hostsSelf) }
        : { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=tmux, but not inside tmux (TMUX is unset)" };
    }
    if (forced === "herdr") {
      return env.HERDR_PANE_ID
        ? { ok: true, mux: "herdr", source: "forced", nesting: nestingOf(tmuxIn, herdrEnv, hostsSelf) }
        : { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=herdr, but not inside herdr (HERDR_PANE_ID is unset)" };
    }
    return { ok: false, error: `invalid ORCHESTRATOR_MULTIPLEXER ${JSON.stringify(forced)}; one of: tmux herdr` };
  }
  if (herdrEnv && hostsSelf !== false) return { ok: true, mux: "herdr", source: "detected", nesting: tmuxIn ? "herdr-in-tmux" : null };
  // herdrEnv here means herdr's variables were inherited by the tmux this session runs in.
  if (tmuxIn) return { ok: true, mux: "tmux", source: "detected", nesting: herdrEnv ? "tmux-in-herdr" : null };
  return { ok: false, error: NOT_IN_A_MULTIPLEXER };
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * `env.HERDR_BIN_PATH` when it is absolute and names an executable file (herdr
 * sets it inside its own panes), else herdr on `env.PATH`, else an executable
 * at `<home>/.local/bin/herdr`, else null. Availability and execution both use
 * this result, so a binary that was offered can also be run. Never throws.
 */
export function resolveHerdrBin(env: Readonly<Record<string, string | undefined>>, home: string): string | null {
  const named = env.HERDR_BIN_PATH;
  if (named?.startsWith("/") && isExecutableFile(named)) return named;
  const onPath = Bun.which("herdr", { PATH: env.PATH ?? "" });
  if (onPath !== null) return onPath;
  if (!home.startsWith("/")) return null;
  const fallback = join(home, ".local", "bin", "herdr");
  return isExecutableFile(fallback) ? fallback : null;
}
