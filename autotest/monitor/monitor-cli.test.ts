/**
 * Tests D01–D07: CLI Argument Parsing
 *
 * Tests the monitor.ts CLI interface: required arguments, optional flags,
 * and --help output. Uses Bun.spawn to run the monitor as a subprocess.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { MonitorStatus } from "../../autotest/framework/types.ts";

const MONITOR_PATH =
  "/Users/jack/mag/claude-code/plugins/multimodel/scripts/monitor.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `monitor-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupMinimalSession(sessionDir: string, slug: string): void {
  mkdirSync(join(sessionDir, "pids"), { recursive: true });
  mkdirSync(join(sessionDir, "work", slug, "logs"), { recursive: true });
}

function writeExitCode(sessionDir: string, slug: string, code: number): void {
  writeFileSync(join(sessionDir, `${slug}.exit`), `${code}\n`);
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function spawnMonitor(
  args: string[],
  timeoutMs = 15_000
): Promise<SpawnResult> {
  const proc = Bun.spawn(["bun", MONITOR_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutPromise = new Promise<SpawnResult>((resolve) => {
    setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ exitCode: -1, stdout: "", stderr: "TIMEOUT" });
    }, timeoutMs);
  });

  const waitPromise = proc.exited.then(async () => {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { exitCode: proc.exitCode ?? 0, stdout, stderr };
  });

  return Promise.race([waitPromise, timeoutPromise]);
}

// ---------------------------------------------------------------------------
// TEST-D01: --session-dir is required
// ---------------------------------------------------------------------------

describe("TEST-D01: --session-dir argument is required", () => {
  it("exits with non-zero when --session-dir is missing", async () => {
    const result = await spawnMonitor(["--models", "slug1", "--timeout", "1"]);
    expect(result.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-D02: --models is required
// ---------------------------------------------------------------------------

describe("TEST-D02: --models argument is required", () => {
  it("exits with non-zero when --models is missing", async () => {
    const sessionDir = makeTempDir();
    const result = await spawnMonitor([
      "--session-dir",
      sessionDir,
      "--timeout",
      "1",
    ]);
    expect(result.exitCode).not.toBe(0);
    rmSync(sessionDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// TEST-D03: --models parses comma-separated slugs into array
// ---------------------------------------------------------------------------

describe("TEST-D03: --models parses comma-separated slugs into array", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    for (const slug of ["slug-1", "slug-2", "slug-3"]) {
      setupMinimalSession(sessionDir, slug);
      writeExitCode(sessionDir, slug, 0);
    }
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("tracks 3 models from comma-separated --models value", async () => {
    await spawnMonitor(
      [
        "--session-dir",
        sessionDir,
        "--models",
        "slug-1,slug-2,slug-3",
        "--timeout",
        "3",
        "--poll-interval",
        "300",
      ],
      10_000
    );

    const statusPath = join(sessionDir, "monitor-status.json");
    expect(existsSync(statusPath)).toBe(true);

    const text = await Bun.file(statusPath).text();
    const status: MonitorStatus = JSON.parse(text);

    expect(status.models).toHaveLength(3);
    const slugs = status.models.map((m) => m.model_slug);
    expect(slugs).toContain("slug-1");
    expect(slugs).toContain("slug-2");
    expect(slugs).toContain("slug-3");

    // Each starts in a valid state (STARTING or terminal after exit code detected)
    for (const model of status.models) {
      expect([
        "STARTING",
        "ACTIVE",
        "CALLING_API",
        "TOOL_EXECUTING",
        "STALLED",
        "COMPLETED",
        "ERRORED",
        "KILLED",
        "SKIPPED",
      ]).toContain(model.state);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-D04: --timeout sets the deadline for monitor exit
// ---------------------------------------------------------------------------

describe("TEST-D04: --timeout sets the deadline for monitor exit", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    // No exit files — monitor must run until timeout
    setupMinimalSession(sessionDir, "timeout-slug");
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("monitor exits within reasonable margin of --timeout 3 seconds", async () => {
    const startMs = Date.now();
    await spawnMonitor(
      [
        "--session-dir",
        sessionDir,
        "--models",
        "timeout-slug",
        "--timeout",
        "3",
        "--poll-interval",
        "500",
      ],
      15_000 // outer test timeout
    );
    const elapsedMs = Date.now() - startMs;

    // Should exit in roughly 3-6 seconds (3s timeout + processing margin)
    expect(elapsedMs).toBeGreaterThanOrEqual(2500); // at least 2.5s
    expect(elapsedMs).toBeLessThan(10_000); // less than 10s total

    // monitor-final.json should be written
    expect(existsSync(join(sessionDir, "monitor-final.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST-D05: --stall-threshold overrides default 30s threshold
// ---------------------------------------------------------------------------

describe("TEST-D05: --stall-threshold overrides default 30s inactivity threshold", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupMinimalSession(sessionDir, "stall-thresh-slug");
    // Write some log content so model starts as ACTIVE
    const ts = new Date().toISOString();
    const logsDir = join(sessionDir, "work", "stall-thresh-slug", "logs");
    writeFileSync(
      join(logsDir, "claudish_2026-01-01_00-00-00.log"),
      `[${ts}] [OpenRouter Request] { "targetModel": "claude-opus-4-6", "messageCount": 3, "toolCount": 0 }\n` +
        `[${ts}] [OpenRouter] Stream complete: success\n`
    );
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("model becomes STALLED after custom stall threshold (2s), not 30s", async () => {
    // Run with 2s stall threshold, 4s timeout — model should stall by second poll
    const startMs = Date.now();
    await spawnMonitor(
      [
        "--session-dir",
        sessionDir,
        "--models",
        "stall-thresh-slug",
        "--timeout",
        "5",
        "--poll-interval",
        "500",
        "--stall-threshold",
        "2000",
      ],
      15_000
    );
    const elapsedMs = Date.now() - startMs;

    const statusPath = join(sessionDir, "monitor-status.json");
    expect(existsSync(statusPath)).toBe(true);

    const text = await Bun.file(statusPath).text();
    const status: MonitorStatus = JSON.parse(text);

    const model = status.models.find((m) => m.model_slug === "stall-thresh-slug");
    expect(model).toBeDefined();
    // With 2s stall threshold, after ~3s of no activity, model should be STALLED
    if (model) {
      expect(model.state).toBe("STALLED");
    }
  }, 20_000);
});

// ---------------------------------------------------------------------------
// TEST-D06: Single model slug in --models works correctly
// ---------------------------------------------------------------------------

describe("TEST-D06: Single model slug in --models works correctly", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupMinimalSession(sessionDir, "single-slug");
    writeExitCode(sessionDir, "single-slug", 0);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("tracks exactly 1 model from single --models value", async () => {
    await spawnMonitor(
      [
        "--session-dir",
        sessionDir,
        "--models",
        "single-slug",
        "--timeout",
        "3",
        "--poll-interval",
        "300",
      ],
      10_000
    );

    const statusPath = join(sessionDir, "monitor-status.json");
    expect(existsSync(statusPath)).toBe(true);

    const text = await Bun.file(statusPath).text();
    const status: MonitorStatus = JSON.parse(text);

    expect(status.models).toHaveLength(1);
    expect(status.models[0].model_slug).toBe("single-slug");
  });
});

// ---------------------------------------------------------------------------
// TEST-D07: --help outputs usage information
// ---------------------------------------------------------------------------

describe("TEST-D07: --help outputs usage information", () => {
  it("--help prints usage text and exits with code 0", async () => {
    const result = await spawnMonitor(["--help"], 5_000);
    expect(result.exitCode).toBe(0);
    // Should output some usage text
    const combined = result.stdout + result.stderr;
    expect(combined.toLowerCase()).toMatch(/usage|session-dir|models/i);
  });
});
