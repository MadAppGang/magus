---
name: design-system-guardrails
description: Enforces single-source-of-truth UI — tokens for styles, one component library, variants over call-site restyling. Use before writing or reviewing any UI.
user-invocable: false
---

# Design System Guardrails

Every application UI has exactly **two sources of truth**:

1. **The theme (design tokens)** — every color, spacing, radius, font, and shadow is defined once.
2. **The component library (workshopped in Storybook)** — every component is defined and styled once, with all its variants and states.

Application screens **only compose**. They never define appearance.

Why this matters: when tokens and components live in one place, a rebrand is a one-file change, a component fix propagates everywhere, and there is never a third slightly-different implementation of the same button. Every hardcoded hex value or call-site restyle silently creates a second source of truth that someone else (human or agent) will later copy. These rules exist to make drift impossible, not to slow you down.

---

## The five rules

### Rule 1 — Tokens are the only styling values

All styling values come from the theme as **semantic tokens** (named by role: `primary`, `surface`, `destructive`), never as raw values and never as primitive names (`blue-500`). Semantic names survive rebrands and make dark mode a token swap instead of a rewrite.

- Never hardcode: hex (`#3b82f6`), `rgb()`/`hsl()`/`oklch()` literals, magic pixel values, or Tailwind arbitrary values (`w-[347px]`, `text-[#ff0000]`, `bg-[rgb(0,0,0)]`).
- If the value you need doesn't exist, **add a token to the theme first**, then use it. Never inline it "just this once" — that's how every drifted codebase started.

```tsx
// ❌ Three new sources of truth
<div className="bg-[#1a56db] p-[13px] rounded-[5px]">
// ✅ Tokens only
<div className="bg-primary p-3 rounded-md">
```

```css
/* ❌ */ .card { background: #ffffff; border-radius: 8px; }
/* ✅ */ .card { background: var(--color-surface); border-radius: var(--radius-md); }
```

### Rule 2 — Components are defined once, in the library

Every reusable component lives in the component library (e.g. `src/components/ui/` or the design-system package) — never inside a screen, page, or feature folder. Every library component has **stories covering every variant and interactive state** (default, hover, focus, disabled, loading, error, empty).

A component without a story effectively doesn't exist: Storybook is the discovery surface, the spec, and the test fixture all at once. **Story = part of definition of done.**

Styled raw HTML in app code (`<button className="px-4 py-2 bg-primary ...">`) is a duplicate component in disguise — use or extend the library component instead.

### Rule 3 — Appearance lives inside the component

All visual variations are part of the component's API — `variant`, `size`, `tone`, state props — encoded once inside the component (CVA/variants pattern, or your framework's equivalent).

- Need a new look? **Add a variant in the library + a story for it. Then use it.**
- Never restyle at the call site. A call-site override is an unnamed, undiscoverable, untested variant.
- Interactive states (hover, focus, disabled, loading, invalid) are the component's job, defined once inside it — never re-implemented where it's used.

```tsx
// ❌ Unnamed variant created at the call site
<Button className="bg-emerald-600 hover:bg-emerald-700 text-white">Approve</Button>
// ✅ Named variant defined in the library (with a story), used everywhere
<Button variant="success">Approve</Button>
```

### Rule 4 — Parents own layout, components own appearance

Components ship with **no outer margins**. Where a component sits and how much space surrounds it is the parent's decision; what it looks like is the component's decision.

- Call sites may pass **layout-only** styling: margin, flex/grid placement, width constraints — ideally via layout primitives (`Stack`, `Grid`, `Box`, `gap`) rather than ad-hoc classes.
- Appearance classes at a call site (`bg-*`, text color, border color, `rounded-*`, `shadow-*`, `font-*`) are a violation of Rule 3 — move them into a variant.
- The `style` prop / inline styles: never (only exception: passing CSS custom properties, e.g. `style={{ '--progress': x }}`).

```tsx
// ✅ Layout from the parent
<Stack gap="4"><Button variant="primary">Save</Button></Stack>
<Card className="mt-6 max-w-md" />        // margin + width constraint: fine
// ❌ Appearance from the parent
<Card className="bg-zinc-900 rounded-2xl shadow-xl" />   // these are variants
```

### Rule 5 — Screens compose; one-offs are quarantined

App screens assemble library components and recipes. When a screen needs something the library doesn't have, classify it deliberately:

| It is a…      | Definition                                             | Where it lives                                        |
|---------------|--------------------------------------------------------|-------------------------------------------------------|
| **Variant**   | Existing component, new look/state                     | Inside the component, in the library (Rule 3)          |
| **Component** | New reusable, context-agnostic building block          | Component library + stories (Rule 2)                   |
| **Recipe**    | Named composition of library components (`ProductCard`)| Recipes/Patterns section of the library + story         |
| **Snowflake** | Genuine one-off for one screen                         | Feature folder, named `*.snowflake.tsx` (greppable), composed from tokens + library parts |

Snowflakes are allowed — systems without escape hatches get abandoned — but they must be **named, quarantined, and reviewed**. When any recipe/snowflake gets reused a third time, promote it into the library ("rule of three").

---

## Decision tree — run this before writing any UI

```
Need UI?
│
├─ 1. DISCOVER first (mandatory):
│     • search the component library (grep src/components, the DS package)
│     • check Storybook stories for existing variants/states
│     • if a Storybook MCP / shadcn registry / Figma Code Connect is available, query it
│
├─ 2. Component + variant exist        → use as-is. Done.
├─ 3. Component exists, look missing   → add variant/state IN THE LIBRARY + story → use it.
├─ 4. It's a combination of components → build a Recipe + story in the Recipes section.
├─ 5. Nothing fits                     → build a new component IN THE LIBRARY
│                                        (tokens only, variants API, stories for all states)
│                                        → then use it in the app.
└─ NEVER: copy-paste a component, restyle at a call site, or hardcode a value.
```

Duplication is almost always a **discovery failure**. Two minutes of searching beats twenty minutes of rebuilding — and beats the third divergent implementation forever.

---

## Definition of done — verify before finishing any UI task

Check the **diff you produced**, not the whole repo:

- [ ] No hex/`rgb()`/`hsl()`/`oklch()` literals, no Tailwind arbitrary values, no inline `style` (run `bun ${CLAUDE_PLUGIN_ROOT}/skills/frontend/design-system-guardrails/scripts/audit-ui.ts <path>` if available — it checks exactly this)
- [ ] No component defined outside the library; no styled raw HTML elements in app code
- [ ] Every new or changed variant/state has a story
- [ ] Call sites pass only layout styling to components (margin/placement/width — nothing visual)
- [ ] New values were added as tokens, not inlined
- [ ] Lint passes

If any box fails, fix it before reporting the task complete.

---

## Setting up a new app

Do this in order — tokens before components, components before screens:

1. **Tokens**: one theme file. With Tailwind v4, use an `@theme` block and wipe defaults (`--color-*: initial`) so only your semantic tokens compile into utilities. Without Tailwind, a single CSS custom-properties file. → `references/design-tokens.md`
2. **Library + Storybook**: `src/components/ui/` (or a package), Storybook with a `Foundations / Components / Recipes / Snowflakes` hierarchy, stories colocated with components. → `references/storybook-structure.md`
3. **Component pattern**: variants encoded with CVA (or equivalent), no outer margins, layout primitives (`Stack`, `Grid`, `Box`). → `references/component-patterns.md`
4. **Guardrails**: drop in the ESLint/Stylelint configs from `assets/`, add `${CLAUDE_PLUGIN_ROOT}/skills/frontend/design-system-guardrails/scripts/audit-ui.ts` to CI, add story/visual tests. → `references/enforcement.md`

## Auditing an existing app

1. Run `bun ${CLAUDE_PLUGIN_ROOT}/skills/frontend/design-system-guardrails/scripts/audit-ui.ts <repo-path>` — it reports hardcoded colors, arbitrary values, inline styles, appearance overrides on components, and library components missing stories.
2. Migrate in this order: (1) extract tokens from the most-repeated hardcoded values, (2) consolidate the most-duplicated component (usually Button or Card) into the library with variants + stories, (3) sweep screens to replace one-offs, (4) turn on lint rules to lock it in.
3. Don't aim for 100% overnight — lock in the rules for **new code first** (lint on changed files), then pay down existing drift.

---

## Reference files

Read these when the task goes deeper than the rules above (if a file is missing, the rules above are self-sufficient):

- `references/design-tokens.md` — token tiers, Tailwind v4 strict theme setup, shadcn/ui semantic token conventions, dark mode, Figma → Style Dictionary pipelines
- `references/storybook-structure.md` — Storybook hierarchy, story conventions per component, recipes section, interaction/visual/a11y testing, agent-oriented docs
- `references/component-patterns.md` — CVA reference implementation, state handling, the className policy, layout primitives, framework-agnostic equivalents
- `references/enforcement.md` — complete ESLint/Stylelint configurations, CI gates, governance & promotion process, adoption metrics
- `scripts/audit-ui.ts` (run via `bun ${CLAUDE_PLUGIN_ROOT}/skills/frontend/design-system-guardrails/scripts/audit-ui.ts`) — dependency-free repo audit (CI-ready: exits non-zero on errors, `--json` for tooling). Covered by `scripts/audit-ui.test.ts`.
- `assets/eslint.guardrails.example.mjs`, `assets/stylelint.guardrails.example.cjs` — drop-in lint config templates

**Framework note**: the five rules are framework-agnostic. Examples here use React + Tailwind as the reference implementation; in Vue/Svelte/Angular apply the same rules with the equivalent mechanisms (props for variants, CSS custom properties for tokens, Storybook supports all of them).
