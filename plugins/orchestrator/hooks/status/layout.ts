// Pure: what the band and the panel draw, fitted to their width and rows. Rows in, plain
// values out; band.tsx and panel.tsx only turn these into trees.

import type { OrchestratorRole, OrchestratorRow, OrchestratorScreenState, OrchestratorStatus, OrchestratorTask } from '../../types'
import {
  BADGE_PAD,
  GONE_SCREEN_NOTE,
  NARROW_COLUMNS,
  NEEDS_YOU_GLYPH,
  NO_TARGET_NOTE,
  OTHER_MUX_NOTE,
  ROLE_BADGE,
  ROLE_SHORT,
  SELF_SCREEN_NOTE,
  SHOW_ROWS,
  STATUS_GLYPH,
  statusWordOf,
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

// ── actions ───────────────────────────────────────────────────────────────────

/**
 * Which buttons a row carries: Jump (a target, not self), Show (not self), Open (a ticket URL),
 * Msg (a name, not self). The person is already in the self session, so it gets only Open.
 */
export type RowActions = { jump: boolean; show: boolean; open: boolean; msg: boolean }

export function actionsOf(row: OrchestratorRow): RowActions {
  return {
    jump: row.target !== null && !row.isSelf,
    show: !row.isSelf,
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
const DETAIL_MIN = 6

/** Which cells the band draws at this width, and how wide each is (0 = dropped). */
export type CellPlan = {
  indent: number
  label: number
  role: number
  ticket: number
  status: number
  progress: number
  /** the last column: what the session needs, waits on, or does now */
  detail: number
  jump: number
  open: number
  msg: number
  show: number
}

export type BandRow = {
  key: string
  indent: string
  glyph: string
  /** fitted to the plan's label cell by `bandModel`, never losing the ticket id it leads with */
  label: string
  /** the ticket id the label leads with; null when it does not lead with one */
  labelTicket: string | null
  /** the role badge's name and its short form, and the role that picks its fill */
  role: string
  roleShort: string
  roleKind: OrchestratorRole
  /** the ticket cell; empty when the label already leads with the ticket id */
  ticket: string
  status: OrchestratorStatus
  /** the word the status badge shows: the status, or `needs you` */
  statusWord: string
  /** the status word and its age, as one string: what the status cell's width is planned from */
  statusText: string
  age: string
  progress: string
  detail: string
  detailTone: DetailTone
  needsYou: boolean
  isSelf: boolean
  adopted: boolean
  actions: RowActions
}

export type HeaderTone = 'plain' | 'attention' | 'error'

export type BandModel = {
  header: string
  /** error while states are unreadable, attention while a row needs the user */
  headerTone: HeaderTone
  needYou: number
  panelOpen: boolean
  plan: CellPlan
  rows: BandRow[]
  /** sessions not drawn on the band; 0 when every one is */
  more: number
  /** true when the band has one row only: More then sits on the header */
  moreInHeader: boolean
}

/** The status word and its age, as the badge shows them: `needs you 4m` while the row needs the user. */
function statusCell(row: OrchestratorRow, now: number): string {
  const age = formatAge(row.since, now)
  const word = statusWordOf(row.status, row.needsYou)
  return age === '' ? word : `${word} ${age}`
}

/**
 * A label cut to `width` by its name part: a label led by `labelTicket` keeps the ticket id
 * whole, and with no room beside it is the ticket id alone; only a cell narrower than the id
 * cuts the id itself.
 */
export function fitLabel(label: string, labelTicket: string | null, width: number): string {
  if ([...label].length <= width) return label
  if (labelTicket === null || !label.startsWith(`${labelTicket} `)) return clip(label, width)
  const lead = [...labelTicket].length
  if (width < lead) return clip(labelTicket, width)
  if (width < lead + 2) return labelTicket
  return `${labelTicket} ${clip(label.slice(labelTicket.length + 1), width - lead - 1)}`
}

const NOW_STATE_RE = /^in progress\b/i
const NEXT_STATE_RE = /^next\b/i
const DONE_STATE_RE = /^(done|moved|dropped)\b/i

export type DetailTone = 'plain' | 'attention'
export type Detail = { text: string; tone: DetailTone }

/**
 * The band's last column, first match wins: the row needs the user (`? <reason>`); an open
 * session dependency (`⇠ <its label> (<note>)`); another open dependency (`⇠ <kind> <ref>`);
 * an active session's step in progress, else its first next step (`▶ <step>`); nothing.
 */
export function rowDetail(row: OrchestratorRow): Detail {
  if (row.needsYou) return { text: row.waits ? `? ${row.waits}` : '?', tone: 'attention' }
  const open = row.deps.filter(d => d.open)
  const session = open.find(d => d.kind === 'session')
  if (session) return { text: `⇠ ${session.label ?? session.ref}${session.note ? ` (${session.note})` : ''}`, tone: 'plain' }
  const other = open[0]
  if (other) return { text: `⇠ ${other.kind} ${other.ref}`, tone: 'plain' }
  if (row.status !== 'done' && row.status !== 'gone') {
    const step = row.tasks.find(t => NOW_STATE_RE.test(t.state.trim())) ?? row.tasks.find(t => NEXT_STATE_RE.test(t.state.trim()))
    if (step) return { text: `▶ ${step.step}`, tone: 'plain' }
  }
  return { text: '', tone: 'plain' }
}

function bandRow(row: OrchestratorRow, now: number): BandRow {
  const detail = rowDetail(row)
  return {
    key: row.key,
    indent: '  '.repeat(row.depth),
    glyph: row.needsYou ? NEEDS_YOU_GLYPH : STATUS_GLYPH[row.status],
    label: row.adopted ? `${row.label} (no parent)` : row.label,
    labelTicket: row.labelTicket ?? null,
    role: ROLE_BADGE[row.role],
    roleShort: ROLE_SHORT[row.role],
    roleKind: row.role,
    ticket: row.labelTicket ? '' : row.ticket?.id ?? '',
    status: row.status,
    statusWord: statusWordOf(row.status, row.needsYou),
    statusText: statusCell(row, now),
    age: formatAge(row.since, now),
    progress: formatProgress(row.progress),
    detail: detail.text,
    detailTone: detail.tone,
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
 * nothing else does, and when those three do not fit, the status cell drops its age, then the
 * label shrinks (to one cell at least). Otherwise the label cell is never narrower than the
 * widest ticket id a label leads with. Above NARROW_COLUMNS the rest is added in this order while it fits: indent, Jump, Msg,
 * Open, progress, role, ticket; the detail takes what is left (at least DETAIL_MIN cells), so
 * it is the first to shrink and drop.
 */
export function planCells(rows: readonly BandRow[], columns: number): CellPlan {
  const floor = widest(rows.map(r => r.labelTicket ?? ''))
  const label = Math.max(floor, LABEL_MIN, Math.min(LABEL_MAX, widest(rows.map(r => r.label))))
  // the status word sits on a badge, padded inside
  const status = Math.max(4, widest(rows.map(r => r.statusText))) + BADGE_PAD
  const plan: CellPlan = { indent: 0, label, role: 0, ticket: 0, status, progress: 0, detail: 0, jump: 0, open: 0, msg: 0, show: BUTTON_CELLS.show }
  // 2 cells for the glyph and its space, always drawn
  let used = 2 + label + GAP + status + GAP + plan.show
  if (columns < NARROW_COLUMNS) {
    // too wide: first the status cell loses its age, then the label shrinks, the ticket-id
    // floor included, down to one cell
    if (used > columns) {
      const bare = Math.max(4, widest(rows.map(r => r.statusWord))) + BADGE_PAD
      used -= status - bare
      plan.status = bare
    }
    if (used > columns) plan.label = Math.max(1, label - (used - columns))
    return plan
  }
  const want: [keyof CellPlan, number][] = [
    ['indent', widest(rows.map(r => r.indent))],
    ['jump', rows.some(r => r.actions.jump) ? BUTTON_CELLS.jump : 0],
    ['msg', rows.some(r => r.actions.msg) ? BUTTON_CELLS.msg : 0],
    ['open', rows.some(r => r.actions.open) ? BUTTON_CELLS.open : 0],
    ['progress', widest(rows.map(r => r.progress))],
    ['role', widest(rows.map(r => r.role)) + BADGE_PAD],
    ['ticket', Math.min(TICKET_MAX, widest(rows.map(r => r.ticket)))],
  ]
  for (const [cell, width] of want) {
    if (width <= 0) continue
    // a role badge with no room for the names takes the short forms
    const fits = (w: number) => used + w + (cell === 'indent' ? 0 : GAP) <= columns
    const w = fits(width) ? width : cell === 'role' && fits(widest(rows.map(r => r.roleShort)) + BADGE_PAD) ? widest(rows.map(r => r.roleShort)) + BADGE_PAD : 0
    if (w === 0) continue
    plan[cell] = w
    used += w + (cell === 'indent' ? 0 : GAP)
  }
  const rest = columns - used - GAP
  if (rest >= DETAIL_MIN && rows.some(r => r.detail !== '')) plan.detail = rest
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
 * The header: `orchestrator · <n> sessions`, then `<k> need(s) you`, `<k> waiting` (waiting on
 * something other than the user) and `<k> done`, each only above zero. While states are
 * unreadable it names why instead of the counts, which would all read unknown.
 */
export function bandHeader(rows: readonly OrchestratorRow[], unreadable: string | null): string {
  const lead = `orchestrator · ${rows.length} ${rows.length === 1 ? 'session' : 'sessions'}`
  if (unreadable !== null) return `${lead} · ⚠ states unreadable: ${unreadable}`
  const needYou = rows.filter(r => r.needsYou).length
  const waiting = rows.filter(r => r.status === 'waiting' && !r.needsYou).length
  const done = rows.filter(r => r.status === 'done').length
  const parts = [
    needYou > 0 ? `${needYou} need${needYou === 1 ? 's' : ''} you` : '',
    waiting > 0 ? `${waiting} waiting` : '',
    done > 0 ? `${done} done` : '',
  ].filter(p => p !== '')
  return [lead, ...parts].join(' · ')
}

/**
 * The band: the header, one line per session that fits, and when some do not, a `+N more`
 * line whose More opens the panel's session list. With room for one row only, More sits on
 * the header. Null when there is no row.
 */
export function bandModel(
  rows: readonly OrchestratorRow[],
  bodyColumns: number,
  maxRows: number,
  panelOpen: boolean,
  now: number,
  unreadable: string | null = null,
): BandModel | null {
  if (rows.length === 0) return null
  const needYou = rows.filter(r => r.needsYou).length
  const fitsAll = rows.length <= maxRows - 1
  const room = fitsAll ? rows.length : Math.max(0, maxRows - 2)
  const drawn = pickRows(rows, room).map(r => bandRow(r, now))
  const more = rows.length - drawn.length
  const plan = planCells(drawn.length > 0 ? drawn : rows.map(r => bandRow(r, now)), bodyColumns)
  return {
    header: bandHeader(rows, unreadable),
    headerTone: unreadable !== null ? 'error' : needYou > 0 ? 'attention' : 'plain',
    needYou,
    panelOpen,
    plan,
    // a status cell planned narrower than its text has dropped the age
    rows: drawn.map(r => ({
      ...r,
      label: fitLabel(r.label, r.labelTicket, plan.label),
      ...([...r.statusText].length + BADGE_PAD > plan.status ? { age: '', statusText: r.statusWord } : {}),
    })),
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

/**
 * One line of the session list. `text` is the whole line as plain text; `lead`, `role`, `age`
 * and `progress` are its parts, which the pane draws with the role and status as badges.
 */
export type ListLine = {
  key: string
  text: string
  lead: string
  role: string
  roleKind: OrchestratorRole
  age: string
  progress: string
  status: OrchestratorStatus
  /** the word the status badge shows */
  statusWord: string
  needsYou: boolean
  isSelf: boolean
  actions: RowActions
}

export type ListModel = {
  kind: 'list'
  title: string
  lines: ListLine[]
  page: number
  pages: number
  prev: boolean
  next: boolean
}

function listLead(row: OrchestratorRow): string {
  return `${'  '.repeat(row.depth)}${STATUS_GLYPH[row.status]} ${row.adopted ? `${row.label} (no parent)` : row.label}`
}

function listText(row: OrchestratorRow, now: number, width: number): string {
  const parts = [listLead(row), ROLE_BADGE[row.role], statusCell(row, now), formatProgress(row.progress)].filter(p => p !== '')
  return clip(parts.join('  '), width)
}

/** The lead cut so the lead, the role badge, the status badge and its age, and the progress fit `width`. */
function listLine(row: OrchestratorRow, now: number, width: number): ListLine {
  const age = formatAge(row.since, now)
  const progress = formatProgress(row.progress)
  const statusWord = statusWordOf(row.status, row.needsYou)
  const tailWith = (role: string) => 2 + role.length + BADGE_PAD + 2 + statusWord.length + BADGE_PAD + (age ? 1 + age.length : 0) + (progress ? 2 + progress.length : 0)
  // the role's name while the lead keeps LABEL_MIN cells beside it, else its short form
  const role = width - tailWith(ROLE_BADGE[row.role]) >= LABEL_MIN ? ROLE_BADGE[row.role] : ROLE_SHORT[row.role]
  const tail = tailWith(role)
  return {
    key: row.key,
    text: listText(row, now, width),
    lead: clip(listLead(row), Math.max(1, width - tail)),
    role,
    roleKind: row.role,
    age,
    progress,
    status: row.status,
    statusWord,
    needsYou: row.needsYou,
    isSelf: row.isSelf,
    actions: actionsOf(row),
  }
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
    lines: rows.slice(p * size, (p + 1) * size).map(r => listLine(r, now, width)),
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
  /** the status line as plain text */
  status: string
  /** the status line's parts: the state on its badge, its age, then the rest after a `·` */
  state: OrchestratorStatus
  /** the word the state's badge shows */
  statusWord: string
  age: string
  statusRest: string
  needsYou: boolean
  actions: RowActions
  /** dependencies, holds, the task groups and the family: everything above the rule */
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

/**
 * Text broken into lines of at most `width` cells at word boundaries; a word longer than the
 * width is broken inside itself. Nothing is cut: every word appears, in order.
 */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width))
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = [...word]
    if (line !== '' && [...line].length + 1 + rest.length <= w) {
      line += ` ${word}`
      continue
    }
    if (line !== '') lines.push(line)
    while (rest.length > w) {
      lines.push(rest.slice(0, w).join(''))
      rest = rest.slice(w)
    }
    line = rest.join('')
  }
  if (line !== '') lines.push(line)
  return lines.length > 0 ? lines : ['']
}

const WAIT_STATE_RE = /^wait(?:s|ing)?\s+on\b\s*(.*)$/i
const SELF_WHO_RE = /^this session$/i
/** numbers joined by spaces, commas, `and` or `&`, and nothing else */
const ROW_LIST_RE = /^\d+(?:\s*(?:,|&|\band\b)?\s*\d+)*$/i

/**
 * What a task waits on, from its state: `Waiting on 2, 3` or `Waits on 2 and 3`, where the
 * text after `on` is only a list of numbers naming other rows, reads
 * `after 2 <first two words of step 2> · 3 <…>`. A waiting state whose text is anything else, or
 * whose numbers name no other row, reads as written; any other state is no wait (null).
 */
export function taskWait(task: OrchestratorTask, tasks: readonly OrchestratorTask[]): string | null {
  const state = task.state.trim()
  const m = WAIT_STATE_RE.exec(state)
  if (m === null) return null
  const rest = m[1] ?? ''
  // only a list of row numbers names rows: `v2 of 3 reviews` is text, read as written
  if (!ROW_LIST_RE.test(rest)) return state
  const named: OrchestratorTask[] = []
  for (const n of rest.match(/\d+/g) ?? []) {
    const t = tasks.find(x => x.n === Number(n) && x !== task)
    if (t && !named.includes(t)) named.push(t)
  }
  if (named.length === 0) return state
  return `after ${named.map(t => `${t.n} ${t.step.split(/\s+/).filter(Boolean).slice(0, 2).join(' ')}`).join(' · ')}`
}

/**
 * The task groups: Now (state in progress), Next (every other unfinished row) and Done (done,
 * moved or dropped; dim), each under its heading, empty groups not drawn. A task's step wraps
 * to `columns` under a hanging indent; a dim line below it names who does it (when not this
 * session) and what it waits on.
 */
function taskLines(tasks: readonly OrchestratorTask[], columns: number): SessionLine[] {
  if (tasks.length === 0) return []
  const nW = Math.max(1, widest(tasks.map(t => String(t.n))))
  // ` ▶ ` then the number, then two spaces: the step text starts here
  const indent = 3 + nW + 2
  const stepW = Math.max(1, columns - indent)
  const hang = ' '.repeat(indent)
  const isNow = (t: OrchestratorTask) => NOW_STATE_RE.test(t.state.trim())
  const isDone = (t: OrchestratorTask) => DONE_STATE_RE.test(t.state.trim())
  const groups: { heading: string; glyph: string; dim: boolean; tasks: OrchestratorTask[] }[] = [
    { heading: 'Now', glyph: '▶', dim: false, tasks: tasks.filter(isNow) },
    { heading: 'Next', glyph: '○', dim: false, tasks: tasks.filter(t => !isNow(t) && !isDone(t)) },
    { heading: 'Done', glyph: '✓', dim: true, tasks: tasks.filter(isDone) },
  ]
  const out: SessionLine[] = []
  for (const g of groups) {
    if (g.tasks.length === 0) continue
    out.push({ text: g.heading, dim: g.dim, tone: 'plain' })
    for (const t of g.tasks) {
      const n = String(t.n)
      const lead = ` ${g.glyph} ${n}${' '.repeat(nW - n.length)}  `
      wrapText(t.step, stepW).forEach((l, i) => out.push({ text: `${i === 0 ? lead : hang}${l}`, dim: g.dim, tone: 'plain' }))
      const who = t.who.trim() !== '' && !SELF_WHO_RE.test(t.who.trim()) ? t.who : ''
      const second = [who, taskWait(t, tasks) ?? ''].filter(p => p !== '').join(' · ')
      if (second !== '') for (const l of wrapText(second, stepW)) out.push({ text: `${hang}${l}`, dim: true, tone: 'plain' })
    }
  }
  return out
}

/**
 * The family block: every session waiting on this one, then what this one waits on, or
 * `waits on nothing`. The viewed session is `this session` when it is self, else its label.
 */
function familyLines(row: OrchestratorRow): SessionLine[] {
  const me = row.isSelf ? 'this session' : row.label
  const out: SessionLine[] = [{ text: 'Family', dim: false, tone: 'plain' }]
  for (const w of row.waitedOnBy ?? []) out.push({ text: ` ${w.label} (${ROLE_BADGE[w.role]}) ⇠ waits on ${me}`, dim: false, tone: 'plain' })
  const own = row.deps.filter(d => d.open && d.kind === 'session')
  if (own.length === 0) out.push({ text: ` ${me} ⇠ waits on nothing`, dim: true, tone: 'plain' })
  for (const d of own) out.push({ text: ` ${me} ⇠ waits on ${d.label ?? d.ref}`, dim: false, tone: d.problem ? 'error' : 'plain' })
  return out
}

/** Why there is no screen to show for a row, or null when a capture is the answer. */
export function screenNote(row: OrchestratorRow, own: OwnMux): string | null {
  if (row.isSelf) return SELF_SCREEN_NOTE
  if (row.target === null) return NO_TARGET_NOTE
  if (row.target.mux !== own) return OTHER_MUX_NOTE
  return null
}

/**
 * One session: title `<label> · <role>` (and `· <ticket>` when the label does not lead with
 * it), the status line `<state> <age> · <done>/<total> done` (and `? <reason>` while it needs
 * the user), then dependencies (open first, with their age), holds, the task groups, the
 * family, a rule, and the screen lines cut to what is left of the pane. The title and List take
 * the first row.
 */
export function sessionModel(row: OrchestratorRow, screen: OrchestratorScreenState, fit: PanelFit, own: OwnMux, now: number): SessionModel {
  const title = [row.label, ROLE_BADGE[row.role], row.labelTicket ? null : row.ticket?.id]
    .filter((p): p is string => typeof p === 'string' && p !== '')
    .join(' · ')
  const progress = formatProgress(row.progress)
  const statusRest = [progress && `${progress} done`, row.needsYou ? rowDetail(row).text : ''].filter(Boolean).join(' · ')
  const status = [statusCell(row, now), statusRest].filter(Boolean).join(' · ')
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
  // task lines are already wrapped to the width; only the other lines are cut
  const cut = details.map(l => ({ ...l, text: clip(l.text, fit.columns) }))
  cut.push(...taskLines(row.tasks, fit.columns))
  cut.push(...familyLines(row).map(l => ({ ...l, text: clip(l.text, fit.columns) })))
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
    state: row.status,
    statusWord: statusWordOf(row.status, row.needsYou),
    age: formatAge(row.since, now),
    statusRest,
    needsYou: row.needsYou,
    actions: actionsOf(row),
    details: cut,
    screen: shown.map(l => clip(l, fit.columns)),
    note,
  }
}