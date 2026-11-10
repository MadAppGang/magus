import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyLayout, herdrRunner, readLivePanes, resolveHerdrBin, HERDR_TIMEOUT_MS, type HerdrRunner, type HerdrResult } from "./herdr-cli";
import { planLayout, planArgs, parsePaneLayout, checkApplied, type LayoutPlan } from "./pane-layout";
import { simTab, simRunner, panesOf, rectsOf } from "./testdata/herdr-sim";
import { sandbox, type Sandbox } from "./process-testdata";

const spaces: Sandbox[] = [];
afterEach(() => spaces.splice(0).forEach(s => s.cleanup()));
function plan(ids: string[], focused = ids[0]!): LayoutPlan {
  const p = planLayout({ layout: "main-columns", panes: ids, focused });
  if (!p.ok) throw new Error(p.error);
  return p.plan;
}
const view = (run: HerdrRunner, main = "w1:p1") => {
  const result = run(["pane", "layout", "--pane", main]);
  if (!result.ok) throw new Error(result.stderr);
  const v = parsePaneLayout(result.stdout);
  if (!v) throw new Error("Malformed simulator layout");
  return v;
};
const fault = (timedOut = false): HerdrResult => ({ ok: false, exitCode: timedOut ? null : 1, timedOut, stdout: "", stderr: "staged failure", json: null, errorCode: null });
function start(n: number) {
  const state = simTab(["w1:p1"]), run = simRunner(state), ids = ["w1:p1"];
  for (let i = 0; i < n; i++) {
    const r = run(["pane", "split", ids.at(-1)!, "--direction", "right", "--ratio", ".5", "--no-focus"]);
    ids.push((r.json as { result: { pane: { pane_id: string } } }).result.pane.pane_id);
  }
  run.calls.length = 0;
  return { state, run, ids };
}
for (let n = 1; n <= 6; n++) test("[REQ-410, REQ-411] TEST-2301 " + n + " children produce captured shares, equal columns and unchanged focus/terminals", () => {
  const { state, run, ids } = start(n);
  const focused = n % 2 ? ids.at(-1)! : ids[0]!;
  state.tabs[0]!.focused = focused;
  const witnesses = panesOf(state.tabs[0]!.tree).map(p => [p.id, p.terminal]);

  expect(applyLayout(run, { layout: "main-columns", main: ids[0]!, members: ids })).toEqual({
    status: "applied", order: ids, slots: [], foreign: [], restored: [], stranded: [], error: null,
  });
  const v = view(run), rects = rectsOf(state, v.tabId), main = rects.get(ids[0]!)!;
  expect(main).toMatchObject({ x: 0, y: 0, width: [0, 87, 87, 58, 58, 52, 52][n], height: 49 });
  expect(v.panes.map(p => p.id)).toEqual(ids);
  expect(v.focused).toBe(focused);
  const columnWidths = ids.slice(1).filter((_, i) => i % 2 === 0).map(id => rects.get(id)!.width);
  expect(Math.max(...columnWidths) - Math.min(...columnWidths)).toBeLessThanOrEqual(1);
  for (let i = 1; i < ids.length; i += 2) {
    const a = rects.get(ids[i]!)!, b = ids[i + 1] && rects.get(ids[i + 1]!)!;
    if (b) { expect(a.x).toBe(b.x); expect(a.height + b.height).toBe(49); expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1); }
  }
  expect(panesOf(state.tabs[0]!.tree).map(p => [p.id, p.terminal])).toEqual(witnesses);
  expect(state.tabs).toHaveLength(1);
});
test("[REQ-412] TEST-2302 foreign panes refuse before any zoom/move while witnessed slots participate", () => {
  const { state, run, ids } = start(2); state.tabs[0]!.zoomed = true;
  expect(applyLayout(run, { layout: "main-columns", main: ids[0]!, members: [ids[1]!], slots: [ids[1]!] })).toMatchObject({
    status: "refused", order: ids, slots: [ids[1]!], foreign: [ids[2]!], restored: [], stranded: [],
  });
  expect(run.calls.filter(a => ["move", "zoom", "close"].includes(a[1]!))).toEqual([]);
  expect(applyLayout(run, { layout: "main-columns", main: ids[0]!, members: ids, slots: [ids[1]!] })).toMatchObject({ status: "applied", slots: [ids[1]!], foreign: [] });
  const single = simRunner(simTab(["w1:p1"]));
  expect(applyLayout(single, { layout: "main-columns", main: "w1:p1" })).toEqual({ status: "unchanged", order: ["w1:p1"], slots: [], foreign: [], restored: [], stranded: [], error: null });
  expect(single.calls).toEqual([["pane", "layout", "--pane", "w1:p1"]]);
});
for (const n of [3, 4, 6]) {
  const ids = Array.from({ length: n + 1 }, (_, i) => "w1:p" + (i + 1));
  const p = plan(ids, ids[2]!);
  const args = planArgs(p, "w1:t1");
  args.forEach((failing, index) => test("[REQ-411] TEST-2303 n=" + n + " failure at move " + index + " restores exact order and prior focus", () => {
    const state = simTab(ids); state.tabs[0]!.focused = ids[2]!;
    let failed = false, outside: string[] = [];
    const run = simRunner(state, { failOn: a => {
      if (!failed && JSON.stringify(a) === JSON.stringify(failing)) {
        failed = true;
        const inTab = panesOf(state.tabs.find(t => t.id === "w1:t1")!.tree).map(p => p.id);
        outside = p.park.filter(id => !inTab.includes(id)); return true;
      }
      return false;
    } });
    const outcome = applyLayout(run, { layout: "main-columns", main: ids[0]!, members: ids });
    expect(failed).toBe(true); expect(outcome.status).toBe("failed");
    expect(outcome.restored).toEqual(outside);
    expect(outcome.stranded).toEqual([]);
    expect(view(run).panes.map(p => p.id)).toEqual(ids);
    expect(view(run).focused).toBe(ids[2]!);
    expect(state.tabs).toHaveLength(1);
  }));
}
test("[REQ-411, REQ-435] TEST-2304 final downward replay recovers onto c1, not the last replayed c3", () => {
  const ids = ["w1:p1", "w1:p2", "w1:p3", "w1:p4"];
  let failed = false;
  const run = simRunner(simTab(ids), { failOn: a => {
    if (!failed && a[2] === ids[2] && a.includes("down")) { failed = true; return true; } return false;
  } });
  expect(applyLayout(run, { layout: "main-columns", main: ids[0]! })).toMatchObject({ status: "failed", restored: [ids[2]], stranded: [], order: ids });
  expect(run.calls).toContainEqual(["pane", "move", ids[2]!, "--tab", "w1:t1", "--target-pane", ids[1]!, "--split", "right", "--ratio", "0.5", "--no-focus"]);
  expect(view(run).panes.map(p => p.id)).toEqual(ids);
});
test("[REQ-411, REQ-429] TEST-2304 a failed restore is reported with a usable command and later panes still return", () => {
  const ids = ["w1:p1", "w1:p2", "w1:p3", "w1:p4"], state = simTab(ids);
  const run = simRunner(state, { failOn: a => a[0] === "pane" && a[1] === "move" && a[2] === "w1:p2" && a.includes("--tab") });
  const outcome = applyLayout(run, { layout: "main-columns", main: ids[0]! });
  expect(outcome).toMatchObject({ status: "failed", stranded: ["w1:p2"], restored: ["w1:p3", "w1:p4"] });
  expect(outcome.error).toContain("herdr pane move w1:p2 --tab w1:t1");
  expect(view(run).panes.map(p => p.id)).toEqual(["w1:p1", "w1:p3", "w1:p4"]);
});
test("[REQ-410, REQ-435] TEST-2305 ignored ratios fail share verification after one replay, never loop", () => {
  const ids = Array.from({ length: 6 }, (_, i) => "w1:p" + (i + 1));
  const run = simRunner(simTab(ids), { ignoreRatio: true });
  const outcome = applyLayout(run, { layout: "main-columns", main: ids[0]! });
  expect(outcome).toMatchObject({ status: "failed", order: ids, restored: [], stranded: [] });
  expect(outcome.error).toMatch(/main pane is .*wide/);
  expect(run.calls.filter(a => a[1] === "move")).toHaveLength(10);
});
test("[REQ-412] TEST-2306 valid zoomed layout unzooms once; invalid parameters leave zoom untouched", () => {
  const state = simTab(["w1:p1", "w1:p2"]); state.tabs[0]!.zoomed = true;
  const run = simRunner(state);
  expect(applyLayout(run, { layout: "main-columns", main: "w1:p1", columnSize: 0 }).status).toBe("failed");
  expect(run.calls.some(a => a[1] === "zoom")).toBe(false);
  run.calls.length = 0;
  expect(applyLayout(run, { layout: "main-columns", main: "w1:p1" }).status).toBe("applied");
  expect(run.calls[1]).toEqual(["pane", "zoom", "w1:p1", "--off"]);
  expect(run.calls.filter(a => a[1] === "zoom")).toHaveLength(1);
});
test("[REQ-434] TEST-2307 runner parses captured stderr errors, never throws and times out a sleeping executable", () => {
  const s = sandbox(); spaces.push(s);
  const bin = join(s.bin, "slow-herdr");
  writeFileSync(bin, "#!" + process.execPath + " --no-env-file\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);\n"); chmodSync(bin, 0o755);
  expect(HERDR_TIMEOUT_MS).toBe(5000);
  const timed = herdrRunner(bin)(["pane", "get", "p"], 30);
  expect(timed.ok).toBe(false); expect(timed.timedOut).toBe(true);
  const errorBin = join(s.bin, "error-herdr");
  writeFileSync(errorBin, "#!" + process.execPath + " --no-env-file\nprocess.stderr.write(JSON.stringify({error:{code:'pane_not_found',message:'missing'}}));process.exit(1);\n"); chmodSync(errorBin, 0o755);
  expect(herdrRunner(errorBin)(["pane", "get", "p"])).toMatchObject({ ok: false, exitCode: 1, stdout: "", errorCode: "pane_not_found", json: { error: { code: "pane_not_found", message: "missing" } } });
  writeFileSync(errorBin, "#!" + process.execPath + " --no-env-file\nprocess.stdout.write(JSON.stringify({error:{code:'server_not_running',message:'missing server'}}));process.exit(1);\n");
  expect(herdrRunner(errorBin)(["workspace", "list"])).toMatchObject({ ok: false, exitCode: 1, errorCode: "server_not_running", json: { error: { code: "server_not_running", message: "missing server" } } });
  expect(readLivePanes(simRunner(simTab(["w1:p1"])))).toEqual({ ok: true, live: new Map([["w1:p1", "term_1"]]) });
  expect(herdrRunner(join(s.root, "missing"))([]).ok).toBe(false);
  expect(readLivePanes(() => fault())).toMatchObject({ ok: false, error: expect.any(String) });
  expect(readLivePanes(() => ({ ...fault(), ok: true, exitCode: 0, stdout: '{"result":{"panes":[{"pane_id":"p"}]}}' })).ok).toBe(false);
  const fallback = join(s.env.HOME!, ".local", "bin", "herdr");
  rmSync(join(s.bin, "herdr")); mkdirSync(join(s.env.HOME!, ".local", "bin"), { recursive: true });
  expect(resolveHerdrBin({ PATH: s.bin }, s.env.HOME!)).toBeNull();
  writeFileSync(fallback, "#!/bin/sh\nexit 0\n");
  expect(resolveHerdrBin({ PATH: s.bin }, s.env.HOME!)).toBeNull();
  chmodSync(fallback, 0o755);
  expect(resolveHerdrBin({ PATH: s.bin }, s.env.HOME!)).toBe(fallback);
}, 15_000);
test("[REQ-411] TEST-2308 a timed-out restore that actually landed is not falsely stranded after the final read", () => {
  const ids = ["w1:p1", "w1:p2", "w1:p3", "w1:p4"], real = simRunner(simTab(ids));
  let failed = false, late = false;
  const run: HerdrRunner = (a, timeout) => {
    if (!failed && a[1] === "move" && a[2] === "w1:p3" && a.includes("down")) { failed = true; return fault(); }
    if (failed && !late && a[1] === "move" && a[2] === "w1:p3" && a.includes("right")) {
      late = true; real(a, timeout); return fault(true);
    }
    return real(a, timeout);
  };
  const outcome = applyLayout(run, { layout: "main-columns", main: ids[0]! });
  expect(late).toBe(true);
  expect(outcome).toMatchObject({ status: "failed", stranded: [], restored: ["w1:p3"], order: ids });
  expect(outcome.error).not.toContain("is still outside the tab");
});
test("[REQ-411] TEST-2308 an uncertain park is restored even when the immediate tab read also fails", () => {
  const ids = ["w1:p1", "w1:p2", "w1:p3"], real = simRunner(simTab(ids));
  let parked = false, failedRead = false;
  const run: HerdrRunner = (a, timeout) => {
    if (!parked && a[1] === "move" && a[2] === "w1:p2" && a.includes("--new-tab")) {
      parked = true; real(a, timeout); return fault(true);
    }
    if (parked && !failedRead && a[1] === "layout") { failedRead = true; return fault(); }
    return real(a, timeout);
  };
  const outcome = applyLayout(run, { layout: "main-columns", main: ids[0]! });
  expect(outcome).toMatchObject({ status: "failed", restored: ["w1:p2"], stranded: [], order: ids });
  expect(view(real).panes.map(p => p.id)).toEqual(ids);
});
test("[REQ-411] TEST-2308 a pane closed externally during recovery is reported closed, not stranded", () => {
  const ids = ["w1:p1", "w1:p2", "w1:p3", "w1:p4"], state = simTab(ids);
  let failed = false;
  const run = simRunner(state, { failOn: a => {
    if (!failed && a[1] === "move" && a[2] === "w1:p2" && a.includes("--tab")) {
      failed = true; simRunner(state)(["pane", "close", "w1:p3"]); return true;
    }
    return false;
  } });
  const outcome = applyLayout(run, { layout: "main-columns", main: ids[0]! });
  expect(outcome.status).toBe("failed");
  expect(outcome.stranded).toEqual([]);
  expect(outcome.order).toEqual(["w1:p1", "w1:p2", "w1:p4"]);
  expect(outcome.error).toMatch(/w1:p3.*closed|closed.*w1:p3/);
});
test("[REQ-411] TEST-2308 changed:false same_tab park responses are failures, never a successful replay", () => {
  const real = simRunner(simTab(["w1:p1", "w1:p2"]));
  const run: HerdrRunner = (a, timeout) => a.includes("--new-tab")
    ? { ok: true, exitCode: 0, stdout: '{"result":{"move_result":{"changed":false,"reason":"same_tab"}}}', stderr: "", timedOut: false, json: { result: { move_result: { changed: false, reason: "same_tab" } } }, errorCode: null }
    : real(a, timeout);
  const r = applyLayout(run, { layout: "main-columns", main: "w1:p1" });
  expect(r).toMatchObject({ status: "failed", stranded: [], order: ["w1:p1", "w1:p2"] });
  expect(real.calls.filter(a => a[1] === "move")).toEqual([]);
});
test("[REQ-411] TEST-2308 mirrored recovery reads through the unparked anchor, never the parked main", () => {
  const ids = ["w1:p1", "w1:pA", "w1:p9"];
  const run = simRunner(simTab(ids));
  expect(applyLayout(run, { layout: "main-vertical-mirrored", main: "w1:p9" })).toMatchObject({ status: "applied", order: ids });
  const reads = run.calls.filter(a => a[1] === "layout");
  expect(reads.at(-1)).toEqual(["pane", "layout", "--pane", "w1:p1"]);
});
test("[REQ-435] TEST-2309 malformed move order and half-ratio chains are rejected by independent geometry checks", () => {
  for (const defect of ["downs-first", "half-ratios"]) {
    const n = defect === "downs-first" ? 3 : 5;
    const ids = Array.from({ length: n + 1 }, (_, i) => "w1:p" + (i + 1)), p = plan(ids), run = simRunner(simTab(ids));
    const bad = structuredClone(p);
    if (defect === "downs-first") bad.moves = [bad.moves[0]!, ...bad.moves.slice(1).sort((a, b) => Number(b.direction === "down") - Number(a.direction === "down"))];
    else bad.moves = bad.moves.map((m, i) => i ? { ...m, ratio: .5 } : m);
    for (const args of planArgs(bad, "w1:t1")) expect(run(args).ok).toBe(true);
    expect(checkApplied(view(run), p, ids[0]!)).toEqual(expect.any(String));
  }
});
test("[REQ-435] TEST-2309 splitting repeatedly from main reverses start order, unlike last-family splitting", () => {
  const run = simRunner(simTab(["w1:p1"])), created: string[] = ["w1:p1"];
  for (let i = 0; i < 3; i++) {
    const r = run(["pane", "split", "w1:p1", "--direction", "right", "--ratio", ".5", "--no-focus"]);
    created.push((r.json as { result: { pane: { pane_id: string } } }).result.pane.pane_id);
  }
  expect(view(run).panes.map(p => p.id)).toEqual(["w1:p1", "w1:p4", "w1:p3", "w1:p2"]);
  expect(view(run).panes.map(p => p.id)).not.toEqual(created);
});
