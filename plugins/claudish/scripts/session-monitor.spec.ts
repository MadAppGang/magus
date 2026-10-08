/**
 * Pure unit tests for the claudish session monitor (design §8.2).
 *
 * Written blind, from the specification, the architecture contract (§3-§5, §4.6) and the
 * placement/amendments file only. Each `describe` names the contract clause it pins; REQ ids
 * refer to the requirement list in TEST-PLAN.md.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  ADOPT_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
  LOST_GRACE_MS,
  MAX_BATCH_CHARS,
  MAX_FIELD_CHARS,
  MAX_LINE_CHARS,
  MAX_PATH_CHARS,
  MIN_CLAUDISH_VERSION,
  PID_AGE_TOLERANCE_MS,
  POLL_INTERVAL_MS,
  PREFIX,
  RESCAN_INTERVAL_MS,
  REUSE_CHECK_INTERVAL_MS,
  TEAM_REUSE_CHECK_AFTER_MS,
  UNDECIDED_GIVE_UP_MS,
  admit,
  claudishChildrenOf,
  hostClaudishState,
  identityFrom,
  initialState,
  nextEvents,
  parseProcessTable,
  parseSpawnRecord,
  parseTerminalRecord,
  parseWaitLines,
  renderLine,
  scriptPathFrom,
  sessionsDirFrom,
  takeBatch,
  versionBelow,
  wants,
  type ClaudishChild,
  type MonitorEvent,
  type MonitorState,
  type Observation,
  type PendingLine,
  type ProcessRow,
  type Progress,
  type Read,
  type Snapshot,
  type SpawnRecord,
  type TerminalRecord,
  type WaitLine,
} from "./session-monitor.ts";

// ---------------------------------------------------------------------------------------------
// Testdata and helpers
// ---------------------------------------------------------------------------------------------

const CLAUDE_PID = 4242;
const OTHER_PID = 5151;
const MCP_PID = 6161;
const T0 = Date.parse("2026-10-02T10:00:00.000Z");
const CWD = "/work/project";
const SID = "1a2b3c4d";
const TID = "team-5e6f7a8b";
const TEAM_PATH = `${CWD}/ai-docs/sessions/RUN/reviews/panel`;
const TEAM_PATH_REL = "ai-docs/sessions/RUN/reviews/panel";
const HB = HEARTBEAT_INTERVAL_MS;

const iso = (ms: number): string => new Date(ms).toISOString();
const ok = <T>(value: T): Read<T> => ({ kind: "ok", value });
const ABSENT = { kind: "absent" } as const;
const UNREADABLE = { kind: "unreadable" } as const;

function sessionSpawn(over: Partial<SpawnRecord> = {}): SpawnRecord {
  return {
    kind: "session",
    sessionId: SID,
    hostPid: CLAUDE_PID,
    mcpPid: MCP_PID,
    startedAt: iso(T0),
    model: "MODEL_ID",
    timeoutSeconds: 600,
    ...over,
  };
}

function teamSpawn(over: Partial<SpawnRecord> = {}): SpawnRecord {
  return {
    kind: "team",
    sessionId: TID,
    hostPid: CLAUDE_PID,
    mcpPid: MCP_PID,
    startedAt: iso(T0),
    teamPath: TEAM_PATH,
    slots: 4,
    ...over,
  };
}

interface Step {
  state: MonitorState;
  events: MonitorEvent[];
  lines: string[];
  error?: string;
}

function step(state: MonitorState, observations: Observation[], now: number, extra: Partial<Snapshot> = {}): Step {
  const r = nextEvents(state, { observations, ...extra }, now);
  return { state: r.state, events: r.events, lines: r.events.map((e) => renderLine(e, CWD)), error: r.error };
}

type InitOpts = Parameters<typeof initialState>[1];

/** Admit `spawn.sessionId` at `now` and decide it; asserts exactly one `started`. */
function tracked(spawn: SpawnRecord, opts?: InitOpts, now = T0): MonitorState {
  let s = initialState({ claudePid: CLAUDE_PID }, opts);
  s = admit(s, [spawn.sessionId], now);
  const r = step(s, [{ dir: spawn.sessionId, hasRuntimeFiles: false, spawn: ok(spawn) }], now);
  expect(r.events).toHaveLength(1);
  expect(r.events[0]).toMatchObject({ kind: "started", id: spawn.sessionId });
  return r.state;
}

/** An alive session with no terminal record yet, optionally with waits/progress. */
function aliveObs(dir: string, extra: Partial<Observation> = {}): Observation {
  return { dir, writerAlive: true, terminal: ABSENT, waits: [], ...extra };
}

function aliveTeamObs(dir: string, extra: Partial<Observation> = {}): Observation {
  return { dir, writerAlive: true, terminal: ABSENT, ...extra };
}

// §4.3 grammar, as regular expressions.
const SAFE = "[\\x21\\x23-\\x25\\x27-\\x3B\\x3F-\\x7E]";
const KEY = "(?:model|elapsed|turns|replies|tools|cost|reason|exit|waited|slots|ok|failed|cancelled|running|path)";
const FIELD = `${KEY}=${SAFE}{1,200}`;
const ID = "[A-Za-z0-9._-]{1,64}";
const SESSION_RE = new RegExp(
  `^claudish-monitor: session (${ID}) (?:started|running|needs-input|completed|failed|timeout|cancelled)(?: ${FIELD})*(?: next: (?:get_output|get_diagnostics|send_input) \\1)?$`,
);
const TEAM_RE = new RegExp(
  `^claudish-monitor: team ${ID} (?:started|running|completed|failed|cancelled)(?: ${FIELD})*(?: next: team-status)?$`,
);
const NOTICE_RE = new RegExp(`^claudish-monitor: notice (?:claudish-too-old|no-session-identity): (?: |${SAFE}){1,400}$`);
const SAFE_VALUE_RE = new RegExp(`^${SAFE}+$`);

function matchesGrammar(line: string): boolean {
  return SESSION_RE.test(line) || TEAM_RE.test(line) || NOTICE_RE.test(line);
}

function fields(line: string): [string, string][] {
  const body = line.split(" next: ")[0] ?? line;
  return body
    .split(" ")
    .filter((t) => t.includes("="))
    .map((t) => {
      const i = t.indexOf("=");
      return [t.slice(0, i), t.slice(i + 1)] as [string, string];
    });
}
const keysOf = (line: string): string[] => fields(line).map(([k]) => k);
const fieldOf = (line: string, key: string): string | undefined => fields(line).find(([k]) => k === key)?.[1];

// ---------------------------------------------------------------------------------------------
// Constants (REQ-C1)
// ---------------------------------------------------------------------------------------------

describe("constants (REQ-C1, §4.2)", () => {
  test("every constant has the value the public contract names", () => {
    expect({
      PREFIX,
      POLL_INTERVAL_MS,
      HEARTBEAT_INTERVAL_MS,
      RESCAN_INTERVAL_MS,
      ADOPT_WINDOW_MS,
      LOST_GRACE_MS,
      TEAM_REUSE_CHECK_AFTER_MS,
      REUSE_CHECK_INTERVAL_MS,
      PID_AGE_TOLERANCE_MS,
      UNDECIDED_GIVE_UP_MS,
      MAX_LINE_CHARS,
      MAX_FIELD_CHARS,
      MAX_PATH_CHARS,
      MAX_BATCH_CHARS,
      MIN_CLAUDISH_VERSION,
    }).toEqual({
      PREFIX: "claudish-monitor:",
      POLL_INTERVAL_MS: 2500,
      HEARTBEAT_INTERVAL_MS: 300000,
      RESCAN_INTERVAL_MS: 60000,
      ADOPT_WINDOW_MS: 3720000,
      LOST_GRACE_MS: 120000,
      TEAM_REUSE_CHECK_AFTER_MS: 1800000,
      REUSE_CHECK_INTERVAL_MS: 60000,
      PID_AGE_TOLERANCE_MS: 5000,
      UNDECIDED_GIVE_UP_MS: 60000,
      MAX_LINE_CHARS: 480,
      MAX_FIELD_CHARS: 80,
      MAX_PATH_CHARS: 200,
      MAX_BATCH_CHARS: 2900,
      MIN_CLAUDISH_VERSION: "10.4.0",
    });
  });

  test("constants respect Claude Code's limits: poll above the 2000 ms refill grid, heartbeat in minutes, line and batch under the cuts", () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThan(2000);
    expect(HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(60000);
    expect(MAX_LINE_CHARS).toBeLessThan(500);
    expect(MAX_BATCH_CHARS).toBeLessThan(3000);
    expect(MIN_CLAUDISH_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------------------------
// Attribution (REQ-A1..A6)
// ---------------------------------------------------------------------------------------------

describe("attribution (REQ-A1..A6, §4.5, §5.3)", () => {
  test("REQ-A1: a record whose hostPid equals CLAUDE_PID yields exactly one started line", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, [SID], T0);

    const r = step(s, [{ dir: SID, hasRuntimeFiles: true, spawn: ok(sessionSpawn()) }], T0);

    expect(r.events).toEqual([{ kind: "started", record: "session", id: SID, model: "MODEL_ID" }]);
    expect(r.lines).toEqual([`claudish-monitor: session ${SID} started model=MODEL_ID`]);
  });

  test("REQ-A2: a record whose hostPid differs produces nothing, ever, whatever parentClaudeSessionId holds", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, [SID], T0);
    const spawn = sessionSpawn({ hostPid: OTHER_PID, parentClaudeSessionId: "same-conversation-id-1234" });

    let r = step(s, [{ dir: SID, hasRuntimeFiles: true, spawn: ok(spawn) }], T0);
    const all = [...r.events];
    for (let i = 1; i <= 5; i++) {
      r = step(
        r.state,
        [{ dir: SID, writerAlive: false, terminal: ok<TerminalRecord>({ status: "completed" }), spawn: ok(spawn) }],
        T0 + i * HB,
      );
      all.push(...r.events);
    }

    expect(all).toEqual([]);
    const w = wants(r.state, T0 + 6 * HB);
    expect(w.undecided).not.toContain(SID);
    expect(w.tracked.map((t) => t.dir)).not.toContain(SID);
  });

  test("REQ-A3: with the host's start time known, a record started more than PID_AGE_TOLERANCE_MS before it is not ours", () => {
    const hostStartedAtMs = T0;
    let s = initialState({ claudePid: CLAUDE_PID }, { hostStartedAtMs });
    s = admit(s, [SID], T0);

    const r = step(s, [{ dir: SID, spawn: ok(sessionSpawn({ startedAt: iso(T0 - 6000) })) }], T0);

    expect(r.events).toEqual([]);
  });

  test("REQ-A3: with the host's start time known, a record started within PID_AGE_TOLERANCE_MS before it is ours", () => {
    for (const offset of [4000, 5000]) {
      let s = initialState({ claudePid: CLAUDE_PID }, { hostStartedAtMs: T0 });
      s = admit(s, [SID], T0);

      const r = step(s, [{ dir: SID, spawn: ok(sessionSpawn({ startedAt: iso(T0 - offset) })) }], T0);

      expect(r.events.map((e) => e.kind)).toEqual(["started"]);
    }
  });

  test("REQ-A4: without the host's age, a run begun before monitorStartMs is never reported, not even when it ends later", () => {
    const M = T0 + 60_000;
    let s = initialState({ claudePid: CLAUDE_PID }, { hostStartedAtMs: null, monitorStartMs: M });
    s = admit(s, [SID], M);
    const spawn = sessionSpawn({ startedAt: iso(M - 1) });

    let r = step(s, [{ dir: SID, spawn: ok(spawn) }], M);
    const all = [...r.events];
    r = step(r.state, [{ dir: SID, writerAlive: true, terminal: ok<TerminalRecord>({ status: "completed" }) }], M + 2500);
    all.push(...r.events);

    expect(all).toEqual([]);
  });

  test("REQ-A4: without the host's age, a run begun at or after monitorStartMs is reported", () => {
    const M = T0 + 60_000;
    for (const startedAt of [M, M + 1000]) {
      let s = initialState({ claudePid: CLAUDE_PID }, { hostStartedAtMs: null, monitorStartMs: M });
      s = admit(s, [SID], startedAt);

      const r = step(s, [{ dir: SID, spawn: ok(sessionSpawn({ startedAt: iso(startedAt) })) }], startedAt);

      expect(r.events.map((e) => e.kind)).toEqual(["started"]);
    }
  });

  test("REQ-A5: with neither the host age nor a monitor start time, any record whose hostPid matches is reported", () => {
    const variants: InitOpts[] = [undefined, {}, { hostStartedAtMs: null, monitorStartMs: null }];
    for (const opts of variants) {
      let s = initialState({ claudePid: CLAUDE_PID }, opts);
      s = admit(s, [SID], T0);

      const r = step(s, [{ dir: SID, spawn: ok(sessionSpawn({ startedAt: iso(T0 - 10 * 3600_000) })) }], T0);

      expect(r.events.map((e) => e.kind)).toEqual(["started"]);
    }
  });

  test("REQ-A6: a valid own spawn record whose sessionId differs from its directory name produces nothing and leaves the machine", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, ["dir-name-1"], T0);

    const r = step(s, [{ dir: "dir-name-1", spawn: ok(sessionSpawn({ sessionId: "other-name-2" })) }], T0);

    expect(r.events).toEqual([]);
    const w = wants(r.state, T0);
    expect(w.undecided).not.toContain("dir-name-1");
    expect(w.tracked).toEqual([]);
  });

  test("REQ-A1: a team record whose hostPid matches yields one team started line carrying slots and path", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, [TID], T0);

    const r = step(s, [{ dir: TID, spawn: ok(teamSpawn()) }], T0);

    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: "started", record: "team", id: TID, slots: 4 });
    expect(r.lines).toEqual([`claudish-monitor: team ${TID} started slots=4 path=${TEAM_PATH_REL}`]);
  });
});

// ---------------------------------------------------------------------------------------------
// Decided on admission, ended before first seen, separation (REQ-S1..S3)
// ---------------------------------------------------------------------------------------------

describe("admission and separation (REQ-S1..S3, §4.5)", () => {
  test("REQ-S1: a directory admitted and observed with a valid own spawn is decided on that same call", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, [SID], T0);
    expect(wants(s, T0).undecided).toEqual([SID]);

    const r = step(s, [{ dir: SID, spawn: ok(sessionSpawn()) }], T0);

    expect(r.events.map((e) => e.kind)).toEqual(["started"]);
    expect(wants(r.state, T0).tracked.map((t) => t.dir)).toEqual([SID]);
  });

  for (const kind of ["session", "team"] as const) {
    test(`REQ-S2: a ${kind} record that already ended when first seen gives started, then its end on the next call, then nothing`, () => {
      const spawn = kind === "session" ? sessionSpawn() : teamSpawn();
      const id = spawn.sessionId;
      const terminal: TerminalRecord =
        kind === "session"
          ? { status: "completed", elapsedSeconds: 3, turnsCompleted: 1, toolCallCount: 0, costUsd: 0 }
          : { status: "completed", elapsedSeconds: 3, slots: 4, ok: 4, failed: 0, cancelled: 0 };
      let s = initialState({ claudePid: CLAUDE_PID }, { heartbeatIntervalMs: 1000 });
      s = admit(s, [id], T0);

      const first = step(s, [{ dir: id, hasRuntimeFiles: true, spawn: ok(spawn), terminal: ok(terminal) }], T0);
      const second = step(first.state, [{ dir: id, writerAlive: true, terminal: ok(terminal), waits: [] }], T0 + 2500);
      let state = second.state;
      const later: MonitorEvent[] = [];
      for (let i = 1; i <= 10; i++) {
        const r = step(state, [{ dir: id, writerAlive: true, terminal: ok(terminal), waits: [] }], T0 + 2500 + i * 2000);
        later.push(...r.events);
        state = r.state;
      }

      expect(first.events.map((e) => e.kind)).toEqual(["started"]);
      expect(second.events).toHaveLength(1);
      expect(second.events[0]).toMatchObject({ kind: "ended", record: kind, id, state: "completed" });
      expect(later).toEqual([]);
    });
  }

  test("REQ-S3: the call that decides started never also emits a terminal line, even with every terminal fact present", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, [SID], T0);

    const r = step(
      s,
      [{ dir: SID, spawn: ok(sessionSpawn()), writerAlive: false, terminal: ok<TerminalRecord>({ status: "failed" }) }],
      T0,
    );

    expect(r.events.map((e) => e.kind)).toEqual(["started"]);
  });
});

// ---------------------------------------------------------------------------------------------
// parseSpawnRecord (REQ-P1)
// ---------------------------------------------------------------------------------------------

const VALID_SESSION_JSON = {
  schema: 1,
  kind: "session",
  sessionId: SID,
  hostPid: 12345,
  mcpPid: 12399,
  startedAt: "2026-10-02T10:00:00.000Z",
  model: "MODEL_ID",
  timeoutSeconds: 600,
  claudeSessionId: "child-uuid-0001",
};
const VALID_TEAM_JSON = {
  schema: 1,
  kind: "team",
  sessionId: TID,
  hostPid: 12345,
  mcpPid: 12399,
  startedAt: "2026-10-02T10:00:00.000Z",
  teamPath: "/abs/team/dir",
  slots: 4,
};
const without = (o: Record<string, unknown>, key: string): Record<string, unknown> => {
  const c = { ...o };
  delete c[key];
  return c;
};

describe("parseSpawnRecord (REQ-P1, §3.3 rules 1-4)", () => {
  test("a valid session record parses to ok with its fields", () => {
    const r = parseSpawnRecord(JSON.stringify(VALID_SESSION_JSON, null, 2));

    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value).toMatchObject({
      kind: "session",
      sessionId: SID,
      hostPid: 12345,
      mcpPid: 12399,
      startedAt: "2026-10-02T10:00:00.000Z",
      model: "MODEL_ID",
      timeoutSeconds: 600,
    });
  });

  test("a valid team record parses to ok with teamPath and slots", () => {
    const r = parseSpawnRecord(JSON.stringify(VALID_TEAM_JSON, null, 2));

    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value).toMatchObject({ kind: "team", sessionId: TID, teamPath: "/abs/team/dir", slots: 4 });
  });

  test("optional launcherPid and parentClaudeSessionId are accepted when they follow the rules", () => {
    const r = parseSpawnRecord(
      JSON.stringify({ ...VALID_SESSION_JSON, launcherPid: 12398, parentClaudeSessionId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" }),
    );

    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value.parentClaudeSessionId).toBe("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0");
  });

  test("text that does not parse as JSON (a write in progress) is unreadable", () => {
    const full = JSON.stringify(VALID_SESSION_JSON, null, 2);
    expect(parseSpawnRecord(full.slice(0, full.length / 2)).kind).toBe("unreadable");
    expect(parseSpawnRecord("").kind).toBe("unreadable");
  });

  const invalid: [string, unknown][] = [
    ["schema 2", { ...VALID_SESSION_JSON, schema: 2 }],
    ["no schema", without(VALID_SESSION_JSON, "schema")],
    ["kind batch", { ...VALID_SESSION_JSON, kind: "batch" }],
    ["no hostPid", without(VALID_SESSION_JSON, "hostPid")],
    ["hostPid zero", { ...VALID_SESSION_JSON, hostPid: 0 }],
    ["mcpPid as a string", { ...VALID_SESSION_JSON, mcpPid: "12399" }],
    ["startedAt not a date", { ...VALID_SESSION_JSON, startedAt: "yesterday at noon" }],
    ["sessionId with a space", { ...VALID_SESSION_JSON, sessionId: "1a2b 3c4d" }],
    ["sessionId starting with a dot", { ...VALID_SESSION_JSON, sessionId: ".hidden" }],
    ["sessionId of 65 characters", { ...VALID_SESSION_JSON, sessionId: "a".repeat(65) }],
    ["launcherPid equal to hostPid", { ...VALID_SESSION_JSON, launcherPid: 12345 }],
    ["launcherPid equal to mcpPid", { ...VALID_SESSION_JSON, launcherPid: 12399 }],
    ["launcherPid negative", { ...VALID_SESSION_JSON, launcherPid: -3 }],
    ["parentClaudeSessionId too short", { ...VALID_SESSION_JSON, parentClaudeSessionId: "abc" }],
    ["parentClaudeSessionId empty", { ...VALID_SESSION_JSON, parentClaudeSessionId: "" }],
    ["parentClaudeSessionId with a slash", { ...VALID_SESSION_JSON, parentClaudeSessionId: "abcd/efgh/ijkl" }],
    ["session timeoutSeconds 0", { ...VALID_SESSION_JSON, timeoutSeconds: 0 }],
    ["session without timeoutSeconds", without(VALID_SESSION_JSON, "timeoutSeconds")],
    ["session model as a number", { ...VALID_SESSION_JSON, model: 7 }],
    ["team without teamPath", without(VALID_TEAM_JSON, "teamPath")],
    ["team with a relative teamPath", { ...VALID_TEAM_JSON, teamPath: "relative/dir" }],
    ["team with zero slots", { ...VALID_TEAM_JSON, slots: 0 }],
    ["a JSON array", []],
    ["JSON null", null],
  ];

  test.each(invalid)("valid JSON with %s is invalid, with a reason", (_name, doc) => {
    const r = parseSpawnRecord(JSON.stringify(doc));

    expect(r.kind).toBe("invalid");
    if (r.kind === "invalid") expect(r.reason.length).toBeGreaterThan(0);
  });

  // Rule 4 says 1..3600; amendment 2 says the monitor "may still receive older records with
  // other values". Kept separate so a failure here is triaged as AMBIGUOUS, not a bug.
  test.each([
    ["3601", 3601],
    ["1.5", 1.5],
  ] as [string, number][])("session timeoutSeconds %s (outside the integer range 1..3600) is invalid", (_n, value) => {
    expect(parseSpawnRecord(JSON.stringify({ ...VALID_SESSION_JSON, timeoutSeconds: value })).kind).toBe("invalid");
  });

  test("each invalid record produces no line and leaves the machine", () => {
    const dirs = invalid.map((_, i) => `bad${i}`);
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, dirs, T0);
    const observations: Observation[] = invalid.map(([, doc], i) => ({
      dir: `bad${i}`,
      hasRuntimeFiles: true,
      spawn: parseSpawnRecord(JSON.stringify(doc)),
    }));

    const r = step(s, observations, T0);

    expect(r.events).toEqual([]);
    const w = wants(r.state, T0);
    expect(w.undecided).toEqual([]);
    expect(w.tracked).toEqual([]);
  });

  test("an unreadable spawn record keeps the directory undecided for a retry", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, [SID], T0);

    const r = step(s, [{ dir: SID, hasRuntimeFiles: false, spawn: UNREADABLE }], T0 + 1000);

    expect(r.events).toEqual([]);
    expect(wants(r.state, T0 + 1000).undecided).toContain(SID);
  });
});

// ---------------------------------------------------------------------------------------------
// parseTerminalRecord (REQ-P2)
// ---------------------------------------------------------------------------------------------

describe("parseTerminalRecord (REQ-P2)", () => {
  const sessionMeta = {
    sessionId: SID,
    model: "MODEL_ID",
    status: "completed",
    pid: 777,
    startedAt: "2026-10-02T10:00:00.000Z",
    completedAt: "2026-10-02T10:07:41.000Z",
    exitCode: 0,
    turnsCompleted: 5,
    tokensUsed: 1234,
    toolCallCount: 22,
    idleSeconds: 0,
    costUsd: 0.09,
    terminalReason: "end_turn",
    claudeSessionId: "child-uuid-0001",
    transcriptPath: "/tmp/transcript.jsonl",
  };

  test("a session meta.json parses to ok with status and final numbers", () => {
    const r = parseTerminalRecord(JSON.stringify(sessionMeta, null, 2), "session");

    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value).toMatchObject({
      status: "completed",
      turnsCompleted: 5,
      toolCallCount: 22,
      costUsd: 0.09,
      exitCode: 0,
      terminalReason: "end_turn",
    });
  });

  test("a team meta.json parses to ok with its counts and reason", () => {
    const team = {
      kind: "team",
      status: "failed",
      startedAt: "2026-10-02T10:00:00.000Z",
      completedAt: "2026-10-02T10:00:02.000Z",
      elapsedSeconds: 2,
      slots: 2,
      ok: 0,
      failed: 2,
      cancelled: 0,
      reason: "start-failed",
    };

    const r = parseTerminalRecord(JSON.stringify(team), "team");

    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value).toMatchObject({ status: "failed", elapsedSeconds: 2, slots: 2, ok: 0, failed: 2, cancelled: 0, reason: "start-failed" });
  });

  test("a half-written meta.json is unreadable for either kind", () => {
    const text = JSON.stringify(sessionMeta, null, 2);
    expect(parseTerminalRecord(text.slice(0, 40), "session").kind).toBe("unreadable");
    expect(parseTerminalRecord('{"kind":"team","status":"comp', "team").kind).toBe("unreadable");
  });
});

// ---------------------------------------------------------------------------------------------
// parseWaitLines (REQ-P3)
// ---------------------------------------------------------------------------------------------

describe("parseWaitLines (REQ-P3)", () => {
  const OPEN = '{"wait":"open","since":"2026-10-02T10:03:12.000Z","turns":1}';
  const CLOSED = '{"wait":"closed","since":"2026-10-02T10:03:12.000Z","at":"2026-10-02T10:03:13.400Z","to":"running"}';

  test("complete lines are parsed and the partial last line is not consumed", () => {
    const complete = `${OPEN}\n${CLOSED}\n`;

    const r = parseWaitLines(`${complete}{"wait":"open","sin`);

    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ wait: "open", since: "2026-10-02T10:03:12.000Z", turns: 1 });
    expect(r.lines[1]).toMatchObject({
      wait: "closed",
      since: "2026-10-02T10:03:12.000Z",
      at: "2026-10-02T10:03:13.400Z",
      to: "running",
    });
    expect(r.consumedBytes).toBe(Buffer.byteLength(complete));
  });

  test("an empty chunk or a chunk with no newline consumes nothing", () => {
    expect(parseWaitLines("")).toEqual({ lines: [], consumedBytes: 0 });
    expect(parseWaitLines(OPEN)).toEqual({ lines: [], consumedBytes: 0 });
  });

  test("unparsable lines and lines whose since or at is not a timestamp are skipped but consumed", () => {
    const chunk = [
      "not json at all",
      '{"wait":"open","since":"not-a-time","turns":1}',
      '{"wait":"closed","since":"2026-10-02T10:03:12.000Z","at":"later","to":"running"}',
      OPEN,
      "",
    ].join("\n");

    const r = parseWaitLines(chunk);

    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ wait: "open", since: "2026-10-02T10:03:12.000Z" });
    expect(r.consumedBytes).toBe(Buffer.byteLength(chunk));
  });

  test("consumedBytes counts bytes, not characters, for multi-byte UTF-8", () => {
    const line = '{"wait":"closed","since":"2026-10-02T10:03:12.000Z","at":"2026-10-02T10:03:13.000Z","to":"rünning"}\n';

    const r = parseWaitLines(line);

    expect(r.consumedBytes).toBe(Buffer.byteLength(line));
  });
});

// ---------------------------------------------------------------------------------------------
// Too-old notice (REQ-N1..N4)
// ---------------------------------------------------------------------------------------------

describe("claudish-too-old notice (REQ-N1..N4, §4.5, §5.3)", () => {
  const oldDir = (dir: string, hostClaudish: Observation["hostClaudish"]): Observation => ({
    dir,
    hasRuntimeFiles: true,
    spawn: ABSENT,
    hostClaudish,
  });

  test("REQ-N1: runtime files without a spawn record and an old host claudish give exactly one notice naming the version read", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, ["oldfmt1"], T0);

    const r = step(s, [oldDir("oldfmt1", "old")], T0, { oldClaudishVersion: "10.3.0" });

    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: "notice", code: "claudish-too-old" });
    expect(r.lines[0]).toStartWith("claudish-monitor: notice claudish-too-old: ");
    expect(r.lines[0]).toContain("10.3.0");
    expect(r.lines[0]).toContain(MIN_CLAUDISH_VERSION);
    expect(wants(r.state, T0).undecided).not.toContain("oldfmt1");
  });

  test("REQ-N1: a second old-format directory adds nothing", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, ["oldfmt1"], T0);
    const first = step(s, [oldDir("oldfmt1", "old")], T0, { oldClaudishVersion: "10.3.0" });
    s = admit(first.state, ["oldfmt2"], T0 + 2500);

    const second = step(s, [oldDir("oldfmt2", "old")], T0 + 2500, { oldClaudishVersion: "10.3.0" });

    expect(second.events).toEqual([]);
  });

  test("REQ-N2: a new or absent host claudish removes the directory silently and keeps the notice available", () => {
    for (const host of ["new", "none"] as const) {
      let s = initialState({ claudePid: CLAUDE_PID });
      s = admit(s, ["oldfmt1"], T0);
      const r1 = step(s, [oldDir("oldfmt1", host)], T0);
      s = admit(r1.state, ["oldfmt2"], T0 + 2500);

      const r2 = step(s, [oldDir("oldfmt2", "old")], T0 + 2500, { oldClaudishVersion: "10.3.0" });

      expect(r1.events).toEqual([]);
      expect(wants(r1.state, T0).undecided).not.toContain("oldfmt1");
      expect(r2.events.map((e) => e.kind)).toEqual(["notice"]);
    }
  });

  test("REQ-N3: an unknown host claudish keeps the directory undecided until the give-up time, then drops it silently", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, ["oldfmt1"], T0);

    const mid = step(s, [oldDir("oldfmt1", "unknown")], T0 + 30_000);
    const atLimit = step(mid.state, [oldDir("oldfmt1", "unknown")], T0 + UNDECIDED_GIVE_UP_MS);
    const past = step(atLimit.state, [oldDir("oldfmt1", "unknown")], T0 + UNDECIDED_GIVE_UP_MS + 1);

    expect([...mid.events, ...atLimit.events, ...past.events]).toEqual([]);
    expect(wants(mid.state, T0 + 30_000).undecided).toContain("oldfmt1");
    expect(wants(atLimit.state, T0 + UNDECIDED_GIVE_UP_MS).undecided).toContain("oldfmt1");
    expect(wants(past.state, T0 + UNDECIDED_GIVE_UP_MS + 1).undecided).not.toContain("oldfmt1");
  });

  test("REQ-N3: a directory with neither a spawn record nor runtime files stays undecided until it is given up", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, ["empty1"], T0);

    const mid = step(s, [{ dir: "empty1", hasRuntimeFiles: false, spawn: ABSENT }], T0 + 10_000);
    const past = step(mid.state, [{ dir: "empty1", hasRuntimeFiles: false, spawn: ABSENT }], T0 + UNDECIDED_GIVE_UP_MS + 1);

    expect([...mid.events, ...past.events]).toEqual([]);
    expect(wants(mid.state, T0 + 10_000).undecided).toContain("empty1");
    expect(wants(past.state, T0 + UNDECIDED_GIVE_UP_MS + 1).undecided).not.toContain("empty1");
  });

  test("REQ-N4: the startup check reporting old gives the notice with no directory at all, and a later old-format directory adds nothing", () => {
    const s0 = initialState({ claudePid: CLAUDE_PID });

    const r1 = step(s0, [], T0, { startupHostClaudish: "old", oldClaudishVersion: "10.3.0" });
    const s1 = admit(r1.state, ["oldfmt1"], T0 + 2500);
    const r2 = step(s1, [oldDir("oldfmt1", "old")], T0 + 2500, { oldClaudishVersion: "10.3.0" });

    expect(r1.events).toHaveLength(1);
    expect(r1.events[0]).toMatchObject({ kind: "notice", code: "claudish-too-old" });
    expect(r1.lines[0]).toContain("10.3.0");
    expect(r2.events).toEqual([]);
  });

  test("REQ-N4: the startup check reporting new, none or unknown gives nothing", () => {
    for (const host of ["new", "none", "unknown"] as const) {
      const r = step(initialState({ claudePid: CLAUDE_PID }), [], T0, { startupHostClaudish: host });
      expect(r.events).toEqual([]);
    }
  });

  test("REQ-N1: a directory with a valid own spawn record is never an old-format directory, whatever hostClaudish says", () => {
    let s = initialState({ claudePid: CLAUDE_PID });
    s = admit(s, [SID], T0);

    const r = step(s, [{ dir: SID, hasRuntimeFiles: true, spawn: ok(sessionSpawn()), hostClaudish: "old" }], T0, {
      oldClaudishVersion: "10.3.0",
    });

    expect(r.events.map((e) => e.kind)).toEqual(["started"]);
  });
});

// ---------------------------------------------------------------------------------------------
// hostClaudishState, claudishChildrenOf, scriptPathFrom, versionBelow (REQ-V1..V4)
// ---------------------------------------------------------------------------------------------

describe("hostClaudishState (REQ-V1, §5.3)", () => {
  const c = (version: string | null, pid = 100): ClaudishChild => ({ pid, version });
  const cases: [string, ClaudishChild[] | null, string][] = [
    ["no process table", null, "unknown"],
    ["no claudish child", [], "none"],
    ["one child below the minimum", [c("10.3.0")], "old"],
    ["one child at the minimum", [c("10.4.0")], "new"],
    ["10.10.0 (numeric, not string, comparison)", [c("10.10.0")], "new"],
    ["10.4.0-beta.1 (suffix ignored)", [c("10.4.0-beta.1")], "new"],
    ["four children, one of them old", [c("10.4.0", 1), c("10.4.0", 2), c("10.3.0", 3), c("10.4.0", 4)], "old"],
    ["one unread and one current", [c(null, 1), c("10.4.0", 2)], "unknown"],
    ["one unread alone", [c(null)], "unknown"],
  ];

  test.each(cases)("%s → %s", (_name, children, expected) => {
    expect(hostClaudishState(children, "10.4.0")).toBe(expected as ReturnType<typeof hostClaudishState>);
  });

  test("a missing reading is never old", () => {
    expect(hostClaudishState([c(null), c(null, 2)], "10.4.0")).not.toBe("old");
  });
});

describe("claudishChildrenOf (REQ-V2)", () => {
  const row = (pid: number, ppid: number, command: string): ProcessRow => ({ pid, ppid, ageSeconds: 100, command });
  const table: ProcessRow[] = [
    row(100, 1, "/opt/claude/bin/claude"),
    row(200, 100, "node /usr/local/bin/claudish --mcp"),
    row(201, 200, "bun /usr/local/lib/node_modules/claudish/dist/index.js --mcp"),
    row(300, 201, "claudish --model some-model --stdin"),
    row(400, 300, "/opt/claude/bin/claude -p"),
    row(500, 400, "node /usr/local/bin/claudish --mcp"),
    row(501, 500, "bun /usr/local/lib/node_modules/claudish/dist/index.js --mcp"),
    row(210, 100, "node /usr/local/bin/claudish --version"),
    row(220, 100, "node /opt/other-server/index.js --mcp"),
    row(230, 100, "node /usr/local/bin/claudish --mcpx"),
  ];

  test("only the outer launcher is a direct claudish --mcp child of the outer Claude Code", () => {
    expect(claudishChildrenOf(table, 100).map((r) => r.pid)).toEqual([200]);
  });

  test("the nested window's launcher belongs to the inner Claude Code only", () => {
    expect(claudishChildrenOf(table, 400).map((r) => r.pid)).toEqual([500]);
  });

  test("a pid with no children yields none", () => {
    expect(claudishChildrenOf(table, 999)).toEqual([]);
  });
});

describe("scriptPathFrom (REQ-V3)", () => {
  const cases: [string, string | null][] = [
    ["node /p/bin/claudish --mcp", "/p/bin/claudish"],
    ["/q/bun /p/dist/index.js --mcp", "/p/dist/index.js"],
    ["bun --env-file=/dev/null /p/dist/index.js --mcp", "/p/dist/index.js"],
    ["/usr/local/bin/node /p/bin/claudish --mcp", "/p/bin/claudish"],
    ["node --require ./pre.cjs /p/bin/claudish --mcp", "./pre.cjs"],
    ["/q/claudish --mcp", null],
    ["python3 /p/x.py --mcp", null],
    ["node", null],
    ["", null],
  ];

  test.each(cases)("%p → %p", (command, expected) => {
    expect(scriptPathFrom(command)).toBe(expected);
  });
});

describe("versionBelow (REQ-V4)", () => {
  const cases: [string, string, boolean][] = [
    ["10.3.0", "10.4.0", true],
    ["10.3.9", "10.4.0", true],
    ["9.99.99", "10.0.0", true],
    ["10.4.0", "10.4.0", false],
    ["10.4.1", "10.4.0", false],
    ["10.10.0", "10.4.0", false],
    ["11.0.0", "10.4.0", false],
    ["10.4.0-beta.1", "10.4.0", false],
  ];

  test.each(cases)("versionBelow(%p, %p) is %p", (v, min, expected) => {
    expect(versionBelow(v, min)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// No identity, history (REQ-I1, REQ-H1)
// ---------------------------------------------------------------------------------------------

describe("no session identity (REQ-I1)", () => {
  test("claudePid null emits one no-session-identity notice, then nothing for any input", () => {
    let s = initialState({ claudePid: null });
    s = admit(s, [SID], T0);

    const first = step(s, [{ dir: SID, spawn: ok(sessionSpawn()) }], T0);
    let state = first.state;
    const later: MonitorEvent[] = [];
    for (let i = 1; i <= 3; i++) {
      state = admit(state, [`x${i}`], T0 + i * 2500);
      const r = step(
        state,
        [
          { dir: SID, spawn: ok(sessionSpawn()), writerAlive: false, terminal: ABSENT },
          { dir: `x${i}`, spawn: ok(sessionSpawn({ sessionId: `x${i}` })) },
        ],
        T0 + i * 2500,
        { startupHostClaudish: "old", oldClaudishVersion: "10.3.0" },
      );
      later.push(...r.events);
      state = r.state;
    }

    expect(first.events).toEqual([{ kind: "notice", code: "no-session-identity" }]);
    expect(first.lines[0]).toMatch(NOTICE_RE);
    expect(first.lines[0]).toStartWith("claudish-monitor: notice no-session-identity: ");
    expect(later).toEqual([]);
  });
});

describe("history (REQ-H1, R3.7)", () => {
  test("names never admitted produce no events, whatever observations are supplied", () => {
    const s = initialState({ claudePid: CLAUDE_PID });

    const r = step(
      s,
      [
        { dir: SID, hasRuntimeFiles: true, spawn: ok(sessionSpawn()) },
        { dir: TID, writerAlive: false, terminal: ok<TerminalRecord>({ status: "completed" }) },
        { dir: "zzz", waits: [{ wait: "open", since: iso(T0) }] },
      ],
      T0 + HB,
    );

    expect(r.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Terminal states (REQ-T1..T4)
// ---------------------------------------------------------------------------------------------

describe("terminal states (REQ-T1..T4, §4.3.1)", () => {
  const sessionCases: [string, TerminalRecord, string][] = [
    [
      "completed",
      { status: "completed", elapsedSeconds: 461, turnsCompleted: 5, toolCallCount: 22, costUsd: 0.09, exitCode: 0, terminalReason: "end_turn" },
      `claudish-monitor: session ${SID} completed model=MODEL_ID elapsed=7m41s turns=5 tools=22 cost=$0.09 next: get_output ${SID}`,
    ],
    [
      "failed with a reason and an exit code",
      { status: "failed", elapsedSeconds: 4, turnsCompleted: 1, toolCallCount: 2, costUsd: 0.0042, exitCode: 1, terminalReason: "child-crashed" },
      `claudish-monitor: session ${SID} failed model=MODEL_ID elapsed=0m04s turns=1 tools=2 cost=$0.0042 reason=child-crashed exit=1 next: get_diagnostics ${SID}`,
    ],
    [
      "timeout whose reason repeats the state word",
      { status: "timeout", elapsedSeconds: 3900, turnsCompleted: 3, toolCallCount: 9, costUsd: 1.5, exitCode: 143, terminalReason: "timeout" },
      `claudish-monitor: session ${SID} timeout model=MODEL_ID elapsed=1h05m turns=3 tools=9 cost=$1.50 exit=143 next: get_diagnostics ${SID}`,
    ],
    [
      "cancelled (no reason, no exit, no hint; turns below 1 omitted)",
      { status: "cancelled", elapsedSeconds: 30, turnsCompleted: 0, toolCallCount: 2, costUsd: 0, exitCode: 130, terminalReason: "user" },
      `claudish-monitor: session ${SID} cancelled model=MODEL_ID elapsed=0m30s tools=2 cost=$0.00`,
    ],
    [
      "failed with a null exit code and an empty reason",
      { status: "failed", elapsedSeconds: 61, turnsCompleted: 2, toolCallCount: 3, costUsd: 0.01, exitCode: null, terminalReason: "" },
      `claudish-monitor: session ${SID} failed model=MODEL_ID elapsed=1m01s turns=2 tools=3 cost=$0.01 next: get_diagnostics ${SID}`,
    ],
    [
      "failed whose reason repeats the state word",
      { status: "failed", elapsedSeconds: 5, turnsCompleted: 1, toolCallCount: 1, costUsd: 0.06, exitCode: 2, terminalReason: "failed" },
      `claudish-monitor: session ${SID} failed model=MODEL_ID elapsed=0m05s turns=1 tools=1 cost=$0.06 exit=2 next: get_diagnostics ${SID}`,
    ],
  ];

  test.each(sessionCases)("REQ-T1: session %s renders the right word, fields and hint", (_name, terminal, expected) => {
    const s = tracked(sessionSpawn());

    const r = step(s, [aliveObs(SID, { terminal: ok(terminal) })], T0 + 2500);

    expect(r.lines).toEqual([expected]);
    expect(r.lines[0]).toMatch(SESSION_RE);
  });

  test("REQ-T2: a session meta.json with an unrecognised status ends as failed reason=unrecognised-status", () => {
    const s = tracked(sessionSpawn());

    const r = step(s, [aliveObs(SID, { terminal: ok<TerminalRecord>({ status: "exploded", elapsedSeconds: 9 }) })], T0 + 2500);

    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: "ended", record: "session", state: "failed", reason: "unrecognised-status" });
    expect(r.lines[0]).toStartWith(`claudish-monitor: session ${SID} failed `);
    expect(fieldOf(r.lines[0]!, "reason")).toBe("unrecognised-status");
    expect(r.lines[0]).toEndWith(`next: get_diagnostics ${SID}`);
  });

  const teamCases: [string, number, TerminalRecord, string][] = [
    [
      "completed",
      4,
      { status: "completed", elapsedSeconds: 723, slots: 4, ok: 3, failed: 1, cancelled: 0 },
      `claudish-monitor: team ${TID} completed elapsed=12m03s slots=4 ok=3 failed=1 cancelled=0 path=${TEAM_PATH_REL} next: team-status`,
    ],
    [
      "failed to start",
      2,
      { status: "failed", reason: "start-failed", elapsedSeconds: 2, slots: 2, ok: 0, failed: 2, cancelled: 0 },
      `claudish-monitor: team ${TID} failed elapsed=0m02s slots=2 ok=0 failed=2 cancelled=0 reason=start-failed path=${TEAM_PATH_REL} next: team-status`,
    ],
    [
      "cancelled",
      4,
      { status: "cancelled", elapsedSeconds: 65, slots: 4, ok: 0, failed: 0, cancelled: 4 },
      `claudish-monitor: team ${TID} cancelled elapsed=1m05s slots=4 ok=0 failed=0 cancelled=4 path=${TEAM_PATH_REL} next: team-status`,
    ],
  ];

  test.each(teamCases)("REQ-T3: team %s renders the right word, counts, path and hint", (_name, slots, terminal, expected) => {
    const s = tracked(teamSpawn({ slots }));

    const r = step(s, [aliveTeamObs(TID, { terminal: ok(terminal) })], T0 + 2500);

    expect(r.lines).toEqual([expected]);
    expect(r.lines[0]).toMatch(TEAM_RE);
  });

  test("REQ-T4: a team meta.json with a status outside completed/failed/cancelled ends as failed reason=unrecognised-status", () => {
    const s = tracked(teamSpawn());

    const r = step(s, [aliveTeamObs(TID, { terminal: ok<TerminalRecord>({ status: "timeout", elapsedSeconds: 10 }) })], T0 + 2500);

    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: "ended", record: "team", state: "failed", reason: "unrecognised-status" });
    expect(r.lines[0]).toEndWith("next: team-status");
  });
});

// ---------------------------------------------------------------------------------------------
// Partial terminal record and lost writer (REQ-R1, REQ-L1..L3)
// ---------------------------------------------------------------------------------------------

describe("partial terminal record (REQ-R1, R3.9)", () => {
  test("an unreadable meta.json with the writer alive gives nothing; once it parses, the terminal line", () => {
    const s = tracked(sessionSpawn());

    const r1 = step(s, [aliveObs(SID, { terminal: UNREADABLE })], T0 + 2500);
    const r2 = step(r1.state, [aliveObs(SID, { terminal: ok<TerminalRecord>({ status: "completed", elapsedSeconds: 5 }) })], T0 + 5000);

    expect(r1.events).toEqual([]);
    expect(r2.events).toHaveLength(1);
    expect(r2.events[0]).toMatchObject({ kind: "ended", state: "completed" });
  });

  test("an unreadable meta.json with the writer dead ends as failed reason=terminal-record-unreadable", () => {
    const s = tracked(sessionSpawn());

    const r = step(s, [{ dir: SID, writerAlive: false, terminal: UNREADABLE, waits: [] }], T0 + 2500);

    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: "ended", state: "failed", reason: "terminal-record-unreadable" });
    expect(r.lines[0]).toStartWith(`claudish-monitor: session ${SID} failed model=MODEL_ID `);
    expect(fieldOf(r.lines[0]!, "reason")).toBe("terminal-record-unreadable");
    expect(r.lines[0]).toEndWith(`next: get_diagnostics ${SID}`);
  });
});

describe("lost writer (REQ-L1..L3)", () => {
  test("REQ-L1: no meta.json and a dead writer ends as failed reason=no-terminal-record", () => {
    const s = tracked(sessionSpawn());

    const r = step(s, [{ dir: SID, writerAlive: false, terminal: ABSENT, waits: [] }], T0 + 4000);

    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: "ended", record: "session", state: "failed", reason: "no-terminal-record" });
    expect(r.lines[0]).toStartWith(`claudish-monitor: session ${SID} failed model=MODEL_ID `);
    expect(fieldOf(r.lines[0]!, "reason")).toBe("no-terminal-record");
    expect(r.lines[0]).toEndWith(`next: get_diagnostics ${SID}`);
  });

  test("REQ-L1: a team with no meta.json and a dead writer ends as failed reason=no-terminal-record", () => {
    const s = tracked(teamSpawn());

    const r = step(s, [{ dir: TID, writerAlive: false, terminal: ABSENT }], T0 + 4000);

    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ kind: "ended", record: "team", state: "failed", reason: "no-terminal-record" });
    expect(r.lines[0]).toEndWith("next: team-status");
  });

  test("REQ-L2: a live writer long past the session's deadline gets heartbeats only, never a verdict", () => {
    let state = tracked(sessionSpawn({ timeoutSeconds: 60 }));
    const kinds: string[] = [];
    for (let i = 1; i <= 24; i++) {
      const r = step(state, [aliveObs(SID, { progress: ok<Progress>({}) })], T0 + i * HB);
      kinds.push(...r.events.map((e) => e.kind));
      state = r.state;
    }

    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(kinds)).toEqual(new Set(["running"]));
  });

  test("REQ-L3: writer liveness unknown (null) never yields a terminal line, with the record absent or unreadable", () => {
    let state = tracked(sessionSpawn());
    const kinds: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const terminal = i % 2 === 0 ? ABSENT : UNREADABLE;
      const r = step(state, [{ dir: SID, writerAlive: null, terminal, waits: [] }], T0 + i * HB);
      kinds.push(...r.events.map((e) => e.kind));
      state = r.state;
    }

    expect(kinds).not.toContain("ended");
  });
});

// ---------------------------------------------------------------------------------------------
// Waits (REQ-W1..W8)
// ---------------------------------------------------------------------------------------------

describe("waits (REQ-W1..W8, CRITICAL 2, amendments)", () => {
  const sinceA = iso(T0 + 72_000);
  const openA: WaitLine = { wait: "open", since: sinceA, turns: 1 };
  const closedA: WaitLine = { wait: "closed", since: sinceA, at: iso(T0 + 73_000), to: "running" };
  const sinceB = iso(T0 + 160_000);
  const openB: WaitLine = { wait: "open", since: sinceB, turns: 2 };
  const closedB: WaitLine = { wait: "closed", since: sinceB, at: iso(T0 + 161_000), to: "running" };

  test("REQ-W1: an open wait gives one needs-input line with the send_input hint; the same line again gives nothing", () => {
    const s = tracked(sessionSpawn());

    const r1 = step(s, [aliveObs(SID, { waits: [openA] })], T0 + 75_000);
    const r2 = step(r1.state, [aliveObs(SID, { waits: [openA] })], T0 + 77_500);

    expect(r1.lines).toEqual([
      `claudish-monitor: session ${SID} needs-input model=MODEL_ID elapsed=1m12s turns=1 next: send_input ${SID}`,
    ]);
    expect(r2.events).toEqual([]);
  });

  test("REQ-W2: an open and its closed line in one observation give one needs-input line with waited and no hint", () => {
    const s = tracked(sessionSpawn());

    const r = step(s, [aliveObs(SID, { waits: [openA, closedA] })], T0 + 75_000);

    expect(r.lines).toEqual([`claudish-monitor: session ${SID} needs-input model=MODEL_ID elapsed=1m12s turns=1 waited=0m01s`]);
  });

  test("REQ-W3: a later wait gives another needs-input line", () => {
    const s = tracked(sessionSpawn());
    const r1 = step(s, [aliveObs(SID, { waits: [openA] })], T0 + 75_000);
    const r2 = step(r1.state, [aliveObs(SID, { waits: [closedA] })], T0 + 100_000);

    const r3 = step(r2.state, [aliveObs(SID, { waits: [openB] })], T0 + 162_500);

    expect(r2.events).toEqual([]);
    expect(r3.lines).toEqual([
      `claudish-monitor: session ${SID} needs-input model=MODEL_ID elapsed=2m40s turns=2 next: send_input ${SID}`,
    ]);
  });

  test("REQ-W4: no running heartbeat while the newest wait is open", () => {
    let state = step(tracked(sessionSpawn()), [aliveObs(SID, { waits: [openA] })], T0 + 75_000).state;
    const kinds: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const r = step(state, [aliveObs(SID, { progress: ok<Progress>({ replies: 3 }) })], T0 + 75_000 + i * HB);
      kinds.push(...r.events.map((e) => e.kind));
      state = r.state;
    }

    expect(kinds).toEqual([]);
  });

  test("REQ-W4: while the newest wait is open, the record is not in progressFor", () => {
    const state = step(tracked(sessionSpawn()), [aliveObs(SID, { waits: [openA] })], T0 + 75_000).state;

    expect(wants(state, T0 + 75_000 + 2 * HB).progressFor).not.toContain(SID);
  });

  test("REQ-W5: after a wait closes, the heartbeat skips the poll that saw the close and comes on the next poll with its progress", () => {
    const opened = step(tracked(sessionSpawn()), [aliveObs(SID, { waits: [openA] })], T0 + 75_000);
    const tClose = T0 + 75_000 + 3 * HB;

    const closing = step(opened.state, [aliveObs(SID, { waits: [closedA] })], tClose);
    const next = step(
      closing.state,
      [aliveObs(SID, { progress: ok<Progress>({ replies: 4, toolCalls: 6, costUsd: 0.06 }) })],
      tClose + POLL_INTERVAL_MS,
    );

    expect(closing.events).toEqual([]);
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toMatchObject({ kind: "running", id: SID });
    expect(keysOf(next.lines[0]!)).toEqual(["model", "elapsed", "replies", "tools", "cost"]);
    expect(fieldOf(next.lines[0]!, "replies")).toBe("4");
    expect(fieldOf(next.lines[0]!, "tools")).toBe("6");
    expect(fieldOf(next.lines[0]!, "cost")).toBe("$0.06");
  });

  test("REQ-W6: a terminal observation with an unreported closed wait emits the needs-input line before the terminal line", () => {
    const s = tracked(sessionSpawn());

    const r = step(
      s,
      [aliveObs(SID, { waits: [openA, closedA], terminal: ok<TerminalRecord>({ status: "completed", elapsedSeconds: 90 }) })],
      T0 + 95_000,
    );

    expect(r.events.map((e) => e.kind)).toEqual(["needs-input", "ended"]);
    expect(r.lines[0]).toContain("waited=0m01s");
    expect(r.lines[0]).not.toContain("next:");
    expect(r.lines[1]).toStartWith(`claudish-monitor: session ${SID} completed `);
  });

  test("REQ-W7: a terminal observation with an unreported open wait emits only the terminal line, never send_input", () => {
    const s = tracked(sessionSpawn());

    const r = step(
      s,
      [{ dir: SID, writerAlive: false, terminal: ok<TerminalRecord>({ status: "cancelled", elapsedSeconds: 90 }), waits: [openA] }],
      T0 + 95_000,
    );

    expect(r.events.map((e) => e.kind)).toEqual(["ended"]);
    expect(r.lines.join("\n")).not.toContain("send_input");
  });

  test("REQ-W7: a wait already reported open, then a terminal, gives only the terminal line", () => {
    const opened = step(tracked(sessionSpawn()), [aliveObs(SID, { waits: [openA] })], T0 + 75_000);

    const r = step(
      opened.state,
      [aliveObs(SID, { terminal: ok<TerminalRecord>({ status: "completed", elapsedSeconds: 90 }) })],
      T0 + 95_000,
    );

    expect(r.events.map((e) => e.kind)).toEqual(["ended"]);
  });

  test("REQ-W7: a dead writer with an open wait and no record gives only the failed line", () => {
    const s = tracked(sessionSpawn());

    const r = step(s, [{ dir: SID, writerAlive: false, terminal: ABSENT, waits: [openA, closedA, openB] }], T0 + 170_000);

    expect(r.events.map((e) => e.kind)).toEqual(["needs-input", "ended"]);
    expect(r.lines[0]).toContain("waited=");
    expect(r.lines.join("\n")).not.toContain("send_input");
    expect(r.events[1]).toMatchObject({ state: "failed", reason: "no-terminal-record" });
  });

  test("REQ-W8: waits are ordered by instant, not text; a later instant written with a UTC offset is the newest", () => {
    // B is 11:00:30Z written as 06:00:30-05:00, which sorts BEFORE A ("10:00:00Z") as text.
    const s = tracked(sessionSpawn({ startedAt: iso(Date.parse("2026-10-02T09:59:00.000Z")) }));
    const aOpen: WaitLine = { wait: "open", since: "2026-10-02T10:00:00.000Z", turns: 1 };
    const aClosed: WaitLine = { wait: "closed", since: "2026-10-02T10:00:00.000Z", at: "2026-10-02T10:00:05.000Z", to: "running" };
    const bOpen: WaitLine = { wait: "open", since: "2026-10-02T06:00:30.000-05:00", turns: 2 };
    const tObs = Date.parse("2026-10-02T11:01:00.000Z");

    const r = step(s, [aliveObs(SID, { waits: [aOpen, bOpen, aClosed] })], tObs);
    let state = r.state;
    const later: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const h = step(state, [aliveObs(SID, { progress: ok<Progress>({ replies: 1 }) })], tObs + i * HB);
      later.push(...h.events.map((e) => e.kind));
      state = h.state;
    }

    expect(r.events.map((e) => e.kind)).toEqual(["needs-input", "needs-input"]);
    expect(r.lines[0]).toContain("turns=1");
    expect(r.lines[0]).toContain("waited=0m05s");
    expect(r.lines[1]).toContain("turns=2");
    expect(r.lines[1]).toEndWith(`next: send_input ${SID}`);
    expect(later).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Heartbeat (REQ-B1..B5)
// ---------------------------------------------------------------------------------------------

describe("heartbeat (REQ-B1..B5, R3.4)", () => {
  const progress = ok<Progress>({ replies: 7, toolCalls: 14, costUsd: 0.06 });

  test("REQ-B1: none before the interval, one at it, none again until another interval", () => {
    const s = tracked(sessionSpawn());

    const before = step(s, [aliveObs(SID, { progress })], T0 + HB - 1);
    const at = step(before.state, [aliveObs(SID, { progress })], T0 + HB);
    const after = step(at.state, [aliveObs(SID, { progress })], T0 + HB + POLL_INTERVAL_MS);
    const almost = step(after.state, [aliveObs(SID, { progress })], T0 + 2 * HB - 1);
    const again = step(almost.state, [aliveObs(SID, { progress })], T0 + 2 * HB);

    expect(before.events).toEqual([]);
    expect(at.lines).toEqual([`claudish-monitor: session ${SID} running model=MODEL_ID elapsed=5m00s replies=7 tools=14 cost=$0.06`]);
    expect(after.events).toEqual([]);
    expect(almost.events).toEqual([]);
    expect(again.events.map((e) => e.kind)).toEqual(["running"]);
    expect(fieldOf(again.lines[0]!, "elapsed")).toBe("10m00s");
  });

  test("REQ-B1: the heartbeat interval can be overridden through initialState", () => {
    const s = tracked(sessionSpawn(), { heartbeatIntervalMs: 1000 });

    const r = step(s, [aliveObs(SID, { progress })], T0 + 1000);

    expect(r.events.map((e) => e.kind)).toEqual(["running"]);
  });

  test("REQ-B2: replies below 1 are omitted", () => {
    const s = tracked(sessionSpawn());

    const r = step(s, [aliveObs(SID, { progress: ok<Progress>({ replies: 0, toolCalls: 3, costUsd: 0.01 }) })], T0 + HB);

    expect(keysOf(r.lines[0]!)).toEqual(["model", "elapsed", "tools", "cost"]);
  });

  test("REQ-B3: unreadable progress omits every progress field", () => {
    const s = tracked(sessionSpawn());

    const r = step(s, [aliveObs(SID, { progress: UNREADABLE })], T0 + HB);

    expect(r.lines).toEqual([`claudish-monitor: session ${SID} running model=MODEL_ID elapsed=5m00s`]);
  });

  test("REQ-B4: a team heartbeat carries elapsed slots ok failed cancelled running path, in that order", () => {
    const s = tracked(teamSpawn());

    const r = step(
      s,
      [aliveTeamObs(TID, { progress: ok<Progress>({ slots: 4, ok: 1, failed: 0, cancelled: 1, running: 2 }) })],
      T0 + HB,
    );

    expect(r.lines).toEqual([
      `claudish-monitor: team ${TID} running elapsed=5m00s slots=4 ok=1 failed=0 cancelled=1 running=2 path=${TEAM_PATH_REL}`,
    ]);
  });

  test("REQ-B5: no heartbeat after a terminal line", () => {
    const s = tracked(sessionSpawn());
    const ended = step(s, [aliveObs(SID, { terminal: ok<TerminalRecord>({ status: "completed", elapsedSeconds: 3 }) })], T0 + 2500);
    let state = ended.state;
    const later: MonitorEvent[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = step(state, [aliveObs(SID, { progress })], T0 + i * HB);
      later.push(...r.events);
      state = r.state;
    }

    expect(ended.events.map((e) => e.kind)).toEqual(["ended"]);
    expect(later).toEqual([]);
  });

  test("REQ-B5 (INFERRED): progressFor lists a record whose heartbeat is due and no wait is open", () => {
    const s = tracked(sessionSpawn());

    expect(wants(s, T0 + HB).progressFor).toContain(SID);
  });
});

// ---------------------------------------------------------------------------------------------
// Never twice, purity, error envelope (REQ-X1..X4)
// ---------------------------------------------------------------------------------------------

describe("never twice and purity (REQ-X1..X4)", () => {
  test("REQ-X1: after a terminal line the same observations produce nothing", () => {
    const s = tracked(sessionSpawn());
    const obs = [aliveObs(SID, { terminal: ok<TerminalRecord>({ status: "failed", elapsedSeconds: 3, exitCode: 1 }) })];
    const first = step(s, obs, T0 + 2500);

    const second = step(first.state, obs, T0 + 5000);
    const third = step(second.state, obs, T0 + 5000 + HB);

    expect(first.events).toHaveLength(1);
    expect([...second.events, ...third.events]).toEqual([]);
    const w = wants(third.state, T0 + 5000 + HB);
    expect(w.tracked).toEqual([]);
    expect(w.progressFor).toEqual([]);
  });

  test("REQ-X1 (INFERRED): re-admitting a name that already ended does not report it again", () => {
    const s = tracked(sessionSpawn());
    const ended = step(s, [aliveObs(SID, { terminal: ok<TerminalRecord>({ status: "completed" }) })], T0 + 2500);

    const readmitted = admit(ended.state, [SID], T0 + 5000);
    const r = step(readmitted, [{ dir: SID, spawn: ok(sessionSpawn()) }], T0 + 5000);

    expect(r.events).toEqual([]);
  });

  test("REQ-X2: admit ignores a name already in the machine", () => {
    const s = tracked(sessionSpawn());

    const again = admit(s, [SID], T0 + 1000);
    const r = step(again, [{ dir: SID, spawn: ok(sessionSpawn()), writerAlive: true, terminal: ABSENT, waits: [] }], T0 + 1000);

    expect(wants(again, T0 + 1000).undecided).not.toContain(SID);
    expect(r.events.filter((e) => e.kind === "started")).toEqual([]);
  });

  test("REQ-X3: admit and nextEvents never mutate their input state", () => {
    const s0 = initialState({ claudePid: CLAUDE_PID });
    const s1 = admit(s0, [SID], T0);
    const obs: Observation[] = [{ dir: SID, spawn: ok(sessionSpawn()) }];

    const a = step(s1, obs, T0);
    const b = step(s1, obs, T0);

    expect(wants(s0, T0).undecided).toEqual([]);
    expect(a.events.map((e) => e.kind)).toEqual(["started"]);
    expect(b.events).toEqual(a.events);
    expect(wants(s1, T0).undecided).toEqual([SID]);
  });

  test("REQ-X4: nextEvents never throws for hostile input, and an internal error returns the input state with no events", () => {
    const s = admit(initialState({ claudePid: CLAUDE_PID }), [SID], T0);
    const hostile: unknown[] = [
      null,
      { observations: null },
      { observations: [{ dir: SID, spawn: { kind: "ok", value: null } }] },
      { observations: [{ dir: SID, spawn: { kind: "ok", value: { kind: "session" } } }] },
      { observations: [null] },
    ];

    for (const snapshot of hostile) {
      const call = () => nextEvents(s, snapshot as Snapshot, T0);

      expect(call).not.toThrow();
      const r = call();
      expect(Array.isArray(r.events)).toBe(true);
      expect(r.events.filter((e) => e.kind === "started")).toEqual([]);
      if (r.error !== undefined) {
        expect(typeof r.error).toBe("string");
        expect(r.events).toEqual([]);
        expect(wants(r.state, T0)).toEqual(wants(s, T0));
      }
    }
  });

  test("REQ-X4: error is absent on success", () => {
    const s = admit(initialState({ claudePid: CLAUDE_PID }), [SID], T0);

    const r = nextEvents(s, { observations: [{ dir: SID, spawn: ok(sessionSpawn()) }] }, T0);

    expect(r.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// wants (REQ-WT1)
// ---------------------------------------------------------------------------------------------

describe("wants (REQ-WT1, §4.5 deadline)", () => {
  test("a tracked session carries its pid, start and reuse-check time (start + timeout + LOST_GRACE_MS)", () => {
    const s = tracked(sessionSpawn({ timeoutSeconds: 600 }));

    const w = wants(s, T0 + 1000);

    expect(w.undecided).toEqual([]);
    expect(w.tracked).toHaveLength(1);
    expect(w.tracked[0]).toMatchObject({
      dir: SID,
      kind: "session",
      mcpPid: MCP_PID,
      startedAtMs: T0,
      reuseCheckFromMs: T0 + 600_000 + LOST_GRACE_MS,
    });
  });

  test("a tracked team carries its teamPath and a reuse-check time of start + TEAM_REUSE_CHECK_AFTER_MS", () => {
    const s = tracked(teamSpawn());

    const w = wants(s, T0 + 1000);

    expect(w.tracked[0]).toMatchObject({
      dir: TID,
      kind: "team",
      mcpPid: MCP_PID,
      startedAtMs: T0,
      reuseCheckFromMs: T0 + TEAM_REUSE_CHECK_AFTER_MS,
      teamPath: TEAM_PATH,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// renderLine (REQ-F1..F8)
// ---------------------------------------------------------------------------------------------

describe("renderLine (REQ-F1..F8, §4.3)", () => {
  const examples: [string, MonitorEvent, string][] = [
    [
      "session started",
      { kind: "started", record: "session", id: SID, model: "MODEL_ID" },
      `claudish-monitor: session ${SID} started model=MODEL_ID`,
    ],
    [
      "session running",
      { kind: "running", record: "session", id: SID, model: "MODEL_ID", elapsedMs: 300_000, progress: { replies: 7, toolCalls: 14, costUsd: 0.06 } },
      `claudish-monitor: session ${SID} running model=MODEL_ID elapsed=5m00s replies=7 tools=14 cost=$0.06`,
    ],
    [
      "session needs-input, open",
      { kind: "needs-input", id: "9f8e7d6c", model: "MODEL_ID", elapsedMs: 72_000, turns: 1 },
      "claudish-monitor: session 9f8e7d6c needs-input model=MODEL_ID elapsed=1m12s turns=1 next: send_input 9f8e7d6c",
    ],
    [
      "session needs-input, closed",
      { kind: "needs-input", id: "9f8e7d6c", model: "MODEL_ID", elapsedMs: 160_000, turns: 2, waitedMs: 1000 },
      "claudish-monitor: session 9f8e7d6c needs-input model=MODEL_ID elapsed=2m40s turns=2 waited=0m01s",
    ],
    [
      "session completed",
      { kind: "ended", record: "session", id: SID, model: "MODEL_ID", state: "completed", elapsedMs: 461_000, turns: 5, toolCalls: 22, costUsd: 0.09 },
      `claudish-monitor: session ${SID} completed model=MODEL_ID elapsed=7m41s turns=5 tools=22 cost=$0.09 next: get_output ${SID}`,
    ],
    [
      "session failed, monitor verdict",
      { kind: "ended", record: "session", id: SID, model: "MODEL_ID", state: "failed", elapsedMs: 4000, reason: "no-terminal-record" },
      `claudish-monitor: session ${SID} failed model=MODEL_ID elapsed=0m04s reason=no-terminal-record next: get_diagnostics ${SID}`,
    ],
    [
      "team started",
      { kind: "started", record: "team", id: TID, slots: 4, path: TEAM_PATH },
      `claudish-monitor: team ${TID} started slots=4 path=${TEAM_PATH_REL}`,
    ],
    [
      "team running",
      { kind: "running", record: "team", id: TID, elapsedMs: 300_000, progress: { slots: 4, ok: 1, failed: 0, cancelled: 1, running: 2 }, path: TEAM_PATH },
      `claudish-monitor: team ${TID} running elapsed=5m00s slots=4 ok=1 failed=0 cancelled=1 running=2 path=${TEAM_PATH_REL}`,
    ],
    [
      "team completed",
      { kind: "ended", record: "team", id: TID, state: "completed", elapsedMs: 723_000, slots: 4, ok: 3, failed: 1, cancelled: 0, path: TEAM_PATH },
      `claudish-monitor: team ${TID} completed elapsed=12m03s slots=4 ok=3 failed=1 cancelled=0 path=${TEAM_PATH_REL} next: team-status`,
    ],
  ];

  test.each(examples)("REQ-F1: the §4.3.1 example for %s renders exactly", (_name, event, expected) => {
    const line = renderLine(event, CWD);

    expect(line).toBe(expected);
    expect(matchesGrammar(line)).toBe(true);
  });

  test("REQ-F1: session timeout and cancelled carry the right hint, or none", () => {
    const base = { kind: "ended", record: "session", id: SID, model: "M", elapsedMs: 1000 } as const;

    expect(renderLine({ ...base, state: "timeout", exitCode: 143 }, CWD)).toEndWith(`exit=143 next: get_diagnostics ${SID}`);
    expect(renderLine({ ...base, state: "cancelled" }, CWD)).not.toContain("next:");
  });

  test("REQ-F2: both notices start with the prefix and code and match the grammar", () => {
    const identity = renderLine({ kind: "notice", code: "no-session-identity" }, CWD);
    const tooOld = renderLine({ kind: "notice", code: "claudish-too-old", version: "10.3.0" }, CWD);

    expect(identity).toStartWith("claudish-monitor: notice no-session-identity: ");
    expect(identity).toMatch(NOTICE_RE);
    expect(tooOld).toStartWith("claudish-monitor: notice claudish-too-old: ");
    expect(tooOld).toMatch(NOTICE_RE);
    expect(tooOld).toContain("10.3.0");
    expect(tooOld).toContain(MIN_CLAUDISH_VERSION);
    expect(tooOld.indexOf("10.3.0")).toBeLessThan(tooOld.indexOf(MIN_CLAUDISH_VERSION));
  });

  test("REQ-F3: a hostile 2000-character model name cannot break the line, the grammar or the length cap", () => {
    const hostile = ("ab\n\r—<>&=\" " + "x".repeat(20)).repeat(80).slice(0, 2000);
    const events: MonitorEvent[] = [
      { kind: "started", record: "session", id: SID, model: hostile },
      { kind: "running", record: "session", id: SID, model: hostile, elapsedMs: 1000, progress: { replies: 1, toolCalls: 2, costUsd: 0.5 } },
      { kind: "needs-input", id: SID, model: hostile, elapsedMs: 1000, turns: 1 },
      {
        kind: "ended", record: "session", id: SID, model: hostile, state: "failed", elapsedMs: 99_999_000, turns: 999_999,
        toolCalls: 999_999, costUsd: 123456.789, reason: hostile, exitCode: 255,
      },
      { kind: "notice", code: "claudish-too-old", version: `10.3.0${hostile}` },
    ];

    for (const e of events) {
      const line = renderLine(e, CWD);
      expect(line.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
      expect(line).not.toMatch(/[\n\r"&<>]/);
      expect(line).toMatch(/^[\x20-\x7E]+$/);
      expect(matchesGrammar(line)).toBe(true);
      for (const [k, v] of fields(line)) {
        expect(v).toMatch(SAFE_VALUE_RE);
        expect(v.length).toBeLessThanOrEqual(k === "path" ? MAX_PATH_CHARS : MAX_FIELD_CHARS);
      }
    }
  });

  test("REQ-F3: each character outside the safe set becomes one underscore", () => {
    const line = renderLine({ kind: "started", record: "session", id: SID, model: 'a b<c>d&e=f"g\nh—i' }, CWD);

    expect(line).toBe(`claudish-monitor: session ${SID} started model=a_b_c_d_e_f_g_h_i`);
  });

  test("REQ-F3: a long model value is cut to MAX_FIELD_CHARS", () => {
    const line = renderLine({ kind: "started", record: "session", id: SID, model: "m".repeat(2000) }, CWD);

    expect(fieldOf(line, "model")).toBe("m".repeat(MAX_FIELD_CHARS));
  });

  test("REQ-F3: a reason containing = renders it as _", () => {
    const line = renderLine({ kind: "ended", record: "session", id: SID, state: "failed", reason: "code=42" }, CWD);

    expect(fieldOf(line, "reason")).toBe("code_42");
  });

  const teamStarted = (path: string): MonitorEvent => ({ kind: "started", record: "team", id: TID, slots: 1, path });

  test("REQ-F4: a path inside cwd is made relative; equal to cwd is '.'; a sibling sharing the prefix stays absolute", () => {
    expect(fieldOf(renderLine(teamStarted(join(CWD, "reviews", "panel")), CWD), "path")).toBe("reviews/panel");
    expect(fieldOf(renderLine(teamStarted(CWD), CWD), "path")).toBe(".");
    expect(fieldOf(renderLine(teamStarted("/work/projectile/x"), CWD), "path")).toBe("/work/projectile/x");
  });

  test("REQ-F5: a path with a space, % and < is percent-encoded with uppercase hex and decodes back losslessly", () => {
    const original = "/elsewhere/my dir/50%<x>";

    const value = fieldOf(renderLine(teamStarted(original), CWD), "path")!;

    expect(value).toBe("/elsewhere/my%20dir/50%25%3Cx%3E");
    expect(decodeURIComponent(value)).toBe(original);
  });

  test("REQ-F5: non-ASCII path bytes are percent-encoded as UTF-8", () => {
    const value = fieldOf(renderLine(teamStarted("/elsewhere/café"), CWD), "path")!;

    expect(value).toBe("/elsewhere/caf%C3%A9");
  });

  test("REQ-F6: a 300-character path renders as '...' plus its last 197 characters", () => {
    const p = `/${"a".repeat(299)}`;

    const value = fieldOf(renderLine(teamStarted(p), CWD), "path")!;

    expect(value).toBe(`...${p.slice(-197)}`);
    expect(value.length).toBeLessThanOrEqual(MAX_PATH_CHARS);
  });

  test.each([
    ["second", 195, `...${"b".repeat(195)}`],
    ["third", 196, `...${"b".repeat(196)}`],
    ["first (the cut lands on '%', so the triple is kept whole)", 194, `...%20${"b".repeat(194)}`],
  ] as [string, number, string][])(
    "REQ-F6: a cut landing on the %s character of a %%XX triple never splits the escape",
    (_where, tail, expected) => {
      const p = `/${"a".repeat(100)} ${"b".repeat(tail)}`;

      const value = fieldOf(renderLine(teamStarted(p), CWD), "path")!;

      expect(value).toBe(expected);
      expect(value.slice(3)).not.toMatch(/^[0-9A-F]{1,2}(?![0-9A-F])/);
    },
  );

  test.each([
    [0, "$0.00"],
    [0.0042, "$0.0042"],
    [0.004, "$0.004"],
    [0.01, "$0.01"],
    [0.06, "$0.06"],
    [1.5, "$1.50"],
  ] as [number, string][])("REQ-F7: cost %p renders as %p", (costUsd, expected) => {
    const line = renderLine({ kind: "running", record: "session", id: SID, model: "M", elapsedMs: 1000, progress: { costUsd } }, CWD);

    expect(fieldOf(line, "cost")).toBe(expected);
  });

  test.each([
    [4_000, "0m04s"],
    [461_000, "7m41s"],
    [3_599_000, "59m59s"],
    [3_600_000, "1h00m"],
    [3_900_000, "1h05m"],
  ] as [number, string][])("REQ-F8: elapsed %p ms renders as %p", (elapsedMs, expected) => {
    const line = renderLine({ kind: "running", record: "session", id: SID, model: "M", elapsedMs, progress: null }, CWD);

    expect(fieldOf(line, "elapsed")).toBe(expected);
  });

  test("REQ-F1: an unknown value is omitted, never printed as ? or 0", () => {
    const line = renderLine({ kind: "ended", record: "session", id: SID, state: "completed" }, CWD);

    expect(line).toBe(`claudish-monitor: session ${SID} completed next: get_output ${SID}`);
  });
});

// ---------------------------------------------------------------------------------------------
// takeBatch (REQ-K1..K5)
// ---------------------------------------------------------------------------------------------

describe("takeBatch (REQ-K1..K5, §4.4)", () => {
  const L = (id: string | null, text: string): PendingLine => ({ id, text });

  test("REQ-K1: notices come first, then lines in FIFO order", () => {
    const r = takeBatch([L("A", "a1"), L(null, "n1"), L("B", "b1")], MAX_BATCH_CHARS);

    expect(r).toEqual({ batch: ["n1", "a1", "b1"], rest: [] });
  });

  test("REQ-K2: a batch never holds two lines for one id; skipped lines stay in pending, in place", () => {
    const pending = [L("A", "A:started"), L("A", "A:completed"), L("B", "B:started")];

    const first = takeBatch(pending, MAX_BATCH_CHARS);
    const second = takeBatch(first.rest, MAX_BATCH_CHARS);

    expect(first).toEqual({ batch: ["A:started", "B:started"], rest: [L("A", "A:completed")] });
    expect(second).toEqual({ batch: ["A:completed"], rest: [] });
  });

  test("REQ-K2: several skipped lines keep their relative order", () => {
    const r = takeBatch([L("A", "a1"), L("A", "a2"), L("B", "b1"), L("A", "a3"), L("C", "c1")], MAX_BATCH_CHARS);

    expect(r).toEqual({ batch: ["a1", "b1", "c1"], rest: [L("A", "a2"), L("A", "a3")] });
  });

  test("REQ-K3: the scan stops at the first eligible line that does not fit, even if a later shorter one would", () => {
    const r = takeBatch([L("A", "a".repeat(100)), L("B", "b".repeat(100)), L("C", "c".repeat(10))], 150);

    expect(r.batch).toEqual(["a".repeat(100)]);
    expect(r.rest).toEqual([L("B", "b".repeat(100)), L("C", "c".repeat(10))]);
  });

  test("REQ-K4: a non-empty pending list always yields at least one line", () => {
    const r = takeBatch([L("A", "x".repeat(MAX_LINE_CHARS))], MAX_BATCH_CHARS);

    expect(r.batch).toHaveLength(1);
    expect(takeBatch([], MAX_BATCH_CHARS)).toEqual({ batch: [], rest: [] });
  });

  test("REQ-K5: 40 lines of 480 characters drain completely, in order, at least 6 per batch, each batch within the limit", () => {
    const lines = Array.from({ length: 40 }, (_, i) => L(`id${i}`, `${String(i).padStart(2, "0")}${"x".repeat(MAX_LINE_CHARS - 2)}`));
    let pending = lines;
    const out: string[] = [];
    const sizes: number[] = [];
    for (let guard = 0; pending.length > 0 && guard < 40; guard++) {
      const r = takeBatch(pending, MAX_BATCH_CHARS);
      expect(r.batch.join("\n").length + 1).toBeLessThanOrEqual(MAX_BATCH_CHARS);
      sizes.push(r.batch.length);
      out.push(...r.batch);
      pending = r.rest;
    }

    expect(pending).toEqual([]);
    expect(out).toEqual(lines.map((l) => l.text));
    for (const size of sizes.slice(0, -1)) expect(size).toBeGreaterThanOrEqual(6);
  });

  test("REQ-K5: takeBatch does not mutate the pending list it is given", () => {
    const pending = [L("A", "a1"), L("A", "a2"), L(null, "n1")];
    const copy = pending.map((p) => ({ ...p }));

    takeBatch(pending, MAX_BATCH_CHARS);

    expect(pending).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------------------------
// Environment and process-table helpers (REQ-E1..E3)
// ---------------------------------------------------------------------------------------------

describe("identityFrom (REQ-E1)", () => {
  test.each([
    [{ CLAUDE_PID: "1234" }, 1234],
    [{ CLAUDE_PID: "1234", CLAUDE_CODE_SESSION_ID: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" }, 1234],
    [{ CLAUDE_PID: "0" }, null],
    [{ CLAUDE_PID: "-5" }, null],
    [{ CLAUDE_PID: "12abc" }, null],
    [{ CLAUDE_PID: "1.5" }, null],
    [{ CLAUDE_PID: "" }, null],
    [{}, null],
    [{ CLAUDE_CODE_SESSION_ID: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" }, null],
  ] as [Record<string, string | undefined>, number | null][])("%p → claudePid %p", (env, expected) => {
    expect(identityFrom(env)).toEqual({ claudePid: expected });
  });
});

describe("sessionsDirFrom (REQ-E2, amendment 1)", () => {
  const home = () => "/os-home";

  test("CLAUDISH_SESSIONS_DIR wins over HOME", () => {
    expect(sessionsDirFrom({ CLAUDISH_SESSIONS_DIR: "/custom/sessions", HOME: "/h" }, home)).toBe("/custom/sessions");
  });

  test("otherwise HOME/.claudish/sessions", () => {
    expect(sessionsDirFrom({ HOME: "/h" }, home)).toBe(join("/h", ".claudish", "sessions"));
  });

  test("otherwise, with HOME unset or empty, the injected OS home directory", () => {
    expect(sessionsDirFrom({}, home)).toBe(join("/os-home", ".claudish", "sessions"));
    expect(sessionsDirFrom({ HOME: "" }, home)).toBe(join("/os-home", ".claudish", "sessions"));
  });
});

describe("parseProcessTable (REQ-E3)", () => {
  test("parses pid, ppid, etime in all three shapes and commands with spaces; skips blank and malformed lines", () => {
    const output = [
      "    1     1 2-01:02:03 /sbin/launchd",
      " 4242     1    1:02:03 /opt/claude/bin/claude --resume",
      " 4300  4242      05:03 node /usr/local/bin/claudish --mcp",
      "",
      "this line is garbage",
      "  abc   def      05:03 not-a-row",
      " 4400  4300      00:07 bun /usr/local/lib/node_modules/claudish/dist/index.js --mcp",
      "",
    ].join("\n");

    expect(parseProcessTable(output)).toEqual([
      { pid: 1, ppid: 1, ageSeconds: 2 * 86400 + 3723, command: "/sbin/launchd" },
      { pid: 4242, ppid: 1, ageSeconds: 3723, command: "/opt/claude/bin/claude --resume" },
      { pid: 4300, ppid: 4242, ageSeconds: 303, command: "node /usr/local/bin/claudish --mcp" },
      { pid: 4400, ppid: 4300, ageSeconds: 7, command: "bun /usr/local/lib/node_modules/claudish/dist/index.js --mcp" },
    ]);
  });

  test("empty output parses to no rows", () => {
    expect(parseProcessTable("")).toEqual([]);
  });
});
