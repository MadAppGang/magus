# Testing OpenTUI TUIs
> **Surface: neutral.** This file describes process and measurement. It is bridge site **B3**: React
> snippets mount JSX under test, core snippets drive `createTestRenderer`. No block mixes the two, and no block contains a construct call.

A TUI has two testable surfaces: **behaviour** (does input fold into the right state?) and **appearance**
(do the right cells carry the right colours?). Both run headless under `bun:test` against the **real native
renderer**, terminal I/O bypassed — not a mock. `@opentui/core/testing` exports harness helpers only.

## Two harnesses, one setup object

React trees mount with `testRender(<App />, { width, height })` from `@opentui/react/test-utils`; the core
surface uses `createTestRenderer({ width, height })` from `@opentui/core/testing`. Both return the **same**
setup object, so every helper below works from either — and **options is required on both**.

```tsx
import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
test("renders the header", async () => {
  const s = await testRender(<Dashboard rows={fixture} />, { width: 80, height: 24 })
  try {
    await s.renderOnce()
    expect(s.captureCharFrame()).toContain("Requests")
  } finally { s.renderer.destroy() }
})
```

**`try`/`finally` with `destroy()` is not optional.** A leaked renderer keeps native threads alive: the next
case renders into a live renderer, and `bun test` hangs instead of exiting. And **there is no `rerender()`**
— `testRender()` returns no such function, so the reflex from `@testing-library/react` has nothing to reach
for. Re-render by driving the tree — input, a clock, `s.resize(w, h)` — or mount anew.

**React `act(…)` warnings are expected noise, not a broken setup.** MEASURED 2026-07-30: `bun test
assets/theme` prints one "An update to Root … not wrapped in act(…)" per mount — 44 of them across 51
passing tests, 0 failures. `testRender` drives the reconciler and exposes no `act`; nothing to fix. The
core harness below is the same shape, for imperative trees and for exercising a `Renderable` subclass:

```ts
import { createTestRenderer } from "@opentui/core/testing"
const s = await createTestRenderer({ width: 40, height: 10 })
try { s.renderer.root.add(myRenderable); await s.renderOnce() } finally { s.renderer.destroy() }
```

## Two captures: text, and style

`captureCharFrame()` returns a `string` — text presence, layout, snapshots. `captureSpans()` returns a
`CapturedFrame` for colour, attributes and the cursor, and **takes no arguments** — no `{ rgb: true }`:

```ts
interface CapturedFrame { cols: number; rows: number; cursor: [number, number]; lines: CapturedLine[] }
interface CapturedLine { spans: CapturedSpan[] } // CapturedSpan:
interface CapturedSpan { text: string; fg: RGBA; bg: RGBA; attributes: number; width: number }
```

**`captureCharFrame()` ends with a trailing newline**, so `split("\n")` yields `height + 1` entries and
`rows.at(-1)` is `""` — MEASURED at 10×3: length 4, `at(-1)` `""`, `at(-2)` ten spaces, since rows are
space-padded to full width. Index from the front, drop the last entry, `trimEnd()` before comparing a row.

It also throws styling away, so it can never fail on a colour regression — every colour assertion goes
through `captureSpans().lines[row].spans`. It is a plain string, so `toMatchSnapshot()` works directly; pin
the size, freeze timestamps, use a fixed fixture. The opt-in you reached for is a **separate, real API**:

```ts
import { createTerminalCapabilities, setRendererCapabilities } from "@opentui/core/testing"
setRendererCapabilities(s.renderer, { rgb: true, terminal: { name: "test-terminal" } })
const caps = createTerminalCapabilities({ rgb: true }) // standalone object, if you need one
```

`TerminalCapabilitiesOverrides` is `Partial<Omit<TerminalCapabilities, "terminal">>` plus `terminal?:
Partial<TerminalInfo>`, so pass only the keys you care about. Feature booleans start **disabled** — a
truecolor override belongs here, and only here.

## Assert the aesthetic, don't opine on it

"Is that actually a gradient" is answerable — a meter whose ramp collapsed to three shades passes every text assertion, and this is the test that fails:

```tsx
test("meter fill is a smooth ramp, not three shades", async () => {
  const s = await testRender(<Meter pct={100} width={40} />, { width: 44, height: 3 })
  try {
    await s.renderOnce()
    const spans = s.captureSpans().lines.flatMap((l) => l.spans).filter((sp) => sp.text.trim())
    const distinct = new Set(spans.map((sp) => sp.fg.toInts().join(",")))
    expect(distinct.size).toBeGreaterThanOrEqual(12)
  } finally { s.renderer.destroy() }
})
```

Key colours by `fg.toInts().join(",")` — `RGBA` wraps a buffer, so instances are never `Set`-equal by
identity. The same shape checks a badge's cell width against its label's display width, or a focused panel's
border against an unfocused one — see `assets/theme/widgets.test.tsx` for the full set.

## Input, time, and the rest of the toolkit

| Helper | Use |
|---|---|
| `s.mockInput` | `await typeText("hello")`, `pressKey(KeyCodes.ARROW_LEFT)`, `pressEnter`/`pressEscape`/`pressTab`/`pressBackspace`/`pasteBracketedText`; `shift`/`ctrl`/`meta`/`super`/`hyper` modifiers. Tab cycling and paste are both testable. |
| `s.mockMouse` | `click(x, y)`, `drag(...)`, `scroll(x, y, "down")`, `getCurrentPosition()`, `getPressedButtons()` |
| `ManualClock`† | `setTimeout(fn, 100)`, `advance(99)` → not fired, `advance(1)` → fired. Assert animations instead of sleeping through them. |
| `renderOnce()`, `waitForFrame(p)`†, `flush()`†, `waitForVisualIdle()`† | one pass; then the other three when output settles over several frames |
| `createSpy`, `TestRecorder`, `MockTreeSitterClient` | call recording (`calls`, `callCount()`, `calledWith()`); frame-by-frame animation capture; `<code>`/`<markdown>`/`<diff>` without real highlighting |

Measured exports of `@opentui/core/testing`: `createTestRenderer`, `createTerminalCapabilities`,
`setRendererCapabilities`, `createMockKeys`, `createMockMouse`, `createSpy`, `pasteBytes`, `ManualClock`,
`MockTreeSitterClient`, `TestRecorder`, `KeyCodes`, `MouseButtons`. † **Not in every published line** — check `versions-and-builds.md` before using one in code you may re-pin.

## Checklist

- Options object on every call; every body in `try { … } finally { s.renderer.destroy() }`; no `rerender()`; no arguments passed to `captureSpans`; `rows.at(-1)` of a char frame is `""`.
- At least one **style** assertion per visual component — text-only tests cannot see colour.
- Snapshots at a fixed size, with frozen time and a fixed fixture; a screenshot for anything judged by eye — tests catch regressions, they cannot tell you the design is good (`screenshot-workflow.md`).
