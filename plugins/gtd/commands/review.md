---
name: review
description: "Run the GTD Weekly Review. Usage: /gtd:review [--quick]"
---

# GTD Weekly Review

You are implementing the GTD weekly review command. This is a comprehensive review of the entire GTD system — a ritual to ensure nothing is missed and the system stays trustworthy.

## Parse the Input

- `--quick` flag: run abbreviated review (inbox + stale waiting only)
- No flags: run full weekly review (all 8 automated sections + 4 guided questions)

## Load GTD State

Run this Bash command to gather all data:

```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"

if [ ! -f "$GTD_FILE" ]; then
  echo "No GTD store found. Run /gtd:capture to get started."
  exit 0
fi

# Get current date info
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SEVEN_DAYS_AGO=$(date -u -v-7d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "7 days ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
THIRTY_DAYS_AGO=$(date -u -v-30d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "30 days ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")

# Load full task store
cat "$GTD_FILE"
```

## Generate the Weekly Review

Present the following 8 automated sections, then ask the 4 guided questions.

### Automated Section 1: Completed This Week

Show tasks completed in the past 7 days:

```bash
jq --arg since "$SEVEN_DAYS_AGO" \
  '[.tasks[] | select(.completed != null and (if $since != "" then .completed > $since else true end))] |
   sort_by(.completed) | reverse' "$GTD_FILE"
```

Display with green checkmarks and celebration.

### Automated Section 2: Stale Inbox Items

Show inbox items older than 7 days:

```bash
jq --arg cutoff "$SEVEN_DAYS_AGO" \
  '[.tasks[] | select(.list == "inbox" and .completed == null and (if $cutoff != "" then .created < $cutoff else true end))]' \
  "$GTD_FILE"
```

If any: "These inbox items haven't been processed. Run `/gtd:process` after this review."

### Automated Section 3: Waiting For Follow-Ups

Show waiting items older than 7 days (need a nudge):

```bash
jq --arg cutoff "$SEVEN_DAYS_AGO" \
  '[.tasks[] | select(.list == "waiting" and .completed == null and (if $cutoff != "" then .created < $cutoff else true end))]' \
  "$GTD_FILE"
```

For each: "Have you followed up on: '[subject]' (waiting on: [waitingOn])?"

### Automated Section 4: Project Health Check

Show projects without any next actions (orphaned projects):

```bash
# Get all project IDs
PROJECTS=$(jq '[.tasks[] | select(.list == "project" and .completed == null)]' "$GTD_FILE")
# For each project, check if there are next actions with that parentId
```

Flag projects with no next actions as needing attention.

### Automated Section 5: Upcoming Due Dates (Next 7 Days)

```bash
NEXT_WEEK=$(date -u -v+7d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "+7 days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
jq --arg cutoff "$NEXT_WEEK" --arg now "$NOW" \
  '[.tasks[] | select(.dueDate != null and .completed == null and .dueDate > $now and (if $cutoff != "" then .dueDate <= $cutoff else true end))] |
   sort_by(.dueDate)' "$GTD_FILE"
```

### Automated Section 6: Someday/Maybe Review

```bash
jq '[.tasks[] | select(.list == "someday" and .completed == null)] | sort_by(.created)' "$GTD_FILE"
```

Ask for each item: "Promote to Next Actions? Still relevant? Or archive?"

Developer augmentation: Flag Someday items older than 30 days and any containing "learn" or "study".

### Automated Section 7: Session Summary

Show statistics:
- Total tasks by list
- Completion rate
- Most used context tags
- Active task if set

### Automated Section 8: Brain Dump Prompt

Ask: "Is there anything else on your mind that you haven't captured yet? Take 2 minutes to think..."

After their response: capture any items they mention via `gtd_append_task`.

## Guided Questions (4 Questions)

For each question, engage in conversation and capture any actions:

1. "What are your top 3 next actions for this week?"
2. "Are there any projects you're not making progress on? What's blocking them?"
3. "Is your current Next Actions list realistic given your available time?"
4. "Any code reviews, PRs, or team dependencies you're waiting on that need a follow-up?"

## Update lastReview Timestamp

After completing the review, run:

```bash
CWD=$(pwd)
GTD_FILE="${CWD}/.claude/gtd/tasks.json"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP="${GTD_FILE}.tmp.$$"

jq --arg now "$NOW" '.lastReview = $now' "$GTD_FILE" > "$TMP" && mv "$TMP" "$GTD_FILE"

echo -e "\033[92mWeekly Review complete.\033[0m Last review updated to now."

# Optionally save review to file
REVIEW_DIR="${CWD}/.claude/gtd/reviews"
WEEK=$(date +"%Y-W%V")
mkdir -p "$REVIEW_DIR"
echo "# GTD Weekly Review — ${WEEK}" > "${REVIEW_DIR}/${WEEK}.md"
echo "Completed: $(date)" >> "${REVIEW_DIR}/${WEEK}.md"
```

## Completion Message

Show a summary of what was reviewed, any actions taken, and remind them of next review date (7 days from now).
