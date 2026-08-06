# React patterns
> **Surface: `@opentui/react` (JSX).** Every snippet is React. Lowercase intrinsics only —
> `<text>`, `<box>`, `<span>`. Never `Text({…})`, never `<Box>`.

React is the canonical surface — every production app mined for this skill is React, and the documented scaffold is
`bun create tui --template react`. **Layout lives here too**: knowing CSS flexbox is knowing most of Yoga.

## The intrinsic element set

Twenty host elements, all lowercase. MEASURED 2026-07-30 in `react/src/components/index.d.ts:4-25` (the `baseComponents` map), identical in 0.1.107 and 0.4.5.

| Group | Elements |
|---|---|
| Structure & text | `box` `scrollbox` `text` `span` |
| Modifiers (inside `<text>`) | `b` `strong` `i` `em` `u` `a` `br` |
| Input | `input` `textarea` `select` `tab-select` |
| Code & display | `code` `diff` `markdown` `line-number` `ascii-font` |

- **Multi-word names are kebab-case** — `ascii-font`, `tab-select`, `line-number`; `scrollbox` is one word.
  Solid spells those three with underscores, so **Solid examples do not compile in React.**
- **Capitalised is never an intrinsic.** `Box`, `Text`, `Span`, `ScrollBox`, `TabSelect` are not exported from
  `@opentui/react` at all — it exports intrinsics, hooks, `createRoot` and `extend`; Capitalised in JSX means *your own*
  component. `<TimeToFirstDraw />` is the one exception. **No `frame-buffer`** — custom renderables need `extend()`.
- **No `bold` prop on `<text>`.** Emphasis is a nested modifier (`<text><strong>…</strong></text>`) or the `attributes`
  bitfield from `createTextAttributes` (`components-and-charts.md`) — prefer the bitfield; three modifiers nest 3 deep.
- **Props are flat** — `<box flexDirection="row" gap={1} padding={1}>`, and those flat props **are** the renderable's
  options. MEASURED: the prop type is `TOptions & { style?: Partial<Omit<TOptions, NonStyled>> } & ReactProps`
  (`src/types/components.d.ts:24`, both versions), so `style={{ … }}` adds nothing. `ref` is typed on every intrinsic.

## Layout: flexbox for boxes, arithmetic for widget widths

Arriving from Bubble Tea? **Half of that size-budget discipline goes; half is mandatory.** Yoga owns every *box* — it
accounts for border and padding, so never subtract 2 for a border and never thread inner heights down: heights, panel
placement and growth are declarative. But `Meter`, `Sparkline`, `HeatRow` and `StackedBar` take a **numeric `width`**
(`assets/theme/widgets.tsx`) and a number cannot `flexGrow`, so a full-width visual IS a column budget. Two constants are
the whole of it — MEASURED 2026-07-30 via `testRender` at `Panel width={20}`: **`Panel` costs 4 columns** (border ×2 +
`paddingLeft`/`paddingRight`; `Meter width={16}` fills one row, `17` wraps to a second) and **a `<scrollbox>` inside it
costs 1 more** for the scrollbar (rows of 15 `#` paint flush beside the thumb; 16 wraps every row, halving the visible
lines). So a widget spanning a panel is `outer - 4`, or `outer - 5` where that panel scrolls; when the panel itself grows,
thread the width down from `useTerminalDimensions()` minus named chrome constants. Narrower than the Bubble Tea reflex,
not a return to it: **heights are flexbox, widths of data widgets are arithmetic.**

**Resample the widget to its slot, or you get a hole, not a stretch.** A widget paints one column per sample: 48 samples
in a 58-column slot paint 48 and leave 10 blank, shoving a right-aligned label off the panel edge. `padStartTo` protects
the numeral column, nothing protects the widget column — slice or interpolate the series to the budgeted width (`Meter`
and `StackedBar` apportion `width` for you; `Sparkline` and `HeatRow` are one column per sample and cannot).

| Concern | Props |
|---|---|
| Flow & clipping | `flexDirection` (`row` `column` `row-reverse` `column-reverse`), `flexWrap` (`no-wrap` `wrap` `wrap-reverse`), `overflow` (`visible` `hidden` `scroll`) |
| Distribution | `justifyContent`, `alignItems`, `alignSelf` — `flex-start` `center` `flex-end` `space-between` `space-around` `space-evenly`, plus `stretch`/`baseline` on the align props |
| Size & growth | `flexGrow` `flexShrink` `flexBasis`; `width` `height` `minWidth` `minHeight` `maxWidth` `maxHeight`, each `number \| "auto" \| "N%"` |
| Spacing | `gap` `rowGap` `columnGap` on `<box>`/`<scrollbox>`; `padding*` and `margin*`, incl. `paddingX`/`paddingY` |

> **`gap`, `minWidth`, `minHeight`, `flexWrap`, `flexGrow` and `flexBasis` are supported.** MEASURED 2026-07-30 in
> `@opentui/core/Renderable.d.ts` (`LayoutOptions`) and `renderables/Box.d.ts` — same sets in both versions, attested in
> production (claudeup writes `gap={1}` at `ScopeTabs.tsx:20`), absent from the **docs site** only. **Prefer `gap` to
> spacer `<box>`es and `" ".repeat(n)` padding.**

One idiom is OpenTUI's own: **a `flexGrow={1}` box with `border={["top"]}` is a self-sizing horizontal rule**, deleting
all width math (claudish `TabBar.tsx:50-56`). But **borders are solid** — a dashed rule is glyph-repeated in a `<text>`.

**Right-align a group in a one-row header or footer: `justifyContent="space-between"` over TWO row groups.** There is no
`marginLeft="auto"`, and a `" ".repeat(n)` spacer re-breaks at every width. Two consumers derived this independently.

```tsx
<box flexDirection="row" justifyContent="space-between" height={1} paddingX={1}>
  <box flexDirection="row" gap={1}><text fg={tokens.accent}>svcmon</text><text fg={tokens.subtle}>prod</text></box>
  <box flexDirection="row" gap={1}><text fg={tokens.subtle}>3 alerts</text><text fg={tokens.success}>●</text></box>
</box>
```

## Overprint is height starvation — NOT sibling count

> **Bare `<text>` siblings in a `<box>` are legal and lay out normally.** They collapse only when the box is too small
> to hold them: Yoga's default `flexShrink: 1` shrinks starved children toward zero height, two or more land on the same
> `y`, and that row paints **last-wins per cell**.

MEASURED 2026-07-30 via `testRender` + `captureCharFrame()`, three siblings `AAAAAA`/`BB`/`CCCC` — deliberately unequal,
so a merge is distinguishable from a clip. Same in 0.1.107 and 0.4.5.

| `<box>` under test (3 children) | frame | verdict |
|---|---|---|
| no `flexDirection`, with or without `gap` | `AAAAAA` / `BB` / `CCCC` | fine — **absent `flexDirection` means `column`** |
| `flexDirection="column"`, height ≥ 3 rows | 3 rows | fine — same as omitting it |
| `flexDirection="row"`, ± `gap`, ± `height={1}` | `AAAAAA BB CCCC` | fine |
| `gap={1} height={3}` (needs 5) | 3 rows intact | fine — **`gap` collapses before children do** |
| `height={2}` (needs 3) | `BBAAAA` / `CCCC` | **overprint** — 2 of 3 collapse |
| `height={1}` (needs 3) | `CCCCAA` | **overprint** — all 3 collapse |
| `height={1}` **plus `overflow="hidden"`** | `CCCCAA` | **overprint** — `overflow` hides spill, it does not stop the collapse |
| `height={1}`, each child wrapped in its own `<box>` | `BBAAAA` / `CCCC` | **overprint** — not `<text>`-specific |
| `flexDirection="row" width={8}` (too narrow) | `AAA B CC` / `AAA B CC` | not overprint — each child **wraps** |

`CCCCAA` is the tell: `CCCC` over `BB` over `AAAAAA` at one `y`, so the longest tail survives — a clip would have left
one string intact. **`flexDirection` is therefore not a fix for a (0,0) bug; there is no (0,0) bug.** Stop starving the
box, four ways, each measured to hold at `height={1}`:

1. **Give the box the height it needs** — 3 rows for 3 children, 5 with `gap={1}`. Always right.
2. **`flexDirection="row"` for anything conceptually one line.** Three 1-row children then need one row, so a
   single-row box cannot starve them — which is why the badge row `aesthetics-and-color.md` prescribes is safe. **Do not
   defensively wrap each `<text>` in a `<box>`**: row 8 measures a wrapped child overprinting too, so the wrapper costs
   a Yoga node and buys nothing.
3. **`flexShrink={0}` or `minHeight={1}` on each child** — they overflow the box instead of stacking, for when the
   parent's height is genuinely not yours to set.
4. **`<span>`s inside ONE `<text>`** — no siblings at all, per-run colour, one element; why claudish's span:text ratio
   is 549:166. The right default for a styled single-line row.

```tsx
// A row of badges. Bare <text> siblings are correct here — `flexDirection` makes them one row, so the box
// needs exactly the one row it has. No wrapper <box> per badge, no overprint.
<box flexDirection="row" gap={1}>
  <text fg={tokens.success}>GET</text><text fg={tokens.warn}>POST</text><text fg={tokens.error}>DELETE</text>
</box>
```

**The same collapse also arrives from a SIBLING.** A `flexGrow` sibling whose own child is a `<scrollbox>` asks for its
entire content height; Yoga spreads that shortfall over every sibling, so a box sized correctly for its children still
lands at one row and overprints. `flexShrink={0}` on it, `flexBasis={0}` on the grower — measured in SKILL.md, "Filling
the terminal".

## Hooks

MEASURED 2026-07-30 from `@opentui/react/src/hooks/index.d.ts`: **five hooks in 0.1.107, nine in 0.4.5.**

| Hook | 0.1.107 | 0.4.5 | What it gives you |
|---|:--:|:--:|---|
| `useRenderer()` | ✅ | ✅ | the `CliRenderer` — `width`/`height`, `console.show()`, `destroy()` |
| `useKeyboard(handler, { release? })` | ✅ | ✅ | every key event, broadcast to every subscriber |
| `useOnResize((w, h) => …)` | ✅ | ✅ | a side effect on resize; also returns the renderer |
| `useTerminalDimensions()` | ✅ | ✅ | `{ width, height }`, re-renders on change |
| `useTimeline(options?)` | ✅ | ✅ | tween driver for animation |
| `useFocus(h)` / `useBlur(h)` | — | ✅ | **terminal window** gained / lost focus |
| `usePaste(h)` / `useSelectionHandler(h)` | — | ✅ | bracketed paste / mouse selection (needs `selectable` on the `<text>`) |

All import from `@opentui/react`; the **portable subset is the top five** (`versions-and-builds.md` owns the
pin decision). And **`useFocus` is not widget focus** — it fires when the terminal *window* does.

## Keyboard: one worked example

```tsx
import { useKeyboard } from "@opentui/react"; import { useState } from "react"
import { tokens } from "./theme/tokens"

export function ConnectForm({ onConnect }: { onConnect: () => void }) {
  const [focus, setFocus] = useState<"host" | "port">("host")
  useKeyboard((key) => {
    // Tab order is YOURS: no tabIndex, no traversal, no focus trap exists.
    if (key.name === "tab") return setFocus((f) => (f === "host" ? "port" : "host"))
    // Letters arrive LOWERCASE with `shift` separate, so `key.name === "S"` is dead code.
    if (key.name === "s" && key.shift) onConnect()
  })
  return (
    <box flexDirection="column" gap={1} padding={1} border borderColor={tokens.border}>
      {(["host", "port"] as const).map((f) => (
        <box key={f} height={3} border borderColor={focus === f ? tokens.accent : tokens.border}>
          <input placeholder={f} focused={focus === f} />
        </box>
      ))}
    </box>
  )
}
```

**`useKeyboard` is a broadcast, not a focus-routed dispatch.** Every mounted subscriber receives every key — no bubbling,
no `stopPropagation` — so mutual exclusion is hand-rolled in every handler, with guard clauses (`if (state.modal)
return`, claudeup `AliasScreen.tsx:625-632`). Production splits between **centralised** (claudish: two call sites for a
whole app on a mode state machine, `App.tsx:1092-1110`) and **distributed** (claudeup 15, mnemex 24). Default to one
handler per screen plus a guard that bails while a modal or child owns the keys. Both `"enter"` and `"return"` occur, so
test both; `key.raw` carries the literal character.

## Focus is a controlled prop

`focused?: boolean` exists on `box`, `input`, `textarea`, `select`, `scrollbox`, `tab-select` and `line-number`
(MEASURED `types/components.d.ts:38-72`). You own the state — no focus owner, no `tabIndex`, no traversal, no trap.

- `<box>` also takes `focusable` and `focusedBorderColor` (both on `BoxOptions`) so a panel can recolour its own border;
  production hand-rolls the ternary instead (claudish `ProfilesContent.tsx:141-145`). Pick one.
- **`focused` on a `<scrollbox>` decides whether it consumes wheel and key events itself:** `false` when the parent owns
  navigation and an effect syncs scroll position (`RoutingContent.tsx:421-428`), `true` when you want the wheel. In
  inline mode focus-based key delivery is unreliable — drive scrolling from a ref, since imperative `focus()` has no
  documented React path.

## Theme by plain module import

`grep` for `ThemeProvider|ThemeContext|useTheme` across all three production apps returns **zero matches.** All three
import a frozen `as const` object directly (`import { tokens, ramps } from "./theme/tokens"`; mnemex has 20+ such
sites) — one theme per process, so context buys nothing. **Nor scatter hex literals:** claudeup's `theme.colors.dim`
holds `#333333` and `ScreenLayout.tsx` hardcodes it at four call sites, so the token stopped being the source of truth.

## Resize and breakpoints

`useTerminalDimensions()` returns `{ width, height }` and re-renders on change — the declarative route and the right
default; `useOnResize((w, h) => …)` is for a side effect such as recomputing derived chrome. Three production shapes,
cheapest first: **`height="100%"` everywhere, no resize handling** (mnemex `App.tsx:140-146`); **measure at the root and
thread as props** (claudish derives one `contentH` from named chrome constants, `App.tsx:2186` — the column budget
above); **a dimensions context with conditional chrome** (claudeup, `DimensionsContext.tsx:48-65`).

Breakpoints are a branch on `width`, thresholds named in the theme rather than inline (mnemex keeps `minWidth: 80` and
`wideWidth: 120` in `theme.ts:79-85`): given `wide = width >= layout.wideWidth`, a sidebar becomes
`<box flexDirection={wide ? "row" : "column"} gap={1}>` with `minWidth` floors on both children and `flexGrow={1}` on
the body. Screenshot **both** extremes — resize bugs only show at the edges.

## Refs and the reconciler

- **Ref geometry is unpopulated on the first render.** `content.height` and `viewport.height` land after the first layout
  pass; default to the safe branch while the ref is null (`probe-tui-app.tsx:1440-1445`).
- **A scrollbox child's `id` must be content-derived, never positional.** The reconciler keys off `id` while React keys
  off `key`, so a positional `id` desynchronises them (claudeup `AliasScreen.tsx:707-711`). Render every row in and let
  the scrollbox window — the hand-rolled JS windowing it replaced overstruck rows whenever its height drifted from the
  panel (`:674-678`).
- **`scrollTo` is overloaded** — `scrollTo({x, y})` (`RoutingContent.tsx:97`) beside `scrollTo(0)`
  (`probe-tui-app.tsx:1359`) at one installed version. Read your installed `.d.ts`.

Next: `aesthetics-and-color.md` (visual layer), `app-architecture.md` (app shape, async I/O, shutdown),
`components-and-charts.md` (catalogue, 2D drawing).
