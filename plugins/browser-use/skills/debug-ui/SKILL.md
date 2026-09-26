---
name: debug-ui
description: Visual UI debugging — screenshot capture and analysis, responsive layout checking at multiple viewport sizes, CSS validation via DOM state, visual regression detection, before/after state comparison.
user-invocable: false
---

# UI Debugging Patterns

Patterns for detecting visual bugs, checking responsive layouts, validating CSS properties, and performing before/after visual comparisons using Browser Use's screenshot and DOM state tools.

---

## 1. Visual State Capture Workflow

The baseline pattern for any UI debugging task:

```
Step 1: Navigate to the page under investigation
  mcp__plugin_browser-use_browser-use__browser_navigate(url="https://app.example.com/dashboard")
  mcp__plugin_browser-use_browser-use__browser_list_sessions()
  → record the new session's id, e.g. "debug_01"

Step 2: Capture visual state
  mcp__plugin_browser-use_browser-use__browser_screenshot()
  → an image the model sees directly (browser_save_screenshot writes a PNG file)

Step 3: Inspect DOM state for element details
  mcp__plugin_browser-use_browser-use__browser_get_state()
  → interactive_elements: index, tag, text, href for each clickable element

Step 4: Get HTML for CSS/class inspection
  mcp__plugin_browser-use_browser-use__browser_get_html(
    selector=".problematic-component")
  → raw HTML with class names, inline styles, data attributes

Step 5: Close session
  mcp__plugin_browser-use_browser-use__browser_close_session(session_id="debug_01")
```

### Reading Screenshots

When analyzing a screenshot from `browser_screenshot`:
- Look for visual misalignments: text overflowing containers, images cropped incorrectly
- Check button/link clickable areas: text labels that appear cut off
- Identify z-index issues: elements appearing behind other elements unexpectedly
- Verify color contrast: text against background (low contrast = readability issue)
- Spot layout breaks: columns that should be side by side that are stacked, or vice versa

---

## 2. Responsive Layout Testing

Browser Use cannot change the viewport size: no tool takes a width, and page
JavaScript (`window.resizeTo`, a rewritten meta viewport) cannot resize a
top-level window. Screenshots here are at the server's one window size.

### 2.1 What you can check at the current size

Ask the page which breakpoints are active, and what the layout computed:

```
browser_evaluate(script="return [320,375,414,768,1024,1280,1440].map(w => [w, matchMedia(`(min-width: ${w}px)`).matches])")
browser_evaluate(script="return getComputedStyle(document.querySelector('.nav')).display")
```

For screenshots at other widths, use a browser that can resize: claude-in-chrome's
`resize_window`, or the project's own Playwright tests with a `viewport` option.

### 2.2 Standard Breakpoints to Test

| Breakpoint | Width | Device Class |
|------------|-------|--------------|
| Mobile S | 320px | Small phones |
| Mobile M | 375px | iPhone SE, iPhone 12 mini |
| Mobile L | 414px | iPhone Plus/Max, Android large |
| Tablet | 768px | iPad portrait |
| Laptop | 1024px | Small laptop |
| Desktop | 1280px | Standard monitor |
| Wide | 1440px+ | Large monitor |

### 2.3 Responsive Bug Detection Checklist

At each breakpoint you can reach, look for:

- [ ] Navigation menu: collapsed to hamburger on mobile?
- [ ] Text: no overflow outside containers, no horizontal scroll
- [ ] Images: responsive (scale with container)?
- [ ] Buttons: large enough tap targets on mobile (min 44x44px)?
- [ ] Tables: scroll horizontally or stack on small screens?
- [ ] Forms: inputs full-width on mobile?
- [ ] Content: no content hidden behind other content (z-index issues)?
- [ ] Whitespace: not excessive on mobile (padding/margin scaling)?

---

## 3. DOM State Inspection for CSS Debugging

Use `browser_get_state` and `browser_get_html` to inspect CSS classes, attributes and inline styles; use `browser_evaluate` with `getComputedStyle` for computed styles.

### 3.1 Find Elements by CSS Class

```
# Get HTML of a specific component to see its CSS classes and inline styles
browser_get_html(
  selector=".checkout-button")
→ "<button class='checkout-button btn btn-primary disabled' style='opacity: 0.5;' disabled>Check Out</button>"
```

From this HTML you can detect:
- `disabled` attribute (button non-interactive)
- `opacity: 0.5` (intentionally dimmed, but should it be?)
- Unexpected extra class `disabled` (added by application state)

### 3.2 Find Hidden Elements

```
# Get full page HTML and search for hidden elements
browser_get_html()
→ scan for: display:none, visibility:hidden, opacity:0, height:0, overflow:hidden

# Or ask the page directly
browser_evaluate(script="return [...document.querySelectorAll('button, a, input')].filter(e => !e.checkVisibility()).map(e => e.outerHTML.slice(0, 80))")
```

### 3.3 Attribute Validation

`browser_get_state` lists only each element's index, tag, text and href. Read
attributes from `browser_get_html(selector=…)`, or with `browser_evaluate`
(`el.getAttribute('aria-label')`). Check for:

| Attribute | What to Verify |
|-----------|---------------|
| `class` | Expected CSS classes applied, no conflicting classes |
| `aria-label` | Accessible label present for interactive elements |
| `aria-disabled` | Matches visual disabled state |
| `href` | Correct URL (not "#" or javascript:void(0)) |
| `data-*` | Application state attributes set correctly |
| `type` (input) | Correct type (e.g., "email" for email fields) |

---

## 4. Before/After Visual Comparison

Capture visual state before and after an action or code change.

### 4.1 Before/After State Comparison Workflow

```
# BEFORE state: capture baseline
browser_navigate(url="https://app.example.com/cart")
session_id = the new entry in browser_list_sessions()
browser_save_screenshot(output_path="/abs/path/before.png", full_page=True)
# Analyze: Claude describes the visual state

# Apply action (e.g., add item to cart)
state = browser_get_state()
# Find "Add to Cart" button → index N
browser_click(index=N)

# AFTER state: capture changed state
browser_save_screenshot(output_path="/abs/path/after.png", full_page=True)
# Analyze: read both PNGs and describe what changed

browser_close_session(session_id=session_id)
```

### 4.2 Visual Regression Baseline Pattern

For tracking regressions across deployments:

```
Step 1: Capture baseline (production/main branch)
  browser_save_screenshot(output_path="/abs/path/baseline-homepage.png", full_page=True)

Step 2: Capture candidate (staging/PR branch)
  browser_save_screenshot(output_path="/abs/path/candidate-homepage.png", full_page=True)

Step 3: Report differences
  Claude analyzes both screenshots and describes:
  - Layout changes
  - Color changes
  - Missing or new elements
  - Font/size changes
  - Spacing differences
```

**Limitation**: Browser Use does no pixel diff itself. With both PNGs on disk, a pixel diff is one command away (the designer plugin's `compare` skill runs one); otherwise the comparison is descriptive. For automated CI regression testing with pixel diff, use Playwright + Percy or BackstopJS instead.

---

## 5. Common Visual Bug Patterns

### 5.1 Overlapping Elements (Z-Index Issues)

**Detection**:
```
# Screenshot reveals two elements occupying the same space
browser_screenshot()
# → Claude can see: tooltip covered by navbar, modal behind overlay, etc.

# Confirm via HTML: check z-index in inline styles or classes
browser_get_html(selector=".navbar, .tooltip")
→ look for z-index values, position:fixed, position:absolute
```

### 5.2 Text Overflow / Truncation

**Detection**:
```
# Screenshot shows "..." in unexpected places
browser_screenshot()

# Confirm via HTML: find overflow:hidden, white-space:nowrap, text-overflow:ellipsis
browser_get_html(selector=".product-title, .card-description")
```

### 5.3 Broken Flexbox/Grid Layout

**Detection**:
```
# Screenshot shows elements stacked that should be side-by-side, or vice versa
browser_screenshot()

# Confirm via HTML: check display:flex, display:grid, flex-direction, grid-template-columns
browser_get_html(selector=".product-grid, .card-container")
```

### 5.4 Missing Images / Broken Image Links

**Detection**:
```
# Get HTML and check img tags for broken src attributes
browser_get_html(selector="img")
→ look for: src="" (empty), src="/undefined", missing alt attributes
```

### 5.5 Button/Link Disabled State Not Visual

**Detection**:
```
# Button appears active but doesn't respond to clicks
browser_get_state()
# Check interactive_elements element attributes for: disabled, aria-disabled, tabindex="-1"

browser_get_html(selector="#checkout-btn")
# Check for: pointer-events:none, opacity:0.5 without disabled attr (just visually disabled)
```

---

## 6. When to Escalate to claude-in-chrome

Computed CSS, framework state and performance entries are one `browser_evaluate` call
away in Browser Use's own page (`getComputedStyle(el)`, `window.__STORE__`,
`performance.getEntries()`). Console history, the network log and GIF recording are not;
they need claude-in-chrome, which reads the user's Chrome rather than Browser Use's
session.

**Escalate to claude-in-chrome when you need**:

| Signal | Tool Required |
|--------|--------------|
| JavaScript console errors | `mcp__claude-in-chrome__read_console_messages` |
| Network request failures (404, 500, CORS) | `mcp__claude-in-chrome__read_network_requests` |
| Animated GIF of user interaction | `mcp__claude-in-chrome__gif_creator` |

See the `browser-use:hybrid-debugging` skill for combined Browser Use + claude-in-chrome workflows.

---

## 7. UI Debug Report Format

When reporting UI bugs, use this structured format:

```markdown
## UI Bug Report: [Component Name]

**URL**: https://app.example.com/page
**Viewport**: 1280x720 (desktop) / 375x812 (mobile)
**Detected Via**: screenshot + DOM inspection

### Issue
[One-line description of the visual bug]

### Evidence
- Screenshot before/after: [attached or described]
- DOM state: [relevant interactive_elements entries]
- HTML/CSS: [relevant HTML snippet with problematic classes/styles]

### Root Cause (Suspected)
[CSS property or DOM attribute that is causing the issue]

### Reproduction Steps
1. Navigate to [URL]
2. [Action that triggers the bug]
3. Observe: [what you see]
Expected: [what you should see]

### Recommended Fix
[Specific CSS property or DOM attribute change to investigate]
```
