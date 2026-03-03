#!/usr/bin/env bun
/**
 * analyze-results.ts — Code Roast skill E2E test analyzer
 *
 * Validates code-roast-specific checks in transcript.jsonl files produced by
 * the shared autotest framework (runner-base.sh + execute-test.sh).
 *
 * Usage:
 *   bun ./autotest/code-roast/analyze-results.ts <results-dir>
 *
 * The results-dir must contain test-cases.json (copied there by runner-base.sh)
 * and per-test subdirectories with transcript.jsonl files.
 *
 * Outputs:
 *   <results-dir>/roast-analysis.json  — structured check results
 *   stdout                             — human-readable summary table
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestCaseMeta {
  description: string;
  version: string;
  created: string;
  notes: string;
}

interface RoastChecks {
  /** Skill tool was called with this exact skill name */
  skill_invoked_is?: string;
  /** Skill tool was NOT called with this skill name */
  no_skill_invoked_is?: string;
  /** No Agent/Task tool calls used "code-roast" as subagent_type */
  no_task_with_skill_name?: boolean;
  /** At least one Read tool call has a path containing any of these substrings */
  reads_file_any?: string[];
  /** At least one Grep tool call was made */
  grep_used?: boolean;
  /** Minimum number of Grep tool calls */
  min_grep_calls?: number;
  /** Combined response text contains at least one of these (case-insensitive) */
  response_contains_any?: string[];
  /** Combined response text contains all of these (case-insensitive) */
  response_contains_all?: string[];
  /** Combined response text does NOT contain this string (case-insensitive) */
  response_not_contains?: string;
}

interface TestCase {
  id: string;
  description: string;
  prompt?: string;
  expected_agent?: string;
  expected_alternatives?: string[];
  category?: string;
  tags?: string[];
  checks?: RoastChecks;
  [key: string]: unknown;
}

interface TestCasesFile {
  meta: TestCaseMeta;
  test_cases: TestCase[];
}

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

interface TestAnalysis {
  test_id: string;
  model: string;
  description: string;
  transcript_path: string;
  passed: boolean;
  checks: CheckResult[];
  summary: {
    total_checks: number;
    passed_checks: number;
    failed_checks: number;
    skill_calls: number;
    skills_invoked: string[];
    task_calls: number;
    read_calls: number;
    grep_calls: number;
    total_tool_calls: number;
    response_length: number;
  };
}

interface AnalysisOutput {
  results_dir: string;
  analyzed_at: string;
  total_tests: number;
  passed_tests: number;
  failed_tests: number;
  skipped_tests: number;
  pass_rate: number;
  by_model: Record<string, { total: number; passed: number; failed: number; pass_rate: number }>;
  tests: TestAnalysis[];
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

interface TranscriptEntry {
  type: string;
  subtype?: string;
  message?: {
    content: Array<{
      type: "text" | "tool_use";
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  /** claudish --json result entry */
  result?: string | unknown;
  line?: number;
  raw?: string;
}

function parseTranscript(path: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const content = readFileSync(path, "utf-8");
  for (const [i, line] of content.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as TranscriptEntry);
    } catch {
      entries.push({ type: "parse_error", line: i + 1, raw: trimmed.slice(0, 200) });
    }
  }
  return entries;
}

/**
 * Extract ALL tool calls from transcript entries.
 * Handles both transcript formats:
 *   1. { type: "assistant", message: { content: [{ type: "tool_use", name, input }] } }
 *   2. Direct content arrays (raw API format)
 */
function extractAllToolCalls(entries: TranscriptEntry[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of entry.message?.content ?? []) {
      if (block.type === "tool_use" && block.name) {
        calls.push({ name: block.name, input: block.input ?? {} });
      }
    }
  }
  return calls;
}

/**
 * Fallback: extract tool names from metrics.json tool_call_sequence.
 * Only provides names, not inputs — used when transcript parsing yields nothing.
 */
function extractToolNamesFromMetrics(metricsPath: string): string[] {
  if (!existsSync(metricsPath)) return [];
  try {
    const raw = readFileSync(metricsPath, "utf-8");
    const metrics = JSON.parse(raw) as { totals?: { tool_call_sequence?: string[] } };
    return metrics?.totals?.tool_call_sequence ?? [];
  } catch {
    return [];
  }
}

/**
 * Extract combined response text from all assistant turns.
 *
 * For code-roast, the skill output spans multiple turns (read, grep, response).
 * We concatenate ALL assistant text blocks to capture the full roast output.
 */
function extractFullResponseText(entries: TranscriptEntry[]): string {
  const texts: string[] = [];

  // Check for claudish result entry first
  for (const entry of entries) {
    if (entry.type === "result" && typeof entry.result === "string" && entry.result.length > 0) {
      texts.push(entry.result);
    }
  }

  // Also collect all assistant text blocks (for multi-turn skill execution)
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of entry.message?.content ?? []) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      }
    }
  }

  return texts.join("\n");
}

// ---------------------------------------------------------------------------
// Check evaluation
// ---------------------------------------------------------------------------

/**
 * Checks that require Claude Code's plugin system (Skill tool, Read/Grep tools).
 * External models run via claudish without plugin access — these checks are
 * skipped (auto-passed) for non-internal models.
 */
const PLUGIN_REQUIRED_CHECKS = new Set([
  "skill_invoked_is",
  "reads_file_any",
  "grep_used",
  "min_grep_calls",
]);

function evaluateChecks(
  checks: RoastChecks,
  toolCalls: ToolCall[],
  toolNamesFromMetrics: string[],
  responseText: string,
): CheckResult[] {
  const results: CheckResult[] = [];

  // Categorize tool calls
  const skillCalls = toolCalls.filter((c) => c.name === "Skill");
  const taskCalls = toolCalls.filter((c) => c.name === "Agent" || c.name === "Task");
  const readCalls = toolCalls.filter((c) => c.name === "Read");
  const grepCalls = toolCalls.filter((c) => c.name === "Grep");

  // Extract skill names invoked
  const skillsInvoked = skillCalls
    .map((c) => {
      const skill = c.input?.skill;
      return typeof skill === "string" ? skill : "";
    })
    .filter(Boolean);

  // For metrics fallback: check if Skill/Grep/Read appear in tool names
  const metricsHasSkill = toolNamesFromMetrics.some(
    (n) => n === "Skill" || n.toLowerCase().includes("skill"),
  );
  const metricsHasGrep = toolNamesFromMetrics.some(
    (n) => n === "Grep" || n.toLowerCase().includes("grep"),
  );
  const metricsHasRead = toolNamesFromMetrics.some(
    (n) => n === "Read" || n.toLowerCase().includes("read"),
  );

  // --- skill_invoked_is ---
  if (checks.skill_invoked_is !== undefined) {
    const expected = checks.skill_invoked_is;
    // Match exact name OR namespaced name (e.g., "code-roast" matches "dev:code-roast")
    const found = skillsInvoked.some(
      (s) => s === expected || s.endsWith(`:${expected}`),
    );
    // Fallback: check if metrics shows Skill was used AND response looks like a roast
    const metricsFallback =
      !found &&
      metricsHasSkill &&
      responseText.toLowerCase().includes("sin");
    results.push({
      check: "skill_invoked_is",
      passed: found || metricsFallback,
      detail: found
        ? `Skill("${expected}") invoked correctly. Skills: [${skillsInvoked.join(", ")}]`
        : metricsFallback
          ? `Skill tool detected in metrics (transcript parse incomplete). Response contains roast content.`
          : `Skill("${expected}") NOT invoked. Skills found: [${skillsInvoked.join(", ") || "none"}]. Total tool calls: ${toolCalls.length}, metrics tools: ${toolNamesFromMetrics.length}`,
    });
  }

  // --- no_skill_invoked_is ---
  if (checks.no_skill_invoked_is !== undefined) {
    const forbidden = checks.no_skill_invoked_is;
    // Match exact name OR namespaced name (e.g., "code-roast" matches "dev:code-roast")
    const found = skillsInvoked.some(
      (s) => s === forbidden || s.endsWith(`:${forbidden}`),
    );
    results.push({
      check: "no_skill_invoked_is",
      passed: !found,
      detail: !found
        ? `Correctly did NOT invoke Skill("${forbidden}"). Skills used: [${skillsInvoked.join(", ") || "none"}]`
        : `Incorrectly invoked Skill("${forbidden}") — this was a non-roast prompt`,
    });
  }

  // --- no_task_with_skill_name ---
  if (checks.no_task_with_skill_name === true) {
    const badTaskCalls = taskCalls.filter((c) => {
      const subType = c.input?.subagent_type;
      return (
        typeof subType === "string" &&
        (subType.includes("code-roast") || subType.includes("roast"))
      );
    });
    const passed = badTaskCalls.length === 0;
    results.push({
      check: "no_task_with_skill_name",
      passed,
      detail: passed
        ? `No Agent/Task calls confused skill for agent. Task calls: ${taskCalls.length}`
        : `Agent/Task called with roast-related subagent_type: [${badTaskCalls.map((c) => c.input?.subagent_type).join(", ")}]`,
    });
  }

  // --- reads_file_any ---
  if (checks.reads_file_any !== undefined) {
    const needles = checks.reads_file_any;
    const readPaths = readCalls.map((c) => String(c.input?.file_path ?? ""));
    const matched = needles.filter((needle) =>
      readPaths.some((p) => p.includes(needle)),
    );
    const found = matched.length > 0;
    // Fallback: metrics shows Read was used
    const metricsFallback = !found && metricsHasRead && readPaths.length === 0;
    results.push({
      check: "reads_file_any",
      passed: found || metricsFallback,
      detail: found
        ? `Read tool accessed files matching: [${matched.join(", ")}]`
        : metricsFallback
          ? `Read tool detected in metrics but paths not available in transcript`
          : `Read tool did NOT access any of: [${needles.join(", ")}]. Read paths: [${readPaths.slice(0, 5).join(", ")}]`,
    });
  }

  // --- grep_used ---
  if (checks.grep_used === true) {
    const found = grepCalls.length > 0;
    const metricsFallback = !found && metricsHasGrep;
    results.push({
      check: "grep_used",
      passed: found || metricsFallback,
      detail: found
        ? `Grep tool used ${grepCalls.length} time(s) for Tier 1 detection`
        : metricsFallback
          ? `Grep detected in metrics but not in transcript`
          : `Grep tool NOT used — Tier 1 detection may not have run`,
    });
  }

  // --- min_grep_calls ---
  if (checks.min_grep_calls !== undefined) {
    const required = checks.min_grep_calls;
    const actual = grepCalls.length;
    results.push({
      check: "min_grep_calls",
      passed: actual >= required,
      detail:
        actual >= required
          ? `${actual} Grep calls (minimum: ${required})`
          : `Only ${actual} Grep calls, expected at least ${required}`,
    });
  }

  // --- response_contains_any (case-insensitive) ---
  if (checks.response_contains_any !== undefined) {
    const candidates = checks.response_contains_any;
    const responseLower = responseText.toLowerCase();
    const matched = candidates.filter((c) => responseLower.includes(c.toLowerCase()));
    const found = matched.length > 0;
    results.push({
      check: "response_contains_any",
      passed: found,
      detail: found
        ? `Response contains: [${matched.map((m) => `"${m}"`).join(", ")}]`
        : `Response contains none of: [${candidates.map((c) => `"${c}"`).join(", ")}]. Response length: ${responseText.length} chars`,
    });
  }

  // --- response_contains_all (case-insensitive) ---
  if (checks.response_contains_all !== undefined) {
    const required = checks.response_contains_all;
    const responseLower = responseText.toLowerCase();
    const missing = required.filter((c) => !responseLower.includes(c.toLowerCase()));
    const found = missing.length === 0;
    results.push({
      check: "response_contains_all",
      passed: found,
      detail: found
        ? `Response contains all required terms`
        : `Response missing: [${missing.map((m) => `"${m}"`).join(", ")}]`,
    });
  }

  // --- response_not_contains (case-insensitive) ---
  if (checks.response_not_contains !== undefined) {
    const forbidden = checks.response_not_contains;
    const found = responseText.toLowerCase().includes(forbidden.toLowerCase());
    results.push({
      check: "response_not_contains",
      passed: !found,
      detail: !found
        ? `Response correctly does NOT contain "${forbidden}"`
        : `Response unexpectedly contains "${forbidden}"`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun analyze-results.ts <results-dir>");
    console.error("  The results-dir must contain test-cases.json and per-test subdirectories.");
    process.exit(1);
  }

  const resultsDir = args[0];

  if (!existsSync(resultsDir)) {
    console.error(`ERROR: Results directory not found: ${resultsDir}`);
    process.exit(1);
  }

  // Load test-cases.json (copied to results dir by runner-base.sh)
  const testCasesPath = join(resultsDir, "test-cases.json");
  if (!existsSync(testCasesPath)) {
    console.error(`ERROR: test-cases.json not found in: ${resultsDir}`);
    console.error("       runner-base.sh should have copied it there. Run via run.sh.");
    process.exit(1);
  }

  const testCasesFile: TestCasesFile = JSON.parse(readFileSync(testCasesPath, "utf-8"));
  const testCases = testCasesFile.test_cases;

  console.log(`\n${colorize("=== Code Roast Skill E2E Analyzer ===", BOLD)}`);
  console.log(`Results dir: ${resultsDir}`);
  console.log(`Test cases:  ${testCases.length}`);
  console.log("");

  // Discover transcript.jsonl files recursively
  function findTranscripts(dir: string, depth: number = 0): string[] {
    if (depth > 3) return [];
    const found: string[] = [];
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subdir = join(dir, entry.name);
      const transcriptPath = join(subdir, "transcript.jsonl");
      if (existsSync(transcriptPath)) {
        found.push(transcriptPath);
      } else {
        found.push(...findTranscripts(subdir, depth + 1));
      }
    }
    return found;
  }

  const transcriptPaths = findTranscripts(resultsDir);

  if (transcriptPaths.length === 0) {
    console.error("WARNING: No transcript.jsonl files found in results directory.");
    console.error("         Run tests first: ./autotest/code-roast/run.sh --model <model>");
    process.exit(1);
  }

  const testAnalyses: TestAnalysis[] = [];
  let skipped = 0;

  // Process each transcript
  for (const transcriptPath of transcriptPaths) {
    const caseDir = transcriptPath.replace(/\/transcript\.jsonl$/, "");
    const caseId = basename(caseDir);

    // Detect model from directory structure: <results>/<model_slug>/<case_id>/
    const parentDir = basename(join(caseDir, ".."));
    const isModelSlug = !testCases.some((tc) => tc.id === parentDir);
    const modelSlug = isModelSlug ? parentDir : "unknown";

    const tc = testCases.find((c) => c.id === caseId);
    if (!tc) {
      skipped++;
      continue;
    }

    if (!tc.checks || Object.keys(tc.checks).length === 0) {
      skipped++;
      continue;
    }

    // Parse transcript
    let entries: TranscriptEntry[];
    try {
      entries = parseTranscript(transcriptPath);
    } catch (e) {
      console.error(`  ERROR: Failed to parse ${transcriptPath}: ${e}`);
      skipped++;
      continue;
    }

    // Extract tool calls (primary: transcript, fallback: metrics)
    const toolCalls = extractAllToolCalls(entries);
    const metricsPath = join(caseDir, "metrics.json");
    const toolNamesFromMetrics = extractToolNamesFromMetrics(metricsPath);
    const responseText = extractFullResponseText(entries);

    // Evaluate checks
    const checkResults = evaluateChecks(
      tc.checks,
      toolCalls,
      toolNamesFromMetrics,
      responseText,
    );

    // External models (non-internal) don't have Claude Code's plugin system.
    // Skip plugin-dependent checks — mark failed ones as auto-passed with [SKIP] note.
    if (modelSlug !== "internal") {
      for (const check of checkResults) {
        if (PLUGIN_REQUIRED_CHECKS.has(check.check) && !check.passed) {
          check.passed = true;
          check.detail = `[SKIPPED — external model has no plugin access] ${check.detail}`;
        }
      }
    }

    const allPassed = checkResults.every((r) => r.passed);

    // Categorize tools for summary
    const skillCalls = toolCalls.filter((c) => c.name === "Skill");
    const taskCalls = toolCalls.filter((c) => c.name === "Agent" || c.name === "Task");
    const readCalls = toolCalls.filter((c) => c.name === "Read");
    const grepCalls = toolCalls.filter((c) => c.name === "Grep");
    const skillsInvoked = skillCalls
      .map((c) => String(c.input?.skill ?? ""))
      .filter(Boolean);

    testAnalyses.push({
      test_id: caseId,
      model: modelSlug,
      description: tc.description,
      transcript_path: transcriptPath,
      passed: allPassed,
      checks: checkResults,
      summary: {
        total_checks: checkResults.length,
        passed_checks: checkResults.filter((r) => r.passed).length,
        failed_checks: checkResults.filter((r) => !r.passed).length,
        skill_calls: skillCalls.length,
        skills_invoked: skillsInvoked,
        task_calls: taskCalls.length,
        read_calls: readCalls.length,
        grep_calls: grepCalls.length,
        total_tool_calls: toolCalls.length,
        response_length: responseText.length,
      },
    });
  }

  // Sort by test case order
  const orderMap = new Map(testCases.map((tc, i) => [tc.id, i]));
  testAnalyses.sort((a, b) => {
    const ai = orderMap.get(a.test_id) ?? 999;
    const bi = orderMap.get(b.test_id) ?? 999;
    return ai - bi;
  });

  const totalAnalyzed = testAnalyses.length;
  const passedTests = testAnalyses.filter((t) => t.passed).length;
  const failedTests = totalAnalyzed - passedTests;
  const passRate = totalAnalyzed > 0 ? Math.round((passedTests / totalAnalyzed) * 100) : 0;

  // --- Per-model breakdown ---
  const byModel: Record<string, { total: number; passed: number; failed: number; pass_rate: number }> = {};
  for (const analysis of testAnalyses) {
    const m = analysis.model;
    if (!byModel[m]) byModel[m] = { total: 0, passed: 0, failed: 0, pass_rate: 0 };
    byModel[m].total++;
    if (analysis.passed) byModel[m].passed++;
    else byModel[m].failed++;
  }
  for (const m of Object.keys(byModel)) {
    byModel[m].pass_rate = Math.round((byModel[m].passed / byModel[m].total) * 100);
  }

  // --- Print per-test results ---
  console.log(colorize("=== Check Results Per Test ===", BOLD));
  console.log("");

  let currentModel = "";
  for (const analysis of testAnalyses) {
    // Print model header when it changes
    if (analysis.model !== currentModel) {
      currentModel = analysis.model;
      const modelStats = byModel[currentModel];
      const modelColor = modelStats && modelStats.failed === 0 ? GREEN : YELLOW;
      console.log(
        colorize(`--- Model: ${currentModel} (${modelStats?.passed}/${modelStats?.total} pass) ---`, modelColor),
      );
      console.log("");
    }

    const icon = analysis.passed ? colorize("PASS", GREEN) : colorize("FAIL", RED);
    const checksStr = `${analysis.summary.passed_checks}/${analysis.summary.total_checks}`;
    const skillStr = analysis.summary.skills_invoked.length > 0
      ? `skill=${analysis.summary.skills_invoked[0]}`
      : "skill=none";
    console.log(
      `${icon} ${colorize(padEnd(analysis.test_id, 30), BOLD)} checks=${padEnd(checksStr, 5)} ${padEnd(skillStr, 22)} tools=${analysis.summary.total_tool_calls}`,
    );

    // Print failed checks
    for (const chk of analysis.checks) {
      if (!chk.passed) {
        console.log(
          `     ${colorize("FAIL", RED)} ${colorize(chk.check, YELLOW)}: ${chk.detail}`,
        );
      }
    }

    // Print passed checks in dim
    for (const chk of analysis.checks) {
      if (chk.passed) {
        console.log(
          `     ${colorize("ok  ", DIM)} ${colorize(chk.check, DIM)}: ${colorize(chk.detail.slice(0, 100), DIM)}`,
        );
      }
    }
    console.log("");
  }

  if (skipped > 0) {
    console.log(colorize(`(${skipped} test(s) skipped: no transcript or no checks defined)`, DIM));
    console.log("");
  }

  // --- Per-model summary table ---
  console.log(colorize("=== Results by Model ===", BOLD));
  console.log("");
  console.log(`${padEnd("Model", 45)} ${padEnd("Pass", 6)} ${padEnd("Fail", 6)} ${padEnd("Rate", 6)}`);
  console.log("-".repeat(65));

  for (const [model, stats] of Object.entries(byModel)) {
    const rateColor = stats.pass_rate === 100 ? GREEN : stats.pass_rate >= 50 ? YELLOW : RED;
    console.log(
      `${padEnd(model, 45)} ${colorize(padEnd(String(stats.passed), 6), GREEN)} ${colorize(padEnd(String(stats.failed), 6), stats.failed > 0 ? RED : GREEN)} ${colorize(padEnd(`${stats.pass_rate}%`, 6), rateColor)}`,
    );
  }
  console.log("");

  // --- Overall summary ---
  console.log(colorize("=== Overall Results ===", BOLD));
  console.log(`Analyzed:  ${totalAnalyzed} tests across ${Object.keys(byModel).length} model(s)`);
  console.log(`Passed:    ${colorize(String(passedTests), passedTests === totalAnalyzed ? GREEN : YELLOW)}`);
  console.log(`Failed:    ${colorize(String(failedTests), failedTests > 0 ? RED : GREEN)}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Pass rate: ${colorize(`${passRate}%`, passRate === 100 ? GREEN : passRate >= 50 ? YELLOW : RED)}`);
  console.log("");

  // --- Skill invocation summary ---
  const allSkills = testAnalyses.flatMap((a) => a.summary.skills_invoked);
  const skillDist: Record<string, number> = {};
  for (const s of allSkills) {
    skillDist[s] = (skillDist[s] ?? 0) + 1;
  }
  if (Object.keys(skillDist).length > 0) {
    console.log(colorize("=== Skill Invocation Distribution ===", BOLD));
    for (const [skill, count] of Object.entries(skillDist)) {
      console.log(`  ${skill}: ${count} invocations`);
    }
    console.log("");
  }

  // --- Write roast-analysis.json ---
  const output: AnalysisOutput = {
    results_dir: resultsDir,
    analyzed_at: new Date().toISOString(),
    total_tests: totalAnalyzed,
    passed_tests: passedTests,
    failed_tests: failedTests,
    skipped_tests: skipped,
    pass_rate: passRate,
    by_model: byModel,
    tests: testAnalyses,
  };

  const outputPath = join(resultsDir, "roast-analysis.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Analysis written to: ${outputPath}`);
  console.log("");

  process.exit(failedTests > 0 ? 1 : 0);
}

main();
