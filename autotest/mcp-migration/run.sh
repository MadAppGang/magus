#!/bin/bash
# MCP Migration regression test suite runner
# Verifies /team and /delegate use claudish MCP tools, NOT Bash+claudish CLI.
#
# Usage:
#   ./autotest/mcp-migration/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/mcp-migration/run.sh                                         # All tests
#   ./autotest/mcp-migration/run.sh --cases mcp-team-no-bash-cli-01         # Single test
#   ./autotest/mcp-migration/run.sh --parallel 3                            # 3 tests at once

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite mcp-migration \
  --analyzer "bun $SCRIPT_DIR/analyze-transcript.ts" \
  "$@"
