/**
 * debug-log-parser.ts - Slim bundle of parseDebugLogContent for monitor.ts.
 *
 * Extracts per-turn metrics from claudish debug log content (string input only).
 * No file I/O, no CLI, no formatting — just the pure parsing logic.
 *
 * Sync reference: autotest/framework/parsers/debug-log-parser.ts (canonical source)
 */

import type { ToolCall, Tokens, OutputTurn, Totals, Metrics } from "./types.ts";

// ============================================================================
// BEGIN SHARED PARSER — keep byte-identical with the other copy.
//
//   plugins/multimodel/scripts/lib/debug-log-parser.ts  (slim, for monitor.ts)
//   autotest/framework/parsers/debug-log-parser.ts      (canonical, adds a CLI)
//
// The two files legitimately differ OUTSIDE this region — shebang, header,
// imports, file I/O, table formatting, CLI. Inside it they must not differ at
// all: a parse fix landed in one copy only is how monitor.ts and the autotest
// aggregator start reporting different numbers for the same debug log.
// Enforced by scripts/check-parser-sync.ts (pre-commit, and the release-gates CI job).
// ============================================================================

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

// --- Types ---

/** Internal parsing state — not a JSON artifact, not exported. */
interface DebugTurn {
  turn_number: number;
  timestamp: string | null;
  /** The same instant as `timestamp`, kept as a Date for arithmetic. */
  requested_at: Date | null;
  /**
   * When this turn's FIRST tool call was logged. A turn can log several
   * `Tool calls:` lines; only the first one starts the clock that
   * `time_to_first_tool_ms` reports.
   */
  first_tool_at: Date | null;
  target_model?: string | null;
  original_model?: string | null;
  message_count?: number | null;
  tool_count?: number | null;
  tool_calls: ToolCall[];
  tokens: Tokens | null;
  duration_ms: number | null;
  /** The completion was stamped BEFORE the request — see `elapsed()`. */
  duration_skewed: boolean;
  completed: boolean;
  retry: boolean;
  response_status?: number | null;
  stream_status?: string;
}

/** Result of one elapsed-time measurement between two log timestamps. */
interface Elapsed {
  /** Milliseconds, or null when the measurement could not be made at all. */
  ms: number | null;
  /** True ONLY when both timestamps existed and ran backwards. */
  skewed: boolean;
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

/**
 * Elapsed milliseconds from `from` to `to`, or null when the log's own
 * timestamps make the measurement impossible.
 *
 * A `to` that precedes `from` is not a fast turn — it is a clock the log
 * cannot vouch for. Returning the negative number lets it flow into
 * total_time_ms and cancel real time out; clamping it to 0 reports a
 * measurement that was never made. Null says "not measured", and `skewed`
 * separates that from "no timestamp to measure with" so the caller can count
 * the contradictions into `totals.clock_inconsistencies`.
 */
function elapsed(from: Date | null, to: Date | null): Elapsed {
  if (!from || !to) return { ms: null, skewed: false };
  const delta = to.getTime() - from.getTime();
  return delta < 0 ? { ms: null, skewed: true } : { ms: delta, skewed: false };
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

const CH_QUOTE = 34; // "
const CH_BACKSLASH = 92; // \
const CH_OPEN_BRACE = 123; // {
const CH_CLOSE_BRACE = 125; // }

/**
 * Advance an unclosed-`{` count across one line of JSON.
 *
 * Braces inside string literals do not nest, so the scan tracks string state
 * and its backslash escapes rather than counting every brace it sees. String
 * state is deliberately NOT carried between lines: a JSON string cannot span
 * one, so resetting confines an unbalanced quote to the line that has it.
 *
 * Character codes rather than characters: this runs over every byte of the log
 * on every monitor poll.
 */
function scanBraceDepth(line: string, depth: number): number {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === CH_BACKSLASH) escaped = true;
      else if (ch === CH_QUOTE) inString = false;
      continue;
    }
    if (ch === CH_QUOTE) inString = true;
    else if (ch === CH_OPEN_BRACE) depth++;
    else if (ch === CH_CLOSE_BRACE) depth--;
  }
  return depth;
}

function preProcessLines(content: string): string[] {
  // Join multi-line JSON blocks into single lines.
  // The log format has: [timestamp] [OpenRouter Request] {\n  "key": "val",\n  ...\n}
  const rawLines = content.split("\n");

  // Unclosed-brace depth after each line, as one prefix sum over the whole
  // file. Brace nesting is additive, so a block that opens at line i has
  // returned to its opening level at line j exactly when depth[j] <= the depth
  // before i — which makes both questions below O(1) and keeps this linear.
  //
  // Scanning forward from each opener instead is quadratic, and the answer
  // matters: this log carries model output, so lines that merely LOOK like
  // block openers are producible. 20k of them took 33 seconds on a parse
  // monitor.ts re-runs every three seconds.
  const depth: number[] = new Array(rawLines.length);
  let running = 0;
  for (let k = 0; k < rawLines.length; k++) {
    running = scanBraceDepth(rawLines[k], running);
    depth[k] = running;
  }

  // The lowest depth still reachable from each line onward. A block opening at
  // line i closes SOMEWHERE iff the depth ever comes back down to where it was
  // before i — a suffix minimum, not the final depth: one stray unclosed brace
  // late in the log must not retroactively invalidate the blocks before it.
  const suffixMin: number[] = new Array(rawLines.length);
  let lowest = Infinity;
  for (let k = rawLines.length - 1; k >= 0; k--) {
    lowest = Math.min(lowest, depth[k]);
    suffixMin[k] = lowest;
  }

  const depthBefore = (k: number): number => (k === 0 ? 0 : depth[k - 1]);

  const lines: string[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    // Detect lines ending with { that start a multi-line JSON block — and that
    // the block they start actually closes.
    //
    // An unclosed block is not a block. Joining to EOF on the strength of one
    // opening brace deletes every turn after it, and the log a live monitor
    // reads always ends mid-write. Emitted on its own, a request line with no
    // closing brace does not match RE_REQUEST, so it counts as nothing rather
    // than as a turn — which is what an in-flight request is.
    const closesAt = depthBefore(i);
    if (!/\]\s*\{$/.test(line.trimEnd()) || suffixMin[i] > closesAt) {
      lines.push(line);
      i++;
      continue;
    }

    // Consume to the brace that closes the block — not to the first line that
    // happens to be just `}`. That heuristic ended the join at a NESTED
    // object's closing brace, so every field after the nested block (toolCount
    // among them) was dropped without a trace.
    let j = i;
    while (depth[j] > closesAt) j++;

    const jsonLines: string[] = [];
    for (let k = i; k <= j; k++) jsonLines.push(rawLines[k].trimEnd());
    lines.push(jsonLines.join(" "));
    i = j + 1;
  }

  return lines;
}

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
        requested_at: ts,
        first_tool_at: null,
        target_model: target?.[1] ?? null,
        original_model: original?.[1] ?? null,
        message_count: msgCount ? parseInt(msgCount[1], 10) : null,
        tool_count: toolCount ? parseInt(toolCount[1], 10) : null,
        tool_calls: [],
        tokens: null,
        duration_ms: null,
        duration_skewed: false,
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
      // Append, never assign. A turn logs one of these lines per batch the
      // model emitted, so a model that calls Read and then Bash logs two — and
      // overwriting dropped Read from the record of what the model did.
      const calls = parseToolCallsStr(m[1]);
      if (calls.length > 0) {
        if (currentRequest.tool_calls.length === 0) {
          currentRequest.first_tool_at = ts;
        }
        currentRequest.tool_calls.push(...calls);
      }
      continue;
    }

    // Token usage — old format [OpenRouter] Usage: (prefer if total present)
    m = line.match(RE_USAGE);
    if (m && currentRequest) {
      currentRequest.tokens = {
        prompt: parseInt(m[1], 10),
        completion: parseInt(m[2], 10),
        total: parseInt(m[3], 10),
      };
      continue;
    }

    // Token usage — new format [Streaming] Usage data received: (has total, prefer over final usage)
    m = line.match(RE_STREAMING_USAGE);
    if (m && currentRequest) {
      // Only overwrite if we don't already have tokens with a total (old format wins if present)
      if (!currentRequest.tokens || currentRequest.tokens.total === 0) {
        currentRequest.tokens = {
          prompt: parseInt(m[1], 10),
          completion: parseInt(m[2], 10),
          total: parseInt(m[3], 10),
        };
      }
      continue;
    }

    // Token usage — new format [Streaming] Final usage: (no total, only use as fallback)
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

    // Stream complete — old format [OpenRouter] Stream complete:
    m = line.match(RE_STREAM_COMPLETE);
    if (m && currentRequest) {
      currentRequest.completed = true;
      currentRequest.stream_status = m[1];
      const took = elapsed(currentRequest.requested_at, ts);
      currentRequest.duration_ms = took.ms;
      currentRequest.duration_skewed = took.skewed;

      turns.push(currentRequest);
      currentRequest = null;
      continue;
    }

    // Stream complete — new format finish_reason=stop in streaming chunk
    if (RE_STREAMING_FINISH.test(line) && currentRequest) {
      currentRequest.completed = true;
      currentRequest.stream_status = "stop";
      const took = elapsed(currentRequest.requested_at, ts);
      currentRequest.duration_ms = took.ms;
      currentRequest.duration_skewed = took.skewed;

      // Don't push yet — wait for usage data that follows in the next lines
      // We set completed=true here and will push when we encounter the next request or EOF
      continue;
    }

    // Cost tracker
    m = line.match(RE_COST_TRACKER);
    if (m) {
      totalCost = parseFloat(m[1]);
      continue;
    }
  }

  // Handle last request (push whether complete or not; mark incomplete as retry)
  if (currentRequest) {
    if (!currentRequest.completed) {
      currentRequest.retry = true;
    }
    turns.push(currentRequest);
  }

  // Calculate aggregates — single pass to categorize turns
  const completedTurns: DebugTurn[] = [];
  const retryTurns: DebugTurn[] = [];
  for (const t of turns) {
    if (t.retry) retryTurns.push(t);
    else if (t.completed) completedTurns.push(t);
  }

  // Every elapsed-time measurement the log's own timestamps contradicted.
  // Reported alongside the metrics so a consumer can tell "not measured" from
  // "measured as zero" instead of silently trusting a shortened total.
  let clockInconsistencies = 0;
  for (const turn of turns) {
    if (turn.duration_skewed) clockInconsistencies++;
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
    // `!== null`, not truthiness: a turn that really took 0ms is a measurement.
    if (turn.duration_ms !== null) totalDurationMs += turn.duration_ms;
    for (const tc of turn.tool_calls) allToolCalls.push(tc.name);
  }

  // Time from the session's first log line to the first tool call it executed.
  // NOT the duration of the turn that happened to contain that call — that
  // answers a different question, and answered it under this field's name.
  // Scoped to completed turns so it describes the same first call that
  // tool_call_sequence[0] does; a retry's tools never ran.
  let timeToFirstToolMs: number | null = null;
  for (const turn of completedTurns) {
    if (turn.tool_calls.length === 0) continue;
    const ttft = elapsed(firstTimestamp, turn.first_tool_at);
    if (ttft.skewed) clockInconsistencies++;
    timeToFirstToolMs = ttft.ms;
    break;
  }

  // Wall clock time
  const wall = elapsed(firstTimestamp, lastTimestamp);
  if (wall.skewed) clockInconsistencies++;
  const wallTimeMs: number | null = wall.ms;

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
    clock_inconsistencies: clockInconsistencies,
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

export function parseDebugLogContent(content: string): Metrics {
  if (!content.trim()) {
    return { error: "empty debug log", turns: [], totals: null };
  }
  return parseLinesInternal(preProcessLines(content));
}

// ============================================================================
// END SHARED PARSER
// ============================================================================
