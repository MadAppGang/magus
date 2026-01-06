# UI Designer Enhancement: Design References System

**Session**: agentdev-design-references-20260105-221331-7ea4
**Type**: Enhancement Design
**Target Plugin**: plugins/orchestration/
**Author**: Agent Designer
**Date**: 2026-01-05
**Plugin Version**: 0.9.0 → 0.10.0

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-05 | 1.1.0 | Applied consolidated review feedback (6 fixes) |

### Fixes Applied from Plan Review

| Issue | Status | Fix Applied |
|-------|--------|-------------|
| YAML skills array format | FIXED | Changed to array format `skills: [orchestration:design-references]` |
| Cross-session pattern tracking | FIXED | Clarified 3+ threshold applies WITHIN SINGLE REVIEW SESSION only |
| Bash script logic errors | FIXED | Replaced awk with Read tool + proper Markdown parsing |
| Plugin.json registration missing | FIXED | Added explicit JSON structure in Section 6 |
| HTML entity `&lt;` | FIXED | Replaced with `<` in quality gate text |
| Version bump missing | FIXED | Added version 0.9.0 → 0.10.0 in header and Section 6 |

---

## Executive Summary

This design document describes a comprehensive enhancement to the UI Designer capability in the orchestration plugin, introducing:

1. **Predefined Design References Skill** - Curated design system references (Material Design 3, Apple HIG, Tailwind UI, Ant Design, Shadcn/ui)
2. **Create-Style Command** (`/create-style`) - Interactive wizard for creating custom project design styles
3. **Feedback Loop Integration** - Learn from reviews and update project style automatically
4. **Updated ui-designer Agent** - Style detection, preference hierarchy, and feedback capabilities

---

## Table of Contents

1. [New Skill: design-references](#1-new-skill-design-references)
2. [New Command: create-style](#2-new-command-create-style)
3. [Project Style File Format](#3-project-style-file-format)
4. [Updated ui-designer Agent](#4-updated-ui-designer-agent)
5. [Updated ui-design-review Skill](#5-updated-ui-design-review-skill)
6. [Implementation Roadmap](#6-implementation-roadmap)

---

## 1. New Skill: design-references

**Location**: `plugins/orchestration/skills/design-references/SKILL.md`

### Skill Frontmatter

```yaml
---
name: design-references
version: 1.0.0
description: |
  Predefined design system references for UI reviews. Includes Material Design 3,
  Apple Human Interface Guidelines, Tailwind UI, Ant Design, and Shadcn/ui.
  Use when conducting design reviews against established design systems.
---
```

### Skill Content Structure

```markdown
# Design References Skill

## Overview

This skill provides predefined design system references that the ui-designer agent
can use when reviewing designs. Each reference includes design principles, color
guidelines, typography rules, spacing patterns, and component patterns.

## Available Design Systems

### Material Design 3 (Google)

**Reference ID**: `material-3`
**Official URL**: https://m3.material.io/

#### Design Principles

1. **Adaptive & Accessible** - Responsive across devices, accessible to all
2. **Personal & Customizable** - Dynamic color, personalization
3. **Expressive** - Motion, shape, and color express brand

#### Color System

- **Dynamic Color** - Colors derived from user wallpaper or brand
- **Tonal Palettes** - 13 tones per color (0-100)
- **Color Roles**:
  - Primary: Main brand color
  - Secondary: Accent elements
  - Tertiary: Contrast and balance
  - Error: Destructive actions
  - Surface: Backgrounds and containers
  - On-*: Text/icon colors on surfaces

**Key Metrics**:
- Text contrast: 4.5:1 minimum (WCAG AA)
- Large text contrast: 3:1 minimum
- Non-text contrast: 3:1 minimum

#### Typography

**Type Scale** (Default):
| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Display Large | 57sp | 400 | 64sp |
| Display Medium | 45sp | 400 | 52sp |
| Display Small | 36sp | 400 | 44sp |
| Headline Large | 32sp | 400 | 40sp |
| Headline Medium | 28sp | 400 | 36sp |
| Headline Small | 24sp | 400 | 32sp |
| Title Large | 22sp | 400 | 28sp |
| Title Medium | 16sp | 500 | 24sp |
| Title Small | 14sp | 500 | 20sp |
| Body Large | 16sp | 400 | 24sp |
| Body Medium | 14sp | 400 | 20sp |
| Body Small | 12sp | 400 | 16sp |
| Label Large | 14sp | 500 | 20sp |
| Label Medium | 12sp | 500 | 16sp |
| Label Small | 11sp | 500 | 16sp |

**Font**: Roboto (sans-serif)

#### Spacing

**Baseline Grid**: 4dp
**Common Values**: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128

#### Component Patterns

- **Buttons**: Filled, Outlined, Text, Elevated, Tonal
- **Cards**: Elevated, Filled, Outlined
- **Navigation**: Rail, Bar, Drawer
- **Inputs**: Filled, Outlined
- **Dialogs**: Basic, Full-screen, Date picker

#### Review Checklist

- [ ] Dynamic color theming applied correctly
- [ ] Type scale follows M3 specs
- [ ] 4dp baseline grid followed
- [ ] Touch targets minimum 48dp
- [ ] Elevation levels correct (0-5)
- [ ] Shape scale appropriate (Extra small to Extra large)

---

### Apple Human Interface Guidelines (iOS/macOS)

**Reference ID**: `apple-hig`
**Official URL**: https://developer.apple.com/design/human-interface-guidelines/

#### Design Principles

1. **Clarity** - Text readable, icons precise, ornaments subtle
2. **Deference** - Content over chrome, minimal UI
3. **Depth** - Visual layers, motion conveys hierarchy

#### Color System

**System Colors**:
| Color | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| Blue | #007AFF | #0A84FF | Links, interactive elements |
| Green | #34C759 | #30D158 | Success, positive actions |
| Indigo | #5856D6 | #5E5CE6 | Accent |
| Orange | #FF9500 | #FF9F0A | Warnings, attention |
| Pink | #FF2D55 | #FF375F | Accent |
| Purple | #AF52DE | #BF5AF2 | Accent |
| Red | #FF3B30 | #FF453A | Destructive, errors |
| Teal | #5AC8FA | #64D2FF | Accent |
| Yellow | #FFCC00 | #FFD60A | Warnings |

**Semantic Colors**:
- Label (Primary, Secondary, Tertiary, Quaternary)
- Fill (Primary through Quaternary)
- Background (Primary, Secondary, Tertiary)
- Separator

#### Typography

**SF Pro** (San Francisco):
| Style | Size | Weight | Leading |
|-------|------|--------|---------|
| Large Title | 34pt | Bold | 41pt |
| Title 1 | 28pt | Regular | 34pt |
| Title 2 | 22pt | Regular | 28pt |
| Title 3 | 20pt | Regular | 25pt |
| Headline | 17pt | Semi-Bold | 22pt |
| Body | 17pt | Regular | 22pt |
| Callout | 16pt | Regular | 21pt |
| Subheadline | 15pt | Regular | 20pt |
| Footnote | 13pt | Regular | 18pt |
| Caption 1 | 12pt | Regular | 16pt |
| Caption 2 | 11pt | Regular | 13pt |

#### Spacing

**iOS Standard Margins**: 16pt (compact), 20pt (regular)
**macOS Standard Margins**: 20pt

#### Component Patterns

- **Navigation**: Tab Bar, Sidebar, Navigation Bar
- **Buttons**: System, Custom, Icon-only
- **Lists**: Plain, Grouped, Inset Grouped
- **Forms**: Grouped sections with headers

#### Review Checklist

- [ ] SF Pro or SF Mono fonts used
- [ ] System colors or semantically appropriate custom colors
- [ ] Touch targets minimum 44pt x 44pt
- [ ] Standard margins respected
- [ ] Navigation patterns match platform conventions
- [ ] Dark mode support with proper semantic colors

---

### Tailwind UI

**Reference ID**: `tailwind-ui`
**Official URL**: https://tailwindui.com/

#### Design Principles

1. **Utility-First** - Compose styles from atomic classes
2. **Responsive** - Mobile-first, breakpoint prefixes
3. **Consistent** - Design tokens as class names

#### Color System

**Tailwind Colors** (50-950 shades):
- Slate, Gray, Zinc, Neutral, Stone (Grays)
- Red, Orange, Amber, Yellow (Warm)
- Lime, Green, Emerald, Teal (Cool greens)
- Cyan, Sky, Blue, Indigo, Violet, Purple, Fuchsia, Pink, Rose

**Usage Patterns**:
- Primary: `blue-600` (buttons, links)
- Secondary: `gray-600` (secondary text)
- Success: `green-600`
- Warning: `amber-600`
- Error: `red-600`
- Background: `white` / `gray-50`
- Surface: `gray-100` / `gray-800`

#### Typography

**Font Scale**:
| Class | Size | Line Height |
|-------|------|-------------|
| text-xs | 12px | 16px |
| text-sm | 14px | 20px |
| text-base | 16px | 24px |
| text-lg | 18px | 28px |
| text-xl | 20px | 28px |
| text-2xl | 24px | 32px |
| text-3xl | 30px | 36px |
| text-4xl | 36px | 40px |
| text-5xl | 48px | 48px |
| text-6xl | 60px | 60px |
| text-7xl | 72px | 72px |
| text-8xl | 96px | 96px |
| text-9xl | 128px | 128px |

**Font Weights**: thin(100) to black(900)

#### Spacing Scale

| Class | Value |
|-------|-------|
| 0 | 0px |
| px | 1px |
| 0.5 | 2px |
| 1 | 4px |
| 2 | 8px |
| 3 | 12px |
| 4 | 16px |
| 5 | 20px |
| 6 | 24px |
| 8 | 32px |
| 10 | 40px |
| 12 | 48px |
| 16 | 64px |
| 20 | 80px |
| 24 | 96px |

#### Component Patterns

- **Buttons**: Primary, Secondary, Soft, Outline
- **Forms**: Stacked, Inline, with validation states
- **Cards**: Simple, with header, with footer
- **Navigation**: Navbar, Sidebar, Tabs

#### Review Checklist

- [ ] Spacing uses Tailwind scale (4px base)
- [ ] Typography uses Tailwind type scale
- [ ] Colors from Tailwind palette
- [ ] Consistent hover/focus states
- [ ] Responsive breakpoints (sm, md, lg, xl, 2xl)
- [ ] Dark mode with `dark:` variants

---

### Ant Design

**Reference ID**: `ant-design`
**Official URL**: https://ant.design/

#### Design Principles

1. **Natural** - Align with user mental models
2. **Certain** - Predictable, consistent behavior
3. **Meaningful** - Purpose-driven design
4. **Growing** - Support user skill progression

#### Color System

**Functional Colors**:
| Role | Hex | Usage |
|------|-----|-------|
| Primary | #1677ff | Brand, primary actions |
| Success | #52c41a | Positive feedback |
| Warning | #faad14 | Warnings, attention |
| Error | #ff4d4f | Errors, destructive |
| Info | #1677ff | Informational |

**Neutral Colors**: 13 shades of gray (#fff to #000)

#### Typography

**Font Family**: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue

| Role | Size | Weight |
|------|------|--------|
| h1 | 38px | 600 |
| h2 | 30px | 600 |
| h3 | 24px | 600 |
| h4 | 20px | 600 |
| h5 | 16px | 600 |
| Base | 14px | 400 |
| Small | 12px | 400 |

#### Spacing

**Base Unit**: 4px
**Scale**: 4, 8, 12, 16, 20, 24, 32, 40, 48

#### Component Patterns

- **Forms**: Horizontal, Vertical, Inline layouts
- **Tables**: Sortable, Filterable, Paginated
- **Modals**: Confirm, Info, with footer
- **Data Entry**: Extensive input types

#### Review Checklist

- [ ] 14px base font size
- [ ] 4px spacing base unit
- [ ] Functional colors for feedback
- [ ] Form layouts consistent
- [ ] Table patterns for data display
- [ ] Enterprise-grade density (compact option)

---

### Shadcn/ui

**Reference ID**: `shadcn-ui`
**Official URL**: https://ui.shadcn.com/

#### Design Principles

1. **Copy-Paste** - Components you own, not import
2. **Accessible** - Built on Radix UI primitives
3. **Customizable** - CSS variables for theming
4. **Composable** - Small, focused components

#### Color System

**CSS Variables Based**:
```css
--background: 0 0% 100%;
--foreground: 240 10% 3.9%;
--card: 0 0% 100%;
--card-foreground: 240 10% 3.9%;
--popover: 0 0% 100%;
--popover-foreground: 240 10% 3.9%;
--primary: 240 5.9% 10%;
--primary-foreground: 0 0% 98%;
--secondary: 240 4.8% 95.9%;
--secondary-foreground: 240 5.9% 10%;
--muted: 240 4.8% 95.9%;
--muted-foreground: 240 3.8% 46.1%;
--accent: 240 4.8% 95.9%;
--accent-foreground: 240 5.9% 10%;
--destructive: 0 84.2% 60.2%;
--destructive-foreground: 0 0% 98%;
--border: 240 5.9% 90%;
--input: 240 5.9% 90%;
--ring: 240 5.9% 10%;
--radius: 0.5rem;
```

#### Typography

**Inter** (default) or system font stack

| Variant | Size | Weight | Leading |
|---------|------|--------|---------|
| h1 | 36px | 800 | 40px |
| h2 | 30px | 600 | 36px |
| h3 | 24px | 600 | 32px |
| h4 | 20px | 600 | 28px |
| p | 16px | 400 | 28px |
| lead | 20px | 400 | 28px |
| large | 18px | 600 | 28px |
| small | 14px | 500 | 20px |
| muted | 14px | 400 | 20px |

#### Spacing

**Tailwind-based**: 4px base (matches Tailwind scale)

#### Component Patterns

- **Buttons**: Default, Secondary, Destructive, Outline, Ghost, Link
- **Forms**: Built on Radix primitives
- **Dialogs**: AlertDialog, Dialog, Sheet
- **Data Display**: Table, DataTable, Cards

#### Review Checklist

- [ ] CSS variables for theming
- [ ] Radix UI primitives for accessibility
- [ ] Border radius using --radius variable
- [ ] Focus rings using --ring variable
- [ ] Consistent variant naming
- [ ] Dark mode via class strategy

---

## Usage in Reviews

### Selecting a Design Reference

The ui-designer agent will check for style in this order:

1. **Project Style** (`.claude/design-style.md`) - Highest priority
2. **Predefined Reference** (via `--style` flag or user selection)
3. **Auto-detect** (if recognizable patterns found)
4. **Generic Best Practices** (fallback)

### Review with Specific Reference

```
Task: ui-designer

Review this dashboard screenshot against Material Design 3 guidelines.

Design Reference: material-3

Image: screenshots/dashboard.png

Write review to: ${SESSION_PATH}/reviews/design-review/gemini.md
```

### Combining Project Style + Reference

```
Task: ui-designer

Review using:
- Project Style: .claude/design-style.md (brand colors, custom tokens)
- Base Reference: shadcn-ui (component patterns, accessibility)

Image: screenshots/form.png
```
```

---

## 2. New Command: create-style

**Location**: `plugins/orchestration/commands/create-style.md`

### Command Frontmatter

```yaml
---
description: |
  Interactive wizard to create a custom project design style guide. Stores
  the style in .claude/design-style.md for automatic use by ui-designer agent.

  Workflow: SELECT BASE -> CUSTOMIZE COLORS -> TYPOGRAPHY -> SPACING -> PATTERNS -> SAVE
allowed-tools: Task, AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
skills:
  - orchestration:design-references
---
```

### Command Structure

```xml
<role>
  <identity>Design Style Wizard</identity>

  <expertise>
    - Interactive design system configuration
    - Brand color extraction and validation
    - Typography system setup
    - Spacing and layout pattern definition
    - Component pattern documentation
  </expertise>

  <mission>
    Guide users through creating a custom project design style that the
    ui-designer agent will automatically detect and use for all future
    reviews. Make the process simple while capturing comprehensive
    design decisions.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <critical_constraints>
    <implementer_role>
      You are an IMPLEMENTER that creates the design style file.

      **You MUST:**
      - Use AskUserQuestion for all user input gates
      - Use Write to create .claude/design-style.md
      - Use Read to check for existing style file
      - Use TodoWrite to track wizard progress

      **You MUST NOT:**
      - Use Task tool (this is not an orchestrator)
      - Modify any source code files
      - Make assumptions about user preferences
    </implementer_role>

    <todowrite_requirement>
      Track wizard progress through phases:
      1. Check existing style
      2. Select base reference
      3. Define brand colors
      4. Configure typography
      5. Set spacing scale
      6. Document component patterns
      7. Add dos and donts
      8. Save style file
    </todowrite_requirement>
  </critical_constraints>

  <workflow>
    <phase number="1" name="Initialization">
      <objective>Check for existing style and initialize wizard</objective>

      <steps>
        <step>Check if .claude/design-style.md exists</step>
        <step>If exists, ask: Update existing or create new?</step>
        <step>If updating, read existing file as base</step>
        <step>Initialize TodoWrite with wizard phases</step>
      </steps>

      <quality_gate>User confirmed action (new/update)</quality_gate>
    </phase>

    <phase number="2" name="Base Reference">
      <objective>Select predefined design system as starting point</objective>

      <steps>
        <step>Present available design references:
          ```
          Select a base design system (or start from scratch):

          1. Material Design 3 - Google's design system
          2. Apple Human Interface Guidelines - iOS/macOS patterns
          3. Tailwind UI - Utility-first CSS patterns
          4. Ant Design - Enterprise-level design system
          5. Shadcn/ui - Modern React component patterns
          6. Start from scratch (no base reference)
          ```
        </step>
        <step>Store selected base reference</step>
      </steps>

      <quality_gate>Base reference selected</quality_gate>
    </phase>

    <phase number="3" name="Brand Colors">
      <objective>Define project color palette</objective>

      <steps>
        <step>Ask for primary brand color (hex value or description)</step>
        <step>Ask for secondary/accent colors</step>
        <step>Ask for semantic colors (success, warning, error)</step>
        <step>Ask if dark mode colors differ</step>
        <step>Validate color contrast ratios (warn if < 4.5:1)</step>
        <step>Generate color section for style file</step>
      </steps>

      <input_format>
        ```
        Enter your brand colors:

        Primary color: #2563EB (or "blue")
        Secondary color: #7C3AED (or skip)
        Accent color: #F59E0B (or skip)

        For semantic colors, press Enter to use defaults:
        Success: #22C55E
        Warning: #EAB308
        Error: #EF4444

        Do you have separate dark mode colors? (y/n)
        ```
      </input_format>

      <quality_gate>At least primary color defined</quality_gate>
    </phase>

    <phase number="4" name="Typography">
      <objective>Configure typography preferences</objective>

      <steps>
        <step>Ask for primary font family</step>
        <step>Ask for heading font (if different)</step>
        <step>Ask for monospace font</step>
        <step>Ask for base font size</step>
        <step>Confirm type scale (or customize)</step>
        <step>Generate typography section</step>
      </steps>

      <input_format>
        ```
        Configure typography:

        Primary font: Inter (or system default)
        Heading font: Same as primary (or specify)
        Monospace font: JetBrains Mono (or default)

        Base font size: 16px
        Type scale: Default (major third) or Custom?
        ```
      </input_format>

      <quality_gate>Font family and base size defined</quality_gate>
    </phase>

    <phase number="5" name="Spacing">
      <objective>Define spacing scale and layout patterns</objective>

      <steps>
        <step>Ask for base spacing unit (4px or 8px)</step>
        <step>Confirm spacing scale or customize</step>
        <step>Ask for default component padding</step>
        <step>Ask for page margins (mobile and desktop)</step>
        <step>Generate spacing section</step>
      </steps>

      <input_format>
        ```
        Configure spacing:

        Base unit: 4px (recommended) or 8px
        Standard scale: 4, 8, 12, 16, 24, 32, 48, 64

        Component padding: 16px (or specify)
        Page margin (mobile): 16px
        Page margin (desktop): 24px
        ```
      </input_format>

      <quality_gate>Base unit and scale defined</quality_gate>
    </phase>

    <phase number="6" name="Component Patterns">
      <objective>Document preferred component patterns</objective>

      <steps>
        <step>Ask about button styles (filled, outlined, etc.)</step>
        <step>Ask about form input styles</step>
        <step>Ask about card/container patterns</step>
        <step>Ask about border radius preference</step>
        <step>Ask about shadow/elevation usage</step>
        <step>Generate component patterns section</step>
      </steps>

      <input_format>
        ```
        Component preferences:

        Button style: Filled | Outlined | Soft | Mix
        Input style: Outlined | Filled | Underlined
        Card style: Elevated | Outlined | Flat

        Border radius: 4px | 8px | 12px | Full (rounded)
        Shadows: Minimal | Moderate | Prominent
        ```
      </input_format>

      <quality_gate>At least button and input styles defined</quality_gate>
    </phase>

    <phase number="7" name="Dos and Donts">
      <objective>Capture specific design rules and constraints</objective>

      <steps>
        <step>Ask for any specific "DO" patterns</step>
        <step>Ask for any specific "DON'T" patterns</step>
        <step>Ask for reference URLs or screenshots</step>
        <step>Generate rules section</step>
      </steps>

      <input_format>
        ```
        Design rules (optional but helpful):

        Things to DO:
        - (e.g., "Always use rounded corners on buttons")
        - (e.g., "Include icons on primary actions")

        Things to DON'T:
        - (e.g., "No gradients on backgrounds")
        - (e.g., "Avoid red for non-error states")

        Reference URLs (inspiration):
        - (e.g., https://dribbble.com/shots/...)
        ```
      </input_format>

      <quality_gate>User confirmed (even if empty)</quality_gate>
    </phase>

    <phase number="8" name="Save Style">
      <objective>Write design style file</objective>

      <steps>
        <step>Generate complete .claude/design-style.md</step>
        <step>Write file to .claude/design-style.md</step>
        <step>Confirm file created successfully</step>
        <step>Explain how ui-designer will use it</step>
      </steps>

      <quality_gate>File created and confirmed</quality_gate>
    </phase>
  </workflow>
</instructions>

<examples>
  <example name="Quick Setup with Base Reference">
    <user_request>/create-style</user_request>
    <execution>
      User: "1. Material Design 3"
      User: Primary "#1976D2", skip secondary
      User: Use defaults for typography
      User: 4px base unit, defaults
      User: Filled buttons, outlined inputs, 8px radius
      User: Skip dos/donts
      Result: .claude/design-style.md created with M3 base + customizations
    </execution>
  </example>

  <example name="Update Existing Style">
    <user_request>/create-style</user_request>
    <execution>
      System: "Found existing .claude/design-style.md. Update or create new?"
      User: "Update"
      System: "Which section to update?"
      User: "Just colors - change primary to #6366F1"
      Result: Updated primary color, kept everything else
    </execution>
  </example>
</examples>

<formatting>
  <completion_template>
## Design Style Created

**File**: .claude/design-style.md
**Base Reference**: {selected_base}

**Customizations**:
- Primary color: {primary}
- Typography: {font}
- Spacing base: {base}px
- Border radius: {radius}px

**How it works**:
The ui-designer agent will automatically detect this file and apply
your design preferences when reviewing any UI in this project.

Run `/ui-design` to review a design against your new style guide.
  </completion_template>
</formatting>
```

---

## 3. Project Style File Format

**Location**: `.claude/design-style.md`

### File Structure

```markdown
# Project Design Style

**Version**: 1.0.0
**Created**: 2026-01-05
**Base Reference**: material-3

---

## Brand Colors

### Primary Palette

| Role | Light Mode | Dark Mode | Usage |
|------|------------|-----------|-------|
| Primary | #2563EB | #60A5FA | Main brand, primary actions |
| Primary Foreground | #FFFFFF | #FFFFFF | Text on primary |
| Secondary | #7C3AED | #A78BFA | Accent elements |
| Secondary Foreground | #FFFFFF | #FFFFFF | Text on secondary |

### Semantic Colors

| Role | Light Mode | Dark Mode | Usage |
|------|------------|-----------|-------|
| Success | #22C55E | #4ADE80 | Positive feedback |
| Warning | #EAB308 | #FACC15 | Warnings, attention |
| Error | #EF4444 | #F87171 | Errors, destructive |
| Info | #3B82F6 | #60A5FA | Informational |

### Neutral Colors

| Role | Light Mode | Dark Mode |
|------|------------|-----------|
| Background | #FFFFFF | #0F172A |
| Surface | #F8FAFC | #1E293B |
| Border | #E2E8F0 | #334155 |
| Text Primary | #0F172A | #F8FAFC |
| Text Secondary | #64748B | #94A3B8 |
| Text Muted | #94A3B8 | #64748B |

---

## Typography

### Font Families

- **Primary**: Inter, system-ui, sans-serif
- **Headings**: Inter, system-ui, sans-serif
- **Monospace**: JetBrains Mono, monospace

### Type Scale

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| h1 | 36px | 700 | 40px |
| h2 | 30px | 600 | 36px |
| h3 | 24px | 600 | 32px |
| h4 | 20px | 600 | 28px |
| h5 | 18px | 600 | 24px |
| body | 16px | 400 | 24px |
| small | 14px | 400 | 20px |
| tiny | 12px | 400 | 16px |

---

## Spacing

### Base Unit

**4px** baseline grid

### Scale

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Tight spacing |
| sm | 8px | Compact elements |
| md | 16px | Standard padding |
| lg | 24px | Section spacing |
| xl | 32px | Large gaps |
| 2xl | 48px | Section separation |
| 3xl | 64px | Page sections |

### Layout

- **Page Margin (Mobile)**: 16px
- **Page Margin (Desktop)**: 24px
- **Max Content Width**: 1280px
- **Component Gap**: 16px

---

## Component Patterns

### Buttons

| Variant | Background | Border | Text |
|---------|------------|--------|------|
| Primary | Primary | None | Primary Foreground |
| Secondary | Secondary | None | Secondary Foreground |
| Outline | Transparent | Primary | Primary |
| Ghost | Transparent | None | Primary |
| Destructive | Error | None | White |

**Sizing**:
- Small: height 32px, padding 12px 16px
- Medium: height 40px, padding 12px 20px
- Large: height 48px, padding 16px 24px

**Border Radius**: 8px

### Form Inputs

| State | Border | Background |
|-------|--------|------------|
| Default | Border color | Transparent |
| Focus | Primary | Transparent |
| Error | Error | Error/10% |
| Disabled | Border/50% | Surface |

**Height**: 40px
**Padding**: 12px 16px
**Border Radius**: 8px

### Cards

- **Background**: Surface
- **Border**: Border color, 1px
- **Border Radius**: 12px
- **Padding**: 24px
- **Shadow**: None (flat) or subtle elevation

---

## Design Rules

### DO

- Use consistent border radius (8px for small, 12px for containers)
- Include focus states for all interactive elements
- Use semantic colors for feedback (success, warning, error)
- Maintain 4px spacing grid
- Include hover states for clickable elements
- Use icons alongside text for primary actions

### DON'T

- Don't use gradients on backgrounds
- Don't mix rounded and sharp corners
- Don't use red for non-error states
- Don't use shadows for elevation (prefer borders)
- Don't use more than 3 font weights on a page
- Don't center-align body text

---

## Reference URLs

- Brand Guidelines: [internal link if applicable]
- Inspiration: [dribbble/figma links]
- Component Library: [storybook/design system link]

---

## Style History

| Date | Change | Author |
|------|--------|--------|
| 2026-01-05 | Initial creation | /create-style |
```

---

## 4. Updated ui-designer Agent

**Location**: `plugins/orchestration/agents/ui-designer.md`

### Key Changes

Add the following to the existing agent:

#### 1. Style Detection in Critical Constraints

```xml
<style_detection>
  **FIRST STEP: Check for Project Style**

  Before any design review, check for style preferences in this order:

  1. **Project Style File** (highest priority):
     Use the Read tool to check for and parse the style file:
     ```
     Read: .claude/design-style.md

     If file exists, parse the following sections:
     - Extract "**Base Reference**:" value from header
     - Extract "## Brand Colors" section
     - Extract "## Typography" section
     - Extract "## Spacing" section
     - Extract "## Design Rules" section
     ```

  2. **Explicit Reference** (if provided in prompt):
     ```
     Design Reference: material-3
     ```
     Use the specified predefined reference.

  3. **Auto-detect** (if neither above):
     Analyze the design and suggest likely reference:
     - iOS-style elements -> Apple HIG
     - Material components -> Material Design 3
     - Tailwind-like spacing -> Tailwind UI
     - Enterprise forms -> Ant Design
     - Modern React patterns -> Shadcn/ui

  4. **Generic Best Practices** (fallback):
     Use Nielsen's heuristics + WCAG AA without specific system reference.

  **Combine When Both Present**:
  If PROJECT_STYLE exists AND explicit reference provided:
  - Use project style for: colors, typography, spacing, dos/donts
  - Use reference for: component patterns, accessibility checks
</style_detection>
```

#### 2. Feedback Loop Support

```xml
<feedback_loop>
  **Learn from Reviews (Single Session)**

  When flagging issues, check if they represent a pattern that should be added to project style.

  **IMPORTANT**: The "3+ times" threshold applies WITHIN A SINGLE REVIEW SESSION only.
  This means when reviewing multiple images/screens at once, if the same issue appears
  3+ times across those screens, suggest adding it to the project style.

  This approach:
  - Requires NO persistence layer or cross-session tracking
  - Works entirely within the current review context
  - Is simple to implement and understand

  **Identify Recurring Patterns (Within Current Session)**:
  - If same issue flagged 3+ times across multiple screens in THIS review, suggest adding to style
  - If user says "this is intentional" or "we always do this", offer to update style

  **Offer Style Updates**:
  After presenting review, if patterns detected:
  ```markdown
  ## Suggested Style Updates

  Based on this review, consider adding to your project style:

  **New Rule**: "Always include placeholder text in form inputs"
  **Reason**: Flagged 3 times in this review - appears to be a project pattern

  Would you like me to add this to .claude/design-style.md?
  (Reply "yes" or "add to style")
  ```

  **Update Style File**:
  If user approves, append to .claude/design-style.md:
  ```markdown
  ### DO
  - [existing rules]
  - Always include placeholder text in form inputs (learned 2026-01-05)
  ```

  **Track in Style History**:
  Add entry to Style History section:
  ```markdown
  | 2026-01-05 | Added: placeholder text rule | ui-designer feedback |
  ```
</feedback_loop>
```

#### 3. Updated Knowledge Section

Add to `<knowledge>`:

```xml
<style_integration>
  **Style File Parser**:

  Use the Read tool to extract sections from .claude/design-style.md.
  Parse the Markdown structure to identify each section by its ## header.

  **Section Extraction**:
  1. Read the entire file with Read tool
  2. Parse sections by identifying "## Section Name" headers
  3. Extract content between headers

  **Apply Style to Review**:

  When reviewing, cross-reference style file:

  1. **Color Validation**:
     - Compare detected colors against defined palette
     - Flag deviations from brand colors

  2. **Typography Validation**:
     - Check font families match defined fonts
     - Verify sizes follow type scale

  3. **Spacing Validation**:
     - Verify spacing follows defined scale
     - Check against base unit (4px or 8px)

  4. **Rules Validation**:
     - Check each DO rule is followed
     - Verify no DON'T rules violated
</style_integration>
```

#### 4. Updated Workflow

Add to workflow phase 1:

```xml
<phase number="1" name="Input Validation">
  <step>Initialize TodoWrite with review phases</step>
  <step>**NEW**: Use Read tool to check for .claude/design-style.md</step>
  <step>**NEW**: If found, parse style file and extract base reference</step>
  <step>Validate design reference exists</step>
  <step>Identify design type</step>
  <step>Determine review scope from user request</step>
</phase>
```

Add new phase for style feedback:

```xml
<phase number="7" name="Feedback Loop">
  <step>Analyze flagged issues for patterns WITHIN THIS SESSION</step>
  <step>Check if any issue appeared 3+ times across reviewed screens</step>
  <step>If patterns found, present "Suggested Style Updates"</step>
  <step>If user approves, update .claude/design-style.md</step>
  <step>Add entry to Style History</step>
</phase>
```

---

## 5. Updated ui-design-review Skill

**Location**: `plugins/orchestration/skills/ui-design-review/SKILL.md`

### Key Additions

#### Style-Aware Prompting Patterns

```markdown
## Style-Aware Review Prompts

### Pattern: Review with Project Style

When `.claude/design-style.md` exists, include in Gemini prompt:

```markdown
Analyze this UI against the project design style.

**Image**: [attached]

**Project Style Reference**:
{EXTRACTED_STYLE_CONTENT}

**Validation Checklist**:

1. **Colors**
   - Primary: {style.colors.primary}
   - Secondary: {style.colors.secondary}
   - Check all UI colors match palette

2. **Typography**
   - Font: {style.typography.primary}
   - Scale: {style.typography.scale}
   - Verify fonts and sizes match

3. **Spacing**
   - Base: {style.spacing.base}px
   - Check spacing follows scale

4. **Rules**
   - DO: {style.rules.do}
   - DON'T: {style.rules.dont}
   - Verify rules are followed

**Output Format**:
For each issue:
- **Location**: Where in UI
- **Issue**: What's wrong
- **Style Reference**: Which style rule violated
- **Severity**: CRITICAL/HIGH/MEDIUM/LOW
- **Recommendation**: How to fix
```

### Pattern: Review with Predefined Reference

When explicit reference specified:

```markdown
Analyze this UI against {REFERENCE_NAME} guidelines.

**Image**: [attached]

**Reference**: {REFERENCE_ID}
**Reference URL**: {REFERENCE_URL}

Apply {REFERENCE_NAME} checklist:
{REFERENCE_CHECKLIST}

Flag any deviations from the design system.
```

### Pattern: Combined Style + Reference

When both project style and reference available:

```markdown
Analyze this UI against:
1. **Project Style** (for: colors, typography, spacing, rules)
2. **{REFERENCE_NAME}** (for: component patterns, accessibility)

**Image**: [attached]

**Project Style**:
{EXTRACTED_STYLE_CONTENT}

**Reference Patterns**:
{REFERENCE_PATTERNS}

Prioritize project style rules, fall back to reference for unlisted aspects.
```
```

---

## 6. Implementation Roadmap

### Version Bump

**Plugin Version**: 0.9.0 → **0.10.0**

Update in `plugins/orchestration/plugin.json`:
```json
{
  "name": "orchestration",
  "version": "0.10.0",
  ...
}
```

### Plugin.json Registration

Add the following to `plugins/orchestration/plugin.json`:

```json
{
  "name": "orchestration",
  "version": "0.10.0",
  "description": "Multi-agent orchestration patterns and design system tools",
  "skills": [
    "design-references",
    "ui-design-review",
    "multi-model-validation",
    "quality-gates",
    "todowrite-orchestration",
    "error-recovery"
  ],
  "commands": [
    "./commands/create-style.md",
    "./commands/ui-design.md"
  ],
  "agents": [
    "./agents/ui-designer.md"
  ]
}
```

### Phase 1: Core Infrastructure

| Task | File | Priority |
|------|------|----------|
| Create design-references skill | `skills/design-references/SKILL.md` | P0 |
| Create project style file format docs | `skills/design-references/SKILL.md` | P0 |

### Phase 2: Create-Style Command

| Task | File | Priority |
|------|------|----------|
| Create create-style command | `commands/create-style.md` | P0 |
| Test wizard flow | Manual testing | P1 |

### Phase 3: Agent Updates

| Task | File | Priority |
|------|------|----------|
| Add style detection to ui-designer | `agents/ui-designer.md` | P0 |
| Add feedback loop support | `agents/ui-designer.md` | P1 |
| Update ui-design-review skill | `skills/ui-design-review/SKILL.md` | P1 |

### Phase 4: Integration

| Task | File | Priority |
|------|------|----------|
| Update plugin.json with new skill | `plugin.json` | P0 |
| Add create-style to commands list | `plugin.json` | P0 |
| Update version to 0.10.0 | `plugin.json` | P0 |
| Update README | `README.md` | P1 |

### File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `skills/design-references/SKILL.md` | CREATE | New skill with 5 design system references |
| `commands/create-style.md` | CREATE | New command for style wizard |
| `agents/ui-designer.md` | UPDATE | Add style detection + feedback loop |
| `skills/ui-design-review/SKILL.md` | UPDATE | Add style-aware prompting |
| `plugin.json` | UPDATE | Register new skill, command, bump version to 0.10.0 |

---

## Appendix A: Design Reference Screenshots

Each predefined design reference should include example screenshots that demonstrate:

1. **Color usage** - Primary, secondary, semantic colors in context
2. **Typography** - Headers, body text, labels in use
3. **Spacing** - Consistent spacing patterns
4. **Components** - Buttons, forms, cards, navigation

Store in: `skills/design-references/examples/`

```
examples/
├── material-3/
│   ├── color-scheme.png
│   ├── typography.png
│   ├── buttons.png
│   └── forms.png
├── apple-hig/
│   ├── ios-colors.png
│   ├── sf-typography.png
│   └── navigation.png
├── tailwind-ui/
│   ├── color-palette.png
│   ├── components.png
│   └── layouts.png
├── ant-design/
│   ├── enterprise-forms.png
│   ├── data-tables.png
│   └── dashboards.png
└── shadcn-ui/
    ├── theme-system.png
    ├── components.png
    └── dark-mode.png
```

---

## Appendix B: Tool Recommendations

### ui-designer Agent

```yaml
tools: TodoWrite, Read, Write, Bash, Glob, Grep
```

- **TodoWrite**: Track review workflow progress
- **Read**: Read project style file, design references
- **Write**: Create review documents, update style file (feedback loop)
- **Bash**: Run Claudish for Gemini analysis, validate files
- **Glob**: Find design files, screenshots
- **Grep**: Search for patterns in codebase

### create-style Command

```yaml
allowed-tools: Task, AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
```

- **AskUserQuestion**: Interactive wizard prompts
- **Read**: Check existing style file
- **Write**: Create .claude/design-style.md
- **Bash**: Validate color formats, check file existence
- **TodoWrite**: Track wizard progress

---

## Appendix C: Model Recommendations

| Agent/Command | Model | Rationale |
|---------------|-------|-----------|
| ui-designer | sonnet | Balance of speed and quality for reviews |
| create-style | sonnet | Interactive wizard needs fast responses |
| Gemini analysis | gemini-3-pro-preview | Multimodal vision required |

---

## Appendix D: Color Recommendations

| Agent | Color | Rationale |
|-------|-------|-----------|
| ui-designer | cyan | Reviewer role (unchanged) |
| create-style | N/A | Command (no color) |

---

*Design document generated by agent-designer*
*Session: agentdev-design-references-20260105-221331-7ea4*
*Revised: 2026-01-05 - Applied 6 fixes from consolidated plan review*
