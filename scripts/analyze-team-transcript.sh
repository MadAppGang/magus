#!/bin/bash
set -euo pipefail

# ============================================================================
# analyze-team-transcript.sh
# Analyzes /team orchestration transcripts for correctness
#
# Usage: bash scripts/analyze-team-transcript.sh <session-dir>
#
# Checks:
#   1. PROXY_MODE never used with general-purpose agent (CRITICAL)
#   2. Session files written to ai-docs/sessions/ (not /tmp/)
#   3. PROXY_MODE only used with known-enabled agents
#   4. claudish --model flag present when CLI is used
#   5. Task prompt contains raw investigation (not pre-solved)
# ============================================================================

SESSION_DIR="${1:?Usage: $0 <session-dir>}"

if [ ! -d "${SESSION_DIR}" ]; then
  echo "ERROR: Session directory not found: ${SESSION_DIR}"
  exit 1
fi

# Counters
TOTAL_CHECKS=0
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Known PROXY_MODE-enabled agents
# Synced with plugins/multimodel/skills/proxy-mode-reference/SKILL.md
PROXY_AGENTS=(
  "dev:researcher" "dev:developer" "dev:debugger" "dev:architect"
  "dev:test-architect" "dev:devops" "dev:ui"
  "agentdev:reviewer" "agentdev:architect" "agentdev:developer"
  "frontend:plan-reviewer" "frontend:reviewer" "frontend:architect"
  "frontend:designer" "frontend:developer" "frontend:ui-developer"
  "frontend:css-developer" "frontend:test-architect"
  "seo:analyst" "seo:editor" "seo:writer" "seo:researcher" "seo:data-analyst"
)

pass() {
  ((TOTAL_CHECKS++))
  ((PASS_COUNT++))
  echo "  PASS: $1"
}

fail() {
  ((TOTAL_CHECKS++))
  ((FAIL_COUNT++))
  echo "  FAIL: $1"
}

warn() {
  ((TOTAL_CHECKS++))
  ((WARN_COUNT++))
  echo "  WARN: $1"
}

is_proxy_agent() {
  local agent="$1"
  for pa in "${PROXY_AGENTS[@]}"; do
    if [ "${agent}" = "${pa}" ]; then
      return 0
    fi
  done
  return 1
}

# ============================================================================
# Analyze each run transcript
# ============================================================================

for transcript in "${SESSION_DIR}"/run*-transcript.jsonl; do
  [ -f "${transcript}" ] || continue

  run_name="$(basename "${transcript}" -transcript.jsonl)"
  echo ""
  echo "============================================================"
  echo "  Analyzing: ${run_name}"
  echo "  File: ${transcript}"
  echo "============================================================"

  line_count=$(wc -l < "${transcript}" | tr -d ' ')
  echo "  Transcript lines: ${line_count}"
  echo ""

  if [ "${line_count}" -eq 0 ]; then
    fail "${run_name}: Empty transcript"
    continue
  fi

  # ------------------------------------------------------------------
  # Extract all Task tool calls from the transcript
  # ------------------------------------------------------------------
  # stream-json format nests content under .message.content[]
  TASK_CALLS_JSON=$(
    jq -c '
      select(.type == "assistant")
      | .message.content[]?
      | select(.type == "tool_use" and .name == "Task")
      | {
          id: .id,
          subagent_type: .input.subagent_type,
          prompt: .input.prompt,
          description: .input.description
        }
    ' "${transcript}" 2>/dev/null || true
  )

  if [ -z "${TASK_CALLS_JSON}" ]; then
    warn "${run_name}: No Task tool calls found in transcript"
    echo "  (This may mean /team used a different execution pattern)"
    echo ""

    # Check if claudish was invoked directly via Bash
    BASH_CALLS=$(
      jq -c '
        select(.type == "assistant")
        | .message.content[]?
        | select(.type == "tool_use" and .name == "Bash")
        | .input.command
      ' "${transcript}" 2>/dev/null | grep -i "claudish" || true
    )

    if [ -n "${BASH_CALLS}" ]; then
      echo "  Found direct claudish Bash calls:"
      echo "${BASH_CALLS}" | head -5
    fi

    continue
  fi

  task_count=$(echo "${TASK_CALLS_JSON}" | wc -l | tr -d ' ')
  echo "  Found ${task_count} Task tool call(s)"
  echo ""

  # ------------------------------------------------------------------
  # CHECK 1: PROXY_MODE not used with general-purpose
  # ------------------------------------------------------------------
  echo "  --- Check 1: PROXY_MODE + general-purpose (CRITICAL) ---"

  violations=$(
    echo "${TASK_CALLS_JSON}" | jq -r '
      select(
        .subagent_type == "general-purpose"
        and (.prompt | test("PROXY_MODE"; "i"))
      )
      | "    VIOLATION: general-purpose + PROXY_MODE in: \(.description // "unnamed")"
    ' 2>/dev/null || true
  )

  if [ -n "${violations}" ]; then
    fail "${run_name}: PROXY_MODE used with general-purpose agent!"
    echo "${violations}"
  else
    pass "${run_name}: No PROXY_MODE + general-purpose violations"
  fi

  # ------------------------------------------------------------------
  # CHECK 2: Session files use ai-docs/sessions/ (not /tmp/)
  # ------------------------------------------------------------------
  echo ""
  echo "  --- Check 2: Session directory paths ---"

  tmp_refs=$(
    echo "${TASK_CALLS_JSON}" | jq -r '
      select(.prompt | test("/tmp/"; "i"))
      | "    BAD PATH: /tmp/ found in: \(.description // "unnamed")"
    ' 2>/dev/null || true
  )

  if [ -n "${tmp_refs}" ]; then
    fail "${run_name}: /tmp/ path found in Task prompts"
    echo "${tmp_refs}"
  else
    pass "${run_name}: No /tmp/ paths in Task prompts"
  fi

  sessions_refs=$(
    echo "${TASK_CALLS_JSON}" | jq -r '
      select(.prompt | test("ai-docs/sessions/"; "i"))
      | "    OK: ai-docs/sessions/ used in: \(.description // "unnamed")"
    ' 2>/dev/null || true
  )

  if [ -n "${sessions_refs}" ]; then
    pass "${run_name}: ai-docs/sessions/ directory referenced"
  else
    warn "${run_name}: No ai-docs/sessions/ paths found in Task prompts (may use different pattern)"
  fi

  # ------------------------------------------------------------------
  # CHECK 3: PROXY_MODE only with enabled agents
  # ------------------------------------------------------------------
  echo ""
  echo "  --- Check 3: PROXY_MODE agent compatibility ---"

  proxy_tasks=$(
    echo "${TASK_CALLS_JSON}" | jq -c '
      select(.prompt | test("PROXY_MODE"; "i"))
    ' 2>/dev/null || true
  )

  if [ -n "${proxy_tasks}" ]; then
    while IFS= read -r task_json; do
      agent=$(echo "${task_json}" | jq -r '.subagent_type')
      desc=$(echo "${task_json}" | jq -r '.description // "unnamed"')

      if is_proxy_agent "${agent}"; then
        pass "${run_name}: PROXY_MODE used with compatible agent '${agent}' (${desc})"
      else
        fail "${run_name}: PROXY_MODE used with incompatible agent '${agent}' (${desc})"
      fi
    done <<< "${proxy_tasks}"
  else
    echo "  (No PROXY_MODE tasks found - may be using claudish CLI fallback)"
  fi

  # ------------------------------------------------------------------
  # CHECK 4: claudish --model flag in CLI calls
  # ------------------------------------------------------------------
  echo ""
  echo "  --- Check 4: claudish --model flag in CLI calls ---"

  # Check direct Bash calls that invoke claudish
  # Filter out `which claudish` / `command -v claudish` (existence checks)
  # Use NUL-delimited output to handle multi-line commands correctly
  BASH_CLAUDISH_COUNT=0
  BASH_CLAUDISH_MODEL_COUNT=0

  while IFS= read -r -d '' cmd; do
    # Skip existence checks
    if echo "${cmd}" | head -1 | grep -qE "^(which|command -v|type |where )"; then
      continue
    fi
    ((BASH_CLAUDISH_COUNT++))
    if echo "${cmd}" | grep -q "\-\-model"; then
      ((BASH_CLAUDISH_MODEL_COUNT++))
      pass "${run_name}: --model flag in direct Bash claudish call"
    else
      warn "${run_name}: Direct Bash claudish call without --model flag"
    fi
  done < <(
    jq -rj '
      select(.type == "assistant")
      | .message.content[]?
      | select(.type == "tool_use" and .name == "Bash")
      | select(.input.command | test("\\|[^|]*claudish|^claudish|echo.*claudish"; "i"))
      | select(.input.command | test("^which |^command -v "; "i") | not)
      | .input.command, "\u0000"
    ' "${transcript}" 2>/dev/null || true
  )

  if [ "${BASH_CLAUDISH_COUNT}" -eq 0 ]; then
    echo "  (No direct claudish Bash invocations found)"
  fi

  # ------------------------------------------------------------------
  # CHECK 5: Raw investigation (not pre-digested)
  # ------------------------------------------------------------------
  echo ""
  echo "  --- Check 5: Task prompt quality (raw vs pre-digested) ---"

  # Pre-digested indicators: phrases that suggest the answer was already computed
  # Includes embedded data tables with conclusions (MISMATCH, results)
  PREDIGESTED_PATTERNS="(all versions match|versions are correct|no mismatches found|everything is in sync|verified that|MISMATCH|comparison table below|Based on the comparison)"

  predigested_tasks=$(
    echo "${TASK_CALLS_JSON}" | jq -c --arg pat "${PREDIGESTED_PATTERNS}" '
      select(.prompt | test($pat; "i"))
    ' 2>/dev/null || true
  )

  if [ -n "${predigested_tasks}" ]; then
    fail "${run_name}: Task prompts contain pre-digested conclusions"
    echo "${predigested_tasks}" | jq -r '"    PREDIGESTED: \(.description // "unnamed")"' 2>/dev/null || true
  else
    pass "${run_name}: Task prompts appear to be raw investigation tasks"
  fi

  # ------------------------------------------------------------------
  # CHECK 6: (Bonus) Verify model identity in responses
  # ------------------------------------------------------------------
  echo ""
  echo "  --- Check 6: Model identity in responses ---"

  # Look for tool results that mention model metadata
  model_identity=$(
    jq -c '
      select(.type == "tool_result" or .type == "result")
      | .content // .text // ""
      | select(test("model.*claude-sonnet|claude-sonnet.*model"; "i"))
    ' "${transcript}" 2>/dev/null | head -3 || true
  )

  if [ -n "${model_identity}" ]; then
    warn "${run_name}: Claude Sonnet model detected in responses (may indicate PROXY_MODE failure)"
    echo "    ${model_identity}" | head -c 200
  else
    pass "${run_name}: No unexpected Claude Sonnet model identity detected"
  fi

  # ------------------------------------------------------------------
  # CHECK 7: resolve-agents.sh usage
  # ------------------------------------------------------------------
  echo ""
  echo "  --- Check 7: Pre-processor (resolve-agents.sh) usage ---"

  resolve_calls=$(
    jq -c '
      select(.type == "assistant")
      | .message.content[]?
      | select(.type == "tool_use" and .name == "Bash")
      | select(.input.command | test("resolve-agents\\.sh"; "i"))
    ' "${transcript}" 2>/dev/null || true
  )

  if [ -n "${resolve_calls}" ]; then
    pass "${run_name}: resolve-agents.sh pre-processor was called"
  else
    warn "${run_name}: resolve-agents.sh was NOT called (may use fallback agent selection)"
  fi

  # ------------------------------------------------------------------
  # CHECK 8: Compliance summary
  # ------------------------------------------------------------------
  echo ""
  echo "  --- Check 8: Overall compliance for this run ---"

  # Count Task calls that are correctly configured
  total_tasks=$(echo "${TASK_CALLS_JSON}" | wc -l | tr -d ' ')
  proxy_correct=$(
    echo "${TASK_CALLS_JSON}" | jq -c '
      select(
        (.prompt | test("PROXY_MODE"; "i"))
        and (.subagent_type | test("^(dev:|agentdev:|frontend:|seo:)"))
      )
    ' 2>/dev/null | wc -l | tr -d ' '
  )
  non_proxy=$(
    echo "${TASK_CALLS_JSON}" | jq -c '
      select(.prompt | test("PROXY_MODE"; "i") | not)
    ' 2>/dev/null | wc -l | tr -d ' '
  )

  correct_total=$((proxy_correct + non_proxy))
  if [ "${total_tasks}" -gt 0 ]; then
    pct=$((correct_total * 100 / total_tasks))
    echo "  Task calls: ${total_tasks} total, ${proxy_correct} correct PROXY_MODE, ${non_proxy} non-PROXY"
    echo "  Compliance: ${pct}% (${correct_total}/${total_tasks})"
    if [ "${pct}" -ge 90 ]; then
      pass "${run_name}: Compliance >= 90% (${pct}%)"
    else
      fail "${run_name}: Compliance < 90% (${pct}%)"
    fi
  else
    echo "  (No Task calls to measure compliance)"
  fi

  echo ""
done

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "============================================================"
echo "  VALIDATION SUMMARY"
echo "============================================================"
echo ""
echo "  Total checks: ${TOTAL_CHECKS}"
echo "  Passed:       ${PASS_COUNT}"
echo "  Failed:       ${FAIL_COUNT}"
echo "  Warnings:     ${WARN_COUNT}"
echo ""

if [ "${FAIL_COUNT}" -eq 0 ] && [ "${WARN_COUNT}" -eq 0 ]; then
  echo "  RESULT: ALL CHECKS PASSED"
elif [ "${FAIL_COUNT}" -eq 0 ]; then
  echo "  RESULT: PASSED WITH WARNINGS"
else
  echo "  RESULT: FAILURES DETECTED"
  echo ""
  echo "  Review the FAIL entries above for details."
  echo "  Key enforcement files:"
  echo "    - plugins/multimodel/commands/team.md (model: opus + pre-processor)"
  echo "    - plugins/multimodel/scripts/resolve-agents.sh (deterministic agent resolution)"
  echo "    - plugins/multimodel/hooks/enforce-proxy-mode.sh (runtime violation blocker)"
  echo "    - plugins/multimodel/hooks/hooks.json (hook registration)"
fi

echo ""
echo "  Session: ${SESSION_DIR}"
echo "============================================================"

# Exit with failure code if any checks failed
[ "${FAIL_COUNT}" -eq 0 ]
