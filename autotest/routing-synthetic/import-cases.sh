#!/bin/bash
# import-cases.sh — Import generated test cases from magus-bench
#
# Converts magus-bench generated test cases into autotest test-cases.json format.
# Splits skill-type and agent-type cases into the correct check schemas.
#
# Usage:
#   ./autotest/routing-synthetic/import-cases.sh [--source <path>] [--count <n>]
#
# Options:
#   --source <path>    Path to generated JSON (default: ../../magus-bench/skill-routing-eval/generated/test-cases-generated.json)
#   --count <n>        Max cases to import (default: all)
#   --dry-run          Show what would be imported without writing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Defaults
SOURCE="${REPO_ROOT}/../magus-bench/skill-routing-eval/generated/test-cases-generated.json"
MAX_COUNT=0
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --source) SOURCE="$2"; shift 2 ;;
    --count) MAX_COUNT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help) head -14 "$0" | tail -13; exit 0 ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$SOURCE" ]]; then
  echo "ERROR: Source file not found: $SOURCE" >&2
  echo "Run: cd ../magus-bench/skill-routing-eval && ./generate-tests.sh" >&2
  exit 1
fi

if ! command -v bun &>/dev/null; then
  echo "ERROR: bun not found" >&2; exit 1
fi

echo "=== Import Generated Test Cases ==="
echo "Source: $SOURCE"

bun -e "
import { readFileSync, writeFileSync } from 'fs';

const source = JSON.parse(readFileSync('${SOURCE}', 'utf-8'));
const maxCount = ${MAX_COUNT};
const dryRun = ${DRY_RUN};

let cases = source.test_cases;
if (maxCount > 0) cases = cases.slice(0, maxCount);

// Convert to autotest format
const autotestCases = cases.map(c => {
  const base = {
    id: c.id,
    description: c.description || c.rationale,
    prompt: c.prompt,
    category: c.category,
    tags: [c.variant_type, c.difficulty, 'synthetic', 'seed:' + c.seed_id],
  };

  // Skill-type cases have checks object
  if (c.checks) {
    return { ...base, checks: c.checks };
  }

  // Agent-type cases use expected_agent
  const outcome = c.expected_outcome;
  if (outcome === 'NO_TASK_CALL') {
    return { ...base, expected_agent: 'NO_TASK_CALL' };
  }

  // Named agent
  return {
    ...base,
    expected_agent: outcome,
    expected_alternatives: [],
  };
});

const output = {
  meta: {
    description: 'Synthetically generated routing test cases. Imported from magus-bench skill-routing-eval.',
    version: '1.0.0',
    created: new Date().toISOString().split('T')[0],
    source_file: '${SOURCE}',
    seed_count: source.meta?.seed_count ?? 22,
    generated_count: autotestCases.length,
    generator: 'import-cases.sh + magus-bench/generate-test-cases.ts',
  },
  test_cases: autotestCases,
};

// Category stats
const cats = {};
for (const c of autotestCases) cats[c.category] = (cats[c.category] || 0) + 1;

const skillCases = autotestCases.filter(c => c.checks);
const agentCases = autotestCases.filter(c => c.expected_agent);

console.log('Total cases:  ' + autotestCases.length);
console.log('Skill-type:   ' + skillCases.length + ' (use analyze-transcript.py)');
console.log('Agent-type:   ' + agentCases.length + ' (use evaluator.ts)');
console.log('');
console.log('Categories:');
for (const [cat, count] of Object.entries(cats).sort(([,a],[,b]) => (b as number) - (a as number))) {
  console.log('  ' + String(cat).padEnd(24) + count);
}

if (dryRun) {
  console.log('');
  console.log('[DRY RUN] Would write ' + autotestCases.length + ' cases to test-cases.json');
} else {
  writeFileSync('${SCRIPT_DIR}/test-cases.json', JSON.stringify(output, null, 2) + '\n');
  console.log('');
  console.log('Wrote: ${SCRIPT_DIR}/test-cases.json');
}
"
