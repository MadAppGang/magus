/**
 * Shared TypeScript types for the stats plugin.
 */

export type ActivityCategory = "research" | "coding" | "testing" | "delegation" | "other";

export interface StagingPreRecord {
  type: "pre";
  tool_name: string;
  timestamp: string; // ISO 8601 ms
}

export interface StagingPostRecord {
  type: "post";
  tool_name: string;
  success: boolean;
  timestamp: string; // ISO 8601 ms
}

export type StagingRecord = StagingPreRecord | StagingPostRecord;

export interface ToolCallRecord {
  tool_name: string;
  duration_ms: number; // 0 if post record missing (force-killed session)
  success: boolean;
  activity_category: ActivityCategory;
  timestamp: string; // ISO 8601
}

export interface ActivityCounts {
  research: number;
  coding: number;
  testing: number;
  delegation: number;
  other: number;
}

export interface SessionMetrics {
  session_id: string;
  date: string; // YYYY-MM-DD (local time)
  project: string; // absolute cwd
  duration_sec: number;
  inter_message_gap_sec: number;
  tool_calls: ToolCallRecord[];
  activity_counts: ActivityCounts;
}

export interface TranscriptMetrics {
  session_start?: string; // ISO timestamp of first assistant message
  session_end?: string; // ISO timestamp of last assistant message
  duration_sec: number;
  inter_message_gap_sec: number;
  tool_call_count: number; // cross-check value from transcript
  bash_commands: BashCommand[];
}

export interface BashCommand {
  tool_call_index: number; // position in transcript for correlation
  command: string; // raw command string for pattern matching
}

export interface AggregatorInput {
  session_id: string;
  transcript_path: string;
  staging_path: string;
  cwd: string;
  db_path: string;
  config: StatsConfig;
}

export interface StatsConfig {
  enabled: boolean;
  retention_days: number;
  session_summary: boolean;
}

export interface SessionRow {
  id: string;
  date: string;
  project: string;
  duration_sec: number;
  total_tool_calls: number;
  inter_message_gap_sec: number;
  research_calls: number;
  coding_calls: number;
  testing_calls: number;
  delegation_calls: number;
  other_calls: number;
  created_at: string;
}

export interface SessionSummary {
  session_count: number;
  avg_duration_sec: number;
  total_tool_calls: number;
  avg_research_ratio: number;
  avg_coding_ratio: number;
  avg_testing_ratio: number;
  avg_delegation_ratio: number;
}

export interface TopToolRow {
  tool_name: string;
  call_count: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  activity_category: string;
}

export interface DailyTrendRow {
  date: string;
  total_duration_sec: number;
  session_count: number;
}
