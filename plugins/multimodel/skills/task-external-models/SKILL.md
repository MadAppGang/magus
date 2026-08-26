---
name: task-external-models
description: Quick reference for running external models in orchestration. They are invoked via claudish MCP tools (team, create_session), never the CLI. Use when unsure how to specify an external model.
disable-model-invocation: true
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
- **Every model, native and external, in ONE `team` call** →
  `claudish team(mode="run", models=[...], input=PROMPT, timeout=180, require_pattern=..., agent=...)`.
  Native Claude names (`internal`, `default`, `opus`, `sonnet`, `haiku`) are ordinary
  slots and belong in `models` alongside the external ones — they run on the user's own
  Claude subscription through claudish's native passthrough. There is no separate `Agent`
  dispatch and no `internal-result.md` handoff file. Requires `claudish >= 7.65.0`.
- **`team` DOES take `claude_flags`, and a first-class `agent`.** Its parameters are
  `mode, path, input, models, judges, timeout, require_pattern, min_output_bytes,
  agent, claude_flags`. Prefer the dedicated `agent`; an `--agent` placed inside
  `claude_flags` is ignored when `agent` is also set. Both apply to EVERY child in the
  run — there is no per-model form. `claude_flags` is split on whitespace, so a flag
  VALUE containing spaces cannot be expressed through it.
- **Pass `require_pattern` whenever the prompt mandates an output shape** — for a voting
  panel that is the vote-fence marker (three backticks immediately followed by `vote`).
  Without it, a model that exits 0 having never produced the block is reported as having
  succeeded. This is the guarantee the old background-`Agent` path could not offer,
  because claudish never saw that slot at all.

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
| `list_models` | **Authoritative** — current recommended models, pricing, access prefixes |
| `search_models` | **Authoritative** — every live variant in a model family |
| `compare_models` | Compare model capabilities |
| `run_prompt` | One-shot prompt to a single model (no session lifecycle) |
| `report_error` | Report failures to claudish developers |

---

## /team Execution Pattern

The `/team` command dispatches the whole panel in a single `team` MCP call. The tool
parallelises the models internally, so there is nothing to issue alongside it:

````
claudish team(mode="run", path=SESSION_DIR,
  models=["internal", "grok", "gemini"],
  input=VOTE_PROMPT, timeout=180,
  require_pattern="```vote", agent=RESOLVED_AGENT)
````

`"internal"` sits in that array like any other model. Because it goes through the tool, it
is covered by `require_pattern`: a native reviewer that answers without a vote block is
reported FAILED (state EMPTY, reason `shape_mismatch`) rather than silently counted.

---

## /delegate Execution Pattern

The `/delegate` command uses channel-based sessions:

```
// Start session
create_session(model="grok", prompt=TASK_PROMPT,
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

> **Note:** Model IDs change frequently — so resolve them live. `list_models` (and `search_models` for a specific family) is the authoritative source; claudish serves it from its own catalog with a 24-hour cache. There is no model-aliases file in this repo, and model IDs must never be recalled from memory: training data carries dead IDs. See `claudish:claudish-usage` → "Model Alias Resolution".

> **IMPORTANT: Pass model names EXACTLY as the user provides them.** Do NOT invent provider prefixes (like `minimax/`, `openai/`, `google/`) — claudish handles routing internally. The one exception is a backend selector that `list_models` itself reports on a model's **Access** line (e.g. `cx@LATEST_GPT_MODEL`): if the user asks for that backend, pass it through verbatim.

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
