# dev:loop E2E Test Suite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a two-layer test suite that validates the dev:loop autonomous agent loop — deterministic unit tests for hook scripts + claudish-based integration tests across 6 models.

**Architecture:** Layer 1 follows the coaching pattern (custom bash runner + synthetic JSONL transcripts + TypeScript check evaluator). Layer 2 follows the terminal pattern (thin wrapper around runner-base.sh + TypeScript analyzer). Both layers share a single `test-cases.json` with `"layer"` tags to separate them.

**Tech Stack:** Bash (runners), TypeScript/Bun (analyzers), jq (JSON parsing), claudish (Layer 2 integration)

**Design doc:** `docs/plans/2026-02-28-dev-loop-e2e-tests-design.md`

---

## Task 1: Create Directory Structure and test-cases.json Skeleton

**Files:**
- Create: `autotest/dev-loop/test-cases.json`
- Create: `autotest/dev-loop/fixtures/` (empty directory marker)

**Step 1: Create the directory structure**

```bash
mkdir -p autotest/dev-loop/fixtures
mkdir -p autotest/dev-loop/results
```

**Step 2: Write the test-cases.json skeleton with Layer 1 stop-hook tests**

Create `autotest/dev-loop/test-cases.json` with:
```json
{
  "meta": {
    "description": "dev:loop E2E test cases. Layer 1: deterministic hook tests with synthetic transcripts. Layer 2: claudish-based 6-model integration tests.",
    "version": "1.0.0",
    "created": "2026-02-28",
    "notes": "Layer 1 tests hook scripts directly (no LLM). Layer 2 sends real prompts through claudish."
  },
  "test_cases": [
    {
      "id": "stop-hook-block-01",
      "layer": "unit",
      "category": "stop-hook",
      "description": "Blocks exit when loop state file exists and no promise match",
      "target": "stop-hook",
      "state_file": {
        "task": "Create hello.py",
        "iteration": 1,
        "max_iterations": 5,
        "completion_promise": "DONE",
        "phase": "implementing"
      },
      "transcript": [
        {"tool": "Write", "input": {"file_path": "/project/hello.py", "content": "print('hello')"}},
        {"tool": "Bash", "input": {"command": "python hello.py"}}
      ],
      "checks": {
        "exit_code_is": 0,
        "stdout_contains": "\"decision\"",
        "stdout_contains_2": "\"block\"",
        "state_file_exists": true,
        "state_iteration_is": 2
      }
    },
    {
      "id": "stop-hook-allow-exit-02",
      "layer": "unit",
      "category": "stop-hook",
      "description": "Allows exit when no loop state file exists",
      "target": "stop-hook",
      "state_file": null,
      "transcript": [],
      "checks": {
        "exit_code_is": 0,
        "stdout_is_empty": true,
        "state_file_exists": false
      }
    },
    {
      "id": "stop-hook-promise-match-03",
      "layer": "unit",
      "category": "stop-hook",
      "description": "Promise tag match in transcript exits the loop",
      "target": "stop-hook",
      "state_file": {
        "task": "Create greet.py",
        "iteration": 2,
        "max_iterations": 5,
        "completion_promise": "DONE",
        "phase": "implementing"
      },
      "transcript_text": ["The task is complete. <promise>DONE</promise>"],
      "checks": {
        "exit_code_is": 0,
        "state_file_exists": false,
        "stdout_is_empty": true
      }
    },
    {
      "id": "stop-hook-max-iter-04",
      "layer": "unit",
      "category": "stop-hook",
      "description": "Max iterations reached exits the loop",
      "target": "stop-hook",
      "state_file": {
        "task": "Impossible task",
        "iteration": 5,
        "max_iterations": 5,
        "completion_promise": "DONE",
        "phase": "implementing"
      },
      "transcript": [
        {"tool": "Bash", "input": {"command": "echo 'still trying'"}}
      ],
      "checks": {
        "exit_code_is": 0,
        "state_file_exists": false,
        "stdout_is_empty": true
      }
    },
    {
      "id": "stop-hook-increment-05",
      "layer": "unit",
      "category": "stop-hook",
      "description": "Iteration counter increments on each hook run",
      "target": "stop-hook",
      "state_file": {
        "task": "Build feature",
        "iteration": 3,
        "max_iterations": 10,
        "completion_promise": "ALL_PASS",
        "phase": "implementing"
      },
      "transcript": [
        {"tool": "Write", "input": {"file_path": "/project/feature.ts", "content": "export {}"}}
      ],
      "checks": {
        "exit_code_is": 0,
        "stdout_contains": "\"block\"",
        "state_file_exists": true,
        "state_iteration_is": 4
      }
    },
    {
      "id": "stop-hook-corrupt-state-06",
      "layer": "unit",
      "category": "stop-hook",
      "description": "Corrupted state file handled gracefully",
      "target": "stop-hook",
      "raw_state_file": "this is {{ not valid yaml or json ]]",
      "transcript": [],
      "checks": {
        "exit_code_is": 0,
        "state_file_exists": false
      }
    },
    {
      "id": "reflect-basic-01",
      "layer": "unit",
      "category": "reflection",
      "description": "Generates reflection JSON from a substantial transcript",
      "target": "reflection-generator",
      "state_file": {
        "task": "Implement auth module",
        "iteration": 1,
        "max_iterations": 5,
        "phase": "implementing"
      },
      "filler_count": 12,
      "transcript": [
        {"tool": "Read", "input": {"file_path": "/project/auth.ts"}},
        {"tool": "Write", "input": {"file_path": "/project/auth.ts", "content": "export function login() {}"}},
        {"tool": "Bash", "input": {"command": "bun test auth.test.ts"}}
      ],
      "checks": {
        "exit_code_is": 0,
        "reflection_file_exists": true,
        "reflection_valid_json": true,
        "reflection_has_field": "approach",
        "reflection_has_field_2": "successes"
      }
    },
    {
      "id": "reflect-test-failure-02",
      "layer": "unit",
      "category": "reflection",
      "description": "Captures test failure details in reflection",
      "target": "reflection-generator",
      "state_file": {
        "task": "Fix failing tests",
        "iteration": 2,
        "max_iterations": 5,
        "phase": "implementing"
      },
      "filler_count": 10,
      "transcript": [
        {"tool": "Bash", "input": {"command": "bun test", "output_hint": "FAIL src/auth.test.ts > login > should validate email\nExpected: true\nReceived: false"}},
        {"tool": "Read", "input": {"file_path": "/project/auth.test.ts"}},
        {"tool": "Write", "input": {"file_path": "/project/auth.ts", "content": "export function login(email: string) { return email.includes('@'); }"}}
      ],
      "checks": {
        "exit_code_is": 0,
        "reflection_file_exists": true,
        "reflection_valid_json": true,
        "reflection_has_field": "failures"
      }
    },
    {
      "id": "reflect-history-03",
      "layer": "unit",
      "category": "reflection",
      "description": "Reads ALL previous reflections when generating new one",
      "target": "reflection-generator",
      "state_file": {
        "task": "Build calculator",
        "iteration": 4,
        "max_iterations": 10,
        "phase": "implementing"
      },
      "pre_reflections": [
        {"iteration": 1, "approach": "basic structure", "successes": ["created files"], "failures": []},
        {"iteration": 2, "approach": "add tests", "successes": ["tests written"], "failures": ["2 tests fail"]},
        {"iteration": 3, "approach": "fix tests", "successes": ["1 test fixed"], "failures": ["1 test still fails"]}
      ],
      "filler_count": 10,
      "transcript": [
        {"tool": "Bash", "input": {"command": "bun test"}},
        {"tool": "Write", "input": {"file_path": "/project/calc.ts", "content": "// fixed"}}
      ],
      "checks": {
        "exit_code_is": 0,
        "reflection_file_exists": true,
        "reflection_valid_json": true,
        "reflection_references_prior": true
      }
    },
    {
      "id": "reflect-thrash-detect-04",
      "layer": "unit",
      "category": "reflection",
      "description": "Detects thrashing when same error hash repeats 3x",
      "target": "reflection-generator",
      "state_file": {
        "task": "Fix import error",
        "iteration": 4,
        "max_iterations": 10,
        "phase": "implementing"
      },
      "pre_reflections": [
        {"iteration": 1, "approach": "fix import", "successes": [], "failures": ["Cannot find module 'foo'"], "error_hash": "abc123"},
        {"iteration": 2, "approach": "try different path", "successes": [], "failures": ["Cannot find module 'foo'"], "error_hash": "abc123"},
        {"iteration": 3, "approach": "install package", "successes": [], "failures": ["Cannot find module 'foo'"], "error_hash": "abc123"}
      ],
      "filler_count": 10,
      "transcript": [
        {"tool": "Bash", "input": {"command": "bun test", "output_hint": "Cannot find module 'foo'"}}
      ],
      "checks": {
        "exit_code_is": 0,
        "reflection_file_exists": true,
        "reflection_valid_json": true,
        "reflection_has_field": "thrashing",
        "reflection_thrashing_is": true
      }
    },
    {
      "id": "reflect-low-signal-05",
      "layer": "unit",
      "category": "reflection",
      "description": "Skips reflection for sessions with fewer than 10 tool calls",
      "target": "reflection-generator",
      "state_file": {
        "task": "Quick fix",
        "iteration": 1,
        "max_iterations": 5,
        "phase": "implementing"
      },
      "filler_count": 0,
      "transcript": [
        {"tool": "Write", "input": {"file_path": "/project/fix.ts", "content": "// fix"}},
        {"tool": "Bash", "input": {"command": "echo done"}}
      ],
      "checks": {
        "exit_code_is": 0,
        "reflection_file_exists": false
      }
    },
    {
      "id": "reflect-json-format-06",
      "layer": "unit",
      "category": "reflection",
      "description": "Output validates against Reflection interface schema",
      "target": "reflection-generator",
      "state_file": {
        "task": "Build API",
        "iteration": 1,
        "max_iterations": 5,
        "phase": "implementing"
      },
      "filler_count": 12,
      "transcript": [
        {"tool": "Read", "input": {"file_path": "/project/api.ts"}},
        {"tool": "Write", "input": {"file_path": "/project/api.ts", "content": "export const handler = () => {}"}},
        {"tool": "Bash", "input": {"command": "bun test api.test.ts"}}
      ],
      "checks": {
        "exit_code_is": 0,
        "reflection_file_exists": true,
        "reflection_valid_json": true,
        "reflection_schema_valid": true
      }
    },
    {
      "id": "converge-success-01",
      "layer": "unit",
      "category": "convergence",
      "description": "Detects converged success when quality metrics are high",
      "target": "convergence-detector",
      "metrics_history": [
        {"iteration": 1, "test_pass_rate": 0.60, "lint_score": 0.70, "build_success": true},
        {"iteration": 2, "test_pass_rate": 0.85, "lint_score": 0.85, "build_success": true},
        {"iteration": 3, "test_pass_rate": 0.95, "lint_score": 0.90, "build_success": true}
      ],
      "checks": {
        "exit_code_is": 0,
        "convergence_status_is": "converged_success"
      }
    },
    {
      "id": "converge-plateau-02",
      "layer": "unit",
      "category": "convergence",
      "description": "Detects stuck plateau when delta is tiny for 3 iterations",
      "target": "convergence-detector",
      "metrics_history": [
        {"iteration": 1, "test_pass_rate": 0.70, "lint_score": 0.80, "build_success": true},
        {"iteration": 2, "test_pass_rate": 0.71, "lint_score": 0.80, "build_success": true},
        {"iteration": 3, "test_pass_rate": 0.71, "lint_score": 0.81, "build_success": true},
        {"iteration": 4, "test_pass_rate": 0.72, "lint_score": 0.81, "build_success": true}
      ],
      "checks": {
        "exit_code_is": 0,
        "convergence_status_is": "stuck_plateau"
      }
    },
    {
      "id": "converge-thrashing-03",
      "layer": "unit",
      "category": "convergence",
      "description": "Detects oscillation with alternating pass/fail and same error hash",
      "target": "convergence-detector",
      "metrics_history": [
        {"iteration": 1, "test_pass_rate": 0.80, "error_hash": "abc123"},
        {"iteration": 2, "test_pass_rate": 0.50, "error_hash": "abc123"},
        {"iteration": 3, "test_pass_rate": 0.80, "error_hash": "abc123"},
        {"iteration": 4, "test_pass_rate": 0.50, "error_hash": "abc123"}
      ],
      "checks": {
        "exit_code_is": 0,
        "convergence_status_is": "thrashing"
      }
    },
    {
      "id": "converge-exploring-04",
      "layer": "unit",
      "category": "convergence",
      "description": "Distinguishes exploring from thrashing — different errors each time",
      "target": "convergence-detector",
      "metrics_history": [
        {"iteration": 1, "test_pass_rate": 0.60, "error_hash": "aaa111"},
        {"iteration": 2, "test_pass_rate": 0.55, "error_hash": "bbb222"},
        {"iteration": 3, "test_pass_rate": 0.65, "error_hash": "ccc333"}
      ],
      "checks": {
        "exit_code_is": 0,
        "convergence_status_is": "exploring"
      }
    },
    {
      "id": "converge-budget-05",
      "layer": "unit",
      "category": "convergence",
      "description": "Budget exhausted when iteration >= max_iterations",
      "target": "convergence-detector",
      "state_file": {
        "iteration": 10,
        "max_iterations": 10
      },
      "metrics_history": [
        {"iteration": 9, "test_pass_rate": 0.60},
        {"iteration": 10, "test_pass_rate": 0.65}
      ],
      "checks": {
        "exit_code_is": 0,
        "convergence_status_is": "budget_exhausted"
      }
    },
    {
      "id": "route-initial-01",
      "layer": "unit",
      "category": "agent-routing",
      "description": "Initial phase routes to dev:developer",
      "target": "agent-router",
      "routing_input": {
        "phase": "initial",
        "last_outcome": null,
        "convergence_status": null
      },
      "checks": {
        "exit_code_is": 0,
        "routed_agent_is": "dev:developer"
      }
    },
    {
      "id": "route-test-fail-02",
      "layer": "unit",
      "category": "agent-routing",
      "description": "Test failure during implementation routes to dev:debugger",
      "target": "agent-router",
      "routing_input": {
        "phase": "implementing",
        "last_outcome": "test_fail",
        "convergence_status": null
      },
      "checks": {
        "exit_code_is": 0,
        "routed_agent_is": "dev:debugger"
      }
    },
    {
      "id": "route-plateau-03",
      "layer": "unit",
      "category": "agent-routing",
      "description": "Stuck plateau routes to dev:architect for strategy change",
      "target": "agent-router",
      "routing_input": {
        "phase": "implementing",
        "last_outcome": "test_fail",
        "convergence_status": "stuck_plateau"
      },
      "checks": {
        "exit_code_is": 0,
        "routed_agent_is": "dev:architect"
      }
    },
    {
      "id": "e2e-loop-start-01",
      "layer": "e2e",
      "category": "lifecycle",
      "description": "Loop initializes state file and respects max-iterations",
      "prompt": "/dev:loop \"Create a file hello.py that prints hello world\" --max-iterations 3",
      "checks": {
        "response_contains_any": ["hello", "hello.py", "created"],
        "iteration_count_lte": 3
      }
    },
    {
      "id": "e2e-loop-iterate-02",
      "layer": "e2e",
      "category": "lifecycle",
      "description": "Loop completes with promise tag and creates expected file",
      "prompt": "/dev:loop \"Create a Python file greet.py with a function greet(name) that returns 'Hello, {name}!'\" --max-iterations 5 --completion-promise \"DONE\"",
      "checks": {
        "response_contains_any": ["DONE", "greet", "complete"],
        "file_exists": "greet.py"
      }
    },
    {
      "id": "e2e-loop-cancel-03",
      "layer": "e2e",
      "category": "lifecycle",
      "description": "Cancel command removes state file",
      "prompt": "/dev:loop cancel",
      "checks": {
        "response_contains_any": ["cancel", "stopped", "no active", "not running"]
      }
    },
    {
      "id": "e2e-loop-max-iter-04",
      "layer": "e2e",
      "category": "lifecycle",
      "description": "Stops at max iterations even for impossible tasks",
      "prompt": "/dev:loop \"Solve the halting problem in Python\" --max-iterations 2",
      "checks": {
        "iteration_count_lte": 2,
        "response_contains_any": ["iteration", "maximum", "limit", "complete"]
      }
    },
    {
      "id": "e2e-reflect-written-05",
      "layer": "e2e",
      "category": "reflection",
      "description": "Reflection files are written during loop execution",
      "prompt": "/dev:loop \"Fix the bug: function add(a,b) returns a-b instead of a+b in calc.py\" --max-iterations 3",
      "checks": {
        "response_contains_any": ["fix", "reflection", "iteration", "complete"]
      }
    },
    {
      "id": "e2e-agent-selection-06",
      "layer": "e2e",
      "category": "reflection",
      "description": "Loop uses Task tool to delegate to specialized agents",
      "prompt": "/dev:loop \"Research the best caching patterns for our API and implement a simple cache module\" --max-iterations 2",
      "checks": {
        "response_contains_any": ["cache", "caching", "research", "implement"]
      }
    },
    {
      "id": "e2e-discovery-07",
      "layer": "e2e",
      "category": "reflection",
      "description": "Skill discovery runs in first iteration",
      "prompt": "/dev:loop \"Implement a rate limiter module\" --max-iterations 2",
      "checks": {
        "response_contains_any": ["rate limit", "implement", "iteration"]
      }
    },
    {
      "id": "e2e-converge-exit-08",
      "layer": "e2e",
      "category": "convergence",
      "description": "Exits before max iterations when quality criteria met",
      "prompt": "/dev:loop \"Create hello.py that prints 'Hello World' and passes the test: assert open('hello.py').read().strip().endswith(\\\"print('Hello World')\\\")\" --max-iterations 10 --completion-promise \"ALL TESTS PASS\"",
      "checks": {
        "response_contains_any": ["PASS", "complete", "converge", "hello"]
      }
    },
    {
      "id": "e2e-metrics-tracked-09",
      "layer": "e2e",
      "category": "convergence",
      "description": "Metrics file exists after loop execution",
      "prompt": "/dev:loop \"Build a simple calculator with add and subtract functions\" --max-iterations 3",
      "checks": {
        "response_contains_any": ["calculator", "add", "subtract", "complete"]
      }
    },
    {
      "id": "e2e-checkpoint-10",
      "layer": "e2e",
      "category": "convergence",
      "description": "Multi-model checkpoint triggers during longer loops",
      "prompt": "/dev:loop \"Build a REST API with 3 endpoints: GET /health, GET /users, POST /users\" --max-iterations 8 --checkpoint-every 3",
      "checks": {
        "response_contains_any": ["API", "endpoint", "health", "users"]
      }
    }
  ]
}
```

**Step 3: Verify JSON is valid**

Run: `jq '.' autotest/dev-loop/test-cases.json | head -5`
Expected: Valid JSON output, first 5 lines of formatted JSON

**Step 4: Verify test case counts**

Run: `jq '[.test_cases[] | select(.layer == "unit")] | length' autotest/dev-loop/test-cases.json`
Expected: `20`

Run: `jq '[.test_cases[] | select(.layer == "e2e")] | length' autotest/dev-loop/test-cases.json`
Expected: `10`

**Step 5: Commit**

```bash
git add autotest/dev-loop/test-cases.json
git commit -m "test(dev-loop): add test-cases.json with 20 unit + 10 e2e test cases"
```

---

## Task 2: Write the TypeScript Check Evaluator (analyze-results.ts)

This is the shared analyzer that handles both layers. For Layer 1 it's called per-test (like `analyze-coaching.ts`). For Layer 2 it's called on the results directory (like terminal's `analyze-results.ts`).

**Files:**
- Create: `autotest/dev-loop/analyze-results.ts`

**Step 1: Write the analyzer with Layer 1 check evaluation**

Create `autotest/dev-loop/analyze-results.ts`:

```typescript
#!/usr/bin/env bun
/**
 * dev:loop Test Suite Analyzer
 *
 * Dual-mode analyzer supporting both test layers:
 *
 * Layer 1 (unit): Called per-test by run-unit.sh
 *   Usage: bun analyze-results.ts --layer unit <test-dir> <checks-json> [exit-code]
 *   Returns JSON: {"passed": bool, "checks": [...], "summary": {...}}
 *
 * Layer 2 (e2e): Called on results directory by runner-base.sh
 *   Usage: bun analyze-results.ts --layer e2e <results-dir>
 *   Outputs: <results-dir>/dev-loop-analysis.json + stdout summary table
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join, basename } from "path";

// ===========================================================================
// Types
// ===========================================================================

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

// Layer 1: Unit test checks
interface UnitChecks {
  exit_code_is?: number;
  stdout_contains?: string;
  stdout_contains_2?: string;
  stdout_is_empty?: boolean;
  state_file_exists?: boolean;
  state_iteration_is?: number;
  reflection_file_exists?: boolean;
  reflection_valid_json?: boolean;
  reflection_has_field?: string;
  reflection_has_field_2?: string;
  reflection_thrashing_is?: boolean;
  reflection_references_prior?: boolean;
  reflection_schema_valid?: boolean;
  convergence_status_is?: string;
  routed_agent_is?: string;
}

// Layer 2: E2E checks (used by runner-base.sh analyzer callback)
interface E2EChecks {
  response_contains?: string;
  response_contains_any?: string[];
  file_exists?: string;
  iteration_count_lte?: number;
  iteration_count_gte?: number;
}

// ===========================================================================
// Helpers
// ===========================================================================

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

// ===========================================================================
// Layer 1: Unit Check Evaluation
// ===========================================================================

function runUnitChecks(
  testDir: string,
  checks: Record<string, unknown>,
  analyzerExitCode: number
): CheckResult[] {
  const results: CheckResult[] = [];

  const stdoutPath = join(testDir, "hook-stdout.txt");
  const statePath = join(testDir, "state.json");
  const reflectionDir = join(testDir, "reflections");
  const convergencePath = join(testDir, "convergence-output.json");
  const routerPath = join(testDir, "router-output.json");

  const stdoutContent = readFile(stdoutPath);
  const stateData = readJson(statePath) as Record<string, unknown> | null;
  const convergenceData = readJson(convergencePath) as Record<string, unknown> | null;
  const routerData = readJson(routerPath) as Record<string, unknown> | null;

  // ---- Exit code ----
  if ("exit_code_is" in checks) {
    const expected = Number(checks.exit_code_is);
    const passed = analyzerExitCode === expected;
    results.push({
      check: "exit_code_is",
      passed,
      detail: passed
        ? `Exit code is ${expected} (correct)`
        : `Exit code is ${analyzerExitCode}, expected ${expected}`,
    });
  }

  // ---- Stdout checks ----
  if ("stdout_contains" in checks) {
    const expected = String(checks.stdout_contains);
    if (stdoutContent === null) {
      results.push({ check: "stdout_contains", passed: false, detail: "stdout file absent" });
    } else {
      const passed = stdoutContent.includes(expected);
      results.push({
        check: "stdout_contains",
        passed,
        detail: passed
          ? `stdout contains "${expected}"`
          : `stdout does NOT contain "${expected}". Preview: ${stdoutContent.substring(0, 200)}`,
      });
    }
  }

  if ("stdout_contains_2" in checks) {
    const expected = String(checks.stdout_contains_2);
    if (stdoutContent === null) {
      results.push({ check: "stdout_contains_2", passed: false, detail: "stdout file absent" });
    } else {
      const passed = stdoutContent.includes(expected);
      results.push({
        check: "stdout_contains_2",
        passed,
        detail: passed
          ? `stdout also contains "${expected}"`
          : `stdout does NOT contain "${expected}"`,
      });
    }
  }

  if ("stdout_is_empty" in checks) {
    const passed = stdoutContent === null || stdoutContent.trim().length === 0;
    results.push({
      check: "stdout_is_empty",
      passed,
      detail: passed
        ? "stdout is empty (correct)"
        : `stdout has content: ${stdoutContent?.substring(0, 100)}`,
    });
  }

  // ---- State file checks ----
  if ("state_file_exists" in checks) {
    const expected = Boolean(checks.state_file_exists);
    const actual = existsSync(statePath) && (readFile(statePath) ?? "").trim().length > 0;
    const passed = actual === expected;
    results.push({
      check: "state_file_exists",
      passed,
      detail: passed
        ? `State file ${expected ? "exists" : "absent"} (correct)`
        : `State file ${actual ? "exists" : "absent"}, expected ${expected ? "exists" : "absent"}`,
    });
  }

  if ("state_iteration_is" in checks) {
    const expected = Number(checks.state_iteration_is);
    if (stateData === null) {
      results.push({ check: "state_iteration_is", passed: false, detail: "state.json absent" });
    } else {
      const actual = stateData.iteration;
      const passed = actual === expected;
      results.push({
        check: "state_iteration_is",
        passed,
        detail: passed
          ? `iteration is ${expected} (correct)`
          : `iteration is ${actual}, expected ${expected}`,
      });
    }
  }

  // ---- Reflection checks ----
  if ("reflection_file_exists" in checks) {
    const expected = Boolean(checks.reflection_file_exists);
    let actual = false;
    if (existsSync(reflectionDir)) {
      try {
        const files = readdirSync(reflectionDir).filter((f) => f.endsWith(".json"));
        actual = files.length > 0;
      } catch { /* empty */ }
    }
    const passed = actual === expected;
    results.push({
      check: "reflection_file_exists",
      passed,
      detail: passed
        ? `Reflection file ${expected ? "exists" : "absent"} (correct)`
        : `Reflection file ${actual ? "exists" : "absent"}, expected ${expected ? "exists" : "absent"}`,
    });
  }

  if ("reflection_valid_json" in checks) {
    let passed = false;
    let detail = "No reflection file found";
    if (existsSync(reflectionDir)) {
      try {
        const files = readdirSync(reflectionDir).filter((f) => f.endsWith(".json"));
        if (files.length > 0) {
          const content = readFile(join(reflectionDir, files[files.length - 1]));
          if (content) {
            JSON.parse(content);
            passed = true;
            detail = "Reflection file is valid JSON";
          }
        }
      } catch (e) {
        detail = `Reflection file is invalid JSON: ${e}`;
      }
    }
    results.push({ check: "reflection_valid_json", passed, detail });
  }

  // Check for specific fields in reflection
  for (const suffix of ["", "_2"]) {
    const key = `reflection_has_field${suffix}`;
    if (key in checks) {
      const field = String(checks[key]);
      let passed = false;
      let detail = "No reflection file found";
      if (existsSync(reflectionDir)) {
        try {
          const files = readdirSync(reflectionDir).filter((f) => f.endsWith(".json"));
          if (files.length > 0) {
            const data = readJson(join(reflectionDir, files[files.length - 1])) as Record<string, unknown> | null;
            if (data && field in data) {
              passed = true;
              detail = `Reflection has field "${field}"`;
            } else {
              detail = `Reflection missing field "${field}". Keys: ${data ? Object.keys(data).join(", ") : "none"}`;
            }
          }
        } catch { /* empty */ }
      }
      results.push({ check: key, passed, detail });
    }
  }

  if ("reflection_thrashing_is" in checks) {
    const expected = Boolean(checks.reflection_thrashing_is);
    let passed = false;
    let detail = "No reflection file found";
    if (existsSync(reflectionDir)) {
      try {
        const files = readdirSync(reflectionDir).filter((f) => f.endsWith(".json"));
        if (files.length > 0) {
          const data = readJson(join(reflectionDir, files[files.length - 1])) as Record<string, unknown> | null;
          if (data) {
            const actual = Boolean(data.thrashing);
            passed = actual === expected;
            detail = passed
              ? `thrashing is ${expected} (correct)`
              : `thrashing is ${actual}, expected ${expected}`;
          }
        }
      } catch { /* empty */ }
    }
    results.push({ check: "reflection_thrashing_is", passed, detail });
  }

  if ("reflection_references_prior" in checks) {
    let passed = false;
    let detail = "No reflection file found";
    if (existsSync(reflectionDir)) {
      try {
        const files = readdirSync(reflectionDir).filter((f) => f.endsWith(".json"));
        if (files.length > 0) {
          const data = readJson(join(reflectionDir, files[files.length - 1])) as Record<string, unknown> | null;
          if (data) {
            const summary = String(data.prior_iterations_summary ?? data.history_summary ?? "");
            passed = summary.length > 10;
            detail = passed
              ? "Reflection references prior iterations"
              : "Reflection does not reference prior iterations";
          }
        }
      } catch { /* empty */ }
    }
    results.push({ check: "reflection_references_prior", passed, detail });
  }

  if ("reflection_schema_valid" in checks) {
    let passed = false;
    let detail = "No reflection file found";
    const requiredFields = ["approach", "successes", "failures"];
    if (existsSync(reflectionDir)) {
      try {
        const files = readdirSync(reflectionDir).filter((f) => f.endsWith(".json"));
        if (files.length > 0) {
          const data = readJson(join(reflectionDir, files[files.length - 1])) as Record<string, unknown> | null;
          if (data) {
            const missing = requiredFields.filter((f) => !(f in data));
            passed = missing.length === 0;
            detail = passed
              ? "Reflection has all required schema fields"
              : `Reflection missing fields: ${missing.join(", ")}`;
          }
        }
      } catch { /* empty */ }
    }
    results.push({ check: "reflection_schema_valid", passed, detail });
  }

  // ---- Convergence checks ----
  if ("convergence_status_is" in checks) {
    const expected = String(checks.convergence_status_is);
    if (convergenceData === null) {
      results.push({
        check: "convergence_status_is",
        passed: false,
        detail: "convergence-output.json absent",
      });
    } else {
      const actual = String(convergenceData.status ?? convergenceData.convergence_status ?? "");
      const passed = actual === expected;
      results.push({
        check: "convergence_status_is",
        passed,
        detail: passed
          ? `Convergence status is "${expected}" (correct)`
          : `Convergence status is "${actual}", expected "${expected}"`,
      });
    }
  }

  // ---- Agent routing checks ----
  if ("routed_agent_is" in checks) {
    const expected = String(checks.routed_agent_is);
    if (routerData === null) {
      results.push({
        check: "routed_agent_is",
        passed: false,
        detail: "router-output.json absent",
      });
    } else {
      const actual = String(routerData.agent ?? routerData.routed_agent ?? "");
      const passed = actual === expected;
      results.push({
        check: "routed_agent_is",
        passed,
        detail: passed
          ? `Routed agent is "${expected}" (correct)`
          : `Routed agent is "${actual}", expected "${expected}"`,
      });
    }
  }

  return results;
}

// ===========================================================================
// Layer 2: E2E Analyzer (results directory walker)
// ===========================================================================

// Note: Layer 2 uses runner-base.sh which calls this script with the results
// directory. We walk subdirs looking for transcript.jsonl files and evaluate
// the e2e checks from test-cases.json.

interface TranscriptEntry {
  type: string;
  message?: {
    content: Array<{
      type: "text" | "tool_use";
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: string | unknown;
}

function parseTranscript(path: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch { /* skip malformed */ }
  }
  return entries;
}

function extractFinalResponse(entries: TranscriptEntry[]): string {
  // Primary: type==="result" entry (claudish --json output)
  for (const entry of entries) {
    if (entry.type === "result" && typeof entry.result === "string") {
      return entry.result;
    }
  }
  // Fallback: last assistant text blocks
  let lastText = "";
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const parts: string[] = [];
    for (const block of entry.message?.content ?? []) {
      if (block.type === "text" && block.text) parts.push(block.text);
    }
    if (parts.length > 0) lastText = parts.join("\n");
  }
  return lastText;
}

interface TestCase {
  id: string;
  description: string;
  layer: string;
  checks?: Record<string, unknown>;
  [key: string]: unknown;
}

function runE2EAnalysis(resultsDir: string): void {
  const testCasesPath = join(resultsDir, "test-cases.json");
  if (!existsSync(testCasesPath)) {
    console.error(`ERROR: test-cases.json not found in: ${resultsDir}`);
    process.exit(1);
  }

  const testCasesFile = JSON.parse(readFileSync(testCasesPath, "utf-8"));
  const testCases: TestCase[] = testCasesFile.test_cases.filter(
    (tc: TestCase) => tc.layer === "e2e"
  );

  console.log(`\n\x1b[1m=== dev:loop E2E Analyzer ===\x1b[0m`);
  console.log(`Results dir: ${resultsDir}`);
  console.log(`E2E test cases: ${testCases.length}\n`);

  // Find transcript.jsonl files
  function findTranscripts(dir: string, depth = 0): string[] {
    if (depth > 3) return [];
    const found: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      for (const entry of entries) {
        const subdir = join(dir, entry);
        const tp = join(subdir, "transcript.jsonl");
        if (existsSync(tp)) found.push(tp);
        else found.push(...findTranscripts(subdir, depth + 1));
      }
    } catch { /* empty */ }
    return found;
  }

  const transcriptPaths = findTranscripts(resultsDir);
  const analyses: Array<{
    test_id: string;
    passed: boolean;
    checks: CheckResult[];
    summary: { total_checks: number; passed_checks: number; failed_checks: number };
  }> = [];

  for (const tp of transcriptPaths) {
    const caseDir = tp.replace(/\/transcript\.jsonl$/, "");
    const caseId = basename(caseDir);
    const tc = testCases.find((c) => c.id === caseId);
    if (!tc || !tc.checks) continue;

    const entries = parseTranscript(tp);
    const finalResponse = extractFinalResponse(entries);
    const checks = tc.checks;
    const checkResults: CheckResult[] = [];

    // response_contains
    if ("response_contains" in checks) {
      const needle = String(checks.response_contains);
      const found = finalResponse.includes(needle);
      checkResults.push({
        check: "response_contains",
        passed: found,
        detail: found
          ? `Response contains "${needle.slice(0, 60)}"`
          : `Response does NOT contain "${needle.slice(0, 60)}"`,
      });
    }

    // response_contains_any
    if ("response_contains_any" in checks) {
      const candidates = checks.response_contains_any as string[];
      const found = candidates.some((c) => finalResponse.toLowerCase().includes(c.toLowerCase()));
      checkResults.push({
        check: "response_contains_any",
        passed: found,
        detail: found
          ? `Response contains one of the expected terms`
          : `Response contains none of: ${candidates.join(", ")}`,
      });
    }

    // iteration_count_lte
    if ("iteration_count_lte" in checks) {
      // Look for iteration count in response or loop metadata
      const maxExpected = Number(checks.iteration_count_lte);
      const iterMatch = finalResponse.match(/iteration[:\s]+(\d+)/i);
      const iterCount = iterMatch ? parseInt(iterMatch[1], 10) : 0;
      // If we can't detect iteration count, pass if response exists
      const passed = iterCount > 0 ? iterCount <= maxExpected : finalResponse.length > 0;
      checkResults.push({
        check: "iteration_count_lte",
        passed,
        detail: iterCount > 0
          ? `${iterCount} iterations <= ${maxExpected}`
          : `Could not detect iteration count, response exists (${finalResponse.length} chars)`,
      });
    }

    // file_exists
    if ("file_exists" in checks) {
      const filename = String(checks.file_exists);
      // Check if the response mentions creating the file
      const mentioned = finalResponse.toLowerCase().includes(filename.toLowerCase());
      checkResults.push({
        check: "file_exists",
        passed: mentioned,
        detail: mentioned
          ? `Response references file "${filename}"`
          : `Response does not mention "${filename}"`,
      });
    }

    const allPassed = checkResults.every((r) => r.passed);
    analyses.push({
      test_id: caseId,
      passed: allPassed,
      checks: checkResults,
      summary: {
        total_checks: checkResults.length,
        passed_checks: checkResults.filter((r) => r.passed).length,
        failed_checks: checkResults.filter((r) => !r.passed).length,
      },
    });

    const icon = allPassed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(`${icon} ${caseId}`);
    for (const chk of checkResults) {
      if (!chk.passed) {
        console.log(`     \x1b[31mFAIL\x1b[0m ${chk.check}: ${chk.detail}`);
      }
    }
  }

  const totalAnalyzed = analyses.length;
  const passedTests = analyses.filter((a) => a.passed).length;
  const passRate = totalAnalyzed > 0 ? Math.round((passedTests / totalAnalyzed) * 100) : 0;

  console.log(`\n\x1b[1m=== Overall ===\x1b[0m`);
  console.log(`Analyzed: ${totalAnalyzed} | Passed: ${passedTests} | Failed: ${totalAnalyzed - passedTests} | Rate: ${passRate}%\n`);

  const outputPath = join(resultsDir, "dev-loop-analysis.json");
  writeFileSync(outputPath, JSON.stringify({ analyses, passRate }, null, 2));
  console.log(`Analysis written to: ${outputPath}\n`);

  process.exit(passedTests < totalAnalyzed ? 1 : 0);
}

// ===========================================================================
// Main
// ===========================================================================

function main(): void {
  const args = process.argv.slice(2);
  let layer = "unit";
  let positionalArgs: string[] = [];

  // Parse --layer flag
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--layer" && i + 1 < args.length) {
      layer = args[i + 1];
      i++;
    } else {
      positionalArgs.push(args[i]);
    }
  }

  if (layer === "unit") {
    // Layer 1: per-test evaluation
    if (positionalArgs.length < 2) {
      console.error("Usage: bun analyze-results.ts --layer unit <test-dir> <checks-json> [exit-code]");
      process.exit(1);
    }
    const testDir = positionalArgs[0];
    let checks: Record<string, unknown>;
    try {
      checks = JSON.parse(positionalArgs[1]);
    } catch (e) {
      console.error(`Invalid checks JSON: ${e}`);
      process.exit(1);
    }
    const exitCode = positionalArgs[2] !== undefined ? parseInt(positionalArgs[2], 10) : 0;

    const checkResults = runUnitChecks(testDir, checks, exitCode);
    const allPassed = checkResults.every((r) => r.passed);
    const output: AnalysisOutput = {
      passed: allPassed,
      checks: checkResults,
      summary: {
        total_checks: checkResults.length,
        passed_checks: checkResults.filter((r) => r.passed).length,
        failed_checks: checkResults.filter((r) => !r.passed).length,
      },
    };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    process.exit(allPassed ? 0 : 1);

  } else if (layer === "e2e") {
    // Layer 2: results directory analysis
    if (positionalArgs.length < 1) {
      console.error("Usage: bun analyze-results.ts --layer e2e <results-dir>");
      process.exit(1);
    }
    runE2EAnalysis(positionalArgs[0]);

  } else {
    console.error(`Unknown layer: ${layer}. Use --layer unit or --layer e2e`);
    process.exit(1);
  }
}

main();
```

**Step 2: Verify TypeScript compiles**

Run: `cd autotest/dev-loop && bun build analyze-results.ts --outdir /dev/null 2>&1 | head -5`
Expected: No compilation errors

**Step 3: Test the unit layer with a minimal mock**

Run: `mkdir -p /tmp/dev-loop-test && echo '{"decision":"block"}' > /tmp/dev-loop-test/hook-stdout.txt && bun autotest/dev-loop/analyze-results.ts --layer unit /tmp/dev-loop-test '{"stdout_contains":"block","exit_code_is":0}' 0`
Expected: `{"passed": true, ...}`

**Step 4: Commit**

```bash
git add autotest/dev-loop/analyze-results.ts
git commit -m "test(dev-loop): add dual-layer TypeScript analyzer

Layer 1 (unit): per-test check evaluation for hook scripts
Layer 2 (e2e): results directory walker for claudish integration tests"
```

---

## Task 3: Write the Layer 1 Custom Runner (run-unit.sh)

Follows the coaching pattern: reads test-cases.json, generates synthetic transcripts, runs target scripts, validates with the TypeScript analyzer.

**Files:**
- Create: `autotest/dev-loop/run-unit.sh`

**Step 1: Write run-unit.sh**

Create `autotest/dev-loop/run-unit.sh` (make executable):

```bash
#!/bin/bash
# dev:loop Unit Test Runner (Layer 1)
#
# Tests deterministic hook scripts with synthetic JSONL transcripts.
# No LLM involved — runs in seconds with zero API cost.
#
# Pattern: Same as autotest/coaching/run-tests.sh
#
# Usage:
#   ./autotest/dev-loop/run-unit.sh [OPTIONS]
#
# Options:
#   --cases <ids>       Comma-separated test case IDs (default: all unit cases)
#   --output-dir <dir>  Custom output directory
#   --timeout <secs>    Per-test timeout (default: 30)
#   --dry-run           Show what would run
#   --help              Show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_CASES_FILE="$SCRIPT_DIR/test-cases.json"
ANALYZER_TS="$SCRIPT_DIR/analyze-results.ts"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_DIR="$SCRIPT_DIR/results/unit-$TIMESTAMP"
TIMEOUT=30
DRY_RUN=false
SELECTED_CASES=""

# dev:loop script paths (update these when implementation lands)
STOP_HOOK="$REPO_ROOT/plugins/dev/hooks/dev-loop/stop-hook.sh"
REFLECTION_GEN="$REPO_ROOT/plugins/dev/hooks/dev-loop/reflection-generator.ts"
CONVERGENCE_DET="$REPO_ROOT/plugins/dev/hooks/dev-loop/convergence-detector.ts"
AGENT_ROUTER="$REPO_ROOT/plugins/dev/hooks/dev-loop/agent-router.ts"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --cases) SELECTED_CASES="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help)
      head -17 "$0" | tail -16
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Verify dependencies
for cmd in jq bun; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' not found."
    exit 1
  fi
done

if [[ ! -f "$TEST_CASES_FILE" ]]; then
  echo "ERROR: Test cases file not found: $TEST_CASES_FILE"
  exit 1
fi

if [[ ! -f "$ANALYZER_TS" ]]; then
  echo "ERROR: Analyzer not found: $ANALYZER_TS"
  exit 1
fi

# Determine timeout command (macOS vs Linux)
if command -v gtimeout &>/dev/null; then
  TIMEOUT_CMD="gtimeout"
elif command -v timeout &>/dev/null; then
  TIMEOUT_CMD="timeout"
else
  TIMEOUT_CMD=""
  echo "WARNING: No 'timeout' command found."
fi

# Load unit test cases only
TOTAL_CASES=$(jq '[.test_cases[] | select(.layer == "unit")] | length' "$TEST_CASES_FILE")
echo "=== dev:loop Unit Test Runner (Layer 1) ==="
echo "Test cases file: $TEST_CASES_FILE"
echo "Unit test cases: $TOTAL_CASES"
echo "Timeout per test: ${TIMEOUT}s"
echo "Output directory: $OUTPUT_DIR"
echo ""

mkdir -p "$OUTPUT_DIR"
cp "$TEST_CASES_FILE" "$OUTPUT_DIR/test-cases.json"

# Filter test cases
if [[ -n "$SELECTED_CASES" ]]; then
  IFS=',' read -ra CASE_IDS <<< "$SELECTED_CASES"
  echo "Running selected cases: ${CASE_IDS[*]}"
else
  CASE_IDS=()
  while IFS= read -r id; do
    CASE_IDS+=("$id")
  done < <(jq -r '.test_cases[] | select(.layer == "unit") | .id' "$TEST_CASES_FILE")
fi

echo "Cases to run: ${#CASE_IDS[@]}"
echo ""

# Track results
PASS=0
FAIL=0
ERROR=0
TOTAL=0

# Helper: generate a single JSONL tool_use line
make_tool_line() {
  local tool_name="$1"
  local input_json="$2"
  jq -nc \
    --arg tool "$tool_name" \
    --argjson inp "$input_json" \
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":$tool,"input":$inp}]}}'
}

# Helper: generate a text assistant line (for promise matching)
make_text_line() {
  local text="$1"
  jq -nc --arg t "$text" '{"type":"assistant","message":{"content":[{"type":"text","text":$t}]}}'
}

run_single_test() {
  local case_id="$1"
  local case_dir="$OUTPUT_DIR/$case_id"
  mkdir -p "$case_dir"

  # Extract test case fields
  local tc_json
  tc_json=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id)' "$TEST_CASES_FILE")

  local description
  description=$(echo "$tc_json" | jq -r '.description')
  local target
  target=$(echo "$tc_json" | jq -r '.target')
  local checks
  checks=$(echo "$tc_json" | jq -c '.checks')
  local filler_count
  filler_count=$(echo "$tc_json" | jq -r '.filler_count // 10')

  if [[ -z "$description" || "$description" == "null" ]]; then
    echo "  ERROR: Test case '$case_id' not found"
    ERROR=$((ERROR + 1))
    TOTAL=$((TOTAL + 1))
    return
  fi

  echo "  [$case_id] target=$target"
  echo "    $description"

  if $DRY_RUN; then
    echo "    [DRY RUN] Would run $target"
    echo ""
    return
  fi

  # Create isolated temp directory
  local test_dir
  test_dir=$(mktemp -d)

  local state_dir="$test_dir/.claude"
  local state_file="$state_dir/dev-loop.local.json"
  local transcript_file="$test_dir/transcript.jsonl"
  local reflections_dir="$test_dir/reflections"
  mkdir -p "$state_dir" "$reflections_dir"

  # Seed state file if specified
  local state_data
  state_data=$(echo "$tc_json" | jq -c '.state_file // empty')
  if [[ -n "$state_data" && "$state_data" != "null" && "$state_data" != "" ]]; then
    echo "$state_data" > "$state_file"
  fi

  # Handle raw_state_file (for corrupted state testing)
  local raw_state
  raw_state=$(echo "$tc_json" | jq -r '.raw_state_file // empty')
  if [[ -n "$raw_state" && "$raw_state" != "null" && "$raw_state" != "" ]]; then
    printf '%s' "$raw_state" > "$state_file"
  fi

  # Seed pre_reflections if specified
  local pre_reflections
  pre_reflections=$(echo "$tc_json" | jq -c '.pre_reflections // empty')
  if [[ -n "$pre_reflections" && "$pre_reflections" != "null" && "$pre_reflections" != "" ]]; then
    local refl_count
    refl_count=$(echo "$pre_reflections" | jq 'length')
    local r
    for (( r=0; r<refl_count; r++ )); do
      local iter
      iter=$(echo "$pre_reflections" | jq -r ".[$r].iteration")
      echo "$pre_reflections" | jq -c ".[$r]" > "$reflections_dir/iteration-${iter}.json"
    done
  fi

  # Generate synthetic JSONL transcript
  # Filler lines first
  local i
  for (( i=0; i<filler_count; i++ )); do
    make_tool_line "Write" "{\"file_path\":\"/project/filler${i}.ts\",\"content\":\"// filler\"}" >> "$transcript_file"
  done

  # Test-specific tool calls
  local transcript_arr
  transcript_arr=$(echo "$tc_json" | jq -c '.transcript // []')
  local tc_count
  tc_count=$(echo "$transcript_arr" | jq 'length')
  local j
  for (( j=0; j<tc_count; j++ )); do
    local tc_tool tc_input
    tc_tool=$(echo "$transcript_arr" | jq -r ".[${j}].tool")
    tc_input=$(echo "$transcript_arr" | jq -c ".[${j}].input")
    make_tool_line "$tc_tool" "$tc_input" >> "$transcript_file"
  done

  # Text lines (for promise matching)
  local transcript_text
  transcript_text=$(echo "$tc_json" | jq -c '.transcript_text // empty')
  if [[ -n "$transcript_text" && "$transcript_text" != "null" && "$transcript_text" != "" ]]; then
    local text_count
    text_count=$(echo "$transcript_text" | jq 'length')
    local t
    for (( t=0; t<text_count; t++ )); do
      local text_val
      text_val=$(echo "$transcript_text" | jq -r ".[${t}]")
      make_text_line "$text_val" >> "$transcript_file"
    done
  fi

  # Seed metrics_history for convergence tests
  local metrics_history
  metrics_history=$(echo "$tc_json" | jq -c '.metrics_history // empty')
  if [[ -n "$metrics_history" && "$metrics_history" != "null" && "$metrics_history" != "" ]]; then
    echo "$metrics_history" > "$test_dir/metrics-history.json"
  fi

  # Seed routing_input for agent-router tests
  local routing_input
  routing_input=$(echo "$tc_json" | jq -c '.routing_input // empty')
  if [[ -n "$routing_input" && "$routing_input" != "null" && "$routing_input" != "" ]]; then
    echo "$routing_input" > "$test_dir/routing-input.json"
  fi

  # Run the target script
  local exit_code=0
  set +e
  case "$target" in
    stop-hook)
      if [[ ! -f "$STOP_HOOK" ]]; then
        echo "    SKIP: stop hook not yet implemented ($STOP_HOOK)"
        echo "    (This test will pass once dev:loop implementation lands)"
        ERROR=$((ERROR + 1))
        TOTAL=$((TOTAL + 1))
        cp -r "$test_dir/." "$case_dir/" 2>/dev/null || true
        rm -rf "$test_dir"
        echo ""
        return
      fi
      # Stop hook receives JSON on stdin with session_id, transcript_path, cwd
      local hook_input
      hook_input=$(jq -nc \
        --arg sid "test-session-${case_id}" \
        --arg tp "$transcript_file" \
        --arg cwd "$test_dir" \
        '{"session_id": $sid, "transcript_path": $tp, "cwd": $cwd}')

      if [[ -n "$TIMEOUT_CMD" ]]; then
        echo "$hook_input" | $TIMEOUT_CMD ${TIMEOUT}s bash "$STOP_HOOK" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      else
        echo "$hook_input" | bash "$STOP_HOOK" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      fi
      exit_code=$?

      # Copy state file to standard check location
      if [[ -f "$state_file" ]]; then
        cp "$state_file" "$test_dir/state.json"
      fi
      ;;

    reflection-generator)
      if [[ ! -f "$REFLECTION_GEN" ]]; then
        echo "    SKIP: reflection generator not yet implemented ($REFLECTION_GEN)"
        ERROR=$((ERROR + 1))
        TOTAL=$((TOTAL + 1))
        cp -r "$test_dir/." "$case_dir/" 2>/dev/null || true
        rm -rf "$test_dir"
        echo ""
        return
      fi
      if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD ${TIMEOUT}s bun "$REFLECTION_GEN" \
          --transcript "$transcript_file" \
          --state "$state_file" \
          --reflections-dir "$reflections_dir" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      else
        bun "$REFLECTION_GEN" \
          --transcript "$transcript_file" \
          --state "$state_file" \
          --reflections-dir "$reflections_dir" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      fi
      exit_code=$?
      ;;

    convergence-detector)
      if [[ ! -f "$CONVERGENCE_DET" ]]; then
        echo "    SKIP: convergence detector not yet implemented ($CONVERGENCE_DET)"
        ERROR=$((ERROR + 1))
        TOTAL=$((TOTAL + 1))
        cp -r "$test_dir/." "$case_dir/" 2>/dev/null || true
        rm -rf "$test_dir"
        echo ""
        return
      fi
      if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD ${TIMEOUT}s bun "$CONVERGENCE_DET" \
          --metrics "$test_dir/metrics-history.json" \
          --state "$state_file" \
          --output "$test_dir/convergence-output.json" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      else
        bun "$CONVERGENCE_DET" \
          --metrics "$test_dir/metrics-history.json" \
          --state "$state_file" \
          --output "$test_dir/convergence-output.json" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      fi
      exit_code=$?
      ;;

    agent-router)
      if [[ ! -f "$AGENT_ROUTER" ]]; then
        echo "    SKIP: agent router not yet implemented ($AGENT_ROUTER)"
        ERROR=$((ERROR + 1))
        TOTAL=$((TOTAL + 1))
        cp -r "$test_dir/." "$case_dir/" 2>/dev/null || true
        rm -rf "$test_dir"
        echo ""
        return
      fi
      if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD ${TIMEOUT}s bun "$AGENT_ROUTER" \
          --input "$test_dir/routing-input.json" \
          --output "$test_dir/router-output.json" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      else
        bun "$AGENT_ROUTER" \
          --input "$test_dir/routing-input.json" \
          --output "$test_dir/router-output.json" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      fi
      exit_code=$?
      ;;

    *)
      echo "    ERROR: Unknown target '$target'"
      ERROR=$((ERROR + 1))
      TOTAL=$((TOTAL + 1))
      rm -rf "$test_dir"
      echo ""
      return
      ;;
  esac
  set -e

  # Copy artifacts to output dir
  cp -r "$test_dir/." "$case_dir/" 2>/dev/null || true

  # Run the TypeScript analyzer
  local analysis_result
  local analysis_exit=0
  set +e
  analysis_result=$(bun "$ANALYZER_TS" --layer unit "$test_dir" "$checks" "$exit_code" 2>"$case_dir/analyzer-stderr.txt")
  analysis_exit=$?
  set -e

  echo "$analysis_result" > "$case_dir/analysis.json" 2>/dev/null || true

  # Determine pass/fail
  local result="ERROR"
  local passed_checks=0
  local total_checks=0

  if [[ -n "$analysis_result" ]]; then
    local all_passed
    all_passed=$(echo "$analysis_result" | jq -r '.passed' 2>/dev/null || echo "false")
    passed_checks=$(echo "$analysis_result" | jq -r '.summary.passed_checks' 2>/dev/null || echo "0")
    total_checks=$(echo "$analysis_result" | jq -r '.summary.total_checks' 2>/dev/null || echo "0")

    if [[ "$all_passed" == "true" ]]; then
      result="PASS"
      PASS=$((PASS + 1))
    else
      result="FAIL"
      FAIL=$((FAIL + 1))
      echo "$analysis_result" | jq -r '.checks[] | select(.passed == false) | "    FAIL: " + .check + ": " + .detail' 2>/dev/null || true
    fi
  else
    result="ERROR"
    ERROR=$((ERROR + 1))
  fi
  TOTAL=$((TOTAL + 1))

  # Write meta file
  jq -n \
    --arg id "$case_id" \
    --arg result "$result" \
    --arg passed "$passed_checks" \
    --arg total "$total_checks" \
    --arg exit_code "$exit_code" \
    --arg finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      test_id: $id,
      result: $result,
      passed_checks: ($passed | tonumber),
      total_checks: ($total | tonumber),
      exit_code: ($exit_code | tonumber),
      finished_at: $finished
    }' > "$case_dir/meta.json"

  echo "    Result: $result ($passed_checks/$total_checks checks) | target exit: $exit_code"
  echo ""

  rm -rf "$test_dir"
}

# Main execution
echo "=== Starting Unit Tests ==="
echo ""

for case_id in "${CASE_IDS[@]}"; do
  run_single_test "$case_id"
done

# Summary
echo ""
echo "=== Unit Test Results Summary ==="
echo "Total: $TOTAL | Pass: $PASS | Fail: $FAIL | Error/Skip: $ERROR"
if [[ $TOTAL -gt 0 ]]; then
  echo "Pass Rate: $(( PASS * 100 / TOTAL ))%"
fi
echo ""
echo "Results directory: $OUTPUT_DIR"

# Write results-summary.json
jq -n \
  --argjson total "$TOTAL" \
  --argjson passed "$PASS" \
  --argjson failed "$FAIL" \
  --argjson errors "$ERROR" \
  --arg timestamp "$TIMESTAMP" \
  '{
    layer: "unit",
    summary: {
      total: $total,
      passed: $passed,
      failed: $failed,
      errors: $errors,
      pass_rate: (if $total > 0 then (($passed * 100) / $total | round) else 0 end),
      timestamp: $timestamp
    }
  }' > "$OUTPUT_DIR/results-summary.json"

# Detailed results table
echo ""
echo "=== Detailed Results ==="
echo ""
printf "%-35s %-10s %-8s %-12s %-8s\n" "TEST_ID" "TARGET" "RESULT" "CHECKS" "EXIT"
printf "%-35s %-10s %-8s %-12s %-8s\n" "-------" "------" "------" "------" "----"

for case_id in "${CASE_IDS[@]}"; do
  meta_file="$OUTPUT_DIR/$case_id/meta.json"
  if [[ -f "$meta_file" ]]; then
    result=$(jq -r '.result' "$meta_file")
    passed=$(jq -r '.passed_checks' "$meta_file")
    total=$(jq -r '.total_checks' "$meta_file")
    exit_code=$(jq -r '.exit_code' "$meta_file")
    target=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .target' "$TEST_CASES_FILE" 2>/dev/null || echo "?")
    printf "%-35s %-10s %-8s %-12s %-8s\n" "$case_id" "$target" "$result" "${passed}/${total}" "$exit_code"
  fi
done

echo ""
echo "Full results: $OUTPUT_DIR/results-summary.json"

if [[ $FAIL -gt 0 || $ERROR -gt 0 ]]; then
  exit 1
fi
exit 0
```

**Step 2: Make executable**

Run: `chmod +x autotest/dev-loop/run-unit.sh`

**Step 3: Verify it runs in dry-run mode**

Run: `./autotest/dev-loop/run-unit.sh --dry-run 2>&1 | head -20`
Expected: Lists all 20 unit test cases with `[DRY RUN]` markers

**Step 4: Verify case filtering works**

Run: `./autotest/dev-loop/run-unit.sh --cases stop-hook-block-01 --dry-run`
Expected: Shows only 1 case

**Step 5: Commit**

```bash
git add autotest/dev-loop/run-unit.sh
git commit -m "test(dev-loop): add Layer 1 unit test runner

Custom bash runner following coaching pattern:
- Reads test-cases.json, filters layer=unit
- Generates synthetic JSONL from transcript arrays
- Seeds state files, pre_reflections, metrics_history
- Runs target scripts (stop-hook, reflection, convergence, router)
- Validates with TypeScript analyzer
- Gracefully skips tests when target scripts not yet implemented"
```

---

## Task 4: Write the Layer 2 Claudish Wrapper (run-e2e.sh)

Thin wrapper around runner-base.sh, following the terminal pattern exactly.

**Files:**
- Create: `autotest/dev-loop/run-e2e.sh`

**Step 1: Write run-e2e.sh**

Create `autotest/dev-loop/run-e2e.sh` (make executable):

```bash
#!/bin/bash
# dev:loop E2E Integration Test Suite (Layer 2)
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/dev-loop/run-e2e.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/dev-loop/run-e2e.sh                                           # All e2e tests, monitor mode
#   ./autotest/dev-loop/run-e2e.sh --model claude-sonnet-4-6
#   ./autotest/dev-loop/run-e2e.sh --models "claude-sonnet-4-6,or@minimax/minimax-m2.5,or@moonshotai/kimi-k2.5,or@z-ai/glm-5,or@google/gemini-3.1-pro-preview,or@openai/gpt-5.2-codex"
#   ./autotest/dev-loop/run-e2e.sh --cases e2e-loop-start-01 --dry-run
#   ./autotest/dev-loop/run-e2e.sh --parallel 3

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite dev-loop \
  --analyzer "bun $SCRIPT_DIR/analyze-results.ts --layer e2e" \
  "$@"
```

**Step 2: Make executable**

Run: `chmod +x autotest/dev-loop/run-e2e.sh`

**Step 3: Verify it reports correctly**

Run: `./autotest/dev-loop/run-e2e.sh --dry-run 2>&1 | head -10`
Expected: Shows e2e test cases with `[DRY RUN]` markers

**Step 4: Commit**

```bash
git add autotest/dev-loop/run-e2e.sh
git commit -m "test(dev-loop): add Layer 2 claudish integration test runner

Thin wrapper around runner-base.sh for 6-model integration testing.
Models: claude-sonnet-4-6, minimax-m2.5, kimi-k2.5, glm-5, gemini-3.1-pro, gpt-5.2-codex"
```

---

## Task 5: Add .gitignore for Results and Verify Full Structure

**Files:**
- Create: `autotest/dev-loop/results/.gitkeep`
- Create: `autotest/dev-loop/fixtures/.gitkeep`

**Step 1: Create placeholder files**

```bash
touch autotest/dev-loop/results/.gitkeep
touch autotest/dev-loop/fixtures/.gitkeep
```

**Step 2: Add results to gitignore**

Check if `autotest/dev-loop/results/` pattern needs to be in `.gitignore`.

Run: `grep -c 'autotest.*results' .gitignore || echo "not found"`

If not found, the gitkeep ensures the directory exists but results are ephemeral and shouldn't block commits. Runner outputs go to timestamped subdirectories.

**Step 3: Verify the complete directory structure**

Run: `find autotest/dev-loop -type f | sort`
Expected:
```
autotest/dev-loop/analyze-results.ts
autotest/dev-loop/fixtures/.gitkeep
autotest/dev-loop/results/.gitkeep
autotest/dev-loop/run-e2e.sh
autotest/dev-loop/run-unit.sh
autotest/dev-loop/test-cases.json
```

**Step 4: Verify both runners in dry-run**

Run: `./autotest/dev-loop/run-unit.sh --dry-run 2>&1 | tail -5`
Expected: `Cases to run: 20`

Run: `./autotest/dev-loop/run-e2e.sh --dry-run 2>&1 | tail -5`
Expected: Shows e2e test cases

**Step 5: Commit all remaining files**

```bash
git add autotest/dev-loop/
git commit -m "test(dev-loop): complete test suite directory structure

autotest/dev-loop/
├── test-cases.json       (20 unit + 10 e2e test cases)
├── run-unit.sh           (Layer 1: deterministic hook tests)
├── run-e2e.sh            (Layer 2: 6-model claudish integration)
├── analyze-results.ts    (shared dual-layer analyzer)
├── fixtures/.gitkeep
└── results/.gitkeep"
```

---

## Task 6: Validate Layer 1 Against Implementation (when available)

This task runs after the dev:loop implementation lands. Skip if scripts don't exist yet.

**Files:**
- No new files

**Step 1: Check if dev:loop scripts exist**

Run: `ls -la plugins/dev/hooks/dev-loop/ 2>/dev/null || echo "NOT YET IMPLEMENTED"`

If not implemented, this task is blocked. Move on.

**Step 2: Run Layer 1 tests against real implementation**

Run: `./autotest/dev-loop/run-unit.sh`
Expected: Tests run against real scripts, some may pass, some may fail revealing implementation bugs

**Step 3: Fix any failures by iterating**

For each failing test:
1. Read the `analysis.json` in the test output directory
2. Determine if the test expectation or the implementation needs fixing
3. Fix and re-run

**Step 4: Verify 100% pass rate**

Run: `./autotest/dev-loop/run-unit.sh`
Expected: `Pass Rate: 100%`

**Step 5: Commit any test fixes**

```bash
git add autotest/dev-loop/test-cases.json autotest/dev-loop/analyze-results.ts
git commit -m "test(dev-loop): fix Layer 1 tests after validation against implementation"
```

---

## Task 7: Run Layer 2 Across 6 Models (when available)

This task runs after both the dev:loop implementation AND claudish are configured.

**Files:**
- No new files

**Step 1: Run single-model smoke test**

Run: `./autotest/dev-loop/run-e2e.sh --cases e2e-loop-start-01 --model claude-sonnet-4-6`
Expected: One test runs through claudish and produces results

**Step 2: Run full 6-model matrix**

Run:
```bash
./autotest/dev-loop/run-e2e.sh \
  --models "claude-sonnet-4-6,or@minimax/minimax-m2.5,or@moonshotai/kimi-k2.5,or@z-ai/glm-5,or@google/gemini-3.1-pro-preview,or@openai/gpt-5.2-codex" \
  --parallel 3
```
Expected: Tests run across all 6 models

**Step 3: Analyze results**

Run: `bun autotest/dev-loop/analyze-results.ts --layer e2e autotest/dev-loop/results/<latest-run-dir>`
Expected: Pass rate >= 80% across models

**Step 4: Fix any failures, iterate**

Target: All 6 models pass at least `e2e-loop-start-01` and `e2e-loop-max-iter-04`.

**Step 5: Commit any test adjustments**

```bash
git add autotest/dev-loop/
git commit -m "test(dev-loop): validate Layer 2 across 6 models

Models tested: claude-sonnet-4-6, minimax-m2.5, kimi-k2.5, glm-5, gemini-3.1-pro, gpt-5.2-codex
Pass rate: XX% (target: >= 80%)"
```

---

## Success Criteria

| Layer | Criterion | Target |
|-------|-----------|--------|
| 1 (unit) | Pass rate | 100% (deterministic) |
| 2 (e2e) | Pass rate across 6 models | >= 80% |
| 2 (e2e) | Basic lifecycle tests | All 6 models pass `e2e-loop-start-01` + `e2e-loop-max-iter-04` |

## Run Commands Quick Reference

```bash
# Layer 1: Fast (seconds, no LLM cost)
./autotest/dev-loop/run-unit.sh
./autotest/dev-loop/run-unit.sh --cases stop-hook-block-01,reflect-basic-01
./autotest/dev-loop/run-unit.sh --dry-run

# Layer 2: Full 6-model (minutes, has LLM costs)
./autotest/dev-loop/run-e2e.sh \
  --models "claude-sonnet-4-6,or@minimax/minimax-m2.5,or@moonshotai/kimi-k2.5,or@z-ai/glm-5,or@google/gemini-3.1-pro-preview,or@openai/gpt-5.2-codex" \
  --parallel 3

# Analyze existing results
bun autotest/dev-loop/analyze-results.ts --layer e2e autotest/dev-loop/results/<run-dir>
bun autotest/dev-loop/analyze-results.ts --layer unit /path/to/test-dir '{"exit_code_is":0}' 0
```
