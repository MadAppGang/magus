// Pure layout of the forecast panel the allowance row's `[ Show ]` opens: a view in, styled lines
// out, in the order of the approved v12 design (claudish ai-docs/reports/2026-10-27-allowance-band-
// design/forecast-panel.ts): the alert headline, the NEXT SWITCH card, the relay strip, the `next`
// line, SPEED, LEFT NOW, then a legend whose first line is the profile key. The design's "Now on"
// line and an "updated N min ago" note are not drawn: by the user's call they held the top two
// lines and said nothing the sections below do not.
// The panel names accounts by claudish's label, in their profile colour; the band row keeps the
// profile numbers, and the legend's profile key maps one to the other.
// One function per section; each returns [] when the view carries nothing for it, so a part
// claudish does not send (a switch's likelihood curve, who served each past hour, the slower scenario) is
// simply absent, never computed here. No engine interface, no state reference, no colour but the
// palette's AllowanceColors.
//
// Every line fits the panel's columns, because the pane truncates a line that does not with "…":
// a sentence wraps at a word (a duration is one word: `2h 52m` never splits), and a section that
// runs out of room drops a whole column, never part of a number or time. Below COMPACT_COLUMNS
// the panel draws only the headline, NEXT SWITCH in one line, `next` and LEFT NOW's meters.
//
// The same rules as the row (allowance-row.ts): a red ╳ comes only from claudish's verdict (the
// view's gaps and blockedNow), never from the forecast's pBlocked; only a chip or badge cell
// carries a backgroundColor (the profile chips, the relay strip's `unused → lost` tag); the
// design's grey fog behind the predicted half is not painted. allowance.tsx draws these lines;
// register.tsx hands them the state.

import type { ClaudishAllowance, ClaudishAllowanceAccount, ClaudishAllowanceLikelihood, ClaudishAllowancePart, ClaudishAllowanceSwitch, ClaudishAllowanceView, ClaudishAllowanceWindow } from '../../types'
import { MINUS, gaugeCells, profileChip, profileColor, rateCells, rateValue } from './allowance-row'
import { short } from './claudish-source'
import type { PaneLine, PaneSegment } from './layout'
import { tint, type AllowanceColors } from './palette'

const MIN_MS = 60_000
const HOUR_MS = 3_600_000

/** A row label's width: the relay strip's, `next`'s and the speed rows' first column. */
export const LABEL_CELLS = 15
/** The relay strip's label column where LABEL_CELLS leaves no room for its cells: `in use` and a space. */
export const RELAY_LABEL_MIN = 7
/** The indent of the lines under the headline and of the NEXT SWITCH card. */
export const INDENT = '   '
/** A meter (left now, lost) in eighths. */
export const METER_CELLS = 8
/** The speed bar's widest and narrowest: the bar is the graphic, so the words around it go first. */
export const SPEED_CELLS = 36
export const SPEED_MIN = 8
/** The NEXT SWITCH card's widest and narrowest (frame included); narrower than CARD_MIN it is one line. */
export const CARD_MAX = 100
export const CARD_MIN = 40
/** Below this many columns the panel is compact: no card fits, so no relay strip or SPEED either. */
export const COMPACT_COLUMNS = INDENT.length + CARD_MIN
/** The card's time axis at its widest. */
const CARD_AXIS_MAX = 72
/** The relay strip's span: this week's Monday 00:00 (local) to the end of next Monday. */
export const RELAY_DAYS = 8
/** The relay strip's cell, in hours: the finest of these whose cells fit; none fits, no strip. */
export const RELAY_CELL_HOURS: readonly number[] = [1, 2, 3, 4, 6, 8, 12]
/** The alert headline's likelihood dots: pGap in tenths. */
export const LIKELY_DOTS = 10
// LEFT NOW's columns, as the design spaces them.
const LEFT_NAME_CELLS = 10
const LEFT_STATE_CELLS = 9
const LEFT_5H_NOTE_CELLS = 12
const LEFT_WEEK_NOTE_CELLS = 14

/** Every sentence the panel says on its own, so tests and callers name them rather than retype them. */
export const FORECAST_TEXT = {
  waiting: 'Waiting for claudish',
  unsupported: 'Allowance needs claudish 14.5.0 or later',
  insufficient: 'Not enough usage recorded yet',
  blockedNow: 'Codex has nothing left now',
  /** the panel's own slice (the forecast) has not arrived yet */
  pending: 'Asking claudish for the forecast',
  /** the NEXT SWITCH card's title */
  nextSwitch: 'NEXT SWITCH',
  /** LEFT NOW's lost column: the share each account's NEXT refill throws away (forward, claudish's lostAtReset) */
  lostHead: 'LOST AT NEXT REFILL',
  /** the relay strip's tag before a refill that throws allowance away */
  unusedLost: 'unused → lost',
  /** the relay strip's slower-scenario row */
  slower: 'slower',
  /** under it: the slower scenario has no blocked run, or has one */
  slowerNoGap: '→ no gap',
  slowerGap: '→ gap',
} as const

/** The share of demand the slower scenario removes, 1 − factor, as the strip names it: these exactly, else `N%`. */
const LESS_BUSY_FRACTIONS: readonly (readonly [share: number, said: string])[] = [[1 / 3, '⅓'], [1 / 2, '½'], [1 / 4, '¼']]

/** `⅓ less busy` for factor 0.667 (also ½, ¼); any other factor `N% less busy`, N = round((1 − factor)·100). */
export function lessBusyText(factor: number): string {
  const removed = 1 - factor
  const named = LESS_BUSY_FRACTIONS.find(([share]) => Math.abs(removed - share) < 0.005)
  return `${named ? named[1] : `${Math.round(removed * 100)}%`} less busy`
}

/**
 * The marks the legend can explain, each with the legend line (1-2) it sits on; the legend explains
 * only those drawn (drawnMarks). `┼` stands for the switch span `├─┼─┤`.
 */
export const LEGEND: readonly (readonly [mark: LegendMark, text: string, line: 1 | 2])[] = [
  ['▓', 'predicted', 1],
  ['╳', 'nothing left', 1],
  ['┃', 'weekly refill', 1],
  ['◆', '5-hour refill', 1],
  ['┼', 'will switch, likely between', 2],
  ['↻', 'refills in', 2],
  // only where the card's hill marks are bare (their labels did not all fit)
  ['▲', 'soonest · usual · latest', 2],
]
export type LegendMark = '▓' | '╳' | '┃' | '◆' | '┼' | '↻' | '▲'

// ── small parts ───────────────────────────────────────────────────────────────

const text = (t: string, c: AllowanceColors): PaneSegment => ({ text: t, color: c.text })
const strong = (t: string, color: string): PaneSegment => ({ text: t, color, bold: true })
const dim = (t: string, c: AllowanceColors): PaneSegment => ({ text: t, color: c.dim })
const heading = (t: string, c: AllowanceColors): PaneSegment => strong(t, c.text)

/** Segments that look like a legend mark but are not one (the now line, the card's frame): drawnMarks skips them. */
const UNMARKED = new WeakSet<PaneSegment>()
function unmarked(seg: PaneSegment): PaneSegment {
  UNMARKED.add(seg)
  return seg
}

function cells(line: PaneLine): number {
  let n = 0
  for (const part of line) n += [...(typeof part === 'string' ? part : part.text)].length
  return n
}

/** The line padded with spaces to `n` cells (never cut). */
function padTo(line: PaneLine, n: number): PaneLine {
  const gap = n - cells(line)
  return gap > 0 ? [...line, ' '.repeat(gap)] : line
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0
}

/** A share as a percentage: one decimal under 1 %, whole above. */
function percent(share: number): string {
  const p = Math.max(0, share) * 100
  return p > 0 && p < 1 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`
}

/** A meter's colour by its lit eighths: green from half, amber from a quarter, red below (the design's). */
function eighthsColor(eighths: number, c: AllowanceColors): string {
  return eighths >= METER_CELLS / 2 ? c.ok : eighths >= METER_CELLS / 4 ? c.warn : c.bad
}

/** An 8-cell meter: `lit` eighths of █ in `color`, the rest ░ in the dim colour. */
function meter(lit: number, color: string, c: AllowanceColors): PaneSegment[] {
  const n = Math.max(0, Math.min(METER_CELLS, lit))
  const out: PaneSegment[] = []
  if (n > 0) out.push({ text: '█'.repeat(n), color })
  if (n < METER_CELLS) out.push({ text: '░'.repeat(METER_CELLS - n), color: c.dim })
  return out
}

/**
 * A duration from now, as the panel writes every time: `52m`, `7h 52m`, `1d 4h`; `<1m` under a
 * minute; `now` for none or a time already past.
 */
export function untilText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const min = Math.floor(ms / MIN_MS)
  if (min < 1) return '<1m'
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ── flowing a line ────────────────────────────────────────────────────────────

/** A piece of a flowed line: `body` never breaks; `gap` goes before it, except where it starts a line. */
type Atom = { gap: PaneLine; body: PaneLine }

/**
 * `said`'s words as atoms in `style`, the first after `first`. A duration (`2h 52m`, `◆ 2h 52m`,
 * `1d 19h–5d 0h`) stays one atom, so a time is never split across lines.
 */
function words(said: string, style: (t: string) => PaneSegment, first: PaneLine = []): Atom[] {
  const out: string[] = []
  for (const w of said.split(' ').filter(w => w !== '')) {
    const last = out.length - 1
    if (last >= 0 && /(^◆|\d[dhm])$/.test(out[last]!) && /^\d/.test(w)) out[last] += ` ${w}`
    else out.push(w)
  }
  return out.map((w, i) => ({ gap: i === 0 ? first : [' '], body: [style(w)] }))
}

const sameLook = (a: PaneSegment, b: PaneSegment) =>
  a.color === b.color && !!a.bold === !!b.bold && a.backgroundColor === undefined && b.backgroundColor === undefined

/** Neighbouring segments of one look as one segment (a space between two of them included). */
function joined(line: PaneLine): PaneLine {
  const out: PaneLine = []
  line.forEach((part, i) => {
    const prev = out[out.length - 1]
    const next = line[i + 1]
    if (typeof prev === 'object' && typeof part === 'object' && sameLook(prev, part)) out[out.length - 1] = { ...prev, text: prev.text + part.text }
    else if (typeof prev === 'object' && typeof part === 'string' && typeof next === 'object' && sameLook(prev, next)) out[out.length - 1] = { ...prev, text: prev.text + part }
    else out.push(part)
  })
  return out
}

/**
 * `lead` then `atoms`, on as many lines as `columns` needs: an atom that does not fit on the line
 * starts the next one, after `indent`. Nothing is cut; an atom wider than a whole line goes whole
 * on a line of its own.
 */
function flow(lead: PaneLine, atoms: readonly Atom[], columns: number, indent: string | PaneLine): PaneLine[] {
  const start: PaneLine = typeof indent === 'string' ? [indent] : indent
  const out: PaneLine[] = []
  let line: PaneLine = [...lead]
  let fresh = false
  for (const a of atoms) {
    if (fresh) {
      line.push(...a.body)
      fresh = false
    } else if (cells(line) + cells(a.gap) + cells(a.body) <= columns) {
      line.push(...a.gap, ...a.body)
    } else {
      out.push(line)
      line = [...start, ...a.body]
    }
    if (cells(line) >= columns) {
      out.push(line)
      line = [...start]
      fresh = true
    }
  }
  if (!fresh) out.push(line)
  return out.map(joined)
}

/** The account claudish says is in use; undefined when none is (or claudish does not say). */
function activeAccount(view: ClaudishAllowanceView): ClaudishAllowanceAccount | undefined {
  return view.accounts.find(a => a.active === true)
}

/** Account `n`'s label as claudish sends it; null without one (or without the account). */
function labelOf(view: ClaudishAllowanceView, n: number): string | null {
  return view.accounts.find(a => a.number === n)?.label ?? null
}

/**
 * Account `n` named as the design names it in the panel: its label, bold in its profile colour.
 * Without a label, or where the label is wider than `max` cells (a fixed column), its number on
 * its profile chip, as the band shows it.
 */
function accountName(view: ClaudishAllowanceView, n: number, c: AllowanceColors, max: number = Number.POSITIVE_INFINITY): PaneSegment {
  const l = labelOf(view, n)
  return l !== null && [...l].length <= max ? strong(l, profileColor(n, c)) : profileChip(n, c)
}

/** Account `n` on its chip, as the design's NEXT SWITCH card draws it: ` second `; ` 2 ` without a label. */
function accountChip(view: ClaudishAllowanceView, n: number, c: AllowanceColors): PaneSegment {
  const l = labelOf(view, n)
  return l === null ? profileChip(n, c) : { ...profileChip(n, c), text: ` ${l} ` }
}

/** The takeovers ahead (usual time after now), soonest first; [] when claudish reports none. */
export function switchesAhead(view: ClaudishAllowanceView, now: number): ClaudishAllowanceSwitch[] {
  return (view.switches ?? []).filter(s => Number.isFinite(s.at) && s.at > now).sort((a, b) => a.at - b.at)
}

/** The next switch away from the account in use: the first takeover ahead by another account. */
export function nextSwitch(view: ClaudishAllowanceView, now: number): ClaudishAllowanceSwitch | undefined {
  const active = activeAccount(view)?.number
  return switchesAhead(view, now).find(s => s.account !== active)
}

// ── B1 the alert headline ─────────────────────────────────────────────────────

/**
 * The headline: "Codex has nothing left now" while blockedNow, then each of claudish's alerts (the
 * view's gaps), soonest first: `⚠  Codex runs out in X, and stays out for Y.` in the alert's
 * colour (red when critical, amber when warn), `likely` and LIKELY_DOTS dots (pGap in tenths, lit
 * in that colour), then claudish's remedy, bold, on its own indented line; each wrapped at a word
 * to `columns`. [] with neither.
 */
export function gapLines(view: ClaudishAllowanceView, now: number, c: AllowanceColors, columns: number = Number.POSITIVE_INFINITY): PaneLine[] {
  const out: PaneLine[] = []
  if (view.blockedNow) out.push([strong('╳', c.bad), ' ', strong(FORECAST_TEXT.blockedNow, c.bad)])
  for (const g of [...view.gaps].sort((a, b) => a.startAt - b.startAt)) {
    const color = g.level === 'critical' ? c.bad : c.warn
    const toStart = g.startAt - now
    const span = g.endAt !== null
      ? untilText(g.endAt - Math.max(now, g.startAt))
      : g.hours !== null && Number.isFinite(g.hours) ? untilText(g.hours * HOUR_MS) : null
    const head = toStart > 0 ? `Codex runs out in ${untilText(toStart)}` : 'Codex is out now'
    const said = `${head}${span !== null && span !== 'now' ? `, and stays out for ${span}` : ''}.`
    const dots = Math.round(clamp01(g.pGap) * LIKELY_DOTS)
    const likely: PaneLine = [text('likely ', c)]
    if (dots > 0) likely.push({ text: '●'.repeat(dots), color })
    if (dots < LIKELY_DOTS) likely.push({ text: '○'.repeat(LIKELY_DOTS - dots), color: c.dim })
    const atoms = [...words(said, t => strong(t, color)), { gap: ['    '], body: likely }]
    out.push(...flow([strong('⚠', color), '  '], atoms, columns, INDENT))
    if (g.remedy !== '') out.push(...flow([INDENT], words(g.remedy, t => heading(t, c)), columns, INDENT))
  }
  return out
}

// ── B3 the NEXT SWITCH card ───────────────────────────────────────────────────

/** The card's three-row digits (the design's), one 4-cell glyph per character. */
export const BIG_DIGITS: Readonly<Record<string, readonly [string, string, string]>> = {
  '0': ['█▀▀█', '█  █', '█▄▄█'], '1': [' ▄█ ', '  █ ', ' ▄█▄'], '2': ['▀▀▀█', '█▀▀▀', '█▄▄▄'],
  '3': ['▀▀▀█', ' ▀▀█', '▄▄▄█'], '4': ['█  █', '▀▀▀█', '   █'], '5': ['█▀▀▀', '▀▀▀█', '▄▄▄█'],
  '6': ['█▀▀▀', '█▀▀█', '█▄▄█'], '7': ['▀▀▀█', '  █ ', ' █  '], '8': ['█▀▀█', '█▀▀█', '█▄▄█'],
  '9': ['█▀▀█', '▀▀▀█', '▄▄▄█'], '-': ['    ', '▀▀▀ ', '    '],
}

/** `label` (digits and `-`) as three rows of big digits, a space between glyphs; unknown characters are skipped. */
export function bigDigits(label: string): [string, string, string] {
  const glyphs = [...label].map(ch => BIG_DIGITS[ch]).filter((g): g is readonly [string, string, string] => g !== undefined)
  return [0, 1, 2].map(r => glyphs.map(g => g[r]).join(' ')) as [string, string, string]
}

/** The card's axis: a step that gives at most 8 marks, and an end one step past `hours`. */
function axisOf(hours: number): { step: number; end: number } {
  // Capped at 8 × 48 h: a far-future `latest` from claudish otherwise grows the label loop without
  // bound (year 100000 measured 1.6 s per draw). A mark past the end sits at the right edge.
  const h = Math.min(Math.max(0, hours), 8 * 48 - 1)
  for (const step of [1, 2, 3, 6, 12, 24, 48]) {
    const n = Math.floor(h / step) + 1
    if (n <= 8) return { step, end: n * step }
  }
  return { step: 48, end: 8 * 48 }
}

/** A switch's likely range as durations from now, `<soonest>–<latest>`, or one duration when they read the same. */
export function rangeText(s: ClaudishAllowanceSwitch, now: number): string {
  const lo = untilText(s.soonest - now)
  const hi = untilText(s.latest - now)
  return lo === hi ? lo : `${lo}–${hi}`
}

/** The hill's glyphs, by eighths of a row: blank to full. */
const EIGHTHS = ' ▁▂▃▄▅▆▇█'
/** The hill's height in rows of eighths (the design's two: 16 levels). */
export const HILL_ROWS = 2

/**
 * A takeover's likelihood as HILL_ROWS rows of eighths (top row first, trailing blanks trimmed)
 * over `axisCells` columns, on the card axis's x scale: column i stands for the hours from now
 * that round to it (`i × end / (axisCells − 1)` ± half a column), and is as tall as the highest
 * hour of `p` overlapping them (the max, not the sum, so the peak stays full height). A curve of
 * one value (a takeover at a fixed refill) is a spike: one full-height column at its hour. The
 * height is p alone, not scaled by the takeover's probability. null when nothing would show
 * (every column under half an eighth, e.g. the curve lies past the axis).
 */
export function hillRows(likelihood: ClaudishAllowanceLikelihood, now: number, end: number, axisCells: number): string[] | null {
  if (axisCells < 1 || !(end > 0)) return null
  const from = (likelihood.start - now) / HOUR_MS // the first hour's start, in hours from now
  const perCol = axisCells > 1 ? end / (axisCells - 1) : end
  const level = new Array<number>(axisCells).fill(0)
  if (likelihood.p.length === 1) {
    const i = Math.round(Math.min(1, Math.max(0, from) / end) * (axisCells - 1))
    if (from + 1 > -perCol / 2 && from <= end) level[i] = HILL_ROWS * 8
  } else {
    for (let i = 0; i < axisCells; i++) {
      const lo = (i - 0.5) * perCol
      const hi = (i + 0.5) * perCol
      const first = Math.max(0, Math.floor(lo - from))
      const last = Math.min(likelihood.p.length - 1, Math.ceil(hi - from) - 1)
      let peak = 0
      for (let j = first; j <= last; j++) peak = Math.max(peak, clamp01(likelihood.p[j]!))
      level[i] = Math.round(peak * HILL_ROWS * 8)
    }
  }
  if (level.every(l => l === 0)) return null
  return Array.from({ length: HILL_ROWS }, (_, k) => {
    const floor = (HILL_ROWS - 1 - k) * 8
    return level.map(l => EIGHTHS[Math.max(0, Math.min(8, l - floor))]!).join('').trimEnd()
  })
}

/** A window's short label: `5h`, `7d`. */
const SPAN_LABEL = { '5h': '5h', week: '7d' } as const

/** One account's line of the badge table: its number, and per window span, what is left and when it refills. */
type BadgeRow = { n: number; windows: Partial<Record<'5h' | 'week', { left: string; due: string }>> }

/** Account `n` as a badge-table row: each window claudish sends, its whole percent left and the compact time to its refill (`6d6h`, `12m`; '' without a refill ahead). */
function badgeRow(view: ClaudishAllowanceView, n: number, now: number): BadgeRow {
  const account = view.accounts.find(a => a.number === n)
  const windows: BadgeRow['windows'] = {}
  for (const span of ['5h', 'week'] as const) {
    const w = account?.windows.find(x => x.span === span)
    if (w === undefined || !Number.isFinite(w.usedFraction)) continue
    windows[span] = {
      left: `${Math.round((1 - clamp01(w.usedFraction)) * 100)}%`,
      due: w.resetAt !== null && w.resetAt > now ? untilText(w.resetAt - now).replace(' ', '') : '',
    }
  }
  return { n, windows }
}

/**
 * Badge-table rows as lines (the user's), aligned as a table: per row its number chip, ` <n> ` on
 * the solid profile colour in chip ink, bold, padded inside the chip to the widest number; then one
 * column per window span any row has, 5h then 7d, one plain space between two columns, the first
 * straight after the chip. A cell is a two-tone badge: ` <span> ` on the profile colour tinted by
 * tintSegment[0], straight into ` <NN%> <dur> ` tinted by tintSegment[1], both in the text colour,
 * the percent right-aligned and the time left-aligned to the column's widest (no time column when
 * `time` is false or no row has one). A row without the window leaves the cell blank, untinted.
 */
function badgeTable(view: ClaudishAllowanceView, rows: readonly BadgeRow[], time: boolean, c: AllowanceColors): PaneLine[] {
  // By the user's call the rows carry the profile number only (the switch row names them).
  const names = rows.map(r => `${r.n}`)
  const nameCells = Math.max(...names.map(s => [...s].length))
  const columns = (['5h', 'week'] as const).filter(span => rows.some(r => r.windows[span] !== undefined)).map(span => {
    const cellsOf = rows.map(r => r.windows[span]).filter(w => w !== undefined)
    const leftCells = Math.max(...cellsOf.map(w => w.left.length))
    const dueCells = time ? Math.max(0, ...cellsOf.map(w => w.due.length)) : 0
    return { span, leftCells, dueCells, width: ` ${SPAN_LABEL[span]} `.length + 2 + leftCells + (dueCells > 0 ? 1 + dueCells : 0) }
  })
  return rows.map((r, i): PaneLine => {
    const hue = profileColor(r.n, c)
    const line: PaneLine = [{ text: ` ${names[i]!.padEnd(nameCells)} `, color: c.chipInk, backgroundColor: hue, bold: true }]
    columns.forEach((col, k) => {
      if (k > 0) line.push(' ')
      const w = r.windows[col.span]
      if (w === undefined) {
        line.push(' '.repeat(col.width))
        return
      }
      const value = `${w.left.padStart(col.leftCells)}${col.dueCells > 0 ? ` ${w.due.padEnd(col.dueCells)}` : ''}`
      line.push(
        { text: ` ${SPAN_LABEL[col.span]} `, color: c.text, backgroundColor: tint(hue, c, c.tintSegment[0]) },
        { text: ` ${value} `, color: c.text, backgroundColor: tint(hue, c, c.tintSegment[1]) },
      )
    })
    return line
  })
}

/**
 * The two badges beside the digits, the account in use's first (none without one), as one table
 * (badgeTable) fitted to `room` cells: whole, then without the time column, then without the next
 * account's windows, then without the account in use's (the names alone). Each drop applies to the
 * whole table, so the rows stay aligned. Never cut; names alone wider than `room`: no badges.
 */
function badgeLines(view: ClaudishAllowanceView, from: ClaudishAllowanceAccount | undefined, to: number, now: number, room: number, c: AllowanceColors): PaneLine[] {
  const current = from !== undefined ? badgeRow(view, from.number, now) : undefined
  const next = badgeRow(view, to, now)
  const bare = (r: BadgeRow): BadgeRow => ({ n: r.n, windows: {} })
  const stages = [
    { time: true, next: true, current: true },
    { time: false, next: true, current: true },
    { time: false, next: false, current: true },
    { time: false, next: false, current: false },
  ] as const
  for (const st of stages) {
    const rows = [
      ...(current !== undefined ? [st.current ? current : bare(current)] : []),
      st.next ? next : bare(next),
    ]
    const lines = badgeTable(view, rows, st.time, c)
    if (lines.every(l => cells(l) <= room)) return lines
  }
  return []
}

/** Account `n`'s name chip alone, as the badge table draws it: what decides the side column when nothing else is beside the digits. */
function nameChip(view: ClaudishAllowanceView, n: number, c: AllowanceColors): PaneLine {
  return badgeTable(view, [{ n, windows: {} }], false, c)[0]!
}

/**
 * The card's speedometer, as the band draws its pace: the G4 gauge (gaugeCells), a space, the
 * short rate (rateCells, in the colour of the gauge's lit tip), then `safe <rate>` dim. [] while
 * the rate or the safe pace is missing, as the band then draws no gauge.
 */
export function speedometer(view: ClaudishAllowanceView, c: AllowanceColors): PaneSegment[] {
  const { short: rate, safe } = view.rate
  const gauge = gaugeCells(rate, safe, c)
  if (gauge.length === 0 || rate === null || safe === null) return []
  return [...gauge, { text: ' ' }, ...rateCells(rate, safe, c), { text: '  ' }, dim(`safe ${rateValue(safe)}`, c)]
}

/**
 * NEXT SWITCH (design B3), for nextSwitch: a frame in the next account's colour, CARD_MAX wide at
 * most (columns − INDENT), indented. Inside: `NEXT SWITCH  [in use] ━━━━━━━━━▶ [next]` (the
 * accounts' name chips, accountChip, or their number chips where the names do not fit; the first
 * left out without an account in use); then the likely range in hours from now as three-row
 * digits (`soonest-latest h`, one number when they round equal) with, by the user's call, a side
 * column beside them, one line per digit row: the account in use's badge, the next account's
 * (one aligned table, badgeTable, fitted by badgeLines), the speedometer, then `usual: switch in <dur>` under it,
 * all from one column; all under the digits where the speedometer does not fit beside; where the
 * digits themselves do not fit, one line `rangeText` instead, the side under it. Then, over a time axis from `now`, the switch's likelihood hill (hillRows, two rows of
 * eighths: in the next account's colour from soonest to latest, grey outside) where claudish sends
 * a curve, else a range row `├──┼──┤` (soonest, usual, latest); under the axis `soonest ▲`,
 * `▲ usual` (always the usual time, never the hill's peak), `▲ latest` where all three fit, else
 * three bare `▲` the legend explains. The design's speed
 * marks and sentence need speed scenarios claudish does not send; they are not drawn. Narrower
 * than CARD_MIN: switchLine. [] without a next switch.
 */
export function switchCardLines(view: ClaudishAllowanceView, now: number, columns: number, c: AllowanceColors): PaneLine[] {
  const s = nextSwitch(view, now)
  if (s === undefined) return []
  const width = Math.min(CARD_MAX, columns - INDENT.length)
  if (width < CARD_MIN) return switchLine(view, s, now, columns, c)
  const inner = width - 3
  const hue = profileColor(s.account, c)
  const side = (t: string) => unmarked({ text: t, color: hue })
  const out: PaneLine[] = [[INDENT, side(`┏${'━'.repeat(width - 2)}┓`)]]
  const row = (body: PaneLine) => {
    if (cells(body) <= inner) out.push([INDENT, side('┃'), ' ', ...padTo(body, inner), side('┃')])
  }

  const from = activeAccount(view)
  const handOff = (chip: (n: number) => PaneSegment[]): PaneLine => [heading(FORECAST_TEXT.nextSwitch, c), '   ',
    ...(from !== undefined ? [...chip(from.number), ' ', { text: '━━━━━━━━━▶', color: hue }, ' '] : []),
    ...chip(s.account)]
  // Each account a two-tone badge (the user's): its number chip, straight into its name on the
  // profile colour's first tint in the text colour; the number chip alone without a label, and for
  // both where the names do not fit the card.
  const numberAndName = (n: number): PaneSegment[] => {
    const l = labelOf(view, n)
    return [profileChip(n, c), ...(l !== null ? [{ text: ` ${l} `, color: c.text, backgroundColor: tint(profileColor(n, c), c, c.tintSegment[0]) }] : [])]
  }
  const named = handOff(numberAndName)
  row(cells(named) <= inner ? named : handOff(n => [profileChip(n, c)]))
  row([])

  const hoursTo = (t: number) => Math.max(0, (t - now) / HOUR_MS)
  const lo = Math.round(hoursTo(s.soonest))
  const hi = Math.max(lo, Math.round(hoursTo(s.latest)))
  const big = bigDigits(lo === hi ? `${lo}` : `${lo}-${hi}`)
  const digits: PaneLine[] = big.map((r, k) => [{ text: r, color: hue }, ...(k === 2 ? [' ', heading('h', c)] : [])])
  const digitCells = Math.max(...digits.map(cells))
  // The side, both lines starting in one column: the band's speedometer (its pace gauge, the rate in
  // the gauge tip's colour, `safe …` dim; none without a rate and a safe pace) on the digits' bottom
  // row, then the usual time right under it, `usual: switch in <dur>` (none when the usual time is
  // not ahead). Without a speedometer, the usual line takes its place.
  const speedo = speedometer(view, c)
  const usual: PaneLine = Number.isFinite(s.at) && s.at > now ? [dim('usual: switch in ', c), heading(untilText(s.at - now), c)] : []
  const below = [speedo, usual].filter(l => l.length > 0)
  // The side's column: the design's 34 cells of digits, else just past them; neither fits, it goes
  // under. The speedometer and the usual line decide it (the badges give up parts to fit it); with
  // neither, the badges' names do.
  const deciding = below.length > 0
    ? below
    : [nameChip(view, s.account, c), ...(from !== undefined ? [nameChip(view, from.number, c)] : [])]
  const decidingCells = Math.max(0, ...deciding.map(cells))
  const at = decidingCells === 0 ? undefined : [Math.max(34, digitCells + 3), digitCells + 3].find(n => 2 + n + decidingCells <= inner)
  // One badge per digit row, the account in use's first, then the speedometer and the usual line.
  const badges = badgeLines(view, from, s.account, now, at !== undefined && 2 + digitCells <= inner ? inner - 2 - at : inner - 2, c)
  const sideLines = [...badges, ...below]
  if (2 + digitCells > inner) {
    row(['  ', heading(rangeText(s, now), c)])
    for (const l of sideLines) row(['  ', ...l])
  } else if (at !== undefined) {
    digits.forEach((d, k) => {
      const l = sideLines[k]
      row(['  ', ...(l !== undefined ? [...padTo(d, at), ...l] : d)])
    })
    for (const l of sideLines.slice(digits.length)) row(['  ', ' '.repeat(at), ...l])
  } else {
    for (const d of digits) row(['  ', ...d])
    if (sideLines.length > 0) {
      row([])
      for (const l of sideLines) row(['  ', ...l])
    }
  }
  row([])

  // Over a time axis from now: claudish's likelihood hill where it sends one, else the range
  // ├ soonest, ┼ usual, ┤ latest. Both on the axis's x scale.
  const axisCells = Math.min(CARD_AXIS_MAX, inner - 6)
  const { step, end } = axisOf(hoursTo(s.latest))
  const col = (h: number) => Math.round(Math.min(1, h / end) * (axisCells - 1))
  const [a, u, b] = [col(hoursTo(s.soonest)), col(hoursTo(s.at)), col(hoursTo(s.latest))]
  const hill = s.likelihood ? hillRows(s.likelihood, now, end, axisCells) : null
  if (hill !== null) {
    // Inside the likely span (soonest to latest) in the next account's colour; outside it grey (the design's).
    const tone = (i: number) => (i >= a && i <= b ? hue : c.dim)
    for (const r of hill) {
      const segs: PaneSegment[] = []
      ;[...r].forEach((g, i) => {
        const last = segs[segs.length - 1]
        if (last !== undefined && last.color === tone(i)) last.text += g
        else segs.push({ text: g, color: tone(i) })
      })
      row(r === '' ? [] : ['  ', ...segs])
    }
  } else {
    const range: PaneLine = Array.from({ length: b + 1 }, (_, i): PaneLine[number] => {
      if (i === u) return strong('┼', hue)
      if (i < a) return ' '
      return { text: i === a ? '├' : i === b ? '┤' : '─', color: hue }
    })
    row(['  ', ...range])
  }

  const axis = Array.from({ length: axisCells + 4 }, () => '─')
  const put = (i: number, label: string) => {
    if (i < 0 || i + label.length > axis.length) return
    if (axis.slice(Math.max(0, i - 1), i + label.length + 1).some(ch => ch !== '─')) return
    ;[...label].forEach((ch, k) => (axis[i + k] = ch))
  }
  put(0, 'now')
  for (let h = step; h <= end; h += step) put(col(h), step >= 24 ? `${h / 24}d` : `${h}h`)
  row(['  ', dim(axis.join(''), c)])

  // The three marks, labelled (`soonest ▲`, `▲ usual`, `▲ latest`) when every one fits without
  // touching another; else all three bare `▲` at their columns, which the legend then explains
  // (a bare ▲ is a legend mark; a labelled one is not). Never a subset of the labels.
  const marks: (PaneSegment | null)[] = Array.from({ length: inner - 2 }, () => null)
  const mark = (start: number, label: string, seg: (t: string) => PaneSegment): boolean => {
    if (start < 0 || start + label.length > marks.length) return false
    if (marks.slice(Math.max(0, start - 1), start + label.length + 1).some(m => m !== null)) return false
    ;[...label].forEach((ch, k) => (marks[start + k] = unmarked(seg(ch))))
    return true
  }
  let labelled = mark(u, '▲ usual', ch => strong(ch, hue))
  if (a < u) labelled = mark(a - 'soonest ▲'.length + 1, 'soonest ▲', ch => dim(ch, c)) && labelled
  if (b > u) labelled = mark(b, '▲ latest', ch => dim(ch, c)) && labelled
  if (!labelled) {
    marks.fill(null)
    for (const i of [a, b]) marks[i] = dim('▲', c)
    marks[u] = strong('▲', hue)
  }
  let last = marks.length
  while (last > 0 && marks[last - 1] === null) last--
  row(['  ', ...marks.slice(0, last).map(m => m ?? ' ')])
  out.push([INDENT, side(`┗${'━'.repeat(width - 2)}┛`)])
  return out
}

/**
 * NEXT SWITCH where no card fits: `NEXT SWITCH  [in use] ━▶ [next]  <rangeText>`, wrapped at a
 * piece to `columns`.
 */
function switchLine(view: ClaudishAllowanceView, s: ClaudishAllowanceSwitch, now: number, columns: number, c: AllowanceColors): PaneLine[] {
  const from = activeAccount(view)
  const chips: PaneLine = [...(from !== undefined ? [accountChip(view, from.number, c), ' ', { text: '━▶', color: profileColor(s.account, c) }, ' '] : []), accountChip(view, s.account, c)]
  const atoms: Atom[] = [{ gap: ['  '], body: chips }, { gap: ['  '], body: [heading(rangeText(s, now), c)] }]
  return flow([heading(FORECAST_TEXT.nextSwitch, c)], atoms, columns, '')
}

// ── B4 the relay strip ────────────────────────────────────────────────────────

/** Monday 00:00 of `now`'s week, in local time. */
export function weekStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** A day's label in `perDay` cells: its name where it fits with a free cell after it, else its initial. */
function dayLabel(day: string, perDay: number): string {
  return (perDay > day.length ? day : day.slice(0, 1)).padEnd(perDay)
}

/**
 * The relay strip (design B4), what the data supports: this week (weekStart) to the end of next
 * Monday, RELAY_DAYS days, one cell per RELAY_CELL_HOURS (the finest that fits), after a label
 * column of LABEL_CELLS, or RELAY_LABEL_MIN where that leaves no room. ONE x scale for every row:
 * a day starts at the column of its first cell. Rows: `THIS WEEK` … `NEXT`; the day names
 * (initials where a name does not fit its day); `real ◀ ┃ ▶ predicted` at now; `in use` from now
 * on, the account in use then each takeover (switchesAhead) as `▓` in its colour tinted by
 * tintFaded, ╳ in a gap; `switch`, each takeover ahead as `├─┼─┤` (soonest, usual, latest) in its
 * colour, where two would share a cell only the earlier one (a later range is dropped whole);
 * then one lane per account, under its name (accountName, within the label column): `┃` at its weekly refills and `◆` at its 5-hour refills
 * claudish read (not projected), `█` in its colour where its history (the view's `history`, its
 * last 24 h) shows allowance used in the cell and `·` where it shows none, `▓` where the takeovers
 * have it in use and `·` elsewhere ahead, and a badge `unused → lost −NN%` (warn fill, chipInk
 * text) over the latest run of cells after now and before its lostAt refill that carry no mark and
 * where the takeovers do not have it in use, shortened to `−NN% lost` or `−NN%` when the longer
 * does not fit, left out when none does. The now column is `┃` on every row from the third.
 * Then, where claudish sends its slower scenario (view.slower), a blank row and `slower` (ok colour,
 * bold), drawn from slower.switches and slower.blocked alone exactly as `in use` is from the
 * takeovers and gaps; under it, in the label column, `⅓ less busy` (lessBusyText of its factor, dim)
 * and `→ no gap` (ok) when slower.blocked is empty, else `→ gap` (bad), each left out where it does
 * not fit the label column. Never compared with the current scenario: slower is not guaranteed better.
 * The past `in use`, `how busy` and `switch` rows, the lanes before history starts, and the
 * slower scenario's how-busy bars need data claudish does not send; they are blank or left out.
 * [] without an account, with nothing to place (no takeover, refill or history in the span), or
 * where even the coarsest cells do not fit.
 */
export function relayLines(view: ClaudishAllowanceView, now: number, columns: number, c: AllowanceColors): PaneLine[] {
  if (view.accounts.length === 0) return []
  const span = RELAY_DAYS * 24
  const scale = [LABEL_CELLS, RELAY_LABEL_MIN]
    .map(labelCells => ({ labelCells, hours: RELAY_CELL_HOURS.find(h => span / h <= columns - labelCells) }))
    .find(o => o.hours !== undefined)
  if (scale === undefined || scale.hours === undefined) return []
  const { labelCells, hours } = scale
  const n = span / hours
  const perDay = 24 / hours
  const cellMs = hours * HOUR_MS
  const start = weekStart(now)
  const end = start + n * cellMs
  const cellOf = (t: number) => Math.floor((t - start) / cellMs)
  const tOf = (i: number) => start + (i + 0.5) * cellMs
  const nowC = cellOf(now)
  const inSpan = (t: number) => t >= start && t < end

  const ahead = switchesAhead(view, now)
  const refills = view.refills.filter(r => r.account !== null && inSpan(r.at))
  const history = (view.history ?? []).filter(h => h.points.some(p => inSpan(p.at) && p.at <= now))
  if (!ahead.some(s => inSpan(s.at)) && refills.length === 0 && history.length === 0) return []

  const active = activeAccount(view)?.number ?? null
  const whoAt = (t: number) => {
    let w = active
    for (const s of ahead) if (t >= s.at) w = s.account
    return w
  }
  const inGap = (t: number) => view.gaps.some(g => t >= g.startAt && t < (g.endAt ?? Number.POSITIVE_INFINITY))
  const faded = (account: number) => tint(profileColor(account, c), c, c.tintFaded)
  const nowMark = () => unmarked(strong('┃', c.text))
  const label = (l: PaneLine) => padTo(l, labelCells)
  const strip = (cell: (i: number) => PaneLine[number]): PaneLine[number][] =>
    Array.from({ length: n }, (_, i) => (i === nowC ? nowMark() : cell(i)))

  const out: PaneLine[] = []
  out.push([...label([]), ...padTo([heading('THIS WEEK', c)], 7 * perDay), dim('NEXT', c)])
  out.push([...label([]), ...DAYS.map(d => text(dayLabel(d, perDay), c)), dim(dayLabel('Mon', perDay).trimEnd(), c)])
  if (nowC >= 0 && nowC < n) {
    const real = 'real ◀ '
    const pred = ' ▶ predicted'
    const head: PaneLine = [...label([])]
    head.push(...(nowC >= real.length ? [' '.repeat(nowC - real.length), heading(real, c)] : [' '.repeat(nowC)]))
    head.push(nowMark())
    if (n - nowC - 1 >= pred.length) head.push(heading(pred, c))
    out.push(head)
  }

  if (active !== null || ahead.length > 0) {
    out.push([...label([heading('in use', c)]), ...strip(i => {
      if (i < nowC) return ' '
      const t = tOf(i)
      if (inGap(t)) return strong('╳', c.bad)
      const w = whoAt(t)
      return w === null ? ' ' : { text: '▓', color: faded(w) }
    })])
  }

  if (ahead.some(s => inSpan(s.at))) {
    // The earliest switch's range first; a later one that would share a cell with a range kept is dropped whole.
    const spans: { lo: number; mid: number; hi: number; hue: string }[] = []
    for (const s of ahead) {
      const mid = cellOf(s.at)
      if (mid < 0 || mid >= n) continue
      const lo = Math.max(nowC + 1, Math.min(mid, cellOf(Math.max(now, s.soonest))))
      const hi = Math.min(n - 1, Math.max(mid, cellOf(s.latest)))
      if (spans.some(k => lo <= k.hi && hi >= k.lo)) continue
      spans.push({ lo, mid, hi, hue: profileColor(s.account, c) })
    }
    const marks: (PaneSegment | null)[] = Array.from({ length: n }, () => null)
    for (const { lo, mid, hi, hue } of spans) {
      for (let i = lo; i <= hi; i++) marks[i] = { text: '─', color: hue }
      if (lo < mid) marks[lo] = { text: '├', color: hue }
      if (hi > mid) marks[hi] = { text: '┤', color: hue }
      marks[mid] = strong('┼', hue)
    }
    out.push([...label([dim('switch', c)]), ...strip(i => marks[i] ?? ' ')])
  }
  out.push([...label([]), ...strip(() => ' ')])

  for (const a of view.accounts) {
    const hue = profileColor(a.number, c)
    const lane: (PaneLine[number] | null)[] = Array.from({ length: n }, () => null)
    for (const r of refills) {
      if (r.account !== a.number) continue
      const i = cellOf(r.at)
      if (r.span === 'week') lane[i] = strong('┃', hue)
      else if (r.span === '5h' && !r.projected && lane[i] === null) lane[i] = strong('◆', c.text)
    }
    // The past, as far as the account's history reaches: allowance used in a cell, or none.
    const used = new Set<number>()
    const seen = new Set<number>()
    const points = (view.history ?? []).find(h => h.account === a.number)?.points.filter(p => p.at <= now).sort((x, y) => x.at - y.at) ?? []
    points.forEach((q, k) => {
      const i = cellOf(q.at)
      if (i < 0 || i >= nowC) return
      seen.add(i)
      if (k > 0 && points[k - 1]!.remaining > q.remaining) used.add(i)
    })
    // The tag over the unused stretch before the refill whose unused share is lost: the latest run
    // of cells ahead, before that refill, with no mark and the account not in use.
    const share = a.lostShare === null || !Number.isFinite(a.lostShare) ? 0 : Math.round(a.lostShare * 100)
    const lostAt = a.lostAt ?? null
    if (share >= 1 && lostAt !== null && lostAt > now && inSpan(lostAt)) {
      const open = (i: number) => i > nowC && lane[i] === null && whoAt(tOf(i)) !== a.number
      for (const tag of [`${FORECAST_TEXT.unusedLost} ${MINUS}${share}%`, `${MINUS}${share}% lost`, `${MINUS}${share}%`]) {
        const len = [...tag].length
        let first = cellOf(lostAt) - len
        while (first > nowC && !Array.from({ length: len }, (_, k) => open(first + k)).every(Boolean)) first--
        if (first <= nowC) continue
        ;[...tag].forEach((ch, k) => (lane[first + k] = { text: ch, color: c.chipInk, backgroundColor: c.warn, bold: true }))
        break
      }
    }
    out.push([...label([accountName(view, a.number, c, labelCells - 1)]), ...strip(i => {
      if (lane[i] !== null) return lane[i]!
      if (i < nowC) return used.has(i) ? { text: '█', color: hue } : seen.has(i) ? dim('·', c) : ' '
      return whoAt(tOf(i)) === a.number ? { text: '▓', color: faded(a.number) } : dim('·', c)
    })])
  }

  // The slower scenario, from its own values only (it is not guaranteed better: never compared or clamped).
  const slower = view.slower
  if (slower) {
    const slowAhead = slower.switches.filter(s => Number.isFinite(s.at) && s.at > now).sort((a, b) => a.at - b.at)
    const slowWhoAt = (t: number) => {
      let w = active
      for (const s of slowAhead) if (t >= s.at) w = s.account
      return w
    }
    const slowGap = (t: number) => slower.blocked.some(b => t >= b.from && t < b.to)
    out.push([...label([]), ...strip(() => ' ')])
    out.push([...label([strong(FORECAST_TEXT.slower, c.ok)]), ...strip(i => {
      if (i < nowC) return ' '
      const t = tOf(i)
      if (slowGap(t)) return strong('╳', c.bad)
      const w = slowWhoAt(t)
      return w === null ? ' ' : { text: '▓', color: faded(w) }
    })])
    // The two labels under it, each only where it fits the label column with a free cell after it.
    const said = slower.blocked.length === 0 ? { text: FORECAST_TEXT.slowerNoGap, color: c.ok } : { text: FORECAST_TEXT.slowerGap, color: c.bad }
    for (const l of [[dim(lessBusyText(slower.factor), c)], [said]] as PaneLine[]) {
      if (cells(l) < labelCells) out.push([...label(l), ...strip(() => ' ')])
    }
  }
  return out
}

// ── B5 next ───────────────────────────────────────────────────────────────────

/**
 * `next  N in <dur> → M in <dur> → nothing in <dur>`: each takeover ahead (switchesAhead) by its
 * account's name (accountName) with the time to its usual moment, and the first gap ahead as a red `nothing`, in time
 * order, wrapped at an arrow to `columns` (a wrapped line starts with its arrow). [] with neither.
 */
export function nextLines(view: ClaudishAllowanceView, now: number, c: AllowanceColors, columns: number = Number.POSITIVE_INFINITY): PaneLine[] {
  const events: { at: number; said: PaneLine }[] = switchesAhead(view, now)
    .map(s => ({ at: s.at, said: [accountName(view, s.account, c), dim(' in ', c), text(untilText(s.at - now), c)] }))
  const gap = [...view.gaps].filter(g => g.startAt > now).sort((a, b) => a.startAt - b.startAt)[0]
  if (gap !== undefined) events.push({ at: gap.startAt, said: [strong('nothing', c.bad), dim(' in ', c), text(untilText(gap.startAt - now), c)] })
  if (events.length === 0) return []
  const atoms = events.sort((a, b) => a.at - b.at).map((e, i): Atom => ({ gap: i > 0 ? [dim(' → ', c)] : [], body: e.said }))
  // A continuation starts under the label column's arrow; where that leaves an event too wide for
  // the line, it starts at the panel's INDENT instead (an event, a duration, is never cut).
  const widest = Math.max(...atoms.map(a => cells(a.body)))
  const lead = LABEL_CELLS - 3 + ' → '.length + widest <= columns ? ' '.repeat(LABEL_CELLS - 3) : INDENT
  return flow(padTo([dim('next', c)], LABEL_CELLS), atoms, columns, [lead, dim(' → ', c)])
}

// ── B6 speed ──────────────────────────────────────────────────────────────────

/** The speed bar: green to two thirds of the way to 1.5× safe pace (safe sits there), amber, then red. */
function speedBar(rate: number, safe: number, width: number, c: AllowanceColors): PaneSegment[] {
  const filled = Math.round(clamp01(rate / (safe * 1.5)) * width)
  return Array.from({ length: width }, (_, i): PaneSegment => {
    const zone = i < width * (2 / 3) ? c.ok : i < width * (5 / 6) ? c.warn : c.bad
    return i < filled ? { text: '█', color: zone } : { text: '░', color: tint(zone, c, c.tintGauge) }
  })
}

/** SPEED's row labels: claudish's burn rates are decayed means with these half-lives (2 h short, 24 h long). */
export const SPEED_LABELS = { short: 'last 2 hours', long: 'last day' } as const

/** The plain fractions the pace sentence speaks in, as the design does ("about a third over"). */
const FRACTIONS: readonly (readonly [share: number, said: string])[] = [
  [0.1, 'a tenth'], [0.2, 'a fifth'], [0.25, 'a quarter'], [1 / 3, 'a third'], [0.5, 'half'],
  [2 / 3, 'two thirds'], [0.75, 'three quarters'], [0.9, 'nine tenths'],
]

/**
 * How `rate` stands against the safe pace, in the design's plain words: `On the safe pace.` within
 * 5 %; `About twice the safe pace.` / `About N times the safe pace.` from 1.75×; otherwise the
 * nearest plain fraction, `About a third over the safe pace.`, `About a quarter under the safe
 * pace.`, and `About half the safe pace.` for half under.
 */
export function paceSentence(rate: number, safe: number): string {
  const r = rate / safe
  if (Math.abs(r - 1) < 0.05) return 'On the safe pace.'
  if (r >= 1.75) {
    const k = Math.round(r)
    return k === 2 ? 'About twice the safe pace.' : `About ${k} times the safe pace.`
  }
  const off = Math.abs(r - 1)
  const said = FRACTIONS.reduce((best, f) => (Math.abs(f[0] - off) < Math.abs(best[0] - off) ? f : best))[1]
  if (r < 1 && said === 'half') return 'About half the safe pace.'
  return `About ${said} ${r < 1 ? 'under' : 'over'} the safe pace.`
}

/** What follows the speed bar, widest first: each rung drops one more column (verdict, then `safe …`, then the unit). */
const SPEED_TAILS: readonly { unit: boolean; safe: boolean; verdict: boolean }[] = [
  { unit: true, safe: true, verdict: true },
  { unit: true, safe: true, verdict: false },
  { unit: true, safe: false, verdict: false },
  { unit: false, safe: false, verdict: false },
]

/**
 * SPEED (design B6): claudish's short burn (SPEED_LABELS.short) and long burn (SPEED_LABELS.long),
 * both per hour. Against the safe pace (its sustainable burn, T1): a header `slow … safe│ … fast`
 * over the bar (safe at two thirds), per row a bar, the value, `safe …` and a verdict (`fine`,
 * `a bit fast` over safe, `too fast` over 1.2× safe), then a dim paceSentence of the short rate
 * (else the long) and, with a gap starting after `now`, `At this speed every account is empty in
 * <dur>.`, wrapped at a word. The bar is the graphic: it is SPEED_CELLS wide at most and keeps at
 * least SPEED_MIN, and where it would be narrower the rows drop the verdict, then `safe …`, then
 * the unit (SPEED_TAILS); the header drops `slow` and `fast` where they do not fit. Without a safe
 * pace, the values alone, under `SPEED  per hour`. Values carry ` cu/h`: claudish's rates are in
 * compute units whatever the view's `unit` (the pool's). [] with neither rate.
 */
export function speedLines(view: ClaudishAllowanceView, now: number, columns: number, c: AllowanceColors): PaneLine[] {
  const rows: (readonly [string, number])[] = []
  for (const [label, rate] of [[SPEED_LABELS.short, view.rate.short], [SPEED_LABELS.long, view.rate.long]] as const) {
    if (rate !== null && Number.isFinite(rate)) rows.push([label, rate])
  }
  if (rows.length === 0) return []
  const safe = view.rate.safe !== null && Number.isFinite(view.rate.safe) && view.rate.safe > 0 ? view.rate.safe : null
  const value = (rate: number, withUnit: boolean): PaneLine => [heading(rateValue(rate), c), ...(withUnit ? [dim(' cu/h', c)] : [])]
  const rowLabel = (label: string) => padTo([text(label, c)], LABEL_CELLS)
  if (safe === null) {
    return [
      [...padTo([heading('SPEED', c)], LABEL_CELLS), dim('per hour', c)],
      ...rows.map(([label, rate]): PaneLine => [...rowLabel(label), ...value(rate, true)]),
    ]
  }

  const verdict = (rate: number) => (rate > safe * 1.2 ? strong('too fast', c.bad) : rate > safe ? strong('a bit fast', c.warn) : strong('fine', c.ok))
  const tailOf = (rate: number, t: (typeof SPEED_TAILS)[number]): PaneLine => {
    const line: PaneLine = ['  ', ...(t.safe ? padTo(value(rate, t.unit), 12) : value(rate, t.unit))]
    if (t.safe) line.push(dim(`safe ${rateValue(safe)}`, c))
    if (t.verdict) line.push('  ', verdict(rate))
    return line
  }
  const room = (t: (typeof SPEED_TAILS)[number]) => columns - LABEL_CELLS - Math.max(...rows.map(([, rate]) => cells(tailOf(rate, t))))
  const tail = SPEED_TAILS.find(t => room(t) >= SPEED_MIN) ?? SPEED_TAILS[SPEED_TAILS.length - 1]!
  const bar = Math.max(SPEED_MIN, Math.min(SPEED_CELLS, room(tail)))

  const at = Math.round(bar * (2 / 3))
  const before = at - 'safe'.length
  const after = bar - at - 1 - 'fast'.length
  const out: PaneLine[] = [[...padTo([heading('SPEED', c)], LABEL_CELLS),
    ...(before > 'slow'.length ? padTo([dim('slow', c)], before) : [' '.repeat(Math.max(0, before))]),
    dim('safe', c), heading('│', c),
    ...(after >= 1 ? [' '.repeat(after), dim('fast', c)] : [])]]
  for (const [label, rate] of rows) out.push([...rowLabel(label), ...speedBar(rate, safe, bar, c), ...tailOf(rate, tail)])

  let said = paceSentence(rows[0]![1], safe)
  const gap = [...view.gaps].filter(g => g.startAt > now).sort((a, b) => a.startAt - b.startAt)[0]
  if (gap !== undefined) said += ` At this speed every account is empty in ${untilText(gap.startAt - now)}.`
  const indent = ' '.repeat(LABEL_CELLS)
  out.push(...flow([indent], words(said, t => dim(t, c)), columns, indent))
  return out
}

// ── B7 left now ───────────────────────────────────────────────────────────────

/** A LEFT NOW window cell: an 8-cell meter of what is left, then (with `noteCells`) `full` or `↻ <dur>` to its refill. */
function windowCell(w: ClaudishAllowanceWindow | undefined, now: number, noteCells: number | null, highlight: boolean, c: AllowanceColors): PaneLine {
  const cellsWide = METER_CELLS + 2 + (noteCells ?? 0)
  // A window claudish does not send is an empty cell: a `—` read as "used up".
  if (w === undefined || !Number.isFinite(w.usedFraction)) return padTo([], cellsWide)
  const lit = Math.round((1 - clamp01(w.usedFraction)) * METER_CELLS)
  const line: PaneLine = [...meter(lit, eighthsColor(lit, c), c), '  ']
  if (noteCells !== null) {
    if (clamp01(w.usedFraction) === 0) line.push(text('full', c))
    else if (w.resetAt !== null) line.push(dim('↻', c), highlight ? heading(` ${untilText(w.resetAt - now)}`, c) : dim(` ${untilText(w.resetAt - now)}`, c))
  }
  return padTo(line, cellsWide)
}

/** LEFT NOW's columns, widest first: each rung drops one whole column, never part of a value. */
const LEFT_RUNGS: readonly { lost: boolean; note5: boolean; noteWeek: boolean; state: boolean }[] = [
  { lost: true, note5: true, noteWeek: true, state: true },
  { lost: false, note5: true, noteWeek: true, state: true },
  { lost: false, note5: false, noteWeek: true, state: true },
  { lost: false, note5: false, noteWeek: false, state: true },
  { lost: false, note5: false, noteWeek: false, state: false },
]
/** The rung the compact panel starts from: the meters alone. */
const LEFT_METERS = 3

function leftNowWith(view: ClaudishAllowanceView, now: number, c: AllowanceColors, rung: (typeof LEFT_RUNGS)[number]): PaneLine[] {
  const lost = rung.lost && view.accounts.some(a => a.lostShare !== null)
  const next = nextSwitch(view, now)?.account
  const note5 = rung.note5 ? LEFT_5H_NOTE_CELLS : null
  const noteWeek = rung.noteWeek ? LEFT_WEEK_NOTE_CELLS : null
  const head: PaneLine = [
    ...padTo([heading('LEFT NOW', c)], LEFT_NAME_CELLS + (rung.state ? LEFT_STATE_CELLS : 0)),
    ...padTo([heading('5 HOURS', c)], METER_CELLS + 2 + (note5 ?? 0)),
    ...padTo([heading('THIS WEEK', c)], METER_CELLS + 2 + (noteWeek ?? 0)),
  ]
  if (lost) head.push(heading(FORECAST_TEXT.lostHead, c))
  const rows = view.accounts.map((a): PaneLine => {
    const state = a.active === true ? heading('in use', c) : a.number === next ? text('next', c) : ''
    const row: PaneLine = [...padTo([accountName(view, a.number, c, LEFT_NAME_CELLS - 1)], LEFT_NAME_CELLS)]
    if (rung.state) row.push(...padTo(state === '' ? [] : [state], LEFT_STATE_CELLS))
    row.push(
      ...windowCell(a.windows.find(w => w.span === '5h'), now, note5, a.active === true, c),
      ...windowCell(a.windows.find(w => w.span === 'week'), now, noteWeek, false, c),
    )
    if (lost) {
      if (a.lostShare === null || !Number.isFinite(a.lostShare)) row.push(dim('—', c))
      else {
        row.push(...meter(Math.round(clamp01(a.lostShare) * METER_CELLS), c.warn, c), '  ', text(percent(clamp01(a.lostShare)).padEnd(5), c))
        const at = a.lostAt ?? null
        if (at !== null && at > now) row.push(' ', dim('↻', c), dim(` ${untilText(at - now)}`, c))
      }
    }
    return row
  })
  return [head, ...rows]
}

/**
 * LEFT NOW at the first rung from `from` whose every line fits `columns` (the last rung when none
 * does). A line is measured as drawn, its columns' padding included: the pane cuts on cells.
 */
function leftNowFrom(view: ClaudishAllowanceView, now: number, c: AllowanceColors, columns: number, from: number): PaneLine[] {
  if (view.accounts.length === 0) return []
  let lines: PaneLine[] = []
  for (const rung of LEFT_RUNGS.slice(from)) {
    lines = leftNowWith(view, now, c, rung)
    if (lines.every(l => cells(l) <= columns)) break
  }
  return lines
}

/**
 * LEFT NOW (design B7): per account, by name (accountName, within its column), its state (`in use` for the account in use,
 * bold; `next` for nextSwitch's), then what is left of its 5-hour and its week window, each an
 * 8-cell meter (█ green from half, amber from a quarter, red below; ░ dim) with `full` or `↻ <dur>`
 * to its refill (the in-use account's 5-hour time in the text colour), an empty cell without the window.
 * Once claudish reports lost share for some account (T4), a LOST AT NEXT REFILL column: the
 * share its next refill throws away as an amber meter and a percentage, with `↻ <dur>` to that
 * refill (lostAt); `—` where unknown. Narrower than `columns`, whole columns go (LEFT_RUNGS): the
 * lost column, the 5-hour text, the week text, the state; the meters stay. [] with no account.
 */
export function leftNowLines(view: ClaudishAllowanceView, now: number, c: AllowanceColors, columns: number = Number.POSITIVE_INFINITY): PaneLine[] {
  return leftNowFrom(view, now, c, columns, 0)
}

// ── B8 the legend ─────────────────────────────────────────────────────────────

/**
 * The marks among `lines` the legend explains: a segment whose text is exactly one of them. The
 * relay strip's now line and the card's frame look like `┃` and are not counted.
 */
export function drawnMarks(lines: readonly PaneLine[]): Set<LegendMark> {
  const known = new Set<string>(LEGEND.map(([m]) => m))
  const drawn = new Set<LegendMark>()
  for (const line of lines) {
    for (const part of line) if (typeof part !== 'string' && !UNMARKED.has(part) && known.has(part.text)) drawn.add(part.text as LegendMark)
  }
  return drawn
}

/**
 * The legend (design B8): up to two groups of indented lines, each mark drawn as it appears (`┼`
 * as `├─┼─┤`) then its explanation, dim, in LEGEND's order on LEGEND's line, wrapped at an entry
 * to `columns`; only the marks in `drawn`, and no line for a group with none. [] when none is drawn.
 */
export function legendLines(drawn: ReadonlySet<LegendMark>, c: AllowanceColors, columns: number = Number.POSITIVE_INFINITY): PaneLine[] {
  const look: Record<LegendMark, PaneSegment[]> = {
    '▓': [{ text: '▓', color: tint(c.text, c, c.tintFaded) }],
    '╳': [strong('╳', c.bad)],
    '┃': [strong('┃', c.text)],
    '◆': [strong('◆', c.text)],
    '┼': [{ text: '├─', color: c.text }, strong('┼', c.text), { text: '─┤', color: c.text }],
    '↻': [dim('↻', c)],
    '▲': [dim('▲', c)],
  }
  const out: PaneLine[] = []
  for (const n of [1, 2] as const) {
    const atoms = LEGEND.filter(([mark, , on]) => on === n && drawn.has(mark))
      .map(([mark, said], i): Atom => ({ gap: i === 0 ? [] : ['   '], body: [...look[mark], ' ', dim(said, c)] }))
    if (atoms.length > 0) out.push(...flow(['  '], atoms, columns, '  '))
  }
  return out
}

/**
 * The profile key: one dim legend line mapping the band's profile numbers to the names the panel
 * uses, `1 default   2 second`, each number on its profile chip, in number order, wrapped at an
 * entry to `columns`. Only accounts claudish labels; [] when none is.
 */
export function profileKeyLines(view: ClaudishAllowanceView, c: AllowanceColors, columns: number = Number.POSITIVE_INFINITY): PaneLine[] {
  const atoms = view.accounts
    .filter((a): a is typeof a & { label: string } => typeof a.label === 'string')
    .sort((x, y) => x.number - y.number)
    .map((a, i): Atom => ({ gap: i === 0 ? [] : ['   '], body: [profileChip(a.number, c), ' ', dim(a.label, c)] }))
  return atoms.length === 0 ? [] : flow(['  '], atoms, columns, '  ')
}

// ── the panel ─────────────────────────────────────────────────────────────────

export type ForecastInput = {
  view: ClaudishAllowanceView
  now: number
  /** the panel's body width */
  columns: number
  c: AllowanceColors
  /** the panel's own slice (the forecast) has not arrived yet */
  pending?: boolean
}

/**
 * The panel for a report, in the v12 design's order less its "Now on" line: the headline (gapLines,
 * and a line while the panel's own slice is on its way), the NEXT SWITCH card, the relay strip,
 * `next`, SPEED, LEFT NOW, a blank line between sections, then the legend: the profile key and the
 * marks drawn. Narrower than COMPACT_COLUMNS: the headline, NEXT SWITCH in one line, `next` and
 * LEFT NOW's meters only. A report that is not `ok` says only that not enough usage is recorded yet.
 */
export function forecastLines(input: ForecastInput): PaneLine[] {
  const { view, now, columns, c } = input
  if (view.status !== 'ok') return [[dim(FORECAST_TEXT.insufficient, c)]]
  const header: PaneLine[] = [...gapLines(view, now, c, columns), ...(input.pending === true ? [[INDENT, dim(FORECAST_TEXT.pending, c)]] : [])]
  const sections = (columns < COMPACT_COLUMNS
    ? [header, switchCardLines(view, now, columns, c), nextLines(view, now, c, columns), leftNowFrom(view, now, c, columns, LEFT_METERS)]
    : [
      header,
      switchCardLines(view, now, columns, c),
      relayLines(view, now, columns, c),
      nextLines(view, now, c, columns),
      speedLines(view, now, columns, c),
      leftNowLines(view, now, c, columns),
    ]).filter(s => s.length > 0)
  const body = sections.flatMap((s, i) => (i === 0 ? s : [[], ...s]))
  const legend = [...profileKeyLines(view, c, columns), ...legendLines(drawnMarks(body), c, columns)]
  return legend.length > 0 ? [...body, [], ...legend] : body
}

/** The parts the panel's own slice carries: until it has arrived, the panel says it is asking. */
const PANEL_PARTS: readonly ClaudishAllowancePart[] = ['forecast']

/**
 * The panel for whatever the allowance holds: the forecast for a report (with a line while the
 * panel's own slice is still on its way), or one dim line saying why there is none: waiting for
 * claudish's first answer, claudish too old, claudish's refusal, or its reason for no report.
 */
export function panelLines(input: { allowance: ClaudishAllowance; now: number; columns: number; c: AllowanceColors }): PaneLine[] {
  const { allowance: a, c } = input
  switch (a.kind) {
    case 'probing':
      return [[dim(FORECAST_TEXT.waiting, c)]]
    case 'unsupported':
      return [[dim(FORECAST_TEXT.unsupported, c)]]
    case 'refused':
      return [[dim(`claudish refused: ${short(a.code)}`, c)]]
    case 'none':
      return [[dim(a.reason, c)]]
    case 'ready':
      return forecastLines({
        view: a.view, now: input.now, columns: input.columns, c,
        pending: a.parts !== undefined && PANEL_PARTS.some(p => a.parts?.[p] === undefined),
      })
  }
}
