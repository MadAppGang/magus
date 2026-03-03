#!/usr/bin/env bun
/**
 * monitor.ts - claudish process observability monitor.
 *
 * Co-launched alongside external model claudish processes during /team runs.
 * Polls per-model debug logs, infers process state, detects stalls, handles
 * kill/skip sentinels, and writes live status to monitor-status.json.
 *
 * Usage:
 *   bun monitor.ts --session-dir <path> --models <slug1,slug2,...> --timeout <seconds>
 */

import {
  existsSync,
  readdirSync,
  statSync,
  renameSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { parseArgs } from "util";
import { parseDebugLogContent } from "../../../autotest/framework/parsers/debug-log-parser.ts";
import type {
  ProcessState,
  ModelStatus,
  MonitorStatus,
  MonitorFinal,
} from "../../../autotest/framework/types.ts";

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3000;
const STALL_THRESHOLD_MS = 30_000;
const RETRY_STALL_COUNT = 3;
const KILL_GRACE_MS = 5000;
const PROGRESS_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// Internal state type (mutable, per-model tracking)
// ---------------------------------------------------------------------------

interface MonitorState {
  state: ProcessState;
  byteOffset: number;
  partialLineBuffer: string;
  lastActivityTime: number | null;
  firstActivityTime: number | null;
  turnsCompleted: number;
  retries: number;
  consecutiveRetries: number;
  tokensSoFar: number;
  toolCalls: Set<string>;
  pid: number | null;
  inApiCall: boolean;
  stall_during_api_call: boolean;
  exit_code: number | null;
  error_message: string | null;
  debugLogPath: string;
  killHandled: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTerminal(state: ProcessState): boolean {
  return (
    state === "COMPLETED" ||
    state === "ERRORED" ||
    state === "KILLED" ||
    state === "SKIPPED"
  );
}

function readPidFileSync(sessionDir: string, slug: string): number | null {
  const pidPath = join(sessionDir, "pids", `${slug}.pid`);
  if (!existsSync(pidPath)) return null;
  try {
    const content = readFileSync(pidPath, "utf-8").trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function readFileTextSync(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function findDebugLog(sessionDir: string, slug: string): string {
  const logsDir = join(sessionDir, "work", slug, "logs");
  if (!existsSync(logsDir)) return "";
  try {
    const entries = readdirSync(logsDir)
      .filter((f: string) => f.startsWith("claudish_") && f.endsWith(".log"))
      .map((f: string) => {
        const fullPath = join(logsDir, f);
        const st = statSync(fullPath);
        return { path: fullPath, mtime: st.mtimeMs };
      })
      .sort(
        (a: { path: string; mtime: number }, b: { path: string; mtime: number }) =>
          b.mtime - a.mtime
      ); // Most recently modified first
    return entries.length > 0 ? entries[0].path : "";
  } catch {
    return "";
  }
}

interface ReadResult {
  content: string;
  newOffset: number;
  newPartialBuffer: string;
}

async function readNewBytes(
  logPath: string,
  offset: number,
  partialBuffer: string
): Promise<ReadResult> {
  if (!logPath || !existsSync(logPath)) {
    return { content: "", newOffset: offset, newPartialBuffer: partialBuffer };
  }

  try {
    const file = Bun.file(logPath);
    const size = file.size;
    if (size <= offset) {
      return {
        content: "",
        newOffset: offset,
        newPartialBuffer: partialBuffer,
      };
    }

    const newChunk = await file.slice(offset, size).text();
    const combined = partialBuffer + newChunk;

    // Buffer incomplete last line — hold it for the next read
    let newPartialBuffer = "";
    let content = combined;
    if (!combined.endsWith("\n")) {
      const lastNewline = combined.lastIndexOf("\n");
      if (lastNewline >= 0) {
        content = combined.slice(0, lastNewline + 1);
        newPartialBuffer = combined.slice(lastNewline + 1);
      } else {
        // No newline at all — entire chunk is a partial line, buffer it all
        content = "";
        newPartialBuffer = combined;
      }
    }

    return { content, newOffset: size, newPartialBuffer };
  } catch {
    return { content: "", newOffset: offset, newPartialBuffer: partialBuffer };
  }
}

function inferStateFromMetrics(
  modelState: MonitorState,
  content: string
): void {
  const metrics = parseDebugLogContent(content);
  const { turns } = metrics;
  if (turns.length === 0) return;

  for (const turn of turns) {
    if (turn.retry) {
      modelState.retries++;
      modelState.consecutiveRetries++;
    } else {
      // Completed turn
      modelState.turnsCompleted++;
      modelState.consecutiveRetries = 0;
      modelState.inApiCall = false;

      // Accumulate completion tokens
      if (turn.tokens) {
        modelState.tokensSoFar += turn.tokens.completion;
      }
    }

    // Accumulate tool names
    for (const tool of turn.tool_calls) {
      modelState.toolCalls.add(tool);
    }
  }

  // State inference from last turn in chunk
  const lastTurn = turns[turns.length - 1];

  if (!lastTurn.retry) {
    // Completed turn — back to ACTIVE awaiting next turn or exit
    if (!isTerminal(modelState.state)) {
      modelState.state = "ACTIVE";
    }
  } else {
    // Incomplete / open request
    if (lastTurn.tool_calls && lastTurn.tool_calls.length > 0) {
      modelState.state = "TOOL_EXECUTING";
      modelState.inApiCall = false;
    } else {
      modelState.state = "CALLING_API";
      modelState.inApiCall = true;
    }
  }

  // Consecutive retries stall
  if (modelState.consecutiveRetries >= RETRY_STALL_COUNT) {
    if (!isTerminal(modelState.state)) {
      if (modelState.inApiCall) modelState.stall_during_api_call = true;
      modelState.state = "STALLED";
    }
  }
}

async function checkExitCode(
  sessionDir: string,
  slug: string,
  modelState: MonitorState
): Promise<void> {
  if (isTerminal(modelState.state)) return;

  const exitPath = join(sessionDir, `${slug}.exit`);
  if (!existsSync(exitPath)) return;

  const raw = readFileTextSync(exitPath);
  if (raw === null) return;

  const code = parseInt(raw.trim(), 10);
  if (isNaN(code)) return;

  modelState.exit_code = code;

  if (code === 0) {
    modelState.state = "COMPLETED";
  } else {
    modelState.state = "ERRORED";
    const stderrPath = join(sessionDir, `${slug}-stderr.log`);
    const stderr = readFileTextSync(stderrPath);
    if (stderr && stderr.trim()) {
      modelState.error_message = stderr.trim().slice(0, 500);
    } else {
      modelState.error_message = `Process exited with code ${code}`;
    }
  }
}

async function checkSentinels(
  sessionDir: string,
  slug: string,
  modelState: MonitorState
): Promise<void> {
  if (isTerminal(modelState.state)) return;

  // Skip sentinel takes effect immediately (no kill)
  const skipPath = join(sessionDir, `${slug}.skip`);
  if (existsSync(skipPath)) {
    modelState.state = "SKIPPED";
    return;
  }

  // Kill sentinel
  const killPath = join(sessionDir, `${slug}.kill`);
  if (!existsSync(killPath)) return;

  // Precedence: if .exit already exists, process completed naturally — ignore kill
  const exitPath = join(sessionDir, `${slug}.exit`);
  if (existsSync(exitPath)) return;

  // Only handle kill once per lifecycle
  if (modelState.killHandled) return;
  modelState.killHandled = true;

  // Refresh PID
  let pid = modelState.pid ?? readPidFileSync(sessionDir, slug);
  modelState.pid = pid;

  if (pid === null) {
    modelState.state = "KILLED";
    modelState.exit_code = 130;
    modelState.error_message = "Kill sentinel found but no PID available";
    try {
      await Bun.write(exitPath, "130\n");
    } catch {
      // Ignore write errors
    }
    return;
  }

  // Validate process exists (signal 0)
  let processExists = false;
  try {
    process.kill(pid, 0);
    processExists = true;
  } catch {
    processExists = false;
  }

  if (!processExists) {
    // Already gone
    modelState.state = "KILLED";
    modelState.exit_code = 130;
    if (!existsSync(exitPath)) {
      try {
        await Bun.write(exitPath, "130\n");
      } catch {
        // Ignore
      }
    }
    return;
  }

  // Send SIGTERM
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[monitor] Sent SIGTERM to ${slug} (pid=${pid})`);
  } catch (e) {
    console.error(`[monitor] Failed SIGTERM for ${slug}: ${e}`);
  }

  // Grace period
  await Bun.sleep(KILL_GRACE_MS);

  // Check if still alive
  let stillAlive = false;
  try {
    process.kill(pid, 0);
    stillAlive = true;
  } catch {
    stillAlive = false;
  }

  if (stillAlive) {
    try {
      process.kill(pid, "SIGKILL");
      console.log(`[monitor] Sent SIGKILL to ${slug} (pid=${pid})`);
    } catch (e) {
      console.error(`[monitor] Failed SIGKILL for ${slug}: ${e}`);
    }
  }

  // Write exit code 130
  if (!existsSync(exitPath)) {
    try {
      await Bun.write(exitPath, "130\n");
    } catch {
      // Ignore
    }
  }

  modelState.state = "KILLED";
  modelState.exit_code = 130;
}

function checkStall(
  modelState: MonitorState,
  now: number,
  stallThresholdMs: number
): void {
  if (isTerminal(modelState.state)) return;

  // Consecutive retry stall
  if (modelState.consecutiveRetries >= RETRY_STALL_COUNT) {
    if (modelState.inApiCall) modelState.stall_during_api_call = true;
    modelState.state = "STALLED";
    return;
  }

  if (modelState.lastActivityTime === null) return;

  const inactive = now - modelState.lastActivityTime;
  if (inactive > stallThresholdMs) {
    if (modelState.inApiCall) modelState.stall_during_api_call = true;
    modelState.state = "STALLED";
  }
}

function getResultFileBytes(sessionDir: string, slug: string): number {
  const resultPath = join(sessionDir, `${slug}-result.md`);
  if (!existsSync(resultPath)) return 0;
  try {
    return statSync(resultPath).size;
  } catch {
    return 0;
  }
}

function buildModelStatus(
  slug: string,
  modelState: MonitorState,
  sessionDir: string,
  now: number
): ModelStatus {
  const elapsedSec =
    modelState.firstActivityTime !== null
      ? (now - modelState.firstActivityTime) / 1000
      : 0;

  const lastActivitySecondsAgo =
    modelState.lastActivityTime !== null
      ? (now - modelState.lastActivityTime) / 1000
      : 0;

  return {
    model_id: slug,
    model_slug: slug,
    state: modelState.state,
    turns_completed: modelState.turnsCompleted,
    retries: modelState.retries,
    consecutive_retries: modelState.consecutiveRetries,
    tokens_so_far: modelState.tokensSoFar,
    tool_calls: [...modelState.toolCalls],
    elapsed_seconds: Math.round(elapsedSec * 10) / 10,
    last_activity_seconds_ago: Math.round(lastActivitySecondsAgo * 10) / 10,
    stall_during_api_call: modelState.stall_during_api_call,
    pid: modelState.pid,
    exit_code: modelState.exit_code,
    result_file_bytes: getResultFileBytes(sessionDir, slug),
    debug_log_path: modelState.debugLogPath,
    error_message: modelState.error_message,
  };
}

function buildMonitorStatus(
  sessionId: string,
  models: Map<string, MonitorState>,
  slugs: string[],
  sessionDir: string,
  startTime: number,
  timeoutSec: number,
  pollCount: number,
  now: number
): MonitorStatus {
  const modelStatuses: ModelStatus[] = slugs.map((slug) =>
    buildModelStatus(slug, models.get(slug)!, sessionDir, now)
  );

  return {
    session_id: sessionId,
    generated_at: new Date(now).toISOString(),
    elapsed_seconds: Math.round((now - startTime) / 100) / 10,
    timeout_seconds: timeoutSec,
    poll_count: pollCount,
    models: modelStatuses,
  };
}

async function writeStatusAtomic(
  sessionDir: string,
  status: MonitorStatus
): Promise<void> {
  const tmpPath = join(sessionDir, "monitor-status.json.tmp");
  const finalPath = join(sessionDir, "monitor-status.json");
  try {
    await Bun.write(tmpPath, JSON.stringify(status, null, 2) + "\n");
    renameSync(tmpPath, finalPath);
  } catch (e) {
    console.error(`[monitor] Failed to write status: ${e}`);
  }
}

async function writeFinalStatus(
  sessionDir: string,
  sessionId: string,
  models: Map<string, MonitorState>,
  slugs: string[],
  startTime: number,
  timeoutSec: number,
  pollCount: number
): Promise<void> {
  const now = Date.now();
  const base = buildMonitorStatus(
    sessionId,
    models,
    slugs,
    sessionDir,
    startTime,
    timeoutSec,
    pollCount,
    now
  );

  const completedSlugs = slugs.filter(
    (s) => models.get(s)!.state === "COMPLETED"
  );
  const stalledSlugs = slugs.filter((s) => models.get(s)!.state === "STALLED");
  const erroredSlugs = slugs.filter((s) => models.get(s)!.state === "ERRORED");
  const killedSlugs = slugs.filter((s) => models.get(s)!.state === "KILLED");
  const skippedSlugs = slugs.filter((s) => models.get(s)!.state === "SKIPPED");

  const totalTokens = slugs.reduce(
    (sum, s) => sum + models.get(s)!.tokensSoFar,
    0
  );
  const totalTurns = slugs.reduce(
    (sum, s) => sum + models.get(s)!.turnsCompleted,
    0
  );

  const final: MonitorFinal = {
    ...base,
    summary: {
      all_completed: completedSlugs.length === slugs.length,
      completed_models: completedSlugs,
      stalled_models: stalledSlugs,
      errored_models: erroredSlugs,
      killed_models: killedSlugs,
      skipped_models: skippedSlugs,
      total_tokens_all_models: totalTokens,
      total_turns_all_models: totalTurns,
      wall_time_seconds: Math.round((now - startTime) / 100) / 10,
    },
  };

  const finalPath = join(sessionDir, "monitor-final.json");
  try {
    await Bun.write(finalPath, JSON.stringify(final, null, 2) + "\n");
  } catch (e) {
    console.error(`[monitor] Failed to write final status: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Progress emission (stdout)
// ---------------------------------------------------------------------------

function emitProgress(
  models: Map<string, MonitorState>,
  slugs: string[],
  startTime: number,
  now: number
): void {
  const elapsed = Math.round((now - startTime) / 1000);
  const lines: string[] = [`[t=${elapsed}s] Model status:`];
  const maxSlugLen = Math.max(...slugs.map((s) => s.length));

  for (const slug of slugs) {
    const ms = models.get(slug)!;
    const statePadded = ms.state.padEnd(14);
    const tools =
      ms.toolCalls.size > 0
        ? `tools=[${[...ms.toolCalls].join(",")}]`
        : "tools=[]";
    const stalledNote =
      ms.state === "STALLED" && ms.lastActivityTime !== null
        ? ` (no activity for ${Math.round((now - ms.lastActivityTime) / 1000)}s)`
        : "";
    lines.push(
      `  ${slug.padEnd(maxSlugLen)} : ${statePadded} turn=${ms.turnsCompleted}  tokens=${ms.tokensSoFar}  ${tools}${stalledNote}`
    );
  }

  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "session-dir": { type: "string" },
      models: { type: "string" },
      timeout: { type: "string", default: "180" },
      "poll-interval": { type: "string" },
      "stall-threshold": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help || !values["session-dir"] || !values.models) {
    console.log(
      "Usage: bun monitor.ts --session-dir <path> --models <slug1,slug2,...> --timeout <seconds>"
    );
    console.log("");
    console.log("Options:");
    console.log("  --session-dir <path>      Session directory path (required)");
    console.log(
      "  --models <slug1,slug2>    Comma-separated model slugs (required)"
    );
    console.log("  --timeout <seconds>       Maximum wait time (default: 180)");
    console.log(
      "  --poll-interval <ms>      Poll interval ms (default: 3000)"
    );
    console.log(
      "  --stall-threshold <ms>    Stall threshold ms (default: 30000)"
    );
    process.exit(values.help ? 0 : 1);
  }

  const sessionDir = values["session-dir"]!;
  const slugs = values
    .models!.split(",")
    .map((s: string) => s.trim())
    .filter(Boolean) as string[];
  const timeoutSec = parseInt(values.timeout!, 10) || 180;
  const pollIntervalMs =
    parseInt(values["poll-interval"] ?? "", 10) || POLL_INTERVAL_MS;
  const stallThresholdMs =
    parseInt(values["stall-threshold"] ?? "", 10) || STALL_THRESHOLD_MS;

  // Session ID from directory basename
  const sessionId = sessionDir.split("/").pop() ?? sessionDir;

  // Initialize per-model state
  const models = new Map<string, MonitorState>();
  for (const slug of slugs) {
    models.set(slug, {
      state: "STARTING",
      byteOffset: 0,
      partialLineBuffer: "",
      lastActivityTime: null,
      firstActivityTime: null,
      turnsCompleted: 0,
      retries: 0,
      consecutiveRetries: 0,
      tokensSoFar: 0,
      toolCalls: new Set(),
      pid: readPidFileSync(sessionDir, slug),
      inApiCall: false,
      stall_during_api_call: false,
      exit_code: null,
      error_message: null,
      debugLogPath: "",
      killHandled: false,
    });
  }

  const startTime = Date.now();
  const deadline = startTime + timeoutSec * 1000;
  let pollCount = 0;

  // Progress tracking
  const prevStates = new Map<string, ProcessState>(
    slugs.map((s: string) => [s, "STARTING" as ProcessState])
  );
  let lastProgressEmit = startTime;

  // SIGTERM handler — write final status before clean exit
  let shutdownInProgress = false;
  process.on("SIGTERM", async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log("[monitor] Received SIGTERM — writing final status");
    await writeFinalStatus(
      sessionDir,
      sessionId,
      models,
      slugs,
      startTime,
      timeoutSec,
      pollCount
    );
    process.exit(0);
  });

  console.log(
    `[monitor] Started: session=${sessionId} models=[${slugs.join(",")}] timeout=${timeoutSec}s`
  );

  // Main poll loop
  while (Date.now() < deadline) {
    const loopStart = Date.now();
    pollCount++;

    for (const slug of slugs) {
      const modelState = models.get(slug)!;
      if (isTerminal(modelState.state)) continue;

      try {
        // Refresh PID if not yet loaded
        if (modelState.pid === null) {
          modelState.pid = readPidFileSync(sessionDir, slug);
        }

        // Discover debug log
        const logPath = findDebugLog(sessionDir, slug);
        if (logPath) {
          modelState.debugLogPath = logPath;
        }

        // Read new bytes incrementally
        const resolvedPath = logPath || modelState.debugLogPath;
        const { content, newOffset, newPartialBuffer } = await readNewBytes(
          resolvedPath,
          modelState.byteOffset,
          modelState.partialLineBuffer
        );

        const hadNewBytes = newOffset > modelState.byteOffset;
        modelState.byteOffset = newOffset;
        modelState.partialLineBuffer = newPartialBuffer;

        if (hadNewBytes) {
          const now = Date.now();
          if (modelState.firstActivityTime === null) {
            modelState.firstActivityTime = now;
          }
          modelState.lastActivityTime = now;

          // STALLED → ACTIVE recovery
          if (modelState.state === "STALLED") {
            modelState.state = "ACTIVE";
            console.log(
              `[monitor] ${slug}: recovered from stall (new log bytes detected)`
            );
          } else if (
            modelState.state === "STARTING" &&
            content.trim().length > 0
          ) {
            modelState.state = "ACTIVE";
          }

          // Parse new content and update state
          if (content.trim().length > 0) {
            inferStateFromMetrics(modelState, content);
          }
        }

        // Check exit code file
        await checkExitCode(sessionDir, slug, modelState);

        // Check sentinel files (.kill, .skip)
        await checkSentinels(sessionDir, slug, modelState);

        // Apply stall heuristics
        if (!isTerminal(modelState.state)) {
          checkStall(modelState, Date.now(), stallThresholdMs);
        }
      } catch (e) {
        // Per-model errors must not crash the monitor
        console.error(`[monitor] Poll error for ${slug}: ${e}`);
      }
    }

    // Write atomic status snapshot
    const now = Date.now();
    const status = buildMonitorStatus(
      sessionId,
      models,
      slugs,
      sessionDir,
      startTime,
      timeoutSec,
      pollCount,
      now
    );
    await writeStatusAtomic(sessionDir, status);

    // Emit progress on state change or interval
    const anyChanged = slugs.some(
      (s) => models.get(s)!.state !== prevStates.get(s)
    );
    const intervalElapsed = now - lastProgressEmit >= PROGRESS_INTERVAL_MS;

    if (anyChanged || intervalElapsed || pollCount === 1) {
      emitProgress(models, slugs, startTime, now);
      for (const slug of slugs) {
        prevStates.set(slug, models.get(slug)!.state);
      }
      lastProgressEmit = now;
    }

    // Check if all models reached terminal state
    const allDone = slugs.every((s) => isTerminal(models.get(s)!.state));
    if (allDone) {
      console.log("[monitor] All models in terminal state — exiting");
      break;
    }

    // Sleep for poll interval (accounting for loop processing time)
    const loopDuration = Date.now() - loopStart;
    const sleepMs = Math.max(0, pollIntervalMs - loopDuration);
    if (sleepMs > 0) {
      await Bun.sleep(sleepMs);
    }
  }

  // Write final status
  await writeFinalStatus(
    sessionDir,
    sessionId,
    models,
    slugs,
    startTime,
    timeoutSec,
    pollCount
  );

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[monitor] Complete. elapsed=${elapsed}s polls=${pollCount}`);
}
