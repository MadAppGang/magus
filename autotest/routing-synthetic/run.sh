#!/bin/bash
# Synthetic routing test suite runner
# Runs generated skill/agent routing test cases using native Claude Code (claude -p).
#
# Prerequisites:
#   1. Generate cases: cd ../magus-bench/skill-routing-eval && ./generate-tests.sh
#   2. Import cases:   ./autotest/routing-synthetic/import-cases.sh
#
# Usage:
#   ./autotest/routing-synthetic/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/routing-synthetic/run.sh --dry-run
#   ./autotest/routing-synthetic/run.sh --cases skill-mnemex-explicit-01-var-01
#   ./autotest/routing-synthetic/run.sh --parallel 3

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

# Auto-import if test-cases.json is missing
if [[ ! -f "$SCRIPT_DIR/test-cases.json" ]]; then
  echo "No test-cases.json found — running import..."
  "$SCRIPT_DIR/import-cases.sh" || {
    echo "ERROR: Import failed. Generate cases first:" >&2
    echo "  cd ../magus-bench/skill-routing-eval && ./generate-tests.sh" >&2
    exit 1
  }
  echo ""
fi

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite routing-synthetic \
  --model internal \
  --analyzer "$SCRIPT_DIR/analyze-results.sh" \
  "$@"
