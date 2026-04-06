---
name: team
description: |
  Multi-model blind voting. Runs tasks across AI models in parallel via claudish MCP,
  collects independent votes (APPROVE/REJECT), presents aggregated verdicts.
  Examples: "/team Review auth implementation", "/team --models grok,gemini Check API security"
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

**Step 1a — Load alias table:** Follow the `multimodel:claudish-usage` skill → "Model Alias Resolution" procedure to build ALIAS_TABLE from `shared/model-aliases.json` + `.claude/multimodel-team.json` `customAliases`.

**Step 1b — Parse args:**
Parse: `defaultModels`, `contextPreferences`, `agentPreferences`, `defaultThreshold`, `claudeFlags` from prefs.
Parse command args: task, `--models`, `--threshold`, `--no-memory`. If no task: ask the user.

**Step 1c — Resolve models** (stop at first match, resolve each name via ALIAS_TABLE):
1. `--models` flag provided → resolve each via ALIAS_TABLE
2. `contextPreferences` keyword matching task → resolve each via ALIAS_TABLE
3. `defaultModels` from prefs → resolve each via ALIAS_TABLE, announce "Using saved models: {list}"
4. None matched → read `shared/model-aliases.json` → `teams` section for task-type defaults
5. Still nothing → AskUserQuestion listing available aliases from ALIAS_TABLE

**Resolve threshold:** unset/"majority" → 50%, "supermajority" → 67%, "unanimous" → 100%

**Resolve agent** (only if "internal" in model list): match task keywords to context detection table,
check `agentPreferences[context]` first, else table default, else `dev:researcher`.
Announce: "Agent: {RESOLVED_AGENT}"

**Session directory** (for internal model output): `Bash: SESSION_DIR="$(pwd)/ai-docs/sessions/team-$(date +%Y%m%d-%H%M%S)" && mkdir -p "$SESSION_DIR" && echo "$SESSION_DIR"`

**Build vote prompt** using the template below with `{TASK}` substituted.
Unless `--no-memory`, save resolved models to `defaultModels` in the preferences file.

## Step 2: Execute (single message, parallel)

Issue BOTH calls in ONE message. Do not serialize them.

**CRITICAL:** "internal" is NOT a real model — never pass it to claudish. Filter it out first.

**External models** (all models EXCEPT "internal"):
```
claudish team(mode="run", path=SESSION_DIR, models=[...all models with "internal" removed...],
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

**Model alias resolution** — see `multimodel:claudish-usage` skill → "Model Alias Resolution" section. ALIAS_TABLE built in Step 1a. NEVER resolve from memory. NEVER add provider prefixes.

**Context detection:**
| Context | Keywords | Default Models | Agent |
|---------|----------|----------------|-------|
| debug | debug, error, bug, fix, trace | Read `shared/model-aliases.json` → `teams.debug` | dev:debugger |
| research | research, investigate, analyze, explore | Read `shared/model-aliases.json` → `teams.research` | dev:researcher |
| coding | implement, build, create, code, develop | Read `shared/model-aliases.json` → `teams.code` | dev:developer |
| review | review, audit, check, validate, verify | Read `shared/model-aliases.json` → `teams.review` | dev:researcher |
| architecture | architecture, design, plan, system, refactor | Read `shared/model-aliases.json` → `teams.architecture` | dev:architect |
| testing | test, coverage, unit test, integration, e2e | Read `shared/model-aliases.json` → `teams.code` | dev:test-architect |

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
