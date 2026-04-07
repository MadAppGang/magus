---
name: navigation-patterns
description: URL navigation, multi-tab orchestration, session creation and management, back/forward navigation, browser profile persistence, session export/import for authentication reuse. Trigger keywords - navigate to, open URL, multiple tabs, session, browser profile, tab switch, browser history, back button.
version: 1.0.0
tags: [browser, navigation, tabs, session, profile, url, multi-tab, authentication]
keywords: [navigate to, open url, new tab, tab, session, back, forward, browser profile, cookies, authentication, session persistence, multi-tab, switch tab, close tab, profile, user data dir]
plugin: browser-use
updated: 2026-03-03
user-invocable: false
---

# Navigation Patterns

Patterns for URL navigation, multi-tab workflows, session lifecycle management, and browser profile persistence.

---

## 1. Basic Navigation

The fundamental browser pattern: navigate, inspect, interact, close.

```
Step 1: Navigate to URL (session created automatically)
  mcp__browser-use__browser_navigate(url="https://example.com")
  → Save session_id from response

Step 2: Inspect the page
  mcp__browser-use__browser_get_state(session_id="abc123")
  → Returns selector_map with numbered elements

Step 3: Interact (optional)
  mcp__browser-use__browser_click(index=3, session_id="abc123")

Step 4: Always close
  mcp__browser-use__browser_close_session(session_id="abc123")
```

**Verify page loaded**: After `browser_navigate`, check the response `title` and `url`. If `title` is blank or URL redirected unexpectedly, call `browser_get_state` to inspect the actual page content before proceeding.

**Wait for dynamic content**: For SPAs (React, Vue, Angular), the DOM may not be ready immediately after navigate. If `selector_map` in `browser_get_state` is sparse or empty, call `browser_get_state` again after a short delay:

```
1. browser_navigate(url="https://spa-app.example.com")
2. browser_get_state(session_id) → sparse selector_map?
3. browser_get_state(session_id) → call again; SPA renders after first paint
```

---

## 2. Back Navigation

Use `browser_go_back` to return to the previous page without creating a new navigation entry.

```
Pattern: Visit detail page, then return to list

1. browser_navigate(url="https://shop.example.com/products")    → session_id
2. browser_get_state(session_id) → find product links in selector_map
3. browser_click(index=5, session_id)                          → navigate to product detail
4. browser_extract_content(query="price and specs", session_id)
5. browser_go_back(session_id)                                  → back to product list
6. browser_get_state(session_id)                               → DOM refreshed
7. browser_click(index=6, session_id)                          → next product
... repeat ...
N. browser_close_session(session_id)
```

**Note**: `browser_go_back` uses the browser's history stack. It will fail if there is no previous page (e.g., you navigated directly to a deep URL). In that case, use `browser_navigate` with the list URL instead.

---

## 3. Multi-Tab Workflows

Open multiple tabs within a single session to compare pages or extract data in parallel.

### 3.1 Open Link in New Tab

```
1. browser_navigate(url="https://example.com", session_id=None)     → session_id: "s1"
2. browser_navigate(url="https://example.com/page-2", session_id="s1", new_tab=True)
                                                                      → opens tab_1
3. browser_list_tabs(session_id="s1")
   → [{"tab_id": "tab_0", "url": ".../page-1", "active": false},
      {"tab_id": "tab_1", "url": ".../page-2", "active": true}]
```

### 3.2 Switch Between Tabs

```
4. browser_switch_tab(tab_id="tab_0", session_id="s1")   → activate tab_0
5. browser_get_state(session_id="s1")                    → DOM of tab_0
6. browser_extract_content(query="pricing", session_id="s1")

7. browser_switch_tab(tab_id="tab_1", session_id="s1")   → activate tab_1
8. browser_extract_content(query="pricing", session_id="s1")
```

### 3.3 Close Individual Tabs

```
9. browser_close_tab(tab_id="tab_1", session_id="s1")   → close second tab
10. browser_close_session(session_id="s1")              → close session (closes remaining tabs)
```

### Multi-Tab Use Cases

| Use Case | Pattern |
|----------|---------|
| Compare prices on two sites | Open site A → new_tab for site B → extract from each |
| Scrape paginated list into detail pages | Open list → each item in new tab → extract → close tab → next item |
| Compare before/after a UI change | Navigate to staging → new tab to production → screenshot both |
| Log in on one tab, use auth on another | Log in on tab_0, navigate to protected resource on tab_1 (same session shares cookies) |

---

## 4. Session Lifecycle Management

### 4.1 Session Creation

Sessions are created implicitly when `browser_navigate` is called without a `session_id`. Always save the returned `session_id`:

```
response = mcp__browser-use__browser_navigate(url="https://example.com")
session_id = response["session_id"]   # e.g., "abc123"
```

### 4.2 Session Inspection

List active sessions to detect leaks from previous runs or to resume a workflow:

```
mcp__browser-use__browser_list_sessions()
→ {"sessions": [{"session_id": "abc123", "url": "...", "created_at": "..."}]}
```

Always check for existing sessions before starting a new workflow — a previous error may have left sessions open.

### 4.3 Session Cleanup

```
# Clean up a specific session
mcp__browser-use__browser_close_session(session_id="abc123")

# Clean up all leaked sessions at start of new workflow
sessions = mcp__browser-use__browser_list_sessions()
for s in sessions["sessions"]:
    mcp__browser-use__browser_close_session(session_id=s["session_id"])
```

### 4.4 Session Cleanup Decision Table

| Situation | Action |
|-----------|--------|
| Workflow completed successfully | `browser_close_session` |
| Workflow failed with an error | `browser_close_session` (still required) |
| Need to use the same session in the next step | Keep open, pass `session_id` to next tool |
| Starting a new unrelated task | `browser_list_sessions` + close all |
| Debugging a stuck page | `browser_screenshot` first, then close |

---

## 5. Browser Profile Persistence

Browser profiles save cookies, localStorage, and login state across Claude Code sessions. Use them to skip login flows.

### 5.1 Profile Directory

Profiles are stored in `~/.browser-use/profiles/` (one directory per profile, named by you):

```
~/.browser-use/
├── profiles/
│   ├── github/       # Saved login state for GitHub
│   ├── jira/         # Saved login state for Jira
│   └── work-google/  # Work Google account cookies
└── sessions/         # Exported session snapshots (JSON files)
```

### 5.2 Export Session for Reuse (After Login)

After completing a login workflow, export the session state to a JSON file:

```
# 1. Navigate and log in normally
mcp__browser-use__browser_navigate(url="https://github.com/login")
# ... complete login workflow (fill username, password, click submit) ...

# 2. Export the authenticated session
mcp__browser-use__browser_export_session(
  session_id="abc123",
  output_path="~/.browser-use/sessions/github-session.json"
)

# 3. Close the session
mcp__browser-use__browser_close_session(session_id="abc123")
```

### 5.3 Import Session (Skip Login)

In the next Claude Code session, restore the saved login state:

```
# Import saved cookies into a new session
mcp__browser-use__browser_import_session(
  import_path="~/.browser-use/sessions/github-session.json",
  navigate_to="https://github.com/dashboard"
)
→ {"session_id": "new_xyz", "cookies_imported": 12, "url": "https://github.com/dashboard"}

# Verify login worked
mcp__browser-use__browser_get_state(session_id="new_xyz")
# Check: selector_map should show dashboard elements, not login form
```

### 5.4 Session Expiry Check

Saved sessions expire when site cookies expire. After importing, verify login succeeded:

```
1. browser_import_session(import_path="...", navigate_to="https://site.com/dashboard")
2. browser_get_state(session_id)
3. Check: if selector_map contains login form elements → session expired, login again
         if selector_map contains dashboard elements → session active, proceed
```

---

## 6. Anti-Patterns

### Session Leaks

```
# WRONG: Forgot to close session
mcp__browser-use__browser_navigate(url="https://example.com")
mcp__browser-use__browser_extract_content(query="pricing", session_id="abc123")
# Task complete — session never closed. Browser process running, memory leaked.

# CORRECT: Always close
mcp__browser-use__browser_navigate(url="https://example.com")
mcp__browser-use__browser_extract_content(query="pricing", session_id="abc123")
mcp__browser-use__browser_close_session(session_id="abc123")
```

### Stale Session IDs

```
# WRONG: Reusing a session_id from a previous Claude Code session
mcp__browser-use__browser_click(index=3, session_id="abc123")
# → {"error": "session_not_found"}

# CORRECT: Always navigate first to create a fresh session
mcp__browser-use__browser_navigate(url="https://example.com")
→ session_id: "new_session_id"
```

### Tab Accumulation

```
# WRONG: Opening new tab in a loop without closing old ones
for each product_url:
    browser_navigate(url=product_url, session_id=s, new_tab=True)
    # 50 tabs open at once → browser crashes

# CORRECT: Close tab before opening next
for each product_url:
    browser_navigate(url=product_url, session_id=s, new_tab=True)
    tab_id = browser_list_tabs(session_id=s)["tabs"][-1]["tab_id"]
    # ... extract data ...
    browser_close_tab(tab_id=tab_id, session_id=s)
```

### Missing URL Scheme

```
# WRONG: URL without scheme
mcp__browser-use__browser_navigate(url="example.com")
# → navigation error

# CORRECT: Always include https://
mcp__browser-use__browser_navigate(url="https://example.com")
```
