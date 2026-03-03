---
name: hybrid-debugging
description: Combining Browser Use and claude-in-chrome in a single debugging workflow. Browser Use for DOM navigation, clicking, data extraction, and screenshots; claude-in-chrome for console errors, network requests, JavaScript execution, and GIF recording. Trigger keywords - hybrid, claude-in-chrome, console errors, network requests, debug, combined tools, JS errors, API calls.
version: 1.0.0
tags: [hybrid, debugging, claude-in-chrome, browser-use, console, network, javascript, integration]
keywords: [hybrid debugging, console errors, network requests, javascript errors, combined tools, browser use and chrome, debug workflow, tool combination, claude-in-chrome, console log, fetch, xhr, api trace, gif recording]
plugin: browser-use
updated: 2026-03-03
---

# Hybrid Debugging: Browser Use + claude-in-chrome

Patterns for combining Browser Use MCP tools with claude-in-chrome to achieve full-spectrum browser debugging.

**Core principle**: Browser Use and claude-in-chrome have complementary capabilities. Neither covers everything alone. Hybrid workflows combine their strengths.

---

## 1. Tool Capability Map

| Capability | Browser Use | claude-in-chrome |
|-----------|-------------|-----------------|
| Navigate to URL | `browser_navigate` | Tab management only |
| Click elements | `browser_click` (by index) | `computer` (by coordinate) |
| Type into inputs | `browser_type` (by index) | `computer` (keyboard) |
| Get DOM element map | `browser_get_state` | `read_page` (text extract) |
| Read raw HTML | `browser_get_html` | `read_page` |
| Take screenshot | `browser_screenshot` | `computer` (screenshot) |
| Capture full-page screenshot | `browser_screenshot(full_page=True)` | Not available |
| Scroll page | `browser_scroll` | `computer` (scroll) |
| Read console errors | Not available | `read_console_messages` |
| Read network requests | Not available | `read_network_requests` |
| Execute JavaScript | Not available (no eval tool) | `javascript_tool` |
| Resize viewport | Via agent only | `javascript_tool` (resizeTo) |
| Record GIF of interaction | Not available | `gif_creator` |
| Autonomous agent mode | `retry_with_browser_use_agent` | Not available |
| Multi-tab session | `browser_navigate(new_tab=True)` | Tab enumeration only |
| Export/import session cookies | `browser_export/import_session` | Not available |
| Work on headless browser | Yes (Chromium) | No (requires headed Chrome) |
| Work on developer's Chrome | No | Yes (attaches to running Chrome) |

---

## 2. Detecting claude-in-chrome Availability

Before using hybrid patterns, verify claude-in-chrome is accessible. It requires Chrome to be running with the Claude Chrome extension installed.

```
# Probe for claude-in-chrome availability
mcp__claude-in-chrome__tabs_context_mcp()
→ If successful: returns list of open Chrome tabs → claude-in-chrome IS available
→ If error/timeout: claude-in-chrome NOT available → fall back to Browser Use-only mode
```

**Decision**:

```
available = probe claude-in-chrome
if available:
    use hybrid workflow (see Section 3-4)
else:
    use Browser Use-only fallback (see Section 5)
```

---

## 3. Tool Selection Decision Table

Use this table when deciding which tool to reach for:

| Task | Primary Tool | Fallback |
|------|-------------|----------|
| Navigate to a URL | `browser_navigate` | N/A (no CiC nav) |
| Click a button by DOM element | `browser_click` (index) | `mcp__claude-in-chrome__computer` (coord) |
| Read what errors appeared in console | `read_console_messages` | Not possible with BU alone |
| Trace which API calls a button made | `read_network_requests` | Not possible with BU alone |
| Get the current DOM element map | `browser_get_state` | `read_page` (text only, less structured) |
| Execute arbitrary JavaScript | `javascript_tool` | Not possible with BU alone |
| Capture full-page screenshot | `browser_screenshot(full_page=True)` | `computer` (viewport only) |
| Record a GIF of a user flow | `gif_creator` | screenshot sequence (not animated) |
| Autonomous complex task | `retry_with_browser_use_agent` | Not possible with CiC alone |
| Scrape structured data across pages | `browser_extract_content` + pagination | `javascript_tool` (scrape in-page) |
| Test on user's real logged-in Chrome | `tabs_context_mcp` + CiC tools | Import session (BU) |

---

## 4. Hybrid Workflow Patterns

### 4.1 Pattern: Navigate + Monitor Console

Navigate with Browser Use, observe console errors with claude-in-chrome.

**Use case**: "The checkout button throws an error — find out what JavaScript error occurs."

```
PHASE 1 — Browser Use (Navigate and Click):
  1. browser_navigate(url="https://app.example.com/cart")
     → session_id: "s1"
  2. browser_get_state(session_id="s1")
     → find "Checkout" button → index 7
  3. browser_screenshot(session_id="s1")
     → visual state before click

  4. browser_click(index=7, session_id="s1")
     → triggers the checkout action

PHASE 2 — claude-in-chrome (Console Observation, run after step 4):
  5. mcp__claude-in-chrome__read_console_messages()
     → ["Error: Cannot read property 'total' of undefined (cart.js:142)",
        "Warning: React key prop missing in list item"]

PHASE 3 — Synthesize:
  6. browser_screenshot(session_id="s1")
     → visual state after click (did UI change? error state shown?)
  7. browser_get_state(session_id="s1")
     → DOM state after click (error message in page? modal open?)

  8. browser_close_session(session_id="s1")

Report:
  - Root cause: cart.js:142 — undefined `total` property (JS error)
  - Visual evidence: before/after screenshots
  - DOM state: error modal visible in selector_map
```

### 4.2 Pattern: Click + Trace Network Requests

Trigger a user action with Browser Use, trace the resulting API calls with claude-in-chrome.

**Use case**: "When I submit this form, what API calls are made and are they returning correctly?"

```
PHASE 1 — Browser Use (Navigate and Setup):
  1. browser_navigate(url="https://app.example.com/signup")
     → session_id: "s1"
  2. browser_get_state(session_id="s1")
  3. browser_type(index=2, text="test@example.com", session_id="s1")  # Email field
  4. browser_type(index=3, text="SecurePass123!", session_id="s1")    # Password field

PHASE 2 — Submit and Capture (run together):
  5. browser_click(index=8, session_id="s1")   # Submit button
     [simultaneously]
  6. mcp__claude-in-chrome__read_network_requests()
     → [
         {"url": "/api/auth/signup", "method": "POST", "status": 422,
          "response": {"error": "Email already registered"}},
         {"url": "/api/analytics/event", "method": "POST", "status": 200}
       ]

PHASE 3 — Correlate:
  7. browser_get_state(session_id="s1")
     → DOM shows inline error "Email already in use"
  8. browser_screenshot(session_id="s1")
     → confirms error state displayed visually

  9. browser_close_session(session_id="s1")

Report:
  - API call: POST /api/auth/signup → 422 (Email already registered)
  - UI response: inline error message correctly displayed
  - Issue: Form should clear password field on error (visual check shows it doesn't)
```

### 4.3 Pattern: Screenshot + JavaScript State Validation

Capture visual state with Browser Use, validate application state with JavaScript via claude-in-chrome.

**Use case**: "After adding to cart, verify the cart count in the header updates correctly."

```
PHASE 1 — Browser Use (Action):
  1. browser_navigate(url="https://shop.example.com/product/widget-a")
  2. browser_get_state(session_id)
     → find "Add to Cart" → index 5
  3. browser_screenshot(session_id)   # Before
  4. browser_click(index=5, session_id)
  5. browser_screenshot(session_id)   # After

PHASE 2 — JavaScript State Check:
  6. mcp__claude-in-chrome__javascript_tool(
       script="return JSON.stringify(window.__STORE__?.cart?.items?.length)"
     )
     → "3"   # 3 items in cart now

  7. mcp__claude-in-chrome__javascript_tool(
       script="return document.querySelector('.cart-count')?.textContent"
     )
     → "3"   # Header badge shows 3

PHASE 3 — Verify:
  Screenshot shows badge updated → JavaScript confirms state updated → consistent

  browser_close_session(session_id)
```

### 4.4 Pattern: GIF Recording of Bug Reproduction

Use claude-in-chrome to record a GIF of the bug, while Browser Use performs the interaction.

**Use case**: "Show me the visual glitch when hovering over the dropdown menu."

```
PHASE 1 — Setup GIF recording with claude-in-chrome:
  1. mcp__claude-in-chrome__gif_creator(action="start", filename="dropdown-bug.gif")

PHASE 2 — Trigger interaction with Browser Use:
  2. browser_navigate(url="https://app.example.com")
  3. browser_get_state(session_id)
     → find navigation dropdown → index 3
  4. browser_click(index=3, session_id)   # Open dropdown
  5. browser_get_state(session_id)
     → find specific menu item → index 12
  6. browser_click(index=12, session_id)  # Click menu item

PHASE 3 — Stop recording:
  7. mcp__claude-in-chrome__gif_creator(action="stop")
     → "dropdown-bug.gif saved"

  8. browser_close_session(session_id)
```

Note: This pattern works when Browser Use and claude-in-chrome target the same Chrome instance. Browser Use operates in a headless Chromium by default — for GIF recording, use claude-in-chrome's DOM navigation or use `retry_with_browser_use_agent` with the developer's Chrome (headed mode).

---

## 5. Browser Use-Only Fallback (When claude-in-chrome Unavailable)

When `tabs_context_mcp` probe fails, use these fallback patterns:

| Need | Browser Use-Only Approach | Limitation |
|------|--------------------------|------------|
| Console errors | `retry_with_browser_use_agent(task="Check the browser console for errors after clicking X, use_vision=True")` | Less reliable than direct console access |
| Network trace | `browser_get_html` — look for error messages rendered in page | Cannot see network-level failures |
| JavaScript execution | `retry_with_browser_use_agent(task="Run document.title and report it")` | Agent-mediated, not direct eval |
| Computed styles | `browser_get_html(selector=element)` — inspect inline styles | No computed style access |
| Application state | `browser_extract_content(query="cart total and item count")` | Semantic, not programmatic |

### Fallback Debugging Report

When running Browser Use-only, be explicit about what you could and could not check:

```markdown
## Debugging Report (Browser Use-Only Mode)

**Checked** (via Browser Use):
- Visual state: screenshot before/after interaction
- DOM state: selector_map, element attributes
- Page HTML: class names, inline styles, aria attributes

**Not Checked** (requires claude-in-chrome):
- JavaScript console errors
- Network request trace
- Computed CSS properties
- Application state (Redux/Vuex store)

**Recommendation**: Install the claude-in-chrome extension and re-run for complete analysis.
```

---

## 6. Parallel Execution for Efficiency

When using both tools in a hybrid workflow, run independent operations in parallel:

```
# SEQUENTIAL (slow):
browser_click(...)             # 1. Click
browser_screenshot(...)        # 2. Screenshot
read_console_messages(...)     # 3. Console
read_network_requests(...)     # 4. Network

# PARALLEL (fast) — screenshot + console + network can all run after the click:
browser_click(...)             # 1. Click
  [then simultaneously]:
  browser_screenshot(...)      # 2a. Visual state
  read_console_messages(...)   # 2b. Console errors
  read_network_requests(...)   # 2c. Network trace
```

Use Claude Code's parallel tool calling by making all three tool calls in the same response turn after the click action completes.

---

## 7. Key Decision: Which Tool Owns Navigation?

In a hybrid workflow, Browser Use always owns navigation (page loads, clicks, form fills). claude-in-chrome observes passively — it reads the state of the current page without navigating itself.

```
Browser Use: DRIVER (navigates, clicks, types, extracts)
claude-in-chrome: OBSERVER (reads console, network, runs JS queries)
```

Never use claude-in-chrome's `computer` tool for navigation if Browser Use is active — it could click into a different Chrome window than the one Browser Use is controlling.
