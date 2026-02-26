#!/usr/bin/env bun
/**
 * debug-log-parser.ts - Extract performance metrics from claudish debug logs.
 *
 * Parses the debug log format produced by `claudish --debug --log-level debug`
 * and extracts per-turn metrics: timing, token usage, tool calls, retries.
 *
 * Usage:
 *   bun run debug-log-parser.ts <debug.log> [--output metrics.json] [--format json|table]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { parseArgs } from "util";
import type { ToolCall, Tokens, OutputTurn, Totals, Metrics } from "../types.js";

// --- Regex patterns for claudish debug log format ---

const RE_TIMESTAMP = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/;
const RE_REQUEST = /\[OpenRouter Request\]\s*\{(.*)\}/s;
const RE_TARGET_MODEL = /"targetModel"\s*:\s*"([^"]+)"/;
const RE_ORIGINAL_MODEL = /"originalModel"\s*:\s*"([^"]+)"/;
const RE_MESSAGE_COUNT = /"messageCount"\s*:\s*(\d+)/;
const RE_TOOL_COUNT = /"toolCount"\s*:\s*(\d+)/;
const RE_TOOL_CALLS = /\[OpenRouter\] Tool calls:\s*(.*)/;
const RE_TOOL_VALIDATED = /\[OpenRouter\] Tool validated:\s*(\w+)/;
const RE_USAGE =
  /\[OpenRouter\] Usage:\s*prompt=(\d+),\s*completion=(\d+),\s*total=(\d+)/;
const RE_STREAM_COMPLETE = /\[OpenRouter\] Stream complete:\s*(\w+)/;
const RE_RESPONSE_STATUS = /\[OpenRouter\] Response status:\s*(\d+)/;
const RE_COST_TRACKER = /\[Cost Tracker\] Total cost:\s*\$?([\d.]+)/;
const RE_PROXY_START = /\[Proxy\] Server started on port\s*(\d+)/;
const RE_TOOL_CALL_ENTRY = /([\w][\w-]*(?:__[\w-]+)*)\((\d+)\s*chars?\)/g;

// --- Types ---

/** Internal parsing state — not a JSON artifact, not exported. */
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

// --- Parsing ---

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
  const re = new RegExp(RE_TOOL_CALL_ENTRY.source, "g");
  while ((m = re.exec(toolStr)) !== null) {
    tools.push({ name: m[1], input_chars: parseInt(m[2], 10) });
  }
  return tools;
}

function preProcessLines(content: string): string[] {
  // Join multi-line JSON blocks into single lines.
  // The log format has: [timestamp] [OpenRouter Request] {\n  "key": "val",\n  ...\n}
  const rawLines = content.split("\n");
  const lines: string[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    // Detect lines ending with { that start a multi-line JSON block
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

export function parseDebugLog(logPath: string): Metrics {
  if (!existsSync(logPath)) {
    return { error: "debug.log not found", turns: [], totals: null };
  }

  let content: string;
  try {
    content = readFileSync(logPath, "utf-8");
  } catch (e: any) {
    return { error: e.message, turns: [], totals: null };
  }

  if (!content.trim()) {
    return { error: "empty debug log", turns: [], totals: null };
  }

  const lines = preProcessLines(content);

  // State tracking
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

      // Incomplete previous request → mark as retry
      if (currentRequest && !currentRequest.completed) {
        currentRequest.retry = true;
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

    // Token usage
    m = line.match(RE_USAGE);
    if (m && currentRequest) {
      currentRequest.tokens = {
        prompt: parseInt(m[1], 10),
        completion: parseInt(m[2], 10),
        total: parseInt(m[3], 10),
      };
      continue;
    }

    // Stream complete
    m = line.match(RE_STREAM_COMPLETE);
    if (m && currentRequest) {
      currentRequest.completed = true;
      currentRequest.stream_status = m[1];

      // Calculate duration
      if (ts && currentRequest.timestamp) {
        const reqTs = new Date(currentRequest.timestamp);
        if (!isNaN(reqTs.getTime())) {
          currentRequest.duration_ms = ts.getTime() - reqTs.getTime();
        }
      }

      turns.push(currentRequest);
      currentRequest = null;
      continue;
    }

    // Cost tracker
    m = line.match(RE_COST_TRACKER);
    if (m) {
      totalCost = parseFloat(m[1]);
      continue;
    }
  }

  // Handle incomplete last request
  if (currentRequest && !currentRequest.completed) {
    currentRequest.retry = true;
    turns.push(currentRequest);
  }

  // Calculate aggregates
  const completedTurns = turns.filter((t) => t.completed && !t.retry);
  const retryTurns = turns.filter((t) => t.retry);

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

  // Clean up turn data for output
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

// --- Formatting ---

function formatTable(metrics: Metrics): string {
  const lines: string[] = [];
  lines.push("=".repeat(60));
  lines.push("  DEBUG LOG METRICS");
  lines.push("=".repeat(60));

  const totals = metrics.totals;
  if (totals) {
    lines.push(`  Model:          ${totals.model ?? "unknown"}`);
    lines.push(`  Turns:          ${totals.total_turns}`);
    lines.push(`  Retries:        ${totals.total_retries}`);
    lines.push(`  Wall time:      ${totals.wall_time_ms ?? 0}ms`);
    lines.push(`  API time:       ${totals.total_time_ms}ms`);

    const tok = totals.total_tokens;
    lines.push(
      `  Tokens:         ${tok.total} (prompt=${tok.prompt}, completion=${tok.completion})`
    );

    const cost = totals.cost_usd;
    lines.push(`  Cost:           ${cost != null ? "$" + cost : "N/A"}`);
    lines.push(`  Tools used:     ${totals.unique_tools.join(", ")}`);
    lines.push(
      `  TTFT:           ${totals.time_to_first_tool_ms ?? "N/A"}ms`
    );
  }

  lines.push("");
  lines.push("  TURN DETAILS");
  lines.push("-".repeat(60));
  lines.push(`  ${"#".padStart(3)}  ${"Duration".padStart(10)}  ${"Tokens".padStart(8)}  Tools`);
  lines.push("-".repeat(60));

  for (const turn of metrics.turns) {
    const retryFlag = turn.retry ? " [RETRY]" : "";
    const duration = `${turn.duration_ms ?? "?"}ms`;
    const tokens = String(turn.tokens?.total ?? "?");
    const tools = turn.tool_calls.join(", ") || "(text only)";
    lines.push(
      `  ${String(turn.turn_number).padStart(3)}  ${duration.padStart(10)}  ${tokens.padStart(8)}  ${tools}${retryFlag}`
    );
  }

  lines.push("=".repeat(60));
  return lines.join("\n");
}

// --- CLI ---

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    output: { type: "string", short: "o" },
    format: { type: "string", short: "f", default: "json" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(
    "Usage: bun run debug-log-parser.ts <debug.log> [--output metrics.json] [--format json|table]"
  );
  process.exit(positionals.length === 0 && !values.help ? 1 : 0);
}

const metrics = parseDebugLog(positionals[0]);

const output =
  values.format === "table"
    ? formatTable(metrics)
    : JSON.stringify(metrics, null, 2);

if (values.output) {
  mkdirSync(dirname(values.output), { recursive: true });
  writeFileSync(values.output, output + "\n");
} else {
  console.log(output);
}
