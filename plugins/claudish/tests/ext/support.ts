// Black-box helpers. Imports deliberately target the HOME plugin test layout.
import { expect, type Engine } from 'claude-code/testing'
import { CREATE_TOOL, TEAM_TOOL, type Harness } from '../fake-claudish'
import { walk, type Mounted, type Node } from '../ui'

export const POLL = 1_500
// Spec §9: the theme keys (text outside the badges) and the badges' dark palette, as the kit draws
// with no theme set. The hex values are worked from the §9 table and formulas, not read from the code.
export const DARK = {
  run: '#89B4FA', ask: '#FFB454', done: '#22E06B', fail: '#FF4D5E', format: '#FFD479', stopped: '#5A5E78',
  model: '#5B6CE0', tools: '#4FD6BE', loops: '#B794F6', cost: '#FFD479', // §10: model indigo
  ink: '#0B0B12', snow: '#FFFFFF',
  // quiet fill: the hue 55 % toward black, written in white
  modelQuiet: '#293165',
  // §10 "Tokens, FINAL": two fixed inks, no hue; dark in #0F592A, out #16803D, both written in white
  tokensIn: '#0F592A', tokensOut: '#16803D',
} as const
export const THEME = [
  'claude', 'permission', 'success', 'error', 'warning', 'inactive', 'subtle', 'inverseText', 'ide', 'suggestion',
  ...new Set(Object.values(DARK)),
]

let callId = 0
export async function modelCall($: Engine, tool: string, args: Record<string, unknown>) {
  return $.tool.call({ ...args, tool, tool_use_id: `ext-${++callId}` } as Parameters<Engine['tool']['call']>[0])
}

export async function delegate($: Engine, h: Harness, prompt: string | null = 'Work on the task', tool = CREATE_TOOL) {
  await modelCall($, tool, { model: 'haiku-4.5', ...(prompt === null ? {} : { prompt }) })
  const s = h.fake.sessions[h.fake.sessions.length - 1]
  if (!s) throw new Error('no session was started')
  await h.clock.advance(POLL)
  return s
}

export async function team($: Engine, h: Harness, path = 'review', models = ['model-a', 'model-b', 'model-c'], tool = TEAM_TOOL) {
  await modelCall($, tool, { mode: 'run', path, models })
  const r = h.fake.runs[h.fake.runs.length - 1]
  if (!r) throw new Error('no run was started')
  await h.clock.advance(POLL)
  return r
}

export async function endTurn($: Engine, agentId?: string) {
  await $.turn.complete({ turnId: 'ext-main', answer: 'finished', durationMs: 1, isAborted: false, reason: 'answer', ...(agentId ? { agentId } : {}) })
}

// Only published $.state keys are inspected, never implementation exports or private constants.
export type Entry = { kind: string; at: number; state?: string; attempts?: number }
export function ledger(h: Harness): Record<string, Entry> {
  const value = h.state.get('wakeLedger') as { entries?: Record<string, Entry> } | undefined
  return value?.entries ?? {}
}
export function entries(h: Harness) { return Object.values(ledger(h)) }
export function delivered(h: Harness) { return entries(h).filter(e => e.kind === 'delivered') }

export function children(node: Node): unknown[] {
  const c = node.children ?? node.props?.children ?? []
  return (Array.isArray(c) ? c : [c]).flat(Infinity)
}
export function textOf(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (!tree || typeof tree !== 'object') return ''
  const n = tree as Node
  if (n.type === 'Button') return String(n.props?.label ?? '')
  return children(n).map(textOf).join('')
}
export async function drawingText(m: Mounted) { return textOf(await m.drawn()) }

// Locate a row by its visible model and exactly one Show (or Hide, while its tab is open), not by
// undocumented row keys. The buttons' own group holds no model text, so it is never the row.
export async function row(m: Mounted, model: string): Promise<Node> {
  const candidates = walk(await m.drawn()).map(x => x.node).filter(n =>
    n.type === 'Box' && textOf(n).includes(model)
    && walk(n).filter(x => x.node.type === 'Button' && (x.node.props?.label === 'Show' || x.node.props?.label === 'Hide')).length === 1)
  const found = candidates[candidates.length - 1]
  if (!found) throw new Error(`no row for ${model}`)
  return found
}
export async function button(m: Mounted, model: string, label: string): Promise<string> {
  const n = walk(await row(m, model)).map(x => x.node).find(n => n.type === 'Button' && n.props?.label === label)
  expect(n).toBeDefined()
  const key = n?.props?.key ?? (n as { key?: unknown } | undefined)?.key
  expect(typeof key).toBe('string')
  return key as string
}
export async function press(m: Mounted, model: string, label: string) { await m.press({ key: await button(m, model, label) }) }

export function themeOnly(tree: unknown) {
  for (const { node, inFrame } of walk(tree)) {
    if (inFrame) continue
    for (const prop of ['color', 'backgroundColor', 'borderColor']) {
      if (node.props?.[prop] !== undefined) expect(THEME).toContain(node.props[prop])
    }
  }
}
/** The status badge (§9): its 3-letter `code`, drawn ` XXX `, bold, in `color` on the solid `fill`. */
export function stateColor(tree: unknown, code: string, color: string, fill: string) {
  const nodes = walk(tree).map(x => x.node).filter(n => n.type === 'Text' && textOf(n) === ` ${code} `)
  expect(nodes.length).toBeGreaterThan(0)
  expect(nodes.some(n => n.props?.color === color && n.props?.backgroundColor === fill && n.props?.bold === true)).toBe(true)
}


