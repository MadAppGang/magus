#!/bin/bash
# Error escalation protocol test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Tests that Claude follows Pattern 0 (stop and report) when external
# models fail, instead of silently substituting different models.
#
# Usage:
#   ./autotest/error-escalation/run.sh [OPTIONS]
#
# Examples:
#   ./autotest/error-escalation/run.sh --model internal          # Native Claude with plugins
#   ./autotest/error-escalation/run.sh --model internal:sonnet   # Specific model
#   ./autotest/error-escalation/run.sh --model internal --cases escalation-skill-knowledge-01
#   ./autotest/error-escalation/run.sh --model internal --parallel 3
#
# NOTE: Tests require 'internal' mode for plugin/skill access.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite error-escalation \
  "$@"
