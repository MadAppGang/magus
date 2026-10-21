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
  ClaudishTrailKind,
} from '../../types'
import {
  NO_CAPTURE_NOTE,
  PAINT_SURFACES,
  PANE_LINE_COST,
  PANE_SEGMENT_COST,
  PANE_STYLE_BUDGET,
  STALE_NUMBER_S,
  STALE_STEPS_S,
  STATE_LOOK,
  feedKey,
  isDrawn,
  shownRuns,
  isTerminal,
  isWaiting,
  lookOf,
  runLabel,
  paneId,
  slotKey,
  type BadgeTone,
  type Group,
  type StatusColor,
} from './domain'
import type { Hue } from './palette'

// ── shared ────────────────────────────────────────────────────────────────────

/** One run of text in the mod's own drawing: theme keys only. */
export type Segment = { text: string; color?: StatusColor; backgroundColor?: StatusColor; dim?: true; bold?: true }

/** What a Stop or Show press acts on: values the render read. */
export type SlotTarget = { runId: string; epoch: number; ref: ClaudishRunRef; slot: string; model: string; label: string }

const DASH = '—'

/** A count in at most 6 cells: 850, 12.0k, 2.3M; null → —. */
export function count(n: number | null): string {
  if (n === null) return DASH
  // At most 4 characters past the arrow: a decimal only where it is one of three digits.
  const a = Math.abs(n)
  return a < 1000 ? String(Math.round(n)) : a < 9_950 ? `${(n / 1000).toFixed(1)}k` : a < 999_500 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1)}M`
}

/** The provider as the band shows it: claudish's `Anthropic (Native)` reads `Anthropic`. The cost
 *  cell still reads claudish's own name, where "native" means a subscription. */
export function providerName(provider: string | null | undefined): string {
  return (provider ?? '').replace(/\s*\(native\)\s*$/i, '')
}

/** A cost in at most 6 cells: `<$0.01`, `$0.42`, `$12.3`, `$123`; null → —. */
export function dollars(usd: number | null | undefined): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return DASH // undefined: a slot recorded before costs were read
  if (usd === 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  return usd < 10 ? `$${usd.toFixed(2)}` : usd < 100 ? `$${usd.toFixed(1)}` : `$${Math.round(usd)}`
}

/**
 * The cost cell: dollars when claudish reports a charge; `SUB` when the slot runs on a subscription
 * (claudish reports 0, or a native Claude model, which it reports no cost for); — when unknown.
 */
function costCell(slot: ClaudishSlot): string {
  if (slot.costUsd === 0 || ((slot.costUsd ?? null) === null && /native/i.test(slot.provider ?? ''))) return SUB
  return dollars(slot.costUsd)
}
const SUB = 'SUB'

/** Tokens as two values, each in its own unit: `↑12.7k ↓780`, in (sent to the model) then out. Both unknown → —. */
export function tokenIO(tokensIn: number | null, tokensOut: number | null): string {
  if (tokensIn === null && tokensOut === null) return DASH
  return `↑${count(tokensIn)} ↓${count(tokensOut)}`
}

/** Tool calls and loops as a symbol and a number: `ƒ 8`, `↻ 1`; unknown → —. */
export function tally(symbol: string, n: number | null): string {
  return n === null ? DASH : `${symbol} ${n}`
}

/** 4 → 4s, 125 → 2m, 7300 → 2h; null → —. */
export function age(seconds: number | null): string {
  if (seconds === null) return DASH
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

/**
 * A runtime in at most 5 cells, as tt draws it: 42s, 17m, 3h12m below ten hours, 13h below
 * a day, 6d02h below ten days, 12d beyond. Null (no start time) is —, never a fake 0.
 */
export function runtime(ms: number | null): string {
  if (ms === null) return DASH
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (s < 60) return `${s}s`
  if (m < 60) return `${m}m`
  if (h < 10) return `${h}h${String(m % 60).padStart(2, '0')}m`
  if (h < 24) return `${h}h`
  if (d < 10) return `${d}d${String(h % 24).padStart(2, '0')}h`
  return `${Math.min(d, 999)}d`
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

function padStart(text: string, width: number): string {
  const n = Array.from(text).length
  return n >= width ? text : ' '.repeat(width - n) + text
}

/** The state a row draws: a live slot of an unreachable run is `unknown`, never its stale state. */
function shownState(run: ClaudishRun, slot: ClaudishSlot): ClaudishSlotState {
  return run.unreachableSince !== null && !isTerminal(slot.state) ? 'UNKNOWN' : slot.state
}

/** The activity column: what a live slot does, or why a terminal one ended (not a repeat of its badge). */
function activityOf(run: ClaudishRun, slot: ClaudishSlot, state: ClaudishSlotState): string {
  if (state === 'UNKNOWN' && run.unreachableSince !== null) return ''
  if (!isTerminal(state)) return slot.activity ?? ''
  if (state === 'LOST') return slot.reason ?? run.lostReason ?? ''
  const reason = slot.reason ?? ''
  if (slot.detail) return reason ? `${reason}: ${slot.detail}` : slot.detail // the provider's own words beat the code
  return reason === 'cancelled' || reason === 'timeout' || reason === 'shape_mismatch' ? '' : reason
}

/** How long a slot has run: to now while live, to its last activity once it ended. */
function slotRuntime(run: ClaudishRun, slot: ClaudishSlot, now: number): number | null {
  if (run.startedAt === undefined) return null
  const end = isTerminal(slot.state) ? (slot.lastActivityAt ?? run.settledAt) : now
  return end === null ? null : Math.max(0, end - run.startedAt)
}

/**
 * The stale-meter: how long a running slot has been silent, as cells filled; none for any other
 * slot. Under STALE_NUMBER_S of silence the slot is streaming: `flowing`, which the band animates.
 * `idle` is the silence in whole seconds, from which the band counts on between polls.
 */
export type Meter = { filled: number; number: string; color: StatusColor; flowing: boolean; idle: number }
export const METER_CELLS = STALE_STEPS_S.length
/** A space and up to three characters of silence (`59s`, `12m`). */
const METER_NUMBER_CELLS = 4

/** One step of a slot's timeline as the live cell takes it: ms from the run's start, its kind, the tool, its line. */
export type TrailMark = { t: number; k: ClaudishTrailKind; tool: string; x: string }
/**
 * A slot's timeline: its last TRAIL_SHOWN steps; how long the run has gone (to now while live, to
 * its end once ended); the silence in whole seconds while live; how long ago it ended.
 */
export type TrailView = { steps: TrailMark[]; elapsed: number; live: boolean; idle: number; endedFor: number }

/** Steps the live cell receives: more than either look draws, so a long trail costs the cell nothing. */
export const TRAIL_SHOWN = 40

/** The slot's timeline, or null when nothing was recorded for it. */
export function trailView(run: ClaudishRun, slot: ClaudishSlot, now: number): TrailView | null {
  const steps = run.trails?.[slot.slot]
  if (!steps || steps.length === 0) return null
  const start = Math.min(run.startedAt ?? steps[0]!.at, steps[0]!.at)
  const last = steps[steps.length - 1]!
  const live = !isTerminal(slot.state)
  const end = live ? now : last.at
  const cut = Math.max(0, steps.length - TRAIL_SHOWN)
  return {
    steps: steps.slice(cut).map(s => ({ t: Math.max(0, s.at - start), k: s.kind, tool: s.tool ?? '', x: s.text ?? '' })),
    elapsed: Math.max(1, end - start),
    live,
    idle: live && slot.idleSeconds !== null ? Math.max(0, Math.floor(slot.idleSeconds)) : 0,
    endedFor: live ? 0 : Math.max(0, now - last.at),
  }
}

export function staleMeter(slot: ClaudishSlot, state: ClaudishSlotState): Meter | null {
  if (state !== 'RUNNING' || slot.idleSeconds === null) return null
  const idle = Math.max(0, Math.floor(slot.idleSeconds))
  if (idle < STALE_NUMBER_S) return { filled: 0, number: '', color: 'success', flowing: true, idle }
  const filled = STALE_STEPS_S.filter(s => idle >= s).length
  return { filled, number: age(idle), color: meterColor(filled), flowing: false, idle }
}

/** Green while the silence is short, amber from a minute (three cells), red from two (all five). */
export function meterColor(filled: number): StatusColor {
  return filled >= METER_CELLS ? 'error' : filled >= 3 ? 'warning' : 'success'
}

/** The meter's cells as text: ▰ for each filled cell, ▱ for the rest. */
export function meterCells(m: Meter): string {
  return '▰'.repeat(m.filled) + '▱'.repeat(METER_CELLS - m.filled)
}

export { isDrawn, shownRuns }

// ── band ──────────────────────────────────────────────────────────────────────

export type StopCell = 'stop' | 'confirm' | 'stopping' | 'none'

/** A row's status badge: the code on its hue's solid fill, then the runtime on its quiet fill. */
export type Badge = { code: string; runtime: string; hue: Hue }

const HUE_OF: Readonly<Record<BadgeTone, Hue>> = {
  run: 'run', ask: 'ask', done: 'done', fail: 'fail', format: 'format', stopped: 'stopped', unclear: 'stopped',
}

export type BandRow = {
  /** `${runId}/${slot}`, or `${runId}/` for a run not listed yet */
  key: string
  attention: boolean
  id: string
  badge: Badge
  word: string
  /** the header word it counts under */
  group: Group
  model: string
  provider: string
  /** `↑12.7k` and `↓780`, the two halves of the tokens badge. tokensOut empty: no badge, tokensIn drawn
   *  alone (— when both are unknown, empty for a run not listed yet) */
  tokensIn: string
  tokensOut: string
  /** the counts after the ƒ and ↻ marks: `8`, or — when unknown; empty for a run not listed yet */
  tools: string
  loops: string
  /** `$0.12`, — when unknown or billed by a subscription; empty for a run not listed yet */
  cost: string
  meter: Meter | null
  /** the slot's timeline, for the live cell; null for a run not listed yet */
  trail: TrailView | null
  activity: string
  stop: StopCell
  show: boolean
  /** the open Show panel is on this slot's tab */
  active: boolean
  terminal: boolean
  /** when a terminal row ended (its last activity), for the most-recent-first order; null when unknown */
  endedAt: number | null
  target: SlotTarget
}

/** Cells per column; 0 = dropped. `badge` is BADGE_CELLS (code and runtime) or CODE_CELLS (code alone). */
export type ColumnPlan = {
  lead: number; id: number; badge: number; model: number; provider: number; tokens: number
  tools: number; loops: number; cost: number; meter: number; activity: number; stop: number; show: number
  /** the in half's share of `tokens`: the two halves are one block, so this is not a column */
  tokensIn: number
}

const COLUMNS = ['lead', 'id', 'badge', 'model', 'provider', 'tokens', 'tools', 'loops', 'cost', 'meter', 'activity', 'stop', 'show'] as const

export type BandModel = {
  header: Segment[]
  /** null: the band is too narrow for any row, so it draws the header alone */
  plan: ColumnPlan | null
  rows: BandRow[]
  /** `+N more: …` when terminal rows were folded for height */
  more: string | null
  /** the Show panel is open: the header carries its Hide button */
  panelOpen: boolean
}

export type BandInput = {
  runs: ClaudishRuns
  feeds: Readonly<Record<string, ClaudishFeedSupport>>
  stops: Readonly<Record<string, ClaudishStopRequest>>
  ledger: ClaudishLedger
  earlier: ClaudishEarlier
  bodyColumns: number
  maxRows: number
  /** the clock, for each live slot's runtime */
  now: number
  /** the Show panel: whether it is open, and which slot's tab (a tab id) it shows */
  panel: { open: boolean; active: string | null }
}

/** ` RUN ` then ` 3h12m `: one cell each side of a 3-cell code and a 5-cell runtime, as tt's badge. */
export const CODE_CELLS = 5
export const RUNTIME_CELLS = 7
const BADGE_CELLS = CODE_CELLS + RUNTIME_CELLS
export const STOP_CELLS = 9 // `[ Stop? ]`
export const SHOW_CELLS = 8 // `[ Show ]`, `[ Hide ]`
/** The marks before the tool-call and loop counts. */
export const TOOLS_MARK = 'ƒ'
export const LOOPS_MARK = '↻'
/** A badge half's padding (one cell each side), and a mark, which its number follows with no space (`ƒ8`). */
const PAD = 2
const MARK_CELLS = 1
const ID_MIN = 2
const MODEL_MIN = 8
const MODEL_MAX = 28
const PROVIDER_MAX = 18
const ACTIVITY_MIN = 12
export const LEAD_CELLS = 2

const GROUPS: readonly Group[] = ['needs you', 'running', 'done', 'wrong format', 'failed', 'stopped']

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
        key: `${run.id}/`, attention: false, id: label,
        badge: { code: look.code, runtime: runtime(run.startedAt === undefined ? null : input.now - run.startedAt), hue: HUE_OF[look.tone] },
        word: look.word, group: look.group,
        model: '', provider: '', tokensIn: '', tokensOut: '', tools: '', loops: '', cost: '', meter: null, trail: null, activity: '',
        stop: 'none', show: false, active: false, terminal: false, endedAt: null,
        target: { runId: run.id, epoch: run.epoch, ref: run.ref, slot: '', model: '', label },
      })
      continue
    }
    for (const slot of run.slots) {
      const state = shownState(run, slot)
      const look = lookOf(state, slot.reason)
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
      const trail = trailView(run, slot, input.now)
      rows.push({
        key,
        attention: isWaiting(state),
        id,
        badge: { code: look.code, runtime: runtime(slotRuntime(run, slot, input.now)), hue: HUE_OF[look.tone] },
        word: look.word,
        group: look.group,
        model: slot.model,
        provider: providerName(slot.provider),
        // Both unknown: one — and no badge (tokensOut empty), as the Show tab reads it.
        tokensIn: slot.tokensIn === null && slot.tokensOut === null ? DASH : `↑${count(slot.tokensIn)}`,
        tokensOut: slot.tokensIn === null && slot.tokensOut === null ? '' : `↓${count(slot.tokensOut)}`,
        tools: slot.toolCalls === null ? DASH : String(slot.toolCalls),
        loops: slot.turnsCompleted === null ? DASH : String(slot.turnsCompleted),
        cost: costCell(slot),
        meter: staleMeter(slot, state),
        trail,
        // A row drawn as a timeline says what it does there; the column is for a row without one.
        activity: trail ? '' : activityOf(run, slot, state),
        stop,
        show: slot.slot !== '*',
        active: input.panel.open && input.panel.active === paneId(run.id, slot.slot),
        terminal,
        endedAt: terminal ? slot.lastActivityAt : null,
        target: { runId: run.id, epoch: run.epoch, ref: run.ref, slot: slot.slot, model: slot.model, label },
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

/** The row's width: each column and one gap between columns. The provider is the model badge's second half, so no gap. */
/** Tokens, tool calls, loops and cost: one block of badges, joined with no gap between them. */
const STATS = ['tokens', 'tools', 'loops', 'cost'] as const

function total(plan: ColumnPlan): number {
  // The provider and the stats block join the model badge with no gap: one block from model to cost.
  const stats = STATS.reduce((sum, k) => sum + plan[k], 0)
  const cols = COLUMNS.filter(k => k !== 'provider' && !(STATS as readonly string[]).includes(k)).map(k => plan[k]).filter(w => w > 0)
  return cols.reduce((sum, w) => sum + w, 0) + Math.max(0, cols.length - 1) + plan.provider + stats
}

/** The meter column's text for one row: the cells, then the silence once it is worth a number. */
function meterText(m: Meter | null): string {
  return m === null ? '' : m.number === '' ? meterCells(m) : `${meterCells(m)} ${m.number}`
}

/**
 * Drops columns in a fixed priority until the row fits `bodyColumns`: activity, provider, loops,
 * tool calls, tokens, cost, the meter; then the badge loses its runtime, the id shrinks to 2, and
 * last the model shrinks to 8. The model is never dropped: it is what the row is about. Below
 * that floor, null: header alone.
 */
export function fitColumns(bodyColumns: number, rows: readonly BandRow[]): ColumnPlan | null {
  const content = {
    id: width(rows.map(r => r.id)),
    model: width(rows.map(r => r.model), MODEL_MAX),
    provider: width(rows.map(r => r.provider), PROVIDER_MAX),
    tokensIn: width(rows.map(r => r.tokensIn)),
    tokensOut: width(rows.map(r => r.tokensOut)),
    tools: width(rows.map(r => r.tools)),
    loops: width(rows.map(r => r.loops)),
    cost: width(rows.map(r => r.cost)),
    // A live meter counts on between polls (flow.tsx), so its column keeps room for the number.
    meter: Math.max(width(rows.map(r => meterText(r.meter))), rows.some(r => r.meter !== null || r.trail !== null) ? METER_CELLS + METER_NUMBER_CELLS : 0),
    activity: width(rows.map(r => r.activity)),
  }
  const plan: ColumnPlan = {
    lead: LEAD_CELLS, id: content.id, badge: BADGE_CELLS,
    model: content.model > 0 ? content.model + PAD : 0, provider: content.provider > 0 ? content.provider + PAD : 0,
    // No row with an out half (both counts unknown everywhere): one part, so one padding.
    tokens: content.tokensIn > 0 ? content.tokensIn + PAD + (content.tokensOut > 0 ? content.tokensOut + PAD : 0) : 0,
    tokensIn: content.tokensIn + PAD,
    tools: content.tools > 0 ? MARK_CELLS + content.tools + PAD : 0,
    loops: content.loops > 0 ? MARK_CELLS + content.loops + PAD : 0,
    cost: content.cost > 0 ? content.cost + PAD : 0,
    meter: content.meter,
    activity: Math.min(content.activity, ACTIVITY_MIN),
    // No row can be stopped (the run ended): the Stop column gives its room to the timeline.
    stop: rows.some(r => r.stop !== 'none') ? STOP_CELLS : 0, show: SHOW_CELLS,
  }
  const steps: ((p: ColumnPlan) => void)[] = [
    p => { p.activity = 0 },
    p => { p.provider = 0 },
    p => { p.loops = 0 },
    p => { p.tools = 0 },
    p => { p.tokens = 0 },
    p => { p.cost = 0 },
    p => { p.meter = 0 },
    p => { p.badge = CODE_CELLS },
    p => { p.id = Math.min(p.id, ID_MIN) },
    p => { p.model = Math.min(p.model, MODEL_MIN + PAD) },
  ]
  for (const step of [null, ...steps]) {
    step?.(plan)
    if (total(plan) <= bodyColumns) {
      // The activity column takes what is left, up to its content.
      if (plan.activity > 0) plan.activity = Math.min(content.activity, plan.activity + bodyColumns - total(plan))
      // A timeline takes the rest exactly: its module draws as wide as it is told, so a region
      // left to size itself pushes the id, status and model columns out of the row.
      if (plan.meter > 0 && rows.some(r => r.trail !== null)) plan.meter += Math.max(0, bodyColumns - total(plan))
      return plan
    }
  }
  return null
}

function headerOf(rows: readonly BandRow[], input: BandInput, shown: readonly ClaudishRun[], older: number): Segment[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    counts.set(r.group, (counts.get(r.group) ?? 0) + 1)
  }
  const out: Segment[] = [{ text: '◆ claudish', color: 'claude', bold: true }]
  const only = shown.length === 1 ? shown[0] : undefined
  if (only && only.ref.kind === 'panel') out.push({ text: `  ${runLabel(only)}`, bold: true })
  for (const g of GROUPS) {
    const n = counts.get(g) ?? 0
    if (n === 0) continue
    out.push(g === 'needs you' ? { text: ` · ${n} needs you`, color: 'permission', bold: true }
      : g === 'wrong format' ? { text: ` · ${n} wrong format`, color: 'warning' }
      : { text: ` · ${n} ${g}`, dim: true })
  }
  const parked = Object.values(input.ledger.entries).filter(e => e.kind === 'parked').length
  if (parked > 0) out.push({ text: ` · ${parked} ${parked === 1 ? 'notice' : 'notices'} not delivered`, color: 'error' })
  const earlier = older + input.earlier.runs
  if (earlier > 0) out.push({ text: ` · ${earlier} earlier ${earlier === 1 ? 'run' : 'runs'}`, dim: true })
  return out
}

/**
 * The band, or null when there is nothing to draw (no drawn run and nothing compacted).
 * It draws the most recent run and any older run still live; rows fit `bodyColumns` (never
 * wrapping); past `maxRows`, terminal rows fold into one line.
 */
export function bandModel(input: BandInput): BandModel | null {
  const drawn = input.runs.list.filter(r => isDrawn(r, input.feeds))
  if (drawn.length === 0 && input.earlier.runs === 0) return null
  const { shown, older } = shownRuns(drawn)
  const all = rowsOf(input, shown)
  const header = headerOf(all, input, shown, older)
  const plan = fitColumns(input.bodyColumns, all)
  const panelOpen = input.panel.open
  if (plan === null) return { header, plan: null, rows: [], more: null, panelOpen }
  if (1 + all.length <= input.maxRows) return { header, plan, rows: all, more: null, panelOpen }
  const kept = all.filter(r => !r.terminal)
  const folded = all.filter(r => r.terminal)
  if (folded.length === 0) return { header, plan, rows: all, more: null, panelOpen }
  const by = new Map<string, number>()
  for (const r of folded) {
    by.set(r.group, (by.get(r.group) ?? 0) + 1)
  }
  const parts = GROUPS.filter(g => by.has(g)).map(g => `${by.get(g)} ${g}`)
  return { header, plan, rows: kept, more: `+${folded.length} more: ${parts.join(' · ')}`, panelOpen }
}

/** One row's cells as drawn text, each cut and padded to its column. The badge halves carry their own padding. */
export function rowCells(row: BandRow, plan: ColumnPlan): {
  lead: string; id: string; code: string; runtime: string; model: string; provider: string
  tokensIn: string; tokensOut: string; tools: string; loops: string; cost: string; meter: string; meterNumber: string; activity: string
} {
  const fit = (text: string, w: number, right = false) => {
    if (w <= 0) return ''
    const c = cut(text, w)
    return right ? padStart(c, w) : pad(c, w)
  }
  const m = row.meter
  const meterNumber = m && m.number !== '' && plan.meter > METER_CELLS ? ` ${m.number}` : ''
  return {
    lead: row.attention ? '▌ ' : '  ',
    id: fit(row.id, plan.id),
    code: ` ${pad(cut(row.badge.code, CODE_CELLS - 2), CODE_CELLS - 2)} `,
    runtime: plan.badge > CODE_CELLS ? ` ${padStart(cut(row.badge.runtime, RUNTIME_CELLS - 2), RUNTIME_CELLS - 2)} ` : '',
    model: plan.model > 0 ? ` ${fit(row.model, plan.model - PAD)} ` : '',
    provider: plan.provider > 0 ? ` ${fit(row.provider, plan.provider - PAD)} ` : '',
    // The stats block: each part has one space on each side; the parts touch, fill to fill.
    tokensIn: plan.tokens > 0 ? ` ${fit(row.tokensIn, (row.tokensOut === '' ? plan.tokens : plan.tokensIn) - PAD, true)} ` : '',
    tokensOut: plan.tokens > 0 && row.tokensOut !== '' ? ` ${fit(row.tokensOut, plan.tokens - plan.tokensIn - PAD, true)} ` : '',
    tools: plan.tools > 0 ? (row.tools === '' ? ' '.repeat(plan.tools) : ` ${TOOLS_MARK}${fit(row.tools, plan.tools - MARK_CELLS - PAD)} `) : '',
    loops: plan.loops > 0 ? (row.loops === '' ? ' '.repeat(plan.loops) : ` ${LOOPS_MARK}${fit(row.loops, plan.loops - MARK_CELLS - PAD)} `) : '',
    cost: plan.cost > 0 ? ` ${fit(row.cost, plan.cost - PAD, true)} ` : '',
    meter: plan.meter <= 0 ? '' : m ? meterCells(m) : ' '.repeat(METER_CELLS),
    meterNumber: pad(meterNumber, Math.max(0, plan.meter - METER_CELLS)),
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

/** claudish clamps a resize to at least this size; asking for less would only be clamped again. */
export const CHILD_MIN_COLS = 40
export const CHILD_MIN_ROWS = 24

/**
 * The terminal size a shown child is given: the tab's width, and its height less the header row
 * (`fit` is the tab's fit, the tab strip already taken off). Clamped as claudish clamps, so a
 * size already set compares equal and is not asked for again. A panel smaller than the minimum
 * keeps cropping, as it did before resize existed.
 */
export function childSize(fit: PaneFit): { cols: number; rows: number } {
  return { cols: Math.max(CHILD_MIN_COLS, fit.columns), rows: Math.max(CHILD_MIN_ROWS, fit.rows - 1) }
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
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\ud800-\udbff]/

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
 * when the frame carries them, the surface paints, and the estimate fits the budget. A
 * frame shorter than the tab starts right under the header: no blank rows above it.
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

export type PaneModel = { badge: Badge | null; header: Segment[]; body: PaneBody }

/** The tab's header (the row's badge, then its text, theme keys only) and its body. */
export function paneModel(view: ClaudishPaneView, runs: ClaudishRuns, fit: PaneFit, now: number): PaneModel {
  const run = runs.list.find(r => r.id === view.runId)
  const slot = run?.slots.find(s => s.slot === view.slot)
  const header: Segment[] = []
  let badge: Badge | null = null
  if (run && slot) {
    const state = shownState(run, slot)
    const look = lookOf(state, slot.reason)
    badge = { code: look.code, runtime: runtime(slotRuntime(run, slot, now)), hue: HUE_OF[look.tone] }
    header.push({ text: ` ${view.model}`, bold: true })
    if (slot.provider) header.push({ text: ` · ${providerName(slot.provider)}`, dim: true })
    const m = staleMeter(slot, state)
    if (m) header.push({ text: ` · ${meterText(m)}`, color: m.color })
    const activity = activityOf(run, slot, state)
    if (activity) header.push({ text: ` · ${activity}`, dim: true })
    if (look.tone === 'format') header.push({ text: ' · the answer missed the required format', color: 'warning' })
  } else {
    header.push({ text: view.model, bold: true })
  }
  if (view.status === 'ended') header.push({ text: ' · ended', dim: true })

  const numbers = slot
    ? [`tokens ${tokenIO(slot.tokensIn, slot.tokensOut)}`, tally(TOOLS_MARK, slot.toolCalls), tally(LOOPS_MARK, slot.turnsCompleted)].join(' · ')
    : ''

  let body: PaneBody
  if (view.status === 'waiting') body = { kind: 'waiting' }
  else if (view.status === 'unavailable') {
    const note = view.note === null || view.note === NO_CAPTURE_NOTE ? NO_CAPTURE_NOTE : `Live screen not available right now: ${view.note}`
    body = { kind: 'unavailable', note, numbers }
  } else if (view.frame) body = { kind: 'frame', lines: paneLines(view.frame, fit).lines }
  else body = { kind: 'note', note: view.note ?? '' }
  return { badge, header, body }
}

// ── Show panel: its tabs ──────────────────────────────────────────────────────

/** One tab of the Show panel: a slot of a run the band shows, its view under `id`. */
export type ShowTab = { id: string; label: string; hue: Hue; target: SlotTarget }

/**
 * The panel's tabs: every slot of the runs the band shows, in the band's run order, so a new
 * run's slots are tabs at once, with no Show pressed for each. A tab reads its model; where two
 * tabs share a model, each adds its slot (its run and slot across runs) so no two read alike.
 */
export function showTabs(runs: ClaudishRuns, feeds: Readonly<Record<string, ClaudishFeedSupport>>): ShowTab[] {
  const { shown } = shownRuns(runs.list.filter(r => isDrawn(r, feeds)))
  const severalRuns = shown.length > 1
  const tabs: (ShowTab & { where: string })[] = []
  for (const run of shown) {
    const label = runLabel(run)
    for (const slot of run.slots) {
      if (slot.slot === '*') continue
      const look = lookOf(shownState(run, slot), slot.reason)
      const where = run.ref.kind === 'delegation' ? label : severalRuns ? `${label}/${slot.slot}` : slot.slot
      tabs.push({
        id: paneId(run.id, slot.slot),
        label: slot.model,
        hue: HUE_OF[look.tone],
        target: { runId: run.id, epoch: run.epoch, ref: run.ref, slot: slot.slot, model: slot.model, label },
        where,
      })
    }
  }
  const uses = new Map<string, number>()
  for (const t of tabs) uses.set(t.label, (uses.get(t.label) ?? 0) + 1)
  return tabs.map(({ where, ...t }) => ((uses.get(t.label) ?? 0) > 1 ? { ...t, label: `${t.label} ${where}` } : t))
}

/** A label is never cut below this many cells (5 characters + `…`), unless it is shorter (R12.2). */
export const TAB_FLOOR = 6

/** One tab as the strip draws it: its index into the tabs given, and its label as drawn. */
export type StripTab = { index: number; label: string }

/** A tab's cells besides its label: ` ●` and a space each side. */
const TAB_CELLS = 4
/** The `│` between two tabs of one row. */
const BAR_CELLS = 1

/**
 * The tab strip's rows (R12): the tabs in order, wrapped onto the fewest rows that hold every
 * label at its floor, broken where the largest common cap still gives that row count, then each
 * row's labels cut as R10.3 cuts them in that row's room (the active one last, never below the
 * floor). The first row's room is `width − SHOW_CELLS` (Hide ends it); later rows' is `width`.
 * A first tab that fits the first row at its floor is always there; otherwise the first row holds
 * only Hide. A later row too narrow for one tab at its floor holds one tab cut below it, to
 * `width − 4` cells, never below 1. Always at least one row. Lengths are code points.
 */
export function wrapTabs(tabs: readonly Pick<ShowTab, 'id' | 'label'>[], active: string | null, width: number): StripTab[][] {
  const w = Math.max(0, Math.floor(width))
  const chars = tabs.map(t => Array.from(t.label))
  const full = chars.map(c => c.length)
  const floorOf = (i: number) => Math.min(full[i]!, TAB_FLOOR)
  const room = (r: number) => (r === 0 ? Math.max(0, w - SHOW_CELLS) : w)

  // Next-fit placing in order at a cap: never returns to an earlier row, so the row count is
  // non-decreasing in the cap and the largest cap keeping the floor's row count is a downward scan.
  const place = (cap: number): number[][] => {
    const rows: number[][] = [[]]
    let used = 0
    for (let i = 0; i < tabs.length; i++) {
      for (;;) {
        const r = rows.length - 1
        const row = rows[r]!
        let len = Math.min(full[i]!, cap)
        if (r === 0 && row.length === 0 && floorOf(i) + TAB_CELLS <= room(0)) len = Math.min(len, room(0) - TAB_CELLS)
        const need = (row.length > 0 ? BAR_CELLS : 0) + len + TAB_CELLS
        if (used + need <= room(r)) { row.push(i); used += need; break }
        if (r > 0 && row.length === 0) { row.push(i); used = room(r); break }
        rows.push([])
        used = 0
      }
    }
    return rows
  }

  const count = place(TAB_FLOOR).length
  let breaks: number[][] | null = null
  for (let cap = Math.max(0, ...full); cap > TAB_FLOOR && !breaks; cap--) {
    const rows = place(cap)
    if (rows.length <= count) breaks = rows
  }
  breaks ??= place(TAB_FLOOR)

  return breaks.map((row, r) => {
    const len = row.map(i => full[i]!)
    let cost = len.reduce((s, n) => s + n + TAB_CELLS, 0) + BAR_CELLS * Math.max(0, row.length - 1)
    const passes = r > 0 && row.length === 1 ? [floorOf, () => 1] : [floorOf]
    for (const floor of passes) {
      while (cost > room(r)) {
        let pick = -1
        for (let k = 0; k < row.length; k++) {
          if (len[k]! <= floor(row[k]!) || tabs[row[k]!]!.id === active) continue
          if (pick < 0 || len[k]! > len[pick]!) pick = k
        }
        if (pick < 0) pick = row.findIndex((i, k) => tabs[i]!.id === active && len[k]! > floor(i))
        if (pick < 0) break
        len[pick]!--
        cost--
      }
    }
    return row.map((i, k) => ({ index: i, label: len[k]! >= full[i]! ? tabs[i]!.label : `${chars[i]!.slice(0, len[k]! - 1).join('')}…` }))
  })
}

/** The tab the panel shows: the one last asked for while it is still a tab, else the first. */
export function activeTab(tabs: readonly ShowTab[], asked: string | null): ShowTab | null {
  return tabs.find(t => t.id === asked) ?? tabs[0] ?? null
}
