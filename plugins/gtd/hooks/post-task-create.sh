#!/usr/bin/env bash
# post-task-create.sh
# PostToolUse hook for TaskCreate: syncs newly created session tasks to GTD store.
# Input:  JSON via stdin { tool_name, tool_input, tool_response, cwd, ... }
# Output: nothing (side effect: updates tasks.json)
#
# Behavior:
# - If metadata.gtdId exists: skip (hydrated task, already in store)
# - Otherwise: generate new GTD ID, append task to tasks.json
# - Tasks with gtdParent -> list: "next"; without -> list: "inbox"

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

# If metadata.gtdId exists, this task is already in the GTD store — skip
EXISTING_GTD_ID=$(echo "$TOOL_INPUT" | jq -r '.metadata.gtdId // empty' 2>/dev/null || true)
[ -n "$EXISTING_GTD_ID" ] && exit 0

# Initialize GTD store if needed
gtd_init

# Extract task fields from tool_input
SUBJECT=$(echo "$TOOL_INPUT" | jq -r '.subject // empty')
[ -z "$SUBJECT" ] && exit 0

GTD_PARENT=$(echo "$TOOL_INPUT" | jq -r '.metadata.gtdParent // empty' 2>/dev/null || true)

# Determine list based on whether this task has a GTD parent (subtask of active project)
if [ -n "$GTD_PARENT" ]; then
  LIST="next"
else
  LIST="inbox"
fi

# Generate new GTD ID
NEW_ID=$(gtd_new_id)

# Get current timestamp
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build task JSON object
TASK_JSON=$(jq -n \
  --arg id "$NEW_ID" \
  --arg subject "$SUBJECT" \
  --arg list "$LIST" \
  --arg parent "${GTD_PARENT:-}" \
  --arg created "$NOW" \
  '{
    id: $id,
    subject: $subject,
    list: $list,
    context: [],
    parentId: (if $parent != "" then $parent else null end),
    energy: null,
    timeEstimate: null,
    waitingOn: null,
    dueDate: null,
    created: $created,
    modified: $created,
    completed: null,
    notes: ""
  }')

# Append to GTD store atomically
echo "$TASK_JSON" | gtd_append_task

exit 0
