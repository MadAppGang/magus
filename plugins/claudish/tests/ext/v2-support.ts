// Black-box helpers for spec-v2 (with §7 R2 and §8 R3). Button children, not its accessible label,
// paint the button: `[ label ]`.
import { expect } from 'claude-code/testing'
import type { On } from 'claude-code'
import { walk, type Mounted, type Node } from '../ui'
import { QUIET_DARK, RETIRED_THEME_KEYS, children, colourKey } from './support'

// §9/§10: the badges' dark palette (the kit sets no theme), worked from the spec's table and formulas:
// solid = the hue as fill, ink white or #0B0B12 by WCAG contrast; quiet = the hue 55 % toward black,
// in white. The tokens badge takes §10's two fixed inks instead.
export const DARK = {
  run: '#89B4FA', ask: '#FFB454', done: '#22E06B', fail: '#FF4D5E', format: '#FFD479', stopped: '#5A5E78',
  model: '#5B6CE0', tools: '#4FD6BE', loops: '#B794F6', cost: '#FFD479', // §10: model indigo
  ink: '#0B0B12', snow: '#FFFFFF',
  // quiet fill: the hue 55 % toward black, written in white
  modelQuiet: '#293165',
  // §10 "Tokens, FINAL": two fixed inks, no hue; dark in #0F592A, out #16803D, both written in white
  tokensIn: '#0F592A', tokensOut: '#16803D',
} as const

// §9 / R6.6: the theme key set (text outside the badges), plus the palette's hex (the badges and value
// text), with R6.2's quiet inks (tool calls, loops, cost) and R6.5's shown-tab fill (the run hue's quiet).
export const V2_THEME: readonly string[] = [
  'claude', 'permission', 'success', 'error', 'warning', 'inactive', 'subtle', 'inverseText', 'ide', 'suggestion',
  ...new Set([...Object.values(DARK), ...Object.values(QUIET_DARK).flat()]),
]

export function visibleText(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (!tree || typeof tree !== 'object') return ''
  const n = tree as Node
  const c = children(n)
  if (n.type === 'Button' && c.length === 0) return String(n.props?.label ?? '')
  return c.map(visibleText).join('')
}

export function keyOf(n: Node): string {
  const key = n.props?.key ?? (n as { key?: unknown }).key
  expect(typeof key).toBe('string')
  return key as string
}

// §7: a button is drawn `[ name ]`.
export function chips(tree: unknown, name?: string): Node[] {
  return walk(tree).map(x => x.node).filter(n => n.type === 'Button'
    && (name === undefined || visibleText(n) === `[ ${name} ]`))
}

// The row holds the badge code and the buttons. The buttons' own right-aligned group holds no
// code, so it is never taken for the row. Show reads Hide while the slot's tab is open (§7/§8).
function isRow(n: Node): boolean {
  return n.type === 'Box' && chips(n, 'Show').length + chips(n, 'Hide').length === 1
    && / (?:NEW|RUN|ASK|END|ERR|TMO|NIL|FMT|STP|LST|\?\?\?) /.test(visibleText(n))
}

// The deepest matching Box is the row, rather than the whole band or a wrapping group.
export async function bandRow(m: Mounted, model: string): Promise<Node> {
  const candidates = walk(await m.drawn()).map(x => x.node)
    .filter(n => isRow(n) && visibleText(n).includes(model))
  const result = candidates[candidates.length - 1]
  if (!result) throw new Error(`no status row for ${model}`)
  return result
}

// Follow a visible Show address across resizes, including widths where the model is gone.
export async function rowByShow(m: Mounted, showKey: string): Promise<Node> {
  const candidates = walk(await m.drawn()).map(x => x.node).filter(n => isRow(n)
    && [...chips(n, 'Show'), ...chips(n, 'Hide')].some(c => keyOf(c) === showKey))
  const result = candidates[candidates.length - 1]
  if (!result) throw new Error(`no status row containing Show ${showKey}`)
  return result
}

// The header line: a Box holding it alone when the band draws it so, else the outermost Text
// carrying it (the spec fixes the header's text, not its element).
export async function header(m: Mounted): Promise<Node> {
  const nodes = walk(await m.drawn()).map(x => x.node).filter(n => visibleText(n).includes('◆ claudish') && chips(n).length === 0)
  const boxes = nodes.filter(n => n.type === 'Box')
  const result = boxes[boxes.length - 1] ?? nodes.find(n => n.type === 'Text')
  if (!result) throw new Error('no claudish header')
  return result
}

export async function chip(m: Mounted, model: string, name: string): Promise<Node> {
  const found = chips(await bandRow(m, model), name)
  expect(found).toHaveLength(1)
  return found[0]!
}

export async function pressChip(m: Mounted, model: string, name: string): Promise<void> {
  await m.press({ key: keyOf(await chip(m, model, name)) })
}

export type Ink = {
  color?: unknown
  backgroundColor?: unknown
  bold?: unknown
  dimColor?: unknown
}

type Segment = { text: string; ink: Ink }

// Effective Text ink includes a surrounding fill and nested Text inheritance. Never
// assert an implementation's private keys or require a particular Text nesting.
export function segments(tree: unknown): Segment[] {
  const out: Segment[] = []
  const go = (value: unknown, inherited: Ink) => {
    if (typeof value === 'string' || typeof value === 'number') {
      out.push({ text: String(value), ink: inherited })
      return
    }
    if (!value || typeof value !== 'object') return
    const n = value as Node
    const ink = { ...inherited }
    for (const k of ['color', 'backgroundColor', 'bold', 'dimColor'] as const) {
      if (n.props?.[k] !== undefined) ink[k] = n.props[k]
    }
    const c = children(n)
    if (n.type === 'Button' && c.length === 0) {
      out.push({ text: String(n.props?.label ?? ''), ink })
    } else {
      for (const child of c) go(child, ink)
    }
  }
  go(tree, {})
  return out
}

export function inkOf(tree: unknown, text: string): Ink[] {
  const parts = segments(tree)
  const all = parts.map(p => p.text).join('')
  const at = all.indexOf(text)
  expect(at, `missing visible text ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0)
  let offset = 0
  const inks: Ink[] = []
  for (const part of parts) {
    const end = offset + part.text.length
    if (end > at && offset < at + text.length) inks.push(part.ink)
    offset = end
  }
  expect(inks.length).toBeGreaterThan(0)
  return inks
}

export function expectInk(tree: unknown, text: string, expected: Ink): void {
  for (const ink of inkOf(tree, text)) {
    for (const k of Object.keys(expected) as (keyof Ink)[]) expect(ink[k]).toBe(expected[k])
  }
}

export function themeKeysOnly(tree: unknown): void {
  const allowed = V2_THEME.map(colourKey)
  for (const { node, inFrame } of walk(tree)) {
    if (inFrame) continue
    for (const prop of ['color', 'backgroundColor', 'borderColor']) {
      if (node.props?.[prop] !== undefined) expect(allowed).toContain(colourKey(node.props[prop]))
      expect(RETIRED_THEME_KEYS as readonly unknown[]).not.toContain(node.props?.[prop])
    }
  }
}

/** The ink matches one of the allowed spellings of a colour (a quiet ink whose rounding the spec leaves open). */
export function expectInkOneOf(tree: unknown, text: string, prop: 'color' | 'backgroundColor', candidates: readonly string[]): void {
  for (const ink of inkOf(tree, text)) {
    const v = ink[prop]
    expect(typeof v === 'string' && candidates.some(c => c.toUpperCase() === v.toUpperCase()), `${text} ${prop}=${String(v)} not in ${candidates.join('|')}`).toBe(true)
  }
}

/** The tab header of the Show panel's shown tab: a Box led by the badge and naming the model (outside the frame). */
export async function tabHeader(p: Mounted, model: string): Promise<Node> {
  const candidates = walk(await p.drawn()).filter(x => !x.inFrame).map(x => x.node)
    .filter(n => n.type === 'Box' && /^ (?:NEW|RUN|ASK|END|ERR|TMO|NIL|FMT|STP|LST|\?\?\?) /.test(visibleText(n))
      && visibleText(n).includes(model))
  const result = candidates[candidates.length - 1]
  if (!result) throw new Error(`no badge-led tab header for ${model}`)
  return result
}

export function runtimePart(value: string): string { return `${value} `.padStart(7) }

// Arrange public state reads through the kit's hooks (its test Engine has no state
// noun). Keep every other field and the version; never import implementation exports.
// The kit takes a hook only before the test first calls $, so each helper registers at the top of
// the test and returns a setter for the target, known only once the run has started.
export function arrangeStart(on: On): (token: string, startedAt: number | undefined) => void {
  let want: { token: string; startedAt: number | undefined } | null = null
  on('state.get', { plugin: 'claudish', key: 'runs' }, async (_$, e, next) => {
    const result = await next(e)
    if (want === null || 'deny' in result) return result
    const { token, startedAt } = want
    const value = result.value.value as { list: { ref: { token: string }; startedAt?: number }[] } | undefined
    if (!value || !value.list.some(r => r.ref.token === token)) throw new Error('run missing from public state')
    const list = value.list.map(r => {
      if (r.ref.token !== token) return r
      const changed = { ...r }
      if (startedAt === undefined) delete changed.startedAt
      else changed.startedAt = startedAt
      return changed
    })
    return { value: { ...result.value, value: { ...value, list } } }
  })
  return (token, startedAt) => { want = { token, startedAt } }
}

// LOST is a mod-domain state, not a claudish wire state. Arrange its public view
// directly instead of inventing a missing-run timeout that spec-v2 does not name.
export function arrangeLost(on: On): (token: string, slot: string) => void {
  let want: { token: string; slot: string } | null = null
  on('state.get', { plugin: 'claudish', key: 'runs' }, async (_$, e, next) => {
    const result = await next(e)
    if (want === null || 'deny' in result) return result
    const { token, slot } = want
    const value = result.value.value as {
      list: { ref: { token: string }; slots: { slot: string; state: string; idleSeconds: number | null }[] }[]
    } | undefined
    if (!value || !value.list.some(r => r.ref.token === token && r.slots.some(s => s.slot === slot))) {
      throw new Error('slot missing from public state')
    }
    const list = value.list.map(r => r.ref.token !== token ? r : {
      ...r, slots: r.slots.map(s => s.slot !== slot ? s : { ...s, state: 'LOST', idleSeconds: null }),
    })
    return { value: { ...result.value, value: { ...value, list } } }
  })
  return (token, slot) => { want = { token, slot } }
}

export function arrangeEarlier(on: On): (counts: { runs: number; done: number; failed: number; stopped: number }) => void {
  let counts: { runs: number; done: number; failed: number; stopped: number } | null = null
  on('state.get', { plugin: 'claudish', key: 'earlier' }, async (_$, e, next) => {
    const result = await next(e)
    return counts === null || 'deny' in result ? result : { value: { ...result.value, value: counts } }
  })
  return c => { counts = c }
}

export function frameLines(tree: unknown): string[] {
  const frames = walk(tree).map(x => x.node).filter(n => n.type === 'Box'
    && (n.props?.key ?? (n as { key?: unknown }).key) === 'frame')
  expect(frames).toHaveLength(1)
  const linesOf = (value: unknown): string[] => {
    if (typeof value === 'string' || typeof value === 'number') return String(value).split('\n')
    if (!value || typeof value !== 'object') return []
    const n = value as Node
    if (n.type === 'Text' || n.props?.flexDirection === 'row') return visibleText(n).split('\n')
    return children(n).flatMap(linesOf)
  }
  return children(frames[0]!).flatMap(linesOf)
}
