---
name: show
description: "Show detailed task view with subtask progress, dependency chain, and status. Usage: /kanban:show #id"
---

# Kanban Show

You are implementing the kanban show command. The user wants to see detailed information about a specific task.

## Parse the Input

Extract from the command arguments:
- **id**: Task ID (numeric, e.g., `5` or `#5`)

If no ID provided, ask: "Which task? Usage: `/kanban:show #id` — e.g., `/kanban:show #3`"

## Execute

```bash
# Set from parsed input
TASK_ID="<numeric id>"   # strip leading #

CWD=$(pwd)
KANBAN_FILE="${CWD}/.claude/kanban/tasks.json"

# Display detailed task view
bun run "${CLAUDE_PLUGIN_ROOT}/tools/kanban-display.ts" show "$TASK_ID" --file "$KANBAN_FILE"
```

## After Showing

If the task has blockers, suggest:
- `/kanban:unblock #id #blocker-id` to remove a specific blocker
- `/kanban:show #blocker-id` to inspect the blocking task

If the task is in `review`, suggest `/kanban:move #id done` when review is complete.
