#!/usr/bin/env bun
/**
 * Stop hook aggregator for the stats plugin.
 *
 * Called by stop-stats.sh with a 30-second budget.
 * Reads stdin for {transcript_path, session_id, cwd},
 * aggregates staging JSONL + transcript into SQLite,
 * cleans up staging file.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getConfig } from "../lib/config.ts";
import { getStagingPath } from "../lib/collector.ts";
import { runAggregator } from "../lib/aggregator.ts";
import type { AggregatorInput } from "../lib/types.ts";

async function main(): Promise<void> {
  let payload: Record<string, unknown> = {};

  try {
    const input = readFileSync("/dev/stdin", "utf-8");
    payload = JSON.parse(input) as Record<string, unknown>;
  } catch {
    process.exit(0);
  }

  const sessionId = payload.session_id as string | undefined;
  const transcriptPath = payload.transcript_path as string | undefined;
  const cwd = payload.cwd as string | undefined;

  if (!sessionId || !cwd) {
    process.exit(0);
  }

  const config = getConfig();

  const statsDir = join(homedir(), ".claude", "stats");
  const dbPath = join(statsDir, "stats.db");
  const stagingPath = getStagingPath(sessionId);

  const aggregatorInput: AggregatorInput = {
    session_id: sessionId,
    transcript_path: transcriptPath ?? "",
    staging_path: stagingPath,
    cwd,
    db_path: dbPath,
    config,
  };

  await runAggregator(aggregatorInput);
}

main().catch((err) => {
  process.stderr.write(`[stats] stop-stats.ts fatal error: ${err}\n`);
}).finally(() => {
  process.exit(0);
});
