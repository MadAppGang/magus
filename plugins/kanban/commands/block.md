---
name: block
description: "Add a blocking dependency between tasks. Usage: /kanban:block #id #blocker-id"
---

# Kanban Block

You are implementing the kanban block command. The user wants to declare that one task blocks another.

## Semantics

`/kanban:block #5 #3` means: **task #3 blocks task #5** (i.e., #5 cannot proceed until #3 is done).
- #5 gains `dependencies.blockedBy: ["3"]`
- #3 gains `dependencies.blocks: ["5"]`

## Parse the Input

Extract from the command arguments:
- **id**: The task being blocked (numeric, e.g., `5` or `#5`)
- **blocker-id**: The task that blocks it (numeric, e.g., `3` or `#3`)

If either is missing, ask: "Usage: `/kanban:block #id #blocker-id` — e.g., `/kanban:block #5 #3` (task #3 blocks task #5)"

## Execute

```bash
# Set from parsed input
TASK_ID="<numeric id>"      # the task being blocked
BLOCKER_ID="<numeric id>"   # the task that blocks it

CWD=$(pwd)
KANBAN_FILE="${CWD}/.claude/kanban/tasks.json"
KANBAN_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/kanban-lib.sh"

# Detect circular dependencies before adding
bash -c "source \"${KANBAN_LIB}\" && CWD=\"${CWD}\" kanban_detect_cycle \"$TASK_ID\" \"$BLOCKER_ID\""
CYCLE_RESULT=$?

if [ $CYCLE_RESULT -ne 0 ]; then
  echo "Error: Adding this dependency would create a cycle. #${BLOCKER_ID} already depends on #${TASK_ID}."
  exit 1
fi

# Add the dependency
bash -c "source \"${KANBAN_LIB}\" && CWD=\"${CWD}\" kanban_block \"$TASK_ID\" \"$BLOCKER_ID\""
RESULT=$?

if [ $RESULT -ne 0 ]; then
  echo "Error: One or both tasks not found."
  exit 1
fi

# Display confirmation
bun run "${CLAUDE_PLUGIN_ROOT}/tools/kanban-display.ts" blocked "$TASK_ID" "$BLOCKER_ID"
```

## After Blocking

- Confirm: "#id is now blocked by #blocker-id."
- If #id is currently in-progress, suggest resolving the blocker first.
- Suggest `/kanban:show #id` to see the full dependency chain.
