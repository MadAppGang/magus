---
name: debug-ui
description: Visual UI debugging — screenshot capture and analysis, responsive layout checking at multiple viewport sizes, CSS validation via DOM state, visual regression detection, before/after state comparison. Trigger keywords - debug UI, visual bug, layout issue, responsive, screenshot, CSS, mobile view, broken layout, element overlap.
version: 1.0.0
tags: [debugging, ui, visual, css, responsive, screenshot, layout, regression, mobile, desktop]
keywords: [debug ui, visual bug, layout issue, responsive, screenshot, css, visual regression, broken layout, mobile view, desktop view, css validation, element position, overlap, overflow, hidden, z-index, viewport]
plugin: browser-use
updated: 2026-03-03
user-invocable: false
---

# UI Debugging Patterns

Patterns for detecting visual bugs, checking responsive layouts, validating CSS properties, and performing before/after visual comparisons using Browser Use's screenshot and DOM state tools.

---

## 1. Visual State Capture Workflow

The baseline pattern for any UI debugging task:

```
Step 1: Navigate to the page under investigation
  mcp__browser-use__browser_navigate(url="https://app.example.com/dashboard")
  → session_id: "debug_01"

Step 2: Capture visual state
  mcp__browser-use__browser_screenshot(session_id="debug_01")
  → base64 image — Claude can analyze this directly

Step 3: Inspect DOM state for element details
  mcp__browser-use__browser_get_state(session_id="debug_01")
  → selector_map with element positions, classes, attributes, text

Step 4: Get HTML for CSS/class inspection
  mcp__browser-use__browser_get_html(
    selector=".problematic-component",
    session_id="debug_01"
  )
  → raw HTML with class names, inline styles, data attributes

Step 5: Close session
  mcp__browser-use__browser_close_session(session_id="debug_01")
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

Test how the UI looks at different viewport widths. Browser Use does not support viewport resizing via a direct tool parameter, so use one of two approaches.

### 2.1 Multi-Session Approach (Recommended)

Open separate sessions with different browser configurations (different window sizes). Each session gets an independent Chromium instance.

```
# Desktop session
session_desktop = browser_navigate(url="https://app.example.com")["session_id"]
screenshot_desktop = browser_screenshot(session_id=session_desktop, full_page=True)

# Mobile session (simulate via JS before screenshot)
session_mobile = browser_navigate(url="https://app.example.com")["session_id"]
# Resize viewport via JS using retry_with_browser_use_agent
retry_with_browser_use_agent(
  task="Resize the viewport to 390x844 (iPhone 14 size) using window.resizeTo or meta viewport manipulation, then take a screenshot",
  session_id=session_mobile,
  max_steps=5
)
screenshot_mobile = browser_screenshot(session_id=session_mobile, full_page=True)

# Compare: Claude analyzes both screenshots
browser_close_session(session_id=session_desktop)
browser_close_session(session_id=session_mobile)
```

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

After taking screenshots at each breakpoint, look for:

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

Use `browser_get_state` and `browser_get_html` to inspect CSS classes, attributes, and computed styles without needing browser DevTools.

### 3.1 Find Elements by CSS Class

```
# Get HTML of a specific component to see its CSS classes and inline styles
browser_get_html(
  selector=".checkout-button",
  session_id=session_id
)
→ "<button class='checkout-button btn btn-primary disabled' style='opacity: 0.5;' disabled>Check Out</button>"
```

From this HTML you can detect:
- `disabled` attribute (button non-interactive)
- `opacity: 0.5` (intentionally dimmed, but should it be?)
- Unexpected extra class `disabled` (added by application state)

### 3.2 Find Hidden Elements

```
# Get full page HTML and search for hidden elements
browser_get_html(session_id=session_id)
→ scan for: display:none, visibility:hidden, opacity:0, height:0, overflow:hidden

# Or get DOM state and look for:
browser_get_state(session_id=session_id)
→ selector_map elements missing from expected positions may be hidden
```

### 3.3 Attribute Validation

From `browser_get_state`, the `selector_map` includes element attributes. Check for:

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
session_id = browser_navigate(url="https://app.example.com/cart")["session_id"]
screenshot_before = browser_screenshot(session_id=session_id, full_page=True)
# Analyze: Claude describes the visual state

# Apply action (e.g., add item to cart)
state = browser_get_state(session_id=session_id)
# Find "Add to Cart" button → index N
browser_click(index=N, session_id=session_id)

# AFTER state: capture changed state
screenshot_after = browser_screenshot(session_id=session_id, full_page=True)
# Analyze: Claude describes what changed

# Save screenshots to files for documentation
Bash: python3 -c "import base64; open('before.png','wb').write(base64.b64decode('<before_base64>'))"
Bash: python3 -c "import base64; open('after.png','wb').write(base64.b64decode('<after_base64>'))"

browser_close_session(session_id=session_id)
```

### 4.2 Visual Regression Baseline Pattern

For tracking regressions across deployments:

```
Step 1: Capture baseline (production/main branch)
  screenshot_prod = browser_screenshot(session_id=prod_session, full_page=True)
  → save as "baseline-homepage-2026-03-03.png"

Step 2: Capture candidate (staging/PR branch)
  screenshot_staging = browser_screenshot(session_id=staging_session, full_page=True)
  → save as "candidate-homepage-2026-03-03.png"

Step 3: Report differences
  Claude analyzes both screenshots and describes:
  - Layout changes
  - Color changes
  - Missing or new elements
  - Font/size changes
  - Spacing differences
```

**Limitation**: Browser Use cannot do pixel-level diff. Claude provides a descriptive comparison, not a numerical diff percentage. For automated CI regression testing with pixel diff, use Playwright + Percy or BackstopJS instead.

---

## 5. Common Visual Bug Patterns

### 5.1 Overlapping Elements (Z-Index Issues)

**Detection**:
```
# Screenshot reveals two elements occupying the same space
browser_screenshot(session_id)
# → Claude can see: tooltip covered by navbar, modal behind overlay, etc.

# Confirm via HTML: check z-index in inline styles or classes
browser_get_html(selector=".navbar, .tooltip", session_id)
→ look for z-index values, position:fixed, position:absolute
```

### 5.2 Text Overflow / Truncation

**Detection**:
```
# Screenshot shows "..." in unexpected places
browser_screenshot(session_id)

# Confirm via HTML: find overflow:hidden, white-space:nowrap, text-overflow:ellipsis
browser_get_html(selector=".product-title, .card-description", session_id)
```

### 5.3 Broken Flexbox/Grid Layout

**Detection**:
```
# Screenshot shows elements stacked that should be side-by-side, or vice versa
browser_screenshot(session_id)

# Confirm via HTML: check display:flex, display:grid, flex-direction, grid-template-columns
browser_get_html(selector=".product-grid, .card-container", session_id)
```

### 5.4 Missing Images / Broken Image Links

**Detection**:
```
# Get HTML and check img tags for broken src attributes
browser_get_html(selector="img", session_id)
→ look for: src="" (empty), src="/undefined", missing alt attributes
```

### 5.5 Button/Link Disabled State Not Visual

**Detection**:
```
# Button appears active but doesn't respond to clicks
browser_get_state(session_id)
# Check selector_map element attributes for: disabled, aria-disabled, tabindex="-1"

browser_get_html(selector="#checkout-btn", session_id)
# Check for: pointer-events:none, opacity:0.5 without disabled attr (just visually disabled)
```

---

## 6. When to Escalate to claude-in-chrome

Browser Use can detect visual bugs and inspect DOM/CSS. But some debugging signals require browser DevTools access, which is only available via claude-in-chrome (when available).

**Escalate to claude-in-chrome when you need**:

| Signal | Tool Required |
|--------|--------------|
| JavaScript console errors | `mcp__claude-in-chrome__read_console_messages` |
| Network request failures (404, 500, CORS) | `mcp__claude-in-chrome__read_network_requests` |
| React/Vue component state | `mcp__claude-in-chrome__javascript_tool` (run DevTools API) |
| Computed CSS (after all stylesheets applied) | `mcp__claude-in-chrome__javascript_tool` (getComputedStyle) |
| Event listener inspection | `mcp__claude-in-chrome__javascript_tool` |
| Performance timeline | `mcp__claude-in-chrome__javascript_tool` (PerformanceObserver) |
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
- DOM state: [relevant selector_map entries]
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
