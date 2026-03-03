#!/bin/bash
# Code Roast skill E2E test suite runner
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/code-roast/run.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Default models (use --model or --models to override):
#   internal                — Claude via internal Anthropic API
#   minimax-m2.5            — MiniMax (claudish auto-routes)
#   kimi-k2.5               — Kimi (claudish auto-routes)
#   glm-5                   — GLM-5 (claudish auto-routes)
#   gemini-3.1-pro-preview  — Gemini (claudish auto-routes)
#   gpt-5.2                 — GPT-5.2 (claudish auto-routes)
#
# NOTE: claudish auto-routes to the best provider — do not use or@/provider prefixes
#
# Examples:
#   # Run all 8 tests across all 6 default models
#   ./autotest/code-roast/run.sh
#
#   # Run with a single model
#   ./autotest/code-roast/run.sh --model internal
#   ./autotest/code-roast/run.sh --model minimax-m2.5
#
#   # Run specific test cases
#   ./autotest/code-roast/run.sh --cases roast-ts-file-01,roast-python-inline-02
#
#   # Dry run (print commands without executing)
#   ./autotest/code-roast/run.sh --dry-run
#
#   # Run in parallel (3 concurrent tests)
#   ./autotest/code-roast/run.sh --parallel 3
#
#   # Custom timeout (seconds)
#   ./autotest/code-roast/run.sh --timeout 180

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

# Default models — all 6 specified for code-roast validation
DEFAULT_MODELS="internal,minimax-m2.5,kimi-k2.5,glm-5,gemini-3.1-pro-preview,gpt-5.2"

# Check if user passed --model or --models; if not, inject defaults
HAS_MODEL_FLAG=false
for arg in "$@"; do
  case "$arg" in
    --model|--models) HAS_MODEL_FLAG=true ;;
  esac
done

if [ "$HAS_MODEL_FLAG" = false ]; then
  exec "$FRAMEWORK_DIR/runner-base.sh" \
    --suite code-roast \
    --models "$DEFAULT_MODELS" \
    --analyzer "bun $SCRIPT_DIR/analyze-results.ts" \
    "$@"
else
  exec "$FRAMEWORK_DIR/runner-base.sh" \
    --suite code-roast \
    --analyzer "bun $SCRIPT_DIR/analyze-results.ts" \
    "$@"
fi
