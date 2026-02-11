#!/bin/bash
# Test the /delegate command approach for agent routing
# Tests whether skill loading via command frontmatter achieves correct delegation
#
# Configuration: CLAUDE.md routing table REMOVED, agent descriptions original one-liners
# Test: /delegate <task> should load dev:task-routing skill and delegate correctly

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_DIR="$SCRIPT_DIR/results/run-delegate-command-$TIMESTAMP"

mkdir -p "$OUTPUT_DIR"

echo "=== /delegate Command Test ==="
echo "Output: $OUTPUT_DIR"
echo ""
echo "Configuration:"
echo "  CLAUDE.md routing table: REMOVED"
echo "  Agent descriptions: Original one-liners"
echo "  Skill: dev:task-routing (loaded via command frontmatter)"
echo "  Command: /delegate (skills: dev:task-routing)"
echo ""

# Test cases: same prompts as delegate-research-01 and delegate-implement-01
# but prefixed with /delegate
declare -a TEST_IDS=("delegate-research" "delegate-implement")
declare -a TEST_PROMPTS=(
  "/dev:delegate I need a comprehensive deep-dive research report on modern authentication patterns including OAuth 2.1, passkeys, and WebAuthn. Search the web for recent developments, compare approaches, assess security tradeoffs, and write a detailed findings document to ai-docs/auth-research.md"
  "/dev:delegate Implement a complete caching layer for our plugin system: create a cache manager class, add LRU eviction, implement cache invalidation hooks, add comprehensive tests, and ensure all linting passes. This is a substantial feature implementation."
)
declare -a EXPECTED_AGENTS=("dev:researcher" "dev:developer")

PASS=0
FAIL=0
TOTAL=0

for i in "${!TEST_IDS[@]}"; do
  test_id="${TEST_IDS[$i]}"
  prompt="${TEST_PROMPTS[$i]}"
  expected="${EXPECTED_AGENTS[$i]}"

  test_dir="$OUTPUT_DIR/$test_id"
  mkdir -p "$test_dir"

  echo "--- Test: $test_id ---"
  echo "  Expected: $expected"
  echo "  Prompt: ${prompt:0:100}..."

  start_time=$(date +%s)

  # Run claude with the /delegate command
  set +e
  claude -p \
    --output-format stream-json \
    --verbose \
    --dangerously-skip-permissions \
    "$prompt" \
    > "$test_dir/transcript.jsonl" \
    2> "$test_dir/stderr.txt"
  exit_code=$?
  set -e

  end_time=$(date +%s)
  duration=$((end_time - start_time))

  # Extract actual agent used
  actual_agent=$(python3 -c "
import json

agents_used = []
skills_invoked = []
for line in open('$test_dir/transcript.jsonl'):
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        if obj.get('type') == 'assistant':
            for block in obj.get('message', {}).get('content', []):
                if block.get('type') == 'tool_use':
                    name = block.get('name', '')
                    inp = block.get('input', {})
                    if name == 'Task':
                        agent = inp.get('subagent_type', 'UNKNOWN')
                        agents_used.append(agent)
                    elif name == 'Skill':
                        skill = inp.get('skill', 'UNKNOWN')
                        skills_invoked.append(skill)
    except: pass

print('AGENTS:', ','.join(agents_used) if agents_used else 'NO_TASK_CALL')
print('SKILLS:', ','.join(skills_invoked) if skills_invoked else 'NONE')
" 2>/dev/null)

  agent_line=$(echo "$actual_agent" | grep "^AGENTS:" | sed 's/AGENTS: *//')
  skills_line=$(echo "$actual_agent" | grep "^SKILLS:" | sed 's/SKILLS: *//')

  # Get first agent
  first_agent=$(echo "$agent_line" | cut -d',' -f1)

  # Determine result
  if [[ "$first_agent" == "$expected" ]]; then
    result="PASS"
    ((PASS++))
  elif [[ "$first_agent" == "NO_TASK_CALL" ]]; then
    result="NO_DELEGATION"
  else
    result="WRONG_AGENT"
    ((FAIL++))
  fi
  ((TOTAL++))

  echo "  Result: $result"
  echo "  Agent: $first_agent"
  echo "  Skills: $skills_line"
  echo "  Duration: ${duration}s"
  echo ""

  # Save metadata
  jq -n \
    --arg id "$test_id" \
    --arg expected "$expected" \
    --arg actual "$first_agent" \
    --arg skills "$skills_line" \
    --arg result "$result" \
    --arg duration "$duration" \
    '{
      test_id: $id,
      expected_agent: $expected,
      actual_agent: $actual,
      skills_invoked: $skills,
      result: $result,
      duration_seconds: ($duration | tonumber),
      config: "delegate-command (no CLAUDE.md routing, original descriptions)"
    }' > "$test_dir/meta.json"
done

echo "=== Summary ==="
echo "Total: $TOTAL | Pass: $PASS | Fail: $FAIL"
if [[ $TOTAL -gt 0 ]]; then
  echo "Pass Rate: $(( PASS * 100 / TOTAL ))%"
fi
echo ""
echo "Results: $OUTPUT_DIR"
