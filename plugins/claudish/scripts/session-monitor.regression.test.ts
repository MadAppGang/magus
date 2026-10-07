/**
 * Regression tests for specific defects found in code review, one `describe` per defect.
 *
 * NOT the monitor's behaviour suite: that is written blind from the spec, by a writer that
 * never sees this implementation, in `session-monitor.test.ts`. Each case here pins one
 * defect that was fixed, and fails against the code before its fix.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import {
  initialState,
  nextEvents,
  readClaudishVersionFromPackage,
  sessionsDirFrom,
  startMonitor,
} from "./session-monitor.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A monitor over a scratch sessions directory, driven tick by tick on a fake clock. */
function harness(opts: { heartbeatIntervalMs?: number; monitorStartMs?: number; hostStartedAtMs?: number | null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "claudish-monitor-regression-"));
  roots.push(root);
  const sessionsDir = join(root, "sessions");
  mkdirSync(sessionsDir);
  const lines: string[] = [];
  const clock = { now: Date.now() };
  const monitor = startMonitor({
    sessionsDir,
    // This test process stands in for both Claude Code and the claudish writer: it is alive.
    identity: { claudePid: process.pid },
    write: (text) => {
      lines.push(...text.trimEnd().split("\n"));
      return true;
    },
    cwd: root,
    now: () => clock.now,
    monitorStartMs: opts.monitorStartMs ?? clock.now - 60_000,
    hostStartedAtMs: opts.hostStartedAtMs === undefined ? clock.now - 120_000 : opts.hostStartedAtMs,
    heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 60 * 60_000,
    processTable: () => null,
    readClaudishVersion: () => null,
    exit: () => {},
    log: () => {},
  });
  monitor.stop(); // no timer: every poll below is an explicit tick
  return {
    root,
    sessionsDir,
    lines,
    clock,
    /** One poll; returns the lines it wrote. */
    async tick(): Promise<string[]> {
      const before = lines.length;
      await monitor.tick();
      return lines.slice(before);
    },
  };
}

function writeSession(sessionsDir: string, id: string, extra: Record<string, unknown> = {}): string {
  const dir = join(sessionsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "spawn.json"),
    JSON.stringify({
      schema: 1,
      kind: "session",
      sessionId: id,
      hostPid: process.pid,
      mcpPid: process.pid,
      startedAt: new Date().toISOString(),
      timeoutSeconds: 600,
      model: "model-under-test",
      ...extra,
    }),
  );
  return dir;
}

describe("sessionsDirFrom: the one rule claudish shares (review B1)", () => {
  // Contract pin, not a regression: claudish's writer applies the identical rule, and a
  // drift on either side sends records where the monitor never looks.
  const home = () => join(tmpdir(), "os-account-home");
  test("CLAUDISH_SESSIONS_DIR wins when set", () => {
    expect(sessionsDirFrom({ CLAUDISH_SESSIONS_DIR: "/explicit/dir", HOME: "/sandbox-home" }, home)).toBe("/explicit/dir");
  });
  test("else $HOME, even when it differs from the OS account home", () => {
    expect(sessionsDirFrom({ HOME: "/sandbox-home" }, home)).toBe(join("/sandbox-home", ".claudish", "sessions"));
  });
  test("else the OS account home, when HOME and CLAUDISH_SESSIONS_DIR are unset or empty", () => {
    expect(sessionsDirFrom({}, home)).toBe(join(home(), ".claudish", "sessions"));
    expect(sessionsDirFrom({ HOME: "", CLAUDISH_SESSIONS_DIR: "" }, home)).toBe(join(home(), ".claudish", "sessions"));
  });
});

describe("waits.jsonl offsets come from bytes, not decoded text (review L2)", () => {
  test("a complete line holding invalid UTF-8 does not swallow the start of the next line", async () => {
    const h = harness();
    const dir = writeSession(h.sessionsDir, "utf8-offset");
    expect(await h.tick()).toEqual(["claudish-monitor: session utf8-offset started model=model-under-test"]);

    // One complete but unparsable line with two invalid bytes: decoded, each becomes U+FFFD
    // (3 bytes), so a text-derived offset overshoots by 4 bytes.
    writeFileSync(join(dir, "waits.jsonl"), Buffer.concat([Buffer.from('{"junk":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}\n')]));
    expect(await h.tick()).toEqual([]);

    appendFileSync(join(dir, "waits.jsonl"), `${JSON.stringify({ wait: "open", since: new Date().toISOString(), turns: 1 })}\n`);
    const out = await h.tick();
    expect(out).toHaveLength(1);
    expect(out[0]).toStartWith("claudish-monitor: session utf8-offset needs-input");
    expect(out[0]).toEndWith("next: send_input utf8-offset");
  });
});

describe("no send_input hint for a session already known to have ended (review B9)", () => {
  test("a wait still open when meta.json lands is not reported as answerable", async () => {
    const h = harness();
    const dir = writeSession(h.sessionsDir, "ended-open-wait");
    await h.tick();
    writeFileSync(join(dir, "waits.jsonl"), `${JSON.stringify({ wait: "open", since: new Date().toISOString(), turns: 2 })}\n`);
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ status: "completed", elapsedSeconds: 12, turnsCompleted: 2 }));
    const out = [...(await h.tick()), ...(await h.tick()), ...(await h.tick())];
    expect(out.some((line) => line.includes("send_input"))).toBe(false);
    expect(out).toContain(
      "claudish-monitor: session ended-open-wait completed model=model-under-test elapsed=0m12s turns=2 next: get_output ended-open-wait",
    );
  });

  test("an open wait whose `since` is not a timestamp is not a wait", async () => {
    const h = harness();
    const dir = writeSession(h.sessionsDir, "bad-since");
    await h.tick();
    writeFileSync(join(dir, "waits.jsonl"), `${JSON.stringify({ wait: "open", since: "not-a-time" })}\n`);
    expect(await h.tick()).toEqual([]);
  });
});

describe("no empty heartbeat in the poll that sees a long wait close (review L1)", () => {
  test("the heartbeat waits one poll, so it carries the progress numbers", async () => {
    const h = harness({ heartbeatIntervalMs: 1_000 });
    const dir = writeSession(h.sessionsDir, "wait-then-beat");
    writeFileSync(join(dir, "tokens.json"), JSON.stringify({ total_cost: 0.25, tool_calls: [{ count: 3 }] }));
    await h.tick();
    const since = new Date().toISOString();
    writeFileSync(join(dir, "waits.jsonl"), `${JSON.stringify({ wait: "open", since, turns: 1 })}\n`);
    expect((await h.tick())[0]).toContain("needs-input");

    h.clock.now += 5_000; // heartbeat long overdue, but the wait is open
    expect(await h.tick()).toEqual([]);

    appendFileSync(join(dir, "waits.jsonl"), `${JSON.stringify({ wait: "closed", since, at: new Date().toISOString(), to: "running" })}\n`);
    h.clock.now += 100;
    expect(await h.tick()).toEqual([]);

    h.clock.now += 100;
    const out = await h.tick();
    expect(out).toHaveLength(1);
    expect(out[0]).toStartWith("claudish-monitor: session wait-then-beat running");
    expect(out[0]).toContain("tools=3 cost=$0.25");
  });
});

describe("baseline adoption fails closed without the host's start time (review B8)", () => {
  test("an unfinished run from before the monitor started is not adopted when `ps` gave no host age", async () => {
    const start = Date.now();
    const h = harness({ monitorStartMs: start, hostStartedAtMs: null });
    const dir = writeSession(h.sessionsDir, "pre-existing");
    const earlier = new Date(start - 10 * 60_000);
    utimesSync(dir, earlier, earlier); // written before the monitor started; meta.json absent
    expect(await h.tick()).toEqual([]);
    expect(await h.tick()).toEqual([]);
  });
});

describe("a team heartbeat counts PENDING slots as running (review B13)", () => {
  test("slots = ok + failed + running", async () => {
    const h = harness({ heartbeatIntervalMs: 1_000 });
    const teamPath = join(h.root, "panel");
    mkdirSync(teamPath);
    writeFileSync(
      join(teamPath, "status.json"),
      JSON.stringify({ models: { "01": { state: "COMPLETED" }, "02": { state: "RUNNING" }, "03": { state: "PENDING" } } }),
    );
    const dir = join(h.sessionsDir, "team-pending");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "spawn.json"),
      JSON.stringify({
        schema: 1,
        kind: "team",
        sessionId: "team-pending",
        hostPid: process.pid,
        mcpPid: process.pid,
        startedAt: new Date().toISOString(),
        teamPath,
        slots: 3,
      }),
    );
    expect((await h.tick())[0]).toContain("team team-pending started slots=3");
    h.clock.now += 2_000;
    const out = await h.tick();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("slots=3 ok=1 failed=0 cancelled=0 running=2");
  });
});

function writeTeam(h: ReturnType<typeof harness>, id: string, models: Record<string, unknown>): void {
  const teamPath = join(h.root, `panel-${id}`);
  mkdirSync(teamPath);
  writeFileSync(join(teamPath, "status.json"), JSON.stringify({ models }));
  const dir = join(h.sessionsDir, id);
  mkdirSync(dir);
  writeFileSync(
    join(dir, "spawn.json"),
    JSON.stringify({
      schema: 1,
      kind: "team",
      sessionId: id,
      hostPid: process.pid,
      mcpPid: process.pid,
      startedAt: new Date().toISOString(),
      teamPath,
      slots: Object.keys(models).length,
    }),
  );
}

describe("a team running line counts cancelled slots, as the end line does (review iteration 2, M8)", () => {
  test("ok + failed + cancelled + running = slots", async () => {
    const h = harness({ heartbeatIntervalMs: 1_000 });
    writeTeam(h, "team-cancel1", {
      "01": { state: "COMPLETED" },
      "02": { state: "FAILED", error: { reason: "nonzero_exit" } },
      "03": { state: "FAILED", error: { reason: "cancelled" } },
      "04": { state: "RUNNING" },
    });
    await h.tick();
    h.clock.now += 2_000;
    const out = await h.tick();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("slots=4 ok=1 failed=1 cancelled=1 running=1");
  });
});

describe("a record that names a directory other than its own is not reported (review iteration 2, L12)", () => {
  test("spawn.json sessionId must equal the directory name", async () => {
    const h = harness();
    writeSession(h.sessionsDir, "dir-name", { sessionId: "other-name" });
    expect(await h.tick()).toEqual([]);
    expect(await h.tick()).toEqual([]);
  });
});

describe("without the host's age, a run begun before the monitor is never reported (review iteration 2, L1)", () => {
  test("ending after the monitor started does not admit it", async () => {
    const start = Date.now() - 1_000;
    const h = harness({ monitorStartMs: start, hostStartedAtMs: null });
    // Begun 30 minutes before this monitor, under a CLAUDE_PID that may be a reused one.
    const dir = writeSession(h.sessionsDir, "begun-before", { startedAt: new Date(start - 30 * 60_000).toISOString() });
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ status: "completed", elapsedSeconds: 1800 }));
    expect([...(await h.tick()), ...(await h.tick())]).toEqual([]);
  });

  test("a run begun after the monitor started is still reported", async () => {
    const h = harness({ monitorStartMs: Date.now() - 1_000, hostStartedAtMs: null });
    writeSession(h.sessionsDir, "begun-after");
    expect(await h.tick()).toEqual(["claudish-monitor: session begun-after started model=model-under-test"]);
  });
});

describe("waits are ordered by time, not by the text of `since` (review iteration 2, M7)", () => {
  test("a later wait written with an offset is the newest, and is reported last", async () => {
    const h = harness({ heartbeatIntervalMs: 1_000 });
    const dir = writeSession(h.sessionsDir, "offset-waits");
    await h.tick();
    const first = new Date(Date.now() + 60_000);
    const second = new Date(Date.now() + 120_000);
    const firstSince = first.toISOString(); // …Z
    // The same instant as `second`, written at UTC-5: as text it sorts BEFORE `firstSince`.
    const secondSince = new Date(second.getTime() - 5 * 3_600_000).toISOString().replace("Z", "-05:00");
    expect(secondSince < firstSince).toBe(true);
    writeFileSync(
      join(dir, "waits.jsonl"),
      [
        { wait: "open", since: firstSince, turns: 1 },
        { wait: "closed", since: firstSince, at: new Date(first.getTime() + 30_000).toISOString(), to: "running" },
        { wait: "open", since: secondSince, turns: 2 },
      ]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    );
    const out = [...(await h.tick()), ...(await h.tick())];
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("turns=1 waited=0m30s");
    expect(out[1]).toEndWith("turns=2 next: send_input offset-waits");
    // The newest wait is open, so no heartbeat, however overdue.
    h.clock.now += 10_000;
    expect([...(await h.tick()), ...(await h.tick())]).toEqual([]);
  });
});

describe("a relative script path from `ps` is not resolved (review iteration 2, L2)", () => {
  test("a claudish package reachable only through the monitor's own cwd is not read", () => {
    const root = mkdtempSync(join(tmpdir(), "claudish-monitor-relative-"));
    roots.push(root);
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin", "claudish.cjs"), "");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "claudish", version: "9.0.0" }));
    const relativeScript = relative(process.cwd(), join(root, "bin", "claudish.cjs"));
    expect(isAbsolute(relativeScript)).toBe(false);
    const row = { pid: 4242, ppid: 1, ageSeconds: 0, command: `node ${relativeScript} --mcp` };
    // `nowMs` an hour on, so the package's ctime is not what rejects it.
    expect(readClaudishVersionFromPackage(row, Date.now() + 3_600_000)).toBeNull();
    // Control: the same package by its absolute path is read.
    const absolute = { ...row, command: `node ${join(root, "bin", "claudish.cjs")} --mcp` };
    expect(readClaudishVersionFromPackage(absolute, Date.now() + 3_600_000)).toBe("9.0.0");
  });
});

describe("a restarted monitor stays silent about runs that ended before it (review iteration 2, H2)", () => {
  // The finding: a directory whose mtime moved after the monitor started (an atomic rename, a
  // late rewrite) is admitted as new, so finished runs are reported again after a restart.
  // Reproduced against the real script: its own module-evaluation cut, real `ps`, and the
  // sessions-directory rule taken from a scratch HOME and CLAUDISH_SESSIONS_DIR.
  const script = join(import.meta.dir, "session-monitor.ts");

  function record(dir: string, spawn: Record<string, unknown>, meta?: Record<string, unknown>): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spawn.json"), JSON.stringify({ schema: 1, startedAt: new Date().toISOString(), ...spawn }));
    if (meta) writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  }

  /** The writes the review names: an atomic rename and an end-of-run file, then a later touch. */
  function touchAfterStart(dir: string): void {
    writeFileSync(join(dir, "tokens.json.tmp"), JSON.stringify({ total_cost: 0.01, tool_calls: [] }));
    renameSync(join(dir, "tokens.json.tmp"), join(dir, "tokens.json"));
    writeFileSync(join(dir, "stderr.log"), "done\n");
    const later = new Date(Date.now() + 10 * 60_000);
    utimesSync(dir, later, later); // past any monitor start, however late the child evaluates
  }

  test("finished sessions and team runs of this window and of an earlier one produce no line", async () => {
    const root = mkdtempSync(join(tmpdir(), "claudish-monitor-restart-"));
    roots.push(root);
    const home = join(root, "home");
    const sessionsDir = join(root, "records");
    mkdirSync(home);
    mkdirSync(sessionsDir);
    const ours = { hostPid: process.pid, mcpPid: process.pid };
    const ended = { status: "completed", completedAt: new Date().toISOString(), elapsedSeconds: 30 };

    const finished = [
      join(sessionsDir, "finished-a"),
      join(sessionsDir, "finished-b"),
      join(sessionsDir, "team-0a1b2c3d"),
      join(sessionsDir, "earlier-window"),
    ];
    record(finished[0]!, { kind: "session", sessionId: "finished-a", timeoutSeconds: 600, model: "m", ...ours }, ended);
    record(finished[1]!, { kind: "session", sessionId: "finished-b", timeoutSeconds: 600, model: "m", ...ours }, {
      ...ended,
      status: "failed",
    });
    const teamPath = join(root, "panel");
    mkdirSync(teamPath);
    record(finished[2]!, { kind: "team", sessionId: "team-0a1b2c3d", teamPath, slots: 2, ...ours }, {
      kind: "team",
      ...ended,
      slots: 2,
      ok: 2,
      failed: 0,
      cancelled: 0,
    });
    // A Claude Code restart: the earlier window's records name the earlier process.
    record(finished[3]!, { kind: "session", sessionId: "earlier-window", timeoutSeconds: 600, hostPid: 999_999, mcpPid: process.pid }, ended);
    // Control: a run in flight across the restart, so the harness provably sees lines.
    const live = join(sessionsDir, "in-flight");
    record(live, { kind: "session", sessionId: "in-flight", timeoutSeconds: 600, model: "m", ...ours });
    for (const dir of [...finished, live]) touchAfterStart(dir);

    const child = Bun.spawn(["bun", "--env-file=/dev/null", script], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", HOME: home, CLAUDISH_SESSIONS_DIR: sessionsDir, CLAUDE_PID: String(process.pid) },
      stdout: "pipe",
      stderr: "ignore",
    });
    const lines: string[] = [];
    const reader = (async () => {
      const decoder = new TextDecoder();
      let buffered = "";
      for await (const chunk of child.stdout) {
        buffered += decoder.decode(chunk);
        const parts = buffered.split("\n");
        buffered = parts.pop() ?? "";
        lines.push(...parts.filter((l) => l !== ""));
      }
    })();
    const waitFor = async (predicate: () => boolean, ms: number): Promise<void> => {
      const until = Date.now() + ms;
      while (!predicate() && Date.now() < until) await Bun.sleep(50);
    };
    try {
      await waitFor(() => lines.some((l) => l.includes("session in-flight started")), 10_000);
      writeFileSync(join(live, "meta.json"), JSON.stringify({ status: "completed", elapsedSeconds: 5 }, null, 2));
      await waitFor(() => lines.some((l) => l.includes("session in-flight completed")), 10_000);
      await Bun.sleep(3_000); // one more poll, for any late line about the finished runs
    } finally {
      child.kill();
      await reader.catch(() => {});
    }
    expect(lines).toEqual([
      "claudish-monitor: session in-flight started model=m",
      "claudish-monitor: session in-flight completed model=m elapsed=0m05s next: get_output in-flight",
    ]);
  }, 30_000);
});

describe("the decision core reports a throw instead of swallowing it (review L4)", () => {
  test("nextEvents keeps the last state and returns an error the loop can log", () => {
    const state = initialState({ claudePid: 4242 });
    const poisoned = {
      get dir(): string {
        throw new Error("poisoned observation");
      },
    };
    const result = nextEvents(state, { observations: [poisoned] }, Date.now());
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
    expect(result.error).toContain("poisoned observation");
  });
});
