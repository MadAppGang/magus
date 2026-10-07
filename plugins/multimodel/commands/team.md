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

**Step 1a — Load alias table:** Follow the `claudish:claudish-usage` skill → "Model Alias Resolution" procedure to build ALIAS_TABLE from the live catalog (`list_models`) + `.claude/multimodel-team.json` `customAliases`.

**Step 1b — Parse args:**
Parse: `defaultModels`, `contextPreferences`, `agentPreferences`, `defaultThreshold` from prefs.
Parse command args: task, `--models`, `--threshold`, `--no-memory`. If no task: ask the user.

**Step 1c — Resolve models** (stop at first match, resolve each name via ALIAS_TABLE):
1. `--models` flag provided → resolve each via ALIAS_TABLE
2. `contextPreferences` keyword matching task → resolve each via ALIAS_TABLE
3. `defaultModels` from prefs → resolve each via ALIAS_TABLE, announce "Using saved models: {list}"
4. None matched → compose a team from `list_models`: take `internal` plus 2–4 current
   models from different providers, picked for the task type (see table below)
5. Still nothing → AskUserQuestion listing the models `list_models` currently returns

**Resolve threshold:** unset/"majority" → 50%, "supermajority" → 67%, "unanimous" → 100%

**Resolve agent** (always — it applies to the whole panel): match task keywords to the
context detection table, check `agentPreferences[context]` first, else table default, else
`dev:researcher`. Announce: "Agent: {RESOLVED_AGENT}"

It is passed to `team` as the `agent` argument and applies to EVERY model in the run,
native and external alike; there is no per-model form. For a blind panel that is the
correct shape — every voter reviews by the same method, so a vote difference reflects the
model rather than the prompt.

**Session directory** (the `team` tool's session path): `Bash: SESSION_DIR="$(pwd)/ai-docs/sessions/team-$(date +%Y%m%d-%H%M%S)" && mkdir -p "$SESSION_DIR" && echo "$SESSION_DIR"`

**Build vote prompt** using the template below with `{TASK}` substituted, then **write it
to `${SESSION_DIR}/input.md`**. Step 2 passes that path, not the text — a vote prompt is
100+ lines, and an inline `input` echoes every line of it verbatim in the user's terminal,
burying the model list, the agent and the shape check.

Unless `--no-memory`, save resolved models to `defaultModels` in the preferences file.

## Step 2: Start the run

ONE `team` call starts the whole panel. The tool parallelises every model internally —
native and external alike — so there is no second dispatch to issue alongside it.

````
claudish team(mode="run", path=SESSION_DIR,
  models=[...ALL resolved models, "internal" included...],
  input_file=`${SESSION_DIR}/input.md`,
  require_pattern="```vote", agent=RESOLVED_AGENT)
````

**Requires `claudish >= 8.0.0`.** Check with `claudish --version` if a run behaves oddly.
On 7.67.x and earlier there is no `input_file` and `run` still blocks, so this command does
not work there at all.

**Do NOT pass `timeout`.** It was removed from the schema, and because the schema does not
set `additionalProperties: false` a leftover `timeout=180` is **silently ignored** — the
call reads as though it set a deadline while nothing enforces one. Nothing terminates a
slot on a timer any more; Step 2b is what replaced it.

**`run` does not return votes.** It starts the panel and returns immediately:

```json
{
  "started": true,
  "team_session_id": "team-20260827-0015",
  "session_path": "/abs/path/to/SESSION_DIR",
  "monitor_record": "team-5e6f7a8b",
  "slots": { "<model-id-a>": "01", "<model-id-b>": "02", "internal": "03" }
}
```

**Keep `slots`, `session_path` and `monitor_record`** (claudish 10.4.0 or later returns
`monitor_record`; Step 2b waits on it, and on `status.json` when it is absent). `slots`
maps each model name to its anonymised slot id, and that id addresses everything on disk
for that model — `response-<slot>.md`, `stats/<slot>.json`, `errors/<slot>.log`. Ids are
shuffled, so the responses can be read blind before the mapping is consulted.

**Native Claude names are ordinary slots.** `internal` and `default` select the host tier;
`opus`/`sonnet`/`haiku` select a specific one. They belong in `models` alongside the
external models, and run on the user's own Claude subscription through claudish's native
passthrough — no API key, no translation.

**`require_pattern` is not optional — it is the point.** It is why the native reviewer goes
through this call rather than a background `Agent`: a slot that exits 0 having never
produced a vote block is reported FAILED (state EMPTY, reason `shape_mismatch`) instead of
being silently counted as a success. Exit code 0 is not a success oracle — it is also 0 on
an API error, and on a child that simply ignored the required format. Nothing validated the
old `Agent` path, so a reviewer that never voted passed unnoticed.

## Step 2b: Wait until the run settles

Announce once: "Panel running: {N} models. Waiting for completion."

The `run` result's `monitor_record` names the run's end record in claudish's sessions
directory: one `meta.json`, written once when the run ends, whatever the outcome. Start a
bounded background wait on it with the `Monitor` tool and a 30-minute timeout
(`timeout_ms: 1800000`), running:

```bash
f="${CLAUDISH_SESSIONS_DIR:-$HOME/.claudish/sessions}/MONITOR_RECORD/meta.json"
until grep -Eqs '"status": *"(completed|failed|cancelled)"' "$f"; do sleep 10; done; echo "claudish team run MONITOR_RECORD ended"
```

It tests the record's end state, so a file that is missing, half written or unreadable is
read again ten seconds later. `MONITOR_RECORD` is `monitor_record`, not `team_session_id`:
both start with `team-`, and the wrong one names a directory that never appears, so the wait
runs to the ceiling. So does a `CLAUDISH_SESSIONS_DIR` set only in the claudish server's
`env` block: the wait reads the variable from Claude Code's environment, so it moves where
claudish writes and not where the wait looks (claudish plugin README, "How it knows which
runs are yours"). While the result carries `monitor_record`, do not wait on
`SESSION_PATH/status.json`: it is rewritten in place, and a slot can stay `RUNNING` in it
after the run has ended.

**A result with no `monitor_record`** comes from a claudish older than 10.4.0, which writes no
end record. Do not stop: run the same bounded wait, with the same tool and ceiling, on the
run's `status.json` instead. It needs `bun` on `PATH`:

```bash
f="SESSION_PATH/status.json"
until F="$f" bun --env-file=/dev/null -e 'try{const m=Object.values(JSON.parse(require("fs").readFileSync(process.env.F,"utf8")).models??{});process.exit(m.length>0&&m.every(s=>!/^(PENDING|RUNNING)$/.test(s?.state))?0:1)}catch{process.exit(1)}'; do sleep 10; done; echo "claudish team run settled"
```

It settles when the file parses and no slot in `models` is `PENDING` or `RUNNING`; a file
that is missing, half written or unparseable is read again ten seconds later. On this path a
start that failed or a whole-run cancel can leave a slot `RUNNING`, and the wait then runs to
the ceiling. Tell the user a claudish of 10.4.0 or later ends the wait exactly, but collect
the votes either way.

With claudish 10.4.0 or later, the claudish plugin's monitor also delivers
`claudish-monitor: team <id> completed|failed|cancelled … next: team-status` when the run
settles. Act on whichever arrives first. **Never end the turn without the wait running**: a
plugin monitor's line woke an idle session in two measured sessions, which is not a rate, and
under `claude -p` no monitor runs (claudish-usage skill, "Waiting for a run to end"). Never `sleep` in the foreground.

Then make the settled call:

````
claudish team(mode="status", path=SESSION_PATH)
````

**Settled means the run's end record exists** — the wait's line or the monitor's end line
says so. With no `monitor_record` it means no slot in `status.json` is `PENDING` or
`RUNNING`. Do not treat a slot going quiet as finished.

**Ceiling: 30 minutes wall clock** — the wait's timeout. When it fires with the run not
settled, go to Step 2c. Never restart the wait past it without the user: there is no server-side
deadline any more, so an unbounded wait is unbounded.

A settled `status` also carries `summary` — the rendered result card (`N/M succeeded`,
`reason=shape_mismatch`, and the rest) that the old blocking `run` used to return. Use it
for the verification table in Step 4.

## Step 2c: Decide about a quiet slot — do not auto-cancel

`status` carries two fields for this, and they are **only meaningful read together**:

- `idle_seconds_by_slot` — seconds since that slot last wrote anything.
- `activity_by_slot` — `starting`, `running`, `tool_executing`, `finishing`, or a terminal state.

| Idle | Activity | Reading |
|---|---|---|
| 90s+ | `tool_executing` | Normal. A build or test suite is running. Keep waiting. |
| 90s+ | `running` | The model stopped mid-answer. Candidate for cancel. |
| any | `finishing` | The answer is complete; the slot is exiting. Nothing to do. |

**Default for this command: do NOT cancel automatically.** At the ceiling, report the
still-running slots with their idle seconds and activity, and ask the user whether to wait
longer or cancel. Losing a vote to an impatient auto-cancel is the same failure the old
server-side deadline caused — it killed three of five actively-working slots in one real
session because its only progress signal was token flow, which stops during a local tool
call.

Only if the user says so:

````
claudish team(mode="cancel", path=SESSION_PATH, slot="02")   # one slot
claudish team(mode="cancel", path=SESSION_PATH)              # the whole run
````

A cancelled slot records `error.reason === "cancelled"`, which is distinct from
`nonzero_exit`. Report it in the table as CANCELLED, not FAILED — it was a decision, not a
crash.

## Step 3: Parse Votes

Only after Step 2b reports settled. For each entry in the `slots` map from Step 2, read
`{session_path}/response-{slot}.md` — that file holds the model's answer. There is no
separate handoff file, and the votes are **not** in the `run` response.

Parse vote blocks: `/\`\`\`vote\s*\n([\s\S]*?)\n\s*\`\`\`/` → VERDICT, CONFIDENCE, SUMMARY, KEY_ISSUES

Calculate verdict:
- ABSTAIN excluded from denominator; need ≥2 valid (APPROVE/REJECT) votes, else INCONCLUSIVE
- `approval% = APPROVE / (APPROVE + REJECT) * 100`
- ≥ threshold → APPROVED; < (100 - threshold) → REJECTED; else → SPLIT

A slot's outcome comes from `status.models[{slot}].state`:

| State | Treatment |
|---|---|
| `COMPLETED` | Read its response and parse the vote |
| `FAILED` / `EMPTY` | Did not vote. `error.reason` says why. |
| reason `shape_mismatch` | It answered but produced no vote block. Report FAILED; **do not go hunting for a verdict in its prose.** |
| reason `cancelled` | You cancelled it in Step 2c. Report CANCELLED. |
| `RUNNING` at the ceiling | Not a failure. Report it as still running. |

Failed models: show as FAILED in the table, proceed with the remaining. No retry, no
substitution. See Error Reporting below.

## Step 4: Present Results

**Verification table:**
```
| Model | Slot | Status | Output | Notes |
| {model} | {slot} | OK/FAILED/CANCELLED/RUNNING | {size} | {error.reason} |
```

`{slot}` comes from the `slots` map, `{size}` from `status.models[{slot}].outputSize`.

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
   - `additional_context`: "Failed during /team run + status poll"

Do **not** report a slot whose `error.reason` is `cancelled` — that was a local decision,
not a claudish failure.

3. If multiple failures, batch the question (ask once, report all).

---

## Knowledge

**Model alias resolution** — see `claudish:claudish-usage` skill → "Model Alias Resolution" section. ALIAS_TABLE built in Step 1a. NEVER resolve from memory. NEVER add provider prefixes.

**Context detection:**
Default models come from `contextPreferences[context]` when set. Otherwise compose
from `list_models` using the criterion below — always current, never hardcoded.

| Context | Keywords | Pick from `list_models` | Agent |
|---------|----------|-------------------------|-------|
| debug | debug, error, bug, fix, trace | reasoning-capable, mixed providers | dev:debugger |
| research | research, investigate, analyze, explore | large-context + reasoning | dev:researcher |
| coding | implement, build, create, code, develop | Fast variants, tools-capable | dev:developer |
| review | review, audit, check, validate, verify | flagships from 3+ distinct providers | dev:researcher |
| architecture | architecture, design, plan, system, refactor | most capable / reasoning | dev:architect |
| testing | test, coverage, unit test, integration, e2e | Fast variants, tools-capable | dev:qa-engineer |

**Preferences** (`.claude/multimodel-team.json`): `defaultModels[]`, `defaultThreshold`,
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
