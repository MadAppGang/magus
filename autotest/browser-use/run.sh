#!/bin/bash
# Browser-use plugin E2E test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/browser-use/run.sh [OPTIONS]
#
# Examples:
#   ./autotest/browser-use/run.sh                                        # All tests, monitor mode
#   ./autotest/browser-use/run.sh --model claude-sonnet-4-6              # Specific model
#   ./autotest/browser-use/run.sh --cases browser-navigate-01 --dry-run  # Dry run one case
#   ./autotest/browser-use/run.sh --parallel 3 --timeout 120             # Parallel with timeout
#
# Analyze results:
#   bun autotest/browser-use/analyze-results.ts autotest/browser-use/results/<run-dir>
#
# Requirements: Chrome/Chromium, browser-use Python package, browser-use@magus plugin enabled
#
# Test categories (15 cases, v3.0):
#   smoke:          01 (navigate lifecycle)
#   regression:     02 (SingletonLock contention)
#   core:           03 (get-state), 04 (get-html), 11 (full-page screenshot), 14 (extract-content)
#   interaction:    05 (scroll), 07 (go-back), 10 (click), 13 (type/search)
#   advanced:       06 (multi-tab), 08 (session management), 09 (export/import), 15 (run-script)
#   error-handling: 12 (graceful errors)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Run Chrome headless (no visible window) during E2E tests
# Override with BROWSER_USE_HEADLESS=false to see the browser
export BROWSER_USE_HEADLESS="${BROWSER_USE_HEADLESS:-true}"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite browser-use \
  --analyzer "bun $SCRIPT_DIR/analyze-results.ts" \
  "$@"
