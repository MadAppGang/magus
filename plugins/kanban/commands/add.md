---
name: add
description: "Add a new task directly to the kanban board. Usage: /kanban:add \"title\" [--status todo] [--priority high]"
---

# Kanban Add

You are implementing the kanban add command. The user wants to create a new task and place it directly on the board.

## Parse the Input

Extract from the command arguments:
- **title**: The task title (text in quotes, or all non-flag arguments)
- `--status <status>` — kanban column: backlog, todo, in-progress, review, done (default: todo)
- `--priority <level>` — priority: urgent, high, medium, low (default: null)
- `--context @tag` — context tag (e.g., `@code`, `@review`)

If no title was provided, ask: "What task do you want to add to the board? (e.g., `/kanban:add \"Fix login bug\" --status todo --priority high`)"

## Execute

```bash
# Set from parsed input
TITLE="<task title>"
STATUS="todo"       # backlog | todo | in-progress | review | done
PRIORITY=""         # urgent | high | medium | low (or empty)
CONTEXT_TAG=""      # e.g. "@code" or ""

CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
KANBAN_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/kanban-lib.sh"

# Ensure store exists
bash -c "source \"${KANBAN_LIB}\" && CWD=\"${CWD}\" kanban_init"

# Allocate ID
ID=$(bash -c "source \"${KANBAN_LIB}\" && CWD=\"${CWD}\" kanban_new_id")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build task JSON — new fields are optional (null by default)
TASK=$(jq -n \
  --arg id "$ID" \
  --arg subject "$TITLE" \
  --arg created "$NOW" \
  --arg context "$CONTEXT_TAG" \
  --arg status "$STATUS" \
  --arg priority "$PRIORITY" \
  '{
    id: $id,
    subject: $subject,
    list: "next",
    context: (if $context != "" then [$context] else [] end),
    parentId: null,
    energy: null,
    timeEstimate: null,
    waitingOn: null,
    dueDate: null,
    created: $created,
    modified: $created,
    completed: null,
    notes: "",
    kanbanStatus: $status,
    priority: (if $priority != "" then $priority else null end),
    dependencies: null,
    subtasks: null
  }')

# Atomic append
TMP="${GTD_FILE}.tmp.$$"
jq --argjson task "$TASK" '.tasks += [$task]' "$GTD_FILE" > "$TMP" && mv "$TMP" "$GTD_FILE"

# Display confirmation
bun run "${CLAUDE_PLUGIN_ROOT}/tools/kanban-display.ts" added "$ID" "$TITLE"
```

## After Adding

Tell the user the task was added to the `<status>` column with ID `#<id>`.
Suggest `/kanban:board` to view the full board.
