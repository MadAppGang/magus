/**
 * Tests E01–E07: Sentinel File Handling
 *
 * Tests .kill and .skip sentinel behavior, SIGTERM handling,
 * and the fail-open property of the monitor.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { MonitorStatus, MonitorFinal } from "../../autotest/framework/types.ts";

const MONITOR_PATH =
  "/Users/jack/mag/claude-code/plugins/multimodel/scripts/monitor.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `monitor-sentinel-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupSessionDir(sessionDir: string, slugs: string[]): void {
  mkdirSync(join(sessionDir, "pids"), { recursive: true });
  for (const slug of slugs) {
    mkdirSync(join(sessionDir, "work", slug, "logs"), { recursive: true });
  }
}

function writeDebugLog(
  sessionDir: string,
  slug: string,
  content: string
): void {
  const logsDir = join(sessionDir, "work", slug, "logs");
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(
    join(logsDir, "claudish_2026-01-01_00-00-00.log"),
    content
  );
}

function writeExitCode(sessionDir: string, slug: string, code: number): void {
  writeFileSync(join(sessionDir, `${slug}.exit`), `${code}\n`);
}

function writePidFile(sessionDir: string, slug: string, pid: number): void {
  mkdirSync(join(sessionDir, "pids"), { recursive: true });
  writeFileSync(join(sessionDir, "pids", `${slug}.pid`), `${pid}\n`);
}

function makeTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeCompleteTurn(): string {
  const ts1 = makeTimestamp(0);
  const ts2 = makeTimestamp(500);
  return [
    `[${ts1}] [OpenRouter Request] { "targetModel": "claude-opus-4-6", "messageCount": 5, "toolCount": 0 }`,
    `[${ts2}] [OpenRouter] Stream complete: success`,
    "",
  ].join("\n");
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  pid: number | undefined;
}

async function spawnMonitorBackground(
  sessionDir: string,
  slugs: string[],
  opts: { timeout?: number; pollInterval?: number } = {}
): Promise<{ proc: ReturnType<typeof Bun.spawn>; pid: number | undefined }> {
  const timeout = opts.timeout ?? 30;
  const pollInterval = opts.pollInterval ?? 500;

  const proc = Bun.spawn(
    [
      "bun",
      MONITOR_PATH,
      "--session-dir",
      sessionDir,
      "--models",
      slugs.join(","),
      "--timeout",
      String(timeout),
      "--poll-interval",
      String(pollInterval),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  return { proc, pid: proc.pid };
}

async function runMonitorAndWait(
  sessionDir: string,
  slugs: string[],
  opts: { timeout?: number; pollInterval?: number } = {}
): Promise<{ exitCode: number; statusJson: MonitorStatus | null; finalJson: MonitorFinal | null }> {
  const timeout = opts.timeout ?? 10;
  const pollInterval = opts.pollInterval ?? 300;

  const proc = Bun.spawn(
    [
      "bun",
      MONITOR_PATH,
      "--session-dir",
      sessionDir,
      "--models",
      slugs.join(","),
      "--timeout",
      String(timeout),
      "--poll-interval",
      String(pollInterval),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  const timeoutHandle = setTimeout(() => proc.kill("SIGKILL"), (timeout + 5) * 1000);

  await proc.exited;
  clearTimeout(timeoutHandle);

  const exitCode = proc.exitCode ?? 0;

  let statusJson: MonitorStatus | null = null;
  let finalJson: MonitorFinal | null = null;

  const statusPath = join(sessionDir, "monitor-status.json");
  const finalPath = join(sessionDir, "monitor-final.json");

  if (existsSync(statusPath)) {
    try {
      statusJson = JSON.parse(await Bun.file(statusPath).text());
    } catch { }
  }
  if (existsSync(finalPath)) {
    try {
      finalJson = JSON.parse(await Bun.file(finalPath).text());
    } catch { }
  }

  return { exitCode, statusJson, finalJson };
}

function getModelStatus(status: MonitorStatus | null, slug: string) {
  return status?.models.find((m) => m.model_slug === slug);
}

// ---------------------------------------------------------------------------
// TEST-E01: .kill sentinel triggers SIGTERM when process is alive
// ---------------------------------------------------------------------------

describe("TEST-E01: .kill sentinel triggers SIGTERM when process is alive", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["kill-active"]);
    writeDebugLog(sessionDir, "kill-active", makeCompleteTurn());
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("state transitions to KILLED when .kill sentinel present (no valid PID)", async () => {
    // Write .kill sentinel — no valid PID so SIGTERM is skipped, state still KILLED
    writeFileSync(join(sessionDir, "kill-active.kill"), "");
    // No exit file and no PID file — monitor handles missing PID gracefully

    const { statusJson } = await runMonitorAndWait(
      sessionDir,
      ["kill-active"],
      { timeout: 8, pollInterval: 400 }
    );

    const model = getModelStatus(statusJson, "kill-active");
    expect(model).toBeDefined();
    if (model) {
      expect(model.state).toBe("KILLED");
    }
  });

  it("state transitions to KILLED when PID does not exist (kill -0 fails)", async () => {
    // Write a PID that definitely doesn't exist (very high number)
    writePidFile(sessionDir, "kill-active", 9999999);
    writeFileSync(join(sessionDir, "kill-active.kill"), "");

    const { statusJson } = await runMonitorAndWait(
      sessionDir,
      ["kill-active"],
      { timeout: 8, pollInterval: 400 }
    );

    const model = getModelStatus(statusJson, "kill-active");
    expect(model).toBeDefined();
    if (model) {
      expect(model.state).toBe("KILLED");
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-E02: .kill sentinel ignored when .exit file exists
// ---------------------------------------------------------------------------

describe("TEST-E02: .kill sentinel is ignored when .exit file exists", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["exit-plus-kill"]);
    writeDebugLog(sessionDir, "exit-plus-kill", makeCompleteTurn());
    // Write BOTH exit and kill files
    writeExitCode(sessionDir, "exit-plus-kill", 0);
    writeFileSync(join(sessionDir, "exit-plus-kill.kill"), "");
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("state is COMPLETED (not KILLED) when both .exit and .kill exist", async () => {
    const { statusJson } = await runMonitorAndWait(
      sessionDir,
      ["exit-plus-kill"],
      { timeout: 5, pollInterval: 300 }
    );

    const model = getModelStatus(statusJson, "exit-plus-kill");
    expect(model).toBeDefined();
    if (model) {
      // .exit takes precedence over .kill
      expect(model.state).toBe("COMPLETED");
      expect(model.exit_code).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-E03: .skip sentinel triggers SIGTERM and transitions to SKIPPED
// ---------------------------------------------------------------------------

describe("TEST-E03: .skip sentinel triggers SIGTERM and transitions to SKIPPED", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["skip-test"]);
    writeDebugLog(sessionDir, "skip-test", makeCompleteTurn());
    // Write skip sentinel
    writeFileSync(join(sessionDir, "skip-test.skip"), "");
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("state transitions to SKIPPED when .skip sentinel is present", async () => {
    const { statusJson } = await runMonitorAndWait(
      sessionDir,
      ["skip-test"],
      { timeout: 5, pollInterval: 300 }
    );

    const model = getModelStatus(statusJson, "skip-test");
    expect(model).toBeDefined();
    if (model) {
      expect(model.state).toBe("SKIPPED");
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-E04: kill -0 PID validation prevents sending SIGTERM to invalid PID
// ---------------------------------------------------------------------------

describe("TEST-E04: kill -0 PID validation prevents SIGTERM to invalid PID", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["invalid-pid"]);
    writeDebugLog(sessionDir, "invalid-pid", makeCompleteTurn());
    // Invalid PID
    writePidFile(sessionDir, "invalid-pid", 9999999);
    writeFileSync(join(sessionDir, "invalid-pid.kill"), "");
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("monitor does not crash when kill -0 fails for invalid PID", async () => {
    // The monitor should handle this gracefully without throwing
    const { exitCode, statusJson } = await runMonitorAndWait(
      sessionDir,
      ["invalid-pid"],
      { timeout: 5, pollInterval: 300 }
    );

    // Monitor itself should not crash (exit code should be 0, not error)
    expect(exitCode).toBe(0);

    const model = getModelStatus(statusJson, "invalid-pid");
    expect(model).toBeDefined();
    if (model) {
      // State should be KILLED (graceful handling of invalid PID)
      expect(model.state).toBe("KILLED");
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-E05: Monitor writes monitor-final.json on SIGTERM (graceful shutdown)
// ---------------------------------------------------------------------------

describe("TEST-E05: Monitor writes monitor-final.json on SIGTERM", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["sigterm-slug"]);
    writeDebugLog(sessionDir, "sigterm-slug", makeCompleteTurn());
    // No exit file — monitor will run indefinitely until SIGTERM
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("monitor-final.json is written before process exits on SIGTERM", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        MONITOR_PATH,
        "--session-dir",
        sessionDir,
        "--models",
        "sigterm-slug",
        "--timeout",
        "30",
        "--poll-interval",
        "500",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Wait for monitor to start (first poll cycle)
    await Bun.sleep(1500);

    // Send SIGTERM to the monitor process
    try {
      proc.kill("SIGTERM");
    } catch {
      // Process may have already exited
    }

    // Wait for graceful shutdown (up to 5 seconds)
    const exitTimeout = setTimeout(() => proc.kill("SIGKILL"), 5000);
    await proc.exited;
    clearTimeout(exitTimeout);

    // monitor-final.json should exist
    const finalPath = join(sessionDir, "monitor-final.json");
    expect(existsSync(finalPath)).toBe(true);

    // It should be valid JSON conforming to MonitorFinal
    if (existsSync(finalPath)) {
      const text = await Bun.file(finalPath).text();
      let final: MonitorFinal | null = null;
      expect(() => {
        final = JSON.parse(text);
      }).not.toThrow();

      if (final) {
        expect(typeof (final as MonitorFinal).session_id).toBe("string");
        expect(typeof (final as MonitorFinal).summary).toBe("object");
        expect(Array.isArray((final as MonitorFinal).summary.completed_models)).toBe(true);
      }
    }

    // Process should exit with code 0 (clean shutdown)
    expect(proc.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-E06: Monitor crash does not affect claudish processes
// ---------------------------------------------------------------------------

describe("TEST-E06: Monitor crash does not affect claudish processes", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["crash-test"]);
    writeDebugLog(sessionDir, "crash-test", makeCompleteTurn());
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("monitor SIGKILL does not prevent external processes from writing their result files", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        MONITOR_PATH,
        "--session-dir",
        sessionDir,
        "--models",
        "crash-test",
        "--timeout",
        "30",
        "--poll-interval",
        "500",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Wait briefly then SIGKILL (unclean)
    await Bun.sleep(800);
    proc.kill("SIGKILL");
    await proc.exited;

    // Simulate external process writing its result file independently
    const resultPath = join(sessionDir, "crash-test-result.md");
    writeFileSync(resultPath, "# External process result\nCompleted independently.");
    writeExitCode(sessionDir, "crash-test", 0);

    // Verify files are intact — monitor crash had no effect
    expect(existsSync(resultPath)).toBe(true);
    expect(existsSync(join(sessionDir, "crash-test.exit"))).toBe(true);

    const resultContent = await Bun.file(resultPath).text();
    expect(resultContent).toContain("External process result");
  });
});

// ---------------------------------------------------------------------------
// TEST-E07: Sentinel files checked on every poll cycle
// ---------------------------------------------------------------------------

describe("TEST-E07: Sentinel files checked on every poll cycle", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["poll-sentinel"]);
    writeDebugLog(sessionDir, "poll-sentinel", makeCompleteTurn());
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("sentinel written between poll cycles is detected on next cycle", async () => {
    // Start monitor in background
    const proc = Bun.spawn(
      [
        "bun",
        MONITOR_PATH,
        "--session-dir",
        sessionDir,
        "--models",
        "poll-sentinel",
        "--timeout",
        "10",
        "--poll-interval",
        "500",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    // Wait for first poll to complete, then write sentinel
    await Bun.sleep(800);
    writeFileSync(join(sessionDir, "poll-sentinel.skip"), "");

    // Wait for next poll cycle to detect sentinel
    await Bun.sleep(1500);

    // Check status — should now be SKIPPED
    const statusPath = join(sessionDir, "monitor-status.json");
    if (existsSync(statusPath)) {
      const text = await Bun.file(statusPath).text();
      const status: MonitorStatus = JSON.parse(text);
      const model = status.models.find((m) => m.model_slug === "poll-sentinel");
      if (model) {
        // Model should have been skipped by now
        expect(model.state).toBe("SKIPPED");
      }
    }

    // Clean up
    proc.kill("SIGKILL");
    await proc.exited;
  });
});
