# Skill Routing Autotest

Automated testing framework for validating Claude Code's skill routing behavior — ensuring skills are invoked via the `Skill` tool (not `Task`), spelled correctly in Bash, and routed via the CLAUDE.md skill routing table.

## Background

On 2026-02-16, a triple failure cascade was identified:
1. Model tried `Task(code-analysis:claudemem-search)` — but it's a **skill**, not an agent
2. Model typed `clademem` instead of `claudemem` in Bash
3. CLAUDE.md had no skill routing table to guide correct invocation

This test suite validates the fixes and prevents regression.

## Quick Start

```bash
# Run all test cases
./autotest/skills/run-tests.sh

# Run specific test cases
./autotest/skills/run-tests.sh --cases skill-claudemem-explicit-01,skill-spelling-bash-01

# Dry run (show what would execute)
./autotest/skills/run-tests.sh --dry-run

# Custom timeout
./autotest/skills/run-tests.sh --timeout 180
```

## Test Cases

| ID | Category | Validates |
|----|----------|-----------|
| `skill-claudemem-explicit-01` | explicit-skill | Skill tool used for explicit claudemem request |
| `skill-claudemem-implicit-01` | implicit-skill | Routing table triggers correct skill |
| `skill-spelling-bash-01` | spelling | No typos in claudemem Bash commands |
| `skill-not-agent-01` | agent-vs-skill | claudemem-search never used as Task subagent_type |
| `skill-routing-detective-01` | mixed-routing | Agent for investigation, skill for search guidance |
| `skill-deep-analysis-01` | explicit-skill | deep-analysis invoked via Skill tool |
| `skill-architect-detective-01` | explicit-skill | architect-detective invoked via Skill tool |
| `skill-simple-no-skill-01` | no-skill | Simple tasks don't invoke unnecessary skills |

## Checks Reference

| Check | Validates |
|-------|-----------|
| `skill_invoked_is` | Exact skill name match in Skill tool |
| `skill_invoked_contains` | Skill name contains keyword |
| `no_skill_invoked` | No Skill tool calls at all |
| `no_task_with_skill_name` | No Task calls with skill names as subagent_type |
| `task_agent_is` | Task calls use expected agent |
| `bash_claudemem_spelled_correctly` | All claudemem Bash commands spelled right |
| `no_bash_typo_clademem` | No misspellings of claudemem |

## How It Works

1. **Test cases** (`test-cases.json`) define prompts and expected behaviors
2. **Runner** (`run-tests.sh`) sends each prompt to `claude -p` and captures JSONL transcripts
3. **Analyzer** (`analyze-transcript.py`) parses transcripts for `Skill` and `Task` tool calls
4. **Results** are compared against expected checks

## Directory Structure

```
autotest/skills/
  test-cases.json           Test case definitions
  run-tests.sh              Test runner
  analyze-transcript.py     Transcript analyzer
  README.md                 This file
  results/                  Test results (gitignored)
    run-YYYYMMDD-HHMMSS/
      test-cases.json       Snapshot of cases
      results-summary.json  Aggregated results
      <case-id>/
        transcript.jsonl    Full JSONL transcript
        analysis.json       Check results
        meta.json           Metadata and result
        stderr.txt          Claude CLI stderr
```
