# Component patterns — variants inside, layout outside

## The reference implementation (React + Tailwind + CVA)

Variants are **data, not prose**: encoded once with `class-variance-authority` (or `tailwind-variants` if you need slots), consumed as typed props. The consumer picks from an enum; the appearance decision was already made in the library.

```tsx
// src/components/ui/button/button.tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils"; // clsx + tailwind-merge

const buttonVariants = cva(
  // Base: shared appearance + interactive states, defined ONCE.
  // Semantic tokens only. No outer margins (Rule 4).
  "inline-flex items-center justify-center rounded-md font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
    "disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:     "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:   "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        ghost:       "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-9 px-4 text-sm",
        lg: "h-10 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

interface ButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

function Button({ className, variant, size, loading, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-4" aria-hidden />}
      {children}
    </button>
  );
}
export { Button, buttonVariants };
```

Adding a new look = adding one line to a variant map + one story. That's the entire "new variant" flow.

## States belong to the component

Hover, focus-visible, disabled, loading, invalid, empty, error — defined once, inside the component:

- Interactive states as pseudo-class styles in the base/variant strings (`hover:`, `focus-visible:`, `disabled:`).
- Logical states as props (`loading`, `invalid`) or derived from context (form field state).
- Each state has a story (see `storybook-structure.md`).

If a call site is writing `hover:` or `disabled:` classes on a library component, that state handling belongs inside the component — move it.

## The className policy (layout-only exception)

Three approaches exist in production systems:

1. **Locked down** (SEEK Braid): components accept no `className`/`style`; a low-level `Box` is the only escape hatch. Strongest guarantee, most friction.
2. **Open** (shadcn/ui): `className` everywhere, merged with `tailwind-merge`, constrained by convention.
3. **Layout-only** (this skill's policy — the validated middle ground): `className` is accepted and merged (consumer classes win via `tailwind-merge`), but call sites may only pass **layout**: margins, flex/grid placement (`col-span-*`, `self-*`, `order-*`), and width/height constraints (`w-full`, `max-w-md`). Anything visual — colors, backgrounds, borders, radius, shadow, typography, padding — must be a variant.

Padding is **appearance** (it's part of the component's proportions, covered by `size`); margin is **layout**. Components never ship outer margins — spacing between siblings belongs to the parent, ideally a layout primitive:

```tsx
<Stack gap="4">          {/* Stack/Grid/Box own spacing between children */}
  <Input label="Email" />
  <Button variant="primary">Sign up</Button>
</Stack>
```

Provide `Box`, `Stack` (vertical/horizontal + gap), and `Grid` in the library so screens rarely need raw classes at all. Where teams want overrides greppable, rename the prop `UNSAFE_className` — instantly auditable.

Enforcement of "layout-only" is convention + review + the audit script heuristic (it flags appearance-class prefixes on component call sites); the lint layer can additionally restrict which components accept `className` at all (see `enforcement.md`).

## Wrapping third-party libraries

Never import a UI library (Radix, MUI, Mantine, headless UI) directly in app code. Wrap it once in the library, map your tokens/variants onto it, and export the wrapper. Then `no-restricted-imports` bans the raw import everywhere else. This keeps the "one place to change a component" promise even when the implementation is external.

## Deciding: variant vs component vs recipe vs snowflake

- Same element, different look/tone/size → **variant** (one line in the variant map).
- New context-agnostic building block → **component** (library + stories).
- Existing components arranged into a named, reused block (`ProductCard`, `FilterBar`) → **recipe** (composition; no new styling beyond layout).
- Screen-specific one-off → **snowflake**: build it in the feature folder from tokens + library parts, name it `*.snowflake.tsx`, give it a story under `Snowflakes/`. Promote on third reuse.

Warning sign of a god-component: a variant map with 10+ entries or boolean props that fight each other. At that point split into two components rather than adding variant #11.

## Framework-agnostic equivalents

The rules translate directly:

| Concept | React | Vue | Svelte | Web Components |
|---|---|---|---|---|
| Variants API | CVA + props | `defineProps` + computed class map (CVA works too) | props + class map | attributes + `:host([variant=…])` |
| Tokens | Tailwind theme / CSS vars | same | same | CSS vars pierce shadow DOM by design |
| Composition | children/slots props | slots | slots | slots |
| Workshop | Storybook | Storybook | Storybook | Storybook |

The invariants: variants are a typed enum inside the component; tokens are CSS custom properties; call sites compose and position but never repaint.

## Sources

- CVA: https://cva.style/docs · tailwind-variants: https://www.tailwind-variants.org
- shadcn/ui styling rules (variants first, className for layout only): https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/rules/styling.md
- Component spacing in design systems (no outer margins): https://css-tricks.com/component-spacing-design-system/ · https://ericwbailey.website/published/where-do-you-put-spacing-on-design-system-components/
- Braid's locked-down policy: https://seek-oss.github.io/braid-design-system/components/Box/
