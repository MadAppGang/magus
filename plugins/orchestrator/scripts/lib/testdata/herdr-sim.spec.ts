import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { simRunner, simTab, simRestart, simAgentScreen, panesOf, rectsOf } from "./herdr-sim";

test("[REQ-434, REQ-436] TEST-3101 simulator error envelopes use captured stderr-only bodies", () => {
  const run = simRunner(simTab(["w1:p1"]));
  const captured = JSON.parse(readFileSync(join(import.meta.dir, "herdr-agent-not-found.json"), "utf8"));
  const r = run(["agent", "get", "w1:p1"]);
  expect(r).toMatchObject({ ok: false, exitCode: 1, stdout: "", errorCode: captured.error.code });
  expect(JSON.parse(r.stderr)).toEqual({ id: "cli:agent:get", error: { code: "agent_not_found", message: "agent target w1:p1 not found" } });
  expect(run(["pane", "get", "missing"]).errorCode).toBe("pane_not_found");
});
test("[REQ-434, REQ-436] TEST-3102 simulator keeps terminal witnesses through parking and reports empty tabs closing", () => {
  const state = simTab(["w1:p1", "w1:p2"]), run = simRunner(state);
  const before = panesOf(state.tabs[0]!.tree)[1]!.terminal;
  const parked = run(["pane", "move", "w1:p2", "--new-tab", "--no-focus"]).json as { result: { move_result: { created_tab: { tab_id: string }; pane: { terminal_id: string } } } };
  expect(parked.result.move_result.pane.terminal_id).toBe(before);
  expect(state.tabs[0]!.focused).toBe("w1:p1");
  const returned = run(["pane", "move", "w1:p2", "--tab", "w1:t1", "--target-pane", "w1:p1", "--split", "right", "--ratio", ".3333", "--no-focus"]).json as { result: { move_result: { closed_tab_id: string; pane: { terminal_id: string } } } };
  expect(returned.result.move_result.closed_tab_id).toBe(parked.result.move_result.created_tab.tab_id);
  expect(returned.result.move_result.pane.terminal_id).toBe(before);
  expect(state.tabs).toHaveLength(1);
  expect(rectsOf(state, "w1:t1").get("w1:p1")!.width).toBe(58);
  const old = panesOf(state.tabs[0]!.tree).map(p => p.terminal);
  simRestart(state);
  expect(panesOf(state.tabs[0]!.tree).map(p => p.id)).toEqual(["w1:p1", "w1:p2"]);
  expect(panesOf(state.tabs[0]!.tree).every(p => !old.includes(p.terminal))).toBe(true);
});
test("[REQ-434, REQ-436] TEST-3103 same-tab moves are no-ops and newly generated pane ids cross 9 to A", () => {
  const state = simTab(["w1:p9"]), run = simRunner(state);
  const split = run(["pane", "split", "w1:p9", "--direction", "right", "--no-focus"]).json as { result: { pane: { pane_id: string; terminal_id: string } } };
  expect(split.result.pane.pane_id).toBe("w1:pA");
  const same = run(["pane", "move", "w1:pA", "--tab", "w1:t1", "--target-pane", "w1:p9", "--split", "right", "--ratio", ".7"]).json;
  expect(same).toMatchObject({ result: { move_result: { changed: false, reason: "same_tab" } } });
  expect(panesOf(state.tabs[0]!.tree).map(p => p.id)).toEqual(["w1:p9", "w1:pA"]);
});
test("[REQ-434, REQ-436] TEST-3104 agent wait consumes states without sleeping and done alone cannot prove a new prompt landed", () => {
  const state = simTab(["w1:p1"]), p = panesOf(state.tabs[0]!.tree)[0]!, run = simRunner(state);
  Object.assign(p, { agentStatus: "working", agentSession: "sim-session", statusSequence: ["working", "idle"], screens: [simAgentScreen()] });
  expect(run(["agent", "wait", p.id, "--until", "idle", "--until", "done", "--timeout", "60000"]).ok).toBe(true);
  expect(p.agentStatus).toBe("idle");
  p.agentStatus = "done"; p.takesPrompt = false;
  run(["pane", "send-text", p.id, "report"]); run(["pane", "send-keys", p.id, "enter"]);
  const waiting = run(["agent", "wait", p.id, "--until", "working", "--timeout", "15000"]);
  expect(waiting).toMatchObject({ ok: false, errorCode: "timeout", stdout: "" });
  expect(run(["pane", "read", p.id]).stdout).toContain("❯ report");
});
