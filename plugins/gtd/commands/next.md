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

## Load and Display Tasks

Run this Bash command (adapt filters based on parsed arguments):

```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"

if [ ! -f "$GTD_FILE" ]; then
  echo -e "\033[90mNo GTD store found. Run /gtd:capture to get started.\033[0m"
  exit 0
fi

# Set filter variables (replace with actual parsed values)
CONTEXT_FILTER=""    # e.g. "@code" or ""
ENERGY_FILTER=""     # e.g. "high" or ""
TIME_FILTER=""       # e.g. "60" or ""
PROJECT_FILTER=""    # e.g. "auth-refactor" or ""
SHOW_WAITING=false   # true if --waiting flag

# Build jq filter
if [ "$SHOW_WAITING" = "true" ]; then
  LIST_FILTER="waiting"
else
  LIST_FILTER="next"
fi

# Run jq query to get filtered tasks
TASKS=$(jq \
  --arg list "$LIST_FILTER" \
  --arg ctx "$CONTEXT_FILTER" \
  --arg energy "$ENERGY_FILTER" \
  --argjson time_max "${TIME_FILTER:-999999}" \
  '[.tasks[] | select(
    .list == $list and
    .completed == null and
    (if $ctx != "" then (.context | contains([$ctx])) else true end) and
    (if $energy != "" then .energy == $energy else true end) and
    (if $time_max < 999999 then (.timeEstimate != null and .timeEstimate <= $time_max) else true end)
  )] | sort_by(.energy // "zzz", .subject)' "$GTD_FILE")

TASK_COUNT=$(echo "$TASKS" | jq 'length')

if [ "$SHOW_WAITING" = "true" ]; then
  echo -e "\033[93mWaiting For\033[0m \033[90m(${TASK_COUNT})\033[0m"
else
  echo -e "\033[92mNext Actions\033[0m \033[90m(${TASK_COUNT})\033[0m"
fi
echo ""

if [ "$TASK_COUNT" -eq 0 ]; then
  echo -e "\033[90mNo tasks match. Try /gtd:process to clarify inbox items.\033[0m"
  exit 0
fi

# Group by project (parentId -> project subject)
echo "$TASKS" | jq -r '
  group_by(.parentId) |
  .[] |
  (.[0].parentId // "(unassigned)") as $project |
  "\n\033[97m" + $project + "\033[0m",
  (.[] |
    (if .energy == "high" then "\033[92m" elif .energy == "low" then "\033[90m" else "\033[93m" end) as $color |
    (if .list == "waiting" then "\033[93m[W]\033[0m" else "\033[92m[G]\033[0m" end) as $marker |
    "  " + $marker + " " + $color + .subject + "\033[0m" +
    (if .context | length > 0 then "  \033[90m" + (.context | join(" ")) + "\033[0m" else "" end) +
    (if .timeEstimate != null then "  \033[90m" + (.timeEstimate | tostring) + "min\033[0m" else "" end) +
    (if .energy != null then "  \033[90m" + .energy + "\033[0m" else "" end) +
    (if .waitingOn != null then "  \033[93mwaiting: " + .waitingOn + "\033[0m" else "" end)
  )
' 2>/dev/null || echo "$TASKS" | jq -r '.[] | "  - " + .subject'
```

## After Showing Tasks

- If tasks were shown: offer "Run `/gtd:work <id>` to set an active task, or `/gtd:process` to clarify inbox items."
- If `--waiting` was used: mention checking for follow-ups on items waiting > 7 days.
- If no filters applied and > 10 tasks: suggest using `--context @code` or `--energy high` to narrow down.
