import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUTS, planLayout, mainColumnsShare, roundRatio, planArgs, parsePaneLayout, parsePaneList, checkApplied, recoveryTarget, type LayoutPlan, type LayoutRequest, type PaneLayoutView } from "./pane-layout";

const capture = (name: string) => readFileSync(join(import.meta.dir, "testdata", name), "utf8");
function planned(req: LayoutRequest): LayoutPlan {
  const r = planLayout(req);
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}
const tuples: [number, number, [string, string, "right" | "down", number][]][] = [
  [0, 1, []],
  [1, .5, [["c1", "M", "right", .5]]],
  [2, .5, [["c1", "M", "right", .5], ["c2", "c1", "down", .5]]],
  [3, .3333, [["c1", "M", "right", .3333], ["c3", "c1", "right", .5], ["c2", "c1", "down", .5]]],
  [4, .3333, [["c1", "M", "right", .3333], ["c3", "c1", "right", .5], ["c2", "c1", "down", .5], ["c4", "c3", "down", .5]]],
  [5, .3, [["c1", "M", "right", .3], ["c3", "c1", "right", .3333], ["c5", "c3", "right", .5], ["c2", "c1", "down", .5], ["c4", "c3", "down", .5]]],
  [6, .3, [["c1", "M", "right", .3], ["c3", "c1", "right", .3333], ["c5", "c3", "right", .5], ["c2", "c1", "down", .5], ["c4", "c3", "down", .5], ["c6", "c5", "down", .5]]],
];
describe("pure herdr move plans", () => {
  for (const [n, share, moves] of tuples) test("[REQ-407, REQ-408] TEST-2001 main-columns with " + n + " children equals the complete specified plan", () => {
    const children = Array.from({ length: n }, (_, i) => "c" + (i + 1));
    const columns = Array.from({ length: Math.ceil(n / 2) }, (_, i) => children.slice(2 * i, 2 * i + 2));

    expect(planLayout({ layout: "main-columns", panes: ["M", ...children], focused: "M" })).toEqual({
      ok: true, plan: { layout: "main-columns", anchor: "M", park: children,
        order: ["M", ...children], mainShare: share, columns,
        moves: moves.map(([pane, target, direction, ratio]) => ({ pane, target, direction, ratio, focus: false })) },
    });
    expect(mainColumnsShare(n)).toBe(share);
  });
  test("[REQ-407, REQ-408] TEST-2002 preserves the non-sorted P3 split-tree order field for field", () => {
    expect(planLayout({ layout: "main-columns", panes: ["w1:p1", "w1:p2", "w1:p4", "w1:p3"], focused: "w1:p1" })).toEqual({
      ok: true, plan: { layout: "main-columns", anchor: "w1:p1", park: ["w1:p2", "w1:p4", "w1:p3"],
        moves: [
          { pane: "w1:p2", target: "w1:p1", direction: "right", ratio: .3333, focus: false },
          { pane: "w1:p3", target: "w1:p2", direction: "right", ratio: .5, focus: false },
          { pane: "w1:p4", target: "w1:p2", direction: "down", ratio: .5, focus: false },
        ], order: ["w1:p1", "w1:p2", "w1:p4", "w1:p3"], mainShare: .3333, columns: [["w1:p2", "w1:p4"], ["w1:p3"]] },
    });
  });
  for (const layout of LAYOUTS) test("[REQ-407] TEST-2003 " + layout + " retains opaque order, selects main and marks only the focused replay", () => {
    const ids = Object.freeze(["w1:pB", "w1:p9", "w1:pA", "w1:p2"]);
    const mirrored = layout.endsWith("-mirrored");
    const p = planned({ layout, panes: ids, main: "w1:p9", focused: "w1:pA" });
    expect(p.order).toEqual(mirrored ? ["w1:pB", "w1:pA", "w1:p2", "w1:p9"] : ["w1:p9", "w1:pB", "w1:pA", "w1:p2"]);
    expect(p.anchor).toBe(mirrored ? "w1:pB" : "w1:p9");
    expect(p.park).toEqual(ids.filter(id => id !== p.anchor));
    expect(p.moves.filter(m => m.focus).map(m => m.pane)).toEqual(["w1:pA"]);
    for (const focused of [p.anchor, "not-here", null]) {
      expect(planned({ layout, panes: ids, focused }).moves.every(m => !m.focus || m.pane === focused)).toBe(true);
    }
    const def = planned({ layout, panes: ids });
    expect(def.order).toEqual([...ids]);
    expect(def.anchor).toBe(ids[0]!);
    if (layout !== "main-columns") { expect(p.mainShare).toBeNull(); expect(p.columns).toEqual([]); }
    expect(ids).toEqual(["w1:pB", "w1:p9", "w1:pA", "w1:p2"]);
  });
  const otherPlans = [
    ["even-horizontal", [["B", "A", "right", .3333], ["C", "B", "right", .5]]],
    ["even-vertical", [["B", "A", "down", .3333], ["C", "B", "down", .5]]],
    ["main-vertical", [["B", "A", "right", .6], ["C", "B", "down", .5]]],
    ["main-horizontal", [["B", "A", "down", .6], ["C", "B", "right", .5]]],
    ["main-vertical-mirrored", [["C", "A", "right", .4], ["B", "A", "down", .5]]],
    ["main-horizontal-mirrored", [["C", "A", "down", .4], ["B", "A", "right", .5]]],
    ["tiled", [["C", "A", "down", .5], ["B", "A", "right", .5]]],
  ] as const;
  for (const [layout, expected] of otherPlans) test("[REQ-407] TEST-2004 " + layout + " uses the specified axes and target shares", () => {
    expect(planned({ layout, panes: ["A", "B", "C"] }).moves).toEqual(expected.map(([pane, target, direction, ratio]) => ({ pane, target, direction, ratio, focus: false })));
    const single = planned({ layout, panes: ["A"] });
    expect(single).toMatchObject({ anchor: "A", park: [], moves: [], order: ["A"], mainShare: null, columns: [] });
  });
  for (let n = 7; n <= 12; n++) test("[REQ-408] TEST-2005 " + n + " children keep the 30 percent floor", () => {
    const ids = Array.from({ length: n + 1 }, (_, i) => "p" + i);
    const p = planned({ layout: "main-columns", panes: ids });
    expect(p.mainShare).toBe(.3);
    expect(p.columns.length).toBe(Math.ceil(n / 2));
    expect(p.columns.flat()).toEqual(ids.slice(1));
    expect(p.order).toEqual(ids);
  });
  test("[REQ-408] TEST-2005 custom floor and column size alter shares without losing panes", () => {
    const p = planned({ layout: "main-columns", panes: ["M", "a", "b", "c", "d"], mainMin: .4, columnSize: 3 });
    expect(p.mainShare).toBe(.4); expect(p.columns).toEqual([["a", "b", "c"], ["d"]]);
    expect(p.moves).toEqual([
      { pane: "a", target: "M", direction: "right", ratio: .4, focus: false },
      { pane: "d", target: "a", direction: "right", ratio: .5, focus: false },
      { pane: "b", target: "a", direction: "down", ratio: .3333, focus: false },
      { pane: "c", target: "b", direction: "down", ratio: .5, focus: false },
    ]);
    expect(mainColumnsShare(0, .4, 3)).toBe(1);
    expect(mainColumnsShare(6, .1, 3)).toBe(.3333);
    expect(roundRatio(1 / 3)).toBe(.3333);
    expect(roundRatio(.123456)).toBe(.1235);
    expect(planned({ layout: "main-vertical", panes: ["M", "a"], mainShare: .7 }).moves[0]!.ratio).toBe(.7);
  });
  const invalid: [Partial<LayoutRequest>, string][] = [
    [{ layout: "missing" }, 'unknown layout "missing"; one of:'],
    [{ panes: [] }, "no panes"],
    [{ panes: [""] }, "invalid pane id"],
    [{ panes: ["a b"] }, "invalid pane id"],
    [{ panes: ["a\nb"] }, "invalid pane id"],
    [{ panes: ["a", "a"] }, 'pane listed twice: "a"'],
    [{ main: "not-here" }, 'main pane "not-here" is not in the tab'],
    ...["mainMin", "mainShare"].flatMap(k => [0, 1, -1, Infinity, NaN].map(v => [{ [k]: v }, "invalid " + k] as [Partial<LayoutRequest>, string])),
    ...[0, -1, 1.5, Infinity, NaN].map(v => [{ columnSize: v }, "invalid columnSize"] as [Partial<LayoutRequest>, string]),
  ];
  for (const [bad, prefix] of invalid) test("[REQ-409] TEST-2006 rejects " + JSON.stringify(bad) + " without throwing", () => {
    const result = planLayout({ layout: "main-columns", panes: ["M", "a"], ...bad });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Invalid request was accepted");
    expect(result.error.startsWith(prefix)).toBe(true);
  });
  test("[REQ-409] TEST-2007 planArgs emits parks first, four decimals and explicit focus", () => {
    const p = planned({ layout: "main-columns", panes: ["M", "c1", "c2", "c3"], focused: "c2" });
    expect(planArgs(p, "T")).toEqual([
      ["pane", "move", "c1", "--new-tab", "--no-focus"],
      ["pane", "move", "c2", "--new-tab", "--no-focus"],
      ["pane", "move", "c3", "--new-tab", "--no-focus"],
      ["pane", "move", "c1", "--tab", "T", "--target-pane", "M", "--split", "right", "--ratio", "0.3333", "--no-focus"],
      ["pane", "move", "c3", "--tab", "T", "--target-pane", "c1", "--split", "right", "--ratio", "0.5000", "--no-focus"],
      ["pane", "move", "c2", "--tab", "T", "--target-pane", "c1", "--split", "down", "--ratio", "0.5000", "--focus"],
    ]);
    expect(() => planArgs(p, "")).toThrow(Error);
  });
  test("[REQ-409] TEST-2008 parses the captured geometry, zoom and split-tree array order", () => {
    const v = parsePaneLayout(capture("herdr-pane-layout.json"));
    expect(v).toEqual({ tabId: "w1:t1", area: { x: 0, y: 0, width: 174, height: 49 }, focused: "w1:p1", zoomed: false, panes: [
      { id: "w1:p1", rect: { x: 0, y: 0, width: 58, height: 49 } },
      { id: "w1:p2", rect: { x: 58, y: 0, width: 58, height: 25 } },
      { id: "w1:p3", rect: { x: 58, y: 25, width: 58, height: 24 } },
      { id: "w1:p4", rect: { x: 116, y: 0, width: 58, height: 49 } },
    ] });
    expect(parsePaneLayout(capture("herdr-pane-layout-zoomed.json"))?.zoomed).toBe(true);
    for (const text of ["", "{", "null", "[]", "{}", '{"result":{"layout":{"panes":[]}}}', '{"result":{"layout":{"tab_id":"T","panes":[{}]}}}']) expect(parsePaneLayout(text)).toBeNull();
  });
  test("[REQ-409] TEST-2009 a pane list is complete or unusable, never partially witnessed", () => {
    const text = capture("herdr-pane-list.json"), raw = JSON.parse(text);
    const live = parsePaneList(text);
    expect(live && [...live]).toEqual(raw.result.panes.map((p: { pane_id: string; terminal_id: string }) => [p.pane_id, p.terminal_id]));
    for (const key of ["pane_id", "terminal_id"]) for (const bad of [undefined, "", null, 1]) {
      const broken = structuredClone(raw); broken.result.panes[0][key] = bad;
      expect(parsePaneList(JSON.stringify(broken))).toBeNull();
    }
    for (const text of ["", "{", "null", "[]", "{}", '{"result":{"panes":{}}}']) expect(parsePaneList(text)).toBeNull();
    expect([...parsePaneList('{"result":{"panes":[]}}')!]).toEqual([]);
  });
});
describe("layout verification", () => {
  const valid = () => parsePaneLayout(capture("herdr-pane-layout.json"))!;
  const p = () => planned({ layout: "main-columns", panes: ["w1:p1", "w1:p2", "w1:p3", "w1:p4"] });
  test("[REQ-410] TEST-2010 accepts measured three-child and odd-width five-child layouts", () => {
    expect(checkApplied(valid(), p(), "w1:p1")).toBeNull();
    const v = parsePaneLayout(capture("herdr-pane-layout-5-children.json"))!;
    expect(checkApplied(v, planned({ layout: "main-columns", panes: v.panes.map(p => p.id) }), v.focused)).toBeNull();
  });
  const failures: [string, (v: PaneLayoutView) => void, RegExp][] = [
    ["order", v => { [v.panes[1], v.panes[2]] = [v.panes[2]!, v.panes[1]!]; }, /^order after layout differs:/],
    ["focus", v => { v.focused = "w1:p2"; }, /^focus moved from w1:p1 to w1:p2/],
    ["missing area", v => { v.area = null; }, /^layout has no rects/],
    ["missing rect", v => { v.panes[2]!.rect = null; }, /^layout has no rects/],
    ["main width", v => { v.panes[0]!.rect!.width += 2; }, /^main pane is /],
    ["main x", v => { v.panes[0]!.rect!.x++; }, /^main pane is /],
    ["main height", v => { v.panes[0]!.rect!.height--; }, /^main pane is /],
    ["column width", v => { v.panes[3]!.rect!.width += 2; }, /^columns are uneven:/],
    ["column x", v => { v.panes[2]!.rect!.x++; }, /^columns are uneven:/],
    ["reverse columns", v => { v.panes[3]!.rect!.x = 0; }, /^columns are uneven:/],
    ["rows unequal", v => { v.panes[1]!.rect!.height = 30; v.panes[2]!.rect!.height = 19; }, /^column .*rows are uneven:/],
    ["rows sum", v => { v.panes[1]!.rect!.height = 20; v.panes[2]!.rect!.height = 20; }, /^column .*rows are uneven:/],
  ];
  for (const [name, change, message] of failures) test("[REQ-410] TEST-2010 rejects only the changed " + name + " postcondition", () => {
    const v = valid(); change(v); expect(checkApplied(v, p(), "w1:p1")).toMatch(message);
  });
  test("[REQ-410] TEST-2010 tolerates one main cell, skips unknown focus and skips other-preset geometry", () => {
    const v = valid(); v.panes[0]!.rect!.width--;
    expect(checkApplied(v, p(), "w1:p1")).toBeNull();
    v.focused = "w1:p2"; expect(checkApplied(v, p(), null)).toBeNull();
    const even = planned({ layout: "even-horizontal", panes: v.panes.map(p => p.id) });
    v.area = null; v.panes.forEach(p => p.rect = null);
    expect(checkApplied(v, even, null)).toBeNull();
  });
  test("[REQ-411] TEST-2011 recovery skips missing predecessors without sorting opaque ids", () => {
    const order = ["M", "w1:pA", "w1:p9", "w1:pB"];
    expect(recoveryTarget(order, "w1:pB", new Set(["M", "w1:pA"]))).toBe("w1:pA");
    expect(recoveryTarget(order, "w1:pB", new Set(["M", "w1:p9"]))).toBe("w1:p9");
    expect(recoveryTarget(order, "w1:pA", new Set(["M", "w1:pB"]))).toBe("M");
    expect(recoveryTarget(order, "w1:p9", new Set())).toBe("M");
  });
});
