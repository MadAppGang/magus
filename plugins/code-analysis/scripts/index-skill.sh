#!/usr/bin/env bash
# index-skill.sh
# Register a newly created skill file in mnemex and generated-skills.md.
#
# Usage:
#   bash index-skill.sh \
#     --skill-path  <absolute-path-to-SKILL.md> \
#     --name        <skill-name>                \
#     --description <one-line description>      \
#     [--project-root <project-dir>]            \
#     [--memory-file  <absolute-path-to-generated-skills.md>]
#
# Exits 0 in all cases (non-blocking by design).
# Failures write warnings to stderr; stdout is clean status text.

set -uo pipefail

# ── Argument parsing ────────────────────────────────────────────────────────
SKILL_PATH=""
SKILL_NAME=""
SKILL_DESCRIPTION=""
PROJECT_ROOT=""
MEMORY_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill-path)    SKILL_PATH="$2";        shift 2 ;;
    --name)          SKILL_NAME="$2";        shift 2 ;;
    --description)   SKILL_DESCRIPTION="$2"; shift 2 ;;
    --project-root)  PROJECT_ROOT="$2";      shift 2 ;;
    --memory-file)   MEMORY_FILE="$2";       shift 2 ;;
    *) echo "index-skill: unknown argument: $1" >&2; shift ;;
  esac
done

# ── Validation ───────────────────────────────────────────────────────────────
if [ -z "$SKILL_PATH" ] || [ -z "$SKILL_NAME" ]; then
  echo "index-skill: --skill-path and --name are required" >&2
  exit 0
fi

if [ ! -f "$SKILL_PATH" ]; then
  echo "index-skill: skill file not found: $SKILL_PATH" >&2
  exit 0
fi

# ── Resolve project root ─────────────────────────────────────────────────────
# Priority: explicit --project-root > git top-level > dirname of skill path
if [ -z "$PROJECT_ROOT" ]; then
  PROJECT_ROOT=$(git -C "$(dirname "$SKILL_PATH")" rev-parse --show-toplevel 2>/dev/null || true)
fi
if [ -z "$PROJECT_ROOT" ]; then
  PROJECT_ROOT=$(dirname "$(dirname "$SKILL_PATH")")
fi

# ── Step 1: mnemex index ──────────────────────────────────────────────────
CLAUDEMEM_BIN=""
if command -v mnemex >/dev/null 2>&1; then
  CLAUDEMEM_BIN="mnemex"
fi

if [ -z "$CLAUDEMEM_BIN" ]; then
  echo "index-skill: mnemex not found — skipping index update" >&2
  echo "  Install: npm install -g claude-codemem" >&2
  # Continue to generated-skills.md update even if mnemex is absent
else
  # Run index from the project root so mnemex picks up the right .mnemex/ dir
  # Errors are non-fatal: capture exit code without set -e
  INDEX_OUTPUT=$(cd "$PROJECT_ROOT" && $CLAUDEMEM_BIN index 2>&1) || true
  echo "index-skill: mnemex index complete"
  # Surface any warning lines
  if echo "$INDEX_OUTPUT" | grep -qi "error\|failed\|warn"; then
    echo "index-skill: mnemex warnings:" >&2
    echo "$INDEX_OUTPUT" >&2
  fi
fi

# ── Step 2: generated-skills.md update ───────────────────────────────────────
# Locate generated-skills.md for this project
if [ -z "$MEMORY_FILE" ]; then
  # Derive the Claude project hash from the project root absolute path
  # Format: ~/.claude/projects/{path-with-leading-dash}/memory/generated-skills.md
  # e.g. /Users/jack/mag/claude-code → -Users-jack-mag-claude-code
  PROJECT_HASH=$(echo "$PROJECT_ROOT" | sed 's|/|-|g')
  MEMORY_FILE="${HOME}/.claude/projects/${PROJECT_HASH}/memory/generated-skills.md"
fi

DATE_STR=$(date +%Y-%m-%d)

# Ensure memory directory exists
mkdir -p "$(dirname "$MEMORY_FILE")"

# ── Table header ─────────────────────────────────────────────────────────────
TABLE_HEADER="# Generated Skills Index

Skills auto-indexed by mnemex for semantic search discovery.

| Skill Name | Date | Description | Path |
|------------|------|-------------|------|"

# ── Idempotency: UPDATE existing row or APPEND new row ────────────────────────
NEW_ROW="| ${SKILL_NAME} | ${DATE_STR} | ${SKILL_DESCRIPTION} | ${SKILL_PATH} |"

if [ -f "$MEMORY_FILE" ] && grep -q "^| ${SKILL_NAME} |" "$MEMORY_FILE" 2>/dev/null; then
  # Skill already exists — replace the entire row to update date + description
  TEMP_FILE=$(mktemp)
  # Use awk for portable in-place replacement (macOS sed -i requires extension)
  awk -v name="$SKILL_NAME" -v new_row="$NEW_ROW" '
    $0 ~ "^\\| " name " \\|" { print new_row; next }
    { print }
  ' "$MEMORY_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$MEMORY_FILE"
  echo "index-skill: updated ${SKILL_NAME} in generated-skills.md"
else
  # Skill does not exist — create file with header if needed, then append row
  if [ ! -f "$MEMORY_FILE" ]; then
    printf '%s\n' "$TABLE_HEADER" > "$MEMORY_FILE"
  fi
  printf '%s\n' "$NEW_ROW" >> "$MEMORY_FILE"
  echo "index-skill: added ${SKILL_NAME} to generated-skills.md"
fi

exit 0
