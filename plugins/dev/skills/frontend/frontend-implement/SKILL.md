---
name: frontend-implement
description: "Rewrites generic-looking UI into a deliberate design via theme tokens and library variants, never call-site values. Use when applying design-review fixes, or when a UI looks AI-generated."
disable-model-invocation: true
---

# Frontend implementation: from a design review to a distinctive UI

This skill turns a design review's findings into code that makes a UI look designed for
its product rather than generated. Its rules say **what** to change: composition, surface,
type, motion, colour. The design system decides **where** each change goes. A new look
means new or changed tokens in the theme and new variants in the component library, and
screens only compose. Restyling a screen with inline values does not make the change. It
hides the change where nobody can reuse or review it.

**Done means:** every issue in the review is addressed, or left with a stated reason; the
direction is written down and visible in every area you changed; the diff passes the
design-system audit; every new or changed variant has a story; the implementation log
exists.

| Related | Role |
|---|---|
| `designer:ui-analyse` (designer plugin) | produces the review this skill applies |
| `designer:ui-style-format` (designer plugin) | schema of `.claude/design-style.md`, the direction when a project has one |
| design-system guardrails (dev plugin, sibling folder) | the rules every change here obeys |

## Before you start

Read the design-system guardrails: `../design-system-guardrails/SKILL.md`, relative to this
skill's directory (in the dev plugin, `skills/frontend/design-system-guardrails/SKILL.md`).
This skill assumes its five rules and its decision tree. Nothing below overrides them.

Collect the inputs:

| Input | Usually comes from | If it is missing |
|---|---|---|
| The review | `/designer:review` (writes `summary.md`), the `designer:ui-analyse` patterns, or a human reviewer. Each issue has a location, a severity and a recommendation. | Get one first, for example `/designer:review <screenshot>`. This skill applies findings; it does not invent them. |
| The paths to change | the review's locations, or the caller | Trace them from the review's locations. Ask the caller only if a location matches more than one place. |
| The direction | `.claude/design-style.md`, a `/designer:ui` output directory (its `tokens.css` and `components.md` are a contract), or the user's brief | Infer it from the product: audience, domain, existing brand assets. Record it in the log as an assumption. |
| Screenshots of the current state | the review, or the caller | Work from the code. |

## Map every change to its home

| The change | Lands in | Not in |
|---|---|---|
| colour, gradient stop, shadow, radius, border, font, type size, leading, tracking, easing, keyframes, texture image | a token in the theme file, named by role and defined for every mode | a hex, `rgb()`, `hsl()` or `oklch()` literal, or a Tailwind arbitrary value, in a component or screen |
| a new look for an existing component | a variant in the library, with a story | classes passed at the call site |
| a new building block | a library component with tokens only, a variants API and a story per variant and state | a styled element inside a screen |
| where things sit and the space between them | the screen, using the spacing scale and layout primitives | appearance classes on a component |
| a composition used a third time | a recipe in the library, with a story | a copy in each screen |

Two facts that change decisions:

- **Changing an existing token's value restyles every screen that uses it.** That is right
  when the review is about the product's overall look, such as the palette or the type.
  For a complaint about one component in one context, add a variant or a new semantic token
  instead. The log records which you did.
- **Tailwind compiles arbitrary values whatever the theme says**, so a clean build proves
  nothing about token discipline. The audit under Verify is what catches them.

## Defaults to avoid

Generated UI keeps landing on the same choices, and your own first instinct will reach for
several of them. None of the items below is a default. Each needs a reason from the
direction before it appears. When the project's style guide or brand asks for one, keep
it, because the brief outranks this list.

- Cream, beige or warm off-white page backgrounds, and the dark counterpart: near-black
  with a single neon accent.
- Purple, violet-to-indigo or blue-to-purple gradients on buttons, heroes or text.
- Gradient-filled headline text.
- One italic or serif accent word inside an otherwise sans-serif headline.
- Small uppercase, letter-spaced or monospace "eyebrow" labels above headings.
- Numbered section labels: "01 / 02 / 03".
- Pill-shaped buttons, badges and inputs throughout.
- Glassmorphism: translucent cards, backdrop blur, faint white borders.
- Soft coloured glow shadows, and a hover lift-and-scale on every card.
- The centred hero: large headline, one-line subhead, a solid and a ghost button, and a
  blurred gradient blob behind them.
- Three equal feature cards, each with an icon in a rounded tile, a title and two lines of
  text.
- A bento grid as the answer to every layout.
- One neutral sans (Inter or the system stack) for everything, or its reflex opposite, an
  "editorial" serif display face.
- Emoji standing in for icons or illustration.

Swapping one item for another from the same list does not fix anything. Removing a default
does not give you a design either. Every change should trace back to the direction.

A review built on `designer:ui-analyse`'s anti-AI pattern raises issues in these same five
areas, with remedies such as "gradients/texture", "micro-interactions" and "bespoke
palette". Take those words as naming the area that needs work, not the technique to use.
Gradients, glass and glow are all on the list above.

## Workflow

1. **Read the review.** List every issue with its severity, location and recommendation.
   Then sort each one by the home it will land in, using the table above. Work from the
   highest severity down. Any issue you leave goes in the log with the reason.
2. **See the current state.** Read any screenshot you were given; you can read images
   directly. Read the theme file, and search the component library and its stories before
   choosing anything. Most "missing" components already exist (see the guardrails decision
   tree).
3. **State the direction** before you build anything (see below), and check it against the
   defaults list.
4. **Change the theme first.** Add or revise tokens for light, dark and any other mode the
   theme defines.
5. **Then the library.** Add variants and new components, with a story for each new variant
   and state.
6. **Then the screens.** Compose library parts and pass layout only.
7. **Verify**, then **write the log**.

A UI does not need changes in all five areas. Change the areas the review or the direction
calls for.

## Stating a direction

A direction is one decision that makes the five areas agree. Write one sentence per area,
specific enough that someone else would choose the same tokens. Take it from the style
guide, the brand or the brief, and say so when you inferred it instead.

This example shows the shape; it is not a direction to reuse:

> Field instrument. Composition: dense left-aligned columns, one oversized reading per
> screen. Surface: flat planes separated by hairline borders, no shadows. Type: a condensed
> grotesque for figures and headings over a plain text face. Colour: a cool neutral ground
> with one saturated signal colour kept for state. Motion: state changes only, fast and
> linear.

Named styles such as Swiss, brutalist and editorial are useful shorthand, but only once you
have written them out this way for this product. "Glass" and "warm luxury" lead straight to
the defaults list.

## The five areas, through the system

### Composition

Goal: a hierarchy the eye can follow. Each view has one dominant element, and sizes and
positions differ because importance differs. Layout belongs to the parent, so this is the
one area where screens do the work: grid placement from the column scale (7 beside 5, not
6 beside 6), gaps from the spacing scale, overlap through negative margins on the same
scale, and layout primitives (`Grid`, `Stack`) instead of ad-hoc wrappers.

```tsx
// Screen: placement and spacing only. Each card's look is its variant.
<Grid cols={12} gap="6">
  <FeatureCard variant="lead" className="col-span-7 row-span-2" />
  <FeatureCard className="col-span-5" />
  <FeatureCard className="col-span-5 -mt-8" />
</Grid>
```

If the scale cannot express a column template, give it a name in the `Grid` primitive or
the theme. Do not write it as an arbitrary value in the screen.

### Surface and depth

Goal: surfaces that differ by role (page, raised, sunken, inverse), with depth shown the way
the direction says, whether that is hairlines on flat planes, hard offset shadows or layered
tints. Every shadow, border treatment, surface colour and texture, including a noise image,
is a theme token. Components expose them as variants.

```css
@theme {
  --shadow-raised: …;            /* built for this direction */
  --color-surface-raised: …;
}
```

```tsx
const cardVariants = cva("rounded-md border border-border", {
  variants: {
    surface: {
      flat: "bg-surface",
      raised: "bg-surface-raised shadow-raised",
      inverse: "bg-surface-inverse text-surface-inverse-foreground",
    },
  },
  defaultVariants: { surface: "flat" },
});
```

### Type

Goal: a type scale with real contrast between display and body, defined once. A display
size, including a fluid `clamp()`, belongs in one text token together with its line height
and letter spacing. In Tailwind v4 a `--text-*` token carries `--line-height` and
`--letter-spacing` sub-properties. Font families are font tokens. A `Heading` component
exposes the sizes as variants, so screens never write type classes.

```css
@theme {
  --font-display: …;               /* chosen for this product */
  --text-display: clamp(…);
  --text-display--line-height: …;
  --text-display--letter-spacing: …;
}
```

```tsx
<Heading size="display">Welcome</Heading>
```

Choose the pairing from the direction: a display face with a character the product can
own, and a text face that reads well at body size.

### Motion and feedback

Goal: motion that confirms something happened (pressed, saving, saved, failed) rather than
decorating. Interactive and loading states live inside the component (guardrails Rule 3).
Easing curves are `--ease-*` tokens and keyframe animations are `--animate-*` tokens.
Durations come from a small named set, not a new number for each component. Every animation
has a reduced-motion form, written with `motion-reduce:` inside the component.

Start with CSS transitions on those tokens. Add an animation library only if the project
already uses one or the direction needs gesture or layout animation, and record the new
dependency in the log.

### Colour

Goal: a palette drawn from the product (brand assets, domain, audience). It is held as
primitives in the theme and used only through semantic tokens, in every mode. A new look
means new token values, and each gradient stop is a token. Every text-on-surface pair meets
WCAG AA contrast: 4.5:1 for body text, 3:1 for large text and interface parts. Tailwind's
default palette classes (`bg-blue-500`) are primitives used directly, so the guardrails
reject them in components as well.

```css
/* The theme file is the only place raw colour values live. */
:root { --brand-ground: …; --brand-ink: …; --brand-signal: …; }
.dark { --brand-ground: …; --brand-ink: …; --brand-signal: …; }
@theme inline {
  --color-background: var(--brand-ground);
  --color-foreground: var(--brand-ink);
  --color-accent: var(--brand-signal);
}
```

```tsx
// Do not: each raw value is a new source of truth, and the audit fails it.
<Card className="bg-[#0d0d0d] text-[#e8e4dd]" />
// Do: the look is a variant, and its colours are tokens.
<Card surface="inverse" />
```

## Verify

Check the diff you produced, not the whole repo:

- Run the audit on the changed paths:
  `bun <this skill's directory>/../design-system-guardrails/scripts/audit-ui.ts <paths>`.
  It exits non-zero on hardcoded colours, arbitrary values and inline styles. It also warns
  about appearance classes at call sites and about components with no story. Fix what it
  reports. Theme and token files are exempt by design.
- Every new or changed variant and component has a story.
- The project's own lint, typecheck and tests pass.
- New text-on-surface token pairs meet the contrast ratios above, focus stays visible,
  reduced motion is honoured, the layout holds at the project's breakpoints, and existing
  accessibility behaviour is unchanged.
- If you have a screenshot of the result, read it and check that each review issue landed.
  Name any that did not. Then compare it with the defaults list, because a fix can bring one
  in.
- For a verdict from another vendor's model, use `/designer:review` (designer plugin). It
  resolves the judge live from claudish's catalog and calls it through claudish's MCP
  tools. External models run only that way: never through the claudish CLI, and never with
  a model ID recalled from memory.

## Implementation log

Write the log where the caller asked. If they gave no location, return it as your report.

```markdown
## Implementation log

**Review**: {path to the review}
**Paths changed**: {files}
**Direction**: {one sentence per area; mark it "assumed" if inferred}

### Theme
- {token added or changed}: {modes defined}. {why}

### Library
- {component}: {variant or component added or changed}. Story: {story name}

### Screens
- {screen}: {layout change}

### Review issues
| Severity | Issue | Addressed by | Status |
|---|---|---|---|
| {severity} | {issue} | {token, variant or layout change} | done, or left: {reason} |

### Dependencies added
{package and reason, or "None"}

### Verification
- Audit: {command and result}
- Stories: {added}
- Lint, typecheck, tests: {results}
- Contrast, focus, reduced motion, breakpoints: {results}
- Visual check: {what was read and what it showed, or "not done: no screenshot"}
```
