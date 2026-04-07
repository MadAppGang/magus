---
name: browser-use-integration
version: 1.0.0
description: |
  Optional integration patterns for the browser-use plugin (browser-use@magus).
  Provides detection pattern and screenshot capture workflow for URL-based references.
  Use when designer agents need browser screenshot capture and claude-in-chrome is unavailable.
  This is a SKILL (use Skill tool), NOT an agent.
user-invocable: false
---

# Browser-Use Plugin Integration

## Overview

The `browser-use` plugin provides headless Chromium screenshot capability as a fallback
when the claude-in-chrome extension is unavailable. When installed alongside `designer`,
it enables the `design-review` agent to capture browser screenshots without requiring
the user's Chrome instance to be open.

This skill is **optional** — all designer plugin functionality works without browser-use
installed. browser-use is the fallback for Tier 2 of the three-tier browser capture chain:
1. claude-in-chrome (preferred — real Chrome, CSS snapshot, JS execution)
2. browser-use (fallback — headless Chromium, screenshot only)
3. Error with install options

## When to Use

Use this skill when:
- The `design-review` agent has REFERENCE_TYPE = "browser" (URL reference)
- The `design-review` agent has IMPL_TYPE = "url" (URL implementation)
- claude-in-chrome extension is NOT installed or unavailable
- User needs automated screenshot capture without opening Chrome manually

## Detection Pattern

In agents (preferred — no subprocess): attempt to call the MCP tool directly:

```
chrome_available = try mcp__claude-in-chrome__tabs_context_mcp()
  → success: use Tier 1 (claude-in-chrome)
  → error: chrome not available

browser_use_available = try mcp__browser-use__browser_list_sessions()
  → success: use Tier 2 (browser-use)
  → error: neither available → Tier 3 (error)
```

In skill scripts (bash fallback for informational checks):

```bash
# Check browser-use plugin availability
browser_use_available=$(claude /plugin list 2>/dev/null | grep -c "browser-use" || echo "0")
if [ "$browser_use_available" -gt "0" ]; then
  echo "browser-use available — headless browser tools accessible"
else
  echo "browser-use not installed — screenshot capture unavailable"
fi
```

## Screenshot Capture Pattern

When browser-use is available (Tier 2), use this exact sequence:

```
Step 1: Navigate (creates session automatically)
  mcp__browser-use__browser_navigate(url: TARGET_URL)
  → save session_id from response

Step 2: Capture screenshot
  mcp__browser-use__browser_screenshot(session_id: SESSION_ID, full_page: False)
  → returns: {"image": "<base64-PNG>", "format": "png", "width": N, "height": N}
  → save BASE64_DATA from response["image"]

Step 3: Decode base64 to file (Python3 is available when browser-use is installed)
  Bash:
  python3 -c "import base64, sys; open('${OUTPUT_DIR}/filename.png','wb').write(base64.b64decode(sys.argv[1]))" "${BASE64_DATA}"

Step 4: Verify file was created
  Bash:
  test -f "${OUTPUT_DIR}/filename.png" && echo "ok" || echo "decode_failed"
  If decode_failed: close session then stop with error.

Step 5: Close session (ALWAYS — even on error)
  mcp__browser-use__browser_close_session(session_id: SESSION_ID)
```

**Note**: CSS snapshot extraction (`mcp__claude-in-chrome__javascript_tool`) is NOT
available in browser-use tier. Skip the reference-css.json step when using browser-use.

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
   → /plugin marketplace add browser-use@magus
3. Provide an image file reference instead
   → Re-run with REFERENCE_SOURCE=/path/to/screenshot.png
```

If browser-use IS available but claude-in-chrome is not, log this info message (do not stop):

```
INFO: Using browser-use for headless screenshot capture (Tier 2 fallback).
Note: CSS snapshot will not be available — reference-css.json will not be written.
```
