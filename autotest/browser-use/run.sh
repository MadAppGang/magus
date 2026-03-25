#!/bin/bash
# Browser-use plugin E2E test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/browser-use/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/browser-use/run.sh                                        # All tests, monitor mode
#   ./autotest/browser-use/run.sh --model claude-sonnet-4-6
#   ./autotest/browser-use/run.sh --cases browser-navigate-01 --dry-run
#   ./autotest/browser-use/run.sh --cases browser-singleton-lock-02 --timeout 120
#   ./autotest/browser-use/run.sh --parallel 2
#
# NOTE: Browser-use tests require:
#   - Chrome/Chromium installed
#   - browser-use Python package installed (pip install browser-use)
#   - The browser-use plugin loaded (EXTRA_PLUGIN_DIRS set below)
#
# REGRESSION coverage: SingletonLock contention bug — dev-fix-20260325-143046-4ff02ed6

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load the browser-use plugin so the MCP server is available
export EXTRA_PLUGIN_DIRS="$REPO_ROOT/plugins/browser-use"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite browser-use \
  "$@"
