/**
 * types.ts - Canonical TypeScript interfaces for all autotest framework JSON artifacts.
 *
 * All other framework files import from here. No logic — types only.
 */

// ---------------------------------------------------------------------------
// Debug log parser types (moved from debug-log-parser.ts)
// ---------------------------------------------------------------------------

export interface ToolCall {
  name: string;
  input_chars: number;
}

export interface Tokens {
  prompt: number;
  completion: number;
  total: number;
}

/** Internal parsing state for debug-log-parser.ts. Not a JSON artifact. */
export interface DebugTurn {
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

export interface OutputTurn {
  turn_number: number;
  timestamp: string | null;
  duration_ms: number | null;
  tool_calls: string[];
  tokens: Tokens | null;
  retry: boolean;
  stream_status?: string;
  message_count?: number | null;
}

export interface Totals {
  total_turns: number;
  total_retries: number;
  total_time_ms: number;
  wall_time_ms: number | null;
  total_tokens: Tokens;
  time_to_first_tool_ms: number | null;
  tool_call_sequence: string[];
  unique_tools: string[];
  cost_usd: number | null;
  model: string | null;
}

export interface Metrics {
  turns: OutputTurn[];
  totals: Totals | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Aggregator types (moved/extended from aggregate-results.ts)
// ---------------------------------------------------------------------------

/**
 * Per-test record inside results-summary.json.
 * Enriched with 7 new optional fields (Problem 7 fix).
 */
export interface RunEntry {
  test_id: string;
  model: string;
  result: string;
  expected_agent: string;
  actual_agent: string;
  duration_seconds: number;
  exit_code: number;
  // Token totals (always present, 0 if no metrics.json)
  total_tokens: number;
  cost_usd?: number;
  // Enriched fields from metrics.json totals:
  prompt_tokens?: number;
  completion_tokens?: number;
  turns?: number;
  retries?: number;
  unique_tools?: string[];
  wall_time_ms?: number;
  time_to_first_tool_ms?: number | null;
}

export interface ResultsSummary {
  runs: RunEntry[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    pass_rate: number;
    agent_distribution: Record<string, number>;
  };
  by_model: Record<string, { passed: number; failed: number; error: number }>;
  suite: string;
  models: string[];
}

// ---------------------------------------------------------------------------
// Comparator types (moved from metrics-aggregator.ts)
// ---------------------------------------------------------------------------

export interface TestEntry {
  test_id: string;
  model_slug: string;
  model: string;
  duration_seconds: number;
  exit_code: number;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_turns?: number;
  total_retries?: number;
  time_to_first_tool_ms?: number | null;
  api_time_ms?: number;
  wall_time_ms?: number;
  cost_usd?: number | null;
  unique_tools?: string[];
}

export interface ModelComparison {
  run_id: string;
  suite: string;
  models: string[];
  test_cases: number;
  comparison: ComparisonEntry[];
  aggregate_stats: Record<string, AggregateStats>;
  error?: string;
}

export interface ComparisonEntry {
  test_id: string;
  results: Record<string, TestResult>;
  winner: Record<string, string>;
}

export interface TestResult {
  passed: boolean;
  result: string;
  duration_ms: number;
  api_time_ms: number;
  tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  turns: number;
  retries: number;
  cost_usd: number | null;
  tools: string[];
}

export interface AggregateStats {
  model: string;
  tests_run: number;
  pass_rate: number;
  avg_duration_ms: number;
  avg_tokens: number;
  total_tokens: number;
  avg_cost_usd: number | null;
  total_cost_usd: number | null;
  avg_turns: number;
  total_retries: number;
}

// ---------------------------------------------------------------------------
// Transcript parser types
// ---------------------------------------------------------------------------

/** Raw entry from transcript.jsonl */
export interface TranscriptEntry {
  type: string; // "session_start" | "assistant" | "tool_result" | "session_end"
  id?: string;
  timestamp?: string;
  message?: {
    content: TranscriptContentBlock[];
  };
  result?: string | object;
  // parse_error fields:
  line?: number;
  raw?: string;
}

export interface TranscriptContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
}

/** Structured turn for replay and analysis (replaces replay.ts Turn interface). */
export interface ReplayTurn {
  turn_number: number;
  type: string;
  session_id?: string;
  timestamp?: string;
  content?: string;
  text?: string;
  tool_calls?: TranscriptToolCall[];
  metrics?: any;
  tool_id?: string;
  result?: string;
}

export interface TranscriptToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Evaluation types
// ---------------------------------------------------------------------------

export interface TestCase {
  id: string;
  prompt?: string;
  expected_agent?: string;
  expected_alternatives?: string[];
  // Any other fields from test-cases.json
  [key: string]: any;
}

export type EvalResult =
  | "PASS"
  | "PASS_ALT"
  | "PASS_DELEGATED"
  | "FAIL"
  | "FAIL_OVER_DELEGATED"
  | "NO_DELEGATION"
  | "TIMEOUT"
  | "ERROR";
