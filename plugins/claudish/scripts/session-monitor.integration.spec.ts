/**
 * Integration tests for the claudish session monitor (design §8.3): `startMonitor` over a real
 * temporary sessions directory, files written exactly as §3.3 says claudish writes them, a
 * capturing `write`, an injected clock, process table and version reader.
 *
 * Determinism: `pollIntervalMs` is set far above the test's duration so the loop runs only its
 * first tick (setTimeout 0) on its own; every later tick is driven by the test through `tick()`,
 * which the contract serialises with the loop's. `settle()` absorbs the loop's first tick.
 *
 * Written blind, from the specification and contracts only. REQ ids are listed in TEST-PLAN.md.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ADOPT_WINDOW_MS,
  LOST_GRACE_MS,
  MAX_BATCH_CHARS,
  MIN_CLAUDISH_VERSION,
  RESCAN_INTERVAL_MS,
  REUSE_CHECK_INTERVAL_MS,
  UNDECIDED_GIVE_UP_MS,
  defaultProcessTable,
  readClaudishVersionFromPackage,
  startMonitor,
  type ProcessRow,
} from "./session-monitor.ts";

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

type MonitorOpts = Parameters<typeof startMonitor>[0];
type Monitor = ReturnType<typeof startMonitor>;

interface Env {
  root: string;
  sessionsDir: string;
  cwd: string;
  writes: string[];
  logs: string[];
  exits: number[];
  clock: { now: number };
  table: { rows: ProcessRow[] | null; calls: number };
  version: { value: string | null };
  monitorStartMs: number;
  hostStartedAtMs: number | null;
}

const running: Monitor[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const m of running.splice(0)) m.stop();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A pid that belonged to a process which has exited (ESRCH). */
const DEAD_PID: number = spawnSync("true").pid;

function makeEnv(opts: { createSessionsDir?: boolean } = {}): Env {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "csm-int-")));
  roots.push(root);
  const sessionsDir = join(root, "sessions");
  if (opts.createSessionsDir !== false) mkdirSync(sessionsDir);
  const cwd = join(root, "cwd");
  mkdirSync(cwd);
  const base = Date.now();
  return {
    root,
    sessionsDir,
    cwd,
    writes: [],
    logs: [],
    exits: [],
    clock: { now: base },
    table: { rows: [], calls: 0 },
    version: { value: null },
    monitorStartMs: base - 1000,
    hostStartedAtMs: base - 3 * 3600_000,
  };
}

function start(env: Env, over: Partial<MonitorOpts> = {}): Monitor {
  const m = startMonitor({
    sessionsDir: env.sessionsDir,
    identity: { claudePid: process.pid },
    write: (text) => {
      env.writes.push(text);
      return true;
    },
    cwd: env.cwd,
    pollIntervalMs: 600_000,
    heartbeatIntervalMs: 300,
    now: () => env.clock.now,
    monitorStartMs: env.monitorStartMs,
    hostStartedAtMs: env.hostStartedAtMs,
    processTable: () => {
      env.table.calls++;
      return env.table.rows;
    },
    readClaudishVersion: () => env.version.value,
    exit: (code) => {
      env.exits.push(code);
    },
    log: (message) => {
      env.logs.push(message);
    },
    ...over,
  });
  running.push(m);
  return m;
}

/** Let the loop's own first tick (setTimeout 0) happen, so later ticks are the test's alone. */
async function settle(m: Monitor): Promise<void> {
  await m.tick();
  await Bun.sleep(20);
  await m.tick();
}

const linesOf = (writes: string[]): string[] => writes.flatMap((w) => w.split("\n").filter((l) => l.length > 0));
const lines = (env: Env): string[] => linesOf(env.writes);

async function ticks(m: Monitor, env: Env, n: number, advanceMs = 0): Promise<void> {
  for (let i = 0; i < n; i++) {
    env.clock.now += advanceMs;
    await m.tick();
  }
}

async function tickUntil(m: Monitor, env: Env, pred: (ls: string[]) => boolean, max: number, advanceMs = 0): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    if (pred(lines(env))) return true;
    env.clock.now += advanceMs;
    await m.tick();
  }
  return pred(lines(env));
}

const iso = (ms: number): string => new Date(ms).toISOString();

function sessionRec(env: Env, id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    kind: "session",
    sessionId: id,
    hostPid: process.pid,
    mcpPid: process.pid,
    startedAt: iso(env.clock.now),
    model: "test-model",
    timeoutSeconds: 600,
    claudeSessionId: "child-uuid-0001",
    ...over,
  };
}

function teamRec(env: Env, id: string, teamPath: string, slots: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    kind: "team",
    sessionId: id,
    hostPid: process.pid,
    mcpPid: process.pid,
    startedAt: iso(env.clock.now),
    teamPath,
    slots,
    ...over,
  };
}

/** As claudish does: mkdir, prompt.md (sessions), then spawn.json via tmp + rename. */
function writeSpawn(sessionsDir: string, rec: Record<string, unknown>): string {
  const dir = join(sessionsDir, String(rec.sessionId));
  mkdirSync(dir, { recursive: true });
  if (rec.kind === "session") writeFileSync(join(dir, "prompt.md"), "do the thing\n");
  writeFileSync(join(dir, "spawn.json.tmp"), JSON.stringify(rec, null, 2));
  renameSync(join(dir, "spawn.json.tmp"), join(dir, "spawn.json"));
  return dir;
}

/** A session's meta.json is a plain writeFileSync in claudish (not atomic). */
function writeSessionMeta(dir: string, over: Record<string, unknown> = {}): void {
  const meta = {
    sessionId: dir.split("/").pop(),
    model: "test-model",
    status: "completed",
    pid: 99999,
    startedAt: "2026-10-02T10:00:00.000Z",
    completedAt: "2026-10-02T10:07:41.000Z",
    exitCode: 0,
    turnsCompleted: 2,
    tokensUsed: 1234,
    toolCallCount: 3,
    idleSeconds: 0,
    costUsd: 0.02,
    terminalReason: "end_turn",
    claudeSessionId: "child-uuid-0001",
    transcriptPath: "/tmp/transcript.jsonl",
    ...over,
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

/** A team's meta.json is written atomically. */
function writeTeamMeta(dir: string, meta: Record<string, unknown>): void {
  writeFileSync(join(dir, "meta.json.tmp"), JSON.stringify({ kind: "team", ...meta }, null, 2));
  renameSync(join(dir, "meta.json.tmp"), join(dir, "meta.json"));
}

/** Set the mtime of every entry in `dir`, then of `dir` itself. */
function setTimes(dir: string, ms: number): void {
  const t = new Date(ms);
  for (const f of readdirSync(dir)) utimesSync(join(dir, f), t, t);
  utimesSync(dir, t, t);
}

function claudishChild(ppid: number): ProcessRow {
  return { pid: 77001, ppid, ageSeconds: 100, command: "node /opt/claudish/bin/claudish --mcp" };
}

const tooOld = (ls: string[]): string[] => ls.filter((l) => l.startsWith("claudish-monitor: notice claudish-too-old:"));
const startedLine = (id: string) => (l: string) => l.startsWith(`claudish-monitor: session ${id} started`) || l.startsWith(`claudish-monitor: team ${id} started`);

// §4.3 grammar.
const SAFE = "[\\x21\\x23-\\x25\\x27-\\x3B\\x3F-\\x7E]";
const KEY = "(?:model|elapsed|turns|replies|tools|cost|reason|exit|waited|slots|ok|failed|cancelled|running|path)";
const FIELD = `${KEY}=${SAFE}{1,200}`;
const ID = "[A-Za-z0-9._-]{1,64}";
const SESSION_RE = new RegExp(
  `^claudish-monitor: session (${ID}) (?:started|running|needs-input|completed|failed|timeout|cancelled)(?: ${FIELD})*(?: next: (?:get_output|get_diagnostics|send_input) \\1)?$`,
);
const TEAM_RE = new RegExp(`^claudish-monitor: team ${ID} (?:started|running|completed|failed|cancelled)(?: ${FIELD})*(?: next: team-status)?$`);
const NOTICE_RE = new RegExp(`^claudish-monitor: notice (?:claudish-too-old|no-session-identity): (?: |${SAFE}){1,400}$`);
const matchesGrammar = (l: string): boolean => SESSION_RE.test(l) || TEAM_RE.test(l) || NOTICE_RE.test(l);

const keysOf = (line: string): string[] =>
  (line.split(" next: ")[0] ?? line)
    .split(" ")
    .filter((t) => t.includes("="))
    .map((t) => t.slice(0, t.indexOf("=")));
const fieldOf = (line: string, key: string): string | undefined =>
  (line.split(" next: ")[0] ?? line)
    .split(" ")
    .find((t) => t.startsWith(`${key}=`))
    ?.slice(key.length + 1);

// ---------------------------------------------------------------------------------------------
// Baseline and history (REQ-G1..G4)
// ---------------------------------------------------------------------------------------------

describe("baseline (REQ-G1..G4, §5.2)", () => {
  test("REQ-G1: runs that ended before the monitor started produce no output, ever", async () => {
    const env = makeEnv();
    const tenMinBefore = env.monitorStartMs - 10 * 60_000;
    const s1 = writeSpawn(env.sessionsDir, sessionRec(env, "endedsess1", { startedAt: iso(tenMinBefore - 60_000) }));
    writeSessionMeta(s1);
    setTimes(s1, tenMinBefore);
    const teamPath = join(env.cwd, "old-panel");
    mkdirSync(teamPath);
    const t1 = writeSpawn(env.sessionsDir, teamRec(env, "team-0a0a0a0a", teamPath, 2, { startedAt: iso(tenMinBefore - 60_000) }));
    writeTeamMeta(t1, { status: "completed", elapsedSeconds: 30, slots: 2, ok: 2, failed: 0, cancelled: 0 });
    setTimes(t1, tenMinBefore);
    const twoHoursBefore = env.monitorStartMs - 2 * 3600_000;
    const s2 = writeSpawn(env.sessionsDir, sessionRec(env, "endedsess2", { startedAt: iso(twoHoursBefore - 60_000) }));
    writeSessionMeta(s2, { status: "failed", exitCode: 1 });
    setTimes(s2, twoHoursBefore);
    const m = start(env);

    await settle(m);
    await ticks(m, env, 10, 400);

    expect(env.writes).toEqual([]);
  });

  test("REQ-G2: a finished run whose directory changed after the start but whose meta.json is older stays silent", async () => {
    const env = makeEnv();
    const before = env.monitorStartMs - 10 * 60_000;
    const dir = writeSpawn(env.sessionsDir, sessionRec(env, "restarted1", { startedAt: iso(before - 60_000) }));
    writeSessionMeta(dir);
    setTimes(dir, before);
    writeFileSync(join(dir, "stderr.log.tmp"), "late diagnostic\n");
    renameSync(join(dir, "stderr.log.tmp"), join(dir, "stderr.log"));
    const m = start(env);

    await settle(m);
    await ticks(m, env, 10, 400);

    expect(env.writes).toEqual([]);
  });

  test("REQ-G3: a run created and finished after the start but before the first tick gives started, then its end on a later write", async () => {
    const env = makeEnv();
    const dir = writeSpawn(env.sessionsDir, sessionRec(env, "quick0001"));
    writeSessionMeta(dir, { status: "completed" });
    const m = start(env);

    await settle(m);
    const done = await tickUntil(m, env, (ls) => ls.some((l) => l.includes(" completed ")), 4);

    expect(done).toBe(true);
    const firstWrite = linesOf(env.writes.slice(0, 1));
    expect(firstWrite.some(startedLine("quick0001"))).toBe(true);
    expect(firstWrite.join("\n")).not.toContain("completed");
    const completed = lines(env).filter((l) => l.startsWith("claudish-monitor: session quick0001 completed"));
    expect(completed).toHaveLength(1);
    expect(completed[0]).toEndWith("next: get_output quick0001");
  });

  test("REQ-G4: an ENOENT sessions directory is an empty baseline; once created, a new session is reported on the next tick", async () => {
    const env = makeEnv({ createSessionsDir: false });
    const m = start(env);
    await settle(m);
    expect(env.writes).toEqual([]);

    mkdirSync(env.sessionsDir);
    writeSpawn(env.sessionsDir, sessionRec(env, "afterenoent1"));
    await m.tick();

    expect(lines(env).some(startedLine("afterenoent1"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Adoption (REQ-G5..G9)
// ---------------------------------------------------------------------------------------------

describe("adoption of a run in flight at the start (REQ-G5..G9, §5.2 step 3)", () => {
  function inFlight(env: Env, id: string, opts: { mtimeAgoMs: number; startedAt?: number; mcpPid?: number }): string {
    const startedAt = opts.startedAt ?? env.monitorStartMs - opts.mtimeAgoMs;
    const dir = writeSpawn(env.sessionsDir, sessionRec(env, id, { startedAt: iso(startedAt), mcpPid: opts.mcpPid ?? process.pid }));
    writeFileSync(join(dir, "output.log"), "");
    setTimes(dir, env.monitorStartMs - opts.mtimeAgoMs);
    return dir;
  }

  test("REQ-G5: changed before the start, own spawn record, no meta.json, live writer → started on the first tick", async () => {
    const env = makeEnv();
    inFlight(env, "adopted01", { mtimeAgoMs: 5 * 60_000 });
    const m = start(env);

    await settle(m);

    expect(lines(env).filter(startedLine("adopted01"))).toHaveLength(1);
  });

  test("REQ-G6: the same with the writer exited → nothing", async () => {
    const env = makeEnv();
    inFlight(env, "adopted02", { mtimeAgoMs: 5 * 60_000, mcpPid: DEAD_PID });
    const m = start(env);

    await settle(m);
    await ticks(m, env, 5, 400);

    expect(env.writes).toEqual([]);
  });

  test("REQ-G7: the same with a directory mtime older than ADOPT_WINDOW_MS → nothing", async () => {
    const env = makeEnv();
    inFlight(env, "adopted03", { mtimeAgoMs: ADOPT_WINDOW_MS + 60_000 });
    const m = start(env);

    await settle(m);
    await ticks(m, env, 5, 400);

    expect(env.writes).toEqual([]);
  });

  test("REQ-G8: the same with spawn.startedAt before the host process started → nothing", async () => {
    const env = makeEnv();
    inFlight(env, "adopted04", { mtimeAgoMs: 5 * 60_000, startedAt: (env.hostStartedAtMs as number) - 60_000 });
    const m = start(env);

    await settle(m);
    await ticks(m, env, 5, 400);

    expect(env.writes).toEqual([]);
  });

  test("REQ-G9: without the host's start time nothing in flight is adopted, and its later meta.json gives nothing either", async () => {
    const env = makeEnv();
    env.hostStartedAtMs = null;
    const dir = inFlight(env, "adopted05", { mtimeAgoMs: 5 * 60_000 });
    const m = start(env);

    await settle(m);
    await ticks(m, env, 3, 400);
    writeSessionMeta(dir, { status: "completed" });
    await ticks(m, env, 5, 400);

    expect(env.writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Discovery, partial records, read order (REQ-D1..D3)
// ---------------------------------------------------------------------------------------------

describe("discovery and partial records (REQ-D1..D3)", () => {
  test("REQ-D1: a spawn.json written between ticks is reported on the very next tick", async () => {
    const env = makeEnv();
    const m = start(env);
    await settle(m);

    writeSpawn(env.sessionsDir, sessionRec(env, "between01"));
    await m.tick();

    expect(lines(env)).toEqual(["claudish-monitor: session between01 started model=test-model"]);
  });

  test("REQ-D2: a truncated meta.json gives no output and no throw; once whole, the terminal line", async () => {
    const env = makeEnv();
    const m = start(env);
    await settle(m);
    const dir = writeSpawn(env.sessionsDir, sessionRec(env, "partial01"));
    await m.tick();
    const afterStart = env.writes.length;

    writeFileSync(join(dir, "meta.json"), '{"sessionId":"partial01","status":"compl');
    await ticks(m, env, 3);
    const duringPartial = env.writes.slice(afterStart);
    writeSessionMeta(dir, { status: "completed" });
    const done = await tickUntil(m, env, (ls) => ls.some((l) => l.startsWith("claudish-monitor: session partial01 completed")), 3);

    expect(duringPartial).toEqual([]);
    expect(done).toBe(true);
  });

  test("REQ-D3: spawn.json then output.log written between two ticks gives started, never a too-old notice", async () => {
    const env = makeEnv();
    const m = start(env);
    await settle(m);
    env.clock.now = env.monitorStartMs + UNDECIDED_GIVE_UP_MS + 1000;
    await m.tick();
    env.table.rows = [claudishChild(process.pid)];
    env.version.value = "10.3.0";

    const dir = writeSpawn(env.sessionsDir, sessionRec(env, "readorder1"));
    writeFileSync(join(dir, "output.log"), "first output\n");
    await ticks(m, env, 3);
    const beforeControl = lines(env);
    const old = join(env.sessionsDir, "oldformat1");
    mkdirSync(old);
    writeFileSync(join(old, "output.log"), "");
    await ticks(m, env, 3);

    expect(beforeControl.filter(startedLine("readorder1"))).toHaveLength(1);
    expect(tooOld(beforeControl)).toEqual([]);
    expect(tooOld(lines(env))).toHaveLength(1); // the same setup does produce the notice for a real old-format dir
  });

  test("REQ-D4 (R3.8): with the directory mtime unchanged, a new entry is listed only once RESCAN_INTERVAL_MS has passed", async () => {
    const env = makeEnv();
    const fixedMtime = new Date(Math.floor((env.monitorStartMs - 5000) / 1000) * 1000);
    utimesSync(env.sessionsDir, fixedMtime, fixedMtime);
    const m = start(env);
    await settle(m);

    writeSpawn(env.sessionsDir, sessionRec(env, "rescan0001"));
    utimesSync(env.sessionsDir, fixedMtime, fixedMtime);
    await ticks(m, env, 3, 1000);
    const beforeRescan = lines(env);
    env.clock.now += RESCAN_INTERVAL_MS;
    await m.tick();

    expect(beforeRescan).toEqual([]);
    expect(lines(env).filter(startedLine("rescan0001"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Waits and lost writers (REQ-J1..J3)
// ---------------------------------------------------------------------------------------------

describe("waits and lost writers (REQ-J1..J3)", () => {
  test("REQ-J1: an open and a closed line appended between two ticks give one needs-input line with waited and no hint", async () => {
    const env = makeEnv();
    const m = start(env);
    await settle(m);
    const S = env.clock.now;
    const dir = writeSpawn(env.sessionsDir, sessionRec(env, "shortwait1", { startedAt: iso(S) }));
    await m.tick();
    const before = lines(env).length;

    appendFileSync(join(dir, "waits.jsonl"), `${JSON.stringify({ wait: "open", since: iso(S + 72_000), turns: 1 })}\n`);
    appendFileSync(
      join(dir, "waits.jsonl"),
      `${JSON.stringify({ wait: "closed", since: iso(S + 72_000), at: iso(S + 73_000), to: "running" })}\n`,
    );
    await m.tick();

    expect(lines(env).slice(before)).toEqual([
      "claudish-monitor: session shortwait1 needs-input model=test-model elapsed=1m12s turns=1 waited=0m01s",
    ]);
  });

  test("REQ-J2: a writer that exited without meta.json is reported failed reason=no-terminal-record", async () => {
    const env = makeEnv();
    const m = start(env);
    await settle(m);

    writeSpawn(env.sessionsDir, sessionRec(env, "lostwriter1", { mcpPid: DEAD_PID }));
    const done = await tickUntil(m, env, (ls) => ls.some((l) => l.startsWith("claudish-monitor: session lostwriter1 failed")), 4);

    expect(done).toBe(true);
    const failed = lines(env).find((l) => l.startsWith("claudish-monitor: session lostwriter1 failed"))!;
    expect(fieldOf(failed, "reason")).toBe("no-terminal-record");
    expect(failed).toEndWith("next: get_diagnostics lostwriter1");
    expect(lines(env).findIndex(startedLine("lostwriter1"))).toBeLessThan(lines(env).indexOf(failed));
  });

  test("REQ-J3: past the reuse point, a live mcpPid younger than the session is a reused pid → failed reason=no-terminal-record", async () => {
    const env = makeEnv();
    const S = env.clock.now;
    const procStartMs = S + 60_000;
    const m = start(env, {
      processTable: () => {
        env.table.calls++;
        return [{ pid: process.pid, ppid: process.ppid, ageSeconds: Math.max(0, Math.floor((env.clock.now - procStartMs) / 1000)), command: "bun test" }];
      },
    });
    await settle(m);
    writeSpawn(env.sessionsDir, sessionRec(env, "reused0001", { startedAt: iso(S), timeoutSeconds: 60 }));
    await m.tick();

    env.clock.now = S + 60_000 + LOST_GRACE_MS + 1000;
    const done = await tickUntil(m, env, (ls) => ls.some((l) => l.startsWith("claudish-monitor: session reused0001 failed")), 3);

    expect(done).toBe(true);
    const failed = lines(env).find((l) => l.startsWith("claudish-monitor: session reused0001 failed"))!;
    expect(fieldOf(failed, "reason")).toBe("no-terminal-record");
  });

  test("REQ-J3: an mcpPid older than the session is the real writer → no verdict; the table is read at most once per REUSE_CHECK_INTERVAL_MS", async () => {
    const env = makeEnv();
    const S = env.clock.now;
    const m = start(env, {
      processTable: () => {
        env.table.calls++;
        return [{ pid: process.pid, ppid: process.ppid, ageSeconds: Math.floor((env.clock.now - (S - 3600_000)) / 1000), command: "bun test" }];
      },
    });
    await settle(m);
    writeSpawn(env.sessionsDir, sessionRec(env, "realwriter", { startedAt: iso(S), timeoutSeconds: 60 }));
    await m.tick();
    env.clock.now = S + 60_000 + LOST_GRACE_MS + 1000;
    await m.tick();
    await m.tick();

    env.table.calls = 0;
    await ticks(m, env, 5, 1000);
    const callsWithinOneInterval = env.table.calls;
    env.clock.now += REUSE_CHECK_INTERVAL_MS;
    await ticks(m, env, 3, 1000);

    expect(callsWithinOneInterval).toBeLessThanOrEqual(1);
    expect(lines(env).filter((l) => l.startsWith("claudish-monitor: session realwriter failed"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Heartbeat progress from events.jsonl and tokens.json (REQ-Q1)
// ---------------------------------------------------------------------------------------------

describe("session heartbeat progress (REQ-Q1, LOW 7)", () => {
  test("replies counts distinct message ids of complete assistant lines; tools and cost follow tokens.json even when events stop", async () => {
    const env = makeEnv();
    const m = start(env);
    await settle(m);
    const dir = writeSpawn(env.sessionsDir, sessionRec(env, "progress01"));
    await m.tick();

    const assistant = (id: string) => JSON.stringify({ type: "assistant", message: { id, role: "assistant", content: [] } });
    writeFileSync(
      join(dir, "events.jsonl"),
      `${assistant("msg_1")}\n${assistant("msg_1")}\n${JSON.stringify({ type: "user", message: { role: "user", content: [] } })}\n${assistant("msg_2")}\n{"type":"assistant","message":{"id":"msg_3"`,
    );
    writeFileSync(join(dir, "tokens.json"), JSON.stringify({ total_cost: 0.0123, tool_calls: [{ name: "Read", count: 3 }, { name: "Bash", count: 4 }] }));
    const n1 = lines(env).length;
    await ticks(m, env, 1, 400);
    const hb1 = lines(env).slice(n1).find((l) => l.startsWith("claudish-monitor: session progress01 running"));

    writeFileSync(join(dir, "tokens.json"), JSON.stringify({ total_cost: 0.5, tool_calls: [{ name: "Read", count: 3 }, { name: "Bash", count: 9 }] }));
    const n2 = lines(env).length;
    await ticks(m, env, 1, 400);
    const hb2 = lines(env).slice(n2).find((l) => l.startsWith("claudish-monitor: session progress01 running"));

    expect(hb1).toBeDefined();
    expect(keysOf(hb1!)).toEqual(["model", "elapsed", "replies", "tools", "cost"]);
    expect([fieldOf(hb1!, "replies"), fieldOf(hb1!, "tools"), fieldOf(hb1!, "cost")]).toEqual(["2", "7", "$0.01"]);
    expect(hb2).toBeDefined();
    expect([fieldOf(hb2!, "replies"), fieldOf(hb2!, "tools"), fieldOf(hb2!, "cost")]).toEqual(["2", "12", "$0.50"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Team runs (REQ-TM1..TM2)
// ---------------------------------------------------------------------------------------------

describe("team runs (REQ-TM1..TM2)", () => {
  test("REQ-TM1: started, heartbeat counts from status.json, a malformed status.json, then completed with the team-status hint", async () => {
    const env = makeEnv();
    const teamPath = join(env.cwd, "reviews", "panel");
    mkdirSync(teamPath, { recursive: true });
    writeFileSync(
      join(teamPath, "status.json"),
      JSON.stringify({
        models: {
          "model-a": { state: "COMPLETED" },
          "model-b": { state: "RUNNING" },
          "model-c": { state: "FAILED", error: { reason: "cancelled" } },
        },
      }),
    );
    const m = start(env);
    await settle(m);
    const dir = writeSpawn(env.sessionsDir, teamRec(env, "team-0a1b2c3d", teamPath, 3));
    await m.tick();
    const startedLines = lines(env);

    const n1 = lines(env).length;
    await ticks(m, env, 1, 400);
    const hb = lines(env).slice(n1).find((l) => l.startsWith("claudish-monitor: team team-0a1b2c3d running"));
    writeFileSync(join(teamPath, "status.json"), '{"models":{"model-a":{"sta');
    const n2 = lines(env).length;
    await ticks(m, env, 1, 400);
    const hbMalformed = lines(env).slice(n2).find((l) => l.startsWith("claudish-monitor: team team-0a1b2c3d running"));
    writeTeamMeta(dir, { status: "completed", elapsedSeconds: 723, slots: 3, ok: 2, failed: 1, cancelled: 0 });
    const done = await tickUntil(m, env, (ls) => ls.some((l) => l.startsWith("claudish-monitor: team team-0a1b2c3d completed")), 3);

    expect(startedLines).toEqual(["claudish-monitor: team team-0a1b2c3d started slots=3 path=reviews/panel"]);
    expect(hb).toBeDefined();
    expect(keysOf(hb!)).toEqual(["elapsed", "slots", "ok", "failed", "cancelled", "running", "path"]);
    expect(["slots", "ok", "failed", "cancelled", "running", "path"].map((k) => fieldOf(hb!, k))).toEqual([
      "3",
      "1",
      "0",
      "1",
      "1",
      "reviews/panel",
    ]);
    expect(hbMalformed).toBeDefined();
    expect(keysOf(hbMalformed!)).not.toContain("ok");
    expect(keysOf(hbMalformed!)).not.toContain("failed");
    expect(keysOf(hbMalformed!)).not.toContain("cancelled");
    expect(keysOf(hbMalformed!)).not.toContain("running");
    expect(fieldOf(hbMalformed!, "path")).toBe("reviews/panel");
    expect(done).toBe(true);
    expect(lines(env).filter((l) => l.startsWith("claudish-monitor: team team-0a1b2c3d completed"))).toEqual([
      "claudish-monitor: team team-0a1b2c3d completed elapsed=12m03s slots=3 ok=2 failed=1 cancelled=0 path=reviews/panel next: team-status",
    ]);
  });

  test("REQ-TM2: a team run settled before the first tick gives started on the first write, completed on the next, then nothing", async () => {
    const env = makeEnv();
    const teamPath = join(env.cwd, "probe");
    mkdirSync(teamPath);
    const dir = writeSpawn(env.sessionsDir, teamRec(env, "team-1b2c3d4e", teamPath, 1));
    writeTeamMeta(dir, { status: "completed", elapsedSeconds: 1, slots: 1, ok: 1, failed: 0, cancelled: 0 });
    const m = start(env);

    await settle(m);
    await tickUntil(m, env, (ls) => ls.some((l) => l.includes("team-1b2c3d4e completed")), 3);
    const writesAtEnd = env.writes.length;
    await ticks(m, env, 10, 200);

    expect(env.writes.length).toBeGreaterThanOrEqual(2);
    expect(linesOf(env.writes.slice(0, 1))).toEqual(["claudish-monitor: team team-1b2c3d4e started slots=1 path=probe"]);
    expect(linesOf(env.writes.slice(1, 2))).toEqual([
      "claudish-monitor: team team-1b2c3d4e completed elapsed=0m01s slots=1 ok=1 failed=0 cancelled=0 path=probe next: team-status",
    ]);
    expect(env.writes.length).toBe(writesAtEnd);
  });
});

// ---------------------------------------------------------------------------------------------
// Too-old notice through the loop (REQ-O1..O4)
// ---------------------------------------------------------------------------------------------

describe("too-old notice through the loop (REQ-O1..O4)", () => {
  async function oldFormatRun(version: string | null): Promise<string[]> {
    const env = makeEnv();
    env.table.rows = [claudishChild(process.pid)];
    env.version.value = version;
    const m = start(env);
    await settle(m);
    for (const name of ["oldformat1", "oldformat2"]) {
      mkdirSync(join(env.sessionsDir, name));
      writeFileSync(join(env.sessionsDir, name, "output.log"), "");
      await ticks(m, env, 3);
    }
    return lines(env);
  }

  test("REQ-O1: an old-format directory with an old claudish child gives exactly one notice naming the version read", async () => {
    const out = await oldFormatRun("10.3.0");

    expect(tooOld(out)).toHaveLength(1);
    expect(tooOld(out)[0]).toContain("10.3.0");
    expect(tooOld(out)[0]).toContain(MIN_CLAUDISH_VERSION);
  });

  test("REQ-O2: a child at MIN_CLAUDISH_VERSION, or one whose version cannot be read, gives no notice", async () => {
    expect(tooOld(await oldFormatRun(MIN_CLAUDISH_VERSION))).toEqual([]);
    expect(tooOld(await oldFormatRun(null))).toEqual([]);
  });

  test("REQ-O3: with no sessions directory at all, the startup check gives the notice within the first two ticks", async () => {
    const env = makeEnv({ createSessionsDir: false });
    env.table.rows = [claudishChild(process.pid)];
    env.version.value = "10.3.0";
    const m = start(env);

    await m.tick();
    if (tooOld(lines(env)).length === 0) await m.tick();

    expect(tooOld(lines(env))).toHaveLength(1);
    expect(tooOld(lines(env))[0]).toContain("10.3.0");
  });

  test("REQ-O3: a claudish child that appears after three ticks gets the notice on the tick it appears", async () => {
    const env = makeEnv({ createSessionsDir: false });
    env.version.value = "10.3.0";
    const m = start(env);
    await settle(m);
    await ticks(m, env, 3);
    const before = tooOld(lines(env));

    env.table.rows = [claudishChild(process.pid)];
    await m.tick();

    expect(before).toEqual([]);
    expect(tooOld(lines(env))).toHaveLength(1);
  });

  test("REQ-O4: past UNDECIDED_GIVE_UP_MS the startup check stops reading the process table", async () => {
    const env = makeEnv({ createSessionsDir: false });
    const m = start(env);
    await settle(m);
    env.clock.now = env.monitorStartMs + UNDECIDED_GIVE_UP_MS + 1000;
    await ticks(m, env, 2);

    env.table.calls = 0;
    await ticks(m, env, 3, 2500);

    expect(env.table.calls).toBe(0);
  });

  test("REQ-O4: with no process table, own records are still reported and an old-format directory gives no notice", async () => {
    const env = makeEnv();
    env.table.rows = null;
    env.version.value = "10.3.0";
    const m = start(env);
    await settle(m);

    writeSpawn(env.sessionsDir, sessionRec(env, "notable001"));
    mkdirSync(join(env.sessionsDir, "oldformat9"));
    writeFileSync(join(env.sessionsDir, "oldformat9", "output.log"), "");
    await ticks(m, env, 4);

    expect(lines(env).filter(startedLine("notable001"))).toHaveLength(1);
    expect(tooOld(lines(env))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The default version reader (REQ-O5, §5.3 authoritative per amendment 4)
// ---------------------------------------------------------------------------------------------

describe("readClaudishVersionFromPackage (REQ-O5)", () => {
  function pkg(name = "claudish"): { root: string; row: (ageSeconds: number) => ProcessRow } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "csm-pkg-")));
    roots.push(root);
    mkdirSync(join(root, "pkg", "bin"), { recursive: true });
    writeFileSync(join(root, "pkg", "bin", "claudish.cjs"), "#!/usr/bin/env node\n");
    writeFileSync(join(root, "pkg", "package.json"), JSON.stringify({ name, version: "10.3.0" }));
    mkdirSync(join(root, "bin"));
    symlinkSync(join(root, "pkg", "bin", "claudish.cjs"), join(root, "bin", "claudish"));
    return { root, row: (ageSeconds) => ({ pid: 1, ppid: 1, ageSeconds, command: `node ${join(root, "bin", "claudish")} --mcp` }) };
  }

  test("a server started when the package was written reads its version through the npm symlink", () => {
    const { row } = pkg();

    expect(readClaudishVersionFromPackage(row(0), Date.now())).toBe("10.3.0");
  });

  test("a server that started 60 s before its package.json was written reads no version (the package was replaced)", () => {
    const { row } = pkg();

    expect(readClaudishVersionFromPackage(row(60), Date.now())).toBeNull();
  });

  test("a server that started after the package was written reads the version (nowMs moves the start)", () => {
    const { row } = pkg();

    expect(readClaudishVersionFromPackage(row(60), Date.now() + 120_000)).toBe("10.3.0");
  });

  test("a package.json with another name reads no version", () => {
    const { row } = pkg("not-claudish");

    expect(readClaudishVersionFromPackage(row(0), Date.now())).toBeNull();
  });

  test("a relative script path or a standalone binary reads no version", () => {
    expect(readClaudishVersionFromPackage({ pid: 1, ppid: 1, ageSeconds: 0, command: "node bin/claudish --mcp" }, Date.now())).toBeNull();
    expect(readClaudishVersionFromPackage({ pid: 1, ppid: 1, ageSeconds: 0, command: "/opt/claudish --mcp" }, Date.now())).toBeNull();
  });

  test("a package.json two levels above the script's directory is not consulted", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "csm-pkg-")));
    roots.push(root);
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });
    writeFileSync(join(root, "a", "package.json"), JSON.stringify({ name: "claudish", version: "10.3.0" }));
    writeFileSync(join(root, "a", "b", "c", "claudish.cjs"), "");

    const row: ProcessRow = { pid: 1, ppid: 1, ageSeconds: 0, command: `node ${join(root, "a", "b", "c", "claudish.cjs")} --mcp` };

    expect(readClaudishVersionFromPackage(row, Date.now())).toBeNull();
  });
});

describe("defaultProcessTable (REQ-O6, INFERRED return shape)", () => {
  test("lists this test process with its parent", () => {
    const rows = defaultProcessTable();

    expect(rows).not.toBeNull();
    const me = rows!.find((r) => r.pid === process.pid);
    expect(me).toBeDefined();
    expect(me!.ppid).toBe(process.ppid);
    expect(me!.ageSeconds).toBeGreaterThanOrEqual(0);
    expect(me!.command.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Resilience and output discipline (REQ-Z1..Z5)
// ---------------------------------------------------------------------------------------------

describe("resilience and output discipline (REQ-Z1..Z5)", () => {
  test("REQ-Z1: an unreadable directory, a spawn.json that is a directory and 5 MB of garbage never throw, and later polls still work", async () => {
    const env = makeEnv();
    const m = start(env);
    await settle(m);
    const locked = writeSpawn(env.sessionsDir, sessionRec(env, "locked0001"));
    chmodSync(locked, 0o000);
    mkdirSync(join(env.sessionsDir, "dirspawn01", "spawn.json"), { recursive: true });
    const garbageDir = writeSpawn(env.sessionsDir, sessionRec(env, "garbage001"));
    try {
      await m.tick();
      const garbage = Buffer.alloc(5 * 1024 * 1024);
      for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 7919) & 0xff;
      writeFileSync(join(garbageDir, "events.jsonl"), garbage);
      writeFileSync(join(garbageDir, "tokens.json"), "{{{{");
      writeFileSync(join(garbageDir, "waits.jsonl"), garbage.subarray(0, 4096));

      await ticks(m, env, 4, 400);
      writeSpawn(env.sessionsDir, sessionRec(env, "healthy001"));
      writeSessionMeta(garbageDir, { status: "completed" });
      await ticks(m, env, 3);
      const out = lines(env);

      expect(out.filter(startedLine("healthy001"))).toHaveLength(1);
      expect(out.some((l) => l.startsWith("claudish-monitor: session garbage001 completed"))).toBe(true);
      expect(out.join("\n")).not.toContain("locked0001");
      expect(out.join("\n")).not.toContain("dirspawn01");
      expect(out.filter((l) => !matchesGrammar(l))).toEqual([]);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test("REQ-Z2: 25 sessions started in one tick give 25 started lines; each write ≤ MAX_BATCH_CHARS, one write per tick, no id twice in a write", async () => {
    const env = makeEnv();
    const m = start(env);
    await settle(m);
    const ids = Array.from({ length: 25 }, (_, i) => `burst${String(i).padStart(3, "0")}`);
    for (const id of ids) writeSpawn(env.sessionsDir, sessionRec(env, id, { model: "m".repeat(80) }));

    const perTick: number[] = [];
    for (let i = 0; i < 10; i++) {
      const before = env.writes.length;
      await m.tick();
      perTick.push(env.writes.length - before);
    }

    const started = lines(env).filter((l) => / started /.test(l));
    expect(started.map((l) => l.split(" ")[2]).sort()).toEqual([...ids].sort());
    expect(env.writes.length).toBeGreaterThanOrEqual(2);
    for (const w of env.writes) {
      expect(w.length).toBeLessThanOrEqual(MAX_BATCH_CHARS);
      expect(w.endsWith("\n")).toBe(true);
      const idsInWrite = linesOf([w]).map((l) => l.split(" ")[2]);
      expect(new Set(idsInWrite).size).toBe(idsInWrite.length);
    }
    for (const n of perTick) expect(n).toBeLessThanOrEqual(1);
  });

  test("REQ-Z3: idle ticks call write zero times", async () => {
    const env = makeEnv();
    const m = start(env);
    await settle(m);

    await ticks(m, env, 5, 2500);

    expect(env.writes).toEqual([]);
  });

  test("REQ-Z4: without CLAUDE_PID the loop writes one no-session-identity notice, reports nothing else, and exits 0 once", async () => {
    const env = makeEnv();
    writeSpawn(env.sessionsDir, sessionRec(env, "noident001"));
    const m = start(env, { identity: { claudePid: null } });

    await settle(m);
    await ticks(m, env, 2);

    expect(lines(env)).toHaveLength(1);
    expect(lines(env)[0]).toStartWith("claudish-monitor: notice no-session-identity: ");
    expect(env.exits).toEqual([0]);
  });

  test("REQ-Z5: a CLAUDE_PID that is not a live process stops the loop with exit 0 on its first tick, writing nothing", async () => {
    const env = makeEnv();
    writeSpawn(env.sessionsDir, sessionRec(env, "orphan0001", { hostPid: DEAD_PID }));
    const m = start(env, { identity: { claudePid: DEAD_PID } });

    await settle(m);

    expect(env.exits).toEqual([0]);
    expect(env.writes).toEqual([]);
  });

  test("REQ-Z5: write returning false (the pipe is gone) makes the loop exit 0", async () => {
    const env = makeEnv();
    const m = start(env, {
      write: (text) => {
        env.writes.push(text);
        return false;
      },
    });
    await settle(m);

    writeSpawn(env.sessionsDir, sessionRec(env, "epipe00001"));
    await ticks(m, env, 2);

    expect(env.writes.length).toBeGreaterThanOrEqual(1);
    expect(env.exits).toEqual([0]);
  });

  test("REQ-Z6: a write that throws something other than EPIPE is not retried and does not stop the loop", async () => {
    const env = makeEnv();
    const attempts: string[] = [];
    let failNext = false;
    const m = start(env, {
      write: (text) => {
        attempts.push(text);
        if (failNext) {
          failNext = false;
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        }
        env.writes.push(text);
        return true;
      },
    });
    await settle(m);

    failNext = true;
    const dir = writeSpawn(env.sessionsDir, sessionRec(env, "lostbatch1"));
    await m.tick();
    await ticks(m, env, 2);
    writeSessionMeta(dir, { status: "completed" });
    await tickUntil(m, env, (ls) => ls.some((l) => l.startsWith("claudish-monitor: session lostbatch1 completed")), 3);

    expect(attempts.filter((a) => a.includes("lostbatch1 started"))).toHaveLength(1);
    expect(lines(env).filter(startedLine("lostbatch1"))).toEqual([]);
    expect(lines(env).some((l) => l.startsWith("claudish-monitor: session lostbatch1 completed"))).toBe(true);
    expect(env.exits).toEqual([]);
  });
});
