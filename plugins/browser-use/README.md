# Browser Use

Full-platform browser automation for Claude Code, backed by Playwright's own Chromium so
your real Chrome is never hijacked. Local and cloud browsers, live-page JavaScript
evaluation, keyboard and focus primitives, and a configurable agent brain LLM.

## Install

```bash
/plugin marketplace add MadAppGang/magus
```

```json
{ "enabledPlugins": { "browser-use@magus": true } }
```

## Requirements

The MCP server is a Python script that uv runs in its own pinned environment (browser-use
1.0; see [DEPENDENCIES.md](./DEPENDENCIES.md)), and it drives Playwright's Chromium.
`magus doctor --fix` installs what is missing. Before your first real task:

```
browser_doctor
```

That is a preflight check covering Python, dependencies, Chromium, and which API keys are
visible. Run it first when anything behaves oddly; it turns "the browser is broken" into a
specific missing piece.

Keys are read from the environment, never stored in settings: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, and `BROWSER_USE_API_KEY` for hosted cloud sessions. The agent model
that `retry_with_browser_use_agent` and `browser_extract_content` use is chosen in
settings.json (`"browser-use".agentModel`) or with `browser_set_agent_model`;
`~/.config/browseruse/config.json` is not read.

## What you get

The MCP server is the plugin's own: 27 tools. The page tools (navigate, click, type,
get_state, screenshot, scroll, tabs, sessions) are listed in `browser-use:core-api`.
These go beyond plain page control:

| Tool | Why it exists |
|---|---|
| `browser_evaluate` | Run JS in the live page and get the result back. Reaches Monaco/CodeMirror editors that `browser_type` cannot |
| `browser_keyboard` | Batch key sequences and insert literal text via CDP |
| `browser_press_key` | Single keys and shortcuts (`Meta+a`, `Enter`, `Escape`) |
| `browser_focus` | Focus any element by CSS selector, including hidden inputs |
| `browser_save_screenshot` | Write the live page to a PNG file; `browser_screenshot` only shows it to the model |
| `browser_export_session` / `browser_import_session` | Save and restore cookies across runs |
| `browser_start_cloud_session` | Hosted session with stealth mode, proxy rotation, CAPTCHA handling |
| `browser_set_agent_model` | Swap the agent model for this session; a choice that cannot work is an error at once |
| `retry_with_browser_use_agent` | Hand a task to browser-use's own agent, which runs in a fresh local Chromium of its own |
| `browser_run_script` | Run a standalone Python script with its own browser |
| `browser_doctor` | Environment preflight |

## Skills

| Skill | Read it when |
|---|---|
| `browser-use:core-api` | You are calling the MCP tools and need parameters, returns, or session lifecycle |
| `browser-use:navigation-patterns` | Multi-tab work, session creation, back/forward |
| `browser-use:web-scraping` | Structured extraction, pagination, dynamic SPAs, authenticated pages |
| `browser-use:debug-ui` | Screenshot capture and responsive layout checks |
| `browser-use:hybrid-debugging` | You need console and network too, combining this with claude-in-chrome |
| `browser-use:agent-model` | Choosing which LLM the autonomous agent thinks with |

## The one rule that bites

An element's `index` from `browser_get_state` is its Chrome node id (`backendNodeId`), not
a position from 1 to N. It stays valid while that element exists and stops working once
the page replaces it, which a navigation or a re-render does. Call `get_state` again after
anything that changes the page, or skip indices entirely and target by CSS selector with
`browser_focus` + `browser_keyboard`.

Every code path must close its session with `browser_close_session`, including error paths.

## Upgrading from a plugin built on browser-use 0.x

Each session now runs on a temporary profile that browser-use deletes itself, and nothing
is written under `~/.config/browseruse/profiles/` any more. Directories left there by
earlier versions (`browser-use-user-data-dir-session-*` and `session-*`) are safe to
delete.
