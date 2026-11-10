import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ancestor, sandbox, gitCheckout, type Sandbox, type ProcessResult } from "./process-testdata";
import { simTab, simRunner, simAgentScreen, panesOf, type SimPane, type SimState } from "./testdata/herdr-sim";
import { identity, claim, SELF, MANAGER } from "../../tests/testdata";
import { lockPathFor } from "./window";
import type { PaneEntry, PanesFile } from "./child-pane-core";
import type { OrchestratorRole } from "./state-core";

export async function until(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) { if (Date.now() >= deadline) throw new Error("Test-owned state did not reach its expected condition"); await Bun.sleep(20); }
}
export async function managerSpace(role: OrchestratorRole = "manager") {
  const s = sandbox(), dir = gitCheckout(s), state = simTab(["w1:p1"]);
  panesOf(state.tabs[0]!.tree)[0]!.shellPid = process.pid;
  s.installHerdr({ sim: state });
  Object.assign(s.env, { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_TAB_ID: "w1:t1", HERDR_WORKSPACE_ID: "w1", HERDR_SOCKET_PATH: join(s.root, "herdr.sock") });
  writeFileSync(s.env.HERDR_SOCKET_PATH!, "simulated socket");
  const a = await ancestor(s, SELF);
  s.identity(identity({ role, pid: a.pid, procStart: a.procStart, product: dir, cwd: dir, herdr: { pane: "w1:p1", tab: "w1:t1", workspace: "w1" } }));
  s.alias(SELF, MANAGER);
  const path = join(s.ctx.stateDir, "panes", MANAGER + ".json");
  const registry = (): PanesFile => JSON.parse(readFileSync(path, "utf8"));
  const save = (file: PanesFile) => { mkdirSync(join(s.ctx.stateDir, "panes"), { recursive: true }); writeFileSync(path, JSON.stringify(file)); };
  const run = (args: string[], input = "", env: Record<string, string> = {}) => a.run("scripts/child-pane.ts", args, input, { ...s.env, ...env });
  function seed(patch: Partial<SimPane> = {}, bound = true): PaneEntry {
    const state = s.sim(), local = simRunner(state);
    const r = local(["pane", "split", panesOf(state.tabs[0]!.tree).at(-1)!.id, "--direction", "right", "--ratio", ".5", "--no-focus"]);
    const body = (r.json as { result: { pane: { pane_id: string; terminal_id: string } } }).result.pane;
    const n = state.nextPane;
    const session = "agent" + String(n).padStart(4, "0");
    Object.assign(panesOf(state.tabs[0]!.tree).find(p => p.id === body.pane_id)!, { agentStatus: "idle", agentSession: session, screens: [simAgentScreen()], ...patch });
    s.saveSim(state);
    const entry: PaneEntry = { pane: body.pane_id, terminal: body.terminal_id, name: "child-" + n, claim: "l-" + String(n).padStart(12, "0"), dir, openedAt: Date.now(), line: "launch " + n };
    const file: PanesFile = existsSync(path) ? registry() : { schema: 1, manager: MANAGER, main: "w1:p1", mainTerminal: "term_1", children: [], ended: [] };
    file.children.push(entry); save(file);
    s.claim(claim({ key: entry.claim, role: "child", name: entry.name, product: dir, parent: MANAGER }));
    if (bound) s.identity(identity({ key: entry.claim, sessionId: patch.agentSession ?? session, previousIds: [], role: "child", parent: MANAGER, product: dir, cwd: dir, pid: null, procStart: null }));
    return entry;
  }
  const open = async (name = "child-one", checkout = dir, extra: string[] = []) => {
    const r = await run(["open", "--dir", checkout, "--name", name, "--colour", "green", ...extra]);
    if (r.code === 0) await until(() => !existsSync(lockPathFor(s.ctx.stateDir, checkout)));
    return { ...r, json: JSON.parse(r.stdout) };
  };
  const promptFile = (text: string, name = "prompt.txt") => {
    const path = join(s.ctx.stateDir, "prompts", name);
    mkdirSync(join(s.ctx.stateDir, "prompts"), { recursive: true }); writeFileSync(path, text); return path;
  };
  return { s, a, dir, path, run, registry, save, seed, open, promptFile,
    async cleanup() { await a.stop(); s.cleanup(); } };
}
export type ManagerSpace = Awaited<ReturnType<typeof managerSpace>>;
export function json(r: ProcessResult): Record<string, any> { return JSON.parse(r.stdout); }
export function mutateSim(c: ManagerSpace, change: (state: SimState) => void): void {
  const state = c.s.sim(); change(state); c.s.saveSim(state);
}
