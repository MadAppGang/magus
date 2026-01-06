# CSS Skills Design Document

**Session**: `agentdev-css-skills-20260106-015743-7ac8`
**Target Location**: `plugins/dev/skills/frontend/`
**Skills**: tailwindcss/SKILL.md, css-modules/SKILL.md

---

## Executive Summary

This document provides comprehensive design plans for two CSS skills to be added to the dev plugin:

1. **tailwindcss/SKILL.md** - Standalone TailwindCSS v4 patterns (CSS-first configuration)
2. **css-modules/SKILL.md** - Pure CSS Modules with Lightning CSS and PostCSS

These skills complement the existing `shadcn-ui/SKILL.md` without duplicating content.

---

## Skill 1: tailwindcss/SKILL.md

### Overview

**Purpose**: Standalone TailwindCSS v4 patterns focusing on CSS-first configuration, design tokens, and modern CSS features. This skill covers Tailwind v4 as a standalone utility framework, NOT its integration with shadcn/ui (which is covered in the separate shadcn-ui skill).

**Key Differentiator**: The shadcn-ui skill covers component library patterns with Tailwind. This skill covers pure Tailwind v4 architecture and configuration.

### Frontmatter

```yaml
---
name: tailwindcss
description: |
  TailwindCSS v4 patterns with CSS-first configuration using @theme, @source, and modern CSS features.
  Covers design tokens, CSS variables, container queries, dark mode, and Vite integration.
  Use when configuring Tailwind, defining design tokens, or leveraging modern CSS with Tailwind utilities.
---
```

### Content Structure

#### Section 1: Overview and Key Changes (v4)

```markdown
# TailwindCSS v4 Patterns

## Overview

TailwindCSS v4 introduces a CSS-first approach, eliminating the need for JavaScript configuration files. All customization happens directly in CSS using new directives.

## Key Changes from v3 to v4

| Feature | v3 | v4 |
|---------|-----|-----|
| Configuration | `tailwind.config.js` | CSS `@theme` directive |
| Content detection | JS array | `@source` directive |
| Plugin loading | `require()` in JS | `@plugin` directive |
| Custom variants | JS API | `@custom-variant` directive |
| Custom utilities | JS API | `@utility` directive |

## Browser Support

TailwindCSS v4 requires modern browsers:
- Safari 16.4+
- Chrome 111+
- Firefox 128+

**Important**: No CSS preprocessors (Sass/Less) needed - Tailwind IS the preprocessor.
```

#### Section 2: Documentation Index

```markdown
---

## Documentation Index

### Core Documentation

| Topic | URL | Description |
|-------|-----|-------------|
| Installation | https://tailwindcss.com/docs/installation | Setup guides by framework |
| Using Vite | https://tailwindcss.com/docs/installation/vite | Vite integration (recommended) |
| Editor Setup | https://tailwindcss.com/docs/editor-setup | VS Code IntelliSense |
| Upgrade Guide | https://tailwindcss.com/docs/upgrade-guide | v3 to v4 migration |
| Browser Support | https://tailwindcss.com/docs/browser-support | Compatibility requirements |

### Configuration Reference

| Directive | URL | Description |
|-----------|-----|-------------|
| @theme | https://tailwindcss.com/docs/theme | Define design tokens |
| @source | https://tailwindcss.com/docs/content-configuration | Content detection |
| @import | https://tailwindcss.com/docs/import | Import Tailwind layers |
| @config | https://tailwindcss.com/docs/configuration | Legacy JS config |

### CSS Features

| Feature | URL | Description |
|---------|-----|-------------|
| Dark Mode | https://tailwindcss.com/docs/dark-mode | Dark mode strategies |
| Responsive Design | https://tailwindcss.com/docs/responsive-design | Breakpoint utilities |
| Hover & Focus | https://tailwindcss.com/docs/hover-focus-and-other-states | State variants |
| Container Queries | https://tailwindcss.com/docs/container-queries | Component-responsive design |

### Customization

| Topic | URL | Description |
|-------|-----|-------------|
| Theme Configuration | https://tailwindcss.com/docs/theme | Token customization |
| Adding Custom Styles | https://tailwindcss.com/docs/adding-custom-styles | Extending Tailwind |
| Functions & Directives | https://tailwindcss.com/docs/functions-and-directives | CSS functions |
| Plugins | https://tailwindcss.com/docs/plugins | Plugin system |
```

#### Section 3: CSS-First Configuration

```markdown
---

## CSS-First Configuration

### Basic Setup

```css
/* src/index.css */
@import "tailwindcss";
```

This single import replaces the v3 directives (`@tailwind base`, `@tailwind components`, `@tailwind utilities`).

### @theme Directive - Design Tokens

The `@theme` directive defines design tokens as CSS custom properties:

```css
@import "tailwindcss";

@theme {
  /* Colors */
  --color-primary: hsl(221 83% 53%);
  --color-primary-dark: hsl(224 76% 48%);
  --color-secondary: hsl(215 14% 34%);
  --color-accent: hsl(328 85% 70%);

  /* With oklch (modern color space) */
  --color-success: oklch(0.723 0.191 142.5);
  --color-warning: oklch(0.828 0.189 84.429);
  --color-error: oklch(0.637 0.237 25.331);

  /* Typography */
  --font-display: "Satoshi", "sans-serif";
  --font-body: "Inter", "sans-serif";
  --font-mono: "JetBrains Mono", "monospace";

  /* Spacing */
  --spacing-page: 2rem;
  --spacing-section: 4rem;

  /* Custom breakpoints */
  --breakpoint-xs: 480px;
  --breakpoint-3xl: 1920px;

  /* Animation timing */
  --ease-spring: cubic-bezier(0.68, -0.55, 0.265, 1.55);
  --duration-fast: 150ms;
  --duration-normal: 300ms;
}
```

**Generated utilities from above:**
- Colors: `bg-primary`, `text-primary-dark`, `border-accent`
- Fonts: `font-display`, `font-body`, `font-mono`
- Animations: `ease-spring`, `duration-fast`

### @theme inline Pattern

Use `@theme inline` to reference existing CSS variables without generating new utilities:

```css
/* Define CSS variables normally */
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --primary: oklch(0.205 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
}

/* Map to Tailwind utilities */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-primary: var(--primary);
}
```

**When to use `@theme inline`:**
- Theming with CSS variables (light/dark mode)
- Shadcn/ui integration
- Dynamic theme switching

### @source Directive - Content Detection

```css
@import "tailwindcss";

/* Default: Tailwind scans all git-tracked files */

/* Add additional sources */
@source "../node_modules/my-ui-library/src/**/*.{html,js}";
@source "../shared-components/**/*.tsx";

/* Safelist specific utilities */
@source inline("bg-red-500 text-white p-4");
```

### @custom-variant - Custom Variants

```css
@import "tailwindcss";

/* Dark mode variant (class-based) */
@custom-variant dark (&:is(.dark *));

/* RTL variant */
@custom-variant rtl ([dir="rtl"] &);

/* Print variant */
@custom-variant print (@media print { & });

/* Hover on desktop only */
@custom-variant hover-desktop (@media (hover: hover) { &:hover });
```

### @utility - Custom Utilities

```css
@import "tailwindcss";

/* Text balance utility */
@utility text-balance {
  text-wrap: balance;
}

/* Scrollbar hide */
@utility scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}

/* Flex center shorthand */
@utility flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}
```

### @plugin - Plugin Configuration

```css
@import "tailwindcss";

/* Load a plugin */
@plugin "@tailwindcss/typography";
@plugin "@tailwindcss/forms";
@plugin "@tailwindcss/container-queries";

/* Plugin with options */
@plugin "@tailwindcss/typography" {
  className: prose;
}
```

### @config - Legacy JS Configuration

When you need JS configuration (rare in v4):

```css
@import "tailwindcss";
@config "./tailwind.config.ts";
```
```

#### Section 4: Vite Integration

```markdown
---

## Vite Integration

### Installation

```bash
npm install tailwindcss @tailwindcss/vite
```

### Vite Configuration

```typescript
// vite.config.ts
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

### CSS Entry Point

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  /* Your design tokens */
}
```

### TypeScript Path Aliases

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```
```

#### Section 5: Modern CSS Features

```markdown
---

## Modern CSS Features with Tailwind v4

### Native CSS Variables

Tailwind v4 uses native CSS variables without wrapper functions:

```css
/* v3 - Required hsl wrapper */
--primary: 221 83% 53%;
background-color: hsl(var(--primary));

/* v4 - Direct CSS value */
--color-primary: hsl(221 83% 53%);
/* Used as: bg-primary */
```

### oklch Color Format

```css
@theme {
  /* oklch: lightness, chroma, hue */
  --color-brand: oklch(0.65 0.2 250);
  --color-brand-light: oklch(0.85 0.15 250);
  --color-brand-dark: oklch(0.45 0.25 250);
}
```

**Benefits of oklch:**
- Perceptually uniform
- Consistent lightness across hues
- Better for generating color scales
- Native browser support

### Container Queries

```html
<!-- Parent needs @container -->
<div class="@container">
  <!-- Child responds to container width -->
  <div class="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3">
    <!-- Content -->
  </div>
</div>
```

```css
/* Named containers */
.sidebar {
  container-name: sidebar;
  container-type: inline-size;
}

/* Target named container */
@container sidebar (min-width: 300px) {
  .nav-item { /* expanded styles */ }
}
```

### :has() Pseudo-Class

```html
<!-- Style parent based on child state -->
<label class="group has-[:invalid]:border-red-500 has-[:focus]:ring-2">
  <input type="email" class="peer" />
</label>
```

```css
/* Card with image gets different padding */
.card:has(> img) {
  @apply p-0;
}

/* Form with invalid fields */
.form:has(:invalid) {
  @apply border-red-500;
}
```

### Native CSS Nesting

```css
.card {
  @apply rounded-lg bg-white shadow-md;

  .header {
    @apply border-b p-4;
  }

  .content {
    @apply p-6;
  }

  &:hover {
    @apply shadow-lg;
  }

  &.featured {
    @apply border-2 border-primary;
  }
}
```
```

#### Section 6: Utility Patterns

```markdown
---

## Utility Patterns

### Responsive Design (Mobile-First)

```html
<!-- Breakpoints: sm(640px), md(768px), lg(1024px), xl(1280px), 2xl(1536px) -->
<div class="
  p-4 text-sm               /* Mobile */
  sm:p-6 sm:text-base       /* Tablet */
  lg:p-8 lg:text-lg         /* Desktop */
  2xl:p-12 2xl:text-xl      /* Large screens */
">
```

### State Variants

```html
<!-- Hover, focus, active -->
<button class="
  bg-primary text-white
  hover:bg-primary-dark
  focus:ring-2 focus:ring-primary focus:ring-offset-2
  active:scale-95
  disabled:opacity-50 disabled:cursor-not-allowed
">

<!-- Group hover -->
<div class="group">
  <span class="group-hover:underline">Label</span>
  <span class="opacity-0 group-hover:opacity-100">Icon</span>
</div>

<!-- Peer focus -->
<input class="peer" />
<span class="invisible peer-focus:visible">Hint text</span>
```

### Dark Mode

**Strategy 1: Class-based (recommended)**

```css
@custom-variant dark (&:is(.dark *));
```

```html
<html class="dark">
<body class="bg-white dark:bg-gray-900 text-black dark:text-white">
```

**Strategy 2: Media query**

```css
@custom-variant dark (@media (prefers-color-scheme: dark) { & });
```

### Animation Utilities

```html
<!-- Built-in animations -->
<div class="animate-spin" />
<div class="animate-pulse" />
<div class="animate-bounce" />

<!-- Custom animation -->
<div class="animate-[fadeIn_0.5s_ease-out]" />
```

```css
@theme {
  --animate-fade-in: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### Size Utility (v4)

```html
<!-- v3: Two classes -->
<div class="w-10 h-10">

<!-- v4: Single class -->
<div class="size-10">
```
```

#### Section 7: Best Practices

```markdown
---

## Best Practices

### When to Use @apply

Use `@apply` sparingly for true component abstraction:

```css
/* Good: Repeated pattern across many components */
@layer components {
  .btn-primary {
    @apply px-4 py-2 bg-primary text-white rounded-md;
    @apply hover:bg-primary-dark focus:ring-2 focus:ring-primary;
    @apply disabled:opacity-50 disabled:cursor-not-allowed;
    @apply transition-colors duration-fast;
  }
}

/* Bad: One-off styling (just use utilities in HTML) */
.my-special-div {
  @apply mt-4 p-6 bg-gray-100; /* Just put these in className */
}
```

**Rule**: Only extract patterns when reused 3+ times.

### Design Token Naming

```css
@theme {
  /* Semantic naming (preferred) */
  --color-primary: hsl(221 83% 53%);
  --color-primary-foreground: hsl(0 0% 100%);

  /* Not: --color-blue-600: ... */

  /* Scale naming when needed */
  --color-gray-50: oklch(0.985 0 0);
  --color-gray-100: oklch(0.970 0 0);
  --color-gray-900: oklch(0.145 0 0);
}
```

### Performance

1. **Use Vite plugin** - Automatic dead code elimination
2. **Avoid dynamic class names** - Static analysis can't optimize them
3. **Purge unused styles** - Automatic with proper @source config

```html
<!-- Good: Static class names -->
<div class={isActive ? "bg-primary" : "bg-gray-100"}>

<!-- Bad: Dynamic class construction -->
<div class={`bg-${color}-500`}> <!-- Can't be purged -->
```

### CSS Layers Order

Tailwind v4 uses CSS cascade layers:

```
1. @layer base - Reset, typography defaults
2. @layer components - Reusable components
3. @layer utilities - Utility classes (highest priority)
```

Custom styles should go in appropriate layers:

```css
@layer components {
  .card { /* component styles */ }
}

@layer utilities {
  .text-shadow { /* utility styles */ }
}
```
```

#### Section 8: Related Skills

```markdown
---

## Related Skills

- **shadcn-ui** - Component library using Tailwind (CSS variables, theming)
- **css-modules** - Alternative: scoped CSS for complex components
- **react-typescript** - React patterns with Tailwind className
- **design-references** - Design system guidelines (Tailwind UI reference)
```

---

## Skill 2: css-modules/SKILL.md

### Overview

**Purpose**: Pure CSS Modules with PostCSS and Lightning CSS for scoped styling. This skill covers CSS Modules as a standalone approach, complementing Tailwind for complex component styling.

**Key Differentiator**: While Tailwind provides utility-first styling, CSS Modules provide true component-scoped CSS for complex animations, third-party component styling, and legacy migration.

### Frontmatter

```yaml
---
name: css-modules
description: |
  CSS Modules with Lightning CSS and PostCSS for component-scoped styling.
  Covers *.module.css patterns, TypeScript integration, Vite configuration, and composition.
  Use when building complex animations, styling third-party components, or migrating legacy CSS.
---
```

### Content Structure

#### Section 1: Overview

```markdown
# CSS Modules

## Overview

CSS Modules provide locally-scoped CSS by automatically generating unique class names at build time. This prevents style conflicts and enables true component encapsulation.

## When to Use CSS Modules

| Use Case | CSS Modules | Tailwind |
|----------|-------------|----------|
| Complex animations | Best | Good |
| Third-party component styling | Best | Harder |
| Legacy CSS migration | Best | Refactor needed |
| Rapid prototyping | Slower | Best |
| Design system utilities | Not ideal | Best |
| Component encapsulation | Best | N/A |
| Team with CSS expertise | Best | Either |

**Hybrid Approach**: Use both together - Tailwind for utilities, CSS Modules for complex components.
```

#### Section 2: Documentation Index

```markdown
---

## Documentation Index

### Vite Integration

| Topic | URL | Description |
|-------|-----|-------------|
| CSS Modules in Vite | https://vite.dev/guide/features#css-modules | Vite's built-in support |
| Lightning CSS | https://vite.dev/guide/features#lightning-css | Fast CSS transforms |
| PostCSS | https://vite.dev/guide/features#postcss | PostCSS configuration |

### Lightning CSS

| Topic | URL | Description |
|-------|-----|-------------|
| Documentation | https://lightningcss.dev/docs.html | Official docs |
| CSS Modules | https://lightningcss.dev/css-modules.html | Module support |
| Transpilation | https://lightningcss.dev/transpilation.html | Browser targeting |
| Bundling | https://lightningcss.dev/bundling.html | CSS bundling |

### CSS Modules Spec

| Topic | URL | Description |
|-------|-----|-------------|
| CSS Modules | https://github.com/css-modules/css-modules | Specification |
| Composition | https://github.com/css-modules/css-modules#composition | Composing classes |
| Scoping | https://github.com/css-modules/css-modules#naming | Local vs global |

### TypeScript Integration

| Topic | URL | Description |
|-------|-----|-------------|
| typed-css-modules | https://github.com/Quramy/typed-css-modules | Generate .d.ts files |
| vite-plugin-css-modules-dts | https://github.com/mrcjkb/vite-plugin-css-modules-dts | Vite plugin |
```

#### Section 3: Fundamentals

```markdown
---

## CSS Modules Fundamentals

### File Naming Convention

```
src/
├── components/
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.module.css      # CSS Module
│   │   └── Button.test.tsx
│   └── Card/
│       ├── Card.tsx
│       ├── Card.module.css        # CSS Module
│       └── index.ts
```

Files ending in `.module.css` are automatically processed as CSS Modules.

### Basic Usage

```css
/* Button.module.css */
.button {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-weight: 500;
  transition: background-color 150ms ease;
}

.primary {
  background-color: hsl(221, 83%, 53%);
  color: white;
}

.primary:hover {
  background-color: hsl(224, 76%, 48%);
}

.secondary {
  background-color: hsl(0, 0%, 96%);
  color: hsl(0, 0%, 9%);
}
```

```tsx
// Button.tsx
import styles from './Button.module.css'

interface ButtonProps {
  variant?: 'primary' | 'secondary'
  children: React.ReactNode
}

export function Button({ variant = 'primary', children }: ButtonProps) {
  return (
    <button className={`${styles.button} ${styles[variant]}`}>
      {children}
    </button>
  )
}
```

### Generated Class Names

```html
<!-- Input -->
<button class="${styles.button} ${styles.primary}">

<!-- Output (generated) -->
<button class="Button_button_x7d9f Button_primary_a3k2j">
```

### Local vs Global Scope

```css
/* Local by default */
.button {
  /* Generates: Button_button_hash */
}

/* Explicit local */
:local(.button) {
  /* Same as above */
}

/* Global (escape hatch) */
:global(.external-library-class) {
  /* Kept as-is: .external-library-class */
}

/* Global within local */
.card :global(.markdown-body) {
  /* Scoped parent, global child */
}
```
```

#### Section 4: Composition

```markdown
---

## Composition

### composes Keyword

Share styles between classes:

```css
/* base.module.css */
.flexCenter {
  display: flex;
  align-items: center;
  justify-content: center;
}

.interactive {
  cursor: pointer;
  transition: all 150ms ease;
}
```

```css
/* Button.module.css */
.button {
  composes: flexCenter from './base.module.css';
  composes: interactive from './base.module.css';
  padding: 0.5rem 1rem;
}
```

### Multiple Compositions

```css
.primaryButton {
  composes: button;
  composes: primary from './colors.module.css';
  composes: rounded from './shapes.module.css';
}
```

### Usage in React

```tsx
// Composed class automatically includes all composed classes
<button className={styles.primaryButton}>
  {/* Renders: Button_primaryButton_x Button_button_y colors_primary_z shapes_rounded_w */}
</button>
```
```

#### Section 5: Vite Configuration with Lightning CSS

```markdown
---

## Vite Configuration

### Lightning CSS (Recommended)

Lightning CSS is 100x faster than PostCSS for transforms:

```bash
npm install lightningcss browserslist
```

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import browserslistToTargets from 'lightningcss/browserslist'
import browserslist from 'browserslist'

export default defineConfig({
  plugins: [react()],
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      targets: browserslistToTargets(browserslist('>= 0.25%')),
      cssModules: {
        // Class name pattern
        pattern: '[name]__[local]_[hash:5]',
        // Or for production:
        // pattern: '[hash:8]'
      }
    }
  },
  build: {
    cssMinify: 'lightningcss'
  }
})
```

### Class Name Patterns

| Pattern | Example Output |
|---------|----------------|
| `[name]__[local]_[hash:5]` | `Button__primary_a3k2j` |
| `[local]_[hash:8]` | `primary_a3k2j9x1` |
| `[hash:8]` | `a3k2j9x1` (production) |

### Lightning CSS Features (Included)

Lightning CSS automatically handles:
- Vendor prefixing (replaces autoprefixer)
- Modern syntax transpilation
- Nesting
- Custom media queries
- Color functions (oklch, lab, lch)

### PostCSS Configuration (When Needed)

For plugins Lightning CSS doesn't support:

```javascript
// postcss.config.js
export default {
  plugins: {
    'postcss-import': {},
    'postcss-custom-media': {},
    // Don't use: autoprefixer (Lightning CSS handles this)
    // Don't use: postcss-nested (Lightning CSS handles this)
  }
}
```

**Note**: Use Lightning CSS for transforms, PostCSS only for unsupported plugins.
```

#### Section 6: TypeScript Integration

```markdown
---

## TypeScript Integration

### Type Declarations

Without types, TypeScript doesn't know the shape of CSS modules:

```typescript
// This would error without declarations
import styles from './Button.module.css'
styles.button  // TS error: Property 'button' does not exist
```

### Option 1: Wildcard Declaration (Simple)

```typescript
// src/vite-env.d.ts or src/types/css-modules.d.ts
declare module '*.module.css' {
  const classes: { [key: string]: string }
  export default classes
}
```

**Pros**: No extra tooling
**Cons**: No autocomplete, no type safety

### Option 2: Generated Declarations (Recommended)

```bash
npm install -D vite-plugin-css-modules-dts
```

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cssModulesDts from 'vite-plugin-css-modules-dts'

export default defineConfig({
  plugins: [
    react(),
    cssModulesDts({
      // Generate .d.ts next to .module.css files
      outputDir: '.',
    })
  ]
})
```

Generated files:

```typescript
// Button.module.css.d.ts (auto-generated)
declare const styles: {
  readonly button: string
  readonly primary: string
  readonly secondary: string
}
export default styles
```

**Pros**: Full autocomplete, type safety, catches typos
**Cons**: Generated files in source (add to .gitignore)

### Option 3: CLI Generation

```bash
npm install -D typed-css-modules

# Generate declarations
npx tcm src --pattern '**/*.module.css'

# Watch mode
npx tcm src --pattern '**/*.module.css' --watch
```

Add to `package.json`:

```json
{
  "scripts": {
    "css:types": "tcm src --pattern '**/*.module.css'",
    "css:types:watch": "tcm src --pattern '**/*.module.css' --watch"
  }
}
```
```

#### Section 7: Patterns

```markdown
---

## Patterns

### Component-Scoped Styling

```css
/* Card.module.css */
.card {
  border-radius: 0.5rem;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.header {
  padding: 1rem;
  border-bottom: 1px solid hsl(0, 0%, 90%);
}

.content {
  padding: 1.5rem;
}

.footer {
  padding: 1rem;
  background: hsl(0, 0%, 98%);
}
```

```tsx
// Card.tsx
import styles from './Card.module.css'

export function Card({ children }: { children: React.ReactNode }) {
  return <div className={styles.card}>{children}</div>
}

Card.Header = ({ children }: { children: React.ReactNode }) => (
  <header className={styles.header}>{children}</header>
)

Card.Content = ({ children }: { children: React.ReactNode }) => (
  <div className={styles.content}>{children}</div>
)

Card.Footer = ({ children }: { children: React.ReactNode }) => (
  <footer className={styles.footer}>{children}</footer>
)
```

### CSS Variables with Modules

```css
/* theme.css (global) */
:root {
  --color-primary: hsl(221, 83%, 53%);
  --color-primary-dark: hsl(224, 76%, 48%);
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
}

/* Button.module.css */
.button {
  background-color: var(--color-primary);
  padding: var(--spacing-sm) var(--spacing-md);
}

.button:hover {
  background-color: var(--color-primary-dark);
}
```

### Theming with CSS Variables

```css
/* theme.module.css */
.light {
  --bg: white;
  --text: hsl(0, 0%, 9%);
  --border: hsl(0, 0%, 90%);
}

.dark {
  --bg: hsl(0, 0%, 9%);
  --text: hsl(0, 0%, 98%);
  --border: hsl(0, 0%, 20%);
}

/* Component.module.css */
.component {
  background-color: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
}
```

### Complex Animations

CSS Modules excel at complex animations:

```css
/* Modal.module.css */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 200ms ease;
}

.overlayVisible {
  composes: overlay;
  opacity: 1;
}

.modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.95);
  opacity: 0;
  transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.modalVisible {
  composes: modal;
  transform: translate(-50%, -50%) scale(1);
  opacity: 1;
}

@keyframes slideIn {
  from {
    transform: translate(-50%, -50%) translateY(20px) scale(0.95);
    opacity: 0;
  }
  to {
    transform: translate(-50%, -50%) translateY(0) scale(1);
    opacity: 1;
  }
}

.modalAnimated {
  animation: slideIn 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
```
```

#### Section 8: Hybrid Approach (CSS Modules + Tailwind)

```markdown
---

## Hybrid Approach: CSS Modules + Tailwind

Use both together for maximum flexibility:

```tsx
import styles from './ComplexCard.module.css'

function ComplexCard({ title, children }: Props) {
  return (
    // Tailwind for layout, CSS Module for complex styles
    <div className={`${styles.card} p-4 md:p-6`}>
      <h2 className={`${styles.title} text-lg font-semibold mb-2`}>
        {title}
      </h2>
      <div className={styles.animatedContent}>
        {children}
      </div>
    </div>
  )
}
```

### When to Use Which

| Scenario | Approach |
|----------|----------|
| Layout utilities (flex, grid, spacing) | Tailwind |
| Responsive utilities | Tailwind |
| State variants (hover, focus) | Tailwind |
| Complex animations | CSS Modules |
| Keyframe animations | CSS Modules |
| Third-party component overrides | CSS Modules |
| Component state classes | CSS Modules |
| Design system utilities | Tailwind |
| One-off complex styles | CSS Modules |
```

#### Section 9: Performance

```markdown
---

## Performance Benefits

### Lightning CSS Advantages

| Feature | Speed Improvement |
|---------|-------------------|
| CSS parsing | 100x faster than PostCSS |
| Vendor prefixing | Built-in, instant |
| Minification | Faster than cssnano |
| Bundling | Parallel processing |

### Dead Code Elimination

Vite automatically eliminates unused CSS:
- CSS Modules are naturally tree-shaken (only imported classes included)
- Lightning CSS removes unused selectors

### Bundle Size Optimization

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    cssMinify: 'lightningcss',
    cssCodeSplit: true,  // Separate CSS per chunk
  }
})
```
```

#### Section 10: Related Skills

```markdown
---

## Related Skills

- **tailwindcss** - Utility-first CSS (complementary approach)
- **shadcn-ui** - Component library using CSS variables
- **react-typescript** - Component patterns with className
- **testing-frontend** - Testing styled components
```

---

## Implementation Notes

### File Structure

```
plugins/dev/skills/frontend/
├── css-modules/
│   └── SKILL.md           # New skill
├── tailwindcss/
│   └── SKILL.md           # New skill
├── shadcn-ui/
│   └── SKILL.md           # Existing - DO NOT DUPLICATE
├── react-typescript/
│   └── SKILL.md           # Existing
└── tanstack-router/
       └── SKILL.md        # Existing
```

### Non-Duplication Checklist

**tailwindcss/SKILL.md MUST NOT include:**
- shadcn/ui component installation
- shadcn/ui theming patterns (those use @theme inline)
- Form components from shadcn/ui
- CLI commands for shadcn

**css-modules/SKILL.md MUST NOT include:**
- Tailwind utility patterns (covered in tailwindcss skill)
- shadcn/ui integration patterns
- CVA patterns (covered in css-developer agent)

### Cross-References

Both skills should reference:
- Each other (for hybrid approach)
- shadcn-ui skill (for component library integration)
- react-typescript skill (for React patterns)

---

## Summary

| Skill | Purpose | Key Topics |
|-------|---------|------------|
| tailwindcss | Pure Tailwind v4 | @theme, @source, @utility, Vite integration |
| css-modules | Component-scoped CSS | .module.css, Lightning CSS, TypeScript types |
| shadcn-ui (existing) | Component library | CLI, components, theming |

These three skills together provide comprehensive CSS coverage for the dev plugin.
