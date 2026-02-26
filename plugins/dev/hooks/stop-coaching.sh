#!/usr/bin/env bash
# stop-coaching.sh
# Stop hook wrapper: reads session metadata from stdin, invokes TypeScript analyzer.
# Fires when a Claude Code session ends.
# Input: JSON via stdin { session_id, transcript_path, cwd, ... }
# Side effects: writes {cwd}/.claude/.coaching/recommendations.md

set -euo pipefail

# Check jq availability (Fix 3)
if ! command -v jq >/dev/null 2>&1; then
  echo "Workflow coaching disabled: jq not found. Install with: brew install jq" >&2
  exit 0
fi

# Verify plugin root is set (Fix 4)
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  echo "Workflow coaching: CLAUDE_PLUGIN_ROOT not set" >&2
  exit 0
fi

# Read all stdin (hook input JSON)
INPUT=$(cat)

# Extract fields using jq (fail gracefully if fields absent)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)

# Graceful degradation: missing fields -> silent exit
[ -z "$TRANSCRIPT_PATH" ] && exit 0
[ -z "$SESSION_ID" ] && exit 0
[ -z "$CWD" ] && exit 0

# Graceful degradation: transcript file must exist and be non-empty
[ -f "$TRANSCRIPT_PATH" ] || exit 0
[ -s "$TRANSCRIPT_PATH" ] || exit 0

# Opt-out check
COACHING="${WORKFLOW_COACHING:-on}"
if [ "$COACHING" = "off" ] || [ "$COACHING" = "false" ] || [ "$COACHING" = "0" ] || [ "$COACHING" = "disabled" ]; then
  # Remove stale recommendations so next SessionStart starts clean
  RECS="${CWD}/.claude/.coaching/recommendations.md"
  [ -f "$RECS" ] && rm -f "$RECS"
  exit 0
fi

# Ensure coaching directory exists
COACHING_DIR="${CWD}/.claude/.coaching"
mkdir -p "$COACHING_DIR"

STATE_FILE="${COACHING_DIR}/state.json"
RECS_FILE="${COACHING_DIR}/recommendations.md"
HISTORY_DIR="${COACHING_DIR}/history"

# Run TypeScript analyzer via Bun
# stderr redirected to /dev/null -- coaching failures are non-blocking
bun "${CLAUDE_PLUGIN_ROOT}/hooks/coaching/analyzer.ts" \
  --transcript "$TRANSCRIPT_PATH" \
  --session-id "$SESSION_ID" \
  --rules "${CLAUDE_PLUGIN_ROOT}/hooks/coaching/rules.json" \
  --state "$STATE_FILE" \
  --output "$RECS_FILE" \
  --history-dir "$HISTORY_DIR" \
  2>/dev/null || true

exit 0
