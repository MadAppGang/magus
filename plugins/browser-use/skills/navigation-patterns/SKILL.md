---
name: navigation-patterns
description: URL navigation, multi-tab orchestration, session creation and management, back/forward navigation, browser profile persistence, session export/import for authentication reuse.
user-invocable: false
---

# Navigation Patterns

Patterns for URL navigation, multi-tab workflows, session lifecycle management, and browser profile persistence.

---

## 1. Basic Navigation

The fundamental browser pattern: navigate, inspect, interact, close.

```
Step 1: Navigate to URL (session created automatically)
  mcp__plugin_browser-use_browser-use__browser_navigate(url="https://example.com")
  mcp__plugin_browser-use_browser-use__browser_list_sessions()
  → record the new session's id (navigate itself returns only "Navigated to: …")

Step 2: Inspect the page
  mcp__plugin_browser-use_browser-use__browser_get_state()
  → Returns interactive_elements with numbered elements

Step 3: Interact (optional)
  mcp__plugin_browser-use_browser-use__browser_click(index=3)

Step 4: Always close
  mcp__plugin_browser-use_browser-use__browser_close_session(session_id="abc123")
```

**Verify page loaded**: After `browser_navigate`, check the response `title` and `url`. If `title` is blank or URL redirected unexpectedly, call `browser_get_state` to inspect the actual page content before proceeding.

**Wait for dynamic content**: For SPAs (React, Vue, Angular), the DOM may not be ready immediately after navigate. If `interactive_elements` in `browser_get_state` is sparse or empty, call `browser_get_state` again after a short delay:

```
1. browser_navigate(url="https://spa-app.example.com")
2. browser_get_state() → sparse interactive_elements?
3. browser_get_state() → call again; SPA renders after first paint
```

---

## 2. Back Navigation

Use `browser_go_back` to return to the previous page without creating a new navigation entry.

```
Pattern: Visit detail page, then return to list

1. browser_navigate(url="https://shop.example.com/products")    → then browser_list_sessions() for the id
2. browser_get_state() → find product links in interactive_elements
3. browser_click(index=5)                          → navigate to product detail
4. browser_extract_content(query="price and specs")
5. browser_go_back()                                  → back to product list
6. browser_get_state()                               → DOM refreshed
7. browser_click(index=6)                          → next product
... repeat ...
N. browser_close_session(session_id)
```

**Note**: `browser_go_back` uses the browser's history stack. It will fail if there is no previous page (e.g., you navigated directly to a deep URL). In that case, use `browser_navigate` with the list URL instead.

---

## 3. Multi-Tab Workflows

Open multiple tabs within a single session to compare pages or extract data in parallel.

### 3.1 Open Link in New Tab

```
1. browser_navigate(url="https://example.com")
2. browser_navigate(url="https://example.com/page-2", new_tab=True)
3. browser_list_tabs()
   → [{"tab_id": "8B3E", "url": "https://example.com/", "title": "…"},
      {"tab_id": "C41A", "url": "https://example.com/page-2", "title": "…"}]
```

### 3.2 Switch Between Tabs

```
4. browser_switch_tab(tab_id="8B3E")   → activate the first tab
5. browser_get_state()                    → DOM of that tab
6. browser_extract_content(query="pricing")

7. browser_switch_tab(tab_id="C41A")   → activate the second tab
8. browser_extract_content(query="pricing")
```

### 3.3 Close Individual Tabs

```
9. browser_close_tab(tab_id="C41A")   → close second tab
10. browser_close_session(session_id="<id recorded after step 1>")   → close session (closes remaining tabs)
```

### Multi-Tab Use Cases

| Use Case | Pattern |
|----------|---------|
| Compare prices on two sites | Open site A → new_tab for site B → extract from each |
| Scrape paginated list into detail pages | Open list → each item in new tab → extract → close tab → next item |
| Compare before/after a UI change | Navigate to staging → new tab to production → screenshot both |
| Log in on one tab, use auth on another | Log in on the first tab, open the protected resource in a new tab (tabs in one session share cookies) |

---

## 4. Session Lifecycle Management

### 4.1 Session Creation

The first `browser_navigate` starts a session. It returns only `Navigated to: <url>`,
so read the id from `browser_list_sessions` straight after and record it:

```
mcp__plugin_browser-use_browser-use__browser_navigate(url="https://example.com")
mcp__plugin_browser-use_browser-use__browser_list_sessions()
→ [{"session_id": "06ab70ef-…", "active": true, "age_minutes": 0.1, …}]
```

### 4.2 Session Inspection

List active sessions to detect leaks from previous runs or to resume a workflow:

```
mcp__plugin_browser-use_browser-use__browser_list_sessions()
→ [{"session_id": "abc123", "created_at": "...", "last_activity": "...", "active": true, "current_url": null, "age_minutes": 0.2}]
```

Record the `session_id` of every session this task opens. The list also shows sessions that other tasks, subagents or the user opened; they are not yours to close.

### 4.3 Session Cleanup

```
# Clean up a specific session
mcp__plugin_browser-use_browser-use__browser_close_session(session_id="abc123")

# Clean up every session THIS task opened (ids recorded when each was created)
for session_id in my_session_ids:
    mcp__plugin_browser-use_browser-use__browser_close_session(session_id=session_id)
```

Never close a session you did not open. Another task or the user can hold one in the same
server, and closing it destroys their page state. A session left idle closes itself after
10 minutes (core-api, "Automatic cleanup").

### 4.4 Session Cleanup Decision Table

| Situation | Action |
|-----------|--------|
| Workflow completed successfully | `browser_close_session` |
| Workflow failed with an error | `browser_close_session` (still required) |
| Need to use the same session in the next step | Keep it open; the page tools act on it without an id |
| Starting a new unrelated task | close the sessions this task opened; open a new one |
| Debugging a stuck page | `browser_screenshot` first, then close |

---

## 5. Login Persistence

A session's Chrome profile is temporary: it is deleted when the session closes, including
by the 10-minute idle timeout (see core-api, "Automatic cleanup"). Login state survives
only as an exported JSON file, so export it the moment a login completes and import it to
skip the next login.

### 5.1 Where Exports Live

Pick any path for the export; `~/.browser-use/sessions/<site>.json` keeps them together.

### 5.2 Export Session for Reuse (After Login)

After completing a login workflow, export the session state to a JSON file:

```
# 1. Navigate and log in normally
mcp__plugin_browser-use_browser-use__browser_navigate(url="https://github.com/login")
# ... complete login workflow (fill username, password, click submit) ...

# 2. Export the authenticated session
mcp__plugin_browser-use_browser-use__browser_export_session(
  session_id="abc123",
  output_path="~/.browser-use/sessions/github-session.json"
)

# 3. Close the session
mcp__plugin_browser-use_browser-use__browser_close_session(session_id="abc123")
```

### 5.3 Import Session (Skip Login)

In the next Claude Code session, restore the saved login state:

```
# Import saved cookies into a new session
mcp__plugin_browser-use_browser-use__browser_import_session(
  import_path="~/.browser-use/sessions/github-session.json",
  navigate_to="https://github.com/dashboard"
)
→ {"session_id": "new_xyz", "cookies_imported": 12, "original_url": "https://github.com/", "navigated_to": "https://github.com/dashboard"}

# Verify login worked
mcp__plugin_browser-use_browser-use__browser_get_state()
# Check: interactive_elements should show dashboard elements, not login form
```

### 5.4 Session Expiry Check

Saved sessions expire when site cookies expire. After importing, verify login succeeded:

```
1. browser_import_session(import_path="...", navigate_to="https://site.com/dashboard")
2. browser_get_state()
3. Check: if interactive_elements contains login form elements → session expired, login again
         if interactive_elements contains dashboard elements → session active, proceed
```

---

## 6. Anti-Patterns

### Session Leaks

```
# WRONG: Forgot to close session
mcp__plugin_browser-use_browser-use__browser_navigate(url="https://example.com")
mcp__plugin_browser-use_browser-use__browser_extract_content(query="pricing")
# Task complete — session never closed. Browser process running, memory leaked.

# CORRECT: Always close
mcp__plugin_browser-use_browser-use__browser_navigate(url="https://example.com")
mcp__plugin_browser-use_browser-use__browser_extract_content(query="pricing")
mcp__plugin_browser-use_browser-use__browser_close_session(session_id="abc123")
```

### Stale Session IDs

```
# WRONG: closing or exporting with an id from a previous Claude Code session
mcp__plugin_browser-use_browser-use__browser_export_session(session_id="abc123", output_path="…")
# → "Session 'abc123' not found. Use browser_list_sessions to see active sessions."

# CORRECT: navigate first, then read the fresh id
mcp__plugin_browser-use_browser-use__browser_navigate(url="https://example.com")
mcp__plugin_browser-use_browser-use__browser_list_sessions()
```

### Tab Accumulation

```
# WRONG: Opening new tab in a loop without closing old ones
for each product_url:
    browser_navigate(url=product_url, new_tab=True)
    # 50 tabs open at once → browser crashes

# CORRECT: Close tab before opening next
for each product_url:
    browser_navigate(url=product_url, new_tab=True)
    tab_id = browser_list_tabs()[-1]["tab_id"]
    # ... extract data ...
    browser_close_tab(tab_id=tab_id)
```

### Missing URL Scheme

```
# WRONG: URL without scheme
mcp__plugin_browser-use_browser-use__browser_navigate(url="example.com")
# → navigation error

# CORRECT: Always include https://
mcp__plugin_browser-use_browser-use__browser_navigate(url="https://example.com")
```
