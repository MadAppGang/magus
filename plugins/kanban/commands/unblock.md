---
name: unblock
description: "Remove a blocking dependency. Usage: /kanban:unblock #id [#blocker-id]"
---

# Kanban Unblock

You are implementing the kanban unblock command. The user wants to remove a blocking dependency.

## Semantics

- `/kanban:unblock #5 #3` — remove the specific dependency: #3 no longer blocks #5
- `/kanban:unblock #5` — remove ALL blockers from #5

## Parse the Input

Extract from the command arguments:
- **id**: The task being unblocked (numeric, e.g., `5` or `#5`)
- **blocker-id** (optional): Specific blocker to remove (numeric, e.g., `3` or `#3`)

## Execute

```bash
# Set from parsed input
TASK_ID="<numeric id>"      # the task to unblock
BLOCKER_ID=""               # specific blocker to remove (or empty to remove all)

CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
KANBAN_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/kanban-lib.sh"

# Perform unblock
if [ -n "$BLOCKER_ID" ]; then
  bash -c "source \"${KANBAN_LIB}\" && CWD=\"${CWD}\" kanban_unblock \"$TASK_ID\" \"$BLOCKER_ID\""
else
  bash -c "source \"${KANBAN_LIB}\" && CWD=\"${CWD}\" kanban_unblock \"$TASK_ID\""
fi
RESULT=$?

if [ $RESULT -ne 0 ]; then
  echo "Error: Task #${TASK_ID} not found."
  exit 1
fi

# Display confirmation
bun run "${CLAUDE_PLUGIN_ROOT}/tools/kanban-display.ts" unblocked "$TASK_ID"
```

## After Unblocking

- Confirm the unblock operation.
- If the task is now fully unblocked (no remaining blockers), say "Task #id is now ready to start."
- Suggest `/kanban:move #id todo` or `/kanban:move #id in-progress` if appropriate.
