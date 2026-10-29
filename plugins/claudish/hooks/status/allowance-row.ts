// Pure layout of the allowance row: the pool's pace and the next six days on one line. A view in,
// styled segments out, fitted to the row's width; the tree builder (allowance.tsx) draws exactly
// these and ends the row with its `[ Show ]` button. No engine interface, no state reference, no
// claudish vocabulary, and no colour but the palette's AllowanceColors.
//
// Only a filled chip carries a backgroundColor: the profile chip, a takeover badge on the ruler,
// and badge K's two halves. Every other segment leaves the terminal's own background. A red ╳
// comes only from claudish's verdict: its alerts (the view's gaps) and blockedNow; never from the
// forecast's pBlocked or its projected blocked runs.

import type { ClaudishAllowanceView, ClaudishAllowanceWindow } from '../../types'
import { SHOW_CELLS, type PaneSegment } from './layout'
import { tint, type AllowanceColors } from './palette'

/** The pace gauge: nine cells, safe pace in the middle, a step per quarter doubling either way. */
export const GAUGE_CELLS = 9
export const GAUGE_CENTRE = 4
/** The ruler's span: now to six days, on a square-root scale. */
export const RULER_HOURS = 144
/**
 * The ruler line's narrowest; narrower than this it is dropped. It has no widest: the line takes
 * every column the row has left (design band.ts: the body spans the band, `[ Show ]` at the edge).
 */
export const RULER_MIN = 12
/** The share badge's minus sign: U+2212, never ASCII `-`. */
export const MINUS = '−'
/** Below this many columns there is no row. */
export const ROW_MIN_COLUMNS = 20

const HEIGHTS = '▁▂▄▆█'
const TICKS: readonly (readonly [number, string])[] = [[1, '1h'], [6, '6h'], [24, '1d'], [72, '3d']]
const NOW_LABEL = 'now'
const END_LABEL = '6d'
const LABEL_CELLS = NOW_LABEL.length + END_LABEL.length
const HOUR_MS = 3_600_000
/** A mini meter's cells: the window's remaining allowance, in quarters. */
const MINI_CELLS = 4

/** A run of segments' width in cells (every glyph drawn here is one cell wide). */
function width(segments: readonly PaneSegment[]): number {
  let n = 0
  for (const s of segments) n += [...s.text].length
  return n
}

/** One segment per character, each with the same style: a ruler mark is one cell. */
function perCell(text: string, style: Omit<PaneSegment, 'text'>): PaneSegment[] {
  return [...text].map(ch => ({ text: ch, ...style }))
}

/** An account number's colour; numbers past the fourth cycle through the four. */
export function profileColor(n: number, c: AllowanceColors): string {
  return c.profiles[(((n - 1) % c.profiles.length) + c.profiles.length) % c.profiles.length]!
}

// ── the pace gauge and the rate ───────────────────────────────────────────────

/**
 * How far the rate is from safe pace, in gauge steps (−4 … 4, a step per quarter doubling). Null,
 * and no gauge, while either value is missing or not finite, or the safe rate is not positive.
 */
export function gaugeStep(rate: number | null, safe: number | null): number | null {
  if (rate === null || safe === null || !Number.isFinite(rate) || !Number.isFinite(safe) || safe <= 0) return null
  if (rate <= 0) return -GAUGE_CENTRE
  const step = Math.max(-GAUGE_CENTRE, Math.min(GAUGE_CENTRE, Math.round(Math.log2(rate / safe) * 4)))
  return step === 0 ? 0 : step // never -0
}

/** A gauge cell's heat: green across the middle three, amber deepening to the left, yellow → orange → red to the right. */
function heat(i: number, c: AllowanceColors): string {
  const d = Math.abs(i - GAUGE_CENTRE)
  if (d <= 1) return c.ok
  return (i < GAUGE_CENTRE ? c.under : c.over)[d - 2]!
}

/**
 * The gauge (design G4): bars rise away from the centre; the cells from the centre to the pace are
 * lit in their heat, the rest are that heat tinted toward the page. The centre bar stands full only
 * on pace. Nine segments, or none when there is no step.
 */
export function gaugeCells(rate: number | null, safe: number | null, c: AllowanceColors): PaneSegment[] {
  const step = gaugeStep(rate, safe)
  if (step === null) return []
  const pos = GAUGE_CENTRE + step
  return Array.from({ length: GAUGE_CELLS }, (_, i): PaneSegment => {
    const d = Math.abs(i - GAUGE_CENTRE)
    if (d === 0) return { text: pos === GAUGE_CENTRE ? '█' : '▁', color: c.ok, bold: true }
    const lit = (pos < GAUGE_CENTRE && i >= pos && i < GAUGE_CENTRE) || (pos > GAUGE_CENTRE && i <= pos && i > GAUGE_CENTRE)
    return lit ? { text: HEIGHTS[d]!, color: heat(i, c), bold: true } : { text: HEIGHTS[d]!, color: tint(heat(i, c), c, c.tintGauge) }
  })
}

/** A count in three or four characters: 512, 9.4k, 124k, 1.6M. */
export function compact(n: number): string {
  for (const [scale, suffix] of [[1e9, 'G'], [1e6, 'M'], [1e3, 'k']] as const) {
    if (n >= scale) {
      const v = n / scale
      return v >= 10 ? `${Math.round(v)}${suffix}` : `${v.toFixed(1)}${suffix}`
    }
  }
  return `${Math.round(n)}`
}

/** A rate in compute units per hour, without the unit: `124k`, `1.7M`. Rates are cu/h whatever the view's `unit` (the pool's). */
export function rateValue(rate: number): string {
  return compact(Math.max(0, rate))
}

/**
 * The rate (claudish's short burn, per hour) as its value then a dim `/h`. The value takes the
 * colour of the gauge's lit tip, so the two never disagree; plain text inside the safe band or with
 * no gauge. None while the rate is missing or not finite.
 */
export function rateCells(rate: number | null, safe: number | null, c: AllowanceColors): PaneSegment[] {
  if (rate === null || !Number.isFinite(rate)) return []
  const step = gaugeStep(rate, safe)
  const tone = step === null || Math.abs(step) <= 1 ? c.text : heat(GAUGE_CENTRE + step, c)
  return [{ text: rateValue(rate), color: tone, bold: true }, { text: '/h', color: c.dim }]
}

// ── the ruler ─────────────────────────────────────────────────────────────────

/**
 * Badge K (design band.ts, style K): the account's number on its own colour, then `−NN%` (U+2212,
 * the share rounded to a whole percent) on that colour's tint (tintBadge) in the colour itself,
 * all bold, one segment per cell. [] when the share is null, not finite, or rounds below 1 %.
 */
export function kBadgeCells(account: number, lostShare: number | null, c: AllowanceColors): PaneSegment[] {
  const share = lostShare === null || !Number.isFinite(lostShare) ? 0 : Math.round(lostShare * 100)
  if (!(share >= 1)) return []
  const hue = profileColor(account, c)
  return [
    ...perCell(`${account}`, { color: c.chipInk, backgroundColor: hue, bold: true }),
    ...perCell(`${MINUS}${share}%`, { color: hue, backgroundColor: tint(hue, c, c.tintBadge), bold: true }),
  ]
}

/** The ruler cell `hours` from now falls in, on a line `width` cells long (square-root scale). */
export function rulerX(hours: number, width: number): number {
  if (width <= 1 || Number.isNaN(hours)) return 0
  return Math.min(width - 1, Math.max(0, Math.round(Math.sqrt(Math.max(0, hours) / RULER_HOURS) * (width - 1))))
}

/**
 * The hour a ruler cell's middle stands for, never past the horizon: the last cell's middle
 * would otherwise land beyond 6d, outside every gap.
 */
function hourOf(i: number, width: number): number {
  return width <= 1 ? 0 : Math.min(RULER_HOURS, ((i + 0.5) / (width - 1)) ** 2 * RULER_HOURS)
}

/**
 * The ruler line, one segment per cell, `width` cells (the row adds `now` before and `6d` after).
 * Drawn in this order, each taking only free cells: the now-cell ╳ while blockedNow; a takeover
 * badge (the account's number) at each switch; badge K for each account whose next refill throws
 * allowance away (kBadgeCells); the 1h 6h 1d 3d ticks, each needing a free cell on either side and
 * no ╳ under it; then ╳ across each alert's gap, ┈ across a switch window, ━ elsewhere.
 *
 * Badge K is always one contiguous run: its number cells then its `−NN%` cells, side by side,
 * never split by a takeover badge or a ╳. It ends at the right-most cell at or left of its
 * refill's cell (rulerX of the refill) whose whole span is free: no ╳ (blockedNow or a gap cell),
 * no takeover badge, no run placed before it. It also keeps one cell of clearance on both sides:
 * the cell just left of its first cell and the cell just right of its last hold no takeover badge
 * and no earlier run (a ╳, a rule cell or the ruler's edge may sit there), so a `1−30%` run never
 * sits against a `1` takeover badge of the same colour to read as `11−30%`, and two runs never
 * touch. Runs are placed right-most refill first (refills on
 * one cell keep the accounts' order), so each later run lands to the left of the runs already
 * drawn. With no such span (it would run off the left edge) that run is left out whole; a partial
 * run is never drawn. Takeover badges and ╳ keep their cells; the ticks give way to a run.
 */
export function rulerCells(view: ClaudishAllowanceView, now: number, width: number, c: AllowanceColors): PaneSegment[] {
  if (!(width > 0)) return []
  const cells: (PaneSegment | null)[] = Array.from({ length: width }, () => null)
  const hoursTo = (t: number) => (t - now) / HOUR_MS
  const ahead = (h: number) => h > 0 && h <= RULER_HOURS
  const free = (i: number, n: number) => i >= 0 && i + n <= width && cells.slice(i, i + n).every(x => x === null)
  const nothingLeft: PaneSegment = { text: '╳', color: c.bad, bold: true }

  // Where nothing is left: every cell whose hour falls in a gap, and the cell each gap starts in.
  const gap = new Set<number>()
  for (const g of view.gaps) {
    const from = Math.max(0, hoursTo(g.startAt))
    // Unclipped: a gap running past the horizon must still take the 6d-end cell.
    const to = g.endAt === null ? Infinity : hoursTo(g.endAt)
    if (from > RULER_HOURS || to <= from) continue
    gap.add(rulerX(from, width))
    for (let i = 0; i < width; i++) if (hourOf(i, width) >= from && hourOf(i, width) < to) gap.add(i)
  }

  if (view.blockedNow) cells[0] = nothingLeft

  // Every cell a filled chip holds: a takeover badge or a K run. A K run keeps a cell clear of
  // these on both sides, so two chips of one colour never read as one number.
  const chips = new Set<number>()
  for (const s of view.switches ?? []) {
    const h = hoursTo(s.at)
    const text = `${s.account}`
    const i = rulerX(h, width)
    if (ahead(h) && free(i, text.length)) {
      perCell(text, { color: c.chipInk, backgroundColor: profileColor(s.account, c), bold: true }).forEach((seg, k) => {
        cells[i + k] = seg
        chips.add(i + k)
      })
    }
  }

  // Badge K: one contiguous run, never split. Each run ends at the right-most cell, at or left of
  // its refill's cell, where its whole span is free (no ╳, takeover badge or earlier run) and the
  // cell just outside it on each side holds no takeover badge or earlier run; no such span, and
  // that run is left out whole. Runs are placed right-most refill first, so a nearer refill's run
  // sits to the left of a later one's. Ticks are drawn after, so they give way.
  const kRuns: { x: number; run: PaneSegment[] }[] = []
  for (const a of view.accounts) {
    // The refill the lost share is measured at (the band's own slice carries it, T4); else the
    // account's next refill in the forecast, which only the panel's slice carries.
    const lostAt = a.lostAt ?? null
    const refill = lostAt !== null && ahead(hoursTo(lostAt))
      ? { at: lostAt }
      : view.refills.find(r => r.account === a.number && ahead(hoursTo(r.at)))
    const run = kBadgeCells(a.number, a.lostShare, c)
    if (refill === undefined || run.length === 0) continue
    kRuns.push({ x: rulerX(hoursTo(refill.at), width), run })
  }
  kRuns.sort((p, q) => q.x - p.x) // stable: equal cells keep the accounts' order
  const open = (i: number, n: number) =>
    free(i, n) && !Array.from({ length: n }, (_, k) => i + k).some(j => gap.has(j)) && !chips.has(i - 1) && !chips.has(i + n)
  for (const { x, run } of kRuns) {
    for (let end = x; end - run.length + 1 >= 0; end--) {
      const startAt = end - run.length + 1
      if (!open(startAt, run.length)) continue
      run.forEach((seg, k) => {
        cells[startAt + k] = seg
        chips.add(startAt + k)
      })
      break
    }
  }

  for (const [h, label] of TICKS) {
    const i = rulerX(h, width)
    const clear = [...label].every((_, k) => !gap.has(i + k))
    if (free(i - 1, label.length + 2) && clear) perCell(label, { color: c.dim }).forEach((seg, k) => (cells[i + k] = seg))
  }

  const windows = (view.switches ?? []).filter(s => s.soonest < s.latest).map(s => [hoursTo(s.soonest), hoursTo(s.latest)] as const)
  return cells.map((cell, i) => {
    if (cell !== null) return cell
    if (gap.has(i)) return nothingLeft
    const h = hourOf(i, width)
    return { text: windows.some(([lo, hi]) => h >= lo && h < hi) ? '┈' : '━', color: c.rule }
  })
}

// ── the account in use ────────────────────────────────────────────────────────

/** The account in use, by number on its colour: the one filled cell kind outside the ruler. */
export function profileChip(n: number, c: AllowanceColors): PaneSegment {
  return { text: ` ${n} `, color: c.chipInk, backgroundColor: profileColor(n, c), bold: true }
}

/**
 * A window's mini meter: its label, then what is left in quarters: lit green above half, amber at
 * half, red below; the used part in the track colour. None without a window.
 */
export function miniCells(window: ClaudishAllowanceWindow | undefined, c: AllowanceColors): PaneSegment[] {
  if (window === undefined || !Number.isFinite(window.usedFraction)) return []
  const left = Math.round((1 - Math.min(1, Math.max(0, window.usedFraction))) * MINI_CELLS)
  const level = left > 2 ? c.ok : left > 1 ? c.warn : c.bad
  const out: PaneSegment[] = [{ text: window.span === '5h' ? '5h' : 'wk', color: c.dim }]
  if (left > 0) out.push({ text: '▮'.repeat(left), color: level })
  if (left < MINI_CELLS) out.push({ text: '▮'.repeat(MINI_CELLS - left), color: c.track })
  return out
}

// ── the row ───────────────────────────────────────────────────────────────────

/**
 * The allowance row's segments and their width in cells, fitted to `columns` (the row's whole
 * width; the tree adds one space and `[ Show ]` after them, right-aligned at the last column).
 * Left to right: the profile chip, the 5h and week minis, the gauge, the rate, the ruler. The
 * ruler takes every column left (`now` + line + `6d`), so with a ruler `cells` is exactly
 * `columns − SHOW_CELLS − 1`. Short of room, the ruler narrows to 12 cells of line, then goes;
 * then the minis, the chip, the gauge, and last the rate's `/h`; without a ruler `cells` is less.
 * Null while the report is not `ok`, below 20 columns, or when nothing is left to draw.
 */
export function allowanceRow(view: ClaudishAllowanceView, now: number, columns: number, c: AllowanceColors): { segments: PaneSegment[]; cells: number } | null {
  if (view.status !== 'ok' || !(columns >= ROW_MIN_COLUMNS)) return null
  const room = columns - SHOW_CELLS - 1

  const active = view.accounts.find(a => a.active === true)
  const windowOf = (span: ClaudishAllowanceWindow['span']) => active?.windows.find(w => w.span === span)
  let chip: PaneSegment[] = active ? [profileChip(active.number, c)] : []
  let minis = [miniCells(windowOf('5h'), c), miniCells(windowOf('week'), c)].filter(m => m.length > 0)
  let gauge = gaugeCells(view.rate.short, view.rate.safe, c)
  let rate = rateCells(view.rate.short, view.rate.safe, c)
  if (view.blockedNow && rate.length > 0) rate = [{ ...rate[0]!, color: c.bad }, ...rate.slice(1)]

  const parts = () => [chip, ...minis, gauge, rate].filter(p => p.length > 0)
  const used = (ps: PaneSegment[][]) => ps.reduce((n, p) => n + width(p), 0) + Math.max(0, ps.length - 1)
  const join = (ps: PaneSegment[][]) => ps.flatMap((p, i) => (i === 0 ? p : [{ text: ' ' }, ...p]))

  // The ruler first, at every cell left, as long as that is 12.
  const before = parts()
  const line = room - used(before) - (before.length > 0 ? 1 : 0) - LABEL_CELLS
  if (line >= RULER_MIN) {
    const ruler = [{ text: NOW_LABEL, color: c.dim }, ...rulerCells(view, now, line, c), { text: END_LABEL, color: c.dim }]
    const segments = join([...before, ruler])
    return { segments, cells: width(segments) }
  }

  const drops: (() => void)[] = [
    () => (minis = []),
    () => (chip = []),
    () => (gauge = []),
    () => (rate = rate.slice(0, 1)),
  ]
  for (let d = 0; d <= drops.length; d++) {
    const ps = parts()
    if (used(ps) <= room) {
      if (ps.length === 0) return null
      const segments = join(ps)
      return { segments, cells: width(segments) }
    }
    drops[d]?.()
  }
  return null
}
