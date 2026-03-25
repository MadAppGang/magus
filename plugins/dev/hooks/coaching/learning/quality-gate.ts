// Stage 6: Quality Gate
// Dedup, budget checking, and staleness tracking for learnings
// before they are written to storage.

import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { createHash } from "crypto";
import type { Learning } from "./types";

// =============================================================================
// TYPES
// =============================================================================

export interface LearningStateEntry {
  rule_text: string;
  first_seen_session: string;
  last_reinforced_session: string;
  times_seen: number;
  staged_to_claude_md: boolean;
  staged_session: string | null;
}

export interface LearningState {
  _session_count: number;
  learnings: Record<string, LearningStateEntry>; // key = sha256 hash prefix (16 chars)
}

// =============================================================================
// STATE I/O
// =============================================================================

export function loadLearningState(statePath: string): LearningState {
  if (!existsSync(statePath)) {
    return { _session_count: 0, learnings: {} };
  }
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as LearningState;
  } catch {
    return { _session_count: 0, learnings: {} };
  }
}

export function saveLearningState(statePath: string, state: LearningState): void {
  const tmp = statePath + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, statePath);
}

// =============================================================================
// HASHING
// =============================================================================

export function hashLearning(ruleText: string): string {
  return createHash("sha256").update(ruleText).digest("hex").slice(0, 16);
}

// =============================================================================
// DEDUP
// =============================================================================

/**
 * Returns true if this learning has already been staged to CLAUDE.md.
 * A learning that exists but was NOT staged yet is NOT a duplicate —
 * it can be promoted to CLAUDE.md via a new session.
 */
export function isDuplicate(learning: Learning, state: LearningState): boolean {
  const hash = hashLearning(learning.rule_text);
  const existing = state.learnings[hash];
  if (!existing) return false;
  return existing.staged_to_claude_md;
}

// =============================================================================
// STALENESS / REINFORCEMENT
// =============================================================================

/**
 * Updates last_reinforced_session and increments times_seen for an existing entry.
 * No-op if the learning is not yet in state.
 */
export function reinforceLearning(
  learning: Learning,
  state: LearningState,
  sessionId: string
): void {
  const hash = hashLearning(learning.rule_text);
  const existing = state.learnings[hash];
  if (existing) {
    existing.last_reinforced_session = sessionId;
    existing.times_seen++;
  }
}

/**
 * Registers a brand-new learning into the state map.
 * If the entry already exists this is a no-op (use reinforceLearning instead).
 *
 * Note: staged_to_claude_md is set to false here — it is only flipped to true
 * when the user approves the learning via `/dev:learn --apply` and it is
 * actually written to CLAUDE.md.
 */
export function registerLearning(
  learning: Learning,
  state: LearningState,
  sessionId: string
): void {
  const hash = hashLearning(learning.rule_text);
  if (state.learnings[hash]) return; // Already registered — use reinforceLearning
  state.learnings[hash] = {
    rule_text: learning.rule_text,
    first_seen_session: sessionId,
    last_reinforced_session: sessionId,
    times_seen: 1,
    staged_to_claude_md: false,
    staged_session: null,
  };
}

// =============================================================================
// BUDGET
// =============================================================================

/**
 * Counts non-blank lines inside the `## Learned Preferences` section of CLAUDE.md.
 * Stops counting at the next `##` heading or EOF.
 */
export function countLearnedPreferencesLines(claudeMdPath: string): number {
  if (!existsSync(claudeMdPath)) return 0;
  const content = readFileSync(claudeMdPath, "utf-8");
  const lines = content.split("\n");
  let inSection = false;
  let count = 0;
  for (const line of lines) {
    if (line.startsWith("## Learned Preferences")) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) break; // Next heading — done
    if (inSection && line.trim()) count++;
  }
  return count;
}

export const CLAUDE_MD_LINE_BUDGET = 200;

/**
 * Checks whether adding `newLineCost` more lines would exceed the budget.
 */
export function checkBudget(
  newLineCost: number,
  claudeMdPath: string
): { ok: boolean; current: number; budget: number } {
  const current = countLearnedPreferencesLines(claudeMdPath);
  return {
    ok: current + newLineCost <= CLAUDE_MD_LINE_BUDGET,
    current,
    budget: CLAUDE_MD_LINE_BUDGET,
  };
}
