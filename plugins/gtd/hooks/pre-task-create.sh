#!/usr/bin/env bash
# pre-task-create.sh
# PreToolUse hook for TaskCreate: injects gtdParent metadata when there is an active GTD task.
# Input:  JSON via stdin { tool_name, tool_input, ... }
# Output: JSON { hookSpecificOutput: { updatedInput: <modified tool_input> } }
#         or empty/exit 0 for passthrough (no modification)

set -euo pipefail

# Source shared library (also checks for jq)
source "$(dirname "$0")/gtd-lib.sh"

# Read hook input
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)

[ -z "$CWD" ] && exit 0

# Get tool_input from hook JSON
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // empty' 2>/dev/null || true)
[ -z "$TOOL_INPUT" ] && exit 0

# If metadata.gtdParent already set, pass through unchanged
EXISTING_PARENT=$(echo "$TOOL_INPUT" | jq -r '.metadata.gtdParent // empty' 2>/dev/null || true)
[ -n "$EXISTING_PARENT" ] && exit 0

# If metadata.gtdId already set, this is a hydrated task — pass through
EXISTING_GTD_ID=$(echo "$TOOL_INPUT" | jq -r '.metadata.gtdId // empty' 2>/dev/null || true)
[ -n "$EXISTING_GTD_ID" ] && exit 0

# Get active task ID from GTD store
ACTIVE_ID=$(gtd_active_task)

# No active task — pass through unchanged
[ -z "$ACTIVE_ID" ] && exit 0

# Inject gtdParent into tool_input metadata
UPDATED_INPUT=$(echo "$TOOL_INPUT" | jq --arg parent "$ACTIVE_ID" \
  'if .metadata then .metadata.gtdParent = $parent else .metadata = {gtdParent: $parent} end')

# Output the updatedInput response
OUTPUT=$(jq -n --argjson updated "$UPDATED_INPUT" \
  '{hookSpecificOutput: {updatedInput: $updated}}')

printf '%s' "$OUTPUT"
exit 0
