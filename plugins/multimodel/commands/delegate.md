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
allowed-tools: Read, Write, Task, AskUserQuestion
model: opus
args:
  - name: task
    description: Model ID (optional), optional /plugin:command, and task description
    required: true
---

## Rules

- **MODEL NAMES VERBATIM** — never add prefixes. Only resolve short aliases from the table below. Full model IDs (dots, version numbers) are used as-is. Never call list_models to validate.
- **NO AUTO-RECOVERY** — on failure, report verbatim and stop. No retries, no substitution.
- **NO PRE-SOLVING** — do not read project files before launching. The external model investigates itself.
- **FORWARD input_required TO USER** — always use AskUserQuestion. Never auto-answer.

## Phase 1: Parse and Resolve

Read `.claude/multimodel-team.json` (if missing, treat as `{ defaultModels: [], claudeFlags: "" }`).

Parse `$ARGUMENTS` left-to-right:
- First token with no `/` or `--` prefix → MODEL_ARG (resolve via alias table)
- Token starting with `/` and containing `:` → EXPLICIT_COMMAND
- Remaining tokens → TASK_DESCRIPTION

Resolve MODEL (in order):
1. MODEL_ARG if parsed
2. `preferences.defaultModels[0]` — announce: "Using saved model: {id}"
3. AskUserQuestion: "Which model should handle this delegation?"

Read `claudeFlags` from preferences (pass to create_session if non-empty).

## Phase 2: Execute via Channel

Build prompt: `{EXPLICIT_COMMAND} {TASK_DESCRIPTION}` (omit EXPLICIT_COMMAND if not set).

Call the claudish `create_session` MCP tool:
- model: MODEL
- prompt: TASK_PROMPT
- timeout_seconds: 300
- claude_flags: claudeFlags (omit if empty)

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
    Short single-word aliases only. Full model IDs (containing dots or version numbers) are never aliases — use verbatim.

    | Alias | Full Model ID |
    |-------|---------------|
    | grok | grok-code-fast-1 |
    | gemini | gemini-3.1-pro-preview |
    | gpt-5 | gpt-5.3-codex |
    | deepseek | deepseek-v3.2 |
    | minimax | minimax-m2.5 |
    | glm | glm-5 |
    | kimi | kimi-k2.5 |
    | internal | internal (Claude) |
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
    `grok implement authentication`
    → MODEL=grok-code-fast-1, TASK="implement authentication"

    `gemini /dev:architect design payment service`
    → MODEL=gemini-3.1-pro-preview, EXPLICIT_COMMAND=/dev:architect, TASK="design payment service"

    `/dev:research rate limiting patterns`
    → EXPLICIT_COMMAND=/dev:research, TASK="rate limiting patterns" (model from preferences)

    `gpt-5.4 implement login` (full model ID, not alias)
    → MODEL=gpt-5.4 (verbatim), TASK="implement login"
  </argument_parsing_examples>
</knowledge>
