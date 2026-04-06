#!/usr/bin/env bun
/**
 * PreToolUse hook handler for the stats plugin.
 *
 * Ultra-fast fire-and-forget: reads session_id + tool_name from stdin,
 * appends a pre-event to the staging JSONL file, and exits 0.
 *
 * Requirements:
 * - Must complete in <1ms (synchronous appendFileSync only)
 * - Must NEVER throw uncaught exceptions
 * - Must ALWAYS exit 0
 * - NO file reads, NO state, NO async I/O
 */

import { readFileSync } from "fs";
import { writePreEvent, getStagingPath } from "../lib/collector.ts";

try {
  // Read stdin synchronously
  const input = readFileSync("/dev/stdin", "utf-8");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(input) as Record<string, unknown>;
  } catch {
    process.exit(0);
  }

  const sessionId = payload.session_id as string | undefined;
  const toolName = payload.tool_name as string | undefined;

  if (!sessionId || !toolName) {
    process.exit(0);
  }

  const stagingPath = getStagingPath(sessionId);
  writePreEvent(stagingPath, toolName);
} catch {
  // Non-fatal: never block tool execution
}

process.exit(0);
