import { describe, expect, test } from "bun:test";
import {
  formatAge, formatProgress, clip, actionsOf, messageText, planCells, pickRows,
  bandModel, panelFit, listPageSize, listModel, screenNote, sessionModel,
} from "./layout";
import { BADGE_PAD, NARROW_COLUMNS, ROLE_BADGE, ROLE_SHORT } from "./domain";
import { row, NOW, MANAGER, TRIAGE, CHILD, taskRows } from "../../tests/testdata";
import type { OrchestratorScreenState } from "../../types";

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
        for (const field of ["indent", "role", "ticket", "progress", "waits", "jump", "open", "msg"] as const) expect(p[field]).toBe(0);
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
      { status: "working", since: NOW - 12_000, progress: { done: 3, total: 7 }, waits: null, age: "12s", rest: ["3/7"] },
      { status: "waiting", since: NOW - 180_000, progress: { done: 3, total: 7 }, waits: "release api 2.0", age: "3m", rest: ["3/7", "release api 2.0"] },
      { status: "idle", since: null, progress: null, waits: null, age: "", rest: [] },
    ] as const;

    for (const { status, since, progress, waits, age, rest } of cases) {
      const r = row({ status, since, progress, waits });
      const screen: OrchestratorScreenState = { key: r.key, lines: [], at: NOW, error: null, misses: 0 };

      const session = sessionModel(r, screen, { columns: 100, rows: 24 }, "tmux", NOW);

      expect({ state: session.state, age: session.age }).toEqual({ state: status, age });
      expect(session.status).toContain(status);
      if (age) {
        expect(session.status).toContain(age);
        expect(session.status.indexOf(age)).toBeGreaterThan(session.status.indexOf(status));
        expect(session.statusRest).not.toContain(age);
      }
      expect(session.statusRest).not.toContain(status);
      for (const part of rest) expect(session.statusRest).toContain(part);
      if (rest.length === 0) {
        expect(session.statusRest).toBe("");
      } else {
        expect(session.status).toContain(session.statusRest);
        expect(session.status.indexOf(session.statusRest)).toBeGreaterThan(session.status.indexOf(status));
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
