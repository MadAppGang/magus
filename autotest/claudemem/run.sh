#!/bin/bash
# Claudemem MCP E2E test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/claudemem/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/claudemem/run.sh                                          # All tests, monitor mode
#   ./autotest/claudemem/run.sh --model claude-sonnet-4-6
#   ./autotest/claudemem/run.sh --cases index-status-01 --dry-run
#   ./autotest/claudemem/run.sh --cases search-code-02 --timeout 120
#   ./autotest/claudemem/run.sh --parallel 3

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite claudemem \
  --analyzer "bun $SCRIPT_DIR/analyze-results.ts" \
  "$@"
