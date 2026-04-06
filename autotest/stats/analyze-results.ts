#!/usr/bin/env bun
/**
 * analyze-results.ts - Stats plugin E2E test analyzer
 *
 * Validates stats-specific checks in transcript.jsonl files produced by
 * the shared autotest framework (runner-base.sh + execute-test.sh).
 *
 * Usage (full run analysis):
 *   bun ./autotest/stats/analyze-results.ts <results-dir>
 *
 * Usage (per-test mode — called by runner-base.sh after each test):
 *   bun ./autotest/stats/analyze-results.ts <transcript.jsonl> <checks_json>
 *   Output: JSON with a top-level "passed" boolean field.
 *
 * The results-dir must contain test-cases.json (copied there by runner-base.sh)
 * and per-test subdirectories with transcript.jsonl files.
 *
 * Outputs (full mode):
 *   <results-dir>/stats-analysis.json  — structured check results
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

interface StatsChecks {
  /** Full conversation corpus contains this exact string (case-sensitive) */
  response_contains?: string;
  /** Full conversation corpus contains at least one of these strings */
  response_contains_any?: string[];
  /**
   * Stats-specific: verify ALL 5 stats command names appear in the response.
   * Checks for: report, dashboard, clear, config, help.
   * Used for /stats:help validation.
   */
  response_contains_all_commands?: boolean;
  /** At least one Bash tool call command contains this string */
  bash_command_contains?: string;
  /** At least one Bash tool call command contains one of these strings */
  bash_command_contains_any?: string[];
  /** Minimum total tool calls (any tool, not just Bash) */
  min_tool_calls?: number;
  /** Minimum calls per tool (short name) */
  min_tool_calls_by_name?: Record<string, number>;
  /**
   * Stats-specific: whether the DB appears to have data.
   * Passes if any response text mentions session/tool_call count > 0,
   * or any Bash output contains numeric stats data (Sessions:, tool_calls, etc.).
   */
  stats_db_has_data?: boolean;
  /**
   * Stats-specific: verify a config value appears in the response.
   * Checks that response text contains both the key and the value.
   * Example: { key: "retention_days", value: 90 }
   */
  stats_config_value?: { key: string; value: string | number | boolean };
}

interface TestCase {
  id: string;
  description: string;
  prompt?: string;
  category?: string;
  tags?: string[];
  checks?: StatsChecks;
  [key: string]: unknown;
}

interface TestCasesFile {
  meta: TestCaseMeta;
  test_cases: TestCase[];
}

interface ToolUse {
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
  description: string;
  transcript_path: string;
  passed: boolean;
  checks: CheckResult[];
  summary: {
    total_checks: number;
    passed_checks: number;
    failed_checks: number;
    total_tool_calls: number;
    tool_names: string[];
    final_response_length: number;
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
  tests: TestAnalysis[];
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

interface TranscriptEntry {
  type: string;
  id?: string;
  timestamp?: string;
  subtype?: string;
  is_error?: boolean;
  num_turns?: number;
  message?: {
    content: Array<{
      type: "text" | "tool_use" | "tool_result";
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string | Array<{ type: string; text?: string }>;
    }>;
  };
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
 * Extract ALL tool calls from transcript entries (any tool type).
 */
function extractAllToolCalls(entries: TranscriptEntry[]): ToolUse[] {
  const calls: ToolUse[] = [];
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of entry.message?.content ?? []) {
      if (block.type === "tool_use" && block.name) {
        calls.push({ name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
      }
    }
  }
  return calls;
}

/**
 * Extract the final assistant text response from the transcript.
 *
 * claudish --json output produces a single type==="result" entry whose `result`
 * field holds the complete final text. We check for this first.
 *
 * For native claude -p output, we fall back to the last assistant message text blocks.
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
 * Collect ALL text across the full conversation: every assistant text block,
 * every tool result output, and the top-level result entry.
 *
 * This is the authoritative text corpus for response_contains checks.
 * Unique markers (like "STATS_SEED_OK") can appear in:
 *   - Intermediate assistant text turns
 *   - Bash/echo tool output (tool_result entries)
 *   - The top-level type==="result" field
 */
function extractAllResponseText(entries: TranscriptEntry[]): string {
  const parts: string[] = [];

  for (const entry of entries) {
    if (entry.type === "assistant") {
      for (const block of entry.message?.content ?? []) {
        if (block.type === "text" && block.text) {
          parts.push(block.text);
        }
      }
    }

    if (entry.type === "user") {
      for (const block of entry.message?.content ?? []) {
        if (block.type === "tool_result") {
          const inner = block.content;
          if (typeof inner === "string") {
            parts.push(inner);
          } else if (Array.isArray(inner)) {
            for (const item of inner) {
              if (item.type === "text" && item.text) {
                parts.push(item.text);
              }
            }
          }
        }
      }
    }

    if (entry.type === "result" && typeof entry.result === "string" && entry.result.length > 0) {
      parts.push(entry.result);
    }
  }

  return parts.join("\n");
}

/**
 * Extract tool result output texts from user entries in the transcript.
 */
function extractToolResults(entries: TranscriptEntry[]): Map<string, string> {
  const results = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "user") continue;
    for (const block of entry.message?.content ?? []) {
      if (block.type !== "tool_result") continue;
      const toolUseId = block.tool_use_id ?? "";
      const inner = block.content;
      if (typeof inner === "string") {
        results.set(toolUseId, inner);
      } else if (Array.isArray(inner)) {
        const texts = inner
          .filter((item) => item.type === "text" && item.text)
          .map((item) => item.text ?? "");
        if (texts.length > 0) {
          results.set(toolUseId, texts.join("\n"));
        }
      }
    }
  }
  return results;
}

interface BashCallRecord {
  toolUseId: string;
  command: string;
  output: string;
}

function extractBashCallRecords(
  entries: TranscriptEntry[],
  toolResults: Map<string, string>
): BashCallRecord[] {
  const records: BashCallRecord[] = [];
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of entry.message?.content ?? []) {
      if (
        block.type === "tool_use" &&
        (block.name === "Bash" || block.name === "bash") &&
        block.id
      ) {
        const command = String(block.input?.command ?? "");
        const output = toolResults.get(block.id) ?? "";
        records.push({ toolUseId: block.id, command, output });
      }
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Check evaluation
// ---------------------------------------------------------------------------

function evaluateChecks(
  checks: StatsChecks,
  allToolCalls: ToolUse[],
  finalResponse: string,
  allResponseText: string,
  bashRecords: BashCallRecord[]
): CheckResult[] {
  const results: CheckResult[] = [];

  const bashCalls = allToolCalls.filter(
    (c) => c.name === "Bash" || c.name === "bash"
  );
  const bashCommands = bashCalls.map((c) => String(c.input?.command ?? ""));

  // --- response_contains ---
  if (checks.response_contains !== undefined) {
    const needle = checks.response_contains;
    const found = allResponseText.includes(needle);
    results.push({
      check: "response_contains",
      passed: found,
      detail: found
        ? `Response contains expected text: "${needle.slice(0, 60)}"`
        : `Response does NOT contain: "${needle.slice(0, 60)}". Response length: ${finalResponse.length} chars`,
    });
  }

  // --- response_contains_any ---
  if (checks.response_contains_any !== undefined) {
    const candidates = checks.response_contains_any;
    const found = candidates.some(
      (c) => finalResponse.includes(c) || allResponseText.includes(c)
    );
    const matched = candidates.filter(
      (c) => finalResponse.includes(c) || allResponseText.includes(c)
    );
    results.push({
      check: "response_contains_any",
      passed: found,
      detail: found
        ? `Response contains one of: ${matched.map((m) => `"${m}"`).join(", ")}`
        : `Response contains none of: ${candidates.map((c) => `"${c}"`).join(", ")}. Response length: ${finalResponse.length} chars`,
    });
  }

  // --- response_contains_all_commands ---
  // Used for /stats:help validation: requires ALL 5 command names in response.
  if (checks.response_contains_all_commands !== undefined && checks.response_contains_all_commands) {
    const required = ["report", "dashboard", "clear", "config", "help"];
    const missing = required.filter(
      (cmd) => !finalResponse.includes(cmd) && !allResponseText.includes(cmd)
    );
    const passed = missing.length === 0;
    results.push({
      check: "response_contains_all_commands",
      passed,
      detail: passed
        ? `All 5 command names found: ${required.join(", ")}`
        : `Missing command names: ${missing.join(", ")}. All required: ${required.join(", ")}`,
    });
  }

  // --- bash_command_contains ---
  if (checks.bash_command_contains !== undefined) {
    const needle = checks.bash_command_contains;
    const found = bashCommands.some((cmd) => cmd.includes(needle));
    results.push({
      check: "bash_command_contains",
      passed: found,
      detail: found
        ? `Bash command contains "${needle}"`
        : bashCalls.length === 0
          ? `No Bash tool calls found in transcript (may need internal model mode)`
          : `No Bash command contains "${needle}". Commands: ${bashCommands.slice(0, 3).map((c) => c.slice(0, 60)).join(" | ")}`,
    });
  }

  // --- bash_command_contains_any ---
  if (checks.bash_command_contains_any !== undefined) {
    const candidates = checks.bash_command_contains_any;
    const found = candidates.some((needle) =>
      bashCommands.some((cmd) => cmd.includes(needle))
    );
    const matched = candidates.filter((needle) =>
      bashCommands.some((cmd) => cmd.includes(needle))
    );
    results.push({
      check: "bash_command_contains_any",
      passed: found,
      detail: found
        ? `Bash commands contain: ${matched.map((m) => `"${m}"`).join(", ")}`
        : bashCalls.length === 0
          ? `No Bash tool calls found in transcript (may need internal model mode)`
          : `No Bash command contains any of: ${candidates.map((c) => `"${c}"`).join(", ")}`,
    });
  }

  // --- min_tool_calls ---
  if (checks.min_tool_calls !== undefined) {
    const actual = allToolCalls.length;
    const required = checks.min_tool_calls;
    const passed = actual >= required;
    results.push({
      check: "min_tool_calls",
      passed,
      detail: passed
        ? `${actual} tool calls (minimum: ${required})`
        : `Only ${actual} tool calls, expected at least ${required}`,
    });
  }

  // --- min_tool_calls_by_name ---
  if (checks.min_tool_calls_by_name !== undefined) {
    const countByName: Record<string, number> = {};
    for (const call of allToolCalls) {
      countByName[call.name] = (countByName[call.name] ?? 0) + 1;
    }

    for (const [toolName, minCount] of Object.entries(checks.min_tool_calls_by_name)) {
      const actual = countByName[toolName] ?? 0;
      const passed = actual >= minCount;
      results.push({
        check: `min_tool_calls_by_name[${toolName}]`,
        passed,
        detail: passed
          ? `${toolName} called ${actual}x (minimum: ${minCount})`
          : `${toolName} called ${actual}x, expected at least ${minCount}x`,
      });
    }
  }

  // --- stats_db_has_data ---
  //
  // Strategy: passes if the response text contains indicators of non-zero data:
  // - Session count > 0 mentioned (e.g. "1 session", "Sessions: 3", "42")
  // - Tool call stats mentioned (e.g. "tool calls", "total_tool_calls")
  // - Bash output shows SQL query result with row count > 0
  // - Any seed confirmation marker from our test prompts (SEED_OK patterns)
  //
  // The check verifies the stats database appears to hold real data — either
  // from our seed scripts or from actual hook activity.
  if (checks.stats_db_has_data !== undefined) {
    const expected = checks.stats_db_has_data;

    // Check 1: SQL query outputs from bun inline scripts show data
    const sqlDataPatterns = [
      /SESSION_ROW:\s*\{/,
      /"total_tool_calls"\s*:\s*[1-9]/,
      /"session_count"\s*:\s*[1-9]/,
      /SESSION_COUNT:\s*\{\s*"n"\s*:\s*[1-9]/,
    ];
    const sqlShowsData = sqlDataPatterns.some((p) => p.test(allResponseText));

    // Check 2: Stats command output shows non-zero sessions
    const statsOutputPatterns = [
      /Sessions:\s*[1-9]/i,
      /[1-9]\d*\s+sessions?/i,
      /total_tool_calls[^0-9]*[1-9]/i,
      /tool calls[^0-9]*[1-9]/i,
    ];
    const statsShowsData = statsOutputPatterns.some((p) => p.test(allResponseText));

    // Check 3: Seed OK markers confirm data was inserted
    const seedMarkers = [
      "STATS_SEED_OK",
      "RENDER_SEED_OK",
      "SUGGEST_SEED_OK",
      "SEED_SESSION_OK",
      "CLEAR_SEED_OK",
    ];
    const seedConfirmed = seedMarkers.some((m) => allResponseText.includes(m));

    // Check 4: Bash commands reference stats.db with SELECT/INSERT
    const dbAccessPatterns = [
      /INSERT INTO sessions/i,
      /SELECT.*FROM sessions/i,
      /stats\.db/,
    ];
    const dbAccessed = bashRecords.some((r) =>
      dbAccessPatterns.some((p) => p.test(r.command) || p.test(r.output))
    );

    const hasData = sqlShowsData || statsShowsData || seedConfirmed || dbAccessed;
    const passed = expected ? hasData : !hasData;

    results.push({
      check: "stats_db_has_data",
      passed,
      detail: passed
        ? hasData
          ? `Stats DB appears to have data (sqlShowsData=${sqlShowsData}, statsShowsData=${statsShowsData}, seedConfirmed=${seedConfirmed}, dbAccessed=${dbAccessed})`
          : `Stats DB correctly appears empty`
        : expected
          ? `Stats DB does NOT appear to have data. sqlShowsData=${sqlShowsData}, statsShowsData=${statsShowsData}, seedConfirmed=${seedConfirmed}, dbAccessed=${dbAccessed}`
          : `Stats DB unexpectedly appears to have data`,
    });
  }

  // --- stats_config_value ---
  //
  // Strategy: checks that a config key and its expected value both appear in
  // the response text. The value is converted to string for matching.
  // Handles both JSON format ("retention_days": 90) and display format.
  if (checks.stats_config_value !== undefined) {
    const { key, value } = checks.stats_config_value;
    const valueStr = String(value);

    // Check both the key name and value appear in response
    const keyPresent = allResponseText.includes(key);
    const valuePresent = allResponseText.includes(valueStr);

    // Also check JSON-like pattern: "key": value or "key":value
    const jsonPattern = new RegExp(
      `"${key}"\\s*:\\s*${valueStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    );
    const jsonMatch = jsonPattern.test(allResponseText);

    const passed = (keyPresent && valuePresent) || jsonMatch;
    results.push({
      check: "stats_config_value",
      passed,
      detail: passed
        ? jsonMatch
          ? `Config key "${key}" with value ${valueStr} found in JSON format`
          : `Config key "${key}" and value "${valueStr}" both present in response`
        : !keyPresent
          ? `Config key "${key}" not found in response`
          : `Config key "${key}" found but value "${valueStr}" not present in response`,
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
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

// ---------------------------------------------------------------------------
// Per-test mode (called by runner-base.sh with two args)
// ---------------------------------------------------------------------------

function runPerTestMode(transcriptPath: string, checksJson: string): void {
  let checks: StatsChecks;
  try {
    checks = JSON.parse(checksJson) as StatsChecks;
  } catch (e) {
    console.log(JSON.stringify({ passed: false, error: `Failed to parse checks JSON: ${e}` }));
    process.exit(0);
  }

  if (!existsSync(transcriptPath)) {
    console.log(JSON.stringify({ passed: false, error: `Transcript not found: ${transcriptPath}` }));
    process.exit(0);
  }

  let entries: TranscriptEntry[];
  try {
    entries = parseTranscript(transcriptPath);
  } catch (e) {
    console.log(JSON.stringify({ passed: false, error: `Failed to parse transcript: ${e}` }));
    process.exit(0);
  }

  const allToolCalls = extractAllToolCalls(entries);
  const finalResponse = extractFinalResponse(entries);
  const allResponseText = extractAllResponseText(entries);
  const toolResults = extractToolResults(entries);
  const bashRecords = extractBashCallRecords(entries, toolResults);

  const checkResults = evaluateChecks(checks, allToolCalls, finalResponse, allResponseText, bashRecords);
  const allPassed = checkResults.every((r) => r.passed);

  console.log(JSON.stringify({
    passed: allPassed,
    checks: checkResults,
    summary: {
      total_checks: checkResults.length,
      passed_checks: checkResults.filter((r) => r.passed).length,
      failed_checks: checkResults.filter((r) => !r.passed).length,
      total_tool_calls: allToolCalls.length,
    },
  }));

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Full results-directory mode
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage:");
    console.error("  bun analyze-results.ts <results-dir>            # full run analysis");
    console.error("  bun analyze-results.ts <transcript.jsonl> <checks_json>  # per-test mode");
    process.exit(1);
  }

  // Per-test mode: two args, first ends in .jsonl, second is JSON string
  if (args.length === 2 && args[0].endsWith(".jsonl")) {
    runPerTestMode(args[0], args[1]);
    return;
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

  const testCasesFile: TestCasesFile = JSON.parse(
    readFileSync(testCasesPath, "utf-8")
  );
  const testCases = testCasesFile.test_cases;

  console.log(`\n${colorize("=== Stats Plugin E2E Analyzer ===", BOLD)}`);
  console.log(`Results dir: ${resultsDir}`);
  console.log(`Test cases:  ${testCases.length}`);
  console.log("");

  function findTranscripts(dir: string, depth: number = 0): string[] {
    if (depth > 3) return [];
    const found: string[] = [];
    let subdirNames: string[];
    try {
      subdirNames = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
    for (const entry of subdirNames) {
      const subdir = join(dir, entry);
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

    if (!tc.checks || Object.keys(tc.checks).length === 0) {
      skipped++;
      continue;
    }

    let entries: TranscriptEntry[];
    try {
      entries = parseTranscript(transcriptPath);
    } catch (e) {
      console.error(`  ERROR: Failed to parse ${transcriptPath}: ${e}`);
      skipped++;
      continue;
    }

    const allToolCalls = extractAllToolCalls(entries);
    const finalResponse = extractFinalResponse(entries);
    const allResponseText = extractAllResponseText(entries);
    const toolResults = extractToolResults(entries);
    const bashRecords = extractBashCallRecords(entries, toolResults);

    const checkResults = evaluateChecks(tc.checks, allToolCalls, finalResponse, allResponseText, bashRecords);
    const allPassed = checkResults.every((r) => r.passed);
    const uniqueTools = [...new Set(allToolCalls.map((c) => c.name))];

    testAnalyses.push({
      test_id: caseId,
      description: tc.description,
      transcript_path: transcriptPath,
      passed: allPassed,
      checks: checkResults,
      summary: {
        total_checks: checkResults.length,
        passed_checks: checkResults.filter((r) => r.passed).length,
        failed_checks: checkResults.filter((r) => !r.passed).length,
        total_tool_calls: allToolCalls.length,
        tool_names: uniqueTools,
        final_response_length: finalResponse.length,
      },
    });
  }

  // Sort analyses by test case order in test-cases.json
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

  // --- Print summary table ---
  console.log(colorize("=== Check Results Per Test ===", BOLD));
  console.log("");

  for (const analysis of testAnalyses) {
    const icon = analysis.passed ? colorize("PASS", GREEN) : colorize("FAIL", RED);
    const checksStr = `${analysis.summary.passed_checks}/${analysis.summary.total_checks}`;
    const toolCount = analysis.summary.total_tool_calls;
    console.log(
      `${icon} ${colorize(padEnd(analysis.test_id, 36), BOLD)} checks=${checksStr} tool_calls=${toolCount}`
    );

    for (const chk of analysis.checks) {
      if (!chk.passed) {
        console.log(
          `     ${colorize("FAIL", RED)} ${colorize(chk.check, YELLOW)}: ${chk.detail}`
        );
      }
    }

    for (const chk of analysis.checks) {
      if (chk.passed) {
        console.log(
          `     ${colorize("ok  ", DIM)} ${colorize(chk.check, DIM)}: ${colorize(chk.detail.slice(0, 80), DIM)}`
        );
      }
    }
    console.log("");
  }

  if (skipped > 0) {
    console.log(colorize(`(${skipped} test(s) skipped: no transcript or no checks defined)`, DIM));
    console.log("");
  }

  // --- Print overall summary ---
  console.log(colorize("=== Overall Results ===", BOLD));
  console.log(`Analyzed:  ${totalAnalyzed}`);
  console.log(`Passed:    ${colorize(String(passedTests), passedTests === totalAnalyzed ? GREEN : YELLOW)}`);
  console.log(`Failed:    ${colorize(String(failedTests), failedTests > 0 ? RED : GREEN)}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Pass rate: ${colorize(`${passRate}%`, passRate === 100 ? GREEN : passRate >= 50 ? YELLOW : RED)}`);
  console.log("");

  // --- Write stats-analysis.json ---
  const output: AnalysisOutput = {
    results_dir: resultsDir,
    analyzed_at: new Date().toISOString(),
    total_tests: totalAnalyzed,
    passed_tests: passedTests,
    failed_tests: failedTests,
    skipped_tests: skipped,
    pass_rate: passRate,
    tests: testAnalyses,
  };

  const outputPath = join(resultsDir, "stats-analysis.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Analysis written to: ${outputPath}`);
  console.log("");

  process.exit(failedTests > 0 ? 1 : 0);
}

main();
