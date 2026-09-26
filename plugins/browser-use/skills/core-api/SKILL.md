---
name: core-api
description: Reference for the Browser Use MCP tools — parameters, returns, session lifecycle. Use when navigating, clicking, typing, evaluating JS, or extracting page content.
user-invocable: false
---

# Browser Use Core API

Reference for the MCP tools exposed by the Browser Use plugin: the upstream Browser Use set plus eleven Magus-specific additions. Their full names are `mcp__plugin_browser-use_browser-use__<tool_name>`, as the examples below write them; an agent's `tools:` line uses the same full name. The parameters here were read from the live tool schemas. The authoritative list is whatever the server registers at runtime, so check there rather than counting this table.

---

## 1. Quick Reference Table

The server drives **one current browser**. Every page tool acts on it; none takes a
`session_id`. Session ids exist only for listing, closing and exporting sessions.

| Tool | Purpose | Takes a session_id? |
|------|---------|---------------------|
| `browser_navigate` | Open a URL in the current browser (starts one if none runs) | No |
| `browser_get_state` | Page URL, title, tabs, and the indexed interactive elements | No |
| `browser_click` | Click an element by index, or at viewport coordinates | No |
| `browser_type` | Type into an input by index (clears it first) | No |
| `browser_extract_content` | LLM-powered extraction from the current page | No |
| `browser_get_html` | Raw HTML of the page or of one CSS selector | No |
| `browser_screenshot` | Show the page to the model as an image | No |
| `browser_save_screenshot` | Write the page to a PNG file | No |
| `browser_scroll` | Scroll up or down | No |
| `browser_go_back` | Go back in history | No |
| `browser_list_tabs` / `browser_switch_tab` / `browser_close_tab` | Tabs, by 4-character `tab_id` | No |
| `browser_list_sessions` | List browser sessions with their ids | No |
| `browser_close_session` | Close one session by id | **Yes** |
| `browser_close_all` | Close every session | No |
| `retry_with_browser_use_agent` | Autonomous agent for a task the direct tools failed at | No |
| `browser_export_session` | Save a session's cookies to a JSON file | **Yes** |
| `browser_import_session` | Start a new session from an exported file | No |
| `browser_run_script` | Run a standalone Python script as a subprocess (own browser) | No |
| `browser_evaluate` | **Run JS in the live page** and return its result (CDP) | No |
| `browser_press_key` | Press a key/shortcut (e.g. `Meta+a`, `Enter`, `Escape`) | No |
| `browser_keyboard` | Batch keys + insert literal text via CDP | No |
| `browser_focus` | Focus any element by CSS selector (incl. hidden inputs) | No |
| `browser_doctor` | Preflight: Python / deps / Chromium / API keys | No |

> **Editing a code editor (Monaco/CodeMirror/contenteditable)?** Those expose no
> indexable input, so `browser_type` cannot reach them. Use `browser_evaluate`
> (e.g. `monaco.editor.getModels()[0].setValue('...')`), or `browser_focus` the
> hidden input then `browser_keyboard`. See §3.19 and §3.22.

> **Local HTML files: serve them, do not open them.** `browser_navigate` to a
> `file://` URL reports "Navigated to" but leaves the page on `about:blank`
> (measured: a screenshot of it is blank). Serve the directory and navigate to it:
> `python3 -m http.server <port> --bind 127.0.0.1 --directory <dir>` in the
> background, then `http://127.0.0.1:<port>/<file>.html`; stop the server when done.

---

## 2. Session Lifecycle (Critical Pattern)

The first `browser_navigate` starts a browser session. `browser_navigate` does not
return its id: read it from `browser_list_sessions` straight after, and record it,
because only the sessions you record are yours to close.

```
1. NAVIGATE (starts the browser if needed)
   mcp__plugin_browser-use_browser-use__browser_navigate(url="https://example.com")
   → "Navigated to: https://example.com"

2. RECORD the session id
   mcp__plugin_browser-use_browser-use__browser_list_sessions()
   → [{"session_id": "06ab70ef-…", "active": true, "age_minutes": 0.1, …}]

3. INSPECT (indexed interactive elements)
   mcp__plugin_browser-use_browser-use__browser_get_state()
   → {"url": "…", "title": "…", "tabs": […], "interactive_elements": [{"index": 19, "tag": "a", "text": "Learn more", …}], "viewport": {…}, "scroll": {…}}

4. INTERACT
   mcp__plugin_browser-use_browser-use__browser_click(index=19)          → "Clicked element 19"
   mcp__plugin_browser-use_browser-use__browser_type(index=5, text="search query")

5. EXTRACT or VERIFY
   mcp__plugin_browser-use_browser-use__browser_extract_content(query="product prices")
   mcp__plugin_browser-use_browser-use__browser_screenshot()             (image shown to the model)

6. CLOSE (ALWAYS — do not skip)
   mcp__plugin_browser-use_browser-use__browser_close_session(session_id="06ab70ef-…")
   → "Successfully closed session 06ab70ef-…"
```

**Rule**: Every code path must close the session it opened. If an error occurs
mid-workflow, still call `browser_close_session` before returning. Never close a
session you did not open: another task or the user can be using it.

### Automatic cleanup — the browser does not wait for you

The server cleans up after itself while it runs, so a forgotten session costs
disk and a stray Chrome for minutes, not for the days a Claude Code session can
last:

| Trigger | What happens |
|---|---|
| `browser_close_session` / `browser_close_all` | Chrome is killed; once the last session is gone, this session's Chrome profile directory is deleted |
| **10 minutes with no tool call on a session** | Same thing, automatically — the session is closed, Chrome killed, and the profile deleted if it was the last one |
| Every 2 minutes | Profiles left behind by servers that have died are swept, along with any Chrome still running on them |
| The `claude` process dies | The server notices it has been reparented, kills Chrome, deletes the profile, and exits |

**Consequence you must plan for**: cookies, localStorage and login state live in
that profile directory, so they do **not** survive the 10-minute idle timeout.
Save anything you want to keep with `browser_export_session` as soon as you have
it — right after a login flow completes, not at the end of the workflow. A later
`browser_navigate` starts from a clean profile and needs
`browser_import_session` to get back in.

Nothing here is recoverable by waiting: a closed session's `session_id` is dead,
and `browser_navigate` creates a new one.

---

## 3. Tool Reference (Full Schema)

### 3.1 `browser_navigate`

Open a URL in the current browser. Starts a browser if none is running.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Full URL including scheme. `file://` does not load; see §1 |
| `new_tab` | boolean | No | Open in a new tab (default: false) |

**Returns**: text, `Navigated to: <url>`. It returns no session id; use `browser_list_sessions`.

---

### 3.2 `browser_get_state`

The current page: URL, title, tabs, indexed interactive elements, viewport, page size and scroll offset.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `include_screenshot` | boolean | No | Also return a screenshot (default: false) |

**Returns**: JSON with `url`, `title`, `tabs`, `interactive_elements` (each has `index`, `tag`, `text`, and `href` for links), `viewport`, `page`, `scroll`. Pass an element's `index` to `browser_click` or `browser_type`.

---

### 3.3 `browser_click`

Click an element by index, or at viewport pixel coordinates.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `index` | integer | One of | Element index from `browser_get_state` |
| `coordinate_x`, `coordinate_y` | integer | One of | Viewport coordinates; pass both |
| `new_tab` | boolean | No | Open any resulting navigation in a new tab |

**Returns**: text, `Clicked element <index>`.

---

### 3.4 `browser_type`

Type into an input element. Clears existing text first; `text=""` only clears.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `index` | integer | Yes | Input element index from `browser_get_state` |
| `text` | string | Yes | Text to type |

---

### 3.5 `browser_extract_content`

Extract information from the current page with the agent's LLM.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | What to extract |
| `extract_links` | boolean | No | Include links (default: false) |

---

### 3.6 `browser_get_html`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | string | No | CSS selector; omit for the whole page |

**Returns**: the HTML as text, e.g. `<h1>Example Domain</h1>` for `selector="h1"`.

---

### 3.7 `browser_screenshot`

Show the current page to the model.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `full_page` | boolean | No | Whole scrollable page instead of the viewport (default: false) |

**Returns**: a text block `{"size_bytes": N, "viewport": {"width": W, "height": H}}` and an
image block the model can see. Nothing is written to disk, and no base64 text is
returned to save. To get a file, use `browser_save_screenshot` (§3.24).

---

### 3.8 `browser_scroll`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `direction` | `"up"` or `"down"` | No | Default `"down"`; one viewport per call |

**Returns**: text, `Scrolled <direction>`.

---

### 3.9 `browser_go_back`

No parameters. **Returns**: text, `Navigated back`.

---

### 3.10 `browser_list_tabs`

No parameters. **Returns**: JSON list of `{"tab_id", "url", "title"}`; `tab_id` is 4 characters.

---

### 3.11 `browser_switch_tab`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tab_id` | string | Yes | 4-character id from `browser_list_tabs` |

---

### 3.12 `browser_close_tab`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tab_id` | string | Yes | 4-character id from `browser_list_tabs` |

---

### 3.13 `browser_list_sessions`

No parameters. **Returns**: JSON list of `{"session_id", "created_at", "last_activity", "active", "current_url", "age_minutes"}`.
The list includes sessions other tasks opened.

---

### 3.14 `browser_close_session` and `browser_close_all`

`browser_close_session(session_id=…)` closes one session and returns
`Successfully closed session <id>`. `browser_close_all()` closes every session,
including ones other tasks or the user opened: use it only when you know you own
them all.

---

### 3.15 `retry_with_browser_use_agent`

Hand a task to Browser Use's own LLM agent. A last resort, after direct tools failed on a page more than once.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | The goal, step-by-step detail, relevant data, and what earlier attempts tried |
| `max_steps` | integer | No | Step limit (default: 100) |
| `use_vision` | boolean | No | Use screenshots (default: true) |
| `allowed_domains` | array | No | Domains the agent may visit; omit (or pass `[]`) for the server's configured defaults |
| `model` | string | No | Agent LLM; defaults to the configured one (see `browser_set_agent_model`) |

**When NOT to use**: simple linear workflows (navigate → extract). Direct tools are faster and more reliable.

---

### 3.16 `browser_export_session`

Save a session's **cookies** to a JSON file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | Yes | From `browser_list_sessions` |
| `output_path` | string | Yes | Full path of the `.json` file to write |

**Returns**: `{"success": true, "path": "…", "cookies_count": N, "url": "…"}`

**When to use**: the moment a login flow completes, not at the end of the
workflow. Cookies live in the session's Chrome profile directory, which is deleted
when the browser is closed, including by the 10-minute idle timeout (see
[Automatic cleanup](#automatic-cleanup--the-browser-does-not-wait-for-you)).
Only cookies are exported; a site that keeps its login in `localStorage` needs
logging in again.

---

### 3.17 `browser_import_session`

Start a new browser session with the cookies from an exported file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `import_path` | string | Yes | Path to the exported `.json` file |
| `navigate_to` | string | No | URL to open after importing |

**Returns**: `{"session_id": "…", "cookies_imported": N, "original_url": "…", "navigated_to": "…"}`

---

### 3.18 `browser_run_script`

Run a **standalone** Python automation script as a subprocess.

> ⚠️ **This does NOT run JavaScript, and does NOT share the live browser
> session.** The subprocess gets a fresh Python interpreter that must
> independently have `browser-use`/`playwright` installed, and it would drive its
> **own, separate** browser — it cannot touch the page the other tools control.
> To run JS in the live page, use **`browser_evaluate`** (§3.19). The tool now
> **fails fast** if `script_path` is not a readable `.py` file (passing inline JS
> used to hang for the full timeout) and adds a `hint` when the subprocess hits
> `ModuleNotFoundError`. Run **`browser_doctor`** (§3.23) to see what's installed.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `script_path` | string | Yes | Path to a readable `.py` script file on disk |
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

### 3.19 `browser_evaluate`

**Run JavaScript in the live page** the other tools are driving, and return its
result. This is the in-page eval escape hatch (CDP `Runtime.evaluate`): read or
mutate the DOM, call framework hooks, read `localStorage`, and **drive code
editors that expose no normal input** (Monaco, CodeMirror). Operates on the
current session — no `session_id` needed.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `script` | string | Yes | JS to evaluate. Expression (`document.title`) **or** statements ending in `return ...` (auto-wrapped in a function). A returned Promise is awaited. Result must be JSON-serializable. |

**Returns**: `{"result": <value>}`, or `{"error": "JavaScript exception", "detail": "..."}` if the JS throws.

**Example — set a Monaco editor's text (the canonical use case)**:
```
mcp__plugin_browser-use_browser-use__browser_evaluate(
  script="return monaco.editor.getModels()[0].setValue('graph TD; A-->B')"
)
```

---

### 3.20 `browser_press_key`

Press a single key or keyboard shortcut in the live page (CDP
`Input.dispatchKeyEvent`, sending a keyDown+keyUp pair).

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | Key/shortcut. Modifiers via `+`: `Meta+a` (Cmd+A), `Control+a`, `Shift+ArrowDown`. Named keys: `Enter`, `Escape`, `Tab`, `Backspace`, `Delete`, `Arrow{Up,Down,Left,Right}`, `Home`, `End`, `PageUp`, `PageDown`. |
| `count` | integer | No | Times to press (default 1). |

**Returns**: `{"pressed": "Enter", "count": 1}`

> **Edit shortcuts work in the real editor.** `Meta+`/`Control+` plus
> `a`/`c`/`v`/`x`/`z`/`y` map to the browser's `selectAll`/`copy`/`paste`/`cut`/
> `undo`/`redo` commands (a synthetic modifier press alone does NOT trigger these
> — the CDP edit-command is attached for you). So `Meta+a` then `Delete` clears a
> field, and `Meta+a` then `browser_keyboard(text=...)` replaces its contents.

---

### 3.21 `browser_keyboard`

Send a batch of shortcuts and/or insert literal text, in order. Keys are pressed
first, then `text` is inserted via CDP `Input.insertText` (the reliable way to
type into a focused field or editor without needing an index).

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `keys` | array | No | Shortcuts pressed in order, e.g. `["Meta+a","Delete"]`. |
| `text` | string | No | Literal text inserted after the keys. |

Provide at least one of `keys` / `text`.

**Returns**: `{"keys": ["Meta+a","Delete"], "text_inserted": true}`

**Example — clear a field and type new text**:
```
mcp__plugin_browser-use_browser-use__browser_focus(selector="textarea.inputarea")
mcp__plugin_browser-use_browser-use__browser_keyboard(keys=["Meta+a"], text="new content")
```

---

### 3.22 `browser_focus`

Focus any DOM element by CSS selector — including the hidden/synthetic inputs
that code editors use (e.g. Monaco's `textarea.inputarea`), which never appear in
`get_state`'s index list. Pair with `browser_keyboard`/`browser_press_key`.

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | string | Yes | CSS selector of the element to focus. |

**Returns**: `{"focused": true, "selector": "..."}`, or `{"focused": false, "error": "No element matched ..."}`.

---

### 3.23 `browser_doctor`

Preflight diagnosis of the plugin's environment — turns silent failures (a 300s
`run_script` hang, `ModuleNotFoundError`, missing Chromium) into a one-call
report. Pure inspection; never spawns a browser. Takes no arguments.

`chromium_path` is produced by the same resolver the launcher uses, so the doctor
and the browser can never disagree. `chromium_source` says where it came from:

| `chromium_source` | Meaning |
|---|---|
| `playwright` | Newest build in Playwright's cache — the normal case |
| `env` | `CHROME_EXECUTABLE_PATH` named it explicitly |
| `error` | Nothing resolvable; `chromium_error` carries the message, `chromium_path` is `null` |

**Returns**:
```json
{
  "python_version": "3.11.x",
  "python_executable": "/usr/bin/python3",
  "browser_use": {"installed": true, "version": "0.12.5"},
  "mcp": {"installed": true, "version": "..."},
  "playwright": {"installed": false, "version": null},
  "chromium_present": true,
  "chromium_path": "~/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chromium_source": "playwright",
  "chromium_error": null,
  "api_keys": {"ANTHROPIC_API_KEY": true, "OPENAI_API_KEY": false, "BROWSER_USE_API_KEY": false}
}
```

A `chromium_path` under `/Applications/Google Chrome.app` is never reported
unless `CHROME_EXECUTABLE_PATH` asked for it: launching the user's real Chrome
steals the macOS `com.google.Chrome` single-instance slot, so an unresolvable
Chromium is reported as an error instead of quietly falling back to it. The fix
is `python3 -m playwright install chromium`.

---

### 3.24 `browser_save_screenshot`

Write the live page to a PNG file: the tool for pixel diffs, design references and
attachments, since `browser_screenshot` writes nothing to disk. Captures through CDP
`Page.captureScreenshot` on the page the other tools are driving.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `output_path` | string | Yes | Absolute path ending in `.png`; parent directories are created |
| `full_page` | boolean | No | Whole scrollable page instead of the viewport (default: false) |

**Returns**: `{"path": "…", "size_bytes": N, "width": W, "height": H}`. Width and
height are in device pixels. A relative path, a non-`.png` path, or no running
browser returns an `Error:` line and writes nothing.

```
mcp__plugin_browser-use_browser-use__browser_navigate(url="http://127.0.0.1:8765/card.html")
mcp__plugin_browser-use_browser-use__browser_save_screenshot(output_path="/abs/out/card--default.png")
```

---

## 4. Tool Selection Guide

| Problem | Use This Tool |
|---------|--------------|
| Open a webpage | `browser_navigate` |
| Find what's clickable on a page | `browser_get_state` |
| Click a link or button | `browser_click` (by index from `get_state`) |
| Type into a form field | `browser_type` (by index from `get_state`) |
| Type into a code editor (Monaco/CodeMirror) | `browser_evaluate` (`setValue`) or `browser_focus` + `browser_keyboard` |
| Run JavaScript in the live page | `browser_evaluate` |
| Press Enter / Escape / Tab / arrows | `browser_press_key` |
| Select-all + clear a field | `browser_focus` + `browser_keyboard(keys=["Meta+a","Delete"])` |
| Focus a hidden/synthetic input | `browser_focus` (by CSS selector) |
| Diagnose missing deps / why a tool fails | `browser_doctor` |
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
| `"session_not_found"` after a long pause | The session idled out after 10 minutes and was closed automatically | Start a new one with `browser_navigate`. Its login state went with the profile — `browser_import_session` if you exported it |
| A click or type reports the index is not found | Element index is stale | Call `browser_get_state` again — DOM may have changed |
| The page shows a block, captcha or 403 page | Site blocking headless browser | Try `retry_with_browser_use_agent` with `use_vision=True`, or use Browser Use Cloud |
| `interactive_elements` is empty | Page still loading | Call `browser_get_state` again; SPAs need time to render |
| Agent hits `max_steps` | Task too complex or poorly described | Increase `max_steps` or rewrite the task description with more specific goals |
| Page is `about:blank` after navigating to `file://` | browser-use does not load `file://` URLs | Serve the directory over `http://127.0.0.1` (see §1) |
| Screenshot returns empty/blank | Page not finished rendering | Call `browser_scroll(direction="down")` to trigger rendering, then screenshot |
| `browser_type` has no effect | Input not focused | Call `browser_click` on the input first, then `browser_type` |
| Can't type into Monaco/CodeMirror | Editor has no indexable input | Use `browser_evaluate` (`setValue`) or `browser_focus` + `browser_keyboard` — not `browser_type` |
| `browser_run_script` errors at once on `script_path` | Passed inline JS / a stream, not a `.py` file | Pass a real `.py` file; to run JS in the page use `browser_evaluate` |
| `ModuleNotFoundError` in `run_script` | Subprocess interpreter lacks the deps | `run_script` doesn't share this env or browser; install deps in that interpreter — run `browser_doctor` to check |
| Cached element `index` clicks the wrong thing | Indices are snapshot-scoped | Re-`get_state` immediately before use, or target by selector (`browser_focus`/`browser_evaluate`) |
