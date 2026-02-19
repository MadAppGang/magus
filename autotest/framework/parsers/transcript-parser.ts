/**
 * transcript-parser.ts - Shared transcript.jsonl parsing for the autotest framework.
 *
 * Extracted from replay.ts (loadTranscript, buildTurns) and aggregate-results.ts
 * (inline JSONL scan for Task tool delegation). Single canonical source for
 * transcript parsing logic.
 */

import type {
  TranscriptEntry,
  ReplayTurn,
  Metrics,
} from "../types.js";
import { readFileSync } from "fs";

/**
 * Parse a transcript.jsonl file into structured entries.
 * Handles parse errors gracefully — returns a parse_error entry instead of throwing.
 *
 * Extracted from replay.ts loadTranscript() (lines 47-60).
 */
export function parseTranscriptFile(path: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const content = readFileSync(path, "utf-8");
  for (const [i, line] of content.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as TranscriptEntry);
    } catch {
      entries.push({
        type: "parse_error",
        line: i + 1,
        raw: trimmed.slice(0, 200),
      });
    }
  }
  return entries;
}

/**
 * Build replay-formatted turns from transcript entries and optional metrics.
 * Assigns turn numbers, extracts tool calls, merges per-turn metrics.
 *
 * Extracted from replay.ts buildTurns() (lines 73-167).
 */
export function buildReplayTurns(
  entries: TranscriptEntry[],
  metrics: Metrics | null
): ReplayTurn[] {
  const turns: ReplayTurn[] = [];
  let turnNumber = 0;

  for (const entry of entries) {
    const type = entry.type ?? "";

    if (type === "session_start") {
      turns.push({
        turn_number: 0,
        type: "session_start",
        session_id: entry.id ?? "",
        timestamp: entry.timestamp ?? "",
        content: "[Session started]",
      });
      continue;
    }

    if (type === "session_end") {
      turns.push({
        turn_number: turnNumber + 1,
        type: "session_end",
        timestamp: entry.timestamp ?? "",
        content: "[Session ended]",
      });
      continue;
    }

    if (type === "assistant") {
      turnNumber++;
      const message = entry.message ?? { content: [] };
      const contentBlocks = message.content ?? [];

      const textParts: string[] = [];
      const toolCalls: { id: string; name: string; input: Record<string, any> }[] = [];

      for (const block of contentBlocks) {
        if (block.type === "text") {
          textParts.push(block.text ?? "");
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id ?? "",
            name: block.name ?? "",
            input: block.input ?? {},
          });
        }
      }

      // Find matching metrics turn
      let metricsTurn: any = null;
      if (metrics) {
        metricsTurn =
          (metrics.turns ?? []).find((mt) => mt.turn_number === turnNumber) ??
          null;
      }

      turns.push({
        turn_number: turnNumber,
        type: "assistant",
        text: textParts.join("\n"),
        tool_calls: toolCalls,
        metrics: metricsTurn,
      });
      continue;
    }

    if (type === "tool_result") {
      let resultText: string | object = entry.result ?? "";
      if (typeof resultText === "object") {
        resultText = JSON.stringify(resultText, null, 2);
      }
      if (String(resultText).length > 2000) {
        resultText = String(resultText).slice(0, 2000) + "... [truncated]";
      }

      turns.push({
        turn_number: turnNumber,
        type: "tool_result",
        tool_id: entry.id ?? "",
        result: resultText as string,
      });
      continue;
    }

    if (type === "parse_error") {
      turns.push({
        turn_number: turnNumber,
        type: "error",
        content: `[Parse error on line ${entry.line ?? "?"}]: ${entry.raw ?? ""}`,
      });
    }
  }

  return turns;
}

/**
 * Scan transcript entries and return the first Task tool subagent_type found.
 * Returns "" if no Task delegation occurred.
 * Falls back to "TASK_USED" if Task was called but subagent_type was not parseable.
 *
 * Extracted from aggregate-results.ts inline JSONL scan loop (lines 131-161).
 */
export function extractAgentFromTranscript(entries: TranscriptEntry[]): string {
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of entry.message?.content ?? []) {
      if (block.type === "tool_use" && block.name === "Task") {
        const agent = block.input?.subagent_type ?? "";
        if (agent) return agent;
        // Task was used but subagent_type not present
        return "TASK_USED";
      }
    }
  }
  return "";
}
