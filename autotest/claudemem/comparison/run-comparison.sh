#!/bin/bash
# run-comparison.sh — Head-to-head claudemem vs Serena efficiency test
#
# Runs identical task prompts against isolated MCP configs:
#   - claudemem-only (--strict-mcp-config)
#   - serena-only (--strict-mcp-config)
#
# Captures: transcript, duration, tool calls, token count
#
# Usage:
#   ./autotest/claudemem/comparison/run-comparison.sh [--cases <ids>] [--parallel]

set -euo pipefail
unset CLAUDECODE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_DIR="$SCRIPT_DIR/results/run-$TIMESTAMP"
TIMEOUT=300
MAX_BUDGET=0.50

# MCP configs
CLAUDEMEM_MCP="$SCRIPT_DIR/mcp-claudemem.json"
SERENA_MCP="$SCRIPT_DIR/mcp-serena.json"

# Test prompts directory
PROMPTS_DIR="$SCRIPT_DIR/prompts"

mkdir -p "$OUTPUT_DIR"

# Parse args
SELECTED_CASES=""
PARALLEL=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --cases) SELECTED_CASES="$2"; shift 2 ;;
    --parallel) PARALLEL=true; shift ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --max-budget) MAX_BUDGET="$2"; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

# Discover prompts
PROMPT_FILES=()
if [[ -n "$SELECTED_CASES" ]]; then
  IFS=',' read -ra IDS <<< "$SELECTED_CASES"
  for id in "${IDS[@]}"; do
    f="$PROMPTS_DIR/$id.md"
    [[ -f "$f" ]] && PROMPT_FILES+=("$f") || echo "WARN: $f not found"
  done
else
  for f in "$PROMPTS_DIR"/*.md; do
    [[ -f "$f" ]] && PROMPT_FILES+=("$f")
  done
fi

TOTAL=${#PROMPT_FILES[@]}
echo "=== Claudemem vs Serena Comparison ==="
echo "Tests:   $TOTAL"
echo "Timeout: ${TIMEOUT}s"
echo "Output:  $OUTPUT_DIR"
echo ""

# Run a single test
run_test() {
  local mcp_name="$1"    # claudemem or serena
  local mcp_config="$2"  # path to MCP JSON
  local prompt_file="$3" # path to prompt .md
  local test_id="$4"     # e.g. find-references

  local test_dir="$OUTPUT_DIR/$mcp_name/$test_id"
  mkdir -p "$test_dir"
  cp "$prompt_file" "$test_dir/prompt.md"

  local start_epoch=$(date +%s)
  local timed_out=false

  # Build env prefix for claudemem (LSP needs CLAUDEMEM_LSP in parent env)
  local env_prefix=""
  if [[ "$mcp_name" == "claudemem" ]]; then
    env_prefix="CLAUDEMEM_LSP=true"
  fi

  # Run claude -p in background with watchdog timer (macOS has no `timeout`)
  env $env_prefix claude -p \
    --strict-mcp-config \
    --mcp-config "$mcp_config" \
    --disable-slash-commands \
    --dangerously-skip-permissions \
    --verbose \
    --output-format stream-json \
    --max-budget-usd "$MAX_BUDGET" \
    < "$prompt_file" \
    > "$test_dir/transcript.jsonl" \
    2> "$test_dir/stderr.log" &
  local pid=$!

  # Watchdog: kill after TIMEOUT seconds
  ( sleep "$TIMEOUT" && kill "$pid" 2>/dev/null ) &
  local watchdog=$!

  local exit_code=0
  wait "$pid" 2>/dev/null || exit_code=$?

  # Clean up watchdog (|| true prevents set -e from killing script)
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true

  local end_epoch=$(date +%s)
  local duration=$((end_epoch - start_epoch))

  # Detect timeout (killed by signal = 128+signal)
  if (( duration >= TIMEOUT - 2 )); then
    timed_out=true
  fi

  # Extract MCP tool calls from transcript
  local mcp_calls=$(grep -o '"name":"mcp__[^"]*"' "$test_dir/transcript.jsonl" 2>/dev/null | sort | uniq -c | sort -rn)
  local total_mcp=$(grep -c '"type":"tool_use"' "$test_dir/transcript.jsonl" 2>/dev/null || echo 0)
  local total_lines=$(wc -l < "$test_dir/transcript.jsonl" 2>/dev/null || echo 0)

  # Write meta
  cat > "$test_dir/meta.json" <<METAJSON
{
  "test_id": "$test_id",
  "mcp_server": "$mcp_name",
  "duration_seconds": $duration,
  "exit_code": $exit_code,
  "total_mcp_tool_calls": $total_mcp,
  "transcript_lines": $total_lines,
  "timeout_seconds": $TIMEOUT,
  "max_budget_usd": $MAX_BUDGET,
  "timed_out": $timed_out
}
METAJSON

  local icon="OK"
  [[ $exit_code -ne 0 ]] && icon="FAIL"
  $timed_out && icon="TIMEOUT"
  echo "  $icon  [$test_id] mcp=$mcp_name dur=${duration}s tools=$total_mcp exit=$exit_code timeout=$timed_out"
}

# Execute all tests for both MCP servers
for prompt_file in "${PROMPT_FILES[@]}"; do
  test_id=$(basename "$prompt_file" .md)
  echo "--- $test_id ---"

  if $PARALLEL; then
    run_test "claudemem" "$CLAUDEMEM_MCP" "$prompt_file" "$test_id" &
    run_test "serena" "$SERENA_MCP" "$prompt_file" "$test_id" &
    wait
  else
    run_test "claudemem" "$CLAUDEMEM_MCP" "$prompt_file" "$test_id"
    run_test "serena" "$SERENA_MCP" "$prompt_file" "$test_id"
  fi
  echo ""
done

echo "=== Comparison Complete ==="
echo "Output: $OUTPUT_DIR"
echo ""
echo "Analyze: bun $SCRIPT_DIR/analyze-comparison.ts $OUTPUT_DIR"
