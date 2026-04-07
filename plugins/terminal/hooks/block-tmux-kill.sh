#!/usr/bin/env bash
# PreToolUse hook: Block tmux kill-server from Claude Code sessions.
# Receives tool input JSON on stdin. Exit 0 = allow, exit 2 = block.
set -euo pipefail

INPUT=$(cat)

# Extract the command from Bash tool input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Check for tmux kill-server (with various whitespace patterns)
if echo "$COMMAND" | grep -qE '(^|;|&&|\|)\s*tmux\s+kill-server'; then
  echo "BLOCKED: tmux kill-server would destroy all sessions and running processes."
  echo "If you really need this, ask the user to run it manually."
  exit 2
fi

exit 0
