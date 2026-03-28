---
name: list
description: "List tasks filtered by kanban criteria. Usage: /kanban:list [--status in-progress] [--blocked] [--ready] [--priority high]"
---

# Kanban List

You are implementing the kanban list command. The user wants a filtered list of board tasks.

## Parse the Input

Extract optional filters from the command arguments:
- `--status <status>` — filter by kanban column: backlog, todo, in-progress, review, done
- `--blocked` — show only tasks that have open blockers
- `--ready` — show tasks with no incomplete blockers (ready to start)
- `--priority <level>` — filter by priority: urgent, high, medium, low

## Execute

```bash
# Set filter variables from parsed input
STATUS_FILTER=""     # e.g. "in-progress" or ""
SHOW_BLOCKED=false   # true if --blocked
SHOW_READY=false     # true if --ready
PRIORITY_FILTER=""   # e.g. "high" or ""

CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
KANBAN_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/kanban-lib.sh"

# Build jq filter
JQ_FILTER='.tasks[] | select(.completed == null and .kanbanStatus != null)'

if [ -n "$STATUS_FILTER" ]; then
  JQ_FILTER="${JQ_FILTER} | select(.kanbanStatus == \"${STATUS_FILTER}\")"
fi

if [ -n "$PRIORITY_FILTER" ]; then
  JQ_FILTER="${JQ_FILTER} | select(.priority == \"${PRIORITY_FILTER}\")"
fi

if [ "$SHOW_BLOCKED" = "true" ]; then
  JQ_FILTER="${JQ_FILTER} | select((.dependencies.blockedBy // []) | length > 0)"
fi

if [ "$SHOW_READY" = "true" ]; then
  # Ready = on board + has no open blockers
  JQ_FILTER='.tasks as $all |
    .tasks[] |
    select(.completed == null and .kanbanStatus != null) |
    . as $t |
    select(
      (($t.dependencies.blockedBy // []) | length == 0) or
      (($t.dependencies.blockedBy // []) |
       all(. as $bid | ($all[] | select(.id == $bid and .completed != null) | true) // false))
    )'
fi

# Execute and display
jq -r "[$JQ_FILTER] |
  .[] |
  \"  \" +
  (if .priority == \"urgent\" then \"⚡U \" elif .priority == \"high\" then \"⚡H \" elif .priority == \"medium\" then \"·M \" elif .priority == \"low\" then \"·L \" else \"   \" end) +
  \"[\" + (.kanbanStatus // \"none\") + \"] \" +
  \"#\" + .id + \" \" + .subject +
  (if (.dependencies.blockedBy // []) | length > 0 then \" ⛔\" else \"\" end)" \
  "$GTD_FILE"
```

## After Listing

- Show a count: "N tasks match your filter."
- If `--ready` and results found: "These tasks have no blockers and are ready to start."
- If `--blocked` and results found: "Use `/kanban:unblock #id` or `/kanban:show #id` to investigate blockers."
- If no results: "No tasks match that filter. Try `/kanban:board` for a full view."
