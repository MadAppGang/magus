/**
 * claudish session monitor: progress of claudish runs, delivered to the Claude Code window
 * that started them.
 *
 * Declared in `plugins/claudish/monitors/monitors.json` (`when: "always"`). Claude Code runs it
 * once per window and turns every stdout line into one notification. It reads the records
 * claudish writes under its sessions directory and prints one prefixed line per state change of
 * the runs THIS window started: `create_session` sessions and `team(mode:"run")` runs.
 *
 * WHAT IT READS (written by claudish 10.4.0 and later)
 *   <sessionsDir> is `CLAUDISH_SESSIONS_DIR` when set, else `<home>/.claudish/sessions`, where
 *   <home> is `$HOME`, or the OS account home when HOME is unset. claudish's writer applies the
 *   same rule (`sessionsDirFrom`), so a sandbox that moves HOME moves both sides together.
 *   <sessionsDir>/<id>/spawn.json   start record, atomic. `hostPid` names the Claude Code process
 *                                   that launched the writing MCP server; a record is ours iff
 *                                   `hostPid === CLAUDE_PID`.
 *   <sessionsDir>/<id>/waits.jsonl  one line per wait opened and closed (sessions only)
 *   <sessionsDir>/<id>/events.jsonl, tokens.json   heartbeat numbers (sessions)
 *   <teamPath>/status.json          heartbeat slot counts (team runs)
 *   <sessionsDir>/<id>/meta.json    the end
 *
 * WHY IT IS SHAPED THIS WAY
 *   - A monitor that exits is never restarted, and one that floods is stopped, and both look
 *     exactly like one that never started. So: every read degrades to absent/unreadable, every
 *     poll is wrapped, at most one write per poll, and the process exits only when its window is
 *     gone (CLAUDE_PID dead, stdout closed) or when it has no CLAUDE_PID to attribute anything by.
 *   - One file of pure functions (`admit`, `wants`, `nextEvents`, `renderLine`, `takeBatch`, the
 *     parsers) plus a thin I/O loop (`startMonitor`). The pure half is the contract tests run
 *     against; the loop only gathers observations in a fixed read order and writes batches.
 *   - `node:` built-ins only. Run with `bun --env-file=/dev/null`: the cwd is the user's project,
 *     and a `.env` there that is a symlinked FIFO makes bun exit 1 with no output.
 *
 * Stdout carries the line grammar below and nothing else; diagnostics go to stderr.
 *
 *   claudish-monitor: session <id> started|running|needs-input|completed|failed|timeout|cancelled
 *                     [key=value ...] [next: get_output|get_diagnostics|send_input <id>]
 *   claudish-monitor: team <id> started|running|completed|failed|cancelled
 *                     [key=value ...] [next: team-status]
 *   claudish-monitor: notice claudish-too-old|no-session-identity: <text>
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** When this module was evaluated. The history cut: a run that ended before it is never reported. */
const MODULE_EVALUATED_AT_MS = Date.now();

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Every stdout line starts with this. Absent from claudish's channel payloads and the description. */
export const PREFIX = "claudish-monitor:";
/** One write per poll at most, scheduled after the tick, so write gaps exceed the 2,000 ms refill grid. */
export const POLL_INTERVAL_MS = 2_500;
/** At most one `running` line per record per interval. Minutes, not seconds. */
export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
/** A listing runs at least this often even when the directory mtime did not move. */
export const RESCAN_INTERVAL_MS = 60_000;
/** claudish's MAX_TIMEOUT (3,600 s) plus grace: no live session predates this window. */
export const ADOPT_WINDOW_MS = (3600 + 120) * 1000;
/** A session's pid-reuse check starts at `startedAt + timeoutSeconds + LOST_GRACE_MS`. */
export const LOST_GRACE_MS = 2 * 60_000;
/** Team runs have no timer; their pid-reuse check starts this long after `startedAt`. */
export const TEAM_REUSE_CHECK_AFTER_MS = 30 * 60_000;
/** At most one pid-reuse check per directory per interval. */
export const REUSE_CHECK_INTERVAL_MS = 60_000;
/** Slack for `ps`'s one-second `etime` resolution. */
export const PID_AGE_TOLERANCE_MS = 5_000;
/** An undecided directory is dropped after this; also the length of the startup too-old check. */
export const UNDECIDED_GIVE_UP_MS = 60_000;
/** Under Claude Code's 500-character cut per line. */
export const MAX_LINE_CHARS = 480;
/** Cap for any value taken from a file, except `path`. */
export const MAX_FIELD_CHARS = 80;
/** Cap for the percent-encoded `path` value. */
export const MAX_PATH_CHARS = 200;
/** Under Claude Code's 3,000-character cut per batch. */
export const MAX_BATCH_CHARS = 2_900;
/** The first claudish release that writes `spawn.json`. Named in the too-old notice. */
export const MIN_CLAUDISH_VERSION = "10.4.0";

/** Bytes read from an append-only log per poll; the rest is read on the next one. */
const MAX_READ_BYTES = 4 * 1024 * 1024;
/** A spawn.json or meta.json larger than this is not a record. */
const MAX_RECORD_BYTES = 256 * 1024;
/** Files whose presence without a spawn.json marks a directory written by an older claudish. */
const RUNTIME_FILES = ["output.log", "events.jsonl", "tokens.json", "waits.jsonl", "meta.json"];
/** Directory names the listing keeps; the same rule as spawn.json's sessionId. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CLAUDE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type RecordKind = "session" | "team";
export type SessionTerminal = "completed" | "failed" | "timeout" | "cancelled";
export type TeamTerminal = "completed" | "failed" | "cancelled";
export type NoticeCode = "claudish-too-old" | "no-session-identity";
export type HostClaudish = "old" | "new" | "none" | "unknown";
export type Read<T> =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; value: T };

export interface SpawnRecord {
  kind: RecordKind;
  sessionId: string;
  parentClaudeSessionId?: string;
  hostPid: number;
  mcpPid: number;
  startedAt: string;
  model?: string;
  timeoutSeconds?: number;
  teamPath?: string;
  slots?: number;
}
export interface TerminalRecord {
  status: string;
  elapsedSeconds?: number;
  turnsCompleted?: number;
  toolCallCount?: number;
  costUsd?: number;
  terminalReason?: string | null;
  exitCode?: number | null;
  // team
  reason?: string;
  slots?: number;
  ok?: number;
  failed?: number;
  cancelled?: number;
}
export type WaitLine =
  | { wait: "open"; since: string; turns?: number }
  | { wait: "closed"; since: string; at: string; to: string };
export interface Progress {
  // session
  replies?: number;
  toolCalls?: number;
  costUsd?: number;
  // team
  slots?: number;
  ok?: number;
  failed?: number;
  running?: number;
  cancelled?: number;
}

export interface Observation {
  dir: string;
  // undecided, in this read order:
  hasRuntimeFiles?: boolean;
  spawn?: Read<SpawnRecord>;
  hostClaudish?: HostClaudish;
  // tracked, in this read order:
  writerAlive?: boolean | null;
  terminal?: Read<TerminalRecord>;
  waits?: WaitLine[];
  progress?: Read<Progress>;
}
export interface Snapshot {
  observations: Observation[];
  /** The startup too-old check (§4.6 step 5); "old" emits the notice. */
  startupHostClaudish?: HostClaudish;
  /** The claudish version read from this window's server when either check says "old". */
  oldClaudishVersion?: string;
}

export type MonitorEvent =
  | { kind: "started"; record: RecordKind; id: string; model?: string; slots?: number; path?: string }
  | {
      kind: "running";
      record: RecordKind;
      id: string;
      model?: string;
      elapsedMs: number;
      progress: Progress | null;
      path?: string;
    }
  | { kind: "needs-input"; id: string; model?: string; elapsedMs?: number; turns?: number; waitedMs?: number }
  | {
      kind: "ended";
      record: RecordKind;
      id: string;
      model?: string;
      state: SessionTerminal | TeamTerminal;
      elapsedMs?: number;
      turns?: number;
      toolCalls?: number;
      costUsd?: number;
      reason?: string;
      exitCode?: number;
      slots?: number;
      ok?: number;
      failed?: number;
      cancelled?: number;
      path?: string;
    }
  | { kind: "notice"; code: NoticeCode; version?: string };

export interface Identity {
  claudePid: number | null;
}
/** One claudish MCP server of this window; `version` null = no reading (§5.3). */
export interface ClaudishChild {
  pid: number;
  version: string | null;
}
declare const OPAQUE: unique symbol;
/** Opaque. Treat it as a value: every pure function returns a new one and never mutates its input. */
export interface MonitorState {
  readonly [OPAQUE]: true;
}
export interface ProcessRow {
  pid: number;
  ppid: number;
  ageSeconds: number;
  command: string;
}
export interface PendingLine {
  id: string | null;
  text: string;
}

// ---------------------------------------------------------------------------------------------
// Pure state
// ---------------------------------------------------------------------------------------------

interface WaitEntry {
  reported: boolean;
  closedAt?: string;
  turns?: number;
}
interface UndecidedDir {
  phase: "undecided";
  firstSeenMs: number;
}
interface TrackedDir {
  phase: "tracked";
  id: string;
  kind: RecordKind;
  model?: string;
  teamPath?: string;
  mcpPid: number;
  startedAtMs: number;
  reuseCheckFromMs: number;
  lastLineMs: number;
  waits: Map<string, WaitEntry>;
  waitOpen: boolean;
}
type DirEntry = UndecidedDir | TrackedDir;
interface StateData {
  identity: Identity;
  heartbeatIntervalMs: number;
  hostStartedAtMs: number | null;
  /** The history cut. Used only when `hostStartedAtMs` is null; see `isOurs`. */
  monitorStartMs: number | null;
  noticesSent: Set<NoticeCode>;
  dirs: Map<string, DirEntry>;
  /** Names that already produced a terminal line. Re-admitting one is ignored, so nothing ends twice. */
  retired: Set<string>;
}

const data = (state: MonitorState): StateData => state as unknown as StateData;
const wrap = (d: StateData): MonitorState => d as unknown as MonitorState;

function cloneState(state: MonitorState): StateData {
  const d = data(state);
  const dirs = new Map<string, DirEntry>();
  for (const [name, entry] of d.dirs) {
    if (entry.phase === "undecided") dirs.set(name, { ...entry });
    else {
      const waits = new Map<string, WaitEntry>();
      for (const [since, w] of entry.waits) waits.set(since, { ...w });
      dirs.set(name, { ...entry, waits });
    }
  }
  return {
    identity: { claudePid: d.identity.claudePid },
    heartbeatIntervalMs: d.heartbeatIntervalMs,
    hostStartedAtMs: d.hostStartedAtMs,
    monitorStartMs: d.monitorStartMs,
    noticesSent: new Set(d.noticesSent),
    dirs,
    retired: new Set(d.retired),
  };
}

export function initialState(
  identity: Identity,
  opts?: { heartbeatIntervalMs?: number; hostStartedAtMs?: number | null; monitorStartMs?: number | null },
): MonitorState {
  const pid = identity?.claudePid;
  const finite = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);
  return wrap({
    identity: { claudePid: typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null },
    heartbeatIntervalMs:
      typeof opts?.heartbeatIntervalMs === "number" && opts.heartbeatIntervalMs > 0
        ? opts.heartbeatIntervalMs
        : HEARTBEAT_INTERVAL_MS,
    hostStartedAtMs: finite(opts?.hostStartedAtMs),
    monitorStartMs: finite(opts?.monitorStartMs),
    noticesSent: new Set(),
    dirs: new Map(),
    retired: new Set(),
  });
}

/** Pure. Registers names as undecided. Names already in the map are ignored. */
export function admit(state: MonitorState, newDirs: string[], now: number): MonitorState {
  const d = cloneState(state);
  if (d.identity.claudePid === null) return wrap(d);
  for (const name of newDirs) {
    if (typeof name !== "string" || d.dirs.has(name) || d.retired.has(name)) continue;
    d.dirs.set(name, { phase: "undecided", firstSeenMs: now });
  }
  return wrap(d);
}

function heartbeatDue(entry: TrackedDir, d: StateData, now: number): boolean {
  return !entry.waitOpen && now - entry.lastLineMs >= d.heartbeatIntervalMs;
}

/** What the loop must observe this poll. */
export function wants(
  state: MonitorState,
  now: number,
): {
  undecided: string[];
  tracked: {
    dir: string;
    kind: RecordKind;
    mcpPid: number;
    startedAtMs: number;
    reuseCheckFromMs: number;
    teamPath?: string;
  }[];
  progressFor: string[];
} {
  const d = data(state);
  const undecided: string[] = [];
  const tracked: ReturnType<typeof wants>["tracked"] = [];
  const progressFor: string[] = [];
  for (const [dir, entry] of d.dirs) {
    if (entry.phase === "undecided") {
      undecided.push(dir);
      continue;
    }
    tracked.push({
      dir,
      kind: entry.kind,
      mcpPid: entry.mcpPid,
      startedAtMs: entry.startedAtMs,
      reuseCheckFromMs: entry.reuseCheckFromMs,
      ...(entry.teamPath !== undefined ? { teamPath: entry.teamPath } : {}),
    });
    if (heartbeatDue(entry, d, now)) progressFor.push(dir);
  }
  return { undecided, tracked, progressFor };
}

function isOurs(spawn: SpawnRecord, d: StateData): boolean {
  if (d.identity.claudePid === null || spawn.hostPid !== d.identity.claudePid) return false;
  const startedAtMs = Date.parse(spawn.startedAt);
  if (d.hostStartedAtMs !== null) {
    return Number.isFinite(startedAtMs) && startedAtMs >= d.hostStartedAtMs - PID_AGE_TOLERANCE_MS;
  }
  // No host age (no `ps`): a pid match alone cannot tell this window from a dead one whose pid
  // it reused. Fail closed for anything begun before the monitor started, the same rule the
  // baseline applies to in-flight runs, so such a run is not picked up even when it ends later.
  if (d.monitorStartMs === null) return true;
  return Number.isFinite(startedAtMs) && startedAtMs >= d.monitorStartMs;
}

function noticeOnce(d: StateData, code: NoticeCode, events: MonitorEvent[], version?: string): void {
  if (d.noticesSent.has(code)) return;
  d.noticesSent.add(code);
  events.push(version !== undefined ? { kind: "notice", code, version } : { kind: "notice", code });
}

function track(spawn: SpawnRecord, now: number): TrackedDir {
  const startedAtMs = Date.parse(spawn.startedAt);
  const reuseCheckFromMs =
    spawn.kind === "session"
      ? startedAtMs + (spawn.timeoutSeconds ?? 3600) * 1000 + LOST_GRACE_MS
      : startedAtMs + TEAM_REUSE_CHECK_AFTER_MS;
  return {
    phase: "tracked",
    id: spawn.sessionId,
    kind: spawn.kind,
    ...(spawn.model !== undefined ? { model: spawn.model } : {}),
    ...(spawn.teamPath !== undefined ? { teamPath: spawn.teamPath } : {}),
    mcpPid: spawn.mcpPid,
    startedAtMs,
    reuseCheckFromMs,
    lastLineMs: now,
    waits: new Map(),
    waitOpen: false,
  };
}

function startedEvent(entry: TrackedDir, spawn: SpawnRecord): MonitorEvent {
  if (entry.kind === "team") {
    return {
      kind: "started",
      record: "team",
      id: entry.id,
      ...(spawn.slots !== undefined ? { slots: spawn.slots } : {}),
      ...(entry.teamPath !== undefined ? { path: entry.teamPath } : {}),
    };
  }
  return { kind: "started", record: "session", id: entry.id, ...(entry.model !== undefined ? { model: entry.model } : {}) };
}

function decideUndecided(
  d: StateData,
  name: string,
  entry: UndecidedDir,
  obs: Observation,
  snapshot: Snapshot,
  now: number,
  events: MonitorEvent[],
): void {
  const spawn = obs.spawn ?? { kind: "absent" as const };
  switch (spawn.kind) {
    case "ok": {
      // A record names its own directory. One that names another would retire one name and
      // report a different id, so it is not a record of this layout.
      if (spawn.value.sessionId !== name || !isOurs(spawn.value, d)) {
        d.dirs.delete(name);
        return;
      }
      const tracked = track(spawn.value, now);
      d.dirs.set(name, tracked);
      events.push(startedEvent(tracked, spawn.value));
      return;
    }
    case "invalid":
      d.dirs.delete(name);
      return;
    case "unreadable":
      break;
    case "absent": {
      if (obs.hasRuntimeFiles !== true) break;
      const host = obs.hostClaudish ?? "unknown";
      if (host === "old") {
        d.dirs.delete(name);
        noticeOnce(d, "claudish-too-old", events, snapshot.oldClaudishVersion);
        return;
      }
      if (host === "new" || host === "none") {
        d.dirs.delete(name);
        return;
      }
      break;
    }
    default:
      assertNever(spawn);
  }
  if (now - entry.firstSeenMs > UNDECIDED_GIVE_UP_MS) d.dirs.delete(name);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** `since` (and a closed wait's `at`) must be timestamps: a wait without a time is not a wait. */
function isWaitLine(w: unknown): w is WaitLine {
  if (!w || typeof w !== "object") return false;
  const line = w as Record<string, unknown>;
  if (!isTimestamp(line.since)) return false;
  if (line.wait === "open") return true;
  return line.wait === "closed" && isTimestamp(line.at);
}

function applyWaits(entry: TrackedDir, lines: WaitLine[] | undefined): void {
  if (!Array.isArray(lines)) return;
  for (const line of lines) {
    if (!isWaitLine(line)) continue;
    const existing = entry.waits.get(line.since);
    if (line.wait === "open") {
      if (!existing) {
        entry.waits.set(line.since, {
          reported: false,
          ...(nonNegativeInt(line.turns) !== undefined ? { turns: nonNegativeInt(line.turns) } : {}),
        });
      }
    } else if (existing) existing.closedAt = line.at;
    else entry.waits.set(line.since, { reported: false, closedAt: line.at });
  }
  let newest: string | undefined;
  for (const since of entry.waits.keys()) if (newest === undefined || bySince(since, newest) > 0) newest = since;
  entry.waitOpen = newest !== undefined && entry.waits.get(newest)?.closedAt === undefined;
}

/**
 * Wait order is time order. `since` is any string `Date.parse` accepts, and two encodings of
 * nearby instants (`…Z` against `…-05:00`) sort the wrong way as text. Ties fall back to the text.
 */
function bySince(a: string, b: string): number {
  const diff = Date.parse(a) - Date.parse(b);
  if (diff !== 0 && Number.isFinite(diff)) return diff;
  return a < b ? -1 : a > b ? 1 : 0;
}

function reportWaits(entry: TrackedDir, now: number, events: MonitorEvent[]): void {
  const pending = [...entry.waits.entries()].filter(([, w]) => !w.reported).sort(([a], [b]) => bySince(a, b));
  for (const [since, w] of pending) {
    w.reported = true;
    const sinceMs = Date.parse(since);
    const elapsedMs = Number.isFinite(sinceMs) ? sinceMs - entry.startedAtMs : undefined;
    const closedMs = w.closedAt !== undefined ? Date.parse(w.closedAt) : Number.NaN;
    events.push({
      kind: "needs-input",
      id: entry.id,
      ...(entry.model !== undefined ? { model: entry.model } : {}),
      ...(elapsedMs !== undefined && elapsedMs >= 0 ? { elapsedMs } : {}),
      ...(w.turns !== undefined ? { turns: w.turns } : {}),
      ...(w.closedAt !== undefined
        ? { waitedMs: Number.isFinite(closedMs) && Number.isFinite(sinceMs) ? Math.max(0, closedMs - sinceMs) : 0 }
        : {}),
    });
    entry.lastLineMs = now;
  }
}

const SESSION_TERMINALS: readonly string[] = ["completed", "failed", "timeout", "cancelled"];
const TEAM_TERMINALS: readonly string[] = ["completed", "failed", "cancelled"];

function endedFromRecord(entry: TrackedDir, rec: TerminalRecord): MonitorEvent {
  const terminals = entry.kind === "session" ? SESSION_TERMINALS : TEAM_TERMINALS;
  const known = terminals.includes(rec.status);
  const state = (known ? rec.status : "failed") as SessionTerminal | TeamTerminal;
  const failure = state === "failed" || state === "timeout";
  const rawReason = entry.kind === "session" ? rec.terminalReason : rec.reason;
  const reason = !known
    ? "unrecognised-status"
    : failure && typeof rawReason === "string" && rawReason !== "" && rawReason !== state
      ? rawReason
      : undefined;
  const base = {
    kind: "ended" as const,
    record: entry.kind,
    id: entry.id,
    state,
    ...(rec.elapsedSeconds !== undefined ? { elapsedMs: rec.elapsedSeconds * 1000 } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
  if (entry.kind === "team") {
    return {
      ...base,
      ...(rec.slots !== undefined ? { slots: rec.slots } : {}),
      ...(rec.ok !== undefined ? { ok: rec.ok } : {}),
      ...(rec.failed !== undefined ? { failed: rec.failed } : {}),
      ...(rec.cancelled !== undefined ? { cancelled: rec.cancelled } : {}),
      ...(entry.teamPath !== undefined ? { path: entry.teamPath } : {}),
    };
  }
  return {
    ...base,
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    ...(rec.turnsCompleted !== undefined ? { turns: rec.turnsCompleted } : {}),
    ...(rec.toolCallCount !== undefined ? { toolCalls: rec.toolCallCount } : {}),
    ...(rec.costUsd !== undefined ? { costUsd: rec.costUsd } : {}),
    ...(failure && typeof rec.exitCode === "number" && Number.isInteger(rec.exitCode) ? { exitCode: rec.exitCode } : {}),
  };
}

/** The monitor's own verdict, for a writer that is gone without a usable `meta.json`. */
function endedByMonitor(entry: TrackedDir, reason: string, now: number): MonitorEvent {
  return {
    kind: "ended",
    record: entry.kind,
    id: entry.id,
    state: "failed",
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    ...(Number.isFinite(entry.startedAtMs) && now >= entry.startedAtMs ? { elapsedMs: now - entry.startedAtMs } : {}),
    reason,
    ...(entry.teamPath !== undefined ? { path: entry.teamPath } : {}),
  };
}

function decideTracked(
  d: StateData,
  name: string,
  entry: TrackedDir,
  obs: Observation,
  now: number,
  events: MonitorEvent[],
): void {
  const alive = obs.writerAlive === true || obs.writerAlive === false ? obs.writerAlive : null;
  const terminal = obs.terminal ?? { kind: "absent" as const };
  const wasWaiting = entry.waitOpen;
  if (entry.kind === "session") applyWaits(entry, obs.waits);
  const end = (event: MonitorEvent): void => {
    // The session is over, so a wait still open can no longer be answered. Drop it rather than
    // tell the model to `send_input` to a session this same poll knows is gone; waits that
    // closed are still reported, and carry no hint.
    for (const w of entry.waits.values()) if (w.closedAt === undefined) w.reported = true;
    reportWaits(entry, now, events);
    events.push(event);
    d.dirs.delete(name);
    d.retired.add(name);
  };

  switch (terminal.kind) {
    case "ok":
      end(endedFromRecord(entry, terminal.value));
      return;
    case "unreadable":
    case "invalid":
      if (alive === false) {
        end(endedByMonitor(entry, "terminal-record-unreadable", now));
        return;
      }
      break;
    case "absent":
      if (alive === false) {
        end(endedByMonitor(entry, "no-terminal-record", now));
        return;
      }
      break;
    default:
      assertNever(terminal);
  }

  reportWaits(entry, now, events);
  // Decided after `reportWaits`, which moves `lastLineMs`. A wait that closed in this poll was
  // open when `wants()` ran, so no progress was read for it: the heartbeat waits one poll and
  // then carries its numbers, instead of going out empty.
  const waitClosedNow = wasWaiting && !entry.waitOpen;
  if (entry.waitOpen || waitClosedNow || now - entry.lastLineMs < d.heartbeatIntervalMs) return;
  const progress = obs.progress?.kind === "ok" ? obs.progress.value : null;
  events.push({
    kind: "running",
    record: entry.kind,
    id: entry.id,
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    elapsedMs: Math.max(0, now - entry.startedAtMs),
    progress,
    ...(entry.teamPath !== undefined ? { path: entry.teamPath } : {}),
  });
  entry.lastLineMs = now;
}

/**
 * Pure. Never throws for any input. A throw inside keeps the last valid state, emits nothing and
 * comes back as `error`, so the loop can say so on stderr instead of wedging every record silently.
 */
export function nextEvents(
  state: MonitorState,
  snapshot: Snapshot,
  now: number,
): { state: MonitorState; events: MonitorEvent[]; error?: string } {
  try {
    const d = cloneState(state);
    const events: MonitorEvent[] = [];
    if (d.identity.claudePid === null) {
      noticeOnce(d, "no-session-identity", events);
      d.dirs.clear();
      return { state: wrap(d), events };
    }
    if (snapshot?.startupHostClaudish === "old") {
      noticeOnce(d, "claudish-too-old", events, snapshot.oldClaudishVersion);
    }
    const seen = new Set<string>();
    for (const obs of Array.isArray(snapshot?.observations) ? snapshot.observations : []) {
      if (!obs || typeof obs.dir !== "string" || seen.has(obs.dir)) continue;
      seen.add(obs.dir);
      const entry = d.dirs.get(obs.dir);
      if (!entry) continue;
      if (entry.phase === "undecided") decideUndecided(d, obs.dir, entry, obs, snapshot, now, events);
      else decideTracked(d, obs.dir, entry, obs, now, events);
    }
    for (const [name, entry] of d.dirs) {
      if (entry.phase === "undecided" && !seen.has(name) && now - entry.firstSeenMs > UNDECIDED_GIVE_UP_MS) {
        d.dirs.delete(name);
      }
    }
    return { state: wrap(d), events };
  } catch (err) {
    return { state, events: [], error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

/** printable ASCII without space, `"`, `&`, `<`, `=`, `>` */
function isSafeCode(c: number): boolean {
  return c === 0x21 || (c >= 0x23 && c <= 0x25) || (c >= 0x27 && c <= 0x3b) || (c >= 0x3f && c <= 0x7e);
}

/** Characters outside `safe` become `_`; cut to `max`. A newline in a value cannot split a line. */
function sanitizeValue(value: string, max: number = MAX_FIELD_CHARS): string {
  let out = "";
  for (const ch of value) {
    if (out.length >= max) break;
    out += isSafeCode(ch.codePointAt(0) ?? 0) ? ch : "_";
  }
  return out;
}

function sanitizeId(id: string): string {
  const cleaned = String(id).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return cleaned === "" ? "_" : cleaned;
}

function sanitizeText(text: string, max: number): string {
  let out = "";
  for (const ch of text) {
    if (out.length >= max) break;
    const c = ch.codePointAt(0) ?? 0;
    out += c === 0x20 || isSafeCode(c) ? ch : "_";
  }
  return out;
}

/** Every byte outside `safe`, and `%` itself, becomes `%XX`. Lossless. */
function percentEncode(value: string): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    out += isSafeCode(byte) && byte !== 0x25 ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Over `max`, keep at most the last `max - 3` characters, never splitting a `%XX` triple, after `...`. */
function capEncoded(encoded: string, max: number): string {
  if (encoded.length <= max) return encoded;
  let start = encoded.length - (max - 3);
  if (encoded[start - 1] === "%") start += 2;
  else if (encoded[start - 2] === "%") start += 1;
  return `...${encoded.slice(start)}`;
}

function displayPath(teamPath: string, cwd: string): string {
  let shown = teamPath;
  try {
    const rel = relative(resolve(cwd), resolve(teamPath));
    if (rel === "") shown = ".";
    else if (!rel.startsWith("..") && !isAbsolute(rel)) shown = rel;
  } catch {
    shown = teamPath;
  }
  return capEncoded(percentEncode(shown), MAX_PATH_CHARS);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `<m>m<ss>s` below one hour, `<h>h<mm>m` from one hour. */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 3600) return `${Math.floor(total / 60)}m${pad2(total % 60)}s`;
  return `${Math.floor(total / 3600)}h${pad2(Math.floor((total % 3600) / 60))}m`;
}

/** `$0.00` for an exact zero; two decimals from 0.01; below, up to four with trailing zeros trimmed. */
function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  const fixed = cost.toFixed(4);
  if (Number(fixed) === 0) return "$0.0000";
  return `$${fixed.replace(/0+$/, "").replace(/\.$/, "")}`;
}

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}
function isDuration(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

type Field = [key: string, value: string];

function noticeText(code: NoticeCode, version: string | undefined): string {
  if (code === "no-session-identity") {
    return "this monitor started without CLAUDE_PID, so it cannot tell which claudish runs belong to this session. It reports nothing and exits.";
  }
  const runs =
    version !== undefined && version !== ""
      ? `runs claudish ${sanitizeValue(version, 40)} as an MCP server, older than ${MIN_CLAUDISH_VERSION},`
      : `runs a claudish MCP server older than ${MIN_CLAUDISH_VERSION},`;
  return (
    `this Claude Code session ${runs} which does not record the session that starts a run, ` +
    `so runs started through that server are not reported. Install claudish ${MIN_CLAUDISH_VERSION} or later and restart Claude Code.`
  );
}

function sessionFields(event: Exclude<MonitorEvent, { kind: "notice" }>): Field[] {
  const f: Field[] = [];
  const model = "model" in event && typeof event.model === "string" && event.model !== "" ? event.model : undefined;
  if (model !== undefined) f.push(["model", sanitizeValue(model)]);
  switch (event.kind) {
    case "started":
      return f;
    case "running": {
      if (isDuration(event.elapsedMs)) f.push(["elapsed", formatDuration(event.elapsedMs)]);
      const p = event.progress;
      if (p && isCount(p.replies) && p.replies >= 1) f.push(["replies", String(p.replies)]);
      if (p && isCount(p.toolCalls)) f.push(["tools", String(p.toolCalls)]);
      if (p && isDuration(p.costUsd)) f.push(["cost", formatCost(p.costUsd)]);
      return f;
    }
    case "needs-input":
      if (isDuration(event.elapsedMs)) f.push(["elapsed", formatDuration(event.elapsedMs)]);
      if (isCount(event.turns) && event.turns >= 1) f.push(["turns", String(event.turns)]);
      if (isDuration(event.waitedMs)) f.push(["waited", formatDuration(event.waitedMs)]);
      return f;
    case "ended": {
      if (isDuration(event.elapsedMs)) f.push(["elapsed", formatDuration(event.elapsedMs)]);
      if (isCount(event.turns) && event.turns >= 1) f.push(["turns", String(event.turns)]);
      if (isCount(event.toolCalls)) f.push(["tools", String(event.toolCalls)]);
      if (isDuration(event.costUsd)) f.push(["cost", formatCost(event.costUsd)]);
      const failure = event.state === "failed" || event.state === "timeout";
      if (failure && typeof event.reason === "string" && event.reason !== "") {
        f.push(["reason", sanitizeValue(event.reason)]);
      }
      if (failure && typeof event.exitCode === "number" && Number.isSafeInteger(event.exitCode)) {
        f.push(["exit", String(event.exitCode)]);
      }
      return f;
    }
    default:
      return assertNever(event);
  }
}

function teamFields(event: Exclude<MonitorEvent, { kind: "notice" | "needs-input" }>, cwd: string): Field[] {
  const f: Field[] = [];
  const counts = (pairs: [string, unknown][]): void => {
    for (const [key, value] of pairs) if (isCount(value)) f.push([key, String(value)]);
  };
  switch (event.kind) {
    case "started":
      counts([["slots", event.slots]]);
      break;
    case "running":
      if (isDuration(event.elapsedMs)) f.push(["elapsed", formatDuration(event.elapsedMs)]);
      counts([
        ["slots", event.progress?.slots],
        ["ok", event.progress?.ok],
        ["failed", event.progress?.failed],
        ["cancelled", event.progress?.cancelled],
        ["running", event.progress?.running],
      ]);
      break;
    case "ended":
      if (isDuration(event.elapsedMs)) f.push(["elapsed", formatDuration(event.elapsedMs)]);
      counts([
        ["slots", event.slots],
        ["ok", event.ok],
        ["failed", event.failed],
        ["cancelled", event.cancelled],
      ]);
      if (event.state === "failed" && typeof event.reason === "string" && event.reason !== "") {
        f.push(["reason", sanitizeValue(event.reason)]);
      }
      break;
    default:
      return assertNever(event);
  }
  if (typeof event.path === "string" && event.path !== "") f.push(["path", displayPath(event.path, cwd)]);
  return f;
}

function sessionHint(event: MonitorEvent, id: string): string | null {
  if (event.kind === "needs-input") return event.waitedMs === undefined ? `send_input ${id}` : null;
  if (event.kind !== "ended") return null;
  if (event.state === "completed") return `get_output ${id}`;
  if (event.state === "failed" || event.state === "timeout") return `get_diagnostics ${id}`;
  return null;
}

function assemble(head: string[], fields: Field[], hint: string | null): string {
  const parts = [...head, ...fields.map(([k, v]) => `${k}=${v}`)];
  if (hint !== null) parts.push("next:", hint);
  return parts.join(" ");
}

/** Pure. One event → one line per §4.3 (sanitised, capped at MAX_LINE_CHARS). */
export function renderLine(event: MonitorEvent, cwd: string): string {
  if (event.kind === "notice") {
    return `${PREFIX} notice ${event.code}: ${sanitizeText(noticeText(event.code, event.version), 400)}`.slice(
      0,
      MAX_LINE_CHARS,
    );
  }
  const id = sanitizeId(event.id);
  const record = event.kind === "needs-input" ? "session" : event.record;
  const state = event.kind === "ended" ? event.state : event.kind;
  const head = [PREFIX, record, id, state];
  let fields: Field[];
  let hint: string | null;
  if (record === "team" && event.kind !== "needs-input") {
    fields = teamFields(event, cwd);
    hint = event.kind === "ended" ? "team-status" : null;
  } else {
    fields = sessionFields(event);
    hint = sessionHint(event, id);
  }
  let line = assemble(head, fields, hint);
  if (line.length <= MAX_LINE_CHARS) return line;
  // Only an extreme path or count can get here. Shorten the path first, then drop fields
  // from the end, so the line still matches the grammar and keeps its hint.
  const pathAt = fields.findIndex(([k]) => k === "path");
  if (pathAt >= 0) {
    const room = MAX_PATH_CHARS - (line.length - MAX_LINE_CHARS);
    if (room >= 8) {
      fields[pathAt] = ["path", capEncoded(fields[pathAt]![1].replace(/^\.\.\./, ""), room)];
      line = assemble(head, fields, hint);
    }
  }
  while (line.length > MAX_LINE_CHARS && fields.length > 0) {
    fields.pop();
    line = assemble(head, fields, hint);
  }
  return line.slice(0, MAX_LINE_CHARS);
}

/** Pure. §4.4: notices first, then FIFO; never two lines for one id; stop at the first that does not fit. */
export function takeBatch(pending: PendingLine[], maxChars: number): { batch: string[]; rest: PendingLine[] } {
  const order = [
    ...pending.map((line, i) => ({ line, i })).filter(({ line }) => line.id === null),
    ...pending.map((line, i) => ({ line, i })).filter(({ line }) => line.id !== null),
  ];
  const taken = new Set<number>();
  const ids = new Set<string>();
  const batch: string[] = [];
  let size = 0;
  for (const { line, i } of order) {
    if (line.id !== null && ids.has(line.id)) continue;
    const cost = line.text.length + 1;
    if (batch.length > 0 && size + cost > maxChars) break;
    batch.push(line.text);
    taken.add(i);
    size += cost;
    if (line.id !== null) ids.add(line.id);
  }
  return { batch, rest: pending.filter((_, i) => !taken.has(i)) };
}

// ---------------------------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------------------------

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
}
function nonNegativeInt(n: unknown): number | undefined {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}
function nonNegativeNumber(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseObject(text: string): Record<string, unknown> | "unreadable" | "not-object" {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "unreadable";
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : "not-object";
}

/** Pure. JSON text → validated record per §3.3 schema rules 1-4. */
export function parseSpawnRecord(text: string): Read<SpawnRecord> {
  const obj = parseObject(typeof text === "string" ? text : "");
  if (obj === "unreadable") return { kind: "unreadable" };
  if (obj === "not-object") return { kind: "invalid", reason: "not a JSON object" };
  const bad = (reason: string): Read<SpawnRecord> => ({ kind: "invalid", reason });

  if (obj.schema !== 1) return bad("schema is not 1");
  if (obj.kind !== "session" && obj.kind !== "team") return bad("kind is neither session nor team");
  if (typeof obj.sessionId !== "string" || !ID_RE.test(obj.sessionId)) return bad("sessionId is not a valid id");
  if (typeof obj.startedAt !== "string" || !Number.isFinite(Date.parse(obj.startedAt))) {
    return bad("startedAt is not a date");
  }
  if (!isPositiveInt(obj.hostPid)) return bad("hostPid is not a positive integer");
  if (!isPositiveInt(obj.mcpPid)) return bad("mcpPid is not a positive integer");
  if (obj.launcherPid !== undefined) {
    if (!isPositiveInt(obj.launcherPid) || obj.launcherPid === obj.hostPid || obj.launcherPid === obj.mcpPid) {
      return bad("launcherPid is not a distinct positive integer");
    }
  }
  if (obj.parentClaudeSessionId !== undefined) {
    if (typeof obj.parentClaudeSessionId !== "string" || !CLAUDE_ID_RE.test(obj.parentClaudeSessionId)) {
      return bad("parentClaudeSessionId is malformed");
    }
  }
  const record: SpawnRecord = {
    kind: obj.kind,
    sessionId: obj.sessionId,
    hostPid: obj.hostPid,
    mcpPid: obj.mcpPid,
    startedAt: obj.startedAt,
    ...(obj.parentClaudeSessionId !== undefined ? { parentClaudeSessionId: obj.parentClaudeSessionId as string } : {}),
  };
  if (obj.kind === "session") {
    const t = obj.timeoutSeconds;
    if (typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > 3600) {
      return bad("timeoutSeconds is not an integer in 1..3600");
    }
    if (obj.model !== undefined && typeof obj.model !== "string") return bad("model is not a string");
    if (obj.claudeSessionId !== undefined && typeof obj.claudeSessionId !== "string") {
      return bad("claudeSessionId is not a string");
    }
    record.timeoutSeconds = t;
    if (typeof obj.model === "string") record.model = obj.model;
  } else {
    if (typeof obj.teamPath !== "string" || !isAbsolute(obj.teamPath)) return bad("teamPath is not an absolute path");
    if (!isPositiveInt(obj.slots)) return bad("slots is not a positive integer");
    record.teamPath = obj.teamPath;
    record.slots = obj.slots;
  }
  return { kind: "ok", value: record };
}

/** Pure. A `meta.json` → the fields the terminal line needs. A non-string `status` reads as "". */
export function parseTerminalRecord(text: string, kind: RecordKind): Read<TerminalRecord> {
  const obj = parseObject(typeof text === "string" ? text : "");
  if (obj === "unreadable") return { kind: "unreadable" };
  if (obj === "not-object") return { kind: "invalid", reason: "not a JSON object" };
  const rec: TerminalRecord = { status: typeof obj.status === "string" ? obj.status : "" };
  const elapsed = nonNegativeNumber(obj.elapsedSeconds);
  if (elapsed !== undefined) rec.elapsedSeconds = elapsed;
  if (kind === "session") {
    const turns = nonNegativeInt(obj.turnsCompleted);
    const tools = nonNegativeInt(obj.toolCallCount);
    const cost = nonNegativeNumber(obj.costUsd);
    if (turns !== undefined) rec.turnsCompleted = turns;
    if (tools !== undefined) rec.toolCallCount = tools;
    if (cost !== undefined) rec.costUsd = cost;
    if (typeof obj.terminalReason === "string" || obj.terminalReason === null) rec.terminalReason = obj.terminalReason;
    if (obj.exitCode === null || (typeof obj.exitCode === "number" && Number.isSafeInteger(obj.exitCode))) {
      rec.exitCode = obj.exitCode;
    }
  } else {
    if (typeof obj.reason === "string") rec.reason = obj.reason;
    for (const key of ["slots", "ok", "failed", "cancelled"] as const) {
      const n = nonNegativeInt(obj[key]);
      if (n !== undefined) rec[key] = n;
    }
  }
  return { kind: "ok", value: rec };
}

/**
 * Pure. Complete lines only; the partial tail is left for the next read. Unparsable lines, and
 * lines whose `since` (or a closed wait's `at`) is not a timestamp, are skipped. `consumedBytes`
 * is exact for valid UTF-8 only; the loop cuts raw bytes first (`completeLines`) and takes its
 * file offset from them.
 */
export function parseWaitLines(chunk: string): { lines: WaitLine[]; consumedBytes: number } {
  const text = typeof chunk === "string" ? chunk : "";
  const end = text.lastIndexOf("\n");
  if (end < 0) return { lines: [], consumedBytes: 0 };
  const complete = text.slice(0, end + 1);
  const lines: WaitLine[] = [];
  for (const raw of complete.split("\n")) {
    if (raw.trim() === "") continue;
    const obj = parseObject(raw);
    if (typeof obj !== "object" || !isTimestamp(obj.since)) continue;
    if (obj.wait === "open") {
      const turns = nonNegativeInt(obj.turns);
      lines.push(turns !== undefined ? { wait: "open", since: obj.since, turns } : { wait: "open", since: obj.since });
    } else if (obj.wait === "closed" && isTimestamp(obj.at)) {
      lines.push({ wait: "closed", since: obj.since, at: obj.at, to: typeof obj.to === "string" ? obj.to : "" });
    }
  }
  return { lines, consumedBytes: Buffer.byteLength(complete, "utf8") };
}

/** CLAUDE_PID when it is a positive integer, else null. CLAUDE_CODE_SESSION_ID is not read. */
export function identityFrom(env: Record<string, string | undefined>): Identity {
  const raw = env?.CLAUDE_PID?.trim();
  if (!raw || !/^\d+$/.test(raw)) return { claudePid: null };
  const pid = Number(raw);
  return { claudePid: Number.isSafeInteger(pid) && pid > 0 ? pid : null };
}

/**
 * THE rule, shared with claudish's writer: `CLAUDISH_SESSIONS_DIR || join(HOME || homedir(),
 * ".claudish", "sessions")`. An empty value counts as unset. `$HOME` comes before the OS account
 * home so that a sandbox or launcher that changes HOME moves the writer and this reader together;
 * a drift on either side sends records where the other never looks.
 */
export function sessionsDirFrom(env: Record<string, string | undefined>, homedirFn: () => string): string {
  return env?.CLAUDISH_SESSIONS_DIR || join(env?.HOME || homedirFn(), ".claudish", "sessions");
}

/** `[[dd-]hh:]mm:ss` → seconds, or null. */
function parseEtime(etime: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime);
  if (!m) return null;
  const [, dd, hh, mm, ss] = m;
  return Number(dd ?? 0) * 86_400 + Number(hh ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
}

/** Parses `ps -A -ww -o pid=,ppid=,etime=,command=`; etime is [[dd-]hh:]mm:ss. */
export function parseProcessTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const raw of String(output ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*?))?\s*$/.exec(raw);
    if (!m) continue;
    const ageSeconds = parseEtime(m[3]!);
    if (ageSeconds === null) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), ageSeconds, command: m[4] ?? "" });
  }
  return rows;
}

/** Pure. Rows with ppid === claudePid whose command contains "claudish" and the token "--mcp". */
export function claudishChildrenOf(table: ProcessRow[], claudePid: number): ProcessRow[] {
  return (Array.isArray(table) ? table : []).filter(
    (row) =>
      row.ppid === claudePid &&
      typeof row.command === "string" &&
      row.command.includes("claudish") &&
      row.command.split(/\s+/).includes("--mcp"),
  );
}

/**
 * Pure. The script a `node` or `bun` process runs: the first argument after argv[0] that is not
 * a flag, when argv[0]'s basename is node or bun (split on single spaces); else null. A
 * standalone binary has no script, and a path holding a space cannot be cut from a ps line.
 *
 * Deliberately the first non-flag argument, not the literal argv[1]: `bun --env-file=x script`
 * must still find the script. The cost: a flag that takes a separate value
 * (`node --require ./preload.cjs …`) yields that value instead. Every such miss reads as no
 * version, which is "unknown", never "old" — a wrong guess cannot produce a false notice.
 */
export function scriptPathFrom(command: string): string | null {
  const argv = String(command ?? "").split(" ");
  const exe = basename(argv[0] ?? "");
  if (exe !== "node" && exe !== "bun") return null;
  const script = argv.slice(1).find((arg) => arg !== "" && !arg.startsWith("-"));
  return script ?? null;
}

function versionParts(version: string): [number, number, number] | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Pure. Compares the leading MAJOR.MINOR.PATCH numerically; anything after it is ignored. */
export function versionBelow(version: string, min: string): boolean {
  const a = versionParts(version);
  const b = versionParts(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

/** Pure. §5.3. `children` null = no process table. A missing reading is never "old". */
export function hostClaudishState(children: ClaudishChild[] | null, minVersion: string): HostClaudish {
  if (!Array.isArray(children)) return "unknown";
  if (children.length === 0) return "none";
  let unread = false;
  for (const child of children) {
    const v = child?.version;
    if (typeof v !== "string" || versionParts(v) === null) unread = true;
    else if (versionBelow(v, minVersion)) return "old";
  }
  return unread ? "unknown" : "new";
}

// ---------------------------------------------------------------------------------------------
// I/O helpers (each read has its own try; a failure becomes absent or unreadable)
// ---------------------------------------------------------------------------------------------

function errCode(err: unknown): string | undefined {
  return err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : undefined;
}

type TextRead = { kind: "absent" } | { kind: "unreadable" } | { kind: "ok"; text: string };

function readText(path: string, maxBytes: number = MAX_RECORD_BYTES): TextRead {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > maxBytes) return { kind: "unreadable" };
    return { kind: "ok", text: readFileSync(path, "utf8") };
  } catch (err) {
    return errCode(err) === "ENOENT" || errCode(err) === "ENOTDIR" ? { kind: "absent" } : { kind: "unreadable" };
  }
}

/** Bytes appended to `path` since `offset`, raw; null when the file is absent or unreadable. */
function readFrom(path: string, offset: number): { bytes: Buffer; size: number } | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    if (size <= offset) return { bytes: Buffer.alloc(0), size };
    const length = Math.min(size - offset, MAX_READ_BYTES);
    const buf = Buffer.alloc(length);
    const read = readSync(fd, buf, 0, length, offset);
    return { bytes: buf.subarray(0, read), size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // nothing to recover: the descriptor is gone either way
      }
    }
  }
}

/**
 * The complete lines of a raw chunk, cut at its last newline BYTE, and how many bytes they span.
 * The offset must come from the bytes: decoding first turns each invalid UTF-8 byte into U+FFFD
 * (three bytes), and an offset measured on that text overshoots into the next line.
 */
function completeLines(bytes: Buffer): { text: string; bytes: number } {
  const end = bytes.lastIndexOf(0x0a);
  if (end < 0) return { text: "", bytes: 0 };
  return { text: bytes.subarray(0, end + 1).toString("utf8"), bytes: end + 1 };
}

/** `process.kill(pid, 0)`: ESRCH → false; success or EPERM → true; anything else → null. */
function probePid(pid: number): boolean | null {
  if (!isPositiveInt(pid)) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = errCode(err);
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return null;
  }
}

/** The default process table: one `ps` call; null when ps is missing or refused. */
export function defaultProcessTable(): ProcessRow[] | null {
  try {
    const r = spawnSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,etime=,command="], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.error || r.status !== 0 || typeof r.stdout !== "string") return null;
    return parseProcessTable(r.stdout);
  } catch {
    return null;
  }
}

/**
 * The §5.3 package reader: realpath argv's script (ps shows the npm symlink), then the first
 * `package.json` named "claudish" in its directory or that directory's parent. Discarded when the
 * file's ctime is later than the server's start plus PID_AGE_TOLERANCE_MS: the package was
 * replaced after the server started, so it no longer describes the running code. Never executes
 * anything named by the process table.
 */
export function readClaudishVersionFromPackage(child: ProcessRow, nowMs: number = Date.now()): string | null {
  try {
    const script = scriptPathFrom(child.command);
    // A relative path is relative to the SERVER's cwd, which `ps` does not show. Resolving it
    // here would use this monitor's cwd, the user's project, and in a project that is itself a
    // claudish checkout read the wrong package. No reading is "unknown", never "old".
    if (script === null || !isAbsolute(script)) return null;
    const real = realpathSync(script);
    const startedMs = nowMs - child.ageSeconds * 1000;
    for (const dir of [dirname(real), dirname(dirname(real))]) {
      const file = join(dir, "package.json");
      let ctimeMs: number;
      let pkg: Record<string, unknown> | "unreadable" | "not-object";
      try {
        const st = statSync(file);
        if (!st.isFile() || st.size > MAX_RECORD_BYTES) continue;
        ctimeMs = st.ctimeMs;
        pkg = parseObject(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      if (typeof pkg !== "object" || pkg.name !== "claudish") continue;
      if (ctimeMs > startedMs + PID_AGE_TOLERANCE_MS) return null;
      return typeof pkg.version === "string" ? pkg.version : null;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The I/O loop
// ---------------------------------------------------------------------------------------------

interface DirIo {
  eventsOffset: number;
  replyIds: Set<string>;
  waitsOffset: number;
  lastReuseCheckMs: number;
}

/** Adds the distinct `message.id` values of `assistant` lines in `complete` (whole lines only). */
function collectReplies(complete: string, replyIds: Set<string>): void {
  for (const raw of complete.split("\n")) {
    if (!raw.includes('"assistant"')) continue;
    const obj = parseObject(raw);
    if (typeof obj !== "object" || obj.type !== "assistant") continue;
    const message = obj.message;
    if (message && typeof message === "object" && typeof (message as { id?: unknown }).id === "string") {
      replyIds.add((message as { id: string }).id);
    }
  }
}

function sessionProgress(dirPath: string, io: DirIo): Read<Progress> {
  let eventsOk = false;
  const events = readFrom(join(dirPath, "events.jsonl"), io.eventsOffset);
  if (events) {
    eventsOk = true;
    const done = completeLines(events.bytes);
    collectReplies(done.text, io.replyIds);
    io.eventsOffset += done.bytes;
    // A single line longer than one read can never complete inside it: skip past it.
    if (done.bytes === 0 && events.bytes.length >= MAX_READ_BYTES) io.eventsOffset += MAX_READ_BYTES;
  }
  const progress: Progress = {};
  if (io.replyIds.size > 0) progress.replies = io.replyIds.size;
  let tokensOk = false;
  const tokens = readText(join(dirPath, "tokens.json"));
  if (tokens.kind === "ok") {
    const obj = parseObject(tokens.text);
    if (typeof obj === "object") {
      tokensOk = true;
      const cost = nonNegativeNumber(obj.total_cost);
      if (cost !== undefined) progress.costUsd = cost;
      if (Array.isArray(obj.tool_calls)) {
        let sum = 0;
        for (const t of obj.tool_calls) {
          const n = t && typeof t === "object" ? nonNegativeInt((t as { count?: unknown }).count) : undefined;
          if (n !== undefined) sum += n;
        }
        progress.toolCalls = sum;
      }
    }
  }
  return eventsOk || tokensOk || io.replyIds.size > 0 ? { kind: "ok", value: progress } : { kind: "unreadable" };
}

function teamProgress(teamPath: string | undefined): Read<Progress> {
  if (!teamPath) return { kind: "absent" };
  const read = readText(join(teamPath, "status.json"), MAX_READ_BYTES);
  if (read.kind !== "ok") return read;
  const obj = parseObject(read.text);
  if (typeof obj !== "object" || !obj.models || typeof obj.models !== "object") return { kind: "unreadable" };
  const slots = Object.values(obj.models as Record<string, unknown>);
  const progress: Progress = { slots: slots.length, ok: 0, failed: 0, cancelled: 0, running: 0 };
  for (const slot of slots) {
    const s = slot && typeof slot === "object" ? (slot as { state?: unknown; error?: { reason?: unknown } }) : {};
    // The classification claudish's own `summarise` gives the end record, so the `running` line
    // and the end line count alike. PENDING is a slot not yet started: still to run, so it counts
    // as running, and the four counts add up to `slots`.
    if (s.state === "COMPLETED") progress.ok! += 1;
    else if (s.state === "RUNNING" || s.state === "PENDING") progress.running! += 1;
    else if (s.error?.reason === "cancelled") progress.cancelled! += 1;
    else progress.failed! += 1;
  }
  return { kind: "ok", value: progress };
}

function eventRecordId(event: MonitorEvent): string | null {
  return event.kind === "notice" ? null : sanitizeId(event.id);
}

/** I/O loop. Never throws; exits only per §5.5; one write per poll at most. */
export function startMonitor(opts: {
  sessionsDir: string;
  identity: Identity;
  /** false = the pipe is gone (EPIPE). */
  write: (text: string) => boolean;
  cwd?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  now?: () => number;
  monitorStartMs?: number;
  hostStartedAtMs?: number | null;
  /** Default: one `ps` call; null = unavailable. */
  processTable?: () => ProcessRow[] | null;
  /** Default: the §5.3 package reader. */
  readClaudishVersion?: (child: ProcessRow) => string | null;
  /**
   * Called when the loop decides to exit (CLAUDE_PID gone, stdout gone, or the
   * no-session-identity notice written). The loop has already stopped. Default: stop only;
   * the command-line entry passes `process.exit`.
   */
  exit?: (code: number) => void;
  /** Diagnostics; default stderr. */
  log?: (message: string) => void;
}): { stop(): void; tick(): Promise<void> } {
  const clock = opts.now ?? Date.now;
  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const cwd = opts.cwd ?? process.cwd();
  const sessionsDir = opts.sessionsDir;
  const monitorStartMs = opts.monitorStartMs ?? MODULE_EVALUATED_AT_MS;
  const hostStartedAtMs = opts.hostStartedAtMs ?? null;
  const processTable = opts.processTable ?? defaultProcessTable;
  const readVersion = opts.readClaudishVersion ?? ((row: ProcessRow) => readClaudishVersionFromPackage(row, clock()));
  const claudePid = data(initialState(opts.identity)).identity.claudePid;
  const logged = new Set<string>();
  const log = (message: string): void => {
    if (logged.has(message) || logged.size > 500) return;
    logged.add(message);
    try {
      (opts.log ?? ((m: string) => process.stderr.write(`[claudish session-monitor] ${m}\n`)))(message);
    } catch {
      // stderr is gone too; nothing left to report to
    }
  };

  let state = initialState({ claudePid }, { heartbeatIntervalMs: opts.heartbeatIntervalMs, hostStartedAtMs, monitorStartMs });
  let pending: PendingLine[] = [];
  let known: Set<string> | null = null;
  let lastDirMtimeMs: number | null = null;
  let lastRescanMs = Number.NEGATIVE_INFINITY;
  let tooOldCheck: "pending" | "done" = "pending";
  const io = new Map<string, DirIo>();
  let stopped = false;
  let exited = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  const stop = (): void => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const exitWith = (code: number): void => {
    if (exited) return;
    exited = true;
    stop();
    try {
      opts.exit?.(code);
    } catch (err) {
      log(`exit hook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  function classifyBaseline(names: string[]): string[] {
    const started = Date.now();
    const fresh: string[] = [];
    for (const name of names) {
      const dir = join(sessionsDir, name);
      try {
        const mtimeMs = statSync(dir).mtimeMs;
        const metaPath = join(dir, "meta.json");
        if (mtimeMs >= monitorStartMs) {
          // Something happened in it after the start: new, unless it had already ended before.
          let endedBefore = false;
          try {
            endedBefore = statSync(metaPath).mtimeMs < monitorStartMs;
          } catch {
            endedBefore = false;
          }
          if (!endedBefore) fresh.push(name);
          continue;
        }
        if (mtimeMs < monitorStartMs - ADOPT_WINDOW_MS) continue;
        if (existsSync(metaPath)) continue;
        const read = readText(join(dir, "spawn.json"));
        if (read.kind !== "ok") continue;
        const spawn = parseSpawnRecord(read.text);
        if (spawn.kind !== "ok" || probePid(spawn.value.mcpPid) === false) continue;
        // Fail closed. A run that predates this monitor is adopted only when the host's start
        // time is known and the run is younger: without it (no `ps`), a Claude Code pid reused
        // by this window would inherit a dead window's orphaned run.
        if (hostStartedAtMs === null || Date.parse(spawn.value.startedAt) < hostStartedAtMs - PID_AGE_TOLERANCE_MS) {
          continue;
        }
        fresh.push(name);
      } catch {
        // unreadable entry: history
      }
    }
    log(`baseline: ${names.length} entries classified in ${Date.now() - started} ms, ${fresh.length} to decide`);
    return fresh;
  }

  /** Steps 1-3: stat, list when due, classify. Returns the names to admit. */
  function listNewDirs(t: number): string[] {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(sessionsDir).mtimeMs;
    } catch (err) {
      if (errCode(err) === "ENOENT" || errCode(err) === "ENOTDIR") {
        if (known === null) known = new Set();
        lastDirMtimeMs = null;
        return [];
      }
      log(`cannot stat the sessions directory: ${errCode(err) ?? String(err)}`);
      return [];
    }
    if (known !== null && mtimeMs === lastDirMtimeMs && t - lastRescanMs < RESCAN_INTERVAL_MS) return [];
    let names: string[];
    try {
      names = readdirSync(sessionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && ID_RE.test(entry.name))
        .map((entry) => entry.name);
    } catch (err) {
      log(`cannot list the sessions directory: ${errCode(err) ?? String(err)}`);
      return [];
    }
    lastDirMtimeMs = mtimeMs;
    lastRescanMs = t;
    if (known === null) {
      known = new Set(names);
      return classifyBaseline(names);
    }
    const previous = known;
    known = new Set(names);
    return names.filter((name) => !previous.has(name));
  }

  function ioFor(dir: string): DirIo {
    let entry = io.get(dir);
    if (!entry) {
      entry = { eventsOffset: 0, replyIds: new Set(), waitsOffset: 0, lastReuseCheckMs: Number.NEGATIVE_INFINITY };
      io.set(dir, entry);
    }
    return entry;
  }

  function runTick(): void {
    if (exited) return;
    const t = clock();

    // 0. Exit check.
    if (claudePid !== null) {
      if (probePid(claudePid) === false) {
        exitWith(0);
        return;
      }
    } else if (data(state).noticesSent.has("no-session-identity")) {
      exitWith(0);
      return;
    }

    let table: ProcessRow[] | null | undefined;
    const getTable = (): ProcessRow[] | null => {
      if (table === undefined) {
        try {
          table = processTable();
        } catch {
          table = null;
        }
      }
      return table ?? null;
    };
    let host: { state: HostClaudish; oldVersion?: string } | undefined;
    const hostNow = (): { state: HostClaudish; oldVersion?: string } => {
      if (host) return host;
      const rows = claudePid === null ? null : getTable();
      if (rows === null || claudePid === null) return (host = { state: "unknown" });
      const children: ClaudishChild[] = claudishChildrenOf(rows, claudePid).map((row) => {
        let version: string | null = null;
        try {
          version = readVersion(row);
        } catch {
          version = null;
        }
        return { pid: row.pid, version };
      });
      const s = hostClaudishState(children, MIN_CLAUDISH_VERSION);
      const old = children
        .map((c) => c.version)
        .filter((v): v is string => typeof v === "string" && versionBelow(v, MIN_CLAUDISH_VERSION));
      const lowest = old.reduce<string | undefined>((low, v) => (low === undefined || versionBelow(v, low) ? v : low), undefined);
      return (host = lowest !== undefined ? { state: s, oldVersion: lowest } : { state: s });
    };

    const snapshot: Snapshot = { observations: [] };
    if (claudePid !== null) {
      // 1-4. Discover and admit.
      state = admit(state, listNewDirs(t), t);

      // 5. Observe, in the fixed read order.
      const w = wants(state, t);
      for (const dir of w.undecided) {
        const dirPath = join(sessionsDir, dir);
        const hasRuntimeFiles = RUNTIME_FILES.some((file) => {
          try {
            return existsSync(join(dirPath, file));
          } catch {
            return false;
          }
        });
        const read = readText(join(dirPath, "spawn.json"));
        const spawn: Read<SpawnRecord> = read.kind === "ok" ? parseSpawnRecord(read.text) : read;
        if (spawn.kind === "invalid") log(`ignoring a spawn.json that breaks the record schema: ${spawn.reason}`);
        const obs: Observation = { dir, hasRuntimeFiles, spawn };
        if (spawn.kind === "absent" && hasRuntimeFiles) {
          const h = hostNow();
          obs.hostClaudish = h.state;
          if (h.oldVersion !== undefined) snapshot.oldClaudishVersion = h.oldVersion;
        }
        snapshot.observations.push(obs);
      }

      if (tooOldCheck === "pending") {
        if (t > monitorStartMs + UNDECIDED_GIVE_UP_MS) tooOldCheck = "done";
        else {
          const h = hostNow();
          snapshot.startupHostClaudish = h.state;
          if (h.oldVersion !== undefined) snapshot.oldClaudishVersion = h.oldVersion;
          if (h.state === "old" || h.state === "new") tooOldCheck = "done";
        }
      }

      const progressFor = new Set(w.progressFor);
      for (const tr of w.tracked) {
        const dirPath = join(sessionsDir, tr.dir);
        const dirIo = ioFor(tr.dir);
        let writerAlive = probePid(tr.mcpPid);
        if (writerAlive === true && t >= tr.reuseCheckFromMs && t - dirIo.lastReuseCheckMs >= REUSE_CHECK_INTERVAL_MS) {
          dirIo.lastReuseCheckMs = t;
          // `ps` truncates etime to whole seconds and runs after `t`, so `t - age` can only land
          // LATER than the real start, by under one second plus the ps call. The real writer
          // started before its record, so it stays inside the tolerance; only a process started
          // after the record (a reused pid) clears it.
          const row = getTable()?.find((r) => r.pid === tr.mcpPid);
          if (row && t - row.ageSeconds * 1000 > tr.startedAtMs + PID_AGE_TOLERANCE_MS) writerAlive = false;
        }
        const meta = readText(join(dirPath, "meta.json"));
        const terminal: Read<TerminalRecord> = meta.kind === "ok" ? parseTerminalRecord(meta.text, tr.kind) : meta;
        const obs: Observation = { dir: tr.dir, writerAlive, terminal };
        if (tr.kind === "session") {
          const chunk = readFrom(join(dirPath, "waits.jsonl"), dirIo.waitsOffset);
          if (chunk) {
            const done = completeLines(chunk.bytes);
            obs.waits = parseWaitLines(done.text).lines;
            dirIo.waitsOffset += done.bytes;
          }
        }
        if (progressFor.has(tr.dir)) {
          obs.progress = tr.kind === "session" ? sessionProgress(dirPath, dirIo) : teamProgress(tr.teamPath);
        }
        snapshot.observations.push(obs);
      }
    }

    // 6. Decide and render.
    const result = nextEvents(state, snapshot, t);
    if (result.error !== undefined) log(`decision failed; the last state is kept: ${result.error}`);
    state = result.state;
    for (const event of result.events) pending.push({ id: eventRecordId(event), text: renderLine(event, cwd) });
    const live = new Set(wants(state, t).tracked.map((tr) => tr.dir));
    for (const dir of io.keys()) if (!live.has(dir)) io.delete(dir);

    // 7. One write.
    if (pending.length === 0) return;
    const { batch, rest } = takeBatch(pending, MAX_BATCH_CHARS);
    pending = rest;
    let ok: boolean;
    try {
      ok = opts.write(`${batch.join("\n")}\n`);
    } catch (err) {
      log(`write failed: ${err instanceof Error ? err.message : String(err)}`);
      ok = errCode(err) !== "EPIPE";
    }
    if (!ok) {
      exitWith(0);
      return;
    }
    if (claudePid === null && data(state).noticesSent.has("no-session-identity") && pending.length === 0) exitWith(0);
  }

  const tick = (): Promise<void> => {
    const run = chain.then(() => {
      try {
        runTick();
      } catch (err) {
        log(`poll failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      }
    });
    chain = run;
    return run;
  };

  const loop = (): void => {
    if (stopped) return;
    void tick().then(() => {
      if (!stopped) timer = setTimeout(loop, pollIntervalMs);
    });
  };
  timer = setTimeout(loop, 0);

  return { stop, tick };
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}

// ---------------------------------------------------------------------------------------------
// Command-line entry
// ---------------------------------------------------------------------------------------------

function isPipeGone(err: unknown): boolean {
  const code = errCode(err);
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ECONNRESET";
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Synchronous write to fd 1, so a batch is out before any `process.exit`. false = the reader
 * is gone. EAGAIN (a non-blocking pipe that is full) is retried briefly.
 */
function writeStdout(text: string): boolean {
  const buf = Buffer.from(text, "utf8");
  let offset = 0;
  let retries = 0;
  while (offset < buf.length) {
    try {
      offset += writeSync(1, buf, offset, buf.length - offset);
    } catch (err) {
      const code = errCode(err);
      if (code === "EAGAIN" && retries++ < 500) {
        // Blocks the event loop for at most 5 s. Acceptable here: this process has nothing
        // else to do, and a partial write would split a line, which is worse than a late one.
        sleepSync(10);
        continue;
      }
      if (code === "EPIPE" || code === "EBADF") return false;
      try {
        process.stderr.write(`[claudish session-monitor] stdout write failed: ${code ?? String(err)}\n`);
      } catch {
        // stderr is gone too
      }
      return true;
    }
  }
  return true;
}

function main(): void {
  const exit = (code: number): never => process.exit(code);
  const report = (what: string, err: unknown): void => {
    if (isPipeGone(err)) exit(0);
    try {
      process.stderr.write(
        `[claudish session-monitor] ${what}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
    } catch {
      // stderr is gone too
    }
  };
  process.stdout.on("error", (err) => report("stdout error", err));
  process.on("uncaughtException", (err) => report("uncaught exception", err));
  process.on("unhandledRejection", (reason) => report("unhandled rejection", reason));
  // Without a handler a closed reader kills the process with SIGPIPE instead of EPIPE.
  process.on("SIGPIPE", () => {});

  const identity = identityFrom(process.env);
  let hostStartedAtMs: number | null = null;
  if (identity.claudePid !== null) {
    const row = defaultProcessTable()?.find((r) => r.pid === identity.claudePid);
    if (row) hostStartedAtMs = Date.now() - row.ageSeconds * 1000;
  }
  startMonitor({
    sessionsDir: sessionsDirFrom(process.env, homedir),
    identity,
    write: writeStdout,
    monitorStartMs: MODULE_EVALUATED_AT_MS,
    hostStartedAtMs,
    exit,
  });
}

if (import.meta.main) main();
