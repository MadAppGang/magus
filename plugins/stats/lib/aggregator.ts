/**
 * Session aggregation logic for the Stop hook.
 * Pairs pre/post staging events, parses the transcript,
 * classifies tool calls, and writes to SQLite.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { classifyTool } from "./classifier.ts";
import { readEvents, cleanupStaging, getStagingDir } from "./collector.ts";
import {
  openDb,
  insertSession,
  insertToolCalls,
  upsertDailyStats,
  deleteOldSessions,
  rebuildDailyStatsRows,
} from "./db.ts";
import type {
  AggregatorInput,
  SessionMetrics,
  ToolCallRecord,
  ActivityCounts,
  TranscriptMetrics,
  BashCommand,
  StagingPreRecord,
  StagingPostRecord,
} from "./types.ts";

/**
 * Parse staging JSONL into tool call records.
 * Pairs pre+post events sequentially by tool_name.
 * Unpaired pre events → duration_ms = 0.
 */
export function parseStagingFile(path: string): Array<{ toolName: string; timestamp: string; durationMs: number; success: boolean }> {
  const events = readEvents(path);
  const results: Array<{ toolName: string; timestamp: string; durationMs: number; success: boolean }> = [];

  // Process events sequentially: for each "pre", find the next unmatched "post" for same tool_name
  const pendingPre = new Map<string, { timestamp: string; index: number }[]>();

  for (const event of events) {
    if (event.type === "pre") {
      const pre = event as StagingPreRecord;
      if (!pendingPre.has(pre.tool_name)) {
        pendingPre.set(pre.tool_name, []);
      }
      pendingPre.get(pre.tool_name)!.push({ timestamp: pre.timestamp, index: results.length });
      // Push placeholder; will be updated when post arrives
      results.push({
        toolName: pre.tool_name,
        timestamp: pre.timestamp,
        durationMs: 0,
        success: true,
      });
    } else if (event.type === "post") {
      const post = event as StagingPostRecord;
      const pending = pendingPre.get(post.tool_name);
      if (pending && pending.length > 0) {
        // Match with the oldest unmatched pre for this tool_name
        const matched = pending.shift()!;
        const durationMs = Math.max(
          0,
          new Date(post.timestamp).getTime() - new Date(matched.timestamp).getTime()
        );
        results[matched.index] = {
          toolName: post.tool_name,
          timestamp: matched.timestamp,
          durationMs,
          success: post.success,
        };
      }
      // Unmatched post records are silently skipped
    }
  }

  return results;
}

/**
 * Parse transcript JSONL for session timing and Bash command strings.
 * Uses line-by-line streaming (reads full file but processes line by line).
 */
export function parseTranscript(path: string): TranscriptMetrics {
  if (!existsSync(path)) {
    return {
      duration_sec: 0,
      inter_message_gap_sec: 0,
      tool_call_count: 0,
      bash_commands: [],
    };
  }

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  let sessionStart: string | undefined;
  let sessionEnd: string | undefined;
  let interMessageGapMs = 0;
  let lastAssistantTimestamp: string | undefined;
  let toolCallCount = 0;
  const bashCommands: BashCommand[] = [];
  // bashIndex is a sequential counter of Bash-only calls (0, 1, 2...).
  // tool_call_index on BashCommand stores this value so that lookup in
  // computeActivityCounts / runAggregator (which also iterate Bash calls
  // sequentially) always uses the same index space.
  let bashIndex = 0;

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type !== "assistant") continue;

    const timestamp = obj.timestamp as string | undefined;
    if (!timestamp) continue;

    if (!sessionStart) sessionStart = timestamp;
    sessionEnd = timestamp;

    // Compute inter-message gap
    if (lastAssistantTimestamp) {
      const gap = new Date(timestamp).getTime() - new Date(lastAssistantTimestamp).getTime();
      if (gap > 0) interMessageGapMs += gap;
    }
    lastAssistantTimestamp = timestamp;

    // Parse tool_use blocks from assistant message content
    const message = obj.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const contentBlocks = message.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(contentBlocks)) continue;

    for (const block of contentBlocks) {
      if (block.type !== "tool_use") continue;

      toolCallCount++;
      const toolName = block.name as string;

      // Extract Bash command strings, keyed by sequential Bash-call index
      if (toolName === "Bash") {
        const input = block.input as Record<string, unknown> | undefined;
        const command = input?.command as string | undefined;
        if (command) {
          bashCommands.push({ tool_call_index: bashIndex, command });
        }
        bashIndex++;
      }
    }
  }

  const durationSec =
    sessionStart && sessionEnd
      ? Math.max(0, Math.round((new Date(sessionEnd).getTime() - new Date(sessionStart).getTime()) / 1000))
      : 0;

  return {
    session_start: sessionStart,
    session_end: sessionEnd,
    duration_sec: durationSec,
    inter_message_gap_sec: Math.round(interMessageGapMs / 1000),
    tool_call_count: toolCallCount,
    bash_commands: bashCommands,
  };
}

/**
 * Compute activity counts from tool call records.
 */
function computeActivityCounts(
  calls: Array<{ toolName: string; durationMs: number; success: boolean; timestamp: string }>,
  bashCommands: BashCommand[]
): ActivityCounts {
  const counts: ActivityCounts = {
    research: 0,
    coding: 0,
    testing: 0,
    delegation: 0,
    other: 0,
  };

  // Build a map from tool_call_index to bash command for O(1) lookup
  const bashByIndex = new Map<number, string>();
  for (const bc of bashCommands) {
    bashByIndex.set(bc.tool_call_index, bc.command);
  }

  let bashCallIndex = 0;
  for (const call of calls) {
    let bashCommand: string | undefined;
    if (call.toolName === "Bash") {
      bashCommand = bashByIndex.get(bashCallIndex);
      bashCallIndex++;
    }

    const category = classifyTool(call.toolName, bashCommand);
    counts[category]++;
  }

  return counts;
}

/**
 * Aggregate orphaned staging files (from sessions where Stop hook didn't fire).
 * Called at the end of each Stop hook run.
 */
async function aggregateOrphans(
  currentSessionId: string,
  dbPath: string,
  retentionHours = 24
): Promise<void> {
  const stagingDir = getStagingDir();
  if (!existsSync(stagingDir)) return;

  const cutoffMs = Date.now() - retentionHours * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = readdirSync(stagingDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const orphanSessionId = entry.replace(".jsonl", "");
    if (orphanSessionId === currentSessionId) continue; // Skip current session's file

    const orphanPath = join(stagingDir, entry);
    try {
      const st = statSync(orphanPath);
      if (st.mtimeMs > cutoffMs) continue; // Not old enough

      // Try to aggregate orphan
      const stagingEvents = parseStagingFile(orphanPath);
      if (stagingEvents.length === 0) {
        cleanupStaging(orphanPath);
        continue;
      }

      const db = openDb(dbPath);
      try {
        const calls: ToolCallRecord[] = stagingEvents.map((e) => ({
          tool_name: e.toolName,
          duration_ms: e.durationMs,
          success: e.success,
          activity_category: classifyTool(e.toolName),
          timestamp: e.timestamp,
        }));

        const activityCounts = computeActivityCounts(stagingEvents, []);
        const date = new Date(stagingEvents[0].timestamp).toLocaleDateString("en-CA");
        const metrics: SessionMetrics = {
          session_id: orphanSessionId,
          date,
          project: "unknown", // Cannot determine cwd for orphans
          duration_sec: 0,
          inter_message_gap_sec: 0,
          tool_calls: calls,
          activity_counts: activityCounts,
        };

        db.transaction(() => {
          if (insertSession(db, metrics)) {
            insertToolCalls(db, calls, orphanSessionId);
            upsertDailyStats(db, date, metrics.project, activityCounts, calls.length, 0);
          }
        })();

        cleanupStaging(orphanPath);
      } finally {
        db.close();
      }
    } catch (err) {
      // Leave orphan in place, log to stderr
      process.stderr.write(`[stats] Failed to aggregate orphan ${orphanSessionId}: ${err}\n`);
    }
  }
}

/**
 * Main aggregation entry point called by stop-stats.sh.
 */
export async function runAggregator(input: AggregatorInput): Promise<void> {
  const { session_id, transcript_path, staging_path, cwd, db_path, config } = input;

  if (!config.enabled) return;

  const db = openDb(db_path);

  try {
    // Session dedup guard
    const existing = db.query("SELECT id FROM sessions WHERE id = ?").get(session_id);
    if (existing) {
      process.stderr.write(`[stats] Session ${session_id} already aggregated, skipping\n`);
      return;
    }

    // Parse staging file
    const stagingEvents = parseStagingFile(staging_path);

    // Parse transcript
    let transcriptMetrics: TranscriptMetrics = {
      duration_sec: 0,
      inter_message_gap_sec: 0,
      tool_call_count: 0,
      bash_commands: [],
    };
    try {
      if (transcript_path && existsSync(transcript_path)) {
        // Size guard: skip transcripts > 50MB
        const st = statSync(transcript_path);
        if (st.size <= 50 * 1024 * 1024) {
          transcriptMetrics = parseTranscript(transcript_path);
        }
      }
    } catch (err) {
      process.stderr.write(`[stats] Transcript parse error: ${err}\n`);
    }

    // Build tool call records with classification
    const bashCommands = transcriptMetrics.bash_commands;
    // bashByIndex is keyed by sequential Bash-call index (matches tool_call_index
    // stored in BashCommand, which parseTranscript also assigns sequentially).
    const bashByIndex = new Map<number, string>();
    for (const bc of bashCommands) {
      bashByIndex.set(bc.tool_call_index, bc.command);
    }

    let bashCallIndex = 0;
    const toolCalls: ToolCallRecord[] = stagingEvents.map((e) => {
      let bashCommand: string | undefined;
      if (e.toolName === "Bash") {
        bashCommand = bashByIndex.get(bashCallIndex);
        bashCallIndex++;
      }
      return {
        tool_name: e.toolName,
        duration_ms: e.durationMs,
        success: e.success,
        activity_category: classifyTool(e.toolName, bashCommand),
        timestamp: e.timestamp,
      };
    });

    // Compute activity counts using the shared helper
    const activityCounts = computeActivityCounts(stagingEvents, bashCommands);

    // Compute session date in local time
    const date = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

    const metrics: SessionMetrics = {
      session_id,
      date,
      project: cwd,
      duration_sec: transcriptMetrics.duration_sec,
      inter_message_gap_sec: transcriptMetrics.inter_message_gap_sec,
      tool_calls: toolCalls,
      activity_counts: activityCounts,
    };

    // Write to SQLite in a transaction
    db.transaction(() => {
      const inserted = insertSession(db, metrics);
      if (inserted) {
        insertToolCalls(db, toolCalls, session_id);
        upsertDailyStats(
          db,
          date,
          cwd,
          activityCounts,
          toolCalls.length,
          transcriptMetrics.duration_sec
        );
      }

      // Apply retention policy
      const { deletedCount, affectedPairs } = deleteOldSessions(
        db,
        config.retention_days
      );
      if (deletedCount > 0 && affectedPairs.length > 0) {
        rebuildDailyStatsRows(db, affectedPairs);
      }
    })();

    // Clean up staging file after successful commit
    cleanupStaging(staging_path);

    // Aggregate orphaned staging files from previous sessions
    await aggregateOrphans(session_id, db_path);
  } catch (err) {
    process.stderr.write(`[stats] Aggregation failed: ${err}\n`);
    // Non-fatal: log and exit 0
  } finally {
    db.close();
  }
}
