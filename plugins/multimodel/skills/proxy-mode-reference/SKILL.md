---
name: proxy-mode-reference
version: 3.0.0
description: Reference guide for using external AI models via claudish MCP tools and CLI. Orchestration workflows (/team, /delegate) use MCP tools. Direct usage uses CLI. Includes model routing and error handling patterns.
keywords: [external-models, multi-model, claudish, mcp, team, create-session, routing-prefixes, minimax, kimi, glm, gemini, openai]
plugin: multimodel
updated: 2026-03-29
user-invocable: false
---

# External Models via Claudish — Reference Guide

## ⚠️ Learn and Reuse Model Preferences

Models are learned per context and reused automatically:

```bash
cat .claude/multimodel-team.json 2>/dev/null
```

1. Detect context from task keywords (debug/research/coding/review)
2. If `contextPreferences[context]` exists → **USE IT** (no asking)
3. If empty (first time) → ASK user → SAVE for that context
4. User says "change models" → UPDATE preferences

---

## How External Models Work

External models are invoked via **claudish MCP tools**. The orchestrator calls MCP tools directly — no Bash invocation needed.

```
Orchestrator → claudish MCP tool → External Model
```

### From /team Command (Automatic)

The `/team` command handles this automatically:
- **Internal models** → `Task({resolved_agent})` — auto-detected from task type
- **External models** → `team(mode="run", models=[...], input=PROMPT, timeout=180)`

The `team` MCP tool runs all models in parallel internally and returns structured per-model results.

### From /delegate Command

- `create_session(model, prompt, timeout_seconds, claude_flags)` → returns session_id
- React to channel events: `completed` → `get_output(session_id)`
- On `input_required` → forward to user → `send_input(session_id, answer)`

### Direct CLI Usage (for non-orchestration tasks)

```bash
# Pattern
claudish --model {MODEL_ID} --stdin --quiet < prompt-file.md > result.md

# Examples
claudish --model grok-code-fast-1 --stdin --quiet < task.md > grok-result.md
claudish --model gemini-3.1-pro-preview --stdin --quiet < task.md > gemini-result.md
```

## Model Routing

Claudish handles all model routing internally. Pass bare model names — claudish auto-resolves them to the best available provider.

```bash
# Just use bare model names — claudish handles the rest
claudish --model grok-code-fast-1 --stdin --quiet < task.md > result.md
claudish --model gemini-3.1-pro-preview --stdin --quiet < task.md > result.md
claudish --model gpt-5.3-codex --stdin --quiet < task.md > result.md
```

Do NOT add provider prefixes (`x-ai/`, `google/`, `openai/`, `minimax/`, etc.) — claudish manages provider detection and routing automatically since v5.4.0.

---

## Correct Usage Patterns

### Single External Model (via MCP)

```
// One-shot prompt
run_prompt(model="grok-code-fast-1", prompt="Review this code for security issues")

// Session-based (for longer tasks)
create_session(model="grok-code-fast-1", prompt=TASK_PROMPT, timeout_seconds=300)
```

### Parallel External Models (in /team)

```
// Single MCP tool call handles all external models in parallel
team(mode="run", path=SESSION_DIR, models=["grok-code-fast-1", "gemini-3.1-pro-preview"],
  input=VOTE_PROMPT, timeout=180)
```

### Verifying Results

**For `team` tool:** Check each model's status in the structured response.
**For `create_session`:** The `completed` channel event confirms success; `failed` event contains error details.

## Common Mistakes

### Mistake 1: Using Bash+CLI in orchestration

```
❌ WRONG — bypasses MCP structured I/O and error handling
Bash("claudish --model grok --stdin < task.md > result.md")

✅ CORRECT — use MCP tools in orchestration workflows
team(mode="run", models=["grok"], input=PROMPT, timeout=180)
```

## Error Escalation Protocol

**CRITICAL: When claudish fails, STOP and REPORT — never silently substitute a different model.**

### Rules

1. **If claudish exits with non-zero exit code or empty output:** STOP and report the exact error (from stderr log) to the user before trying any alternative.
2. **Never silently substitute a different model** than the user requested. If the user asked for Gemini, don't silently launch GPT-5 instead.
3. **Never silently retry with a different provider prefix.** If `or@google/gemini-3.1-pro-preview` fails, don't silently try `g@gemini-3.1-pro-preview` without telling the user.
4. **Report all attempts made** so the user understands what was tried and can make an informed decision.

### Failure Report Template

```
"{Model} failed — {error category}.

Attempts:
1. {command tried} — {exact error from stderr}

Options:
(1) {Fix suggestion}
(2) Use a different model
(3) Skip and continue without this model
(4) Cancel
(5) Report this error to claudish developers

Which do you prefer?"
```

### When to apply

This protocol applies whenever a user has requested a specific external model. It does NOT apply to automated pipelines where the user said "use whatever works" or when the `/team` command is managing its own failure reporting.

### Error Reporting

After reporting the failure to the user, offer to send a sanitized error report to claudish developers:

```
Options:
(1) {Fix suggestion}
(2) Use a different model
(3) Skip and continue without this model
(4) Cancel
(5) Report this error to claudish developers
```

If the user selects (5), call the claudish `report_error` MCP tool:

```
report_error(
  error_type: "provider_failure",  // or "stream_error", "adapter_error", "team_failure"
  model: "{MODEL_ID}",
  stderr_snippet: "{error content from MCP result or channel event}",
  session_path: "{SESSION_DIR}",
  additional_context: "Invoked via multimodel plugin"
)
```

**Consent required:** Always ask before calling. Data is sanitized (API keys, paths, emails stripped).

**Automatic reporting:** Users can enable via `claudish config` → Privacy → Telemetry, or `CLAUDISH_TELEMETRY=1`. When enabled, errors report automatically.

See also: `multimodel:error-recovery` skill, Pattern 0 (User Escalation).

---

## Troubleshooting

### "claudish: command not found"
**Fix:** `npm install -g claudish`

### "OPENROUTER_API_KEY not set"
**Fix:** `export OPENROUTER_API_KEY=your-key`

### Non-zero exit code
**Fix:** Check stderr log for error details. Common causes: rate limits, invalid model ID, API key issues.
