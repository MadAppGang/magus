#!/usr/bin/env bash
# stop-gtd.sh
# Stop hook: lightweight session reconciliation and inbox suggestions for next session.
# Input:  JSON via stdin { session_id, transcript_path, cwd, ... }
# Output: plain text summary to stdout (appears in terminal, not conversation)

set -euo pipefail

# Source shared library (also checks for jq)
source "$(dirname "$0")/gtd-lib.sh"

# Read hook input
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)

[ -z "$CWD" ] && exit 0

# Opt-out check
if ! gtd_suggestions_enabled; then
  exit 0
fi

# Only run if GTD store exists (don't create it on Stop)
GTD_FILE=$(gtd_tasks_file)
[ -f "$GTD_FILE" ] || exit 0

# ── Reconciliation: verify tasks.json integrity ───────────────────────────────
TASK_COUNT=$(gtd_read | jq '.tasks | length' 2>/dev/null || echo "0")
INBOX_COUNT=$(gtd_count_by_list "inbox")
NEXT_COUNT=$(gtd_count_by_list "next")
COMPLETED_COUNT=$(gtd_read | jq '[.tasks[] | select(.completed != null)] | length' 2>/dev/null || echo "0")

# ── Scan transcript for uncaptured items ──────────────────────────────────────
SUGGESTIONS_FILE="${CWD}/.claude/gtd/inbox-suggestions.md"
UNCAPTURED_ITEMS=""

if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ] && [ -s "$TRANSCRIPT_PATH" ]; then
  # Look for common GTD capture signals in user messages
  # Extract user message text from JSONL transcript
  USER_MESSAGES=$(jq -r 'select(.type == "user") | .message.content[]? | select(type == "string")' \
    "$TRANSCRIPT_PATH" 2>/dev/null || true)

  if [ -n "$USER_MESSAGES" ]; then
    # Extract lines with capture signals
    UNCAPTURED_ITEMS=$(echo "$USER_MESSAGES" | \
      grep -iE "(I need to|we should|TODO:|FIXME:|remind me to|don't forget|don't forget|waiting on|blocked by|someday|eventually|tech debt)" \
      2>/dev/null | head -5 || true)
  fi
fi

# ── Write suggestions for next session ───────────────────────────────────────
if [ -n "$UNCAPTURED_ITEMS" ]; then
  mkdir -p "$(dirname "$SUGGESTIONS_FILE")"
  {
    printf "# Potential GTD Captures from Session %s\n\n" "${SESSION_ID:-unknown}"
    printf "The following items were mentioned but may not have been captured:\n\n"
    echo "$UNCAPTURED_ITEMS" | while IFS= read -r line; do
      [ -n "$line" ] && printf -- "- %s\n" "$line"
    done
    printf "\nRun \`/gtd:capture \"<text>\"\` to add any of these to your inbox.\n"
  } > "$SUGGESTIONS_FILE"
fi

# ── Update session state ──────────────────────────────────────────────────────
SESSION_STATE_FILE=$(gtd_session_state_file)
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
jq -n \
  --arg sid "${SESSION_ID:-unknown}" \
  --arg now "$NOW" \
  --argjson completed "$COMPLETED_COUNT" \
  '{
    sessionId: $sid,
    endedAt: $now,
    tasksCompletedThisSession: $completed
  }' > "$SESSION_STATE_FILE" 2>/dev/null || true

# ── Output session summary to terminal ───────────────────────────────────────
printf "[GTD] Session ended. Tasks: %d total, %d inbox, %d next, %d completed.\n" \
  "$TASK_COUNT" "$INBOX_COUNT" "$NEXT_COUNT" "$COMPLETED_COUNT"

if [ -n "$UNCAPTURED_ITEMS" ]; then
  printf "[GTD] Potential captures detected — check at next session start.\n"
fi

DAYS_SINCE=$(gtd_days_since_review)
if [ "$DAYS_SINCE" -ge 14 ]; then
  printf "[GTD] Weekly Review is %d days overdue. Run /gtd:review to catch up.\n" "$DAYS_SINCE"
elif [ "$DAYS_SINCE" -ge 7 ]; then
  printf "[GTD] Weekly Review due (last: %d days ago). Run /gtd:review.\n" "$DAYS_SINCE"
fi

exit 0
