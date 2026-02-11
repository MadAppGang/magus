# Subagent Selection Autotest

Automated testing framework for validating Claude Code's subagent selection behavior.

## Quick Start

```bash
# Run all test cases (one run each)
./autotest/subagents/run-tests.sh

# Run specific test cases
./autotest/subagents/run-tests.sh --cases research-web-01,implement-01

# Run each case 3 times for statistical confidence
./autotest/subagents/run-tests.sh --runs 3

# Dry run (show what would execute)
./autotest/subagents/run-tests.sh --dry-run
```

## Analyzing Results

```bash
# Analyze the most recent run
./autotest/subagents/analyze-results.sh --latest

# Analyze a specific results directory
./autotest/subagents/analyze-results.sh autotest/subagents/results/run-YYYYMMDD-HHMMSS

# Show confusion matrix
./autotest/subagents/analyze-results.sh --latest --confusion-matrix
```

## How It Works

1. **Test cases** (`test-cases.json`) define prompts and expected subagent_type
2. **Runner** sends each prompt to `claude -p` and captures JSONL transcripts
3. **Analyzer** extracts the first `Task` tool call's `subagent_type` from each transcript
4. **Results** are compared against expected agents

## Test Case Format

```json
{
  "id": "research-web-01",
  "description": "Web research task should trigger dev:researcher",
  "prompt": "Search the web for best practices on JWT token refresh...",
  "expected_agent": "dev:researcher",
  "expected_alternatives": ["general-purpose"],
  "category": "research",
  "tags": ["web", "research"]
}
```

## Directory Structure

```
autotest/subagents/
  test-cases.json       Test case definitions
  run-tests.sh          Test runner
  analyze-results.sh    Results analyzer
  results/              Test results (gitignored)
    run-YYYYMMDD-HHMMSS/
      test-cases.json     Snapshot of cases
      results-summary.json Aggregated results
      <case-id>/
        run1-transcript.jsonl  Full transcript
        run1-output.txt        Human-readable output
        run1-meta.json         Metadata and result
  docs/                 Reference documentation
    official-subagents.md
    plugins-reference-agents.md
```

## Improvement Workflow

1. Run baseline tests
2. Modify agent descriptions
3. Re-run tests
4. Compare results: `analyze-results.sh --compare <old> <new>`
5. Iterate until pass rate improves
