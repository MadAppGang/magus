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

> **Correction (2026-08-14).** This skill previously documented three ways to hand an
> image to claudish, one of them labelled *Recommended*. **All three were fiction:**
>
> | Method | Why it never worked |
> |---|---|
> | `claudish --model X --image PATH` | `claudish --help` (7.48.0) has no `--image`. Unknown flags pass through to `claude`, which has none either. |
> | `[Image: data:image/png;base64,…]` in the prompt | A data URI typed into a text prompt is text. Nothing decodes it, and it burns the context window doing nothing. |
> | `[Image: https://…]` in the prompt | A URL typed into a text prompt is text. Nothing fetches it. |
>
> Each produced a fluent, confident review of a screen the model never saw — worse
> than an error, because nothing reported it. These files were where the rest of the
> designer plugin copied the pattern from. Do not restore any of them.
>
> Claudish *can* carry images — it converts image blocks to `image_url` for the
> provider, and describes them via a vision proxy when the target model has no vision
> of its own. But that path runs through a **session** (see "A Second Opinion"
> below), where the spawned Claude Code Reads the file. It is not reachable from a
> CLI flag or from prompt text.

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

For a pixel-level diff with a numeric score, `designer:design-review` runs
`compare.ts` first and uses this pattern to categorise what the diff found.

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

## Integration with /designer:ui Command

The `/designer:ui` command uses this skill when:
1. The user requests analysis only ("review", "audit", "check")
2. An image is supplied with no implementation request
3. As the first step before `dev:frontend-implement`

### Intent Triggers for Analysis

**Primary triggers**: review, analyze, analyse, audit, check, evaluate, assess,
score, inspect, critique, rate, examine

**Pattern triggers**: "what's wrong with", "problems with", "issues with",
"accessibility", "usability", "wcag"

### Workflow Integration

1. Command detects analysis intent
2. Resolves the screenshot path and confirms the file exists
3. `Read`s the screenshot and runs the analysis at the chosen depth
4. Writes the review to `${SESSION_PATH}/reviews/design-review/ui.md`
5. Presents a summary to the user

## A Second Opinion (another vendor's eyes)

Wanting a different model to look at the same screen is legitimate, and it needs a
**session** rather than a one-shot prompt — the spawned Claude Code has a `Read`
tool, and that is what puts the image in front of the other model:

```
create_session(model="{resolved from list_models}",
  prompt="Read screenshots/dashboard.png and review it for usability and
          accessibility. Write your review to:
          ${SESSION_PATH}/reviews/design-review/{model}.md",
  timeout_seconds=300)
```

Point the prompt at the **path**; the session reads it. Claudish converts the
resulting image block for the provider, and falls back to a vision proxy that
describes the image when the target model has no vision of its own.

This gives you parallel reviewers, consensus on which issues are real, and different
perspectives on the same screen.

**Dispatch it from a command, never from inside a subagent** — a subagent has no
channel back from an external session.

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
