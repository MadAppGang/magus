/**
 * Process tests for the claudish session monitor (design §8.4): the real script, spawned as
 * `bun --no-env-file <module>` (placement file), with HOME and CLAUDISH_SESSIONS_DIR in temp
 * dirs, CLAUDE_PID naming a helper process the test owns, and a cwd holding a symlinked FIFO
 * `.env` (a process that opens it blocks forever). One test spawns the command exactly as
 * `monitors/monitors.json` declares it.
 *
 * These run at the real POLL_INTERVAL_MS (2,500 ms), so each test takes seconds.
 * Written blind, from the specification and contracts only. REQ ids are in TEST-PLAN.md.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { POLL_INTERVAL_MS } from "./session-monitor.ts";

const MODULE = join(import.meta.dir, "session-monitor.ts");
const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const MONITORS_JSON = join(resolve(import.meta.dir, "..", "..", ".."), "plugins", "claudish", "monitors", "monitors.json");
const BUN = process.execPath;
const SCHEDULING_SLACK_MS = 1000;

// §4.3 grammar.
const SAFE = "[\\x21\\x23-\\x25\\x27-\\x3B\\x3F-\\x7E]";
const KEY = "(?:model|elapsed|turns|replies|tools|cost|reason|exit|waited|slots|ok|failed|cancelled|running|path)";
const FIELD = `${KEY}=${SAFE}{1,200}`;
const ID = "[A-Za-z0-9._-]{1,64}";
const SESSION_RE = new RegExp(
  `^claudish-monitor: session (${ID}) (?:started|running|needs-input|completed|failed|timeout|cancelled)(?: ${FIELD})*(?: next: (?:get_output|get_diagnostics|send_input) \\1)?$`,
);
const TEAM_RE = new RegExp(`^claudish-monitor: team ${ID} (?:started|running|completed|failed|cancelled)(?: ${FIELD})*(?: next: team-status)?$`);
const NOTICE_RE = new RegExp(`^claudish-monitor: notice (?:claudish-too-old|no-session-identity): (?: |${SAFE}){1,400}$`);
const matchesGrammar = (l: string): boolean => SESSION_RE.test(l) || TEAM_RE.test(l) || NOTICE_RE.test(l);
const BASELINE_RE = /\[claudish session-monitor\] baseline: (\d+) entries classified in (\d+(?:\.\d+)?) ms, (\d+) to decide/;

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

interface Proc {
  child: ChildProcess;
  stdout: string[];
  stdoutAt: number[];
  stderr: () => string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>;
  exited: () => boolean;
}

const children: ChildProcess[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const c of children.splice(0)) {
    if (c.exitCode === null && c.signalCode === null && c.pid !== undefined) {
      try {
        process.kill(-c.pid, "SIGKILL");
      } catch {
        try {
          c.kill("SIGKILL");
        } catch {}
      }
    }
  }
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

/** A stand-in for the Claude Code process: alive until the test kills it. */
function helper(): ChildProcess {
  const h = spawn("sleep", ["600"], { stdio: "ignore", detached: true });
  children.push(h);
  return h;
}

/** cwd holding `.env` as a symlink to a FIFO: opening it blocks until a writer appears. */
function hostileCwd(root: string): string {
  const cwd = join(root, "project");
  mkdirSync(cwd);
  const fifo = join(root, "env.fifo");
  const r = spawnSync("mkfifo", [fifo]);
  if (r.status !== 0) throw new Error(`mkfifo failed: ${r.stderr}`);
  symlinkSync(fifo, join(cwd, ".env"));
  return cwd;
}

function launch(command: string, args: string[], env: Record<string, string>, cwd: string): Proc {
  const child = spawn(command, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(child);
  const stdout: string[] = [];
  const stdoutAt: number[] = [];
  let partial = "";
  let err = "";
  let done = false;
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    partial += chunk;
    const parts = partial.split("\n");
    partial = parts.pop() ?? "";
    for (const p of parts) {
      stdout.push(p);
      stdoutAt.push(Date.now());
    }
  });
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    err += chunk;
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>((res) => {
    child.on("exit", (code, signal) => {
      done = true;
      res({ code, signal, at: Date.now() });
    });
  });
  return { child, stdout, stdoutAt, stderr: () => err, exit, exited: () => done };
}

function monitor(env: Record<string, string>, cwd: string): Proc {
  return launch(BUN, ["--no-env-file", MODULE], env, cwd);
}

function baseEnv(home: string, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  return env;
}

async function waitFor(cond: () => boolean, timeoutMs: number, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await Bun.sleep(stepMs);
  }
  return cond();
}

async function exitWithin(p: Proc, ms: number): Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number } | null> {
  return Promise.race([p.exit, Bun.sleep(ms).then(() => null)]);
}

function writeSpawn(sessionsDir: string, id: string, hostPid: number, mcpPid: number): string {
  const dir = join(sessionsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "prompt.md"), "do the thing\n");
  const rec = {
    schema: 1,
    kind: "session",
    sessionId: id,
    hostPid,
    mcpPid,
    startedAt: new Date().toISOString(),
    model: "test-model",
    timeoutSeconds: 600,
    claudeSessionId: "child-uuid-0001",
  };
  writeFileSync(join(dir, "spawn.json.tmp"), JSON.stringify(rec, null, 2));
  renameSync(join(dir, "spawn.json.tmp"), join(dir, "spawn.json"));
  return dir;
}

function writeMeta(dir: string, status: string): void {
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify(
      {
        sessionId: dir.split("/").pop(),
        model: "test-model",
        status,
        pid: 99999,
        startedAt: new Date(Date.now() - 5000).toISOString(),
        completedAt: new Date().toISOString(),
        exitCode: status === "completed" ? 0 : 1,
        turnsCompleted: 1,
        tokensUsed: 10,
        toolCallCount: 0,
        idleSeconds: 0,
        costUsd: 0,
        terminalReason: status === "completed" ? "end_turn" : "child-crashed",
        claudeSessionId: "child-uuid-0001",
        transcriptPath: "/tmp/transcript.jsonl",
      },
      null,
      2,
    ),
  );
}

const hasLine = (p: Proc, prefix: string) => () => p.stdout.some((l) => l.startsWith(prefix));

// ---------------------------------------------------------------------------------------------
// Reporting through the real process (REQ-PR1..PR3)
// ---------------------------------------------------------------------------------------------

describe("the real process reports own sessions (REQ-PR1..PR3)", () => {
  test(
    "REQ-PR1: started within 8 s of spawn.json, the terminal line within 8 s of meta.json, every line in the grammar",
    async () => {
      const root = tempRoot("csm-proc-");
      const sessionsDir = join(root, "sessions");
      mkdirSync(sessionsDir);
      const claude = helper();
      const p = monitor(
        baseEnv(join(root, "home"), {
          CLAUDISH_SESSIONS_DIR: sessionsDir,
          CLAUDE_PID: String(claude.pid),
          CLAUDE_CODE_SESSION_ID: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
        }),
        hostileCwd(root),
      );
      expect(await waitFor(() => BASELINE_RE.test(p.stderr()), 8000)).toBe(true);

      const dir = writeSpawn(sessionsDir, "proc000001", claude.pid!, claude.pid!);
      const started = await waitFor(hasLine(p, "claudish-monitor: session proc000001 started"), 8000);
      writeMeta(dir, "completed");
      const completed = await waitFor(hasLine(p, "claudish-monitor: session proc000001 completed"), 8000);

      expect(started).toBe(true);
      expect(completed).toBe(true);
      expect(p.stdout.filter((l) => !matchesGrammar(l))).toEqual([]);
      expect(p.exited()).toBe(false);
    },
    30_000,
  );

  test(
    "REQ-PR2: malformed files do not kill the process; 5 s later it is alive and still reporting",
    async () => {
      const root = tempRoot("csm-proc-");
      const sessionsDir = join(root, "sessions");
      mkdirSync(sessionsDir);
      const claude = helper();
      const p = monitor(baseEnv(join(root, "home"), { CLAUDISH_SESSIONS_DIR: sessionsDir, CLAUDE_PID: String(claude.pid) }), hostileCwd(root));
      expect(await waitFor(() => BASELINE_RE.test(p.stderr()), 8000)).toBe(true);

      mkdirSync(join(sessionsDir, "broken0001"));
      writeFileSync(join(sessionsDir, "broken0001", "spawn.json"), '{"schema":1,"kind":"sess');
      mkdirSync(join(sessionsDir, "broken0002"));
      writeFileSync(join(sessionsDir, "broken0002", "spawn.json"), "[]");
      mkdirSync(join(sessionsDir, "broken0003", "spawn.json"), { recursive: true });
      const tracked = writeSpawn(sessionsDir, "broken0004", claude.pid!, claude.pid!);
      writeFileSync(join(tracked, "waits.jsonl"), "\u0000\u0001garbage\n{not json}\n");
      writeFileSync(join(tracked, "events.jsonl"), "{{{{\nÿþ\n");
      writeFileSync(join(tracked, "tokens.json"), "nope");
      await waitFor(hasLine(p, "claudish-monitor: session broken0004 started"), 8000);
      writeFileSync(join(tracked, "meta.json"), '{"status":"comp');
      await Bun.sleep(5000);
      const aliveAfterGarbage = !p.exited();

      writeSpawn(sessionsDir, "healthy0001", claude.pid!, claude.pid!);
      const stillReporting = await waitFor(hasLine(p, "claudish-monitor: session healthy0001 started"), 8000);

      expect(aliveAfterGarbage).toBe(true);
      expect(stillReporting).toBe(true);
      expect(p.stdout.filter((l) => !matchesGrammar(l))).toEqual([]);
      expect(p.stdout.join("\n")).not.toMatch(/broken000[123]/);
    },
    40_000,
  );

  test(
    "REQ-PR3: with CLAUDISH_SESSIONS_DIR unset, records under $HOME/.claudish/sessions are reported",
    async () => {
      const root = tempRoot("csm-proc-");
      const home = join(root, "home");
      const sessionsDir = join(home, ".claudish", "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const claude = helper();
      const p = monitor(baseEnv(home, { CLAUDE_PID: String(claude.pid) }), hostileCwd(root));
      expect(await waitFor(() => BASELINE_RE.test(p.stderr()), 8000)).toBe(true);

      writeSpawn(sessionsDir, "homedir001", claude.pid!, claude.pid!);

      expect(await waitFor(hasLine(p, "claudish-monitor: session homedir001 started"), 8000)).toBe(true);
    },
    30_000,
  );

  test(
    "REQ-PR4: the command exactly as monitors.json declares it starts, ignores the FIFO .env, and reports",
    async () => {
      const entries = JSON.parse(readFileSync(MONITORS_JSON, "utf8")) as { command: string }[];
      const command = entries[0]!.command.replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT);
      const root = tempRoot("csm-proc-");
      const sessionsDir = join(root, "sessions");
      mkdirSync(sessionsDir);
      const claude = helper();
      const env = baseEnv(join(root, "home"), { CLAUDISH_SESSIONS_DIR: sessionsDir, CLAUDE_PID: String(claude.pid) });
      env.PATH = `${dirname(BUN)}:${env.PATH}`;
      const p = launch("/bin/sh", ["-c", command], env, hostileCwd(root));
      expect(await waitFor(() => BASELINE_RE.test(p.stderr()), 8000)).toBe(true);

      writeSpawn(sessionsDir, "declared01", claude.pid!, claude.pid!);

      expect(await waitFor(hasLine(p, "claudish-monitor: session declared01 started"), 8000)).toBe(true);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------------------------
// Exits (REQ-PX1..PX3)
// ---------------------------------------------------------------------------------------------

describe("the real process exits only when it should (REQ-PX1..PX3)", () => {
  const noIdentityEnvs: [string, Record<string, string | undefined>][] = [
    ["no CLAUDE_PID and no CLAUDE_CODE_SESSION_ID", {}],
    ["no CLAUDE_PID but CLAUDE_CODE_SESSION_ID set", { CLAUDE_CODE_SESSION_ID: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" }],
    ["CLAUDE_PID that is not a positive integer", { CLAUDE_PID: "not-a-pid" }],
  ];

  test.each(noIdentityEnvs)(
    "REQ-PX1: %s → exactly one no-session-identity line, then exit 0 within one poll interval",
    async (_name, extra) => {
      const root = tempRoot("csm-proc-");
      const sessionsDir = join(root, "sessions");
      mkdirSync(sessionsDir);
      const p = monitor(baseEnv(join(root, "home"), { CLAUDISH_SESSIONS_DIR: sessionsDir, ...extra }), hostileCwd(root));

      const result = await exitWithin(p, 15_000);

      expect(result).not.toBeNull();
      expect(result!.code).toBe(0);
      expect(p.stdout).toHaveLength(1);
      expect(p.stdout[0]).toMatch(/^claudish-monitor: notice no-session-identity: /);
      expect(p.stdout[0]).toMatch(NOTICE_RE);
      expect(result!.at - p.stdoutAt[0]!).toBeLessThanOrEqual(POLL_INTERVAL_MS + SCHEDULING_SLACK_MS);
    },
    20_000,
  );

  test(
    "REQ-PX2: with its stdout closed, writing a spawn.json makes it exit 0",
    async () => {
      const root = tempRoot("csm-proc-");
      const sessionsDir = join(root, "sessions");
      mkdirSync(sessionsDir);
      const claude = helper();
      const env = baseEnv(join(root, "home"), {
        CLAUDISH_SESSIONS_DIR: sessionsDir,
        CLAUDE_PID: String(claude.pid),
        MON_BUN: BUN,
        MON_MODULE: MODULE,
      });
      // `| true` closes the read end of the monitor's stdout at once; bash then reports the
      // monitor's own exit status (PIPESTATUS[0]).
      const p = launch("/bin/bash", ["-c", '"$MON_BUN" --no-env-file "$MON_MODULE" | true; exit "${PIPESTATUS[0]}"'], env, hostileCwd(root));
      expect(await waitFor(() => BASELINE_RE.test(p.stderr()), 8000)).toBe(true);

      writeSpawn(sessionsDir, "epipe00001", claude.pid!, claude.pid!);
      const result = await exitWithin(p, 12_000);

      expect(result).not.toBeNull();
      expect(result!.code).toBe(0);
    },
    30_000,
  );

  test(
    "REQ-PX3: idle with no session files at all, it stays up while CLAUDE_PID lives and exits 0 within two polls of its death; no baseline line on ENOENT",
    async () => {
      const root = tempRoot("csm-proc-");
      const claude = helper();
      const p = monitor(
        baseEnv(join(root, "home"), { CLAUDISH_SESSIONS_DIR: join(root, "does-not-exist"), CLAUDE_PID: String(claude.pid) }),
        hostileCwd(root),
      );
      await Bun.sleep(POLL_INTERVAL_MS + 1500);
      const aliveWhileHostLives = !p.exited();

      const killedAt = Date.now();
      claude.kill("SIGKILL");
      const result = await exitWithin(p, 2 * POLL_INTERVAL_MS + 5000);

      expect(aliveWhileHostLives).toBe(true);
      expect(result).not.toBeNull();
      expect(result!.code).toBe(0);
      expect(result!.at - killedAt).toBeLessThanOrEqual(2 * POLL_INTERVAL_MS + SCHEDULING_SLACK_MS);
      expect(p.stdout).toEqual([]);
      expect(p.stderr()).not.toMatch(BASELINE_RE);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------------------------
// Startup cost on 10,000 directories (REQ-PC1)
// ---------------------------------------------------------------------------------------------

describe("startup on a 10,000-entry testdata tree (REQ-PC1, R3.8)", () => {
  let tree = "";

  beforeAll(() => {
    tree = realpathSync(mkdtempSync(join(tmpdir(), "csm-10k-")));
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) mkdirSync(join(tree, `d${String(i).padStart(5, "0")}`));
    const ms = performance.now() - t0;
    console.log(`[session-monitor.process.test] testdata tree: 10000 directories built in ${ms.toFixed(0)} ms (budget 5000 ms)`);
  }, 30_000);

  afterAll(() => {
    if (tree) rmSync(tree, { recursive: true, force: true });
  });

  test(
    "the first stat + readdir + baseline classification of 10,000 entries finishes in under 1 s",
    async () => {
      const root = tempRoot("csm-proc-");
      const claude = helper();
      const p = monitor(baseEnv(join(root, "home"), { CLAUDISH_SESSIONS_DIR: tree, CLAUDE_PID: String(claude.pid) }), hostileCwd(root));

      const seen = await waitFor(() => BASELINE_RE.test(p.stderr()), 12_000);

      expect(seen).toBe(true);
      const m = BASELINE_RE.exec(p.stderr())!;
      console.log(`[session-monitor.process.test] ${m[0]}`);
      expect(Number(m[1])).toBe(10_000);
      expect(Number(m[2])).toBeLessThan(1000);
      expect(p.stdout).toEqual([]);
    },
    15_000,
  );
});
