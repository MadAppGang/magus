---
name: agent-model
description: Picks the LLM retry_with_browser_use_agent and browser_extract_content use. Use when choosing the browser-use agent model, or the user mentions a cheap, slow, or smart model.
user-invocable: false
---

# Choosing the browser-use agent model

Two tools reason with an LLM of their own, which makes its own API calls and does not
borrow this Claude session:

- `retry_with_browser_use_agent` runs an **autonomous** agent loop in a fresh local
  Chromium of its own.
- `browser_extract_content` makes one model call over the current page's text.

The page tools (`browser_navigate`, `browser_click`, …) and cloud sessions use no model.
This skill decides *which* LLM, per task. The Python MCP server is deliberately dumb: it
reads config and accepts an override. The judgment lives here.

## Selection precedence (how the server resolves the model)

1. **Session override** — set by the `browser_set_agent_model` tool; it holds until the
   MCP server restarts.
2. **Configured** — the `"browser-use"."agentModel"` block merged from settings files:
   `~/.claude/settings.json` → `<project>/.claude/settings.json` →
   `<project>/.claude/settings.local.json` (local wins).
3. **Browser Use gateway** — if `BROWSER_USE_API_KEY` is set and nothing above:
   `BROWSER_USE_AGENT_MODEL` when set, else `bu-fast`.
4. **Default** — `anthropic` / `LATEST_SONNET_MODEL` (uses `ANTHROPIC_API_KEY`).

Nothing else is read. `~/.config/browseruse/config.json` is not consulted, so a model or
browser setting written there has no effect.

## Providers

| provider id | use for | key (env var NAME) | base_url |
|---|---|---|---|
| `anthropic` | Claude models — strong vision, best default | `ANTHROPIC_API_KEY` | **not accepted** |
| `openai` | GPT models | `OPENAI_API_KEY` | optional |
| `openai_compatible` | Kimi, GLM, Moonshot, Zhipu, or any OpenAI-compatible endpoint | your choice | **required** |
| `browser_use` | Browser Use's gateway models (`bu-fast` is the default) | `BROWSER_USE_API_KEY`, or a stored `browser-use login` | optional |

`anthropic` with a `base_url` is an error. To reach Claude through a proxy or another
gateway, use `openai_compatible` with that gateway's OpenAI-compatible URL.

Gateway model names from browser-use before 1.0 (`bu-latest`, and the numbered `bu-<n>-<n>`
names) are rejected with an error naming the 1.0 alternative.

Current Anthropic vision models: `LATEST_SONNET_MODEL` (default; best multi-step + vision),
`LATEST_OPUS_MODEL` (hardest reasoning), `LATEST_HAIKU_MODEL` (cheapest/fastest). Confirm live ids
against the `claude-api` skill before quoting one — do not rely on memory.

## Picking a model for the task

- **Simple scrape / read one page** → cheap+fast is fine: `LATEST_HAIKU_MODEL`, or a cheap
  `openai_compatible` model.
- **Multi-step form fill, navigation, recovering from popups** → `LATEST_SONNET_MODEL` (default).
- **Login / auth flows, ambiguous pages, hard reasoning** → `LATEST_SONNET_MODEL` or `LATEST_OPUS_MODEL`.
- **CAPTCHA / stealth / anti-bot** → no model choice fixes it: the agent runs a local
  Chromium that meets the same block. Use a cloud session (`browser_start_cloud_session`)
  and drive it with the page tools.
- If the user names a model or provider (Kimi, GLM, "the cheap one", "smartest"), honor it.

**Suggest the right model even when it differs from their configured default** — that's the point
of this skill. Read the task, recommend, then apply one of the two ways below.

## Two ways to apply a choice

**Ephemeral (until the MCP server restarts)** — call the tool:
```
browser_set_agent_model(provider="anthropic", model="LATEST_SONNET_MODEL")
browser_set_agent_model(provider="openai_compatible", model="moonshot-v1-128k",
                        base_url="https://api.moonshot.cn/v1", api_key_env="MOONSHOT_API_KEY")
```
No file edit. The tool builds the model at once, so a choice that cannot work (an unknown
provider, `anthropic` with a `base_url`, a missing key for `openai_compatible`, a rejected
model name) returns an `Error` line now and leaves the previous choice in place. A good
choice takes effect on the next agent or extraction call.

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
A bad settings choice is reported only when a tool first uses the model.

## Secrets — never store keys in settings

`apiKeyEnv` holds the **name** of an environment variable, never the key itself (settings.json is
often committed). Export that variable in the shell that starts Claude Code. The MCP server
inherits Claude Code's environment, so every exported key reaches it, custom providers included.
Never add the key to the plugin's `.mcp.json`: a `${VAR}` entry there makes Claude Code refuse to
start the server whenever the variable is unset, and edits to an installed plugin do not survive
its next update.
