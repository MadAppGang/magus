#!/bin/bash
# Hybrid analyzer for routing-synthetic suite
#
# Handles both test types:
#   - Skill-type cases (have "checks" object) → delegates to skills/analyze-transcript.py
#   - Agent-type cases (have "expected_agent") → uses evaluator.ts via aggregator
#
# Usage:
#   ./autotest/routing-synthetic/analyze-results.sh <results-dir>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"
SKILLS_ANALYZER="$SCRIPT_DIR/../skills/analyze-transcript.py"

if [[ -z "${1:-}" || ! -d "${1:-}" ]]; then
  echo "Usage: $0 <results-dir>" >&2
  exit 1
fi

RESULTS_DIR="$1"
TEST_CASES_FILE="$RESULTS_DIR/test-cases.json"

if [[ ! -f "$TEST_CASES_FILE" ]]; then
  echo "ERROR: test-cases.json not found in $RESULTS_DIR" >&2
  exit 1
fi

echo "=== Routing-Synthetic Analysis ==="
echo "Results: $RESULTS_DIR"
echo ""

# Count test types
SKILL_COUNT=$(jq '[.test_cases[] | select(.checks)] | length' "$TEST_CASES_FILE")
AGENT_COUNT=$(jq '[.test_cases[] | select(.expected_agent)] | length' "$TEST_CASES_FILE")
TOTAL_COUNT=$(jq '.test_cases | length' "$TEST_CASES_FILE")

echo "Test cases:   $TOTAL_COUNT total"
echo "  Skill-type: $SKILL_COUNT (transcript analysis)"
echo "  Agent-type: $AGENT_COUNT (agent selection)"
echo ""

# --- Analyze skill-type cases ---

SKILL_PASS=0
SKILL_FAIL=0
SKILL_SKIP=0

if [[ $SKILL_COUNT -gt 0 ]]; then
  echo "=== Skill-Type Analysis ==="

  # Get all skill-type case IDs
  SKILL_IDS=$(jq -r '.test_cases[] | select(.checks) | .id' "$TEST_CASES_FILE")

  for case_id in $SKILL_IDS; do
    # Find transcript for this case (check all model dirs)
    TRANSCRIPT=""
    for model_dir in "$RESULTS_DIR"/*/; do
      if [[ -f "$model_dir/$case_id/transcript.jsonl" ]]; then
        TRANSCRIPT="$model_dir/$case_id/transcript.jsonl"
        break
      fi
    done

    if [[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]]; then
      echo "  SKIP [$case_id] No transcript found"
      SKILL_SKIP=$((SKILL_SKIP + 1))
      continue
    fi

    # Get checks JSON for this case
    CHECKS=$(jq -c --arg id "$case_id" '.test_cases[] | select(.id == $id) | .checks' "$TEST_CASES_FILE")

    if [[ -z "$CHECKS" || "$CHECKS" == "null" ]]; then
      echo "  SKIP [$case_id] No checks defined"
      SKILL_SKIP=$((SKILL_SKIP + 1))
      continue
    fi

    # Run skill analyzer
    RESULT=$(python3 "$SKILLS_ANALYZER" "$TRANSCRIPT" "$CHECKS" 2>/dev/null) || true

    if echo "$RESULT" | jq -e '.passed' >/dev/null 2>&1; then
      PASSED=$(echo "$RESULT" | jq -r '.passed')
      if [[ "$PASSED" == "true" ]]; then
        echo "  PASS [$case_id]"
        SKILL_PASS=$((SKILL_PASS + 1))
      else
        FAILED_CHECKS=$(echo "$RESULT" | jq -r '.checks[] | select(.passed == false) | .check + ": " + .detail')
        echo "  FAIL [$case_id] $FAILED_CHECKS"
        SKILL_FAIL=$((SKILL_FAIL + 1))
      fi
    else
      echo "  ERROR [$case_id] Analyzer returned invalid JSON"
      SKILL_FAIL=$((SKILL_FAIL + 1))
    fi
  done

  echo ""
  echo "Skill results: $SKILL_PASS passed, $SKILL_FAIL failed, $SKILL_SKIP skipped"
  echo ""
fi

# --- Agent-type results come from aggregator (already in results-summary.json) ---

SUMMARY_FILE="$RESULTS_DIR/results-summary.json"
if [[ -f "$SUMMARY_FILE" ]]; then
  echo "=== Agent-Type Analysis ==="

  AGENT_PASS=$(jq '[.runs[] | select(.result == "PASS" or .result == "PASS_ALT" or .result == "PASS_DELEGATED")] | length' "$SUMMARY_FILE")
  AGENT_FAIL=$(jq '[.runs[] | select(.result == "FAIL" or .result == "FAIL_OVER_DELEGATED" or .result == "NO_DELEGATION")] | length' "$SUMMARY_FILE")
  AGENT_ERROR=$(jq '[.runs[] | select(.result == "ERROR" or .result == "TIMEOUT")] | length' "$SUMMARY_FILE")

  echo "Agent results: $AGENT_PASS passed, $AGENT_FAIL failed, $AGENT_ERROR errors"

  # Category breakdown
  echo ""
  echo "By category:"
  jq -r '
    .runs | group_by(.test_id | split("-var-")[0] | split("-0")[0]) |
    map({
      category: .[0].test_id,
      pass: [.[] | select(.result | startswith("PASS"))] | length,
      fail: [.[] | select(.result | test("FAIL|NO_DEL"))] | length,
      total: length
    }) |
    sort_by(-.fail) |
    .[] |
    "  \(.category | .[0:30] | . + " " * (30 - length))\(.pass)/\(.total) passed"
  ' "$SUMMARY_FILE" 2>/dev/null || true
  echo ""
fi

# --- Combined summary ---

TOTAL_PASS=$((SKILL_PASS + ${AGENT_PASS:-0}))
TOTAL_FAIL=$((SKILL_FAIL + ${AGENT_FAIL:-0}))
TOTAL_ERROR=$((SKILL_SKIP + ${AGENT_ERROR:-0}))
TOTAL_RUN=$((TOTAL_PASS + TOTAL_FAIL + TOTAL_ERROR))

if [[ $TOTAL_RUN -gt 0 ]]; then
  PASS_RATE=$(( TOTAL_PASS * 100 / TOTAL_RUN ))
else
  PASS_RATE=0
fi

echo "=== Combined Results ==="
echo "Total:  $TOTAL_RUN"
echo "Passed: $TOTAL_PASS ($PASS_RATE%)"
echo "Failed: $TOTAL_FAIL"
echo "Errors: $TOTAL_ERROR"
echo ""

# Write combined analysis
jq -n \
  --argjson skill_pass "$SKILL_PASS" \
  --argjson skill_fail "$SKILL_FAIL" \
  --argjson skill_skip "$SKILL_SKIP" \
  --argjson agent_pass "${AGENT_PASS:-0}" \
  --argjson agent_fail "${AGENT_FAIL:-0}" \
  --argjson agent_error "${AGENT_ERROR:-0}" \
  --argjson total_pass "$TOTAL_PASS" \
  --argjson total_fail "$TOTAL_FAIL" \
  --argjson pass_rate "$PASS_RATE" \
  '{
    skill_type: { passed: $skill_pass, failed: $skill_fail, skipped: $skill_skip },
    agent_type: { passed: $agent_pass, failed: $agent_fail, errors: $agent_error },
    combined: { passed: $total_pass, failed: $total_fail, pass_rate_pct: $pass_rate }
  }' > "$RESULTS_DIR/routing-analysis.json"

echo "Analysis: $RESULTS_DIR/routing-analysis.json"
