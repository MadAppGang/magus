---
name: hybrid-debugging
description: Combines Browser Use (DOM, clicks, screenshots) with claude-in-chrome (console, network, JS) for full-spectrum debugging. Use when investigating console errors or network requests.
user-invocable: false
---

# Hybrid Debugging: Browser Use + claude-in-chrome

Patterns for combining Browser Use MCP tools with claude-in-chrome to achieve full-spectrum browser debugging.

**Core principle**: Browser Use and claude-in-chrome have complementary capabilities. Neither covers everything alone. Hybrid workflows combine their strengths.

---

## 1. Tool Capability Map

| Capability | Browser Use | claude-in-chrome |
|-----------|-------------|-----------------|
| Navigate to URL | `browser_navigate` | `navigate` |
| Click elements | `browser_click` (by index) | `computer` (by coordinate) |
| Type into inputs | `browser_type` (by index) | `computer` (keyboard) |
| Get DOM element map | `browser_get_state` | `read_page` (text extract) |
| Read raw HTML | `browser_get_html` | `read_page` |
| Take screenshot | `browser_screenshot` (seen by the model); `browser_save_screenshot` (PNG file) | `computer` (screenshot) |
| Capture full-page screenshot | `browser_screenshot(full_page=True)` | Not available |
| Scroll page | `browser_scroll` | `computer` (scroll) |
| Read console errors | An error hook installed with `browser_evaluate` (§4.1) | `read_console_messages` |
| Read network requests | URLs and statuses from `performance` entries via `browser_evaluate` (§4.2) | `read_network_requests` |
| Execute JavaScript | `browser_evaluate` (in its own page) | `javascript_tool` |
| Resize viewport | Not available | `resize_window` |
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
| Execute arbitrary JavaScript | `browser_evaluate` (BU's page) | `javascript_tool` (the user's Chrome) |
| Capture full-page screenshot | `browser_screenshot(full_page=True)` | `computer` (viewport only) |
| Record a GIF of a user flow | `gif_creator` | screenshot sequence (not animated) |
| Autonomous complex task | `retry_with_browser_use_agent` | Not possible with CiC alone |
| Scrape structured data across pages | `browser_extract_content` + pagination | `javascript_tool` (scrape in-page) |
| Test on user's real logged-in Chrome | `tabs_context_mcp` + CiC tools | Import session (BU) |

---

## 4. Hybrid Workflow Patterns

**Two browsers, not one.** Browser Use drives its own headless Chromium; claude-in-chrome
reads the user's Chrome. Console and network reads from claude-in-chrome describe the
Chrome tab, never Browser Use's session. For the patterns below to observe the same page,
open the URL in the user's Chrome too (`mcp__claude-in-chrome__navigate`) and reproduce
the action there; use Browser Use for what only it has (indexed DOM map, full-page
screenshots, the autonomous agent).

### 4.1 Pattern: Click + Console Errors

**Use case**: "The checkout button throws an error — find out what JavaScript error occurs."

In the user's Chrome (claude-in-chrome), where the console is readable:

```
1. mcp__claude-in-chrome__navigate(url="https://app.example.com/cart")   → returns the tab list; note tabId
2. mcp__claude-in-chrome__find(query="Checkout button", tabId=T)   → its ref
3. mcp__claude-in-chrome__computer(action="left_click", ref="ref_…", tabId=T)
4. mcp__claude-in-chrome__read_console_messages(tabId=T, pattern="Error|Warning", onlyErrors=true)
   → the errors this click raised, with file:line
```

In Browser Use alone, install an error hook before the action and read it after:

```
1. browser_navigate(url="https://app.example.com/cart")
2. browser_evaluate(script="window.__errs=[]; addEventListener('error', e => __errs.push(e.message + ' @ ' + e.filename + ':' + e.lineno)); addEventListener('unhandledrejection', e => __errs.push(String(e.reason))); const ce = console.error; console.error = (...a) => { __errs.push(a.join(' ')); ce(...a) }; return true")
3. browser_get_state()  → "Checkout" button → index 7
4. browser_click(index=7)
5. browser_evaluate(script="return window.__errs")
6. browser_save_screenshot(output_path="/abs/path/after-checkout.png")
```

The hook sees only what happens after step 2; an error during page load needs claude-in-chrome.

### 4.2 Pattern: Submit + Network Requests

**Use case**: "When I submit this form, what API calls are made and are they returning correctly?"

In the user's Chrome (full request list, statuses, bodies):

```
1. mcp__claude-in-chrome__navigate(url="https://app.example.com/signup")
2. mcp__claude-in-chrome__form_input(…, tabId=T) for each field, then click submit with computer
3. mcp__claude-in-chrome__read_network_requests(tabId=T, urlPattern="/api/")
```

In Browser Use alone, the Resource Timing entries give URL, type and status (no bodies):

```
1. browser_navigate(url="https://app.example.com/signup")
2. browser_get_state() → field indices; browser_type(…) each; browser_click(index=<submit>)
3. browser_evaluate(script="return performance.getEntriesByType('resource').filter(e => e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest').map(e => ({url: e.name, status: e.responseStatus, ms: Math.round(e.duration)}))")
```

### 4.3 Pattern: Action + Application State

**Use case**: "After adding to cart, verify the cart count in the header updates correctly."

This needs no second browser: `browser_evaluate` reads state in the page Browser Use drives.

```
1. browser_navigate(url="https://shop.example.com/product/widget-a")
2. browser_get_state() → "Add to Cart" → index 5
3. browser_click(index=5)
4. browser_evaluate(script="return {store: window.__STORE__?.cart?.items?.length, badge: document.querySelector('.cart-count')?.textContent}")
   → {"result": {"store": 3, "badge": "3"}}
5. browser_screenshot()   → the badge as the user sees it
```

### 4.4 Pattern: GIF of a Bug Reproduction

`gif_creator` records the user's Chrome, so the whole reproduction runs there:
`gif_creator(action="start_recording", tabId=T)`, drive the page with claude-in-chrome
(`navigate`, `find`, `computer`), then `stop_recording` and `export` with `download=true`. Browser Use cannot appear in that recording: its
Chromium is headless and separate.

---

## 5. Browser Use-Only Fallback (When claude-in-chrome Unavailable)

When `tabs_context_mcp` probe fails, use these fallback patterns:

| Need | Browser Use-Only Approach | Limitation |
|------|--------------------------|------------|
| Console errors | The `browser_evaluate` error hook (§4.1) | Sees only errors after the hook is installed |
| Network trace | `performance.getEntriesByType('resource')` via `browser_evaluate` (§4.2) | URL, status and timing; no request or response bodies |
| JavaScript execution | `browser_evaluate(script="document.title")` | None — direct eval in the live page |
| Computed styles | `browser_evaluate(script="getComputedStyle(document.querySelector('.x')).color")` | None |
| Application state | `browser_evaluate` on the store (`window.__STORE__`), or `browser_extract_content` | Store must be reachable from `window` |

### Fallback Debugging Report

When running Browser Use-only, be explicit about what you could and could not check:

```markdown
## Debugging Report (Browser Use-Only Mode)

**Checked** (via Browser Use):
- Visual state: screenshot before/after interaction
- DOM state: interactive_elements
- Page HTML: class names, inline styles, aria attributes
- Computed CSS and application state, through `browser_evaluate`

**Not Checked** (requires claude-in-chrome):
- Console errors raised before the hook was installed (page load)
- Request and response bodies

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
