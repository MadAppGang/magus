#!/usr/bin/env bun
/**
 * Coaching E2E Test Analyzer
 *
 * Validates coaching pipeline test results by inspecting output files
 * produced by the real analyzer CLI and SessionStart hook.
 *
 * Usage: bun analyze-coaching.ts <test-dir> <checks-json> [exit-code]
 *
 * Returns JSON: {"passed": bool, "checks": [...], "summary": {...}}
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

// =============================================================================
// TYPES
// =============================================================================

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

interface AnalysisOutput {
  passed: boolean;
  checks: CheckResult[];
  summary: {
    total_checks: number;
    passed_checks: number;
    failed_checks: number;
  };
}

// =============================================================================
// HELPERS
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

function countNumberedSuggestions(content: string): number {
  const matches = content.match(/^\d+\. /gm);
  return matches ? matches.length : 0;
}

// =============================================================================
// CHECK RUNNERS
// =============================================================================

function runChecks(
  testDir: string,
  checks: Record<string, unknown>,
  analyzerExitCode: number
): CheckResult[] {
  const results: CheckResult[] = [];

  const recsPath = join(testDir, "recommendations.md");
  const statePath = join(testDir, "state.json");
  const sessionStartPath = join(testDir, "sessionstart-output.json");

  const recsContent = readFile(recsPath);
  const stateData = readJson(statePath) as Record<string, unknown> | null;
  const sessionStartContent = readFile(sessionStartPath);

  // ---- Recommendations file checks ----

  if ("recommendations_not_null" in checks || "recommendations_is_not_null" in checks) {
    const checkName =
      "recommendations_not_null" in checks
        ? "recommendations_not_null"
        : "recommendations_is_not_null";
    const passed = recsContent !== null && recsContent.trim().length > 0;
    results.push({
      check: checkName,
      passed,
      detail: passed
        ? "recommendations.md exists and is non-empty"
        : "recommendations.md is absent or empty",
    });
  }

  if ("recommendations_is_null" in checks) {
    const passed = recsContent === null || recsContent.trim().length === 0;
    results.push({
      check: "recommendations_is_null",
      passed,
      detail: passed
        ? "recommendations.md is absent (correct)"
        : `recommendations.md exists with content: ${recsContent?.substring(0, 100)}`,
    });
  }

  if ("recommendations_contains" in checks) {
    const expected = String(checks.recommendations_contains);
    if (recsContent === null) {
      results.push({
        check: "recommendations_contains",
        passed: false,
        detail: `recommendations.md is absent; expected to contain: "${expected}"`,
      });
    } else {
      const passed = recsContent.includes(expected);
      results.push({
        check: "recommendations_contains",
        passed,
        detail: passed
          ? `recommendations.md contains "${expected}"`
          : `recommendations.md does NOT contain "${expected}". Content preview: ${recsContent.substring(0, 200)}`,
      });
    }
  }

  if ("recommendations_contains_2" in checks) {
    const expected = String(checks.recommendations_contains_2);
    if (recsContent === null) {
      results.push({
        check: "recommendations_contains_2",
        passed: false,
        detail: `recommendations.md is absent; expected to contain: "${expected}"`,
      });
    } else {
      const passed = recsContent.includes(expected);
      results.push({
        check: "recommendations_contains_2",
        passed,
        detail: passed
          ? `recommendations.md contains "${expected}"`
          : `recommendations.md does NOT contain "${expected}". Content preview: ${recsContent.substring(0, 200)}`,
      });
    }
  }

  if ("recommendations_not_contains" in checks) {
    const forbidden = String(checks.recommendations_not_contains);
    if (recsContent === null) {
      // null is fine for not_contains
      results.push({
        check: "recommendations_not_contains",
        passed: true,
        detail: `recommendations.md is absent (does not contain "${forbidden}")`,
      });
    } else {
      const passed = !recsContent.includes(forbidden);
      results.push({
        check: "recommendations_not_contains",
        passed,
        detail: passed
          ? `recommendations.md does NOT contain "${forbidden}" (correct)`
          : `recommendations.md contains forbidden text "${forbidden}"`,
      });
    }
  }

  if ("recommendations_numbered_lte" in checks) {
    const maxCount = Number(checks.recommendations_numbered_lte);
    if (recsContent === null) {
      results.push({
        check: "recommendations_numbered_lte",
        passed: true,
        detail: "recommendations.md is absent (0 numbered suggestions <= limit)",
      });
    } else {
      const count = countNumberedSuggestions(recsContent);
      const passed = count <= maxCount;
      results.push({
        check: "recommendations_numbered_lte",
        passed,
        detail: passed
          ? `${count} numbered suggestions <= ${maxCount} (correct)`
          : `${count} numbered suggestions exceeds limit of ${maxCount}`,
      });
    }
  }

  if ("recommendations_numbered_gt" in checks) {
    const minCount = Number(checks.recommendations_numbered_gt);
    if (recsContent === null) {
      results.push({
        check: "recommendations_numbered_gt",
        passed: false,
        detail: `recommendations.md is absent (0 numbered suggestions, need > ${minCount})`,
      });
    } else {
      const count = countNumberedSuggestions(recsContent);
      const passed = count > minCount;
      results.push({
        check: "recommendations_numbered_gt",
        passed,
        detail: passed
          ? `${count} numbered suggestions > ${minCount} (correct)`
          : `${count} numbered suggestions not > ${minCount}`,
      });
    }
  }

  // ---- State file checks ----

  if ("state_session_count_is" in checks) {
    const expectedCount = Number(checks.state_session_count_is);
    if (stateData === null) {
      results.push({
        check: "state_session_count_is",
        passed: false,
        detail: "state.json is absent",
      });
    } else {
      const actual = (stateData as Record<string, unknown>)._session_count;
      const passed = actual === expectedCount;
      results.push({
        check: "state_session_count_is",
        passed,
        detail: passed
          ? `_session_count is ${expectedCount} (correct)`
          : `_session_count is ${actual}, expected ${expectedCount}`,
      });
    }
  }

  if ("state_rule_exists" in checks) {
    const ruleId = String(checks.state_rule_exists);
    if (stateData === null) {
      results.push({
        check: "state_rule_exists",
        passed: false,
        detail: "state.json is absent",
      });
    } else {
      const rulesObj = (stateData as Record<string, unknown>).rules as
        | Record<string, unknown>
        | undefined;
      const exists = rulesObj !== undefined && rulesObj[ruleId] !== undefined;
      results.push({
        check: "state_rule_exists",
        passed: exists,
        detail: exists
          ? `state.rules["${ruleId}"] exists (correct)`
          : `state.rules["${ruleId}"] not found. rules keys: ${Object.keys(rulesObj ?? {}).join(", ") || "none"}`,
      });
    }
  }

  if ("state_rule_suppress_until_gt" in checks) {
    const minSuppressUntil = Number(checks.state_rule_suppress_until_gt);
    const ruleId = String(checks.state_rule_id ?? checks.state_rule_exists ?? "");
    if (stateData === null) {
      results.push({
        check: "state_rule_suppress_until_gt",
        passed: false,
        detail: "state.json is absent",
      });
    } else {
      const rulesObj = (stateData as Record<string, unknown>).rules as
        | Record<string, unknown>
        | undefined;
      let found = false;
      let passed = false;
      let actual: unknown = undefined;

      if (rulesObj) {
        // Check the specific rule if state_rule_exists was also set, otherwise any rule
        const ruleToCheck = ruleId && rulesObj[ruleId]
          ? ruleId
          : Object.keys(rulesObj)[0];
        if (ruleToCheck && rulesObj[ruleToCheck]) {
          const ruleState = rulesObj[ruleToCheck] as Record<string, unknown>;
          actual = ruleState.suppress_until_count;
          found = true;
          passed = typeof actual === "number" && actual > minSuppressUntil;
        }
      }

      results.push({
        check: "state_rule_suppress_until_gt",
        passed: found && passed,
        detail: found
          ? passed
            ? `suppress_until_count is ${actual} > ${minSuppressUntil} (correct)`
            : `suppress_until_count is ${actual}, expected > ${minSuppressUntil}`
          : "No rule state entries found",
      });
    }
  }

  // ---- Exit code check ----

  if ("exit_code_is" in checks) {
    const expectedCode = Number(checks.exit_code_is);
    const passed = analyzerExitCode === expectedCode;
    results.push({
      check: "exit_code_is",
      passed,
      detail: passed
        ? `Analyzer exit code is ${expectedCode} (correct)`
        : `Analyzer exit code is ${analyzerExitCode}, expected ${expectedCode}`,
    });
  }

  // ---- SessionStart hook checks ----

  if ("sessionstart_output_valid_json" in checks) {
    let passed = false;
    let detail = "sessionstart-output.json is absent";
    if (sessionStartContent !== null) {
      try {
        JSON.parse(sessionStartContent);
        passed = true;
        detail = "sessionstart-output.json is valid JSON";
      } catch (e) {
        detail = `sessionstart-output.json is invalid JSON: ${String(e)}`;
      }
    }
    results.push({ check: "sessionstart_output_valid_json", passed, detail });
  }

  if ("sessionstart_has_hook_event_name" in checks) {
    let passed = false;
    let detail = "sessionstart-output.json is absent or invalid";
    if (sessionStartContent !== null) {
      try {
        const parsed = JSON.parse(sessionStartContent) as Record<string, unknown>;
        const hookOutput = parsed.hookSpecificOutput as Record<string, unknown> | undefined;
        const hookEventName = hookOutput?.hookEventName;
        passed = hookEventName === "SessionStart";
        detail = passed
          ? `hookSpecificOutput.hookEventName === "SessionStart" (correct)`
          : `hookSpecificOutput.hookEventName is "${hookEventName}", expected "SessionStart"`;
      } catch {
        detail = "sessionstart-output.json is invalid JSON";
      }
    }
    results.push({ check: "sessionstart_has_hook_event_name", passed, detail });
  }

  if ("sessionstart_has_additional_context" in checks) {
    let passed = false;
    let detail = "sessionstart-output.json is absent or invalid";
    if (sessionStartContent !== null) {
      try {
        const parsed = JSON.parse(sessionStartContent) as Record<string, unknown>;
        const hookOutput = parsed.hookSpecificOutput as Record<string, unknown> | undefined;
        const additionalContext = hookOutput?.additionalContext;
        passed =
          typeof additionalContext === "string" &&
          additionalContext.trim().length > 0;
        detail = passed
          ? "hookSpecificOutput.additionalContext is present and non-empty"
          : `hookSpecificOutput.additionalContext is absent or empty: ${JSON.stringify(additionalContext)}`;
      } catch {
        detail = "sessionstart-output.json is invalid JSON";
      }
    }
    results.push({
      check: "sessionstart_has_additional_context",
      passed,
      detail,
    });
  }

  if ("sessionstart_context_contains" in checks) {
    const expected = String(checks.sessionstart_context_contains);
    let passed = false;
    let detail = "sessionstart-output.json is absent or invalid";
    if (sessionStartContent !== null) {
      try {
        const parsed = JSON.parse(sessionStartContent) as Record<string, unknown>;
        const hookOutput = parsed.hookSpecificOutput as Record<string, unknown> | undefined;
        const additionalContext = String(hookOutput?.additionalContext ?? "");
        passed = additionalContext.includes(expected);
        detail = passed
          ? `additionalContext contains "${expected}"`
          : `additionalContext does NOT contain "${expected}". Preview: ${additionalContext.substring(0, 200)}`;
      } catch {
        detail = "sessionstart-output.json is invalid JSON";
      }
    }
    results.push({ check: "sessionstart_context_contains", passed, detail });
  }

  if ("sessionstart_output_is_empty" in checks) {
    const passed = sessionStartContent === null || sessionStartContent.trim().length === 0;
    results.push({
      check: "sessionstart_output_is_empty",
      passed,
      detail: passed
        ? "sessionstart-output.json is absent or empty (correct for opt-out)"
        : `sessionstart-output.json has content: ${sessionStartContent?.substring(0, 100)}`,
    });
  }

  return results;
}

// =============================================================================
// MAIN
// =============================================================================

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    process.stderr.write(
      "Usage: bun analyze-coaching.ts <test-dir> <checks-json> [exit-code]\n"
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

  const checkResults = runChecks(testDir, checks, analyzerExitCode);

  const allPassed = checkResults.every((r) => r.passed);
  const passedCount = checkResults.filter((r) => r.passed).length;
  const failedCount = checkResults.filter((r) => !r.passed).length;

  const output: AnalysisOutput = {
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

main();
