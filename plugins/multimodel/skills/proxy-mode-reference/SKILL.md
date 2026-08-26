---
name: proxy-mode-reference
description: Reference for running models through the claudish MCP tools — team, create_session, run_prompt. Covers model routing, native Claude slots, require_pattern shape checks, and error handling. Use when working on /team, /delegate, or any claudish call.
disable-model-invocation: true
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
- **Every model, native and external** → one `team(mode="run", models=[...], input=PROMPT,
  timeout=180, require_pattern=..., agent=...)` call. Native Claude names (`internal`,
  `default`, `opus`, `sonnet`, `haiku`) are ordinary slots in that `models` array; the
  resolved agent travels as the `agent` argument and applies to every child in the run.

The `team` MCP tool runs all models in parallel internally and returns structured per-model results.
Because the native reviewer goes through the tool, `require_pattern` covers it too — a slot
that never produced the required shape is reported FAILED rather than silently succeeding.

### From /delegate Command

- `create_session(model, prompt, timeout_seconds, claude_flags)` → returns session_id
- React to channel events: `completed` → `get_output(session_id)`
- On `input_required` → forward to user → `send_input(session_id, answer)`

### Outside /team and /delegate

Still MCP — no path here shells out to the CLI.

- One-shot completion, no session lifecycle → `run_prompt(model, prompt, system_prompt, max_tokens)`
- One model with tools and a working directory → `create_session(...)` → `get_output(session_id)`

See "Correct Usage Patterns" below for both.

## Model Routing

Claudish handles all model routing internally. Pass bare model names — claudish auto-resolves them to the best available provider.

```
// Bare model names, in whichever MCP tool fits the task
team(mode="run", path=SESSION_DIR, models=["grok", "gemini", "gpt"], input=PROMPT, timeout=180)
run_prompt(model="grok", prompt=PROMPT)
create_session(model="gemini", prompt=PROMPT, timeout_seconds=300)
```

Native Claude names (`internal`/`default`, `opus`/`sonnet`/`haiku`/`claude-*`) are ordinary
entries — they go in the same `models` array, or in `model`, exactly like the rest.

Do NOT add provider prefixes (`x-ai/`, `google/`, `openai/`, `minimax/`, etc.) — claudish manages provider detection and routing automatically since v5.4.0.

---

## Correct Usage Patterns

### Single Model (via MCP)

```
// One-shot prompt — no session, no tools
run_prompt(model="grok", prompt="Review this code for security issues")

// Session-based (for longer tasks) — full parameters:
//   model, prompt, timeout_seconds, agent, claude_flags, work_dir
create_session(model="grok", prompt=TASK_PROMPT, timeout_seconds=300,
  agent=RESOLVED_AGENT, work_dir=WORK_DIR)
→ get_output(session_id)
```

### Parallel Panel (in /team)

````
// Single MCP tool call runs the whole panel in parallel — native and external alike
team(mode="run", path=SESSION_DIR, models=["internal", "grok", "gemini"],
  input=VOTE_PROMPT, timeout=180,
  require_pattern="```vote", agent=RESOLVED_AGENT)
````

Full parameter set: `mode, path, models, judges, input, timeout, require_pattern,
min_output_bytes, agent, claude_flags`. `agent` and `claude_flags` apply to every child in
the run — there is no per-model form.

**Set `require_pattern` whenever the prompt mandates an output shape.** It is what makes a
slot that exits 0 without producing that shape report FAILED (state EMPTY, reason
`shape_mismatch`) instead of succeeding.

**Reading the results:** the tool writes each slot to `response-NN.md` in the session
directory and maps slot IDs to model names in `manifest.json`. IDs are shuffled, so
responses can be read blind before the mapping is consulted. Never expect hand-named files
like `grok-result.md` — the tool does not produce them.

### Verifying Results

**For `team` tool:** Check each model's status in the structured response.
**For `create_session`:** The `completed` channel event confirms success; `failed` event contains error details.

## Common Mistakes

### Mistake 1: Using Bash+CLI in orchestration

```
❌ WRONG — shelling out bypasses MCP structured I/O, per-slot status, and require_pattern
Bash("claudish ...")

✅ CORRECT — use MCP tools in orchestration workflows
team(mode="run", path=SESSION_DIR, models=["grok"], input=PROMPT, timeout=180,
  require_pattern=<regex for the shape PROMPT mandates>)
```

## Error Escalation Protocol

**CRITICAL: When claudish fails, STOP and REPORT — never silently substitute a different model.**

### Rules

1. **If a slot reports FAILED, or returns empty output:** STOP and report the exact error to the user before trying any alternative — from the per-model result object for `team`, or the `failed` channel event for `create_session`.
2. **Never silently substitute a different model** than the user requested. If the user asked for Gemini, don't silently launch GPT-5 instead.
3. **Never silently retry with a different provider prefix.** If `or@google/gemini` fails, don't silently try `g@gemini` without telling the user.
4. **Report all attempts made** so the user understands what was tried and can make an informed decision.

### Failure Report Template

```
"{Model} failed — {error category}.

Attempts:
1. {tool call made} — {exact error from the result or channel event}

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

### claudish MCP tools are unavailable
**Fix:** The plugin's `.mcp.json` starts the server by running the claudish CLI, so it must be installed: `npm install -g claudish`. Restart the session so the MCP server registers.

### "OPENROUTER_API_KEY not set"
**Fix:** `export OPENROUTER_API_KEY=your-key`

### A slot reported FAILED
**Fix:** Read the error from the per-model result (`team`) or the `failed` channel event (`create_session`). Common causes: rate limits, invalid model ID, API key issues.
