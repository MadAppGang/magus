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

When browser-use is available (Tier 2), use this sequence. It needs
`browser_save_screenshot`, the browser-use tool that writes a PNG file; if the tool is
missing, the installed browser-use predates it: say so, and name
`claude plugin update browser-use@magus`.

**A local HTML artboard must be served, not opened.** browser-use reports
"Navigated to" for a `file://` URL but stays on `about:blank`, so the screenshot is
blank. Serve the artboard directory on loopback for the capture:

```
Step 1: Serve local files (skip for an http(s) TARGET_URL)
  Bash (background): python3 -m http.server <port> --bind 127.0.0.1 --directory "<artboard dir>"
  TARGET_URL = http://127.0.0.1:<port>/<artboard>.html

Step 2: Navigate, then record the session id
  mcp__plugin_browser-use_browser-use__browser_navigate(url=TARGET_URL)
  mcp__plugin_browser-use_browser-use__browser_list_sessions()   → the new entry is SESSION_ID

Step 3: Write the PNG
  mcp__plugin_browser-use_browser-use__browser_save_screenshot(output_path="${OUTPUT_DIR}/<name>.png", full_page=false)
  → {"path": "…", "size_bytes": N, "width": W, "height": H}
  `output_path` must be absolute; the tool refuses a relative one.
  An "Error:" line means no file was written: close the session, then stop with that error.

Step 4: Close (ALWAYS — even on error)
  mcp__plugin_browser-use_browser-use__browser_close_session(session_id=SESSION_ID)
  Stop the Step 1 server.
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
