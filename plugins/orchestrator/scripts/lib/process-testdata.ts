import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StoreContext } from "./record-store";
import type { OrchestratorIdentity, OrchestratorProgress, OrchestratorClaim } from "./state-core";
import type { SimState } from "./testdata/herdr-sim";

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
  // Only test-owned shims and explicitly admitted system utilities are reachable.
  for (const name of ["git", "ps", "env", "sh", "bash", "sleep", "touch", "mkdir", "rm", "date"]) {
    const real = Bun.which(name);
    if (real) symlinkSync(real, join(bin, name));
  }
  symlinkSync(process.execPath, join(bin, "bun"));
  mkdirSync(join(home, ".bun", "bin"), { recursive: true });
  symlinkSync(process.execPath, join(home, ".bun", "bin", "bun"));
  for (const name of ["claude", "herdr", "tmux", "magus"]) {
    const path = join(bin, name);
    writeFileSync(path, "#!/bin/sh\nprintf 'unexpected real-service request\\n' >&2\nexit 127\n");
    chmodSync(path, 0o755);
  }
  const env: Record<string, string> = {
    PATH: bin, HOME: home, PWD: root,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", XDG_STATE_HOME: join(root, "xdg-state"),
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
    installHerdr(options: { sim?: SimState } = {}) {
      const path = join(bin, "herdr");
      if (options.sim) {
        env.QA_HERDR_STATE = join(root, "herdr-state.json");
        env.QA_HERDR_LOG = log;
        writeFileSync(env.QA_HERDR_STATE, JSON.stringify(options.sim));
        writeFileSync(path, "#!/bin/sh\nexec " + quote(process.execPath) + " --no-env-file --config=/dev/null " + quote(join(import.meta.dir, "testdata", "herdr-sim.ts")) + ' "$@"\n');
        chmodSync(path, 0o755);
        return;
      }
      writeFileSync(path, "#!" + process.execPath + " --no-env-file\n" +
        'import { appendFileSync } from "node:fs";\n' +
        'appendFileSync(process.env.QA_HERDR_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n' +
        'process.exit(Number(process.env.QA_HERDR_EXIT ?? 0));\n');
      chmodSync(path, 0o755);
      env.QA_HERDR_LOG = log;
    },
    calls(): string[][] { return callLog(log).map(row => row.argv); },
    events(): { argv: string[]; at: number }[] { return callLog(log); },
    reports(): string[][] { return callLog(log).map(row => row.argv).filter(argv => argv[0] === "pane" && argv[1] === "report-metadata"); },
    sim(): SimState { return JSON.parse(readFileSync(env.QA_HERDR_STATE!, "utf8")); },
    saveSim(state: SimState) { writeFileSync(env.QA_HERDR_STATE!, JSON.stringify(state)); },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

function quote(s: string): string { return "'" + s.replaceAll("'", "'\\''") + "'"; }
function callLog(log: string): { argv: string[]; at: number }[] {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => {
    const row = JSON.parse(line);
    return Array.isArray(row) ? { argv: row, at: 0 } : row;
  }) : [];
}

/** A local checkout with a resolvable default branch; no remote is contacted. */
export function gitCheckout(s: Sandbox, name = "checkout"): string {
  const dir = join(s.root, name);
  mkdirSync(dir, { recursive: true });
  const git = (args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { cwd: dir, env: s.env });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    return r.stdout.toString().trim();
  };
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Test User"]); git(["config", "user.email", "test@example.invalid"]);
  git(["config", "core.hooksPath", join(s.root, "no-hooks")]);
  git(["commit", "--allow-empty", "-m", "Create testdata"]);
  git(["remote", "add", "origin", "https://github.com/example/product.git"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  return dir;
}

/** Override only the mux ancestry table; incarnation ps calls still reach the OS.
 * "$CALLER" in table names the CLI process that requested the table. null fails ps.
 */
export function psTable(s: Sandbox, table: string | null): void {
  const realPs = Bun.which("ps");
  if (!realPs) throw new Error("ps is required for process testdata");
  const path = join(s.bin, "ps"); rmSync(path, { force: true });
  writeFileSync(path, "#!" + process.execPath + " --no-env-file\n" + [
    "const args = process.argv.slice(2);",
    "if (args.includes('pid=,ppid=')) {",
    " const table = " + JSON.stringify(table) + ";",
    " if (table === null) process.exit(1);",
    " process.stdout.write(table.replaceAll('$CALLER', String(process.ppid)));",
    "} else {",
    " const r=Bun.spawnSync([" + JSON.stringify(realPs) + ",...args]); process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exitCode=r.exitCode;",
    "}",
  ].join("\n"));
  chmodSync(path, 0o755);
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
    'const children = new Set();',
    'process.on("SIGTERM", () => { for (const p of children) { try { p.kill(); } catch {} } process.exit(0); });',
    'for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {',
    ' const q=JSON.parse(line);',
    ' if(q.stop) break;',
    ' const env={...process.env,...q.env};',
    ' if(q.sessionId) { env.CLAUDE_CODE_SESSION_ID=q.sessionId; save(q.sessionId); }',
    ' void (async () => {',
    ' const p=Bun.spawn([process.execPath,"--no-env-file","--config=/dev/null",q.script,...(q.args??[])],{env,stdin:"pipe",stdout:"pipe",stderr:"pipe"});',
    ' children.add(p);',
    ' p.stdin.write(q.input??""); p.stdin.end();',
    ' const [code,stdout,stderr]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);',
    ' children.delete(p);',
    ' console.log(JSON.stringify({request:q.request,code,stdout,stderr}));',
    ' })().catch(error => console.log(JSON.stringify({request:q.request,code:1,stdout:"",stderr:String(error)})));',
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
  const watchdog = setTimeout(() => { expired = true; p.kill(); }, 180_000);
  let first: { pid: number; procStart: string };
  try { first = JSON.parse(await line()); }
  catch (error) { clearTimeout(watchdog); p.kill(); await p.exited; throw error; }
  let stopped = false, sequence = 0;
  const pending = new Map<number, { resolve: (r: ProcessResult) => void; reject: (e: unknown) => void }>();
  const pump = (async () => {
    try {
      while (!stopped) {
        const { request, ...reply } = JSON.parse(await line());
        const waiter = pending.get(request); pending.delete(request); waiter?.resolve(reply);
      }
    } catch (error) {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    }
  })();
  return {
    ...first,
    async run(relative: string, args: string[] = [], input = "", env: Record<string, string> = {}, nextId = sessionId): Promise<ProcessResult> {
      if (expired || stopped) throw new Error("Ancestor is no longer available");
      const request = ++sequence;
      const reply = new Promise<ProcessResult>((resolve, reject) => pending.set(request, { resolve, reject }));
      p.stdin.write(JSON.stringify({ request, script: script(relative), args, input, env, sessionId: nextId }) + "\n");
      return reply;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(watchdog);
      if (p.exitCode === null) { try { p.stdin.end(); } catch { /* already closed */ } p.kill(); }
      await p.exited;
      await reader.cancel();
      await pump;
    },
  };
}
