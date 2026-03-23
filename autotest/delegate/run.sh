#!/bin/bash
# Delegate command test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/delegate/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/delegate/run.sh                                    # All tests, monitor mode
#   ./autotest/delegate/run.sh --model claude-sonnet-4-6         # With specific model
#   ./autotest/delegate/run.sh --cases delegate-explicit-command-01 --dry-run

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load local multimodel plugin (delegate command not yet in plugin cache)
export EXTRA_PLUGIN_DIRS="$REPO_ROOT/plugins/multimodel"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite delegate \
  --analyzer "bun $SCRIPT_DIR/analyze-transcript.ts" \
  "$@"
