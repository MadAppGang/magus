#!/usr/bin/env bun
/**
 * analyze-results.ts - Browser-use plugin E2E test analyzer
 * Usage:  bun ./autotest/browser-use/analyze-results.ts <results-dir>
 * Output: <results-dir>/browser-use-analysis.json + stdout table
 * Exit:   0 all pass, 1 any fail
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";

// --- Types ------------------------------------------------------------------

interface BrowserUseChecks {
  has_tool_prefix?: string;
  tools_used_include_any?: string[][];
  min_tool_calls?: number;
  min_tool_calls_by_name?: Record<string, number>;
  response_contains?: string;
  response_contains_any?: string[];
  response_contains_all?: string[];
  response_not_contains?: string[];
  tool_result_contains?: Record<string, string>;
}

interface TestCase {
  id: string;
  description: string;
  checks?: BrowserUseChecks;
  [key: string]: unknown;
}

interface TestCasesFile { meta: { description: string; version: string; created: string; notes: string }; test_cases: TestCase[] }

interface ToolUse { name: string; input: Record<string, unknown> }

interface CheckResult { check: string; passed: boolean; detail: string }

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

interface AnalysisOutput { results_dir: string; analyzed_at: string; total_tests: number; passed_tests: number; failed_tests: number; skipped_tests: number; pass_rate: number; tests: TestAnalysis[] }

// --- Tool name normalization ------------------------------------------------
// All variants normalize to mcp__browser_use__<shortName>.
// Variants: plugin_browser[-_]use_browser[-_]use__, browser-use__, browser_use__, mcp__browser_<name>
// Also maps chrome-devtools tool names to browser-use equivalents (fallback path
// when browser-use MCP server can't load due to schema incompatibility).

const CHROME_DEVTOOLS_TO_BROWSER_USE: Record<string, string> = {
  "navigate_page": "browser_navigate",
  "take_screenshot": "browser_screenshot",
  "take_snapshot": "browser_get_state",
  "evaluate_script": "browser_run_script",
  "click": "browser_click",
  "type_text": "browser_type",
  "fill": "browser_type",
  "list_pages": "browser_list_tabs",
  "select_page": "browser_switch_tab",
  "close_page": "browser_close_tab",
  "new_page": "browser_navigate",
  "press_key": "browser_type",
};

function normalizeToolPrefix(name: string): { prefix: string; shortName: string } {
  // Map chrome-devtools tools to browser-use equivalents
  if (name.startsWith("mcp__chrome-devtools__") || name.startsWith("mcp__chrome_devtools__")) {
    const cdpName = name.replace(/^mcp__chrome[-_]devtools__/, "");
    const mapped = CHROME_DEVTOOLS_TO_BROWSER_USE[cdpName];
    if (mapped) {
      return { prefix: "mcp__browser_use__", shortName: mapped };
    }
    // Unknown chrome-devtools tool — still normalize prefix for matching
    return { prefix: "mcp__chrome_devtools__", shortName: cdpName };
  }

  let n = name
    .replace(/^mcp__plugin_browser[-_]use_browser[-_]use__/, "mcp__browser_use__")
    .replace(/^mcp__browser-use__/, "mcp__browser_use__");
  // Short form (metrics.json): mcp__browser_<name> → mcp__browser_use__browser_<name>
  if (/^mcp__browser_(?!use__)/.test(n)) n = n.replace(/^mcp__browser_/, "mcp__browser_use__browser_");

  const idx = n.indexOf("__", 4);
  if (idx === -1) return { prefix: n, shortName: n };
  return { prefix: n.slice(0, idx + 2), shortName: n.slice(idx + 2) };
}

function toolMatchesPrefix(toolName: string, prefix: string): boolean {
  if (prefix.startsWith("mcp__")) {
    const { prefix: p, shortName } = normalizeToolPrefix(toolName);
    return (p + shortName).startsWith(normalizeToolPrefix(prefix).prefix);
  }
  return normalizeToolPrefix(toolName).shortName.startsWith(prefix);
}

function canonicalName(name: string): string {
  const { prefix, shortName } = normalizeToolPrefix(name);
  return prefix + shortName;
}

// --- Transcript parsing + tool extraction -----------------------------------

interface TranscriptEntry {
  type: string;
  message?: { content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> };
  result?: string | unknown;
  line?: number;
  raw?: string;
}

function parseTranscript(path: string): TranscriptEntry[] {
  const raw = readFileSync(path, "utf-8").trim();
  // Handle both JSON array format and newline-delimited JSONL
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw) as TranscriptEntry[]; }
    catch { /* fall through to line-by-line parsing */ }
  }
  return raw
    .split("\n")
    .flatMap((line, i) => {
      const t = line.trim();
      if (!t) return [];
      try { return [JSON.parse(t) as TranscriptEntry]; }
      catch { return [{ type: "parse_error", line: i + 1, raw: t.slice(0, 200) }]; }
    });
}

function extractToolCallsFromMetrics(metricsPath: string): ToolUse[] | null {
  if (!existsSync(metricsPath)) return null;
  try {
    const seq = (JSON.parse(readFileSync(metricsPath, "utf-8")) as {
      totals?: { tool_call_sequence?: string[] };
    })?.totals?.tool_call_sequence;
    if (!Array.isArray(seq)) return null;
    return seq.filter((n) => typeof n === "string" && n.startsWith("mcp__")).map((n) => ({ name: n, input: {} }));
  } catch { return null; }
}

function extractToolCallsFromDebugLogSSE(debugLogPath: string): ToolUse[] | null {
  if (!existsSync(debugLogPath)) return null;
  try {
    const re = /content_block_start[^}]*"type"\s*:\s*"tool_use"[^}]*"name"\s*:\s*"([^"]+)"/g;
    const calls: ToolUse[] = [];
    let m: RegExpExecArray | null;
    const content = readFileSync(debugLogPath, "utf-8");
    while ((m = re.exec(content)) !== null) {
      if (m[1].startsWith("mcp__")) calls.push({ name: m[1], input: {} });
    }
    return calls.length > 0 ? calls : null;
  } catch { return null; }
}

function extractMcpToolCalls(transcriptDir: string, entries: TranscriptEntry[]): ToolUse[] {
  const fromMetrics = extractToolCallsFromMetrics(join(transcriptDir, "metrics.json"));
  if (fromMetrics?.length) return fromMetrics;

  const fromTranscript: ToolUse[] = [];
  for (const e of entries) {
    if (e.type !== "assistant") continue;
    for (const b of e.message?.content ?? []) {
      if (b.type === "tool_use" && b.name?.startsWith("mcp__")) {
        fromTranscript.push({ name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
      }
    }
  }
  if (fromTranscript.length > 0) return fromTranscript;

  return extractToolCallsFromDebugLogSSE(join(transcriptDir, "debug.log")) ?? [];
}

function extractFinalResponse(entries: TranscriptEntry[]): string {
  for (const e of entries) {
    if (e.type === "result" && typeof e.result === "string" && e.result.length > 0) return e.result;
  }
  let lastText = "";
  for (const e of entries) {
    if (e.type !== "assistant") continue;
    const parts = (e.message?.content ?? []).filter((b) => b.type === "text" && b.text).map((b) => b.text as string);
    if (parts.length > 0) lastText = parts.join("\n");
  }
  return lastText;
}

// --- Check evaluation -------------------------------------------------------

function evaluateChecks(checks: BrowserUseChecks, mcpCalls: ToolUse[], finalResponse: string): CheckResult[] {
  const results: CheckResult[] = [];
  const normCalls = mcpCalls.map((c) => ({ ...c, sn: normalizeToolPrefix(c.name).shortName }));
  const allShortNames = normCalls.map((c) => c.sn);
  const allOrigNames = mcpCalls.map((c) => c.name);
  const allCanonNames = mcpCalls.map((c) => canonicalName(c.name));

  const toolFound = (t: string) =>
    allCanonNames.includes(canonicalName(t)) ||
    allShortNames.includes(t) ||
    allOrigNames.some((n) => n === t || normalizeToolPrefix(n).shortName === t);

  if (checks.has_tool_prefix !== undefined) {
    const prefix = checks.has_tool_prefix;
    const found = allOrigNames.some((n) => toolMatchesPrefix(n, prefix));
    results.push({
      check: "has_tool_prefix",
      passed: found,
      detail: found
        ? `At least one tool call uses prefix "${prefix}"`
        : `No tool calls with prefix "${prefix}" found. Tools used: [${allOrigNames.slice(0, 8).join(", ")}]`,
    });
  }

  if (checks.tools_used_include_any !== undefined) {
    let satisfied = false;
    const details: string[] = [];
    for (const toolSet of checks.tools_used_include_any) {
      const missing = toolSet.filter((t) => !toolFound(t));
      if (missing.length === 0) {
        satisfied = true;
        details.push(`[${toolSet.join(", ")}] SATISFIED`);
        break;
      }
      details.push(`[${toolSet.join(", ")}] missing: ${missing.join(", ")}`);
    }
    results.push({
      check: "tools_used_include_any",
      passed: satisfied,
      detail: satisfied
        ? `One of the required tool sets was fully satisfied`
        : `No tool set was fully satisfied. Details: ${details.join(" | ")}`,
    });
  }

  if (checks.min_tool_calls !== undefined) {
    const actual = mcpCalls.length;
    const req = checks.min_tool_calls;
    const passed = actual >= req;
    results.push({
      check: "min_tool_calls",
      passed,
      detail: passed ? `${actual} MCP tool calls (minimum: ${req})` : `Only ${actual} MCP tool calls, expected at least ${req}`,
    });
  }

  if (checks.min_tool_calls_by_name !== undefined) {
    const counts: Record<string, number> = {};
    for (const c of normCalls) counts[c.sn] = (counts[c.sn] ?? 0) + 1;
    for (const [toolName, minCount] of Object.entries(checks.min_tool_calls_by_name)) {
      const actual = counts[toolName] ?? 0;
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

  if (checks.response_contains_any !== undefined) {
    const candidates = checks.response_contains_any;
    const matched = candidates.filter((c) => finalResponse.includes(c));
    const found = matched.length > 0;
    results.push({
      check: "response_contains_any",
      passed: found,
      detail: found
        ? `Response contains one of: ${matched.map((m) => `"${m}"`).join(", ")}`
        : `Response contains none of: ${candidates.map((c) => `"${c}"`).join(", ")}. Response length: ${finalResponse.length} chars`,
    });
  }

  if (checks.response_contains_all !== undefined) {
    const required = checks.response_contains_all;
    const missing = required.filter((r) => !finalResponse.includes(r));
    const allFound = missing.length === 0;
    results.push({
      check: "response_contains_all",
      passed: allFound,
      detail: allFound
        ? `Response contains all ${required.length} required strings`
        : `Response missing ${missing.length}/${required.length}: ${missing.map((m) => `"${m.slice(0, 40)}"`).join(", ")}`,
    });
  }

  if (checks.response_not_contains !== undefined) {
    const forbidden = checks.response_not_contains;
    const found = forbidden.filter((f) => finalResponse.toLowerCase().includes(f.toLowerCase()));
    const clean = found.length === 0;
    results.push({
      check: "response_not_contains",
      passed: clean,
      detail: clean
        ? `Response does not contain any of ${forbidden.length} forbidden strings`
        : `Response contains forbidden: ${found.map((f) => `"${f}"`).join(", ")}`,
    });
  }

  if (checks.tool_result_contains !== undefined) {
    const toolChecks = checks.tool_result_contains;
    for (const [toolName, expected] of Object.entries(toolChecks)) {
      const normalizedTool = toolName;
      const matchingCalls = mcpCalls.filter((c) => {
        const short = normalizeToolPrefix(c.tool_name);
        return short === normalizedTool || short.endsWith(normalizedTool);
      });
      const anyResultContains = matchingCalls.some((c) =>
        c.output && typeof c.output === "string" && c.output.includes(expected)
      );
      results.push({
        check: `tool_result_contains[${toolName}]`,
        passed: anyResultContains,
        detail: anyResultContains
          ? `${toolName} result contains "${expected.slice(0, 40)}"`
          : `No ${toolName} call result contains "${expected.slice(0, 40)}" (${matchingCalls.length} calls found)`,
      });
    }
  }

  return results;
}

const RESET = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", BOLD = "\x1b[1m", DIM = "\x1b[2m";
const colorize = (t: string, c: string) => `${c}${t}${RESET}`;
const padEnd = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);

function main(): void {
  const [resultsDir] = process.argv.slice(2);
  if (!resultsDir) {
    console.error("Usage: bun analyze-results.ts <results-dir>");
    console.error("  The results-dir must contain test-cases.json and per-test subdirectories.");
    process.exit(1);
  }
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

  const { test_cases: testCases } = JSON.parse(readFileSync(testCasesPath, "utf-8")) as TestCasesFile;

  console.log(`\n${colorize("=== Browser-use Plugin E2E Analyzer ===", BOLD)}`);
  console.log(`Results dir: ${resultsDir}`);
  console.log(`Test cases:  ${testCases.length}\n`);

  const testAnalyses: TestAnalysis[] = [];
  let skipped = 0;

  function findTranscripts(dir: string, depth = 0): string[] {
    if (depth > 3) return [];
    const found: string[] = [];
    let subdirs: string[];
    try { subdirs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
    catch { return []; }
    for (const entry of subdirs) {
      const subdir = join(dir, entry);
      const tp = join(subdir, "transcript.jsonl");
      if (existsSync(tp)) found.push(tp);
      else found.push(...findTranscripts(subdir, depth + 1));
    }
    return found;
  }

  const transcriptPaths = findTranscripts(resultsDir);
  if (transcriptPaths.length === 0) {
    console.error("WARNING: No transcript.jsonl files found. Use run.sh to execute tests first.");
  }

  for (const transcriptPath of transcriptPaths) {
    const caseDir = transcriptPath.replace(/\/transcript\.jsonl$/, "");
    const caseId = basename(caseDir);
    const tc = testCases.find((c) => c.id === caseId);

    if (!tc || !tc.checks || Object.keys(tc.checks).length === 0) { skipped++; continue; }

    let entries: TranscriptEntry[];
    try { entries = parseTranscript(transcriptPath); }
    catch (e) { console.error(`  ERROR: Failed to parse ${transcriptPath}: ${e}`); skipped++; continue; }

    const mcpCalls = extractMcpToolCalls(caseDir, entries);
    const finalResponse = extractFinalResponse(entries);
    const checkResults = evaluateChecks(tc.checks, mcpCalls, finalResponse);

    testAnalyses.push({
      test_id: caseId,
      description: tc.description,
      transcript_path: transcriptPath,
      passed: checkResults.every((r) => r.passed),
      checks: checkResults,
      summary: {
        total_checks: checkResults.length,
        passed_checks: checkResults.filter((r) => r.passed).length,
        failed_checks: checkResults.filter((r) => !r.passed).length,
        total_mcp_tool_calls: mcpCalls.length,
        mcp_tool_names: [...new Set(mcpCalls.map((c) => c.name))],
        final_response_length: finalResponse.length,
      },
    });
  }

  const orderMap = new Map(testCases.map((tc, i) => [tc.id, i]));
  testAnalyses.sort((a, b) => (orderMap.get(a.test_id) ?? 999) - (orderMap.get(b.test_id) ?? 999));

  const total = testAnalyses.length;
  const passed = testAnalyses.filter((t) => t.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  console.log(colorize("=== Check Results Per Test ===", BOLD));
  console.log("");

  for (const a of testAnalyses) {
    const icon = a.passed ? colorize("PASS", GREEN) : colorize("FAIL", RED);
    console.log(`${icon} ${colorize(padEnd(a.test_id, 36), BOLD)} checks=${a.summary.passed_checks}/${a.summary.total_checks} mcp_calls=${a.summary.total_mcp_tool_calls}`);
    for (const chk of a.checks) {
      if (!chk.passed) console.log(`     ${colorize("FAIL", RED)} ${colorize(chk.check, YELLOW)}: ${chk.detail}`);
    }
    for (const chk of a.checks) {
      if (chk.passed) console.log(`     ${colorize("ok  ", DIM)} ${colorize(chk.check, DIM)}: ${colorize(chk.detail.slice(0, 80), DIM)}`);
    }
    console.log("");
  }

  if (skipped > 0) {
    console.log(colorize(`(${skipped} test(s) skipped: no transcript or no checks defined)`, DIM));
    console.log("");
  }

  console.log(colorize("=== Overall Results ===", BOLD));
  console.log(`Analyzed:  ${total}`);
  console.log(`Passed:    ${colorize(String(passed), passed === total ? GREEN : YELLOW)}`);
  console.log(`Failed:    ${colorize(String(failed), failed > 0 ? RED : GREEN)}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Pass rate: ${colorize(`${passRate}%`, passRate === 100 ? GREEN : passRate >= 50 ? YELLOW : RED)}`);
  console.log("");

  const outputPath = join(resultsDir, "browser-use-analysis.json");
  writeFileSync(outputPath, JSON.stringify({
    results_dir: resultsDir,
    analyzed_at: new Date().toISOString(),
    total_tests: total,
    passed_tests: passed,
    failed_tests: failed,
    skipped_tests: skipped,
    pass_rate: passRate,
    tests: testAnalyses,
  } satisfies AnalysisOutput, null, 2));
  console.log(`Analysis written to: ${outputPath}`);
  console.log("");

  process.exit(failed > 0 ? 1 : 0);
}

main();
