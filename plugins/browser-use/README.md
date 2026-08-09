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

The MCP server runs on `python3` and drives its own Chromium. Before your first real task:

```
browser_doctor
```

That is a preflight check covering Python, dependencies, Chromium, and which API keys are
visible. Run it first when anything behaves oddly; it turns "the browser is broken" into a
specific missing piece.

Keys are read from the environment, never stored in settings: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, and `BROWSER_USE_API_KEY` for hosted cloud sessions.

## What you get

The MCP server exposes the upstream Browser Use tools plus ten Magus-specific ones:

| Tool | Why it exists |
|---|---|
| `browser_evaluate` | Run JS in the live page and get the result back. Reaches Monaco/CodeMirror editors that `browser_type` cannot |
| `browser_keyboard` | Batch key sequences and insert literal text via CDP |
| `browser_press_key` | Single keys and shortcuts (`Meta+a`, `Enter`, `Escape`) |
| `browser_focus` | Focus any element by CSS selector, including hidden inputs |
| `browser_export_session` / `browser_import_session` | Save and restore cookies and localStorage across runs |
| `browser_start_cloud_session` | Hosted session with stealth mode, proxy rotation, CAPTCHA handling |
| `browser_set_agent_model` | Swap the autonomous agent's brain LLM for this session |
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

Element indices from `browser_get_state` are **snapshot-scoped and not stable across
calls**. The map is rebuilt every call, so the same element can get a different index.
Always `get_state` immediately before the call that consumes the index, or skip indices
entirely and target by CSS selector with `browser_focus` + `browser_keyboard`.

Every code path must close its session with `browser_close_session`, including error paths.
