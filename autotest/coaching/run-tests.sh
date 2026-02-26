#!/bin/bash
# Coaching Pipeline E2E Test Runner
#
# Tests the full Stop hook -> SessionStart hook pipeline using synthetic JSONL transcripts.
# This is NOT a claudish-based suite: it tests deterministic hook scripts, not LLM behavior.
#
# Usage:
#   ./autotest/coaching/run-tests.sh [OPTIONS]
#
# Options:
#   --cases <ids>       Comma-separated test case IDs (default: all)
#   --output-dir <dir>  Custom output directory
#   --timeout <secs>    Per-test timeout (default: 30)
#   --dry-run           Show what would run
#   --help              Show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_CASES_FILE="$SCRIPT_DIR/test-cases.json"
ANALYZER_TS="$SCRIPT_DIR/analyze-coaching.ts"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_DIR="$SCRIPT_DIR/results/run-$TIMESTAMP"
TIMEOUT=30
DRY_RUN=false
SELECTED_CASES=""

# Plugin paths
COACHING_ANALYZER="$REPO_ROOT/plugins/dev/hooks/coaching/analyzer.ts"
COACHING_RULES="$REPO_ROOT/plugins/dev/hooks/coaching/rules.json"
SESSIONSTART_HOOK="$REPO_ROOT/plugins/dev/hooks/session-start-coaching.sh"

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
if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: brew install jq"
  exit 1
fi

if ! command -v bun &>/dev/null; then
  echo "ERROR: 'bun' not found. Install from: https://bun.sh"
  exit 1
fi

if [[ ! -f "$TEST_CASES_FILE" ]]; then
  echo "ERROR: Test cases file not found: $TEST_CASES_FILE"
  exit 1
fi

if [[ ! -f "$COACHING_ANALYZER" ]]; then
  echo "ERROR: Coaching analyzer not found: $COACHING_ANALYZER"
  exit 1
fi

if [[ ! -f "$COACHING_RULES" ]]; then
  echo "ERROR: Coaching rules not found: $COACHING_RULES"
  exit 1
fi

if [[ ! -f "$SESSIONSTART_HOOK" ]]; then
  echo "ERROR: SessionStart hook not found: $SESSIONSTART_HOOK"
  exit 1
fi

# Determine timeout command (macOS vs Linux)
if command -v gtimeout &>/dev/null; then
  TIMEOUT_CMD="gtimeout"
elif command -v timeout &>/dev/null; then
  TIMEOUT_CMD="timeout"
else
  TIMEOUT_CMD=""
  echo "WARNING: No 'timeout' command found. Tests will run without timeout enforcement."
  echo "  Install with: brew install coreutils (provides gtimeout)"
fi

# Load test cases
TOTAL_CASES=$(jq '.test_cases | length' "$TEST_CASES_FILE")
echo "=== Coaching Pipeline E2E Test Runner ==="
echo "Test cases file: $TEST_CASES_FILE"
echo "Total test cases: $TOTAL_CASES"
echo "Timeout per test: ${TIMEOUT}s"
echo "Output directory: $OUTPUT_DIR"
echo ""

# Create output directory
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
  done < <(jq -r '.test_cases[].id' "$TEST_CASES_FILE")
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

run_single_test() {
  local case_id="$1"
  local case_dir="$OUTPUT_DIR/$case_id"
  mkdir -p "$case_dir"

  # Extract test case fields
  local description
  description=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .description' "$TEST_CASES_FILE")
  local checks
  checks=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .checks' "$TEST_CASES_FILE")
  local filler_count
  filler_count=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .filler_count // 10' "$TEST_CASES_FILE")
  local transcript_json
  transcript_json=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .transcript' "$TEST_CASES_FILE")
  local raw_lines
  raw_lines=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .raw_transcript_lines // empty' "$TEST_CASES_FILE" 2>/dev/null || true)
  local pre_state
  pre_state=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .pre_state // empty' "$TEST_CASES_FILE" 2>/dev/null || true)
  local pre_recommendations
  pre_recommendations=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .pre_recommendations // empty' "$TEST_CASES_FILE" 2>/dev/null || true)
  local env_vars
  env_vars=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .env // {}' "$TEST_CASES_FILE" 2>/dev/null || echo '{}')
  local has_sessionstart
  has_sessionstart=$(echo "$checks" | jq -r 'to_entries | map(select(.key | startswith("sessionstart"))) | length > 0')

  if [[ -z "$description" || "$description" == "null" ]]; then
    echo "  ERROR: Test case '$case_id' not found"
    ERROR=$((ERROR + 1))
    TOTAL=$((TOTAL + 1))
    return
  fi

  echo "  [$case_id]"
  echo "    $description"

  if $DRY_RUN; then
    echo "    [DRY RUN] Would generate transcript and run analyzer"
    echo ""
    return
  fi

  # Create isolated temp directory for test artifacts
  local test_dir
  test_dir=$(mktemp -d)

  # Setup state and history dirs
  local state_file="$test_dir/state.json"
  local recs_file="$test_dir/recommendations.md"
  local history_dir="$test_dir/history"
  local transcript_file="$test_dir/transcript.jsonl"

  # Seed pre_state if specified
  if [[ -n "$pre_state" && "$pre_state" != "null" && "$pre_state" != "" ]]; then
    echo "$pre_state" > "$state_file"
  fi

  # Seed pre_recommendations if specified
  if [[ -n "$pre_recommendations" && "$pre_recommendations" != "null" && "$pre_recommendations" != "" ]]; then
    printf '%s' "$pre_recommendations" > "$recs_file"
  fi

  # Generate JSONL transcript
  if [[ -n "$raw_lines" && "$raw_lines" != "null" && "$raw_lines" != "" ]]; then
    # Raw mode: write lines directly (for malformed JSONL testing)
    local line_count
    line_count=$(echo "$raw_lines" | jq 'length')
    local k
    for (( k=0; k<line_count; k++ )); do
      echo "$raw_lines" | jq -r ".[$k]" >> "$transcript_file"
    done
  else
    # Normal mode: generate filler + test tool calls
    # 1) Write filler lines first (Write tool avoids triggering search rules)
    local i
    for (( i=0; i<filler_count; i++ )); do
      make_tool_line "Write" "{\"file_path\":\"/project/filler${i}.ts\",\"content\":\"// filler\"}" >> "$transcript_file"
    done

    # 2) Add the test-specific tool calls
    local tc_count
    tc_count=$(echo "$transcript_json" | jq 'length')
    local j
    for (( j=0; j<tc_count; j++ )); do
      local tc_tool tc_input
      tc_tool=$(echo "$transcript_json" | jq -r ".[${j}].tool")
      tc_input=$(echo "$transcript_json" | jq -c ".[${j}].input")
      make_tool_line "$tc_tool" "$tc_input" >> "$transcript_file"
    done
  fi

  # Build env prefix for analyzer
  local env_prefix=""
  local env_key
  while IFS= read -r env_key; do
    local env_val
    env_val=$(echo "$env_vars" | jq -r --arg k "$env_key" '.[$k]')
    env_prefix="$env_prefix $env_key=$(printf '%q' "$env_val")"
  done < <(echo "$env_vars" | jq -r 'keys[]')

  # Run the real analyzer
  local exit_code=0
  set +e
  if [[ -n "$env_prefix" ]]; then
    if [[ -n "$TIMEOUT_CMD" ]]; then
      eval "env $env_prefix $TIMEOUT_CMD ${TIMEOUT}s bun \"$COACHING_ANALYZER\" \
        --transcript \"$transcript_file\" \
        --session-id \"aabbccdd11223344\" \
        --rules \"$COACHING_RULES\" \
        --state \"$state_file\" \
        --output \"$recs_file\" \
        --history-dir \"$history_dir\"" \
        > "$test_dir/analyzer-stdout.txt" \
        2> "$test_dir/analyzer-stderr.txt"
    else
      eval "env $env_prefix bun \"$COACHING_ANALYZER\" \
        --transcript \"$transcript_file\" \
        --session-id \"aabbccdd11223344\" \
        --rules \"$COACHING_RULES\" \
        --state \"$state_file\" \
        --output \"$recs_file\" \
        --history-dir \"$history_dir\"" \
        > "$test_dir/analyzer-stdout.txt" \
        2> "$test_dir/analyzer-stderr.txt"
    fi
  else
    if [[ -n "$TIMEOUT_CMD" ]]; then
      $TIMEOUT_CMD ${TIMEOUT}s bun "$COACHING_ANALYZER" \
        --transcript "$transcript_file" \
        --session-id "aabbccdd11223344" \
        --rules "$COACHING_RULES" \
        --state "$state_file" \
        --output "$recs_file" \
        --history-dir "$history_dir" \
        > "$test_dir/analyzer-stdout.txt" \
        2> "$test_dir/analyzer-stderr.txt"
    else
      bun "$COACHING_ANALYZER" \
        --transcript "$transcript_file" \
        --session-id "aabbccdd11223344" \
        --rules "$COACHING_RULES" \
        --state "$state_file" \
        --output "$recs_file" \
        --history-dir "$history_dir" \
        > "$test_dir/analyzer-stdout.txt" \
        2> "$test_dir/analyzer-stderr.txt"
    fi
  fi
  exit_code=$?
  set -e

  # Run SessionStart hook if the test checks sessionstart_ outputs
  if [[ "$has_sessionstart" == "true" ]]; then
    # The SessionStart hook reads from ${CWD}/.claude/.coaching/recommendations.md
    local coaching_dir="$test_dir/.claude/.coaching"
    mkdir -p "$coaching_dir"
    if [[ -f "$recs_file" ]]; then
      cp "$recs_file" "$coaching_dir/recommendations.md"
    fi

    set +e
    if [[ -n "$env_prefix" ]]; then
      if [[ -n "$TIMEOUT_CMD" ]]; then
        eval "printf '{\"cwd\":\"%s\"}' \"$test_dir\" | env $env_prefix $TIMEOUT_CMD ${TIMEOUT}s bash \"$SESSIONSTART_HOOK\" \
          > \"$test_dir/sessionstart-output.json\" \
          2> \"$test_dir/sessionstart-stderr.txt\""
      else
        eval "printf '{\"cwd\":\"%s\"}' \"$test_dir\" | env $env_prefix bash \"$SESSIONSTART_HOOK\" \
          > \"$test_dir/sessionstart-output.json\" \
          2> \"$test_dir/sessionstart-stderr.txt\""
      fi
    else
      if [[ -n "$TIMEOUT_CMD" ]]; then
        printf '{"cwd":"%s"}' "$test_dir" | $TIMEOUT_CMD ${TIMEOUT}s bash "$SESSIONSTART_HOOK" \
          > "$test_dir/sessionstart-output.json" \
          2> "$test_dir/sessionstart-stderr.txt"
      else
        printf '{"cwd":"%s"}' "$test_dir" | bash "$SESSIONSTART_HOOK" \
          > "$test_dir/sessionstart-output.json" \
          2> "$test_dir/sessionstart-stderr.txt"
      fi
    fi
    set -e
  fi

  # Copy artifacts to output dir for debugging
  cp -r "$test_dir/." "$case_dir/" 2>/dev/null || true

  # Run the TypeScript analyzer to check results
  local analysis_result
  local analysis_exit=0
  set +e
  analysis_result=$(bun "$ANALYZER_TS" "$test_dir" "$checks" "$exit_code" 2>"$case_dir/analyzer-ts-stderr.txt")
  analysis_exit=$?
  set -e

  echo "$analysis_result" > "$case_dir/analysis.json" 2>/dev/null || true

  # Determine pass/fail
  local result="ERROR"
  local passed_checks=0
  local total_checks=0
  local failed_details=""

  if [[ -n "$analysis_result" ]]; then
    local all_passed
    all_passed=$(echo "$analysis_result" | jq -r '.passed' 2>/dev/null || echo "false")
    passed_checks=$(echo "$analysis_result" | jq -r '.summary.passed_checks' 2>/dev/null || echo "0")
    total_checks=$(echo "$analysis_result" | jq -r '.summary.total_checks' 2>/dev/null || echo "0")
    failed_details=$(echo "$analysis_result" | jq -r '.checks[] | select(.passed == false) | "    FAIL: " + .check + ": " + .detail' 2>/dev/null || echo "")

    if [[ "$all_passed" == "true" ]]; then
      result="PASS"
      PASS=$((PASS + 1))
    else
      result="FAIL"
      FAIL=$((FAIL + 1))
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

  echo "    Result: $result ($passed_checks/$total_checks checks) | analyzer exit: $exit_code"
  if [[ -n "$failed_details" ]]; then
    echo "$failed_details"
  fi
  echo ""

  # Clean up temp directory
  rm -rf "$test_dir"
}

# Main execution loop
echo "=== Starting Tests ==="
echo ""

for case_id in "${CASE_IDS[@]}"; do
  run_single_test "$case_id"
done

# Generate summary
echo ""
echo "=== Test Results Summary ==="
echo "Total: $TOTAL | Pass: $PASS | Fail: $FAIL | Error: $ERROR"
if [[ $TOTAL -gt 0 ]]; then
  echo "Pass Rate: $(( PASS * 100 / TOTAL ))%"
else
  echo "Pass Rate: N/A (no tests executed)"
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
printf "%-40s %-8s %-12s %-8s\n" "TEST_ID" "RESULT" "CHECKS" "EXIT"
printf "%-40s %-8s %-12s %-8s\n" "-------" "------" "------" "----"

for case_id in "${CASE_IDS[@]}"; do
  meta_file="$OUTPUT_DIR/$case_id/meta.json"
  if [[ -f "$meta_file" ]]; then
    result=$(jq -r '.result' "$meta_file")
    passed=$(jq -r '.passed_checks' "$meta_file")
    total=$(jq -r '.total_checks' "$meta_file")
    exit_code=$(jq -r '.exit_code' "$meta_file")
    printf "%-40s %-8s %-12s %-8s\n" "$case_id" "$result" "${passed}/${total}" "$exit_code"
  fi
done

echo ""
echo "Full results: $OUTPUT_DIR/results-summary.json"

# Exit with failure if any tests failed
if [[ $FAIL -gt 0 || $ERROR -gt 0 ]]; then
  exit 1
fi
exit 0
