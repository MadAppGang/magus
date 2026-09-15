---
name: ui-analyse
description: Reviews a UI screenshot — usability, WCAG, design-system consistency, design-vs-implementation diff. Prompting patterns, depth tiers and severity guidelines. Analysis only; pair with dev:frontend-implement to apply.
user-invocable: false
---

# UI Analysis Skill

## Overview

Patterns, checklists and templates for reviewing a UI visually. **Analysis only** —
to implement the improvements, use `dev:frontend-implement`.

## Getting the Image In Front of You

```
Read("screenshots/dashboard.png")
```

That is the whole mechanism. Claude Code renders a `.png`/`.jpg` into context as an
image, so you review the screen rather than its filename. **You are the vision
model.** There is no model to select, no catalog lookup, no API key, no encoding
step, and no "vision unavailable" fallback.

Read one image per call. Call it twice to hold a reference and an implementation side
by side — reference first, so "Image 1" and "Image 2" mean what the prompt says.

**There is no CLI path for handing claudish an image.** `claudish` has no `--image` flag,
and unknown flags pass straight through to `claude`, which has none either. An
`[Image: data:image/png;base64,…]` or `[Image: https://…]` reference typed into a prompt is
plain text — nothing decodes it, nothing fetches it. Either route returns a fluent,
confident review of a screen the model never saw, and reports no error while doing it.

Claudish *can* carry images — it converts image blocks to `image_url` for the provider, and
describes them via a vision proxy when the target model has no vision of its own. That path
runs through a **session** (see "A Second Opinion" below), where the spawned Claude Code
Reads the file.

## When to Use

- Reviewing screenshots, wireframes, or mockups
- Conducting accessibility audits
- Validating design system consistency
- Comparing an implementation against its design reference
- Analysing UI patterns and usability

## Relationship to Other Skills

| Skill | Purpose | Modifies Code? |
|-------|---------|----------------|
| designer:ui-analyse | Visual analysis, issue detection | No |
| dev:frontend-implement | Apply improvements from analysis | Yes |
| designer:ui-style-format | Style file specification | No |
| designer:design-references | Reference image management | No |

## Review Depth

Pick the tier before you start; it decides how much of the rest of this file applies.

| Tier | Roughly | Covers |
|---|---|---|
| **Quick** | 5 min | Can users complete the primary task? Any major accessibility barrier? Is the hierarchy clear? Do interactive elements look interactive? |
| **Standard** | 15 min | All ten Nielsen heuristics, key WCAG AA criteria, visual design quality, interaction design |
| **Comprehensive** | 30 min+ | Everything in Standard, plus a full WCAG AA audit, design-system consistency, competitive context, and user-flow mapping |

## Analysis Patterns

### Pattern 1: Usability Review

```markdown
Analyze this UI screenshot for usability issues.

**Focus Areas**:
1. Visual hierarchy - Is the most important content prominent?
2. Affordances - Do interactive elements look clickable/tappable?
3. Feedback - Is system status clearly communicated?
4. Consistency - Do similar elements behave similarly?
5. Error prevention - Are destructive actions guarded?

**Output Format**: for each issue —
- **Location**: Where in the UI
- **Issue**: What the problem is
- **Principle**: Which design principle it violates
- **Severity**: CRITICAL/HIGH/MEDIUM/LOW
- **Recommendation**: Specific fix
```

**Usage**: `Read(SCREENSHOT_PATH)`, then answer the prompt above.

### Pattern 2: WCAG Accessibility Audit

```markdown
Audit this UI for WCAG 2.1 AA compliance.

**Checklist**:
1. **Perceivable**
   - [ ] Text contrast >= 4.5:1 (WCAG 1.4.3)
   - [ ] Non-text contrast >= 3:1 (WCAG 1.4.11)
   - [ ] Information not conveyed by color alone (WCAG 1.4.1)
   - [ ] Text resizable to 200% (WCAG 1.4.4)

2. **Operable**
   - [ ] Keyboard accessible (WCAG 2.1.1)
   - [ ] No keyboard traps (WCAG 2.1.2)
   - [ ] Focus visible (WCAG 2.4.7)
   - [ ] Touch targets >= 44x44px (WCAG 2.5.5)

3. **Understandable**
   - [ ] Labels present for inputs (WCAG 3.3.2)
   - [ ] Error identification clear (WCAG 3.3.1)
   - [ ] Instructions available (WCAG 3.3.2)

4. **Robust**
   - [ ] Valid structure implied (headings, regions)

**Output Format**:
| Criterion | Status | Notes | Fix |
|-----------|--------|-------|-----|
| 1.4.3 | PASS/FAIL | Details | Recommendation |
```

**Usage**: `Read(SCREENSHOT_PATH)`, then answer the prompt above.

A screenshot shows you contrast, target size, focus rings and labelling. It does not
show you keyboard order or trap behaviour — mark those **not assessable from an
image** rather than guessing, and say what would be needed to check them.

### Pattern 3: Design System Consistency Check

```markdown
Compare this implementation against the design system.

**Validation Points**:
1. **Colors** - primary, secondary, accent; semantic (success, warning, error);
   background and surface
2. **Typography** - font family, size scale adherence, weight usage, line height
3. **Spacing** - margin scale (4, 8, 16, 24, 32, 48...), padding, gaps
4. **Components** - button variants (primary, secondary, ghost); input states
   (default, focus, error, disabled); card patterns
5. **Elevation** - shadow levels, border usage, layer hierarchy

**Output Format**:
| Element | Expected | Actual | Deviation |
|---------|----------|--------|-----------|
| Button BG | #2563EB | #3B82F6 | Wrong shade |
```

**Usage**: `Read(SCREENSHOT_PATH)`, plus the token source (`.claude/design-style.md`
or the theme file), then answer the prompt above.

For an audit of the *code* rather than the rendered screen — token-only styling, one
component library, variants over call-site restyling — use `/dev:design-system`
instead. It reads the source with a deterministic auditor and finds things no
screenshot can show.

### Pattern 4: Anti-AI Design Audit

```markdown
Analyze this UI for "AI-generated" patterns that should be avoided.

**Check for**:
1. Rigid symmetric grids (should be asymmetric)
2. Flat solid colors (should have gradients/texture)
3. Generic typography (should have dramatic hierarchy)
4. Static elements (should have micro-interactions)
5. Default Tailwind colors (should be bespoke palette)

**Output**: List violations with specific recommendations.
```

**Usage**: `Read(SCREENSHOT_PATH)`, then answer the prompt above.

### Pattern 5: Comparative Review (design vs implementation)

```markdown
Compare the implementation screenshot to the original design.

**Comparison Points**:
1. Layout and positioning accuracy
2. Color fidelity
3. Typography matching
4. Spacing precision
5. Component rendering
6. Responsive behavior (if multiple sizes supplied)

**Output Format**:
## Match Analysis

**Overall Fidelity**: X/10

### Exact Matches
- [elements that match perfectly]

### Deviations
| Element | Design | Implementation | Impact | Fix |
|---------|--------|----------------|--------|-----|
| CTA Button | #2563EB | #3B82F6 | Visual | Change to design color |

### Missing Elements
- [in the design, absent from the implementation]

### Extra Elements
- [in the implementation, absent from the design]
```

**Usage**: `Read(REFERENCE_PATH)` then `Read(IMPLEMENTATION_PATH)` — two calls, so
both images are in context at once. Read the reference first.

For a pixel-level diff with a numeric score, `designer:review` runs `compare.ts` first
and hands this pattern to an external vision model (`designer:review-services`,
Procedure A) to categorise what the diff found.

### Pattern 6: No Image Available (text-only)

There is no "vision provider unavailable" case. The only way to land here is that no
screenshot exists to read.

1. Note in output: "No screenshot supplied — visual verification not performed"
2. Proceed with text-based analysis if component code is available
3. Use code analysis to infer potential issues, and label them as inferred
4. Never describe what a screen looks like from its code alone

## Severity Guidelines

| Severity | User Impact | Examples | Action |
|----------|-------------|----------|--------|
| **CRITICAL** | Blocks task completion | Invisible submit button, broken flow | Fix immediately |
| **HIGH** | Major barrier | Fails WCAG AA, confusing navigation | Fix before release |
| **MEDIUM** | Noticeable friction | Inconsistent spacing, unclear labels | Fix in next sprint |
| **LOW** | Polish opportunity | Minor alignment, shade variance | Backlog |

## Output Format

```markdown
## UI Analysis Results

**Target**: {image_path}
**Depth**: {quick|standard|comprehensive}
**Date**: {timestamp}
**Score**: {X}/10

### Issues by Severity

#### CRITICAL
{issues or "None found"}

#### HIGH
{issues or "None found"}

#### MEDIUM
{issues or "None found"}

#### LOW
{issues or "None found"}

### Strengths
{positive observations}

### Recommendations
{actionable improvements}
```

## Who runs these prompts

- `designer:review` in single-image mode (`/designer:review <screenshot>`): Patterns 1
  and 2 at the chosen depth, answered by the external judge and written to
  `${OUTPUT_DIR}/summary.md`.
- `designer:review` in compare mode: Pattern 5, answered by the external judge after the
  pixel diff.
- `designer:ui` while creating: the checklist in its own agent file, then Patterns 1 and 2
  on the primary screen's screenshot as a self-check.

## Another vendor's eyes

By default the judging is done by a model other than the one running the agent. The
procedure — resolve the newest Gemini Pro (or the top GPT tier) live, write the image
paths into a brief, `team(mode="run")`, poll `status` until settled, read
`response-<slot>.md`, fall back to a local `Read` only when the judge fails and say so in
the header — is Procedure A of `designer:review-services`. It works from inside a
subagent because `team` is polled, not awaited on a channel. Point the brief at the
**path**; the child session reads it, and claudish carries the image block to the
provider.

## Best Practices

### DO
- `Read` the image before reviewing it — never review from the path alone
- Validate the image file exists before starting
- Cite a specific design principle for every issue
- Give actionable, specific recommendations
- Prioritise by severity (CRITICAL first)
- Say when something is not assessable from a static image

### DON'T
- Make code changes (that is `dev:frontend-implement`)
- Give vague aesthetic opinions ("looks bad")
- Overwhelm with LOW severity items
- Forget accessibility considerations
- Skip the principle citation
- Assume implementation details you have not seen
