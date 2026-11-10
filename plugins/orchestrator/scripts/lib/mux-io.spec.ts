import { afterEach, expect, test } from "bun:test";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { managerSpace, type ManagerSpace, mutateSim, json } from "./child-process-testdata";
import { runBun, psTable, spawnEval, collect, script } from "./process-testdata";
import { panesOf } from "./testdata/herdr-sim";
import { readIdentity } from "./record-store";
import { MANAGER, SELF } from "../../tests/testdata";
const contexts: ManagerSpace[] = [];
const space = async () => { const c = await managerSpace(); contexts.push(c); return c; };
afterEach(async () => { for (const c of contexts.splice(0)) await c.cleanup(); });
const probeError = (c: ManagerSpace, code: string) => mutateSim(c, s => { s.responses = [{ argv: ["pane", "process-info"], times: 50, exitCode: 1, stderr: JSON.stringify({ error: { code, message: code } }) }]; });
const query = (c: ManagerSpace) => c.a.run("scripts/orch-config.ts", ["multiplexer"], "", c.s.env);
const start = (c: ManagerSpace) => c.a.run("hooks/session-record.ts", [], JSON.stringify({ session_id: SELF, hook_event_name: "SessionStart", source: "startup", cwd: c.dir }), c.s.env);
for (const hosts of [true, false]) test("[REQ-401, REQ-404] TEST-2501 process ancestry distinguishes herdr-in-tmux from tmux-in-herdr, hosts=" + hosts, async () => {
  const c = await space(); c.s.env.TMUX = "host";
  psTable(c.s, "$CALLER " + (hosts ? process.pid : "333333") + "\n" + process.pid + " 1\n");
  if (!hosts) mutateSim(c, s => { panesOf(s.tabs[0]!.tree)[0]!.shellPid = 777777; });
  const r = await query(c);
  expect(r.code).toBe(0);
  expect(json(r).session).toEqual({ mux: hosts ? "herdr" : "tmux", source: "detected", nesting: hosts ? "herdr-in-tmux" : "tmux-in-herdr" });
  await start(c);
  expect(readIdentity(c.s.ctx, MANAGER)?.herdr).toEqual(hosts ? { pane: "w1:p1", tab: "w1:t1", workspace: "w1" } : null);
  if (!hosts) expect((await c.run(["list"])).code).toBe(10);
}, 15_000);
test("[REQ-401, REQ-404, REQ-417] TEST-2501 stderr pane_not_found agrees across config, hook and child command", async () => {
  const c = await space(); c.s.env.TMUX = "host"; probeError(c, "pane_not_found");
  expect(json(await query(c)).session).toEqual({ mux: "tmux", source: "detected", nesting: "tmux-in-herdr" });
  await start(c); expect(readIdentity(c.s.ctx, MANAGER)?.herdr).toBeNull();
  expect((await c.run(["list"])).code).toBe(10);
}, 15_000);
test("[REQ-404] TEST-2502 a failed process table proves nothing and the hook keeps the herdr ids", async () => {
  const c = await space(); c.s.env.TMUX = "host"; psTable(c.s, null);
  expect(json(await query(c)).session).toMatchObject({ mux: "herdr", nesting: "herdr-in-tmux" });
  await start(c); expect(readIdentity(c.s.ctx, MANAGER)?.herdr?.pane).toBe("w1:p1");
}, 15_000);
for (const exists of [true, false]) for (const tmux of [true, false])
  test("[REQ-404] TEST-2502 server_not_running socket present=" + exists + " tmux=" + tmux, async () => {
    const c = await space(); if (tmux) c.s.env.TMUX = "host";
    if (!exists) rmSync(c.s.env.HERDR_SOCKET_PATH!);
    probeError(c, "server_not_running");
    const r = await query(c);
    if (exists) expect(json(r).session).toMatchObject({ mux: "herdr" });
    else if (tmux) expect(json(r).session).toMatchObject({ mux: "tmux" });
    else { expect(r.code).toBe(1); expect(json(r).session).toEqual({ error: "not inside tmux or herdr" }); }
  }, 15_000);
test("[REQ-401, REQ-434] TEST-2503 forced values skip process probes entirely", async () => {
  const c = await space(); c.s.env.TMUX = "host";
  for (const forced of ["tmux", "herdr", "bad"]) {
    c.s.env.ORCHESTRATOR_MULTIPLEXER = forced;
    await query(c);
  }
  expect(c.s.calls()).toEqual([]);
}, 15_000);
test("[REQ-404, REQ-434] TEST-2503 probe timeout stays unknown; fallback availability and execution use the same executable", async () => {
  const c = await space(), fallbackDir = join(c.s.env.HOME!, ".local", "bin");
  mkdirSync(fallbackDir, { recursive: true });
  renameSync(join(c.s.bin, "herdr"), join(fallbackDir, "herdr"));
  const q = await query(c);
  expect(json(q).herdrInstalled).toBe(true);
  expect(c.s.calls()).toContainEqual(["pane", "process-info", "--pane", "w1:p1"]);
  rmSync(join(fallbackDir, "herdr"));
  expect(json(await query(c)).herdrInstalled).toBe(false);
  // The injectable runner is public: a timed-out external dependency is unknown,
  // not "absent", without making the process test wait on a real server.
  const code = [
    "const {sessionMuxNow}=await import(process.env.QA_MODULE);",
    "console.log(JSON.stringify(sessionMuxNow(JSON.parse(process.env.QA_ENV),{home:process.env.HOME,stateDir:process.env.ORCHESTRATOR_STATE_DIR,run:()=>({ok:false,exitCode:null,stdout:'',stderr:'timeout',timedOut:true,json:null,errorCode:null}),ps:()=>null})));",
  ].join("\n");
  const r = await collect(spawnEval(c.s, code, { QA_MODULE: script("scripts/lib/mux-io.ts"), QA_ENV: JSON.stringify(c.s.env) }), "");
  expect(r.code).toBe(0); expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, mux: "herdr" });
}, 15_000);
