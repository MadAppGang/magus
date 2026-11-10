import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sandbox, runBun, spawnBun, collect, ancestor, type Sandbox } from "../scripts/lib/process-testdata";
import { readIdentity, readRecord, ownedKey } from "../scripts/lib/record-store";
import { identity, progress, claim, taskRows, SELF, MANAGER, CHILD } from "../tests/testdata";

const spaces: Sandbox[] = [];
const space = () => { const s = sandbox(); spaces.push(s); return s; };
afterEach(() => { for (const s of spaces.splice(0)) s.cleanup(); });
const start = (s: Sandbox, id = SELF, source = "startup") => JSON.stringify({ session_id: id, hook_event_name: "SessionStart", source, cwd: s.root });
const end = (s: Sandbox, id = SELF, reason = "other") => JSON.stringify({ session_id: id, hook_event_name: "SessionEnd", reason, cwd: s.root });

describe("session-record process [R1.4–R1.5, R2.2–R2.3, R3.4; §4.5]", () => {
  test("[REQ-4, REQ-10, REQ-16] TEST-801 first claim bind uses the real ancestor and a nested inheritor gets no record or SessionEnd report", async () => {
    const s = space();
    s.installHerdr();
    Object.assign(s.env, { HERDR_ENV: "1", HERDR_PANE_ID: "pane-a", HERDR_TAB_ID: "tab-a", HERDR_WORKSPACE_ID: "workspace-a" });
    s.claim(claim({ product: s.root }));
    const a = await ancestor(s, SELF);
    try {
      const r = await a.run("hooks/session-record.ts", [], start(s), { ORCHESTRATOR_CLAIM: MANAGER, CLAUDE_PID: "1" });
      expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(readIdentity(s.ctx, MANAGER)).toMatchObject({
        key: MANAGER, sessionId: SELF, pid: a.pid, procStart: a.procStart, cwd: s.root,
        herdr: { pane: "pane-a", tab: "tab-a", workspace: "workspace-a" },
      });
      expect(ownedKey(s.ctx, SELF)).toBe(MANAGER);
      expect(readdirSync(join(s.ctx.stateDir, "progress"))).toEqual([]);
      expect(s.calls()).toContainEqual(["pane", "process-info", "--pane", "pane-a"]);
      expect(s.reports()).toHaveLength(1);
      expect(s.reports()[0]).toEqual(expect.arrayContaining(["pane-a", "--title", "--seq"]));
      const before = readFileSync(join(s.ctx.stateDir, "sessions", MANAGER + ".json"), "utf8");
      const env = { ORCHESTRATOR_CLAIM: MANAGER, ORCHESTRATOR_ROLE: "manager", CLAUDE_CODE_SESSION_ID: "nested01" };
      expect(await runBun(s, "hooks/session-record.ts", [], start(s, "nested01"), env)).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(await runBun(s, "hooks/session-record.ts", [], end(s, "nested01"), env)).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(ownedKey(s.ctx, "nested01")).toBeNull();
      expect(s.reports()).toHaveLength(1);
      expect(readFileSync(join(s.ctx.stateDir, "sessions", MANAGER + ".json"), "utf8")).toBe(before);
    } finally { await a.stop(); }
  }, 30_000);

  test("[REQ-4, REQ-10, REQ-16] TEST-802 clear follows the ancestor incarnation across ids and leaves progress and parent keys unchanged", async () => {
    const s = space();
    s.claim(claim({ product: s.root }));
    const a = await ancestor(s, SELF);
    try {
      expect((await a.run("hooks/session-record.ts", [], start(s), { ORCHESTRATOR_CLAIM: MANAGER })).code).toBe(0);
      s.progress(progress({ tasks: taskRows(), rev: 7 }));
      s.identity(identity({ key: CHILD, sessionId: "child001", role: "child", parent: MANAGER }));
      const bytes = readFileSync(join(s.ctx.stateDir, "progress", MANAGER + ".json"), "utf8");
      expect(await a.run("hooks/session-record.ts", [], start(s, "clear001", "clear"), {}, "clear001")).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(readIdentity(s.ctx, MANAGER)).toMatchObject({ key: MANAGER, sessionId: "clear001", previousIds: [SELF], pid: a.pid, procStart: a.procStart });
      expect(readIdentity(s.ctx, CHILD)?.parent).toBe(MANAGER);
      expect(ownedKey(s.ctx, SELF)).toBeNull();
      expect(ownedKey(s.ctx, "clear001")).toBe(MANAGER);
      expect(readFileSync(join(s.ctx.stateDir, "progress", MANAGER + ".json"), "utf8")).toBe(bytes);
    } finally { await a.stop(); }
  }, 30_000);

  test("[REQ-4, REQ-10, REQ-16] TEST-803 resume cannot steal a live incarnation, then rebinds its old alias after the owner exits", async () => {
    const s = space();
    s.claim(claim({ product: s.root }));
    const a = await ancestor(s, SELF);
    const b = await ancestor(s, "resume01");
    try {
      await a.run("hooks/session-record.ts", [], start(s), { ORCHESTRATOR_CLAIM: MANAGER });
      await a.run("hooks/session-record.ts", [], start(s, "clear001", "clear"), {}, "clear001");
      const before = readFileSync(join(s.ctx.stateDir, "sessions", MANAGER + ".json"), "utf8");
      expect(await b.run("hooks/session-record.ts", [], start(s, SELF, "resume"), {}, SELF)).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(readFileSync(join(s.ctx.stateDir, "sessions", MANAGER + ".json"), "utf8")).toBe(before);
      await a.stop();
      expect(await b.run("hooks/session-record.ts", [], start(s, SELF, "resume"), {}, SELF)).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(readIdentity(s.ctx, MANAGER)).toMatchObject({ sessionId: SELF, pid: b.pid, procStart: b.procStart, previousIds: [SELF, "clear001"] });
    } finally { await a.stop(); await b.stop(); }
  }, 30_000);

  test("[REQ-4, REQ-10, REQ-16] TEST-804 SessionEnd clears metadata only for the writable owner, never on clear or unknown incarnation", async () => {
    const s = space(); s.installHerdr();
    Object.assign(s.env, { HERDR_ENV: "1", HERDR_PANE_ID: "pane-a" });
    s.claim(claim({ product: s.root }));
    const a = await ancestor(s, SELF);
    try {
      await a.run("hooks/session-record.ts", [], start(s), { ORCHESTRATOR_CLAIM: MANAGER });
      const count = s.reports().length;
      const bytes = readFileSync(join(s.ctx.stateDir, "sessions", MANAGER + ".json"), "utf8");
      const competing = await ancestor(s, SELF);
      try {
        const write = await competing.run("scripts/orch-state.ts", ["block", "not owner"]);
        expect(write.code).toBe(3);
        expect(write.stdout + write.stderr).toMatch(/live process|live owner/i);
        expect(await competing.run("hooks/session-record.ts", [], end(s))).toEqual({ code: 0, stdout: "", stderr: "" });
        expect(s.reports()).toHaveLength(count);
      } finally { await competing.stop(); }
      expect(await a.run("hooks/session-record.ts", [], end(s, SELF, "clear"))).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(s.reports()).toHaveLength(count);
      expect(await runBun(s, "hooks/session-record.ts", [], end(s))).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(s.reports()).toHaveLength(count);
      expect(await a.run("hooks/session-record.ts", [], end(s))).toEqual({ code: 0, stdout: "", stderr: "" });
      const last = s.reports().at(-1)!;
      expect(last.slice(0, 4)).toEqual(["pane", "report-metadata", "pane-a", "--source"]);
      expect(last).toContain("--clear-title");
      expect(last).toContain("--clear-state-labels");
      expect(Number(last[last.indexOf("--seq") + 1])).toBeGreaterThanOrEqual(readRecord(s.ctx, MANAGER)!.updatedAt);
      expect(readFileSync(join(s.ctx.stateDir, "sessions", MANAGER + ".json"), "utf8")).toBe(bytes);
    } finally { await a.stop(); }
  }, 30_000);

  test("[REQ-4, REQ-10, REQ-16] TEST-805 forced tmux suppresses inherited herdr ids and a publish failure never fails binding", async () => {
    const s = space(); s.installHerdr();
    s.claim(claim({ product: s.root }));
    const a = await ancestor(s, SELF);
    try {
      const env = { ORCHESTRATOR_CLAIM: MANAGER, HERDR_ENV: "1", HERDR_PANE_ID: "pane-a", ORCHESTRATOR_MULTIPLEXER: "tmux" };
      expect(await a.run("hooks/session-record.ts", [], start(s), env)).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(readIdentity(s.ctx, MANAGER)?.herdr).toBeNull();
      expect(s.reports()).toEqual([]);
      expect(await a.run("hooks/session-record.ts", [], start(s), { ...env, ORCHESTRATOR_MULTIPLEXER: "herdr", QA_HERDR_EXIT: "1" })).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(readIdentity(s.ctx, MANAGER)?.herdr?.pane).toBe("pane-a");
      expect(s.reports()).toHaveLength(1);
    } finally { await a.stop(); }
  }, 30_000);
});

test("[REQ-432] TEST-807 a plain session with inherited herdr variables never probes or publishes", async () => {
  const s = space(); s.installHerdr();
  Object.assign(s.env, { HERDR_ENV: "1", HERDR_PANE_ID: "pane-a", TMUX: "host" });
  expect(await runBun(s, "hooks/session-record.ts", [], start(s, "plain001"))).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(s.calls()).toEqual([]);
  expect(readdirSync(join(s.ctx.stateDir, "sessions"))).toEqual([]);
});

describe("hook failures and deadlines [R3.4; §4.3, §4.5]", () => {
  for (const relative of ["hooks/guard.ts", "hooks/session-record.ts"]) {
    test(`[REQ-4, REQ-10, REQ-16] TEST-806 ${relative} silently allows when stdin never finishes by the watchdog`, async () => {
      const s = space();
      const started = performance.now();
      const r = await collect(spawnBun(s, relative), null, 9000);
      expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(performance.now() - started).toBeLessThan(4500);
    }, 12_000);
  }
  for (const input of ["", "{", "null", "[]", JSON.stringify({ session_id: "../outside", hook_event_name: "SessionStart" })]) {
    test(`[REQ-4, REQ-10, REQ-16] TEST-806 session-record returns zero silently for bad input ${JSON.stringify(input)}`, async () => {
      const s = space();
      expect(await runBun(s, "hooks/session-record.ts", [], input)).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(readdirSync(join(s.ctx.stateDir, "sessions"))).toEqual([]);
    });
  }
  test("[REQ-4, REQ-10, REQ-16] TEST-806 identity write failure is swallowed, not turned into a hook error or progress rewrite", async () => {
    const s = space();
    s.claim(claim());
    rmSync(join(s.ctx.stateDir, "sessions"), { recursive: true });
    writeFileSync(join(s.ctx.stateDir, "sessions"), "not a directory");
    expect(await runBun(s, "hooks/session-record.ts", [], start(s), { ORCHESTRATOR_CLAIM: MANAGER })).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(readdirSync(join(s.ctx.stateDir, "progress"))).toEqual([]);
  });
});
