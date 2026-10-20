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

/**
 * `hex` mixed `t` of the way toward `target`, per channel, rounded. Where a channel lands exactly on
 * a half, the spec does not fix the rounding, so both spellings are returned (upper-case `#RRGGBB`).
 * Worked from the spec's formulas, never read from the code.
 */
export function mixCandidates(hex: string, target: string, t: number): string[] {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16)
  const options = [0, 1, 2].map(i => {
    const exact = ch(hex, i) + (ch(target, i) - ch(hex, i)) * t
    const frac = exact - Math.floor(exact)
    return Math.abs(frac - 0.5) < 1e-6 ? [Math.floor(exact), Math.ceil(exact)] : [Math.round(exact)]
  })
  const out: string[] = []
  const two = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
  for (const r of options[0]!) for (const g of options[1]!) for (const b of options[2]!) out.push(`#${two(r)}${two(g)}${two(b)}`)
  return out
}

/**
 * R6.2/R6.5, dark: the quiet fill of a hue (the hue 55 % toward black, written in white). Tool calls,
 * loops and cost sit on their hue's quiet ink; the Show panel's shown tab sits on the run hue's quiet fill.
 */
export const QUIET_DARK = {
  run: mixCandidates(DARK.run, '#000000', 0.55),
  tools: mixCandidates(DARK.tools, '#000000', 0.55),
  loops: mixCandidates(DARK.loops, '#000000', 0.55),
  cost: mixCandidates(DARK.cost, '#000000', 0.55),
  model: [DARK.modelQuiet] as string[],
} as const

/** A colour equals one of the spellings the spec allows (hex compared without case). */
export function isOneOf(colour: unknown, candidates: readonly string[]): boolean {
  return typeof colour === 'string' && candidates.some(c => c.toUpperCase() === colour.toUpperCase())
}

// R6.6: the theme keys the band may use, plus the raw palette colours of §9/§10 (with R6.2's quiet inks).
export const THEME = [
  'claude', 'permission', 'success', 'error', 'warning', 'inactive', 'subtle', 'inverseText', 'ide', 'suggestion',
  ...new Set([...Object.values(DARK), ...Object.values(QUIET_DARK).flat()]),
]
/** R6.6: theme keys the band no longer uses. */
export const RETIRED_THEME_KEYS = ['diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed', 'merged', 'text'] as const

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

/** A colour as compared against the allowed set: theme keys exactly, raw hex without case. */
export function colourKey(c: unknown): unknown {
  return typeof c === 'string' && c.startsWith('#') ? c.toUpperCase() : c
}
export function themeOnly(tree: unknown) {
  const allowed = THEME.map(colourKey)
  for (const { node, inFrame } of walk(tree)) {
    if (inFrame) continue
    for (const prop of ['color', 'backgroundColor', 'borderColor']) {
      if (node.props?.[prop] !== undefined) expect(allowed).toContain(colourKey(node.props[prop]))
      // R6.6: retired theme keys never come back
      expect(RETIRED_THEME_KEYS as readonly unknown[]).not.toContain(node.props?.[prop])
    }
  }
}
/** The status badge (§9): its 3-letter `code`, drawn ` XXX `, bold, in `color` on the solid `fill`. */
export function stateColor(tree: unknown, code: string, color: string, fill: string) {
  const nodes = walk(tree).map(x => x.node).filter(n => n.type === 'Text' && textOf(n) === ` ${code} `)
  expect(nodes.length).toBeGreaterThan(0)
  expect(nodes.some(n => n.props?.color === color && n.props?.backgroundColor === fill && n.props?.bold === true)).toBe(true)
}


