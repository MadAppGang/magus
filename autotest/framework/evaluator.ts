/**
 * evaluator.ts - Pure pass/fail evaluation for autotest framework.
 *
 * Extracted from aggregate-results.ts lines 173-207.
 * No file I/O. No side effects. Fully testable in isolation.
 */

import type { TestCase, EvalResult } from "./types.js";

/**
 * Determine test result given expected vs actual agent selection.
 *
 * @param tc          - The test case definition (has expected_agent, expected_alternatives)
 * @param actualAgent - Agent detected from transcript (or "" / "NO_TASK_CALL" / "TASK_USED")
 * @param exitCode    - Process exit code from execute-test.sh
 */
export function evaluate(
  tc: TestCase,
  actualAgent: string,
  exitCode: number
): EvalResult {
  const expectedAgent: string = tc.expected_agent ?? "";
  const expectedAlternatives: string[] = tc.expected_alternatives ?? [];

  if (exitCode !== 0) {
    return exitCode === 124 ? "TIMEOUT" : "ERROR";
  }

  if (expectedAgent) {
    if (expectedAgent === "NO_TASK_CALL") {
      // Test expects direct handling (no delegation)
      if (!actualAgent || actualAgent === "NO_TASK_CALL") {
        return "PASS";
      }
      // Model delegated when it shouldn't have
      return "FAIL_OVER_DELEGATED";
    }

    if (actualAgent === expectedAgent) {
      return "PASS";
    }

    if (expectedAlternatives.includes(actualAgent)) {
      return "PASS_ALT";
    }

    if (actualAgent === "TASK_USED") {
      // Task tool was used but subagent_type couldn't be extracted from transcript.
      // The delegation DID happen, we just can't verify which specific agent.
      return "PASS_DELEGATED";
    }

    if (!actualAgent || actualAgent === "NO_TASK_CALL") {
      return "NO_DELEGATION";
    }

    return "FAIL";
  }

  // No expected agent specified — exit code 0 is a pass
  return exitCode === 0 ? "PASS" : "FAIL";
}
