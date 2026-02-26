#!/bin/bash
# Terminal plugin E2E test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/terminal/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/terminal/run.sh                                          # All tests, monitor mode
#   ./autotest/terminal/run.sh --model google/gemini-2.5-flash
#   ./autotest/terminal/run.sh --cases tmux-inspect-sessions-01 --dry-run
#   ./autotest/terminal/run.sh --cases cross-backend-compare-09 --timeout 120
#   ./autotest/terminal/run.sh --parallel 3

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite terminal \
  --analyzer "bun $SCRIPT_DIR/analyze-results.ts" \
  "$@"
