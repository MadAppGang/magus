---
name: work
description: "Set the active GTD task to focus on. Usage: /gtd:work <task-id or name>"
---

# GTD Work — Set Active Task

You are implementing the GTD work command. The user wants to focus on a specific GTD task, loading its subtasks into the current session.

## Parse the Input

The user invoked `/gtd:work` with a task identifier. Extract:
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
  echo -e "\033[91mNo GTD store found.\033[0m Run \033[97m/gtd:capture\033[0m to create one."
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
  echo -e "\033[91mTask not found:\033[0m \"$IDENTIFIER\""
  echo "Run \033[97m/gtd:next\033[0m to see available tasks."
  exit 0
fi

TASK_ID=$(echo "$TASK" | jq -r '.id')
TASK_SUBJECT=$(echo "$TASK" | jq -r '.subject')

# Set as active task
TMP="${GTD_FILE}.tmp.$$"
jq --arg id "$TASK_ID" '.activeTaskId = $id' "$GTD_FILE" > "$TMP" && mv "$TMP" "$GTD_FILE"

# Count subtasks (parentId == task_id)
SUBTASK_COUNT=$(jq --arg id "$TASK_ID" '[.tasks[] | select(.parentId == $id and .completed == null)] | length' "$GTD_FILE")

echo -e "\033[92mActive task set:\033[0m \033[97m${TASK_SUBJECT}\033[0m \033[90m[${TASK_ID}]\033[0m"
echo -e "\033[90mSubtasks: ${SUBTASK_COUNT} pending\033[0m"
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
    echo -e "\033[90mNo active task set. Use /gtd:work <task-id> to focus.\033[0m"
  fi
fi
```
