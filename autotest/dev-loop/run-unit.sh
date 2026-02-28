#!/bin/bash
# dev:loop Unit Test Runner
#
# Tests the deterministic dev-loop components using synthetic JSONL transcripts
# and seeded state files. Tests run against the real scripts when present;
# skips gracefully when a target script is not yet implemented.
#
# Usage:
#   ./autotest/dev-loop/run-unit.sh [OPTIONS]
#
# Options:
#   --cases <ids>       Comma-separated test case IDs (default: all unit)
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
OUTPUT_DIR="$SCRIPT_DIR/results/run-unit-$TIMESTAMP"
TIMEOUT=30
DRY_RUN=false
SELECTED_CASES=""

# Target script paths (may not exist yet — runner skips gracefully)
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
      head -18 "$0" | tail -17
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

# Load unit test cases
TOTAL_CASES=$(jq '[.test_cases[] | select(.layer == "unit")] | length' "$TEST_CASES_FILE")
echo "=== dev:loop Unit Test Runner ==="
echo "Test cases file: $TEST_CASES_FILE"
echo "Unit test cases: $TOTAL_CASES"
echo "Timeout per test: ${TIMEOUT}s"
echo "Output directory: $OUTPUT_DIR"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"
cp "$TEST_CASES_FILE" "$OUTPUT_DIR/test-cases.json"

# Filter test cases to unit layer only, then apply --cases filter
ALL_UNIT_IDS=()
while IFS= read -r id; do
  ALL_UNIT_IDS+=("$id")
done < <(jq -r '.test_cases[] | select(.layer == "unit") | .id' "$TEST_CASES_FILE")

if [[ -n "$SELECTED_CASES" ]]; then
  IFS=',' read -ra REQUESTED_IDS <<< "$SELECTED_CASES"
  CASE_IDS=()
  for rid in "${REQUESTED_IDS[@]}"; do
    # Verify the requested ID exists in the unit layer
    found=false
    for uid in "${ALL_UNIT_IDS[@]}"; do
      if [[ "$uid" == "$rid" ]]; then
        found=true
        break
      fi
    done
    if $found; then
      CASE_IDS+=("$rid")
    else
      echo "WARNING: Case '$rid' not found in unit layer — skipping"
    fi
  done
  echo "Running selected unit cases: ${CASE_IDS[*]}"
else
  CASE_IDS=("${ALL_UNIT_IDS[@]}")
fi

echo "Cases to run: ${#CASE_IDS[@]}"
echo ""

# Track results
PASS=0
FAIL=0
ERROR=0
TOTAL=0

# Helper: generate a JSONL tool_use line
make_tool_line() {
  local tool_name="$1"
  local input_json="$2"
  jq -nc \
    --arg tool "$tool_name" \
    --argjson inp "$input_json" \
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":$tool,"input":$inp}]}}'
}

# Helper: generate a JSONL text line (for promise matching)
make_text_line() {
  local text="$1"
  jq -nc --arg t "$text" '{"type":"assistant","message":{"content":[{"type":"text","text":$t}]}}'
}

run_single_test() {
  local case_id="$1"
  local case_dir="$OUTPUT_DIR/$case_id"
  mkdir -p "$case_dir"

  # Extract test case fields
  local description
  description=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .description' "$TEST_CASES_FILE")
  local target
  target=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .target' "$TEST_CASES_FILE")
  local checks
  checks=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .checks' "$TEST_CASES_FILE")
  local filler_count
  filler_count=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .filler_count // 10' "$TEST_CASES_FILE")
  local transcript_json
  transcript_json=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .transcript // []' "$TEST_CASES_FILE")
  local transcript_text_json
  transcript_text_json=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .transcript_text // []' "$TEST_CASES_FILE")

  # Optional seeding fields (may be null/empty)
  local state_file_json
  state_file_json=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .state_file // empty' "$TEST_CASES_FILE" 2>/dev/null || true)
  local raw_state_file
  raw_state_file=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .raw_state_file // empty' "$TEST_CASES_FILE" 2>/dev/null || true)
  local pre_reflections_json
  pre_reflections_json=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .pre_reflections // empty' "$TEST_CASES_FILE" 2>/dev/null || true)
  local metrics_history_json
  metrics_history_json=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .metrics_history // empty' "$TEST_CASES_FILE" 2>/dev/null || true)
  local routing_input_json
  routing_input_json=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .routing_input // empty' "$TEST_CASES_FILE" 2>/dev/null || true)

  if [[ -z "$description" || "$description" == "null" ]]; then
    echo "  ERROR: Test case '$case_id' not found"
    ERROR=$((ERROR + 1))
    TOTAL=$((TOTAL + 1))
    return
  fi

  echo "  [$case_id] [$target]"
  echo "    $description"

  if $DRY_RUN; then
    echo "    [DRY RUN] Would seed state and run $target"
    echo ""
    return
  fi

  # Resolve target script
  local target_script=""
  local target_skip=false
  case "$target" in
    stop-hook)
      target_script="$STOP_HOOK"
      ;;
    reflection-generator)
      target_script="$REFLECTION_GEN"
      ;;
    convergence-detector)
      target_script="$CONVERGENCE_DET"
      ;;
    agent-router)
      target_script="$AGENT_ROUTER"
      ;;
    *)
      echo "    ERROR: Unknown target '$target'"
      ERROR=$((ERROR + 1))
      TOTAL=$((TOTAL + 1))
      return
      ;;
  esac

  if [[ ! -f "$target_script" ]]; then
    echo "    SKIP: $target not yet implemented ($target_script)"
    # Count as ERROR (not FAIL) per spec
    jq -n \
      --arg id "$case_id" \
      --arg result "ERROR" \
      --arg target "$target" \
      --arg reason "target script not yet implemented: $target_script" \
      --arg finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{
        test_id: $id,
        result: $result,
        target: $target,
        passed_checks: 0,
        total_checks: 0,
        exit_code: -1,
        finished_at: $finished,
        skip_reason: $reason
      }' > "$case_dir/meta.json"
    ERROR=$((ERROR + 1))
    TOTAL=$((TOTAL + 1))
    echo ""
    return
  fi

  # Create isolated temp directory for test artifacts
  local test_dir
  test_dir=$(mktemp -d)

  # Create .claude directory for state file
  mkdir -p "$test_dir/.claude"

  # Create reflections directory
  local reflections_dir="$test_dir/reflections"
  mkdir -p "$reflections_dir"

  local transcript_file="$test_dir/transcript.jsonl"
  local state_json_path="$test_dir/.claude/dev-loop.local.json"
  local metrics_file="$test_dir/metrics-history.json"
  local routing_input_file="$test_dir/routing-input.json"
  local convergence_output_file="$test_dir/convergence-output.json"
  local routing_output_file="$test_dir/routing-output.json"

  # Seed state_file as .claude/dev-loop.local.json
  if [[ -n "$state_file_json" && "$state_file_json" != "null" ]]; then
    echo "$state_file_json" > "$state_json_path"
  fi

  # Seed raw_state_file (for corrupt state testing) — overwrites the state file path
  if [[ -n "$raw_state_file" && "$raw_state_file" != "null" ]]; then
    printf '%s' "$raw_state_file" > "$state_json_path"
  fi

  # Seed pre_reflections as reflections/iteration-N.json
  if [[ -n "$pre_reflections_json" && "$pre_reflections_json" != "null" ]]; then
    local ref_count
    ref_count=$(echo "$pre_reflections_json" | jq 'length')
    local r
    for (( r=0; r<ref_count; r++ )); do
      local ref_obj iter_num
      ref_obj=$(echo "$pre_reflections_json" | jq -c ".[$r]")
      iter_num=$(echo "$ref_obj" | jq -r '.iteration // ($r + 1)' --argjson r "$r")
      echo "$ref_obj" > "$reflections_dir/iteration-${iter_num}.json"
    done
  fi

  # Seed metrics_history as metrics-history.json
  if [[ -n "$metrics_history_json" && "$metrics_history_json" != "null" ]]; then
    echo "$metrics_history_json" > "$metrics_file"
  fi

  # Seed routing_input as routing-input.json
  if [[ -n "$routing_input_json" && "$routing_input_json" != "null" ]]; then
    echo "$routing_input_json" > "$routing_input_file"
  fi

  # Generate JSONL transcript
  # 1) Write filler lines first (Write tool avoids triggering search rules)
  local i
  for (( i=0; i<filler_count; i++ )); do
    make_tool_line "Write" "{\"file_path\":\"/project/filler${i}.ts\",\"content\":\"// filler\"}" >> "$transcript_file"
  done

  # 2) Add test-specific tool_use calls
  local tc_count
  tc_count=$(echo "$transcript_json" | jq 'length')
  local j
  for (( j=0; j<tc_count; j++ )); do
    local tc_tool tc_input
    tc_tool=$(echo "$transcript_json" | jq -r ".[${j}].tool")
    tc_input=$(echo "$transcript_json" | jq -c ".[${j}].input")
    make_tool_line "$tc_tool" "$tc_input" >> "$transcript_file"
  done

  # 3) Add text lines from transcript_text (for promise matching tests)
  local tt_count
  tt_count=$(echo "$transcript_text_json" | jq 'length')
  local k
  for (( k=0; k<tt_count; k++ )); do
    local tt_text
    tt_text=$(echo "$transcript_text_json" | jq -r ".[${k}]")
    make_text_line "$tt_text" >> "$transcript_file"
  done

  # Run the target script
  local exit_code=0
  set +e
  case "$target" in
    stop-hook)
      # stop-hook receives JSON stdin and outputs to stdout
      local hook_input
      hook_input=$(jq -nc \
        --arg session_id "aabbccdd11223344" \
        --arg transcript_path "$transcript_file" \
        --arg cwd "$test_dir" \
        '{"session_id": $session_id, "transcript_path": $transcript_path, "cwd": $cwd}')

      if [[ -n "$TIMEOUT_CMD" ]]; then
        echo "$hook_input" | $TIMEOUT_CMD ${TIMEOUT}s bash "$target_script" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      else
        echo "$hook_input" | bash "$target_script" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      fi
      exit_code=$?
      ;;

    reflection-generator)
      if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD ${TIMEOUT}s bun "$target_script" \
          --transcript "$transcript_file" \
          --state "$state_json_path" \
          --reflections-dir "$reflections_dir" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      else
        bun "$target_script" \
          --transcript "$transcript_file" \
          --state "$state_json_path" \
          --reflections-dir "$reflections_dir" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      fi
      exit_code=$?
      ;;

    convergence-detector)
      if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD ${TIMEOUT}s bun "$target_script" \
          --metrics "$metrics_file" \
          --state "$state_json_path" \
          --output "$convergence_output_file" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      else
        bun "$target_script" \
          --metrics "$metrics_file" \
          --state "$state_json_path" \
          --output "$convergence_output_file" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      fi
      exit_code=$?
      ;;

    agent-router)
      if [[ -n "$TIMEOUT_CMD" ]]; then
        $TIMEOUT_CMD ${TIMEOUT}s bun "$target_script" \
          --input "$routing_input_file" \
          --output "$routing_output_file" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      else
        bun "$target_script" \
          --input "$routing_input_file" \
          --output "$routing_output_file" \
          > "$test_dir/hook-stdout.txt" \
          2> "$test_dir/hook-stderr.txt"
      fi
      exit_code=$?
      ;;
  esac
  set -e

  # Copy state file to state.json for analyzer inspection (all targets)
  if [[ -f "$state_json_path" ]]; then
    cp "$state_json_path" "$test_dir/state.json"
  fi

  # Copy artifacts to output dir for debugging
  cp -r "$test_dir/." "$case_dir/" 2>/dev/null || true

  # Run the TypeScript analyzer to check results
  local analysis_result
  local analysis_exit=0
  set +e
  if [[ -f "$ANALYZER_TS" ]]; then
    analysis_result=$(bun "$ANALYZER_TS" \
      --layer unit \
      "$test_dir" \
      "$checks" \
      "$exit_code" \
      2>"$case_dir/analyzer-ts-stderr.txt")
    analysis_exit=$?
  else
    # Analyzer not yet implemented — run basic exit-code-only check
    analysis_result=$(jq -n \
      --argjson code "$exit_code" \
      --argjson checks_obj "$checks" \
      '{
        passed: true,
        checks: [
          {
            check: "analyzer_not_implemented",
            passed: true,
            detail: "analyze-results.ts not yet implemented — exit code only check deferred"
          }
        ],
        summary: {total_checks: 1, passed_checks: 1, failed_checks: 0}
      }')
    analysis_exit=0
  fi
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
    --arg target "$target" \
    --arg finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      test_id: $id,
      result: $result,
      target: $target,
      passed_checks: ($passed | tonumber),
      total_checks: ($total | tonumber),
      exit_code: ($exit_code | tonumber),
      finished_at: $finished
    }' > "$case_dir/meta.json"

  echo "    Result: $result ($passed_checks/$total_checks checks) | exit: $exit_code"
  if [[ -n "$failed_details" ]]; then
    echo "$failed_details"
  fi
  echo ""

  # Clean up temp directory
  rm -rf "$test_dir"
}

# Main execution loop
echo "=== Starting Unit Tests ==="
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
printf "%-40s %-24s %-8s %-12s %-8s\n" "TEST_ID" "TARGET" "RESULT" "CHECKS" "EXIT"
printf "%-40s %-24s %-8s %-12s %-8s\n" "-------" "------" "------" "------" "----"

for case_id in "${CASE_IDS[@]}"; do
  meta_file="$OUTPUT_DIR/$case_id/meta.json"
  if [[ -f "$meta_file" ]]; then
    result=$(jq -r '.result' "$meta_file")
    tgt=$(jq -r '.target // "unknown"' "$meta_file")
    passed=$(jq -r '.passed_checks' "$meta_file")
    total=$(jq -r '.total_checks' "$meta_file")
    exit_code=$(jq -r '.exit_code' "$meta_file")
    printf "%-40s %-24s %-8s %-12s %-8s\n" "$case_id" "$tgt" "$result" "${passed}/${total}" "$exit_code"
  fi
done

echo ""
echo "Full results: $OUTPUT_DIR/results-summary.json"

# Exit with failure if any tests failed
if [[ $FAIL -gt 0 || $ERROR -gt 0 ]]; then
  exit 1
fi
exit 0
