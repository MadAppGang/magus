---
name: board
description: "Show the kanban board. Usage: /kanban:board [--filter @context] [--project #id] [--compact]"
---

# Kanban Board

You are implementing the kanban board display command. The user wants to see their tasks organized as a kanban board.

## Parse the Input

Extract optional filters from the command arguments:
- `--filter @context` — filter tasks by context tag (e.g., `@code`, `@review`)
- `--project #id` — filter tasks belonging to a specific project ID
- `--compact` — compact display mode (fewer details per card)

## Execute

Run this Bash command to display the kanban board:

```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
KANBAN_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/kanban-lib.sh"

# Ensure tasks store exists with kanban schema
bash -c "source \"${KANBAN_LIB}\" && CWD=\"${CWD}\" kanban_init"

# Build display args
DISPLAY_ARGS="board"
FILTER_CONTEXT=""   # e.g. "@code" or ""
FILTER_PROJECT=""   # e.g. "5" (numeric ID) or ""
COMPACT=false       # true if --compact

[ -n "$FILTER_CONTEXT" ] && DISPLAY_ARGS="$DISPLAY_ARGS --filter $FILTER_CONTEXT"
[ -n "$FILTER_PROJECT" ] && DISPLAY_ARGS="$DISPLAY_ARGS --project $FILTER_PROJECT"
[ "$COMPACT" = "true" ] && DISPLAY_ARGS="$DISPLAY_ARGS --compact"

TERM_WIDTH=$(tput cols 2>/dev/null || echo 80)
bun run "${CLAUDE_PLUGIN_ROOT}/tools/kanban-display.ts" $DISPLAY_ARGS --file "$GTD_FILE" --width "$TERM_WIDTH"
```

## After Showing the Board

- Point out any columns that exceed the WIP limit (default 3 tasks in-progress)
- Mention tasks that are blocked (have unresolved blockers) with `⛔` indicator
- Suggest `/kanban:move #id <status>` to move a highlighted task
- If board is empty: "Add tasks with `/kanban:add \"title\"` or use `/gtd:capture` and they'll appear here once clarified."
