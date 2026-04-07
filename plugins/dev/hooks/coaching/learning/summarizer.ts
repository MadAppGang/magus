/**
 * Stage 3: Structured Transcript Extraction (NO LLM)
 *
 * Parses a Claude Code session transcript (JSONL) and produces a structured
 * SessionSummary for the LLM classifier. Pure parsing — no API calls.
 */

import { readFileSync } from "fs";
import type { QueueEntry, SessionSummary } from "./types";

// Correction/rule patterns (same as analyzer.ts Stage 2)
const CORRECTION_PATTERN =
  /\b(no[,.]\s|wrong|instead|not that|we always|we use|don't use|never use)\b/i;
const EXPLICIT_RULE_PATTERN =
  /\b(in this project|our convention|we always|the rule is|we never|always use|never use)\b/i;

export function summarizeTranscript(entry: QueueEntry): SessionSummary {
  const content = readFileSync(entry.transcript_path, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const userMessages: SessionSummary["user_messages"] = [];
  const toolCounts: Record<string, number> = {};
  const failedSequences: Array<{ first_cmd: string; second_cmd: string }> = [];
  let messageIndex = 0;
  let lastBashCmd = "";
  let lastBashOrder = -1;

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Extract user messages
    if (obj.type === "human") {
      const message = obj.message as Record<string, unknown> | undefined;
      if (!message) continue;
      const contentBlocks = message.content;
      let text = "";
      if (typeof contentBlocks === "string") {
        text = contentBlocks;
      } else if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks as Record<string, unknown>[]) {
          if (block.type === "text" && typeof block.text === "string") {
            text += block.text + "\n";
          }
        }
      }
      text = text.trim();
      if (text) {
        userMessages.push({
          index: messageIndex++,
          // Truncate to 500 chars for LLM input budget
          text: text.length > 500 ? text.slice(0, 500) + "..." : text,
          has_correction: CORRECTION_PATTERN.test(text),
          has_explicit_rule: EXPLICIT_RULE_PATTERN.test(text),
        });
      }
    }

    // Count tool calls
    if (obj.type === "assistant") {
      const message = obj.message as Record<string, unknown> | undefined;
      if (!message) continue;
      const contentBlocks = message.content;
      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks as Record<string, unknown>[]) {
          if (block.type === "tool_use") {
            const toolName = String(block.name ?? "unknown");
            toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1;

            // Track failed Bash sequences (adjacent Bash calls with different first tokens)
            if (toolName === "Bash") {
              const input = block.input as Record<string, unknown> | undefined;
              const cmd = String(input?.command ?? "").split(/\s+/)[0];
              const order = toolCounts[toolName];
              if (
                lastBashCmd &&
                order - lastBashOrder <= 2 &&
                cmd !== lastBashCmd &&
                cmd !== "" &&
                lastBashCmd !== ""
              ) {
                failedSequences.push({
                  first_cmd: lastBashCmd,
                  second_cmd: cmd,
                });
              }
              lastBashCmd = cmd;
              lastBashOrder = order;
            }
          }
        }
      }
    }
  }

  return {
    session_id: entry.session_id,
    cwd: entry.cwd,
    transcript_path: entry.transcript_path,
    queued_at: entry.queued_at,
    learning_score: entry.learning_score,
    user_messages: userMessages,
    tool_call_summary: {
      total: Object.values(toolCounts).reduce((a, b) => a + b, 0),
      by_tool: toolCounts,
      failed_sequences: failedSequences,
    },
    rule_based_signals: entry.rule_based_signals,
  };
}
