#!/bin/bash
# Stats plugin E2E test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/stats/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/stats/run.sh                                           # All tests, sequential (default)
#   ./autotest/stats/run.sh --model internal                         # Native claude with plugin hooks
#   ./autotest/stats/run.sh --cases stats-help-01 --dry-run
#   ./autotest/stats/run.sh --cases stats-hook-pipeline-06 --timeout 120
#   ./autotest/stats/run.sh --parallel 3                             # Override: run 3 in parallel
#
# NOTE: Stats tests share ~/.claude/stats/ state (all read/write the same stats.db).
# Running in parallel can cause test contamination (e.g., stats-clear-13 wiping data
# that stats-dashboard-render-11 just seeded). Default is --parallel 1 (sequential).
# Pass --parallel N to override if you know tests are independent.
#
# NOTE: For tests that require stats hooks (PreToolUse/PostToolUse/Stop/SessionStart),
# use --model internal so execute-test.sh runs native `claude -p`. External models via
# claudish do NOT trigger plugin hooks. Hook/pipeline tests (stats-hook-*) require this.
#
# NOTE: The stats plugin stores data in ~/.claude/stats/stats.db (not in the project
# directory). Tests that seed data use bun inline scripts and clean up after themselves.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load the stats plugin so hooks and commands are available in claude -p mode
export EXTRA_PLUGIN_DIRS="$REPO_ROOT/plugins/stats"

# Check if user already passed --parallel; if so, don't add the default.
PARALLEL_ARG=""
for arg in "$@"; do
  if [[ "$arg" == "--parallel" ]]; then
    PARALLEL_ARG="user_supplied"
    break
  fi
done

if [[ -z "$PARALLEL_ARG" ]]; then
  # Default to sequential to prevent ~/.claude/stats/ state contamination across tests
  PARALLEL_ARG="--parallel 1"
else
  PARALLEL_ARG=""
fi

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite stats \
  --suite-dir "$SCRIPT_DIR" \
  --analyzer "bun $SCRIPT_DIR/analyze-results.ts" \
  $PARALLEL_ARG \
  "$@"
