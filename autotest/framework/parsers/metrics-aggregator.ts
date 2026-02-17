#!/usr/bin/env bun
/**
 * metrics-aggregator.ts - Aggregate metrics across models for comparison.
 *
 * Reads per-test metrics.json files from a run directory and generates
 * a model-comparison report showing speed, token usage, cost, and accuracy.
 *
 * Usage:
 *   bun run metrics-aggregator.ts <results-dir> [--output comparison.json] [--format json|table]
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "fs";
import { join, dirname } from "path";
import { parseArgs } from "util";

// --- Types ---

interface TestEntry {
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

interface ModelComparison {
  run_id: string;
  suite: string;
  models: string[];
  test_cases: number;
  comparison: any[];
  aggregate_stats: Record<string, any>;
  error?: string;
}

// --- Helpers ---

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isDirectory())
    .sort();
}

// --- Core ---

function loadRunData(
  resultsDir: string
): [any, any, Record<string, TestEntry[]>] {
  const config = readJson(join(resultsDir, "config.json")) ?? {};
  const summary = readJson(join(resultsDir, "results-summary.json")) ?? {};

  const modelResults: Record<string, TestEntry[]> = {};

  for (const modelDir of listDirs(resultsDir)) {
    const modelSlug = modelDir.split("/").pop()!;
    if (modelSlug === "comparison") continue;

    for (const testDir of listDirs(modelDir)) {
      const testId = testDir.split("/").pop()!;

      // Check for run subdirectories (multi-run mode)
      const runDirs = listDirs(testDir).filter((d) =>
        d.split("/").pop()!.startsWith("run-")
      );

      const dirsToProcess = runDirs.length > 0 ? runDirs : [testDir];

      for (const dataDir of dirsToProcess) {
        const entry = loadTestEntry(dataDir, testId, modelSlug);
        if (entry) {
          if (!modelResults[modelSlug]) modelResults[modelSlug] = [];
          modelResults[modelSlug].push(entry);
        }
      }
    }
  }

  return [config, summary, modelResults];
}

function loadTestEntry(
  dataDir: string,
  testId: string,
  modelSlug: string
): TestEntry | null {
  const metaPath = join(dataDir, "meta.json");
  const metricsPath = join(dataDir, "metrics.json");

  const meta = readJson(metaPath);
  if (!meta) return null;

  const entry: TestEntry = {
    test_id: testId,
    model_slug: modelSlug,
    model: meta.model ?? modelSlug,
    duration_seconds: meta.duration_seconds ?? 0,
    exit_code: meta.exit_code ?? -1,
  };

  const metrics = readJson(metricsPath);
  if (metrics) {
    const totals = metrics.totals ?? {};
    const tokens = totals.total_tokens ?? {};
    entry.total_tokens = tokens.total ?? 0;
    entry.prompt_tokens = tokens.prompt ?? 0;
    entry.completion_tokens = tokens.completion ?? 0;
    entry.total_turns = totals.total_turns ?? 0;
    entry.total_retries = totals.total_retries ?? 0;
    entry.time_to_first_tool_ms = totals.time_to_first_tool_ms ?? null;
    entry.api_time_ms = totals.total_time_ms ?? 0;
    entry.wall_time_ms = totals.wall_time_ms ?? 0;
    entry.cost_usd = totals.cost_usd ?? null;
    entry.unique_tools = totals.unique_tools ?? [];
  }

  return entry;
}

function buildComparison(
  config: any,
  summary: any,
  modelResults: Record<string, TestEntry[]>
): ModelComparison {
  const models = Object.keys(modelResults).sort();
  if (models.length === 0) {
    return {
      error: "No model results found",
      run_id: "unknown",
      suite: "unknown",
      models: [],
      test_cases: 0,
      comparison: [],
      aggregate_stats: {},
    };
  }

  // All test IDs
  const allTestIds = [
    ...new Set(
      Object.values(modelResults)
        .flat()
        .map((e) => e.test_id)
    ),
  ].sort();

  // Result map from summary
  const resultMap = new Map<string, string>();
  for (const run of summary.runs ?? []) {
    resultMap.set(`${run.test_id}::${run.model}`, run.result ?? "UNKNOWN");
  }

  // Per-test comparison
  const comparison = allTestIds.map((testId) => {
    const testEntry: any = { test_id: testId, results: {} };

    for (const modelSlug of models) {
      const entries = (modelResults[modelSlug] ?? []).filter(
        (e) => e.test_id === testId
      );
      if (entries.length === 0) continue;

      const entry = entries[0];
      const modelName = entry.model;
      const resultKey = `${testId}::${modelName}`;
      const result = resultMap.get(resultKey) ?? "UNKNOWN";
      const passed = result.startsWith("PASS")
        ? true
        : result === "UNKNOWN"
          ? entry.exit_code === 0
          : false;

      testEntry.results[modelSlug] = {
        passed,
        result,
        duration_ms:
          entry.wall_time_ms || entry.duration_seconds * 1000,
        api_time_ms: entry.api_time_ms ?? 0,
        tokens: entry.total_tokens ?? 0,
        prompt_tokens: entry.prompt_tokens ?? 0,
        completion_tokens: entry.completion_tokens ?? 0,
        turns: entry.total_turns ?? 0,
        retries: entry.total_retries ?? 0,
        cost_usd: entry.cost_usd ?? null,
        tools: entry.unique_tools ?? [],
      };
    }

    // Winners (among passing models)
    const passing = Object.entries(testEntry.results).filter(
      ([, r]: any) => r.passed
    ) as [string, any][];
    const winners: Record<string, string> = {};
    if (passing.length > 0) {
      winners.speed = passing.reduce((a, b) =>
        a[1].duration_ms <= b[1].duration_ms ? a : b
      )[0];
      winners.cost = passing.reduce((a, b) =>
        (a[1].cost_usd ?? Infinity) <= (b[1].cost_usd ?? Infinity) ? a : b
      )[0];
      winners.tokens = passing.reduce((a, b) =>
        a[1].tokens <= b[1].tokens ? a : b
      )[0];
    }
    testEntry.winner = winners;

    return testEntry;
  });

  // Aggregate stats per model
  const aggregate: Record<string, any> = {};
  for (const modelSlug of models) {
    const entries = modelResults[modelSlug] ?? [];
    if (entries.length === 0) continue;

    const modelName = entries[0].model;
    const durations = entries.map(
      (e) => e.wall_time_ms || e.duration_seconds * 1000
    );
    const tokens = entries.map((e) => e.total_tokens ?? 0);
    const costs = entries
      .map((e) => e.cost_usd)
      .filter((c): c is number => c != null);
    const turns = entries.map((e) => e.total_turns ?? 0);
    const retries = entries.map((e) => e.total_retries ?? 0);

    let passCount = 0;
    let totalCount = 0;
    for (const testId of allTestIds) {
      const key = `${testId}::${modelName}`;
      const r = resultMap.get(key);
      if (r) {
        totalCount++;
        if (r.startsWith("PASS")) passCount++;
      }
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

    aggregate[modelSlug] = {
      model: modelName,
      tests_run: entries.length,
      pass_rate: totalCount > 0 ? Math.round((passCount / totalCount) * 1000) / 1000 : 0,
      avg_duration_ms: Math.round(avg(durations)),
      avg_tokens: Math.round(avg(tokens)),
      total_tokens: sum(tokens),
      avg_cost_usd: costs.length > 0 ? Math.round(avg(costs) * 1e6) / 1e6 : null,
      total_cost_usd: costs.length > 0 ? Math.round(sum(costs) * 1e6) / 1e6 : null,
      avg_turns: turns.length > 0 ? Math.round(avg(turns) * 10) / 10 : 0,
      total_retries: sum(retries),
    };
  }

  return {
    run_id: config.run_id ?? "unknown",
    suite: config.suite ?? "unknown",
    models: models.map((m) => aggregate[m]?.model ?? m),
    test_cases: allTestIds.length,
    comparison,
    aggregate_stats: aggregate,
  };
}

// --- Formatting ---

function formatTable(data: ModelComparison): string {
  const lines: string[] = [];
  lines.push("=".repeat(80));
  lines.push("  MODEL COMPARISON REPORT");
  lines.push("=".repeat(80));
  lines.push(`  Run:        ${data.run_id}`);
  lines.push(`  Suite:      ${data.suite}`);
  lines.push(`  Models:     ${data.models.join(", ")}`);
  lines.push(`  Test cases: ${data.test_cases}`);
  lines.push("");

  const agg = data.aggregate_stats;
  if (Object.keys(agg).length > 0) {
    lines.push("  AGGREGATE STATISTICS");
    lines.push("-".repeat(80));
    lines.push(
      `  ${"Model".padEnd(30)} ${"Pass%".padStart(7)} ${"Avg ms".padStart(8)} ${"Avg Tok".padStart(9)} ${"Avg $".padStart(10)} ${"Turns".padStart(6)}`
    );
    lines.push("-".repeat(80));
    for (const [slug, stats] of Object.entries(agg).sort()) {
      const model = (stats.model ?? slug).slice(0, 30);
      const rate = `${Math.round(stats.pass_rate * 100)}%`;
      const dur = String(stats.avg_duration_ms ?? "?");
      const tok = String(stats.avg_tokens ?? "?");
      const cost =
        stats.avg_cost_usd != null
          ? `$${stats.avg_cost_usd.toFixed(4)}`
          : "N/A";
      const t = String(stats.avg_turns ?? "?");
      lines.push(
        `  ${model.padEnd(30)} ${rate.padStart(7)} ${dur.padStart(8)} ${tok.padStart(9)} ${cost.padStart(10)} ${t.padStart(6)}`
      );
    }
    lines.push("");
  }

  if (data.comparison.length > 0) {
    lines.push("  PER-TEST RESULTS");
    lines.push("-".repeat(80));
    const allModels = [
      ...new Set(
        data.comparison.flatMap((tc) => Object.keys(tc.results))
      ),
    ].sort();

    for (const tc of data.comparison) {
      lines.push(`  Test: ${tc.test_id}`);
      const winners = tc.winner ?? {};
      for (const m of allModels) {
        const r = tc.results[m];
        if (!r) continue;
        const status = r.passed ? "PASS" : r.result ?? "FAIL";
        const flags: string[] = [];
        if (winners.speed === m) flags.push("fastest");
        if (winners.cost === m) flags.push("cheapest");
        if (winners.tokens === m) flags.push("fewest-tokens");
        const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
        const cost =
          r.cost_usd != null ? `$${r.cost_usd.toFixed(4)}` : "N/A";
        lines.push(
          `    ${m.padEnd(25)} ${status.padEnd(8)} ${String(r.duration_ms).padStart(8)}ms ${String(r.tokens).padStart(8)}tok ${cost.padStart(10)} turns=${r.turns}${flagStr}`
        );
      }
      lines.push("");
    }
  }

  lines.push("=".repeat(80));
  return lines.join("\n");
}

// --- CLI ---

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    output: { type: "string", short: "o" },
    format: { type: "string", short: "f", default: "json" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(
    "Usage: bun run metrics-aggregator.ts <results-dir> [--output comparison.json] [--format json|table]"
  );
  process.exit(positionals.length === 0 && !values.help ? 1 : 0);
}

const [config, summary, modelResults] = loadRunData(positionals[0]);
const comparison = buildComparison(config, summary, modelResults);

const output =
  values.format === "table"
    ? formatTable(comparison)
    : JSON.stringify(comparison, null, 2);

if (values.output) {
  mkdirSync(dirname(values.output), { recursive: true });
  writeFileSync(values.output, output + "\n");
  console.log(`Written to ${values.output}`);
} else {
  console.log(output);
}
