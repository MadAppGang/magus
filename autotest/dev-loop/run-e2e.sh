#!/bin/bash
# dev:loop E2E Integration Test Suite (Layer 2)
# Thin wrapper around the shared framework runner-base.sh
#
# Usage:
#   ./autotest/dev-loop/run-e2e.sh [OPTIONS]
#
# All options are passed through to runner-base.sh.
# See: ./autotest/framework/runner-base.sh --help
#
# Examples:
#   ./autotest/dev-loop/run-e2e.sh                                           # All e2e tests, monitor mode
#   ./autotest/dev-loop/run-e2e.sh --model claude-sonnet-4-6
#   ./autotest/dev-loop/run-e2e.sh --models "claude-sonnet-4-6,or@minimax/minimax-m2.5,or@moonshotai/kimi-k2.5,or@z-ai/glm-5,or@google/gemini-3.1-pro-preview,or@openai/gpt-5.2-codex"
#   ./autotest/dev-loop/run-e2e.sh --cases e2e-loop-start-01 --dry-run
#   ./autotest/dev-loop/run-e2e.sh --parallel 3

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"

exec "$FRAMEWORK_DIR/runner-base.sh" \
  --suite dev-loop \
  --analyzer "bun $SCRIPT_DIR/analyze-results.ts --layer e2e" \
  "$@"
