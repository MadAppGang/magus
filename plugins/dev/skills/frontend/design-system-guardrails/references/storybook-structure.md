# Storybook structure — the component workshop and source of truth

Storybook is where components are built, documented, tested, and **discovered**. If it isn't in Storybook, it doesn't exist; if Storybook drifts from the app, it stops being trusted. Everything below exists to keep it authoritative.

## Top-level hierarchy

Based on Storybook's survey of 60 production design-system Storybooks:

```
Getting Started            (MDX doc: how to use the library)
Foundations/               (MDX docs: Design Tokens, Colors, Typography, Spacing, Icons)
Components/                (the library: Button, Input, Card, Dialog, …)
Recipes/                   (named compositions: ProductCard, SettingsForm, DataTableToolbar)
Screens/                   (full realistic screens assembled from components + recipes)
Snowflakes/                (quarantined one-offs, visible and greppable)
```

- Group `Components/` by **function** (Forms, Navigation, Layout, Feedback, Data Display) once it grows past ~15 components. Atomic Design naming (atoms/molecules) is a valid alternative but teams increasingly prefer functional names.
- Set hierarchy via the story `title`: `'Components/Forms/Button'`.
- Mark maturity with `parameters.status` or a `[deprecated]` suffix rather than deleting.

The `Recipes/` and `Screens/` sections are the "components in real application scenarios" requirement: they prove the parts compose, serve as integration-level visual tests, and show consumers (humans and agents) the intended way to assemble the parts. This is Brad Frost's **components / recipes / snowflakes** model — recipes stay *outside* the publishable component library but *inside* Storybook.

## Files & colocation

Stories live next to the component — same folder, same PR, reviewed together:

```
src/components/ui/button/
├── button.tsx
├── button.stories.tsx
└── index.ts
```

## Per-component story set (CSF3)

Order: docs → playground → one story per state/variant → recipe usage. Every state you want reviewed and visually tested needs its **own story** — only stories get snapshotted.

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';

const meta = {
  title: 'Components/Forms/Button',
  component: Button,
  tags: ['autodocs'],
  args: { variant: 'primary', children: 'Save changes' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'destructive', 'ghost'],
               table: { category: 'Variant' } },
    size:    { control: 'select', options: ['sm', 'md', 'lg'], table: { category: 'Variant' } },
    disabled:{ table: { category: 'State' } },
  },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Playground: every prop wired to controls — the API explorer. */
export const Playground: Story = {};

/** One story per variant & state — these are the visual/a11y test fixtures. */
export const Secondary: Story   = { args: { variant: 'secondary' } };
export const Destructive: Story = { args: { variant: 'destructive' } };
export const Disabled: Story    = { args: { disabled: true } };
export const Loading: Story     = { args: { loading: true } };

/** Pseudo-states are snapshot-able via storybook-addon-pseudo-states. */
export const Hovered: Story = { parameters: { pseudo: { hover: true } } };
export const Focused: Story = { parameters: { pseudo: { focusVisible: true } } };

/** Interaction test — behavior encoded with the component. */
export const SubmitsOnClick: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole('button'));
    // expect(args.onClick).toHaveBeenCalled()
  },
};
```

Conventions:

- Story names are short and never repeat the component name: `Disabled`, not `DisabledButton`.
- Sensible real-content `args` defaults ("Save changes", not "Lorem ipsum").
- Categorize controls (`table.category`: Variant / State / Content / Advanced).
- Data-driven components mock at the story level (MSW) — mock data never lives in app code.
- Compose child stories/templates instead of copy-pasting markup between stories.
- Link the Figma frame via `parameters.design` when one exists.

## Recipe & screen stories

```tsx
// recipes/product-card.stories.tsx
const meta = { title: 'Recipes/ProductCard', component: ProductCard };
export const Default: Story = {};
export const OutOfStock: Story = { args: { stock: 0 } };
export const LongTitle: Story  = { args: { title: veryLongTitle } };  // stress test
```

Recipes get the same treatment as components: stories for realistic states, edge content (long text, empty, error), and responsive checks via viewport parameters. A recipe story that breaks reveals a composition bug before any screen ships it.

## Testing — stories are the fixtures

One set of stories powers three test layers (Storybook 9+ Vitest addon):

1. **Interaction**: `play` functions run as real browser tests in CI.
2. **Accessibility**: a11y addon (axe) runs on every story; failures are test failures.
3. **Visual regression**: Chromatic (or Lost Pixel/Playwright screenshots) snapshots every story; PRs block until diffs are approved. This is the strongest drift-catcher — a call-site restyle can't hide from a screen-level snapshot.

CI gate: build Storybook + run story tests + visual diff on every PR touching UI.

## Workflow rules

1. **Storybook-first**: build or change a component in Storybook *before* wiring it into a screen. Write the state stories first — they're the spec.
2. **Story = definition of done**: a PR adding/changing a component or variant without the matching story is incomplete.
3. **Deployed & automated**: publish Storybook on every merge (Chromatic/Vercel/Pages). A stale Storybook stops being consulted, and drift follows.
4. **Discovery before creation**: consult Storybook before building anything (the sidebar is the inventory). With `@storybook/addon-mcp`, agents can query `list-all-documentation` / `get-documentation` and run `run-story-tests` — use those tools when available instead of guessing props.

## Agent-legibility (Storybook's own AI guidance)

- One concept per story; JSDoc descriptions explain **why/when** ("Primary buttons are the main action in a view; never more than one per view"), not what.
- Keep token values literal in Foundations MDX (static analysis can't evaluate imports).
- Exclude anti-pattern/demo stories from agent context with the `!manifest` tag.

## Sources

- Structuring your Storybook: https://storybook.js.org/blog/structuring-your-storybook/
- Components, recipes, snowflakes (Brad Frost): https://bradfrost.com/blog/post/design-system-components-recipes-and-snowflakes/
- Shopify Polaris "Patterns" (recipe precedent): https://polaris-react.shopify.com/patterns
- Storybook 9 testing (Vitest, a11y): https://storybook.js.org/blog/storybook-9/
- Pseudo-states addon: https://github.com/chromaui/storybook-addon-pseudo-states
- Storybook AI best practices & MCP: https://storybook.js.org/docs/ai/best-practices , https://storybook.js.org/docs/ai/mcp/overview
- Story-driven development case study (smallcase): https://medium.com/smallcase-engineering/story-driven-development-11eb81aeb77
