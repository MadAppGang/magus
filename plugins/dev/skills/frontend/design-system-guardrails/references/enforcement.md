# Enforcement — making the rules physical

Written rules (for humans or agents) cap out around ~70% compliance. Real red lines belong in lint, tests, and CI. Layer them: **agent rules → lint (editor + pre-commit) → CI audit → visual regression**.

## ESLint

Tailwind-aware linting, two maintained options (2026):

- **`eslint-plugin-better-tailwindcss`** — supports Tailwind v3 + v4, ESLint + Oxlint, most frameworks. Key rules: `no-unknown-classes` (anything not in your theme errors — catches typos AND off-theme utilities), `no-conflicting-classes`, `no-restricted-classes` (regex bans). Point it at your CSS entry: `settings: { "better-tailwindcss": { entryPoint: "src/app.css" } }`.
- **`eslint-plugin-tailwindcss`** v4.2+ (rewritten for Tailwind v4, flat-config only): `no-arbitrary-value`, `no-custom-classname`, `no-contradicting-classname`.

Core rules that do the structural work (see `assets/eslint.guardrails.example.mjs` for the full drop-in config):

```js
// Ban arbitrary values + raw palette classes even if the plugin misses them
"better-tailwindcss/no-restricted-classes": ["error", { restrict: [
  { pattern: "^.*-\\[.*\\]$", message: "Arbitrary value — add a token to the theme instead." },
  { pattern: "^(bg|text|border|ring|fill|stroke)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\\d+$",
    message: "Primitive palette class — use a semantic token (bg-primary, text-muted-foreground)." },
]}],

// No inline styles anywhere; className only on layout primitives
"react/forbid-component-props": ["error", { forbid: [
  { propName: "style", message: "No inline styles — use tokens/variants." },
  { propName: "className",
    allowedFor: ["Box", "Stack", "Grid", "Card", /* + page-layout wrappers */],
    message: "Appearance belongs in the component's variants. className is for layout primitives only." },
]}],

// Styled raw elements = shadow components
"react/forbid-elements": ["error", { forbid: [
  { element: "button", message: "Use <Button> from the component library." },
  { element: "input",  message: "Use <Input> from the component library." },
  { element: "select", message: "Use <Select> from the component library." },
]}],

// One entry point; no reaching around the library
"no-restricted-imports": ["error", { patterns: [
  { group: ["@radix-ui/*", "@headlessui/*", "@mui/*"],
    message: "Import the wrapped component from @/components/ui instead." },
]}],

// Hardcoded colors in TS/JS (chart configs, styled objects)
"no-restricted-syntax": ["error",
  { selector: "Literal[value=/^#([0-9a-fA-F]{3,8})$/]",
    message: "Hex color — use a design token (CSS var or tokens module)." },
],
```

Scoping: apply `forbid-elements` / `forbid-component-props` to `src/app|features|pages/**` and **exempt `src/components/ui/**`** — the library is exactly where raw elements and className plumbing are supposed to exist. The `className` allow-list is intentionally the bluntest instrument here; if it's too noisy at first, start with `style` + arbitrary values + palette bans (pure wins), then tighten.

Escape hatch policy: exceptions happen via `// eslint-disable-next-line <rule> -- <reason>` and require the reason (`@eslint-community/eslint-comments/require-description`). Exceptions are visible, greppable, and reviewable — which is what keeps the system honest without being abandoned.

## Stylelint (any handwritten CSS/SCSS)

```json
{
  "plugins": ["stylelint-declaration-strict-value"],
  "rules": {
    "color-no-hex": true,
    "scale-unlimited/declaration-strict-value": [
      ["/color$/", "fill", "stroke", "background", "box-shadow", "border-radius", "font-size", "font-family", "z-index"],
      { "ignoreValues": ["currentColor", "transparent", "inherit", "initial", "unset", "none", "0"] }
    ]
  }
}
```

Exempt the token definition files (`tokens.css`, `app.css` with `@theme`) — they're the one place raw values are correct.

## CI gates

1. **Audit script** (`scripts/audit-ui.ts`, bundled, run with `bun`): dependency-free scan for hardcoded colors, arbitrary values, inline styles, appearance-overrides on components, and library components missing stories. Exits non-zero on errors → works as a CI step and a pre-commit hook. Run on changed paths for fast PR feedback, full repo nightly.
   It distinguishes Tailwind *variant selectors* (`data-[state=open]:`, `has-[…]:`, `supports-[…]:`) from *arbitrary values* (`w-[347px]`), so a correct shadcn/ui codebase reports clean. Layout primitives and components imported from icon packages (lucide, heroicons, tabler…) are exempt from the appearance-override check — className is their documented API. Widen the exemption with `--layout-components A,B,C`.
2. **Story tests**: Storybook Vitest addon / test-runner executes every story + play functions + axe a11y in CI.
3. **Visual regression**: Chromatic (or Playwright screenshots) on every story; the PR check stays pending until diffs are approved. This catches what static analysis can't — including "someone restyled it downstream".
4. **Story coverage**: no canonical tool — the audit script's missing-story check covers it; alternatively a danger.js rule ("new file in `components/ui` without sibling `.stories.*` → fail").

## Adoption metrics & governance

- Measure DS usage with **react-scanner** (JSON of component/prop usage, diffable in CI) or **Omlet** (dashboards, adoption trends). Track: % of screens using only library components, raw-element count, override count. Celebrate the trend, don't weaponize it.
- **New-variant flow**: request → is it a variant, recipe, or snowflake? (see `component-patterns.md`) → variant/recipe PRs go to the library with stories; snowflakes are approved with a named owner and revisit date.
- **Promotion (rule of three)**: reused in a third place → promote into the library, delete the copies.
- **100% coverage is a non-goal.** Systems with zero escape hatches get routed around and die. Quarantined, documented exceptions + a promotion path is the sustainable equilibrium.

## Rollout order for an existing codebase

1. Turn everything on as **warnings** on the whole repo; **errors on changed files only** (lint-staged) so new code is clean immediately.
2. Fix the top 3 most-repeated violations (usually one color, one button, one card).
3. Flip rules to errors directory-by-directory as they hit zero.
4. Add Chromatic last — once the library is the source of truth, visual diffs become low-noise and high-signal.

## Sources

- eslint-plugin-better-tailwindcss: https://github.com/schoero/eslint-plugin-better-tailwindcss
- eslint-plugin-tailwindcss (v4 rewrite): https://github.com/francoismassart/eslint-plugin-tailwindcss
- forbid-component-props: https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/forbid-component-props.md
- stylelint-declaration-strict-value: https://github.com/AndyOGo/stylelint-declaration-strict-value
- Firefox semantic-token enforcement precedent: https://firefox-source-docs.mozilla.org/code-quality/lint/linters/stylelint-plugin-mozilla/rules/no-base-design-tokens.html
- Chromatic PR gating: https://www.chromatic.com/storybook
- react-scanner: https://github.com/moroshko/react-scanner · Omlet: https://omlet.dev
- Governance & promotion: https://bradfrost.com/blog/post/a-design-system-governance-process/
