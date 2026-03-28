---
name: move
description: "Move a task between kanban columns. Usage: /kanban:move #id <status>"
---

# Kanban Move

You are implementing the kanban move command. The user wants to move a task to a different column.

## Parse the Input

Extract from the command arguments:
- **id**: Task ID (numeric, e.g., `5` or `#5`)
- **status**: Target column: `backlog`, `todo`, `in-progress`, `review`, `done`

If either is missing, ask: "Usage: `/kanban:move #id <status>` — e.g., `/kanban:move #3 in-progress`"

## Execute

```bash
# Set from parsed input
TASK_ID="<numeric id>"   # strip leading #
NEW_STATUS="<status>"    # backlog | todo | in-progress | review | done

CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
KANBAN_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/kanban-lib.sh"

# Check for blockers before moving to in-progress
if [ "$NEW_STATUS" = "in-progress" ]; then
  BLOCKERS=$(jq -r --arg id "$TASK_ID" \
    '.tasks[] | select(.id == $id) | .dependencies.blockedBy // [] | .[]' \
    "$GTD_FILE" 2>/dev/null)

  if [ -n "$BLOCKERS" ]; then
    # Check if any blockers are incomplete
    OPEN_BLOCKERS=$(jq -r --arg id "$TASK_ID" \
      '.tasks as $all |
       (.tasks[] | select(.id == $id) | .dependencies.blockedBy // []) as $blockers |
       $blockers[] as $bid |
       ($all[] | select(.id == $bid and .completed == null) | .id)' \
      "$GTD_FILE" 2>/dev/null)

    if [ -n "$OPEN_BLOCKERS" ]; then
      echo "Warning: Task #${TASK_ID} has open blockers: $(echo $OPEN_BLOCKERS | tr '\n' ' '). Moving anyway (soft block)."
    fi
  fi
fi

# Perform the move
bash -c "source \"${KANBAN_LIB}\" && CWD=\"${CWD}\" kanban_move \"$TASK_ID\" \"$NEW_STATUS\""
RESULT=$?

if [ $RESULT -ne 0 ]; then
  echo "Error: Task #${TASK_ID} not found."
  exit 1
fi

# Get task title for confirmation
TITLE=$(jq -r --arg id "$TASK_ID" '.tasks[] | select(.id == $id) | .subject' "$GTD_FILE")

# Display confirmation
bun run "${CLAUDE_PLUGIN_ROOT}/tools/kanban-display.ts" moved "$TASK_ID" "$NEW_STATUS" "$TITLE"

# If moving to done, check if this unblocks other tasks
if [ "$NEW_STATUS" = "done" ]; then
  UNBLOCKED=$(jq -r --arg id "$TASK_ID" \
    '.tasks[] | select(
      .completed == null and
      (.dependencies.blockedBy // [] | contains([$id])) and
      (.dependencies.blockedBy // [] | map(. != $id) | all(. == false) or length == 1)
    ) | "#\(.id) \(.subject)"' \
    "$GTD_FILE" 2>/dev/null)

  if [ -n "$UNBLOCKED" ]; then
    echo ""
    echo "Unblocked tasks (ready to start):"
    echo "$UNBLOCKED"
  fi
fi
```

## After Moving

- Confirm: "Task #id moved to `<status>`."
- If there were open blockers when moving to in-progress, note the warning.
- If moved to done and tasks were unblocked, mention them: "These tasks are now unblocked: ..."
- If moved to in-progress and the dev plugin is installed (check if `/dev:dev` is available): suggest "Ready to implement? Run `/dev:dev` to start development, or `/dev:debug` to fix a bug."
- Suggest `/kanban:board` to see the updated board.
