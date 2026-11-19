// What a script asks of, or does to, a pane, in either multiplexer: one
// contract, PaneIO, with a tmux and a herdr implementation. The adapters hold no
// orchestrator policy (no locks, registry, claims or occupancy decisions);
// callers decide, adapters translate: agent identity, the witness, key names,
// "gone", and the layout.
//
// Every failure is a return value; nothing here throws on a failed call.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Multiplexer, parseProcessInfo, resolveHerdrBin } from "../../../hooks/lib/mux-core.ts";
import { type SendKey, alternationRegex, parseAgentInfo, parseSlotRegistry, shellInForeground } from "../child-pane-core.ts";
import { type HerdrResult, type HerdrRunner, type LayoutCommand, type LayoutOutcome, HERDR_TIMEOUT_MS, applyLayout, failureDetail, herdrRunner, readLivePanes, readTabLayout, spawnEnv } from "../herdr-cli.ts";
import type { LivePanes } from "../pane-layout.ts";
import { claudeConfigDirOf, incarnationLive } from "../record-store.ts";
import { buildHerdrRun, isClaudeForeground, parseHerdrPane, parseHerdrPaneState, promptStillInInput } from "../window.ts";
import { paneSessionFile } from "./tmux-session-files.ts";
import { type CellRect, mainColumnsRects, tmuxLayoutString } from "./tmux-layout.ts";

export type { LayoutCommand, LayoutOutcome } from "../herdr-cli.ts";

/** A key either backend can press, by the orchestrator's name for it. */
export type KeyName = SendKey;
/** What proves a pane is still the one opened: herdr's terminal id; tmux `<pane_id>:<pane_pid>`. */
export type Witness = string;
/** The states a wait can name. "detected" is a wait target, never a reported status. */
export type WaitStatus = "detected" | "idle" | "working" | "blocked" | "done";
/**
 * A reported status. "starting": tmux only, Claude Code in the foreground with
 * no session file tied to the pane yet; "unknown": herdr's own unknown; null:
 * herdr gave none.
 */
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "starting" | "unknown" | null;
export type AgentSeen =
  /** No agent: a shell or another program. */
  | { kind: "none" }
  /**
   * `agent` is herdr's name for it, and always "claude" under tmux. `session`
   * null means the session is unknown, which occupancy reads as unbound.
   */
  | { kind: "agent"; agent: string; session: string | null; status: AgentStatus }
  /** The pane does not exist. */
  | { kind: "gone" }
  /** The multiplexer gave no usable answer. */
  | { kind: "failed"; why: string };
export type Result = { ok: true } | { ok: false; gone: boolean; error: string };
export type ReadResult = { ok: true; text: string } | { ok: false; gone: boolean; error: string };
export type InputCheck = { ok: true } | { ok: false; reason: "gone" | "witness" | "no-agent" | "failed"; detail: string };
export type WaitOutcome = "reached" | "timeout" | "no-agent" | "gone" | "failed";
export type OutputOutcome = "matched" | "timeout" | "gone" | "failed";
export type LiveList = { ok: true; panes: ReadonlyMap<string, Witness> } | { ok: false; error: string };
export type Family =
  | {
      ok: true;
      /** The window's or tab's panes: tmux pane-index order; herdr split-tree order. */
      order: string[];
      /** Terminal-plugin slots opened for an agent in this window or tab. */
      slots: Set<string>;
      /** herdr's tab id; null under tmux. */
      tab: string | null;
      size: { columns: number; rows: number } | null;
      active: string | null;
      /** Why the slots could not be read, when they could not; they then count as foreign. */
      slotsNote: string | null;
    }
  | { ok: false; error: string };
export type Split = { ok: true; pane: string; witness: Witness } | { ok: false; error: string };

/** What a script asks of, or does to, a pane in the multiplexer it lives in. */
export interface PaneIO {
  readonly mux: Multiplexer;
  /**
   * This session's own pane: herdr's HERDR_PANE_ID; tmux's TMUX_PANE, which must
   * look like `%N` (no tmux call otherwise) and name a live pane (one call).
   * Null when missing or invalid.
   */
  ownPane(env: Readonly<Record<string, string | undefined>>): string | null;
  witness(pane: string): Witness | null;
  /** Before every input: the witness still holds, and with `needAgent`, an agent runs in the pane. */
  checkInput(pane: string, expected: Witness, opts: { needAgent: boolean }): InputCheck;
  agent(pane: string): AgentSeen;
  /**
   * Waits for one of `until`. "detected" is reached by any agent whose status
   * is not "starting". "no-agent": no agent runs in the pane, so the caller
   * can stop at once instead of waiting out the timeout.
   */
  agentWait(pane: string, until: readonly WaitStatus[], timeoutMs: number): WaitOutcome;
  /** Whether the pane's own shell is in the foreground; null when that could not be read. */
  shellForeground(pane: string): boolean | null;
  /** "visible": the screen as shown now. "recent": the last `lines` lines, unwrapped. */
  read(pane: string, opts: { lines: number; source: "visible" | "recent" }): ReadResult;
  /** Waits for any of the literal `patterns` in the recent screen. */
  waitOutput(pane: string, patterns: readonly string[], timeoutMs: number): OutputOutcome;
  cwd(pane: string): string | null;
  /** herdr's "done": a turn finished while the pane was unfocused. Always false under tmux. */
  finishedTurn(pane: string): boolean;
  /** Types one line into the pane's interactive shell and presses Enter. */
  runLine(pane: string, line: string): Result;
  /** Types text literally, without Enter. */
  sendText(pane: string, text: string): Result;
  sendKeys(pane: string, keys: readonly KeyName[]): Result;
  /**
   * Whether Claude Code took a submitted prompt, waiting up to 15 s. `before`
   * is the screen just before the prompt was typed; `wasDone` is
   * `finishedTurn` as it was then.
   */
  landed(pane: string, prompt: string, before: string, wasDone: boolean): boolean;
  /** Every pane on this multiplexer's server, in any window or tab, with its witness. */
  livePanes(): LiveList;
  /** The window or tab holding `main`. `live` saves a second pane list when the caller has one. */
  family(main: string, live?: LivePanes): Family;
  /** Opens a pane to the right of `target`, in `dir`, without taking the focus. */
  splitBeside(target: string, opts: { dir: string }): Split;
  close(pane: string): Result;
  layout(cmd: LayoutCommand): LayoutOutcome;
}

/** One tmux call: `out` is stdout, or on failure stdout and stderr. */
export type TmuxRunner = (argv: readonly string[]) => { ok: boolean; out: string };

export interface PaneIODeps {
  herdr?: HerdrRunner;
  tmux?: TmuxRunner;
  /** `<claude config dir>/sessions`, where tmux agent identity is read. */
  sessionsDir?: string;
  /** The `ps -axo pid=,ppid=` table; null when it could not be read. */
  ps?: () => string | null;
  /** Whether a pid runs and started when the procStart says. */
  live?: (pid: number, procStart: string | null) => boolean;
  /**
   * Read for the terminal plugin's herdr slot records (HERDR_SOCKET_PATH,
   * XDG_STATE_HOME) and the sessions directory; when given, the default tmux and
   * herdr runners also run with it.
   */
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
}

/** How long one `herdr agent wait` poll may block when it only checks the state now. */
const HERDR_AGENT_POLL_MS = 500;
/** How long `landed` waits for Claude Code to show it took a submitted prompt. */
const LANDED_WAIT_MS = 15_000;
/** How much longer than its own `--timeout` a blocking herdr call may run. */
const HERDR_WAIT_GRACE_MS = 2_000;
/** How often the tmux side polls, having no blocking wait of its own. */
const TMUX_POLL_MS = 250;
const RECENT_LINES = 200;

// --- herdr ----------------------------------------------------------------------

let herdrExec: HerdrRunner | undefined;

/** One herdr call, through the resolved binary, with a timeout. */
export function herdr(args: readonly string[], timeoutMs?: number): HerdrResult {
  herdrExec ??= herdrRunner(resolveHerdrBin(process.env, process.env.HOME || homedir()) ?? "herdr");
  return herdrExec(args, timeoutMs);
}

/** A herdr call's stdout, so a JSON answer is not mixed with warnings on stderr; on failure its stderr. */
export function herdrJson(args: readonly string[]): { ok: boolean; out: string } {
  const r = herdr(args);
  if (r.timedOut) return { ok: false, out: `herdr did not answer within ${HERDR_TIMEOUT_MS} ms` };
  return { ok: r.ok, out: (r.ok ? r.stdout : r.stderr).trim() };
}

/** The part of a prompt looked for on screen: its first 40 characters, up to the first line break. */
export function promptHead(prompt: string): string {
  return prompt.slice(0, 40).split("\n")[0] ?? "";
}

/** The screen without its input box: everything but the last `❯` line. */
function outsideInput(screen: string): string {
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.trimStart().startsWith("❯")) return [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
  }
  return screen;
}

const HERDR_KEYS: Readonly<Record<KeyName, string>> = {
  enter: "enter",
  escape: "esc",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  tab: "tab",
  backspace: "backspace",
  space: "space",
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
};

const AGENT_STATUSES = new Set(["idle", "working", "blocked", "done", "unknown"]);

function herdrStatus(status: string | null): AgentStatus {
  if (status === null) return null;
  return AGENT_STATUSES.has(status) ? (status as AgentStatus) : "unknown";
}

function herdrResult(r: HerdrResult, what: string): Result {
  if (r.ok) return { ok: true };
  return { ok: false, gone: r.errorCode === "pane_not_found", error: `herdr ${what}: ${failureDetail(r)}` };
}

/** The terminal-plugin slots opened for this manager, from tmux-mcp's herdr records. Read only: tmux-mcp replaces them by rename. */
function herdrSlots(env: Readonly<Record<string, string | undefined>>, home: string, live: LivePanes, main: string): { slots: Set<string>; note: string | null } {
  const socket = env.HERDR_SOCKET_PATH;
  if (!socket) return { slots: new Set(), note: null };
  const root = join(env.XDG_STATE_HOME || join(home, ".local", "state"), "tmux-mcp", "herdr");
  const hash = createHash("sha256").update(socket).digest("hex");
  const registry = join(root, `${hash}.json`);
  const readOrBlank = (path: string): string | null => {
    try {
      return readFileSync(path, "utf8");
    } catch (err) {
      // An unreadable file never parses, so it is reported as unreadable rather than as absent.
      return (err as NodeJS.ErrnoException).code === "ENOENT" ? null : "";
    }
  };
  const slots = parseSlotRegistry(readOrBlank(registry), readOrBlank(join(root, `${hash}.layout.json`)), live, main);
  if (slots === "unreadable") return { slots: new Set(), note: `terminal slot records at ${registry} could not be read; slots count as foreign` };
  return { slots: slots ?? new Set(), note: null };
}

function herdrIO(run: HerdrRunner, env: Readonly<Record<string, string | undefined>>, home: string): PaneIO {
  const agentReaches = (pane: string, until: readonly string[], ms: number): HerdrResult =>
    run(["agent", "wait", pane, ...until.flatMap((state) => ["--until", state]), "--timeout", String(ms)], ms + HERDR_WAIT_GRACE_MS);
  const paneRead = (pane: string, source: string, lines?: number): HerdrResult =>
    run(["pane", "read", pane, "--source", source, ...(lines === undefined ? [] : ["--lines", String(lines)])]);
  const readAnswer = (r: HerdrResult, pane: string): ReadResult =>
    r.ok ? { ok: true, text: r.stdout } : { ok: false, gone: r.errorCode === "pane_not_found", error: `could not read ${pane}: ${failureDetail(r)}` };

  const io: PaneIO = {
    mux: "herdr",
    ownPane: (e) => (e.HERDR_PANE_ID ? e.HERDR_PANE_ID : null),
    witness: (pane) => {
      const r = run(["pane", "get", pane], HERDR_TIMEOUT_MS);
      return r.ok ? (parseHerdrPaneState(r.stdout)?.terminal ?? null) : null;
    },
    checkInput: (pane, expected, { needAgent }) => {
      const r = run(["pane", "get", pane], HERDR_TIMEOUT_MS);
      if (r.errorCode === "pane_not_found") return { ok: false, reason: "gone", detail: "the pane closed" };
      const state = r.ok ? parseHerdrPaneState(r.stdout) : null;
      if (state === null) return { ok: false, reason: "failed", detail: "herdr gave no readable answer for the pane" };
      if (state.terminal !== expected) return { ok: false, reason: "witness", detail: `the pane now holds another terminal (${state.terminal ?? "none"}, expected ${expected})` };
      if (needAgent && state.agent === null) return { ok: false, reason: "no-agent", detail: "no agent runs in the pane any more" };
      return { ok: true };
    },
    agent: (pane) => {
      const r = run(["agent", "get", pane]);
      if (r.errorCode === "pane_not_found") return { kind: "gone" };
      if (r.errorCode === "agent_not_found") return { kind: "none" };
      const info = r.ok ? parseAgentInfo(r.json) : null;
      if (info !== null) return { kind: "agent", agent: info.agent, session: info.session, status: herdrStatus(info.status) };
      return { kind: "failed", why: r.ok ? "herdr agent get: unreadable answer" : `herdr agent get: ${failureDetail(r)}` };
    },
    agentWait: (pane, until, timeoutMs) => {
      const r = agentReaches(pane, until, timeoutMs);
      if (r.ok) return "reached";
      if (r.errorCode === "pane_not_found") return "gone";
      if (r.errorCode === "agent_not_found") return "no-agent";
      if (r.timedOut || r.errorCode === "timeout") return "timeout";
      return "failed";
    },
    shellForeground: (pane) => {
      const r = run(["pane", "process-info", "--pane", pane]);
      const procs = parseProcessInfo(r.stdout.trim() !== "" ? r.stdout : r.stderr, r.exitCode);
      return procs !== null && typeof procs === "object" ? shellInForeground(procs) : null;
    },
    read: (pane, { lines, source }) => {
      if (source === "visible") return readAnswer(paneRead(pane, "visible"), pane);
      const viaAgent = run(["agent", "read", pane, "--source", "recent-unwrapped", "--lines", String(lines)]);
      return readAnswer(viaAgent.errorCode === "agent_not_found" ? paneRead(pane, "recent-unwrapped", lines) : viaAgent, pane);
    },
    waitOutput: (pane, patterns, timeoutMs) => {
      const r = run(
        ["pane", "wait-output", pane, "--regex", alternationRegex(patterns), "--source", "recent-unwrapped", "--lines", String(RECENT_LINES), "--timeout", String(timeoutMs)],
        timeoutMs + HERDR_WAIT_GRACE_MS,
      );
      if (r.ok) return "matched";
      if (r.errorCode === "pane_not_found") return "gone";
      if (r.timedOut || r.errorCode === "timeout") return "timeout";
      return "failed";
    },
    cwd: (pane) => {
      const r = run(["pane", "get", pane]);
      return r.ok ? parseHerdrPane(r.stdout)?.cwd || null : null;
    },
    finishedTurn: (pane) => {
      const r = run(["pane", "get", pane]);
      return r.ok && parseHerdrPaneState(r.stdout)?.status === "done";
    },
    runLine: (pane, line) => herdrResult(run(buildHerdrRun(pane, line).slice(1)), "pane run"),
    sendText: (pane, text) => herdrResult(run(["pane", "send-text", pane, text]), "pane send-text"),
    sendKeys: (pane, keys) => {
      for (const key of keys) {
        const sent = herdrResult(run(["pane", "send-keys", pane, HERDR_KEYS[key]]), "pane send-keys");
        if (!sent.ok) return sent;
      }
      return { ok: true };
    },
    // herdr tracks the agent's state: a prompt Claude Code took turns it to
    // working, or to done when the turn is already over. A pane that was already
    // done would satisfy `done` at once, so only `working` proves anything there.
    landed: (pane, _prompt, _before, wasDone) => agentReaches(pane, wasDone ? ["working"] : ["working", "done"], LANDED_WAIT_MS).ok,
    livePanes: () => {
      const listed = readLivePanes(run);
      return listed.ok ? { ok: true, panes: listed.live } : { ok: false, error: listed.error };
    },
    family: (main, known) => {
      const tab = readTabLayout(run, main);
      if (!tab.ok) return { ok: false, error: tab.error };
      let live = known;
      if (live === undefined) {
        const listed = readLivePanes(run);
        if (!listed.ok) return { ok: false, error: listed.error };
        live = listed.live;
      }
      const { slots, note } = herdrSlots(env, home, live, main);
      const { view } = tab;
      return {
        ok: true,
        order: view.panes.map((pane) => pane.id),
        slots,
        tab: view.tabId,
        size: view.area === null ? null : { columns: view.area.width, rows: view.area.height },
        active: view.focused,
        slotsNote: note,
      };
    },
    splitBeside: (target, { dir }) => {
      const r = run(["pane", "split", target, "--direction", "right", "--ratio", "0.5", "--cwd", dir, "--no-focus"]);
      if (!r.ok) return { ok: false, error: `herdr pane split: ${failureDetail(r)}` };
      const pane = parseHerdrPane(r.stdout)?.paneId ?? null;
      if (pane === null) return { ok: false, error: `herdr pane split named no pane: ${r.stdout.trim()}` };
      const terminal = parseHerdrPaneState(r.stdout)?.terminal ?? null;
      if (terminal === null) {
        run(["pane", "close", pane]);
        return { ok: false, error: `herdr pane split named no terminal, so ${pane} was closed unused` };
      }
      return { ok: true, pane, witness: terminal };
    },
    close: (pane) => herdrResult(run(["pane", "close", pane]), "pane close"),
    layout: (cmd) => applyLayout(run, cmd),
  };
  return io;
}

// --- tmux -----------------------------------------------------------------------

/** How long one tmux call may run, as for herdr: a wedged server cannot hang the caller. */
export const TMUX_TIMEOUT_MS = HERDR_TIMEOUT_MS;

/** A tmux runner. With `env`, tmux runs with exactly that environment (TMUX and TMUX_TMPDIR pick its server). */
function tmuxRunner(env?: Readonly<Record<string, string | undefined>>): TmuxRunner {
  return (argv) => tmuxCli(argv, env);
}

function tmuxCli(argv: readonly string[], env?: Readonly<Record<string, string | undefined>>): { ok: boolean; out: string } {
  try {
    const p = Bun.spawnSync(["tmux", ...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: TMUX_TIMEOUT_MS, ...spawnEnv(env) });
    if (p.exitedDueToTimeout === true) return { ok: false, out: `tmux did not answer within ${TMUX_TIMEOUT_MS} ms` };
    const ok = p.exitCode === 0;
    return { ok, out: (ok ? p.stdout.toString() : p.stdout.toString() + p.stderr.toString()).trim() };
  } catch (err) {
    // A missing binary throws instead of exiting non-zero.
    return { ok: false, out: err instanceof Error ? err.message : String(err) };
  }
}

function psTable(): string | null {
  try {
    const p = Bun.spawnSync(["ps", "-axo", "pid=,ppid="], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 2_000 });
    return p.exitCode === 0 ? p.stdout.toString() : null;
  } catch {
    return null;
  }
}

/** tmux's answer for a pane that does not exist. */
function tmuxSaysGone(out: string): boolean {
  return /can't find (pane|window)/i.test(out);
}

const TMUX_KEYS: Readonly<Record<KeyName, readonly string[]>> = {
  enter: ["Enter"],
  escape: ["Escape"],
  up: ["Up"],
  down: ["Down"],
  left: ["Left"],
  right: ["Right"],
  tab: ["Tab"],
  backspace: ["BSpace"],
  space: ["Space"],
  "0": ["-l", "0"],
  "1": ["-l", "1"],
  "2": ["-l", "2"],
  "3": ["-l", "3"],
  "4": ["-l", "4"],
  "5": ["-l", "5"],
  "6": ["-l", "6"],
  "7": ["-l", "7"],
  "8": ["-l", "8"],
  "9": ["-l", "9"],
};

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "mksh", "tcsh", "csh", "nu", "elvish", "xonsh"]);

/** Whether a `#{pane_current_command}` names an interactive shell; a login shell's leading `-` is ignored. */
function isShellCommand(command: string): boolean {
  return SHELLS.has(command.trim().replace(/^-/, ""));
}

/**
 * Claude Code's session-file status word, as an agent status. A missing or
 * unrecognised word is "unknown", as herdr reports its own unknown, so a session
 * that may be working is never read as idle.
 */
function claudeStatus(status: string | null): AgentStatus {
  if (status === "idle") return "idle";
  if (status === "busy" || status === "shell") return "working";
  if (status === "waiting") return "blocked";
  return "unknown";
}

function tmuxResult(r: { ok: boolean; out: string }, what: string): Result {
  return r.ok ? { ok: true } : { ok: false, gone: tmuxSaysGone(r.out), error: `tmux ${what}: ${r.out || "failed"}` };
}

/** Whether every pane sits where its planned rectangle says, allowing one cell for tmux's borders. */
function misplaced(planned: ReadonlyMap<string, CellRect>, listed: string): string | null {
  const seen = new Set<string>();
  for (const line of listed.split("\n")) {
    const [id, left, top, width, height] = line.split("\t");
    const want = id === undefined ? undefined : planned.get(id);
    if (id === undefined || want === undefined) continue;
    seen.add(id);
    const got = [left, top, width, height].map(Number);
    const diff = [want.left, want.top, want.width, want.height].map((v, i) => Math.abs(v - (got[i] as number)));
    if (diff.some((d) => !Number.isFinite(d) || d > 1)) return `${id} is at ${left},${top} ${width}x${height}, planned ${want.left},${want.top} ${want.width}x${want.height}`;
  }
  for (const id of planned.keys()) if (!seen.has(id)) return `${id} is not in the window after the layout`;
  return null;
}

type Displayed = { ok: true; values: string[] } | { ok: false; gone: boolean; detail: string };

function tmuxIO(tmux: TmuxRunner, sessionsDir: string, ps: () => string | null, live: (pid: number, procStart: string | null) => boolean): PaneIO {
  /**
   * `display -p` of `fields` for one pane, led by `#{pane_id}`: tmux answers a
   * pane that does not exist with exit 0 and empty fields, so an empty or other
   * pane id is what says the pane is gone.
   */
  const display = (pane: string, fields: readonly string[]): Displayed => {
    const r = tmux(["display", "-p", "-t", pane, ["#{pane_id}", ...fields].join("\t")]);
    if (!r.ok) return { ok: false, gone: tmuxSaysGone(r.out), detail: `tmux display: ${r.out || "failed"}` };
    const [id = "", ...values] = r.out.split("\t");
    if (id !== pane) return { ok: false, gone: true, detail: `tmux names no pane ${pane}` };
    return { ok: true, values };
  };
  const capture = (pane: string, source: "visible" | "recent", lines: number) =>
    tmux(source === "visible" ? ["capture-pane", "-p", "-t", pane] : ["capture-pane", "-p", "-J", "-t", pane, "-S", `-${lines}`]);

  const witnessOf = (pane: string): { ok: true; witness: Witness } | { ok: false; gone: boolean; detail: string } => {
    const r = display(pane, ["#{pane_pid}"]);
    if (!r.ok) return r;
    const [pid = ""] = r.values;
    if (!/^\d+$/.test(pid)) return { ok: false, gone: false, detail: `tmux gave no pane pid for ${pane}` };
    return { ok: true, witness: `${pane}:${pid}` };
  };

  const agent = (pane: string): AgentSeen => {
    const r = display(pane, ["#{pane_current_command}", "#{pane_pid}"]);
    if (!r.ok) return r.gone ? { kind: "gone" } : { kind: "failed", why: r.detail };
    const [command = "", pid = ""] = r.values;
    if (!isClaudeForeground(command)) return { kind: "none" };
    if (!/^\d+$/.test(pid)) return { kind: "failed", why: `tmux gave no pane pid for ${pane}` };
    // paneSessionFile reads null both for no file and for no process table; only the first means starting.
    let psFailed = false;
    const table = (): string | null => {
      const t = ps();
      if (t === null) psFailed = true;
      return t;
    };
    const file = paneSessionFile(pane, Number(pid), { sessionsDir, ps: table, live });
    if (file === null && psFailed) return { kind: "failed", why: "could not read the process table" };
    if (file === null) return { kind: "agent", agent: "claude", session: null, status: "starting" };
    return { kind: "agent", agent: "claude", session: file.sessionId, status: claudeStatus(file.status) };
  };

  const family = (main: string): Family => {
    const listed = tmux(["list-panes", "-t", main, "-F", "#{pane_id}\t#{pane_index}\t#{pane_active}\t#{@mcp_pane}\t#{@mcp_owner}\t#{@mcp_slot}"]);
    if (!listed.ok) return { ok: false, error: `tmux list-panes: ${listed.out || "failed"}` };
    const rows = listed.out
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [id = "", index = "", active = "", mcpPane = "", owner = "", slot = ""] = line.split("\t");
        return { id, index: Number(index), active: active === "1", slot: mcpPane === id && owner === "agent" && slot !== "" };
      })
      .sort((a, b) => a.index - b.index);
    const size = display(main, ["#{window_width}", "#{window_height}"]);
    const [columns, rowsTall] = size.ok ? size.values.map(Number) : [];
    return {
      ok: true,
      order: rows.map((row) => row.id),
      slots: new Set(rows.filter((row) => row.slot).map((row) => row.id)),
      tab: null,
      size: Number.isInteger(columns) && Number.isInteger(rowsTall) ? { columns: columns as number, rows: rowsTall as number } : null,
      active: rows.find((row) => row.active)?.id ?? null,
      slotsNote: null,
    };
  };

  const layout = (cmd: LayoutCommand): LayoutOutcome => {
    const outcome = (status: LayoutOutcome["status"], order: string[], rest: Partial<LayoutOutcome> = {}): LayoutOutcome => ({
      status,
      order,
      slots: [...(cmd.slots ?? [])],
      foreign: [],
      restored: [],
      stranded: [],
      error: null,
      ...rest,
    });
    if (cmd.layout !== "main-columns") return outcome("failed", [], { error: `layout ${cmd.layout} is herdr only; tmux lays out main-columns` });
    const fam = family(cmd.main);
    if (!fam.ok) return outcome("failed", [], { error: fam.error });
    const order = fam.order;
    if (cmd.members !== undefined) {
      const allowed = new Set([...cmd.members, cmd.main]);
      const foreign = order.filter((pane) => !allowed.has(pane));
      if (foreign.length > 0) return outcome("refused", order, { foreign });
    }
    if (order.length === 1 && order[0] === cmd.main) return outcome("unchanged", order);
    if (fam.size === null) return outcome("failed", order, { error: "tmux did not report the window size" });

    // The same order herdr plans with: main first, the rest as they stand.
    const target = [cmd.main, ...order.filter((pane) => pane !== cmd.main)];
    const cur = [...order];
    for (let i = 0; i < target.length; i++) {
      const want = target[i] as string;
      if (cur[i] === want) continue;
      const j = cur.indexOf(want);
      const swapped = tmux(["swap-pane", "-d", "-s", want, "-t", cur[i] as string]);
      if (!swapped.ok) return outcome("failed", cur, { error: `tmux swap-pane -s ${want} -t ${cur[i]}: ${swapped.out || "failed"}` });
      cur[j] = cur[i] as string;
      cur[i] = want;
    }

    let rects: CellRect[];
    try {
      rects = mainColumnsRects(target.length, fam.size, { mainMin: cmd.mainMin, columnSize: cmd.columnSize });
    } catch (err) {
      return outcome("failed", cur, { error: err instanceof Error ? err.message : String(err) });
    }
    const applied = tmux(["select-layout", "-t", cmd.main, tmuxLayoutString(rects, fam.size)]);
    if (!applied.ok) return outcome("failed", cur, { error: `tmux select-layout: ${applied.out || "failed"}` });

    const placed = tmux(["list-panes", "-t", cmd.main, "-F", "#{pane_id}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}\t#{pane_active}"]);
    if (!placed.ok) return outcome("failed", cur, { error: `tmux list-panes: ${placed.out || "failed"}` });
    const activeNow = placed.out.split("\n").find((line) => line.endsWith("\t1"))?.split("\t")[0] ?? null;
    if (fam.active !== null && activeNow !== fam.active) tmux(["select-pane", "-t", fam.active]);
    const wrong = misplaced(new Map(target.map((pane, i) => [pane, rects[i] as CellRect])), placed.out);
    return wrong === null ? outcome("applied", cur) : outcome("failed", cur, { error: wrong });
  };

  const io: PaneIO = {
    mux: "tmux",
    ownPane: (e) => {
      const pane = e.TMUX_PANE;
      if (pane === undefined || !/^%\d+$/.test(pane)) return null;
      return display(pane, []).ok ? pane : null;
    },
    witness: (pane) => {
      const w = witnessOf(pane);
      return w.ok ? w.witness : null;
    },
    checkInput: (pane, expected, { needAgent }) => {
      const w = witnessOf(pane);
      if (!w.ok) return { ok: false, reason: w.gone ? "gone" : "failed", detail: w.gone ? "the pane closed" : w.detail };
      if (w.witness !== expected) return { ok: false, reason: "witness", detail: `the pane now holds another process (${w.witness}, expected ${expected})` };
      if (!needAgent) return { ok: true };
      // The shell's pid does not change when Claude Code exits, so the witness alone cannot see it.
      const seen = agent(pane);
      if (seen.kind === "agent") return { ok: true };
      if (seen.kind === "gone") return { ok: false, reason: "gone", detail: "the pane closed" };
      if (seen.kind === "failed") return { ok: false, reason: "failed", detail: seen.why };
      return { ok: false, reason: "no-agent", detail: "no agent runs in the pane any more" };
    },
    agent,
    agentWait: (pane, until, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      let failures = 0;
      for (;;) {
        const seen = agent(pane);
        if (seen.kind === "gone") return "gone";
        if (seen.kind === "none") return "no-agent";
        if (seen.kind === "failed") {
          failures++;
          if (failures >= 3) return "failed";
        } else {
          failures = 0;
          const reached = until.some((state) => (state === "detected" ? seen.status !== "starting" : seen.status === state));
          if (reached) return "reached";
        }
        if (Date.now() >= deadline) return "timeout";
        Bun.sleepSync(TMUX_POLL_MS);
      }
    },
    shellForeground: (pane) => {
      const r = display(pane, ["#{pane_current_command}"]);
      return r.ok ? isShellCommand(r.values[0] ?? "") : null;
    },
    read: (pane, { lines, source }) => {
      const r = capture(pane, source, lines);
      return r.ok ? { ok: true, text: r.out } : { ok: false, gone: tmuxSaysGone(r.out), error: `could not read ${pane}: ${r.out || "tmux capture-pane failed"}` };
    },
    waitOutput: (pane, patterns, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const r = capture(pane, "recent", RECENT_LINES);
        if (!r.ok) return tmuxSaysGone(r.out) ? "gone" : "failed";
        if (patterns.some((pattern) => r.out.includes(pattern))) return "matched";
        if (Date.now() >= deadline) return "timeout";
        Bun.sleepSync(TMUX_POLL_MS);
      }
    },
    cwd: (pane) => {
      const r = display(pane, ["#{pane_current_path}"]);
      const path = r.ok ? (r.values[0] ?? "") : "";
      return path !== "" ? path : null;
    },
    finishedTurn: () => false,
    runLine: (pane, line) => {
      // -l types the text literally and `--` ends the options, so a leading hyphen is text; Enter goes separately, as a keypress.
      const typed = tmuxResult(tmux(["send-keys", "-t", pane, "-l", "--", line]), "send-keys");
      return typed.ok ? tmuxResult(tmux(["send-keys", "-t", pane, "Enter"]), "send-keys") : typed;
    },
    // `--` ends the options, so text that starts with a hyphen is typed, not read as a flag.
    sendText: (pane, text) => tmuxResult(tmux(["send-keys", "-t", pane, "-l", "--", text]), "send-keys"),
    sendKeys: (pane, keys) => {
      for (const key of keys) {
        const sent = tmuxResult(tmux(["send-keys", "-t", pane, ...TMUX_KEYS[key]]), "send-keys");
        if (!sent.ok) return sent;
      }
      return { ok: true };
    },
    // tmux cannot tell what Claude Code is doing, so the screen decides. The
    // prompt landed when its first 40 characters show outside the input box (the
    // transcript echoes a submitted prompt), or when the screen differs from the
    // one before typing and the prompt is not in the input box (Claude Code
    // cleared the box and is working). A dropped prompt leaves the screen as it was.
    // Only a screen that was read counts: a pane that is gone never took it, and
    // a read that failed proves nothing either way.
    landed: (pane, prompt, before) => {
      const head = promptHead(prompt);
      const by = Date.now() + LANDED_WAIT_MS;
      for (;;) {
        const r = capture(pane, "recent", RECENT_LINES);
        if (!r.ok && tmuxSaysGone(r.out)) return false;
        if (!r.ok) {
          if (Date.now() > by) return false;
          Bun.sleepSync(500);
          continue;
        }
        const screen = r.out;
        if (head !== "" && outsideInput(screen).includes(head)) return true;
        if (screen !== before && !promptStillInInput(screen, prompt)) return true;
        if (Date.now() > by) return false;
        Bun.sleepSync(500);
      }
    },
    livePanes: () => {
      const r = tmux(["list-panes", "-a", "-F", "#{pane_id}\t#{pane_pid}"]);
      if (!r.ok) return { ok: false, error: `tmux list-panes -a: ${r.out || "failed"}` };
      const panes = new Map<string, Witness>();
      for (const line of r.out.split("\n")) {
        const [id, pid] = line.split("\t");
        if (id && pid) panes.set(id, `${id}:${pid}`);
      }
      return { ok: true, panes };
    },
    family: (main) => family(main),
    splitBeside: (target, { dir }) => {
      const r = tmux(["split-window", "-d", "-h", "-t", target, "-c", dir, "-P", "-F", "#{pane_id}\t#{pane_pid}"]);
      if (!r.ok) return { ok: false, error: `tmux split-window: ${r.out || "failed"}` };
      const [pane, pid] = r.out.split("\t");
      if (!pane || !pid || !/^\d+$/.test(pid)) return { ok: false, error: `tmux split-window named no pane: ${r.out}` };
      return { ok: true, pane, witness: `${pane}:${pid}` };
    },
    close: (pane) => tmuxResult(tmux(["kill-pane", "-t", pane]), "kill-pane"),
    layout,
  };
  return io;
}

/**
 * The pane IO for `mux`. Each dependency defaults to the real one. A given `env`
 * or `home` reaches the default runners too: tmux runs with that environment,
 * and herdr is looked up in it and run with it.
 */
export function paneIO(mux: Multiplexer, deps: PaneIODeps = {}): PaneIO {
  const env = deps.env ?? process.env;
  const home = deps.home ?? (env.HOME || homedir());
  const scoped = deps.env !== undefined || deps.home !== undefined;
  switch (mux) {
    case "tmux":
      return tmuxIO(deps.tmux ?? (deps.env !== undefined ? tmuxRunner(deps.env) : tmuxCli), deps.sessionsDir ?? join(claudeConfigDirOf(env, home), "sessions"), deps.ps ?? psTable, deps.live ?? incarnationLive);
    case "herdr":
      return herdrIO(deps.herdr ?? (scoped ? herdrRunner(resolveHerdrBin(env, home) ?? "herdr", deps.env) : herdr), env, home);
  }
}
