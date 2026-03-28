---
name: team
description: |
  Multi-model blind voting. Runs tasks across AI models in parallel via claudish MCP,
  collects independent votes (APPROVE/REJECT), presents aggregated verdicts.
  Examples: "/team Review auth implementation", "/team --models grok,gemini Check API security"
allowed-tools: Read, Write, Bash, Task, TaskCreate, TaskUpdate, TaskList, TaskGet, AskUserQuestion
model: opus
args:
  - name: task
    description: The task to submit to the team
    required: false
  - name: --models
    description: Comma-separated model IDs to override stored preferences
    required: false
  - name: --threshold
    description: Vote threshold (default 50%, "unanimous" for 100%, "supermajority" for 67%)
    required: false
  - name: --no-memory
    description: Don't save model preferences for this run
    required: false
---

## Step 1: Setup

Read `.claude/multimodel-team.json` (missing = all fields absent).
Parse: `defaultModels`, `contextPreferences`, `agentPreferences`, `defaultThreshold`, `claudeFlags`.
Parse args: task, `--models`, `--threshold`, `--no-memory`. If no task: ask the user.

**Resolve models** (stop at first match):
1. `--models` flag → use VERBATIM, skip alias table
2. `contextPreferences` keyword matching task → use those
3. `defaultModels` → use those, announce "Using saved models: {list}"
4. None matched → call the claudish `list_models` MCP tool, ask user to pick

**Resolve threshold:** unset/"majority" → 50%, "supermajority" → 67%, "unanimous" → 100%

**Resolve agent** (only if "internal" in model list): match task keywords to context detection table,
check `agentPreferences[context]` first, else table default, else `dev:researcher`.
Announce: "Agent: {RESOLVED_AGENT}"

**Session directory** (for internal model output): `Bash: SESSION_DIR="$(pwd)/ai-docs/sessions/team-$(date +%Y%m%d-%H%M%S)" && mkdir -p "$SESSION_DIR" && echo "$SESSION_DIR"`

**Build vote prompt** using the template below with `{TASK}` substituted.
Unless `--no-memory`, save resolved models to `defaultModels` in the preferences file.

## Step 2: Execute (single message, parallel)

Issue BOTH calls in ONE message. Do not serialize them.

**External models** (all non-"internal" model IDs):
```
claudish team(mode="run", path=SESSION_DIR, models=[...externals...],
  input=VOTE_PROMPT, timeout=180, claude_flags=claudeFlags)  ← omit claude_flags if empty
```

**Internal model** (if "internal" requested), same message:
```
Task(subagent_type=RESOLVED_AGENT, run_in_background=true,
  prompt=VOTE_PROMPT + "\n\nWrite your complete analysis and vote to: {SESSION_DIR}/internal-result.md")
```

## Step 3: Parse Votes

- From `team` tool response: extract per-model results (status, output, errors)
- From internal Task: Read `{SESSION_DIR}/internal-result.md`

Parse vote blocks: `/\`\`\`vote\s*\n([\s\S]*?)\n\s*\`\`\`/` → VERDICT, CONFIDENCE, SUMMARY, KEY_ISSUES

Calculate verdict:
- ABSTAIN excluded from denominator; need ≥2 valid (APPROVE/REJECT) votes, else INCONCLUSIVE
- `approval% = APPROVE / (APPROVE + REJECT) * 100`
- ≥ threshold → APPROVED; < (100 - threshold) → REJECTED; else → SPLIT

Failed models: show as FAILED in table, proceed with remaining. No retry, no substitution. See Error Reporting below.

## Step 4: Present Results

**Verification table:**
```
| Model | Method | Status | Output | Notes |
| {model} | team MCP / Task | OK/FAILED | {size} | {error} |
```

**Verdict:**
```
## Team Verdict: APPROVED / REJECTED / SPLIT / INCONCLUSIVE

| Model | Vote | Confidence | Summary |
| {model} | APPROVE/REJECT/ABSTAIN | {n}/10 | {summary} |

Result: {approve}/{valid} APPROVE ({pct}%) — Threshold: {threshold}%
```

Key issues ranked by frequency. Dissenting opinions if votes differ.
Save to `{SESSION_DIR}/verdict.md`.

### Error Reporting

If any models FAILED in the verification table:

1. After presenting the verdict, list failed models:
   ```
   {N} model(s) failed during this run. Would you like to report these errors
   to claudish developers? (Data is sanitized before sending.)
   ```

2. If user agrees, call `report_error` for each failed model:
   - `error_type`: `"team_failure"`
   - `model`: failed model ID
   - `session_path`: SESSION_DIR
   - `additional_context`: "Failed during /team run-and-judge"

3. If multiple failures, batch the question (ask once, report all).

---

## Knowledge

**Model aliases** — short single-word only; full IDs (contain dots/numbers) always verbatim:
| grok → grok-code-fast-1 | gemini → gemini-3.1-pro-preview | deepseek → deepseek-v3.2 |
| minimax → minimax-m2.5 | glm → glm-5 | kimi → kimi-k2.5 |

**NEVER add provider prefixes** (no "openai/", "google/", "mm@", "or@"). claudish resolves internally.

**Context detection:**
| Context | Keywords | Default Models | Agent |
|---------|----------|----------------|-------|
| debug | debug, error, bug, fix, trace | grok, glm, minimax | dev:debugger |
| research | research, investigate, analyze, explore | gemini, gpt-5, glm | dev:researcher |
| coding | implement, build, create, code, develop | grok, minimax, deepseek | dev:developer |
| review | review, audit, check, validate, verify | gemini, gpt-5, glm, grok | dev:researcher |
| architecture | architecture, design, plan, system, refactor | gemini, gpt-5, glm | dev:architect |
| testing | test, coverage, unit test, integration, e2e | grok, minimax, deepseek | dev:test-architect |

**Preferences** (`.claude/multimodel-team.json`): `defaultModels[]`, `defaultThreshold`, `claudeFlags`,
`contextPreferences{context:[models]}`, `agentPreferences{context:"agent"}`. All fields optional.

**Vote prompt template:**
```
## Team Vote: Independent Review

You are evaluating the following task independently. Provide your own assessment
based solely on what is presented. Do not assume any prior context.

### Task
{TASK}

### Required Vote Format
End your response with:

\`\`\`vote
VERDICT: [APPROVE|REJECT|ABSTAIN]
CONFIDENCE: [1-10]
SUMMARY: [One sentence]
KEY_ISSUES: [Comma-separated, or "None"]
\`\`\`

APPROVE = meets requirements, no blocking issues.
REJECT = significant issues that must be addressed.
ABSTAIN = only if truly unable to evaluate. Be decisive.
```
