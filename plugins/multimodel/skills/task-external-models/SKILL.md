---
name: task-external-models
version: 4.0.0
description: Quick-reference for using external AI models in orchestration workflows. External models are invoked via claudish MCP tools (team, create_session). Use when confused about how to run external models, "external model in /team", "how to specify external model", or "claudish MCP tools". Trigger keywords - "external model", "claudish", "external LLM", "model parameter", "MCP tool", "create_session", "team tool".
tags: [external-model, quick-reference, claudish, mcp, team, create-session]
keywords: [external model, grok, gemini, gpt-5, minimax, claudish, mcp, external LLM, create_session, team, effort, permission-mode]
plugin: multimodel
updated: 2026-03-29
user-invocable: false
---

# External Models: Quick Reference

## ⚠️ Learn and Reuse Model Preferences

Models are learned per context and reused automatically:

```bash
cat .claude/multimodel-team.json 2>/dev/null
```

**Flow:**
1. Detect context from task keywords (debug/research/coding/review)
2. If `contextPreferences[context]` has models → **USE THEM** (no asking)
3. If empty (first time for context) → ASK user → SAVE to that context
4. User says "use different models" → ASK and UPDATE

**Override triggers:** "use different models", "change models", "update preferences"

---

## How External Models Work

External AI models are invoked via **claudish MCP tools**. No Bash invocation needed.

**In /team orchestration:**
- **Internal model** (Claude) → `Task(subagent_type: "{RESOLVED_AGENT}")` — agent auto-detected from task type
- **External models** (Grok, Gemini, etc.) → `claudish team(mode="run", models=[...], input=PROMPT, timeout=180)`
- `claude_flags` comes from `claudeFlags` in `.claude/multimodel-team.json`

**For single-model delegation (/delegate):**
- `create_session(model, prompt, timeout_seconds, claude_flags)` → returns session_id
- Watch for channel `completed` event → `get_output(session_id)`
- On `input_required` → forward to user via AskUserQuestion → `send_input(session_id, answer)`

---

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `team` | Run prompt across multiple external models in parallel |
| `create_session` | Start a single async external model session |
| `get_output` | Retrieve output from a completed or running session |
| `send_input` | Answer a question from an interactive session |
| `list_sessions` | List active and completed sessions |
| `cancel_session` | Stop a running session |
| `list_models` | List available external models |
| `search_models` | Search for models by capability |
| `compare_models` | Compare model capabilities |
| `run_prompt` | One-shot prompt to a single model (no session lifecycle) |
| `report_error` | Report failures to claudish developers |

---

## /team Execution Pattern

The `/team` command uses the `team` MCP tool for all external models in a single call:

```
claudish team(mode="run", path=SESSION_DIR, models=[...externals...],
  input=VOTE_PROMPT, timeout=180, claude_flags=claudeFlags)
```

Internal models (Claude) run via Task in the **same message** for true parallelism:

```javascript
// Internal model via Task (agent resolved from task keywords)
Task({
  subagent_type: "{RESOLVED_AGENT}",
  description: "Internal Claude vote",
  run_in_background: true,
  prompt: "{VOTE_PROMPT}\n\nWrite to: {SESSION_DIR}/internal-result.md"
})

// External models — single MCP tool call handles all
// The team tool runs all models in parallel internally
claudish team(mode="run", path=SESSION_DIR,
  models=["grok-code-fast-1", "gemini-3.1-pro-preview"],
  input=VOTE_PROMPT, timeout=180, claude_flags=claudeFlags)
```

---

## /delegate Execution Pattern

The `/delegate` command uses channel-based sessions:

```
// Start session
create_session(model="grok-code-fast-1", prompt=TASK_PROMPT,
  timeout_seconds=300, claude_flags=claudeFlags)
→ returns session_id

// React to channel events
session_started  → Log: "Delegating to {MODEL}..."
tool_executing   → Log: "{MODEL}: executing {content}"
input_required   → AskUserQuestion → send_input(session_id, answer)
completed        → get_output(session_id, tail_lines=200)
failed           → get_output(session_id) → report error → stop
```

---

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|--------------|-----|
| Using `Bash(claudish --model ...)` | Bypasses MCP; loses structured I/O and error handling | Use `team` or `create_session` MCP tools |
| Adding provider prefixes to model IDs | claudish handles routing internally | Pass bare model names exactly as provided |
| Running claudish in main context | Pollutes context with full conversation output | Use MCP tools (sessions run externally) |

---

## Model IDs

> **Note:** Model IDs change frequently. Use `list_models` MCP tool or `claudish --top-models` for current list.

> **IMPORTANT: Pass model names EXACTLY as the user provides them.** Do NOT add provider prefixes (like `minimax/`, `openai/`, `google/`). The claudish MCP server handles routing and provider detection internally.

---

## Verifying Models Actually Ran

After collecting results from external models, **always verify**:

**For `team` tool results:** The tool returns structured per-model results including status, output, and errors. Check each model's status field.

**For `create_session` results:** The channel `completed` event confirms success. Call `get_output(session_id)` for full output. The `failed` event with content details the error.

**Verification checklist:**
```
For each external model result:
  ☐ Model status is "completed" (not "failed" or "timeout")
  ☐ Output contains substantive analysis (not just acknowledgment)
  ☐ No error content in the result
```

---

## Error Escalation Protocol

**When a model fails, follow this protocol:**

### Rule: STOP and REPORT — Never Silently Substitute

```
❌ WRONG (silent substitution):
   Gemini failed (rate limited) → silently launch GPT-5 instead
   claudish crashed → silently fall back to embedded Claude

✅ CORRECT (report and ask):
   Gemini failed (rate limited) → STOP → report exact error → present options → wait for user decision
```

### What to report

For `team` tool failures: extract the error from the per-model result object.
For `create_session` failures: the `failed` channel event content contains the error.

```
"{Model} failed.

What happened:
1. Tool: {team or create_session}
   Error: {error content from result or channel event}

Options:
(1) Retry the same model
(2) Use a different model
(3) Skip this model, continue with others
(4) Cancel
(5) Report this error to claudish developers

Which do you prefer?"
```

### Error Reporting via MCP

When the user chooses to report an error, call the claudish `report_error` MCP tool:

```
report_error(
  error_type: "{provider_failure|adapter_error|stream_error|team_failure}",
  model: "{MODEL_ID}",
  stderr_snippet: "{error content from result}",
  session_path: "{SESSION_DIR}",
  additional_context: "Invoked via multimodel plugin"
)
```

**Consent required.** All data is sanitized before sending.

See also: `multimodel:error-recovery` skill for retry patterns.

---

## Related Skills

- **multimodel:multi-model-validation** - Full parallel validation patterns
- **multimodel:model-tracking-protocol** - Progress tracking during reviews
- **multimodel:error-recovery** - Handle failures and timeouts
