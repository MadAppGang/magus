/**
 * Rule-based suggestion engine for the stats plugin.
 * Analyzes recent session data and generates actionable productivity suggestions.
 */

import type { SessionRow } from "./types.ts";

export interface Suggestion {
  id: string;
  message: string;
}

/**
 * Analyze recent sessions and return productivity suggestions.
 *
 * @param sessions - Recent session rows from the database (most recent first)
 * @returns Array of suggestion strings
 */
export function getSuggestions(sessions: SessionRow[]): string[] {
  if (sessions.length === 0) return [];

  const suggestions: string[] = [];

  // Compute aggregate metrics across sessions
  const totalCalls = sessions.reduce((sum, s) => sum + s.total_tool_calls, 0);
  const totalResearch = sessions.reduce((sum, s) => sum + s.research_calls, 0);
  const totalCoding = sessions.reduce((sum, s) => sum + s.coding_calls, 0);
  const totalTesting = sessions.reduce((sum, s) => sum + s.testing_calls, 0);
  const totalDelegation = sessions.reduce((sum, s) => sum + s.delegation_calls, 0);

  const classified = totalResearch + totalCoding + totalTesting + totalDelegation;
  const denominator = classified > 0 ? classified : 1;

  const researchRatio = totalResearch / denominator;
  const testingRatio = totalTesting / denominator;

  // Rule 1: High research ratio — suggest mnemex for semantic search
  if (researchRatio > 0.4 && totalResearch > 10) {
    suggestions.push(
      "High research ratio detected (>40% of tool calls are Read/Grep/Glob). " +
      "Consider using the code-analysis plugin with mnemex for semantic symbol search — " +
      "it can replace dozens of sequential Reads with a single indexed query."
    );
  }

  // Rule 2: Low testing ratio — suggest TDD workflow
  if (testingRatio < 0.05 && totalCalls > 20) {
    suggestions.push(
      "Low testing ratio (<5% of classified calls). " +
      "Consider adopting TDD: run `bun test --watch` via the terminal plugin to get " +
      "a continuous test feedback loop while coding."
    );
  }

  // Rule 3: Session duration trend increasing
  if (sessions.length >= 3) {
    const recent = sessions.slice(0, 3);
    const older = sessions.slice(-3);
    const avgRecent =
      recent.reduce((sum, s) => sum + s.duration_sec, 0) / recent.length;
    const avgOlder =
      older.reduce((sum, s) => sum + s.duration_sec, 0) / older.length;

    if (avgOlder > 0 && avgRecent > avgOlder * 1.5) {
      suggestions.push(
        "Session duration has increased significantly recently. " +
        "Consider breaking large tasks into smaller focused sessions, " +
        "or using task delegation to parallelize work."
      );
    }
  }

  // Rule 4: Detect many sequential Read calls (heuristic from session data)
  // If research ratio is very high and delegation is very low, suggest Glob/Grep
  if (researchRatio > 0.5 && totalDelegation === 0 && totalResearch > 20) {
    suggestions.push(
      "Many sequential read operations with no task delegation detected. " +
      "Use Grep to search file contents and Glob to find files by pattern " +
      "instead of reading files one by one."
    );
  }

  return suggestions;
}
