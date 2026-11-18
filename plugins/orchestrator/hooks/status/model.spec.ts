import { describe, expect, test } from "bun:test";
import {
  pathsOf, keyOfFileName, SESSION_FILE_RE, parseSessionFile, parseRecords, familyTree,
  visibleKeys, orphansOf, pidsToCheck, hasIncarnation, livenessOf, isStale,
  sessionActivity, statusOf, sessionResolver, mergeRows, isActive, sameRows, ticketLabel, psProblem,
  type SessionFile, type Liveness,
} from "./model";
import { identity, progress, record, row, NOW, START, LATER_START, ROOT, PRODUCT, SELF, TRIAGE, MANAGER, CHILD, taskRows } from "../../tests/testdata";
import type { OrchestratorRecord, OrchestratorRowDep } from "../../types";

function file(patch: Partial<SessionFile> = {}): SessionFile {
  return {
    pid: 701, sessionId: SELF, procStart: START, status: "busy", waitingFor: null,
    name: "live-manager", cwd: PRODUCT, tmux: "product:@12.%702",
    statusUpdatedAt: NOW - 500, updatedAt: NOW - 100, ...patch,
  };
}
const live = (patch: Partial<SessionFile> = {}): Liveness => ({ live: true, file: file(patch) });
const triage = () => record({ key: TRIAGE, sessionId: "triage01", role: "triage", parent: null, name: "triage", pid: 700 });
const manager = () => record();
const child = () => record({ key: CHILD, sessionId: "child001", role: "child", parent: MANAGER, name: "api-child", pid: 702 });
const sibling = () => record({ key: "l-000000000004", sessionId: "sibling1", name: "sibling", pid: 703 });

describe("files and family trees [R1.1, R1.4–R1.5; §4.7]", () => {
  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-901 paths honour config/state overrides and listings reject unrelated files", () => {
    expect(pathsOf({ home: ROOT })).toEqual({ stateDir: ROOT + "/.claude/orchestrator", sessionsDir: ROOT + "/.claude/sessions" });
    expect(pathsOf({ home: ROOT, stateDir: ROOT + "/state", claudeConfigDir: ROOT + "/config" })).toEqual({ stateDir: ROOT + "/state", sessionsDir: ROOT + "/config/sessions" });
    expect(pathsOf({ home: ROOT, stateDir: "relative" })?.stateDir).toBe(ROOT + "/.claude/orchestrator");
    expect(pathsOf({})).toBeNull();
    expect(keyOfFileName(MANAGER + ".json")).toBe(MANAGER);
    for (const name of [MANAGER + ".json.tmp", "other.json", "../" + MANAGER + ".json"]) expect(keyOfFileName(name)).toBeNull();
    expect(SESSION_FILE_RE.test("701.json")).toBe(true);
    for (const name of ["701.key", "701.json.tmp", "name.json", "../701.json"]) expect(SESSION_FILE_RE.test(name)).toBe(false);
    expect(parseSessionFile(JSON.stringify({ pid: 701 }))).toEqual(file({
      sessionId: null, procStart: null, status: null, waitingFor: null, name: null,
      cwd: null, tmux: null, statusUpdatedAt: null, updatedAt: null,
    }));
    for (const text of ["{", "null", JSON.stringify({ pid: "701" })]) expect(parseSessionFile(text)).toBeNull();
    const parsed = parseRecords(new Map([
      [MANAGER, { identity: JSON.stringify(identity()), progress: JSON.stringify(progress({ tasks: taskRows() })) }],
      [CHILD, { identity: "{", progress: null }],
    ]));
    expect(parsed).toEqual([record({ tasks: taskRows() })]);
  });

  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-902 manager and child see ancestors and descendants, never sibling branches", () => {
    const records = [triage(), manager(), child(), sibling()];
    expect(visibleKeys(MANAGER, records)).toEqual([TRIAGE, MANAGER, CHILD]);
    expect(visibleKeys(CHILD, records)).toEqual([TRIAGE, MANAGER, CHILD]);
    expect(familyTree(MANAGER, records)).toEqual([
      { key: TRIAGE, depth: 0, adopted: false },
      { key: MANAGER, depth: 1, adopted: false },
      { key: CHILD, depth: 2, adopted: false },
    ]);
    expect(new Set(visibleKeys(TRIAGE, records))).toEqual(new Set(records.map(r => r.key)));
    expect(visibleKeys("s-missing1", records)).toEqual([]);
    const rotated = records.map(r => r.key === MANAGER || r.key === TRIAGE ? { ...r, sessionId: r.sessionId + "-new", previousIds: [r.sessionId] } : r);
    expect(visibleKeys(CHILD, rotated)).toEqual([TRIAGE, MANAGER, CHILD]);
    const cycle = [record({ key: MANAGER, parent: CHILD }), record({ key: CHILD, parent: MANAGER })];
    const keys = visibleKeys(MANAGER, cycle);
    expect(new Set(keys)).toEqual(new Set([MANAGER, CHILD]));
    expect(keys).toHaveLength(2);
  });

  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-902 triage adopts only its product's true orphans, sorted by creation with descendants", () => {
    const orphan = record({ key: "s-orphan01", sessionId: "orphan01", parent: null, createdAt: NOW - 50 });
    const broken = record({ key: "s-broken01", sessionId: "broken01", parent: "s-missing1", createdAt: NOW - 100 });
    const grand = record({ key: "s-orchild1", sessionId: "orchild1", role: "child", parent: orphan.key });
    const foreign = record({ key: "s-foreign1", sessionId: "foreign1", product: ROOT + "/other", parent: null });
    const records = [triage(), manager(), child(), orphan, broken, grand, foreign];
    expect(orphansOf(records[0]!, records).map(r => r.key)).toEqual([broken.key, orphan.key]);
    const tree = familyTree(TRIAGE, records);
    expect(tree.find(e => e.key === broken.key)?.adopted).toBe(true);
    expect(tree.find(e => e.key === orphan.key)?.adopted).toBe(true);
    expect(tree.map(e => e.key)).toContain(grand.key);
    expect(tree.findIndex(e => e.key === broken.key)).toBeLessThan(tree.findIndex(e => e.key === orphan.key));
    expect(visibleKeys(MANAGER, records)).not.toContain(orphan.key);
    expect(visibleKeys(TRIAGE, records)).not.toContain(foreign.key);
  });

  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-903 dependencies resolve across the product, not only visible rows, and gone remains open", () => {
    const dep = (ref: string) => ({ kind: "session" as const, ref, note: null, since: NOW - 1000, doneAt: null });
    const other = { ...sibling(), state: "done" as const, doneAt: NOW - 20 };
    const r = record({ deps: [dep(other.name!)] });
    const records = [triage(), r, child(), other];
    const liveness = new Map(records.map(x => [x.key, live()]));
    let rows = mergeRows({ selfKey: MANAGER, records, live: liveness, known: true, now: NOW });
    expect(rows.map(r => r.key)).not.toContain(other.key);
    expect(rows.find(r => r.key === MANAGER)?.deps[0]).toMatchObject({ open: false, problem: null });
    const gone = { ...other, state: "active" as const, doneAt: null };
    rows = mergeRows({ selfKey: MANAGER, records: records.map(x => x.key === other.key ? gone : x), live: new Map([...liveness, [other.key, { live: false, file: null }]]), known: true, now: NOW });
    expect(rows.find(r => r.key === MANAGER)?.deps[0]).toMatchObject({ open: true, problem: "gone" });
    const resolve = sessionResolver(PRODUCT, [other, { ...other, key: "s-second01" }, { ...other, key: "s-foreign1", product: ROOT + "/other" }], () => true);
    expect(resolve(other.name!)).toEqual(["done", "done"]);
    expect(resolve("missing")).toEqual([]);
    const stale = { ...gone, updatedAt: NOW - 24 * 3600_000 - 1 };
    rows = mergeRows({ selfKey: MANAGER, records: [triage(), r, stale], live: new Map([[MANAGER, live()]]), known: true, now: NOW });
    expect(rows.find(r => r.key === MANAGER)?.deps[0]).toMatchObject({ open: true, problem: "not found" });
  });
});

describe("incarnation-first liveness [R1.5, R1.8; §4.7]", () => {
  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-904 checks the recorded pid/start before adopting a same-process session-id rotation", () => {
    const r = record();
    const rotated = file({ sessionId: "newid001", status: "shell" });
    expect(hasIncarnation(r)).toBe(true);
    expect(pidsToCheck([r], [file({ pid: 999, sessionId: "newid001" })])).toEqual([701]);
    expect(livenessOf(r, new Map([[701, START]]), new Map([[701, rotated]]), [])).toEqual({ live: true, file: rotated });
    expect(livenessOf(r, new Map(), new Map([[701, rotated]]), [])).toEqual({ live: false, file: null });
    const wrongFile = file({ procStart: LATER_START, name: "replacement", sessionId: "newid001" });
    expect(livenessOf(r, new Map([[701, START]]), new Map([[701, wrongFile]]), [])).toEqual({ live: true, file: null });
  });
  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-904 a reused pid cannot supply status, name or pane to a dead record", () => {
    const r = record();
    const replacement = file({ procStart: LATER_START, sessionId: "newid001", status: "busy", name: "replacement", tmux: "wrong:@90.%999" });
    const l = livenessOf(r, new Map([[701, LATER_START]]), new Map([[701, replacement]]), [replacement]);
    expect(l).toEqual({ live: false, file: null });
    const out = mergeRows({ selfKey: MANAGER, records: [r], live: new Map([[MANAGER, l]]), known: true, now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "gone", name: "api-manager", label: "api-manager", target: null });
  });
  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-904 null incarnation matches only an exact session id in scanned files, not pid alone", () => {
    const r = record({ procStart: null });
    const rotated = file({ sessionId: "newid001" });
    expect(hasIncarnation(r)).toBe(false);
    expect(livenessOf(r, new Map([[701, START]]), new Map([[701, rotated]]), [rotated])).toEqual({ live: false, file: null });
    const exact = file({ pid: 880, sessionId: SELF });
    expect(pidsToCheck([r], [exact, rotated])).toEqual([880]);
    expect(livenessOf(r, new Map([[880, START]]), new Map(), [exact])).toEqual({ live: true, file: exact });
    expect(livenessOf(r, new Map([[880, LATER_START]]), new Map(), [exact])).toEqual({ live: false, file: null });
    expect(livenessOf(r, new Map([[880, START]]), new Map(), [{ ...exact, procStart: null }])).toEqual({ live: false, file: null });
  });
  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-904 stale records are filtered after 24 hours, but self and live rows remain", () => {
    const old = record({ updatedAt: NOW - 24 * 3600_000 - 1 });
    expect(isStale(old, false, NOW)).toBe(true);
    expect(isStale(old, true, NOW)).toBe(false);
    expect(isStale({ ...old, updatedAt: NOW - 24 * 3600_000 + 1 }, false, NOW)).toBe(false);
    expect(mergeRows({ selfKey: MANAGER, records: [old], live: new Map(), known: true, now: NOW })).toHaveLength(1);
  });
});

describe("status precedence and row values [R1.2, R1.8; §4.7]", () => {
  for (const [status, expected] of [["busy", "working"], ["shell", "working"], ["waiting", "waiting"], ["idle", "idle"], ["future-value", "idle"], [null, "idle"]] as const) {
    test(`[REQ-1, REQ-2, REQ-5, REQ-8] TEST-905 maps session status ${status} to ${expected}`, () => {
      expect(sessionActivity(status)).toBe(expected);
      expect(statusOf(record(), live({ status, waitingFor: status === "waiting" ? "approval" : null }), [])).toEqual({
        status: expected, needsYou: status === "waiting", since: NOW - 500,
        waits: status === "waiting" ? "approval" : null,
      });
    });
  }
  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-905 done and gone precede waiting/block/busy; blocking precedes busy and deps", () => {
    const dep: OrchestratorRowDep = { kind: "release", ref: "api 2.0", note: null, since: NOW - 300, doneAt: null, open: true, problem: null };
    const r = record({ blocked: { reason: "choose scope", since: NOW - 1000 } });
    expect(statusOf(r, { live: false, file: null }, [dep])).toEqual({ status: "gone", needsYou: false, since: r.updatedAt, waits: null });
    expect(statusOf(r, { live: false, file: file() }, [dep]).since).toBe(NOW - 100);
    for (const l of [live({ status: "waiting" }), { live: false, file: null }]) {
      expect(statusOf({ ...r, state: "done", doneAt: NOW - 200 }, l, [dep])).toEqual({ status: "done", needsYou: false, since: NOW - 200, waits: null });
    }
    expect(statusOf(r, live({ status: "waiting", waitingFor: "permission" }), [dep])).toEqual({ status: "waiting", needsYou: true, since: NOW - 500, waits: "permission" });
    expect(statusOf(r, live(), [dep])).toEqual({ status: "blocked", needsYou: true, since: NOW - 1000, waits: "choose scope" });
    expect(statusOf(record(), live(), [dep]).status).toBe("working");
    expect(statusOf(record(), live({ status: "idle" }), [dep])).toEqual({ status: "waiting", needsYou: false, since: NOW - 300, waits: "release api 2.0" });
    expect(statusOf(record(), { live: false, file: null }, [], false).status).toBe("unknown");
  });

  test("[REQ-1, REQ-2, REQ-5, REQ-8] TEST-906 merge reuses live names, falls back to record/ticket/key, and exposes tasks/deps/holds", () => {
    const r = record({ tasks: taskRows(), holds: [{ what: "staging", since: NOW - 100 }] });
    const result = mergeRows({ selfKey: MANAGER, records: [r], live: new Map([[MANAGER, live()]]), known: true, now: NOW });
    expect(result[0]).toMatchObject({ name: "live-manager", label: "live-manager", isSelf: true, progress: { done: 1, total: 2 }, tasks: taskRows(), holds: r.holds });
    for (const [rr, label, name] of [
      [record(), "api-manager", "api-manager"],
      [record({ name: null }), "example/product#7", null],
      [record({ name: null, ticket: null }), MANAGER, null],
    ] as const) {
      const rows = mergeRows({ selfKey: MANAGER, records: [rr], live: new Map([[MANAGER, live({ name: null })]]), known: true, now: NOW });
      expect(rows[0]).toMatchObject({ label, name });
    }
    expect(isActive(row({ status: "done" }))).toBe(false);
    expect(isActive(row({ status: "gone" }))).toBe(false);
    expect(isActive(row({ status: "unknown" }))).toBe(true);
    expect(sameRows(result, JSON.parse(JSON.stringify(result)))).toBe(true);
    expect(sameRows(result, result.map(r => ({ ...r, status: "blocked" })))).toBe(false);
  });
});

describe("ticket-first labels and the family's waits", () => {
  test("TEST-907 a name led by the lower-cased ticket id reads ticket first", () => {
    const t = { id: "ABC-463", url: null };
    expect(ticketLabel("abc-463-auth-config-dir-key", t, MANAGER)).toEqual({ label: "ABC-463 auth-config-dir-key", labelTicket: "ABC-463" });
    expect(ticketLabel("triage2", t, MANAGER)).toEqual({ label: "triage2", labelTicket: null });
    expect(ticketLabel("abc-463", t, MANAGER)).toEqual({ label: "abc-463", labelTicket: null });
    expect(ticketLabel("abc-4630-other", t, MANAGER)).toEqual({ label: "abc-4630-other", labelTicket: null });
    expect(ticketLabel("abc-463-x", null, MANAGER)).toEqual({ label: "abc-463-x", labelTicket: null });
    expect(ticketLabel(null, t, MANAGER)).toEqual({ label: "ABC-463", labelTicket: null });
    expect(ticketLabel(null, null, MANAGER)).toEqual({ label: MANAGER, labelTicket: null });
    const rows = mergeRows({
      selfKey: MANAGER, records: [record({ name: "abc-463-auth-config", ticket: t })],
      live: new Map([[MANAGER, live({ name: null })]]), known: true, now: NOW,
    });
    expect(rows[0]).toMatchObject({ name: "abc-463-auth-config", label: "ABC-463 auth-config", labelTicket: "ABC-463" });
  });

  test("TEST-909 a ps that gave no snapshot says why, short", () => {
    expect(psProblem({ refused: "operation not permitted\nat spawn" })).toBe("ps refused (operation not permitted)");
    expect(psProblem({ refused: "" })).toBe("ps refused");
    expect(psProblem({ exitCode: 1, stderr: "\nps: bad option\nusage" })).toBe("ps exited 1 (ps: bad option)");
    expect(psProblem({ exitCode: 2, stderr: "" })).toBe("ps exited 2");
    expect(psProblem({ exitCode: 0, stderr: "noise" })).toBeNull();
    expect(psProblem({ refused: "x".repeat(200) })!.length).toBeLessThan(80);
  });

  test("TEST-910 a ps reason is cut by characters, carries no control characters, and a repeated refusal reads the same", () => {
    const emoji = psProblem({ refused: "😀".repeat(100) })!;
    expect(emoji).toBe("ps refused (" + "😀".repeat(59) + "…)");
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji)).toBe(false);
    expect(psProblem({ refused: "denied\u001b[0m\tby\u0007 policy" })).toBe("ps refused (denied [m by policy)");
    expect(psProblem({ exitCode: 1, stderr: "bad\u0000 option\u007f" })).toBe("ps exited 1 (bad option)");
    const a = psProblem({ refused: "spawn ps EPERM (pid 4242, after 3001 ms)" });
    const b = psProblem({ refused: "spawn ps EPERM (pid 977, after 12 ms)" });
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d/);
  });

  test("TEST-911 a waiter whose session is gone does not wait on anyone", () => {
    const dep = { kind: "session" as const, ref: MANAGER, note: null, since: NOW - 1000, doneAt: null };
    const waiter = { ...child(), deps: [dep] };
    const gone = { ...child(), key: "s-gonewait1", sessionId: "gonew001", name: "gone-waiter", deps: [dep] };
    const records = [triage(), manager(), waiter, gone];
    const liveness = new Map<string, Liveness>(records.map(x => [x.key, { live: x.key !== gone.key, file: null }]));
    const rows = mergeRows({ selfKey: MANAGER, records, live: liveness, known: true, now: NOW });
    expect(rows.find(r => r.key === MANAGER)!.waitedOnBy.map(w => w.key)).toEqual([CHILD]);
  });

  test("TEST-908 session dependencies carry the target's label, and every row lists who waits on it, by key or by name", () => {
    const dep = (ref: string, patch: Record<string, unknown> = {}) => ({ kind: "session" as const, ref, note: null, since: NOW - 1000, doneAt: null, ...patch });
    const t = { id: "ABC-427", url: null };
    const m = record({ name: "abc-427-status-poll", ticket: t });
    const tr = { ...triage(), name: "triage2", ticket: null, deps: [dep(MANAGER)] };
    const c = { ...child(), deps: [dep("abc-427-status-poll", { note: "redesign" })] };
    const done = { ...child(), key: "s-donewait1", sessionId: "donew001", name: "done-waiter", deps: [dep(MANAGER, { doneAt: NOW - 10 })] };
    const foreign = record({ key: "s-foreign1", sessionId: "foreign1", product: ROOT + "/other", parent: null, name: "foreign", deps: [dep(MANAGER)] });
    const sib = { ...sibling(), deps: [dep("abc-427-status-poll")] };
    const records = [tr, m, c, done, foreign, sib];
    const liveness = new Map(records.map(x => [x.key, { live: true, file: null }] as const));
    const rows = mergeRows({ selfKey: MANAGER, records, live: liveness, known: true, now: NOW });
    const mrow = rows.find(r => r.key === MANAGER)!;
    // the sibling is not drawn, but it is of the product, so it still waits on this session
    expect(rows.map(r => r.key)).not.toContain(sib.key);
    expect(mrow.waitedOnBy).toEqual([
      { key: TRIAGE, label: "triage2", role: "triage" },
      { key: CHILD, label: "api-child", role: "child" },
      { key: sib.key, label: "sibling", role: "manager" },
    ]);
    const crow = rows.find(r => r.key === CHILD)!;
    expect(crow.deps[0]).toMatchObject({ open: true, label: "ABC-427 status-poll", note: "redesign" });
    expect(crow.waitedOnBy).toEqual([]);
    const trow = rows.find(r => r.key === TRIAGE)!;
    expect(trow.deps[0]).toMatchObject({ open: true, label: "ABC-427 status-poll" });
    // a dependency naming no single record has no label
    const lone = mergeRows({ selfKey: MANAGER, records: [record({ deps: [dep("missing")] })], live: new Map([[MANAGER, live()]]), known: true, now: NOW });
    expect(lone[0].deps[0]).toMatchObject({ open: true, problem: "not found", label: null });
  });
});
