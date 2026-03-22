#!/usr/bin/env bash
# session-start-gtd.sh
# SessionStart hook: reads GTD state, injects context with task summary and nudges.
# Input:  JSON via stdin { cwd, session_id, ... }
# Output: JSON { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }
#
# IMPORTANT: additionalContext must use plain markdown only, NO raw ANSI escape codes.

set -euo pipefail

# Source shared library (also checks for jq)
source "$(dirname "$0")/gtd-lib.sh"

# Read hook input
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)

[ -z "$CWD" ] && exit 0

# Opt-out check
if ! gtd_suggestions_enabled; then
  exit 0
fi

# Initialize GTD store if needed (creates file on first run)
gtd_init

# Gather state
INBOX_COUNT=$(gtd_count_by_list "inbox")
NEXT_COUNT=$(gtd_count_by_list "next")
WAITING_COUNT=$(gtd_count_by_list "waiting")
OVERDUE_COUNT=$(gtd_count_overdue)
DAYS_SINCE_REVIEW=$(gtd_days_since_review)

# Determine what to show — stay silent when GTD state is healthy
SHOW_REVIEW_WARNING=false
SHOW_REVIEW_NUDGE=false
SHOW_INBOX_NUDGE=false
SHOW_OVERDUE_ALERT=false
SHOW_NEXT_ACTION=false

[ "$DAYS_SINCE_REVIEW" -ge 14 ] && SHOW_REVIEW_WARNING=true
[ "$DAYS_SINCE_REVIEW" -ge 7 ] && [ "$DAYS_SINCE_REVIEW" -lt 14 ] && SHOW_REVIEW_NUDGE=true
[ "$INBOX_COUNT" -ge 3 ] && SHOW_INBOX_NUDGE=true
[ "$OVERDUE_COUNT" -ge 1 ] && SHOW_OVERDUE_ALERT=true
[ "$NEXT_COUNT" -ge 1 ] && SHOW_NEXT_ACTION=true

# If nothing to show, exit silently (mind like water)
if [ "$SHOW_REVIEW_WARNING" = "false" ] && \
   [ "$SHOW_REVIEW_NUDGE" = "false" ] && \
   [ "$SHOW_INBOX_NUDGE" = "false" ] && \
   [ "$SHOW_OVERDUE_ALERT" = "false" ]; then
  exit 0
fi

# Build the additionalContext markdown
CONTEXT_LINES=""

# Header
CONTEXT_LINES="## GTD Status

"

# Review warning (strongest, always show when overdue)
if [ "$SHOW_REVIEW_WARNING" = "true" ]; then
  CONTEXT_LINES="${CONTEXT_LINES}**Weekly Review overdue** (${DAYS_SINCE_REVIEW} days ago) — run \`/gtd:review\` to catch up.

"
elif [ "$SHOW_REVIEW_NUDGE" = "true" ]; then
  DAYS_UNTIL=$(( 7 - DAYS_SINCE_REVIEW + 7 ))
  CONTEXT_LINES="${CONTEXT_LINES}Weekly Review: ${DAYS_SINCE_REVIEW} days ago — due soon. Run \`/gtd:review\` when ready.

"
fi

# Inbox nudge
if [ "$SHOW_INBOX_NUDGE" = "true" ]; then
  CONTEXT_LINES="${CONTEXT_LINES}**Inbox:** ${INBOX_COUNT} unclarified items. Run \`/gtd:process\` when ready.

"
fi

# Overdue alert
if [ "$SHOW_OVERDUE_ALERT" = "true" ]; then
  CONTEXT_LINES="${CONTEXT_LINES}**Overdue:** ${OVERDUE_COUNT} next action(s) past due date.

"
fi

# Summary counts
CONTEXT_LINES="${CONTEXT_LINES}System: ${NEXT_COUNT} next action(s), ${WAITING_COUNT} waiting, ${INBOX_COUNT} in inbox. Run \`/gtd:status\` for full dashboard.

"

# Active task context: load active task and its subtasks for Claude
ACTIVE_ID=$(gtd_active_task)
if [ -n "$ACTIVE_ID" ]; then
  ACTIVE_SUBJECT=$(gtd_read | jq -r --arg id "$ACTIVE_ID" '.tasks[] | select(.id == $id) | .subject // empty')
  if [ -n "$ACTIVE_SUBJECT" ]; then
    CONTEXT_LINES="${CONTEXT_LINES}**Active task:** ${ACTIVE_SUBJECT} (\`${ACTIVE_ID}\`)

"
  fi
fi

# Behavioral instruction for Claude
CONTEXT_LINES="${CONTEXT_LINES}When creating session tasks via TaskCreate, include metadata with \`gtdParent\` set to the active GTD task ID if one is active. GTD tasks will be synced automatically to \`.claude/gtd/tasks.json\`."

# Build JSON output using hookSpecificOutput format (same as coaching plugin)
OUTPUT=$(jq -n --arg ctx "$CONTEXT_LINES" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}')

printf '%s' "$OUTPUT"
exit 0
