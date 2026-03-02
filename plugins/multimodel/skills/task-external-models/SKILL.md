---
name: task-external-models
version: 3.0.0
description: Quick-reference for using external AI models in orchestration workflows. External models are invoked via Bash+claudish CLI (deterministic, 100% reliable). Claudish v5.3.0 supports Claude Code flag passthrough — unknown flags flow through to Claude Code automatically. Use when confused about how to run external models, "claudish with Bash", "external model in /team", or "how to specify external model". Trigger keywords - "external model", "claudish", "Bash claudish", "external LLM", "model parameter", "flag passthrough".
tags: [external-model, quick-reference, bash, claudish, agent-cli, flag-passthrough]
keywords: [external model, grok, gemini, gpt-5, minimax, claudish, bash, external LLM, cli, flag passthrough, effort, permission-mode]
plugin: multimodel
updated: 2026-03-02
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

## The Simple Truth

External AI models are invoked via **Bash+claudish CLI**. This is deterministic and 100% reliable.

```bash
claudish --model {MODEL_ID} --stdin --quiet < prompt.md > result.md
```

**With Claude Code flag passthrough (claudish v5.3.0+):**
```bash
claudish --model {MODEL_ID} --stdin --quiet --effort high --permission-mode plan < prompt.md > result.md
```
Claudish's two-pass parser recognizes its own flags (`--model`, `--stdin`, `--quiet`) and forwards
unknown flags (`--effort`, `--permission-mode`) directly to Claude Code.

**In /team orchestration:**
- **Internal model** (Claude) → `Task(subagent_type: "{RESOLVED_AGENT}")` — agent auto-detected from task type
- **External models** (Grok, Gemini, etc.) → `Bash(claudish --model {MODEL_ID} --stdin {CLAUDE_FLAGS})`
- **{CLAUDE_FLAGS}** comes from `claudeFlags` in `.claude/multimodel-team.json`

---

## Bash + claudish Pattern

**Works with ANY agent** — deterministic, no LLM compliance needed.

```bash
# Pattern — pass model names EXACTLY as user provides them, NO provider prefixes
claudish --model {MODEL_ID} --stdin --quiet < prompt.md > result.md 2>stderr.log; echo $? > result.exit

# Examples (bare model names — claudish handles routing internally)
claudish --model grok-code-fast-1 --stdin --quiet < task.md > grok.md 2>grok-err.log; echo $? > grok.exit
claudish --model gemini-3-pro-preview --stdin --quiet < task.md > gemini.md 2>gemini-err.log; echo $? > gemini.exit
claudish --model gpt-5.2-codex --stdin --quiet < task.md > gpt5.md 2>gpt5-err.log; echo $? > gpt5.exit
```

**CLI Reference (claudish v5.3.0+):**
```
claudish [options] [-- claude-code-flags...]

Claudish-owned flags:
--model <id>         AI model to use (e.g., grok-code-fast-1, minimax-m2.5)
--stdin              Read prompt from stdin
--quiet              Minimal output
-y, --auto-approve   Skip permission checks
--debug, -d          Enable claudish debug logging
--profile, -p        Select model profile

Passthrough flags (forwarded to Claude Code):
--effort <level>     low, medium, high
--permission-mode    acceptEdits, bypassPermissions, default, dontAsk, plan
--max-budget-usd     Spending cap for the session
--allowedTools       Restrict available tools
--system-prompt      Override system prompt
--append-system-prompt  Append to system prompt
--settings           Merged with claudish statusLine config
(any other unknown flag is forwarded automatically)
```

**Parallel Execution in /team:**

All Bash calls are launched in a SINGLE message with `run_in_background: true`:

```javascript
// Internal model via Task (agent resolved from task keywords)
Task({
  subagent_type: "{RESOLVED_AGENT}",
  description: "Internal Claude vote",
  run_in_background: true,
  prompt: "{VOTE_PROMPT}\n\nWrite to: {SESSION_DIR}/internal-result.md"
})
// External models get role context through a preamble in vote-prompt.md

// External models via Bash+claudish (all in same message)
// IMPORTANT: Use model names exactly as user provided — no provider prefixes
// {CLAUDE_FLAGS} comes from claudeFlags in .claude/multimodel-team.json (may be empty)
Bash({
  command: "claudish --model grok-code-fast-1 --stdin --quiet {CLAUDE_FLAGS} < {SESSION_DIR}/vote-prompt.md > {SESSION_DIR}/grok-result.md 2>{SESSION_DIR}/grok-stderr.log; echo $? > {SESSION_DIR}/grok.exit",
  run_in_background: true
})

Bash({
  command: "claudish --model gemini-3-pro-preview --stdin --quiet {CLAUDE_FLAGS} < {SESSION_DIR}/vote-prompt.md > {SESSION_DIR}/gemini-result.md 2>{SESSION_DIR}/gemini-stderr.log; echo $? > {SESSION_DIR}/gemini.exit",
  run_in_background: true
})
```

---

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|--------------|-----|
| Missing `--stdin` flag | claudish expects prompt as argument, truncated for large prompts | Use `--stdin` with `< prompt-file.md` |
| Not capturing exit code | No way to detect failures | Add `; echo $? > result.exit` |
| Not capturing stderr | Error details lost | Add `2>stderr.log` |
| `$(cat file.md)` in Task prompt | Shell expansion doesn't work in JSON string parameters | Read file content first, then include in prompt |
| Worrying about flag order | Not needed with claudish v5.3.0 two-pass parser | Known flags are recognized anywhere in the command |
| Adding provider prefixes to `--model` | claudish handles routing internally | Pass bare model names exactly as provided |

---

## Model IDs

> **Note:** Model IDs change frequently. Use `claudish --top-models` for current list.

```bash
# Get current available models
claudish --top-models    # Best value paid models
claudish --free          # Free models
```

> **IMPORTANT: Pass model names EXACTLY as the user provides them.** Do NOT add provider prefixes (like `minimax/`, `openai/`, `google/`). The claudish CLI handles routing and provider detection internally. If the user says `minimax-m2.5`, pass `minimax-m2.5` — not `minimax/minimax-m2.5`.

---

## Verifying Models Actually Ran

After collecting results from external models, **always verify**:

1. **Check exit code:** `cat {model-slug}.exit` → should be `0`
2. **Check output size:** `wc -c < {model-slug}-result.md` → should be >50 bytes
3. **Check stderr:** `cat {model-slug}-stderr.log` → should be empty or just info
4. **Record in verification table** for /team results display

**Verification checklist:**
```
For each external model result:
  ☐ Exit code is 0
  ☐ Result file exists and has >50 bytes
  ☐ Response contains substantive analysis (not just acknowledgment)
  ☐ No error messages in stderr log
```

---

## Related Skills

- **multimodel:multi-model-validation** - Full parallel validation patterns
- **multimodel:model-tracking-protocol** - Progress tracking during reviews
- **multimodel:error-recovery** - Handle failures and timeouts
