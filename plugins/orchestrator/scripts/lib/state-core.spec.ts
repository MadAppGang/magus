import { describe, expect, test } from "bun:test";
import {
  isSessionId, isFamilyKey, isRole, isDepKind, triageKey, sessionKey, launchKey,
  parseIdentity, parseProgress, parseRecord, mergeRecord, parseClaim, emptyProgress,
  recordFromClaim, rebindIdentity, nextUpdatedAt, applyOp, depKey, parseDepSpec,
  resolveDeps, openDeps, normaliseTicketId, parseTasksTable, renderTasksTable,
  progressOf, parseLstart, sameProcess, psArgv, parsePsStarts, parseTmuxField,
  type OrchestratorOp,
} from "./state-core";
import { identity, progress, record, claim, taskRows, NOW, START, MANAGER, TRIAGE, SELF, PRODUCT } from "../../tests/testdata";

describe("state files [R1.4, R3.4; §4.1]", () => {
  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-101 accepts required identity fields and defaults optional malformed fields", () => {
    const minimal = { schema: 1, key: MANAGER, sessionId: SELF, role: "manager", product: PRODUCT, cwd: PRODUCT, createdAt: 1, updatedAt: 2 };
    expect(parseIdentity(JSON.stringify(minimal))).toEqual(identity({
      ...minimal, schema: 1, role: "manager", previousIds: [], name: null,
      ticket: null, parent: null, pid: null, procStart: null, herdr: null,
    }));
    const parsed = parseIdentity(JSON.stringify({ ...identity(), ignored: "extra" }));
    expect(parsed).toEqual(identity());
    expect(parsed).not.toHaveProperty("ignored");
  });

  for (const [field, bad] of [
    ["schema", 2], ["key", "../escape"], ["sessionId", "../escape"],
    ["role", "owner"], ["product", 1], ["cwd", null], ["createdAt", "1"], ["updatedAt", null],
  ] as const) {
    test(`[REQ-2, REQ-4, REQ-8; §4.1] TEST-101 returns null for bad required identity ${field}`, () => {
      expect(parseIdentity(JSON.stringify({ ...identity(), [field]: bad }))).toBeNull();
      const omitted: Record<string, unknown> = { ...identity() };
      delete omitted[field];
      expect(parseIdentity(JSON.stringify(omitted))).toBeNull();
    });
  }
  for (const text of ["", "{", "null", "[]", "7"]) {
    test(`[REQ-2, REQ-4, REQ-8; §4.1] TEST-101 never throws and returns null for malformed identity ${JSON.stringify(text)}`, () => {
      expect(parseIdentity(text)).toBeNull();
      expect(parseRecord(text, null)).toBeNull();
      expect(parseClaim(text)).toBeNull();
    });
  }

  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-102 merges max updatedAt, ignores bad progress and drops bad list items", () => {
    const i = identity({ updatedAt: 50 });
    const p = progress({ rev: 3, updatedAt: 80, tasks: taskRows() });
    expect(parseRecord(JSON.stringify(i), JSON.stringify(p))).toEqual({ ...i, ...p });
    expect(mergeRecord(i, { ...p, updatedAt: 20 }).updatedAt).toBe(50);
    for (const text of [null, "{", "null", JSON.stringify({ ...p, schema: 2 }), JSON.stringify({ ...p, key: TRIAGE })]) {
      expect(parseProgress(text, MANAGER)).toEqual(emptyProgress(MANAGER));
      expect(parseRecord(JSON.stringify(i), text)).toEqual({ ...i, ...emptyProgress(MANAGER), updatedAt: 50 });
    }
    const tasks = taskRows();
    expect(tasks.length).toBeGreaterThan(0);
    const validTask = tasks[0]!;

    const mixed = parseProgress(JSON.stringify({
      ...p, tasks: [validTask, null, "bad", { n: 0 }],
      deps: [{ kind: "release", ref: "api 2.0", note: null, since: 1, doneAt: null }, { kind: "unknown" }],
      holds: [{ what: "staging", since: 1 }, null],
    }), MANAGER);
    expect(mixed.tasks).toEqual([validTask]);
    expect(mixed.deps).toEqual([{ kind: "release", ref: "api 2.0", note: null, since: 1, doneAt: null }]);
    expect(mixed.holds).toEqual([{ what: "staging", since: 1 }]);
  });

  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-103 claim and rebind preserve family identity without duplicating same-id history", () => {
    const c = claim();
    expect(parseClaim(JSON.stringify(c))).toEqual(c);
    expect(parseClaim(JSON.stringify({ ...c, role: "triage" }))).toBeNull();
    expect(parseClaim(JSON.stringify({ ...c, key: TRIAGE }))).toBeNull();
    const facts = { sessionId: SELF, cwd: PRODUCT + "/worktree", pid: 802, procStart: START, herdr: null, now: NOW };
    const first = recordFromClaim(c, facts);
    expect(first).toMatchObject({ schema: 1, key: c.key, role: c.role, name: c.name, ticket: c.ticket, parent: c.parent, product: c.product, createdAt: expect.any(Number), sessionId: SELF, previousIds: [], cwd: facts.cwd, pid: facts.pid, procStart: START, herdr: null, updatedAt: NOW });
    expect(first).not.toHaveProperty("tasks");
    expect(first).not.toHaveProperty("now");
    const next = rebindIdentity(first, { ...facts, sessionId: "clear0002", now: NOW - 100 });
    expect(next).toEqual({ ...first, sessionId: "clear0002", previousIds: [SELF], updatedAt: NOW + 1 });
    expect(rebindIdentity(next, { ...facts, sessionId: "clear0002", now: NOW }).previousIds).toEqual([SELF]);
    expect(first.sessionId).toBe(SELF);
    expect(first.previousIds).toEqual([]);
  });
});

describe("progress operations [R1.2–R1.4, R5.3, R5.5; §4.2]", () => {
  const reactivating: OrchestratorOp[] = [
    { op: "tasks", tasks: taskRows() }, { op: "dep-add", kind: "release", ref: "api 2.0", note: null },
    { op: "block", reason: "choose scope" }, { op: "hold", what: "staging" },
  ];
  for (const op of reactivating) {
    test(`[REQ-2, REQ-4, REQ-8; §4.1] TEST-104 ${op.op} changes progress, reactivates done work and bumps revision under a backwards clock`, () => {
      const before = progress({ rev: 8, updatedAt: NOW, state: "done", doneAt: NOW - 1 });
      const frozen = JSON.stringify(before);
      const after = applyOp(before, op, NOW - 1000);
      expect(after).toMatchObject({ rev: 9, updatedAt: NOW + 1, state: "active", doneAt: null });
      expect(JSON.stringify(before)).toBe(frozen);
      if (op.op === "tasks") expect(after.tasks).toEqual(taskRows());
      if (op.op === "dep-add") expect(after.deps).toEqual([{ kind: "release", ref: "api 2.0", note: null, since: NOW - 1000, doneAt: null }]);
      if (op.op === "block") expect(after.blocked).toEqual({ reason: "choose scope", since: NOW - 1000 });
      if (op.op === "hold") expect(after.holds).toEqual([{ what: "staging", since: NOW - 1000 }]);
    });
  }
  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-104 applies every non-reactivating operation without silently reopening done work", () => {
    let p = applyOp(progress(), { op: "block", reason: "review" }, NOW);
    p = applyOp(p, { op: "hold", what: "staging" }, NOW + 1);
    p = applyOp(p, { op: "hold", what: "staging" }, NOW + 2);
    expect(p.holds).toEqual([{ what: "staging", since: NOW + 1 }]);
    p = applyOp(p, { op: "done" }, NOW + 3);
    expect(p).toMatchObject({ state: "done", doneAt: NOW + 3, rev: 4 });
    p = applyOp(p, { op: "unblock" }, NOW + 4);
    p = applyOp(p, { op: "release", what: "staging" }, NOW + 5);
    p = applyOp(p, { op: "dep-done", kind: "session", ref: "absent" }, NOW + 6);
    p = applyOp(p, { op: "dep-drop", kind: "session", ref: "absent" }, NOW + 7);
    expect(p).toMatchObject({ blocked: null, holds: [], deps: [], rev: 8, updatedAt: NOW + 7, state: "done", doneAt: NOW + 3 });
  });

  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-105 dependency add/done/reopen/drop matches kind and ref and keeps since", () => {
    let p = applyOp(progress(), { op: "dep-add", kind: "session", ref: "worker", note: "first" }, 100);
    p = applyOp(p, { op: "dep-add", kind: "release", ref: "worker", note: null }, 101);
    p = applyOp(p, { op: "dep-done", kind: "session", ref: "worker" }, 102);
    expect(p.deps[0]).toEqual({ kind: "session", ref: "worker", note: "first", since: 100, doneAt: 102 });
    p = applyOp(p, { op: "dep-add", kind: "session", ref: "worker", note: null }, 103);
    expect(p.deps[0]).toEqual({ kind: "session", ref: "worker", note: "first", since: 100, doneAt: null });
    p = applyOp(p, { op: "dep-add", kind: "session", ref: "worker", note: "new" }, 104);
    expect(p.deps[0]?.note).toBe("new");
    p = applyOp(p, { op: "dep-drop", kind: "session", ref: "worker" }, 105);
    expect(p.deps.map(depKey)).toEqual(["release:worker"]);
  });

  for (const [targets, open, problem] of [
    [[], true, "not found"], [["live"], true, null], [["done"], false, null],
    [["gone"], true, "gone"], [["done", "done"], true, "not found"],
  ] as const) {
    test(`[REQ-2, REQ-4, REQ-8; §4.1] TEST-105 resolves session targets ${JSON.stringify(targets)} without declaring gone complete`, () => {
      const d = { kind: "session" as const, ref: "worker", note: null, since: 10, doneAt: null };
      const resolve = () => targets;
      expect(resolveDeps({ deps: [d] }, resolve)).toEqual([{ ...d, open, problem }]);
      expect(openDeps({ deps: [d] }, resolve)).toEqual(open ? [{ ...d, open, problem }] : []);
      expect(resolveDeps({ deps: [{ ...d, doneAt: 50 }] }, resolve)[0]).toMatchObject({ open: false, problem: null });
    });
  }
  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-105 PR and release dependencies close only explicitly and require full PR URLs", () => {
    for (const kind of ["pr", "release"] as const) {
      const d = { kind, ref: kind === "pr" ? "https://github.com/example/product/pull/8" : "api 2.0", note: null, since: 10, doneAt: null };
      expect(resolveDeps({ deps: [d] }, () => ["done"])[0]).toMatchObject({ open: true, problem: null });
      expect(resolveDeps({ deps: [{ ...d, doneAt: 20 }] }, () => [])[0]?.open).toBe(false);
    }
    expect(parseDepSpec("session: worker ")).toEqual({ ok: true, kind: "session", ref: "worker" });
    expect(parseDepSpec("pr:https://github.com/example/product/pull/8")).toEqual({ ok: true, kind: "pr", ref: "https://github.com/example/product/pull/8" });
    for (const text of ["pr:PR #8", "pr:#8", "pr:http://example.test/pull/8", "other:x", "release: ", "session"]) expect(parseDepSpec(text).ok).toBe(false);
  });
});

describe("formats and limits [R1.2, R1.8, R5.3, R5.6; §4.1]", () => {
  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-106 normalises only positive bare/hash numbers with the checkout origin", () => {
    for (const id of ["#229", "229"]) {
      expect(normaliseTicketId(id, "example/product")).toBe("example/product#229");
      expect(normaliseTicketId(id, null)).toBe("#229");
    }
    for (const id of ["DEMO-7", "other/repo#7", "#0", "0", "007", " #7 ", "https://github.com/example/product/issues/7"])
      expect(normaliseTicketId(id, "example/product")).toBe(id);
  });

  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-107 parses the first matching table, trims, unescapes bars and stops at non-rows", () => {
    const text = [
      "| Other | Table |", "|---|---|", "|x|y|", "",
      "| # | STEP | who | State |", "|---|---|---|---|",
      "| 2 | A \\| B | child | done |", "| 0 | skip | a | x |",
      "| -2 | skip | a | x |", "| 2.5 | skip | a | x |", "| nope | skip | a | x |",
      "stop", "| 9 | not part | x | x |", "",
      "| # | Step | Who | State |", "|---|---|---|---|", "| 4 | later | x | x |",
    ].join("\n");
    expect(parseTasksTable(text)).toEqual([{ n: 2, step: "A | B", who: "child", state: "done" }]);
    for (const text of ["", "|#|Step|Who|State|\n|---|---|---|---|\n", "|#|Step|State|Who|\n|1|x|x|x|"])
      expect(parseTasksTable(text)).toBeNull();
    const tasks = [{ n: 1, step: "A | B", who: "a | b", state: "done | verified" }];
    expect(renderTasksTable(tasks)).toBe("| # | Step | Who | State |\n|---|---|---|---|\n| 1 | A \\| B | a \\| b | done \\| verified |\n");
    expect(parseTasksTable(renderTasksTable(tasks))).toEqual(tasks);
  });

  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-108 progress uses done/moved/dropped word boundaries and caps stored text", () => {
    expect(progressOf([])).toBeNull();
    expect(progressOf(taskRows())).toEqual({ done: 1, total: 2 });
    const states = ["done", "DONE verified", "doneish", "moved", "dropped by user", "movedness", "undone", "working"];
    expect(progressOf(states.map((state, i) => ({ n: i + 1, step: "x", who: "x", state })))).toEqual({ done: 2, total: 6 });
    let p = applyOp(progress(), { op: "tasks", tasks: [{ n: 1, step: "s".repeat(201), who: "manager", state: "working" }] }, NOW);
    p = applyOp(p, { op: "block", reason: "r".repeat(201) }, NOW);
    p = applyOp(p, { op: "dep-add", kind: "release", ref: "f".repeat(301), note: "n".repeat(201) }, NOW);
    expect(p.tasks[0]?.step).toBe("s".repeat(200));
    expect(p.blocked?.reason).toBe("r".repeat(200));
    expect(p.deps[0]?.ref).toBe("f".repeat(300));
    expect(p.deps[0]?.note).toBe("n".repeat(200));
    expect(nextUpdatedAt(10, 1)).toBe(11);
    expect(nextUpdatedAt(10, 10)).toBe(11);
    expect(nextUpdatedAt(10, 12)).toBe(12);
  });

  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-109 parses the measured UTC process string and not the local day-month form", () => {
    expect(parseLstart(START)).toBe(Date.UTC(2026, 10, 8, 12, 39, 30));
    expect(parseLstart("  Sun   Nov 8 12:39:30   2026\n")).toBe(NOW);
    for (const invalid of ["Sun  8 Nov 23:39:30 2026", "Sun Nov 31 12:39:30 2026", "Sun Nov 8 25:39:30 2026", "2026-11-08T12:39:30Z", ""]) expect(parseLstart(invalid)).toBeNull();
    expect(sameProcess(START, START)).toBe(true);
    expect(sameProcess(START, "Sun Nov  8 12:39:31 2026")).toBe(true);
    expect(sameProcess(START, "Sun Nov  8 12:39:29 2026")).toBe(true);
    expect(sameProcess(START, "Sun Nov  8 12:39:32 2026")).toBe(false);
    for (const value of [null, undefined, "", "bad"]) {
      expect(sameProcess(value, START)).toBe(false);
      expect(sameProcess(START, value)).toBe(false);
    }
    expect(psArgv([701, 702])).toEqual(["env", "TZ=UTC", "LC_ALL=C", "ps", "-o", "pid=,lstart=", "-p", "701,702"]);
    expect([...parsePsStarts("  701 " + START + "\n702 Sun Nov  8 12:39:31 2026\n").entries()]).toEqual([[701, START], [702, "Sun Nov  8 12:39:31 2026"]]);
  });

  test("[REQ-8; §4.1] TEST-109 treats lstart as UTC even in a non-UTC process", () => {
    for (const timezone of ["UTC", "Etc/GMT-11"]) {
      const code = [
        'const {parseLstart}=await import(process.env.QA_MODULE);',
        'console.log(JSON.stringify({value:parseLstart(process.env.QA_START),offset:new Date(Number(process.env.QA_NOW)).getTimezoneOffset()}));',
      ].join("\n");
      const result = Bun.spawnSync([process.execPath, "--no-env-file", "--config=/dev/null", "--eval", code], {
        env: { PATH: process.env.PATH ?? "", TZ: timezone, QA_MODULE: import.meta.dir + "/state-core.ts", QA_START: START, QA_NOW: String(NOW) },
        timeout: 3000,
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({ value: NOW, offset: timezone === "UTC" ? 0 : -660 });
    }
  });

  test("[REQ-2, REQ-4, REQ-8; §4.1] TEST-110 validates ids and family keys before using them as paths and formats generated keys", () => {
    for (const id of ["a".repeat(8), "Z-9".repeat(21) + "Z"]) expect(isSessionId(id)).toBe(true);
    for (const id of ["a".repeat(7), "a".repeat(65), "../session", "session_id", "session\n"]) expect(isSessionId(id)).toBe(false);
    for (const prefix of ["l", "t", "s"]) {
      expect(isFamilyKey(prefix + "-" + "a".repeat(8))).toBe(true);
      expect(isFamilyKey(prefix + "-" + "a".repeat(72))).toBe(true);
      expect(isFamilyKey(prefix + "-" + "a".repeat(73))).toBe(false);
    }
    expect(isFamilyKey("x-12345678")).toBe(false);
    expect(triageKey("0123456789abcdef")).toBe("t-0123456789ab");
    expect(sessionKey(SELF)).toBe("s-" + SELF);
    expect(launchKey("01234567-89ab-cdef-0123-456789abcdef")).toBe("l-0123456789abcdef0123456789abcdef");
    for (const value of ["triage", "manager", "child"]) expect(isRole(value)).toBe(true);
    for (const value of ["session", "pr", "release"]) expect(isDepKind(value)).toBe(true);
    for (const value of ["owner", null, 1]) expect(isRole(value)).toBe(false);
    expect(isDepKind("ticket")).toBe(false);
    expect(parseTmuxField("circle:@95.%474")).toEqual({ session: "circle", window: "@95", pane: "%474" });
    expect(parseTmuxField("%474")).toEqual({ session: null, window: null, pane: "%474" });
    for (const text of ["circle:95.474", "@95", "circle:@95", "%474 junk", ""]) expect(parseTmuxField(text)).toBeNull();
  });
});
