#!/bin/bash
set -euo pipefail

# ============================================================================
# validate-team-orchestration.sh
# Runs 10 sequential /team invocations via `claude -p` and saves transcripts
# for analysis by analyze-team-transcript.sh
#
# Designed to test diverse task types, model combos, and agent selection.
# Target: 90% compliance (9/10 runs must use correct agent).
# ============================================================================

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SESSION_DIR="${REPO_ROOT}/ai-docs/sessions/team-validation-${TIMESTAMP}"

mkdir -p "${SESSION_DIR}"

TOTAL_RUNS=10

echo "============================================================"
echo "  /team Orchestration Validation (${TOTAL_RUNS} runs)"
echo "  Session: ${SESSION_DIR}"
echo "  Time:    $(date)"
echo "============================================================"
echo ""

# --------------------------------------------------------------------------
# 10 diverse run definitions
# Vary: task type, models, model count, provider mix
# --------------------------------------------------------------------------

# Run 1: Investigation (2 models) — should use dev:researcher
RUN1_MODELS="internal,x-ai/grok-code-fast-1"
RUN1_TASK="Investigate whether all plugin.json versions match the versions listed in CLAUDE.md"

# Run 2: Investigation (3 models) — should use dev:researcher
RUN2_MODELS="internal,g@gemini-3-pro-preview,mm@minimax-m2.1"
RUN2_TASK="Analyze how many skills each plugin has and which plugin has the most skills"

# Run 3: Review (2 models) — should use dev:researcher
RUN3_MODELS="internal,deepseek/deepseek-v3.2"
RUN3_TASK="Review the multimodel plugin hook system and validate that hooks.json is properly configured"

# Run 4: Investigation (3 models) — should use dev:researcher
RUN4_MODELS="internal,x-ai/grok-code-fast-1,z-ai/glm-4.7"
RUN4_TASK="Find all commands across all plugins and check if any command names conflict or overlap"

# Run 5: Review (3 models) — should use dev:researcher
RUN5_MODELS="internal,g@gemini-3-pro-preview,deepseek/deepseek-v3.2"
RUN5_TASK="Audit the frontend plugin agents directory and validate that all agent files follow the same format"

# Run 6: Investigation (2 models) — should use dev:researcher
RUN6_MODELS="internal,mm@minimax-m2.1"
RUN6_TASK="Check whether all plugins listed in marketplace.json actually exist in the plugins directory"

# Run 7: Review (2 models) — should use dev:researcher
RUN7_MODELS="internal,z-ai/glm-4.7"
RUN7_TASK="Validate that the code-analysis plugin skill files all have proper SKILL.md format with description sections"

# Run 8: Investigation (3 models) — should use dev:researcher
RUN8_MODELS="internal,x-ai/grok-code-fast-1,g@gemini-3-pro-preview"
RUN8_TASK="Investigate which plugins have MCP server configurations and compare their setup patterns"

# Run 9: Investigation (2 models) — should use dev:researcher
RUN9_MODELS="internal,deepseek/deepseek-v3.2"
RUN9_TASK="Analyze the git tags and find any plugins where the latest tag version differs from plugin.json version"

# Run 10: Review (3 models) — should use dev:researcher
RUN10_MODELS="internal,x-ai/grok-code-fast-1,mm@minimax-m2.1"
RUN10_TASK="Review the session-isolation skill and validate it covers all necessary isolation patterns"

run_team() {
  local run_num="$1"
  local models="$2"
  local task="$3"
  local transcript="${SESSION_DIR}/run${run_num}-transcript.jsonl"
  local output="${SESSION_DIR}/run${run_num}-output.txt"

  echo "------------------------------------------------------------"
  echo "  Run ${run_num} of ${TOTAL_RUNS}: models = ${models}"
  echo "  Task: ${task:0:80}..."
  echo "  Transcript: ${transcript}"
  echo "------------------------------------------------------------"

  local start_time
  start_time=$(date +%s)

  # Run claude in print mode with stream-json for full transcript
  # --verbose is required for stream-json with -p
  claude -p \
    --verbose \
    --output-format stream-json \
    --dangerously-skip-permissions \
    "/team --models '${models}' ${task}" \
    > "${transcript}" 2>&1 || true

  local end_time
  end_time=$(date +%s)
  local elapsed=$((end_time - start_time))

  # Extract human-readable text from transcript
  if [ -f "${transcript}" ]; then
    grep '"type":"assistant"' "${transcript}" 2>/dev/null \
      | jq -r '.message.content[]? | select(.type == "text") | .text' 2>/dev/null \
      > "${output}" || true

    local lines
    lines=$(wc -l < "${transcript}" | tr -d ' ')
    echo "  Completed in ${elapsed}s (${lines} transcript lines)"
  else
    echo "  WARNING: No transcript file created"
    echo "Run ${run_num} produced no transcript" > "${output}"
  fi

  echo ""
}

# --------------------------------------------------------------------------
# Execute all 10 runs sequentially
# --------------------------------------------------------------------------
for i in $(seq 1 ${TOTAL_RUNS}); do
  eval "models=\${RUN${i}_MODELS}"
  eval "task=\${RUN${i}_TASK}"
  echo "Starting Run ${i} of ${TOTAL_RUNS}..."
  run_team "${i}" "${models}" "${task}"
done

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
echo "============================================================"
echo "  All ${TOTAL_RUNS} runs complete"
echo "  Session: ${SESSION_DIR}"
echo ""
echo "  Files created:"
ls -la "${SESSION_DIR}/"
echo ""
echo "  Next step: Run the analysis script:"
echo "    bash scripts/analyze-team-transcript.sh ${SESSION_DIR}"
echo "============================================================"
