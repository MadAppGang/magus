#!/bin/bash
# Subagent Selection Test Results Analyzer
# Analyzes results from run-tests.sh and generates insights.
#
# Usage:
#   ./autotest/subagents/analyze-results.sh <results-dir>
#   ./autotest/subagents/analyze-results.sh --latest
#
# Options:
#   --latest            Analyze the most recent results
#   --compare <dir2>    Compare two result sets
#   --by-category       Group results by test category
#   --confusion-matrix  Show agent selection confusion matrix
#   --help              Show this help message

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_BASE="$SCRIPT_DIR/results"

# Parse arguments
COMPARE_DIR=""
BY_CATEGORY=false
CONFUSION_MATRIX=false

if [[ "${1:-}" == "--latest" ]]; then
  RESULTS_DIR=$(ls -td "$RESULTS_BASE"/run-* 2>/dev/null | head -1)
  if [[ -z "$RESULTS_DIR" ]]; then
    echo "ERROR: No results found in $RESULTS_BASE"
    exit 1
  fi
  shift
elif [[ "${1:-}" == "--help" ]]; then
  head -13 "$0" | tail -12
  exit 0
elif [[ -n "${1:-}" && -d "${1:-}" ]]; then
  RESULTS_DIR="$1"
  shift
else
  echo "Usage: $0 <results-dir> | --latest [OPTIONS]"
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case $1 in
    --compare) COMPARE_DIR="$2"; shift 2 ;;
    --by-category) BY_CATEGORY=true; shift ;;
    --confusion-matrix) CONFUSION_MATRIX=true; shift ;;
    *) shift ;;
  esac
done

SUMMARY_FILE="$RESULTS_DIR/results-summary.json"

if [[ ! -f "$SUMMARY_FILE" ]]; then
  echo "ERROR: No results-summary.json found in $RESULTS_DIR"
  exit 1
fi

echo "=== Subagent Selection Analysis ==="
echo "Results: $RESULTS_DIR"
echo ""

# Basic stats
export RESULTS_DIR
python3 << 'PYEOF'
import json, sys, os

results_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("RESULTS_DIR", "")

with open(os.path.join(results_dir, "results-summary.json")) as f:
    data = json.load(f)

runs = data["runs"]
summary = data["summary"]

print(f"Total Tests: {summary['total']}")
print(f"Passed:      {summary['passed']} ({summary['pass_rate']}%)")
print(f"Failed:      {summary['failed']}")
print(f"Errors:      {summary['errors']}")
print()

# Agent distribution
print("=== Agent Selection Distribution ===")
print()
for agent, count in sorted(summary.get("agent_distribution", {}).items(), key=lambda x: -x[1]):
    pct = round(count / summary["total"] * 100, 1) if summary["total"] > 0 else 0
    bar = "#" * int(pct / 2)
    print(f"  {agent:30s} {count:3d} ({pct:5.1f}%) {bar}")
print()

# Failures detail
failures = [r for r in runs if r.get("result") == "FAIL"]
if failures:
    print("=== Failed Tests ===")
    print()
    print(f"{'Test ID':25s} {'Expected':25s} {'Got':25s}")
    print("-" * 75)
    for r in failures:
        print(f"{r['test_id']:25s} {r['expected_agent']:25s} {r['actual_agent']:25s}")
    print()

    # Analyze failure patterns
    wrong_to = {}
    for r in failures:
        key = f"{r['expected_agent']} -> {r['actual_agent']}"
        wrong_to[key] = wrong_to.get(key, 0) + 1

    print("=== Failure Patterns (Expected -> Got) ===")
    print()
    for pattern, count in sorted(wrong_to.items(), key=lambda x: -x[1]):
        print(f"  {pattern}: {count}x")
    print()

# Error detail
errors = [r for r in runs if r.get("result") in ("NO_DELEGATION", "TIMEOUT", "ERROR")]
if errors:
    print("=== Error Tests ===")
    print()
    for r in errors:
        print(f"  {r['test_id']:25s} result={r['result']:15s} exit_code={r.get('exit_code', '?')}")
    print()

# Timing stats
durations = [r.get("duration_seconds", 0) for r in runs if r.get("duration_seconds")]
if durations:
    print("=== Timing ===")
    print()
    print(f"  Average: {sum(durations)/len(durations):.1f}s")
    print(f"  Min:     {min(durations)}s")
    print(f"  Max:     {max(durations)}s")
    print(f"  Total:   {sum(durations)}s")
    print()

# By category (if available from test-cases.json)
test_cases_file = os.path.join(results_dir, "test-cases.json")
if os.path.exists(test_cases_file):
    with open(test_cases_file) as f:
        tc_data = json.load(f)

    # Build category map
    cat_map = {}
    for tc in tc_data.get("test_cases", []):
        cat_map[tc["id"]] = tc.get("category", "unknown")

    # Group results by category
    by_cat = {}
    for r in runs:
        cat = cat_map.get(r["test_id"], "unknown")
        if cat not in by_cat:
            by_cat[cat] = {"total": 0, "passed": 0}
        by_cat[cat]["total"] += 1
        if r.get("result", "").startswith("PASS"):
            by_cat[cat]["passed"] += 1

    print("=== Results by Category ===")
    print()
    print(f"{'Category':20s} {'Pass':5s} {'Total':5s} {'Rate':8s}")
    print("-" * 40)
    for cat in sorted(by_cat.keys()):
        d = by_cat[cat]
        rate = round(d["passed"] / d["total"] * 100) if d["total"] > 0 else 0
        print(f"{cat:20s} {d['passed']:5d} {d['total']:5d} {rate:5d}%")
    print()

PYEOF
RESULTS_DIR="$RESULTS_DIR" python3 << 'PYEOF2' "$RESULTS_DIR"
# Confusion matrix (if requested)
import json, sys, os

results_dir = sys.argv[1]
by_category = os.environ.get("BY_CATEGORY", "false") == "true"
confusion = os.environ.get("CONFUSION_MATRIX", "false") == "true"

if not confusion:
    sys.exit(0)

with open(os.path.join(results_dir, "results-summary.json")) as f:
    data = json.load(f)

runs = data["runs"]

# Build confusion matrix
all_agents = sorted(set(
    [r.get("expected_agent", "") for r in runs] +
    [r.get("actual_agent", "") for r in runs]
))

print("=== Confusion Matrix ===")
print("(Rows = Expected, Columns = Actual)")
print()

# Header
header = f"{'':25s}"
for a in all_agents:
    short = a.split(":")[-1][:12] if ":" in a else a[:12]
    header += f" {short:>12s}"
print(header)
print("-" * (25 + 13 * len(all_agents)))

for expected in all_agents:
    row = f"{expected:25s}"
    for actual in all_agents:
        count = sum(1 for r in runs
                   if r.get("expected_agent") == expected and r.get("actual_agent") == actual)
        if count > 0:
            row += f" {count:>12d}"
        else:
            row += f" {'·':>12s}"
    print(row)
print()
PYEOF2

echo "=== Recommendations ==="
echo ""
echo "To improve agent selection accuracy:"
echo "  1. Review the 'description' field in each failing agent's .md file"
echo "  2. Make descriptions more specific about WHEN to use the agent"
echo "  3. Add trigger phrases like 'Use proactively when...'"
echo "  4. Include 2-3 examples in the description showing delegation patterns"
echo "  5. Re-run tests: ./autotest/subagents/run-tests.sh"
echo ""
echo "To compare before/after changes:"
echo "  $0 --compare <new-results-dir>"
