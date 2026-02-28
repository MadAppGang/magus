# Design: dev:loop E2E Test Suite

**Date**: 2026-02-28
**Status**: Approved
**Author**: Claude Opus 4.6 + Jack Rudenko

## Overview

Two-layer test suite for the `dev:loop` autonomous agent loop command:
- **Layer 1**: Deterministic unit tests for hook scripts, reflection generator, and convergence detection
- **Layer 2**: Claudish-based integration tests across 6 models for full loop behavior validation

## Architecture

```
autotest/dev-loop/
├── test-cases.json              # ALL test cases (both layers, tagged)
├── run-unit.sh                  # Layer 1: deterministic script tests
├── run-e2e.sh                   # Layer 2: claudish 6-model integration
├── analyze-results.ts           # Suite-specific analyzer (both layers)
└── fixtures/                    # Synthetic transcripts for unit tests
    ├── simple-implement.jsonl   # Basic coding session
    ├── test-failures.jsonl      # Session with repeated test failures
    ├── thrashing.jsonl          # Session with identical errors 3x
    └── converged.jsonl          # Session where tests pass
```

## Layer 1: Deterministic Unit Tests (20 cases)

Runs hook scripts directly with synthetic JSONL transcripts. No LLM involved.
Similar to `autotest/coaching/` pattern.

### Category 1: Stop Hook Logic (6 tests)

| ID | Description | Input | Expected |
|----|-------------|-------|----------|
| `stop-hook-block-01` | Blocks exit when loop active | State file exists, no promise match | `{"decision": "block"}` output |
| `stop-hook-allow-exit-02` | Allows exit when no loop | No state file | exit 0, no output |
| `stop-hook-promise-match-03` | Promise tag match exits loop | `<promise>DONE</promise>` in transcript | State file deleted, exit 0 |
| `stop-hook-max-iter-04` | Max iterations reached exits | iteration >= max_iterations | State file deleted, exit 0 |
| `stop-hook-increment-05` | Iteration counter increments | iteration=3 in state file | iteration=4 after hook runs |
| `stop-hook-corrupt-state-06` | Corrupted state handled | Invalid YAML in state file | Error message, state deleted, exit 0 |

### Category 2: Reflection Generator (6 tests)

| ID | Description | Input | Expected |
|----|-------------|-------|----------|
| `reflect-basic-01` | Generates reflection | 10+ tool call transcript | JSON with approach/successes/failures |
| `reflect-test-failure-02` | Captures test failure | Transcript with failing test run | `failures` array includes error message |
| `reflect-history-03` | Reads ALL previous reflections | 3 prior iteration-N.json files | Summary references all 3 iterations |
| `reflect-thrash-detect-04` | Detects thrashing | Same error hash in last 3 iterations | `thrashing: true` flag in output |
| `reflect-low-signal-05` | Skips low-signal sessions | < 10 tool calls in transcript | No reflection file written, exit 0 |
| `reflect-json-format-06` | Valid JSON schema | Any valid transcript | Output validates against Reflection interface |

### Category 3: Convergence Detection (5 tests)

| ID | Description | Input | Expected |
|----|-------------|-------|----------|
| `converge-success-01` | Detects converged success | test_pass=0.95, lint=0.90, build=true | `converged_success` status |
| `converge-plateau-02` | Detects stuck plateau | 3 iterations, delta < 0.01 each | `stuck_plateau` status |
| `converge-thrashing-03` | Detects oscillation | Alternating pass/fail, same error hash | `thrashing` status |
| `converge-exploring-04` | Distinguishes exploring | Alternating results, DIFFERENT errors | `exploring` status |
| `converge-budget-05` | Budget exhausted | iteration >= max_iterations | `budget_exhausted` status |

### Category 4: Agent Routing (3 tests)

| ID | Description | Input | Expected |
|----|-------------|-------|----------|
| `route-initial-01` | Initial phase routing | phase=initial, no prior outcome | `dev:developer` |
| `route-test-fail-02` | Test fail routing | phase=implementing, outcome=test_fail | `dev:debugger` |
| `route-plateau-03` | Plateau routing | convergence_status=stuck_plateau | `dev:architect` |

### Unit Test Runner (run-unit.sh)

Pattern: coaching-style custom runner
1. Read test-cases.json, filter `"layer": "unit"` cases
2. For each test case:
   - Create temp `.claude/` directory with pre-seeded state
   - Generate synthetic JSONL from `transcript` array in test case
   - Run target script (stop hook, reflection generator, or convergence detector)
   - Capture output files and exit code
3. Call `analyze-results.ts` with `--layer unit` flag
4. Report pass/fail per case

## Layer 2: Claudish Integration Tests (10 cases)

Sends real prompts through claudish to 6 models. Validates full loop behavior.

### Models

| Model | ID | Provider |
|-------|-----|----------|
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Anthropic (internal) |
| MiniMax M2.5 | `or@minimax/minimax-m2.5` | OpenRouter |
| Kimi K2.5 | `or@moonshotai/kimi-k2.5` | OpenRouter |
| GLM-5 | `or@z-ai/glm-5` | OpenRouter |
| Gemini 3.1 Pro | `or@google/gemini-3.1-pro-preview` | OpenRouter |
| GPT-5.2 Codex | `or@openai/gpt-5.2-codex` | OpenRouter |

### Category 1: Loop Lifecycle (4 tests)

| ID | Description | Prompt | Checks |
|----|-------------|--------|--------|
| `e2e-loop-start-01` | Loop initializes | `/dev:loop "Create hello.py" --max-iterations 3` | state_file_created, iteration_count_lte: 3 |
| `e2e-loop-iterate-02` | Loop completes with promise | `/dev:loop "Create greet.py with greet(name)" --max-iterations 5 --completion-promise "DONE"` | loop_exited_with_promise, file_exists: "greet.py" |
| `e2e-loop-cancel-03` | Cancel works | Start then `/dev:loop cancel` | state_file_deleted |
| `e2e-loop-max-iter-04` | Stops at max iterations | `/dev:loop "Impossible task" --max-iterations 2` | iteration_count_lte: 2 |

### Category 2: Reflection & Discovery (3 tests)

| ID | Description | Prompt | Checks |
|----|-------------|--------|--------|
| `e2e-reflect-written-05` | Reflection files written | `/dev:loop "Fix bug in test.py" --max-iterations 3` | reflection_files_exist, reflection_valid_json |
| `e2e-agent-selection-06` | Correct agent routing | `/dev:loop "Research caching patterns" --max-iterations 2` | transcript_has_task_call |
| `e2e-discovery-07` | Skill discovery runs | `/dev:loop "Implement feature" --max-iterations 2` | transcript shows discovery in iteration 1 |

### Category 3: Convergence & Quality (3 tests)

| ID | Description | Prompt | Checks |
|----|-------------|--------|--------|
| `e2e-converge-exit-08` | Exits on quality pass | `/dev:loop "Create hello.py passing test" --max-iterations 10 --completion-promise "ALL TESTS PASS"` | loop exits before max |
| `e2e-metrics-tracked-09` | Metrics file exists | `/dev:loop "Build calculator" --max-iterations 3` | metrics_file_exists |
| `e2e-checkpoint-10` | Multi-model checkpoint | `/dev:loop "Build API" --max-iterations 8 --checkpoint-every 3` | /team invocation in transcript |

### Integration Test Checks Interface

```typescript
interface DevLoopChecks {
  // State file
  state_file_created?: boolean;
  state_file_deleted?: boolean;
  iteration_count_lte?: number;
  iteration_count_gte?: number;

  // Reflection
  reflection_files_exist?: boolean;
  reflection_valid_json?: boolean;
  reflection_has_fields?: string[];

  // Agent selection
  transcript_has_task_call?: boolean;
  task_subagent_type_any?: string[];

  // Convergence
  metrics_file_exists?: boolean;
  loop_exited_with_promise?: boolean;

  // Output
  response_contains?: string;
  file_exists?: string;
}
```

### Integration Test Runner (run-e2e.sh)

Pattern: claudish-based via `runner-base.sh`
```bash
exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite dev-loop \
  --analyzer "bun $SCRIPT_DIR/analyze-results.ts --layer e2e" \
  "$@"
```

## Run Commands

```bash
# Layer 1: Fast (seconds, no LLM cost)
./autotest/dev-loop/run-unit.sh

# Layer 2: Full 6-model (minutes, has LLM costs)
./autotest/dev-loop/run-e2e.sh \
  --models "claude-sonnet-4-6,or@minimax/minimax-m2.5,or@moonshotai/kimi-k2.5,or@z-ai/glm-5,or@google/gemini-3.1-pro-preview,or@openai/gpt-5.2-codex" \
  --parallel 3

# Run specific cases
./autotest/dev-loop/run-unit.sh --cases stop-hook-block-01,reflect-basic-01
./autotest/dev-loop/run-e2e.sh --cases e2e-loop-iterate-02 --models claude-sonnet-4-6

# Analyze existing results
bun autotest/dev-loop/analyze-results.ts autotest/dev-loop/results/<run-dir>
```

## Dependencies

- Bun runtime (for TypeScript analyzers)
- claudish v5.2.0+ (for Layer 2)
- jq (for JSON parsing in shell scripts)
- The dev:loop implementation itself (Stop hook, reflection generator, convergence detector)

## Success Criteria

- Layer 1: 100% pass rate (deterministic — must always pass)
- Layer 2: >= 80% pass rate across all 6 models (LLM behavior has variance)
- All 6 models must pass at least the basic lifecycle tests (e2e-loop-start-01, e2e-loop-max-iter-04)

## Implementation Order

1. Create directory structure and test-cases.json
2. Write synthetic JSONL fixtures
3. Implement run-unit.sh (coaching-style custom runner)
4. Write analyze-results.ts (shared analyzer with --layer flag)
5. Validate Layer 1 passes against dev:loop implementation
6. Implement run-e2e.sh (thin wrapper to runner-base.sh)
7. Run Layer 2 across 6 models
8. Fix any failures, iterate
