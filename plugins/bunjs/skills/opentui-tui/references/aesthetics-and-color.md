# Aesthetics & Colour — dense, colourful OpenTUI dashboards
> **Surface: `@opentui/react` (JSX).** Every snippet is React. Lowercase intrinsics only —
> `<text>`, `<box>`, `<span>`. Never `Text({…})`, never `<Box>`.

The bar to hit: **more colour, more graphs, less text.** The failure mode to design against is not ugliness —
it is **under-baking**: printing `CPU 78%` where the same row could carry a gradient meter, a percentage and a
sparkline. Copy `assets/theme/` in (SKILL.md §3), never retype it; those constants degrade silently in transit.

## The default-visual contract — apply it mechanically, do not deliberate case by case

SKILL.md owns the canonical table; this file owns the elaboration, starting with the component per row: bounded value
(%, ratio) → `<Meter>`; time series → `<Sparkline>`; counts over time × category → `<HeatRow>`; category distribution
→ `<StackedBar>`; discrete status / level / method → `<Badge>`, or `<BadgeSpan>` in a row carrying other text. Free
narrative stays text, and only in a log or detail panel.

## The six rules

1. **Colour is semantic, never decorative.** A colour means one thing app-wide; the moment red is "error"
   here and "selected" there, glanceability dies. A rainbow is not the goal, it is the tell.
2. **Default to the shape, not the number.** The eye reads the bar first; the number labels it. Right-align numerals
   to a fixed width with **`padStartTo`** — `padTo` pads at the *end*, so a numeral column padded with it jitters at
   the decimal point, the exact drift this rule exists to stop.
3. **Blend per cell.** One colour per column via `rampFor(width, stops)` — the memoised `blendStops`,
   never blended in a render body — not four `░▒▓█` glyphs sharing one colour. Fields, not steps.
4. **Less text, checked on the screenshot.** A non-log panel more than about half prose or plain
   numerals is under-visualised. Abbreviate labels (`Mem`, `RX/TX`, `p99`) and let columns explain.
5. **One border style, one accent.** `rounded` *or* `double`, one accent for focus and titles; mixed border styles
   — or padding differing between neighbouring panels — read as broken, not as variety.
6. **Dim the chrome, saturate the signal.** Borders, labels, units and unfocused panels are low-contrast grey;
   data and the focused panel are bright. Contrast needs a quiet frame to work.

## Smooth ramp or discrete buckets? The distinction is not taste

- **Colour encodes POSITION along a fill → smooth ramp.** A meter's gradient, a heat row's brightness.
  Colour is redundant with length, so continuity is the point.
- **Colour encodes a VALUE → discrete buckets.** Latency, temperature band, status. A continuous green→red ramp made
  976 ms, 2519 ms and 4713 ms read as *nearly the same colour*; buckets pick visibly different fills per band. The
  "≥ 12 distinct colours" gate in `color.test.ts` covers case one only.

`theme/color.ts` blends in **sRGB channel space, not a perceptual one**, and says so plainly: a two-stop green→red
blend desaturates through the middle, HSV saturation **0.304** at the midpoint (a muddy `#929e6e`). Hence the
explicit midtone stop in every shipped ramp (min sat across `ramps.load`'s 40 cells: 0.564), and hence buckets.

## The palette

Centralise as tokens, never scatter hex literals in components. Tuned for dark backgrounds and to survive 256-colour
downsampling. **This is the only file that writes the hexes down** — elsewhere, `theme/tokens`.

| Token | Hex | Meaning | Token | Hex | Role |
|---|---|---|---|---|---|
| `fatal` | `#FF5555` | catastrophic | `border` | `#45475A` | panel borders |
| `error` | `#FF6B6B` | recoverable error | `subtle` | `#6C7086` | labels, units |
| `warn` | `#FFB454` | warning | `text` | `#CDD6F4` | body text |
| `info` | `#5AC8FF` | normal / informational | `accent` | `#89B4FA` | focus / titles |
| `debug` | `#8A8FA0` | verbose | `bgPanel` | `#1E1E2E` | panel background |
| `trace` | `#5C6070` | dimmest | `ink` | `#11111B` | text on bright badges |
| `success` | `#2ECC71` | ok / passed | `running` | `#3498DB` | active / healthy |
| `idle` | `#95A5A6` | waiting | `dead` | `#6C7086` | offline |

`dead` and `subtle` share a hex today; keep both names, they mean different things and may diverge. **Gradient stops**
— a `Ramp` is a NON-EMPTY tuple, fed to `rampFor`, never used as buckets — `ramps.load` / `ramps.network`: `#2ECC71 →
#F1C40F → #E74C3C`; `ramps.temperature`: `#3498DB → #2ECC71 → #FF8C00 → #E91E63`. **HTTP methods** (`methods.*`):
`GET #61AFFE` · `POST #49CC90` · `PUT #FCA130` · `PATCH #50E3C2` · `DELETE #F8615C` · `OPTIONS #9013FE`.

**Accessibility.** Differentiate by **brightness and shape**, not hue alone — a badge's label, a meter's fill ratio and
the `╌` of a dead sensor all survive greyscale. `tokens.chromeIntent` uses `RGBA.defaultForeground`/`defaultBackground`,
so chrome follows the user's terminal theme while signal colours stay literal.

## Every visual that matters is ONE ROW of styled text — no canvas, no drawing, no per-pixel anything

| Pattern | React mechanism |
|---|---|
| The six visuals | `<Meter>` `<Sparkline>` `<HeatRow>` `<StackedBar>` `<Badge>` `<BadgeSpan>` — `<span>`s in ONE `<text>`, below |
| Badge row | `<box flexDirection="row" gap={1}>` of bare `<Badge>`s — `gap`, not spacer boxes, and no wrapper `<box>` per chip |
| Horizontal bar chart | one `<text>` per bar inside a `flexDirection="column"` box |
| Status text, log levels | `fg` on the `<text>` or per `<span>`; dim chrome/labels/units via `attributes={createTextAttributes({ dim: true })}` + `tokens.subtle` |
| Panel frame, title, focus ring | `<box>` props only — no drawing at all; tab strip: `<tab-select>` or a badge row |

**The dividing line: one row → styled `<text>`/`<span>`; two or more rows of a computed field → a custom renderable.** Every pattern
above is one row, so a dashboard of meters, sparklines, stacked bars and heat rows never needs one; for genuine 2D (vertical bars,
2D heatmap, line chart, braille) see `components-and-charts.md`.

## The six visuals — and `Panel`, which is chrome rather than a visual

All six ship in `assets/theme/widgets.tsx`, where `FILL`/`TRACK` are `"█"`/`"░"`, `SPARK` is `▁▂▃▄▅▆▇█`, `GAP`/`NODATA`
are `" "`/`"╌"` and `BOLD` is `createTextAttributes({ bold: true })`.

**Two conventions all six keep.** EMPTY INPUT RENDERS `null`, never an empty `<text>` — which is still a flex item and still eats a
row, so an absent heat row shifted the layout while an absent sparkline beside it did not. And each forwards `WidgetLayout` (the
`Panel` layout keys minus `width`/`height`, which here mean CELLS) with **`flexShrink={0}` by default**: MEASURED, a service row one
column over budget let Yoga shave that column off the FIRST child, painting a 3-column `UP` chip plus a 1-column stub of green
background under its neighbour's first letter — and `captureCharFrame()` is blind to a stub of background, so a whole
character-level suite passed over it. Over-budget now overflows and clips at the parent's edge, which is visible and blames the row.

**Gradient meter.** `rampFor` blends the stops to the meter's real width, memoised because a render-body blend
re-derived 40 colours per frame per meter, and falling back to `ramps.load` because `ramp={[]}` used to paint a
ZERO-WIDTH meter. The row is exactly `width` cells whatever the ramp does, and `pct={NaN}` is ABSENT data — a dim `╌`
row, never the `░` row a healthy 0% paints:

```tsx
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
```

**Heat row** — hue fixed per row so it scans as one severity, brightness per column so it reads as magnitude. Colour goes in the
**background** of a space so cells abut into a ribbon. A numeric `max` is a GLOBAL maximum, the only thing that makes brightness
comparable between rows; its cost is a small row going black — a `5xx` row peaking at ~3% of `2xx` sits inside one ramp step of the
floor and reads as a dead panel. `max="row"` opts into a per-row scale: legible per row, NOT comparable across rows, so use it only
where the rows are separate scales and label them as such. One scale, but the small row disappears? Split the panel instead.

```tsx
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
```

**Sparkline** — one colour on purpose: glyph height already encodes magnitude, so a second encoding is noise. The range
covers the FINITE samples only and each non-finite one draws a `GAP` (a space, not `▁`), so one `NaN` can no longer
poison `Math.max`/`Math.min` and flatten every cell to the mid glyph. It is also HALVED, because `max - min` overflows
on finite input: `[-MAX_VALUE, 0, MAX_VALUE]` painted `▁▁`, a sample gone and the row a column short.

```tsx
  for (const v of values) if (Number.isFinite(v)) { max = Math.max(max, v); min = Math.min(min, v) }
  if (max === Number.NEGATIVE_INFINITY) return <text fg={fg} flexShrink={0} {...layout} style={style}>{GAP.repeat(values.length)}</text>
  const half = max / 2 - min / 2
  const mid = SPARK[Math.floor((SPARK.length - 1) / 2)]!
  const top = SPARK.length - 1
  const glyph = (v: number) => SPARK[Math.min(top, Math.max(0, Math.round(((v / 2 - min / 2) / half) * top)))]!
```

**Stacked bar** — the shipped renderer for a category distribution, and a thin one: `splitCells` does the apportionment as a tested
pure function, this draws consecutive `<span bg>` runs in one `<text>`. **Share the cell maths, never the drawing** — two renderers
rounding independently drift by a cell. The row is EXACTLY `width` columns for any input; an all-zero distribution has no shares to
apportion and draws a full TRACK row:

```tsx
  const split = splitCells(segments.map((s) => s.value), cells)
  if (split.reduce((a, b) => a + b, 0) === 0) return <text fg={tokens.border} flexShrink={0} {...layout} style={style}>{TRACK.repeat(cells)}</text>
```

**Badge** — dark ink on a saturated fill, one space of padding each side:
```tsx
  return <text flexShrink={0} {...layout} style={style}><span fg={pickInk(bg)} bg={bg} attributes={BOLD}>{` ${label} `}</span>{badgePad(label, width)}</text>
```
**Pad a badge COLUMN outside the fill, never inside the label.** `<Badge label="UP" bg={…} width={8} />` puts a plain filler `<span>`
after the chip, so the column aligns and the fill stays `displayWidth(label) + 2`. `label={padTo("UP", 6)}` looks identical and is
not — that padding lands inside `bg`, and MEASURED, 24 such `UP` chips down a service list fused into one solid green RECTANGLE with
the labels floating in it. **`BadgeSpan`** is the chip as a `<span>`, because the ONE-`<text>` rule makes `Badge` un-composable:
`<text><BadgeSpan label="WARN" bg={tokens.warn} /><span fg={tokens.text}> disk 82%</span></text>`. Any mixed-content row (a log
line, a service row) takes `BadgeSpan`; `Badge` only in a row of badges.

**Panel** is `<box>` props only, no glyphs: `border`, `borderStyle="rounded"`, `borderColor={focused ? tokens.accent :
tokens.border}`, `backgroundColor={tokens.bgPanel}`, `title`, `titleAlignment="left"`, `flexDirection="column"`,
`overflow="hidden"`, `paddingLeft`/`paddingRight` of 1. The title draws *in* the border, so no header row; `overflow`
stops a long title spilling into its neighbour at 80 columns; no outer margin — the parent owns placement.

Compose a row as `<box flexDirection="row" gap={1} height={1}>` holding a `<text>` label in `padTo(label, 6)`, a
`<Meter width={24} ramp={ramps.load}>`, a `padStartTo`-ed percentage and a `<Sparkline>` — padding every field to a fixed
width keeps columns from drifting as values change, `height={1}` stops a row overprinting its neighbour. MEASURED output
of that tree, two rows in a focused `<Panel title="Load">`, 60×14:

```
╭─Load─────────────────────────────────────────────────────╮
│ CPU    ███████████████████░░░░░ 78%  ▁▃▂█▆               │
│ Mem    ██████████░░░░░░░░░░░░░░ 41%  ▃▃▆▁█               │
╰──────────────────────────────────────────────────────────╯
```

## Colouring a fill: two rules

1. **Fill colours are not foreground colours.** A neon token that reads beautifully as text is harsh as a solid block — desaturate any
   `bg` fill that carries text. **Unless nothing sits on it:** `<span bg>` on spaces has no text to stay legible against, which is why a heat row can use full hue.
2. **Background carries good/bad; foreground stays legible**, and **dual-encode: length relative, colour absolute** — length against the
   run's max is the comparison, colour on an absolute scale is the health, so a fast row reads warm beside a faster one. Signal in the text colour costs contrast and buys nothing.

## Anti-patterns

- A wall of white text with no colour, bars or borders (it looks like `cat` output), or the opposite: decorative rainbow colour with no meaning, exhausting and unreadable at a glance.
- **Numbers where a bar belongs**, and upstream is the trap: the docs' own `frame-buffer.mdx` progress-bar example is a **flat
  one-colour bar**, so following upstream produces this by default — as does a four-glyph `░▒▓█` ramp standing in for a colour ramp. `components-and-charts.md` has the mechanical fix.
- Emoji as the *only* status signal: ambiguous width breaks alignment, and Yoga lays out cells — it cannot fix a glyph measuring 1 in your font and 2 in the reader's.

## What to steal

**gonzo** — severity-over-time heat rows (FATAL…TRACE, one hue per row, columns = time buckets); a 2×2 panel grid; the severity
distribution as one `<StackedBar>`. **btop** — three-point gradient meters, inline panel titles, right-aligned numerals, dim units.
**posting** — HTTP-method badges as the status signal (`methods.*`). **lazygit** — one bright panel.

## Verify by looking

You cannot judge "colourful and dense" from source: render and screenshot in colour (`screenshot-workflow.md`). **Negative control —
a first screenshot showing a single-colour bar or bare numbers is a failure.** Go back to the contract; do not proceed. Two measured
traps a character frame hides: a heat row is coloured *spaces*, and a squeezed widget leaves a one-column stub of background — both
need `captureSpans()` `bg` (`testing.md`) or a colour screenshot.
