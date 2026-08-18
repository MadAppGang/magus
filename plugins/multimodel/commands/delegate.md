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
- **NO PRE-SOLVING** — do not read project files before launching. The external model investigates itself.
- **FORWARD input_required TO USER** — always use AskUserQuestion. Never auto-answer.
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
2. `preferences.defaultModels[0]` → resolve via ALIAS_TABLE, announce "Using saved model: {id}"
3. AskUserQuestion: "Which model?" — list available aliases from ALIAS_TABLE

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

Channel events arrive as: `<channel source="claudish" session_id="..." event="...">content</channel>`

| Event | Action |
|-------|--------|
| `session_started` | Log: "Delegating to {MODEL}..." |
| `tool_executing` | Log: "{MODEL}: executing {content}" |
| `input_required` | Forward `content` to user via AskUserQuestion → call `send_input(SESSION_ID, answer)` → resume waiting |
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
    For delegation: `defaultModels[0]` is the default (single model). `claudeFlags` passed as `claude_flags`.
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
