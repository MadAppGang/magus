---
name: agent-model
description: Picks the browser-use agent brain LLM per task. Use when choosing a model for retry_with_browser_use_agent or a cloud session, or the user mentions a cheap, slow, or smart model.
user-invocable: false
---

# Choosing the browser-use agent brain

The `retry_with_browser_use_agent` tool and cloud sessions run an **autonomous** agent loop that
needs its own LLM to think with (it makes its own API calls — it does not borrow this Claude
session). This skill decides *which* LLM, per task. The Python MCP server is deliberately dumb: it
reads config and accepts an override. The judgment lives here.

## Selection precedence (how the server resolves the brain)

1. **Session override** — set at runtime by the `browser_set_agent_model` tool (this turn only).
2. **Configured** — the `"browser-use"."agentModel"` block merged from settings files:
   `~/.claude/settings.json` → `<project>/.claude/settings.json` →
   `<project>/.claude/settings.local.json` (local wins).
3. **Legacy** — if `BROWSER_USE_API_KEY` is set and nothing above, Browser Use's `bu-latest`.
4. **Default** — `anthropic` / `LATEST_SONNET_MODEL` (uses `ANTHROPIC_API_KEY`, already available).

## Providers

| provider id | use for | key (env var NAME) | base_url |
|---|---|---|---|
| `anthropic` | Claude models — strong vision, best default | `ANTHROPIC_API_KEY` | not needed |
| `openai` | GPT models | `OPENAI_API_KEY` | not needed |
| `openai_compatible` | Kimi, GLM, Moonshot, Zhipu, or any OpenAI-compatible endpoint | your choice | **required** |
| `browser_use` | Browser Use's hosted BU3 models (`bu-latest`, `bu-2-0`) | `BROWSER_USE_API_KEY` | not needed |

Current Anthropic vision models: `LATEST_SONNET_MODEL` (default; best multi-step + vision),
`LATEST_OPUS_MODEL` (hardest reasoning), `LATEST_HAIKU_MODEL` (cheapest/fastest). Confirm live ids
against the `claude-api` skill before quoting one — do not rely on memory.

## Picking a model for the task

- **Simple scrape / read one page** → cheap+fast is fine: `LATEST_HAIKU_MODEL`, or a cheap
  `openai_compatible` model.
- **Multi-step form fill, navigation, recovering from popups** → `LATEST_SONNET_MODEL` (default).
- **Login / auth flows, ambiguous pages, hard reasoning** → `LATEST_SONNET_MODEL` or `LATEST_OPUS_MODEL`.
- **CAPTCHA / stealth / anti-bot** → a cloud session (`browser_start_cloud_session`) with
  `browser_use` / `bu-latest`, which is tuned for it.
- If the user names a model or provider (Kimi, GLM, "the cheap one", "smartest"), honor it.

**Suggest the right model even when it differs from their configured default** — that's the point
of this skill. Read the task, recommend, then apply one of the two ways below.

## Two ways to apply a choice

**Ephemeral (this session, reverts next launch)** — call the tool:
```
browser_set_agent_model(provider="anthropic", model="LATEST_SONNET_MODEL")
browser_set_agent_model(provider="openai_compatible", model="moonshot-v1-128k",
                        base_url="https://api.moonshot.cn/v1", api_key_env="MOONSHOT_API_KEY")
```
No file edit; takes effect on the next agent call.

**Persistent (per project or per user)** — write to settings (relaunch the MCP server after). Use
the `update-config` skill to edit `.claude/settings.json` (committed) or `.claude/settings.local.json`
(gitignored):
```jsonc
{ "browser-use": { "agentModel": {
  "provider": "openai_compatible",
  "model": "glm-4.6",
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "apiKeyEnv": "ZHIPU_API_KEY",
  "temperature": 0.2
} } }
```

## Secrets — never store keys in settings

`apiKeyEnv` holds the **name** of an environment variable, never the key itself (settings.json is
often committed). For a custom `openai_compatible` provider, that env var must also reach the MCP
server: add it to the plugin's `.mcp.json` env block (e.g. `"ZHIPU_API_KEY": "${ZHIPU_API_KEY}"`)
and export it in your shell. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `BROWSER_USE_API_KEY`
already flow through — only custom providers need this step.
