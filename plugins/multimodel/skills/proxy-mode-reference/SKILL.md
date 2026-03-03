---
name: proxy-mode-reference
version: 2.0.0
description: Reference guide for using external AI models via claudish CLI. Use when running multi-model reviews, understanding how /team invokes external models, or debugging external model integration issues. Includes routing prefixes for MiniMax, Kimi, GLM direct APIs.
keywords: [external-models, multi-model, claudish, routing-prefixes, minimax, kimi, glm, gemini, openai, bash-claudish]
plugin: multimodel
updated: 2026-02-11
---

# External Models via Claudish CLI — Reference Guide

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

External models are invoked **deterministically** via the claudish CLI. The orchestrator
(e.g., `/team` command) calls claudish directly through Bash — no LLM delegation needed.

```
Orchestrator → Bash(claudish --model {MODEL_ID} --stdin) → External Model
```

This approach is 100% reliable because it's a direct CLI invocation, not a prompt-based delegation.

## Invoking External Models

### From /team Command (Automatic)

The `/team` command handles this automatically:
- **Internal models** → Task({resolved_agent}) — auto-detected from task type
- **External models** → Bash(claudish --model {MODEL_ID} --stdin)

### Direct CLI Usage

```bash
# Pattern
claudish --model {MODEL_ID} --stdin --quiet < prompt-file.md > result.md

# Examples
claudish --model grok-code-fast-1 --stdin --quiet < task.md > grok-result.md
claudish --model gemini-3.1-pro-preview --stdin --quiet < task.md > gemini-result.md
```

**Required flags:**
- `--model` — The external model to use
- `--stdin` — Read prompt from stdin (for large prompts)
- `--quiet` — Suppress log messages (for clean output capture)

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

### Single External Model

```bash
claudish --model grok-code-fast-1 --stdin --quiet < task.md > result.md
```

### Parallel External Models (in /team)

```bash
# All launched in a single message with run_in_background: true
Bash("claudish --model grok-code-fast-1 --stdin --quiet < vote-prompt.md > grok-result.md 2>grok-stderr.log; echo $? > grok.exit")
Bash("claudish --model gemini-3.1-pro-preview --stdin --quiet < vote-prompt.md > gemini-result.md 2>gemini-stderr.log; echo $? > gemini.exit")
```

### Verifying Results

```bash
# Check exit code
cat grok.exit  # 0 = success

# Check output size
wc -c < grok-result.md  # Should be >50 bytes

# Check stderr for errors
cat grok-stderr.log
```

## Common Mistakes

### Mistake 1: Not capturing exit code

```bash
# ❌ WRONG - no way to detect failures
claudish --model grok --stdin < task.md > result.md

# ✅ CORRECT - capture exit code
claudish --model grok --stdin < task.md > result.md 2>stderr.log; echo $? > result.exit
```

## Troubleshooting

### "claudish: command not found"
**Fix:** `npm install -g claudish`

### "OPENROUTER_API_KEY not set"
**Fix:** `export OPENROUTER_API_KEY=your-key`

### Non-zero exit code
**Fix:** Check stderr log for error details. Common causes: rate limits, invalid model ID, API key issues.
