#!/bin/bash
# Subagent selection test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/subagents/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/subagents/run.sh                          # All tests, monitor mode
#   ./autotest/subagents/run.sh --model google/gemini-2.5-flash
#   ./autotest/subagents/run.sh --cases explicit-researcher-01 --dry-run

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite subagents \
  --analyzer "$SCRIPT_DIR/analyze-results.sh" \
  "$@"
