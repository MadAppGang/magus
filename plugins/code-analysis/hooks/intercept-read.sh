#!/bin/bash
# =============================================================================
# INTERCEPT READ → WARN ON BULK READS (3+ FILES) (v0.3.0)
# =============================================================================
# This hook tracks file reads in a session and warns when 3+ files are read,
# suggesting claudemem map/symbol commands as a more efficient alternative.
# Does NOT block - just provides helpful guidance.
#
# v0.3.0 Update: Recommends map → symbol → callers workflow
# =============================================================================

set -euo pipefail

# Read tool input from stdin
TOOL_INPUT=$(cat)
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // empty')

# Skip if empty path
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Check if claudemem is available
if ! command -v claudemem &>/dev/null; then
  exit 0
fi

if ! claudemem status 2>/dev/null | grep -qE "[0-9]+ (chunks|symbols)"; then
  # Not indexed - no tracking needed
  exit 0
fi

# === TRACK READS IN SESSION ===

# Use a session-specific tracker file
# SESSION_KEY is based on working directory to isolate projects
SESSION_KEY=$(echo "$PWD" | md5sum | cut -c1-8)
TRACKER="/tmp/claude-read-tracker-$SESSION_KEY"

# Cleanup old trackers (older than 30 minutes)
find /tmp -name "claude-read-tracker-*" -mmin +30 -delete 2>/dev/null || true

# Track this read
echo "$FILE_PATH" >> "$TRACKER"

# Count unique directories being read from
READ_COUNT=$(wc -l < "$TRACKER" 2>/dev/null | tr -d ' ')
UNIQUE_DIRS=$(cat "$TRACKER" | xargs -I{} dirname {} 2>/dev/null | sort -u | wc -l | tr -d ' ')

# === WARN AFTER 3+ READS ===

if [ "$READ_COUNT" -ge 3 ]; then
  # Get the directories being read
  DIR_LIST=$(cat "$TRACKER" | xargs -I{} dirname {} 2>/dev/null | sort -u | head -3 | tr '\n' ', ' | sed 's/,$//')

  cat << EOF >&3
{
  "additionalContext": "⚠️ **Bulk Read Warning** ($READ_COUNT files from $UNIQUE_DIRS dirs)\n\nDirs: \`$DIR_LIST\`\n\n**Recommended workflow (v0.3.0):**\n1. \`claudemem --agent map\` → Get structure with PageRank\n2. \`claudemem --agent symbol <name>\` → Find specific symbol\n3. \`claudemem --agent callers <name>\` → Check impact before changes\n4. Read specific file:line from results (NOT whole files)\n\nAST analysis is 80% more token-efficient than bulk file reads."
}
EOF
fi

# Always allow reads (soft warning only)
exit 0
