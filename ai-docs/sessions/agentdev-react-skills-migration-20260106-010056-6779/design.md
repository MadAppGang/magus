# React.js and Browser Debugging Skills Migration Design

**Version:** 1.0.0
**Session:** agentdev-react-skills-migration-20260106-010056-6779
**Author:** agentdev:designer
**Date:** 2026-01-06

---

## Executive Summary

This document designs the migration of React.js development and browser debugging skills from the `frontend` plugin to the `dev` plugin. The key innovation is **replacing Chrome DevTools MCP with Chrome Extension tools** (`mcp__claude-in-chrome__*`), enabling browser debugging through Claude's native browser interface.

### Scope

**Skills to Migrate:**
- `browser-debugger` (930 lines) - CRITICAL: Full rewrite with Chrome Extension tools
- `react-patterns` (378 lines) - Enhance existing `react-typescript`
- `tanstack-router` (437 lines) - NEW skill for dev plugin
- `tanstack-query` (915 lines) - NEW skill for dev plugin
- `router-query-integration` (408 lines) - Merge into TanStack skills
- `shadcn-ui` (924 lines) - NEW skill for dev plugin
- `api-integration` (404 lines) - Merge into existing API patterns

**Skills NOT Migrated (Already Covered):**
- `core-principles` - Covered by `universal-patterns`
- `tooling-setup` - Covered by project-specific configs
- `performance-security` - Partially covered; add to React skill
- `claudish-usage` - Already in code-analysis plugin
- `ui-implementer` - Agent-specific, not needed as skill
- `api-spec-analyzer` - Agent-specific
- `dependency-check` - Agent-specific

### Key Design Decisions

1. **Option A Selected**: Enhance existing `react-typescript` + create modular skills
2. **Chrome Extension First**: All browser debugging uses `mcp__claude-in-chrome__*` tools
3. **Context Detection**: Skills load based on project detection
4. **Deduplication**: Avoid overlap with existing dev plugin content

---

## Part 1: Source Analysis

### Frontend Plugin Skills Summary

| Skill | Lines | Content Type | Migration Action |
|-------|-------|--------------|------------------|
| `browser-debugger` | 930 | Chrome DevTools MCP | REWRITE with Chrome Extension |
| `react-patterns` | 378 | React 19 patterns | MERGE into react-typescript |
| `tanstack-router` | 437 | Router patterns | NEW skill |
| `tanstack-query` | 915 | Query patterns | NEW skill |
| `router-query-integration` | 408 | Integration patterns | MERGE into TanStack skills |
| `shadcn-ui` | 924 | Component library | NEW skill |
| `api-integration` | 404 | API patterns | MERGE into existing |
| `core-principles` | 123 | Project structure | SKIP (covered) |
| `tooling-setup` | 202 | Tooling config | SKIP (project-specific) |
| `performance-security` | 415 | Perf/security | EXTRACT security section |

### Existing Dev Plugin Frontend Skills

| Skill | Lines | Coverage |
|-------|-------|----------|
| `react-typescript` | 411 | Basic React + TS patterns |
| `vue-typescript` | 411 | Vue 3 + TS patterns |
| `state-management` | 419 | Zustand, Pinia, TanStack Query basics |
| `testing-frontend` | 488 | Vitest, RTL, Vue Test Utils |

### Content Overlap Analysis

**Significant Overlap:**
- `react-typescript` (dev) vs `react-patterns` (frontend): 60% overlap
- `state-management` (dev) vs `tanstack-query` (frontend): 30% overlap
- `testing-frontend` (dev) covers frontend testing well

**Unique Content (Must Migrate):**
- Browser debugging with Chrome Extension (100% new)
- TanStack Router patterns (100% new)
- shadcn/ui patterns (100% new)
- Route loaders + Query prefetching (100% new)

---

## Part 2: Target Skill Structure

### Recommended Structure

```
plugins/dev/skills/
├── frontend/
│   ├── react-typescript/SKILL.md        # ENHANCED (merge react-patterns)
│   ├── vue-typescript/SKILL.md          # Unchanged
│   ├── state-management/SKILL.md        # Unchanged
│   ├── testing-frontend/SKILL.md        # Unchanged
│   ├── tanstack-router/SKILL.md         # NEW
│   ├── tanstack-query/SKILL.md          # NEW (merge router-query-integration)
│   ├── shadcn-ui/SKILL.md               # NEW
│   └── browser-debugging/SKILL.md       # NEW (Chrome Extension tools)
└── ...
```

### Context Detection Updates

Update `context-detection/SKILL.md` to load new skills:

```yaml
package.json:
  check: "dependencies.react exists"
  skills:
    - react-typescript
    - state-management
    - testing-frontend
  additional_checks:
    - check: "dependencies['@tanstack/react-router'] exists"
      skills: tanstack-router
    - check: "dependencies['@tanstack/react-query'] exists"
      skills: tanstack-query
    - check: "components.json exists OR dependencies['@radix-ui/*'] exists"
      skills: shadcn-ui
```

---

## Part 3: Browser Debugging Skill (Chrome Extension)

### Critical Tool Mapping

**DevTools MCP to Chrome Extension Translation:**

| DevTools MCP Tool | Chrome Extension Tool | Notes |
|-------------------|----------------------|-------|
| `mcp__chrome-devtools__navigate_page` | `mcp__claude-in-chrome__navigate` | URL navigation |
| `mcp__chrome-devtools__take_screenshot` | `mcp__claude-in-chrome__computer` | action: screenshot |
| `mcp__chrome-devtools__take_snapshot` | `mcp__claude-in-chrome__read_page` | DOM structure |
| `mcp__chrome-devtools__click` | `mcp__claude-in-chrome__computer` | action: left_click / click ref |
| `mcp__chrome-devtools__fill` | `mcp__claude-in-chrome__form_input` | Input filling |
| `mcp__chrome-devtools__fill_form` | `mcp__claude-in-chrome__form_input` | Multiple calls |
| `mcp__chrome-devtools__hover` | `mcp__claude-in-chrome__computer` | action: hover |
| `mcp__chrome-devtools__resize_page` | `mcp__claude-in-chrome__resize_window` | Viewport resize |
| `mcp__chrome-devtools__list_console_messages` | `mcp__claude-in-chrome__read_console_messages` | Console logs |
| `mcp__chrome-devtools__list_network_requests` | `mcp__claude-in-chrome__read_network_requests` | Network tab |
| `mcp__chrome-devtools__evaluate_script` | `mcp__claude-in-chrome__javascript_tool` | JS execution |
| `mcp__chrome-devtools__new_page` | `mcp__claude-in-chrome__tabs_create_mcp` | New tab |
| `mcp__chrome-devtools__list_pages` | `mcp__claude-in-chrome__tabs_context_mcp` | Tab listing |

**Chrome Extension Unique Features (NEW capabilities):**

| Tool | Purpose | Use Case |
|------|---------|----------|
| `mcp__claude-in-chrome__find` | Natural language element search | "Find the submit button" |
| `mcp__claude-in-chrome__get_page_text` | Extract all page text | Content verification |
| `mcp__claude-in-chrome__gif_creator` | Record interactions as GIF | Bug reproduction |
| `mcp__claude-in-chrome__upload_image` | Upload images to pages | Testing file uploads |
| `mcp__claude-in-chrome__shortcuts_list` | List available shortcuts | Keyboard testing |
| `mcp__claude-in-chrome__shortcuts_execute` | Execute shortcuts | Keyboard actions |

### Updated Recipe Structure

**Recipe 1: Agent Self-Validation (Updated)**

```markdown
## After Implementing UI Feature

1. **Save file changes** (Edit tool)

2. **Capture implementation screenshot**:
   ```
   mcp__claude-in-chrome__navigate(url: "http://localhost:5173/your-route")
   # Wait for page load
   mcp__claude-in-chrome__computer(action: "screenshot")
   ```

3. **Analyze with embedded Claude** (always available):
   - Describe what you see in the screenshot
   - Check for obvious layout issues
   - Verify expected elements are present

4. **Check console for errors**:
   ```
   mcp__claude-in-chrome__read_console_messages()
   # Filter for errors in response
   ```

5. **Check network for failures**:
   ```
   mcp__claude-in-chrome__read_network_requests()
   # Look for failed requests (status >= 400)
   ```

6. **Report results to orchestrator**
```

**Recipe 2: Design Fidelity Validation (Updated)**

```markdown
## Design Fidelity Check

### Step 1: Capture Implementation
```
mcp__claude-in-chrome__navigate(url: "http://localhost:5173/component")
mcp__claude-in-chrome__resize_window(width: 1440, height: 900)
mcp__claude-in-chrome__computer(action: "screenshot")
```

### Step 2: Visual Analysis with Vision Model
(Unchanged - uses claudish with external vision models)

### Step 3: Generate Fix Recommendations
(Unchanged)
```

**Recipe 3: Interactive Element Testing (Updated)**

```markdown
## Interactive Testing Flow

### Step 1: Get Page Structure
```
mcp__claude-in-chrome__read_page()
# Returns DOM structure with element references
```

### Step 2: Test Each Interactive Element

**Button Test**:
```
# Before
mcp__claude-in-chrome__computer(action: "screenshot")

# Find and click button (natural language)
mcp__claude-in-chrome__find(description: "submit button")
mcp__claude-in-chrome__computer(action: "left_click", coordinate: [x, y])

# OR click by reference
mcp__claude-in-chrome__computer(action: "click", ref: "button[type=submit]")

# After (wait for response)
# Wait a moment for response
mcp__claude-in-chrome__computer(action: "screenshot")

# Check results
mcp__claude-in-chrome__read_console_messages()
mcp__claude-in-chrome__read_network_requests()
```

**Form Test**:
```
# Fill form fields
mcp__claude-in-chrome__form_input(
  selector: "#email",
  value: "test@example.com"
)
mcp__claude-in-chrome__form_input(
  selector: "#password",
  value: "SecurePass123!"
)

# Submit (click button)
mcp__claude-in-chrome__find(description: "submit button")
mcp__claude-in-chrome__computer(action: "left_click", coordinate: [x, y])

# Verify success
mcp__claude-in-chrome__read_page()
# Check for success indicators
```

**Hover State Test**:
```
mcp__claude-in-chrome__computer(action: "screenshot")
mcp__claude-in-chrome__find(description: "primary button")
mcp__claude-in-chrome__computer(action: "hover", coordinate: [x, y])
mcp__claude-in-chrome__computer(action: "screenshot")
# Compare screenshots for hover state changes
```
```

**Recipe 4: Responsive Design Validation (Updated)**

```markdown
## Responsive Testing

### Breakpoints to Test

| Breakpoint | Width | Description |
|------------|-------|-------------|
| Mobile | 375px | iPhone SE |
| Mobile L | 428px | iPhone 14 Pro Max |
| Tablet | 768px | iPad |
| Desktop | 1280px | Laptop |
| Desktop L | 1920px | Full HD |

### Automated Responsive Check

```bash
#!/bin/bash
# Test all breakpoints

BREAKPOINTS=(375 428 768 1280 1920)
URL="http://localhost:5173/your-route"

for width in "${BREAKPOINTS[@]}"; do
  echo "Testing ${width}px..."

  # Navigate (once)
  mcp__claude-in-chrome__navigate(url: "$URL")

  # Resize and screenshot
  mcp__claude-in-chrome__resize_window(width: $width, height: 900)
  mcp__claude-in-chrome__computer(action: "screenshot")
  # Save/analyze screenshot
done
```
```

**Recipe 5: Accessibility Validation (Updated)**

```markdown
## Accessibility Check

### Automated A11y Testing

```
# Get full page content for accessibility tree analysis
mcp__claude-in-chrome__read_page()

# Get all text content
mcp__claude-in-chrome__get_page_text()

# Check for common issues:
# - Missing alt text (look for img without alt in read_page)
# - Missing ARIA labels
# - Incorrect heading hierarchy
# - Missing form labels
```

### Visual Contrast Analysis

(Unchanged - uses claudish with vision models)
```

**Recipe 6: Console and Network Debugging (Updated)**

```markdown
## Debug Session

### Real-Time Console Monitoring

```
# Get all console messages
mcp__claude-in-chrome__read_console_messages()

# Response includes:
# - Type (log, warn, error, info)
# - Message content
# - Timestamp
# - Stack trace (for errors)
```

### Network Request Analysis

```
# Get all network requests
mcp__claude-in-chrome__read_network_requests()

# Response includes:
# - URL
# - Method (GET, POST, etc.)
# - Status code
# - Response time
# - Request/response headers
# - Request/response body (if available)
```
```

### Quick Reference: Chrome Extension Tools

```markdown
## Quick Reference: Claude-in-Chrome MCP Tools

### Navigation
- `navigate(url)` - Load URL in current tab
- `tabs_create_mcp(url)` - Open new tab
- `tabs_context_mcp()` - List all tabs

### Inspection
- `read_page()` - Get DOM structure with element references
- `get_page_text()` - Extract all visible text
- `computer(action: "screenshot")` - Capture visual state

### Interaction
- `computer(action: "left_click", coordinate: [x, y])` - Click at coordinates
- `computer(action: "click", ref: "selector")` - Click by CSS selector
- `computer(action: "hover", coordinate: [x, y])` - Hover at coordinates
- `form_input(selector, value)` - Fill input field
- `computer(action: "type", text: "...")` - Type text
- `computer(action: "key", key: "Enter")` - Press key

### Console & Network
- `read_console_messages()` - Get console output
- `read_network_requests()` - Get network activity

### Advanced
- `javascript_tool(script)` - Execute JavaScript in page
- `resize_window(width, height)` - Change viewport size
- `find(description)` - Find element by natural language
- `gif_creator(start/stop)` - Record interactions as GIF
- `upload_image(selector, imagePath)` - Upload image file
- `shortcuts_list()` - List keyboard shortcuts
- `shortcuts_execute(shortcut)` - Execute keyboard shortcut
```

---

## Part 4: React Skills Enhancement

### Enhanced react-typescript/SKILL.md

**Additions from frontend plugin:**

1. **React 19 Features Section**
   - use() hook for promises and context
   - React Compiler patterns
   - Server Actions (for RSC-aware apps)
   - Suspense improvements
   - useOptimistic hook
   - useFormStatus hook

2. **React Compiler Patterns**
   - Compiler-friendly code patterns
   - What to avoid (mutations, side effects in render)
   - Verification with DevTools (Memo badge)

3. **Performance Optimization**
   - Code-splitting with lazy()
   - Route-level lazy loading
   - Image optimization patterns

4. **Security Best Practices**
   - XSS prevention
   - dangerouslySetInnerHTML sanitization
   - Environment variable handling

### New tanstack-router/SKILL.md

**Content (from frontend plugin):**
- File-based routing setup
- Route types and configuration
- Link component patterns
- Navigation hooks (useNavigate, useParams, etc.)
- Search params with Zod validation
- Nested routes and layouts
- Route loaders (basics - details in tanstack-query)
- Preloading strategies

### New tanstack-query/SKILL.md

**Content (merged from tanstack-query + router-query-integration):**
- Query basics (useQuery, useMutation)
- Query keys factory pattern
- Query options pattern (recommended)
- Stale time and cache management
- Route loaders with ensureQueryData
- Prefetch vs ensure vs fetch
- Optimistic updates
- Parallel queries in loaders
- Dependent queries
- Mutation with cache invalidation
- DevTools setup

### New shadcn-ui/SKILL.md

**Content (from frontend plugin):**
- CLI usage (init, add, diff)
- Configuration (components.json)
- Installation per framework
- Component categories and URLs
- Common patterns (forms, data tables)
- cn() utility usage
- Theming with CSS variables
- Dark mode setup
- Integration with React Hook Form + Zod

---

## Part 5: Migration Checklist

### Phase 1: Skill Files

- [ ] Create `browser-debugging/SKILL.md` with Chrome Extension tools
- [ ] Enhance `react-typescript/SKILL.md` with React 19 patterns
- [ ] Create `tanstack-router/SKILL.md`
- [ ] Create `tanstack-query/SKILL.md` (with router integration)
- [ ] Create `shadcn-ui/SKILL.md`

### Phase 2: Context Detection

- [ ] Update `context-detection/SKILL.md` with new skill triggers
- [ ] Add TanStack Router detection
- [ ] Add TanStack Query detection
- [ ] Add shadcn/ui detection

### Phase 3: Agent Updates

- [ ] Update `developer.md` to reference new skills
- [ ] Update `debugger.md` to use Chrome Extension tools
- [ ] Update `ui.md` to reference shadcn-ui skill

### Phase 4: Testing

- [ ] Verify browser debugging recipes work with Chrome Extension
- [ ] Test skill loading with different project configurations
- [ ] Validate no content duplication

---

## Part 6: Risk Assessment

### High Risk

| Risk | Mitigation |
|------|------------|
| Chrome Extension tools may differ from DevTools MCP | Document differences clearly; provide fallback patterns |
| Tool availability (extension not installed) | Add prerequisite checks; graceful degradation |
| Breaking changes in tool names/parameters | Pin to specific tool versions; document changes |

### Medium Risk

| Risk | Mitigation |
|------|------------|
| Content overlap causing confusion | Clear skill descriptions; deduplication review |
| Context detection false positives | Multiple detection signals; user override option |
| Skill file too large (> 1000 lines) | Split into focused sub-skills if needed |

### Low Risk

| Risk | Mitigation |
|------|------------|
| Missing patterns from frontend plugin | Review after migration; add incrementally |
| Version drift between plugins | Document source version; sync periodically |

---

## Part 7: File Size Estimates

| New Skill | Estimated Lines | Source |
|-----------|-----------------|--------|
| `browser-debugging/SKILL.md` | ~800 | Rewrite of browser-debugger (930) |
| `react-typescript/SKILL.md` | ~600 | Current (411) + react-patterns additions |
| `tanstack-router/SKILL.md` | ~450 | tanstack-router (437) |
| `tanstack-query/SKILL.md` | ~700 | tanstack-query (915) + router integration (408) merged |
| `shadcn-ui/SKILL.md` | ~600 | shadcn-ui (924) condensed |

**Total New Content:** ~3,150 lines
**Total Removed (from frontend if replaced):** ~4,396 lines
**Net Change:** More concise, focused skills

---

## Part 8: Implementation Notes

### Browser Debugging: Key Differences

**What Changes:**
1. Tool names: `mcp__chrome-devtools__*` becomes `mcp__claude-in-chrome__*`
2. Element selection: UID-based becomes coordinate/selector/ref-based
3. Screenshot: Direct file path becomes in-memory capture
4. Wait operations: Explicit waits become checking after action

**What Stays the Same:**
1. Visual analysis with external models (claudish)
2. Model selection flow (user chooses vision model)
3. Validation recipes structure (6 recipes)
4. Agent integration patterns

### React Patterns: Enhancement Strategy

**Add, Don't Duplicate:**
1. React 19 section: NEW content
2. Compiler patterns: NEW content
3. Performance: ADD to existing
4. Security: ADD to existing
5. Basic patterns: KEEP existing (already good)

### TanStack Skills: Merge Strategy

**tanstack-query absorbs router-query-integration:**
- Route loaders section in tanstack-query
- Query options pattern is the bridge
- ensureQueryData examples
- Parallel prefetching patterns

---

## Appendix A: Chrome Extension Tool Parameters

### navigate

```typescript
mcp__claude-in-chrome__navigate({
  url: string  // Full URL to navigate to
})
```

### read_page

```typescript
mcp__claude-in-chrome__read_page()
// Returns: DOM structure with element references
```

### computer

```typescript
mcp__claude-in-chrome__computer({
  action: "screenshot" | "left_click" | "right_click" | "double_click" |
          "hover" | "click" | "type" | "key" | "scroll",
  coordinate?: [x: number, y: number],
  ref?: string,  // CSS selector for click action
  text?: string, // For type action
  key?: string   // For key action (e.g., "Enter", "Escape")
})
```

### form_input

```typescript
mcp__claude-in-chrome__form_input({
  selector: string,  // CSS selector
  value: string      // Value to input
})
```

### find

```typescript
mcp__claude-in-chrome__find({
  description: string  // Natural language description
})
// Returns: Element info with coordinates
```

### resize_window

```typescript
mcp__claude-in-chrome__resize_window({
  width: number,
  height: number
})
```

### read_console_messages

```typescript
mcp__claude-in-chrome__read_console_messages()
// Returns: Array of console messages with type, content, timestamp
```

### read_network_requests

```typescript
mcp__claude-in-chrome__read_network_requests()
// Returns: Array of network requests with URL, method, status, timing
```

### javascript_tool

```typescript
mcp__claude-in-chrome__javascript_tool({
  script: string  // JavaScript to execute
})
// Returns: Execution result
```

### tabs_create_mcp

```typescript
mcp__claude-in-chrome__tabs_create_mcp({
  url?: string  // URL for new tab (optional)
})
```

### tabs_context_mcp

```typescript
mcp__claude-in-chrome__tabs_context_mcp()
// Returns: Array of open tabs with URLs and titles
```

---

## Appendix B: Decision Record

### Decision 1: Skill Structure

**Question:** How to organize migrated skills?

**Options:**
- A: Enhance existing + create new modular skills
- B: Create role-specific skills (react-core, react-tanstack, etc.)
- C: Merge all React content into one comprehensive skill

**Selected:** Option A

**Rationale:**
- Maintains backward compatibility
- Allows incremental loading
- Matches context detection patterns
- Avoids massive skill files

### Decision 2: Browser Debugging Approach

**Question:** How to handle Chrome Extension vs DevTools MCP?

**Options:**
- A: Parallel support (detect which is available)
- B: Chrome Extension only
- C: DevTools MCP only (keep current)

**Selected:** Option B (Chrome Extension only)

**Rationale:**
- Chrome Extension is the new standard
- DevTools MCP being deprecated
- Simpler maintenance
- Better integration with Claude

### Decision 3: Content Deduplication

**Question:** How to handle overlapping content?

**Approach:**
1. Check existing dev plugin skill first
2. Only add genuinely new content
3. Reference rather than duplicate
4. Update existing when enhancement is needed

---

*End of Design Document*
