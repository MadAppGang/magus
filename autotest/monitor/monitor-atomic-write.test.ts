/**
 * Tests C01–C06: Atomic Write Correctness and JSON Schema Validation
 *
 * Validates that monitor-status.json and monitor-final.json conform to their
 * TypeScript interfaces and are always valid JSON (atomic write guarantee).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  ModelStatus,
  MonitorStatus,
  MonitorFinal,
  ProcessState,
} from "../../autotest/framework/types.ts";

const MONITOR_PATH =
  "/Users/jack/mag/claude-code/plugins/multimodel/scripts/monitor.ts";

const VALID_STATES: ProcessState[] = [
  "STARTING",
  "ACTIVE",
  "CALLING_API",
  "TOOL_EXECUTING",
  "STALLED",
  "COMPLETED",
  "ERRORED",
  "KILLED",
  "SKIPPED",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `monitor-atomic-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

function writeExitCode(
  sessionDir: string,
  slug: string,
  code: number
): void {
  writeFileSync(join(sessionDir, `${slug}.exit`), `${code}\n`);
}

function makeTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeCompleteTurn(): string {
  const ts1 = makeTimestamp(0);
  const ts2 = makeTimestamp(500);
  return [
    `[${ts1}] [OpenRouter Request] { "targetModel": "claude-opus-4-6", "messageCount": 5, "toolCount": 0 }`,
    `[${ts2}] [OpenRouter] Usage: prompt=1000, completion=250, total=1250`,
    `[${ts2}] [OpenRouter] Stream complete: success`,
    "",
  ].join("\n");
}

async function runMonitorAndWait(
  sessionDir: string,
  slugs: string[],
  timeout = 5,
  pollInterval = 300
): Promise<void> {
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
  await proc.exited;
}

function isValidISO8601(str: string): boolean {
  try {
    const d = new Date(str);
    return !isNaN(d.getTime()) && d.toISOString().length > 0;
  } catch {
    return false;
  }
}

function validateModelStatus(entry: any): void {
  expect(typeof entry.model_id).toBe("string");
  expect(typeof entry.model_slug).toBe("string");
  expect(VALID_STATES).toContain(entry.state);
  expect(typeof entry.turns_completed).toBe("number");
  expect(entry.turns_completed).toBeGreaterThanOrEqual(0);
  expect(typeof entry.retries).toBe("number");
  expect(entry.retries).toBeGreaterThanOrEqual(0);
  expect(typeof entry.consecutive_retries).toBe("number");
  expect(entry.consecutive_retries).toBeGreaterThanOrEqual(0);
  expect(typeof entry.tokens_so_far).toBe("number");
  expect(entry.tokens_so_far).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(entry.tool_calls)).toBe(true);
  expect(typeof entry.elapsed_seconds).toBe("number");
  expect(entry.elapsed_seconds).toBeGreaterThanOrEqual(0);
  expect(typeof entry.last_activity_seconds_ago).toBe("number");
  expect(entry.last_activity_seconds_ago).toBeGreaterThanOrEqual(0);
  expect(typeof entry.stall_during_api_call).toBe("boolean");
  // pid is number or null
  expect(entry.pid === null || typeof entry.pid === "number").toBe(true);
  // exit_code is number or null
  expect(entry.exit_code === null || typeof entry.exit_code === "number").toBe(
    true
  );
  expect(typeof entry.result_file_bytes).toBe("number");
  expect(entry.result_file_bytes).toBeGreaterThanOrEqual(0);
  expect(typeof entry.debug_log_path).toBe("string");
  // error_message is string or null
  expect(
    entry.error_message === null || typeof entry.error_message === "string"
  ).toBe(true);
}

// ---------------------------------------------------------------------------
// TEST-C01: monitor-status.json is valid JSON after write
// ---------------------------------------------------------------------------

describe("TEST-C01: monitor-status.json is valid JSON after write", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["json-slug"]);
    writeDebugLog(sessionDir, "json-slug", makeCompleteTurn());
    writeExitCode(sessionDir, "json-slug", 0);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("monitor-status.json is parseable as JSON", async () => {
    await runMonitorAndWait(sessionDir, ["json-slug"]);

    const statusPath = join(sessionDir, "monitor-status.json");
    expect(existsSync(statusPath)).toBe(true);

    const text = await Bun.file(statusPath).text();
    // Should not throw
    let parsed: any;
    expect(() => {
      parsed = JSON.parse(text);
    }).not.toThrow();
    expect(parsed).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TEST-C02: monitor-status.json conforms to MonitorStatus schema
// ---------------------------------------------------------------------------

describe("TEST-C02: monitor-status.json conforms to MonitorStatus schema", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["schema-slug"]);
    writeDebugLog(sessionDir, "schema-slug", makeCompleteTurn());
    writeExitCode(sessionDir, "schema-slug", 0);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("has all required MonitorStatus fields", async () => {
    await runMonitorAndWait(sessionDir, ["schema-slug"]);

    const statusPath = join(sessionDir, "monitor-status.json");
    const text = await Bun.file(statusPath).text();
    const status: MonitorStatus = JSON.parse(text);

    // session_id: string
    expect(typeof status.session_id).toBe("string");

    // generated_at: ISO-8601 string
    expect(typeof status.generated_at).toBe("string");
    expect(isValidISO8601(status.generated_at)).toBe(true);

    // elapsed_seconds: number >= 0
    expect(typeof status.elapsed_seconds).toBe("number");
    expect(status.elapsed_seconds).toBeGreaterThanOrEqual(0);

    // timeout_seconds: number > 0
    expect(typeof status.timeout_seconds).toBe("number");
    expect(status.timeout_seconds).toBeGreaterThan(0);

    // poll_count: integer >= 1
    expect(typeof status.poll_count).toBe("number");
    expect(status.poll_count).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(status.poll_count)).toBe(true);

    // models: array
    expect(Array.isArray(status.models)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST-C03: Each model entry conforms to ModelStatus schema
// ---------------------------------------------------------------------------

describe("TEST-C03: Each model entry conforms to ModelStatus schema", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["model1", "model2"]);
    writeDebugLog(sessionDir, "model1", makeCompleteTurn());
    writeDebugLog(sessionDir, "model2", makeCompleteTurn());
    writeExitCode(sessionDir, "model1", 0);
    writeExitCode(sessionDir, "model2", 0);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("each model entry has all required ModelStatus fields", async () => {
    await runMonitorAndWait(sessionDir, ["model1", "model2"]);

    const statusPath = join(sessionDir, "monitor-status.json");
    const text = await Bun.file(statusPath).text();
    const status: MonitorStatus = JSON.parse(text);

    expect(status.models).toHaveLength(2);
    for (const entry of status.models) {
      validateModelStatus(entry);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-C04: monitor-final.json conforms to MonitorFinal schema
// ---------------------------------------------------------------------------

describe("TEST-C04: monitor-final.json conforms to MonitorFinal schema", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["final-slug"]);
    writeDebugLog(sessionDir, "final-slug", makeCompleteTurn());
    writeExitCode(sessionDir, "final-slug", 0);
    writeFileSync(
      join(sessionDir, "final-slug-result.md"),
      "# Final result"
    );
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("monitor-final.json has all required MonitorFinal fields", async () => {
    await runMonitorAndWait(sessionDir, ["final-slug"]);

    const finalPath = join(sessionDir, "monitor-final.json");
    expect(existsSync(finalPath)).toBe(true);

    const text = await Bun.file(finalPath).text();
    const final: MonitorFinal = JSON.parse(text);

    // Inherits MonitorStatus fields
    expect(typeof final.session_id).toBe("string");
    expect(typeof final.generated_at).toBe("string");
    expect(typeof final.elapsed_seconds).toBe("number");
    expect(typeof final.timeout_seconds).toBe("number");
    expect(typeof final.poll_count).toBe("number");
    expect(Array.isArray(final.models)).toBe(true);

    // Summary fields
    expect(typeof final.summary).toBe("object");
    expect(typeof final.summary.all_completed).toBe("boolean");
    expect(Array.isArray(final.summary.completed_models)).toBe(true);
    expect(Array.isArray(final.summary.stalled_models)).toBe(true);
    expect(Array.isArray(final.summary.errored_models)).toBe(true);
    expect(Array.isArray(final.summary.killed_models)).toBe(true);
    expect(Array.isArray(final.summary.skipped_models)).toBe(true);
    expect(typeof final.summary.total_tokens_all_models).toBe("number");
    expect(final.summary.total_tokens_all_models).toBeGreaterThanOrEqual(0);
    expect(typeof final.summary.total_turns_all_models).toBe("number");
    expect(final.summary.total_turns_all_models).toBeGreaterThanOrEqual(0);
    expect(typeof final.summary.wall_time_seconds).toBe("number");
    expect(final.summary.wall_time_seconds).toBeGreaterThanOrEqual(0);
  });

  it("completed model appears in summary.completed_models", async () => {
    await runMonitorAndWait(sessionDir, ["final-slug"]);

    const finalPath = join(sessionDir, "monitor-final.json");
    const text = await Bun.file(finalPath).text();
    const final: MonitorFinal = JSON.parse(text);

    expect(final.summary.all_completed).toBe(true);
    expect(final.summary.completed_models).toContain("final-slug");
  });
});

// ---------------------------------------------------------------------------
// TEST-C05: poll_count increments on each poll cycle
// ---------------------------------------------------------------------------

describe("TEST-C05: poll_count increments on each poll cycle", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["poll-slug"]);
    // No exit file — monitor will run multiple poll cycles until timeout
    writeDebugLog(sessionDir, "poll-slug", makeCompleteTurn());
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("poll_count is at least 2 when monitor runs for >2 poll intervals", async () => {
    // Run with 3s timeout, 600ms poll interval -> at least 4 polls
    await runMonitorAndWait(sessionDir, ["poll-slug"], 3, 600);

    const statusPath = join(sessionDir, "monitor-status.json");
    expect(existsSync(statusPath)).toBe(true);

    const text = await Bun.file(statusPath).text();
    const status: MonitorStatus = JSON.parse(text);

    // After 3 seconds with 600ms poll, should have >= 2 polls
    expect(status.poll_count).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// TEST-C06: generated_at is a valid ISO-8601 timestamp
// ---------------------------------------------------------------------------

describe("TEST-C06: generated_at is a valid ISO-8601 timestamp", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["ts-slug"]);
    writeDebugLog(sessionDir, "ts-slug", makeCompleteTurn());
    writeExitCode(sessionDir, "ts-slug", 0);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("generated_at parses as a valid ISO-8601 date within reasonable range", async () => {
    const beforeRun = Date.now();
    await runMonitorAndWait(sessionDir, ["ts-slug"]);
    const afterRun = Date.now();

    const statusPath = join(sessionDir, "monitor-status.json");
    const text = await Bun.file(statusPath).text();
    const status: MonitorStatus = JSON.parse(text);

    expect(typeof status.generated_at).toBe("string");
    const d = new Date(status.generated_at);
    expect(isNaN(d.getTime())).toBe(false);
    // Timestamp should be within the test run window (with some margin)
    expect(d.getTime()).toBeGreaterThanOrEqual(beforeRun - 5000);
    expect(d.getTime()).toBeLessThanOrEqual(afterRun + 5000);
  });
});
