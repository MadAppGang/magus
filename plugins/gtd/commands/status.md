---
name: status
description: "Show the GTD dashboard with color-coded task counts. Usage: /gtd:status [--json]"
---

# GTD Status Dashboard

You are implementing the GTD status command. The user wants an ANSI-colored dashboard showing the current state of their GTD system at a glance.

## Parse the Input

- `--json` flag: output machine-readable JSON instead of ANSI dashboard

## Run the Dashboard

Execute this Bash command to render the ANSI status dashboard:

```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"

# Check if GTD store exists
if [ ! -f "$GTD_FILE" ]; then
  echo -e "\033[90m┌── GTD Status ──────────────────────────────────────────────────────────────┐\033[0m"
  echo -e "\033[90m│\033[0m No GTD store found. Run \033[97m/gtd:capture \"<task>\"\033[0m to get started.             \033[90m│\033[0m"
  echo -e "\033[90m└────────────────────────────────────────────────────────────────────────────┘\033[0m"
  exit 0
fi

# Load counts
INBOX=$(jq '[.tasks[] | select(.list == "inbox" and .completed == null)] | length' "$GTD_FILE")
NEXT=$(jq '[.tasks[] | select(.list == "next" and .completed == null)] | length' "$GTD_FILE")
WAITING=$(jq '[.tasks[] | select(.list == "waiting" and .completed == null)] | length' "$GTD_FILE")
SOMEDAY=$(jq '[.tasks[] | select(.list == "someday" and .completed == null)] | length' "$GTD_FILE")
PROJECTS=$(jq '[.tasks[] | select(.list == "project" and .completed == null)] | length' "$GTD_FILE")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
OVERDUE=$(jq --arg now "$NOW" '[.tasks[] | select(.list == "next" and .completed == null and .dueDate != null and .dueDate < $now)] | length' "$GTD_FILE")

# Get first next action
NEXT_ACTION=$(jq -r '[.tasks[] | select(.list == "next" and .completed == null)] | first | .subject // empty' "$GTD_FILE")
NEXT_ACTION_CTX=$(jq -r '[.tasks[] | select(.list == "next" and .completed == null)] | first | (.context | join(" ")) // empty' "$GTD_FILE")
NEXT_ACTION_TIME=$(jq -r '[.tasks[] | select(.list == "next" and .completed == null)] | first | .timeEstimate // empty' "$GTD_FILE")
NEXT_ACTION_ENERGY=$(jq -r '[.tasks[] | select(.list == "next" and .completed == null)] | first | .energy // empty' "$GTD_FILE")

# Get active task
ACTIVE_SUBJECT=$(jq -r '
  (.activeTaskId // empty) as $id |
  if $id then (.tasks[] | select(.id == $id) | .subject) else empty end
' "$GTD_FILE" 2>/dev/null || true)

# Weekly review status
LAST_REVIEW=$(jq -r '.lastReview // empty' "$GTD_FILE")
if [ -z "$LAST_REVIEW" ]; then
  REVIEW_STATUS="Never"
  REVIEW_COLOR="\033[91m"
else
  # Calculate days ago (macOS/Linux compatible)
  if date -j >/dev/null 2>&1; then
    LAST_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_REVIEW" "+%s" 2>/dev/null || echo "0")
  else
    LAST_EPOCH=$(date -u -d "$LAST_REVIEW" "+%s" 2>/dev/null || echo "0")
  fi
  NOW_EPOCH=$(date -u "+%s")
  DAYS_AGO=$(( (NOW_EPOCH - LAST_EPOCH) / 86400 ))
  DAYS_UNTIL=$(( 7 - DAYS_AGO ))

  if [ "$DAYS_AGO" -ge 14 ]; then
    REVIEW_STATUS="${DAYS_AGO} days ago — OVERDUE"
    REVIEW_COLOR="\033[91m"
  elif [ "$DAYS_AGO" -ge 7 ]; then
    REVIEW_STATUS="${DAYS_AGO} days ago — due now"
    REVIEW_COLOR="\033[93m"
  else
    REVIEW_STATUS="${DAYS_AGO} days ago — due in ${DAYS_UNTIL} days"
    REVIEW_COLOR="\033[92m"
  fi
fi

# Render dashboard
echo -e "\033[90m┌── GTD Status ──────────────────────────────────────────────────────────────┐\033[0m"
printf "\033[90m│\033[0m \033[95mInbox:\033[0m %-4s \033[90m│\033[0m \033[92mNext:\033[0m %-4s \033[90m│\033[0m \033[93mWaiting:\033[0m %-4s \033[90m│\033[0m \033[96mSomeday:\033[0m %-5s \033[90m│\033[0m \033[97mProjects:\033[0m %-3s \033[90m│\033[0m" \
  "$INBOX" "$NEXT" "$WAITING" "$SOMEDAY" "$PROJECTS"
if [ "$OVERDUE" -gt 0 ]; then
  printf " \033[91mOverdue:\033[0m %-2s \033[90m│\033[0m\n" "$OVERDUE"
else
  printf " \033[90mOverdue:\033[0m 0  \033[90m│\033[0m\n"
fi

# Active task line
if [ -n "$ACTIVE_SUBJECT" ]; then
  printf "\033[90m│\033[0m \033[97mActive:\033[0m %-69s \033[90m│\033[0m\n" "${ACTIVE_SUBJECT:0:69}"
fi

# Next action line
if [ -n "$NEXT_ACTION" ]; then
  NEXT_DETAIL="${NEXT_ACTION}"
  [ -n "$NEXT_ACTION_CTX" ] && NEXT_DETAIL="${NEXT_DETAIL} (${NEXT_ACTION_CTX}"
  [ -n "$NEXT_ACTION_TIME" ] && NEXT_DETAIL="${NEXT_DETAIL}, ${NEXT_ACTION_TIME}min"
  [ -n "$NEXT_ACTION_ENERGY" ] && NEXT_DETAIL="${NEXT_DETAIL}, ${NEXT_ACTION_ENERGY}"
  [ -n "$NEXT_ACTION_CTX" ] && NEXT_DETAIL="${NEXT_DETAIL})"
  printf "\033[90m│\033[0m Next: %-71s \033[90m│\033[0m\n" "${NEXT_DETAIL:0:71}"
fi

# Review line
printf "\033[90m│\033[0m Weekly Review: %b%-57s\033[0m \033[90m│\033[0m\n" "$REVIEW_COLOR" "${REVIEW_STATUS:0:57}"
echo -e "\033[90m└────────────────────────────────────────────────────────────────────────────┘\033[0m"
```

## If --json Flag

Output structured JSON instead:

```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ ! -f "$GTD_FILE" ]; then
  echo '{"error": "No GTD store found"}'
  exit 0
fi

jq --arg now "$NOW" '{
  counts: {
    inbox: [.tasks[] | select(.list == "inbox" and .completed == null)] | length,
    next: [.tasks[] | select(.list == "next" and .completed == null)] | length,
    waiting: [.tasks[] | select(.list == "waiting" and .completed == null)] | length,
    someday: [.tasks[] | select(.list == "someday" and .completed == null)] | length,
    projects: [.tasks[] | select(.list == "project" and .completed == null)] | length,
    overdue: [.tasks[] | select(.list == "next" and .completed == null and .dueDate != null and .dueDate < $now)] | length
  },
  activeTaskId: .activeTaskId,
  lastReview: .lastReview,
  nextAction: first([.tasks[] | select(.list == "next" and .completed == null)])
}' "$GTD_FILE"
```

## After Showing Status

Offer contextual suggestions based on counts:
- Inbox > 5: "You have many unprocessed items. Run `/gtd:process` to clarify them."
- Next == 0 and Inbox > 0: "No next actions! Run `/gtd:process` to move inbox items to next actions."
- Overdue > 0: "You have overdue items. Check `/gtd:next` to address them."
- Review overdue: "Your weekly review is overdue. Run `/gtd:review` when you have 15 minutes."
- Everything healthy: "Your GTD system is in good shape!"
