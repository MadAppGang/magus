/** @jsxImportSource @opentui/react */
/**
 * Render tests for all six widgets and `Panel`. `captureSpans()` takes NO arguments and
 * there is no `{ rgb: true }` opt-in — `CapturedSpan` already carries `fg`/`bg` as `RGBA`.
 * But `renderOnce()` IS mandatory: capture before it and every cell comes back as
 * unpainted U+0A00 filler, which looks like a widget bug and is not one.
 *
 * Colours compare through `toInts()`, not `toString()`: `toString()` rounds to two
 * decimals and adjacent ramp steps differ by ~0.016, enough to collapse two
 * distinct colours into one and silently pass the granularity assertion.
 *
 * AND SOME OF THIS FILE CANNOT ASSERT ON CHARACTERS AT ALL. A squeezed widget leaves a
 * one-column stub of its own BACKGROUND under its neighbour's first letter; a heat row
 * is coloured spaces. `captureCharFrame()` is blind to both, so the layout and heat
 * assertions below read `bg` off spans — a character-level suite passes over a row Yoga
 * has mangled. */
import type { CapturedFrame } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import type { ReactNode } from "react"
import { describe, expect, test } from "bun:test"
import { blendStops } from "./color"
import { displayWidth, padTo } from "./text"
import { ramps, tokens } from "./tokens"
import { Badge, BadgeSpan, fillCells, HeatRow, Meter, Panel, rampFor, Sparkline, StackedBar } from "./widgets"

/** Always destroy in `finally`: a leaked renderer keeps native threads alive and hangs `bun test`. */
async function frame(node: ReactNode, width = 44, height = 6): Promise<CapturedFrame> {
  const { renderOnce, captureSpans, renderer } = await testRender(node, { width, height })
  try {
    await renderOnce()
    return captureSpans()
  } finally {
    renderer.destroy()
  }
}

const spans = (f: CapturedFrame, i: number) => f.lines[i]!.spans
const line = (f: CapturedFrame, i: number) => spans(f, i).map((s) => s.text).join("")
const fgs = (f: CapturedFrame, i: number) => new Set(spans(f, i).map((s) => s.fg.toInts().join()))
const bgs = (f: CapturedFrame, i: number) => new Set(spans(f, i).map((s) => s.bg.toInts().join()))
/** `#rrggbb` as the `"r,g,b"` key `toInts().slice(0, 3).join()` produces, so a colour
 * assertion names its token instead of a magic triple. */
const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join()
/** Rows carrying the panel's own background — i.e. rows the panel actually PAINTED.
 * Unpainted terminal comes back `0,0,0`, which is what an under-sized panel leaves behind. */
const painted = (f: CapturedFrame) => f.lines.filter((l) => l.spans.some((s) => s.bg.toInts().slice(0, 3).join() === rgb(tokens.bgPanel))).length
/** Rows between the panel's top and bottom border — its usable body. */
const bodyRows = (f: CapturedFrame) => f.lines.filter((_, i) => line(f, i).startsWith("│")).length
/** Column of the first cell a widget actually PAINTS — a glyph, or a coloured space.
 * A heat row and a stacked bar paint backgrounds only, so `line().search(/\S/)` reports
 * nothing for them and every margin assertion built on characters would be vacuous. */
function firstPainted(f: CapturedFrame, i = 0): number {
  let col = 0
  for (const s of spans(f, i)) {
    if (s.text.trim() !== "" || s.bg.toInts().slice(0, 3).join() !== "0,0,0") return col
    col += s.width
  }
  return -1
}
/** Columns painted by `colors`, and how many distinct ones landed — the stacked-bar invariant. */
function segs(f: CapturedFrame, i: number, colors: string[]) {
  const keys = new Set(colors.map(rgb))
  const hit = spans(f, i).filter((s) => keys.has(s.bg.toInts().slice(0, 3).join()))
  return { cols: hit.reduce((w, s) => w + s.width, 0), distinct: new Set(hit.map((s) => s.bg.toInts().slice(0, 3).join())).size, min: Math.min(...hit.map((s) => s.width)) }
}

describe("Meter", () => {
  // PASS criterion 1 in mechanical form. A flat one-colour bar scores 1 here, and
  // a four-glyph ░▒▓█ ramp also scores 1 — both fail.
  test("a full 40-wide fill carries >= 12 distinct colours", async () => {
    const f = await frame(<Meter pct={100} width={40} />, 44)
    expect(line(f, 0).startsWith("█".repeat(40))).toBe(true)
    expect(fgs(f, 0).size).toBeGreaterThanOrEqual(12)
  })

  test("still >= 12 distinct at 80 columns", async () => {
    const f = await frame(<Meter pct={100} width={80} />, 84)
    expect(fgs(f, 0).size).toBeGreaterThanOrEqual(12)
  })

  test("pct clamps below 0 and above 100", async () => {
    expect(line(await frame(<Meter pct={-50} width={10} />), 0).startsWith("░".repeat(10))).toBe(true)
    expect(line(await frame(<Meter pct={150} width={10} />), 0).startsWith("█".repeat(10))).toBe(true)
  })

  test("width 0 renders nothing and does not throw", async () => {
    const f = await frame(<Meter pct={50} width={0} />)
    expect(line(f, 0).trim()).toBe("")
  })

  // DEFECT 7. The flagship widget rebuilt its ramp every frame while
  // `app-architecture.md` tells readers to hoist ramps out of render. Reference
  // identity is the whole assertion: `blendStops` returns a fresh array on every call,
  // so a render-body call CANNOT pass this, and a `useMemo` keyed per instance could
  // not share one ramp between two meters either.
  test("the ramp is memoised across calls, keyed on width and on stops", () => {
    const a = rampFor(40, ramps.load)
    expect(rampFor(40, ramps.load)).toBe(a) // same instance, not merely equal
    expect(a).toEqual(blendStops(40, ...ramps.load)) // and still the right ramp
    expect(rampFor(24, ramps.load)).not.toBe(a) // width is part of the key
    expect(rampFor(40, ramps.temperature)).not.toBe(a) // so are the stops
  })

  test("the cache is bounded and stays correct after eviction", () => {
    for (let w = 100; w < 200; w++) rampFor(w, ramps.load) // > 64 entries, evicts the lot
    expect(rampFor(40, ramps.load)).toEqual(blendStops(40, ...ramps.load))
    expect(rampFor(40, ramps.load)).toBe(rampFor(40, ramps.load))
  })

  // DEFECT 8. `Math.max(0, NaN)` is `NaN`, so an unguarded clamp let `filled` become
  // NaN and every `i < filled` go false — a dead sensor painting the exact row a
  // healthy 0% paints. No render assertion can separate those two, which is why the
  // contract is pinned on the extracted helper rather than on the frame.
  test("NaN cannot reach the fill count, and infinities still clamp", () => {
    expect(fillCells(Number.NaN, 10)).toBe(0)
    expect(fillCells(50, 10)).toBe(5)
    expect(fillCells(-50, 10)).toBe(0)
    expect(fillCells(150, 10)).toBe(10)
    expect(fillCells(Number.POSITIVE_INFINITY, 10)).toBe(10) // clamps to 100, not discarded as non-finite
    expect(fillCells(Number.NEGATIVE_INFINITY, 10)).toBe(0)
    expect(fillCells(50, Number.NaN)).toBe(0)
    expect(fillCells(50, 0)).toBe(0)
    expect(fillCells(100, 10.9)).toBe(10) // fractional width floors, never renders a half cell
  })

  // The other half of DEFECT 8, and the half `fillCells` could not fix on its own: the
  // two states painted the SAME ROW. `pct={NaN}` mapped to 0 filled cells and drew a
  // full track — the exact pixels of a healthy 0%. A dead sensor now draws `╌` in
  // `tokens.dead`, so the two differ in glyph AND in brightness (hue alone would fail a
  // greyscale reader, `aesthetics-and-color.md`'s accessibility rule).
  test("a dead sensor and a healthy 0% cannot paint the same row", async () => {
    const dead = await frame(<Meter pct={Number.NaN} width={10} />)
    const idle = await frame(<Meter pct={0} width={10} />)
    expect(line(dead, 0).startsWith("╌".repeat(10))).toBe(true) // unguarded: "░".repeat(10)
    expect(line(idle, 0).startsWith("░".repeat(10))).toBe(true)
    expect(line(dead, 0)).not.toBe(line(idle, 0))
    expect(fgs(dead, 0)).not.toEqual(fgs(idle, 0))
    expect(line(dead, 0)).not.toContain("NaN")
  })

  // DEFECT: `ramp` accepted `[]`. `blendStops` returns `[]` for zero stops, the render
  // painted one cell per ramp entry, and a 10-wide meter painted NOTHING — no glyph, no
  // throw, no way to notice. Two fixes, and this test carries both: the `@ts-expect-error`
  // IS the type-level assertion (tsc fails if `Ramp` ever stops rejecting `[]`), and the
  // frame proves the JS caller the type cannot reach still gets its columns.
  test("an empty ramp is a compile error, and cannot shrink the meter if it reaches here", async () => {
    // @ts-expect-error — `Ramp` is a non-empty tuple; `[]` must not type-check.
    const f = await frame(<Meter pct={100} width={10} ramp={[]} />)
    expect(line(f, 0).startsWith("█".repeat(10))).toBe(true) // unguarded: an empty row
    expect(fgs(f, 0).size).toBeGreaterThanOrEqual(5) // and it fell back to a real ramp, not one flat colour
  })

  test("the painted width follows `width`, never the ramp's length", async () => {
    const f = await frame(<Meter pct={100} width={10} ramp={[tokens.info, tokens.error] as const} />)
    expect(line(f, 0).startsWith("█".repeat(10))).toBe(true) // 2 stops, 10 cells
  })
})

describe("Sparkline", () => {
  test("an empty array renders nothing", async () => {
    expect(line(await frame(<Sparkline values={[]} />), 0).trim()).toBe("")
  })

  test("constant data draws a flat mid-ramp row, never NaN", async () => {
    const f = await frame(<Sparkline values={[7, 7, 7, 7]} />)
    expect(line(f, 0).startsWith("▄▄▄▄")).toBe(true)
  })

  test("a single value renders one glyph", async () => {
    expect(line(await frame(<Sparkline values={[3]} />), 0).trim()).toBe("▄")
  })

  test("a real series spans the glyph range and is one colour", async () => {
    const f = await frame(<Sparkline values={[0, 4, 8]} />)
    expect(line(f, 0).startsWith("▁▅█")).toBe(true)
    expect(fgs(f, 0).size).toBeLessThanOrEqual(2) // the row + the blank remainder
  })

  // DEFECT 8. One NaN used to poison `Math.max`/`Math.min`, make `range` NaN, and send
  // every cell to the fallback mid glyph: `[0, NaN, 8]` rendered "▄▄▄", turning a real
  // series into convincing fake constant data. The range is now taken over the finite
  // samples and the hole is drawn as a hole.
  test("a non-finite sample is a gap and does not flatten the row", async () => {
    const f = await frame(<Sparkline values={[0, Number.NaN, 8]} />)
    expect(line(f, 0).startsWith("▁ █")).toBe(true) // unguarded: "▄▄▄"
  })

  test("Infinity does not poison the range either", async () => {
    const f = await frame(<Sparkline values={[Number.POSITIVE_INFINITY, 1, 2]} />)
    expect(line(f, 0).startsWith(" ▁█")).toBe(true) // unguarded: "▁▁▁"
  })

  test("an all-non-finite series paints no glyph rather than inventing a scale", async () => {
    const f = await frame(<Sparkline values={[Number.NaN, Number.NaN]} />)
    expect(line(f, 0).trim()).toBe("") // unguarded: "▄▄"
  })

  test("one column per sample, gaps included, so a row never shifts", async () => {
    const f = await frame(<Sparkline values={[1, Number.NaN, 3, Number.NaN, 5]} />)
    expect(line(f, 0).slice(0, 5)).toBe("▁ ▅ █") // 1 → floor, 3 → mid-high, 5 → top; range from the finite pair
  })

  // DEFECT: finite input, non-finite arithmetic. `max - min` overflowed to Infinity, so
  // the top sample's `(v - min) / range` was `Infinity / Infinity` → NaN → `SPARK[NaN]`
  // → undefined, and `join("")` erased it without a trace: three samples, TWO columns.
  // That breaks the one-column-per-sample invariant the test above pins, for input a
  // sensor can genuinely produce. The range is halved now, which cannot overflow.
  test("finite extrema cannot overflow the range and swallow a sample", async () => {
    const f = await frame(<Sparkline values={[-Number.MAX_VALUE, 0, Number.MAX_VALUE]} />)
    expect(line(f, 0).slice(0, 3)).toBe("▁▅█") // unguarded: "▁▁ " — the third sample vanished
    expect(line(f, 0).trim().length).toBe(3) // still one column per sample
  })

  test("halving the range does not move any ordinary cell", async () => {
    expect(line(await frame(<Sparkline values={[0, 1, 2, 3, 4, 5, 6, 7]} />), 0).slice(0, 8)).toBe("▁▂▃▄▅▆▇█")
  })
})

// DEFECT 5. The default-visual contract makes a stacked bar the default for a category
// distribution, and `splitCells` — largest-remainder apportionment, the hard part — was
// already shipped and tested with no renderer to use it.
describe("StackedBar", () => {
  const dist = [
    { value: 50, color: tokens.success },
    { value: 30, color: tokens.warn },
    { value: 20, color: tokens.error },
  ]
  const hues = dist.map((s) => s.color)

  test("the segments sum to EXACTLY the bar width, and each category keeps a cell", async () => {
    for (const width of [3, 7, 20, 40]) {
      const f = await frame(<StackedBar segments={dist} width={width} />, 44)
      const s = segs(f, 0, hues)
      expect(s.cols).toBe(width) // no cell lost to rounding, no column drift right of the bar
      expect(s.distinct).toBe(3) // every non-zero category is visible
      expect(s.min).toBeGreaterThanOrEqual(1)
    }
  })

  test("a lopsided distribution still gives the small categories one cell each", async () => {
    const f = await frame(<StackedBar width={20} segments={[
      { value: 1000, color: tokens.success }, { value: 1, color: tokens.warn }, { value: 1, color: tokens.error },
    ]} />)
    expect(segs(f, 0, hues).cols).toBe(20)
    expect(segs(f, 0, hues).distinct).toBe(3)
  })

  test("over-subscribed — 4 categories into 3 cells — is still exactly 3 columns", async () => {
    const f = await frame(<StackedBar width={3} segments={[...dist, { value: 5, color: tokens.info }]} />)
    expect(segs(f, 0, [...hues, tokens.info]).cols).toBe(3)
  })

  test("an all-zero distribution draws a full-width track, not nothing", async () => {
    const f = await frame(<StackedBar width={12} segments={[{ value: 0, color: tokens.success }, { value: 0, color: tokens.warn }]} />)
    expect(line(f, 0).startsWith("░".repeat(12))).toBe(true)
  })

  test("degenerate widths and an empty distribution render nothing, never throw", async () => {
    expect(line(await frame(<StackedBar width={0} segments={dist} />), 0).trim()).toBe("")
    expect(line(await frame(<StackedBar width={-4} segments={dist} />), 0).trim()).toBe("")
    expect(line(await frame(<StackedBar width={Number.NaN} segments={dist} />), 0).trim()).toBe("")
    expect(line(await frame(<StackedBar width={10} segments={[]} />), 0).trim()).toBe("")
  })

  test("NaN and negative values are dropped, not rendered as cells", async () => {
    const f = await frame(<StackedBar width={10} segments={[
      { value: Number.NaN, color: tokens.success }, { value: -5, color: tokens.warn }, { value: 5, color: tokens.error },
    ]} />)
    expect(segs(f, 0, [tokens.error]).cols).toBe(10) // the one real category takes the whole bar
    expect(segs(f, 0, [tokens.success, tokens.warn]).cols).toBe(0)
  })
})

describe("HeatRow", () => {
  test("max <= 0 is guarded — every cell is the ramp floor, no NaN index", async () => {
    const f = await frame(<HeatRow values={[1, 2, 3]} max={0} hue={tokens.error} />)
    expect(line(f, 0).startsWith("   ")).toBe(true)
    expect(bgs(f, 0).size).toBe(2) // one floor colour + the untouched remainder
  })

  test("values above max clamp to the top of the ramp", async () => {
    const f = await frame(<HeatRow values={[10, 999]} max={10} hue={tokens.error} />)
    // Both cells clamp to the same colour, so the capture COALESCES them into one
    // span of width 2 — that coalescing is itself the proof they matched.
    expect(spans(f, 0)[0]!.width).toBe(2)
    expect(spans(f, 0)[0]!.bg.toInts().slice(0, 3)).toEqual([255, 107, 107]) // tokens.error
  })

  test("a real row varies by brightness, in the BACKGROUND", async () => {
    const f = await frame(<HeatRow values={[0, 3, 6, 9]} max={9} hue={tokens.error} />)
    expect(bgs(f, 0).size).toBeGreaterThanOrEqual(5) // 4 distinct cells + remainder
  })

  // DEFECT: one global `max` is right for comparability and wrong for a small row. A
  // `5xx` row peaking at 3% of the `2xx` row lands inside one step of the ramp floor
  // across every column and reads as a DEAD PANEL. `max="row"` is the opt-in; the
  // trade-off it buys is documented on the component and in `aesthetics-and-color.md`.
  test("max=\"row\" spends the whole ramp on the row's own peak", async () => {
    const small = [0, 1, 2, 3]
    const global = await frame(<HeatRow values={small} max={100} hue={tokens.error} />)
    const perRow = await frame(<HeatRow values={small} max="row" hue={tokens.error} />)
    expect(bgs(global, 0).size).toBeLessThanOrEqual(3) // near-black; the panel reads dead
    expect(bgs(perRow, 0).size).toBe(5) // 4 distinct cells + remainder — unguarded: 2
    expect(spans(perRow, 0)[3]!.bg.toInts().slice(0, 3).join()).toBe(rgb(tokens.error)) // peak = full hue
  })

  test("a per-row scale on an all-zero row still draws the floor, never a NaN index", async () => {
    const f = await frame(<HeatRow values={[0, 0, 0]} max="row" hue={tokens.error} />)
    expect(bgs(f, 0).size).toBe(2) // one floor colour + the untouched remainder
  })

  // The empty-input convention, which `HeatRow` alone used to break: it returned an
  // empty `<text>`, and an empty `<text>` is still a flex item that eats a row.
  test("an empty row renders nothing and does not consume a layout row", async () => {
    const f = await frame(
      <box flexDirection="column">
        <HeatRow values={[]} max={10} hue={tokens.error} />
        <text fg={tokens.text}>after</text>
      </box>,
    )
    expect(line(f, 0).startsWith("after")).toBe(true) // unguarded: row 0 blank, "after" pushed to row 1
  })
})

// ONE CONVENTION FOR EMPTY INPUT, ASSERTED ACROSS ALL FOUR DATA WIDGETS, because the
// cost of the odd one out is silent: a dashboard row that moves by one depending on
// WHICH series happens to be empty. `null`, not an empty `<text>`.
describe("empty input", () => {
  const empties: Array<[string, ReactNode]> = [
    ["Meter", <Meter pct={50} width={0} />],
    ["Sparkline", <Sparkline values={[]} />],
    ["HeatRow", <HeatRow values={[]} max={10} hue={tokens.error} />],
    ["StackedBar", <StackedBar segments={[]} width={10} />],
  ]
  for (const [name, widget] of empties) {
    test(`${name} renders nothing and occupies no row`, async () => {
      const f = await frame(
        <box flexDirection="column">{widget}<text fg={tokens.text}>after</text></box>,
      )
      expect(line(f, 0).startsWith("after")).toBe(true)
    })
  }
})

describe("Badge", () => {
  test("a CJK + emoji label occupies displayWidth(label) + 2 columns", async () => {
    const label = "日本 OK 🔥"
    const f = await frame(<Badge label={label} bg={tokens.success} />)
    expect(spans(f, 0)[0]!.width).toBe(displayWidth(label) + 2)
  })

  test("pickInk produces a legible pair — dark ink on the bright fill", async () => {
    const f = await frame(<Badge label="OK" bg={tokens.success} />)
    const chip = spans(f, 0)[0]!
    expect(chip.fg.toInts().slice(0, 3)).toEqual([17, 17, 27]) // tokens.ink
    expect(chip.bg.toInts().slice(0, 3)).toEqual([46, 204, 113]) // tokens.success
  })

  // DEFECT 6. `Badge` is a `<text>`, and a `<text>` cannot nest in a `<text>` — so on
  // every log line and service row (all of which are ONE `<text>` by the overprint
  // rule) the chip had to be re-inlined by hand. The span form composes; this is the
  // row that could not be built before.
  test("BadgeSpan shares one <text> with other content, and only its own cells carry the fill", async () => {
    const f = await frame(
      <text><BadgeSpan label="WARN" bg={tokens.warn} /><span fg={tokens.text}> disk 82%</span></text>,
    )
    expect(line(f, 0).startsWith(" WARN  disk 82%")).toBe(true)
    const chip = spans(f, 0)[0]!
    expect(chip.width).toBe(displayWidth("WARN") + 2)
    expect(chip.bg.toInts().slice(0, 3).join()).toBe(rgb(tokens.warn))
    expect(chip.fg.toInts().slice(0, 3).join()).toBe(rgb(tokens.ink))
    expect(spans(f, 0)[1]!.bg.toInts().slice(0, 3).join()).not.toBe(rgb(tokens.warn)) // the fill stops at the chip
  })

  test("Badge and BadgeSpan paint an identical chip — the pair cannot drift", async () => {
    const cell = (s: { text: string; width: number; fg: { toInts(): number[] }; bg: { toInts(): number[] } }) =>
      [s.text, s.width, s.fg.toInts(), s.bg.toInts()]
    const standalone = spans(await frame(<Badge label="OK" bg={tokens.success} />), 0)[0]!
    const inline = spans(await frame(<text><BadgeSpan label="OK" bg={tokens.success} /></text>), 0)[0]!
    expect(cell(inline)).toEqual(cell(standalone))
  })

  test("a CJK + emoji label measures the same in both forms", async () => {
    const label = "日本 OK 🔥"
    const f = await frame(<text><BadgeSpan label={label} bg={tokens.success} /></text>)
    expect(spans(f, 0)[0]!.width).toBe(displayWidth(label) + 2)
  })

  // DEFECT: a fixed-width badge COLUMN. `label={padTo("UP", 6)}` is the obvious way and
  // the wrong one — the padding lands inside `bg`, so 24 `UP` chips down a service list
  // fused into one solid green RECTANGLE with the labels floating in it. `width` pads
  // OUTSIDE the fill: the column still aligns, the fills stay chip-sized.
  test("a badge column pads outside the fill — the chips align without fusing", async () => {
    const f = await frame(
      <box flexDirection="column">
        <text><BadgeSpan label="UP" bg={tokens.success} width={8} /><span fg={tokens.text}>api</span></text>
        <text><BadgeSpan label="DOWN" bg={tokens.error} width={8} /><span fg={tokens.text}>web</span></text>
      </box>,
    )
    expect(line(f, 0).indexOf("api")).toBe(8) // unguarded: 4 — `width` ignored, the column does not align
    expect(line(f, 1).indexOf("web")).toBe(8) // unguarded: 6
    expect(spans(f, 0)[0]!.width).toBe(4) // " UP "   — the fill is the chip, not the column
    expect(spans(f, 1)[0]!.width).toBe(6) // " DOWN "
    expect(spans(f, 0)[1]!.bg.toInts().slice(0, 3).join()).not.toBe(rgb(tokens.success)) // filler is unpainted
  })

  test("padding the label instead is the fused rectangle, and it is measurable", async () => {
    const inside = await frame(<Badge label={padTo("UP", 6)} bg={tokens.success} />)
    const outside = await frame(<Badge label="UP" bg={tokens.success} width={8} />)
    expect(spans(inside, 0)[0]!.width).toBe(8) // 6 padded columns + 2 — a solid block on every row
    expect(spans(outside, 0)[0]!.width).toBe(4) // the same column budget, a quarter of the paint
  })

  test("a width under the chip's own is ignored — a chip is never clipped", async () => {
    const f = await frame(<Badge label="WARN" bg={tokens.warn} width={2} />)
    expect(spans(f, 0)[0]!.width).toBe(6)
    expect(line(f, 0).startsWith(" WARN ")).toBe(true)
  })
})

// THE HIGHEST-PRIORITY DEFERRED DEFECT: `Panel` forwarded layout and the widgets did
// not, so a parent had no way to defend a widget's column budget. The failure is silent
// AND invisible to `captureCharFrame()` — which is why every assertion here reads spans.
describe("layout forwarding", () => {
  /** The measured failure: a service row one column over its box. */
  const row = (chip: ReactNode) => (
    <box width={20} flexDirection="row" overflow="hidden">
      {chip}
      <text fg={tokens.text}>api-gateway-svc</text>
      <text fg={tokens.text}>12ms</text>
    </box>
  )

  test("a row one column over budget cannot squeeze the first widget", async () => {
    const f = await frame(row(<Badge label="UP" bg={tokens.success} />), 30, 3)
    const chip = spans(f, 0)[0]!
    expect(chip.width).toBe(4) // " UP " — unguarded: 3, Yoga took the column off the FIRST child
    expect(chip.bg.toInts().slice(0, 3).join()).toBe(rgb(tokens.success))
    // The tell a character frame cannot show: a 1-column stub of the chip's own fill,
    // sitting under its neighbour's first letter. `" UPa"` reads fine as characters.
    expect(spans(f, 0)[1]!.bg.toInts().slice(0, 3).join()).not.toBe(rgb(tokens.success))
  })

  test("flexShrink={1} opts back in — the default is a choice, not a lock", async () => {
    const f = await frame(row(<Badge label="UP" bg={tokens.success} flexShrink={1} />), 30, 3)
    expect(spans(f, 0)[0]!.width).toBe(3) // shrunk on request, which is the parent's call to make
  })

  test("every widget forwards the same layout props Panel does", async () => {
    const shifted: Array<[string, ReactNode]> = [
      ["Meter", <Meter pct={50} width={6} marginLeft={2} />],
      ["Sparkline", <Sparkline values={[1, 2, 3]} marginLeft={2} />],
      ["HeatRow", <HeatRow values={[1, 2, 3]} max={3} hue={tokens.error} marginLeft={2} />],
      ["StackedBar", <StackedBar segments={[{ value: 1, color: tokens.info }]} width={6} marginLeft={2} />],
      ["Badge", <Badge label="UP" bg={tokens.success} marginLeft={2} />],
    ]
    for (const [, widget] of shifted) expect(firstPainted(await frame(widget))).toBe(2) // unguarded: 0
  })

  test("the style form works too, and minWidth reaches Yoga", async () => {
    const byStyle = await frame(<Meter pct={50} width={6} style={{ marginLeft: 3 }} />)
    expect(firstPainted(byStyle)).toBe(3)
    const held = await frame(
      <box width={10} flexDirection="row" overflow="hidden">
        <Sparkline values={[1, 2, 3]} flexShrink={1} minWidth={3} />
        <text fg={tokens.text}>0123456789</text>
      </box>,
      20, 3,
    )
    expect(line(held, 0).slice(0, 3)).toBe("▁▅█") // minWidth floors the shrink at the full series
  })
})

describe("Panel", () => {
  test("focused toggles borderColor between accent and border", async () => {
    const on = await frame(<Panel title="CPU" focused><text>x</text></Panel>)
    const off = await frame(<Panel title="CPU"><text>x</text></Panel>)
    expect(spans(on, 0)[0]!.fg.toInts().slice(0, 3)).toEqual([137, 180, 250]) // accent
    expect(spans(off, 0)[0]!.fg.toInts().slice(0, 3)).toEqual([69, 71, 90]) // border
  })

  test("a terminal too narrow for the title truncates instead of overflowing", async () => {
    const f = await frame(<Panel title="Utilisation Percent"><text>x</text></Panel>, 10, 5)
    expect(f.cols).toBe(10)
    for (const l of f.lines) expect(l.spans.reduce((w, s) => w + s.width, 0)).toBeLessThanOrEqual(10)
  })

  // DEFECT 1, and the reason a dashboard could not be built from this component: it
  // accepted no layout prop and carried no rest spread, so "the parent owns placement"
  // was unachievable. Both halves of the proof are here — the painted row count with
  // the parent's sizing applied, and the same tree WITHOUT it, which is what shipped.
  const inHeight12 = (panel: ReactNode) => (
    <box height={12} width={40} flexDirection="column">
      <box flexGrow={1}>{panel}</box>
    </box>
  )

  test("a parent can size it: flexGrow fills every row it is given", async () => {
    const f = await frame(inHeight12(<Panel title="CPU" flexGrow={1}><text>x</text></Panel>), 40, 12)
    expect(painted(f)).toBe(12) // 2 border rows + 10 body rows, the whole box
    expect(bodyRows(f)).toBe(10)
  })

  test("without the parent's sizing it is content-sized — 1 body row, the shipped behaviour", async () => {
    const f = await frame(inHeight12(<Panel title="CPU"><text>x</text></Panel>), 40, 12)
    expect(painted(f)).toBe(3) // top border + 1 body row + bottom border
    expect(bodyRows(f)).toBe(1) // 9 rows of terminal left unpainted below it
  })

  test("an explicit height and style={{ flexGrow }} size it too", async () => {
    const byHeight = await frame(inHeight12(<Panel title="CPU" height={8}><text>x</text></Panel>), 40, 12)
    expect(painted(byHeight)).toBe(8)
    expect(bodyRows(byHeight)).toBe(6)
    const byStyle = await frame(inHeight12(<Panel title="CPU" style={{ flexGrow: 1 }}><text>x</text></Panel>), 40, 12)
    expect(painted(byStyle)).toBe(12)
  })

  test("two panels share a row by flexGrow, each full height, chrome intact", async () => {
    const f = await frame(
      <box flexDirection="row" gap={1} flexGrow={1}>
        <Panel title="Load" flexGrow={2}><text>load</text></Panel>
        <Panel title="Log" flexGrow={1}><text>log</text></Panel>
      </box>,
      40, 8,
    )
    expect(painted(f)).toBe(8)
    expect(line(f, 0).startsWith("╭─Load")).toBe(true)
    expect(line(f, 0)).toContain("╭─Log")
    expect(line(f, 7)).toBe("╰──────────────────────╯ ╰─────────────╯") // 2:1 minus the gap
  })

  test("sizing does not let a call site change the chrome", async () => {
    const f = await frame(inHeight12(<Panel title="CPU" flexGrow={1} focused><text>x</text></Panel>), 40, 12)
    expect(spans(f, 0)[0]!.fg.toInts().slice(0, 3).join()).toBe(rgb(tokens.accent))
    expect(line(f, 0).startsWith("╭")).toBe(true) // still rounded, still one border style
    expect(bgs(f, 1)).toContain(`${rgb(tokens.bgPanel)},255`)
  })
})
