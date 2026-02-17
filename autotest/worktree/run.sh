#!/bin/bash
# Worktree lifecycle test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/worktree/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/worktree/run.sh                           # All tests, monitor mode
#   ./autotest/worktree/run.sh --dry-run

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite worktree \
  "$@"
