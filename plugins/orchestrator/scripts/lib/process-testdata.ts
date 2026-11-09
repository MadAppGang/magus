import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StoreContext } from "./record-store";
import type { OrchestratorIdentity, OrchestratorProgress, OrchestratorClaim } from "./state-core";

export const pluginRoot = resolve(import.meta.dir, "../..");
export const script = (relative: string) => join(pluginRoot, relative);
export type ProcessResult = { code: number; stdout: string; stderr: string };
export type Sandbox = ReturnType<typeof sandbox>;

export function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orchestrator-test-")));
  const ctx: StoreContext = { stateDir: join(root, "state"), claudeConfigDir: join(root, "config") };
  const home = join(root, "home");
  const bin = join(root, "bin");
  for (const dir of [home, bin, join(ctx.claudeConfigDir, "sessions"), ...["sessions", "progress", "claims", "by-session"].map(d => join(ctx.stateDir, d))]) mkdirSync(dir, { recursive: true });
  const env: Record<string, string> = {
    PATH: bin + ":" + (process.env.PATH ?? ""), HOME: home, PWD: root,
    TMPDIR: tmpdir(), LANG: "C", LC_ALL: "C",
    CLAUDE_CONFIG_DIR: ctx.claudeConfigDir, ORCHESTRATOR_STATE_DIR: ctx.stateDir,
  };
  const log = join(root, "herdr-calls.jsonl");
  return {
    root, ctx, env, bin, log,
    identity(i: OrchestratorIdentity) {
      writeFileSync(join(ctx.stateDir, "sessions", i.key + ".json"), JSON.stringify(i));
    },
    progress(p: OrchestratorProgress) {
      writeFileSync(join(ctx.stateDir, "progress", p.key + ".json"), JSON.stringify(p));
    },
    claim(c: OrchestratorClaim) {
      writeFileSync(join(ctx.stateDir, "claims", c.key + ".json"), JSON.stringify(c));
    },
    alias(sessionId: string, key: string) {
      writeFileSync(join(ctx.stateDir, "by-session", sessionId), key + "\n");
    },
    installHerdr() {
      const path = join(bin, "herdr");
      writeFileSync(path, "#!" + process.execPath + " --no-env-file\n" +
        'import { appendFileSync } from "node:fs";\n' +
        'appendFileSync(process.env.QA_HERDR_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n' +
        'process.exit(Number(process.env.QA_HERDR_EXIT ?? 0));\n');
      chmodSync(path, 0o755);
      env.QA_HERDR_LOG = log;
    },
    reports(): string[][] {
      return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

export function actualStart(pid: number): string {
  const r = Bun.spawnSync(["env", "TZ=UTC", "LC_ALL=C", "ps", "-o", "lstart=", "-p", String(pid)], { env: { PATH: process.env.PATH ?? "" } });
  if (r.exitCode !== 0) throw new Error("Could not observe test process incarnation");
  const value = r.stdout.toString().trim();
  if (!value) throw new Error("Test process has no lstart");
  return value;
}

export async function collect(p: Bun.Subprocess<"pipe", "pipe", "pipe">, input: string | null, timeoutMs = 12_000): Promise<ProcessResult> {
  if (input !== null) { p.stdin.write(input); p.stdin.end(); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; p.kill(); }, timeoutMs);
  try {
    const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    if (timedOut) throw new Error("Test child exceeded " + timeoutMs + " ms");
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    if (input === null) { try { p.stdin.end(); } catch { /* the child may have closed stdin */ } }
    if (p.exitCode === null) { p.kill(); await p.exited; }
  }
}

export function spawnBun(s: Sandbox, relative: string, args: string[] = [], env: Record<string, string> = {}) {
  return Bun.spawn([process.execPath, "--no-env-file", "--config=/dev/null", script(relative), ...args], {
    cwd: s.root, env: { ...s.env, ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
}

export function runBun(s: Sandbox, relative: string, args: string[] = [], input = "", env: Record<string, string> = {}) {
  return collect(spawnBun(s, relative, args, env), input);
}
export function spawnEval(s: Sandbox, code: string, env: Record<string, string> = {}) {
  return Bun.spawn([process.execPath, "--no-env-file", "--config=/dev/null", "--eval", code], {
    cwd: s.root, env: { ...s.env, ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
}

// A test-owned ancestor stands in for Claude Code. Its session file and OS start
// time are real; only the hook/CLI child and the filesystem protocol are exercised.
export async function ancestor(s: Sandbox, sessionId: string) {
  const source = [
    'import { writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { createInterface } from "node:readline";',
    'const r = Bun.spawnSync(["env","TZ=UTC","LC_ALL=C","ps","-o","lstart=","-p",String(process.pid)]);',
    'const procStart = r.stdout.toString().trim();',
    'function save(id) { writeFileSync(join(process.env.CLAUDE_CONFIG_DIR,"sessions",process.pid+".json"),JSON.stringify({pid:process.pid,procStart,sessionId:id,status:"idle",cwd:process.cwd()})); }',
    'save(process.env.CLAUDE_CODE_SESSION_ID);',
    'console.log(JSON.stringify({pid:process.pid,procStart}));',
    'for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {',
    ' const q=JSON.parse(line);',
    ' if(q.stop) break;',
    ' const env={...process.env,...q.env};',
    ' if(q.sessionId) { env.CLAUDE_CODE_SESSION_ID=q.sessionId; save(q.sessionId); }',
    ' const p=Bun.spawn([process.execPath,"--no-env-file","--config=/dev/null",q.script,...(q.args??[])],{env,stdin:"pipe",stdout:"pipe",stderr:"pipe"});',
    ' p.stdin.write(q.input??""); p.stdin.end();',
    ' const [code,stdout,stderr]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);',
    ' console.log(JSON.stringify({code,stdout,stderr}));',
    '}',
  ].join("\n");
  const p = spawnEval(s, source, { CLAUDE_CODE_SESSION_ID: sessionId });
  const reader = p.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  async function line(): Promise<string> {
    while (!buffer.includes("\n")) {
      const result = await reader.read();
      if (result.done) throw new Error("Ancestor ended before replying");
      buffer += decoder.decode(result.value, { stream: true });
    }
    const cut = buffer.indexOf("\n");
    const result = buffer.slice(0, cut);
    buffer = buffer.slice(cut + 1);
    return result;
  }
  let expired = false;
  const watchdog = setTimeout(() => { expired = true; p.kill(); }, 60_000);
  let first: { pid: number; procStart: string };
  try { first = JSON.parse(await line()); }
  catch (error) { clearTimeout(watchdog); p.kill(); await p.exited; throw error; }
  let stopped = false;
  return {
    ...first,
    async run(relative: string, args: string[] = [], input = "", env: Record<string, string> = {}, nextId = sessionId): Promise<ProcessResult> {
      if (expired || stopped) throw new Error("Ancestor is no longer available");
      p.stdin.write(JSON.stringify({ script: script(relative), args, input, env, sessionId: nextId }) + "\n");
      return JSON.parse(await line());
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(watchdog);
      if (p.exitCode === null) { try { p.stdin.end(); } catch { /* already closed */ } p.kill(); }
      await p.exited;
      await reader.cancel();
    },
  };
}
