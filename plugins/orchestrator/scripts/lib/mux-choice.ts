// Pure rules for choosing a multiplexer. Imports nothing, reads nothing: every
// fact is passed in. Two questions are answered, and they are kept apart:
//
//   detectSessionMux  where THIS session lives. It addresses the session and its
//                     children, and the stored choice never enters it.
//   chooseWindowMux   where a NEW TICKET WINDOW opens. The stored choice enters
//                     here, and only when the answer would otherwise be ambiguous.

export type Multiplexer = "tmux" | "herdr";

/** What `herdr pane process-info --pane $HERDR_PANE_ID` showed, reduced to pids. */
export interface HerdrPaneProcs {
  shellPid: number;
  foregroundPids: number[];
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

/**
 * Parses a process-info answer, from stdout or, for an error, stderr (`.result.process_info.shell_pid`,
 * `.foreground_processes[].pid`). `.error.code` "pane_not_found" → "absent",
 * "server_not_running" → "no-server"; any other error, a failed exit or
 * unparseable text → null. Never throws.
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
  const foreground = Array.isArray(info.foreground_processes) ? info.foreground_processes : [];
  const foregroundPids = foreground.flatMap((p) => (isRecord(p) && Number.isInteger(p.pid) ? [p.pid as number] : []));
  return { shellPid: info.shell_pid as number, foregroundPids };
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
  /** `herdrHostsSelf`'s answer; null = unknown, and then the environment is trusted. */
  hostsSelf: boolean | null;
}

export type Nesting = "herdr-in-tmux" | "tmux-in-herdr" | null;

export type SessionMux =
  | { ok: true; mux: Multiplexer; source: "forced" | "detected"; nesting: Nesting }
  | { ok: false; error: string };

const NOT_IN_A_MULTIPLEXER = "not inside tmux or herdr";

/**
 * Where this session lives. A non-empty ORCHESTRATOR_MULTIPLEXER decides alone.
 * Otherwise herdr's variables win unless herdr was shown not to host this
 * process, because herdr inherits TMUX when it runs inside tmux; then TMUX
 * means tmux. Never throws.
 */
export function detectSessionMux(facts: SessionMuxFacts): SessionMux {
  const { env, hostsSelf } = facts;
  const forced = env.ORCHESTRATOR_MULTIPLEXER;
  const tmuxIn = Boolean(env.TMUX);
  if (forced) {
    if (forced === "tmux") {
      return tmuxIn
        ? { ok: true, mux: "tmux", source: "forced", nesting: null }
        : { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=tmux, but not inside tmux (TMUX is unset)" };
    }
    if (forced === "herdr") {
      return env.HERDR_PANE_ID
        ? { ok: true, mux: "herdr", source: "forced", nesting: null }
        : { ok: false, error: "ORCHESTRATOR_MULTIPLEXER=herdr, but not inside herdr (HERDR_PANE_ID is unset)" };
    }
    return { ok: false, error: `invalid ORCHESTRATOR_MULTIPLEXER ${JSON.stringify(forced)}; one of: tmux herdr` };
  }
  const herdrEnv = env.HERDR_ENV === "1" && Boolean(env.HERDR_PANE_ID);
  if (herdrEnv && hostsSelf !== false) return { ok: true, mux: "herdr", source: "detected", nesting: tmuxIn ? "herdr-in-tmux" : null };
  // herdrEnv here means herdr's variables were inherited by the tmux this session runs in.
  if (tmuxIn) return { ok: true, mux: "tmux", source: "detected", nesting: herdrEnv ? "tmux-in-herdr" : null };
  return { ok: false, error: NOT_IN_A_MULTIPLEXER };
}

export type AskReason = "herdr-in-tmux" | "herdr-installed";

export interface WindowMuxFacts {
  env: Readonly<Record<string, string | undefined>>;
  session: SessionMux;
  /** The stored per-user choice; null when none or unreadable. */
  stored: Multiplexer | null;
  /** A herdr executable was found. */
  herdrInstalled: boolean;
}

export type WindowMux =
  | {
      ok: true;
      mux: Multiplexer;
      source: "forced" | "stored" | "detected" | "provisional";
      /** Non-null: an interactive caller should ask once and store the answer. */
      ask: AskReason | null;
      /** One sentence for the user, or null. */
      note: string | null;
    }
  | { ok: false; error: string };

const STORED_HERDR_NOTE = "New ticket windows open as herdr tabs (your stored choice). This session's own children stay in tmux slots.";

/** Where a new ticket window opens. Never throws. */
export function chooseWindowMux(facts: WindowMuxFacts): WindowMux {
  const { session, stored, herdrInstalled } = facts;
  if (!session.ok) return { ok: false, error: session.error };
  const result = (
    mux: Multiplexer,
    source: "forced" | "stored" | "detected" | "provisional",
    ask: AskReason | null = null,
    note: string | null = null,
  ): WindowMux => ({ ok: true, mux, source, ask, note });

  if (session.source === "forced") return result(session.mux, "forced");
  if (session.nesting === "herdr-in-tmux") return stored !== null ? result(stored, "stored") : result("herdr", "provisional", "herdr-in-tmux");
  if (session.mux === "herdr") return result("herdr", "detected");
  if (!herdrInstalled) return result("tmux", "detected");
  if (stored === "herdr") return result("herdr", "stored", null, STORED_HERDR_NOTE);
  if (stored === "tmux") return result("tmux", "stored");
  return result("tmux", "provisional", "herdr-installed");
}

export type StartMux = { ok: true; mux: Multiplexer } | { ok: false; error: string };

/**
 * Where `ticket-window.ts` start opens. `named`: `--session <name>` was given,
 * which names a tmux session, so the stored choice never enters that route.
 * `forced`: a non-empty ORCHESTRATOR_MULTIPLEXER. Never throws.
 */
export function chooseStartMux(facts: { session: SessionMux; windows: WindowMux; named: boolean; forced: boolean }): StartMux {
  const { session, windows, named, forced } = facts;
  if (!named) {
    if (windows.ok) return { ok: true, mux: windows.mux };
    return {
      ok: false,
      error:
        windows.error === NOT_IN_A_MULTIPLEXER
          ? `${NOT_IN_A_MULTIPLEXER}; run it from a tmux pane or a herdr tab, or pass --session <name> for a tmux session`
          : windows.error,
    };
  }
  if (session.ok) {
    if (session.mux === "tmux") return { ok: true, mux: "tmux" };
    return { ok: false, error: "--session is tmux only; under herdr the ticket opens as a tab in the current workspace (ORCHESTRATOR_MULTIPLEXER=tmux forces tmux)" };
  }
  // A named tmux session can be created from outside any multiplexer.
  return forced ? { ok: false, error: session.error } : { ok: true, mux: "tmux" };
}

// --- the per-user config file -------------------------------------------------------

export interface UserConfig {
  schema: 1;
  multiplexer: Multiplexer | null;
  multiplexerAnsweredAt: number | null;
  /** Every other top-level key, kept verbatim on rewrite. */
  extra: Record<string, unknown>;
}

export type ConfigParse = { ok: true; config: UserConfig } | { ok: false; error: string };

export function emptyUserConfig(): UserConfig {
  return { schema: 1, multiplexer: null, multiplexerAnsweredAt: null, extra: {} };
}

/**
 * null (no file) or "" → an empty config. Not JSON, not an object, a schema
 * other than 1, a multiplexer other than "tmux", "herdr", null or absent, or an
 * answered-at time other than a finite number, null or absent → ok:false.
 */
export function parseUserConfig(text: string | null): ConfigParse {
  if (text === null || text === "") return { ok: true, config: emptyUserConfig() };
  const data = parseJson(text);
  if (!isRecord(data)) return { ok: false, error: "config.json is not a JSON object" };
  const { schema, multiplexer = null, multiplexerAnsweredAt = null, ...extra } = data;
  if (schema !== 1) return { ok: false, error: `config.json has schema ${JSON.stringify(schema)}, expected 1` };
  if (multiplexer !== null && multiplexer !== "tmux" && multiplexer !== "herdr") {
    return { ok: false, error: `config.json has multiplexer ${JSON.stringify(multiplexer)}; one of: tmux herdr` };
  }
  if (multiplexerAnsweredAt !== null && (typeof multiplexerAnsweredAt !== "number" || !Number.isFinite(multiplexerAnsweredAt))) {
    return { ok: false, error: `config.json has multiplexerAnsweredAt ${JSON.stringify(multiplexerAnsweredAt)}, expected a number` };
  }
  return { ok: true, config: { schema: 1, multiplexer, multiplexerAnsweredAt, extra } };
}

export function withMultiplexer(config: UserConfig, mux: Multiplexer, now: number): UserConfig {
  return { ...config, multiplexer: mux, multiplexerAnsweredAt: now };
}

/** Two-space JSON and a newline. The three named keys come first and win over any of the same name in `extra`. */
export function serializeUserConfig(config: UserConfig): string {
  const { schema: _schema, multiplexer: _multiplexer, multiplexerAnsweredAt: _answeredAt, ...extra } = config.extra;
  return `${JSON.stringify({ schema: config.schema, multiplexer: config.multiplexer, multiplexerAnsweredAt: config.multiplexerAnsweredAt, ...extra }, null, 2)}\n`;
}
