---
name: delegate
description: |
  Delegate a task to an external AI model via claudish MCP channel session.
  The model runs a full Claude Code session with all plugins and skills loaded.
  Interactive: when the model asks questions, they're forwarded to you.

  Usage: /multimodel:delegate [model] [/plugin:command] <task>
  Examples:
    /multimodel:delegate grok implement authentication
    /multimodel:delegate gemini /dev:architect design payment service
    /multimodel:delegate /dev:research rate limiting patterns
args:
  - name: task
    description: Model ID (optional), optional /plugin:command, and task description
    required: true
---

## Rules

- **NO AUTO-RECOVERY** — on failure, report verbatim and stop. No retries, no substitution.
  **Resolution may default when nothing was named; recovery never substitutes a named
  model.** Picking a model the user did not specify is a documented, announced default
  (Step 1c.4). Swapping a model the user *did* specify, after it failed, is substitution
  and stays forbidden.
- **NO PRE-SOLVING** — do not read project files before launching. The external model investigates itself.
- **FORWARD input_required TO USER** — use AskUserQuestion whenever it is available. Never
  auto-answer. Where it is unavailable (`claude -p`), see Phase 3 — cancel the session and
  report the question rather than hanging on an answer that cannot arrive.
- **NEVER add provider prefixes** — no "openai/", "google/", "mm@", "or@". Claudish resolves internally.

## Phase 1: Parse and Resolve

**Step 1a — Load alias table:** Follow the `multimodel:claudish-usage` skill → "Model Alias Resolution" procedure to build ALIAS_TABLE from the live catalog (`list_models`) + `.claude/multimodel-team.json` `customAliases`.

**Step 1b — Parse arguments** left-to-right:
- First token with no `/` or `--` prefix → MODEL_ARG
- Token starting with `/` and containing `:` → resolve it before deciding what it is:
  - matches a **command or skill** → EXPLICIT_COMMAND (inlined into the prompt)
  - matches an **agent** (`plugins/<ns>/agents/*.md` frontmatter `name:`) → EXPLICIT_AGENT
  - matches neither → say so and ask; do not inline an unresolvable token
- Remaining tokens → TASK_DESCRIPTION

**An agent is not slash-invocable, and the ambiguity bites.** A name can be both:
<!-- doc-refs: off -->
`dev:architect` is an agent AND a command, so `/dev:architect` resolves. `dev:reviewer`
is agent-only, so `/dev:reviewer` silently does not — it is named here as the
counter-example, which is why this passage is exempt from the reference gate.
<!-- doc-refs: on -->
Resolving the token tells you which you have. Agents travel by flag, not by prompt
text — see Step 1d.

**Step 1c — Resolve MODEL** (in order, resolve each via ALIAS_TABLE):
1. MODEL_ARG if parsed → resolve via ALIAS_TABLE
2. **First entry of `preferences.defaultModels` that is not `internal`** → resolve via
   ALIAS_TABLE, announce "Using saved model: {id}"
3. AskUserQuestion: "Which model?" — list available aliases from ALIAS_TABLE.
   Use this whenever the tool is available.
4. **No model named, no usable preference, and AskUserQuestion unavailable**
   (a non-interactive `claude -p` session) → take the first entry of the `list_models`
   recommended set that is not `internal`. Announce, as its own line, before dispatch:

   > No model specified or saved; delegating to **{id}** (live-catalog default).
   > Pin one with `defaultModels`, or pass `/multimodel:delegate <model> <task>`.

   Then proceed. Do not stall.
5. Catalogue unreachable → stop with exactly:
   `No model named and the model catalogue is unreachable. Pass one explicitly:`
   `/multimodel:delegate <model> <task>`

**Why step 2 skips `internal`.** It means the host Claude model and is never dispatchable
(`claudish-usage` §"`internal` is never sent to claudish"). `/team` filters it as a CRITICAL
rule; this command did not, and `defaultModels[0]` is `internal` in an ordinary
configuration — including this repository's own `.claude/multimodel-team.json`. Unfiltered,
step 2 resolved MODEL to `internal` and handed it to claudish, which cannot run it. That
broke the normal configured path interactively, and no bench caught it because the bench
stages a workspace with no preferences file at all.

**Why step 4 comes AFTER the question, not before.** A single delegation has no other votes
to balance a wrong pick, so an interactive user must still be asked. Step 4 exists only
where asking is impossible. Ordering it earlier would fire a default ahead of every
interactive question — which `/team` can afford, having composed a diversified panel, and
this command cannot.

**Why a default here is not "auto-recovery".** The rule below forbids substituting after a
failure. Choosing when the user named nothing is a different act, and the announcement is
what keeps them different: a silent pick is the anti-pattern, an announced one is a
documented default with the override syntax attached. Measured 2026-08-19: with no default
specified, agents facing this dead end did not stop — two of them invented a model argument
(`Model resolved: gemini → gemini-3.6-flash`) from a prompt containing no such word.

**Step 1d — Build CLAUDE_FLAGS.** Start from `preferences.claudeFlags` (may be empty),
then append `--agent {EXPLICIT_AGENT}` if an agent was parsed.

`--agent` is a **Claude Code** flag (`claude --agent <agent>`, "Agent for the current
session"). Claudish does not implement it; it forwards any flag it does not recognise
straight through, and its own `--help` gives `--agent` as the worked example under
`CLAUDE CODE FLAG PASSTHROUGH`. Verified on claudish 7.48.0.

This is the **only** route that gives the external model the real agent: its system
prompt, its frontmatter tools, its preloaded skills, its reference tree. Naming the
agent in the prompt gets you a role description and none of that.

## Phase 2: Execute via Channel

Build prompt: `{EXPLICIT_COMMAND} {TASK_DESCRIPTION}` (omit EXPLICIT_COMMAND if not set).

Call the claudish `create_session` MCP tool:
- model: MODEL
- prompt: TASK_PROMPT
- timeout_seconds: 300
- claude_flags: CLAUDE_FLAGS from Step 1d (omit if empty)

Store the returned `session_id` as SESSION_ID.

## Phase 3: React to Channel Events

**The second dead end, and why it is fixed in the same change as Step 1c.4.** Step 1c.4
makes a non-interactive session reach dispatch. That moves the interactivity problem
downstream rather than removing it: `input_required` also forwards through
AskUserQuestion, so a delegated session that asks a question under `claude -p` would hang
on an answer that cannot arrive — turning a free pre-dispatch stall into a **paid session
stranded mid-flight**. Cancelling and reporting the question keeps the failure cheap and
legible.

Channel events arrive as: `<channel source="claudish" session_id="..." event="...">content</channel>`

| Event | Action |
|-------|--------|
| `session_started` | Log: "Delegating to {MODEL}..." |
| `tool_executing` | Log: "{MODEL}: executing {content}" |
| `input_required` | **AskUserQuestion available** → forward `content` → `send_input(SESSION_ID, answer)` → resume waiting. **Unavailable** (`claude -p`) → `cancel_session(SESSION_ID)`, then report: `The delegated session asked a question and this session cannot answer it. Question: {content}. Re-run interactively, or restate the task so it needs no clarification.` Stop. |
| `completed` | Call `get_output(SESSION_ID, tail_lines=200)` → proceed to Phase 4 |
| `failed` | Call `get_output(SESSION_ID)` → report error (first 20 lines) → see Error Reporting below → stop |

### Error Reporting (on failure)

When the session fails:

1. Call `get_output(SESSION_ID)` — show first 20 lines to user
2. Ask: "Would you like to report this error to claudish developers? (Data is sanitized.)"
3. If yes, call `report_error`:
   - `error_type`: `"provider_failure"` (model failure) or `"adapter_error"` (claudish crash)
   - `model`: MODEL
   - `session_path`: working directory
   - `stderr_snippet`: first 500 chars of error output
   - `additional_context`: "Delegated via /delegate command"
4. Stop (no retry, no substitution per rules)

## Phase 4: Present Results

- Output ≤ 50 lines → display inline
- Output > 50 lines → display first 50 lines, then: `[Output truncated. Full result available via session {SESSION_ID}]`

Always show footer:
```
---
Model: {MODEL} | Session: {SESSION_ID}
```

<knowledge>
  <model_aliases>
    See `multimodel:claudish-usage` skill → "Model Alias Resolution" for the full procedure.
    ALIAS_TABLE built in Phase 1a. NEVER resolve from memory. NEVER add prefixes.
    Special: `internal` means host Claude model — never sent to claudish.
  </model_aliases>

  <preferences_schema>
    File: `.claude/multimodel-team.json`
    ```json
    {
      "schemaVersion": "2.1.0",
      "defaultModels": ["model-id-1", "model-id-2"],
      "claudeFlags": "--effort high --max-budget-usd 0.50"
    }
    ```
    For delegation: the first non-`internal` entry of `defaultModels` is the default
    (single model). `claudeFlags` is passed through as `claude_flags`.

    **`claudeFlags` is also the cost guard.** It reaches Claude Code unmodified, so
    `--max-budget-usd 0.50` caps a delegated session's spend. Step 1c.4 can pick a model
    the user did not name; setting a budget here bounds what that can cost. No separate
    budget mechanism is needed or should be added.
  </preferences_schema>

  <argument_parsing_examples>
    Aliases below are illustrative — actual resolution comes from `list_models` (live catalog).

    `grok implement authentication`
    → MODEL=(resolved from aliases file via "grok" shortAlias), TASK="implement authentication"

    `gemini /dev:architect design payment service`
    → MODEL=gemini (resolved from aliases file), EXPLICIT_COMMAND=/dev:architect, TASK="design payment service"

    `/dev:research rate limiting patterns`
    → EXPLICIT_COMMAND=/dev:research, TASK="rate limiting patterns" (model from preferences)

    `gpt-5.4 implement login` (full model ID, not alias)
    → MODEL=gpt-5.4 (verbatim), TASK="implement login"
  </argument_parsing_examples>
</knowledge>
