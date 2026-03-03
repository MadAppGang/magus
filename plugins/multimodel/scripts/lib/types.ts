/**
 * types.ts - Slim type bundle for monitor.ts.
 *
 * Contains only the types needed by the process observability monitor.
 * Sync reference: autotest/framework/types.ts (canonical source)
 */

// ---------------------------------------------------------------------------
// Debug log parser types (subset used by monitor.ts via parseDebugLogContent)
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
// Monitor types (used by monitor.ts directly)
// ---------------------------------------------------------------------------

export type ProcessState =
  | "STARTING"
  | "ACTIVE"
  | "CALLING_API"
  | "TOOL_EXECUTING"
  | "STALLED"
  | "COMPLETED"
  | "ERRORED"
  | "KILLED"
  | "SKIPPED";

export interface ModelStatus {
  model_id: string;
  model_slug: string;
  state: ProcessState;
  turns_completed: number;
  retries: number;
  consecutive_retries: number;
  tokens_so_far: number;
  tool_calls: string[];
  elapsed_seconds: number;
  last_activity_seconds_ago: number;
  stall_during_api_call: boolean;
  pid: number | null;
  exit_code: number | null;
  result_file_bytes: number;
  debug_log_path: string;
  error_message: string | null;
}

export interface MonitorStatus {
  session_id: string;
  generated_at: string;
  elapsed_seconds: number;
  timeout_seconds: number;
  poll_count: number;
  models: ModelStatus[];
}

export interface MonitorFinal extends MonitorStatus {
  summary: {
    all_completed: boolean;
    completed_models: string[];
    stalled_models: string[];
    errored_models: string[];
    killed_models: string[];
    skipped_models: string[];
    total_tokens_all_models: number;
    total_turns_all_models: number;
    wall_time_seconds: number;
  };
}
