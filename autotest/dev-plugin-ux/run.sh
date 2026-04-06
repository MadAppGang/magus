#!/bin/bash
# Dev Plugin UX improvement validation test suite
# Tests the v2.2.0 changes: help fix, review→audit rename, grouped layout
#
# Usage:
#   ./autotest/dev-plugin-ux/run.sh [OPTIONS]
#
# Uses the worktree plugin directory for testing changes before merge.
#
# Examples:
#   ./autotest/dev-plugin-ux/run.sh --model internal:sonnet
#   ./autotest/dev-plugin-ux/run.sh --model internal:haiku --parallel 3

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite dev-plugin-ux \
  "$@"
