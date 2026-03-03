#!/usr/bin/env bun
/**
 * analyze-results.ts - Designer plugin E2E test analyzer
 *
 * Validates designer plugin test cases in transcript.jsonl files produced by
 * the shared autotest framework (runner-base.sh + execute-test.sh).
 *
 * Handles four test categories:
 *   agent-routing    — expected_agent / expected_alternatives matching
 *   skill-routing    — skill_invoked_is / no_task_with_skill_name checks
 *   command-parsing  — skill_invoked_is checks for slash commands
 *   cross-plugin     — expected_agent + optional response_contains_any check
 *
 * Usage:
 *   bun ./autotest/designer/analyze-results.ts <results-dir>
 *
 * The results-dir must contain test-cases.json (copied there by runner-base.sh)
 * and per-test subdirectories with transcript.jsonl files.
 *
 * Outputs:
 *   <results-dir>/designer-analysis.json  — structured analysis results
 *   stdout                                — human-readable summary table
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import type { TranscriptEntry } from "../framework/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestCaseMeta {
  description: string;
  version: string;
  created: string;
  notes: string;
  total_cases?: number;
}

interface DesignerChecks {
  /** The exact skill name that should have been invoked via Skill tool */
  skill_invoked_is?: string;
  /** A partial skill name that should appear in any Skill tool invocation */
  skill_invoked_contains?: string;
  /** True: no Skill tool call whose name matches a Task subagent_type */
  no_task_with_skill_name?: boolean;
  /** True: no Skill tool calls should have been made */
  no_skill_invoked?: boolean;
  /** True: a Task tool call must exist with this exact subagent_type */
  task_agent_is?: string;
  /** Response must contain at least one of these strings */
  response_contains_any?: string[];
  /** Response must contain this exact string */
  response_contains?: string;
}

interface TestCase {
  id: string;
  description: string;
  prompt?: string;
  expected_agent?: string;
  expected_alternatives?: string[];
  category?: string;
  tags?: string[];
  checks?: DesignerChecks;
  [key: string]: unknown;
}

interface TestCasesFile {
  meta: TestCaseMeta;
  test_cases: TestCase[];
}

type ResultStatus = "PASS" | "PASS_ALT" | "FAIL" | "ERROR" | "TIMEOUT";

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

interface TestAnalysis {
  test_id: string;
  description: string;
  category: string;
  transcript_path: string;
  status: ResultStatus;
  actual_agent: string;
  skill_invocations: string[];
  checks: CheckResult[];
  summary: {
    total_checks: number;
    passed_checks: number;
    failed_checks: number;
    task_calls: number;
    skill_calls: number;
    final_response_length: number;
  };
}

interface CategoryStats {
  total: number;
  passed: number;
  pass_alts: number;
  failed: number;
  errors: number;
}

interface AnalysisOutput {
  results_dir: string;
  analyzed_at: string;
  suite: string;
  total_tests: number;
  passed_tests: number;
  pass_alt_tests: number;
  failed_tests: number;
  error_tests: number;
  skipped_tests: number;
  pass_rate: number;
  by_category: Record<string, CategoryStats>;
  agent_distribution: Record<string, number>;
  skill_invocation_counts: Record<string, number>;
  tests: TestAnalysis[];
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

function parseTranscript(path: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const content = readFileSync(path, "utf-8");
  for (const [i, line] of content.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as TranscriptEntry);
    } catch {
      entries.push({ type: "parse_error", line: i + 1, raw: trimmed.slice(0, 200) } as TranscriptEntry);
    }
  }
  return entries;
}

/**
 * Extract Task tool calls from transcript.jsonl.
 * Each Task call contains a subagent_type (the agent name).
 */
function extractTaskCalls(entries: TranscriptEntry[]): Array<{ subagent_type: string; input: Record<string, unknown> }> {
  const calls: Array<{ subagent_type: string; input: Record<string, unknown> }> = [];
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of entry.message?.content ?? []) {
      if (block.type === "tool_use" && block.name === "Task") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const subagentType = (input.subagent_type as string) ?? "";
        if (subagentType) {
          calls.push({ subagent_type: subagentType, input });
        }
      }
    }
  }
  return calls;
}

/**
 * Extract Skill tool calls from transcript.jsonl.
 * Each Skill call contains a skill name.
 */
function extractSkillCalls(entries: TranscriptEntry[]): string[] {
  const skills: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of entry.message?.content ?? []) {
      if (block.type === "tool_use" && block.name === "Skill") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const skillName = (input.skill as string) ?? "";
        if (skillName) {
          skills.push(skillName);
        }
      }
    }
  }
  return skills;
}

/**
 * Extract Task and Skill calls from metrics.json tool_call_sequence as fallback.
 * metrics.json records tool names in the sequence but without structured inputs,
 * so this is a best-effort secondary source.
 */
function extractFromMetrics(metricsPath: string): { taskAgents: string[]; skillNames: string[] } {
  if (!existsSync(metricsPath)) return { taskAgents: [], skillNames: [] };
  try {
    const raw = readFileSync(metricsPath, "utf-8");
    const metrics = JSON.parse(raw) as { totals?: { tool_call_sequence?: string[] } };
    const seq = metrics?.totals?.tool_call_sequence;
    if (!Array.isArray(seq)) return { taskAgents: [], skillNames: [] };
    // metrics.json only captures tool names, not inputs — can detect Task/Skill calls
    // but cannot recover the subagent_type or skill name from this source alone.
    // Return empty; transcript.jsonl is authoritative for structured inputs.
    return { taskAgents: [], skillNames: [] };
  } catch {
    return { taskAgents: [], skillNames: [] };
  }
}

/**
 * Extract the final assistant text response.
 * Checks type==="result" first (claudish --json format), then falls back to
 * the last assistant turn's text blocks.
 */
function extractFinalResponse(entries: TranscriptEntry[]): string {
  for (const entry of entries) {
    if (entry.type === "result" && typeof entry.result === "string" && entry.result.length > 0) {
      return entry.result;
    }
  }
  let lastText = "";
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const parts: string[] = [];
    for (const block of entry.message?.content ?? []) {
      if (block.type === "text" && block.text) {
        parts.push(block.text);
      }
    }
    if (parts.length > 0) {
      lastText = parts.join("\n");
    }
  }
  return lastText;
}

/**
 * Determine the actual agent used from Task calls.
 * Returns "NO_TASK_CALL" if no Task tool was used, or the first subagent_type found.
 */
function resolveActualAgent(taskCalls: Array<{ subagent_type: string }>): string {
  if (taskCalls.length === 0) return "NO_TASK_CALL";
  return taskCalls[0].subagent_type;
}

// ---------------------------------------------------------------------------
// Check evaluation
// ---------------------------------------------------------------------------

function evaluateAgentRouting(
  tc: TestCase,
  actualAgent: string,
  skillCalls: string[]
): { status: ResultStatus; checks: CheckResult[] } {
  const checks: CheckResult[] = [];

  if (!tc.expected_agent) {
    return { status: "PASS", checks };
  }

  const expectedAgent = tc.expected_agent;
  const alternatives = tc.expected_alternatives ?? [];

  if (actualAgent === expectedAgent) {
    checks.push({
      check: "expected_agent",
      passed: true,
      detail: `Agent "${actualAgent}" matches expected "${expectedAgent}"`,
    });
    return { status: "PASS", checks };
  }

  if (alternatives.includes(actualAgent)) {
    checks.push({
      check: "expected_agent_alternative",
      passed: true,
      detail: `Agent "${actualAgent}" is an accepted alternative (expected: "${expectedAgent}")`,
    });
    return { status: "PASS_ALT", checks };
  }

  checks.push({
    check: "expected_agent",
    passed: false,
    detail: `Expected "${expectedAgent}" but got "${actualAgent}". Alternatives: [${alternatives.join(", ")}]`,
  });
  return { status: "FAIL", checks };
}

function evaluateDesignerChecks(
  designerChecks: DesignerChecks,
  taskCalls: Array<{ subagent_type: string }>,
  skillCalls: string[],
  finalResponse: string
): CheckResult[] {
  const results: CheckResult[] = [];

  // --- skill_invoked_is ---
  if (designerChecks.skill_invoked_is !== undefined) {
    const expected = designerChecks.skill_invoked_is;
    const found = skillCalls.some((s) => s === expected || s.endsWith(`:${expected.split(":").pop()}`));
    results.push({
      check: "skill_invoked_is",
      passed: found,
      detail: found
        ? `Skill "${expected}" was invoked via Skill tool`
        : `Skill "${expected}" was NOT invoked. Skills invoked: [${skillCalls.join(", ") || "none"}]`,
    });
  }

  // --- skill_invoked_contains ---
  if (designerChecks.skill_invoked_contains !== undefined) {
    const needle = designerChecks.skill_invoked_contains;
    const found = skillCalls.some((s) => s.includes(needle));
    results.push({
      check: "skill_invoked_contains",
      passed: found,
      detail: found
        ? `A skill containing "${needle}" was invoked: [${skillCalls.filter((s) => s.includes(needle)).join(", ")}]`
        : `No skill containing "${needle}" was invoked. Skills invoked: [${skillCalls.join(", ") || "none"}]`,
    });
  }

  // --- no_task_with_skill_name ---
  if (designerChecks.no_task_with_skill_name === true) {
    // Check if any Task call used a name that looks like a skill (namespace:skill pattern
    // but not a known agent name). Heuristic: if the Skill tool was invoked with a name,
    // that same name should not appear as a Task subagent_type.
    const skillName = designerChecks.skill_invoked_is ?? designerChecks.skill_invoked_contains ?? "";
    const badTaskCalls = taskCalls.filter((t) => {
      if (!skillName) return false;
      return t.subagent_type === skillName || t.subagent_type.includes(skillName.split(":").pop() ?? "");
    });
    const passed = badTaskCalls.length === 0;
    results.push({
      check: "no_task_with_skill_name",
      passed,
      detail: passed
        ? `No Task calls used the skill name as subagent_type`
        : `Task was incorrectly called with skill name: [${badTaskCalls.map((t) => t.subagent_type).join(", ")}]`,
    });
  }

  // --- no_skill_invoked ---
  if (designerChecks.no_skill_invoked === true) {
    const passed = skillCalls.length === 0;
    results.push({
      check: "no_skill_invoked",
      passed,
      detail: passed
        ? `Correctly invoked no skills (direct handling)`
        : `Unexpected skill invocations: [${skillCalls.join(", ")}]`,
    });
  }

  // --- task_agent_is ---
  if (designerChecks.task_agent_is !== undefined) {
    const expected = designerChecks.task_agent_is;
    const found = taskCalls.some((t) => t.subagent_type === expected);
    results.push({
      check: "task_agent_is",
      passed: found,
      detail: found
        ? `Task was called with subagent_type "${expected}"`
        : `No Task call with subagent_type "${expected}". Task agents used: [${taskCalls.map((t) => t.subagent_type).join(", ") || "none"}]`,
    });
  }

  // --- response_contains ---
  if (designerChecks.response_contains !== undefined) {
    const needle = designerChecks.response_contains;
    const found = finalResponse.includes(needle);
    results.push({
      check: "response_contains",
      passed: found,
      detail: found
        ? `Response contains expected text: "${needle.slice(0, 60)}"`
        : `Response does NOT contain: "${needle.slice(0, 60)}". Response length: ${finalResponse.length} chars`,
    });
  }

  // --- response_contains_any ---
  if (designerChecks.response_contains_any !== undefined) {
    const candidates = designerChecks.response_contains_any;
    const matched = candidates.filter((c) => finalResponse.includes(c));
    const found = matched.length > 0;
    results.push({
      check: "response_contains_any",
      passed: found,
      detail: found
        ? `Response contains: ${matched.map((m) => `"${m}"`).join(", ")}`
        : `Response contains none of: ${candidates.map((c) => `"${c}"`).join(", ")}. Response length: ${finalResponse.length} chars`,
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

function statusColor(status: ResultStatus): string {
  switch (status) {
    case "PASS": return GREEN;
    case "PASS_ALT": return YELLOW;
    case "FAIL": return RED;
    case "ERROR": return RED;
    case "TIMEOUT": return YELLOW;
  }
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

  const testCasesPath = join(resultsDir, "test-cases.json");
  if (!existsSync(testCasesPath)) {
    console.error(`ERROR: test-cases.json not found in: ${resultsDir}`);
    console.error("       runner-base.sh should have copied it there. Run via run.sh.");
    process.exit(1);
  }

  const testCasesFile: TestCasesFile = JSON.parse(readFileSync(testCasesPath, "utf-8"));
  const testCases = testCasesFile.test_cases;

  console.log(`\n${colorize("=== Designer Plugin E2E Analyzer ===", BOLD)}`);
  console.log(`Results dir: ${resultsDir}`);
  console.log(`Test cases:  ${testCases.length}`);
  console.log("");

  // Walk the results dir looking for transcript.jsonl files
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
    console.error("         Tests may not have run yet. Use run.sh to execute tests first.");
  }

  const testAnalyses: TestAnalysis[] = [];
  let skipped = 0;

  for (const transcriptPath of transcriptPaths) {
    const caseDir = transcriptPath.replace(/\/transcript\.jsonl$/, "");
    const caseId = basename(caseDir);

    const tc = testCases.find((c) => c.id === caseId);
    if (!tc) {
      skipped++;
      continue;
    }

    // Parse transcript
    let entries: TranscriptEntry[];
    try {
      entries = parseTranscript(transcriptPath);
    } catch (e) {
      console.error(`  ERROR: Failed to parse ${transcriptPath}: ${e}`);
      testAnalyses.push({
        test_id: caseId,
        description: tc.description,
        category: tc.category ?? "unknown",
        transcript_path: transcriptPath,
        status: "ERROR",
        actual_agent: "ERROR",
        skill_invocations: [],
        checks: [{ check: "parse_transcript", passed: false, detail: `Parse error: ${e}` }],
        summary: { total_checks: 1, passed_checks: 0, failed_checks: 1, task_calls: 0, skill_calls: 0, final_response_length: 0 },
      });
      continue;
    }

    const taskCalls = extractTaskCalls(entries);
    const skillCalls = extractSkillCalls(entries);
    const finalResponse = extractFinalResponse(entries);
    const actualAgent = resolveActualAgent(taskCalls);

    const allCheckResults: CheckResult[] = [];
    let status: ResultStatus = "PASS";

    // Evaluate agent routing (for test cases with expected_agent)
    if (tc.expected_agent) {
      const { status: agentStatus, checks: agentChecks } = evaluateAgentRouting(tc, actualAgent, skillCalls);
      allCheckResults.push(...agentChecks);
      status = agentStatus;
    }

    // Evaluate designer-specific checks
    if (tc.checks && Object.keys(tc.checks).length > 0) {
      const designerCheckResults = evaluateDesignerChecks(
        tc.checks,
        taskCalls,
        skillCalls,
        finalResponse
      );
      allCheckResults.push(...designerCheckResults);

      // If there are designer checks, derive status from those (when no expected_agent)
      if (!tc.expected_agent) {
        const allPassed = designerCheckResults.every((r) => r.passed);
        status = allPassed ? "PASS" : "FAIL";
      } else if (status === "PASS" || status === "PASS_ALT") {
        // Additional checks on top of agent routing
        const allPassed = designerCheckResults.every((r) => r.passed);
        if (!allPassed) status = "FAIL";
      }
    }

    testAnalyses.push({
      test_id: caseId,
      description: tc.description,
      category: tc.category ?? "unknown",
      transcript_path: transcriptPath,
      status,
      actual_agent: actualAgent,
      skill_invocations: skillCalls,
      checks: allCheckResults,
      summary: {
        total_checks: allCheckResults.length,
        passed_checks: allCheckResults.filter((r) => r.passed).length,
        failed_checks: allCheckResults.filter((r) => !r.passed).length,
        task_calls: taskCalls.length,
        skill_calls: skillCalls.length,
        final_response_length: finalResponse.length,
      },
    });
  }

  // Sort by test case order in test-cases.json
  const orderMap = new Map(testCases.map((tc, i) => [tc.id, i]));
  testAnalyses.sort((a, b) => {
    const ai = orderMap.get(a.test_id) ?? 999;
    const bi = orderMap.get(b.test_id) ?? 999;
    return ai - bi;
  });

  // --- Per-test output ---
  console.log(colorize("=== Check Results Per Test ===", BOLD));
  console.log("");

  const categories = [...new Set(testAnalyses.map((t) => t.category))];

  for (const category of categories) {
    const categoryTests = testAnalyses.filter((t) => t.category === category);
    console.log(colorize(`  [${category}]`, CYAN));

    for (const analysis of categoryTests) {
      const color = statusColor(analysis.status);
      const checksStr = `${analysis.summary.passed_checks}/${analysis.summary.total_checks}`;
      const agentStr = analysis.actual_agent.slice(0, 28);
      console.log(
        `  ${colorize(padEnd(analysis.status, 8), color)} ${colorize(padEnd(analysis.test_id, 38), BOLD)} ` +
        `agent=${colorize(padEnd(agentStr, 28), DIM)} checks=${checksStr}`
      );

      for (const chk of analysis.checks) {
        if (!chk.passed) {
          console.log(
            `           ${colorize("FAIL", RED)} ${colorize(chk.check, YELLOW)}: ${chk.detail}`
          );
        }
      }
      for (const chk of analysis.checks) {
        if (chk.passed) {
          console.log(
            `           ${colorize("ok  ", DIM)} ${colorize(chk.check, DIM)}: ${colorize(chk.detail.slice(0, 80), DIM)}`
          );
        }
      }
    }
    console.log("");
  }

  // --- Category summary ---
  const byCategory: Record<string, CategoryStats> = {};
  for (const analysis of testAnalyses) {
    const cat = analysis.category;
    if (!byCategory[cat]) {
      byCategory[cat] = { total: 0, passed: 0, pass_alts: 0, failed: 0, errors: 0 };
    }
    byCategory[cat].total++;
    if (analysis.status === "PASS") byCategory[cat].passed++;
    else if (analysis.status === "PASS_ALT") byCategory[cat].pass_alts++;
    else if (analysis.status === "ERROR" || analysis.status === "TIMEOUT") byCategory[cat].errors++;
    else byCategory[cat].failed++;
  }

  console.log(colorize("=== Category Pass Rates ===", BOLD));
  for (const [cat, stats] of Object.entries(byCategory)) {
    const pct = stats.total > 0 ? Math.round(((stats.passed + stats.pass_alts) / stats.total) * 100) : 0;
    const color = pct === 100 ? GREEN : pct >= 50 ? YELLOW : RED;
    console.log(
      `  ${colorize(padEnd(cat, 30), BOLD)} ${colorize(`${pct}%`, color)} ` +
      `(${stats.passed} PASS, ${stats.pass_alts} PASS_ALT, ${stats.failed} FAIL, ${stats.errors} ERR / ${stats.total} total)`
    );
  }
  console.log("");

  // --- Skill invocation summary ---
  const skillCounts: Record<string, number> = {};
  for (const analysis of testAnalyses) {
    for (const skill of analysis.skill_invocations) {
      skillCounts[skill] = (skillCounts[skill] ?? 0) + 1;
    }
  }

  if (Object.keys(skillCounts).length > 0) {
    console.log(colorize("=== Skill Invocation Summary ===", BOLD));
    for (const [skill, count] of Object.entries(skillCounts).sort(([, a], [, b]) => b - a)) {
      console.log(`  ${colorize(padEnd(skill, 40), DIM)} ${count}x`);
    }
    console.log("");
  }

  // --- Agent distribution ---
  const agentDist: Record<string, number> = {};
  for (const analysis of testAnalyses) {
    const agent = analysis.actual_agent;
    agentDist[agent] = (agentDist[agent] ?? 0) + 1;
  }

  console.log(colorize("=== Agent Distribution ===", BOLD));
  for (const [agent, count] of Object.entries(agentDist).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${colorize(padEnd(agent, 40), DIM)} ${count}x`);
  }
  console.log("");

  // --- Overall summary ---
  const totalAnalyzed = testAnalyses.length;
  const passedTests = testAnalyses.filter((t) => t.status === "PASS").length;
  const passAltTests = testAnalyses.filter((t) => t.status === "PASS_ALT").length;
  const failedTests = testAnalyses.filter((t) => t.status === "FAIL").length;
  const errorTests = testAnalyses.filter((t) => t.status === "ERROR" || t.status === "TIMEOUT").length;
  const passRate = totalAnalyzed > 0 ? Math.round(((passedTests + passAltTests) / totalAnalyzed) * 100) : 0;

  console.log(colorize("=== Overall Results ===", BOLD));
  console.log(`Analyzed:   ${totalAnalyzed}`);
  console.log(`PASS:       ${colorize(String(passedTests), passedTests > 0 ? GREEN : DIM)}`);
  console.log(`PASS_ALT:   ${colorize(String(passAltTests), passAltTests > 0 ? YELLOW : DIM)}`);
  console.log(`FAIL:       ${colorize(String(failedTests), failedTests > 0 ? RED : GREEN)}`);
  console.log(`ERROR:      ${colorize(String(errorTests), errorTests > 0 ? RED : GREEN)}`);
  console.log(`Skipped:    ${skipped}`);
  console.log(`Pass rate:  ${colorize(`${passRate}%`, passRate === 100 ? GREEN : passRate >= 50 ? YELLOW : RED)}`);
  console.log("");

  // --- Write designer-analysis.json ---
  const output: AnalysisOutput = {
    results_dir: resultsDir,
    analyzed_at: new Date().toISOString(),
    suite: "designer",
    total_tests: totalAnalyzed,
    passed_tests: passedTests,
    pass_alt_tests: passAltTests,
    failed_tests: failedTests,
    error_tests: errorTests,
    skipped_tests: skipped,
    pass_rate: passRate,
    by_category: byCategory,
    agent_distribution: agentDist,
    skill_invocation_counts: skillCounts,
    tests: testAnalyses,
  };

  const outputPath = join(resultsDir, "designer-analysis.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Analysis written to: ${outputPath}`);
  console.log("");

  process.exit(failedTests > 0 || errorTests > 0 ? 1 : 0);
}

main();
