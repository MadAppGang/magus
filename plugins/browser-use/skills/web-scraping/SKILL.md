---
name: web-scraping
description: Structured data extraction from web pages — pagination patterns, dynamic SPAs, authenticated scraping, rate limiting, anti-bot handling, JSON/CSV output. Trigger keywords - scrape, extract data, web scraping, paginate, collect data from, crawl, next page, infinite scroll.
version: 1.0.0
tags: [scraping, extraction, pagination, spa, authentication, rate-limiting, structured-data, json, csv]
keywords: [scrape, extract data, collect data, paginate, next page, infinite scroll, spa, dynamic content, login, authenticated, rate limit, anti-bot, structured data, json, csv, crawl, harvest]
plugin: browser-use
updated: 2026-03-03
---

# Web Scraping Patterns

Patterns for extracting structured data from web pages, including pagination, SPAs, authenticated scraping, and rate-limited crawls.

---

## 1. Core Scraping Loop

The fundamental extract-one-page workflow:

```
1. Navigate to page
   mcp__browser-use__browser_navigate(url="https://shop.example.com/products")
   → session_id: "s1"

2. Get DOM state (find data containers and pagination controls)
   mcp__browser-use__browser_get_state(session_id="s1")
   → selector_map: {... "47": {tag: "a", text: "Next →", href: "..."}, ...}

3. Extract structured data with LLM-powered query
   mcp__browser-use__browser_extract_content(
     query="product name, price, SKU, availability for each product listed",
     session_id="s1"
   )
   → "Product: Widget A, Price: $12.99, SKU: WA-001, In Stock\n..."

4. Append to results array

5. Check pagination (see Section 2)

6. Close session when done
   mcp__browser-use__browser_close_session(session_id="s1")

7. Write results to file
   Write tool → products.json
```

### When to Use `extract_content` vs `get_html`

| Situation | Tool | Reason |
|-----------|------|--------|
| Data layout is complex or varies per item | `extract_content` | LLM understands natural variation |
| You know the exact CSS selector | `get_html` | Faster, cheaper (no LLM call) |
| Extracting a table | `get_html(selector=".data-table")` | Raw HTML is easier to parse programmatically |
| Extracting a product listing with many fields | `extract_content` | LLM handles field extraction |
| Page has inconsistent markup | `extract_content` | Semantic understanding handles inconsistency |

---

## 2. Pagination Patterns

### 2.1 Numbered Page Navigation

For sites with `?page=N` URL patterns:

```
base_url = "https://shop.example.com/products"
all_results = []

for page in range(1, max_pages + 1):
    url = f"{base_url}?page={page}"
    mcp__browser-use__browser_navigate(url=url, session_id=session_id)
    state = mcp__browser-use__browser_get_state(session_id=session_id)

    # Check if page has content (stop if we reach an empty page)
    if "No products found" in str(state["selector_map"]):
        break

    data = mcp__browser-use__browser_extract_content(
        query="all product names, prices, and URLs",
        session_id=session_id
    )
    all_results.append(data["content"])

    # Rate limit: pause between pages
    Bash: sleep 1
```

### 2.2 Next Button Pagination

For sites with a "Next" or ">" button:

```
session_id from browser_navigate(url=start_url)
all_results = []
page = 0

LOOP:
    page += 1
    state = browser_get_state(session_id)

    # Extract data on current page
    data = browser_extract_content(query="...", session_id)
    all_results.append(data)

    # Find next button in selector_map
    next_index = find_next_button(state["selector_map"])
    # Look for: text contains "Next", "›", "»", or href with page+1

    if next_index is None or page >= max_pages:
        BREAK  # No more pages

    browser_click(index=next_index, session_id)
    # After click, DOM updates — call get_state again in next loop iteration

browser_close_session(session_id)
```

**Finding the "next" button**: Look in `selector_map` for elements with:
- `text` containing: `"Next"`, `"›"`, `"»"`, `">"`, `"Load more"`
- `href` containing: `page=N+1`, `offset=`, `cursor=`
- `attributes["aria-label"]` containing: `"Next page"`

### 2.3 Infinite Scroll (Lazy Loading)

For pages that load more content as you scroll down:

```
session_id from browser_navigate(url=start_url)
all_results = []
previous_count = 0

LOOP (max 20 scrolls):
    # Extract current visible items
    data = browser_extract_content(query="all items visible", session_id)
    current_count = count_items(data)

    if current_count == previous_count:
        BREAK  # No new items loaded — end of list

    all_results.extend(new_items(data, previous_count))
    previous_count = current_count

    # Scroll down to trigger next batch
    browser_scroll(direction="down", amount=2000, session_id=session_id)

    # Wait for lazy-load: call get_state twice (SPA needs render time)
    browser_get_state(session_id)
    browser_get_state(session_id)

browser_close_session(session_id)
```

### 2.4 Pagination Safety Limits

Always set a `max_pages` limit to prevent runaway scrapes:

```
max_pages = 50       # Hard stop
rate_limit_ms = 1000 # 1 second between pages
timeout_items = 1000 # Stop if collected 1000 items
```

---

## 3. SPA and Dynamic Content Handling

SPAs (React, Vue, Angular) render content via JavaScript after the initial HTML load. `browser_navigate` may return before JS rendering completes.

### 3.1 Wait-for-DOM Pattern

```
1. browser_navigate(url="https://spa-app.com/products")
   → response arrives, but DOM is still rendering

2. browser_get_state(session_id)
   → selector_map may be sparse (only skeleton/loading elements)

3. browser_get_state(session_id)   ← call again after first render
   → selector_map now has actual content

4. If still sparse:
   browser_scroll(direction="down", amount=100, session_id)  ← trigger rendering
   browser_get_state(session_id)   ← try once more
```

### 3.2 Detecting a Loaded SPA

Signs the page is still loading in `selector_map`:
- Elements with text like `"Loading..."`, `"Fetching..."`, `"Please wait"`
- Very few elements (< 5) when expecting many
- Elements with class names containing `skeleton`, `placeholder`, `shimmer`

Signs the page is loaded:
- Product cards, article titles, or expected data elements present
- Pagination controls visible
- Search/filter controls enabled

### 3.3 URL Hash Navigation in SPAs

Some SPAs use hash routing (`#/products`). Navigate with the full URL including hash:

```
browser_navigate(url="https://app.example.com/#/dashboard/reports")
```

---

## 4. Authenticated Scraping

Scraping behind a login wall — two strategies:

### 4.1 Strategy A: Live Login (First Time)

```
# 1. Navigate to login page
browser_navigate(url="https://site.com/login")

# 2. Fill credentials
state = browser_get_state(session_id)
# Find username input in selector_map → index N
# Find password input in selector_map → index M
browser_type(index=N, text="username@example.com", session_id)
browser_type(index=M, text="password123", session_id)

# 3. Submit
# Find submit button in selector_map → index P
browser_click(index=P, session_id)

# 4. Verify login succeeded
state = browser_get_state(session_id)
# Check: no login form present, dashboard elements visible

# 5. Export session for future use
browser_export_session(
  session_id=session_id,
  output_path="~/.browser-use/sessions/site-session.json"
)

# 6. Proceed to scrape protected pages...
```

### 4.2 Strategy B: Restore Saved Session

```
# Import cookies from previous login session
browser_import_session(
  import_path="~/.browser-use/sessions/site-session.json",
  navigate_to="https://site.com/dashboard"
)
→ session_id: "restored_xyz"

# Verify session is still valid
state = browser_get_state(session_id="restored_xyz")
# If login form visible → session expired, fall back to Strategy A
# If dashboard visible → proceed with scraping
```

### 4.3 Session Expiry Handling

```
FUNCTION check_logged_in(session_id, expected_element_text):
    state = browser_get_state(session_id)
    for element in selector_map.values():
        if expected_element_text in element.get("text", ""):
            return True
    return False  # Session expired
```

---

## 5. Rate Limiting and Politeness

Scraping too fast can trigger anti-bot measures (IP bans, CAPTCHAs, 429 errors). Apply rate limits.

### 5.1 Simple Sleep Between Pages

```
# After each page navigation:
Bash: sleep 1    # 1 second between page loads

# For polite crawling of small sites:
Bash: sleep 3    # 3 seconds between requests
```

### 5.2 Randomized Delays

More realistic delay pattern to avoid detection:

```
# Between pages, use random delay 1-3 seconds
Bash: python3 -c "import time, random; time.sleep(random.uniform(1, 3))"
```

### 5.3 Anti-Bot Indicators

Watch for these signals in `browser_get_state` responses:
- Page title: `"Access Denied"`, `"403 Forbidden"`, `"Bot Detected"`, `"Cloudflare"`
- URL change to `/challenge`, `/captcha`, `/blocked`
- `selector_map` dominated by CAPTCHA widgets

**On bot detection**: Stop scraping. Consider using Browser Use Cloud mode (`/browser-use:cloud`) which includes stealth mode, proxy rotation, and CAPTCHA handling.

---

## 6. Structured Output Formatting

### 6.1 Collecting Results

```
all_results = []

for each page:
    data = browser_extract_content(query="product name, price, URL", session_id)
    all_results.append(data["content"])
```

### 6.2 Writing JSON Output

After scraping all pages, write results using the Write tool:

```
# Write as JSON array
Write tool → products.json:
[
  {"name": "Widget A", "price": "$12.99", "url": "..."},
  {"name": "Widget B", "price": "$24.99", "url": "..."}
]
```

### 6.3 Writing CSV Output

For tabular data, write as CSV:

```
Write tool → products.csv:
name,price,sku,availability
Widget A,$12.99,WA-001,In Stock
Widget B,$24.99,WB-002,Out of Stock
```

### 6.4 Streaming Writes for Large Datasets

For large scrapes (hundreds of pages), write incrementally rather than accumulating in memory:

```
# Every 10 pages, append to file rather than accumulating all in memory
# Prevents memory issues for large scrapes
# Write partial results after each batch, report running total to user
```

---

## 7. Anti-Patterns

### No Pagination Limit

```
# WRONG: No max_pages guard — will run until the site has no more pages or crashes
while has_next_page:
    scrape_page()
    click_next()

# CORRECT: Always set a max
page = 0
max_pages = 100
while has_next_page and page < max_pages:
    scrape_page()
    click_next()
    page += 1
```

### Not Closing Session After Error

```
# WRONG: Exception aborts workflow, session never closed
data = browser_extract_content(...)  # raises error
browser_close_session(session_id)    # never reached

# CORRECT: Close before raising
try:
    data = browser_extract_content(...)
finally:
    browser_close_session(session_id)
```

### Scraping Without Verification

```
# WRONG: Assume extract_content always works
data = browser_extract_content(query="products", session_id)
results.extend(data)  # What if page redirected to login? Data is now the login page.

# CORRECT: Verify page content before extracting
state = browser_get_state(session_id)
if "Login" in get_page_title(state):
    handle_session_expired()
else:
    data = browser_extract_content(query="products", session_id)
```
