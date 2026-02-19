#!/usr/bin/env bun
/**
 * aggregator.ts - Aggregate test results into results-summary.json.
 *
 * Replaces parsers/aggregate-results.ts. Uses transcript-parser and evaluator
 * modules. Enriches RunEntry with 7 new fields from metrics.json.
 *
 * Usage:
 *   bun run aggregator.ts <results-dir> --suite <name> --models <csv>
 *
 * Environment:
 *   OUTPUT_DIR  - Results directory (fallback if no positional arg)
 *   SUITE       - Suite name
 *   MODELS_STR  - Comma-separated model list
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import { parseArgs } from "util";
import type { RunEntry, ResultsSummary, TestCase } from "./types.js";
import {
  parseTranscriptFile,
  extractAgentFromTranscript,
} from "./parsers/transcript-parser.js";
import { evaluate } from "./evaluator.js";

// --- Helpers ---

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function findFilesRecursive(dir: string, filename: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (entry === filename) results.push(full);
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  walk(dir);
  return results.sort();
}

// --- CLI args ---

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    suite: { type: "string" },
    models: { type: "string" },
  },
  allowPositionals: true,
});

const resultsDir =
  positionals[0] ?? process.env.OUTPUT_DIR ?? "";
const suite = values.suite ?? process.env.SUITE ?? "";
const modelsStr = values.models ?? process.env.MODELS_STR ?? "";

if (!resultsDir) {
  console.error("ERROR: results directory required");
  process.exit(1);
}

// --- Load test cases ---

const testCasesFile = join(resultsDir, "test-cases.json");
const tcMap: Record<string, TestCase> = {};
if (existsSync(testCasesFile)) {
  const tcData = readJson(testCasesFile);
  for (const tc of tcData?.test_cases ?? []) {
    tcMap[tc.id] = tc;
  }
}

// --- Find all meta.json files ---

const metaPaths = findFilesRecursive(resultsDir, "meta.json");
const runs: RunEntry[] = [];

for (const metaPath of metaPaths) {
  const meta = readJson(metaPath);
  if (!meta) continue;

  const testId: string = meta.test_id ?? "";
  const model: string = meta.model ?? "";
  const exitCode: number = meta.exit_code ?? -1;
  const duration: number = meta.duration_seconds ?? 0;

  const testDir = dirname(metaPath);

  // Load metrics
  let totalTokens = 0;
  let costUsd: number | undefined;
  let promptTokens = 0;
  let completionTokens = 0;
  let turns = 0;
  let retries = 0;
  let uniqueTools: string[] = [];
  let wallTimeMs: number | undefined;
  let timeToFirstToolMs: number | null | undefined;

  const metrics = readJson(join(testDir, "metrics.json"));
  if (metrics) {
    const totals = metrics.totals ?? {};
    totalTokens = (totals.total_tokens ?? {}).total ?? 0;
    costUsd = totals.cost_usd ?? undefined;
    // Enriched fields:
    promptTokens = (totals.total_tokens ?? {}).prompt ?? 0;
    completionTokens = (totals.total_tokens ?? {}).completion ?? 0;
    turns = totals.total_turns ?? 0;
    retries = totals.total_retries ?? 0;
    uniqueTools = totals.unique_tools ?? [];
    wallTimeMs = totals.wall_time_ms ?? undefined;
    timeToFirstToolMs = totals.time_to_first_tool_ms ?? null;
  }

  // Parse transcript for agent selection
  // Strategy 1: Look in transcript JSONL for Task tool_use blocks (stream-json format)
  let actualAgent = "";
  const transcriptPath = join(testDir, "transcript.jsonl");
  if (existsSync(transcriptPath)) {
    try {
      const entries = parseTranscriptFile(transcriptPath);
      actualAgent = extractAgentFromTranscript(entries);
    } catch {
      // Skip unreadable transcripts
    }
  }

  // Strategy 2: Fall back to metrics.json tool_call_sequence
  // claudish --json only outputs the final result (no intermediate tool calls),
  // but the debug log parser captures tool_call_sequence from the debug log.
  if (!actualAgent && metrics) {
    const toolSeq: string[] = metrics.totals?.tool_call_sequence ?? [];
    if (toolSeq.includes("Task")) {
      actualAgent = "TASK_USED";
    }
  }

  // Determine pass/fail using pure evaluator
  const tc: TestCase = tcMap[testId] ?? { id: testId };
  const result = evaluate(tc, actualAgent, exitCode);

  const entry: RunEntry = {
    test_id: testId,
    model,
    result,
    expected_agent: tc.expected_agent ?? "",
    actual_agent: actualAgent || "NO_TASK_CALL",
    duration_seconds: duration,
    exit_code: exitCode,
    total_tokens: totalTokens,
    // Enriched fields:
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    turns,
    retries,
    unique_tools: uniqueTools,
  };

  if (costUsd != null) entry.cost_usd = costUsd;
  if (wallTimeMs != null) entry.wall_time_ms = wallTimeMs;
  if (timeToFirstToolMs !== undefined) entry.time_to_first_tool_ms = timeToFirstToolMs;

  runs.push(entry);
}

// --- Calculate summary ---

const total = runs.length;
const passed = runs.filter((r) => r.result.startsWith("PASS")).length;
const failed = runs.filter((r) => r.result.startsWith("FAIL")).length;
const errors = total - passed - failed;

// Agent distribution
const agentCounts: Record<string, number> = {};
for (const r of runs) {
  const agent = r.actual_agent ?? "UNKNOWN";
  agentCounts[agent] = (agentCounts[agent] ?? 0) + 1;
}

// Per-model breakdown
const byModel: Record<string, { passed: number; failed: number; error: number }> = {};
for (const r of runs) {
  if (!byModel[r.model]) byModel[r.model] = { passed: 0, failed: 0, error: 0 };
  if (r.result.startsWith("PASS")) byModel[r.model].passed++;
  else if (r.result.startsWith("FAIL")) byModel[r.model].failed++;
  else byModel[r.model].error++;
}

// Build output (backward-compatible shape + enriched fields)
const summaryOutput: ResultsSummary = {
  runs,
  summary: {
    total,
    passed,
    failed,
    errors,
    pass_rate: total > 0 ? Math.round((passed / total) * 1000) / 10 : 0,
    agent_distribution: agentCounts,
  },
  by_model: byModel,
  suite,
  models: modelsStr ? modelsStr.split(",") : [],
};

writeFileSync(
  join(resultsDir, "results-summary.json"),
  JSON.stringify(summaryOutput, null, 2) + "\n"
);

// --- Print summary ---

console.log("=== Results Summary ===");
console.log();
console.log(`Total: ${total} | Pass: ${passed} | Fail: ${failed} | Error: ${errors}`);
if (total > 0) {
  console.log(`Pass Rate: ${Math.round((passed / total) * 1000) / 10}%`);
}
console.log();

const modelEntries = Object.entries(byModel);
if (modelEntries.length > 1) {
  console.log("By Model:");
  for (const [m, stats] of modelEntries.sort()) {
    const mTotal = stats.passed + stats.failed + stats.error;
    const mRate = mTotal > 0 ? Math.round((stats.passed / mTotal) * 1000) / 10 : 0;
    console.log(
      `  ${m.padEnd(40)}  pass=${stats.passed}  fail=${stats.failed}  err=${stats.error}  rate=${mRate}%`
    );
  }
  console.log();
}

// Detailed results table
console.log("=== Detailed Results ===");
console.log();
const header = `${"TEST_ID".padEnd(30)} ${"MODEL".padEnd(25)} ${"EXPECTED".padEnd(25)} ${"ACTUAL".padEnd(25)} ${"RESULT".padEnd(10)} ${"TIME".padEnd(6)}`;
console.log(header);
console.log("-".repeat(header.length));
for (const r of runs) {
  console.log(
    `${r.test_id.padEnd(30)} ${r.model.padEnd(25)} ${r.expected_agent.padEnd(25)} ${r.actual_agent.padEnd(25)} ${r.result.padEnd(10)} ${String(r.duration_seconds).padStart(4)}s`
  );
}
console.log();

// Agent distribution
if (Object.keys(agentCounts).length > 0) {
  console.log("Agent Distribution:");
  const sorted = Object.entries(agentCounts).sort((a, b) => b[1] - a[1]);
  for (const [agent, count] of sorted) {
    const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    console.log(`  ${agent}: ${count} (${pct}%)`);
  }
  console.log();
}
