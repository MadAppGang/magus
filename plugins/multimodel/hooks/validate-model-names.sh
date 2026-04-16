#!/bin/bash
set -u
# ============================================================================
# validate-model-names.sh
# PreToolUse hook for claudish MCP tools (team, create_session)
#
# Catches model-name bugs that are KNOWN to be wrong, without second-guessing
# claudish on whether a model exists. Local model-aliases.json is a
# recommendation list, NOT a whitelist — claudish supports many more models
# than we curate locally.
#
# Catches:
#   1. Unresolved alias keys (e.g., "grok" instead of "grok-4.20-beta")
#      Step 2 of resolution should always replace alias keys with their values.
#   2. Provider prefixes (e.g., "openai/gpt-5.4", "or@grok") — explicitly
#      forbidden because claudish handles routing internally.
#
# Does NOT check whether a model "exists" — that's claudish's job. A name not
# in shared/model-aliases.json is allowed through; if it's invalid, claudish
# will error and the user will see the real reason.
#
# Protocol: reads JSON from stdin, writes JSON to fd3 (or stdout)
# Fail-open: parse errors default to ALLOW
# ============================================================================

INPUT=$(cat)

TOOL_NAME=$(echo "${INPUT}" | jq -r '.tool_name // empty' 2>/dev/null || true)
if [ -z "${TOOL_NAME}" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}' >&3 2>/dev/null || \
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  exit 0
fi

allow() {
  local json='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  echo "${json}" >&3 2>/dev/null || echo "${json}"
  exit 0
}

deny() {
  local reason="$1"
  local json
  json=$(jq -nc --arg reason "${reason}" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$reason}}')
  echo "${json}" >&3 2>/dev/null || echo "${json}"
  exit 0
}

# --------------------------------------------------------------------------
# Find model-aliases.json — needed only to load the alias key set
# --------------------------------------------------------------------------
ALIASES_FILE=""
SEARCH_DIR="${CLAUDE_PLUGIN_ROOT:-$(pwd)}"
for _ in 1 2 3 4 5; do
  if [ -f "${SEARCH_DIR}/shared/model-aliases.json" ]; then
    ALIASES_FILE="${SEARCH_DIR}/shared/model-aliases.json"
    break
  fi
  SEARCH_DIR=$(dirname "${SEARCH_DIR}")
done

# Without aliases file we can't detect unresolved alias keys, but we can
# still catch provider prefixes. Continue with empty alias set.
ALIAS_KEYS=""
if [ -n "${ALIASES_FILE}" ] && [ -f "${ALIASES_FILE}" ]; then
  ALIAS_KEYS=$(jq -r '.shortAliases | keys[]' "${ALIASES_FILE}" 2>/dev/null || true)

  # Also include customAliases keys from project preferences
  REPO_ROOT=$(dirname "${ALIASES_FILE}" | xargs dirname)
  if [ -f "${REPO_ROOT}/.claude/multimodel-team.json" ]; then
    CUSTOM_KEYS=$(jq -r '.customAliases // {} | keys[]' "${REPO_ROOT}/.claude/multimodel-team.json" 2>/dev/null || true)
    [ -n "${CUSTOM_KEYS}" ] && ALIAS_KEYS="${ALIAS_KEYS}
${CUSTOM_KEYS}"
  fi
fi

# --------------------------------------------------------------------------
# Extract model names from tool input
# --------------------------------------------------------------------------
MODELS=""
if echo "${TOOL_NAME}" | grep -q "team$"; then
  MODELS=$(echo "${INPUT}" | jq -r '.tool_input.models // [] | .[]' 2>/dev/null || true)
elif echo "${TOOL_NAME}" | grep -q "create_session$"; then
  MODELS=$(echo "${INPUT}" | jq -r '.tool_input.model // empty' 2>/dev/null || true)
fi
[ -z "${MODELS}" ] && allow

# --------------------------------------------------------------------------
# Check 1: provider prefixes (explicitly forbidden routing markers)
#
# Forbidden patterns:
#   - "openai/", "google/", "anthropic/", "x-ai/", "moonshotai/", "z-ai/"
#     "deepseek/", "minimax/", "qwen/", "xiaomi/" — provider routing prefixes
#   - "mm@", "or@" — claudish backend selectors
#
# Allowed:
#   - "openrouter/<name>" — this IS the model ID (e.g., openrouter/polaris-alpha
#     is the full canonical name, not a prefix). Slashes alone are not banned.
# --------------------------------------------------------------------------
PREFIXED=""
while IFS= read -r model; do
  [ -z "${model}" ] && continue
  if echo "${model}" | grep -qE '^(openai|google|anthropic|x-ai|moonshotai|z-ai|deepseek|minimax|qwen|xiaomi)/|^(mm|or)@'; then
    PREFIXED="${PREFIXED}${PREFIXED:+, }${model}"
  fi
done <<< "${MODELS}"

if [ -n "${PREFIXED}" ]; then
  deny "Provider prefixes are forbidden in model IDs: ${PREFIXED}. Claudish handles provider routing internally — pass the bare model ID. Example: use 'gpt-5.4' not 'openai/gpt-5.4'. Note: 'openrouter/<name>' is allowed because it is part of the canonical model ID, not a routing prefix."
fi

# --------------------------------------------------------------------------
# Check 2: unresolved alias keys (only if we loaded the alias file)
# --------------------------------------------------------------------------
if [ -n "${ALIAS_KEYS}" ]; then
  UNRESOLVED=""
  while IFS= read -r model; do
    [ -z "${model}" ] && continue
    [ "${model}" = "internal" ] && continue
    while IFS= read -r alias_key; do
      [ -z "${alias_key}" ] && continue
      if [ "${model}" = "${alias_key}" ]; then
        ALIAS_VALUE=""
        if [ -n "${ALIASES_FILE}" ]; then
          ALIAS_VALUE=$(jq -r --arg k "${alias_key}" '.shortAliases[$k] // empty' "${ALIASES_FILE}" 2>/dev/null || true)
        fi
        UNRESOLVED="${UNRESOLVED}${UNRESOLVED:+, }${model} → ${ALIAS_VALUE:-?}"
        break
      fi
    done <<< "${ALIAS_KEYS}"
  done <<< "${MODELS}"

  if [ -n "${UNRESOLVED}" ]; then
    deny "Unresolved alias key(s) sent to claudish: ${UNRESOLVED}. Step 2 of model resolution must replace alias keys with their full model IDs from shared/model-aliases.json shortAliases. Look up each alias and pass the resolved value, not the key."
  fi
fi

allow
