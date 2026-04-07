---
name: browser-use-integration
version: 1.0.0
description: |
  Optional integration patterns for the browser-use plugin (browser-use@magus).
  Provides detection pattern and automated browser workflows for frontend development.
  Use when dev:frontend agent or dev:browser-debugging skill needs headless browser automation.
  This is a SKILL (use Skill tool), NOT an agent.
user-invocable: false
---

# Browser-Use Plugin Integration (dev)

## Overview

The `browser-use` plugin adds headless Chromium automation to frontend development workflows.
When installed alongside `dev`, it enables automated screenshot capture, interactive UI testing,
and visual regression detection without requiring the user's Chrome browser to be open.

This skill is **optional** — all dev plugin functionality works without browser-use installed.

## When to Use

Use this skill when:
- Implementing and validating UI components that need visual verification
- claude-in-chrome is unavailable but browser screenshots are needed
- Full-page screenshots are required (browser-use supports `full_page=True`, claude-in-chrome does not)
- Autonomous interaction testing: click through flows, fill forms, verify outcomes
- Running headless screenshot capture in CI-like contexts

## Detection Pattern

In agents (preferred — no subprocess): probe the MCP tool directly:

```
browser_use_available = try mcp__browser-use__browser_list_sessions()
  → success: browser-use is installed and MCP server is running
  → error/not found: browser-use not available → fall back to claude-in-chrome or manual
```

In skill scripts (bash fallback for informational checks):

```bash
# Check browser-use plugin availability
browser_use_available=$(claude /plugin list 2>/dev/null | grep -c "browser-use" || echo "0")
if [ "$browser_use_available" -gt "0" ]; then
  echo "browser-use available — automated browser tools accessible"
else
  echo "browser-use not installed — use claude-in-chrome or manual screenshots"
fi
```

## Integration Points

| dev Component | Without browser-use | With browser-use |
|--------------|---------------------|------------------|
| `dev:frontend` agent | Manual Gemini screenshots or claude-in-chrome | Automated `browser_navigate` + `browser_screenshot` |
| `dev:browser-debugging` skill | claude-in-chrome only (DevTools access) | Hybrid mode: browser-use for screenshots, claude-in-chrome for console/network |
| UI implementation validation | Describe + check manually | Automated screenshot + Gemini vision analysis |
| Full-page screenshots | Not supported in claude-in-chrome | `browser_screenshot(full_page=True)` |
| Interactive flow testing | Manual description | `browser_click`, `browser_type` for simulated user actions |
| Complex autonomous tasks | Not available | `retry_with_browser_use_agent` for multi-step interactions |

## Automated Screenshot Capture Pattern

For validating a UI component after implementation:

```
Step 1: Navigate to implementation URL
  mcp__browser-use__browser_navigate(url: "http://localhost:3000/component")
  → session_id: "val_01"

Step 2: Capture screenshot for visual validation
  mcp__browser-use__browser_screenshot(session_id: "val_01", full_page: False)
  → base64 PNG — Claude can analyze directly or save to file

Step 3: (Optional) Save to file for record-keeping
  Bash:
  python3 -c "import base64, sys; open('validation.png','wb').write(base64.b64decode(sys.argv[1]))" "${BASE64_DATA}"

Step 4: Always close session
  mcp__browser-use__browser_close_session(session_id: "val_01")
```

## Interactive Testing Pattern

For simulating user interactions:

```
Step 1: Navigate
  mcp__browser-use__browser_navigate(url: TARGET_URL)
  → session_id

Step 2: Inspect DOM for element indices
  mcp__browser-use__browser_get_state(session_id: session_id)
  → selector_map with numbered elements

Step 3: Interact
  mcp__browser-use__browser_click(index: N, session_id: session_id)
  mcp__browser-use__browser_type(index: M, text: "input text", session_id: session_id)

Step 4: Verify result
  mcp__browser-use__browser_screenshot(session_id: session_id)

Step 5: Close
  mcp__browser-use__browser_close_session(session_id: session_id)
```

## User Notification Template

If browser-use is NOT installed and user would benefit from it:

```
For automated browser testing and headless screenshot capture, install the browser-use plugin:
  /plugin marketplace add browser-use@magus

Without browser-use, you can still:
- Use claude-in-chrome for screenshot capture (requires Chrome extension)
- Use Gemini with manually provided screenshots for visual analysis
- Use designer:review for pixel-diff validation (requires designer plugin)
```
