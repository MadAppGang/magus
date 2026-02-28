#!/usr/bin/env bun
/**
 * analyze-results.ts - Terminal plugin E2E test analyzer
 *
 * Validates terminal-specific checks in transcript.jsonl files produced by
 * the shared autotest framework (runner-base.sh + execute-test.sh).
 *
 * Usage:
 *   bun ./autotest/terminal/analyze-results.ts <results-dir>
 *
 * The results-dir must contain test-cases.json (copied there by runner-base.sh)
 * and per-test subdirectories with transcript.jsonl files.
 *
 * Outputs:
 *   <results-dir>/terminal-analysis.json  — structured check results
 *   stdout                                — human-readable summary table
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

interface TerminalChecks {
  /** At least one tool call name starts with this prefix */
  has_tool_prefix?: string;
  /** Also has tool calls starting with this second prefix (for cross-backend) */
  has_tool_prefix_also?: string;
  /** No tool call name starts with this prefix */
  no_tool_prefix?: string;
  /** All listed tool (short) names were called at least once */
  tools_used_include?: string[];
  /** At least one full set of tool names from the OR list is fully satisfied */
  tools_used_include_any?: string[][];
  /** Minimum total MCP tool calls */
  min_tool_calls?: number;
  /** Minimum calls per tool (short name, without MCP prefix) */
  min_tool_calls_by_name?: Record<string, number>;
  /** Final assistant response contains this exact string (case-sensitive) */
  response_contains?: string;
  /** Final assistant response contains at least one of these strings */
  response_contains_any?: string[];
}

interface TestCase {
  id: string;
  description: string;
  prompt?: string;
  expected_agent?: string;
  expected_alternatives?: string[];
  category?: string;
  tags?: string[];
  checks?: TerminalChecks;
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
    total_mcp_tool_calls: number;
    mcp_tool_names: string[];
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
// Tool name normalization
// ---------------------------------------------------------------------------

/**
 * Normalize MCP tool names so both prefix variants are treated as equivalent.
 *
 * The MCP system exposes tools under two possible prefixes:
 *   mcp__ht-mcp__ht_create_session  (binary name)
 *   mcp__ht__ht_create_session       (config key name)
 *
 * Similarly for tmux:
 *   mcp__tmux-mcp__list-sessions
 *   mcp__tmux__list-sessions
 *
 * This function returns the canonical prefix form (without trailing double-underscore).
 */
function normalizeToolPrefix(name: string): { prefix: string; shortName: string } {
  // Step 1: Normalize long-form binary-name variants → canonical double-underscore form
  //   mcp__ht-mcp__ht_create_session  →  mcp__ht__ht_create_session
  //   mcp__tmux-mcp__list-sessions    →  mcp__tmux__list-sessions
  let normalized = name
    .replace(/^mcp__ht-mcp__/, "mcp__ht__")
    .replace(/^mcp__tmux-mcp__/, "mcp__tmux__");

  // Step 2: Normalize short-form metrics.json variants → canonical double-underscore form.
  //   metrics.json records tool names stripped of the middle segment, e.g.:
  //     mcp__ht_create_session  (no double-underscore after the server prefix)
  //   These look like mcp__ + single-segment names starting with "ht_" or "tmux_".
  //   Detect by checking: starts with "mcp__" AND does NOT already contain a second "__".
  if (/^mcp__ht_(?!_)/.test(normalized)) {
    // e.g. mcp__ht_create_session → mcp__ht__ht_create_session
    // Negative lookahead (?!_) prevents matching already-canonical mcp__ht__ht_*
    normalized = normalized.replace(/^mcp__ht_(?!_)/, "mcp__ht__ht_");
  } else if (/^mcp__tmux_(?!_)/.test(normalized)) {
    // e.g. mcp__tmux_list-sessions → mcp__tmux__list-sessions
    // Negative lookahead prevents matching already-canonical mcp__tmux__*
    normalized = normalized.replace(/^mcp__tmux_(?!_)/, "mcp__tmux__");
  }

  // Step 3: Split into prefix and shortName at the second "__"
  const underscoreIdx = normalized.indexOf("__", 4); // skip leading "mcp__"
  if (underscoreIdx === -1) {
    return { prefix: normalized, shortName: normalized };
  }
  const prefix = normalized.slice(0, underscoreIdx + 2); // e.g. "mcp__ht__"
  const shortName = normalized.slice(underscoreIdx + 2);  // e.g. "ht_create_session"
  return { prefix, shortName };
}

/**
 * Returns true if the tool name (after normalization) starts with the given prefix.
 * The prefix can be in either variant form ("mcp__ht__" or "mcp__ht-mcp__").
 */
function toolMatchesPrefix(toolName: string, prefix: string): boolean {
  // Normalize both sides to canonical form before comparing
  const normalizedTool = normalizeToolPrefix(toolName).prefix + normalizeToolPrefix(toolName).shortName;
  const normalizedPrefix = normalizeToolPrefix(prefix).prefix;
  return normalizedTool.startsWith(normalizedPrefix);
}

/**
 * Returns the full canonical name for a tool (prefix + shortName after normalization).
 * e.g. "mcp__ht_create_session"     → "mcp__ht__ht_create_session"
 *      "mcp__ht__ht_create_session"  → "mcp__ht__ht_create_session"
 *      "mcp__tmux_list-sessions"     → "mcp__tmux__list-sessions"
 */
function canonicalName(name: string): string {
  const { prefix, shortName } = normalizeToolPrefix(name);
  return prefix + shortName;
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
      type: "text" | "tool_use";
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  /** Present on type==="result" entries from claudish --json output */
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
 * Extract MCP tool calls from metrics.json (primary source).
 *
 * metrics.json is generated by the framework's debug-log-parser and contains
 * totals.tool_call_sequence — a flat ordered array of every tool called.
 *
 * The names in metrics.json use a short form: "mcp__ht_create_session"
 * (the double-underscore server separator is absent). normalizeToolPrefix()
 * handles converting these to the canonical form.
 *
 * Returns null if metrics.json does not exist or cannot be parsed.
 */
function extractToolCallsFromMetrics(metricsPath: string): ToolUse[] | null {
  if (!existsSync(metricsPath)) return null;
  try {
    const raw = readFileSync(metricsPath, "utf-8");
    const metrics = JSON.parse(raw) as { totals?: { tool_call_sequence?: string[] } };
    const seq = metrics?.totals?.tool_call_sequence;
    if (!Array.isArray(seq)) return null;
    return seq
      .filter((name) => typeof name === "string" && name.startsWith("mcp__"))
      .map((name) => ({ name, input: {} }));
  } catch {
    return null;
  }
}

/**
 * Extract MCP tool calls from debug.log SSE events (native Anthropic format).
 *
 * When claudish runs in native mode (e.g., --model claude-sonnet-4-6), the debug
 * log contains raw Anthropic SSE events rather than the OpenRouter format that
 * debug-log-parser.ts expects. Tool calls appear as:
 *   data: {"type":"content_block_start",...,"content_block":{"type":"tool_use","name":"mcp__ht-mcp__ht_create_session",...}}
 *
 * Returns null if debug.log doesn't exist or contains no SSE tool_use events.
 */
function extractToolCallsFromDebugLogSSE(debugLogPath: string): ToolUse[] | null {
  if (!existsSync(debugLogPath)) return null;
  try {
    const content = readFileSync(debugLogPath, "utf-8");
    // Match content_block_start events with tool_use type and extract tool name
    const re = /content_block_start[^}]*"type"\s*:\s*"tool_use"[^}]*"name"\s*:\s*"([^"]+)"/g;
    const calls: ToolUse[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const name = match[1];
      if (name.startsWith("mcp__")) {
        calls.push({ name, input: {} });
      }
    }
    return calls.length > 0 ? calls : null;
  } catch {
    return null;
  }
}

/**
 * Extract all MCP tool calls.
 *
 * Sources (in priority order):
 * 1. metrics.json → tool_call_sequence (from debug-log-parser, OpenRouter format)
 * 2. transcript.jsonl → intermediate assistant tool_use blocks (full transcript)
 * 3. debug.log → SSE content_block_start events (native Anthropic format)
 *
 * Only returns calls whose names start with "mcp__" (terminal plugin tools).
 */
function extractMcpToolCalls(transcriptDir: string, entries: TranscriptEntry[]): ToolUse[] {
  // Primary: metrics.json (OpenRouter format)
  const metricsPath = join(transcriptDir, "metrics.json");
  const fromMetrics = extractToolCallsFromMetrics(metricsPath);
  if (fromMetrics !== null && fromMetrics.length > 0) {
    return fromMetrics;
  }

  // Fallback 1: parse transcript.jsonl for assistant tool_use blocks
  const calls: ToolUse[] = [];
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of entry.message?.content ?? []) {
      if (block.type === "tool_use" && block.name?.startsWith("mcp__")) {
        calls.push({ name: block.name, input: block.input ?? {} });
      }
    }
  }
  if (calls.length > 0) return calls;

  // Fallback 2: parse debug.log SSE events (native Anthropic format)
  const debugLogPath = join(transcriptDir, "debug.log");
  const fromSSE = extractToolCallsFromDebugLogSSE(debugLogPath);
  if (fromSSE !== null) {
    return fromSSE;
  }

  return [];
}

/**
 * Extract the final assistant text response from the transcript.
 *
 * claudish --json output produces a single type==="result" entry whose `result`
 * field holds the complete final text. We check for this first.
 *
 * For transcripts that DO include intermediate assistant turns (e.g. native
 * claude -p output), we fall back to the existing logic of collecting the last
 * assistant message's text blocks.
 */
function extractFinalResponse(entries: TranscriptEntry[]): string {
  // Primary: look for a type==="result" entry with a string result field.
  // claudish --json always produces exactly one such entry.
  for (const entry of entries) {
    if (entry.type === "result" && typeof entry.result === "string" && entry.result.length > 0) {
      return entry.result;
    }
  }

  // Fallback: last assistant message's text blocks (full transcript format)
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

// ---------------------------------------------------------------------------
// Check evaluation
// ---------------------------------------------------------------------------

function evaluateChecks(
  checks: TerminalChecks,
  mcpCalls: ToolUse[],
  finalResponse: string
): CheckResult[] {
  const results: CheckResult[] = [];

  const normalizedCalls = mcpCalls.map((c) => ({
    ...c,
    normalized: normalizeToolPrefix(c.name),
  }));

  const allShortNames = normalizedCalls.map((c) => c.normalized.shortName);
  const allOriginalNames = mcpCalls.map((c) => c.name);
  const allCanonicalNames = mcpCalls.map((c) => canonicalName(c.name));

  // --- has_tool_prefix ---
  if (checks.has_tool_prefix !== undefined) {
    const prefix = checks.has_tool_prefix;
    const found = allOriginalNames.some((n) => toolMatchesPrefix(n, prefix));
    results.push({
      check: "has_tool_prefix",
      passed: found,
      detail: found
        ? `At least one tool call uses prefix "${prefix}"`
        : `No tool calls with prefix "${prefix}" found. Tools used: [${allOriginalNames.slice(0, 8).join(", ")}]`,
    });
  }

  // --- has_tool_prefix_also ---
  if (checks.has_tool_prefix_also !== undefined) {
    const prefix = checks.has_tool_prefix_also;
    const found = allOriginalNames.some((n) => toolMatchesPrefix(n, prefix));
    results.push({
      check: "has_tool_prefix_also",
      passed: found,
      detail: found
        ? `Cross-backend: also has tool calls with prefix "${prefix}"`
        : `Cross-backend check failed: no tools with prefix "${prefix}". Tools used: [${allOriginalNames.slice(0, 8).join(", ")}]`,
    });
  }

  // --- no_tool_prefix ---
  if (checks.no_tool_prefix !== undefined) {
    const prefix = checks.no_tool_prefix;
    const badCalls = allOriginalNames.filter((n) => toolMatchesPrefix(n, prefix));
    const passed = badCalls.length === 0;
    results.push({
      check: "no_tool_prefix",
      passed,
      detail: passed
        ? `Correctly used no tools with forbidden prefix "${prefix}"`
        : `Unexpected tool calls with prefix "${prefix}": [${badCalls.join(", ")}]`,
    });
  }

  // --- tools_used_include ---
  if (checks.tools_used_include !== undefined) {
    for (const requiredTool of checks.tools_used_include) {
      // Match by canonical name, short name, or original name (handles all prefix variants)
      const reqCanonical = canonicalName(requiredTool);
      const found =
        allCanonicalNames.includes(reqCanonical) ||
        allShortNames.includes(requiredTool) ||
        allOriginalNames.some(
          (n) =>
            n === requiredTool ||
            normalizeToolPrefix(n).shortName === requiredTool
        );
      results.push({
        check: `tools_used_include[${requiredTool}]`,
        passed: found,
        detail: found
          ? `Required tool "${requiredTool}" was called`
          : `Required tool "${requiredTool}" was NOT called. Short names available: [${allShortNames.slice(0, 10).join(", ")}]`,
      });
    }
  }

  // --- tools_used_include_any ---
  if (checks.tools_used_include_any !== undefined) {
    const orSets = checks.tools_used_include_any;
    let anySetSatisfied = false;
    const setDetails: string[] = [];

    for (const toolSet of orSets) {
      const satisfied = toolSet.every((requiredTool) => {
        const reqCanonical = canonicalName(requiredTool);
        return (
          allCanonicalNames.includes(reqCanonical) ||
          allShortNames.includes(requiredTool) ||
          allOriginalNames.some(
            (n) =>
              n === requiredTool ||
              normalizeToolPrefix(n).shortName === requiredTool
          )
        );
      });
      if (satisfied) {
        anySetSatisfied = true;
        setDetails.push(`[${toolSet.join(", ")}] SATISFIED`);
        break;
      } else {
        const missing = toolSet.filter((t) => {
          const reqCanonical = canonicalName(t);
          return (
            !allCanonicalNames.includes(reqCanonical) &&
            !allShortNames.includes(t) &&
            !allOriginalNames.some(
              (n) => n === t || normalizeToolPrefix(n).shortName === t
            )
          );
        });
        setDetails.push(`[${toolSet.join(", ")}] missing: ${missing.join(", ")}`);
      }
    }

    results.push({
      check: "tools_used_include_any",
      passed: anySetSatisfied,
      detail: anySetSatisfied
        ? `One of the required tool sets was fully satisfied`
        : `No tool set was fully satisfied. Details: ${setDetails.join(" | ")}`,
    });
  }

  // --- min_tool_calls ---
  if (checks.min_tool_calls !== undefined) {
    const actual = mcpCalls.length;
    const required = checks.min_tool_calls;
    const passed = actual >= required;
    results.push({
      check: "min_tool_calls",
      passed,
      detail: passed
        ? `${actual} MCP tool calls (minimum: ${required})`
        : `Only ${actual} MCP tool calls, expected at least ${required}`,
    });
  }

  // --- min_tool_calls_by_name ---
  if (checks.min_tool_calls_by_name !== undefined) {
    const countByShortName: Record<string, number> = {};
    for (const call of normalizedCalls) {
      const sn = call.normalized.shortName;
      countByShortName[sn] = (countByShortName[sn] ?? 0) + 1;
    }

    for (const [toolName, minCount] of Object.entries(checks.min_tool_calls_by_name)) {
      const actual = countByShortName[toolName] ?? 0;
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

  // --- response_contains ---
  if (checks.response_contains !== undefined) {
    const needle = checks.response_contains;
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
  if (checks.response_contains_any !== undefined) {
    const candidates = checks.response_contains_any;
    const found = candidates.some((c) => finalResponse.includes(c));
    const matched = candidates.filter((c) => finalResponse.includes(c));
    results.push({
      check: "response_contains_any",
      passed: found,
      detail: found
        ? `Response contains one of: ${matched.map((m) => `"${m}"`).join(", ")}`
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

  // Load test-cases.json from the results directory (copied there by runner-base.sh)
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

  console.log(`\n${colorize("=== Terminal Plugin E2E Analyzer ===", BOLD)}`);
  console.log(`Results dir: ${resultsDir}`);
  console.log(`Test cases:  ${testCases.length}`);
  console.log("");

  // Discover per-model subdirectories (runner-base.sh creates <model_slug>/<case_id>/)
  // or flat <case_id>/ directories (single-model run without model slug).
  const testAnalyses: TestAnalysis[] = [];
  let skipped = 0;

  // Walk the results dir looking for transcript.jsonl files
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
        // Recurse one more level (for model_slug/case_id/ structure)
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

  // Map transcript paths to test case IDs
  // Pattern: <results>/<model_slug>/<case_id>/transcript.jsonl
  //       or <results>/<case_id>/transcript.jsonl
  for (const transcriptPath of transcriptPaths) {
    const caseDir = transcriptPath.replace(/\/transcript\.jsonl$/, "");
    const caseId = basename(caseDir);

    const tc = testCases.find((c) => c.id === caseId);
    if (!tc) {
      // Could not match to a test case — skip
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

    const mcpCalls = extractMcpToolCalls(caseDir, entries);
    const finalResponse = extractFinalResponse(entries);

    const checkResults = evaluateChecks(tc.checks, mcpCalls, finalResponse);

    const allPassed = checkResults.every((r) => r.passed);

    const uniqueTools = [...new Set(mcpCalls.map((c) => c.name))];

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
        total_mcp_tool_calls: mcpCalls.length,
        mcp_tool_names: uniqueTools,
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
    const toolCount = analysis.summary.total_mcp_tool_calls;
    console.log(
      `${icon} ${colorize(padEnd(analysis.test_id, 36), BOLD)} checks=${checksStr} mcp_calls=${toolCount}`
    );

    // Print failed checks
    for (const chk of analysis.checks) {
      if (!chk.passed) {
        console.log(
          `     ${colorize("FAIL", RED)} ${colorize(chk.check, YELLOW)}: ${chk.detail}`
        );
      }
    }

    // Print passed checks in dim
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

  // --- Write terminal-analysis.json ---
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

  const outputPath = join(resultsDir, "terminal-analysis.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Analysis written to: ${outputPath}`);
  console.log("");

  process.exit(failedTests > 0 ? 1 : 0);
}

main();
