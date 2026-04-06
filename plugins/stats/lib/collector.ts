/**
 * Staging file manager for per-session JSONL event capture.
 *
 * All operations are synchronous (appendFileSync) for fire-and-forget
 * performance in PreToolUse / PostToolUse hooks.
 */

import {
  appendFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import type { StagingPreRecord, StagingPostRecord, StagingRecord } from "./types.ts";

/**
 * Returns the staging directory path.
 * Location: ~/.claude/stats/sessions/
 */
export function getStagingDir(): string {
  return join(homedir(), ".claude", "stats", "sessions");
}

/**
 * Validate a session ID to prevent path traversal attacks.
 * Accepts only alphanumeric characters, hyphens, and underscores.
 * Throws if the session ID contains any other characters.
 */
export function validateSessionId(sessionId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error(
      `Invalid session ID: must contain only alphanumeric characters, hyphens, and underscores`
    );
  }
}

/**
 * Returns the staging file path for a given session ID.
 * Validates the session ID to prevent path traversal attacks.
 */
export function getStagingPath(sessionId: string): string {
  validateSessionId(sessionId);
  return join(getStagingDir(), `${sessionId}.jsonl`);
}

/**
 * Ensure the staging directory exists with correct permissions.
 * Called lazily on first write.
 */
function ensureStagingDir(): void {
  const stagingDir = getStagingDir();
  if (!existsSync(stagingDir)) {
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  } else {
    // Verify/correct permissions on existing directory
    try {
      chmodSync(stagingDir, 0o700);
    } catch {
      // Best-effort permission fix
    }
  }
}

/**
 * Append a PreToolUse event to the staging JSONL file.
 * Synchronous — no async, no await, no reads.
 */
export function writePreEvent(stagingPath: string, toolName: string): void {
  ensureStagingDir();
  const record: StagingPreRecord = {
    type: "pre",
    tool_name: toolName,
    timestamp: new Date().toISOString(),
  };
  const line = JSON.stringify(record) + "\n";
  appendFileSync(stagingPath, line, { mode: 0o600, flag: "a" });
}

/**
 * Append a PostToolUse event to the staging JSONL file.
 * Synchronous — no async, no await, no reads.
 */
export function writePostEvent(
  stagingPath: string,
  toolName: string,
  success: boolean
): void {
  ensureStagingDir();
  const record: StagingPostRecord = {
    type: "post",
    tool_name: toolName,
    success,
    timestamp: new Date().toISOString(),
  };
  const line = JSON.stringify(record) + "\n";
  appendFileSync(stagingPath, line, { mode: 0o600, flag: "a" });
}

/**
 * Read and parse all events from a staging JSONL file.
 * Returns empty array if file does not exist.
 */
export function readEvents(stagingPath: string): StagingRecord[] {
  if (!existsSync(stagingPath)) {
    return [];
  }
  const events: StagingRecord[] = [];
  const content = readFileSync(stagingPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as StagingRecord;
      events.push(record);
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}

/**
 * Delete the staging file after successful aggregation.
 */
export function cleanupStaging(stagingPath: string): void {
  try {
    if (existsSync(stagingPath)) {
      unlinkSync(stagingPath);
    }
  } catch {
    // Best-effort cleanup
  }
}
