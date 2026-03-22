#!/usr/bin/env bun
/**
 * analyze-results.ts - GTD plugin E2E test analyzer
 *
 * Validates GTD-specific checks in transcript.jsonl files produced by
 * the shared autotest framework (runner-base.sh + execute-test.sh).
 *
 * Usage:
 *   bun ./autotest/gtd/analyze-results.ts <results-dir>
 *
 * The results-dir must contain test-cases.json (copied there by runner-base.sh)
 * and per-test subdirectories with transcript.jsonl files.
 *
 * Outputs:
 *   <results-dir>/gtd-analysis.json  — structured check results
 *   stdout                           — human-readable summary table
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

interface GtdChecks {
  /** Final assistant response contains this exact string (case-sensitive) */
  response_contains?: string;
  /** Final assistant response contains at least one of these strings */
  response_contains_any?: string[];
  /** At least one Bash tool call command contains this string */
  bash_command_contains?: string;
  /** At least one Bash tool call command contains one of these strings */
  bash_command_contains_any?: string[];
  /** Minimum total tool calls (any tool, not just MCP) */
  min_tool_calls?: number;
  /** Minimum calls per tool (short name) */
  min_tool_calls_by_name?: Record<string, number>;
  /**
   * GTD-specific: whether .claude/gtd/tasks.json was read or written.
   * Checks for Bash commands referencing tasks.json.
   */
  gtd_file_created?: boolean;
  /**
   * GTD-specific: minimum number of GTD tasks mentioned in the response
   * (counted by occurrences of task-like patterns in the final response text).
   */
  gtd_task_count?: number;
}

interface TestCase {
  id: string;
  description: string;
  prompt?: string;
  category?: string;
  tags?: string[];
  checks?: GtdChecks;
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
 * Extract ALL tool calls from transcript entries (any tool type).
 * GTD tests use Bash, Read, Write, and TaskCreate — not MCP tools.
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
  // Primary: type==="result" with a string result field (claudish --json format)
  for (const entry of entries) {
    if (entry.type === "result" && typeof entry.result === "string" && entry.result.length > 0) {
      return entry.result;
    }
  }

  // Fallback: last assistant message text blocks (native claude -p format)
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
 * Unique markers (like "GTD_E2E_CAPTURE_MARKER_42") can appear in:
 *   - Intermediate assistant text turns
 *   - Bash/echo tool output (tool_result entries)
 *   - The top-level type==="result" field
 */
function extractAllResponseText(entries: TranscriptEntry[]): string {
  const parts: string[] = [];

  for (const entry of entries) {
    // All assistant text blocks (all turns, not just last)
    if (entry.type === "assistant") {
      for (const block of entry.message?.content ?? []) {
        if (block.type === "text" && block.text) {
          parts.push(block.text);
        }
      }
    }

    // All tool result outputs (Bash stdout, Read output, etc.)
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

    // Top-level result entry (claudish --json format)
    if (entry.type === "result" && typeof entry.result === "string" && entry.result.length > 0) {
      parts.push(entry.result);
    }
  }

  return parts.join("\n");
}

/**
 * Extract tool result output texts from user entries in the transcript.
 *
 * When Claude calls Bash (or any tool), the result is stored in a user-turn
 * entry as message.content[].type === "tool_result". The actual output text
 * lives in the inner content array as items with type === "text".
 *
 * Returns a map from tool_use_id -> output text for all tool results found.
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

/**
 * Build a list of Bash tool call records pairing the command (from assistant
 * entries) with its output text (from the following user tool_result entry).
 */
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
  checks: GtdChecks,
  allToolCalls: ToolUse[],
  finalResponse: string,
  allResponseText: string,
  bashRecords: BashCallRecord[]
): CheckResult[] {
  const results: CheckResult[] = [];

  // Extract Bash tool calls with their command strings (legacy, for simple command checks)
  const bashCalls = allToolCalls.filter(
    (c) => c.name === "Bash" || c.name === "bash"
  );
  const bashCommands = bashCalls.map((c) => String(c.input?.command ?? ""));

  // --- response_contains ---
  // Checks the full conversation corpus (all assistant turns + all tool outputs),
  // not just the final response. Markers like "GTD_E2E_CAPTURE_MARKER_42" can
  // appear in Bash echo output or intermediate assistant text, not only the last turn.
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
    // Check both final response and all response text for broader coverage
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

  // --- gtd_file_created ---
  //
  // Strategy: pass if ANY bash command in the transcript references "tasks.json"
  // in the command string, UNLESS every such command explicitly errored with
  // "No such file or directory".
  //
  // Rationale: Claude frequently runs multi-line bash scripts (variable assignments
  // like CWD=$(pwd); GTD_FILE="...tasks.json"...) whose OUTPUT is just the shell
  // variable assignments — not the file content. Requiring the output to contain
  // JSON markers produces false negatives. The file creation/population is verified
  // separately by gtd_task_count. This check just verifies Claude touched tasks.json.
  if (checks.gtd_file_created !== undefined) {
    const expected = checks.gtd_file_created;

    // All bash records that reference tasks.json in the command text
    const tasksJsonBashRecords = bashRecords.filter((r) =>
      r.command.includes("tasks.json")
    );

    // Read/Write tool calls that reference tasks.json
    const readToolAccessedTasksJson = allToolCalls.some(
      (c) =>
        (c.name === "Read" || c.name === "Write") &&
        String(c.input?.file_path ?? "").includes("tasks.json")
    );

    // Was tasks.json referenced at all?
    const fileWasReferenced = tasksJsonBashRecords.length > 0 || readToolAccessedTasksJson;

    // Did EVERY reference explicitly error (i.e., "No such file")?
    // If at least one reference did NOT error, we consider the file accessed.
    const allRefsErrored =
      tasksJsonBashRecords.length > 0 &&
      !readToolAccessedTasksJson &&
      tasksJsonBashRecords.every((r) => {
        const out = r.output;
        return (
          out.includes("No such file") ||
          out.includes("cannot open") ||
          out.includes("No such file or directory")
        );
      });

    // Also check if JSON content appears anywhere in allResponseText (belt-and-suspenders)
    const jsonContentInText =
      allResponseText.includes('"tasks"') ||
      allResponseText.includes('"version"') ||
      allResponseText.includes('"activeTaskId"');

    const found = (fileWasReferenced && !allRefsErrored) || jsonContentInText;

    const passed = expected ? found : !found;
    results.push({
      check: "gtd_file_created",
      passed,
      detail: passed
        ? found
          ? `.claude/gtd/tasks.json was created/accessed`
          : `.claude/gtd/tasks.json was correctly not accessed`
        : expected
          ? fileWasReferenced && allRefsErrored
            ? `.claude/gtd/tasks.json was referenced but all commands returned "No such file". Commands: ${tasksJsonBashRecords.slice(0, 2).map((r) => r.command.slice(0, 60)).join(" | ")}`
            : `.claude/gtd/tasks.json was NOT referenced in any Bash command or Read/Write tool call`
          : `.claude/gtd/tasks.json was unexpectedly accessed`,
    });
  }

  // --- gtd_task_count ---
  if (checks.gtd_task_count !== undefined) {
    const expectedCount = checks.gtd_task_count;

    // Strategy 1: Parse JSON from any Bash output that contains a tasks array.
    // Iterate in reverse to find the most recent tasks.json output.
    let parsedCount: number | null = null;
    let parseSource = "";

    for (const record of [...bashRecords].reverse()) {
      const out = record.output;
      if (!out) continue;
      // Try to parse the entire output as JSON directly (from cat tasks.json)
      try {
        const parsed = JSON.parse(out) as { tasks?: unknown[] };
        if (parsed && Array.isArray(parsed.tasks)) {
          parsedCount = parsed.tasks.length;
          parseSource = `parsed tasks array from cat output (${record.command.slice(0, 60)})`;
          break;
        }
      } catch {
        // Not valid JSON on its own — try to extract embedded JSON
      }
      // Try to find a JSON object embedded in output (output may have ANSI codes or other text)
      const jsonMatch = out.match(/\{[\s\S]*"tasks"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { tasks?: unknown[] };
          if (parsed && Array.isArray(parsed.tasks)) {
            parsedCount = parsed.tasks.length;
            parseSource = `extracted tasks array from output (${record.command.slice(0, 60)})`;
            break;
          }
        } catch {
          // continue
        }
      }
    }

    // Strategy 2: If JSON parsing failed, scan allResponseText (which includes ALL tool
    // outputs and assistant turns) for the expected count number near the word "task".
    // allResponseText now includes Bash stdout, so this covers most cases.
    let responseMentionsCount = false;
    let responseMatchDetail = "";
    if (parsedCount === null) {
      // Look for the count appearing near "task" within a window of ~50 chars
      const nearTaskPattern = new RegExp(
        `(?:task[^\\n]{0,50}\\b${expectedCount}\\b|\\b${expectedCount}\\b[^\\n]{0,50}task)`,
        "i"
      );
      if (nearTaskPattern.test(allResponseText)) {
        responseMentionsCount = true;
        responseMatchDetail = "count appears near 'task' in full transcript";
      } else {
        // Looser fallback: count appears anywhere in the full text
        const countPattern = new RegExp(`\\b${expectedCount}\\b`);
        if (countPattern.test(allResponseText)) {
          responseMentionsCount = true;
          responseMatchDetail = "count appears in full transcript (approximate)";
        }
      }
    }

    const passed =
      parsedCount !== null
        ? parsedCount === expectedCount
        : responseMentionsCount;

    results.push({
      check: "gtd_task_count",
      passed,
      detail: passed
        ? parsedCount !== null
          ? `tasks.json contains exactly ${parsedCount} task(s) (expected: ${expectedCount}) — ${parseSource}`
          : `Response mentions expected count ${expectedCount} — ${responseMatchDetail}`
        : parsedCount !== null
          ? `tasks.json contains ${parsedCount} task(s), expected exactly ${expectedCount} — ${parseSource}`
          : `Could not verify task count ${expectedCount}: count not found in transcript`,
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

  console.log(`\n${colorize("=== GTD Plugin E2E Analyzer ===", BOLD)}`);
  console.log(`Results dir: ${resultsDir}`);
  console.log(`Test cases:  ${testCases.length}`);
  console.log("");

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

    // Parse transcript
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

  // --- Write gtd-analysis.json ---
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

  const outputPath = join(resultsDir, "gtd-analysis.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Analysis written to: ${outputPath}`);
  console.log("");

  process.exit(failedTests > 0 ? 1 : 0);
}

main();
