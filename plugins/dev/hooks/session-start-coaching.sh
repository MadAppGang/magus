#!/usr/bin/env bash
# session-start-coaching.sh
# SessionStart hook: reads coaching recommendations from previous session,
# wraps in behavioral instructions, outputs additionalContext via hookSpecificOutput.
# Input: JSON via stdin { cwd, session_id, ... }
# Output: JSON { hookSpecificOutput: { hookEventName, additionalContext } } to stdout

set -euo pipefail

# Check jq availability (Fix 3)
if ! command -v jq >/dev/null 2>&1; then
  echo "Workflow coaching disabled: jq not found. Install with: brew install jq" >&2
  exit 0
fi

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)

[ -z "$CWD" ] && exit 0

RECS_FILE="${CWD}/.claude/.coaching/recommendations.md"

# No recommendations file -> nothing to inject
[ -f "$RECS_FILE" ] || exit 0

# Size guard: skip if recommendations file is unreasonably large (>1MB)
RECS_SIZE=$(stat -f%z "$RECS_FILE" 2>/dev/null || stat -c%s "$RECS_FILE" 2>/dev/null || echo "0")
[ "$RECS_SIZE" -gt 1048576 ] && exit 0

COACHING_CONTENT=$(cat "$RECS_FILE" 2>/dev/null || true)

# Empty file -> nothing to inject
[ -z "$COACHING_CONTENT" ] && exit 0

# Wrap recommendations in behavioral instructions.
# Pattern: tell Claude HOW to present the content, not just what the content is.
# This matches the explanatory-output-style plugin's SessionStart approach.
BEHAVIORAL_INSTRUCTIONS="## Workflow Coaching Instructions

You have received workflow coaching suggestions from the user's previous session.

PRESENT these suggestions to the user at the start of this session as visible output.
Do NOT silently discard them. Do NOT summarize or paraphrase them.
Output them verbatim, formatted as shown below, BEFORE responding to the user's first message.

${COACHING_CONTENT}

After presenting the suggestions, proceed normally with whatever the user asks."

# Build JSON output using hookSpecificOutput format (matches explanatory-output-style plugin)
# Claude Code reads SessionStart hook output from stdout in this format
OUTPUT=$(jq -n --arg ctx "$BEHAVIORAL_INSTRUCTIONS" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}')

printf '%s' "$OUTPUT"

exit 0
