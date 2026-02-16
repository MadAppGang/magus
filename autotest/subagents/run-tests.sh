#!/bin/bash
# Automated Subagent Selection Test Runner
# Tests whether Claude Code selects the correct subagent_type for various task prompts.
#
# Usage:
#   ./autotest/subagents/run-tests.sh [OPTIONS]
#
# Options:
#   --cases <ids>       Comma-separated test case IDs (default: all)
#   --runs <N>          Number of runs per test case (default: 1)
#   --output-dir <dir>  Custom output directory (default: auto-generated)
#   --parallel <N>      Max parallel runs (default: 1, sequential)
#   --dry-run           Show what would be run without executing
#   --help              Show this help message

set -euo pipefail

# Allow running from inside a Claude session (tests launch separate non-interactive processes)
unset CLAUDECODE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_CASES_FILE="$SCRIPT_DIR/test-cases.json"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_DIR="$SCRIPT_DIR/results/run-$TIMESTAMP"
RUNS_PER_CASE=1
PARALLEL=1
DRY_RUN=false
SELECTED_CASES=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --cases) SELECTED_CASES="$2"; shift 2 ;;
    --runs) RUNS_PER_CASE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --parallel) PARALLEL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help)
      head -12 "$0" | tail -11
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Verify dependencies
if ! command -v claude &>/dev/null; then
  echo "ERROR: 'claude' CLI not found in PATH"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: brew install jq"
  exit 1
fi

if [[ ! -f "$TEST_CASES_FILE" ]]; then
  echo "ERROR: Test cases file not found: $TEST_CASES_FILE"
  exit 1
fi

# Load test cases
TOTAL_CASES=$(jq '.test_cases | length' "$TEST_CASES_FILE")
echo "=== Subagent Selection Test Runner ==="
echo "Test cases file: $TEST_CASES_FILE"
echo "Total test cases: $TOTAL_CASES"
echo "Runs per case: $RUNS_PER_CASE"
echo "Output directory: $OUTPUT_DIR"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Copy test cases for reference
cp "$TEST_CASES_FILE" "$OUTPUT_DIR/test-cases.json"

# Filter test cases if --cases specified
if [[ -n "$SELECTED_CASES" ]]; then
  IFS=',' read -ra CASE_IDS <<< "$SELECTED_CASES"
  echo "Running selected cases: ${CASE_IDS[*]}"
else
  # Get all case IDs
  CASE_IDS=()
  while IFS= read -r id; do
    CASE_IDS+=("$id")
  done < <(jq -r '.test_cases[].id' "$TEST_CASES_FILE")
fi

echo "Cases to run: ${#CASE_IDS[@]}"
echo ""

# Initialize results summary
RESULTS_FILE="$OUTPUT_DIR/results-summary.json"
echo '{"runs": [], "summary": {}}' > "$RESULTS_FILE"

# Track results
PASS=0
FAIL=0
ERROR=0
TOTAL=0

run_single_test() {
  local case_id="$1"
  local run_num="$2"
  local case_dir="$OUTPUT_DIR/$case_id"
  mkdir -p "$case_dir"

  # Extract test case data
  local prompt
  prompt=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .prompt' "$TEST_CASES_FILE")
  local expected
  expected=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .expected_agent' "$TEST_CASES_FILE")
  local description
  description=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .description' "$TEST_CASES_FILE")

  if [[ -z "$prompt" || "$prompt" == "null" ]]; then
    echo "  ERROR: Test case '$case_id' not found"
    return 1
  fi

  local run_label="run${run_num}"
  local transcript_file="$case_dir/${run_label}-transcript.jsonl"
  local output_file="$case_dir/${run_label}-output.txt"
  local meta_file="$case_dir/${run_label}-meta.json"

  echo "  [$case_id] Run $run_num: $description"
  echo "    Prompt: ${prompt:0:80}..."
  echo "    Expected: $expected"

  if $DRY_RUN; then
    echo "    [DRY RUN] Would execute claude -p"
    return 0
  fi

  # Write metadata
  jq -n \
    --arg id "$case_id" \
    --arg run "$run_num" \
    --arg prompt "$prompt" \
    --arg expected "$expected" \
    --arg started "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      test_id: $id,
      run: ($run | tonumber),
      prompt: $prompt,
      expected_agent: $expected,
      started_at: $started
    }' > "$meta_file"

  # Run claude with the test prompt
  # We wrap the prompt to ask Claude to delegate it to a subagent
  local wrapped_prompt="$prompt"

  local start_time
  start_time=$(date +%s)

  # Execute with timeout (3 minutes per test)
  # macOS doesn't have 'timeout' by default, use perl-based workaround
  set +e
  if command -v gtimeout &>/dev/null; then
    gtimeout 180 claude -p \
      --output-format stream-json \
      --dangerously-skip-permissions \
      "$wrapped_prompt" \
      > "$transcript_file" \
      2> "$case_dir/${run_label}-stderr.txt"
  else
    # No timeout command available, run directly
    claude -p \
      --output-format stream-json \
      --verbose \
      --dangerously-skip-permissions \
      "$wrapped_prompt" \
      > "$transcript_file" \
      2> "$case_dir/${run_label}-stderr.txt"
  fi
  local exit_code=$?
  set -e

  local end_time
  end_time=$(date +%s)
  local duration=$((end_time - start_time))

  # Save output (extract text from stream-json)
  python3 -c "
import sys, json
for line in open('$transcript_file'):
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        if obj.get('type') == 'assistant':
            for block in obj.get('message', {}).get('content', []):
                if block.get('type') == 'text':
                    print(block.get('text', ''))
    except: pass
" > "$output_file" 2>/dev/null || true

  # Analyze which agent was selected
  local actual_agent
  actual_agent=$(python3 -c "
import sys, json

agents_used = []
for line in open('$transcript_file'):
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        if obj.get('type') == 'assistant':
            for block in obj.get('message', {}).get('content', []):
                if block.get('type') == 'tool_use' and block.get('name') == 'Task':
                    agent = block.get('input', {}).get('subagent_type', 'UNKNOWN')
                    agents_used.append(agent)
    except: pass

if agents_used:
    print(agents_used[0])
else:
    print('NO_TASK_CALL')
" 2>/dev/null || echo "PARSE_ERROR")

  # Determine result
  local result="FAIL"
  if [[ "$actual_agent" == "$expected" ]]; then
    result="PASS"
    ((PASS++))
  elif [[ "$actual_agent" == "NO_TASK_CALL" ]]; then
    result="NO_DELEGATION"
    ((ERROR++))
  elif [[ "$actual_agent" == "PARSE_ERROR" ]]; then
    result="ERROR"
    ((ERROR++))
  elif [[ $exit_code -ne 0 ]]; then
    result="TIMEOUT"
    ((ERROR++))
  else
    # Check alternatives
    local is_alternative=false
    local alternatives
    alternatives=$(jq -r --arg id "$case_id" '.test_cases[] | select(.id == $id) | .expected_alternatives // [] | .[]' "$TEST_CASES_FILE" 2>/dev/null)
    for alt in $alternatives; do
      if [[ "$actual_agent" == "$alt" ]]; then
        result="PASS_ALT"
        ((PASS++))
        is_alternative=true
        break
      fi
    done
    if ! $is_alternative; then
      ((FAIL++))
    fi
  fi
  ((TOTAL++))

  # Update metadata with results
  jq -n \
    --arg id "$case_id" \
    --arg run "$run_num" \
    --arg expected "$expected" \
    --arg actual "$actual_agent" \
    --arg result "$result" \
    --arg duration "$duration" \
    --arg exit_code "$exit_code" \
    --arg finished "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      test_id: $id,
      run: ($run | tonumber),
      expected_agent: $expected,
      actual_agent: $actual,
      result: $result,
      duration_seconds: ($duration | tonumber),
      exit_code: ($exit_code | tonumber),
      finished_at: $finished
    }' > "$meta_file"

  # Print result
  local icon="?"
  case $result in
    PASS) icon="PASS" ;;
    PASS_ALT) icon="PASS(alt)" ;;
    FAIL) icon="FAIL" ;;
    NO_DELEGATION) icon="NO_TASK" ;;
    TIMEOUT) icon="TIMEOUT" ;;
    ERROR) icon="ERROR" ;;
  esac

  echo "    Result: $icon | Expected: $expected | Got: $actual_agent | ${duration}s"
  echo ""
}

# Main execution loop
echo "=== Starting Tests ==="
echo ""

for case_id in "${CASE_IDS[@]}"; do
  for ((run=1; run<=RUNS_PER_CASE; run++)); do
    run_single_test "$case_id" "$run"
  done
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

# Collect all meta files into summary
python3 -c "
import json, glob, os

results_dir = '$OUTPUT_DIR'
runs = []

for meta_file in sorted(glob.glob(os.path.join(results_dir, '*', '*-meta.json'))):
    try:
        with open(meta_file) as f:
            runs.append(json.load(f))
    except:
        pass

# Count results
total = len(runs)
passed = sum(1 for r in runs if r.get('result', '').startswith('PASS'))
failed = sum(1 for r in runs if r.get('result') == 'FAIL')
errors = total - passed - failed

# Agent distribution
agent_counts = {}
for r in runs:
    agent = r.get('actual_agent', 'UNKNOWN')
    agent_counts[agent] = agent_counts.get(agent, 0) + 1

summary = {
    'runs': runs,
    'summary': {
        'total': total,
        'passed': passed,
        'failed': failed,
        'errors': errors,
        'pass_rate': round(passed / total * 100, 1) if total > 0 else 0,
        'agent_distribution': agent_counts,
        'timestamp': '$TIMESTAMP'
    }
}

with open(os.path.join(results_dir, 'results-summary.json'), 'w') as f:
    json.dump(summary, f, indent=2)

print()
print('Agent Distribution:')
for agent, count in sorted(agent_counts.items(), key=lambda x: -x[1]):
    print(f'  {agent}: {count} ({round(count/total*100, 1)}%)')
" 2>/dev/null || echo "WARNING: Could not generate summary JSON"

# Generate detailed report
echo ""
echo "=== Detailed Results ==="
echo ""
printf "%-20s %-25s %-25s %-10s\n" "TEST_ID" "EXPECTED" "ACTUAL" "RESULT"
printf "%-20s %-25s %-25s %-10s\n" "-------" "--------" "------" "------"

for case_id in "${CASE_IDS[@]}"; do
  for ((run=1; run<=RUNS_PER_CASE; run++)); do
    meta_file="$OUTPUT_DIR/$case_id/run${run}-meta.json"
    if [[ -f "$meta_file" ]]; then
      expected=$(jq -r '.expected_agent' "$meta_file")
      actual=$(jq -r '.actual_agent' "$meta_file")
      result=$(jq -r '.result' "$meta_file")
      printf "%-20s %-25s %-25s %-10s\n" "$case_id" "$expected" "$actual" "$result"
    fi
  done
done

echo ""
echo "Full results: $OUTPUT_DIR/results-summary.json"
