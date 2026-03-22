#!/bin/bash
# GTD plugin E2E test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/gtd/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/gtd/run.sh                                          # All tests, sequential (default)
#   ./autotest/gtd/run.sh --model internal                        # Native claude with plugin
#   ./autotest/gtd/run.sh --cases gtd-capture-01 --dry-run
#   ./autotest/gtd/run.sh --cases gtd-help-07 --timeout 60
#   ./autotest/gtd/run.sh --parallel 3                            # Override: run 3 in parallel
#
# NOTE: GTD tests share .claude/gtd/ state (all read/write the same tasks.json).
# Running in parallel causes test contamination (test-11 found tasks from other tests).
# Default is --parallel 1 (sequential). Pass --parallel N to override.
#
# NOTE: For tests that require GTD hooks (TaskCreate/TaskUpdate sync), use
#   --model internal so execute-test.sh runs native `claude -p`. The framework
#   loads --plugin-dir pointing to plugins/dev by default; to load plugins/gtd
#   instead, set GTD_PLUGIN_DIR before running or install the GTD plugin globally.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load the GTD plugin so hooks and commands are available in claude -p mode
export EXTRA_PLUGIN_DIRS="$REPO_ROOT/plugins/gtd"

# Check if user already passed --parallel; if so, don't add the default.
PARALLEL_ARG=""
for arg in "$@"; do
  if [[ "$arg" == "--parallel" ]]; then
    PARALLEL_ARG="user_supplied"
    break
  fi
done

if [[ -z "$PARALLEL_ARG" ]]; then
  # Default to sequential to prevent .claude/gtd/ state contamination across tests
  PARALLEL_ARG="--parallel 1"
else
  PARALLEL_ARG=""
fi

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite gtd \
  --analyzer "bun $SCRIPT_DIR/analyze-results.ts" \
  $PARALLEL_ARG \
  "$@"
