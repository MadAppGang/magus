#!/usr/bin/env bash
# PreToolUse hook: Block git add -f of private/ephemeral paths.
# Receives tool input JSON on stdin. Exit 0 = allow, exit 2 = block.
#
# ADVISORY SAFETY NET — This hook is a best-effort guard, NOT a security
# barrier. The real protection is .gitignore (which git respects by default).
# This hook catches common force-add patterns that would override .gitignore,
# but it cannot fully parse all shell syntax (quoting, expansion, subshells).
# It is inherently bypassable and that is acceptable.
set -euo pipefail

INPUT=$(cat)

# Extract the command from Bash tool input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Only process if this looks like a git add command
# Also match `git -C <dir> add` pattern
[[ "$COMMAND" =~ ^[[:space:]]*git[[:space:]]+((-[Cc][[:space:]]+[^[:space:]]+[[:space:]]+)*)add ]] || exit 0

# List of private paths that must never be force-added
PRIVATE_PATHS=(
  ".mnemex/"
  ".mnemex"
  ".claudemem/"
  ".claudemem"
  ".claude/sessions/"
  ".claude/sessions"
  ".claude/.coaching/"
  ".claude/.coaching"
  ".claude/worktrees/"
  ".claude/worktrees"
)

# Tokenize the command into words for best-effort argument matching.
# NOTE: read -ra splits on whitespace and does not handle shell quoting or
# expansion. This is intentional — see advisory comment at the top.
read -ra TOKENS <<< "$COMMAND"

# Check if -f or --force flag is present anywhere in the tokens
# Handles: -f, --force, -Af (force at end), -fA (force in middle), -AfN etc.
HAS_FORCE=false
for token in "${TOKENS[@]}"; do
  case "$token" in
    --force) HAS_FORCE=true; break ;;
  esac
  # Match any short-flag group containing 'f' (e.g. -f, -Af, -fA, -fAN)
  if [[ "$token" =~ ^-[a-zA-Z]*f[a-zA-Z]*$ ]]; then
    HAS_FORCE=true; break
  fi
done

# If no force flag, git add won't override gitignore -- allow
$HAS_FORCE || exit 0

# Check for wildcard force-adds that would include private paths:
# git add -f . / git add -f -A / git add -f --all / git add -fA / git add -Af
HAS_ALL=false
for token in "${TOKENS[@]}"; do
  case "$token" in
    .|--all) HAS_ALL=true; break ;;
  esac
  # Match any short-flag group containing 'A' (e.g. -A, -fA, -Af, -fAN)
  if [[ "$token" =~ ^-[a-zA-Z]*A[a-zA-Z]*$ ]]; then
    HAS_ALL=true; break
  fi
done

if $HAS_ALL; then
  echo "BLOCKED: 'git add --force' with wildcard would include private paths."
  echo "Use explicit file paths instead of wildcard flags with --force."
  echo "Private paths: ${PRIVATE_PATHS[*]}"
  exit 2
fi

# Check for explicit private paths in the command
for private_path in "${PRIVATE_PATHS[@]}"; do
  for token in "${TOKENS[@]}"; do
    if [[ "$token" == "$private_path" || "$token" == "./$private_path" ]]; then
      echo "BLOCKED: Attempting to force-add private path: $private_path"
      echo "These paths contain personal/ephemeral data and must not be committed."
      echo "They are listed in .gitignore for a reason."
      exit 2
    fi
  done
done

exit 0
