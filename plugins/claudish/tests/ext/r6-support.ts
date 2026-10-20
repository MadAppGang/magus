// Black-box helpers for spec revision R6, with R8.2's Client props and timeline palette delta.
// Written from spec.md and the public contract only: the engine kit's element descriptions,
// the plugin's published `$.state` keys, and the specified Client props. No implementation import.

import { expect } from 'claude-code/testing'
import type { Harness } from '../fake-claudish'
import { iso, type Json } from '../scenario'
import { walk, type Found, type Mounted, type Node } from '../ui'
import { children } from './support'
import { chips, visibleText } from './v2-support'

// ── R6.6: the timeline colours, handed to the Client modules as `c` ──────────

export const TIMELINE_LIGHT = {
  read: '#0D9488', edit: '#A16207', run: '#BE185D', web: '#0369A1', agent: '#C2410C', other: '#4B5563',
  think: '#7C3AED', say: '#6D28D9', ask: '#B45309', done: '#166534', fail: '#B91C1C', finish: '#15803D',
  words: '#4B5068', dim: '#8F94AC', ink: '#FFFFFF', timeInk: '#0B0B12', page: '#FFFFFF', pac: '#E8890C',
  pacQuiet: '#A8743A', ghost: '#B91C1C', ghost2: '#BE185D', ok: '#166534', warn: '#B45309', bad: '#B91C1C',
  silenceInk: '#FFFFFF',
} as const

export const TIMELINE_DARK = {
  read: '#4FD6BE', edit: '#FFD479', run: '#F38BA8', web: '#7DCFFF', agent: '#FF9E64', other: '#D8DAE5',
  think: '#B794F6', say: '#C4A7F8', ask: '#FFB454', done: '#22E06B', fail: '#FF4D5E', finish: '#7EE2A0',
  words: '#9AA0BC', dim: '#5A5E78', ink: '#0B0B12', timeInk: '#0B0B12', page: '#16171D', pac: '#FFD23F',
  pacQuiet: '#A8743A', ghost: '#FF4D5E', ghost2: '#FF8AD8', ok: '#22E06B', warn: '#FFB454', bad: '#FF4D5E',
  silenceInk: '#FFFFFF',
} as const

/**
 * R6.6: dark timeline colours that are NOT also a §9 palette colour, so they can only reach a
 * drawing through a Client module: none may appear in the band's own tree.
 */
export const TIMELINE_ONLY_DARK = ['#F38BA8', '#7DCFFF', '#FF9E64', '#D8DAE5', '#C4A7F8', '#7EE2A0', '#9AA0BC', '#16171D', '#FFD23F', '#A8743A', '#FF8AD8'] as const

// ── R6.4: the live cell's props ──────────────────────────────────────────────

/** One step as the live cell receives it (the contract's TrailMark): ms from the run's start, kind, tool, its line. */
export type Mark = { t: number; k: string; tool: string | null; x: string | null }

/** R8.2: `{ look, steps, elapsed, live, idle, endedFor, staleAfter: 5, staleFull: 120, width, c }`. */
export type TimelineProps = {
  look: string
  steps: Mark[]
  elapsed: number
  live: boolean
  idle: number
  endedFor: number
  staleAfter: number
  staleFull: number
  width: number
  c: Record<string, string>
}

export const TIMELINE_PROP_KEYS = ['c', 'elapsed', 'endedFor', 'idle', 'live', 'look', 'staleAfter', 'staleFull', 'steps', 'width']

/** The mod's run ids, oldest first, from its published `runs` state. */
export function runIds(h: Harness): string[] {
  const runs = h.state.get('runs') as { list?: { id: string }[] } | undefined
  return (runs?.list ?? []).map(r => r.id)
}

/** R6.4: the live cell of a slot is a `Client` keyed `timeline:<runId>/<slot>`. */
export function timelineKey(runId: string, slot: string): string {
  return `timeline:${runId}/${slot}`
}

/** The slot's live-cell Client as drawn in the band's own tree, and its props. */
export async function timeline(m: Mounted, key: string): Promise<{ found: Found; props: TimelineProps }> {
  const found = await m.find({ type: 'Client', key })
  expect(found, `no Client ${key} in the band`).toBeDefined()
  return { found: found!, props: found!.props.props as TimelineProps }
}

/** What the live cell's module draws, laid out at the width the band handed it. */
export async function cellDrawing(m: Mounted, key: string): Promise<{ tree: unknown; text: string; props: TimelineProps }> {
  const { props } = await timeline(m, key)
  await m.resize({ columns: props.width, rows: 1, in: key })
  const tree = await m.drawn({ in: key })
  return { tree, text: visibleText(tree), props }
}

/** `:05` under a minute, then `1:22` (R6.4 "Times"). */
export function blockTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  return s < 60 ? `:${String(s).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── fit and measurement ──────────────────────────────────────────────────────

function marginOf(n: Node): number {
  const p = n.props ?? {}
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  return num(p.marginLeft ?? p.marginX ?? p.margin) + num(p.marginRight ?? p.marginX ?? p.margin)
}

function takesNoRoom(n: Node): boolean {
  return n.props?.display === 'none' || n.props?.position === 'absolute'
}

/**
 * Cells a drawn description occupies across: text by characters, a Button as `[ label ]` unless
 * `plain` with children, a `Client` by its region width (or the `width` prop R6.4 hands its module),
 * a Box by an explicit numeric width, else its children plus gaps and padding.
 */
export function cells(n: unknown): number {
  if (typeof n === 'string' || typeof n === 'number') return Array.from(String(n)).length
  if (!n || typeof n !== 'object') return 0
  const node = n as Node
  const p = node.props ?? {}
  if (node.type === 'Client') {
    if (typeof p.width === 'number') return p.width
    const inner = p.props as { width?: unknown } | undefined
    return typeof inner?.width === 'number' ? inner.width : 0
  }
  if (node.type === 'Button') {
    return p.plain && children(node).length > 0
      ? children(node).reduce<number>((sum, c) => sum + cells(c), 0)
      : cells(p.label) + (p.plain ? 0 : 4)
  }
  if (node.type === 'Text') return children(node).reduce<number>((sum, c) => sum + cells(c), 0)
  if (typeof p.width === 'number') return p.width
  return naturalCells(node)
}

/** A Box's width from what it holds (its own `width` prop ignored): what its children take, gaps and padding. */
export function naturalCells(node: Node): number {
  const p = node.props ?? {}
  const kids = children(node).filter(c => !(c && typeof c === 'object' && takesNoRoom(c as Node)))
  const widths = kids.map(c => cells(c) + (c && typeof c === 'object' ? marginOf(c as Node) : 0))
  const horizontal = p.flexDirection === 'row' || p.flexDirection === 'row-reverse'
  const gap = Number(p.columnGap ?? p.gap ?? 0)
  const natural = horizontal ? widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * gap : Math.max(0, ...widths)
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  return natural + num(p.paddingLeft ?? p.paddingX ?? p.padding) + num(p.paddingRight ?? p.paddingX ?? p.padding)
}

const CODE = / (?:NEW|RUN|ASK|END|ERR|TMO|NIL|FMT|STP|LST|\?\?\?) /

/** Every band row: the deepest Box showing a badge code and holding exactly one Show (R6.2: no row reads Hide). */
export function drawnRows(tree: unknown): Node[] {
  const boxes = walk(tree).map(x => x.node).filter(n => n.type === 'Box'
    && CODE.test(visibleText(n))
    && chips(n, 'Show').length === 1)
  return boxes.filter(n => !walk(n).slice(1).some(x => boxes.includes(x.node)))
}

/** The Client keys drawn inside a node. */
export function clientsIn(n: unknown): Node[] {
  return walk(n).map(x => x.node).filter(x => x.type === 'Client')
}

/** A node's key (`props.key`, or the element's own `key`). */
export function keyOfNode(n: Node): string | undefined {
  const k = n.props?.key ?? (n as { key?: unknown }).key
  return typeof k === 'string' ? k : undefined
}

// ── the clock ────────────────────────────────────────────────────────────────

/**
 * Advances in small steps until the mod has made a new list call, so a read right after it sees
 * this poll's answer with less than `step` ms passed (any count-on between polls adds nothing).
 */
export async function untilPoll(h: Harness, step = 50): Promise<void> {
  const n = h.fake.listCalls().length
  for (let i = 0; i < 1200 && h.fake.listCalls().length === n; i++) await h.clock.advance(step)
  expect(h.fake.listCalls().length, 'a poll happened').toBeGreaterThan(n)
}

/** A row patch that keeps a slot silent for exactly `seconds` at every poll: idle and last activity agree. */
export function silentFor(h: () => Harness, seconds: () => number | null): (row: Json) => Json {
  return row => {
    const s = seconds()
    if (s === null) return row
    return { ...row, idle_seconds: s, last_activity_at: iso(h().clock.now() - s * 1000) }
  }
}

// ── reading text and inks out of a description ───────────────────────────────

/** The visible strings of a description, in document order, each with the colours it is drawn in. */
export type Run = { text: string; color?: unknown; backgroundColor?: unknown; bold?: unknown; dimColor?: unknown }
export function runsOf(tree: unknown): Run[] {
  const out: Run[] = []
  const go = (value: unknown, ink: Omit<Run, 'text'>) => {
    if (typeof value === 'string' || typeof value === 'number') { out.push({ text: String(value), ...ink }); return }
    if (!value || typeof value !== 'object') return
    const n = value as Node
    const next = { ...ink }
    for (const k of ['color', 'backgroundColor', 'bold', 'dimColor'] as const) if (n.props?.[k] !== undefined) next[k] = n.props[k]
    const c = children(n)
    if (n.type === 'Button' && c.length === 0) { out.push({ text: String(n.props?.label ?? ''), ...next }); return }
    for (const child of c) go(child, next)
  }
  go(tree, {})
  return out
}

/** The ink of every visible run overlapping the LAST occurrence of `text`. */
export function inkOfLast(tree: unknown, text: string): Run[] {
  const parts = runsOf(tree)
  const all = parts.map(p => p.text).join('')
  const at = all.lastIndexOf(text)
  expect(at, `missing visible text ${JSON.stringify(text)} in ${JSON.stringify(all)}`).toBeGreaterThanOrEqual(0)
  let offset = 0
  const out: Run[] = []
  for (const part of parts) {
    const end = offset + part.text.length
    if (end > at && offset < at + text.length) out.push(part)
    offset = end
  }
  return out
}

/**
 * R6.4 "flush right": the drawing ends with `tail`, and it reaches the cell's right edge, either
 * spelled out (its text is exactly `width` cells) or laid out (a Box `width` wide pushing its
 * content to the end).
 */
export function expectFlushRight(tree: unknown, width: number, tail: string): void {
  const text = visibleText(tree)
  expect(text.endsWith(tail), `${JSON.stringify(text)} ends with ${JSON.stringify(tail)}`).toBe(true)
  const boxes = walk(tree).map(x => x.node).filter(n => n.type === 'Box')
  const laidOut = boxes.some(b => (b.props?.width === width || b.props?.width === '100%')
    && (b.props?.justifyContent === 'flex-end' || b.props?.justifyContent === 'space-between'
      || children(b).some(c => !!c && typeof c === 'object' && typeof (c as Node).props?.flexGrow === 'number' && ((c as Node).props!.flexGrow as number) > 0)))
  expect(Array.from(text).length === width || laidOut, `${JSON.stringify(text)} reaches ${width} cells`).toBe(true)
  expect(Array.from(text).length).toBeLessThanOrEqual(width)
}

/** The Show panel's tab strip: its Buttons (R6.5: each tab is a Button whose `label` prop is its label). */
export async function tabButtons(p: Mounted): Promise<Found[]> {
  return p.findAll({ type: 'Button' })
}

/** The Show panel's state (R6.5): the shown tab's id, from the published `showTab` key. */
export function activeTab(h: Harness): string | null {
  return (h.state.get('showTab') as { active?: string | null } | undefined)?.active ?? null
}

/** Every Show-tab view the plugin has written and not cleared, by tab id. */
export function views(h: Harness): Map<string, { slot: string; model: string; status: string; runId: string }> {
  const out = new Map<string, { slot: string; model: string; status: string; runId: string }>()
  for (const [k, v] of h.state) if (k.startsWith('panes/') && v) out.set(k.slice('panes/'.length), v as { slot: string; model: string; status: string; runId: string })
  return out
}

/**
 * R6.4: the live cell's (and the legend's) module. The band names it `./flow.tsx`; the kit reports a
 * Client's `module` resolved from the plugin root (`hooks/status/flow.tsx`). Either is the same file.
 */
export function isFlowModule(module: unknown): boolean {
  return module === './flow.tsx' || (typeof module === 'string' && /(^|\/)hooks\/status\/flow\.tsx$/.test(module))
}

/**
 * `text` as drawn by the `line` look, where the ghost ᗣ (R6.4: it closes in from the right while the
 * slot is silent) may be drawn over at most one of its cells: the exact text, or it with one cell ᗣ.
 */
export function underGhost(text: string): RegExp {
  const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const chars = Array.from(text)
  const forms = [chars.map(esc).join(''), ...chars.map((_, i) => chars.map((c, j) => (i === j ? 'ᗣ' : esc(c))).join(''))]
  return new RegExp(forms.map(f => `(?:${f})`).join('|'))
}

export const SHOW_PANE = 'claudish-show'
export const TAB_ID = /^cl_[0-9a-f]{8}$/
