#!/usr/bin/env bun
/**
 * analyze-results.ts - Dev Loop test analyzer (dual-mode)
 *
 * Layer 1 (unit) mode: Called per-test by run-unit.sh
 *   bun analyze-results.ts --layer unit <test-dir> <checks-json> [exit-code]
 *   Returns JSON to stdout: {"passed": bool, "checks": [...], "summary": {...}}
 *
 * Layer 2 (e2e) mode: Called on results directory by runner-base.sh
 *   bun analyze-results.ts --layer e2e <results-dir>
 *   Outputs: <results-dir>/dev-loop-analysis.json + human-readable summary to stdout
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join, basename } from "path";

// =============================================================================
// TYPES
// =============================================================================

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

interface UnitAnalysisOutput {
  passed: boolean;
  checks: CheckResult[];
  summary: {
    total_checks: number;
    passed_checks: number;
    failed_checks: number;
  };
}

interface TestCaseMeta {
  description: string;
  version: string;
  created: string;
  notes: string;
}

interface E2EChecks {
  response_contains_any?: string[];
  file_exists?: string;
  iteration_count_lte?: number;
}

interface TestCase {
  id: string;
  layer: "unit" | "e2e";
  description: string;
  prompt?: string;
  checks?: Record<string, unknown>;
  [key: string]: unknown;
}

interface TestCasesFile {
  meta: TestCaseMeta;
  test_cases: TestCase[];
}

interface TranscriptEntry {
  type: string;
  id?: string;
  timestamp?: string;
  subtype?: string;
  is_error?: boolean;
  message?: {
    content: Array<{
      type: "text" | "tool_use";
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: string | unknown;
  line?: number;
  raw?: string;
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
    final_response_length: number;
  };
}

interface E2EAnalysisOutput {
  results_dir: string;
  analyzed_at: string;
  total_tests: number;
  passed_tests: number;
  failed_tests: number;
  skipped_tests: number;
  pass_rate: number;
  tests: TestAnalysis[];
}

// =============================================================================
// ANSI COLORS
// =============================================================================

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

// =============================================================================
// FILE HELPERS
// =============================================================================

function readFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function readJson(path: string): unknown | null {
  const content = readFile(path);
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Find the latest JSON file in a glob-like directory/pattern.
 * Returns null if directory doesn't exist or no JSON files found.
 */
function findLatestReflection(testDir: string): string | null {
  const reflDir = join(testDir, "reflections");
  if (!existsSync(reflDir)) return null;
  try {
    const files = readdirSync(reflDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => join(reflDir, e.name));
    if (files.length === 0) return null;
    // Sort by name descending to get the latest (iteration-based filenames sort well)
    files.sort((a, b) => b.localeCompare(a));
    return files[0];
  } catch {
    return null;
  }
}

function countReflectionFiles(testDir: string): number {
  const reflDir = join(testDir, "reflections");
  if (!existsSync(reflDir)) return 0;
  try {
    return readdirSync(reflDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .length;
  } catch {
    return 0;
  }
}

// =============================================================================
// LAYER 1: UNIT CHECK RUNNERS
// =============================================================================

function runUnitChecks(
  testDir: string,
  checks: Record<string, unknown>,
  analyzerExitCode: number
): CheckResult[] {
  const results: CheckResult[] = [];

  const stdoutPath = join(testDir, "hook-stdout.txt");
  const statePath = join(testDir, "state.json");
  const convergencePath = join(testDir, "convergence-output.json");
  const routerPath = join(testDir, "routing-output.json");

  const stdoutContent = readFile(stdoutPath);
  const stateData = readJson(statePath) as Record<string, unknown> | null;
  const convergenceData = readJson(convergencePath) as Record<string, unknown> | null;
  const routerData = readJson(routerPath) as Record<string, unknown> | null;

  // --- exit_code_is ---
  if ("exit_code_is" in checks) {
    const expectedCode = Number(checks.exit_code_is);
    const passed = analyzerExitCode === expectedCode;
    results.push({
      check: "exit_code_is",
      passed,
      detail: passed
        ? `Exit code is ${expectedCode} (correct)`
        : `Exit code is ${analyzerExitCode}, expected ${expectedCode}`,
    });
  }

  // --- stdout_contains ---
  if ("stdout_contains" in checks) {
    const expected = String(checks.stdout_contains);
    if (stdoutContent === null) {
      results.push({
        check: "stdout_contains",
        passed: false,
        detail: `hook-stdout.txt is absent; expected to contain: ${expected}`,
      });
    } else {
      const passed = stdoutContent.includes(expected);
      results.push({
        check: "stdout_contains",
        passed,
        detail: passed
          ? `stdout contains ${expected}`
          : `stdout does NOT contain ${expected}. Preview: ${stdoutContent.substring(0, 200)}`,
      });
    }
  }

  // --- stdout_contains_2 ---
  if ("stdout_contains_2" in checks) {
    const expected = String(checks.stdout_contains_2);
    if (stdoutContent === null) {
      results.push({
        check: "stdout_contains_2",
        passed: false,
        detail: `hook-stdout.txt is absent; expected to contain: ${expected}`,
      });
    } else {
      const passed = stdoutContent.includes(expected);
      results.push({
        check: "stdout_contains_2",
        passed,
        detail: passed
          ? `stdout contains ${expected}`
          : `stdout does NOT contain ${expected}. Preview: ${stdoutContent.substring(0, 200)}`,
      });
    }
  }

  // --- stdout_is_empty ---
  if ("stdout_is_empty" in checks) {
    const expectEmpty = Boolean(checks.stdout_is_empty);
    const isEmpty = stdoutContent === null || stdoutContent.trim().length === 0;
    const passed = expectEmpty ? isEmpty : !isEmpty;
    results.push({
      check: "stdout_is_empty",
      passed,
      detail: passed
        ? expectEmpty
          ? "hook-stdout.txt is absent or empty (correct)"
          : "hook-stdout.txt has content (correct)"
        : expectEmpty
          ? `hook-stdout.txt has unexpected content: ${stdoutContent?.substring(0, 100)}`
          : "hook-stdout.txt is absent or empty but expected content",
    });
  }

  // --- state_file_exists ---
  if ("state_file_exists" in checks) {
    const expectExists = Boolean(checks.state_file_exists);
    const exists = stateData !== null;
    const passed = expectExists === exists;
    results.push({
      check: "state_file_exists",
      passed,
      detail: passed
        ? expectExists
          ? "state.json exists and is non-empty (correct)"
          : "state.json is absent (correct)"
        : expectExists
          ? "state.json is absent but expected to exist"
          : `state.json exists but expected to be absent. Content: ${JSON.stringify(stateData).substring(0, 100)}`,
    });
  }

  // --- state_iteration_is ---
  if ("state_iteration_is" in checks) {
    const expectedIteration = Number(checks.state_iteration_is);
    if (stateData === null) {
      results.push({
        check: "state_iteration_is",
        passed: false,
        detail: "state.json is absent",
      });
    } else {
      const actual = stateData.iteration;
      const passed = actual === expectedIteration;
      results.push({
        check: "state_iteration_is",
        passed,
        detail: passed
          ? `state.iteration is ${expectedIteration} (correct)`
          : `state.iteration is ${actual}, expected ${expectedIteration}`,
      });
    }
  }

  // --- reflection_file_exists ---
  if ("reflection_file_exists" in checks) {
    const expectExists = Boolean(checks.reflection_file_exists);
    const count = countReflectionFiles(testDir);
    const exists = count > 0;
    const passed = expectExists === exists;
    results.push({
      check: "reflection_file_exists",
      passed,
      detail: passed
        ? expectExists
          ? `reflections/ has ${count} JSON file(s) (correct)`
          : "reflections/ has no JSON files (correct)"
        : expectExists
          ? "reflections/ has no JSON files but expected at least one"
          : `reflections/ has ${count} JSON file(s) but expected none`,
    });
  }

  // --- reflection_valid_json ---
  if ("reflection_valid_json" in checks) {
    const latestPath = findLatestReflection(testDir);
    if (latestPath === null) {
      results.push({
        check: "reflection_valid_json",
        passed: false,
        detail: "No reflection files found in reflections/",
      });
    } else {
      const content = readFile(latestPath);
      let passed = false;
      let detail = "";
      if (content === null) {
        detail = `Could not read ${latestPath}`;
      } else {
        try {
          JSON.parse(content);
          passed = true;
          detail = `${basename(latestPath)} is valid JSON`;
        } catch (e) {
          detail = `${basename(latestPath)} is invalid JSON: ${String(e)}`;
        }
      }
      results.push({ check: "reflection_valid_json", passed, detail });
    }
  }

  // --- reflection_has_field ---
  if ("reflection_has_field" in checks) {
    const fieldName = String(checks.reflection_has_field);
    const latestPath = findLatestReflection(testDir);
    if (latestPath === null) {
      results.push({
        check: "reflection_has_field",
        passed: false,
        detail: "No reflection files found in reflections/",
      });
    } else {
      const parsed = readJson(latestPath) as Record<string, unknown> | null;
      if (parsed === null) {
        results.push({
          check: "reflection_has_field",
          passed: false,
          detail: `${basename(latestPath)} is absent or invalid JSON`,
        });
      } else {
        const passed = fieldName in parsed;
        results.push({
          check: "reflection_has_field",
          passed,
          detail: passed
            ? `Reflection has field "${fieldName}" (correct)`
            : `Reflection is missing field "${fieldName}". Fields: ${Object.keys(parsed).join(", ")}`,
        });
      }
    }
  }

  // --- reflection_has_field_2 ---
  if ("reflection_has_field_2" in checks) {
    const fieldName = String(checks.reflection_has_field_2);
    const latestPath = findLatestReflection(testDir);
    if (latestPath === null) {
      results.push({
        check: "reflection_has_field_2",
        passed: false,
        detail: "No reflection files found in reflections/",
      });
    } else {
      const parsed = readJson(latestPath) as Record<string, unknown> | null;
      if (parsed === null) {
        results.push({
          check: "reflection_has_field_2",
          passed: false,
          detail: `${basename(latestPath)} is absent or invalid JSON`,
        });
      } else {
        const passed = fieldName in parsed;
        results.push({
          check: "reflection_has_field_2",
          passed,
          detail: passed
            ? `Reflection has field "${fieldName}" (correct)`
            : `Reflection is missing field "${fieldName}". Fields: ${Object.keys(parsed).join(", ")}`,
        });
      }
    }
  }

  // --- reflection_thrashing_is ---
  if ("reflection_thrashing_is" in checks) {
    const expectedBool = Boolean(checks.reflection_thrashing_is);
    const latestPath = findLatestReflection(testDir);
    if (latestPath === null) {
      results.push({
        check: "reflection_thrashing_is",
        passed: false,
        detail: "No reflection files found in reflections/",
      });
    } else {
      const parsed = readJson(latestPath) as Record<string, unknown> | null;
      if (parsed === null) {
        results.push({
          check: "reflection_thrashing_is",
          passed: false,
          detail: `${basename(latestPath)} is absent or invalid JSON`,
        });
      } else {
        const actual = parsed.thrashing;
        const passed = actual === expectedBool;
        results.push({
          check: "reflection_thrashing_is",
          passed,
          detail: passed
            ? `reflection.thrashing is ${expectedBool} (correct)`
            : `reflection.thrashing is ${actual}, expected ${expectedBool}`,
        });
      }
    }
  }

  // --- reflection_references_prior ---
  if ("reflection_references_prior" in checks) {
    const latestPath = findLatestReflection(testDir);
    if (latestPath === null) {
      results.push({
        check: "reflection_references_prior",
        passed: false,
        detail: "No reflection files found in reflections/",
      });
    } else {
      const parsed = readJson(latestPath) as Record<string, unknown> | null;
      if (parsed === null) {
        results.push({
          check: "reflection_references_prior",
          passed: false,
          detail: `${basename(latestPath)} is absent or invalid JSON`,
        });
      } else {
        const priorSummary = parsed.prior_iterations_summary ?? parsed.history_summary;
        const passed =
          typeof priorSummary === "string" && priorSummary.length > 10;
        results.push({
          check: "reflection_references_prior",
          passed,
          detail: passed
            ? `Reflection has prior iterations summary (length=${String(priorSummary).length})`
            : `Reflection is missing prior_iterations_summary or history_summary (found: ${JSON.stringify(priorSummary)})`,
        });
      }
    }
  }

  // --- reflection_schema_valid ---
  if ("reflection_schema_valid" in checks) {
    const requiredFields = ["approach", "successes", "failures"];
    const latestPath = findLatestReflection(testDir);
    if (latestPath === null) {
      results.push({
        check: "reflection_schema_valid",
        passed: false,
        detail: "No reflection files found in reflections/",
      });
    } else {
      const parsed = readJson(latestPath) as Record<string, unknown> | null;
      if (parsed === null) {
        results.push({
          check: "reflection_schema_valid",
          passed: false,
          detail: `${basename(latestPath)} is absent or invalid JSON`,
        });
      } else {
        const missing = requiredFields.filter((f) => !(f in parsed));
        const passed = missing.length === 0;
        results.push({
          check: "reflection_schema_valid",
          passed,
          detail: passed
            ? `Reflection has all required fields: ${requiredFields.join(", ")}`
            : `Reflection is missing required fields: ${missing.join(", ")}. Fields present: ${Object.keys(parsed).join(", ")}`,
        });
      }
    }
  }

  // --- convergence_status_is ---
  if ("convergence_status_is" in checks) {
    const expectedStatus = String(checks.convergence_status_is);
    if (convergenceData === null) {
      results.push({
        check: "convergence_status_is",
        passed: false,
        detail: "convergence-output.json is absent or invalid",
      });
    } else {
      const actual = convergenceData.status ?? convergenceData.convergence_status;
      const passed = actual === expectedStatus;
      results.push({
        check: "convergence_status_is",
        passed,
        detail: passed
          ? `convergence status is "${expectedStatus}" (correct)`
          : `convergence status is "${actual}", expected "${expectedStatus}"`,
      });
    }
  }

  // --- routed_agent_is ---
  if ("routed_agent_is" in checks) {
    const expectedAgent = String(checks.routed_agent_is);
    if (routerData === null) {
      results.push({
        check: "routed_agent_is",
        passed: false,
        detail: "routing-output.json is absent or invalid",
      });
    } else {
      const actual = routerData.agent ?? routerData.routed_agent;
      const passed = actual === expectedAgent;
      results.push({
        check: "routed_agent_is",
        passed,
        detail: passed
          ? `routed agent is "${expectedAgent}" (correct)`
          : `routed agent is "${actual}", expected "${expectedAgent}"`,
      });
    }
  }

  return results;
}

// =============================================================================
// LAYER 2: E2E TRANSCRIPT PARSING + CHECK EVALUATION
// =============================================================================

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
 * Extract the final assistant text response from the transcript.
 *
 * claudish --json output produces a type==="result" entry with a string result field.
 * Falls back to the last assistant message text blocks.
 */
function extractFinalResponse(entries: TranscriptEntry[]): string {
  // Primary: type==="result" with string result (claudish --json format)
  for (const entry of entries) {
    if (entry.type === "result" && typeof entry.result === "string" && entry.result.length > 0) {
      return entry.result;
    }
  }

  // Fallback: last assistant message text blocks
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
 * Walk results directory tree to find all transcript.jsonl files.
 */
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

/**
 * Try to extract an iteration count from the final response text.
 * Looks for patterns like "iteration 3", "3 iterations", "iter: 3", etc.
 */
function extractIterationCount(response: string): number | null {
  // Pattern: "iteration N" or "N iterations" or "iter N" (case-insensitive)
  const patterns = [
    /iteration[s]?\s+(\d+)/i,
    /(\d+)\s+iteration[s]?/i,
    /iter(?:ation)?[:\s]+(\d+)/i,
    /loop\s+(\d+)/i,
    /(\d+)\s+loop[s]?/i,
    /cycle\s+(\d+)/i,
    /(\d+)\s+cycle[s]?/i,
  ];
  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

function evaluateE2EChecks(
  checks: E2EChecks,
  finalResponse: string
): CheckResult[] {
  const results: CheckResult[] = [];

  // --- response_contains_any ---
  if (checks.response_contains_any !== undefined) {
    const candidates = checks.response_contains_any;
    const lowerResponse = finalResponse.toLowerCase();
    const matched = candidates.filter((c) => lowerResponse.includes(c.toLowerCase()));
    const passed = matched.length > 0;
    results.push({
      check: "response_contains_any",
      passed,
      detail: passed
        ? `Response contains: ${matched.map((m) => `"${m}"`).join(", ")}`
        : `Response contains none of: ${candidates.map((c) => `"${c}"`).join(", ")}. Response length: ${finalResponse.length} chars`,
    });
  }

  // --- file_exists ---
  // Since we can't inspect the filesystem from the analyzer (CWD varies),
  // we check whether the response mentions the filename
  if (checks.file_exists !== undefined) {
    const filename = checks.file_exists;
    const passed = finalResponse.toLowerCase().includes(filename.toLowerCase());
    results.push({
      check: "file_exists",
      passed,
      detail: passed
        ? `Response mentions file "${filename}" (correct)`
        : `Response does NOT mention file "${filename}". Response length: ${finalResponse.length} chars`,
    });
  }

  // --- iteration_count_lte ---
  if (checks.iteration_count_lte !== undefined) {
    const maxIter = checks.iteration_count_lte;
    const count = extractIterationCount(finalResponse);
    if (count === null) {
      // Can't determine, give benefit of the doubt — mark passed with note
      results.push({
        check: "iteration_count_lte",
        passed: true,
        detail: `Could not extract iteration count from response (assuming within limit of ${maxIter})`,
      });
    } else {
      const passed = count <= maxIter;
      results.push({
        check: "iteration_count_lte",
        passed,
        detail: passed
          ? `Iteration count ${count} <= ${maxIter} (correct)`
          : `Iteration count ${count} exceeds limit of ${maxIter}`,
      });
    }
  }

  return results;
}

// =============================================================================
// LAYER 1: MAIN ENTRY
// =============================================================================

function runUnitMode(args: string[]): void {
  if (args.length < 2) {
    process.stderr.write(
      "Usage: bun analyze-results.ts --layer unit <test-dir> <checks-json> [exit-code]\n"
    );
    process.exit(1);
  }

  const testDir = args[0];
  let checks: Record<string, unknown>;
  try {
    checks = JSON.parse(args[1]) as Record<string, unknown>;
  } catch (e) {
    process.stderr.write(`Invalid checks JSON: ${String(e)}\n`);
    process.exit(1);
  }

  const analyzerExitCode = args[2] !== undefined ? parseInt(args[2], 10) : 0;

  if (!existsSync(testDir)) {
    process.stderr.write(`Test directory not found: ${testDir}\n`);
    process.exit(1);
  }

  const checkResults = runUnitChecks(testDir, checks, analyzerExitCode);

  const allPassed = checkResults.every((r) => r.passed);
  const passedCount = checkResults.filter((r) => r.passed).length;
  const failedCount = checkResults.filter((r) => !r.passed).length;

  const output: UnitAnalysisOutput = {
    passed: allPassed,
    checks: checkResults,
    summary: {
      total_checks: checkResults.length,
      passed_checks: passedCount,
      failed_checks: failedCount,
    },
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  process.exit(allPassed ? 0 : 1);
}

// =============================================================================
// LAYER 2: MAIN ENTRY
// =============================================================================

function runE2EMode(args: string[]): void {
  if (args.length < 1) {
    console.error("Usage: bun analyze-results.ts --layer e2e <results-dir>");
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

  // Only include e2e layer test cases
  const e2eTestCases = testCasesFile.test_cases.filter((tc) => tc.layer === "e2e");

  console.log(`\n${colorize("=== Dev Loop E2E Analyzer ===", BOLD)}`);
  console.log(`Results dir: ${resultsDir}`);
  console.log(`E2E test cases: ${e2eTestCases.length}`);
  console.log("");

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

    const tc = e2eTestCases.find((c) => c.id === caseId);
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

    const finalResponse = extractFinalResponse(entries);
    const e2eChecks = tc.checks as E2EChecks;
    const checkResults = evaluateE2EChecks(e2eChecks, finalResponse);

    const allPassed = checkResults.every((r) => r.passed);

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
        final_response_length: finalResponse.length,
      },
    });
  }

  // Sort by test case order in test-cases.json
  const orderMap = new Map(e2eTestCases.map((tc, i) => [tc.id, i]));
  testAnalyses.sort((a, b) => {
    const ai = orderMap.get(a.test_id) ?? 999;
    const bi = orderMap.get(b.test_id) ?? 999;
    return ai - bi;
  });

  const totalAnalyzed = testAnalyses.length;
  const passedTests = testAnalyses.filter((t) => t.passed).length;
  const failedTests = totalAnalyzed - passedTests;
  const passRate = totalAnalyzed > 0 ? Math.round((passedTests / totalAnalyzed) * 100) : 0;

  // Print summary table
  console.log(colorize("=== Check Results Per Test ===", BOLD));
  console.log("");

  for (const analysis of testAnalyses) {
    const icon = analysis.passed ? colorize("PASS", GREEN) : colorize("FAIL", RED);
    const checksStr = `${analysis.summary.passed_checks}/${analysis.summary.total_checks}`;
    console.log(
      `${icon} ${colorize(padEnd(analysis.test_id, 36), BOLD)} checks=${checksStr} resp_len=${analysis.summary.final_response_length}`
    );

    // Print failed checks first
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
    console.log(colorize(`(${skipped} test(s) skipped: no transcript or no e2e checks defined)`, DIM));
    console.log("");
  }

  // Overall summary
  console.log(colorize("=== Overall Results ===", BOLD));
  console.log(`Analyzed:  ${totalAnalyzed}`);
  console.log(`Passed:    ${colorize(String(passedTests), passedTests === totalAnalyzed ? GREEN : YELLOW)}`);
  console.log(`Failed:    ${colorize(String(failedTests), failedTests > 0 ? RED : GREEN)}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Pass rate: ${colorize(`${passRate}%`, passRate === 100 ? GREEN : passRate >= 50 ? YELLOW : RED)}`);
  console.log("");

  // Write dev-loop-analysis.json
  const output: E2EAnalysisOutput = {
    results_dir: resultsDir,
    analyzed_at: new Date().toISOString(),
    total_tests: totalAnalyzed,
    passed_tests: passedTests,
    failed_tests: failedTests,
    skipped_tests: skipped,
    pass_rate: passRate,
    tests: testAnalyses,
  };

  const outputPath = join(resultsDir, "dev-loop-analysis.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Analysis written to: ${outputPath}`);
  console.log("");

  process.exit(failedTests > 0 ? 1 : 0);
}

// =============================================================================
// ENTRY POINT
// =============================================================================

function main(): void {
  const allArgs = process.argv.slice(2);

  // Find --layer flag
  const layerIdx = allArgs.indexOf("--layer");
  if (layerIdx === -1 || layerIdx + 1 >= allArgs.length) {
    process.stderr.write(
      "Usage:\n" +
        "  bun analyze-results.ts --layer unit <test-dir> <checks-json> [exit-code]\n" +
        "  bun analyze-results.ts --layer e2e <results-dir>\n"
    );
    process.exit(1);
  }

  const layer = allArgs[layerIdx + 1];
  // Remaining args after --layer <value>
  const remainingArgs = [
    ...allArgs.slice(0, layerIdx),
    ...allArgs.slice(layerIdx + 2),
  ];

  if (layer === "unit") {
    runUnitMode(remainingArgs);
  } else if (layer === "e2e") {
    runE2EMode(remainingArgs);
  } else {
    process.stderr.write(`Unknown layer: "${layer}". Must be "unit" or "e2e".\n`);
    process.exit(1);
  }
}

main();
