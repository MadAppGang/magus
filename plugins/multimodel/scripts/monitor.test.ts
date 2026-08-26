import { afterAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { MonitorFinal, MonitorStatus } from "./lib/types.ts";

// ---------------------------------------------------------------------------
// monitor.ts exports nothing — it is a `if (import.meta.main)` CLI. Its only
// testable surface is the one /team uses: argv in, session directory out.
// Every test below drives the real binary against a real temp session dir.
// ---------------------------------------------------------------------------

const MONITOR = join(import.meta.dir, "monitor.ts");
const ROOT = mkdtempSync(join(tmpdir(), "multimodel-monitor-test-"));

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

let seq = 0;
function session(): string {
  const dir = join(ROOT, `s${seq++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the monitor to completion. Fast polling keeps the suite honest on time. */
async function runMonitor(args: string[]): Promise<Run> {
  const proc = Bun.spawn(["bun", MONITOR, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

/** Watch `slugs` in `dir` until they all reach a terminal state (or 5s). */
function watch(dir: string, slugs: string[]): Promise<Run> {
  return runMonitor([
    "--session-dir", dir,
    "--models", slugs.join(","),
    "--timeout", "5",
    "--poll-interval", "20",
  ]);
}

function final(dir: string): MonitorFinal {
  return JSON.parse(readFileSync(join(dir, "monitor-final.json"), "utf-8"));
}

function modelIn(f: MonitorFinal, slug: string) {
  const m = f.models.find((x) => x.model_slug === slug);
  if (!m) throw new Error(`no status for ${slug} in ${f.models.map((x) => x.model_slug)}`);
  return m;
}

function writeDebugLog(dir: string, slug: string, content: string, name = "claudish_1.log"): string {
  const logsDir = join(dir, "work", slug, "logs");
  mkdirSync(logsDir, { recursive: true });
  const p = join(logsDir, name);
  writeFileSync(p, content);
  return p;
}

function statusOf(dir: string): MonitorStatus | null {
  const p = join(dir, "monitor-status.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as MonitorStatus;
  } catch {
    return null; // caught mid-rename; the next read gets it
  }
}

/** Block until the monitor finishes `n` more poll cycles than it has right now. */
async function advancePolls(dir: string, n: number, timeoutMs = 10_000): Promise<void> {
  const from = statusOf(dir)?.poll_count ?? 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((statusOf(dir)?.poll_count ?? 0) >= from + n) return;
    await Bun.sleep(5);
  }
  throw new Error(`monitor did not advance ${n} polls in ${timeoutMs}ms`);
}

/**
 * Drive the monitor against a log that grows one chunk at a time, waiting for
 * the monitor to poll between appends. This is the shape a live claudish run
 * produces: the writer emits each line as it happens, so a single turn's
 * request and completion routinely land in different polls.
 */
async function feedChunks(
  dir: string,
  slug: string,
  chunks: string[],
  opts: { exit?: string; timeout?: string } = {},
): Promise<Run> {
  const logPath = writeDebugLog(dir, slug, chunks[0]);
  const proc = Bun.spawn(
    [
      "bun", MONITOR,
      "--session-dir", dir,
      "--models", slug,
      "--timeout", opts.timeout ?? "20",
      "--poll-interval", "20",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const drained = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await advancePolls(dir, 2); // chunk 0 has been read
  for (const chunk of chunks.slice(1)) {
    appendFileSync(logPath, chunk);
    await advancePolls(dir, 2); // ...and so has this one
  }
  if (opts.exit !== undefined) {
    writeFileSync(join(dir, `${slug}.exit`), `${opts.exit}\n`);
  }

  const [stdout, stderr] = await drained;
  return { code: await proc.exited, stdout, stderr };
}

/** A whole turn — request, tools, usage, completion — in one write. */
const ONE_TURN =
  '[2026-08-22T10:00:00.000Z] [OpenRouter Request] { "targetModel": "glm-5.2", "messageCount": 1, "toolCount": 2 }\n' +
  "[2026-08-22T10:00:00.500Z] [OpenRouter] Tool calls: Read(10 chars), Bash(20 chars)\n" +
  "[2026-08-22T10:00:00.900Z] [OpenRouter] Usage: prompt=100, completion=42, total=142\n" +
  "[2026-08-22T10:00:01.000Z] [OpenRouter] Stream complete: success\n";

const ts = (ms: number) => new Date(Date.parse("2026-08-22T10:00:00.000Z") + ms).toISOString();

/** The same turn, cut where a live poll cuts it: request | body | completion. */
function splitTurn(startMs: number): string[] {
  return [
    `[${ts(startMs)}] [OpenRouter Request] { "targetModel": "glm-5.2", "messageCount": 1, "toolCount": 2 }\n`,
    `[${ts(startMs + 500)}] [OpenRouter] Tool calls: Read(10 chars), Bash(20 chars)\n` +
      `[${ts(startMs + 900)}] [OpenRouter] Usage: prompt=100, completion=42, total=142\n`,
    `[${ts(startMs + 1000)}] [OpenRouter] Stream complete: success\n`,
  ];
}

/** A request with no completion — a model still waiting on the API. */
const OPEN_REQUEST =
  '[2026-08-22T10:00:00.000Z] [OpenRouter Request] { "targetModel": "glm-5.2", "messageCount": 1, "toolCount": 0 }\n';

describe("command line", () => {
  test("--help documents every flag and exits 0", async () => {
    const r = await runMonitor(["--help"]);
    expect(r.code).toBe(0);
    for (const flag of ["--session-dir", "--models", "--timeout", "--poll-interval", "--stall-threshold"]) {
      expect(r.stdout).toContain(flag);
    }
  });

  test("a missing --session-dir is a usage error, not a silent no-op", async () => {
    // Exiting 0 here would let /team believe a monitor is watching when none is.
    const r = await runMonitor(["--models", "alpha"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Usage:");
  });

  test("a missing --models is a usage error", async () => {
    const r = await runMonitor(["--session-dir", session()]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Usage:");
  });

  test("a --models list that resolves to nothing is a usage error, not a clean bill of health", async () => {
    // `,` is truthy, so the flag looks supplied; splitting and dropping empties
    // leaves no slugs. Every model is then vacuously in a terminal state, so
    // the monitor exited 0 with all_completed=true for a run it never watched.
    const dir = session();
    const r = await runMonitor(["--session-dir", dir, "--models", ","]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--models");
    expect(existsSync(join(dir, "monitor-final.json"))).toBe(false);
  });

  test("a whitespace-only --models list is the same usage error", async () => {
    const dir = session();
    const r = await runMonitor(["--session-dir", dir, "--models", " , ,  "]);
    expect(r.code).toBe(1);
    expect(existsSync(join(dir, "monitor-final.json"))).toBe(false);
  });

  test("a non-numeric --timeout is rejected instead of silently becoming 180", async () => {
    // `parseInt("soon") || 180` turns a typo into a three-minute watch the
    // caller never asked for, and reports nothing about the substitution.
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "0\n"); // terminal at once either way
    const r = await runMonitor([
      "--session-dir", dir,
      "--models", "alpha",
      "--timeout", "soon",
      "--poll-interval", "20",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--timeout");
  });

  test("a zero or negative --timeout is rejected rather than replaced by the default", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "0\n");
    const r = await runMonitor([
      "--session-dir", dir,
      "--models", "alpha",
      "--timeout", "0",
      "--poll-interval", "20",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--timeout");
  });

  test("a malformed --poll-interval is rejected rather than replaced by the default", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "0\n");
    const r = await runMonitor([
      "--session-dir", dir,
      "--models", "alpha",
      "--timeout", "5",
      "--poll-interval", "fast",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--poll-interval");
  });

  test("a malformed --stall-threshold is rejected rather than replaced by the default", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "0\n");
    const r = await runMonitor([
      "--session-dir", dir,
      "--models", "alpha",
      "--timeout", "5",
      "--poll-interval", "20",
      "--stall-threshold", "0",
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--stall-threshold");
  });
});

describe("process outcome is read from the .exit file", () => {
  test("exit code 0 is COMPLETED and the run reports success", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "0\n");

    const r = await watch(dir, ["alpha"]);
    expect(r.code).toBe(0);

    const f = final(dir);
    expect(modelIn(f, "alpha").state).toBe("COMPLETED");
    expect(modelIn(f, "alpha").exit_code).toBe(0);
    expect(f.summary.completed_models).toEqual(["alpha"]);
    expect(f.summary.all_completed).toBe(true);
  });

  test("a non-zero exit is ERRORED and surfaces the process stderr", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "3\n");
    writeFileSync(join(dir, "alpha-stderr.log"), "  fatal: no API key configured\n");

    await watch(dir, ["alpha"]);
    const m = modelIn(final(dir), "alpha");
    expect(m.state).toBe("ERRORED");
    expect(m.exit_code).toBe(3);
    expect(m.error_message).toBe("fatal: no API key configured");
    expect(final(dir).summary.all_completed).toBe(false);
  });

  test("a huge stderr is capped so one model cannot swamp the status file", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "1\n");
    writeFileSync(join(dir, "alpha-stderr.log"), "E".repeat(5000));

    await watch(dir, ["alpha"]);
    expect(modelIn(final(dir), "alpha").error_message!.length).toBe(500);
  });

  test("a failure with no stderr still explains itself", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "9\n");

    await watch(dir, ["alpha"]);
    expect(modelIn(final(dir), "alpha").error_message).toBe("Process exited with code 9");
  });

  test("an unparseable .exit file leaves the model non-terminal rather than guessing", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "not-a-number\n");

    await runMonitor([
      "--session-dir", dir,
      "--models", "alpha",
      "--timeout", "1",
      "--poll-interval", "50",
    ]);
    const m = modelIn(final(dir), "alpha");
    expect(m.exit_code).toBeNull();
    expect(["STARTING", "ACTIVE"]).toContain(m.state);
  });
});

describe("debug log metrics", () => {
  test("a completed turn is counted with its tools and completion tokens", async () => {
    const dir = session();
    const logPath = writeDebugLog(dir, "alpha", ONE_TURN);
    writeFileSync(join(dir, "alpha.exit"), "0\n");

    await watch(dir, ["alpha"]);
    const m = modelIn(final(dir), "alpha");
    expect(m.turns_completed).toBe(1);
    expect(m.retries).toBe(0);
    // tokens_so_far tracks generated output, so it is the completion count (42),
    // never the 142 total — the prompt is resent every turn and would double-count.
    expect(m.tokens_so_far).toBe(42);
    expect(m.tool_calls.sort()).toEqual(["Bash", "Read"]);
    expect(m.debug_log_path).toBe(logPath);
  });

  test("summary totals aggregate across models", async () => {
    const dir = session();
    writeDebugLog(dir, "alpha", ONE_TURN);
    writeDebugLog(dir, "beta", ONE_TURN);
    writeFileSync(join(dir, "alpha.exit"), "0\n");
    writeFileSync(join(dir, "beta.exit"), "0\n");

    await watch(dir, ["alpha", "beta"]);
    const f = final(dir);
    expect(f.summary.total_turns_all_models).toBe(2);
    expect(f.summary.total_tokens_all_models).toBe(84);
  });

  test("the most recently written claudish log is the one followed", async () => {
    // A model that reconnects writes a second log; the stale one must not win.
    const dir = session();
    const old = writeDebugLog(dir, "alpha", ONE_TURN, "claudish_old.log");
    const fresh = writeDebugLog(dir, "alpha", ONE_TURN, "claudish_new.log");
    writeDebugLog(dir, "alpha", "ignore me", "notes.txt");
    utimesSync(old, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    utimesSync(fresh, new Date(), new Date());
    writeFileSync(join(dir, "alpha.exit"), "0\n");

    await watch(dir, ["alpha"]);
    expect(modelIn(final(dir), "alpha").debug_log_path).toBe(fresh);
  });

  test("a model with no log directory yet is reported, not crashed on", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "0\n");

    const r = await watch(dir, ["alpha"]);
    expect(r.code).toBe(0);
    expect(modelIn(final(dir), "alpha").debug_log_path).toBe("");
    expect(modelIn(final(dir), "alpha").turns_completed).toBe(0);
  });

  test("the result file size is reported so /team can tell empty output apart", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha-result.md"), "hello world");
    writeFileSync(join(dir, "beta-result.md"), "");
    writeFileSync(join(dir, "alpha.exit"), "0\n");
    writeFileSync(join(dir, "beta.exit"), "0\n");

    await watch(dir, ["alpha", "beta"]);
    const f = final(dir);
    expect(modelIn(f, "alpha").result_file_bytes).toBe(11);
    expect(modelIn(f, "beta").result_file_bytes).toBe(0);
  });
});

describe("a turn split across polls counts once, not as a retry", () => {
  // claudish writes each line as it happens and the monitor polls every few
  // seconds, so a turn straddling two polls is the normal case. The metrics a
  // poll derives must therefore describe the whole log so far, never just the
  // slice that arrived since the last poll.

  test("the fixture chunks reassemble into exactly ONE_TURN", () => {
    // If this drifts, the comparison below stops comparing like with like.
    expect(splitTurn(0).join("")).toBe(ONE_TURN);
  });

  test(
    "one write and three appends of identical content report identical metrics",
    async () => {
      const whole = session();
      writeDebugLog(whole, "alpha", ONE_TURN);
      writeFileSync(join(whole, "alpha.exit"), "0\n");
      await watch(whole, ["alpha"]);
      const w = modelIn(final(whole), "alpha");

      const split = session();
      await feedChunks(split, "alpha", splitTurn(0), { exit: "0" });
      const s = modelIn(final(split), "alpha");

      const shape = (m: typeof w) => ({
        turns_completed: m.turns_completed,
        retries: m.retries,
        tokens_so_far: m.tokens_so_far,
        tool_calls: [...m.tool_calls].sort(),
      });
      expect(shape(s)).toEqual(shape(w));

      // Pinned absolutely as well: two zeroed reports are also "identical".
      expect(shape(s)).toEqual({
        turns_completed: 1,
        retries: 0,
        tokens_so_far: 42,
        tool_calls: ["Bash", "Read"],
      });
      expect(final(split).summary.total_turns_all_models).toBe(1);
      expect(final(split).summary.total_tokens_all_models).toBe(42);
    },
    30_000,
  );

  test(
    "three healthy split turns are not mistaken for a stall",
    async () => {
      // Each split turn used to read as one retry, so three of them tripped
      // RETRY_STALL_COUNT and reported a model that was doing fine as STALLED.
      // No .exit is written: the terminal state must come from the log alone.
      const dir = session();
      const chunks = [0, 5_000, 10_000].flatMap((t) => splitTurn(t));
      await feedChunks(dir, "alpha", chunks, { timeout: "3" });

      const f = final(dir);
      const m = modelIn(f, "alpha");
      expect(m.state).toBe("ACTIVE");
      expect(m.consecutive_retries).toBe(0);
      expect(m.retries).toBe(0);
      expect(m.turns_completed).toBe(3);
      expect(m.tokens_so_far).toBe(126);
      expect(f.summary.stalled_models).toEqual([]);
    },
    30_000,
  );
});

describe("sentinels", () => {
  test(".skip marks the model SKIPPED without touching the process", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.skip"), "");

    await watch(dir, ["alpha"]);
    const f = final(dir);
    expect(modelIn(f, "alpha").state).toBe("SKIPPED");
    expect(f.summary.skipped_models).toEqual(["alpha"]);
    expect(f.summary.all_completed).toBe(false);
    expect(existsSync(join(dir, "alpha.exit"))).toBe(false);
  });

  test(".kill with no PID still records a terminal outcome and writes an exit code", async () => {
    // /team reads <slug>.exit to decide whether a model produced anything.
    // A kill that left no exit file would hang that read forever.
    const dir = session();
    writeFileSync(join(dir, "alpha.kill"), "");

    await watch(dir, ["alpha"]);
    const m = modelIn(final(dir), "alpha");
    expect(m.state).toBe("KILLED");
    expect(m.exit_code).toBe(130);
    expect(m.error_message).toContain("no PID");
    expect(readFileSync(join(dir, "alpha.exit"), "utf-8").trim()).toBe("130");
  });

  test(".kill is ignored once the process has already exited on its own", async () => {
    // Racing a natural completion against a late kill must not rewrite a
    // successful run as KILLED.
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "0\n");
    writeFileSync(join(dir, "alpha.kill"), "");

    await watch(dir, ["alpha"]);
    const m = modelIn(final(dir), "alpha");
    expect(m.state).toBe("COMPLETED");
    expect(m.exit_code).toBe(0);
  });

  test(
    ".kill terminates the live process named in the PID file",
    async () => {
      // The one branch that matters most: an abandoned model must actually stop
      // burning tokens. Costs KILL_GRACE_MS (5s, a hardcoded constant).
      const dir = session();
      mkdirSync(join(dir, "pids"), { recursive: true });
      const child = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
      const childExited = child.exited;
      writeFileSync(join(dir, "pids", "alpha.pid"), `${child.pid}\n`);
      writeFileSync(join(dir, "alpha.kill"), "");

      const r = await runMonitor([
        "--session-dir", dir,
        "--models", "alpha",
        "--timeout", "20",
        "--poll-interval", "50",
      ]);

      expect(await childExited).not.toBe(0); // signalled, not a clean exit
      expect(r.stdout).toContain("Sent SIGTERM");
      const m = modelIn(final(dir), "alpha");
      expect(m.state).toBe("KILLED");
      expect(m.pid).toBe(child.pid);
      expect(m.exit_code).toBe(130);
    },
    20_000,
  );
});

describe("stall detection", () => {
  test(
    "a model that stops writing while waiting on the API is STALLED, and one that never started is not",
    async () => {
      const dir = session();
      writeDebugLog(dir, "alpha", OPEN_REQUEST); // opened a request, then silence
      // beta has no files at all — it never produced a byte, so there is no
      // activity clock to compare against and it must not be called stalled.

      const r = await runMonitor([
        "--session-dir", dir,
        "--models", "alpha,beta",
        "--timeout", "1",
        "--poll-interval", "50",
        "--stall-threshold", "150",
      ]);
      expect(r.code).toBe(0);

      const f = final(dir);
      const alpha = modelIn(f, "alpha");
      expect(alpha.state).toBe("STALLED");
      expect(alpha.stall_during_api_call).toBe(true);
      expect(f.summary.stalled_models).toEqual(["alpha"]);

      expect(modelIn(f, "beta").state).toBe("STARTING");
      expect(f.poll_count).toBeGreaterThan(1);
    },
    10_000,
  );
});

describe("status files", () => {
  test("the live snapshot is valid JSON and leaves no temp file behind", async () => {
    // /team polls monitor-status.json while the run is in flight, so a
    // half-written file there would be parsed as corruption.
    const dir = session();
    writeDebugLog(dir, "alpha", ONE_TURN);
    writeFileSync(join(dir, "alpha.exit"), "0\n");

    await watch(dir, ["alpha"]);

    const status: MonitorStatus = JSON.parse(
      readFileSync(join(dir, "monitor-status.json"), "utf-8"),
    );
    expect(status.session_id).toBe(dir.split("/").pop());
    expect(status.poll_count).toBeGreaterThanOrEqual(1);
    expect(status.timeout_seconds).toBe(5);
    expect(Date.parse(status.generated_at)).not.toBeNaN();
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("every requested model appears in the report, in the order given", async () => {
    const dir = session();
    writeFileSync(join(dir, "alpha.exit"), "0\n");
    writeFileSync(join(dir, "beta.exit"), "2\n");
    writeFileSync(join(dir, "gamma.skip"), "");

    await watch(dir, ["alpha", "beta", "gamma"]);
    const f = final(dir);
    expect(f.models.map((m) => m.model_slug)).toEqual(["alpha", "beta", "gamma"]);
    expect(f.summary.completed_models).toEqual(["alpha"]);
    expect(f.summary.errored_models).toEqual(["beta"]);
    expect(f.summary.skipped_models).toEqual(["gamma"]);
    expect(f.summary.all_completed).toBe(false);
  });

  test("SIGTERM still produces a final report", async () => {
    // /team terminates the monitor as soon as it has what it needs; the run
    // summary must survive that.
    const dir = session();
    writeDebugLog(dir, "alpha", OPEN_REQUEST); // never terminal on its own
    const proc = Bun.spawn(
      ["bun", MONITOR, "--session-dir", dir, "--models", "alpha", "--timeout", "30", "--poll-interval", "30"],
      { stdout: "pipe", stderr: "pipe" },
    );

    const deadline = Date.now() + 5000;
    while (!existsSync(join(dir, "monitor-status.json")) && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    proc.kill("SIGTERM");

    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(stdout).toContain("Received SIGTERM");
    expect(existsSync(join(dir, "monitor-final.json"))).toBe(true);
    expect(modelIn(final(dir), "alpha").model_slug).toBe("alpha");
  }, 10_000);
});
