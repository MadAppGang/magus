#!/bin/bash
# run.sh - Tech-Writer E2E Comparison Benchmark
#
# 3-phase pipeline:
#   Phase 1: Generate — produce docs with vanilla vs tech-writer approach
#   Phase 2: Judge   — 7 models blindly score both samples (randomized A/B)
#   Phase 3: Analyze — aggregate scores, compute weighted comparison
#
# This is NOT a standard autotest suite. It does not use runner-base.sh.
# Each individual execution reuses execute-test.sh from the shared framework.
#
# Usage:
#   ./autotest/tech-writer/run.sh [OPTIONS]
#
# Options:
#   --gen-model <model>    Model for generation (default: internal)
#   --topic <text>         Override topic (default: from test-cases.json)
#   --output-dir <dir>     Custom output directory
#   --timeout <seconds>    Per-execution timeout (default: 600)
#   --skip-generate        Reuse existing generated docs (requires --output-dir)
#   --skip-judge           Reuse existing judge outputs (requires --output-dir)
#   --dry-run              Show what would run without executing
#   --help                 Show this help message

set -euo pipefail

# Prevent CLAUDECODE nesting issues
unset CLAUDECODE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../framework" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Defaults
GEN_MODEL="internal"
TOPIC=""
OUTPUT_DIR=""
TIMEOUT=600
SKIP_GENERATE=false
SKIP_JUDGE=false
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --gen-model) GEN_MODEL="$2"; shift 2 ;;
    --topic) TOPIC="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --skip-generate) SKIP_GENERATE=true; shift ;;
    --skip-judge) SKIP_JUDGE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help)
      head -20 "$0" | tail -19
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

# --- Dependency checks ---

if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: brew install jq" >&2
  exit 1
fi

if ! command -v bun &>/dev/null; then
  echo "ERROR: 'bun' not found. Install with: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

# --- Load config ---

CONFIG_FILE="$SCRIPT_DIR/test-cases.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: test-cases.json not found in $SCRIPT_DIR" >&2
  exit 1
fi

# Load judge models
JUDGE_MODELS=()
JUDGE_IDS=()
while IFS=$'\t' read -r id model; do
  JUDGE_IDS+=("$id")
  JUDGE_MODELS+=("$model")
done < <(jq -r '.judges[] | [.id, .model] | @tsv' "$CONFIG_FILE")

# Load topic if not overridden
if [[ -z "$TOPIC" ]]; then
  TOPIC=$(jq -r '.topic.title' "$CONFIG_FILE")
fi

# --- Output directory ---

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$SCRIPT_DIR/results/run-$TIMESTAMP"
fi

mkdir -p "$OUTPUT_DIR"
cp "$CONFIG_FILE" "$OUTPUT_DIR/test-cases.json"

# --- Print banner ---

echo "=== Tech-Writer Comparison Benchmark ==="
echo "Topic:        $TOPIC"
echo "Gen model:    $GEN_MODEL"
echo "Judges:       ${JUDGE_IDS[*]}"
echo "Timeout:      ${TIMEOUT}s"
echo "Output:       $OUTPUT_DIR"
echo "Skip gen:     $SKIP_GENERATE"
echo "Skip judge:   $SKIP_JUDGE"
echo ""

if $DRY_RUN; then
  echo "[DRY RUN] Phase 1: Generate"
  echo "  default     → $OUTPUT_DIR/generate/default/"
  echo "  techwriter  → $OUTPUT_DIR/generate/techwriter/"
  echo ""
  echo "[DRY RUN] Phase 2: Judge (7 parallel)"
  for i in "${!JUDGE_IDS[@]}"; do
    echo "  ${JUDGE_IDS[$i]} (${JUDGE_MODELS[$i]}) → $OUTPUT_DIR/judge/${JUDGE_IDS[$i]}/"
  done
  echo ""
  echo "[DRY RUN] Phase 3: Analyze"
  echo "  bun $SCRIPT_DIR/analyze-results.ts $OUTPUT_DIR"
  echo ""
  echo "[DRY RUN] No executions performed."
  exit 0
fi

# --- Helper: extract final text from transcript.jsonl ---
# Extracts the last text content from the transcript
extract_output() {
  local transcript="$1"
  local output_file="$2"

  if [[ ! -f "$transcript" ]]; then
    echo "ERROR: Transcript not found: $transcript" >&2
    return 1
  fi

  # Try to extract from "result" type entries first (claudish --json format)
  # Use jq -j (no newline) and --slurp to handle multi-line result strings
  local result_text
  result_text=$(jq -rs '[.[] | select(.type == "result") | .result // empty] | last // empty' "$transcript" 2>/dev/null)

  if [[ -n "$result_text" && ${#result_text} -gt 50 ]]; then
    printf '%s' "$result_text" > "$output_file"
    return 0
  fi

  # Fallback: extract last assistant text blocks (slurp to handle multi-line)
  jq -rs '
    [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text // empty]
    | last // empty
  ' "$transcript" 2>/dev/null > "$output_file"

  if [[ -s "$output_file" ]]; then
    return 0
  fi

  echo "ERROR: Could not extract text from transcript: $transcript" >&2
  return 1
}

# =====================================================================
# PHASE 1: GENERATE
# =====================================================================

if ! $SKIP_GENERATE; then
  echo "=== Phase 1: Generate ==="
  echo ""

  for approach in default techwriter; do
    gen_dir="$OUTPUT_DIR/generate/$approach"
    mkdir -p "$gen_dir"

    prompt_file="$SCRIPT_DIR/prompts/generate-${approach}.md"
    if [[ ! -f "$prompt_file" ]]; then
      echo "ERROR: Prompt file not found: $prompt_file" >&2
      exit 1
    fi

    echo "  Generating: $approach (model=$GEN_MODEL)..."

    "$FRAMEWORK_DIR/execute-test.sh" \
      --test-id "generate-$approach" \
      --model "$GEN_MODEL" \
      --prompt-file "$prompt_file" \
      --output-dir "$gen_dir" \
      --timeout "$TIMEOUT" \
      || {
        echo "ERROR: Generation failed for $approach (exit=$?)" >&2
        exit 1
      }

    # Extract markdown output from transcript
    extract_output "$gen_dir/transcript.jsonl" "$gen_dir/output.md" || {
      echo "ERROR: Failed to extract output for $approach" >&2
      exit 1
    }

    # Validate non-empty
    output_len=$(wc -c < "$gen_dir/output.md" | tr -d ' ')
    if [[ "$output_len" -lt 100 ]]; then
      echo "ERROR: Generated output too short ($output_len chars) for $approach" >&2
      exit 1
    fi

    echo "  OK: $approach ($output_len chars)"
  done

  echo ""
  echo "  Generation complete."
  echo ""
else
  echo "=== Phase 1: Generate (SKIPPED) ==="
  # Validate outputs exist
  for approach in default techwriter; do
    if [[ ! -f "$OUTPUT_DIR/generate/$approach/output.md" ]]; then
      echo "ERROR: Missing $OUTPUT_DIR/generate/$approach/output.md (needed for --skip-generate)" >&2
      exit 1
    fi
  done
  echo "  Using existing outputs in $OUTPUT_DIR/generate/"
  echo ""
fi

# =====================================================================
# PHASE 2: JUDGE
# =====================================================================

if ! $SKIP_JUDGE; then
  echo "=== Phase 2: Judge ==="
  echo ""

  # Coin flip: randomly assign default/techwriter to Sample A/B
  # Use $RANDOM for a fair coin flip
  COIN=$((RANDOM % 2))
  if [[ $COIN -eq 0 ]]; then
    SAMPLE_A_APPROACH="default"
    SAMPLE_B_APPROACH="techwriter"
  else
    SAMPLE_A_APPROACH="techwriter"
    SAMPLE_B_APPROACH="default"
  fi

  echo "  A/B Assignment: Sample A = $SAMPLE_A_APPROACH, Sample B = $SAMPLE_B_APPROACH"

  # Save mapping for de-blinding
  cat > "$OUTPUT_DIR/sample-mapping.json" <<MAPJSON
{
  "coin_flip": $COIN,
  "sample_a": "$SAMPLE_A_APPROACH",
  "sample_b": "$SAMPLE_B_APPROACH",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
MAPJSON

  # Read generated outputs
  SAMPLE_A_CONTENT=$(cat "$OUTPUT_DIR/generate/$SAMPLE_A_APPROACH/output.md")
  SAMPLE_B_CONTENT=$(cat "$OUTPUT_DIR/generate/$SAMPLE_B_APPROACH/output.md")

  # Build judge prompt from template
  TEMPLATE=$(cat "$SCRIPT_DIR/prompts/judge-template.md")

  # Use awk for safe substitution (handles special chars in markdown)
  JUDGE_PROMPT_FILE="$OUTPUT_DIR/judge-prompt.md"

  # Write template with placeholders replaced
  # We use a two-pass approach: write sample files, then assemble with awk
  printf '%s' "$SAMPLE_A_CONTENT" > "$OUTPUT_DIR/.sample_a.tmp"
  printf '%s' "$SAMPLE_B_CONTENT" > "$OUTPUT_DIR/.sample_b.tmp"

  awk '
    /\{\{SAMPLE_A\}\}/ {
      while ((getline line < "'"$OUTPUT_DIR/.sample_a.tmp"'") > 0) print line
      next
    }
    /\{\{SAMPLE_B\}\}/ {
      while ((getline line < "'"$OUTPUT_DIR/.sample_b.tmp"'") > 0) print line
      next
    }
    { print }
  ' "$SCRIPT_DIR/prompts/judge-template.md" > "$JUDGE_PROMPT_FILE"

  rm -f "$OUTPUT_DIR/.sample_a.tmp" "$OUTPUT_DIR/.sample_b.tmp"

  echo "  Judge prompt: $JUDGE_PROMPT_FILE ($(wc -c < "$JUDGE_PROMPT_FILE" | tr -d ' ') chars)"
  echo ""

  # Launch all judges
  JUDGE_PIDS=()
  for i in "${!JUDGE_IDS[@]}"; do
    judge_id="${JUDGE_IDS[$i]}"
    judge_model="${JUDGE_MODELS[$i]}"
    judge_dir="$OUTPUT_DIR/judge/$judge_id"
    mkdir -p "$judge_dir"

    echo "  Launching judge: $judge_id ($judge_model)..."

    (
      "$FRAMEWORK_DIR/execute-test.sh" \
        --test-id "judge-$judge_id" \
        --model "$judge_model" \
        --prompt-file "$JUDGE_PROMPT_FILE" \
        --output-dir "$judge_dir" \
        --timeout "$TIMEOUT" \
        || true

      # Extract judge response
      extract_output "$judge_dir/transcript.jsonl" "$judge_dir/response.txt" 2>/dev/null || true
    ) &
    JUDGE_PIDS+=($!)
  done

  echo ""
  echo "  Waiting for ${#JUDGE_PIDS[@]} judges to complete..."

  # Wait for all judges
  JUDGE_FAILURES=0
  for pid in "${JUDGE_PIDS[@]}"; do
    wait "$pid" 2>/dev/null || JUDGE_FAILURES=$((JUDGE_FAILURES + 1))
  done

  # Count successful judges
  JUDGE_OK=0
  for judge_id in "${JUDGE_IDS[@]}"; do
    if [[ -f "$OUTPUT_DIR/judge/$judge_id/response.txt" && -s "$OUTPUT_DIR/judge/$judge_id/response.txt" ]]; then
      JUDGE_OK=$((JUDGE_OK + 1))
      echo "  OK: $judge_id"
    else
      echo "  FAIL: $judge_id (no response)"
    fi
  done

  echo ""
  echo "  Judges completed: $JUDGE_OK / ${#JUDGE_IDS[@]}"

  MIN_JUDGES=$(jq -r '.thresholds.min_judges' "$CONFIG_FILE")
  if [[ $JUDGE_OK -lt $MIN_JUDGES ]]; then
    echo "ERROR: Only $JUDGE_OK judges succeeded (minimum: $MIN_JUDGES)" >&2
    exit 1
  fi

  echo ""
else
  echo "=== Phase 2: Judge (SKIPPED) ==="
  if [[ ! -f "$OUTPUT_DIR/sample-mapping.json" ]]; then
    echo "ERROR: Missing $OUTPUT_DIR/sample-mapping.json (needed for --skip-judge)" >&2
    exit 1
  fi
  echo "  Using existing judge outputs in $OUTPUT_DIR/judge/"
  echo ""
fi

# =====================================================================
# PHASE 3: ANALYZE
# =====================================================================

echo "=== Phase 3: Analyze ==="
echo ""

bun "$SCRIPT_DIR/analyze-results.ts" "$OUTPUT_DIR" || {
  echo "WARNING: Analyzer returned non-zero exit code" >&2
}

echo ""
echo "=== Benchmark Complete ==="
echo "Output:       $OUTPUT_DIR"
echo "Mapping:      $OUTPUT_DIR/sample-mapping.json"
echo "Report (JSON):$OUTPUT_DIR/report/tech-writer-benchmark.json"
echo "Report (MD):  $OUTPUT_DIR/report/tech-writer-benchmark.md"
echo ""
