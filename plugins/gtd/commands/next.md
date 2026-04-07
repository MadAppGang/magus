---
name: next
description: "Show next actions, optionally filtered by context, energy, or time. Usage: /gtd:next [--context @tag] [--energy high|medium|low] [--time <minutes>] [--waiting]"
---

# GTD Next Actions

You are implementing the GTD next command. The user wants to see their actionable next actions, optionally filtered.

## Parse the Input

Extract optional filters from the command arguments:
- `--context @tag` — filter by context tag (e.g., `@code`, `@review`)
- `--energy high|medium|low` — filter by energy level
- `--time <minutes>` — show only tasks taking <= N minutes
- `--project <name>` — filter by project name
- `--waiting` — show Waiting For list instead of Next Actions

## Display Tasks

Run this Bash command (set filter variables based on parsed arguments):

```bash
# Set filter variables from parsed input (replace with actual values or leave empty)
CONTEXT_FILTER=""    # e.g. "@code" or ""
ENERGY_FILTER=""     # e.g. "high" or ""
TIME_FILTER=""       # e.g. "60" or ""
SHOW_WAITING=false   # true if --waiting flag

# Build display command
DISPLAY_ARGS="next"
[ -n "$CONTEXT_FILTER" ] && DISPLAY_ARGS="$DISPLAY_ARGS --context $CONTEXT_FILTER"
[ -n "$ENERGY_FILTER" ] && DISPLAY_ARGS="$DISPLAY_ARGS --energy $ENERGY_FILTER"
[ -n "$TIME_FILTER" ] && DISPLAY_ARGS="$DISPLAY_ARGS --time $TIME_FILTER"
[ "$SHOW_WAITING" = "true" ] && DISPLAY_ARGS="$DISPLAY_ARGS --waiting"

bun run "${CLAUDE_PLUGIN_ROOT}/tools/gtd-display.ts" $DISPLAY_ARGS
```

## After Showing Tasks

- If tasks were shown: offer "Run `/gtd:engage <id>` to set an active task, or `/gtd:clarify` to clarify inbox items."
- If `--waiting` was used: mention checking for follow-ups on items waiting > 7 days.
- If no filters applied and > 10 tasks: suggest using `--context @code` or `--energy high` to narrow down.
