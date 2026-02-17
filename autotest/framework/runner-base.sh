#!/bin/bash
# runner-base.sh - Shared test execution engine for all E2E suites
#
# Replaces the duplicated runners in each suite directory with a single
# shared engine. Executes tests via claudish (not raw claude -p), captures
# dual output (JSONL transcript + debug log), and generates metrics.
#
# Usage:
#   ./autotest/framework/runner-base.sh --suite <name> [OPTIONS]
#
# Options:
#   --suite <name>         Suite to run (subagents|team|skills|worktree)
#   --suite-dir <path>     Path to suite directory (auto-detected from --suite)
#   --analyzer <cmd>       Suite-specific analyzer command (receives transcript path + test-cases.json)
#   --model <model>        Single model to test (default: monitor)
#   --models <list>        Comma-separated list of models for matrix testing
#   --cases <ids>          Comma-separated test case IDs (default: all)
#   --runs <N>             Number of runs per test case (default: 1)
#   --output-dir <dir>     Custom output directory (default: auto-generated)
#   --parallel <N>         Max parallel test executions (default: 1)
#   --timeout <seconds>    Per-test timeout (default: 300)
#   --dry-run              Show what would run without executing
#   --help                 Show this help message
#
# Examples:
#   # Run subagents suite with native Anthropic API (monitor mode)
#   ./autotest/framework/runner-base.sh --suite subagents
#
#   # Run with an external model
#   ./autotest/framework/runner-base.sh --suite skills --model google/gemini-2.5-flash
#
#   # Multi-model matrix
#   ./autotest/framework/runner-base.sh --suite subagents \
#     --models "monitor,google/gemini-2.5-flash,x-ai/grok-code-fast-1"
#
#   # Run specific cases in parallel
#   ./autotest/framework/runner-base.sh --suite team --cases "tc-01,tc-02" --parallel 3

set -euo pipefail

# Prevent CLAUDECODE nesting issues
unset CLAUDECODE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRAMEWORK_VERSION="1.0.0"

# Defaults
SUITE=""
SUITE_DIR=""
ANALYZER_CMD=""
MODELS=("monitor")
SELECTED_CASES=""
RUNS_PER_CASE=1
OUTPUT_DIR=""
PARALLEL=1
TIMEOUT=300
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --suite) SUITE="$2"; shift 2 ;;
    --suite-dir) SUITE_DIR="$2"; shift 2 ;;
    --analyzer) ANALYZER_CMD="$2"; shift 2 ;;
    --model) MODELS=("$2"); shift 2 ;;
    --models)
      IFS=',' read -ra MODELS <<< "$2"
      shift 2
      ;;
    --cases) SELECTED_CASES="$2"; shift 2 ;;
    --runs) RUNS_PER_CASE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --parallel) PARALLEL="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help)
      head -37 "$0" | tail -36
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

# --- Suite resolution ---

if [[ -z "$SUITE" && -z "$SUITE_DIR" ]]; then
  echo "ERROR: --suite or --suite-dir required" >&2
  exit 1
fi

# Auto-detect suite directory from --suite name
if [[ -n "$SUITE" && -z "$SUITE_DIR" ]]; then
  SUITE_DIR="$REPO_ROOT/autotest/$SUITE"
fi

# Infer suite name from directory if only --suite-dir was given
if [[ -z "$SUITE" && -n "$SUITE_DIR" ]]; then
  SUITE="$(basename "$SUITE_DIR")"
fi

# Validate suite directory
if [[ ! -d "$SUITE_DIR" ]]; then
  echo "ERROR: Suite directory not found: $SUITE_DIR" >&2
  exit 1
fi

TEST_CASES_FILE="$SUITE_DIR/test-cases.json"
if [[ ! -f "$TEST_CASES_FILE" ]]; then
  echo "ERROR: test-cases.json not found in $SUITE_DIR" >&2
  exit 1
fi

# --- Dependency checks ---

if ! command -v claudish &>/dev/null; then
  echo "ERROR: 'claudish' CLI not found. Install with: npm install -g claudish" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: brew install jq" >&2
  exit 1
fi

if ! command -v bun &>/dev/null; then
  echo "ERROR: 'bun' not found. Install with: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

# --- Output directory ---

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$SUITE_DIR/results/run-$TIMESTAMP"
fi

mkdir -p "$OUTPUT_DIR"

# Copy test-cases.json for reference
cp "$TEST_CASES_FILE" "$OUTPUT_DIR/test-cases.json"

# --- Load test cases ---

TOTAL_CASES=$(jq '.test_cases | length' "$TEST_CASES_FILE")

# Filter test cases if --cases specified
CASE_IDS=()
if [[ -n "$SELECTED_CASES" ]]; then
  IFS=',' read -ra CASE_IDS <<< "$SELECTED_CASES"
else
  while IFS= read -r id; do
    CASE_IDS+=("$id")
  done < <(jq -r '.test_cases[].id' "$TEST_CASES_FILE")
fi

# --- Sanitize model ID for filesystem paths ---
# Model IDs like "google/gemini-2.5-flash" contain / which is illegal in dir names
model_to_slug() {
  local model="$1"
  echo "$model" | tr '/@:' '_'
}

# --- Write run config ---

MODELS_JSON=$(printf '%s\n' "${MODELS[@]}" | jq -R . | jq -s .)
CASES_JSON=$(printf '%s\n' "${CASE_IDS[@]}" | jq -R . | jq -s .)

# Get claudish version
CLAUDISH_VERSION=$(claudish --version 2>/dev/null || echo "unknown")

jq -n \
  --arg run_id "run-$TIMESTAMP" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg suite "$SUITE" \
  --argjson models "$MODELS_JSON" \
  --argjson cases "$CASES_JSON" \
  --arg parallel "$PARALLEL" \
  --arg fw_version "$FRAMEWORK_VERSION" \
  --arg claudish_version "$CLAUDISH_VERSION" \
  '{
    run_id: $run_id,
    timestamp: $timestamp,
    suite: $suite,
    models: $models,
    test_cases: $cases,
    parallel: ($parallel | tonumber),
    framework_version: $fw_version,
    claudish_version: $claudish_version
  }' > "$OUTPUT_DIR/config.json"

# --- Print banner ---

TOTAL_RUNS=$(( ${#CASE_IDS[@]} * ${#MODELS[@]} * RUNS_PER_CASE ))

echo "=== E2E Test Runner ==="
echo "Suite:        $SUITE"
echo "Suite dir:    $SUITE_DIR"
echo "Models:       ${MODELS[*]}"
echo "Test cases:   ${#CASE_IDS[@]} / $TOTAL_CASES"
echo "Runs/case:    $RUNS_PER_CASE"
echo "Total runs:   $TOTAL_RUNS"
echo "Parallel:     $PARALLEL"
echo "Timeout:      ${TIMEOUT}s"
echo "Output:       $OUTPUT_DIR"
echo "Framework:    v$FRAMEWORK_VERSION"
if [[ -n "$ANALYZER_CMD" ]]; then
  echo "Analyzer:     $ANALYZER_CMD"
fi
echo ""

if $DRY_RUN; then
  echo "[DRY RUN] Would execute $TOTAL_RUNS test runs:"
  echo ""
  for model in "${MODELS[@]}"; do
    for case_id in "${CASE_IDS[@]}"; do
      for ((run=1; run<=RUNS_PER_CASE; run++)); do
        slug=$(model_to_slug "$model")
        echo "  $case_id × $model (run $run) → $OUTPUT_DIR/$slug/$case_id/"
      done
    done
  done
  echo ""
  echo "[DRY RUN] No tests executed."
  exit 0
fi

# --- Execute tests ---

echo "=== Starting Tests ==="
echo ""

PIDS=()
RUN_COUNT=0
ACTIVE=0

# Track all test output directories for post-processing
ALL_TEST_DIRS=()

for model in "${MODELS[@]}"; do
  model_slug=$(model_to_slug "$model")

  for case_id in "${CASE_IDS[@]}"; do
    # Extract prompt from test-cases.json
    prompt=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .prompt' "$TEST_CASES_FILE")

    if [[ -z "$prompt" || "$prompt" == "null" ]]; then
      echo "  SKIP [$case_id] Test case not found in test-cases.json"
      continue
    fi

    for ((run=1; run<=RUNS_PER_CASE; run++)); do
      test_output_dir="$OUTPUT_DIR/$model_slug/$case_id"
      if [[ $RUNS_PER_CASE -gt 1 ]]; then
        test_output_dir="$test_output_dir/run-$run"
      fi
      mkdir -p "$test_output_dir"

      ALL_TEST_DIRS+=("$test_output_dir")

      echo "  RUN  [$case_id] model=$model run=$run"

      if [[ $PARALLEL -le 1 ]]; then
        # Sequential execution
        "$SCRIPT_DIR/execute-test.sh" \
          --test-id "$case_id" \
          --model "$model" \
          --prompt "$prompt" \
          --output-dir "$test_output_dir" \
          --timeout "$TIMEOUT" \
          || true

        # Generate metrics from debug log immediately
        if [[ -f "$test_output_dir/debug.log" ]]; then
          bun run "$SCRIPT_DIR/parsers/debug-log-parser.ts" \
            "$test_output_dir/debug.log" \
            --output "$test_output_dir/metrics.json" \
            2>/dev/null || true
        fi
      else
        # Parallel execution: wait if we've hit the limit
        while [[ $ACTIVE -ge $PARALLEL ]]; do
          # Wait for any child to finish
          wait -n 2>/dev/null || true
          ACTIVE=$((ACTIVE - 1))
        done

        # Launch in background
        (
          "$SCRIPT_DIR/execute-test.sh" \
            --test-id "$case_id" \
            --model "$model" \
            --prompt "$prompt" \
            --output-dir "$test_output_dir" \
            --timeout "$TIMEOUT" \
            || true

          # Generate metrics from debug log
          if [[ -f "$test_output_dir/debug.log" ]]; then
            bun run "$SCRIPT_DIR/parsers/debug-log-parser.ts" \
              "$test_output_dir/debug.log" \
              --output "$test_output_dir/metrics.json" \
              2>/dev/null || true
          fi
        ) &
        PIDS+=($!)
        ACTIVE=$((ACTIVE + 1))
      fi

      RUN_COUNT=$((RUN_COUNT + 1))
    done
  done
done

# Wait for all parallel jobs to finish
if [[ ${#PIDS[@]} -gt 0 ]]; then
  echo ""
  echo "  Waiting for ${#PIDS[@]} parallel jobs to complete..."
  for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
fi

echo ""
echo "=== All $RUN_COUNT tests completed ==="
echo ""

# --- Aggregate results ---

# Build results-summary.json from all meta.json files
# This format is backward-compatible with the existing analyze-results.sh
MODELS_STR=$(IFS=','; echo "${MODELS[*]}")

bun run "$SCRIPT_DIR/parsers/aggregate-results.ts" \
  "$OUTPUT_DIR" \
  --suite "$SUITE" \
  --models "$MODELS_STR"

echo "Results:      $OUTPUT_DIR/results-summary.json"

# --- Run suite-specific analyzer (if provided) ---

if [[ -n "$ANALYZER_CMD" ]]; then
  echo ""
  echo "=== Running Suite Analyzer ==="
  echo "Command: $ANALYZER_CMD $OUTPUT_DIR"
  echo ""
  $ANALYZER_CMD "$OUTPUT_DIR" || echo "WARNING: Suite analyzer returned non-zero exit code"
fi

echo ""
echo "=== Run Complete ==="
echo "Output:       $OUTPUT_DIR"
echo "Summary:      $OUTPUT_DIR/results-summary.json"
echo "Config:       $OUTPUT_DIR/config.json"
echo ""
echo "To analyze:   $REPO_ROOT/autotest/subagents/analyze-results.sh $OUTPUT_DIR"
echo "To replay:    bun run $SCRIPT_DIR/replay.ts $OUTPUT_DIR/<model>/<case>/ --interactive"
echo "To metrics:   bun run $SCRIPT_DIR/parsers/debug-log-parser.ts $OUTPUT_DIR/<model>/<case>/debug.log --format table"
