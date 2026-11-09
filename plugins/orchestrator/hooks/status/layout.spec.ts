import { describe, expect, test } from "bun:test";
import {
  formatAge, formatProgress, clip, actionsOf, messageText, planCells, pickRows,
  bandModel, panelFit, listPageSize, listModel, screenNote, sessionModel,
} from "./layout";
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
    expect(actionsOf(row())).toEqual({ jump: true, show: true, open: true, msg: true });
    expect(actionsOf(row({ isSelf: true }))).toEqual({ jump: false, show: true, open: true, msg: false });
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
        expect(b.rows[0]).toMatchObject({ role: "M", progress: "3/7" });
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
      for (const line of list.lines) expect(line.actions).toEqual({ jump: !line.isSelf, show: true, open: true, msg: !line.isSelf });
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
});
