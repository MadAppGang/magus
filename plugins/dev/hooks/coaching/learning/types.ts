// Shared TypeScript interfaces for the learning daemon pipeline (Stages 3-6)

// Re-exported from analyzer.ts Stage 2 for compatibility
export interface QueueEntry {
  session_id: string;
  transcript_path: string;
  queued_at: string;
  cwd: string;
  tool_call_count: number;
  rule_based_signals: string[];
  learning_signals: {
    corrections: { count: number; phrases: string[] };
    explicitRules: { count: number; phrases: string[] };
    repeatedPatterns: number;
    failedAttempts: number;
    messageCount: number;
    toolCallCount: number;
  };
  learning_score: number;
}

export interface SessionSummary {
  session_id: string;
  cwd: string;
  transcript_path: string;
  queued_at: string;
  learning_score: number;
  user_messages: Array<{
    index: number;
    text: string;
    has_correction: boolean;
    has_explicit_rule: boolean;
  }>;
  tool_call_summary: {
    total: number;
    by_tool: Record<string, number>;
    failed_sequences: Array<{ first_cmd: string; second_cmd: string }>;
  };
  rule_based_signals: string[];
}

export interface Learning {
  id: string; // "learning-{sha256-first-8}"
  type:
    | "correction"
    | "explicit_rule"
    | "repeated_pattern"
    | "failed_attempt"
    | "delegation_pattern"
    | "user_frustration"
    | "user_praise";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  is_project_specific: boolean;
  scope: "claude_md" | "memory" | "coaching" | "discard";
  rule_text: string;
  evidence: string;
  subsection: string; // e.g., "Tools & Commands", "Conventions"
  line_cost: number;
}

export interface ClassifierResult {
  learnings: Learning[];
  session_quality: "high" | "medium" | "low";
  summary: string;
}

export interface DaemonState {
  circuit_breaker: {
    consecutive_failures: number;
    disabled_until: string | null; // ISO timestamp
  };
  last_run: string | null; // ISO timestamp
  total_processed: number;
  total_queued_for_approval: number;
}
