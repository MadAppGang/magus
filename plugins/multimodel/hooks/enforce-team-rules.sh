#!/bin/bash
set -u
# ============================================================================
# enforce-team-rules.sh
# PreToolUse hook for /team workflow enforcement and claudish usage logging
#
# Intercepted tools: Task, Bash
# Protocol: reads JSON from stdin, writes JSON to fd3 (or stdout)
#
# Rules enforced:
#   1. /team Task calls must use a valid agent from whitelist (vote template detection)
#   2. Session files must not use /tmp/ paths
#
# Logging:
#   - Every claudish invocation is logged to .claude/claudish-usage.log
#   - Log includes: timestamp, model, agent, flags, full command
#
# Fail-open: parse errors default to ALLOW (never block due to own bugs)
# ============================================================================

# Read hook input from stdin
INPUT=$(cat)

# Parse tool name directly from raw input (avoids intermediate variable issues)
TOOL_NAME=$(echo "${INPUT}" | jq -r '.tool_name // empty' 2>/dev/null || true)

# If we can't parse, allow (never block due to own bugs)
if [ -z "${TOOL_NAME}" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}' >&3 2>/dev/null || \
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  exit 0
fi

# --------------------------------------------------------------------------
# Helper: output allow/deny decision
# --------------------------------------------------------------------------
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
# RULE: Task tool validation
# --------------------------------------------------------------------------
if [ "${TOOL_NAME}" = "Task" ]; then
  # Parse directly from raw INPUT to avoid multi-line JSON issues
  SUBAGENT=$(echo "${INPUT}" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null || true)
  PROMPT=$(echo "${INPUT}" | jq -r '.tool_input.prompt // empty' 2>/dev/null || true)

  # RULE 1: /team workflow enforcement (detect by vote block pattern in prompt)
  # Whitelist of valid agents for /team (matches context_detection in team.md)
  VALID_AGENTS="dev:researcher dev:debugger dev:developer dev:architect dev:test-architect dev:devops dev:ui agentdev:reviewer"

  if echo "${PROMPT}" | grep -q "Team Vote: Independent Review Request\|VERDICT:.*APPROVE\|Required Vote Format"; then
    if [ -n "${SUBAGENT}" ]; then
      AGENT_VALID=false
      for valid in ${VALID_AGENTS}; do
        if [ "${SUBAGENT}" = "${valid}" ]; then
          AGENT_VALID=true
          break
        fi
      done
      if [ "${AGENT_VALID}" = false ]; then
        deny "BLOCKED: /team agent '${SUBAGENT}' not in whitelist. Valid: ${VALID_AGENTS}"
      fi
    fi
  fi

  # RULE 3: No /tmp/ paths in Task prompts (session directory enforcement)
  if echo "${PROMPT}" | grep -q "/tmp/"; then
    deny "BLOCKED: Task prompt contains /tmp/ path. Use ai-docs/sessions/ for session files."
  fi

  allow
fi

# --------------------------------------------------------------------------
# RULE: Bash tool validation (claudish usage logging)
# --------------------------------------------------------------------------
if [ "${TOOL_NAME}" = "Bash" ]; then
  COMMAND=$(echo "${INPUT}" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

  # Only enforce on actual claudish CLI invocations (not file references like claudish-usage.log)
  # Match claudish at a command position: start of line, after pipe, semicolon, or &&
  if echo "${COMMAND}" | grep -qE '(^|[;&|]+\s*)claudish\s'; then
    # Skip existence checks (which claudish, command -v claudish, type claudish)
    if echo "${COMMAND}" | grep -qE "^(which |command -v |type )"; then
      allow
    fi

    # Skip version/help checks
    if echo "${COMMAND}" | grep -qE "claudish\s+--(version|help|top-models|free)"; then
      allow
    fi

    # --- Claudish usage logging ---
    # Extract flags from the command for post-mortem investigation
    CLAUDISH_MODEL=$(echo "${COMMAND}" | grep -oE '\-\-model\s+\S+' | head -1 | sed 's/--model //' || true)
    CLAUDISH_HAS_STDIN="no"
    if echo "${COMMAND}" | grep -q "\-\-stdin"; then
      CLAUDISH_HAS_STDIN="yes"
    fi
    CLAUDISH_HAS_QUIET="no"
    if echo "${COMMAND}" | grep -q "\-\-quiet"; then
      CLAUDISH_HAS_QUIET="yes"
    fi
    CLAUDISH_BG=$(echo "${INPUT}" | jq -r '.tool_input.run_in_background // false' 2>/dev/null || echo "false")
    CLAUDISH_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Log to .claude/claudish-usage.log (create dir if needed)
    LOG_FILE=".claude/claudish-usage.log"
    mkdir -p "$(dirname "${LOG_FILE}")" 2>/dev/null || true
    {
      printf '%s | model=%-35s | stdin=%s | quiet=%s | bg=%s | cmd=%s\n' \
        "${CLAUDISH_TS}" \
        "${CLAUDISH_MODEL:-MISSING}" \
        "${CLAUDISH_HAS_STDIN}" \
        "${CLAUDISH_HAS_QUIET}" \
        "${CLAUDISH_BG}" \
        "${COMMAND}"
    } >> "${LOG_FILE}" 2>/dev/null || true
  fi

  allow
fi

# --------------------------------------------------------------------------
# Default: allow all other tools
# --------------------------------------------------------------------------
allow
