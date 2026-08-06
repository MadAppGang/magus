/** @jsxImportSource @opentui/react */
/**
 * theme/widgets.tsx — the six single-row visuals, as React components.
 *
 * Surface: `@opentui/react` (JSX). Lowercase intrinsics only, flat props. Not one
 * construct call appears here and none is needed: every widget below is ONE ROW of
 * styled text, and a `FrameBufferRenderable` would be the wrong tool for all six.
 * (`Panel` is the exception that proves the rule: it is chrome, not a visual — pure
 * `<box>` props, no glyphs of its own.)
 *
 * Two structural rules, both load-bearing. Colour is applied PER CELL, one
 * `<span>` per column — that is what makes a fill read as continuous rather than
 * as four chunky `░▒▓█` steps. And every widget emits ONE `<text>`: sibling
 * `<text>`s inside a box overprint at the same coordinates, `<span>`s inside a
 * single `<text>` do not. Props are hex / `ColorInput`; `RGBA` stays in `./color`.
 *
 * THE COROLLARY of that second rule, and the reason `BadgeSpan` exists: a `<text>`
 * cannot nest inside a `<text>`, so the ONE-`<text>` form is un-composable. Any
 * widget that has to share a row with other content needs a `<span>` variant.
 *
 * TWO CONVENTIONS THE WHOLE FILE KEEPS, because a reader who learns one widget will
 * assume the other three. EMPTY INPUT RENDERS `null` — never an empty `<text>`, which
 * is still a flex item and still eats a row: `HeatRow values={[]}` pushed the row
 * under it down by one while `Sparkline values={[]}` beside it did not, so an absent
 * series moved the layout depending on which widget was absent. And every widget
 * forwards the same layout props a parent may set on a `Panel` — see `WidgetLayout`.
 */
import { createTextAttributes, type ColorInput } from "@opentui/core"
import type { BoxProps, TextProps } from "@opentui/react"
import type { ReactNode } from "react"
import { blendStops, heatRamp, pickInk } from "./color"
import { displayWidth, splitCells } from "./text"
import { ramps, tokens, type Ramp } from "./tokens"

const BOLD = createTextAttributes({ bold: true })
const FILL = "█"
const TRACK = "░"
const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const
/** A non-finite sample in a series. A SPACE, not `▁`: the floor glyph would read as
 * "nearly zero", which is a lie about data that is absent. */
const GAP = " "
/** A meter whose value is absent, one glyph per cell. NOT `TRACK`: a full `░` row is
 * exactly what a healthy 0% paints, so `NaN` painting one made a dead sensor and an
 * idle one pixel-identical. Same lie as `GAP`, a whole row at a time. */
const NODATA = "╌"

/**
 * The layout keys a parent may set on anything in this file — sizing, growth and
 * placement, and deliberately NOTHING that changes how a component looks. Appearance
 * is each component's own API; see `PanelLayout` for why that exclusion is enforced by
 * the type rather than by a convention.
 */
type LayoutKeys =
  | "flexGrow" | "flexShrink" | "flexBasis" | "alignSelf"
  | "minWidth" | "minHeight" | "maxWidth" | "maxHeight"
  | "margin" | "marginX" | "marginY" | "marginTop" | "marginRight" | "marginBottom" | "marginLeft"

/**
 * A DATA WIDGET IS A FLEX ITEM, AND UNTIL IT COULD SAY SO IT WAS AT YOGA'S MERCY.
 * `Panel` forwarded layout from the start; the widgets forwarded nothing, so a parent
 * had no way to defend a widget's column budget. MEASURED, `<box width={20}>` holding a
 * `UP` badge, a service name and a latency — ONE column over budget: Yoga's default
 * `flexShrink: 1` took that column off the FIRST child, painting a 3-column chip (` UP`)
 * plus a 1-column stub of green background sitting under its neighbour's first letter.
 * `captureCharFrame()` shows ` UPapi…` and is BLIND to the stub; only `captureSpans()`
 * sees it, which is why a full character-level suite passed over a mangled row.
 *
 * Hence `flexShrink={0}` as the DEFAULT on every widget here. A widget's `width` is a
 * cell count the caller computed (`react-patterns.md`: widths of data widgets are
 * arithmetic), so a layout that quietly shortens it has broken the caller's maths.
 * Over-budget now overflows and clips at the parent's edge — visible, and attributable
 * to the row rather than to the widget. `flexShrink={1}` opts back in.
 *
 * No `width`/`height` here, unlike `PanelLayout`: these components already take `width`
 * as a CELL COUNT, and one name meaning two things is how a call site ends up meaning
 * neither. Constrain them with `minWidth`/`maxWidth` instead.
 */
export type WidgetLayout = Pick<TextProps, LayoutKeys>

const RAMP_CACHE = new Map<string, readonly string[]>()
const RAMP_CACHE_MAX = 64

/**
 * Memoised `blendStops` — the ramp for `width` cells across `stops`.
 *
 * `app-architecture.md` says to hoist ramps out of render, and `Meter` used to break
 * that rule on its own flagship path: `blendStops(width, ...ramp)` in the render body
 * re-derived 40 colours (40 `parseColor` + 40 `rgbToHex`) on EVERY frame of EVERY
 * meter, for a value that changes only when the terminal resizes. Keyed on
 * `width|stops`, so a dashboard of 20 meters at one width computes one ramp between
 * them all — a per-instance `useMemo` could not do that.
 *
 * NO STOPS FALLS BACK TO `ramps.load` rather than returning `[]`. `blendStops` answers
 * `[]` for zero stops, which is correct for it and catastrophic here: `Meter` painted
 * one cell per ramp entry, so `ramp={[]}` rendered a ZERO-WIDTH meter — the requested
 * width silently gone, no error, no glyph. The `Ramp` type now rejects `[]` at the call
 * site; this is the belt to that braces, for the JS caller the type cannot reach.
 *
 * FIFO-bounded at 64 entries (Map iteration is insertion-ordered), because a drag
 * resize walks through widths and an unbounded cache would keep every one.
 *
 * The returned array is SHARED. Treat it as read-only — the type says so. */
export function rampFor(width: number, stops: readonly string[]): readonly string[] {
  const use = stops.length > 0 ? stops : ramps.load
  const key = `${width}|${use.join(":")}`
  const hit = RAMP_CACHE.get(key)
  if (hit) return hit
  const built: readonly string[] = blendStops(width, ...use)
  if (RAMP_CACHE.size >= RAMP_CACHE_MAX) RAMP_CACHE.delete(RAMP_CACHE.keys().next().value!)
  RAMP_CACHE.set(key, built)
  return built
}

/**
 * Filled cell count for `pct` over `width` — extracted from `Meter` because it is
 * the one part of a meter that can be wrong without looking wrong.
 *
 * `NaN` is the case: `Math.max(0, NaN)` is `NaN`, so an unguarded clamp passes it
 * straight through to `Math.round`, `filled` becomes `NaN`, `i < NaN` is false for
 * every cell, and the meter renders a full-width TRACK — pixel-identical to a healthy
 * 0%. `NaN → 0` here keeps the ARITHMETIC honest for anyone counting cells; it is not
 * on its own enough for the meter, which draws `NODATA` before it ever gets here, so
 * absent data and idle data no longer paint the same row.
 *
 * ±Infinity is NOT lumped in with it: the clamp maps it to 100 / 0, which is the
 * right answer, and `Number.isFinite` would have thrown away a usable value. */
export function fillCells(pct: number, width: number): number {
  const cells = Math.floor(width)
  if (!Number.isFinite(cells) || cells <= 0 || Number.isNaN(pct)) return 0
  return Math.round((Math.min(100, Math.max(0, pct)) / 100) * cells)
}

/**
 * Gradient meter — the workhorse, and the reason `blendStops` exists. `pct` is
 * 0..100 and is clamped; `NaN` is ABSENT DATA and paints a dim `╌` row instead of a
 * track, because a dead sensor that paints a healthy 0% is a lie no reader can catch.
 * `ramp` is gradient STOPS (default `ramps.load`), blended to `width` colours so every
 * filled cell gets its own: colour encodes POSITION along the fill, the case that must
 * be smooth. The painted row is EXACTLY `width` cells — it is driven by the width, never
 * by the ramp's length, so no ramp can change the geometry. `width <= 0`, fractional or
 * non-finite renders nothing rather than throwing.
 */
export function Meter(
  { pct, width, ramp = ramps.load, style, ...layout }:
    WidgetLayout & { pct: number; width: number; ramp?: Ramp; style?: WidgetLayout },
): ReactNode {
  const cells = Math.floor(width)
  if (!Number.isFinite(cells) || cells <= 0) return null
  if (Number.isNaN(pct)) return <text fg={tokens.dead} flexShrink={0} {...layout} style={style}>{NODATA.repeat(cells)}</text>
  const cols = rampFor(cells, ramp)
  const filled = fillCells(pct, cells)
  return (
    <text flexShrink={0} {...layout} style={style}>
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} fg={i < filled ? cols[i]! : tokens.border}>{i < filled ? FILL : TRACK}</span>
      ))}
    </text>
  )
}

/**
 * Inline trend, one row of block glyphs — deliberately ONE colour, because the
 * glyph height already encodes magnitude and a second encoding would only add
 * noise. Empty input renders nothing. Constant data has no range to normalise
 * against, so it draws a flat MID-ramp row instead of dividing by zero.
 *
 * A non-finite sample POISONS a naive min/max: `Math.max(m, NaN)` is `NaN`, so one
 * gap in the series made `range` NaN, sent `range > 0` false, and flattened the whole
 * row to the mid glyph — a real series turned into fake constant data, which is worse
 * than a hole because it looks fine. So the range is taken over the FINITE samples
 * only and each non-finite one draws a `GAP`, keeping one column per sample so a
 * sparkline never shifts under the value beside it. All-non-finite draws a full row of
 * gaps; the series has no scale, and inventing one would be a lie.
 *
 * THE RANGE IS HALVED, and that is not a micro-optimisation: `max - min` OVERFLOWS on
 * finite input. `[-MAX_VALUE, 0, MAX_VALUE]` made it `Infinity`, `(v - min) / range`
 * `NaN` at the top sample, `SPARK[NaN]` `undefined`, and `join("")` swallowed the hole —
 * a three-sample series painted TWO columns (`▁▁`), one sample gone and every column
 * right of it shifted. Halving both sides keeps every intermediate finite (`|v / 2|` is
 * at most `MAX_VALUE / 2`, so the difference cannot overflow) and is exact in binary
 * floating point, so not one cell moves. The index is clamped for the same reason the
 * range is halved: `SPARK[i]!` must not be able to assert a lie. */
export function Sparkline(
  { values, fg = tokens.info, style, ...layout }:
    WidgetLayout & { values: readonly number[]; fg?: ColorInput; style?: WidgetLayout },
): ReactNode {
  if (values.length === 0) return null
  let max = Number.NEGATIVE_INFINITY
  let min = Number.POSITIVE_INFINITY
  for (const v of values) if (Number.isFinite(v)) { max = Math.max(max, v); min = Math.min(min, v) }
  if (max === Number.NEGATIVE_INFINITY) return <text fg={fg} flexShrink={0} {...layout} style={style}>{GAP.repeat(values.length)}</text>
  const half = max / 2 - min / 2
  const mid = SPARK[Math.floor((SPARK.length - 1) / 2)]!
  const top = SPARK.length - 1
  const glyph = (v: number) => SPARK[Math.min(top, Math.max(0, Math.round(((v / 2 - min / 2) / half) * top)))]!
  return (
    <text fg={fg} flexShrink={0} {...layout} style={style}>
      {values.map((v) => (!Number.isFinite(v) ? GAP : half > 0 ? glyph(v) : mid)).join("")}
    </text>
  )
}

/**
 * One heat row: hue FIXED so the row scans as a single severity, brightness per
 * column so the row reads as magnitude over time. Colour goes in the BACKGROUND of
 * a space, so cells abut into a continuous ribbon instead of a run of glyphs.
 *
 * `max` IS THE SCALE, AND THE CHOICE IS THE WHOLE READING OF THE PANEL. A number is a
 * GLOBAL max — the default, and the only way brightness stays comparable between rows.
 * Its cost is real and was measured on a live panel: a `5xx` row peaking at ~10% of the
 * `2xx` row rendered within a step of the ramp floor across every column and read as a
 * dead panel rather than as errors. `max="row"` opts into a PER-ROW scale, where each
 * row spends the full ramp on its own peak — legible per row, and no longer comparable
 * across rows, so a bright `5xx` no longer means "as bad as `2xx` is busy". Use it only
 * where the rows are genuinely separate scales, and say so in the panel's label; if the
 * rows belong on one scale but the small one still disappears, split the panel instead.
 * `max <= 0` (or an all-zero row) draws the ramp floor — never a NaN index.
 */
export function HeatRow(
  { values, max, hue, style, ...layout }:
    WidgetLayout & { values: readonly number[]; max: number | "row"; hue: ColorInput; style?: WidgetLayout },
): ReactNode {
  if (values.length === 0) return null
  const ramp = heatRamp(hue)
  const top = ramp.length - 1
  const cap = max === "row" ? values.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, v) : m), 0) : max
  return (
    <text flexShrink={0} {...layout} style={style}>
      {values.map((v, i) => {
        const t = cap > 0 && Number.isFinite(v) ? Math.min(1, Math.max(0, v / cap)) : 0
        return <span key={i} bg={ramp[Math.round(t * top)]}> </span>
      })}
    </text>
  )
}

/** One category of a `StackedBar`: how much, and in what colour. */
export type BarSegment = { value: number; color: ColorInput }

/**
 * Stacked bar — the default visual for a CATEGORY DISTRIBUTION (gonzo's severity
 * mix, a pass/fail/skip split), and the sixth widget because `name: count` lines are
 * the anti-pattern it replaces.
 *
 * All the difficulty is in the apportionment, which is why `splitCells` is a tested
 * pure function and this is a thin renderer over it: consecutive `<span bg>` runs of
 * spaces in ONE `<text>`, so the segments abut into a continuous ribbon with no
 * seams. Two renderers rounding independently drift by a cell — share the maths,
 * never the drawing.
 *
 * The width invariant is absolute: the painted row is EXACTLY `width` columns for any
 * input, so a bar never shifts the column to its right. `splitCells` guarantees the
 * segments sum to `width` and that every non-zero category keeps at least one cell
 * (down to `width < categories`, where the largest `width` of them get one each).
 * ALL-ZERO is the one case it cannot fill — no shares to apportion — so an empty
 * distribution draws a full-width TRACK row rather than collapsing to nothing. */
export function StackedBar(
  { segments, width, style, ...layout }:
    WidgetLayout & { segments: readonly BarSegment[]; width: number; style?: WidgetLayout },
): ReactNode {
  const cells = Math.floor(width)
  if (!Number.isFinite(cells) || cells <= 0 || segments.length === 0) return null
  const split = splitCells(segments.map((s) => s.value), cells)
  if (split.reduce((a, b) => a + b, 0) === 0) return <text fg={tokens.border} flexShrink={0} {...layout} style={style}>{TRACK.repeat(cells)}</text>
  return (
    <text flexShrink={0} {...layout} style={style}>
      {split.map((n, i) => (n > 0 ? <span key={i} bg={segments[i]!.color}>{" ".repeat(n)}</span> : null))}
    </text>
  )
}

/** A status chip: `label` and `bg` are the chip itself; `width` is the COLUMN it sits
 * in. See `badgePad` — the padding to `width` goes OUTSIDE the fill. */
export type BadgeChip = { label: string; bg: ColorInput; width?: number }

/**
 * Filler columns so a badge can hold a fixed-width COLUMN without growing its fill.
 *
 * PAD OUTSIDE THE CHIP, NEVER INSIDE THE LABEL. `label={padTo("UP", 8)}` looks like the
 * same thing and is not: the padding lands inside `bg`, so every chip paints 10 saturated
 * columns instead of 4. MEASURED on a 24-service list — 24 `UP` chips padded that way
 * stacked into one solid green RECTANGLE running down the panel, no gap between rows to
 * separate them, the labels floating in a field of green. Padding outside keeps each fill
 * at `displayWidth(label) + 2`, so the column still aligns and the fills stay chips.
 *
 * `width` under the chip's own width pads nothing: a chip is never clipped, because half
 * a label (`WAR`) is a worse failure than a column one cell wide. */
function badgePad(label: string, width?: number): ReactNode {
  const pad = Math.max(0, (width ?? 0) - displayWidth(label) - 2)
  return pad > 0 ? <span>{" ".repeat(pad)}</span> : null
}

/**
 * Status chip: dark ink on a saturated fill, one space of padding each side, so
 * the badge occupies `displayWidth(label) + 2` columns — plus plain filler when a
 * `width` is given. Keep the text LABEL — colour alone fails a red/green-blind reader
 * and fails in grayscale.
 */
export function Badge(
  { label, bg, width, style, ...layout }: WidgetLayout & BadgeChip & { style?: WidgetLayout },
): ReactNode {
  return <text flexShrink={0} {...layout} style={style}><span fg={pickInk(bg)} bg={bg} attributes={BOLD}>{` ${label} `}</span>{badgePad(label, width)}</text>
}

/**
 * The same chip as a `<span>`, for a MIXED-CONTENT row — `<Badge>` is a `<text>`, and
 * a `<text>` cannot nest in a `<text>`, so the standalone form can only ever be a row
 * of its own or a cell in a flex row of boxes. Every log line and service row
 * (`[WARN] disk 82%`, `api ● 12ms`) is one `<text>` by the overprint rule, so without
 * this the chip has to be re-inlined by hand at each site — `pickInk(bg)` + `BOLD` +
 * `` ` ${label} ` `` copied out, which is how the ink threshold and the padding drift
 * apart across a codebase.
 *
 *   <text><BadgeSpan label="WARN" bg={tokens.warn} /><span fg={tokens.text}> disk 82%</span></text>
 *
 * Same three props, same two-space padding, same `displayWidth(label) + 2` columns as
 * `Badge`. The pair is spelled out twice rather than shared through a helper so each
 * form reads as one line of JSX; change one, change the other. No layout props: a
 * `<span>` is not a flex item, so its row's `<text>` owns the layout for both. */
export function BadgeSpan({ label, bg, width }: BadgeChip): ReactNode {
  return <><span fg={pickInk(bg)} bg={bg} attributes={BOLD}>{` ${label} `}</span>{badgePad(label, width)}</>
}

/**
 * The layout props a parent may set on a `Panel` — sizing, growth and placement, and
 * deliberately NOTHING that changes how it looks. Appearance is the component's own
 * API (`title`, `focused`); a call site that could pass `borderStyle="double"` or its
 * own `backgroundColor` is a call site that can break "one border style, one accent"
 * app-wide, so those keys are absent by construction and the compiler says so.
 *
 * `style` is narrowed to this same set, so `style={{ flexGrow: 1 }}` works for readers
 * who reach for OpenTUI's style form while `style={{ borderStyle: "double" }}` does not
 * compile. `width`/`height` are here and absent from `WidgetLayout`, which is the one
 * real difference: a panel's width is a box, a widget's `width` is a cell count. */
export type PanelLayout = Pick<BoxProps, LayoutKeys | "width" | "height">

/**
 * Panel chrome — the lazygit/btop focus model. Accent border when focused, dim
 * border otherwise; that contrast is what makes a multi-panel UI navigable. ONE
 * border style across the whole app: mixed styles read as broken. The title is
 * drawn IN the border, so no header row is needed, and `overflow="hidden"` keeps a
 * title or child wider than the panel from spilling into its neighbour on an
 * 80-column terminal. No outer margin — the parent owns placement.
 *
 * "THE PARENT OWNS PLACEMENT" IS A PROMISE THAT HAS TO BE KEPT IN THE PROPS. It was
 * not: the component took `title`, `focused` and `children`, forwarded no layout prop
 * and carried no rest spread, so there was no way for a parent to own anything. The
 * measured cost, at 40×12 with the panel inside a `<box flexGrow={1}>`: the panel
 * sized to its content and painted 3 rows — one body row — leaving 9 rows of unpainted
 * terminal below it, where the same chrome props written out by hand with `flexGrow`
 * painted all 12. A full-screen dashboard cannot be built out of a box that will not
 * grow, and the reader who hits this abandons the component and re-types the chrome.
 *
 * So a parent sizes it exactly as it would size a `<box>` — one flat prop:
 *
 *   <box flexDirection="row" gap={1} flexGrow={1}>
 *     <Panel title="Load" flexGrow={2}>…</Panel>     // 2/3 of the width, full height
 *     <Panel title="Log"  flexGrow={1}>…</Panel>     // 1/3
 *   </box>
 *
 * There is deliberately no default `flexGrow`: growth is placement, placement is the
 * parent's, and a component that grows on its own would balloon a one-row status strip
 * to fill the screen. Pass it, and the panel fills what it is given. The spread sits
 * AFTER the chrome props so sizing always wins, and the layout type cannot reach the
 * chrome to contradict it.
 */
export function Panel(
  { title, focused = false, children, style, ...layout }:
    PanelLayout & { title: string; focused?: boolean; children?: ReactNode; style?: PanelLayout },
): ReactNode {
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={focused ? tokens.accent : tokens.border}
      backgroundColor={tokens.bgPanel}
      title={title}
      titleAlignment="left"
      flexDirection="column"
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
      {...layout}
      style={style}
    >
      {children}
    </box>
  )
}
