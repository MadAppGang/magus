import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, existsSync, utimesSync, rmSync, openSync, closeSync, fstatSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  readRecord, readIdentity, readProgress, ownedKey, aliasKey, writableKey, readClaim,
  bindSession, updateProgress, writeClaim, fillTicket, prune, ownPid, identityLive,
  claudeConfigDirOf, type BindInput,
} from "./record-store";
import { parseRecord, renderTasksTable } from "./state-core";
import { sandbox, actualStart, ancestor, runBun, spawnEval, collect, script, type Sandbox } from "./process-testdata";
import { identity, progress, claim, NOW, START, LATER_START, MANAGER, CHILD, SELF, PRODUCT, taskRows } from "../../tests/testdata";

const spaces: Sandbox[] = [];
function space() { const s = sandbox(); spaces.push(s); return s; }
afterEach(() => { for (const s of spaces.splice(0)) s.cleanup(); });
const input = (s: Sandbox, patch: Partial<BindInput> = {}): BindInput => ({
  sessionId: SELF, claimId: null, cwd: s.root, herdr: null,
  now: NOW, self: null, allowClear: false, ...patch,
});
const ownIdentity = (s: Sandbox) => {
  const i = identity({ pid: process.pid, procStart: actualStart(process.pid), product: s.root, cwd: s.root });
  s.identity(i); s.alias(SELF, MANAGER);
  return i;
};
const idPath = (s: Sandbox, key = MANAGER) => join(s.ctx.stateDir, "sessions", key + ".json");
const progPath = (s: Sandbox, key = MANAGER) => join(s.ctx.stateDir, "progress", key + ".json");

describe("store ownership and bind routes [R1.4, R3.4; record-store contract]", () => {
  test("[REQ-4, REQ-8, REQ-16] TEST-601 index aliases locate records but never grant ownership", async () => {
    const s = space();
    s.identity(identity({ sessionId: "current1", pid: null, procStart: null }));
    s.alias(SELF, MANAGER);
    expect(aliasKey(s.ctx, SELF)).toBe(MANAGER);
    expect(ownedKey(s.ctx, SELF)).toBeNull();
    expect(writableKey(s.ctx, SELF, null)).toEqual({ ok: false, reason: "not-owned" });
    expect(readRecord(s.ctx, MANAGER)?.sessionId).toBe("current1");
    const r = await runBun(s, "scripts/orch-state.ts", ["block", "choose"], "", { CLAUDE_CODE_SESSION_ID: SELF });
    expect(r.code).toBe(3);
    expect(r.stdout + r.stderr).toMatch(/register|role skill/i);
    expect(existsSync(progPath(s))).toBe(false);
    expect(readRecord(s.ctx, "s-missing1")).toBeNull();
    expect(claudeConfigDirOf({ CLAUDE_CONFIG_DIR: s.ctx.claudeConfigDir }, s.root)).toBe(s.ctx.claudeConfigDir);
    expect(claudeConfigDirOf({}, s.root)).toBe(join(s.root, ".claude"));
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-602 fresh claim binding is exclusive and leaves the claim file unchanged", async () => {
    const s = space();
    const c = claim({ product: s.root });
    writeClaim(s.ctx, c);
    const original = readFileSync(join(s.ctx.stateDir, "claims", c.key + ".json"), "utf8");
    expect(() => writeClaim(s.ctx, { ...c, name: "overwrite" })).toThrow();
    const code = [
      'const {bindSession}=await import(process.env.QA_MODULE);',
      'const r=bindSession(JSON.parse(process.env.QA_CTX),JSON.parse(process.env.QA_INPUT));',
      'console.log(JSON.stringify(r));',
    ].join("\n");
    const a = spawnEval(s, code, { QA_MODULE: script("scripts/lib/record-store.ts"), QA_CTX: JSON.stringify(s.ctx), QA_INPUT: JSON.stringify(input(s, { claimId: c.key, sessionId: "racer001" })) });
    const b = spawnEval(s, code, { QA_MODULE: script("scripts/lib/record-store.ts"), QA_CTX: JSON.stringify(s.ctx), QA_INPUT: JSON.stringify(input(s, { claimId: c.key, sessionId: "racer002" })) });
    const results = await Promise.all([collect(a, ""), collect(b, "")]);
    expect(results.map(r => r.code)).toEqual([0, 0]);
    const answers = results.map(r => JSON.parse(r.stdout));
    expect(answers.filter(r => r.ok)).toHaveLength(1);
    expect(answers.filter(r => !r.ok)).toHaveLength(1);
    const winner = readIdentity(s.ctx, c.key)!;
    expect(["racer001", "racer002"]).toContain(winner.sessionId);
    expect(ownedKey(s.ctx, winner.sessionId)).toBe(c.key);
    expect(ownedKey(s.ctx, winner.sessionId === "racer001" ? "racer002" : "racer001")).toBeNull();
    expect(readFileSync(join(s.ctx.stateDir, "claims", c.key + ".json"), "utf8")).toBe(original);
    expect(readClaim(s.ctx, c.key)).toEqual(c);
    expect(existsSync(progPath(s))).toBe(false);
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-603 owned then resume take precedence over a new claim; live holders cannot be stolen", () => {
    const s = space();
    const old = ownIdentity(s);
    s.claim(claim({ key: CHILD, role: "child" }));
    const self = { pid: process.pid, procStart: old.procStart };
    const owned = bindSession(s.ctx, input(s, { claimId: CHILD, self }));
    expect(owned).toMatchObject({ ok: true, key: MANAGER, route: "owned" });
    expect(existsSync(idPath(s, CHILD))).toBe(false);
    s.alias("resume01", MANAGER);
    const before = readFileSync(idPath(s), "utf8");
    const refused = bindSession(s.ctx, input(s, { sessionId: "resume01", claimId: CHILD, self: null }));
    expect(refused).toEqual({ ok: false, reason: "live-owner", key: MANAGER, sessionId: SELF, pid: process.pid });
    expect(readFileSync(idPath(s), "utf8")).toBe(before);
    expect(existsSync(idPath(s, CHILD))).toBe(false);
    const resumed = bindSession(s.ctx, input(s, { sessionId: "resume01", self }));
    expect(resumed).toMatchObject({ ok: true, route: "resume", key: MANAGER, identity: { previousIds: [SELF], sessionId: "resume01" } });
    expect(ownedKey(s.ctx, SELF)).toBeNull();
    expect(ownedKey(s.ctx, "resume01")).toBe(MANAGER);
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-604 clear rebinds only the same recorded incarnation and preserves child links and progress bytes", () => {
    const s = space();
    const i = ownIdentity(s);
    s.identity(identity({ key: CHILD, role: "child", sessionId: "child001", parent: MANAGER }));
    s.progress(progress({ tasks: taskRows(), rev: 3, updatedAt: NOW - 10 }));
    const bytes = readFileSync(progPath(s), "utf8");
    const noClear = bindSession(s.ctx, input(s, { sessionId: "clear001", self: { pid: process.pid, procStart: i.procStart } }));
    expect(noClear).toEqual({ ok: false, reason: "unbound" });
    const rotated = bindSession(s.ctx, input(s, { sessionId: "clear001", allowClear: true, self: { pid: process.pid, procStart: i.procStart } }));
    expect(rotated).toMatchObject({ ok: true, key: MANAGER, route: "clear", identity: { sessionId: "clear001", previousIds: [SELF] } });
    expect(readIdentity(s.ctx, CHILD)?.parent).toBe(MANAGER);
    expect(readFileSync(progPath(s), "utf8")).toBe(bytes);
    const noMatch = bindSession(s.ctx, input(s, { sessionId: "clear002", allowClear: true, self: { pid: process.pid, procStart: LATER_START } }));
    expect(noMatch).toEqual({ ok: false, reason: "unbound" });
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-605 writable ownership distinguishes unknown incarnation from a known competing process", () => {
    const s = space();
    const i = ownIdentity(s);
    const before = readFileSync(idPath(s), "utf8");
    expect(writableKey(s.ctx, SELF, null)).toEqual({ ok: false, reason: "unknown-incarnation", key: MANAGER, pid: process.pid });
    expect(writableKey(s.ctx, SELF, { pid: process.pid, procStart: LATER_START })).toEqual({ ok: false, reason: "live-owner", key: MANAGER, pid: process.pid });
    expect(writableKey(s.ctx, SELF, { pid: process.pid, procStart: i.procStart })).toEqual({ ok: true, key: MANAGER });
    expect(readFileSync(idPath(s), "utf8")).toBe(before);
    s.identity({ ...i, procStart: LATER_START });
    expect(writableKey(s.ctx, SELF, null)).toEqual({ ok: true, key: MANAGER });
    expect(identityLive(s.ctx, { ...i, procStart: LATER_START })).toBe(false);
    expect(identityLive(s.ctx, i)).toBe(true);
    expect(ownPid(s.ctx.claudeConfigDir)).toBeNull();
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-606 CLI unknown-incarnation refuses writes without claiming a different live process", async () => {
    const s = space();
    ownIdentity(s);
    s.progress(progress({ rev: 2, updatedAt: NOW }));
    const before = readFileSync(progPath(s), "utf8");
    const r = await runBun(s, "scripts/orch-state.ts", ["hold", "staging"], "", { CLAUDE_CODE_SESSION_ID: SELF });
    expect(r.code).toBe(3);
    expect(r.stdout + r.stderr).toMatch(/process|incarnation/i);
    expect(r.stdout + r.stderr).not.toMatch(/another live process/i);
    expect(readFileSync(progPath(s), "utf8")).toBe(before);
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-607 a live triage refuses a second register, dead takeover keeps key and clears previous progress", async () => {
    const s = space();
    const init = Bun.spawnSync(["git", "init", "--quiet", "--initial-branch=main", s.root], { env: s.env });
    expect(init.exitCode).toBe(0);
    const first = await ancestor(s, "triage01");
    let oldKey = "";
    try {
      const r = await first.run("scripts/orch-state.ts", ["register", "--role", "triage"]);
      expect(r.code).toBe(0);
      oldKey = JSON.parse(r.stdout).key;
      expect(oldKey).toBe("t-" + createHash("sha256").update(s.root).digest("hex").slice(0, 12));
      expect((await first.run("scripts/orch-state.ts", ["block", "old block"])).code).toBe(0);
      expect((await first.run("scripts/orch-state.ts", ["hold", "old hold"])).code).toBe(0);
      expect((await first.run("scripts/orch-state.ts", ["tasks"], renderTasksTable(taskRows()))).code).toBe(0);
      const denied = await runBun(s, "scripts/orch-state.ts", ["register", "--role", "triage"], "", { CLAUDE_CODE_SESSION_ID: "triage02" });
      expect(denied.code).toBe(1);
      expect(denied.stdout + denied.stderr).toContain("triage01");
      expect(denied.stdout + denied.stderr).toContain(String(first.pid));
    } finally { await first.stop(); }
    const next = await runBun(s, "scripts/orch-state.ts", ["register", "--role", "triage"], "", { CLAUDE_CODE_SESSION_ID: "triage02" });
    expect(next.code).toBe(0);
    expect(JSON.parse(next.stdout).key).toBe(oldKey);
    expect(readRecord(s.ctx, oldKey)).toMatchObject({ sessionId: "triage02", tasks: [], deps: [], blocked: null, holds: [], rev: 0 });
  }, 30_000);
});

describe("atomic storage and command protocol [R1.4, R1.8; §6 Store]", () => {
  test("[REQ-4, REQ-8, REQ-16] TEST-608 readers never see partial identity or progress during 200 writes", async () => {
    const s = space();
    s.identity(identity({ pid: null, procStart: null, cwd: s.root }));
    s.alias(SELF, MANAGER);
    s.progress(progress());
    const code = [
      'const m=await import(process.env.QA_MODULE);',
      'const ctx=JSON.parse(process.env.QA_CTX), q=JSON.parse(process.env.QA_INPUT);',
      'for(let n=1;n<=200;n++){ m.bindSession(ctx,{...q,now:q.now+n}); const tasks=Array.from({length:128},(_,i)=>({n:i===0?n:i+201,step:("iteration "+n).padEnd(200,"x"),who:"owner",state:"working"})); m.updateProgress(ctx,process.env.QA_KEY,{op:"tasks",tasks},q.now+n); await new Promise(resolve=>setImmediate(resolve)); }',
    ].join("\n");
    const p = spawnEval(s, code, { QA_MODULE: script("scripts/lib/record-store.ts"), QA_CTX: JSON.stringify(s.ctx), QA_INPUT: JSON.stringify(input(s)), QA_KEY: MANAGER });
    let finished = false;
    const result = collect(p, "", 25_000).finally(() => { finished = true; });
    let observations = 0, lastRev = 0;
    try {
      while (!finished) {
        const i = readFileSync(idPath(s), "utf8");
        const text = readFileSync(progPath(s), "utf8");
        const parsed = parseRecord(i, text);
        expect(parsed).not.toBeNull();
        const raw = JSON.parse(text);
        expect(raw.schema).toBe(1);
        expect(raw.key).toBe(MANAGER);
        expect(raw.rev).toBeGreaterThanOrEqual(lastRev);
        if (raw.rev > 0) expect(raw.tasks[0]?.n).toBe(raw.rev);
        lastRev = raw.rev;
        observations++;
        await new Promise(resolve => setImmediate(resolve));
      }
      expect((await result).code).toBe(0);
    } finally {
      if (p.exitCode === null) p.kill();
      await result;
    }
    expect(observations).toBeGreaterThan(0);
    const final = readProgress(s.ctx, MANAGER);
    expect(final.rev).toBe(200);
    expect(final.tasks).toHaveLength(128);
    expect(final.tasks[0]).toEqual({ n: 200, step: "iteration 200".padEnd(200, "x"), who: "owner", state: "working" });
  }, 30_000);

  test("[REQ-4, REQ-8, REQ-16] TEST-612 identity refresh replaces the inode and preserves the old content for an open reader", () => {
    const s = space();
    s.identity(identity({ pid: null, procStart: null, cwd: s.root }));
    s.alias(SELF, MANAGER);
    const path = idPath(s);

    for (let n = 1; n <= 3; n++) {
      const before = readFileSync(path, "utf8");
      const fd = openSync(path, "r");
      try {
        const inode = fstatSync(fd).ino;
        const cwd = join(s.root, "refresh-" + n), now = NOW + n;

        const result = bindSession(s.ctx, input(s, { cwd, now }));

        expect(result).toMatchObject({ ok: true, key: MANAGER, route: "owned" });
        expect(statSync(path).ino).not.toBe(inode);
        expect(readFileSync(fd, "utf8")).toBe(before);
        expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
          schema: 1, key: MANAGER, sessionId: SELF, cwd, updatedAt: now,
        });
      } finally {
        closeSync(fd);
      }
    }
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-613 progress updates replace the inode and preserve the old content for an open reader", () => {
    const s = space();
    s.identity(identity({ pid: null, procStart: null }));
    s.alias(SELF, MANAGER);
    s.progress(progress());
    const path = progPath(s);

    for (let n = 1; n <= 3; n++) {
      const before = readFileSync(path, "utf8");
      const fd = openSync(path, "r");
      try {
        const inode = fstatSync(fd).ino;
        const reason = "write " + n, now = NOW + n;

        const result = updateProgress(s.ctx, MANAGER, { op: "block", reason }, now);

        expect(result).toMatchObject({
          schema: 1, key: MANAGER, rev: n, updatedAt: now,
          blocked: { reason, since: now },
        });
        expect(statSync(path).ino).not.toBe(inode);
        expect(readFileSync(fd, "utf8")).toBe(before);
        expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(result);
      } finally {
        closeSync(fd);
      }
    }
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-609 concurrent hook identity refresh and CLI tasks survive without crossing files", async () => {
    const s = space();
    s.identity(identity({ pid: null, procStart: null, cwd: "old-cwd" }));
    s.alias(SELF, MANAGER);
    s.progress(progress({ holds: [{ what: "staging", since: NOW }] }));
    const hook = JSON.stringify({ session_id: SELF, hook_event_name: "SessionStart", source: "startup", cwd: s.root });
    const results = await Promise.all([
      runBun(s, "hooks/session-record.ts", [], hook),
      runBun(s, "scripts/orch-state.ts", ["tasks"], renderTasksTable(taskRows()), { CLAUDE_CODE_SESSION_ID: SELF }),
    ]);
    expect(results.map(r => r.code)).toEqual([0, 0]);
    expect(readRecord(s.ctx, MANAGER)).toMatchObject({ cwd: s.root, tasks: taskRows(), holds: [{ what: "staging", since: NOW }], rev: 1 });
    const identityBytes = readFileSync(idPath(s), "utf8");
    const one = await runBun(s, "scripts/orch-state.ts", ["dep", "add", "release:api 2.0"], "", { CLAUDE_CODE_SESSION_ID: SELF });
    expect(one.code).toBe(0);
    expect(readFileSync(idPath(s), "utf8")).toBe(identityBytes);
    const progressBytes = readFileSync(progPath(s), "utf8");
    expect((await runBun(s, "hooks/session-record.ts", [], hook)).code).toBe(0);
    expect(readFileSync(progPath(s), "utf8")).toBe(progressBytes);
  }, 30_000);

  test("[REQ-4, REQ-8, REQ-16] TEST-610 fifty sequential dep calls leave fifty deps with revs 1 through 50", async () => {
    const s = space();
    s.identity(identity({ pid: null, procStart: null })); s.alias(SELF, MANAGER);
    const identityBytes = readFileSync(idPath(s), "utf8");
    for (let n = 1; n <= 50; n++) {
      const r = await runBun(s, "scripts/orch-state.ts", ["dep", "add", "release:artifact " + n], "", { CLAUDE_CODE_SESSION_ID: SELF });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).rev).toBe(n);
    }
    const p = readProgress(s.ctx, MANAGER);
    expect(p.rev).toBe(50);
    expect(p.deps.map(d => d.ref)).toEqual(Array.from({ length: 50 }, (_, i) => "artifact " + (i + 1)));
    expect(readFileSync(idPath(s), "utf8")).toBe(identityBytes);
  }, 60_000);

  test("[REQ-4, REQ-8, REQ-16] TEST-611 prune deletes only old dead records and their aliases, old claims and old temps", () => {
    const s = space(), now = Date.now(), day = 24 * 3600_000;
    const live = ownIdentity(s);
    s.identity({ ...live, updatedAt: now - 9 * day });
    s.progress(progress({ updatedAt: now - 9 * day }));
    const gone = identity({ key: CHILD, sessionId: "dead0001", previousIds: ["old00001"], pid: null, procStart: null, updatedAt: now - 9 * day });
    s.identity(gone); s.progress(progress({ key: CHILD, updatedAt: gone.updatedAt }));
    s.alias("dead0001", CHILD); s.alias("old00001", CHILD);
    const fresh = identity({ key: "s-fresh001", sessionId: "fresh001", pid: null, procStart: null, updatedAt: now });
    s.identity(fresh);
    s.claim(claim({ key: "l-oldclaim1", createdAt: now - day - 1 }));
    s.claim(claim({ key: "l-newclaim1", createdAt: now - day + 1000 }));
    const oldTemp = join(s.ctx.stateDir, "progress", "old.tmp");
    const newTemp = join(s.ctx.stateDir, "progress", "new.tmp");
    writeFileSync(oldTemp, "partial"); writeFileSync(newTemp, "partial");
    utimesSync(oldTemp, new Date(now - 3600_001), new Date(now - 3600_001));
    const r = prune(s.ctx, { days: 7, now });
    expect(r).toEqual({ records: [CHILD], aliases: 2, claims: 1, temps: 1 });
    expect(existsSync(idPath(s))).toBe(true);
    expect(existsSync(progPath(s))).toBe(true);
    expect(existsSync(idPath(s, CHILD))).toBe(false);
    expect(existsSync(progPath(s, CHILD))).toBe(false);
    expect(existsSync(idPath(s, fresh.key))).toBe(true);
    expect(existsSync(newTemp)).toBe(true);
    expect(existsSync(oldTemp)).toBe(false);
    expect(readClaim(s.ctx, "l-newclaim1")).not.toBeNull();
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-611 failed progress write reports exit 4 and the path without modifying identity", async () => {
    const s = space();
    s.identity(identity({ pid: null, procStart: null })); s.alias(SELF, MANAGER);
    const before = readFileSync(idPath(s), "utf8");
    const blockedPath = join(s.ctx.stateDir, "progress");
    rmSync(blockedPath, { recursive: true });
    writeFileSync(blockedPath, "not a directory");
    const result = await runBun(s, "scripts/orch-state.ts", ["hold", "staging"], "", { CLAUDE_CODE_SESSION_ID: SELF });
    expect(result.code).toBe(4);
    expect(result.stdout + result.stderr).toContain(blockedPath);
    expect(readFileSync(idPath(s), "utf8")).toBe(before);
  });

  test("[REQ-4, REQ-8, REQ-16] TEST-611 register fills only null ticket, refuses role changes, and tasks echo even on exit 3", async () => {
    const s = space();
    s.identity(identity({ pid: null, procStart: null, ticket: null })); s.alias(SELF, MANAGER);
    let r = await runBun(s, "scripts/orch-state.ts", ["register", "--role", "manager", "--ticket", "DEMO-7", "--ticket-url", "not-https"], "", { CLAUDE_CODE_SESSION_ID: SELF });
    expect(r.code).toBe(0);
    expect(readIdentity(s.ctx, MANAGER)?.ticket).toEqual({ id: "DEMO-7", url: null });
    r = await runBun(s, "scripts/orch-state.ts", ["register", "--role", "triage"], "", { CLAUDE_CODE_SESSION_ID: SELF });
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/already manager|role does not change/i);
    const before = readIdentity(s.ctx, MANAGER)!;
    expect(fillTicket(s.ctx, before, { id: "DEMO-8", url: null }, NOW + 100).ticket).toEqual({ id: "DEMO-7", url: null });
    const table = renderTasksTable(taskRows());
    r = await runBun(s, "scripts/orch-state.ts", ["tasks"], table, { CLAUDE_CODE_SESSION_ID: "unowned1" });
    expect(r.code).toBe(3);
    expect(r.stdout).toBe(table);
    expect(r.stderr).toMatch(/register|role skill/i);
    expect((await runBun(s, "scripts/orch-state.ts", ["show"])).code).toBe(2);
    expect((await runBun(s, "scripts/orch-state.ts", ["unknown"], "", { CLAUDE_CODE_SESSION_ID: SELF })).code).toBe(1);
    expect((await runBun(s, "scripts/orch-state.ts", ["dep", "add", "pr:PR #7"], "", { CLAUDE_CODE_SESSION_ID: SELF })).code).toBe(1);
  }, 30_000);
});
