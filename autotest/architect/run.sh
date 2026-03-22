#!/bin/bash
# Architect command E2E test suite runner
# Tests /dev:architect rename, complexity triage, plan mode, task management, GTD integration
#
# Usage:
#   ./autotest/architect/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/architect/run.sh                                    # All tests, sequential
#   ./autotest/architect/run.sh --model claude-sonnet-4-6          # Specific model
#   ./autotest/architect/run.sh --cases architect-routing-01       # Single test
#   ./autotest/architect/run.sh --parallel 3                       # Run 3 in parallel
#   ./autotest/architect/run.sh --cases architect-routing-01,architect-old-plan-gone-02 --dry-run
#
# NOTE: Tests that create/clean .claude/gtd/ or ai-docs/sessions/ directories
# should run sequentially to avoid state contamination. Tests 07, 08, 11, 13
# modify shared filesystem state.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite architect \
  "$@"
