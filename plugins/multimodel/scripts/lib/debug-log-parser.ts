/**
 * debug-log-parser.ts - Slim bundle of parseDebugLogContent for monitor.ts.
 *
 * Extracts per-turn metrics from claudish debug log content (string input only).
 * No file I/O, no CLI, no formatting — just the pure parsing logic.
 *
 * Sync reference: autotest/framework/parsers/debug-log-parser.ts (canonical source)
 */

import type { ToolCall, Tokens, OutputTurn, Totals, Metrics } from "./types.ts";

// --- Regex patterns for claudish debug log format ---

const RE_TIMESTAMP = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/;
const RE_REQUEST = /\[OpenRouter Request\]\s*\{(.*)\}/s;
const RE_TARGET_MODEL = /"targetModel"\s*:\s*"([^"]+)"/;
const RE_ORIGINAL_MODEL = /"originalModel"\s*:\s*"([^"]+)"/;
const RE_MESSAGE_COUNT = /"messageCount"\s*:\s*(\d+)/;
const RE_TOOL_COUNT = /"toolCount"\s*:\s*(\d+)/;
// Old format (pre-v5.3.0)
const RE_TOOL_CALLS = /\[OpenRouter\] Tool calls:\s*(.*)/;
const RE_TOOL_VALIDATED = /\[OpenRouter\] Tool validated:\s*(\w+)/;
const RE_USAGE =
  /\[OpenRouter\] Usage:\s*prompt=(\d+),\s*completion=(\d+),\s*total=(\d+)/;
const RE_STREAM_COMPLETE = /\[OpenRouter\] Stream complete:\s*(\w+)/;
// New format (v5.3.0+)
const RE_STREAMING_USAGE =
  /\[Streaming\] Usage data received:\s*prompt=(\d+),\s*completion=(\d+),\s*total=(\d+)/;
const RE_STREAMING_FINAL_USAGE =
  /\[Streaming\] Final usage:\s*prompt=(\d+),\s*completion=(\d+)/;
const RE_STREAMING_FINISH = /\[Streaming\] Chunk:.*\bfinish_reason=stop\b/;
// Common patterns
const RE_RESPONSE_STATUS = /\[OpenRouter\] Response status:\s*(\d+)/;
const RE_COST_TRACKER = /\[Cost Tracker\] Total cost:\s*\$?([\d.]+)/;
const RE_PROXY_START = /\[Proxy\] Server started on port\s*(\d+)/;
const RE_TOOL_CALL_ENTRY = /([\w][\w-]*(?:__[\w-]+)*)\((\d+)\s*chars?\)/g;

// --- Internal type ---

interface DebugTurn {
  turn_number: number;
  timestamp: string | null;
  target_model?: string | null;
  original_model?: string | null;
  message_count?: number | null;
  tool_count?: number | null;
  tool_calls: ToolCall[];
  tokens: Tokens | null;
  duration_ms: number | null;
  completed: boolean;
  retry: boolean;
  response_status?: number | null;
  stream_status?: string;
}

// --- Helpers ---

function parseTimestamp(tsStr: string): Date | null {
  try {
    const cleaned = tsStr.endsWith("Z") ? tsStr : tsStr + "Z";
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function extractTimestamp(line: string): Date | null {
  const match = line.match(RE_TIMESTAMP);
  return match ? parseTimestamp(match[1]) : null;
}

function parseToolCallsStr(toolStr: string): ToolCall[] {
  const tools: ToolCall[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE_TOOL_CALL_ENTRY.exec(toolStr)) !== null) {
    tools.push({ name: m[1], input_chars: parseInt(m[2], 10) });
  }
  RE_TOOL_CALL_ENTRY.lastIndex = 0; // Reset for next call
  return tools;
}

function preProcessLines(content: string): string[] {
  // Join multi-line JSON blocks into single lines.
  const rawLines = content.split("\n");
  const lines: string[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    if (/\]\s*\{$/.test(line.trimEnd())) {
      const jsonLines = [line.trimEnd()];
      i++;
      while (i < rawLines.length) {
        const jsonLine = rawLines[i];
        jsonLines.push(jsonLine.trimEnd());
        i++;
        if (jsonLine.trim() === "}") break;
      }
      lines.push(jsonLines.join(" "));
    } else {
      lines.push(line);
      i++;
    }
  }

  return lines;
}

function calculateDuration(
  ts: Date | null,
  requestTimestamp: string | null
): number | null {
  if (!ts || !requestTimestamp) return null;
  const reqTs = new Date(requestTimestamp);
  return isNaN(reqTs.getTime()) ? null : ts.getTime() - reqTs.getTime();
}

// --- Core parser ---

function parseLinesInternal(lines: string[]): Metrics {
  const turns: DebugTurn[] = [];
  let currentRequest: DebugTurn | null = null;
  let firstTimestamp: Date | null = null;
  let lastTimestamp: Date | null = null;
  let totalCost: number | null = null;
  let model: string | null = null;

  for (const line of lines) {
    const ts = extractTimestamp(line);
    if (ts) {
      if (firstTimestamp === null) firstTimestamp = ts;
      lastTimestamp = ts;
    }

    // Proxy start
    if (RE_PROXY_START.test(line)) continue;

    // New API request = new turn
    let m = line.match(RE_REQUEST);
    if (m) {
      const requestJson = m[1];
      const target = requestJson.match(RE_TARGET_MODEL);
      const original = requestJson.match(RE_ORIGINAL_MODEL);
      const msgCount = requestJson.match(RE_MESSAGE_COUNT);
      const toolCount = requestJson.match(RE_TOOL_COUNT);

      if (model === null && target) model = target[1];

      // Push previous request: mark incomplete ones as retry
      if (currentRequest) {
        if (!currentRequest.completed) {
          currentRequest.retry = true;
        }
        turns.push(currentRequest);
      }

      currentRequest = {
        turn_number: turns.length + 1,
        timestamp: ts ? ts.toISOString() : null,
        target_model: target?.[1] ?? null,
        original_model: original?.[1] ?? null,
        message_count: msgCount ? parseInt(msgCount[1], 10) : null,
        tool_count: toolCount ? parseInt(toolCount[1], 10) : null,
        tool_calls: [],
        tokens: null,
        duration_ms: null,
        completed: false,
        retry: false,
        response_status: null,
      };
      continue;
    }

    // Response status
    m = line.match(RE_RESPONSE_STATUS);
    if (m && currentRequest) {
      currentRequest.response_status = parseInt(m[1], 10);
      continue;
    }

    // Tool validated (informational)
    if (RE_TOOL_VALIDATED.test(line) && currentRequest) continue;

    // Tool calls
    m = line.match(RE_TOOL_CALLS);
    if (m && currentRequest) {
      currentRequest.tool_calls = parseToolCallsStr(m[1]);
      continue;
    }

    // Token usage — old format [OpenRouter] Usage:
    m = line.match(RE_USAGE);
    if (m && currentRequest) {
      currentRequest.tokens = {
        prompt: parseInt(m[1], 10),
        completion: parseInt(m[2], 10),
        total: parseInt(m[3], 10),
      };
      continue;
    }

    // Token usage — new format [Streaming] Usage data received:
    m = line.match(RE_STREAMING_USAGE);
    if (m && currentRequest) {
      if (!currentRequest.tokens || currentRequest.tokens.total === 0) {
        currentRequest.tokens = {
          prompt: parseInt(m[1], 10),
          completion: parseInt(m[2], 10),
          total: parseInt(m[3], 10),
        };
      }
      continue;
    }

    // Token usage — new format [Streaming] Final usage:
    m = line.match(RE_STREAMING_FINAL_USAGE);
    if (m && currentRequest && !currentRequest.tokens) {
      const prompt = parseInt(m[1], 10);
      const completion = parseInt(m[2], 10);
      currentRequest.tokens = {
        prompt,
        completion,
        total: prompt + completion,
      };
      continue;
    }

    // Stream complete — old format
    m = line.match(RE_STREAM_COMPLETE);
    if (m && currentRequest) {
      currentRequest.completed = true;
      currentRequest.stream_status = m[1];
      currentRequest.duration_ms = calculateDuration(
        ts,
        currentRequest.timestamp
      );

      turns.push(currentRequest);
      currentRequest = null;
      continue;
    }

    // Stream complete — new format finish_reason=stop
    if (RE_STREAMING_FINISH.test(line) && currentRequest) {
      currentRequest.completed = true;
      currentRequest.stream_status = "stop";
      currentRequest.duration_ms = calculateDuration(
        ts,
        currentRequest.timestamp
      );
      continue;
    }

    // Cost tracker
    m = line.match(RE_COST_TRACKER);
    if (m) {
      totalCost = parseFloat(m[1]);
      continue;
    }
  }

  // Handle last request
  if (currentRequest) {
    if (!currentRequest.completed) {
      currentRequest.retry = true;
    }
    turns.push(currentRequest);
  }

  // Calculate aggregates
  const completedTurns: DebugTurn[] = [];
  const retryTurns: DebugTurn[] = [];
  for (const t of turns) {
    if (t.retry) retryTurns.push(t);
    else if (t.completed) completedTurns.push(t);
  }

  const totalTokens: Tokens = { prompt: 0, completion: 0, total: 0 };
  let totalDurationMs = 0;
  const allToolCalls: string[] = [];

  for (const turn of completedTurns) {
    if (turn.tokens) {
      totalTokens.prompt += turn.tokens.prompt;
      totalTokens.completion += turn.tokens.completion;
      totalTokens.total += turn.tokens.total;
    }
    if (turn.duration_ms) totalDurationMs += turn.duration_ms;
    for (const tc of turn.tool_calls) allToolCalls.push(tc.name);
  }

  // Time to first tool call
  let timeToFirstToolMs: number | null = null;
  for (const turn of completedTurns) {
    if (turn.tool_calls.length > 0) {
      timeToFirstToolMs = turn.duration_ms;
      break;
    }
  }

  // Wall clock time
  let wallTimeMs: number | null = null;
  if (firstTimestamp && lastTimestamp) {
    wallTimeMs = lastTimestamp.getTime() - firstTimestamp.getTime();
  }

  const totals: Totals = {
    total_turns: completedTurns.length,
    total_retries: retryTurns.length,
    total_time_ms: totalDurationMs,
    wall_time_ms: wallTimeMs,
    total_tokens: totalTokens,
    time_to_first_tool_ms: timeToFirstToolMs,
    tool_call_sequence: allToolCalls,
    unique_tools: [...new Set(allToolCalls)].sort(),
    cost_usd: totalCost,
    model,
  };

  const outputTurns: OutputTurn[] = turns.map((turn) => ({
    turn_number: turn.turn_number,
    timestamp: turn.timestamp,
    duration_ms: turn.duration_ms,
    tool_calls: turn.tool_calls.map((tc) => tc.name),
    tokens: turn.tokens,
    retry: turn.retry,
    stream_status: turn.stream_status,
    message_count: turn.message_count,
  }));

  return { turns: outputTurns, totals };
}

// --- Public API ---

export function parseDebugLogContent(content: string): Metrics {
  if (!content.trim()) {
    return { error: "empty debug log", turns: [], totals: null };
  }
  return parseLinesInternal(preProcessLines(content));
}
