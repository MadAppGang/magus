/**
 * theme/text.ts — display-cell maths OpenTUI does not ship: `text-table-width.ts`
 * is internal, and Yoga measures layout, not the columns a string occupies. All
 * four count TERMINAL DISPLAY COLUMNS, never code units. Surface-neutral: no
 * OpenTUI import in this file.
 *
 * TWO CONTRACTS, and they are deliberately different:
 *
 * - `displayWidth` MEASURES. It reports what a terminal paints, so a control
 *   character costs 0 — that is the oracle's answer and the terminal's.
 * - `truncate` / `padTo` / `padStartTo` PRODUCE. They sanitise first (see
 *   `sanitize`), so their output is always ONE LINE of exactly the columns
 *   claimed. `displayWidth(s)` and `displayWidth(padTo(s, w))` therefore need not
 *   agree for control-bearing `s`, and that is stated here rather than left to be
 *   discovered: a newline costs 0 columns to measure and 1 column to print.
 *
 * ANSI escapes are still NOT accepted — styled text in is a caller bug. It no
 * longer corrupts the layout (the ESC is neutralised to a space, so it cannot move
 * the cursor), but the sequence body prints literally. That is the intended loud
 * failure; do not "fix" it by stripping sequences, which would silently swallow the
 * caller's bug and their colours with it.
 */

/**
 * `Bun.stringWidth` — a native, maintained Unicode width table — is the width
 * oracle whenever it exists, which per this skill's stated support matrix is
 * always. The hand table below is a FALLBACK for a non-Bun runtime, nothing more.
 *
 * Bound through `globalThis` rather than the `Bun` global so this file typechecks
 * when it is copied into a project with no `@types/bun`. Bun's defaults are the
 * ones wanted: `ambiguousIsNarrow` (so `⚠` is 1 column, as every modern terminal
 * paints it) and ANSI excluded from the count.
 */
const NATIVE_WIDTH: ((s: string) => number) | null = (() => {
  const b = (globalThis as { Bun?: { stringWidth?: (s: string) => number } }).Bun
  return typeof b?.stringWidth === "function" ? b.stringWidth.bind(b) : null
})()

/**
 * FALLBACK ONLY — East_Asian_Width Wide/Fullwidth, MINUS the emoji, which
 * `\p{Emoji_Presentation}` covers far better than any literal range can. Sorted and
 * non-overlapping; `isWide` binary-searches it.
 *
 * Splitting the work this way is what fixed the four measured defects at once: the
 * engine's own Unicode tables answer "is this an emoji that defaults to Wide?", so
 * `🌡` and `🖥` (text presentation) stop being force-widened by a block-coarse
 * `[0x1f300, 0x1f9ff]` run, while an explicit range brings in the non-emoji planes
 * that run never covered — Tangut, Nushu, Khitan, Kana Extended.
 *
 * MEASURED 2026-07-30 against `Bun.stringWidth` across all 1,112,064 codepoints:
 * 1,081 disagreements, down from 11,205 for the previous hand table. 749 are lone
 * combining marks and 237 are codepoints this engine's Unicode tables do not know;
 * neither occurs in real text. Only 17 are anything else, 14 of them Unicode 16
 * emoji where the FALLBACK is right and the oracle is behind. `color.test.ts` pins
 * every one of those numbers, so widening a run without a sweep fails the suite.
 */
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x2329, 0x232a],
  [0x2e80, 0x303e], [0x3041, 0x31e3], [0x31e6, 0x3247], [0x3250, 0x33ff],
  [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4], [0x16ff0, 0x16ff1], [0x17000, 0x187f7], [0x18800, 0x18cd5],
  [0x18d00, 0x18d08], [0x1aff0, 0x1aff3], [0x1aff5, 0x1affb], [0x1affd, 0x1affe],
  [0x1b000, 0x1b122], [0x1b132, 0x1b132], [0x1b150, 0x1b152], [0x1b155, 0x1b155],
  [0x1b164, 0x1b167], [0x1b170, 0x1b2fb],
  [0x1f200, 0x1f202], [0x1f210, 0x1f23b], [0x1f240, 0x1f248], [0x1f250, 0x1f251],
  [0x1f260, 0x1f265], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
]

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** U+FE0F VARIATION SELECTOR-16, spelled by codepoint: as a bare literal it is an
 * invisible character in the source, which is how a `includes("…")` test for it
 * survives review while matching nothing. Its sibling U+FE0E (text presentation)
 * needs no branch — MEASURED against the oracle, it narrows nothing: `⚠︎` is 1
 * because `⚠` already is, and `⛔︎` stays 2 because U+26D4 is intrinsically Wide. */
const VS16 = "\uFE0F"

/** Zero-width in the fallback: format characters (`Cf`) — U+00AD SOFT HYPHEN,
 * U+200B ZERO WIDTH SPACE, U+200D ZWJ, U+FEFF. The previous table had no notion of
 * these at all and billed each one a column. Anchored, because it classifies a
 * grapheme cluster by the codepoint that STARTS it. */
const LEADING_FORMAT = /^\p{Cf}/u

/** Wide in the fallback, part two: emoji whose default presentation is Wide. This
 * is the engine's own table, so it tracks Unicode releases without an edit here. */
const LEADING_EMOJI_PRESENTATION = /^\p{Emoji_Presentation}/u

/** C0, DEL and C1. Every one is unprintable, and three of them actively wreck a
 * frame: `\n` breaks the row, `\t` advances to an unknowable tab stop, ESC can
 * reposition the cursor anywhere on screen. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

/**
 * THE CONTROL-CHARACTER CONTRACT for everything that returns a string: every C0
 * control, DEL and every C1 control is REPLACED BY ONE SPACE. Not stripped, not
 * rejected.
 *
 * - Not rejected, because these functions render whatever a log line contains, and
 *   a tab in a log line must not throw inside a render loop.
 * - Not stripped, because deleting `\n` fuses the words either side of it
 *   (`"a\nbc"` → `"abc"`), which reads as a different message. One space keeps the
 *   boundary and costs exactly one predictable column.
 * - One rule with no exceptions, so the guarantee is total: the output of
 *   `truncate`, `padTo` and `padStartTo` can never contain a newline, a tab or an
 *   ESC, and `Bun.stringWidth(padTo(s, w)) === w` holds for EVERY `s`.
 *
 * `.replace` with a `/g` regex is used unconditionally — `CONTROL.test()` as a
 * fast-path guard would be a stateful-`lastIndex` bug that skips every other call.
 */
const sanitize = (s: string): string => s.replace(CONTROL, " ")

/**
 * THE NUMERIC CONTRACT for every column count in this file: floored to whole
 * columns, clamped at 0, and NON-FINITE THROWS.
 *
 * Fractional is tolerated because it is a legitimate computation — `width / 3`
 * across a flex row — and half a column cannot be painted, so flooring is the only
 * answer and it cannot be wrong. Non-finite is never a legitimate computation: it
 * means the caller's arithmetic already broke, every column downstream is garbage,
 * and there is no honest value to return. `padTo("abcdef", NaN)` used to answer six
 * columns and `padTo("abcdef", Infinity)` used to throw a `RangeError` from
 * `String.repeat` naming neither the function nor the argument. Both now fail at
 * the boundary, loudly, pointing at the caller.
 *
 * Note this governs WIDTHS only. A `splitCells` PART is a datum, not a dimension,
 * and keeps its documented "negative/NaN/Infinity → 0" rule: a missing measurement
 * sensibly contributes nothing, whereas a missing dimension has no sensible value.
 */
function columns(n: number, fn: string, arg = "width"): number {
  if (!Number.isFinite(n)) throw new RangeError(`${fn}: ${arg} must be a finite number, got ${n}`)
  return Math.max(0, Math.floor(n))
}

/** Binary search over `WIDE`. Linear `.some()` was fine at 18 runs and is not at 37:
 * this runs once per grapheme on the fallback path. */
function isWide(cp: number): boolean {
  let lo = 0
  let hi = WIDE.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [a, b] = WIDE[mid]!
    if (cp < a) hi = mid - 1
    else if (cp > b) lo = mid + 1
    else return true
  }
  return false
}

/** Fallback width of ONE grapheme cluster, classified by the codepoint that starts
 * it plus a VS16 check. Exported for the test that measures the fallback against
 * the oracle — without a way to reach it, the fallback would ship unmeasured on
 * the one runtime that never runs the oracle. */
export function fallbackClusterWidth(cluster: string): number {
  const cp = cluster.codePointAt(0) ?? 0
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || LEADING_FORMAT.test(cluster)) return 0
  return isWide(cp) || LEADING_EMOJI_PRESENTATION.test(cluster) || cluster.includes(VS16) ? 2 : 1
}

/**
 * Columns `s` occupies. `Bun.stringWidth` answers this directly and correctly; the
 * loop below is the fallback for a runtime without it and counts GRAPHEME CLUSTERS,
 * so a cluster costs the same however many code units it spans.
 *
 * Either way: controls and format characters are 0, a ZWJ sequence counts as its
 * base cluster (one emoji = 2), Wide/Fullwidth and U+FE0F-forced emoji presentation
 * are 2, everything else printable is 1. Both paths are grapheme-additive — summing
 * per cluster equals measuring the whole string — which is what lets `truncate`
 * clip cluster by cluster and still land on the width it promises.
 */
export function displayWidth(s: string): number {
  if (NATIVE_WIDTH) return NATIVE_WIDTH(s)
  let w = 0
  for (const { segment } of seg.segment(s)) w += fallbackClusterWidth(segment)
  return w
}

/**
 * Clip to `width` columns, NEVER WRAP: the last column becomes "…". A wide grapheme
 * that would straddle the edge is dropped whole, never split in half.
 *
 * "Never wrap" is a promise about the OUTPUT, so the input is sanitised first — a
 * returned `"a\n…"` was two rows wearing a one-row width, and it reached `padTo`
 * and `padStartTo` too. Output may be SHORTER than `width` when a wide cluster is
 * dropped (`truncate("日本語", 4)` is 3 columns); it is never longer, and it is
 * never more than one line.
 */
export function truncate(s: string, width: number): string {
  const n = columns(width, "truncate")
  if (n === 0) return ""
  const clean = sanitize(s)
  if (displayWidth(clean) <= n) return clean
  let out = ""
  let w = 0
  for (const { segment } of seg.segment(clean)) {
    const cw = displayWidth(segment)
    if (w + cw > n - 1) break
    out += segment
    w += cw
  }
  return `${out}…`
}

/**
 * Exactly `width` columns: clip if long, pad if short. `displayWidth(padTo(s, w))
 * === w`, always — and so does `Bun.stringWidth(padTo(s, w))`, which is the
 * stronger claim and the one a terminal actually settles.
 *
 * `padEnd()` and `.slice()` are BANNED here — they count UTF-16 code units, so they
 * split surrogate pairs and under-count CJK by half, the exact failure
 * `displayWidth` exists to fix. Build on truncate + displayWidth.
 */
export function padTo(s: string, width: number): string {
  const n = columns(width, "padTo")
  if (n === 0) return ""
  const clean = sanitize(s)
  const clipped = displayWidth(clean) > n ? truncate(clean, n) : clean
  return clipped + " ".repeat(Math.max(0, n - displayWidth(clipped)))
}

/**
 * `padTo`'s mirror: exactly `width` columns with the content flush RIGHT. This is
 * what `aesthetics-and-color.md`'s "right-align numerals and pad to a fixed width"
 * needs — `padTo` left-aligns, so a numeral column padded with it jitters at the
 * decimal point, which is the drift that rule exists to stop.
 *
 * `padStart()` is BANNED here for the same reason as `padEnd()`: it counts UTF-16
 * code units, so `"日本".padStart(6)` adds 4 spaces for a string already 4 columns
 * wide. Built on `truncate` + `displayWidth`, so `displayWidth(padStartTo(s, w)) === w`
 * holds for CJK, combining marks and ZWJ emoji alike.
 *
 * Over-long input clips from the END (`"1234567" → "123…"`), matching `padTo`: keeping
 * the tail instead would print a numeral's low-order digits and read as a smaller
 * number.
 */
export function padStartTo(s: string, width: number): string {
  const n = columns(width, "padStartTo")
  if (n === 0) return ""
  const clean = sanitize(s)
  const clipped = displayWidth(clean) > n ? truncate(clean, n) : clean
  return " ".repeat(Math.max(0, n - displayWidth(clipped))) + clipped
}

/**
 * Apportion `cells` across `parts` by share, LARGEST-REMAINDER rounding, so the
 * result sums to EXACTLY `cells` — naive per-segment rounding leaves a stacked bar
 * a cell short and every column right of it drifts. Precondition
 * `cells >= nonZeroParts`: every non-zero part then gets >= 1 cell, stolen from the
 * largest allocation. Over-subscribed (4 parts into 3 cells) that is dropped — the
 * `cells` largest parts get 1 each, rest 0, sum still `cells`. ALL PARTS ZERO →
 * zeros, sum 0, NOT `cells`.
 *
 * `cells` is a DIMENSION and obeys `columns()`: floored, clamped at 0, non-finite
 * throws. `cells <= 0` → zeros. It used to return `[2, 1]` for two parts and 2.5
 * cells — a sum of 3 from a request for 2.5, breaking the one invariant this
 * function exists to hold — and NaN allocations for NaN or Infinity.
 *
 * `parts` are DATA and are forgiving: negative, NaN and Infinity all read as 0.
 * They are also overflow-safe. `[MAX_VALUE, MAX_VALUE]` overflowed `sum` to
 * Infinity and made every share `Infinity / Infinity` = NaN; dividing through by
 * the largest part first is exact in ratio and lands every share back in 0..1.
 * Shares are then `cells * (p / sum)` and not `(cells * p) / sum`, because the
 * latter overflows on a single part near MAX_VALUE even when `sum` is finite.
 */
export function splitCells(parts: number[], cells: number): number[] {
  const n = columns(cells, "splitCells", "cells")
  const finite = parts.map((p) => (Number.isFinite(p) && p > 0 ? p : 0))
  const out = finite.map(() => 0)
  let safe = finite
  let sum = finite.reduce((a, b) => a + b, 0)
  if (!Number.isFinite(sum)) {
    const max = finite.reduce((a, b) => (b > a ? b : a), 0)
    safe = finite.map((p) => p / max)
    sum = safe.reduce((a, b) => a + b, 0)
  }
  if (n <= 0 || sum <= 0) return out
  const byShare = safe.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p)
  if (n < byShare.filter(({ p }) => p > 0).length) {
    for (const { i } of byShare.slice(0, n)) out[i] = 1
    return out
  }
  const exact = safe.map((p) => n * (p / sum))
  exact.forEach((e, i) => { out[i] = Math.floor(e) })
  const rank = exact.map((e, i) => ({ rem: e % 1, i })).sort((a, b) => b.rem - a.rem)
  for (let k = 0, left = n - out.reduce((a, b) => a + b, 0); left > 0; k++, left--) out[rank[k % rank.length]!.i]! += 1
  for (const { p, i } of byShare) if (p > 0 && out[i] === 0) {
    const d = byShare.reduce((m, c) => (out[c.i]! > out[m]! ? c.i : m), 0)
    if (out[d]! > 1) { out[d]! -= 1; out[i] = 1 }
  }
  return out
}
