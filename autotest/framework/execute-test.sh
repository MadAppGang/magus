#!/bin/bash
# execute-test.sh - Single test executor via claudish
#
# Runs a single test case against a single model using claudish,
# capturing dual output: JSONL transcript (stdout) + debug log (stderr).
#
# Usage:
#   ./execute-test.sh --test-id <id> --model <model> --prompt "text" --output-dir <dir>
#   ./execute-test.sh --test-id <id> --model <model> --prompt-file <path> --output-dir <dir>
#
# Output files (in output-dir):
#   transcript.jsonl  - JSONL conversation transcript (claudish --json)
#   debug.log         - Debug log with timing/tokens/tools (claudish --debug)
#   meta.json         - Test metadata (timestamps, exit code, duration)
#   .exit             - Exit code file (for background execution)

set -euo pipefail

# Prevent CLAUDECODE nesting issues
unset CLAUDECODE 2>/dev/null || true

# Defaults
TEST_ID=""
MODEL="monitor"
PROMPT=""
PROMPT_FILE=""
OUTPUT_DIR=""
TIMEOUT=300

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --test-id) TEST_ID="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --prompt-file) PROMPT_FILE="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --help)
      head -14 "$0" | tail -13
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Validate required args
if [[ -z "$TEST_ID" ]]; then
  echo "ERROR: --test-id required" >&2; exit 1
fi
if [[ -z "$OUTPUT_DIR" ]]; then
  echo "ERROR: --output-dir required" >&2; exit 1
fi
if [[ -z "$PROMPT" && -z "$PROMPT_FILE" ]]; then
  echo "ERROR: --prompt or --prompt-file required" >&2; exit 1
fi

# Verify claudish is installed
if ! command -v claudish &>/dev/null; then
  echo "ERROR: 'claudish' CLI not found. Install with: npm install -g claudish" >&2
  exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Write prompt to file if provided inline
if [[ -n "$PROMPT" && -z "$PROMPT_FILE" ]]; then
  PROMPT_FILE="$OUTPUT_DIR/prompt.md"
  printf '%s' "$PROMPT" > "$PROMPT_FILE"
elif [[ -n "$PROMPT_FILE" && ! -f "$PROMPT_FILE" ]]; then
  echo "ERROR: Prompt file not found: $PROMPT_FILE" >&2
  exit 1
fi

# Build claudish flags
CLAUDISH_FLAGS="-y --json --debug --log-level debug"
USE_NATIVE_CLAUDE=false
NATIVE_MODEL_FLAG=""

# Model selection:
#   "internal" — native Claude Code (claude -p) with full plugin/skill access, default model
#   "internal:sonnet" — native Claude Code (claude -p --model sonnet) with specific model
#   "monitor"  — claudish --monitor (broken since v5.2.0, kept for compat)
#   other      — claudish --model <name> (auto-routed by claudish)
if [[ "$MODEL" == "internal" ]]; then
  USE_NATIVE_CLAUDE=true
elif [[ "$MODEL" == internal:* ]]; then
  USE_NATIVE_CLAUDE=true
  NATIVE_MODEL_FLAG="--model ${MODEL#internal:}"
elif [[ "$MODEL" == "monitor" ]]; then
  CLAUDISH_FLAGS="$CLAUDISH_FLAGS --monitor"
else
  CLAUDISH_FLAGS="$CLAUDISH_FLAGS --model $MODEL"
fi

# Record start time
START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START_EPOCH=$(date +%s)

# Find timeout command (macOS compatibility)
TIMEOUT_CMD=""
if command -v gtimeout &>/dev/null; then
  TIMEOUT_CMD="gtimeout $TIMEOUT"
elif command -v timeout &>/dev/null; then
  TIMEOUT_CMD="timeout $TIMEOUT"
fi

# Snapshot existing claudish log files (so we can find the new one after)
LOGS_DIR="$(pwd)/logs"
LAST_LOG_BEFORE=""
if [[ -d "$LOGS_DIR" ]]; then
  LAST_LOG_BEFORE=$(ls -t "$LOGS_DIR"/claudish_*.log 2>/dev/null | head -1)
fi

# Execute test command with output capture
set +e
if [[ "$USE_NATIVE_CLAUDE" == "true" ]]; then
  # Native Claude Code — full plugin/skill access via claude -p
  # --output-format stream-json: JSONL transcript with tool calls visible
  # --dangerously-skip-permissions: non-interactive execution
  # --plugin-dir: load local dev plugin (skills not in cache yet)
  # EXTRA_PLUGIN_DIRS: space-separated list of additional plugin directories (set by suite runners)
  SUITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  PLUGIN_DIR="$SUITE_DIR/../plugins/dev"
  CLAUDE_P_FLAGS="-p --verbose --output-format stream-json --dangerously-skip-permissions"
  if [[ -n "$NATIVE_MODEL_FLAG" ]]; then
    CLAUDE_P_FLAGS="$CLAUDE_P_FLAGS $NATIVE_MODEL_FLAG"
  fi
  if [[ -d "$PLUGIN_DIR" ]]; then
    CLAUDE_P_FLAGS="$CLAUDE_P_FLAGS --plugin-dir $PLUGIN_DIR"
  fi
  # Append extra plugin dirs from suite runner (e.g., GTD suite adds plugins/gtd)
  for extra_dir in ${EXTRA_PLUGIN_DIRS:-}; do
    if [[ -d "$extra_dir" ]]; then
      CLAUDE_P_FLAGS="$CLAUDE_P_FLAGS --plugin-dir $extra_dir"
    fi
  done
  if [[ -n "$TIMEOUT_CMD" ]]; then
    $TIMEOUT_CMD claude $CLAUDE_P_FLAGS \
      < "$PROMPT_FILE" \
      > "$OUTPUT_DIR/transcript.jsonl" \
      2> "$OUTPUT_DIR/stderr.log"
  else
    claude $CLAUDE_P_FLAGS \
      < "$PROMPT_FILE" \
      > "$OUTPUT_DIR/transcript.jsonl" \
      2> "$OUTPUT_DIR/stderr.log"
  fi
  EXIT_CODE=$?
  # No claudish debug log for native claude — stderr.log serves as debug log
  if [[ -f "$OUTPUT_DIR/stderr.log" && -s "$OUTPUT_DIR/stderr.log" ]]; then
    cp "$OUTPUT_DIR/stderr.log" "$OUTPUT_DIR/debug.log"
  fi
else
  # claudish for external models
  # NOTE: claudish --debug writes to logs/claudish_*.log, NOT stderr.
  if [[ -n "$TIMEOUT_CMD" ]]; then
    $TIMEOUT_CMD claudish $CLAUDISH_FLAGS \
      --stdin < "$PROMPT_FILE" \
      > "$OUTPUT_DIR/transcript.jsonl" \
      2> "$OUTPUT_DIR/stderr.log"
  else
    claudish $CLAUDISH_FLAGS \
      --stdin < "$PROMPT_FILE" \
      > "$OUTPUT_DIR/transcript.jsonl" \
      2> "$OUTPUT_DIR/stderr.log"
  fi
  EXIT_CODE=$?

  # Find and copy the claudish debug log (written to logs/claudish_*.log)
  NEWEST_LOG=$(ls -t "$LOGS_DIR"/claudish_*.log 2>/dev/null | head -1)
  if [[ -n "$NEWEST_LOG" && "$NEWEST_LOG" != "$LAST_LOG_BEFORE" ]]; then
    cp "$NEWEST_LOG" "$OUTPUT_DIR/debug.log"
  else
    # Fallback: if no new log file, rename stderr as debug.log
    mv "$OUTPUT_DIR/stderr.log" "$OUTPUT_DIR/debug.log" 2>/dev/null || true
  fi
fi
set -e

# Clean up empty stderr.log
if [[ -f "$OUTPUT_DIR/stderr.log" && ! -s "$OUTPUT_DIR/stderr.log" ]]; then
  rm "$OUTPUT_DIR/stderr.log"
fi

# Record end time
END_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
END_EPOCH=$(date +%s)
DURATION=$((END_EPOCH - START_EPOCH))

# Write exit code file (for background execution polling)
echo "$EXIT_CODE" > "$OUTPUT_DIR/.exit"

# Write meta.json (pure shell - no python/bun dependency)
cat > "$OUTPUT_DIR/meta.json" <<METAJSON
{
  "test_id": "$TEST_ID",
  "model": "$MODEL",
  "started_at": "$START_ISO",
  "completed_at": "$END_ISO",
  "duration_seconds": $DURATION,
  "exit_code": $EXIT_CODE,
  "timeout_seconds": $TIMEOUT,
  "claudish_flags": "$(echo "$CLAUDISH_FLAGS" | sed 's/"/\\"/g')",
  "prompt_file": "$PROMPT_FILE",
  "framework_version": "1.0.0"
}
METAJSON

# Report result
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "  OK  [$TEST_ID] model=$MODEL duration=${DURATION}s"
else
  echo "  FAIL [$TEST_ID] model=$MODEL exit=$EXIT_CODE duration=${DURATION}s"
fi

exit $EXIT_CODE
