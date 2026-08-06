# Components & Charts

> **Surface: `@opentui/react` (JSX).** Every snippet is React. Lowercase intrinsics only —
> `<text>`, `<box>`, `<span>`. Never `Text({…})`, never `<Box>`.

## 18 documented components ≠ 20 JSX intrinsics

Split file — the catalogue is React, the 2D half declares its own gate. The docs list **18** component
pages; the React catalogue holds **20** intrinsics: 13 elements plus 7 text modifiers (`<b> <strong> <i>
<em> <u> <a href> <br>`). Not the same set — and the gap is what you can type.

| JSX tag | Reach for it when |
|---|---|
| `<box>` | any panel — `border`, `borderStyle`, `title`, `titleAlignment`, `bottomTitle`. **4 styles only:** `single`, `double`, `rounded`, `heavy` |
| `<text>`, `<span>` | any label; nest `<span fg=… bg=…>` chunks for multi-colour inside one `<text>`. `attributes={createTextAttributes({…})}` accepts exactly eight optional booleans — **`bold` `italic` `underline` `dim` `blink` `inverse` `hidden` `strikethrough`** (MEASURED `core/utils.d.ts:2`, identical in both pins). Pass several keys in ONE call; never OR two calls together. Siblings there: `attributesWithLink`, `getLinkId` |
| `<scrollbox>` | tailing log panel — `stickyScroll` + `stickyStart="bottom"`, `viewportCulling`, `rootOptions` for border/title |
| `<select>`, `<tab-select>`, `<input>`, `<textarea>` | keyboard list (`Up`/`k`, `Down`/`j`, `Enter`); tab strip (`Left`/`[`, `Right`/`]`); one-line field; multi-line editor with a full cursor, selection and undo API |
| `<code>`, `<markdown>`, `<diff>`, `<line-number>` | tree-sitter highlighting (`syntaxStyle` required, `streaming` to append live); rendered markdown; `view="unified" \| "split"`; gutter + error marks (`setLineColor`, `setLineSign`) |
| `<ascii-font>` | hero number — 7 fonts, and `color` accepts an **array** for a free vertical gradient |

**`stickyStart` is inert without `stickyScroll`.** The constructor gates it (`if (stickyStart &&
stickyScroll)`); `recalculateBarProps` re-applies it only while `_stickyScroll` is set. MEASURED, 12 rows
into a height-6 box: `stickyStart="bottom"` **alone shows rows 00-05 — the top**; adding `stickyScroll` shows
06-11, the tail. Border/title go on `rootOptions`, which frames the viewport instead of scrolling away.
Rest of `ScrollBoxOptions` (extends `BoxOptions`): `scrollX`, `scrollY`, `scrollAcceleration`, and the bags `wrapperOptions`, `viewportOptions`, `contentOptions`, `scrollbarOptions`, `vertical`/`horizontalScrollbarOptions`.

```tsx
<scrollbox stickyScroll stickyStart="bottom" viewportCulling height={6}
  rootOptions={{ border: true, title: "logs" }} contentOptions={{ gap: 0 }}>
  {lines.map((l) => <text key={l}>{l}</text>)}
</scrollbox>
```

**Six doc pages have no intrinsic.** `text-table` is imperative-only in the docs' own words ("without
built-in React or Solid component wrappers"), as are `scrollbar`, `slider` and `frame-buffer`.
`time-to-first-draw` ships as an **exported component** (`<TimeToFirstDraw />`), not a tag; `qr-code` lives
in `@opentui/qrcode` with its own `registerQRCode()`. Anything else reaches JSX only if you register it.

## NO BUILT-IN — none of the 18 is a progress bar, gauge, meter, sparkline, spinner or chart

| What you want | Build it with |
|---|---|
| Progress bar, gauge, meter, sparkline, heatmap **row**, badge | one styled `<text>`/`<span>` row → `Meter`, `Sparkline`, `HeatRow`, `Badge` in `assets/theme/widgets.tsx` |
| Spinner, modal, tooltip, sortable grid | swap a glyph on an interval; absolutely-positioned `<box>` with `zIndex`; `<box>` rows in a `<scrollbox>`, tracking `selectedIndex` yourself |
| Bar chart, 2D heatmap, time-series line | genuine 2D — the second half of this file |

**`Slider` is not a meter.** It is an interactive thumb-on-track input with `onChange`: its `viewPortSize`
defaults to `Math.max(1, (max - min) * 0.1)` — a 10%-wide *thumb* — and it has no `fill`, `filled`,
`progress`, value label or `readOnly` prop. No fill fraction means it cannot express "73% complete" as a bar.

## Gaps the docs leave open — do not paper over them

- **Box's props table is not exhaustive** — its own example passes `flexWrap: "wrap"`, which the table
  omits — and the layout page has no props table at all. `gap`/`minWidth`/`flexWrap` work.
- **`Text` documents no wrapping or truncation prop.** `wrapMode` is documented on `code`, `markdown`,
  `textarea` and `text-table`, not on `text` — truncate in app code with `truncate()`.
- **No complete `Select` snippet nor `KeyBinding` shape is published**, though `keyBindings: KeyBinding[]`
  appears on `textarea` and `TabSelectKeyBinding[]` on `tab-select`. Prefer `@opentui/keymap`.

---

## 2D charts

> **⚠ You are leaving the React surface.** Everything below defines a core `Renderable`
> subclass in its own module. It reaches your JSX only through `extend()` + a module
> augmentation (B4). Do not put a construct call and a JSX tag in the same file.

**One row of a computed field → styled `<text>`/`<span>`. Two or more rows → a `Renderable` subclass.**
Gradient meters, sparklines, heatmap **rows**, badges and bars are all single-row, all pure
`<text>`/`<span>`, and all already React components in `assets/theme/widgets.tsx`. **Import them; never
reimplement them, and never "upgrade" one to a frame buffer** — it costs Yoga layout and reflow for nothing
a single row needs. Below is only for multi-row charts, 2D heatmaps, braille density and `colorMatrix`.

### The mount recipe — two files, never one

There is **no `<frame-buffer>` intrinsic.** `extend()` is the mount path — a real export of `@opentui/react`, used by upstream on its own `TimeToFirstDrawRenderable` in exactly this form.

```ts
// src/charts/heatmap-renderable.ts — FILE 1, core only. No JSX in this file.
import { Renderable, RGBA, type OptimizedBuffer, type RenderableOptions, type RenderContext } from "@opentui/core"
import { tokens } from "../theme/tokens"
export type HeatmapOptions = RenderableOptions<HeatmapRenderable> & { rows: number[][]; ramp: string[] }
const INK = RGBA.fromHex(tokens.ink) // module scope: fromHex inside the loop allocates per cell
export class HeatmapRenderable extends Renderable {
  private palette: RGBA[]
  constructor(ctx: RenderContext, private opts: HeatmapOptions) {
    super(ctx, opts)
    this.palette = opts.ramp.map((hex) => RGBA.fromHex(hex)) // ramp from heatRamp(), theme/color.ts
  }
  /** `buffer` is the PARENT's — offset every write by this.x/this.y; coords are absolute. */
  protected renderSelf(buffer: OptimizedBuffer, _deltaTime: number): void {
    const last = this.palette.length - 1
    this.opts.rows.forEach((row, y) => row.forEach((v, x) => buffer.setCell(this.x + x, this.y + y, " ", INK, this.palette[Math.round(v * last)]!)))
  }
}
```

```ts
// src/charts/register.ts — FILE 2, the bridge. Registers the tag and types it.
import { extend } from "@opentui/react"
import { HeatmapRenderable } from "./heatmap-renderable"
extend({ "heat-map": HeatmapRenderable })
declare module "@opentui/react" {
  interface OpenTUIComponents {
    "heat-map": typeof HeatmapRenderable
  }
}
```

Then it is an ordinary lowercase intrinsic, kebab-cased like every multi-word one. Without the `declare
module` block the tag still compiles — `OpenTUIComponents` has an index signature — but its props are `any`.

```tsx
import "./charts/register" // side-effect import, once at app entry
<heat-map rows={rows} ramp={ramp} width={40} height={rows.length} />
```

### The drawing surface

`renderSelf`'s `buffer` and a `FrameBufferRenderable`'s `frameBuffer` are the same type:
`setCell(x, y, char, fg: RGBA, bg: RGBA, attributes?)`, `setCellWithAlphaBlending` (same args, blended),
`drawText(text, x, y, fg, bg?, attributes?)`, `fillRect(x, y, w, h, bg)` — also the only documented clear —
`drawFrameBuffer(destX, destY, source, …)`, `colorMatrix`/`colorMatrixUniform`.

`renderSelf` is `protected` on both base classes, so subclassing is mandatory, and the arity differs.
`Renderable.renderSelf(buffer, deltaTime)` participates in Yoga flex and reflows on resize — **prefer it for
reusable widgets**. `FrameBufferRenderable.renderSelf(buffer)` needs a fixed `width`/`height` in cells and
never sizes to its parent, so wire those to a resize handler. The class is **`FrameBufferRenderable`**; `FrameBuffer` is the file name and the construct. `respectAlpha` defaults to **`false`**.

### Braille packing — snippet, not shipped code

```ts
// 2×4 dots per cell above U+2800 (40×8 cells ⇒ 80×32 pts). Bit order is NOT raster order: sub-rows 0-2 ascend, then sub-row 3 jumps to 0x40/0x80 — the trap.
const DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]] // [subRow][subCol]
const cell = (sy >> 2) * cols + (sx >> 1) // then draw String.fromCharCode(0x2800 | mask[cell])
mask[cell]! |= DOT[sy & 3]![sx & 1]!
```

### Correcting the upstream progress-bar example

`frame-buffer.mdx`'s "Example: Progress bar" takes **one** `color` argument and passes that same value to
every filled cell. No per-cell interpolation means no continuous ramp — a mechanical property of the code,
not a taste call. The loop is fine; the colour argument is the defect:

```diff
- for (let i = 0; i < filled; i++) fb.setCell(x + i, y, "█", color, EMPTY_BG)
+ for (let i = 0; i < filled; i++) fb.setCell(x + i, y, "█", ramp[i]!, EMPTY_BG)
```

`ramp` is a module-scope `blend1D(width, from, to).map((hex) => RGBA.fromHex(hex))`. For a *single* row this function is the wrong tool — use `Meter`. Design half: `aesthetics-and-color.md`.
