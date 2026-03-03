#!/bin/bash
# Designer plugin E2E test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/designer/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/designer/run.sh                                          # All tests, monitor mode
#   ./autotest/designer/run.sh --model claude-sonnet-4-6
#   ./autotest/designer/run.sh --cases design-review-explicit-01 --dry-run
#   ./autotest/designer/run.sh --cases skill-compare-explicit-05 --timeout 60
#   ./autotest/designer/run.sh --parallel 3

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite designer \
  --analyzer "bun $SCRIPT_DIR/analyze-results.ts" \
  "$@"
