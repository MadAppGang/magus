#!/usr/bin/env bun
/**
 * SessionStart hook for the stats plugin.
 *
 * Queries the last 5 sessions for the current project and injects
 * a brief summary into the session context.
 *
 * Output format: { "context": "..." }
 * Must complete within the 5-second budget.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { getConfig } from "../lib/config.ts";
import { openDb, getLastNSessions } from "../lib/db.ts";
import { getSuggestions } from "../lib/suggestions.ts";
import type { SessionRow } from "../lib/types.ts";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

function formatSummary(sessions: SessionRow[]): string {
  if (sessions.length === 0) return "";

  const count = sessions.length;
  const totalCalls = sessions.reduce((sum, s) => sum + s.total_tool_calls, 0);
  const avgCalls = Math.round(totalCalls / count);
  const avgDurationSec = Math.round(
    sessions.reduce((sum, s) => sum + s.duration_sec, 0) / count
  );

  // Compute activity ratios across all sessions
  const totalResearch = sessions.reduce((sum, s) => sum + s.research_calls, 0);
  const totalCoding = sessions.reduce((sum, s) => sum + s.coding_calls, 0);
  const totalTesting = sessions.reduce((sum, s) => sum + s.testing_calls, 0);
  const totalDelegation = sessions.reduce((sum, s) => sum + s.delegation_calls, 0);
  const classified = totalResearch + totalCoding + totalTesting + totalDelegation;

  let activityStr = "";
  if (classified > 0) {
    const researchPct = Math.round((totalResearch / classified) * 100);
    const codingPct = Math.round((totalCoding / classified) * 100);
    const testingPct = Math.round((totalTesting / classified) * 100);
    const delegationPct = Math.round((totalDelegation / classified) * 100);

    const parts: string[] = [];
    if (researchPct > 0) parts.push(`${researchPct}% research`);
    if (codingPct > 0) parts.push(`${codingPct}% coding`);
    if (testingPct > 0) parts.push(`${testingPct}% testing`);
    if (delegationPct > 0) parts.push(`${delegationPct}% delegation`);
    activityStr = parts.slice(0, 3).join(" / ");
  }

  let summary = `[stats] ${count} session${count > 1 ? "s" : ""}: avg ${avgCalls} tools, ${formatDuration(avgDurationSec)}`;
  if (activityStr) summary += ` — ${activityStr}`;

  return summary;
}

async function main(): Promise<void> {
  let payload: Record<string, unknown> = {};

  try {
    const input = readFileSync("/dev/stdin", "utf-8");
    payload = JSON.parse(input) as Record<string, unknown>;
  } catch {
    process.exit(0);
  }

  const cwd = payload.cwd as string | undefined;
  if (!cwd) process.exit(0);

  const config = getConfig();
  if (!config.enabled || !config.session_summary) process.exit(0);

  const statsDir = join(homedir(), ".claude", "stats");
  const dbPath = join(statsDir, "stats.db");

  if (!existsSync(dbPath)) process.exit(0);

  try {
    const db = openDb(dbPath);
    try {
      const sessions = getLastNSessions(db, 5, cwd);

      if (sessions.length === 0) {
        // No sessions for this project — no injection
        process.exit(0);
      }

      const summary = formatSummary(sessions);

      // Get suggestions based on recent session patterns
      const suggestionTexts = getSuggestions(sessions);

      let contextText = summary;
      if (suggestionTexts.length > 0) {
        contextText += "\n" + suggestionTexts.map((s) => `[stats tip] ${s}`).join("\n");
      }

      // Output JSON context injection (Claude Code SessionStart format)
      const output = JSON.stringify({ context: contextText });
      process.stdout.write(output);
    } finally {
      db.close();
    }
  } catch {
    // SQLite error — silent exit, non-fatal
  }
}

main().catch(() => {
  // All errors are non-fatal
}).finally(() => {
  process.exit(0);
});
