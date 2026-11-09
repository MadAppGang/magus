// Pure: what the band and the panel draw, fitted to their width and rows. Rows in, plain
// values out; band.tsx and panel.tsx only turn these into trees.

import type { OrchestratorRow, OrchestratorScreenState, OrchestratorStatus } from '../../types'
import {
  GONE_SCREEN_NOTE,
  NARROW_COLUMNS,
  NO_TARGET_NOTE,
  OTHER_MUX_NOTE,
  ROLE_BADGE,
  SELF_SCREEN_NOTE,
  SHOW_ROWS,
  STATUS_GLYPH,
} from './domain'
import type { OwnMux } from './mux'

// ── small formats ─────────────────────────────────────────────────────────────

/** An age as the band shows it: `12s`, `3m`, `2h`, `4d`; empty when unknown. */
export function formatAge(since: number | null, now: number): string {
  if (since === null) return ''
  const s = Math.max(0, Math.floor((now - since) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

/** `done/total`, or empty with no tasks. */
export function formatProgress(p: OrchestratorRow['progress']): string {
  return p ? `${p.done}/${p.total}` : ''
}

/** Cuts text to `width` cells, ending in `…` when cut. */
export function clip(text: string, width: number): string {
  if (width <= 0) return ''
  const chars = [...text]
  if (chars.length <= width) return text
  return width === 1 ? '…' : `${chars.slice(0, width - 1).join('')}…`
}

function pad(text: string, width: number): string {
  const t = clip(text, width)
  return t + ' '.repeat(Math.max(0, width - [...t].length))
}

// ── actions ───────────────────────────────────────────────────────────────────

/** Which buttons a row carries: Jump (a target, not self), Show (always), Open (a ticket URL), Msg (a name, not self). */
export type RowActions = { jump: boolean; show: boolean; open: boolean; msg: boolean }

export function actionsOf(row: OrchestratorRow): RowActions {
  return {
    jump: row.target !== null && !row.isSelf,
    show: true,
    open: row.ticket?.url != null,
    msg: row.name !== null && !row.isSelf,
  }
}

/** The text a Msg press puts in the prompt box. */
export function messageText(name: string): string {
  return `SendMessage to ${name}: `
}

// ── the band ──────────────────────────────────────────────────────────────────

export const BUTTON_CELLS = { jump: 8, show: 8, open: 8, msg: 7 } as const
const GAP = 1
const LABEL_MIN = 8
const LABEL_MAX = 24
const TICKET_MAX = 18
const WAITS_MIN = 6

/** Which cells the band draws at this width, and how wide each is (0 = dropped). */
export type CellPlan = {
  indent: number
  label: number
  role: number
  ticket: number
  status: number
  progress: number
  waits: number
  jump: number
  open: number
  msg: number
  show: number
}

export type BandRow = {
  key: string
  indent: string
  glyph: string
  label: string
  role: string
  ticket: string
  status: OrchestratorStatus
  statusText: string
  progress: string
  waits: string
  needsYou: boolean
  isSelf: boolean
  adopted: boolean
  actions: RowActions
}

export type BandModel = {
  header: string
  needYou: number
  panelOpen: boolean
  plan: CellPlan
  rows: BandRow[]
  /** sessions not drawn on the band; 0 when every one is */
  more: number
  /** true when the band has one row only: More then sits on the header */
  moreInHeader: boolean
}

function statusCell(row: OrchestratorRow, now: number): string {
  const age = formatAge(row.since, now)
  return age === '' ? row.status : `${row.status} ${age}`
}

function bandRow(row: OrchestratorRow, now: number): BandRow {
  return {
    key: row.key,
    indent: '  '.repeat(row.depth),
    glyph: STATUS_GLYPH[row.status],
    label: row.adopted ? `${row.label} (no parent)` : row.label,
    role: ROLE_BADGE[row.role],
    ticket: row.ticket?.id ?? '',
    status: row.status,
    statusText: statusCell(row, now),
    progress: formatProgress(row.progress),
    waits: row.waits ?? '',
    needsYou: row.needsYou,
    isSelf: row.isSelf,
    adopted: row.adopted,
    actions: actionsOf(row),
  }
}

function widest(values: readonly string[]): number {
  return values.reduce((m, v) => Math.max(m, [...v].length), 0)
}

/**
 * The cells that fit `columns`. Label, status and Show always stay; below NARROW_COLUMNS
 * nothing else does. Above it the rest is added in this order while it fits: indent, Jump,
 * Msg, Open, progress, role, ticket; waits takes what is left (at least WAITS_MIN cells), so
 * it is the first to shrink and drop.
 */
export function planCells(rows: readonly BandRow[], columns: number): CellPlan {
  const label = Math.max(LABEL_MIN, Math.min(LABEL_MAX, widest(rows.map(r => r.label))))
  const status = Math.max(4, widest(rows.map(r => r.statusText)))
  const plan: CellPlan = { indent: 0, label, role: 0, ticket: 0, status, progress: 0, waits: 0, jump: 0, open: 0, msg: 0, show: BUTTON_CELLS.show }
  // 2 cells for the glyph and its space, always drawn
  let used = 2 + label + GAP + status + GAP + plan.show
  if (columns < NARROW_COLUMNS) {
    if (used > columns) plan.label = Math.max(1, label - (used - columns))
    return plan
  }
  const want: [keyof CellPlan, number][] = [
    ['indent', widest(rows.map(r => r.indent))],
    ['jump', rows.some(r => r.actions.jump) ? BUTTON_CELLS.jump : 0],
    ['msg', rows.some(r => r.actions.msg) ? BUTTON_CELLS.msg : 0],
    ['open', rows.some(r => r.actions.open) ? BUTTON_CELLS.open : 0],
    ['progress', widest(rows.map(r => r.progress))],
    ['role', 1],
    ['ticket', Math.min(TICKET_MAX, widest(rows.map(r => r.ticket)))],
  ]
  for (const [cell, width] of want) {
    if (width <= 0) continue
    const cost = width + (cell === 'indent' ? 0 : GAP)
    if (used + cost > columns) continue
    plan[cell] = width
    used += cost
  }
  const rest = columns - used - GAP
  if (rest >= WAITS_MIN && rows.some(r => r.waits !== '')) plan.waits = rest
  return plan
}

/**
 * Picks which rows the band draws when they do not all fit: self's ancestors, self, then the
 * rows that need the user, then the rest in tree order. The picked rows are drawn in tree
 * order, so the indentation still reads as the tree.
 */
export function pickRows(rows: readonly OrchestratorRow[], room: number): OrchestratorRow[] {
  if (rows.length <= room) return [...rows]
  if (room <= 0) return []
  const selfAt = rows.findIndex(r => r.isSelf)
  const order: number[] = []
  const add = (i: number) => {
    if (i >= 0 && !order.includes(i)) order.push(i)
  }
  if (selfAt >= 0) {
    const selfDepth = rows[selfAt]!.depth
    for (let i = 0; i < selfAt; i++) if (rows[i]!.depth < selfDepth) add(i)
    add(selfAt)
  }
  rows.forEach((r, i) => r.needsYou && add(i))
  rows.forEach((_, i) => add(i))
  const kept = new Set(order.slice(0, room))
  return rows.filter((_, i) => kept.has(i))
}

/**
 * The band: a header (`orchestrator · <n> sessions · <k> need you`), the rows that fit, and
 * when some do not, a `+N more` line whose More opens the panel's session list. With room for
 * one row only, More sits on the header. Null when there is no row.
 */
export function bandModel(rows: readonly OrchestratorRow[], bodyColumns: number, maxRows: number, panelOpen: boolean, now: number): BandModel | null {
  if (rows.length === 0) return null
  const needYou = rows.filter(r => r.needsYou).length
  const header = `orchestrator · ${rows.length} ${rows.length === 1 ? 'session' : 'sessions'}${needYou > 0 ? ` · ${needYou} need${needYou === 1 ? 's' : ''} you` : ''}`
  const fitsAll = rows.length <= maxRows - 1
  const room = fitsAll ? rows.length : Math.max(0, maxRows - 2)
  const drawn = pickRows(rows, room).map(r => bandRow(r, now))
  const more = rows.length - drawn.length
  return {
    header,
    needYou,
    panelOpen,
    plan: planCells(drawn.length > 0 ? drawn : rows.map(r => bandRow(r, now)), bodyColumns),
    rows: drawn,
    more,
    moreInHeader: more > 0 && maxRows < 2,
  }
}

// ── the panel ─────────────────────────────────────────────────────────────────

export type PanelFit = { columns: number; rows: number }

const FALLBACK_COLUMNS = 80
const FALLBACK_ROWS = 20

function positive(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback
}

/**
 * The pane's body size from its render props. Docked, the rows are the room's. Inline, the frame
 * fits the tree, so rows read back from a short tree (a short list, a screen not captured yet)
 * would plan the next tree just as short and it would never grow: inline, the rows are at least
 * SHOW_ROWS, the height the pane asks for when it opens.
 */
export function panelFit(props: { bodyColumns?: unknown; placement?: unknown; scroll?: { bodyRows?: unknown } | null }): PanelFit {
  const rows = positive(props.scroll?.bodyRows, FALLBACK_ROWS)
  return { columns: positive(props.bodyColumns, FALLBACK_COLUMNS), rows: props.placement === 'inline' ? Math.max(rows, SHOW_ROWS) : rows }
}

/** One line of the session list. */
export type ListLine = { key: string; text: string; status: OrchestratorStatus; needsYou: boolean; isSelf: boolean; actions: RowActions }

export type ListModel = {
  kind: 'list'
  title: string
  lines: ListLine[]
  page: number
  pages: number
  prev: boolean
  next: boolean
}

function listText(row: OrchestratorRow, now: number, width: number): string {
  const parts = [
    `${'  '.repeat(row.depth)}${STATUS_GLYPH[row.status]} ${row.adopted ? `${row.label} (no parent)` : row.label}`,
    ROLE_BADGE[row.role],
    statusCell(row, now),
    formatProgress(row.progress),
  ].filter(p => p !== '')
  return clip(parts.join('  '), width)
}

/** Row lines left for the list: the title and the pager take one row each. */
export function listPageSize(fit: PanelFit): number {
  return Math.max(1, fit.rows - 2)
}

/**
 * The session list: every family session, one line each, in band order, paged to the pane.
 * Each line leaves room on its right for its buttons.
 */
export function listModel(rows: readonly OrchestratorRow[], fit: PanelFit, page: number, now: number): ListModel {
  const size = listPageSize(fit)
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(Math.max(0, Math.floor(page)), pages - 1)
  const buttons = BUTTON_CELLS.show + BUTTON_CELLS.jump + BUTTON_CELLS.open + BUTTON_CELLS.msg + 4
  const width = Math.max(10, fit.columns - buttons)
  return {
    kind: 'list',
    title: `orchestrator · ${rows.length} ${rows.length === 1 ? 'session' : 'sessions'}${pages > 1 ? ` · page ${p + 1}/${pages}` : ''}`,
    lines: rows.slice(p * size, (p + 1) * size).map(r => ({
      key: r.key,
      text: listText(r, now, width),
      status: r.status,
      needsYou: r.needsYou,
      isSelf: r.isSelf,
      actions: actionsOf(r),
    })),
    page: p,
    pages,
    prev: p > 0,
    next: p < pages - 1,
  }
}

export type SessionLine = { text: string; dim: boolean; tone: 'plain' | 'attention' | 'error' }

export type SessionModel = {
  kind: 'session'
  key: string
  title: string
  status: string
  needsYou: boolean
  actions: RowActions
  /** dependencies, holds and the tasks table: everything above the rule */
  details: SessionLine[]
  /** the screen lines, cut to the rows and columns left, or a note why there are none */
  screen: string[]
  note: string | null
}

function depLine(d: OrchestratorRow['deps'][number], now: number): SessionLine {
  const age = formatAge(d.since, now)
  const state = d.open ? (d.problem ? `open, ${d.problem}` : 'open') : 'done'
  const note = d.note ? ` (${d.note})` : ''
  return { text: `  ${d.kind} ${d.ref}${note} · ${state}${age ? ` · ${age}` : ''}`, dim: !d.open, tone: d.problem ? 'error' : 'plain' }
}

const DONE_STATE_RE = /^(done|moved|dropped)\b/i

function taskLines(tasks: OrchestratorRow['tasks'], columns: number): SessionLine[] {
  if (tasks.length === 0) return []
  const nW = Math.max(1, widest(tasks.map(t => String(t.n))))
  const whoW = Math.min(16, Math.max(3, widest(tasks.map(t => t.who))))
  const stateW = Math.min(18, Math.max(5, widest(tasks.map(t => t.state))))
  const stepW = Math.max(4, columns - nW - whoW - stateW - 6)
  const line = (n: string, step: string, who: string, state: string) => `${pad(n, nW)}  ${pad(step, stepW)}  ${pad(who, whoW)}  ${clip(state, stateW)}`
  return [
    { text: line('#', 'Step', 'Who', 'State'), dim: false, tone: 'plain' },
    ...tasks.map(t => ({ text: line(String(t.n), t.step, t.who, t.state), dim: DONE_STATE_RE.test(t.state.trim()), tone: 'plain' as const })),
  ]
}

/** Why there is no screen to show for a row, or null when a capture is the answer. */
export function screenNote(row: OrchestratorRow, own: OwnMux): string | null {
  if (row.isSelf) return SELF_SCREEN_NOTE
  if (row.target === null) return NO_TARGET_NOTE
  if (row.target.mux !== own) return OTHER_MUX_NOTE
  return null
}

/**
 * One session: title `<label> · <role> · <ticket>`, the status line, then dependencies (open
 * first, with their age), holds, the tasks table (finished rows dim), a rule, and the screen
 * lines cut to what is left of the pane. The title and List take the first row.
 */
export function sessionModel(row: OrchestratorRow, screen: OrchestratorScreenState, fit: PanelFit, own: OwnMux, now: number): SessionModel {
  const title = [row.label, row.role, row.ticket?.id].filter((p): p is string => typeof p === 'string' && p !== '').join(' · ')
  const progress = formatProgress(row.progress)
  const status = [statusCell(row, now), progress && `${progress} tasks`, row.waits && `waits: ${row.waits}`].filter(Boolean).join(' · ')
  const details: SessionLine[] = []
  if (row.deps.length > 0) {
    details.push({ text: 'Depends on', dim: false, tone: 'plain' })
    const ordered = [...row.deps.filter((d) => d.open), ...row.deps.filter((d) => !d.open)]
    for (const d of ordered) details.push(depLine(d, now))
  }
  if (row.holds.length > 0) {
    details.push({ text: 'Holds', dim: false, tone: 'plain' })
    for (const h of row.holds) {
      const age = formatAge(h.since, now)
      details.push({ text: `  ${h.what}${age ? ` · ${age}` : ''}`, dim: false, tone: 'plain' })
    }
  }
  details.push(...taskLines(row.tasks, fit.columns))
  const cut = details.map(l => ({ ...l, text: clip(l.text, fit.columns) }))
  let note = screenNote(row, own)
  let lines: string[] = []
  if (note === null) {
    if (screen.key !== row.key) note = 'reading the screen…'
    else if (screen.error !== null) note = screen.error === GONE_SCREEN_NOTE ? GONE_SCREEN_NOTE : screen.error
    else lines = screen.lines
  }
  // title, status, the rule, and the note line when there is one
  const left = Math.max(0, fit.rows - 3 - cut.length - (note === null ? 0 : 1))
  const shown = lines.length > left ? lines.slice(lines.length - left) : lines
  return {
    kind: 'session',
    key: row.key,
    title,
    status,
    needsYou: row.needsYou,
    actions: actionsOf(row),
    details: cut,
    screen: shown.map(l => clip(l, fit.columns)),
    note,
  }
}
