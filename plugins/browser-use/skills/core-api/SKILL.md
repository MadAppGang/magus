---
name: core-api
description: Complete reference for all 18 Browser Use MCP tools (15 native + 3 custom). Parameters, return formats, when to use each tool, session lifecycle. Trigger keywords - browser-use tools, MCP tools, navigate, click, type, extract, screenshot, session, browser_navigate, browser_click, browser_get_state.
version: 1.0.0
tags: [browser, mcp, tools, api, reference, navigate, click, type, extract, screenshot, session]
keywords: [browser_navigate, browser_click, browser_type, browser_get_state, browser_extract_content, browser_get_html, browser_screenshot, browser_scroll, browser_go_back, browser_list_tabs, browser_switch_tab, browser_close_tab, browser_list_sessions, browser_close_session, retry_with_browser_use_agent, browser_export_session, browser_import_session, browser_run_script]
plugin: browser-use
updated: 2026-03-03
user-invocable: false
---

# Browser Use Core API

Complete reference for all 18 MCP tools exposed by the Browser Use plugin. All tools are accessed via `mcp__browser-use__<tool_name>`.

---

## 1. Quick Reference Table

| Tool | Purpose | Requires session_id? |
|------|---------|---------------------|
| `browser_navigate` | Navigate to URL (creates session) | No (creates it) |
| `browser_click` | Click element by DOM index | Yes |
| `browser_type` | Type text into an input element | Yes |
| `browser_get_state` | Get full DOM element map with indices | Yes |
| `browser_extract_content` | LLM-powered semantic content extraction | Yes |
| `browser_get_html` | Raw HTML (full page or CSS selector) | Yes |
| `browser_screenshot` | Capture viewport or full-page screenshot | Yes |
| `browser_scroll` | Scroll the page up, down, left, right | Yes |
| `browser_go_back` | Navigate back in browser history | Yes |
| `browser_list_tabs` | List all open tabs in a session | Yes |
| `browser_switch_tab` | Switch to a tab by tab_id | Yes |
| `browser_close_tab` | Close a specific tab | Yes |
| `browser_list_sessions` | List all active browser sessions | No |
| `browser_close_session` | Close session and release browser resources | Yes |
| `retry_with_browser_use_agent` | Autonomous LLM agent for complex tasks | No (creates session) |
| `browser_export_session` | Export cookies + localStorage to JSON file | Yes |
| `browser_import_session` | Restore session from exported JSON file | No (creates session) |
| `browser_run_script` | Execute a saved Python automation script | No |

---

## 2. Session Lifecycle (Critical Pattern)

Sessions are created implicitly on the first `browser_navigate` call. The returned `session_id` must be passed to every subsequent tool call. Always close sessions when done.

```
1. NAVIGATE (creates session) → save session_id
   mcp__browser-use__browser_navigate(url="https://example.com")
   → returns: {"session_id": "abc123", "url": "...", "title": "..."}

2. INSPECT (get DOM element map)
   mcp__browser-use__browser_get_state(session_id="abc123")
   → returns: {"selector_map": {"1": {...}, "2": {...}}, "url": "...", "title": "..."}

3. INTERACT (click, type, scroll)
   mcp__browser-use__browser_click(index=3, session_id="abc123")
   mcp__browser-use__browser_type(index=5, text="search query", session_id="abc123")

4. EXTRACT or VERIFY
   mcp__browser-use__browser_extract_content(query="product prices", session_id="abc123")
   mcp__browser-use__browser_screenshot(session_id="abc123")

5. CLOSE (ALWAYS — do not skip)
   mcp__browser-use__browser_close_session(session_id="abc123")
```

**Rule**: Every code path must close the session. If an error occurs mid-workflow, still call `browser_close_session` before returning.

---

## 3. Tool Reference (Full Schema)

### 3.1 `browser_navigate`

Navigate to a URL. Creates a new browser session if `session_id` is omitted.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Full URL including scheme (https://) |
| `session_id` | string | No | Existing session ID; omit to create new session |
| `new_tab` | boolean | No | Open in new tab within existing session (default: false) |

**Returns**:
```json
{
  "session_id": "abc123",
  "url": "https://example.com",
  "title": "Example Domain",
  "status": 200
}
```

**When to use**: First step of any browser workflow. Also used for navigating to subsequent pages within the same session.

**Example**:
```
mcp__browser-use__browser_navigate(url="https://news.ycombinator.com")
→ session_id: "hk72x1"
```

---

### 3.2 `browser_get_state`

Get the current DOM state with a numbered element map. This is the primary way to discover clickable elements, inputs, and interactive components on a page.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |
| `include_screenshot` | boolean | No | Include base64 screenshot in response (default: false) |

**Returns**:
```json
{
  "url": "https://example.com",
  "title": "Example Domain",
  "selector_map": {
    "1": {
      "tag": "a",
      "text": "More information...",
      "href": "https://www.iana.org/domains/example",
      "attributes": {"class": "link"}
    },
    "2": {
      "tag": "input",
      "type": "text",
      "placeholder": "Search...",
      "attributes": {"id": "search", "name": "q"}
    },
    "3": {
      "tag": "button",
      "text": "Submit",
      "attributes": {"type": "submit"}
    }
  }
}
```

**When to use**: After every navigation or interaction to see the updated DOM state. Always call `get_state` before `click` or `type` to verify the correct element index.

---

### 3.3 `browser_click`

Click an element identified by its index from the `selector_map`.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |
| `index` | integer | No* | Element index from `selector_map` |
| `coordinate_x` | float | No* | X coordinate (fallback when no index available) |
| `coordinate_y` | float | No* | Y coordinate (fallback when no index available) |

*Either `index` OR `coordinate_x`/`coordinate_y` required.

**Returns**:
```json
{"success": true, "element": "button[type=submit]", "url": "https://example.com/results"}
```

**When to use**: Clicking links, buttons, checkboxes, menu items. Prefer `index` over coordinates — indices are more reliable than pixel positions.

**Example**:
```
# From get_state: element 3 is the submit button
mcp__browser-use__browser_click(index=3, session_id="abc123")
```

---

### 3.4 `browser_type`

Type text into an input element identified by its index.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |
| `index` | integer | Yes | Input element index from `selector_map` |
| `text` | string | Yes | Text to type |

**Returns**:
```json
{"success": true, "element": "input[name=q]", "typed": "search query"}
```

**When to use**: Filling text inputs, search boxes, password fields, textareas. Does not clear existing content — call `browser_click` on the element first, then Ctrl+A to select all if clearing is needed.

**Example**:
```
# From get_state: element 2 is the search input
mcp__browser-use__browser_type(index=2, text="browser automation", session_id="abc123")
```

---

### 3.5 `browser_extract_content`

Use LLM-powered semantic extraction to find and return specific content from the page. The agent reads the page and extracts the requested information as structured text.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |
| `query` | string | Yes | Natural language description of what to extract |

**Returns**:
```json
{
  "content": "Product: Widget Pro\nPrice: $49.99\nRating: 4.5/5\nAvailability: In Stock",
  "url": "https://shop.example.com/widget-pro"
}
```

**When to use**: When you need structured data from a page but do not know the exact CSS selector. Better than `get_html` when the page structure is complex or varies. Costs one extra LLM inference call internally.

**Avoid**: On very simple pages where `get_html` with a known selector is faster and cheaper.

**Example**:
```
mcp__browser-use__browser_extract_content(
  query="product name, price, rating, and availability",
  session_id="abc123"
)
```

---

### 3.6 `browser_get_html`

Get raw HTML content — either the full page or scoped to a CSS selector.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |
| `selector` | string | No | CSS selector to scope extraction (default: full page) |

**Returns**:
```json
{
  "html": "<table class=\"data-table\"><tr><th>Name</th>...</table>",
  "selector": ".data-table",
  "url": "https://example.com/data"
}
```

**When to use**: When you need raw HTML for parsing (table data, specific DOM structure), when you know the exact CSS selector, or when LLM-based extraction is overkill. Cheaper than `extract_content`.

**Example**:
```
# Get just the pricing table
mcp__browser-use__browser_get_html(selector=".pricing-table", session_id="abc123")
```

---

### 3.7 `browser_screenshot`

Capture a screenshot of the current page. Returns base64-encoded PNG data.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |
| `full_page` | boolean | No | Capture entire page height (default: false = viewport only) |

**Returns**:
```json
{
  "image": "<base64-encoded PNG>",
  "format": "png",
  "width": 1280,
  "height": 720,
  "url": "https://example.com"
}
```

**When to use**: Visual verification after interactions, UI debugging, before/after state comparison, documenting the browser state for users. Claude can analyze the base64 image directly.

**Save to file**:
```bash
# Decode base64 image to PNG file via Bash
python3 -c "import base64; open('screenshot.png','wb').write(base64.b64decode('<base64-data>'))"
```

---

### 3.8 `browser_scroll`

Scroll the page in a direction by a given amount.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |
| `direction` | string | Yes | `"up"`, `"down"`, `"left"`, `"right"` |
| `amount` | integer | No | Pixels to scroll (default: 500) |

**Returns**:
```json
{"success": true, "direction": "down", "amount": 500}
```

**When to use**: Revealing lazy-loaded content, scrolling to see more elements, implementing infinite scroll pagination.

---

### 3.9 `browser_go_back`

Navigate back in the browser's history stack.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |

**Returns**:
```json
{"success": true, "url": "https://example.com/previous-page", "title": "Previous Page"}
```

**When to use**: Returning to a list page after visiting a detail page, undoing navigation mistakes, implementing crawl-and-return patterns.

---

### 3.10 `browser_list_tabs`

List all open tabs in the current session.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |

**Returns**:
```json
{
  "tabs": [
    {"tab_id": "tab_0", "url": "https://example.com", "title": "Example", "active": true},
    {"tab_id": "tab_1", "url": "https://github.com", "title": "GitHub", "active": false}
  ]
}
```

---

### 3.11 `browser_switch_tab`

Switch the active tab within a session.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |
| `tab_id` | string | Yes | Tab ID from `browser_list_tabs` |

**Returns**:
```json
{"success": true, "tab_id": "tab_1", "url": "https://github.com", "title": "GitHub"}
```

---

### 3.12 `browser_close_tab`

Close a specific tab without closing the entire session.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Active session ID |
| `tab_id` | string | Yes | Tab ID from `browser_list_tabs` |

**Returns**:
```json
{"success": true, "closed_tab_id": "tab_1", "remaining_tabs": 1}
```

---

### 3.13 `browser_list_sessions`

List all currently active browser sessions. No parameters.

**Returns**:
```json
{
  "sessions": [
    {"session_id": "abc123", "url": "https://example.com", "created_at": "2026-03-03T10:00:00Z"},
    {"session_id": "xyz789", "url": "https://github.com", "created_at": "2026-03-03T10:05:00Z"}
  ]
}
```

**When to use**: Before starting a workflow to detect leaked sessions from previous runs. Also for cleanup after errors.

---

### 3.14 `browser_close_session`

Close a browser session and release all associated resources (browser process, CDP connection, memory).

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Session ID to close |

**Returns**:
```json
{"success": true, "session_id": "abc123", "closed_at": "2026-03-03T10:10:00Z"}
```

**Critical rule**: Always close sessions. Leaked sessions consume memory and browser processes. Call in a `finally`-equivalent pattern: even if the workflow fails, close the session.

---

### 3.15 `retry_with_browser_use_agent`

Delegate a complex browser task to Browser Use's internal LLM agent. The agent autonomously navigates, clicks, types, and extracts data to complete a natural language goal.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | Natural language goal description |
| `session_id` | string | No | Existing session to reuse; omit to create new |
| `max_steps` | integer | No | Maximum agent steps before stopping (default: 25) |
| `use_vision` | boolean | No | Enable screenshot-based decision making (default: false) |
| `allowed_domains` | array | No | Whitelist of domains the agent can visit |

**Returns**:
```json
{
  "result": "Found 3 pricing plans: Starter ($9/mo), Pro ($29/mo), Enterprise (custom)",
  "steps_taken": 8,
  "final_url": "https://example.com/pricing",
  "session_id": "new_session_id"
}
```

**When to use**: Tasks where you cannot predict the exact click sequence (login flows with 2FA prompts, dynamic SPAs, complex multi-step forms). Use as escalation after direct tools fail.

**When NOT to use**: Simple linear workflows (navigate → extract) — direct tools are faster and more reliable.

---

### 3.16 `browser_export_session`

Export a live browser session's cookies and localStorage to a JSON file for later restoration.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | Session ID to export |
| `output_path` | string | Yes | File path for exported JSON (e.g., `~/.browser-use/sessions/github.json`) |
| `include_local_storage` | boolean | No | Export localStorage too (default: true) |

**Returns**:
```json
{"success": true, "path": "~/.browser-use/sessions/github.json", "cookies_count": 12}
```

**When to use**: After completing a login flow, to save the authenticated state. Import in the next session to skip login.

---

### 3.17 `browser_import_session`

Restore a previously exported session (cookies, localStorage) into a new browser session.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `import_path` | string | Yes | Path to exported JSON file |
| `navigate_to` | string | No | URL to navigate to after importing cookies |

**Returns**:
```json
{"session_id": "new_id_456", "cookies_imported": 12, "url": "https://github.com/dashboard"}
```

---

### 3.18 `browser_run_script`

Execute a Python automation script from the project's `browser-scripts/` directory.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `script_path` | string | Yes | Path to `.py` script file |
| `args` | array | No | CLI arguments to pass to the script |
| `timeout_seconds` | integer | No | Max execution time (default: 300) |

**Returns**:
```json
{
  "exit_code": 0,
  "stdout": "Scraped 47 products. Saved to products.json\n",
  "stderr": ""
}
```

---

## 4. Tool Selection Guide

| Problem | Use This Tool |
|---------|--------------|
| Open a webpage | `browser_navigate` |
| Find what's clickable on a page | `browser_get_state` |
| Click a link or button | `browser_click` (by index from `get_state`) |
| Type into a form field | `browser_type` (by index from `get_state`) |
| Extract specific data semantically | `browser_extract_content` |
| Get raw HTML for parsing | `browser_get_html` |
| Take a screenshot | `browser_screenshot` |
| Scroll down to load more content | `browser_scroll` |
| Go back to the previous page | `browser_go_back` |
| Open a link in a new tab | `browser_navigate` with `new_tab=True` |
| See all open tabs | `browser_list_tabs` |
| Switch to a different tab | `browser_switch_tab` |
| Task is too complex for direct tools | `retry_with_browser_use_agent` |
| Save login session for reuse | `browser_export_session` |
| Restore a saved login session | `browser_import_session` |
| Run a saved automation script | `browser_run_script` |
| Clean up after a workflow | `browser_close_session` |

---

## 5. Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `"session_not_found"` | Stale `session_id` or typo | Call `browser_list_sessions` to see active sessions |
| `"element index N not in selector_map"` | Element index is stale | Call `browser_get_state` again — DOM may have changed |
| `"browser_navigate" returns status 403` | Site blocking headless browser | Try `retry_with_browser_use_agent` with `use_vision=True`, or use Browser Use Cloud |
| No elements in `selector_map` | Page still loading | Call `browser_get_state` again; SPAs need time to render |
| Agent hits `max_steps` | Task too complex or poorly described | Increase `max_steps` or rewrite the task description with more specific goals |
| Screenshot returns empty/blank | Page not finished rendering | Add a `browser_scroll(direction="down", amount=1)` to trigger rendering, then screenshot |
| `browser_type` has no effect | Input not focused | Call `browser_click` on the input first, then `browser_type` |
