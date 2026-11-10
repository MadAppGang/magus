import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { managerSpace, mutateSim, until, json, type ManagerSpace } from "./lib/child-process-testdata";
import { runBun } from "./lib/process-testdata";
import { lockPathFor } from "./lib/window";
const contexts: ManagerSpace[] = [];
const space = async () => { const c = await managerSpace(); contexts.push(c); return c; };
afterEach(async () => { for (const c of contexts.splice(0)) await c.cleanup(); });
const start = (c: ManagerSpace, extra: string[] = [], env: Record<string, string> = {}) =>
  runBun(c.s, "scripts/ticket-window.ts", ["--dir", c.dir, "--name", "new-window", "--colour", "green", ...extra], "", env);
function stored(c: ManagerSpace) {
  writeFileSync(join(c.s.ctx.stateDir, "config.json"), JSON.stringify({ schema: 1, multiplexer: "herdr", multiplexerAnsweredAt: 1 }));
}
test("[REQ-402, REQ-403] TEST-2601 stored herdr in plain tmux creates a tab in the focused workspace, using the fallback executable too", async () => {
  const c = await space(); stored(c);
  const fallback = join(c.s.env.HOME!, ".local", "bin"); mkdirSync(fallback, { recursive: true });
  renameSync(join(c.s.bin, "herdr"), join(fallback, "herdr"));
  const r = await start(c, [], { HERDR_ENV: "", HERDR_PANE_ID: "", HERDR_WORKSPACE_ID: "", TMUX: "host" });
  expect(r.code).toBe(0);
  const opened = json(r);
  expect(opened).toMatchObject({ multiplexer: "herdr", dir: c.dir });
  expect(c.s.calls().filter(a => a[0] === "pane" && a[1] === "run")).toEqual([
    ["pane", "run", opened.pane, expect.stringContaining("claude -w new-window -n new-window '/color green'")],
  ]);
  expect(c.s.calls().filter(a => a[0] === "tab" && a[1] === "create")).toEqual([
    ["tab", "create", "--workspace", "w1", "--cwd", c.dir, "--label", "new-window", "--no-focus"],
  ]);
  await until(() => !existsSync(lockPathFor(c.s.ctx.stateDir, c.dir)));
}, 15_000);
test("[REQ-402] TEST-2601 no server for the stored herdr choice is an error, never silent tmux fallback", async () => {
  const c = await space(); stored(c);
  mutateSim(c, s => { s.responses = [{ argv: ["workspace", "list"], exitCode: 1, stderr: JSON.stringify({ error: { code: "server_not_running", message: "no server" } }) }]; });
  const r = await start(c, [], { HERDR_ENV: "", HERDR_PANE_ID: "", HERDR_WORKSPACE_ID: "", TMUX: "host" });
  expect(r.code).toBe(1);
  expect(r.stdout + r.stderr).toContain("herdr is your stored choice for new ticket windows, but no herdr server answers. Start herdr, or run orch-config.ts multiplexer --set tmux.");
  expect(c.s.calls().filter(a => a[0] === "tab" && a[1] === "create")).toEqual([]);
}, 15_000);
for (const location of ["outside", "tmux", "herdr", "forced-herdr"] as const) test("[REQ-403] TEST-2601 --session routes " + location + " without allowing stored preference to override tmux", async () => {
  const c = await space(); stored(c);
  const env: Record<string, string> = location === "outside" ? { HERDR_ENV: "", HERDR_PANE_ID: "", TMUX: "" } :
    location === "tmux" ? { HERDR_ENV: "", HERDR_PANE_ID: "", TMUX: "host" } :
    location === "forced-herdr" ? { ORCHESTRATOR_MULTIPLEXER: "herdr" } : {};
  const r = await start(c, ["--session", "work", "--dry-run"], env);
  if (location === "outside" || location === "tmux") {
    expect(r.code).toBe(0); expect(json(r).multiplexer).toBe("tmux");
  } else {
    expect(r.code).toBe(1); expect(r.stdout + r.stderr).toContain("--session is tmux only");
  }
}, 15_000);
test("[REQ-425] TEST-2602 direct deliver with a wrong terminal exits 5 without text or keys", async () => {
  const c = await space(), e = c.seed();
  const r = await runBun(c.s, "scripts/ticket-window.ts", ["--deliver-to", e.pane, "--mux", "herdr", "--expect-terminal", "wrong-terminal", "--prompt", "report"], "", c.s.env);
  expect(r.code).toBe(5);
  expect(c.s.calls().filter(a => ["send-text", "send-keys"].includes(a[1]!))).toEqual([]);
  expect(readFileSync(join(c.s.ctx.stateDir, "ticket-window.log"), "utf8")).toContain("GONE");
}, 15_000);
test("[REQ-425] TEST-2602 a start prompt whose witness changes after readiness logs GONE and frees its lock without text", async () => {
  const c = await space(); mutateSim(c, s => { s.restartWhen = { argv: ["agent", "wait"], nth: 1 }; });
  const r = await start(c, ["--prompt", "report"]);
  expect(r.code).toBe(0);
  const log = join(c.s.ctx.stateDir, "ticket-window.log");
  await until(() => existsSync(log) && readFileSync(log, "utf8").includes("GONE"));
  expect(c.s.calls().filter(a => a[1] === "send-text")).toEqual([]);
  await until(() => !existsSync(lockPathFor(c.s.ctx.stateDir, c.dir)));
}, 30_000);
test("[REQ-425] TEST-2602 a failed pane witness prevents even the launch line and releases the lock", async () => {
  const c = await space(); mutateSim(c, s => { s.failArgv = ["pane", "get"]; });
  const r = await start(c);
  expect(r.code).toBe(1);
  expect(c.s.calls().filter(a => a[1] === "run")).toEqual([]);
  expect(existsSync(lockPathFor(c.s.ctx.stateDir, c.dir))).toBe(false);
}, 15_000);
