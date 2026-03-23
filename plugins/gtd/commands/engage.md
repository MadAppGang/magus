---
name: engage
description: "Set the active GTD task to focus on. Usage: /gtd:engage <task-id or name>"
---

# GTD Engage — Set Active Task

You are implementing the GTD engage command. The user wants to focus on a specific GTD task, loading its subtasks into the current session.

## Parse the Input

The user invoked `/gtd:engage` with a task identifier. Extract:
- **identifier**: Task ID (e.g., `gtd-a1b2c3`) or partial task subject text to search

## Find the Task

Run this Bash command to find and set the active task:

```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
GTD_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/gtd-lib.sh"

IDENTIFIER="<user input>"

# Check if GTD store exists
if [ ! -f "$GTD_FILE" ]; then
  echo "No GTD store found. Run /gtd:capture to create one."
  exit 0
fi

# Search by ID or subject (case-insensitive partial match)
TASK=$(jq --arg id "$IDENTIFIER" --arg search "$IDENTIFIER" '
  .tasks[] | select(
    .completed == null and
    (.id == $id or (.subject | ascii_downcase | contains($search | ascii_downcase)))
  )
' "$GTD_FILE" | head -1)

if [ -z "$TASK" ]; then
  echo "Task not found: \"$IDENTIFIER\". Run /gtd:next to see available tasks."
  exit 0
fi

TASK_ID=$(echo "$TASK" | jq -r '.id')
TASK_SUBJECT=$(echo "$TASK" | jq -r '.subject')

# Set as active task
TMP="${GTD_FILE}.tmp.$$"
jq --arg id "$TASK_ID" '.activeTaskId = $id' "$GTD_FILE" > "$TMP" && mv "$TMP" "$GTD_FILE"

# Count subtasks (parentId == task_id)
SUBTASK_COUNT=$(jq --arg id "$TASK_ID" '[.tasks[] | select(.parentId == $id and .completed == null)] | length' "$GTD_FILE")

# Display confirmation with subtask tree
bun run "${CLAUDE_PLUGIN_ROOT}/tools/gtd-display.ts" engage "$TASK_ID"
```

## After Setting Active Task

1. Tell the user which task is now active and how many subtasks it has.
2. Load any existing subtasks (tasks where parentId == the active task ID) into the session TaskList via TaskCreate with metadata `{ gtdId: "<subtask_id>", gtdParent: "<active_id>" }`.
3. Show the active task's details: subject, context, energy, timeEstimate if set.
4. Offer: "Run `/gtd:next` to see all next actions, or `/gtd:status` for the full dashboard."

If the user provides no argument, show the current active task:
```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
if [ -f "$GTD_FILE" ]; then
  ACTIVE_ID=$(jq -r '.activeTaskId // empty' "$GTD_FILE")
  if [ -n "$ACTIVE_ID" ]; then
    jq --arg id "$ACTIVE_ID" '.tasks[] | select(.id == $id)' "$GTD_FILE"
  else
    echo "No active task set. Use /gtd:engage <task-id> to focus."
  fi
fi
```
