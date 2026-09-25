---
name: browser-use-integration
description: Detects the browser-use@magus plugin and captures screenshots of URL-based references. Use when designer agents need browser screenshot capture and claude-in-chrome is unavailable.
user-invocable: false
---

# Browser-Use Plugin Integration

## Overview

The `browser-use` plugin provides headless Chromium screenshot capability as a fallback
when the claude-in-chrome extension is unavailable. When installed alongside `designer`,
it lets `designer:ui` screenshot its own artboards and lets the commands capture a page
the user names, without requiring the user's Chrome instance to be open.

This skill is **optional** — all designer plugin functionality works without browser-use
installed. browser-use is the fallback for Tier 2 of the three-tier browser capture chain:
1. claude-in-chrome (preferred — real Chrome, CSS snapshot, JS execution)
2. browser-use (fallback — headless Chromium, screenshot only)
3. Error with install options

`designer:review` takes image files only and never captures; the capture happens before it
is dispatched, in the command or in `designer:ui`.

## When to Use

Use this skill when:
- `designer:ui` has written artboards and needs `screens/*.png` for the judge
- A command was given a page URL as a reference or implementation and must capture it
- claude-in-chrome extension is NOT installed or unavailable
- User needs automated screenshot capture without opening Chrome manually

## Detection Pattern

Probe the MCP tools directly — no subprocess, no plugin listing. A tool that answers is
the only presence check this skill makes:

```
chrome_available = try mcp__claude-in-chrome__tabs_context_mcp()
  → success: use Tier 1 (claude-in-chrome)
  → error: chrome not available

browser_use_available = try mcp__plugin_browser-use_browser-use__browser_list_sessions()
  → success: use Tier 2 (browser-use)
  → error: neither available → Tier 3 (error)
```

The tool names carry the plugin namespace: `mcp__plugin_browser-use_browser-use__<tool>`.
An agent that wants them must list them in its `tools:` line by that full name.

## Screenshot Capture Pattern

When browser-use is available (Tier 2), use this exact sequence. `TARGET_URL` may be a
`file://<absolute path>` for a local HTML artboard.

```
Step 1: Navigate (creates session automatically)
  mcp__plugin_browser-use_browser-use__browser_navigate(url: TARGET_URL)
  → save session_id from response

Step 2: Capture screenshot
  mcp__plugin_browser-use_browser-use__browser_screenshot(session_id: SESSION_ID, full_page: False)
  → returns: {"image": "<base64-PNG>", "format": "png", "width": N, "height": N}
  → save BASE64_DATA from response["image"]

Step 3: Decode base64 to file
  Write the base64 text to "${OUTPUT_DIR}/filename.b64" with the Write tool, then:
  Bash:
  bun -e "const fs=require('fs');fs.writeFileSync(process.argv[2],Buffer.from(fs.readFileSync(process.argv[1],'utf8').trim(),'base64'))" "${OUTPUT_DIR}/filename.b64" "${OUTPUT_DIR}/filename.png" && rm "${OUTPUT_DIR}/filename.b64"

Step 4: Verify file was created
  Bash:
  test -f "${OUTPUT_DIR}/filename.png" && echo "ok" || echo "decode_failed"
  If decode_failed: close session then stop with error.

Step 5: Close session (ALWAYS — even on error)
  mcp__plugin_browser-use_browser-use__browser_close_session(session_id: SESSION_ID)
```

## Limitations vs claude-in-chrome

| Capability | claude-in-chrome | browser-use |
|------------|-----------------|-------------|
| Screenshot capture | Yes | Yes |
| Full-page screenshot | No (viewport only) | Yes (full_page=True) |
| CSS snapshot (computed styles) | Yes (javascript_tool) | No |
| JavaScript execution | Yes (javascript_tool) | Limited (retry_with_browser_use_agent) |
| User's real Chrome session | Yes | No (separate headless instance) |
| Authenticated sessions | Yes (user's cookies) | No (fresh session) |
| Real DOM state | Yes | DOM index map only |
| Animation disable (before capture) | Yes (CSS injection) | No |

## User Notification Template

If NEITHER browser capture method is available, stop with this exact message:

```
ERROR: No browser capture method available.

Options:
1. Install Claude-in-Chrome extension (preferred — full CSS snapshot support)
   → https://github.com/anthropics/claude-in-chrome
2. Enable browser-use plugin (headless screenshot fallback)
   → /plugin install browser-use@magus
3. Provide an image file reference instead
   → Re-run with REFERENCE_SOURCE=/path/to/screenshot.png
```

If browser-use IS available but claude-in-chrome is not, log this info message (do not stop):

```
INFO: Using browser-use for headless screenshot capture (Tier 2 fallback).
```
