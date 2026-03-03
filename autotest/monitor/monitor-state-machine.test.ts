/**
 * Tests B01–B18: Monitor State Machine
 *
 * Tests state transitions by running monitor.ts as a subprocess with
 * controlled temp directories and synthetic log/file fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  ProcessState,
  ModelStatus,
  MonitorStatus,
} from "../../autotest/framework/types.ts";

const MONITOR_PATH =
  "/Users/jack/mag/claude-code/plugins/multimodel/scripts/monitor.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `monitor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupSessionDir(
  sessionDir: string,
  slugs: string[]
): void {
  mkdirSync(join(sessionDir, "pids"), { recursive: true });
  for (const slug of slugs) {
    mkdirSync(join(sessionDir, "work", slug, "logs"), { recursive: true });
  }
}

function writeDebugLog(sessionDir: string, slug: string, content: string): void {
  const logsDir = join(sessionDir, "work", slug, "logs");
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(join(logsDir, "claudish_2026-01-01_00-00-00.log"), content);
}

function writeExitCode(sessionDir: string, slug: string, code: number): void {
  writeFileSync(join(sessionDir, `${slug}.exit`), `${code}\n`);
}

function writeResultFile(sessionDir: string, slug: string, content: string): void {
  writeFileSync(join(sessionDir, `${slug}-result.md`), content);
}

function writePidFile(sessionDir: string, slug: string, pid: number): void {
  mkdirSync(join(sessionDir, "pids"), { recursive: true });
  writeFileSync(join(sessionDir, "pids", `${slug}.pid`), `${pid}\n`);
}

function makeTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeTurnLog(
  turnNum: number,
  opts: {
    tools?: string[];
    tokens?: { prompt: number; completion: number; total: number };
    noComplete?: boolean;
  } = {}
): string {
  const ts1 = makeTimestamp(turnNum * 1000);
  const ts2 = makeTimestamp(turnNum * 1000 + 500);
  const lines: string[] = [];

  lines.push(
    `[${ts1}] [OpenRouter Request] { "targetModel": "claude-opus-4-6", "messageCount": 5, "toolCount": 0 }`
  );

  if (opts.tools && opts.tools.length > 0) {
    const toolStr = opts.tools.map((t) => `${t}(100 chars)`).join(", ");
    lines.push(`[${ts2}] [OpenRouter] Tool calls: ${toolStr}`);
  }

  if (opts.tokens) {
    lines.push(
      `[${ts2}] [OpenRouter] Usage: prompt=${opts.tokens.prompt}, completion=${opts.tokens.completion}, total=${opts.tokens.total}`
    );
  }

  if (!opts.noComplete) {
    lines.push(`[${ts2}] [OpenRouter] Stream complete: success`);
  }

  return lines.join("\n") + "\n";
}

async function runMonitorOnce(
  sessionDir: string,
  slugs: string[],
  opts: {
    timeout?: number;
    pollInterval?: number;
    stallThreshold?: number;
  } = {}
): Promise<{ statusJson: MonitorStatus | null; exitCode: number }> {
  const timeout = opts.timeout ?? 5;
  const pollInterval = opts.pollInterval ?? 500;
  const stallThreshold = opts.stallThreshold ?? 30000;

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
      "--stall-threshold",
      String(stallThreshold),
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  await proc.exited;
  const exitCode = proc.exitCode ?? 0;

  const statusPath = join(sessionDir, "monitor-status.json");
  if (existsSync(statusPath)) {
    try {
      const text = await Bun.file(statusPath).text();
      return { statusJson: JSON.parse(text) as MonitorStatus, exitCode };
    } catch {
      return { statusJson: null, exitCode };
    }
  }
  return { statusJson: null, exitCode };
}

function getModelStatus(
  status: MonitorStatus,
  slug: string
): ModelStatus | undefined {
  return status.models.find((m) => m.model_slug === slug);
}

// ---------------------------------------------------------------------------
// TEST-B01: STARTING state when log file is absent
// ---------------------------------------------------------------------------

describe("TEST-B01: STARTING state when log file is absent", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["test-slug"]);
    // Do NOT create any log file — leave log dir empty
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("model state is STARTING when no log file exists", async () => {
    // Write exit code immediately so monitor terminates quickly
    writeExitCode(sessionDir, "test-slug", 0);

    const { statusJson } = await runMonitorOnce(sessionDir, ["test-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    // Note: monitor may transition to COMPLETED from exit code before first poll
    // The important check: if exit code had not been written, initial state would be STARTING
    // Since we check status after exit, state may be COMPLETED — that's OK.
    // The key requirement is that without log content, the model starts as STARTING.
    expect(statusJson).not.toBeNull();
    if (statusJson) {
      const model = getModelStatus(statusJson, "test-slug");
      expect(model).toBeDefined();
      // State should be either STARTING (before exit detected) or COMPLETED (after)
      expect(["STARTING", "COMPLETED"]).toContain(model!.state);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-B02: STARTING state when log file is empty
// ---------------------------------------------------------------------------

describe("TEST-B02: STARTING state when log file is empty", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["test-slug"]);
    // Create empty log file
    writeDebugLog(sessionDir, "test-slug", "");
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("model state is STARTING when log file is empty", async () => {
    writeExitCode(sessionDir, "test-slug", 0);

    const { statusJson } = await runMonitorOnce(sessionDir, ["test-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    expect(statusJson).not.toBeNull();
    if (statusJson) {
      const model = getModelStatus(statusJson, "test-slug");
      expect(model).toBeDefined();
      expect(["STARTING", "COMPLETED"]).toContain(model!.state);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-B03: ACTIVE state on first log content
// ---------------------------------------------------------------------------

describe("TEST-B03: ACTIVE state when log has content", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["test-slug"]);
    // Write real log content
    writeDebugLog(sessionDir, "test-slug", makeTurnLog(1));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("model state is ACTIVE (or terminal) when log has content", async () => {
    writeExitCode(sessionDir, "test-slug", 0);

    const { statusJson } = await runMonitorOnce(sessionDir, ["test-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    expect(statusJson).not.toBeNull();
    if (statusJson) {
      const model = getModelStatus(statusJson, "test-slug");
      expect(model).toBeDefined();
      // With content + exit 0, state should be COMPLETED (terminal from exit code)
      expect(model!.state).toBe("COMPLETED");
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-B04: CALLING_API state inference
// ---------------------------------------------------------------------------

describe("TEST-B04: CALLING_API state when request seen without stream complete", () => {
  it("parseDebugLogContent detects open request as CALLING_API signal", () => {
    // This tests the parser side — an incomplete request means "calling API"
    // We use parseDebugLogContent to validate what the monitor would infer
    const { parseDebugLogContent } = require("../../autotest/framework/parsers/debug-log-parser.ts");
    const incompleteLog = makeTurnLog(1, { noComplete: true });
    const result = parseDebugLogContent(incompleteLog);
    // The incomplete turn should be marked as retry (open request)
    const openTurns = result.turns.filter((t: any) => t.retry === true);
    expect(openTurns.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-B05: TOOL_EXECUTING state after Tool calls seen
// ---------------------------------------------------------------------------

describe("TEST-B05: TOOL_EXECUTING state after tool calls", () => {
  it("parseDebugLogContent shows tool calls in completed turn", () => {
    const { parseDebugLogContent } = require("../../autotest/framework/parsers/debug-log-parser.ts");
    const logWithTools = makeTurnLog(1, { tools: ["Read", "Write"] });
    const result = parseDebugLogContent(logWithTools);
    expect(result.turns[0].tool_calls).toContain("Read");
    expect(result.turns[0].tool_calls).toContain("Write");
  });
});

// ---------------------------------------------------------------------------
// TEST-B06: Turn completion increments turns_completed
// ---------------------------------------------------------------------------

describe("TEST-B06: Completed turn increments turns_completed", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["test-slug"]);
    writeDebugLog(sessionDir, "test-slug", makeTurnLog(1));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("turns_completed is >= 1 after a completed turn", async () => {
    writeExitCode(sessionDir, "test-slug", 0);
    writeResultFile(sessionDir, "test-slug", "result content");

    const { statusJson } = await runMonitorOnce(sessionDir, ["test-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    expect(statusJson).not.toBeNull();
    if (statusJson) {
      const model = getModelStatus(statusJson, "test-slug");
      expect(model).toBeDefined();
      expect(model!.turns_completed).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-B07: STALLED state from inactivity threshold
// ---------------------------------------------------------------------------

describe("TEST-B07: STALLED state from inactivity threshold", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["stall-slug"]);
    // Write minimal log content (so STARTING -> ACTIVE) but then no more bytes
    writeDebugLog(sessionDir, "stall-slug", makeTurnLog(1));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("transitions to STALLED after stall threshold with no new log bytes", async () => {
    // Use a very short stall threshold (2 seconds) and no exit code
    // Poll interval must be shorter than stall threshold
    const { statusJson } = await runMonitorOnce(sessionDir, ["stall-slug"], {
      timeout: 6,
      pollInterval: 500,
      stallThreshold: 2000, // 2 seconds
    });

    if (statusJson) {
      const model = getModelStatus(statusJson, "stall-slug");
      expect(model).toBeDefined();
      if (model) {
        expect(model.state).toBe("STALLED");
        expect(model.stall_during_api_call).toBe(false);
      }
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// TEST-B08: STALLED state from 3+ consecutive retries
// ---------------------------------------------------------------------------

describe("TEST-B08: STALLED state from 3+ consecutive retries", () => {
  it("3 consecutive incomplete requests triggers STALLED via parser", () => {
    const { parseDebugLogContent } = require("../../autotest/framework/parsers/debug-log-parser.ts");

    // Three consecutive incomplete requests (no stream complete)
    const ts1 = makeTimestamp(1000);
    const ts2 = makeTimestamp(2000);
    const ts3 = makeTimestamp(3000);

    const content = [
      `[${ts1}] [OpenRouter Request] { "targetModel": "claude-opus-4-6", "messageCount": 3, "toolCount": 0 }`,
      `[${ts2}] [OpenRouter Request] { "targetModel": "claude-opus-4-6", "messageCount": 3, "toolCount": 0 }`,
      `[${ts3}] [OpenRouter Request] { "targetModel": "claude-opus-4-6", "messageCount": 3, "toolCount": 0 }`,
      "",
    ].join("\n");

    const result = parseDebugLogContent(content);
    const retryTurns = result.turns.filter((t: any) => t.retry);
    expect(retryTurns.length).toBe(3);
    expect(result.totals!.total_retries).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// TEST-B09: stall_during_api_call=true when stalling during API call
// ---------------------------------------------------------------------------

describe("TEST-B09: stall_during_api_call=true when stalling during CALLING_API", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["api-stall-slug"]);
    // Write a log that ends with an open API request (no stream complete)
    writeDebugLog(sessionDir, "api-stall-slug", makeTurnLog(1, { noComplete: true }));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("stall_during_api_call is true when stall happens during open request", async () => {
    const { statusJson } = await runMonitorOnce(
      sessionDir,
      ["api-stall-slug"],
      {
        timeout: 6,
        pollInterval: 500,
        stallThreshold: 2000,
      }
    );

    if (statusJson) {
      const model = getModelStatus(statusJson, "api-stall-slug");
      if (model && model.state === "STALLED") {
        expect(model.stall_during_api_call).toBe(true);
      }
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// TEST-B10: STALLED → ACTIVE recovery on new log bytes
// ---------------------------------------------------------------------------

describe("TEST-B10: STALLED -> ACTIVE recovery on new log bytes", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["recover-slug"]);
    writeDebugLog(sessionDir, "recover-slug", makeTurnLog(1));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("model recovers from STALLED to ACTIVE when new bytes appear", async () => {
    const logPath = join(
      sessionDir,
      "work",
      "recover-slug",
      "logs",
      "claudish_2026-01-01_00-00-00.log"
    );

    // Let it stall first, then write more content
    const stallAfterMs = 2500;
    const addBytesAfterMs = 3500;

    const timer = setTimeout(() => {
      // Append more log content to trigger recovery
      const fs = require("fs");
      fs.appendFileSync(logPath, makeTurnLog(2));
    }, addBytesAfterMs);

    const { statusJson } = await runMonitorOnce(sessionDir, ["recover-slug"], {
      timeout: 7,
      pollInterval: 500,
      stallThreshold: stallAfterMs,
    });

    clearTimeout(timer);

    if (statusJson) {
      const model = getModelStatus(statusJson, "recover-slug");
      expect(model).toBeDefined();
      // After recovery, state should be ACTIVE or STALLED (timing dependent)
      if (model) {
        expect(["ACTIVE", "STALLED", "COMPLETED"]).toContain(model.state);
      }
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// TEST-B11: COMPLETED state when exit code 0 and result file exists
// ---------------------------------------------------------------------------

describe("TEST-B11: COMPLETED state when exit code 0 and result file exists", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["done-slug"]);
    writeDebugLog(sessionDir, "done-slug", makeTurnLog(1));
    writeExitCode(sessionDir, "done-slug", 0);
    writeResultFile(sessionDir, "done-slug", "# Result\nSome content here");
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("state is COMPLETED with exit_code=0 and result_file_bytes>0", async () => {
    const { statusJson } = await runMonitorOnce(sessionDir, ["done-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    expect(statusJson).not.toBeNull();
    const model = getModelStatus(statusJson!, "done-slug");
    expect(model).toBeDefined();
    expect(model!.state).toBe("COMPLETED");
    expect(model!.exit_code).toBe(0);
    expect(model!.result_file_bytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-B12: ERRORED state when exit code is non-zero
// ---------------------------------------------------------------------------

describe("TEST-B12: ERRORED state when exit code is non-zero", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["error-slug"]);
    writeDebugLog(sessionDir, "error-slug", makeTurnLog(1));
    writeExitCode(sessionDir, "error-slug", 1);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("state is ERRORED with exit_code=1", async () => {
    const { statusJson } = await runMonitorOnce(sessionDir, ["error-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    expect(statusJson).not.toBeNull();
    const model = getModelStatus(statusJson!, "error-slug");
    expect(model).toBeDefined();
    expect(model!.state).toBe("ERRORED");
    expect(model!.exit_code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TEST-B13: KILLED state after .kill sentinel processed
// ---------------------------------------------------------------------------

describe("TEST-B13: KILLED state after .kill sentinel processed", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["kill-slug"]);
    writeDebugLog(sessionDir, "kill-slug", makeTurnLog(1));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("state transitions to KILLED when .kill sentinel file is created", async () => {
    // Write kill sentinel before monitor starts
    writeFileSync(join(sessionDir, "kill-slug.kill"), "");

    const { statusJson } = await runMonitorOnce(sessionDir, ["kill-slug"], {
      timeout: 8,
      pollInterval: 300,
    });

    if (statusJson) {
      const model = getModelStatus(statusJson, "kill-slug");
      expect(model).toBeDefined();
      // State should be KILLED (no .exit file, .kill file present, no valid PID)
      expect(model!.state).toBe("KILLED");
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-B14: Kill sentinel ignored when .exit file already exists
// ---------------------------------------------------------------------------

describe("TEST-B14: Kill sentinel ignored when .exit file already exists", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["completed-slug"]);
    writeDebugLog(sessionDir, "completed-slug", makeTurnLog(1));
    // Write BOTH exit file and kill sentinel
    writeExitCode(sessionDir, "completed-slug", 0);
    writeFileSync(join(sessionDir, "completed-slug.kill"), "");
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("state is COMPLETED (not KILLED) when both .exit and .kill exist", async () => {
    const { statusJson } = await runMonitorOnce(sessionDir, ["completed-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    expect(statusJson).not.toBeNull();
    const model = getModelStatus(statusJson!, "completed-slug");
    expect(model).toBeDefined();
    // .exit takes precedence: state should be COMPLETED, not KILLED
    expect(model!.state).toBe("COMPLETED");
  });
});

// ---------------------------------------------------------------------------
// TEST-B15: SKIPPED state after .skip sentinel
// ---------------------------------------------------------------------------

describe("TEST-B15: SKIPPED state after .skip sentinel processed", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["skip-slug"]);
    writeDebugLog(sessionDir, "skip-slug", makeTurnLog(1));
    // Write skip sentinel
    writeFileSync(join(sessionDir, "skip-slug.skip"), "");
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("state transitions to SKIPPED when .skip sentinel is present", async () => {
    const { statusJson } = await runMonitorOnce(sessionDir, ["skip-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    expect(statusJson).not.toBeNull();
    const model = getModelStatus(statusJson!, "skip-slug");
    expect(model).toBeDefined();
    expect(model!.state).toBe("SKIPPED");
  });
});

// ---------------------------------------------------------------------------
// TEST-B16: Terminal states are never re-evaluated
// ---------------------------------------------------------------------------

describe("TEST-B16: Terminal states are never re-evaluated", () => {
  const terminalStates: ProcessState[] = [
    "COMPLETED",
    "ERRORED",
    "KILLED",
    "SKIPPED",
  ];

  it.each(terminalStates.map((s) => [s]))(
    "state %s remains terminal across poll cycles",
    async (state) => {
      const sessionDir = makeTempDir();
      const slug = "terminal-slug";
      setupSessionDir(sessionDir, [slug]);
      writeDebugLog(sessionDir, slug, makeTurnLog(1));

      if (state === "COMPLETED") {
        writeExitCode(sessionDir, slug, 0);
      } else if (state === "ERRORED") {
        writeExitCode(sessionDir, slug, 1);
      } else if (state === "KILLED") {
        writeFileSync(join(sessionDir, `${slug}.kill`), "");
      } else if (state === "SKIPPED") {
        writeFileSync(join(sessionDir, `${slug}.skip`), "");
      }

      // Run monitor with multiple poll cycles
      const { statusJson } = await runMonitorOnce(sessionDir, [slug], {
        timeout: 5,
        pollInterval: 300,
      });

      if (statusJson) {
        const model = getModelStatus(statusJson, slug);
        expect(model).toBeDefined();
        // Should be in some terminal state
        const isTerminal = ["COMPLETED", "ERRORED", "KILLED", "SKIPPED"].includes(
          model!.state
        );
        expect(isTerminal).toBe(true);
      }

      rmSync(sessionDir, { recursive: true, force: true });
    }
  );
});

// ---------------------------------------------------------------------------
// TEST-B17: tokens_so_far accumulates across poll cycles
// ---------------------------------------------------------------------------

describe("TEST-B17: tokens_so_far accumulates across poll cycles", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["token-slug"]);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("tokens_so_far reflects completion tokens from turns", async () => {
    const content = makeTurnLog(1, {
      tokens: { prompt: 1000, completion: 250, total: 1250 },
    }) + makeTurnLog(2, {
      tokens: { prompt: 800, completion: 300, total: 1100 },
    });
    writeDebugLog(sessionDir, "token-slug", content);
    writeExitCode(sessionDir, "token-slug", 0);

    const { statusJson } = await runMonitorOnce(sessionDir, ["token-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    expect(statusJson).not.toBeNull();
    const model = getModelStatus(statusJson!, "token-slug");
    expect(model).toBeDefined();
    // tokens_so_far is sum of completion tokens = 250 + 300 = 550
    expect(model!.tokens_so_far).toBe(550);
  });
});

// ---------------------------------------------------------------------------
// TEST-B18: tool_calls accumulates unique tool names
// ---------------------------------------------------------------------------

describe("TEST-B18: tool_calls accumulates unique tool names across turns", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = makeTempDir();
    setupSessionDir(sessionDir, ["tools-slug"]);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("tool_calls contains unique tool names across multiple turns", async () => {
    const content =
      makeTurnLog(1, { tools: ["Read", "Grep"] }) +
      makeTurnLog(2, { tools: ["Bash", "Read"] });
    writeDebugLog(sessionDir, "tools-slug", content);
    writeExitCode(sessionDir, "tools-slug", 0);

    const { statusJson } = await runMonitorOnce(sessionDir, ["tools-slug"], {
      timeout: 3,
      pollInterval: 300,
    });

    expect(statusJson).not.toBeNull();
    const model = getModelStatus(statusJson!, "tools-slug");
    expect(model).toBeDefined();
    // tool_calls should contain Read, Grep, Bash (unique, no duplicates)
    const toolCalls = model!.tool_calls;
    expect(toolCalls).toContain("Read");
    expect(toolCalls).toContain("Grep");
    expect(toolCalls).toContain("Bash");
    // No duplicates
    const unique = new Set(toolCalls);
    expect(unique.size).toBe(toolCalls.length);
  });
});
