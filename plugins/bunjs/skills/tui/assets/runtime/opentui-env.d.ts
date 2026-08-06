/**
 * runtime/opentui-env.d.ts — the React 19 / OpenTUI type reconciliation, and the
 * one place that records what the type system will and will not catch for you.
 *
 * THE MISMATCH this file exists for: React 19 lets a component return `ReactNode`
 * (which includes `undefined`), while OpenTUI's intrinsic elements were typed to
 * accept `ReactElement | null`. A component written the idiomatic React 19 way —
 * `function Row(): ReactNode` — was then rejected as a child of `<box>`.
 *
 * MEASURED 2026-07-30 against the pinned binding: it now declares
 * `type Element = React.ReactNode` in its own `jsx-namespace.d.ts`, so the widening
 * below is INERT at this pin. It is kept because it costs nothing and because a
 * project pinning an older binding — or a `.tsx` that misses the `jsxImportSource`
 * pragma and falls back to the global JSX namespace — still needs it. Verify with
 * `bun run typecheck`, not by trusting this comment. */
import type { ReactNode } from "react"

declare global {
  namespace JSX {
    /** Agree with OpenTUI's own `Element`, so a component may return `undefined`. */
    type Element = ReactNode
  }
}

/**
 * MEASURED, and the reason the skill's `tsconfig.json` sets `skipLibCheck: true`
 * and `types: ["bun"]`. With library checking on, `tsc --noEmit` fails with 19
 * errors inside `node_modules`, none of them yours:
 *
 *  - 16 × TS2307 `Cannot find module 'bun:ffi'` across `@opentui/core` — fixed by
 *    installing `@types/bun` and listing it in `types`.
 *  - TS2430 in `@opentui/react/jsx-namespace.d.ts`: its `IntrinsicElements` extends
 *    `React.JSX.IntrinsicElements`, and OpenTUI's `<a>` carries
 *    `style?: Partial<TextNodeOptions>` where `@types/react`'s HTML `<a>` demands
 *    `CSSProperties`. THE HTML TAG-NAME COLLISION IS REAL and unfixable from user
 *    code — `<span>`, `<b>`, `<i>`, `<u>`, `<a>` exist in both worlds. It is also
 *    why `lib` must not contain `"DOM"`: with it the editor completes DOM props
 *    that OpenTUI silently ignores.
 *
 * WHAT THE TYPE SYSTEM WILL NOT CATCH (measured the same day — all three compile
 * clean, so never rely on `tsc` for them): Solid's snake_case spellings written as
 * React tags (ascii_font, tab_select); any unknown kebab tag with any props at all,
 * e.g. a made-up element taking a nonsense prop; a construct call beside JSX.
 *
 * The cause is one line in `@opentui/react`: `OpenTUIComponents` carries an index
 * signature `[componentName: string]: RenderableConstructor`, so every kebab-case
 * tag is structurally valid. Run `scripts/check-surface.ts` — it exists precisely
 * because this hole cannot be closed with types.
 *
 * THE B4 REGISTRATION SLOT. A custom renderable reaches JSX only through `extend()`
 * plus this augmentation — there is no `<frame-buffer>` intrinsic. Copy the block
 * below into the react-side module that calls `extend()`, keeping the core subclass
 * in its own file. This is upstream's own documented form, and the form upstream
 * uses on itself for `TimeToFirstDraw`.
 *
 *   // my-chart.tsx  (react side)
 *   import { extend } from "@opentui/react"
 *   import { MyChartRenderable } from "./my-chart-renderable"   // core side
 *
 *   declare module "@opentui/react" {
 *     interface OpenTUIComponents {
 *       "my-chart": typeof MyChartRenderable
 *     }
 *   }
 *   extend({ "my-chart": MyChartRenderable })
 *
 * Left as a template, not a live empty augmentation: per the measurement above it
 * would add no checking, and an interface declared here rather than beside its
 * `extend()` call silently stops matching its renderable. */
export {}
