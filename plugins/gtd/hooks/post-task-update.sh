#!/usr/bin/env bash
# post-task-update.sh
# PostToolUse hook for TaskUpdate: syncs task status changes back to GTD store.
# Input:  JSON via stdin { tool_name, tool_input, tool_response, cwd, ... }
# Output: nothing (side effect: updates tasks.json)
#
# Behavior:
# - If status == "completed" and metadata.gtdId exists: mark completed in tasks.json
# - If status == "deleted" and metadata.gtdId exists: mark deleted in tasks.json

set -euo pipefail

# Source shared library (also checks for jq)
source "$(dirname "$0")/gtd-lib.sh"

# Read hook input
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)

[ -z "$CWD" ] && exit 0

# Get tool_input from hook JSON
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // empty' 2>/dev/null || true)
[ -z "$TOOL_INPUT" ] || [ "$TOOL_INPUT" = "null" ] && exit 0

# Get gtdId from metadata — only act if this task is tracked in GTD store
GTD_ID=$(echo "$TOOL_INPUT" | jq -r '.metadata.gtdId // empty' 2>/dev/null || true)
[ -z "$GTD_ID" ] && exit 0

# Initialize GTD store if needed (defensive)
gtd_init

# Verify this task exists in the GTD store
TASK_EXISTS=$(gtd_read | jq --arg id "$GTD_ID" '[.tasks[] | select(.id == $id)] | length')
[ "$TASK_EXISTS" -eq 0 ] && exit 0

# Get new status from tool_input
NEW_STATUS=$(echo "$TOOL_INPUT" | jq -r '.status // empty' 2>/dev/null || true)
[ -z "$NEW_STATUS" ] && exit 0

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

case "$NEW_STATUS" in
  completed)
    gtd_update_task "$GTD_ID" ".completed = \"${NOW}\""
    ;;
  deleted)
    # Mark as deleted by setting list to "deleted" and completed timestamp
    gtd_update_task "$GTD_ID" ".list = \"deleted\" | .completed = \"${NOW}\""
    ;;
  in_progress)
    # Optionally track in_progress state (not strictly needed for GTD)
    gtd_update_task "$GTD_ID" ".notes = (.notes + \" [in_progress: ${NOW}]\" | ltrimstr(\" \"))"
    ;;
esac

exit 0
