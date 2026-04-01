#!/usr/bin/env bash
# Agentdev debug capture — PreToolUse hook
# Reads JSON from stdin, runs TS handler via bun, outputs JSON result

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${PWD}/.claude/agentdev-debug.json"

# Fast path: skip if debug not enabled (avoid bun startup cost)
if [[ ! -f "$CONFIG_FILE" ]] || ! grep -q '"enabled":\s*true' "$CONFIG_FILE" 2>/dev/null; then
  exit 0
fi

# Run the TS handler
INPUT=$(cat)
echo "$INPUT" | bun run "$SCRIPT_DIR/debug-capture-cli.ts" pre 2>/dev/null || true
