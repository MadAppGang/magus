import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sandbox, runBun, ancestor, type Sandbox } from "./lib/process-testdata";
import { simTab, panesOf } from "./lib/testdata/herdr-sim";
import { identity, SELF, MANAGER } from "../tests/testdata";

const spaces: Sandbox[] = [];
const actors: Awaited<ReturnType<typeof ancestor>>[] = [];
afterEach(async () => { for (const a of actors.splice(0)) await a.stop(); for (const s of spaces.splice(0)) s.cleanup(); });
const space = () => {
  const s = sandbox(), state = simTab(["w1:p1"]);
  spaces.push(s); panesOf(state.tabs[0]!.tree)[0]!.shellPid = process.pid;
  s.installHerdr({ sim: state }); return s;
};
const file = (s: Sandbox) => join(s.ctx.stateDir, "config.json");
const nested = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", TMUX: "host" };
const read = (s: Sandbox, args: string[] = [], env: Record<string, string> = {}) => runBun(s, "scripts/orch-config.ts", ["multiplexer", ...args], "", env);
const body = (r: { stdout: string }): any => JSON.parse(r.stdout);
const cases = [
  [{ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" }, "herdr", "detected", null, null],
  [nested, "herdr", "provisional", "herdr-in-tmux", "herdr-in-tmux"],
  [{ TMUX: "host" }, "tmux", "provisional", "herdr-installed", null],
  [{ ...nested, ORCHESTRATOR_MULTIPLEXER: "tmux" }, "tmux", "forced", null, null],
  [{ ORCHESTRATOR_MULTIPLEXER: "herdr", HERDR_PANE_ID: "w1:p1" }, "herdr", "forced", null, null],
] as const;
for (const [env, mux, source, ask, nesting] of cases) test("[REQ-401, REQ-402] TEST-2401 reads session and window facts as one exact JSON document " + JSON.stringify(env), async () => {
  const s = space(), r = await read(s, [], env);
  expect(r.code).toBe(0);
  expect(body(r)).toEqual({ session: { mux, source: source === "forced" ? "forced" : "detected", nesting },
    windows: { mux, source, ask, note: null }, stored: null, storedError: null, herdrInstalled: true, config: file(s) });
  expect(existsSync(file(s))).toBe(false);
}, 15_000);
test("[REQ-401, REQ-402] TEST-2401 no executable in tmux asks nothing; invalid/outside sessions return JSON errors", async () => {
  const s = space(); rmSync(join(s.bin, "herdr"));
  expect(body(await read(s, [], { TMUX: "host" }))).toEqual({
    session: { mux: "tmux", source: "detected", nesting: null },
    windows: { mux: "tmux", source: "detected", ask: null, note: null },
    stored: null, storedError: null, herdrInstalled: false, config: file(s),
  });
  const invalidEnvs: Record<string, string>[] = [{}, { ORCHESTRATOR_MULTIPLEXER: "bad" }, { ORCHESTRATOR_MULTIPLEXER: "tmux" }, { ORCHESTRATOR_MULTIPLEXER: "herdr" }];
  for (const env of invalidEnvs) {
    const r = await read(s, [], env);
    expect(r.code).toBe(1); expect(body(r).session.error).toEqual(expect.any(String));
    expect(body(r).windows.error).toBe(body(r).session.error);
  }
}, 15_000);
test("[REQ-402, REQ-405] TEST-2402 --set keeps unknown keys and recomputes nested window choice without re-addressing the session", async () => {
  const s = space(); writeFileSync(file(s), '{"schema":1,"future":{"keep":[1,true]}}');
  const r = await read(s, ["--set", "tmux"], nested);
  expect(r.code).toBe(0);
  expect(body(r)).toEqual({ ok: true, stored: "tmux", config: file(s), session: { mux: "herdr", source: "detected", nesting: "herdr-in-tmux" }, windows: { mux: "tmux", source: "stored", ask: null, note: null } });
  expect(JSON.parse(readFileSync(file(s), "utf8"))).toEqual({ schema: 1, multiplexer: "tmux", multiplexerAnsweredAt: expect.any(Number), future: { keep: [1, true] } });
  const again = body(await read(s, [], nested));
  expect(again.windows.ask).toBeNull(); expect(again.stored).toBe("tmux");
}, 15_000);
test("[REQ-402, REQ-405] TEST-2403 plain tmux stored herdr opens windows there but its children remain tmux", async () => {
  const s = space(), r = await read(s, ["--set", "herdr"], { TMUX: "host" });
  expect(r.code).toBe(0);
  expect(body(r)).toMatchObject({ session: { mux: "tmux" }, windows: { mux: "herdr", source: "stored", ask: null, note: "New ticket windows open as herdr tabs (your stored choice). This session's own children stay in tmux slots." } });
  const forced = await read(s, ["--set", "herdr"], { TMUX: "host", ORCHESTRATOR_MULTIPLEXER: "tmux" });
  expect(forced.code).toBe(0);
  expect(forced.stdout + forced.stderr).toContain("ORCHESTRATOR_MULTIPLEXER=tmux still overrides this");
}, 15_000);
test("[REQ-405] TEST-2404 malformed/unwritable config and bad CLI arguments fail without corrupting the file", async () => {
  const s = space(), bad = '{"schema":2,"keep":true}\n'; writeFileSync(file(s), bad);
  const r = await read(s, ["--set", "tmux"], nested);
  expect(r.code).toBe(1);
  expect(r.stdout + r.stderr).toContain("fix it by hand or delete it");
  expect(readFileSync(file(s), "utf8")).toBe(bad);
  const reading = await read(s, [], nested);
  expect(body(reading).stored).toBeNull();
  expect(body(reading).storedError).toEqual(expect.any(String));
  for (const args of [["--set", "screen"], ["--set"], ["--unknown"], ["--set", "tmux", "--claim-question"]]) {
    const r = await read(s, args, nested); expect(r.code).toBe(1); expect(body(r).error).toEqual(expect.any(String));
    expect(readFileSync(file(s), "utf8")).toBe(bad);
  }
  rmSync(file(s)); mkdirSync(file(s));
  expect((await read(s, ["--set", "tmux"], nested)).code).toBe(1);
}, 15_000);
for (const role of ["manager", "child"] as const) test("[REQ-406] TEST-2405 " + role + " may read but cannot set or claim the user question", async () => {
  const s = space(); Object.assign(s.env, nested);
  const a = await ancestor(s, SELF); actors.push(a);
  s.identity(identity({ role, pid: a.pid, procStart: a.procStart, product: s.root })); s.alias(SELF, MANAGER);
  const bytes = '{"schema":1,"keep":true}\n'; writeFileSync(file(s), bytes);
  for (const args of [["--set", "herdr"], ["--claim-question"]]) {
    const r = await a.run("scripts/orch-config.ts", ["multiplexer", ...args]);
    expect(r.code).toBe(1); expect(r.stdout + r.stderr).toContain("only the triage session stores this choice");
    expect(readFileSync(file(s), "utf8")).toBe(bytes);
    expect(existsSync(join(s.ctx.stateDir, "locks", "multiplexer-question"))).toBe(false);
  }
  expect((await a.run("scripts/orch-config.ts", ["multiplexer"])).code).toBe(0);
}, 15_000);
test("[REQ-406] TEST-2406 simultaneous unregistered sessions yield one owned question and one pending, then set releases it", async () => {
  const s = space(); Object.assign(s.env, nested);
  const a = await ancestor(s, "triage001"), b = await ancestor(s, "triage002"); actors.push(a, b);
  const args = ["multiplexer", "--claim-question"];
  const replies = await Promise.all([a.run("scripts/orch-config.ts", args), b.run("scripts/orch-config.ts", args)]);
  expect(replies.map(r => r.code)).toEqual([0, 0]);
  expect(replies.map(r => body(r).question).sort()).toEqual(["owned", "pending"]);
  const owner = body(replies[0]!).question === "owned" ? a : b;
  expect(body(await owner.run("scripts/orch-config.ts", args)).question).toBe("owned");
  const lock = join(s.ctx.stateDir, "locks", "multiplexer-question");
  expect(JSON.parse(readFileSync(join(lock, "info.json"), "utf8"))).toMatchObject({ pid: owner.pid, name: "multiplexer-question", since: expect.any(Number) });
  expect((await owner.run("scripts/orch-config.ts", ["multiplexer", "--set", "tmux"])).code).toBe(0);
  expect(existsSync(lock)).toBe(false);
  expect(body(await b.run("scripts/orch-config.ts", args)).question).toBeNull();
}, 15_000);
test("[REQ-406] TEST-2407 a dead holder is replaced and an already answered/no-question session claims nothing", async () => {
  const s = space(); Object.assign(s.env, nested);
  const a = await ancestor(s, "triage001"), b = await ancestor(s, "triage002"); actors.push(a, b);
  const args = ["multiplexer", "--claim-question"];
  expect(body(await a.run("scripts/orch-config.ts", args)).question).toBe("owned");
  await a.stop();
  expect(body(await b.run("scripts/orch-config.ts", args)).question).toBe("owned");
  await b.run("scripts/orch-config.ts", ["multiplexer", "--set", "herdr"]);
  expect(body(await b.run("scripts/orch-config.ts", args)).question).toBeNull();
  const noOwner = space();
  const r = await read(noOwner, ["--claim-question"], nested);
  expect(r.code).toBe(1);
  expect(existsSync(join(noOwner.ctx.stateDir, "locks", "multiplexer-question"))).toBe(false);
}, 15_000);
