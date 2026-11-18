import { describe, expect, test } from "bun:test";
import {
  formatAge, formatProgress, clip, actionsOf, messageText, planCells, pickRows,
  bandModel, panelFit, listPageSize, listModel, screenNote, sessionModel,
  fitLabel, rowDetail, wrapText, taskWait, BUTTON_CELLS,
} from "./layout";
import { BADGE_PAD, NARROW_COLUMNS, ROLE_BADGE, ROLE_SHORT } from "./domain";
import { row, NOW, MANAGER, TRIAGE, CHILD, taskRows } from "../../tests/testdata";
import type { OrchestratorRow, OrchestratorRowDep, OrchestratorScreenState } from "../../types";

describe("band and panel layout [R1.1–R1.3, R1.6; §4.7]", () => {
  test("[REQ-1, REQ-3, REQ-6] TEST-1001 formats ages, progress, clipping and action visibility", () => {
    expect(formatAge(NOW - 12_000, NOW)).toBe("12s");
    expect(formatAge(NOW - 180_000, NOW)).toBe("3m");
    expect(formatAge(NOW - 7200_000, NOW)).toBe("2h");
    expect(formatAge(null, NOW)).toBe("");
    expect(formatProgress({ done: 3, total: 7 })).toBe("3/7");
    expect(formatProgress(null)).toBe("");
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abcd", 4)).toBe("abcd");
    // REQ-A: REQ-1, REQ-2, REQ-3, REQ-4.
    expect(actionsOf(row())).toEqual({ jump: true, show: true, open: true, msg: true });
    expect(actionsOf(row({ isSelf: true }))).toEqual({ jump: false, show: false, open: true, msg: false });
    expect(actionsOf(row({ isSelf: true, target: null, ticket: null, name: null }))).toEqual({ jump: false, show: false, open: false, msg: false });
    expect(actionsOf(row({ target: null, ticket: null, name: null }))).toEqual({ jump: false, show: true, open: false, msg: false });
    expect(messageText("api-child")).toBe("SendMessage to api-child: ");
  });

  for (const columns of [40, 60, 90, 140]) {
    test(`[REQ-1, REQ-3, REQ-6] TEST-1001 keeps required cells and fits the ${columns}-column band`, () => {
      const r = row({ progress: { done: 3, total: 7 }, waits: "release api 2.0" });
      const b = bandModel([r], columns, 20, false, NOW)!;
      expect(b).not.toBeNull();
      const p = planCells(b.rows, columns);
      expect(p.label).toBeGreaterThan(0);
      expect(p.status).toBeGreaterThan(0);
      expect(p.show).toBeGreaterThan(0);
      expect(Object.values(p).reduce((a, n) => a + n, 0)).toBeLessThanOrEqual(columns);
      expect(b.rows[0]).toMatchObject({ key: MANAGER, status: "idle" });
      if (columns < 60) {
        for (const field of ["indent", "role", "ticket", "progress", "detail", "jump", "open", "msg"] as const) expect(p[field]).toBe(0);
      }
      if (columns === 140) {
        // REQ-B: REQ-9.
        expect(b.rows[0]).toMatchObject({ role: "manager", progress: "3/7" });
        expect(p.role).toBeGreaterThan(0);
        expect(p.ticket).toBeGreaterThan(0);
        expect(p.progress).toBeGreaterThan(0);
      }
    });
  }

  test("[REQ-1, REQ-3, REQ-6] TEST-1002 overflow preserves ancestors and self, prioritises needsYou and leaves a More route", () => {
    const rows = [
      row({ key: TRIAGE, role: "triage", depth: 0 }),
      row({ isSelf: true }),
      row({ key: CHILD, depth: 2 }),
      row({ key: "s-blocked1", depth: 2, needsYou: true, status: "blocked" }),
      row({ key: "s-normal01", depth: 2 }),
    ];
    expect(pickRows(rows, 3).map(r => r.key)).toEqual([TRIAGE, MANAGER, "s-blocked1"]);
    const band = bandModel(rows, 140, 5, true, NOW)!;
    expect(band.header).toBe("orchestrator · 5 sessions · 1 needs you");
    expect(band.needYou).toBe(1);
    expect(band.panelOpen).toBe(true);
    expect(band.more).toBe(2);
    expect(band.rows.map(r => r.key)).toEqual([TRIAGE, MANAGER, "s-blocked1"]);
    expect(bandModel(rows, 140, 1, false, NOW)?.moreInHeader).toBe(true);
    expect(bandModel([], 140, 20, false, NOW)).toBeNull();
  });

  test("[REQ-1, REQ-3, REQ-6] TEST-1003 list paging makes every session reachable exactly once, with appropriate actions", () => {
    const rows = Array.from({ length: 13 }, (_, i) => row({ key: "s-session" + String(i).padStart(2, "0"), label: "session-" + i, name: "session-" + i, isSelf: i === 0, depth: i === 0 ? 0 : 1 }));
    const fit = { columns: 100, rows: 6 };
    expect(listPageSize(fit)).toBe(4);
    const seen: string[] = [];
    for (let page = 0; page < 4; page++) {
      const list = listModel(rows, fit, page, NOW);
      expect(list).toMatchObject({ kind: "list", page, pages: 4, prev: page > 0, next: page < 3 });
      seen.push(...list.lines.map(l => l.key));
      // REQ-A: REQ-6. The list carries the same self exclusions as the band.
      for (const line of list.lines) expect(line.actions).toEqual({ jump: !line.isSelf, show: !line.isSelf, open: true, msg: !line.isSelf });
    }
    expect(seen).toEqual(rows.map(r => r.key));
    expect(new Set(seen).size).toBe(rows.length);
  });

  test("[REQ-1, REQ-3, REQ-6] TEST-1004 inline fit has a 24-row floor and docked fit uses supplied body rows", () => {
    expect(panelFit({ bodyColumns: 80, placement: "inline", scroll: { bodyRows: 2 } })).toEqual({ columns: 80, rows: 24 });
    expect(panelFit({ bodyColumns: 100, placement: "dock", scroll: { bodyRows: 30 } })).toEqual({ columns: 100, rows: 30 });
  });

  test("[REQ-1, REQ-3, REQ-6] TEST-1004 session panel contains ordered dependencies, holds, tasks and clipped visible screen", () => {
    const closed = { kind: "release" as const, ref: "old 1.0", since: NOW - 3000, doneAt: NOW - 1000, note: null, open: false, problem: null };
    const open = { kind: "session" as const, ref: "api-child", since: NOW - 2000, doneAt: null, note: null, open: true, problem: "gone" as const };
    const r = row({ tasks: taskRows(), deps: [closed, open], holds: [{ what: "staging", since: NOW - 1000 }] });
    const screen: OrchestratorScreenState = { key: MANAGER, lines: ["visible screen", "x".repeat(80), ...Array.from({ length: 60 }, (_, i) => "line " + i)], at: NOW, error: null, misses: 0 };
    const m = sessionModel(r, screen, { columns: 40, rows: 24 }, "tmux", NOW);
    expect(m.kind).toBe("session");
    expect(m.title).toContain("api-manager");
    expect(m.title).toContain("manager");
    expect(m.title).toContain("example/product#7");
    const details = m.details.map(d => d.text).join("\n");
    expect(details).toContain("api-child");
    expect(details).toContain("gone");
    expect(details.indexOf("api-child")).toBeLessThan(details.indexOf("old 1.0"));
    expect(details).toContain("staging");
    expect(details).toContain("Build API");
    expect(details).toContain("Review");
    expect(m.details.find(d => d.text.includes("Build API"))?.dim).toBe(true);
    expect(m.screen.length).toBeGreaterThan(0);
    expect(m.screen).toEqual(screen.lines.slice(-m.screen.length));
    expect(m.screen.length).toBeLessThan(24);
    expect(m.screen.every(l => l.length <= 40)).toBe(true);
    expect(screenNote({ ...r, isSelf: true }, "tmux")).toBe("this session");
    expect(screenNote({ ...r, target: null }, "tmux")).toBe("no pane recorded for this session");
    expect(screenNote(r, "herdr")).toBe("not reachable from this multiplexer");
    expect(screenNote(r, "tmux")).toBeNull();
    expect(sessionModel({ ...r, isSelf: true }, screen, { columns: 100, rows: 24 }, "tmux", NOW).note).toBe("this session");
  });
  test("[REQ-B, REQ-8] TEST-1005 publishes role names, short forms and badge bounds from the spec", () => {
    expect(ROLE_BADGE).toEqual({ triage: "triage", manager: "manager", child: "worker" });
    expect(ROLE_SHORT).toEqual({ triage: "TR", manager: "MNG", child: "WRK" });
    expect(BADGE_PAD).toBe(2);
    expect(NARROW_COLUMNS).toBe(60);
  });

  test("[REQ-B, REQ-9] TEST-1006 exposes the name, short form and role key for every band role", () => {
    const rows = [
      row({ key: TRIAGE, role: "triage", depth: 0 }),
      row({ key: MANAGER, role: "manager", depth: 1 }),
      row({ key: CHILD, role: "child", depth: 2 }),
    ];

    const band = bandModel(rows, 200, 20, false, NOW)!;

    expect(band.rows.map(r => ({ role: r.role, roleShort: r.roleShort, roleKind: r.roleKind }))).toEqual([
      { role: "triage", roleShort: "TR", roleKind: "triage" },
      { role: "manager", roleShort: "MNG", roleKind: "manager" },
      { role: "worker", roleShort: "WRK", roleKind: "child" },
    ]);
  });

  test("[REQ-B, REQ-8, REQ-10] TEST-1007 uses full role widths, falls back to short forms and drops roles below the narrow boundary", () => {
    const rows = (["triage", "manager", "child"] as const).map((role, depth) => row({
      key: "badge-" + role, role, depth, label: role + "-session-with-a-long-name",
      progress: { done: 3, total: 7 }, waits: "release service 2.0",
      status: "working", since: NOW - 12_000, isSelf: false,
    }));
    const band = bandModel(rows, 200, 20, false, NOW)!;
    const nameWidth = 7 + BADGE_PAD;
    const shortWidth = 3 + BADGE_PAD;

    expect(planCells(band.rows, 200).role).toBe(nameWidth);

    // Search the public width range without assuming the other cells' drop order.
    const plans = Array.from({ length: 200 - NARROW_COLUMNS + 1 }, (_, i) => {
      const columns = NARROW_COLUMNS + i;
      return { columns, plan: planCells(band.rows, columns) };
    });
    expect(plans.some(({ plan }) => plan.role === shortWidth)).toBe(true);
    for (const { columns, plan } of plans) {
      expect([0, shortWidth, nameWidth]).toContain(plan.role);
      expect(Object.values(plan).reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(columns);
    }
    for (const columns of [0, 1, NARROW_COLUMNS - 1]) {
      expect(planCells(band.rows, columns).role).toBe(0);
    }

    const sparse = bandModel([row({
      role: "manager", depth: 0, label: "api", name: null, ticket: null,
      target: null, since: null, progress: null, waits: null, isSelf: false,
    })], 200, 20, false, NOW)!;
    expect(planCells(sparse.rows, NARROW_COLUMNS).role).toBe(nameWidth);
  });

  test("[REQ-C, REQ-13] TEST-1008 keeps status before age and sizes badges from statusText with a four-cell text floor", () => {
    const rows = [
      row({ key: MANAGER, status: "working", since: NOW - 12_000 }),
      row({ key: CHILD, role: "child", status: "idle", since: null }),
    ];

    const band = bandModel(rows, 200, 20, false, NOW)!;

    expect(band.rows.map(r => ({ status: r.status, age: r.age }))).toEqual([
      { status: "working", age: "12s" },
      { status: "idle", age: "" },
    ]);
    expect(band.rows[0].statusText).toMatch(/^working\s+12s$/);
    expect(band.rows[1].statusText).toBe("idle");
    const widestText = Math.max(4, ...band.rows.map(r => r.statusText.length));
    expect(planCells(band.rows, 200).status).toBe(widestText + BADGE_PAD);
    for (const statusText of ["", "x", "idle"]) {
      expect(planCells([{ ...band.rows[1], statusText }], 200).status).toBe(4 + BADGE_PAD);
    }
  });

  test("[REQ-C, REQ-14] TEST-1009 exposes list badge parts alongside a readable plain-text line", () => {
    const cases = [
      { role: "triage", label: "triage-session", depth: 0, roleName: "triage" },
      { role: "manager", label: "manager-session", depth: 1, roleName: "manager" },
      { role: "child", label: "worker-session", depth: 2, roleName: "worker" },
    ] as const;
    const rows = cases.map(({ role, label, depth }) => row({
      key: "list-" + role, role, label, depth, status: "idle",
      since: NOW - 180_000, progress: { done: 3, total: 7 },
    }));

    const list = listModel(rows, { columns: 100, rows: 24 }, 0, NOW);

    expect(list.lines).toHaveLength(cases.length);
    for (const [i, { role, label, depth, roleName }] of cases.entries()) {
      const line = list.lines[i];
      expect({ role: line.role, roleKind: line.roleKind, age: line.age, progress: line.progress }).toEqual({
        role: roleName, roleKind: role, age: "3m", progress: "3/7",
      });
      expect(line.lead).toMatch(depth === 0 ? /^○\s+/ : /^\s+○\s+/);
      expect(line.lead).toContain(label);
      expect(line.lead.indexOf("○")).toBeLessThan(line.lead.indexOf(label));
      expect(typeof line.text).toBe("string");
      expect(line.text).toContain(label);
    }
  });

  test("[REQ-C, REQ-14] TEST-1010 uses the worker short form when a list line cannot fit its name", () => {
    const worker = row({
      key: CHILD, role: "child", depth: 1, label: "worker-session",
      status: "idle", since: null, progress: null, waits: null,
    });

    const lines = Array.from({ length: 100 }, (_, i) =>
      listModel([worker], { columns: i + 1, rows: 24 }, 0, NOW).lines[0]);

    expect(lines[99].role).toBe("worker");
    const abbreviated = lines.filter(line => line.role === "WRK");
    expect(abbreviated.length).toBeGreaterThan(0);
    for (const line of abbreviated) {
      expect({ roleKind: line.roleKind, age: line.age, progress: line.progress }).toEqual({
        roleKind: "child", age: "", progress: "",
      });
    }
  });

  test("[REQ-C, REQ-15] TEST-1011 exposes session state, age and progress/waits after the status", () => {
    const cases = [
      { status: "working", since: NOW - 12_000, progress: { done: 3, total: 7 }, waits: null, needsYou: false, word: "working", age: "12s", rest: ["3/7 done"] },
      { status: "waiting", since: NOW - 180_000, progress: { done: 3, total: 7 }, waits: "approval", needsYou: true, word: "needs you", age: "3m", rest: ["3/7 done", "? approval"] },
      { status: "idle", since: null, progress: null, waits: null, needsYou: false, word: "idle", age: "", rest: [] },
    ] as const;

    for (const { status, since, progress, waits, needsYou, word, age, rest } of cases) {
      const r = row({ status, since, progress, waits, needsYou });
      const screen: OrchestratorScreenState = { key: r.key, lines: [], at: NOW, error: null, misses: 0 };

      const session = sessionModel(r, screen, { columns: 100, rows: 24 }, "tmux", NOW);

      expect({ state: session.state, age: session.age }).toEqual({ state: status, age });
      expect(session.status).toContain(word);
      if (age) {
        expect(session.status).toContain(age);
        expect(session.status.indexOf(age)).toBeGreaterThan(session.status.indexOf(word));
        expect(session.statusRest).not.toContain(age);
      }
      expect(session.statusRest).not.toContain(word);
      for (const part of rest) expect(session.statusRest).toContain(part);
      if (rest.length === 0) {
        expect(session.statusRest).toBe("");
      } else {
        expect(session.status).toContain(session.statusRest);
        expect(session.status.indexOf(session.statusRest)).toBeGreaterThan(session.status.indexOf(word));
      }
    }
  });

  test("[REQ-B, REQ-12] TEST-1012 titles a child session with the worker role name", () => {
    const worker = row({
      key: CHILD, role: "child", label: "deploy-worker",
      ticket: { id: "example/service#8", url: null },
    });
    const screen: OrchestratorScreenState = { key: CHILD, lines: [], at: NOW, error: null, misses: 0 };

    const session = sessionModel(worker, screen, { columns: 100, rows: 24 }, "tmux", NOW);

    expect(session.title).toBe("deploy-worker · worker · example/service#8");
  });

});

const TICKET_ROW = { id: "ABC-463", url: "https://example.test/ABC-463" };
const screenOf = (key: string): OrchestratorScreenState => ({ key, lines: [], at: NOW, error: null, misses: 0 });
const sessionDep = (ref: string, patch: Partial<OrchestratorRowDep> = {}): OrchestratorRowDep =>
  ({ kind: "session", ref, note: null, since: NOW - 2000, doneAt: null, open: true, problem: null, label: null, ...patch });

describe("one line per session on the band", () => {
  test("TEST-1101 a ticket-led label drops the ticket cell and shortens by its name part, never the ticket id", () => {
    const led = row({ key: CHILD, name: "abc-463-auth-config-dir-key", label: "ABC-463 auth-config-dir-key", labelTicket: "ABC-463", ticket: TICKET_ROW });
    const plain = row({ key: TRIAGE, role: "triage", depth: 0, name: "triage2", label: "triage2", ticket: null });
    const band = bandModel([plain, led], 200, 20, false, NOW)!;
    const ledRow = band.rows.find(r => r.key === CHILD)!;
    expect(ledRow.ticket).toBe("");
    expect(band.plan.ticket).toBe(0);
    expect(fitLabel("ABC-463 auth-config-dir-key", "ABC-463", 100)).toBe("ABC-463 auth-config-dir-key");
    expect(fitLabel("ABC-463 auth-config-dir-key", "ABC-463", 15)).toBe("ABC-463 auth-c…");
    for (const width of [7, 8, 9]) expect(fitLabel("ABC-463 auth-config-dir-key", "ABC-463", width)).toStartWith("ABC-463");
    // below the ticket id's own width the id itself is cut, to fit the cell
    expect(fitLabel("ABC-463 auth-config-dir-key", "ABC-463", 5)).toBe("ABC-…");
    expect(fitLabel("ABC-463 auth-config-dir-key", "ABC-463", 1)).toBe("…");
    expect(fitLabel("triage-with-a-long-name", null, 10)).toBe("triage-wi…");
    // the drawn label is already fitted to the label cell
    expect([...ledRow.label].length).toBeLessThanOrEqual(band.plan.label);
    expect(ledRow.label).toStartWith("ABC-463 ");
    // a name that is not led by the ticket keeps the ticket cell
    const other = bandModel([row({ ticket: TICKET_ROW, label: "api-manager", labelTicket: null })], 200, 20, false, NOW)!;
    expect(other.rows[0].ticket).toBe("ABC-463");
    expect(other.plan.ticket).toBeGreaterThan(0);
  });

  test("TEST-1102 the header counts sessions, need you, waiting and done, each only above zero", () => {
    const rows = [
      row({ key: TRIAGE, role: "triage", depth: 0, status: "working" }),
      row({ key: "s-needs0001", status: "blocked", needsYou: true, waits: "choose scope" }),
      row({ key: "s-wait00001", status: "waiting", needsYou: false }),
      row({ key: "s-ask000001", status: "waiting", needsYou: true }),
      row({ key: "s-done00001", status: "done" }),
      row({ key: "s-done00002", status: "done" }),
    ];
    expect(bandModel(rows, 200, 20, false, NOW)!.header).toBe("orchestrator · 6 sessions · 2 need you · 1 waiting · 2 done");
    expect(bandModel([row({ status: "working" })], 200, 20, false, NOW)!.header).toBe("orchestrator · 1 session");
    expect(bandModel([row({ status: "waiting" }), row({ key: CHILD, status: "done" })], 200, 20, false, NOW)!.header).toBe("orchestrator · 2 sessions · 1 waiting · 1 done");
  });

  test("TEST-1103 the last column: needs you, then an open session dependency, then other deps, then the step in progress or next", () => {
    const tasks = [
      { n: 1, step: "Done step", who: "this session", state: "Done" },
      { n: 2, step: "Next step", who: "this session", state: "Next" },
      { n: 3, step: "Current step", who: "this session", state: "In progress, half way" },
    ];
    const pr = { kind: "pr" as const, ref: "https://example.test/pr/1", note: null, since: NOW - 3000, doneAt: null, open: true, problem: null };
    const cases: [Partial<OrchestratorRow>, string][] = [
      [{ needsYou: true, status: "blocked", waits: "Approve the schema", deps: [sessionDep("x", { label: "ABC-427 status-poll" })], tasks }, "? Approve the schema"],
      [{ status: "waiting", deps: [pr, sessionDep("abc-427-status-poll", { label: "ABC-427 status-poll", note: "hooks/status/ redesign" })], tasks }, "⇠ ABC-427 status-poll (hooks/status/ redesign)"],
      [{ status: "waiting", deps: [sessionDep("api-child")], tasks }, "⇠ api-child"],
      [{ status: "waiting", deps: [pr, sessionDep("api-child", { open: false })], tasks }, "⇠ pr https://example.test/pr/1"],
      [{ status: "working", tasks }, "▶ Current step"],
      [{ status: "working", tasks: tasks.slice(0, 2) }, "▶ Next step"],
      [{ status: "done", tasks }, ""],
      [{ status: "working", tasks: tasks.slice(0, 1) }, ""],
      [{ status: "idle" }, ""],
    ];
    for (const [patch, expected] of cases) expect(rowDetail(row(patch)).text).toBe(expected);
    expect(rowDetail(row({ needsYou: true, status: "waiting", waits: "permission" })).tone).toBe("attention");
    const band = bandModel([row({ status: "working", tasks })], 200, 20, false, NOW)!;
    expect(band.rows[0].detail).toBe("▶ Current step");
    expect(band.plan.detail).toBeGreaterThan(0);
  });

  test("TEST-1104 a row that needs the user draws the warning glyph", () => {
    const band = bandModel([row({ needsYou: true, status: "blocked" }), row({ key: CHILD, status: "working" })], 200, 20, false, NOW)!;
    expect(band.rows.map(r => r.glyph)).toEqual(["⚠", "●"]);
  });

  test("TEST-1106 a row waiting on something other than the user draws ◷", () => {
    const band = bandModel([row({ status: "waiting" }), row({ key: CHILD, status: "waiting", needsYou: true })], 200, 20, false, NOW)!;
    expect(band.rows.map(r => r.glyph)).toEqual(["◷", "⚠"]);
    expect(listModel([row({ status: "waiting" })], { columns: 100, rows: 24 }, 0, NOW).lines[0].lead).toContain("◷");
  });

  test("TEST-1107 a row that needs the user reads `needs you` with its age, wherever its status is shown", () => {
    const r = row({ status: "blocked", needsYou: true, since: NOW - 240_000, waits: "Approve" });
    const band = bandModel([r], 200, 20, false, NOW)!;
    expect(band.rows[0]).toMatchObject({ status: "blocked", statusWord: "needs you", statusText: "needs you 4m", age: "4m" });
    expect(planCells(band.rows, 200).status).toBe("needs you 4m".length + BADGE_PAD);
    const line = listModel([r], { columns: 100, rows: 24 }, 0, NOW).lines[0];
    expect(line).toMatchObject({ status: "blocked", statusWord: "needs you" });
    expect(line.text).toContain("needs you 4m");
    expect(line.text).not.toContain("blocked");
    const s = sessionModel(r, screenOf(MANAGER), { columns: 100, rows: 24 }, "tmux", NOW);
    expect(s).toMatchObject({ state: "blocked", statusWord: "needs you" });
    expect(s.status).toBe("needs you 4m · ? Approve");
    // a row that does not need the user keeps its status word
    expect(bandModel([row({ status: "waiting" })], 200, 20, false, NOW)!.rows[0].statusWord).toBe("waiting");
  });

  test("TEST-1108 a narrow band never plans a row wider than itself: the age goes first, then the ticket-id floor", () => {
    const r = row({
      key: CHILD, status: "blocked", needsYou: true, since: NOW - 12 * 60_000,
      label: "ABC-4630 a-rather-long-session-name", labelTicket: "ABC-4630", ticket: { id: "ABC-4630", url: null },
    });
    const drawn = (columns: number) => bandModel([r], columns, 20, false, NOW)!;
    const glyph = 2, gap = 1;
    const bare = "needs you".length + BADGE_PAD;
    const oldMinimum = glyph + 1 + gap + bare + gap + BUTTON_CELLS.show;
    for (let columns = oldMinimum; columns < NARROW_COLUMNS; columns++) {
      const b = drawn(columns);
      const p = b.plan;
      expect(glyph + p.label + gap + p.status + gap + p.show).toBeLessThanOrEqual(columns);
      // what is drawn fits what was planned
      expect([...b.rows[0].label].length).toBeLessThanOrEqual(p.label);
      expect(b.rows[0].statusText.length + BADGE_PAD).toBeLessThanOrEqual(p.status);
    }
    // the age is dropped before the label gives up its ticket id
    const tight = drawn(glyph + "ABC-4630".length + gap + bare + gap + BUTTON_CELLS.show);
    expect(tight.rows[0]).toMatchObject({ statusText: "needs you", age: "", label: "ABC-4630" });
    // with room, the age stays
    expect(drawn(NARROW_COLUMNS - 1).rows[0]).toMatchObject({ statusText: "needs you 12m", age: "12m" });
  });

  test("TEST-1105 a refused ps reads in the header, in the error tone", () => {
    const rows = [row({ status: "unknown" }), row({ key: CHILD, status: "unknown" })];
    const band = bandModel(rows, 200, 20, false, NOW, "ps refused (operation not permitted)")!;
    expect(band.header).toBe("orchestrator · 2 sessions · ⚠ states unreadable: ps refused (operation not permitted)");
    expect(band.headerTone).toBe("error");
    expect(bandModel(rows, 200, 20, false, NOW)!.headerTone).toBe("plain");
    expect(bandModel([row({ needsYou: true })], 200, 20, false, NOW)!.headerTone).toBe("attention");
  });
});

describe("the session view's tasks and family", () => {
  test("TEST-1111 wraps at word boundaries and never cuts with an ellipsis", () => {
    expect(wrapText("Find why claude-fable-5-2 and minimax-m3 have no effort rows in the bundled list", 30)).toEqual([
      "Find why claude-fable-5-2 and",
      "minimax-m3 have no effort rows",
      "in the bundled list",
    ]);
    expect(wrapText("short", 30)).toEqual(["short"]);
    expect(wrapText("abcdefghij klm", 4)).toEqual(["abcd", "efgh", "ij", "klm"]);
    for (const line of wrapText("a ".repeat(40) + "end", 7)) expect([...line].length).toBeLessThanOrEqual(7);
    const long = "Find why claude-fable-5-2 and minimax-m3 have no effort rows in the bundled list";
    const m = sessionModel(row({ tasks: [{ n: 1, step: long, who: "this session", state: "In progress" }] }), screenOf(MANAGER), { columns: 40, rows: 40 }, "tmux", NOW);
    const text = m.details.map(d => d.text);
    expect(text.join("\n")).not.toContain("…");
    expect(text.every(t => [...t].length <= 40)).toBe(true);
    const first = text.findIndex(t => t.startsWith(" ▶ 1  "));
    expect(first).toBeGreaterThan(-1);
    // continuation lines hang under the step text
    expect(text[first + 1]).toMatch(/^ {6}\S/);
    expect(text.slice(first, first + 4).map(t => t.trim().replace(/^▶ 1\s+/, "")).join(" ")).toContain("in the bundled list");
  });

  test("TEST-1112 groups tasks into Now, Next and Done, dims Done and skips empty groups", () => {
    const tasks = [
      { n: 1, step: "Build API", who: "this session", state: "Done verified" },
      { n: 2, step: "Review", who: "this session", state: "In progress" },
      { n: 3, step: "Ship", who: "this session", state: "Next" },
      { n: 4, step: "Old scope", who: "this session", state: "moved elsewhere" },
    ];
    const m = sessionModel(row({ tasks, progress: { done: 1, total: 3 } }), screenOf(MANAGER), { columns: 80, rows: 40 }, "tmux", NOW);
    const text = m.details.map(d => d.text);
    const at = (s: string) => text.indexOf(s);
    expect(at("Now")).toBeLessThan(at(" ▶ 2  Review"));
    expect(at(" ▶ 2  Review")).toBeLessThan(at("Next"));
    expect(at("Next")).toBeLessThan(at(" ○ 3  Ship"));
    expect(at(" ○ 3  Ship")).toBeLessThan(at("Done"));
    expect(at("Done")).toBeLessThan(at(" ✓ 1  Build API"));
    expect(m.details[at(" ✓ 1  Build API")].dim).toBe(true);
    expect(m.details[at(" ✓ 4  Old scope")].dim).toBe(true);
    expect(m.details[at(" ○ 3  Ship")].dim).toBe(false);
    expect(m.status).toBe("idle 3m · 1/3 done");
    const nowOnly = sessionModel(row({ tasks: tasks.slice(1, 2) }), screenOf(MANAGER), { columns: 80, rows: 40 }, "tmux", NOW);
    expect(nowOnly.details.map(d => d.text)).not.toContain("Next");
    expect(nowOnly.details.map(d => d.text)).not.toContain("Done");
  });

  test("TEST-1113 the dim second line names who and maps waited-on row numbers to their steps", () => {
    const tasks = [
      { n: 1, step: "Find why the rows are missing", who: "this session", state: "In progress" },
      { n: 2, step: "Effort rows for both models", who: "This Session", state: "Waiting on 1" },
      { n: 3, step: "Publish gate", who: "this session", state: "Done" },
      { n: 4, step: "Release models-index, list regenerated", who: "this session", state: "Waits on 2 and 3" },
      { n: 5, step: "generate exits 0", who: "release child", state: "Waiting on 4" },
      { n: 6, step: "Ask the reviewer", who: "user", state: "Waiting on the reviewer" },
      { n: 7, step: "Plain", who: "this session", state: "Next" },
    ];
    expect(taskWait(tasks[1], tasks)).toBe("after 1 Find why");
    expect(taskWait(tasks[3], tasks)).toBe("after 2 Effort rows · 3 Publish gate");
    expect(taskWait(tasks[5], tasks)).toBe("Waiting on the reviewer");
    expect(taskWait(tasks[6], tasks)).toBeNull();
    expect(taskWait({ n: 8, step: "x", who: "", state: "Waiting on 9" }, tasks)).toBe("Waiting on 9");
    // only a pure list of row numbers maps to rows; anything else reads as written
    expect(taskWait({ n: 8, step: "x", who: "", state: "Waiting on v2 of 3 reviews" }, tasks)).toBe("Waiting on v2 of 3 reviews");
    expect(taskWait({ n: 8, step: "x", who: "", state: "Waiting on 2 reviewers" }, tasks)).toBe("Waiting on 2 reviewers");
    expect(taskWait({ n: 8, step: "x", who: "", state: "waits on 1 & 3" }, tasks)).toBe("after 1 Find why · 3 Publish gate");
    expect(taskWait({ n: 8, step: "x", who: "", state: "Waiting on 1,2" }, tasks)).toBe("after 1 Find why · 2 Effort rows");
    const m = sessionModel(row({ tasks }), screenOf(MANAGER), { columns: 100, rows: 60 }, "tmux", NOW);
    const lines = m.details;
    const after = (n: number) => lines[lines.findIndex(l => l.text.startsWith(` ○ ${n}  `)) + 1]!;
    expect(after(2)).toEqual({ text: "      after 1 Find why", dim: true, tone: "plain" });
    expect(after(4).text).toBe("      after 2 Effort rows · 3 Publish gate");
    expect(after(5).text).toBe("      release child · after 4 Release models-index,");
    expect(after(6).text).toBe("      user · Waiting on the reviewer");
    expect(lines[lines.findIndex(l => l.text.startsWith(" ○ 7  ")) + 1]?.text.startsWith("      ")).not.toBe(true);
  });

  test("TEST-1114 the family block lists who waits on this session, then what it waits on", () => {
    const self = row({
      isSelf: true, label: "ABC-424 effort-rows-publish", labelTicket: "ABC-424", ticket: { id: "ABC-424", url: null },
      waitedOnBy: [{ key: TRIAGE, label: "triage2", role: "triage" }],
    });
    const m = sessionModel(self, screenOf(MANAGER), { columns: 100, rows: 40 }, "tmux", NOW);
    expect(m.title).toBe("ABC-424 effort-rows-publish · manager");
    const text = m.details.map(d => d.text);
    const fam = text.indexOf("Family");
    expect(fam).toBeGreaterThan(-1);
    expect(text.slice(fam + 1)).toEqual([" triage2 (triage) ⇠ waits on this session", " this session ⇠ waits on nothing"]);

    const other = row({
      label: "ABC-509 tmux-herdr", labelTicket: "ABC-509", ticket: { id: "ABC-509", url: null },
      deps: [sessionDep("abc-427-status-poll", { label: "ABC-427 status-poll" }), sessionDep("gone-one", { open: false, label: "gone-one" }), sessionDep("unknown-ref", { problem: "not found" })],
      waitedOnBy: [{ key: CHILD, label: "release-child", role: "child" }],
    });
    const o = sessionModel(other, screenOf(MANAGER), { columns: 100, rows: 40 }, "tmux", NOW).details.map(d => d.text);
    expect(o.slice(o.indexOf("Family") + 1)).toEqual([
      " release-child (worker) ⇠ waits on ABC-509 tmux-herdr",
      " ABC-509 tmux-herdr ⇠ waits on ABC-427 status-poll",
      " ABC-509 tmux-herdr ⇠ waits on unknown-ref",
    ]);
    // the family block comes after the tasks
    const withTasks = sessionModel({ ...self, tasks: [{ n: 1, step: "Step", who: "this session", state: "Next" }] }, screenOf(MANAGER), { columns: 100, rows: 40 }, "tmux", NOW).details.map(d => d.text);
    expect(withTasks.indexOf(" ○ 1  Step")).toBeLessThan(withTasks.indexOf("Family"));
  });
});
