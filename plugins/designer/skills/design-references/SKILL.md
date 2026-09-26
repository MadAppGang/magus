---
name: design-references
description: Provides design system references — Material 3, Apple HIG, Tailwind UI, Ant Design, Shadcn/ui. Use when reviewing UI against an established design system.
user-invocable: false
---

# Design References Skill

## Overview

This skill provides predefined design system references that the ui agent can use when reviewing designs. Each reference includes design principles, color guidelines, typography rules, spacing patterns, and component patterns.

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

**System Colors**: blue, green, indigo, orange, pink, purple, red, teal, yellow (plus
mint, cyan, brown and gray). Use them through the platform API (`Color.blue`,
`UIColor.systemBlue`, `NSColor.systemBlue`), never as hex: Apple has revised the values
across releases, and each one resolves at runtime per light/dark mode and the
increased-contrast setting. Blue marks interactive elements, red destructive actions,
green success, orange and yellow warnings.

**Semantic Colors**:
- Label (Primary, Secondary, Tertiary, Quaternary)
- Fill (Primary through Quaternary)
- Background (Primary, Secondary, Tertiary)
- Separator

#### Typography

**SF Pro** (San Francisco):
| Style | Size | Weight | Leading |
|-------|------|--------|---------|
| Large Title | 34pt | Regular (Bold when emphasized) | 41pt |
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

**CSS variables in `oklch()`** (Tailwind v4), defined in the project's global CSS for
`:root` and `.dark`. The default neutral theme starts:

```css
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}
```

The full set: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`,
`muted`, `accent` (each with a `-foreground` pair), `destructive`, `border`, `input`,
`ring`, `radius`, `chart-1`…`chart-5`, and the `sidebar-*` group. The values depend on the
base colour chosen at init, so read the project's own file rather than this sample. A
project still on HSL triples (`--background: 0 0% 100%`) predates Tailwind v4.

#### Typography

The components set no font family; the app's own font applies (read the root layout).

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

`designer:ui` takes its style in this order:

1. **Project Style** (`STYLE_FILE`, default `.claude/design-style.md`)
2. **Predefined Reference** (the `REFERENCE` input, one of the IDs above)
3. **Chosen by platform** when neither is given (iOS → `apple-hig`, web app →
   `shadcn-ui`), named in its report

`designer:review` compares image files and takes no reference input.

### Designing Against a Reference

```
Agent: designer:ui
BRIEF: a settings form — profile name, email, notification toggles; the user saves changes
OUTPUT_DIR: design/settings
REFERENCE: shadcn-ui
STYLE_FILE: .claude/design-style.md
```

Project style wins for colours, type and spacing; the reference supplies component
patterns and accessibility rules.
