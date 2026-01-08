---
name: task-external-models
version: 1.0.0
description: Quick-reference for using external AI models with Task tool. CRITICAL - PROXY_MODE is NOT a Task parameter - it goes in the PROMPT. Use when confused about "Task tool external model", "PROXY_MODE parameter", "how to specify external model", "Task doesn't have model parameter", "only accepts sonnet/opus/haiku", or "minimax/grok/gemini with Task". Trigger keywords - "Task tool parameter", "PROXY_MODE not working", "external model Task", "external LLM", "claudish directly", "claudish with Task", "model parameter missing".
tags: [task, proxy-mode, external-model, quick-reference]
keywords: [task tool, proxy_mode, external model, grok, gemini, gpt-5, minimax, claudish, parameter, prompt, external LLM]
---

# Task Tool + External Models: Quick Reference

## The Answer (TL;DR)

**PROXY_MODE is NOT a Task tool parameter. It goes IN THE PROMPT.**

The Task tool's `model` parameter only accepts: `sonnet`, `opus`, `haiku` (Claude models).

To use external models (Grok, GPT-5, Gemini, etc.), you:
1. Use a PROXY_MODE-enabled agent (e.g., `agentdev:reviewer`)
2. Put `PROXY_MODE: {model-id}` at the START of the prompt
3. The agent delegates to Claudish internally

---

## Correct Pattern

*Tool call shape (illustrative):*

```javascript
// CORRECT - PROXY_MODE in prompt, not as parameter
Task({
  description: "Grok code review",
  subagent_type: "agentdev:reviewer",  // Must support PROXY_MODE
  run_in_background: true,
  prompt: `PROXY_MODE: x-ai/grok-code-fast-1

Review the implementation at /path/to/file.ts

Focus on:
1. Error handling
2. Performance
3. Security`
})
```

---

## Common Mistakes

| Mistake | Why It Fails |
|---------|--------------|
| `model: "grok"` as Task parameter | Task's `model` only accepts sonnet/opus/haiku |
| `subagent_type: "general-purpose"` | general-purpose doesn't support PROXY_MODE |
| PROXY_MODE not on first line | Agent won't detect the directive |
| Running Bash claudish directly | Loses agent context and error handling |

---

## PROXY_MODE-Enabled Agents

**Key agents for quick reference:**

| Plugin | Agent | subagent_type |
|--------|-------|---------------|
| agentdev | reviewer | `agentdev:reviewer` |
| frontend | reviewer | `frontend:reviewer` |
| seo | analyst | `seo:analyst` |

**Full list of 18 agents:** See `orchestration:proxy-mode-reference`

> Most review/analyst agents support PROXY_MODE. Check the reference for complete list.

---

## Model IDs

> **Note:** Model IDs change frequently. Use `claudish --top-models` for current list.

```bash
# Get current available models
claudish --top-models    # Best value paid models
claudish --free          # Free models

# Example model IDs (verify with commands above)
x-ai/grok-code-fast-1       # Grok (fast coding)
minimax/minimax-m2.1        # MiniMax
google/gemini-3-pro-preview # Gemini Pro
openai/gpt-5.2              # GPT-5.2
deepseek/deepseek-chat-v3   # DeepSeek
qwen/qwen3-coder:free       # Free Qwen coder
```

> **Prefix routing:** Use direct API prefixes for cost savings: `oai/` (OpenAI), `g/` (Gemini), `mmax/` (MiniMax), `kimi/` (Kimi), `glm/` (GLM). See `orchestration:proxy-mode-reference` for full routing table.

---

## Parallel Multi-Model Review

*Tool call shape (illustrative):*

```javascript
// Launch multiple models in parallel (same message)
Task({
  description: "Grok review",
  subagent_type: "agentdev:reviewer",
  run_in_background: true,
  prompt: `PROXY_MODE: x-ai/grok-code-fast-1
Review /path/to/plan.md`
})

Task({
  description: "GPT-5 review",
  subagent_type: "agentdev:reviewer",
  run_in_background: true,
  prompt: `PROXY_MODE: openai/gpt-5.2
Review /path/to/plan.md`
})

Task({
  description: "Gemini review",
  subagent_type: "agentdev:reviewer",
  run_in_background: true,
  prompt: `PROXY_MODE: google/gemini-3-pro-preview
Review /path/to/plan.md`
})
```

---

## Related Skills

- **orchestration:proxy-mode-reference** - Complete PROXY_MODE documentation
- **orchestration:multi-model-validation** - Full parallel validation patterns
- **orchestration:model-tracking-protocol** - Progress tracking during reviews
- **orchestration:error-recovery** - Handle PROXY_MODE failures and timeouts
