---
description: Detects the browser-use@magus plugin and runs headless browser automation for frontend workflows. Use when dev:frontend-developer or dev:browser-debugging needs navigation, clicking, or web scraping.
---

# Browser-Use Plugin Integration (dev)

## Overview

The `browser-use` plugin adds headless Chromium automation to frontend development workflows.
When installed alongside `dev`, it enables automated screenshot capture, interactive UI testing,
and visual regression detection without requiring the user's Chrome browser to be open.

This integration is **optional** — all dev plugin functionality works without browser-use installed.

## When to Use

Read this when:
- Implementing and validating UI components that need visual verification
- claude-in-chrome is unavailable but browser screenshots are needed
- Full-page screenshots are required (browser-use supports `full_page=True`, claude-in-chrome does not)
- Autonomous interaction testing: click through flows, fill forms, verify outcomes
- Running headless screenshot capture in CI-like contexts

## Detection Pattern

Probe the MCP tool directly — no subprocess, no plugin listing. A tool that answers is
the only presence check this integration makes:

```
browser_use_available = try mcp__plugin_browser-use_browser-use__browser_list_sessions()
  → success: browser-use is installed and its MCP server is running
  → error/not found: browser-use not available → fall back to claude-in-chrome or manual
```

## Integration Points

| dev Component | Without browser-use | With browser-use |
|--------------|---------------------|------------------|
| `dev:frontend-developer` agent | claude-in-chrome, or screenshots the user supplies | `browser_navigate` + `browser_save_screenshot` |
| `dev:browser-debugging` skill | claude-in-chrome only | browser-use for navigation and screenshots; claude-in-chrome when you need the user's own logged-in browser |
| UI implementation validation | Describe and check manually | A saved screenshot, judged by a vision model |
| Full-page screenshots | Not supported in claude-in-chrome | `browser_save_screenshot(full_page=true)` |
| Interactive flow testing | Manual description | `browser_click`, `browser_type` for simulated user actions |

Page tools (`browser_navigate`, `browser_get_state`, `browser_click`, `browser_type`,
`browser_screenshot`, `browser_save_screenshot`) take **no** `session_id`: they drive the
current page. Session ids exist only to list, close and export sessions. The full contract
is the browser-use plugin's `core-api` skill.

## Automated Screenshot Capture Pattern

For validating a UI component after implementation:

```
Step 1: Navigate to the implementation URL
  mcp__plugin_browser-use_browser-use__browser_navigate(url="http://localhost:3000/component")

Step 2: Record the session this task opened
  mcp__plugin_browser-use_browser-use__browser_list_sessions()  → note the new session_id

Step 3: Save the screenshot to a file
  mcp__plugin_browser-use_browser-use__browser_save_screenshot(output_path="<absolute path>/validation.png", full_page=false)
  → {"path": …, "width": W, "height": H}
  (`browser_screenshot` shows the image to the model but writes no file.)

Step 4: Close only the session you recorded
  mcp__plugin_browser-use_browser-use__browser_close_session(session_id="<recorded id>")
```

## Interactive Testing Pattern

For simulating user interactions:

```
Step 1: Navigate, then record the session id from browser_list_sessions
  mcp__plugin_browser-use_browser-use__browser_navigate(url=TARGET_URL)

Step 2: Inspect the DOM for element indices
  mcp__plugin_browser-use_browser-use__browser_get_state()
  → numbered interactive elements

Step 3: Interact
  mcp__plugin_browser-use_browser-use__browser_click(index=N)
  mcp__plugin_browser-use_browser-use__browser_type(index=M, text="input text")

Step 4: Verify the result
  mcp__plugin_browser-use_browser-use__browser_screenshot()

Step 5: Close the recorded session
  mcp__plugin_browser-use_browser-use__browser_close_session(session_id="<recorded id>")
```

## User Notification Template

If browser-use is NOT installed and user would benefit from it:

```
For automated browser testing and headless screenshot capture, install the browser-use plugin:
  /plugin marketplace add browser-use@magus

Without browser-use, you can still:
- Use claude-in-chrome for screenshot capture (requires Chrome extension)
- Judge manually provided screenshots with an external vision model (resolved from `list_models`)
- Run /dev:audit with a UI scope for pixel-diff validation — it routes to the designer plugin when that is installed
```
