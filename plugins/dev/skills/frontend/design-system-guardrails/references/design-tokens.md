# Design tokens — one source of truth for styles

## Token tiers

Three tiers, validated industry-wide (W3C DTCG, Style Dictionary, Firefox, MetaMask):

| Tier | Named by | Example | Rule |
|---|---|---|---|
| **Primitive / core** | raw value | `--blue-500: oklch(0.62 0.19 250)` | Never used directly in components. Only referenced by semantic tokens. |
| **Semantic / alias** | role & intent | `--color-primary`, `--color-surface`, `--color-destructive` | The **only** tier components and app code consume. |
| **Component** (optional) | component-part-state | `--button-primary-bg-hover` | References semantic tokens. Add only when a component genuinely needs its own knob. |

Name by **role, not appearance** (`primary`, not `blue`): a rebrand or dark mode becomes a one-place change. If a token is named after its value, it's a primitive leaking into the wrong tier.

The interoperable file format is the W3C **Design Tokens (DTCG) spec** — first stable version 2025.10 (`$value`/`$type`, aliases like `{color.brand.500}`). Use it if tokens are exchanged between tools; not required if the Tailwind theme file *is* your source of truth.

## Tailwind v4 — strict theme setup (recommended)

Tailwind v4 is CSS-first: the `@theme` block replaces `tailwind.config.js`. Every theme variable becomes both a utility class and a native CSS variable. To make the theme the *only* source of truth, **wipe the defaults** so off-theme utilities don't even compile:

```css
/* app.css — THE source of truth for styles */
@import "tailwindcss";

@theme {
  /* Wipe Tailwind's default palette: bg-red-500, text-blue-300 etc. cease to exist */
  --color-*: initial;
  /* (--*: initial wipes ALL default namespaces — stricter, more setup) */

  /* Primitives (referenced below, never used in markup) */
  --color-brand-600: oklch(0.55 0.20 260);

  /* Semantic tokens — what components use */
  --color-primary: var(--color-brand-600);
  --color-primary-foreground: oklch(0.98 0 0);
  --color-surface: oklch(1 0 0);
  --color-destructive: oklch(0.58 0.22 27);

  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --font-sans: "Inter", system-ui, sans-serif;
}
```

Notes:

- Spacing in v4 is multiplier-based from a single `--spacing` value — usually keep it and use the scale (`p-3`, `gap-4`) rather than defining every step.
- **Arbitrary values (`w-[347px]`, `bg-[#ff0000]`) cannot be disabled in Tailwind config** — they always compile. Blocking them is lint's job (see `enforcement.md`) plus these rules. Wiping namespaces only kills *named* off-theme utilities like `bg-red-500`.

## Runtime theming / dark mode (shadcn/ui convention)

For themes that switch at runtime, values live on `:root` / `.dark` and are mapped into Tailwind via `@theme inline`:

```css
:root  { --background: oklch(1 0 0);      --primary: oklch(0.55 0.2 260); }
.dark  { --background: oklch(0.145 0 0);  --primary: oklch(0.7 0.18 260); }

@theme inline {
  --color-background: var(--background);
  --color-primary: var(--primary);
}
```

shadcn/ui's semantic set is a good default vocabulary: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring` — each surface paired with a `*-foreground` text color, plus a single `--radius` that derives the whole radius scale. Values in OKLCH.

Adding a new semantic token (the "missing value" flow from Rule 1):

```css
:root  { --warning: oklch(0.8 0.16 85); }
.dark  { --warning: oklch(0.85 0.14 85); }
@theme inline { --color-warning: var(--warning); }
/* → bg-warning, text-warning now exist everywhere */
```

Never write `dark:bg-zinc-900` in components — dark mode is the tokens' job, not each call site's.

## Without Tailwind

Same rules, plain CSS: one `tokens.css` defining all custom properties; every stylesheet consumes only `var(--…)`. Enforce with Stylelint `declaration-strict-value` (see `enforcement.md`). For CSS-in-JS, export a typed `tokens` object from one module and forbid literal values via lint.

## Figma / multi-platform pipelines

When designers own tokens or you target multiple platforms, the validated pipeline is:

**Figma Variables → DTCG token JSON in the repo (via Tokens Studio plugin or Variables API) → Style Dictionary v5 (+ `@tokens-studio/sd-transforms`) → generated CSS-variables file imported next to `@theme` → utilities → components.**

Figma variable modes (light/dark/brand) map to `:root` / `.dark` / `[data-brand="x"]` blocks.

For a single web app with dev-maintained tokens, this layer is overkill — the Tailwind `@theme` file itself is the hand-maintained source of truth, and designers conform to it. Add Style Dictionary when you have ≥2 platforms or designer-owned tokens.

## Checklist for any token change

- [ ] Added at the right tier (semantic unless it's genuinely a new primitive)
- [ ] Named by role, not by value
- [ ] Defined for all modes (light **and** dark, all brands)
- [ ] No component or screen references the primitive directly
- [ ] Documented in the Storybook Foundations page (tokens table)

## Sources

- Tailwind theme variables & `--color-*: initial`: https://tailwindcss.com/docs/theme
- shadcn/ui theming: https://ui.shadcn.com/docs/theming
- W3C DTCG format (2025.10 stable): https://www.designtokens.org/tr/2025.10/format/
- Style Dictionary DTCG support: https://styledictionary.com/info/dtcg/
- Token tiers with Tailwind v4: https://www.maviklabs.com/blog/design-tokens-tailwind-v4-2026/
