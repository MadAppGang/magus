// Pure layout: the band's rows, header and column plan (fitted to the band's own width),
// and a Show tab's viewport, colour spelling and style budget. Values in, values out:
// no engine interface, no state reference, no claudish vocabulary. The tree builders
// (band.tsx, pane.tsx) draw exactly what these return.

import type { Color } from 'claude-code'
import type {
  ClaudishColor,
  ClaudishEarlier,
  ClaudishFeedSupport,
  ClaudishFrame,
  ClaudishLedger,
  ClaudishPaneView,
  ClaudishRun,
  ClaudishRunRef,
  ClaudishRuns,
  ClaudishSlot,
  ClaudishSlotState,
  ClaudishStopRequest,
  ClaudishStyleSpan,
} from '../../types'
import {
  NO_CAPTURE_NOTE,
  PAINT_SURFACES,
  PANE_LINE_COST,
  PANE_SEGMENT_COST,
  PANE_STYLE_BUDGET,
  QUIET_AFTER_S,
  STATE_LOOK,
  feedKey,
  isDrawn,
  isTerminal,
  isWaiting,
  runLabel,
  slotKey,
  type StatusColor,
} from './domain'

// ── shared ────────────────────────────────────────────────────────────────────

/** One run of text in the mod's own drawing: theme keys only. */
export type Segment = { text: string; color?: StatusColor; dim?: true; bold?: true }

/** What a Stop or Show press acts on: values the render read. */
export type SlotTarget = { runId: string; epoch: number; ref: ClaudishRunRef; slot: string; model: string }

const DASH = '—'

type Unit = readonly [div: number, suffix: string]

/** The unit a count reads in on its own: plain below 1000, then k, then M. */
function unitOf(n: number): Unit {
  const a = Math.abs(n)
  return a < 1000 ? [1, ''] : a < 999_950 ? [1000, 'k'] : [1_000_000, 'M']
}

function inUnit(n: number, [div, suffix]: Unit): string {
  return div === 1 ? String(Math.round(n)) : `${(n / div).toFixed(1)}${suffix}`
}

/**
 * The in/out token pair, both halves in ONE unit so the column reads as a pair:
 * 12_000/400 → 12.0k/0.4k, never 12.0k/400. Plain integers only while BOTH are below
 * 1000 (850/120); otherwise the larger half picks k or M and the smaller follows it,
 * unless the shared unit would draw the smaller as 0.0: then it reads in its own unit
 * (42_900/37 → 42.9k/37, 2_345_678/40_000 → 2.3M/40.0k), so a few real tokens never
 * read as none. A null half draws —; both null draws — alone.
 */
export function tokenPair(tokensIn: number | null, tokensOut: number | null): string {
  if (tokensIn === null && tokensOut === null) return DASH
  const shared = unitOf(Math.max(Math.abs(tokensIn ?? 0), Math.abs(tokensOut ?? 0)))
  const half = (n: number | null) => {
    if (n === null) return DASH
    const text = inUnit(n, shared)
    return shared[0] > 1 && /^-?0\.0[kM]$/.test(text) ? inUnit(n, unitOf(n)) : text
  }
  return `${half(tokensIn)}/${half(tokensOut)}`
}

/** 4 → 4s, 125 → 2m, 7300 → 2h; null → —. */
export function age(seconds: number | null): string {
  if (seconds === null) return DASH
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

/** Cut to `width` characters, ending in … when cut. */
export function cut(text: string, width: number): string {
  if (width <= 0) return ''
  const chars = Array.from(text)
  return chars.length <= width ? text : `${chars.slice(0, Math.max(0, width - 1)).join('')}…`
}

function pad(text: string, width: number): string {
  const n = Array.from(text).length
  return n >= width ? text : text + ' '.repeat(width - n)
}

/** The state a row draws: a live slot of an unreachable run is `? unknown`, never its stale state. */
function shownState(run: ClaudishRun, slot: ClaudishSlot): ClaudishSlotState {
  return run.unreachableSince !== null && !isTerminal(slot.state) ? 'UNKNOWN' : slot.state
}

/** The activity column: what a live slot does, or why a terminal one ended (not a repeat of its word). */
function activityOf(run: ClaudishRun, slot: ClaudishSlot, state: ClaudishSlotState): string {
  if (state === 'UNKNOWN' && run.unreachableSince !== null) return ''
  if (!isTerminal(state)) return slot.activity ?? ''
  if (state === 'LOST') return slot.reason ?? run.lostReason ?? ''
  const reason = slot.reason ?? ''
  return reason === 'cancelled' || reason === 'timeout' ? '' : reason
}

function idleOf(slot: ClaudishSlot, state: ClaudishSlotState): Segment {
  if (isTerminal(state)) return { text: '' }
  const quiet = state === 'RUNNING' && slot.idleSeconds !== null && slot.idleSeconds >= QUIET_AFTER_S
  return quiet ? { text: `idle ${age(slot.idleSeconds)} ⚠`, color: 'warning' } : { text: `idle ${age(slot.idleSeconds)}`, color: 'subtle' }
}

export { isDrawn }

// ── band ──────────────────────────────────────────────────────────────────────

export type StopCell = 'stop' | 'confirm' | 'stopping' | 'none'

export type BandRow = {
  /** `${runId}/${slot}`, or `${runId}/` for a run not listed yet */
  key: string
  attention: boolean
  id: string
  glyph: string
  word: string
  color: StatusColor
  /** the header word it counts under */
  group: (typeof GROUPS)[number]
  model: string
  provider: string
  tokens: string
  tools: string
  loops: string
  idle: Segment
  activity: string
  stop: StopCell
  show: boolean
  terminal: boolean
  /** when a terminal row ended (its last activity), for the most-recent-first order; null when unknown */
  endedAt: number | null
  target: SlotTarget
}

/** Cells per column; 0 = dropped. `state` is 10 (glyph and word) or 1 (glyph alone). */
export type ColumnPlan = {
  lead: number; id: number; state: number; model: number; provider: number; tokens: number
  tools: number; loops: number; idle: number; activity: number; stop: number; show: number
}

export type BandModel = {
  header: Segment[]
  /** null: the band is too narrow for any row, so it draws the header alone */
  plan: ColumnPlan | null
  rows: BandRow[]
  /** `+N more: …` when terminal rows were folded for height */
  more: string | null
}

export type BandInput = {
  runs: ClaudishRuns
  feeds: Readonly<Record<string, ClaudishFeedSupport>>
  stops: Readonly<Record<string, ClaudishStopRequest>>
  ledger: ClaudishLedger
  earlier: ClaudishEarlier
  bodyColumns: number
  maxRows: number
}

export const STOP_CELLS = 12 // `[ confirm? ]`
export const SHOW_CELLS = 8 // `[ Show ]`
const STATE_CELLS = 10
const ID_MIN = 2
const MODEL_MIN = 8
const MODEL_MAX = 28
const PROVIDER_MAX = 18
const ACTIVITY_MIN = 12
const LEAD_CELLS = 2

const GROUPS = ['needs you', 'running', 'done', 'failed', 'stopped'] as const

function rowsOf(input: BandInput, drawn: readonly ClaudishRun[]): BandRow[] {
  const severalRuns = drawn.length > 1
  const rows: BandRow[] = []
  for (const run of drawn) {
    const label = runLabel(run)
    const support = input.feeds[feedKey(run.ref)]
    const canCancel = support?.kind === 'speaks' && support.can.cancel
    if (run.slots.length === 0) {
      const look = STATE_LOOK.STARTING
      rows.push({
        key: `${run.id}/`, attention: false, id: label, glyph: look.glyph, word: look.word, color: look.color, group: look.group,
        model: '', provider: '', tokens: '', tools: '', loops: '', idle: { text: '' }, activity: '',
        stop: 'none', show: false, terminal: false, endedAt: null,
        target: { runId: run.id, epoch: run.epoch, ref: run.ref, slot: '', model: '' },
      })
      continue
    }
    for (const slot of run.slots) {
      const state = shownState(run, slot)
      const look = STATE_LOOK[state]
      const key = slotKey(run.id, slot.slot)
      const req = input.stops[key]
      const terminal = isTerminal(slot.state)
      const stop: StopCell = terminal || !canCancel ? 'none'
        : req?.kind === 'armed' ? 'confirm'
        : req?.kind === 'sending' || req?.kind === 'sent' ? 'stopping'
        : 'stop'
      const id = run.ref.kind === 'delegation' ? label
        : severalRuns ? `${label}/${slot.slot}`
        : slot.slot
      rows.push({
        key,
        attention: isWaiting(state),
        id,
        glyph: look.glyph,
        word: look.word,
        color: look.color,
        group: look.group,
        model: slot.model,
        provider: slot.provider ?? '',
        tokens: tokenPair(slot.tokensIn, slot.tokensOut),
        tools: slot.toolCalls === null ? DASH : `${slot.toolCalls} tools`,
        loops: slot.turnsCompleted === null ? DASH : `${slot.turnsCompleted} loops`,
        idle: idleOf(slot, state),
        activity: activityOf(run, slot, state),
        stop,
        show: slot.slot !== '*',
        terminal,
        endedAt: terminal ? slot.lastActivityAt : null,
        target: { runId: run.id, epoch: run.epoch, ref: run.ref, slot: slot.slot, model: slot.model },
      })
    }
  }
  // Attention first, then live, then terminal rows, the most recently ended first (by run when unknown).
  const order = (r: BandRow) => (r.attention ? 0 : r.terminal ? 2 : 1)
  const runIndex = new Map(drawn.map((r, i) => [r.id, i]))
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const oa = order(a.r)
      const ob = order(b.r)
      if (oa !== ob) return oa - ob
      if (oa === 2) {
        const ea = a.r.endedAt
        const eb = b.r.endedAt
        if (ea !== null && eb !== null && ea !== eb) return eb - ea
        const ra = runIndex.get(a.r.target.runId) ?? 0
        const rb = runIndex.get(b.r.target.runId) ?? 0
        if (ra !== rb) return rb - ra
      }
      return a.i - b.i
    })
    .map(x => x.r)
}

function width(texts: readonly string[], max = Infinity): number {
  return Math.min(max, texts.reduce((m, t) => Math.max(m, Array.from(t).length), 0))
}

function total(plan: ColumnPlan): number {
  const cols = Object.values(plan).filter(w => w > 0)
  return cols.reduce((s, w) => s + w, 0) + Math.max(0, cols.length - 1)
}

/**
 * Drops columns in a fixed priority until the row fits `bodyColumns`: activity, tokens, tool
 * calls, provider, loops; then the model shrinks to 8, idle goes, the id shrinks to 2, the
 * model goes, and the state shrinks to its glyph. Below that floor, null: header alone.
 */
export function fitColumns(bodyColumns: number, rows: readonly BandRow[]): ColumnPlan | null {
  const content = {
    id: width(rows.map(r => r.id)),
    model: width(rows.map(r => r.model), MODEL_MAX),
    provider: width(rows.map(r => r.provider), PROVIDER_MAX),
    tokens: width(rows.map(r => r.tokens)),
    tools: width(rows.map(r => r.tools)),
    loops: width(rows.map(r => r.loops)),
    idle: width(rows.map(r => r.idle.text)),
    activity: width(rows.map(r => r.activity)),
  }
  const plan: ColumnPlan = {
    lead: LEAD_CELLS, id: content.id, state: STATE_CELLS, model: content.model, provider: content.provider,
    tokens: content.tokens, tools: content.tools, loops: content.loops, idle: content.idle,
    activity: Math.min(content.activity, ACTIVITY_MIN), stop: STOP_CELLS, show: SHOW_CELLS,
  }
  const steps: ((p: ColumnPlan) => void)[] = [
    p => { p.activity = 0 },
    p => { p.tokens = 0 },
    p => { p.tools = 0 },
    p => { p.provider = 0 },
    p => { p.loops = 0 },
    p => { p.model = Math.min(p.model, MODEL_MIN) },
    p => { p.idle = 0 },
    p => { p.id = Math.min(p.id, ID_MIN) },
    p => { p.model = 0 },
    p => { p.state = 1 },
  ]
  for (const step of [null, ...steps]) {
    step?.(plan)
    if (total(plan) <= bodyColumns) {
      // The activity column takes what is left, up to its content.
      if (plan.activity > 0) plan.activity = Math.min(content.activity, plan.activity + bodyColumns - total(plan))
      return plan
    }
  }
  return null
}

function headerOf(rows: readonly BandRow[], input: BandInput): Segment[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    counts.set(r.group, (counts.get(r.group) ?? 0) + 1)
  }
  const out: Segment[] = [{ text: '◆ claudish', color: 'claude', bold: true }]
  for (const g of GROUPS) {
    const n = counts.get(g) ?? 0
    if (n === 0) continue
    out.push(g === 'needs you' ? { text: ` · ${n} needs you`, color: 'permission' } : { text: ` · ${n} ${g}`, dim: true })
  }
  const parked = Object.values(input.ledger.entries).filter(e => e.kind === 'parked').length
  if (parked > 0) out.push({ text: ` · ${parked} ${parked === 1 ? 'notice' : 'notices'} not delivered`, color: 'error' })
  if (input.earlier.runs > 0) out.push({ text: ` · +${input.earlier.runs} earlier`, dim: true })
  return out
}

/**
 * The band, or null when there is nothing to draw (no drawn run and nothing compacted).
 * Rows fit `bodyColumns` (never wrapping); past `maxRows`, terminal rows fold into one line.
 */
export function bandModel(input: BandInput): BandModel | null {
  const drawn = input.runs.list.filter(r => isDrawn(r, input.feeds))
  if (drawn.length === 0 && input.earlier.runs === 0) return null
  const all = rowsOf(input, drawn)
  const header = headerOf(all, input)
  const plan = fitColumns(input.bodyColumns, all)
  if (plan === null) return { header, plan: null, rows: [], more: null }
  if (1 + all.length <= input.maxRows) return { header, plan, rows: all, more: null }
  const kept = all.filter(r => !r.terminal)
  const folded = all.filter(r => r.terminal)
  if (folded.length === 0) return { header, plan, rows: all, more: null }
  const by = new Map<string, number>()
  for (const r of folded) {
    by.set(r.group, (by.get(r.group) ?? 0) + 1)
  }
  const parts = GROUPS.filter(g => by.has(g)).map(g => `${by.get(g)} ${g}`)
  return { header, plan, rows: kept, more: `+${folded.length} more: ${parts.join(' · ')}` }
}

/** One row's cells as drawn text, each cut and padded to its column. */
export function rowCells(row: BandRow, plan: ColumnPlan): {
  lead: string; id: string; state: string; model: string; provider: string; tokens: string
  tools: string; loops: string; idle: string; activity: string
} {
  const fit = (text: string, w: number, right = false) => {
    if (w <= 0) return ''
    const c = cut(text, w)
    return right ? ' '.repeat(Math.max(0, w - Array.from(c).length)) + c : pad(c, w)
  }
  return {
    lead: row.attention ? '▌ ' : '  ',
    id: fit(row.id, plan.id),
    state: plan.state >= STATE_CELLS ? fit(`${row.glyph} ${row.word}`, plan.state) : row.glyph,
    model: fit(row.model, plan.model),
    provider: fit(row.provider, plan.provider),
    tokens: fit(row.tokens, plan.tokens, true),
    tools: fit(row.tools, plan.tools, true),
    loops: fit(row.loops, plan.loops, true),
    idle: fit(row.idle.text, plan.idle),
    activity: fit(row.activity, plan.activity),
  }
}

/** The planned width of one row, gaps included. */
export function planWidth(plan: ColumnPlan): number {
  return total(plan)
}

// ── Show tab: fit, viewport, colours, budget ─────────────────────────────────

export type PaneFit = { columns: number; rows: number; paint: boolean }

const FALLBACK_COLUMNS = 80
const FALLBACK_ROWS = 20

function positive(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback
}

/** The tab's room: its body width, and its height from the scroll window's rows (never a top-level field). */
export function paneFit(props: { bodyColumns?: unknown; scroll?: { bodyRows?: unknown } | null }, surface: string): PaneFit {
  return {
    columns: positive(props.bodyColumns, FALLBACK_COLUMNS),
    rows: positive(props.scroll?.bodyRows, FALLBACK_ROWS),
    paint: PAINT_SURFACES.includes(surface),
  }
}

/** A child's colour as the engine takes a raw colour: `#rrggbb`. */
export function colorSpelling(c: ClaudishColor): Color {
  const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
  if ('rgb' in c) return `#${(c.rgb & 0xffffff).toString(16).padStart(6, '0')}`
  const n = c.index
  if (n >= 16 && n <= 231) {
    const k = n - 16
    const v = (x: number) => (x === 0 ? 0 : 55 + 40 * x)
    return hex(v(Math.floor(k / 36)), v(Math.floor(k / 6) % 6), v(k % 6))
  }
  if (n >= 232 && n <= 255) {
    const v = 8 + 10 * (n - 232)
    return hex(v, v, v)
  }
  return `#${XTERM_16[Math.max(0, Math.min(15, n))]}`
}

const XTERM_16 = [
  '000000', 'cd0000', '00cd00', 'cdcd00', '0000ee', 'cd00cd', '00cdcd', 'e5e5e5',
  '7f7f7f', 'ff0000', '00ff00', 'ffff00', '5c5cff', 'ff00ff', '00ffff', 'ffffff',
]

/** One styled run of a frame line, its colours already spelled. */
export type PaneSegment = { text: string; color?: Color; backgroundColor?: Color; bold?: true }
/** One drawn frame line: plain strings and styled segments, in order. */
export type PaneLine = (string | PaneSegment)[]

// A wide or astral character makes a line's cells and characters disagree: draw it plain.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\ud800-\udbff]/

function styledLine(chars: readonly string[], spans: readonly ClaudishStyleSpan[]): PaneLine {
  const out: PaneLine = []
  let pos = 0
  for (const s of spans) {
    const from = Math.max(s.col, pos)
    const to = Math.min(s.col + s.len, chars.length)
    if (from >= to) continue
    if (from > pos) out.push(chars.slice(pos, from).join(''))
    const seg: PaneSegment = { text: chars.slice(from, to).join('') }
    if (s.fg !== null) seg.color = colorSpelling(s.fg)
    if (s.bg !== null) seg.backgroundColor = colorSpelling(s.bg)
    if (s.bold) seg.bold = true
    out.push(seg)
    pos = to
  }
  if (pos < chars.length) out.push(chars.slice(pos).join(''))
  return out.length > 0 ? out : ['']
}

/** The estimate the style budget is held to: per line, its cost, its text, and each styled segment. */
export function paneCost(lines: readonly PaneLine[]): number {
  let cost = 0
  for (const line of lines) {
    cost += PANE_LINE_COST
    for (const part of line) cost += typeof part === 'string' ? part.length : part.text.length + PANE_SEGMENT_COST
  }
  return cost
}

export type PaneFrameLines = { lines: PaneLine[]; painted: boolean }

/**
 * The drawn frame: trailing blank lines trimmed, the LAST `rows - 1` lines kept (one row is
 * the header; Claude Code's prompt and newest output are at the bottom), each cut to
 * `columns + 1` cells so the engine still truncates with …; the child's colours painted
 * when the frame carries them, the surface paints, and the estimate fits the budget.
 */
export function paneLines(frame: ClaudishFrame | null, fit: PaneFit): PaneFrameLines {
  if (!frame) return { lines: [], painted: false }
  let last = frame.lines.length - 1
  while (last >= 0 && (frame.lines[last] ?? '').trim() === '') last -= 1
  const keep = Math.max(0, fit.rows - 1)
  const first = Math.max(0, last + 1 - keep)
  const limit = fit.columns + 1
  const picked: { chars: string[]; spans: readonly ClaudishStyleSpan[] }[] = []
  for (let i = first; i <= last; i++) {
    const chars = Array.from(frame.lines[i] ?? '').slice(0, limit)
    picked.push({ chars, spans: frame.styles?.[i] ?? [] })
  }
  const plain = (): PaneLine[] => picked.map(p => [p.chars.join('')])
  if (!fit.paint || !frame.styles) return { lines: plain(), painted: false }
  const styled = picked.map(p => (p.spans.length === 0 || WIDE.test(p.chars.join('')) ? [p.chars.join('')] : styledLine(p.chars, p.spans)))
  if (paneCost(styled) > PANE_STYLE_BUDGET) return { lines: plain(), painted: false }
  return { lines: styled, painted: styled.some(l => l.some(part => typeof part !== 'string')) }
}

// ── Show tab: what it draws ───────────────────────────────────────────────────

export type PaneBody =
  | { kind: 'waiting' }
  | { kind: 'unavailable'; note: string; numbers: string }
  | { kind: 'frame'; lines: PaneLine[] }
  | { kind: 'note'; note: string }

export type PaneModel = { header: Segment[]; body: PaneBody }

/** The tab's header (the row's own styling, theme keys only) and its body. */
export function paneModel(view: ClaudishPaneView, runs: ClaudishRuns, fit: PaneFit): PaneModel {
  const run = runs.list.find(r => r.id === view.runId)
  const slot = run?.slots.find(s => s.slot === view.slot)
  const header: Segment[] = []
  if (run && slot) {
    const state = shownState(run, slot)
    const look = STATE_LOOK[state]
    header.push({ text: `${look.glyph} ${look.word}`, color: look.color }, { text: ` ${view.model}` })
    if (slot.provider) header.push({ text: ` · ${slot.provider}`, dim: true })
    const idle = idleOf(slot, state)
    if (idle.text) header.push({ text: ` · ${idle.text}`, ...(idle.color ? { color: idle.color } : {}) })
    const activity = activityOf(run, slot, state)
    if (activity) header.push({ text: ` · ${activity}`, dim: true })
  } else {
    header.push({ text: view.model })
  }
  if (view.status === 'ended') header.push({ text: ' · ended', dim: true })

  const numbers = slot
    ? [slot.tokensIn === null && slot.tokensOut === null ? DASH : `${tokenPair(slot.tokensIn, slot.tokensOut)} tokens`,
        slot.toolCalls === null ? DASH : `${slot.toolCalls} tools`,
        slot.turnsCompleted === null ? DASH : `${slot.turnsCompleted} loops`].join(' · ')
    : ''

  let body: PaneBody
  if (view.status === 'waiting') body = { kind: 'waiting' }
  else if (view.status === 'unavailable') {
    const note = view.note === null || view.note === NO_CAPTURE_NOTE ? NO_CAPTURE_NOTE : `Live screen not available right now: ${view.note}`
    body = { kind: 'unavailable', note, numbers }
  } else if (view.frame) body = { kind: 'frame', lines: paneLines(view.frame, fit).lines }
  else body = { kind: 'note', note: view.note ?? '' }
  return { header, body }
}
