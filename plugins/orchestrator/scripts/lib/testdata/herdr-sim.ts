import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HerdrRunner, HerdrResult } from "../herdr-cli";
import type { Rect } from "../pane-layout";

// A test-owned model of the captured CLI, not a model of the orchestrator.
export interface SimPane {
  id: string; terminal: string; cwd?: string;
  agentStatus?: "idle" | "working" | "blocked" | "done" | "unknown";
  agentSession?: string; agentAfterCalls?: number;
  shellPid?: number; foregroundPids?: number[];
  screens?: string[]; statusSequence?: string[]; dropSendTexts?: number;
  takesPrompt?: boolean; shellAfterQuitMs?: number;
  onRun?: { append?: string; agent?: boolean; agentAfterMs?: number; agentSession?: string }[];
  agentReadyAt?: number; shellReadyAt?: number; input?: string;
}
export type SimNode = { pane: SimPane } | { direction: "right" | "down"; ratio: number; first: SimNode; second: SimNode };
export interface SimState {
  width: number; height: number; nextPane: number; nextTerminal: number;
  splitQueue?: Partial<SimPane>[];
  restartWhen?: { argv: string[]; nth: number };
  failArgv?: string[];
  workspaces: { id: string; focused: boolean }[];
  tabs: { id: string; workspace: string; tree: SimNode; focused: string; zoomed?: boolean }[];
  callCounts?: Record<string, number>;
  // Scriptable external failures, consumed only on matching calls.
  responses?: { argv: string[]; times?: number; stdout?: string; stderr?: string; exitCode?: number; timedOut?: boolean; after?: "restart" | "remove-agent" }[];
}
type Tab = SimState["tabs"][number];
export const panesOf = (node: SimNode): SimPane[] =>
  "pane" in node ? [node.pane] : [...panesOf(node.first), ...panesOf(node.second)];
export function simTab(ids: string[], width = 174, height = 49): SimState {
  if (!ids.length) throw new Error("simTab needs an anchor");
  const panes = ids.map((id, i) => ({ pane: { id, terminal: "term_" + (i + 1), shellPid: 8000 + i, screens: ["user@host % "] } } as SimNode));
  const chain = (i: number): SimNode => i === panes.length - 1 ? panes[i]! :
    { direction: "right", ratio: 1 / (panes.length - i), first: panes[i]!, second: chain(i + 1) };
  return { width, height, nextPane: Math.max(ids.length, ...ids.map(id => parseInt(id.split(":p")[1] ?? "0", 36) || 0)) + 1,
    nextTerminal: ids.length + 1, workspaces: [{ id: "w1", focused: true }],
    tabs: [{ id: "w1:t1", workspace: "w1", tree: chain(0), focused: ids[0]! }] };
}
export function simAgentScreen(extra = ""): string {
  return [extra, "Claude Code", "Session color set", "❯ "].filter((s, i) => s || i === 3).join("\n");
}
export function simRestart(state: SimState): void {
  let n = 1;
  for (const tab of state.tabs) {
    const focused = panesOf(tab.tree).find(p => p.id === tab.focused);
    for (const p of panesOf(tab.tree)) { p.id = "w1:p" + (n++).toString(36).toUpperCase(); p.terminal = "term_" + state.nextTerminal++; }
    tab.focused = focused?.id ?? panesOf(tab.tree)[0]!.id;
  }
  state.nextPane = n;
}
function boxes(node: SimNode, area: Rect, out: Map<string, Rect>): void {
  if ("pane" in node) { out.set(node.pane.id, { ...area }); return; }
  const horizontal = node.direction === "right";
  const size = Math.round((horizontal ? area.width : area.height) * node.ratio);
  const a = { ...area }, b = { ...area };
  if (horizontal) { a.width = size; b.x += size; b.width -= size; }
  else { a.height = size; b.y += size; b.height -= size; }
  boxes(node.first, a, out); boxes(node.second, b, out);
}
export function rectsOf(state: SimState, tab: string): Map<string, Rect> {
  const out = new Map<string, Rect>(), t = state.tabs.find(t => t.id === tab);
  if (t) boxes(t.tree, { x: 0, y: 0, width: state.width, height: state.height }, out);
  return out;
}
function remove(node: SimNode, id: string): SimNode | null {
  if ("pane" in node) return node.pane.id === id ? null : node;
  const a = remove(node.first, id), b = remove(node.second, id);
  return a && b ? { ...node, first: a, second: b } : a ?? b;
}
function insert(node: SimNode, target: string, pane: SimPane, direction: "right" | "down", ratio: number): SimNode {
  if ("pane" in node) return node.pane.id === target ? { direction, ratio, first: node, second: { pane } } : node;
  return { ...node, first: insert(node.first, target, pane, direction, ratio), second: insert(node.second, target, pane, direction, ratio) };
}
const starts = (args: readonly string[], prefix: readonly string[]) => prefix.every((x, i) => args[i] === x);
const value = (args: readonly string[], flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
function result(stdout: string, exitCode = 0, stderr = "", timedOut = false): HerdrResult {
  let json: unknown = null;
  try { json = JSON.parse(stdout.trim() || stderr); } catch {}
  const errorCode = (json as { error?: { code?: string } } | null)?.error?.code ?? null;
  return { ok: exitCode === 0 && !timedOut, exitCode: timedOut ? null : exitCode, stdout, stderr, json, errorCode, timedOut };
}
function success(id: string, type: string, fields: Record<string, unknown>): HerdrResult {
  return result(JSON.stringify({ id: "cli:" + id, result: { ...fields, type } }));
}
function failure(id: string, code: string, message: string): HerdrResult {
  // All captured herdr error bodies have empty stdout and JSON on stderr.
  return result("", 1, JSON.stringify({ error: { code, message }, id: "cli:" + id }));
}
function refresh(p: SimPane) {
  if (p.agentReadyAt !== undefined && Date.now() >= p.agentReadyAt) {
    delete p.agentReadyAt; p.agentStatus = "idle";
    p.screens = [simAgentScreen(p.screens?.at(-1) ?? "")];
  }
  if (p.shellReadyAt !== undefined && Date.now() >= p.shellReadyAt) { delete p.shellReadyAt; p.foregroundPids = [p.shellPid ?? 8000]; }
}
function paneBody(tab: Tab, p: SimPane) {
  refresh(p);
  const agent = p.agentStatus && p.agentStatus !== "unknown" && p.agentReadyAt === undefined;
  return { pane_id: p.id, terminal_id: p.terminal, tab_id: tab.id, workspace_id: tab.workspace,
    cwd: p.cwd ?? dirname(import.meta.dir), foreground_cwd: p.cwd ?? dirname(import.meta.dir),
    revision: 0, focused: tab.focused === p.id, agent: agent ? "claude" : null,
    agent_status: agent ? p.agentStatus : "unknown",
    ...(agent && p.agentSession ? { agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: p.agentSession } } : {}) };
}
function layout(state: SimState, t: Tab) {
  const rects = rectsOf(state, t.id);
  return { area: { x: 0, y: 0, width: state.width, height: state.height }, tab_id: t.id,
    workspace_id: t.workspace, focused_pane_id: t.focused, zoomed: t.zoomed === true,
    panes: panesOf(t.tree).map(p => ({ pane_id: p.id, focused: p.id === t.focused, rect: rects.get(p.id) })), splits: [] };
}
function currentScreen(p: SimPane, consume = false): string {
  refresh(p);
  const screen = p.screens?.[0] ?? "user@host % ";
  if (consume && (p.screens?.length ?? 0) > 1) p.screens!.shift();
  return screen;
}
export function simRunner(state: SimState, opts: { failOn?: (args: readonly string[]) => boolean; ignoreRatio?: boolean } = {}):
  HerdrRunner & { calls: string[][]; state: SimState } {
  const calls: string[][] = [];
  const run = ((args: readonly string[]): HerdrResult => {
    calls.push([...args]);
    const overridden = state.responses?.find(r => starts(args, r.argv) && (r.times ?? 1) > 0);
    let answer: HerdrResult;
    if (overridden) {
      overridden.times = (overridden.times ?? 1) - 1;
      answer = result(overridden.stdout ?? "", overridden.exitCode ?? 0, overridden.stderr ?? "", overridden.timedOut ?? false);
      if (overridden.after === "restart") simRestart(state);
      if (overridden.after === "remove-agent") for (const t of state.tabs) for (const p of panesOf(t.tree)) p.agentStatus = "unknown";
    } else if (opts.failOn?.(args) || (state.failArgv && starts(args, state.failArgv))) {
      answer = failure(args.slice(0, 2).join(":"), "sim_failure", "staged herdr failure");
    } else {
      answer = command(args);
    }
    if (state.restartWhen && starts(args, state.restartWhen.argv)) {
      const key = JSON.stringify(state.restartWhen.argv);
      state.callCounts ??= {};
      state.callCounts[key] = (state.callCounts[key] ?? 0) + 1;
      if (state.callCounts[key] === state.restartWhen.nth) simRestart(state);
    }
    return answer;
  }) as HerdrRunner & { calls: string[][]; state: SimState };
  run.calls = calls; run.state = state;
  function command(args: readonly string[]): HerdrResult {
    const [noun, verb] = args, id = noun + ":" + verb;
    if (noun === "workspace" && verb === "list")
      return success(id, "workspace_list", { workspaces: state.workspaces.map(w => ({ workspace_id: w.id, focused: w.focused, active_tab_id: state.tabs.find(t => t.workspace === w.id)?.id })) });
    if (noun === "pane" && verb === "list")
      return success(id, "pane_list", { panes: state.tabs.flatMap(t => panesOf(t.tree).map(p => paneBody(t, p))) });
    if (noun === "tab" && verb === "create") {
      const workspace = value(args, "--workspace") ?? "w1";
      const p: SimPane = { id: "w1:p" + (state.nextPane++).toString(36).toUpperCase(), terminal: "term_" + state.nextTerminal++, cwd: value(args, "--cwd"), screens: ["user@host % "] };
      const t: Tab = { id: nextTab(), workspace, focused: p.id, tree: { pane: p } };
      state.tabs.push(t);
      return success(id, "tab_created", { tab: { tab_id: t.id, workspace_id: workspace, focused: false, label: value(args, "--label") ?? "test", number: state.tabs.length, pane_count: 1, agent_status: "unknown" }, root_pane: paneBody(t, p) });
    }
    const pid = value(args, "--pane") ?? args[2];
    const tab = state.tabs.find(t => panesOf(t.tree).some(p => p.id === pid));
    const p = tab && panesOf(tab.tree).find(p => p.id === pid);
    if (!tab || !p) return failure(id, "pane_not_found", "pane target " + pid + " not found");
    refresh(p);
    if (noun === "pane" && verb === "get") return success(id, "pane_info", { pane: paneBody(tab, p) });
    if (noun === "pane" && verb === "layout") return success(id, "pane_layout", { layout: layout(state, tab) });
    if (noun === "pane" && verb === "process-info") {
      const shell = p.shellPid ?? 8000;
      const foreground = p.shellReadyAt !== undefined || p.agentStatus && p.agentStatus !== "unknown" ? [shell + 100] : p.foregroundPids ?? [shell];
      return success("pane:process_info", "pane_process_info", { process_info: { pane_id: p.id, shell_pid: shell,
        foreground_process_group_id: foreground[0], foreground_processes: foreground.map(pid => ({ pid, argv0: pid === shell ? "zsh" : "claude", name: pid === shell ? "zsh" : "2.1.321" })) } });
    }
    if (noun === "pane" && verb === "split") {
      const newPane: SimPane = { id: "w1:p" + (state.nextPane++).toString(36).toUpperCase(),
        terminal: "term_" + state.nextTerminal++, cwd: value(args, "--cwd"), screens: ["user@host % "], ...state.splitQueue?.shift() };
      const direction = value(args, "--direction") === "down" ? "down" : "right";
      tab.tree = insert(tab.tree, p.id, newPane, direction, Number(value(args, "--ratio") ?? 0.5));
      if (!args.includes("--no-focus")) tab.focused = newPane.id;
      return success(id, "pane_info", { pane: paneBody(tab, newPane) });
    }
    if (noun === "pane" && verb === "move") {
      const targetTab = args.includes("--new-tab") ? undefined : state.tabs.find(t => t.id === value(args, "--tab"));
      if (targetTab === tab) return success(id, "pane_move", { move_result: { changed: false, reason: "same_tab", pane: paneBody(tab, p) } });
      if (!args.includes("--new-tab") && (!targetTab || !panesOf(targetTab.tree).some(x => x.id === value(args, "--target-pane"))))
        return failure(id, "pane_not_found", "target not found");
      const oldTab = tab.id;
      const left = remove(tab.tree, p.id);
      if (left) { tab.tree = left; if (tab.focused === p.id) tab.focused = panesOf(left)[0]!.id; }
      else state.tabs.splice(state.tabs.indexOf(tab), 1);
      let dest = targetTab, created: unknown;
      if (!dest) {
        dest = { id: nextTab(), workspace: tab.workspace, tree: { pane: p }, focused: p.id };
        state.tabs.push(dest); created = { tab_id: dest.id, workspace_id: dest.workspace, focused: false, pane_count: 1 };
      } else {
        dest.tree = insert(dest.tree, value(args, "--target-pane")!, p, value(args, "--split") === "down" ? "down" : "right",
          opts.ignoreRatio ? 0.5 : Number(value(args, "--ratio") ?? 0.5));
        if (args.includes("--focus")) dest.focused = p.id;
      }
      return success(id, "pane_move", { move_result: { changed: true, pane: paneBody(dest, p), previous_tab_id: oldTab,
        focused_pane_id: dest.focused, previous_pane_id: p.id, previous_workspace_id: tab.workspace, ...(created ? { created_tab: created } : {}), ...(!left ? { closed_tab_id: oldTab } : {}),
        target_layout: layout(state, dest), ...(left ? { source_layout: layout(state, tab) } : {}) } });
    }
    if (noun === "pane" && verb === "zoom") { const changed = tab.zoomed === true; tab.zoomed = false; return success(id, "pane_zoom", { zoom: { changed, focus_changed: false, focused_pane_id: tab.focused, layout: layout(state, tab), pane_id: p.id, zoom_changed: changed, zoomed: false } }); }
    if (noun === "pane" && verb === "close") {
      const left = remove(tab.tree, p.id);
      if (left) { tab.tree = left; if (tab.focused === p.id) tab.focused = panesOf(left)[0]!.id; }
      else state.tabs.splice(state.tabs.indexOf(tab), 1);
      return success(id, "pane_close", { pane_id: p.id });
    }
    if (noun === "agent" && ["get", "wait", "read", "focus"].includes(verb!)) {
      if ((p.agentAfterCalls ?? 0) > 0) { p.agentAfterCalls!--; return failure(id, "agent_not_found", "agent target " + p.id + " not found"); }
      if (!p.agentStatus || p.agentStatus === "unknown" || p.agentReadyAt !== undefined) return failure(id, "agent_not_found", "agent target " + p.id + " not found");
      if (verb === "read") return result(currentScreen(p, true));
      if (verb === "focus") { tab.focused = p.id; return success(id, "agent_info", { agent: paneBody(tab, p) }); }
      const until = args.flatMap((x, i) => x === "--until" ? [args[i + 1]!] : []);
      if (verb === "get" && p.statusSequence?.length) p.agentStatus = p.statusSequence.shift() as NonNullable<SimPane["agentStatus"]>;
      if (verb === "wait") {
        while (!until.includes(p.agentStatus) && p.statusSequence?.length) p.agentStatus = p.statusSequence.shift() as NonNullable<SimPane["agentStatus"]>;
        if (!until.includes(p.agentStatus)) return failure(id, "timeout", "timed out waiting for agent status");
      }
      return success(id, "agent_info", { agent: { ...paneBody(tab, p), state_change_seq: 1 } });
    }
    if (noun === "pane" && verb === "read") return result(currentScreen(p, true));
    if (noun === "pane" && verb === "wait-output") {
      try {
        if (new RegExp(value(args, "--regex") ?? "").test(currentScreen(p))) return success(id, "pane_output", { matched: true, text: currentScreen(p) });
      } catch {}
      return failure(id, "timeout", "timed out waiting for output match");
    }
    if (noun === "pane" && verb === "run") {
      const line = args[3] ?? "", next = p.onRun?.shift();
      p.screens = [currentScreen(p) + "\n" + line + (next?.append ? "\n" + next.append : "")];
      p.input = "";
      if (!next || next.agent || next.agentAfterMs !== undefined) {
        p.agentSession = next?.agentSession ?? p.agentSession ?? "sim-session";
        if (next?.agentAfterMs) { p.agentReadyAt = Date.now() + next.agentAfterMs; p.agentStatus = "unknown"; }
        else { p.agentStatus = "idle"; p.screens = [simAgentScreen(p.screens[0])]; }
      }
      return success(id, "pane_run", { pane_id: p.id });
    }
    if (noun === "pane" && verb === "send-text") {
      const text = args[3] ?? "";
      if ((p.dropSendTexts ?? 0) > 0) p.dropSendTexts!--;
      else {
        p.input = (p.input ?? "") + text;
        const lines = currentScreen(p).split("\n");
        let i = lines.length - 1; while (i >= 0 && !lines[i]!.trimStart().startsWith("❯")) i--;
        if (i >= 0) lines[i] += text; else lines.push(text);
        p.screens = [lines.join("\n")];
      }
      return success(id, "pane_send_text", { pane_id: p.id });
    }
    if (noun === "pane" && verb === "send-keys") {
      if (args[3] === "enter" && p.input) {
        if (p.input === "/quit") {
          p.agentStatus = "unknown"; p.shellReadyAt = Date.now() + (p.shellAfterQuitMs ?? 0);
          p.screens = [currentScreen(p) + "\nKeep worktree\nWorktree removed\nuser@host % "]; p.input = "";
        } else if (p.takesPrompt !== false) {
          p.agentStatus = "working"; p.screens = [currentScreen(p) + "\nWorking…\n❯ "]; p.input = "";
        }
      }
      return success(id, "pane_send_keys", { pane_id: p.id });
    }
    if (noun === "pane" && verb === "report-metadata") return success(id, "pane_metadata", {});
    return failure(id, "unsupported_test_command", args.join(" "));
  }
  function nextTab(): string {
    let i = 1; while (state.tabs.some(t => t.id === "w1:t" + i)) i++;
    return "w1:t" + i;
  }
  return run;
}

async function main() {
  const path = process.env.QA_HERDR_STATE!, log = process.env.QA_HERDR_LOG!, args = process.argv.slice(2);
  const lock = path + ".lock", deadline = Date.now() + 5000;
  let held = false;
  try {
    while (!held) {
      if (!existsSync(path)) { process.stderr.write(failure("pane:get", "pane_not_found", "test server is gone").stderr); process.exitCode = 1; return; }
      try { mkdirSync(lock); held = true; } catch { if (Date.now() > deadline) throw new Error("simulator state lock timed out"); await Bun.sleep(5); }
    }
    const state: SimState = JSON.parse(readFileSync(path, "utf8"));
    appendFileSync(log, JSON.stringify({ argv: args, at: Date.now() }) + "\n");
    const answer = simRunner(state)(args);
    if (existsSync(path)) {
      const temp = path + "." + process.pid + ".tmp";
      writeFileSync(temp, JSON.stringify(state)); renameSync(temp, path);
    }
    process.stdout.write(answer.stdout); process.stderr.write(answer.stderr); process.exitCode = answer.exitCode ?? 1;
  } finally { if (held) rmSync(lock, { recursive: true, force: true }); }
}
if (import.meta.main) await main();
