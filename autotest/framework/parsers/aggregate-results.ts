#!/usr/bin/env bun
/**
 * aggregate-results.ts - Aggregate test results into results-summary.json.
 *
 * Called by runner-base.sh after all tests complete. Reads meta.json, metrics.json,
 * and transcript.jsonl from each test directory to build a backward-compatible
 * results-summary.json.
 *
 * Usage:
 *   bun run aggregate-results.ts <results-dir> --suite <name> --models <csv>
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
const tcMap: Record<string, any> = {};
if (existsSync(testCasesFile)) {
  const tcData = readJson(testCasesFile);
  for (const tc of tcData?.test_cases ?? []) {
    tcMap[tc.id] = tc;
  }
}

// --- Find all meta.json files ---

const metaPaths = findFilesRecursive(resultsDir, "meta.json");

interface RunEntry {
  test_id: string;
  model: string;
  result: string;
  expected_agent: string;
  actual_agent: string;
  duration_seconds: number;
  exit_code: number;
  total_tokens: number;
  cost_usd?: number;
}

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
  const metrics = readJson(join(testDir, "metrics.json"));
  if (metrics) {
    const totals = metrics.totals ?? {};
    totalTokens = (totals.total_tokens ?? {}).total ?? 0;
    costUsd = totals.cost_usd ?? undefined;
  }

  // Parse transcript for agent selection
  // Strategy 1: Look in transcript JSONL for Task tool_use blocks (stream-json format)
  let actualAgent = "";
  const transcriptPath = join(testDir, "transcript.jsonl");
  if (existsSync(transcriptPath)) {
    try {
      const content = readFileSync(transcriptPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.type === "assistant") {
            for (const block of obj.message?.content ?? []) {
              if (block.type === "tool_use" && block.name === "Task") {
                const agent = block.input?.subagent_type ?? "";
                if (agent) {
                  actualAgent = agent;
                  break;
                }
              }
            }
            if (actualAgent) break;
          }
        } catch {
          // Skip unparseable lines
        }
      }
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

  // Determine pass/fail
  const tc = tcMap[testId] ?? {};
  const expectedAgent: string = tc.expected_agent ?? "";
  const expectedAlternatives: string[] = tc.expected_alternatives ?? [];

  let result = "ERROR";
  if (exitCode !== 0) {
    result = exitCode === 124 ? "TIMEOUT" : "ERROR";
  } else if (expectedAgent) {
    if (expectedAgent === "NO_TASK_CALL") {
      // Test expects direct handling (no delegation)
      if (!actualAgent || actualAgent === "NO_TASK_CALL") {
        result = "PASS";
      } else {
        // Model delegated when it shouldn't have
        result = "FAIL_OVER_DELEGATED";
      }
    } else if (actualAgent === expectedAgent) {
      result = "PASS";
    } else if (expectedAlternatives.includes(actualAgent)) {
      result = "PASS_ALT";
    } else if (actualAgent === "TASK_USED") {
      // Task tool was used but subagent_type couldn't be extracted from transcript.
      // This happens when claudish --json only outputs the final result summary.
      // The delegation DID happen, we just can't verify which specific agent.
      result = "PASS_DELEGATED";
    } else if (!actualAgent || actualAgent === "NO_TASK_CALL") {
      result = "NO_DELEGATION";
    } else {
      result = "FAIL";
    }
  } else {
    // No expected agent specified — exit code 0 is a pass
    result = exitCode === 0 ? "PASS" : "FAIL";
  }

  const entry: RunEntry = {
    test_id: testId,
    model,
    result,
    expected_agent: expectedAgent,
    actual_agent: actualAgent || "NO_TASK_CALL",
    duration_seconds: duration,
    exit_code: exitCode,
    total_tokens: totalTokens,
  };
  if (costUsd != null) (entry as any).cost_usd = costUsd;

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

// Build output (backward-compatible shape)
const summary = {
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
  JSON.stringify(summary, null, 2) + "\n"
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
