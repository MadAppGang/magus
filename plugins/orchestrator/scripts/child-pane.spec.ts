import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { managerSpace, mutateSim, until, json, type ManagerSpace } from "./lib/child-process-testdata";
import { ancestor, gitCheckout, runBun, type ProcessResult } from "./lib/process-testdata";
import { simRunner, simRestart, simAgentScreen, panesOf, rectsOf, type SimPane } from "./lib/testdata/herdr-sim";
import { identity, SELF, MANAGER, CHILD } from "../tests/testdata";
import { lockPathFor } from "./lib/window";
import { readClaim } from "./lib/record-store";
import type { PaneEntry } from "./lib/child-pane-core";
const contexts: ManagerSpace[] = [];
const space = async (role: "manager" | "child" | "triage" = "manager") => { const c = await managerSpace(role); contexts.push(c); return c; };
afterEach(async () => { for (const c of contexts.splice(0)) await c.cleanup(); });
const inputCalls = (c: ManagerSpace) => c.s.calls().filter(a => ["send-text", "send-keys", "run", "close"].includes(a[1]!));
function error(r: ProcessResult, code: number, status?: string) {
  expect(r.code).toBe(code); const body = json(r);
  expect(body.error).toEqual(expect.any(String));
  if (status) expect(body.status).toBe(status);
  return body;
}
const child = (c: ManagerSpace, id: string): SimPane => c.s.sim().tabs.flatMap(t => panesOf(t.tree)).find(p => p.id === id)!;
const editChild = (c: ManagerSpace, id: string, patch: Partial<SimPane>) => mutateSim(c, s => Object.assign(s.tabs.flatMap(t => panesOf(t.tree)).find(p => p.id === id)!, patch));
const argsOpen = (dir: string, name: string, extra: string[] = []) => ["open", "--dir", dir, "--name", name, "--colour", "green", ...extra];
for (const command of ["trust", "retype"] as const) test("[REQ-425] TEST-2722 " + command + " rechecks its terminal immediately before pane run and releases its checkout lock", async () => {
  const c = await space(), e = c.seed({ agentStatus: "unknown" }, false);
  mutateSim(c, s => { s.restartWhen = { argv: ["pane", "process-info", "--pane", e.pane], nth: 1 }; });
  error(await c.run([command, "--pane", e.pane]), 5);
  expect(c.s.calls().filter(a => a[1] === "run")).toEqual([]);
  expect(existsSync(lockPathFor(c.s.ctx.stateDir, c.dir))).toBe(false);
}, 15_000);
test("[REQ-425] TEST-2722 open keeps its registered pane but types nothing when the shell-ready witness was replaced", async () => {
  const c = await space();
  mutateSim(c, s => { s.restartWhen = { argv: ["pane", "process-info", "--pane", "w1:p2"], nth: 1 }; });
  const r = await c.open();
  expect(r.code).toBe(5); expect(r.json).toMatchObject({ pane: "w1:p2", typed: false });
  expect(c.registry().children.map(e => e.pane)).toEqual(["w1:p2"]);
  expect(c.s.calls().filter(a => a[1] === "run")).toEqual([]);
  expect(existsSync(lockPathFor(c.s.ctx.stateDir, c.dir))).toBe(false);
}, 30_000);
for (const command of ["close", "layout"] as const) test("[REQ-429] TEST-2725 " + command + " exits 14 with stranded panes and an explicit recovery command", async () => {
  const c = await space(), first = c.seed(), second = c.seed(), last = c.seed();
  mutateSim(c, s => { s.failArgv = ["pane", "move", first.pane, "--tab"]; });
  const r = await c.run(command === "close" ? ["close", "--pane", last.pane] : ["layout"]);
  expect(r.code).toBe(14);
  const result = json(r), outcome = command === "close" ? result.layout : result;
  expect(outcome.status).toBe("failed");
  expect(outcome.stranded).toContain(first.pane);
  expect(outcome.error).toContain("herdr pane move " + first.pane + " --tab w1:t1");
  expect(c.registry().children.map(e => e.pane)).toEqual(command === "close" ? [first.pane, second.pane] : [first.pane, second.pane, last.pane]);
}, 15_000);

const layoutShape ={ status: expect.any(String), order: expect.any(Array), slots: expect.any(Array), foreign: expect.any(Array), restored: expect.any(Array), stranded: expect.any(Array), error: null };
for (const command of ["open", "close"] as const) test("[REQ-429] TEST-2725 " + command + " preserves its successful effect when layout failed but stranded nothing", async () => {
  const c = await space(), first = c.seed(), second = c.seed(), last = c.seed();
  mutateSim(c, s => { s.failArgv = ["pane", "move", first.pane, "--new-tab"]; });
  const r = command === "open" ? await c.run(argsOpen(c.dir, "added-child")) : await c.run(["close", "--pane", last.pane]);
  expect(r.code).toBe(0);
  expect(json(r).layout).toMatchObject({ status: "failed", stranded: [], error: expect.any(String) });
  if (command === "open") { expect(json(r).typed).toBe(true); expect(c.registry().children).toHaveLength(4); }
  else { expect(json(r).closed).toBe(last.pane); expect(c.registry().children.map(e => e.pane)).toEqual([first.pane, second.pane]); }
}, 15_000);
test("[REQ-423, REQ-424] TEST-2718 a prompt dropped twice reports NOT_SENT with inInput:false, not a fictional success", async () => {
  const c = await space(), e = c.seed({ agentStatus: "done", takesPrompt: false, dropSendTexts: 2 }), p = c.promptFile("report");
  const r = await c.run(["prompt", "--pane", e.pane, "--prompt-file", p]);
  expect(r.code).toBe(8);
  expect(json(r)).toEqual({ error: expect.stringMatching(/\S/), pane: e.pane, outcome: "not-sent", inInput: false, log: join(c.s.ctx.stateDir, "ticket-window.log") });
  expect(c.s.calls().filter(a => a[1] === "send-text")).toHaveLength(2);
  expect(existsSync(p)).toBe(false);
}, 45_000);
test("[REQ-423, REQ-424] TEST-2718 one dropped copy may be retyped once and SENT only after the child starts working", async () => {
  const c = await space(), e = c.seed({ dropSendTexts: 1 }), p = c.promptFile("report");
  const r = await c.run(["prompt", "--pane", e.pane, "--prompt-file", p]);
  expect(r.code).toBe(0); expect(json(r).outcome).toBe("sent");
  expect(c.s.calls().filter(a => a[1] === "send-text")).toHaveLength(2);
  expect(readFileSync(join(c.s.ctx.stateDir, "ticket-window.log"), "utf8")).toContain("SENT (retyped once:");
  expect(existsSync(p)).toBe(false);
}, 30_000);
test("[REQ-422, REQ-423] TEST-2715 delivery that discovers a current-launch trust refusal returns untrusted and keeps the prompt for retry", async () => {
  const c = await space(), e = c.seed();
  editChild(c, e.pane, { screens: [simAgentScreen(e.claim + "\nWorkspace trust not yet accepted")] });
  const ready = simRunner(c.s.sim())(["agent", "get", e.pane]);
  mutateSim(c, s => { s.responses = [{ argv: ["agent", "get"], stdout: ready.stdout, after: "remove-agent" }]; });
  const p = c.promptFile("report"), r = await c.run(["prompt", "--pane", e.pane, "--prompt-file", p]);
  expect(r.code).toBe(7);
  expect(json(r)).toEqual({ error: expect.stringMatching(/\S/), pane: e.pane, outcome: "untrusted", inInput: null, log: join(c.s.ctx.stateDir, "ticket-window.log") });
  expect(c.s.calls().filter(a => a[1] === "send-text")).toEqual([]);
  expect(existsSync(p)).toBe(true);
}, 30_000);

test("[REQ-417] TEST-2701 bad arguments fail before authorisation; child, triage and plain callers never reach herdr", async () => {
  const c = await space("child");
  error(await c.run(["bogus"]), 1);
  error(await c.run(argsOpen(c.dir, "one")), 9);
  expect(c.s.calls()).toEqual([]);
  error(await runBun(c.s, "scripts/child-pane.ts", ["list"], "", { CLAUDE_CODE_SESSION_ID: "plain001" }), 9);
  expect(c.s.calls()).toEqual([]);
  const t = await space("triage");
  error(await t.run(["list"]), 9); expect(t.s.calls()).toEqual([]);
}, 15_000);
test("[REQ-417] TEST-2701 competing live incarnation and unknown own process cannot use the manager's registry", async () => {
  const c = await space(); c.seed();
  const bytes = readFileSync(c.path, "utf8"), rival = await ancestor(c.s, SELF);
  try {
    const r = await rival.run("scripts/child-pane.ts", ["list"]);
    error(r, 9); expect(r.stdout + r.stderr).toMatch(/second live process|live owner/i);
    expect(c.s.calls()).toEqual([]); expect(readFileSync(c.path, "utf8")).toBe(bytes);
    const unknown = await runBun(c.s, "scripts/child-pane.ts", ["list"], "", { ...c.s.env, CLAUDE_CODE_SESSION_ID: SELF });
    error(unknown, 9); expect(unknown.stdout + unknown.stderr).toContain("cannot name its own Claude Code process");
    expect(c.s.calls()).toEqual([]); expect(readFileSync(c.path, "utf8")).toBe(bytes);
  } finally { await rival.stop(); }
}, 15_000);
test("[REQ-417] TEST-2702 a manager outside herdr or under tmux-in-herdr gets exit 10", async () => {
  const c = await space();
  error(await c.run(["list"], "", { HERDR_ENV: "", HERDR_PANE_ID: "", TMUX: "host" }), 10);
  mutateSim(c, s => { panesOf(s.tabs[0]!.tree)[0]!.shellPid = 777777; });
  error(await c.run(["list"], "", { TMUX: "host" }), 10);
  expect(inputCalls(c)).toEqual([]);
}, 15_000);
test("[REQ-418, REQ-428] TEST-2703 five opens keep start order, exact open/list JSON, launch claims, stable focus and geometry", async () => {
  const c = await space(), opened: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const r = await c.open("child-" + i); expect(r.code).toBe(0);
    expect(r.json).toEqual({
      pane: expect.any(String), tab: "w1:t1", main: "w1:p1", name: "child-" + i, colour: "green",
      dir: c.dir, branch: "main", claim: expect.any(String), typed: true, children: i,
      promptDir: join(c.s.ctx.stateDir, "prompts"), layout: { ...layoutShape, status: "applied", order: ["w1:p1", ...opened, r.json.pane], slots: [], foreign: [], restored: [], stranded: [] },
    });
    expect(r.json.line).toBeUndefined();
    opened.push(r.json.pane);
    expect(readClaim(c.s.ctx, r.json.claim)).toMatchObject({ key: r.json.claim, role: "child", parent: MANAGER, product: c.dir });
  }
  const registry = c.registry();
  expect(registry.children.map(e => e.pane)).toEqual(opened);
  const splits = c.s.calls().filter(a => a[1] === "split");
  expect(splits.map(a => a[2])).toEqual(["w1:p1", ...opened.slice(0, -1)]);
  for (const a of splits) expect(a).toEqual(["pane", "split", a[2]!, "--direction", "right", "--ratio", "0.5", "--cwd", c.dir, "--no-focus"]);
  for (const e of registry.children) {
    expect(e.terminal).toBe(child(c, e.pane).terminal);
    expect(e.line).toContain(e.claim);
    expect(c.s.calls()).toContainEqual(["pane", "run", e.pane, e.line]);
  }
  const before = readFileSync(c.path, "utf8"), r = await c.run(["list"]), list = json(r);
  expect(r.code).toBe(0);
  expect(list).toEqual({ main: "w1:p1", tab: "w1:t1", limit: 10,
    children: registry.children.map(e => ({ pane: e.pane, name: e.name, claim: e.claim, dir: e.dir, openedAt: e.openedAt, inTab: true, agent: "claude", status: "idle", occupant: "unbound" })),
    gone: [], slots: [], foreign: [], relayout: false });
  expect(readFileSync(c.path, "utf8")).toBe(before);
  const sim = c.s.sim(); expect(sim.tabs).toHaveLength(1); expect(sim.tabs[0]!.focused).toBe("w1:p1");
  expect(rectsOf(sim, "w1:t1").get("w1:p1")).toEqual({ x: 0, y: 0, width: 52, height: 49 });
}, 30_000);
test("[REQ-419] TEST-2704 seeded ten-child limit exits 12, past-limit opens and duplicate name exits 3", async () => {
  const c = await space();
  for (let i = 0; i < 10; i++) c.seed();
  error(await c.run(argsOpen(c.dir, "eleventh")), 12);
  expect(c.s.calls().some(a => a[1] === "split")).toBe(false);
  const r = await c.open("eleventh", c.dir, ["--past-limit"]);
  expect(r.code).toBe(0); expect(r.json.children).toBe(11);
  error(await c.run(argsOpen(c.dir, "eleventh", ["--past-limit"])), 3);
  expect(c.registry().children).toHaveLength(11);
}, 30_000);
test("[REQ-419] TEST-2704 off-default branch exits 2 and existing local worktree exits 3 without creating panes", async () => {
  const c = await space();
  const git = (args: string[]) => {
    const r = Bun.spawnSync(["git", "-C", c.dir, ...args], { env: c.s.env });
    if (r.exitCode) throw new Error(r.stderr.toString());
  };
  git(["checkout", "-b", "topic"]);
  error(await c.run(argsOpen(c.dir, "child-one")), 2);
  git(["checkout", "main"]);
  git(["worktree", "add", "-b", "child-one", join(c.dir, ".claude", "worktrees", "child-one")]);
  error(await c.run(argsOpen(c.dir, "child-one")), 3);
  expect(c.s.calls().filter(a => a[1] === "split")).toEqual([]);
}, 15_000);
test("[REQ-420, REQ-435] TEST-2705 concurrent opens on different checkouts keep both registry entries", async () => {
  const c = await space(), other = gitCheckout(c.s, "other-checkout");
  const results = await Promise.all([c.run(argsOpen(c.dir, "child-one")), c.run(argsOpen(other, "child-two"))]);
  expect(results.map(r => r.code)).toEqual([0, 0]);
  expect(c.registry().children.map(e => e.name).sort()).toEqual(["child-one", "child-two"]);
  expect(panesOf(c.s.sim().tabs[0]!.tree).map(p => p.id)).toEqual(["w1:p1", ...c.registry().children.map(e => e.pane)]);
  expect(c.s.calls().filter(a => a[1] === "run")).toHaveLength(2);
}, 30_000);
test("[REQ-420, REQ-422, REQ-435] TEST-2705 a shared checkout stays locked until the first delayed agent is up", async () => {
  const c = await space(), sessions = ["shared001", "shared002"];
  mutateSim(c, s => { s.splitQueue = [
    { onRun: [{ agentAfterMs: 3000, agentSession: sessions[0]! }] },
    { onRun: [{ agent: true, agentSession: sessions[1]! }] },
  ]; });
  const first = c.run(argsOpen(c.dir, "child-one"));
  await until(() => c.s.sim().tabs.flatMap(t => panesOf(t.tree)).some(p => p.agentReadyAt !== undefined));
  const readyAt =c.s.sim().tabs.flatMap(t => panesOf(t.tree)).find(p => p.agentReadyAt !== undefined)!.agentReadyAt!;
  const second = c.run(argsOpen(c.dir, "child-two"));
  const results = await Promise.all([first, second]);
  expect(results.map(r => r.code)).toEqual([0, 0]);
  const runs = c.s.events().filter(e => e.argv[1] === "run");
  expect(runs).toHaveLength(2); expect(runs[1]!.at).toBeGreaterThanOrEqual(readyAt);
  for (const [i, r] of results.entries()) {
    const e = json(r);
    c.s.identity(identity({ key: e.claim, sessionId: sessions[i]!, role: "child", parent: MANAGER, pid: null, procStart: null }));
    expect((await c.run(["wait", "--pane", e.pane, "--until", "up", "--timeout-ms", "1000"])).code).toBe(0);
  }
}, 30_000);
test("[REQ-420] TEST-2705 checkout --no-wait exits 6 with no herdr activity or claim", async () => {
  const c = await space(), lock = lockPathFor(c.s.ctx.stateDir, c.dir);
  mkdirSync(lock, { recursive: true }); writeFileSync(join(lock, "info.json"), JSON.stringify({ pid: c.a.pid, name: "busy", since: Date.now() }));
  const claims = readdirSync(join(c.s.ctx.stateDir, "claims"));
  error(await c.run(argsOpen(c.dir, "child-one", ["--no-wait"]), "", { ORCHESTRATOR_MULTIPLEXER: "herdr" }), 6, "checkout-busy");
  expect(c.s.calls()).toEqual([]); expect(readdirSync(join(c.s.ctx.stateDir, "claims"))).toEqual(claims);
}, 15_000);
test("[REQ-420] TEST-2710 concurrent open and close preserve both effects", async () => {
  const c = await space(), e = c.seed();
  const results = await Promise.all([c.run(argsOpen(c.dir, "new-child")), c.run(["close", "--pane", e.pane])]);
  expect(results.map(r => r.code)).toEqual([0, 0]);
  expect(c.registry().children.map(e => e.name)).toEqual(["new-child"]);
  expect(c.registry().ended).toContainEqual({ pane: e.pane, name: e.name, how: "closed", at: expect.any(Number) });
}, 30_000);
test("[REQ-418] TEST-2710 a shell that never readies returns typed:false and releases the checkout lock", async () => {
  const c = await space(); mutateSim(c, s => { s.splitQueue = [{ foregroundPids: [987654] }]; });
  const r = await c.open();
  expect(r.code).toBe(1); expect(r.json).toMatchObject({ pane: expect.any(String), typed: false, promptDir: join(c.s.ctx.stateDir, "prompts") });
  expect(c.registry().children).toHaveLength(1);
  expect(existsSync(lockPathFor(c.s.ctx.stateDir, c.dir))).toBe(false);
  expect(c.s.calls().filter(a => a[1] === "run")).toEqual([]);
}, 30_000);
test("[REQ-421] TEST-2706 failed pane list leaves registry byte-identical and cannot reconcile a partial list", async () => {
  const c = await space(); c.seed(); const bytes = readFileSync(c.path, "utf8");
  for (const answer of [
    { exitCode: 1, stderr: JSON.stringify({ error: { code: "server_not_running", message: "offline" } }) },
    { exitCode: 0, stdout: '{"result":{"panes":[{"pane_id":"w1:p1"}]}}' },
  ]) {
    mutateSim(c, s => { s.responses = [{ argv: ["pane", "list"], ...answer }]; });
    error(await c.run(["layout"]), 1);
    expect(readFileSync(c.path, "utf8")).toBe(bytes);
  }
  expect(inputCalls(c)).toEqual([]);
}, 15_000);
test("[REQ-414, REQ-421, REQ-425] TEST-2706 server restart reusing manager and child ids reports gone, never closes replacements", async () => {
  const c = await space(), e = c.seed(); const bytes = readFileSync(c.path, "utf8");
  mutateSim(c, simRestart);
  const r = await c.run(["list"]); expect(r.code).toBe(0);
  expect(json(r)).toMatchObject({ children: [], gone: [e.pane], relayout: true, foreign: [e.pane] });
  expect(readFileSync(c.path, "utf8")).toBe(bytes);
  error(await c.run(["close", "--pane", e.pane, "--force"]), 5);
  expect(c.s.calls().filter(a => a[1] === "close")).toEqual([]);
}, 15_000);
test("[REQ-428] TEST-2706 an unplanned close appears in list, layout records it and future pane commands return 5", async () => {
  const c = await space(), first = c.seed(), gone = c.seed(), last = c.seed();
  mutateSim(c, s => { simRunner(s)(["pane", "close", gone.pane]); });
  const before = readFileSync(c.path, "utf8"), result = await c.run(["list"]);
  expect(json(result)).toMatchObject({ children: expect.any(Array), gone: [gone.pane], relayout: true });
  expect(readFileSync(c.path, "utf8")).toBe(before);
  expect((await c.run(["layout"])).code).toBe(0);
  expect(c.registry().children.map(e => e.pane)).toEqual([first.pane, last.pane]);
  expect(c.registry().ended).toContainEqual({ pane: gone.pane, name: gone.name, at: expect.any(Number), how: "gone" });
  error(await c.run(["read", "--pane", gone.pane]), 5);
}, 15_000);
test("[REQ-428] TEST-2707 close refuses working/busy/unbound occupants unless forced, and never forces another agent", async () => {
  const c = await space(), working = c.seed({ agentStatus: "working" });
  error(await c.run(["close", "--pane", working.pane]), 13, "working");
  const r = await c.run(["close", "--pane", working.pane, "--force"]);
  expect(r.code).toBe(0);
  expect(json(r)).toEqual({ closed: working.pane, children: 0, layout: { ...layoutShape, status: "unchanged", order: ["w1:p1"], slots: [], foreign: [], restored: [], stranded: [] } });
  const busy = c.seed({ agentStatus: "unknown", foregroundPids: [999999] }, false);
  error(await c.run(["close", "--pane", busy.pane]), 13, "busy");
  const unbound = c.seed({}, false);
  error(await c.run(["close", "--pane", unbound.pane]), 13, "unbound");
  expect((await c.run(["close", "--pane", unbound.pane, "--force"])).code).toBe(0);
  const other = c.seed({ agentSession: "wrong001" }); editChild(c, other.pane, { agentSession: "wrong002" });
  error(await c.run(["close", "--pane", other.pane, "--force"]), 13, "other-agent");
}, 15_000);
test("[REQ-428] TEST-2707 a session aliased to another record is other-agent for prompt, send and forced close", async () => {
  const c = await space(), e = c.seed({ agentSession: "known001" }, false);
  c.s.identity(identity({ key: "s-other001", sessionId: "known001", role: "child", pid: null, procStart: null })); c.s.alias("known001", "s-other001");
  const prompt = c.promptFile("report your result");
  for (const args of [
    ["prompt", "--pane", e.pane, "--prompt-file", prompt],
    ["send", "--pane", e.pane, "--text", "hello"],
    ["close", "--pane", e.pane, "--force"],
  ]) error(await c.run(args), 13, "other-agent");
  expect(inputCalls(c)).toEqual([]);
}, 30_000);
test("[REQ-428] TEST-2708 closing a middle child keeps the remaining order and applies n-minus-one geometry", async () => {
  const c = await space(), a = c.seed(), b = c.seed(), d = c.seed();
  const r = await c.run(["close", "--pane", b.pane]);
  expect(r.code).toBe(0);
  expect(json(r)).toEqual({ closed: b.pane, children: 2, layout: { ...layoutShape, status: "applied", order: ["w1:p1", a.pane, d.pane], slots: [], foreign: [], restored: [], stranded: [] } });
  const sim = c.s.sim(); expect(sim.tabs[0]!.focused).toBe("w1:p1");
  expect(rectsOf(sim, "w1:t1").get("w1:p1")!.width).toBe(87);
}, 15_000);
test("[REQ-412, REQ-429] TEST-2709 foreign panes refuse layout without moves, but open and close still succeed", async () => {
  const c = await space();
  mutateSim(c, s => { simRunner(s)(["pane", "split", "w1:p1", "--direction", "right", "--no-focus"]); });
  const opened = await c.open();
  expect(opened.code).toBe(0); expect(opened.json.layout).toMatchObject({ status: "refused", foreign: ["w1:p2"], stranded: [] });
  expect(opened.stderr).toContain("layout left as it is: this tab holds panes the orchestrator did not open (w1:p2)");
  expect(c.s.calls().find(a => a[1] === "split")?.[2]).toBe("w1:p1");
  const layout = await c.run(["layout"]);
  expect(layout.code).toBe(15); expect(json(layout)).toMatchObject({ status: "refused", children: 1, foreign: ["w1:p2"] });
  const closed = await c.run(["close", "--pane", opened.json.pane, "--force"]);
  expect(closed.code).toBe(0); expect(json(closed).layout.status).toBe("refused");
  expect(c.s.calls().filter(a => a[1] === "move" || a[1] === "zoom")).toEqual([]);
}, 15_000);
function installSlot(c: ManagerSpace, manager: string, version = 1) {
  const s = c.s.sim(), r = simRunner(s)(["pane", "split", "w1:p1", "--direction", "right", "--no-focus"]);
  c.s.saveSim(s);
  const p = (r.json as { result: { pane: { pane_id: string; terminal_id: string } } }).result.pane;
  const base = join(c.s.env.XDG_STATE_HOME!, "tmux-mcp", "herdr"), hash = createHash("sha256").update(c.s.env.HERDR_SOCKET_PATH!).digest("hex");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, hash + ".json"), JSON.stringify({ version, panes: [{ pane_id: p.pane_id, terminal_id: p.terminal_id, owner: "agent", slot: 1 }] }));
  writeFileSync(join(base, hash + ".layout.json"), JSON.stringify({ version: 1, agents: [{ pane_id: p.pane_id, terminal_id: p.terminal_id, agent_pane_id: manager }], tabs: [] }));
  return p.pane_id;
}
for (const [manager, version, status] of [["w1:p1", 1, "applied"], ["another-manager", 1, "refused"], ["w1:p1", 2, "refused"]] as const)
  test("[REQ-412, REQ-415, REQ-435] TEST-2709 slot manager=" + manager + " version=" + version + " is " + status, async () => {
    const c = await space(), slot = installSlot(c, manager, version);
    const records = join(c.s.env.XDG_STATE_HOME!, "tmux-mcp", "herdr");
    const snapshot = () => readdirSync(records).sort().map(name => [name, readFileSync(join(records, name), "utf8")]);
    const slotBytes = snapshot();
    const r = await c.open();
    expect(snapshot()).toEqual(slotBytes);
    expect(r.code).toBe(0); expect(r.json.layout.status).toBe(status);
    if (status === "applied") {
      expect(r.json.layout.slots).toEqual([slot]); expect(r.json.children).toBe(1);
      expect(c.s.calls().find(a => a[1] === "split")?.[2]).toBe(slot);
      error(await c.run(["send", "--pane", slot, "--key", "enter"]), 11);
    } else expect(c.s.calls().filter(a => a[1] === "move")).toEqual([]);
  }, 15_000);
for (const until of ["up", "detected", "idle", "working", "blocked", "done"]) test("[REQ-422] TEST-2711 wait --until " + until + " reports reached with exact fields and never writes the registry", async () => {
  const c = await space(), e = c.seed({ agentStatus: until === "up" || until === "detected" ? "idle" : until as SimPane["agentStatus"] });
  const bytes = readFileSync(c.path, "utf8"), r = await c.run(["wait", "--pane", e.pane, "--until", until, "--timeout-ms", "1000"]);
  expect(r.code).toBe(0);
  expect(json(r)).toEqual({ pane: e.pane, until, reached: true, status: until === "up" || until === "detected" ? "idle" : until, waitedMs: expect.any(Number) });
  expect(readFileSync(c.path, "utf8")).toBe(bytes);
}, 15_000);
test("[REQ-422, REQ-423] TEST-2726 detected but unbound for more than 10 seconds waits for this child's bind, then sends its prompt", async () => {
  const c = await space(), sessionId = "delayed001";
  const e = c.seed({ agentStatus: "idle", agentSession: sessionId, screens: [simAgentScreen()] }, false);
  const bytes = readFileSync(c.path, "utf8");
  const detected = await c.run(["wait", "--pane", e.pane, "--until", "detected", "--timeout-ms", "1000"]);
  expect(detected.code).toBe(0);
  expect(json(detected)).toEqual({ pane: e.pane, until: "detected", reached: true, status: "idle", waitedMs: expect.any(Number) });

  const offset = c.s.events().length;
  const waiting = c.run(["wait", "--pane", e.pane, "--until", "up", "--timeout-ms", "25000"])
    .then(result => ({ result, completedAt: Date.now() }));
  const binding = (async () => {
    const isAgentGet = (event: { argv: string[] }) => event.argv[0] === "agent" && event.argv[1] === "get" && event.argv[2] === e.pane;
    await until(() => c.s.events().slice(offset).some(isAgentGet), 5000);
    const observedAt = c.s.events().slice(offset).find(isAgentGet)!.at;
    await until(() => Date.now() - observedAt >= 11_000, 15_000);
    const inputBeforeBind = inputCalls(c), boundAt = Date.now();
    c.s.identity(identity({ key: e.claim, sessionId, role: "child", parent: MANAGER, pid: null, procStart: null }));
    return { observedAt, boundAt, inputBeforeBind };
  })();
  const [completed, bound] = await Promise.all([waiting, binding]);

  expect(bound.boundAt - bound.observedAt).toBeGreaterThan(10_000);
  expect(completed.completedAt).toBeGreaterThanOrEqual(bound.boundAt);
  expect(bound.inputBeforeBind).toEqual([]);
  expect(completed.result.code).toBe(0);
  expect(json(completed.result)).toEqual({ pane: e.pane, until: "up", reached: true, status: "idle", waitedMs: expect.any(Number) });
  expect(inputCalls(c)).toEqual([]);
  const text = "report after readiness", path = c.promptFile(text);
  const delivered = await c.run(["prompt", "--pane", e.pane, "--prompt-file", path]);
  expect(delivered.code).toBe(0);
  expect(json(delivered)).toEqual({ pane: e.pane, outcome: "sent", inInput: null, log: join(c.s.ctx.stateDir, "ticket-window.log") });
  expect(c.s.calls().filter(a => a[1] === "send-text")).toEqual([["pane", "send-text", e.pane, text]]);
  expect(existsSync(path)).toBe(false);
  expect(readFileSync(c.path, "utf8")).toBe(bytes);
}, 45_000);

test("[REQ-422] TEST-2727 a named agent that never binds times out at the requested deadline without input", async () => {
  const c = await space(), e = c.seed({ agentStatus: "idle", agentSession: "neverbound001", screens: [simAgentScreen()] }, false);
  const bytes = readFileSync(c.path, "utf8"), timeoutMs = 2000, startedAt = performance.now();

  const result = await c.run(["wait", "--pane", e.pane, "--until", "up", "--timeout-ms", String(timeoutMs)]);
  const elapsed = performance.now() - startedAt;

  const body = error(result, 4), waitedMs = body.waitedMs;
  expect(body).toMatchObject({ pane: e.pane, until: "up", reached: false, waitedMs: expect.any(Number) });
  expect(waitedMs).toBeGreaterThanOrEqual(timeoutMs);
  expect(elapsed).toBeGreaterThanOrEqual(timeoutMs);
  expect(inputCalls(c)).toEqual([]);
  expect(readFileSync(c.path, "utf8")).toBe(bytes);
}, 15_000);

for (const kind of ["claim bound elsewhere", "session aliased elsewhere"] as const)
  test("[REQ-422] TEST-2728 other-agent with " + kind + " refuses at once with exit 13 and sends no input", async () => {
    const c = await space(), e = c.seed({ agentStatus: "idle", agentSession: "another001" }, false);
    if (kind === "claim bound elsewhere") {
      c.s.identity(identity({ key: e.claim, sessionId: "expected001", role: "child", parent: MANAGER, pid: null, procStart: null }));
    } else {
      c.s.identity(identity({ key: "s-another001", sessionId: "another001", role: "child", parent: MANAGER, pid: null, procStart: null }));
      c.s.alias("another001", "s-another001");
    }
    const bytes = readFileSync(c.path, "utf8"), startedAt = performance.now();

    const result = await c.run(["wait", "--pane", e.pane, "--until", "up", "--timeout-ms", "30000"]);
    const elapsed = performance.now() - startedAt;

    error(result, 13, "other-agent");
    expect(elapsed).toBeLessThan(10_000);
    expect(inputCalls(c)).toEqual([]);
    expect(readFileSync(c.path, "utf8")).toBe(bytes);
  }, 15_000);

test("[REQ-423, REQ-424] TEST-2729 direct prompt waits beyond 10 seconds for binding and then sends once", async () => {
  const c = await space(), sessionId = "promptbind001";
  const e = c.seed({ agentStatus: "idle", agentSession: sessionId, screens: [simAgentScreen()] }, false);
  const text = "report after binding", path = c.promptFile(text), bytes = readFileSync(c.path, "utf8");
  const offset = c.s.events().length;

  const prompting = c.run(["prompt", "--pane", e.pane, "--prompt-file", path])
    .then(result => ({ result, completedAt: Date.now() }));
  const binding = (async () => {
    const isAgentGet = (event: { argv: string[] }) => event.argv[0] === "agent" && event.argv[1] === "get" && event.argv[2] === e.pane;
    await until(() => c.s.events().slice(offset).some(isAgentGet), 5000);
    const observedAt = c.s.events().slice(offset).find(isAgentGet)!.at;
    await until(() => Date.now() - observedAt >= 11_000, 15_000);
    const inputBeforeBind = inputCalls(c), promptBeforeBind = existsSync(path) ? readFileSync(path, "utf8") : null, boundAt = Date.now();
    c.s.identity(identity({ key: e.claim, sessionId, role: "child", parent: MANAGER, pid: null, procStart: null }));
    return { observedAt, boundAt, inputBeforeBind, promptBeforeBind };
  })();
  const [completed, bound] = await Promise.all([prompting, binding]);

  expect(bound.boundAt - bound.observedAt).toBeGreaterThan(10_000);
  expect(completed.completedAt).toBeGreaterThanOrEqual(bound.boundAt);
  expect(bound.inputBeforeBind).toEqual([]);
  expect(bound.promptBeforeBind).toBe(text);
  expect(completed.result.code).toBe(0);
  expect(json(completed.result)).toEqual({ pane: e.pane, outcome: "sent", inInput: null, log: join(c.s.ctx.stateDir, "ticket-window.log") });
  expect(c.s.calls().filter(a => a[1] === "send-text")).toEqual([["pane", "send-text", e.pane, text]]);
  expect(existsSync(path)).toBe(false);
  expect(readFileSync(c.path, "utf8")).toBe(bytes);
}, 45_000);

test("[REQ-422] TEST-2712 wait distinguishes not-up, trust refusal, timeout and malformed operational responses", async () => {
  const c = await space(), e = c.seed({ agentStatus: "unknown", screens: ["Workspace trust not yet accepted"] }, false);
  error(await c.run(["wait", "--pane", e.pane, "--until", "up", "--timeout-ms", "1000"]), 7);
  error(await c.run(["wait", "--pane", e.pane, "--until", "idle", "--timeout-ms", "1000"]), 13, "not-up");
  expect((await c.run(["wait", "--pane", e.pane, "--until", "detected", "--timeout-ms", "1000"])).code).toBe(4);
  editChild(c, e.pane, { agentStatus: "working", screens: [simAgentScreen()] });
  expect((await c.run(["wait", "--pane", e.pane, "--until", "done", "--timeout-ms", "1000"])).code).toBe(4);
  mutateSim(c, s => { s.responses = [{ argv: ["agent", "get"], times: 3, stdout: "{", exitCode: 0 }]; });
  error(await c.run(["wait", "--pane", e.pane, "--until", "up", "--timeout-ms", "5000"]), 1);
}, 15_000);
test("[REQ-422] TEST-2713 wait-output treats patterns literally, maps captured timeout to exit 4 and returns pattern JSON", async () => {
  const c = await space(), e = c.seed({ screens: [simAgentScreen("Worktree removed (done).")] });
  const r = await c.run(["wait", "--pane", e.pane, "--pattern", "missing", "--pattern", "Worktree removed (done).", "--timeout-ms", "1000"]);
  expect(r.code).toBe(0);
  expect(json(r)).toEqual({ pane: e.pane, pattern: expect.anything(), reached: true, status: null, waitedMs: expect.any(Number) });
  const argv = c.s.calls().find(a => a[0] === "pane" && a[1] === "wait-output")!;
  const regex = new RegExp(argv[argv.indexOf("--regex") + 1]!);
  expect(regex.test("Worktree removed (done).")).toBe(true);
  expect(regex.test("Worktree removed xdonezx")).toBe(false);
  expect(argv[argv.indexOf("--source") + 1]).toBe("recent-unwrapped");
  expect(argv[argv.indexOf("--lines") + 1]).toBe("200");
  expect(argv[argv.indexOf("--timeout") + 1]).toBe("1000");
  expect((await c.run(["wait", "--pane", e.pane, "--pattern", "not present", "--timeout-ms", "1000"])).code).toBe(4);
}, 15_000);
for (const source of ["prompts", "scratch", "stdin"] as const) test("[REQ-423] TEST-2714 one-line prompt from " + source + " is delivered and only managed files are deleted", async () => {
  const c = await space(), e = c.seed(), text = "report the result", before = readFileSync(c.path, "utf8");
  const path = source === "prompts" ? c.promptFile(text + "\n\n") : join(c.s.root, "scratch-prompt.txt");
  if (source === "scratch") writeFileSync(path, text + "\n");
  const r = await c.run(["prompt", "--pane", e.pane, "--prompt-file", source === "stdin" ? "-" : path], source === "stdin" ? text + "\n" : "");
  expect(r.code).toBe(0);
  expect(json(r)).toEqual({ pane: e.pane, outcome: "sent", inInput: null, log: join(c.s.ctx.stateDir, "ticket-window.log") });
  expect(c.s.calls().filter(a => a[1] === "send-text")).toEqual([["pane", "send-text", e.pane, text]]);
  const input = c.s.events().filter(e => ["send-text", "send-keys"].includes(e.argv[1]!));
  expect(input[1]!.argv).toEqual(["pane", "send-keys", e.pane, "enter"]);
  expect(input[1]!.at - input[0]!.at).toBeGreaterThanOrEqual(2000);
  expect(readFileSync(c.path, "utf8")).toBe(before);
  if (source !== "stdin") expect(existsSync(path)).toBe(source === "scratch");
}, 30_000);
test("[REQ-423] TEST-2715 prompt files in a checkout, empty text and inner newlines fail without input", async () => {
  const c = await space(), e = c.seed(), path = join(c.dir, "prompt.txt"); writeFileSync(path, "do work");
  error(await c.run(["prompt", "--pane", e.pane, "--prompt-file", path]), 1);
  expect(readFileSync(path, "utf8")).toBe("do work");
  for (const text of ["", "\n\n", "line one\nline two", "one\rtwo"]) {
    const p = c.promptFile(text);
    error(await c.run(["prompt", "--pane", e.pane, "--prompt-file", p]), 1);
    expect(existsSync(p)).toBe(true);
  }
  expect(inputCalls(c)).toEqual([]);
}, 30_000);
test("[REQ-424] TEST-2716 prompt refuses blocked, not-up and unbound occupants without deleting retry files", async () => {
  const c = await space(), e = c.seed({ agentStatus: "blocked" }), p = c.promptFile("report");
  error(await c.run(["prompt", "--pane", e.pane, "--prompt-file", p]), 13, "blocked");
  editChild(c, e.pane, { agentStatus: "unknown" });
  error(await c.run(["prompt", "--pane", e.pane, "--prompt-file", p]), 13, "not-up");
  editChild(c, e.pane, { agentStatus: "idle", agentSession: "unbound001" }); rmSync(join(c.s.ctx.stateDir, "sessions", e.claim + ".json"));
  const bindWaitStarted = performance.now();
  error(await c.run(["prompt", "--pane", e.pane, "--prompt-file", p]), 13, "unbound");
  expect(performance.now() - bindWaitStarted).toBeGreaterThanOrEqual(60_000);
  expect(inputCalls(c)).toEqual([]); expect(existsSync(p)).toBe(true);
}, 90_000);
test("[REQ-424] TEST-2716 prompt waits through working until idle/done, and working timeout sends nothing", async () => {
  const c = await space(), e = c.seed({ agentStatus: "working", statusSequence: ["working", "working", "idle"] });
  const r = await c.run(["prompt", "--pane", e.pane, "--prompt-file", c.promptFile("report")]);
  expect(r.code).toBe(0);
  const calls = c.s.calls(), wait = calls.findIndex(a => a[0] === "agent" && a[1] === "wait" && a.includes("idle") && a.includes("done"));
  expect(wait).toBeGreaterThanOrEqual(0); expect(wait).toBeLessThan(calls.findIndex(a => a[1] === "send-text"));
  editChild(c, e.pane, { agentStatus: "working", statusSequence: [] });
  const before = c.s.calls().filter(a => a[1] === "send-text").length;
  error(await c.run(["prompt", "--pane", e.pane, "--prompt-file", c.promptFile("try later")]), 4, "working");
  expect(c.s.calls().filter(a => a[1] === "send-text")).toHaveLength(before);
}, 30_000);
test("[REQ-424, REQ-435] TEST-2717 a done child accepts a prompt and landing waits for working, never already-done", async () => {
  const c = await space(), e = c.seed({ agentStatus: "done" });
  const r = await c.run(["prompt", "--pane", e.pane, "--prompt-file", c.promptFile("report")]);
  expect(r.code).toBe(0); expect(json(r).outcome).toBe("sent");
  expect(c.s.calls().filter(a => a[1] === "send-text")).toHaveLength(1);
  const landed = c.s.calls().find(a => a[0] === "agent" && a[1] === "wait" && a.includes("working"));
  expect(landed).toBeDefined(); expect(landed).not.toContain("done");
}, 30_000);
for (const status of ["idle", "done"] as const) test("[REQ-424, REQ-435] TEST-2718 a dropped prompt into " + status + " is NOT_SENT after one retry, retained in input, never typed a third time", async () => {
  const c = await space(), e = c.seed({ agentStatus: status, dropSendTexts: 1, takesPrompt: false }), p = c.promptFile("report");
  const r = await c.run(["prompt", "--pane", e.pane, "--prompt-file", p]);
  expect(r.code).toBe(8);
  expect(json(r)).toEqual({ error: expect.stringMatching(/\S/), pane: e.pane, outcome: "not-sent", inInput: true, log: join(c.s.ctx.stateDir, "ticket-window.log") });
  expect(c.s.calls().filter(a => a[1] === "send-text")).toEqual([["pane", "send-text", e.pane, "report"], ["pane", "send-text", e.pane, "report"]]);
  expect(readFileSync(join(c.s.ctx.stateDir, "ticket-window.log"), "utf8")).toContain("NOT_SENT");
  expect(existsSync(p)).toBe(false);
}, 45_000);
test("[REQ-426] TEST-2719 send text/key are separate literal calls; shell text is refused but a key alone is allowed", async () => {
  const c = await space(), e = c.seed();
  const r = await c.run(["send", "--pane", e.pane, "--text", "look here", "--key", "ENTER"]);
  expect(r.code).toBe(0); expect(json(r)).toEqual({ pane: e.pane, typed: 9, key: "enter" });
  const events = c.s.events().filter(e => ["send-text", "send-keys"].includes(e.argv[1]!));
  expect(events.map(e => e.argv)).toEqual([["pane", "send-text", e.pane, "look here"], ["pane", "send-keys", e.pane, "enter"]]);
  expect(events[1]!.at - events[0]!.at).toBeGreaterThanOrEqual(2000);
  editChild(c, e.pane, { agentStatus: "unknown" });
  error(await c.run(["send", "--pane", e.pane, "--text", "not a shell command"]), 13, "not-up");
  const key = await c.run(["send", "--pane", e.pane, "--key", "down"]);
  expect(key.code).toBe(0); expect(json(key)).toEqual({ pane: e.pane, typed: 0, key: "down" });
  expect(c.s.calls().filter(a => a[1] === "send-text")).toHaveLength(1);
}, 15_000);
test("[REQ-426] TEST-2719 send accepts text files/stdin but rejects empty or multiline content before input", async () => {
  const c = await space(), e = c.seed(), p = join(c.s.root, "send.txt"); writeFileSync(p, "look\n");
  expect(json(await c.run(["send", "--pane", e.pane, "--text-file", p]))).toEqual({ pane: e.pane, typed: 4, key: null });
  expect(json(await c.run(["send", "--pane", e.pane, "--text-file", "-"], "here\n"))).toEqual({ pane: e.pane, typed: 4, key: null });
  const n = inputCalls(c).length;
  for (const text of ["", "\n\n", "a\nb", "a\rb"]) {
    writeFileSync(p, text);
    error(await c.run(["send", "--pane", e.pane, "--text-file", p]), 1);
  }
  error(await c.run(["send", "--pane", e.pane, "--text", "a\nb"]), 1);
  expect(inputCalls(c)).toHaveLength(n);
}, 15_000);
for (const restart of [["agent", "wait"], ["pane", "send-text"]] as const) test("[REQ-425, REQ-435] TEST-2720 prompt restart after " + restart.join(" ") + " exits GONE and sends nothing further", async () => {
  const c = await space(), e = c.seed();
  mutateSim(c, s => { s.restartWhen = { argv: [...restart], nth: 1 }; });
  const p = c.promptFile("report"), r = await c.run(["prompt", "--pane", e.pane, "--prompt-file", p]);
  expect(r.code).toBe(5);
  expect(json(r)).toEqual({ error: expect.stringMatching(/\S/), pane: e.pane, outcome: "gone", inInput: null, log: join(c.s.ctx.stateDir, "ticket-window.log") });
  expect(c.s.calls().filter(a => a[1] === "send-text")).toHaveLength(restart[1] === "send-text" ? 1 : 0);
  expect(c.s.calls().filter(a => a[1] === "send-keys")).toEqual([]);
  expect(readFileSync(join(c.s.ctx.stateDir, "ticket-window.log"), "utf8")).toContain("GONE");
  expect(existsSync(p)).toBe(true);
}, 30_000);
test("[REQ-425] TEST-2720 send rechecks the witness after its text/key pause; close also checks immediately before closing", async () => {
  const c = await space(), e = c.seed();
  mutateSim(c, s => { s.restartWhen = { argv: ["pane", "send-text"], nth: 1 }; });
  error(await c.run(["send", "--pane", e.pane, "--text", "hello", "--key", "enter"]), 5);
  expect(c.s.calls().filter(a => a[1] === "send-keys")).toEqual([]);
  const d = await space(), second = d.seed(), bytes = readFileSync(d.path, "utf8");
  mutateSim(d, s => { s.restartWhen = { argv: ["agent", "get"], nth: 1 }; });
  error(await d.run(["close", "--pane", second.pane, "--force"]), 5);
  expect(d.s.calls().filter(a => a[1] === "close")).toEqual([]);
  expect(readFileSync(d.path, "utf8")).toBe(bytes);
}, 15_000);
test("[REQ-425] TEST-2720 wait rechecks its witness even when herdr answered reached", async () => {
  const c = await space(), e = c.seed();
  mutateSim(c, s => { s.restartWhen = { argv: ["agent", "wait"], nth: 1 }; });
  expect((await c.run(["wait", "--pane", e.pane, "--until", "idle", "--timeout-ms", "1000"])).code).toBe(5);
}, 15_000);
test("[REQ-425] TEST-2720 delivery with the right terminal but no remaining agent never types into the shell", async () => {
  const c = await space(), e = c.seed();
  mutateSim(c, s => { s.responses = [{
    argv: ["agent", "wait"], after: "remove-agent", stdout: JSON.stringify({ result: { agent: { agent: "claude", agent_status: "idle" }, type: "agent_info" } }),
  }]; });
  const r = await c.run(["prompt", "--pane", e.pane, "--prompt-file", c.promptFile("report")]);
  expect(r.code).toBe(5); expect(json(r).outcome).toBe("gone");
  expect(c.s.calls().filter(a => a[1] === "send-text")).toEqual([]);
}, 30_000);
test("[REQ-422, REQ-427, REQ-435] TEST-2721 full trust recovery keeps the old refusal scoped to its launch, retypes once and delivers one new prompt", async () => {
  const c = await space();
  mutateSim(c, s => { s.splitQueue = [{ onRun: [
    { append: "Workspace trust not yet accepted", agent: false },
    { append: "Yes, I trust this folder", agentAfterMs: 10000 },
    { agent: true, agentSession: "recovered001" },
  ], shellAfterQuitMs: 2000 }]; });
  const opened = await c.open(); expect(opened.code).toBe(0);
  const e = c.registry().children[0]!;
  error(await c.run(["wait", "--pane", e.pane, "--until", "up", "--timeout-ms", "1000"]), 7);
  const trust = await c.run(["trust", "--pane", e.pane]);
  expect(trust.code).toBe(0); expect(json(trust)).toEqual({ pane: e.pane, typed: true });
  expect(c.s.calls().filter(a => a[1] === "run" && a[3] === "claude")).toHaveLength(1);
  expect((await c.run(["wait", "--pane", e.pane, "--pattern", "Yes, I trust", "--timeout-ms", "1000"])).code).toBe(0);
  await c.run(["send", "--pane", e.pane, "--key", "down"]); await c.run(["read", "--pane", e.pane]);
  await c.run(["send", "--pane", e.pane, "--key", "enter"]);
  error(await c.run(["send", "--pane", e.pane, "--text", "/quit"]), 13, "not-up");
  editChild(c, e.pane, { agentReadyAt: Date.now() - 1 });
  expect((await c.run(["wait", "--pane", e.pane, "--until", "detected", "--timeout-ms", "1000"])).code).toBe(0);
  expect((await c.run(["read", "--pane", e.pane])).stdout).toContain("Workspace trust not yet accepted");
  expect((await c.run(["send", "--pane", e.pane, "--text", "/quit", "--key", "enter"])).code).toBe(0);
  const retype = await c.run(["retype", "--pane", e.pane]);
  expect(retype.code).toBe(0); expect(json(retype)).toEqual({ pane: e.pane, typed: true });
  expect(c.s.calls().filter(a => a[1] === "run" && a[3] === e.line)).toHaveLength(2);
  c.s.identity(identity({ key: e.claim, sessionId: "recovered001", role: "child", parent: MANAGER, pid: null, procStart: null }));
  expect((await c.run(["wait", "--pane", e.pane, "--until", "up", "--timeout-ms", "1000"])).code).toBe(0);
  const delivered = await c.run(["prompt", "--pane", e.pane, "--prompt-file", c.promptFile("report the result")]);
  expect(delivered.code).toBe(0); expect(json(delivered).outcome).toBe("sent");
  expect(c.s.calls().filter(a => a[1] === "send-text" && a[3] === "report the result")).toHaveLength(1);
}, 30_000);
test("[REQ-427] TEST-2723 trust/retype refuse bound claims; expired claims fail and busy agents are never re-launched", async () => {
  const c = await space(), bound = c.seed();
  error(await c.run(["trust", "--pane", bound.pane]), 13, "bound");
  error(await c.run(["retype", "--pane", bound.pane]), 13, "bound");
  const unbound = c.seed({}, false);
  error(await c.run(["trust", "--pane", unbound.pane]), 13, "busy");
  editChild(c, unbound.pane, { agentStatus: "unknown" });
  rmSync(join(c.s.ctx.stateDir, "claims", unbound.claim + ".json"));
  error(await c.run(["retype", "--pane", unbound.pane]), 1);
  expect(c.s.calls().filter(a => a[1] === "run")).toEqual([]);
}, 15_000);
test("[REQ-427] TEST-2723 retype uses only the stored line, never a line reconstructed from caller arguments", async () => {
  const c = await space(), e = c.seed({ agentStatus: "unknown" }, false);
  const r = await c.run(["retype", "--pane", e.pane]);
  expect(r.code).toBe(0); expect(json(r)).toEqual({ pane: e.pane, typed: true });
  expect(c.s.calls().filter(a => a[1] === "run")).toEqual([["pane", "run", e.pane, e.line]]);
}, 15_000);
for (const command of ["list", "read", "wait", "send", "prompt", "trust", "retype"] as const) test("[REQ-421] TEST-2724 " + command + " neither replaces nor rewrites its registry file", async () => {
  const c = await space(), launching = command === "trust" || command === "retype";
  const e = c.seed(launching ? { agentStatus: "unknown" } : {}, !launching);
  const bytes = readFileSync(c.path, "utf8"), before = statSync(c.path);
  const args = command === "list" ? ["list"] :
    command === "wait" ? ["wait", "--pane", e.pane, "--until", "up", "--timeout-ms", "1000"] :
    command === "send" ? ["send", "--pane", e.pane, "--key", "escape"] :
    command === "prompt" ? ["prompt", "--pane", e.pane, "--prompt-file", c.promptFile("report")] :
    [command, "--pane", e.pane];
  expect((await c.run(args)).code).toBe(0);
  const after = statSync(c.path);
  expect(readFileSync(c.path, "utf8")).toBe(bytes);
  expect({ ino: after.ino, mtimeMs: after.mtimeMs }).toEqual({ ino: before.ino, mtimeMs: before.mtimeMs });
}, command === "prompt" ? 30_000 : 15_000);

test("[REQ-428, REQ-421] TEST-2724 read is agent-first plain text with shell fallback and every reading command leaves the registry unchanged", async () => {
  const c = await space(), e = c.seed({ screens: [simAgentScreen("report ready")] }), before = readFileSync(c.path, "utf8");
  const r = await c.run(["read", "--pane", e.pane, "--lines", "20"]);
  expect(r.code).toBe(0); expect(r.stdout.trimEnd()).toBe(simAgentScreen("report ready").trimEnd());
  expect(c.s.calls()).toContainEqual(["agent", "read", e.pane, "--source", "recent-unwrapped", "--lines", "20"]);
  editChild(c, e.pane, { agentStatus: "unknown", screens: ["shell report"] });
  expect((await c.run(["read", "--pane", e.pane, "--lines", "12"])).stdout.trimEnd()).toBe("shell report");
  expect(c.s.calls()).toContainEqual(["pane", "read", e.pane, "--source", "recent-unwrapped", "--lines", "12"]);
  expect(readFileSync(c.path, "utf8")).toBe(before);
  error(await c.run(["read", "--pane", "w1:pZ"]), 11);
}, 15_000);
test("[REQ-429] TEST-2725 stranded layout exits 14 but open still types and returns its full JSON", async () => {
  const c = await space(); c.seed();
  mutateSim(c, s => { s.failArgv = ["pane", "move", "w1:p2", "--tab"]; });
  const r = await c.open("next-child");
  expect(r.code).toBe(14); expect(r.json.typed).toBe(true);
  expect(r.json.layout.status).toBe("failed"); expect(r.json.layout.stranded).toContain("w1:p2");
  expect(r.json.layout.error).toContain("herdr pane move w1:p2 --tab w1:t1");
  expect(c.s.calls()).toContainEqual(["pane", "run", r.json.pane, c.registry().children.find(e => e.pane === r.json.pane)!.line]);
}, 15_000);
test("[REQ-429] TEST-2725 standalone layout returns unchanged/applied/failed JSON with children and correct exit codes", async () => {
  const c = await space();
  expect(json(await c.run(["layout"]))).toEqual({ status: "unchanged", order: ["w1:p1"], slots: [], foreign: [], restored: [], stranded: [], error: null, children: 0 });
  c.seed();
  const applied = await c.run(["layout"]); expect(applied.code).toBe(0);
  expect(json(applied)).toEqual({ ...layoutShape, status: "applied", order: ["w1:p1", "w1:p2"], slots: [], foreign: [], restored: [], stranded: [], children: 1 });
  mutateSim(c, s => { s.failArgv = ["pane", "move", "w1:p2", "--new-tab"]; });
  const failed = await c.run(["layout"]); expect(failed.code).toBe(1);
  expect(json(failed)).toMatchObject({ status: "failed", children: 1, stranded: [], error: expect.any(String) });
}, 15_000);
