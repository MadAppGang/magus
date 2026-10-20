// Blind-test helpers: reads over a drawn tree (rows, buttons, inherited colours) and the
// model-side starts that put a run into the session. Written from the spec and the UI /
// stop-wake contracts only; no knowledge of the implementation's element keys.
//
// Home: plugins/claudish/tests/blind/helpers.ts (the harness sits one level up).

import type { Engine } from 'claude-code/testing'
import { CREATE_TOOL, TEAM_TOOL, type FakeRun, type FakeSession, type Harness } from '../fake-claudish'
import { walk } from '../ui'

export type N = { type?: string; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }

/** Spec 2.4.0 §9 (R4): the theme keys, used only by text outside the badges. */
export const THEME_KEYS = [
  'claude', 'permission', 'success', 'error', 'warning', 'inactive', 'subtle', 'inverseText', 'ide', 'suggestion',
] as const

/**
 * Spec §9, the dark palette (the kit pins no theme and no TERM_THEME/COLORFGBG, so dark): each hue,
 * its solid ink (white or #0B0B12, by WCAG contrast) and, for tokens, the quiet fill (the hue 55 %
 * toward black, written in white). Values worked from the §9 table and formulas, not from the code.
 */
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
 * R6.2/R6.5 (dark): a hue's quiet fill is the hue mixed 55 % toward black. Where a channel lands on an
 * exact half the spec leaves the rounding open, so both spellings are listed.
 */
export function quietDark(hex: string): string[] {
  const opts = [0, 1, 2].map(i => {
    const exact = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) * 0.45
    return Math.abs(exact - Math.floor(exact) - 0.5) < 1e-6 ? [Math.floor(exact), Math.ceil(exact)] : [Math.round(exact)]
  })
  const two = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
  return opts[0]!.flatMap(r => opts[1]!.flatMap(g => opts[2]!.map(b => `#${two(r)}${two(g)}${two(b)}`)))
}

/**
 * Every colour the band (and the Show panel outside the child's frame) may draw (R6.6): the theme
 * keys, the §9/§10 dark palette's hex, and the quiet inks R6.2 puts tool calls, loops and cost on,
 * plus the run hue's quiet fill under the shown Show tab (R6.5). Hex compared upper-case.
 */
export const ALLOWED_COLOURS: readonly string[] = [
  ...THEME_KEYS,
  ...new Set([...Object.values(DARK), ...[DARK.run, DARK.tools, DARK.loops, DARK.cost].flatMap(quietDark)]),
]

/** A drawn colour as ALLOWED_COLOURS spells it: theme keys as they are, hex upper-case. */
export function allowedSpelling(c: unknown): unknown {
  return typeof c === 'string' && c.startsWith('#') ? c.toUpperCase() : c
}

/** Spec §2/§9: state → 3-letter badge code, its ink (`fg`) on its solid fill (`bg`), and its hue (the runtime's text). */
export const STATE_LOOK = {
  STARTING: { code: 'NEW', fg: DARK.ink, bg: DARK.run },
  RUNNING: { code: 'RUN', fg: DARK.ink, bg: DARK.run },
  AWAITING_INPUT: { code: 'ASK', fg: DARK.ink, bg: DARK.ask },
  AWAITING_PERMISSION: { code: 'ASK', fg: DARK.ink, bg: DARK.ask },
  COMPLETED: { code: 'END', fg: DARK.ink, bg: DARK.done },
  FAILED: { code: 'ERR', fg: DARK.ink, bg: DARK.fail },
  TIMEOUT: { code: 'TMO', fg: DARK.ink, bg: DARK.fail },
  EMPTY: { code: 'NIL', fg: DARK.ink, bg: DARK.fail },
  /** EMPTY with reason shape_mismatch: an answer in the wrong format, never "empty" */
  WRONG_FORMAT: { code: 'FMT', fg: DARK.ink, bg: DARK.format },
  CANCELLED: { code: 'STP', fg: DARK.snow, bg: DARK.stopped },
} as const

export const SLOW = { timeoutMs: 60_000 } as const

export function kids(n: N): unknown[] {
  const c = n.children ?? (n.props?.children as unknown) ?? []
  return Array.isArray(c) ? c.flat(Infinity) : [c]
}

export function keyOf(n: N): string | undefined {
  const k = n.props?.key ?? n.key
  return k === undefined || k === null ? undefined : String(k)
}

export function labelOf(n: N): string {
  const l = n.props?.label
  return typeof l === 'string' ? l : ''
}

/**
 * What a subtree shows: Buttons as `[ label ]` (a `plain` Button with children draws its
 * children, as a chip does), a column Box line by line, a row Box with its gap.
 */
export function textOf(t: unknown): string {
  if (typeof t === 'string') return t
  if (typeof t === 'number') return String(t)
  if (t === null || typeof t !== 'object') return ''
  const n = t as N
  if (n.type === 'Button') return n.props?.plain && kids(n).length > 0 ? kids(n).map(textOf).join('') : `[ ${labelOf(n)} ]`
  const parts = kids(n).map(textOf)
  if (n.type === 'Box') {
    if (n.props?.flexDirection === 'column') return parts.join('\n')
    const gap = typeof n.props?.gap === 'number' ? n.props.gap : typeof n.props?.columnGap === 'number' ? n.props.columnGap : 0
    return parts.join(' '.repeat(gap as number))
  }
  return parts.join('')
}

export function nodesOf(tree: unknown): N[] {
  return walk(tree).map(w => w.node as N)
}

export function buttonsIn(tree: unknown): N[] {
  return nodesOf(tree).filter(n => n.type === 'Button')
}

/** The deepest non-header node that shows `needle` and holds at least one Button: one band row. */
export function rowFor(tree: unknown, needle: string): N | undefined {
  let best: { node: N; depth: number } | undefined
  for (const { node, depth } of walk(tree)) {
    const n = node as N
    if (n.type === 'Button') continue
    const t = textOf(n)
    if (!t.includes(needle) || t.includes('◆ claudish')) continue
    if (!buttonsIn(n).length) continue
    if (!best || depth > best.depth) best = { node: n, depth }
  }
  return best?.node
}

/** The badge codes a row leads with (spec 2.4.0 §2), padded as drawn; the one field narrowing never drops. */
const CODES = [...new Set([...Object.values(STATE_LOOK).map(l => l.code), '???', 'LST'])].map(c => ` ${c} `)

/**
 * Every band row, one per slot: for each `Show` Button, the deepest non-header node that holds
 * exactly that one Show AND shows a badge code. The code (not the model id) identifies the row
 * because narrowing may cut the model id; requiring it skips any wrapper around the Button alone.
 */
export function rowsOf(tree: unknown): N[] {
  const shows = buttonsIn(tree).filter(b => labelOf(b) === 'Show')
  return shows.map(show => {
    let best: { node: N; depth: number } | undefined
    for (const { node, depth } of walk(tree)) {
      const n = node as N
      if (n.type === 'Button' || !buttonsIn(n).includes(show)) continue
      const t = textOf(n)
      if (t.includes('◆ claudish')) continue
      if (!CODES.some(c => t.includes(c))) continue
      if (buttonsIn(n).filter(b => labelOf(b) === 'Show').length !== 1) continue
      if (!best || depth > best.depth) best = { node: n, depth }
    }
    return best?.node
  }).filter((n): n is N => n !== undefined)
}

export function stopButton(row: N | undefined): N | undefined {
  return row ? buttonsIn(row).find(b => labelOf(b) === 'Stop' || labelOf(b) === 'Stop?') : undefined
}

export function showButton(row: N | undefined): N | undefined {
  return row ? buttonsIn(row).find(b => labelOf(b) === 'Show') : undefined
}

/** R2/R3: the button a row's Show becomes while its tab is open and drawn. */
export function hideButton(row: N | undefined): N | undefined {
  return row ? buttonsIn(row).find(b => labelOf(b) === 'Hide') : undefined
}

/** The colour each shown string matching `re` is drawn in: its own or the nearest ancestor's `color`. */
export function colorsOf(tree: unknown, re: RegExp): (string | undefined)[] {
  const out: (string | undefined)[] = []
  const go = (t: unknown, color: string | undefined) => {
    if (typeof t === 'string') {
      if (re.test(t)) out.push(color)
      return
    }
    if (t === null || typeof t !== 'object') return
    const n = t as N
    const c = typeof n.props?.color === 'string' ? (n.props.color as string) : color
    if (n.type === 'Button') {
      if (re.test(labelOf(n))) out.push(c)
      return
    }
    for (const k of kids(n)) go(k, c)
  }
  go(tree, undefined)
  return out
}

/** The fill each shown string matching `re` is drawn on: its own or the nearest ancestor's `backgroundColor`. */
export function fillsOf(tree: unknown, re: RegExp): (string | undefined)[] {
  const out: (string | undefined)[] = []
  const go = (t: unknown, fill: string | undefined) => {
    if (typeof t === 'string') {
      if (re.test(t)) out.push(fill)
      return
    }
    if (t === null || typeof t !== 'object') return
    const n = t as N
    const f = typeof n.props?.backgroundColor === 'string' ? (n.props.backgroundColor as string) : fill
    for (const k of kids(n)) go(k, f)
  }
  go(tree, undefined)
  return out
}

/** Text elements with no Text above them: the ones that decide wrapping. */
export function outerTexts(tree: unknown): N[] {
  const out: N[] = []
  const go = (t: unknown, underText: boolean) => {
    if (t === null || typeof t !== 'object') return
    const n = t as N
    if (n.type === 'Text' && !underText) out.push(n)
    for (const k of kids(n)) go(k, underText || n.type === 'Text')
  }
  go(tree, false)
  return out
}

/** True when the band passed to the engine (the harness's own drawing stands). */
export function isEngineDrawing(tree: unknown): boolean {
  return nodesOf(tree).some(n => keyOf(n) === 'engine-own') && !textOf(tree).includes('claudish')
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** How many of `texts` carry a line naming `who` together with `state` (a slot's line in a wake). */
export function namedWith(texts: readonly string[], who: string, state: string): number {
  const re = new RegExp(`${esc(who)}.*\\b${esc(state)}\\b`)
  return texts.filter(t => t.split('\n').some(line => re.test(line))).length
}

/** The model starts a team panel run (the mod observes it through tool.call). */
export async function startTeam($: Engine, h: Harness, path: string, models: readonly string[]): Promise<FakeRun> {
  const before = h.fake.runs.length
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path, models: [...models], input: 'review this' } as never)
  if (h.fake.runs.length !== before + 1) throw new Error(`team run at ${path} did not start`)
  return h.fake.runs[h.fake.runs.length - 1]!
}

/** The model starts a delegation; with `prompt: null` the child starts waiting for input. */
export async function startDelegation($: Engine, h: Harness, model: string, prompt: string | null = 'do the task'): Promise<FakeSession> {
  const before = h.fake.sessions.length
  await $.tool.call({ tool: CREATE_TOOL, model, ...(prompt === null ? {} : { prompt }) } as never)
  if (h.fake.sessions.length !== before + 1) throw new Error(`delegation ${model} did not start`)
  return h.fake.sessions[h.fake.sessions.length - 1]!
}

/** A run claudish knows that THIS session never started (another session's, or a restart's leftover). */
export function foreignRun(h: Harness, path: string, models: readonly string[]): FakeRun {
  const startedAt = h.clock.now()
  const run: FakeRun = {
    runId: `foreign-${startedAt.toString(36)}-abcdef`,
    path,
    startedAt,
    hidden: false,
    slots: models.map((model, i) => ({
      slot: String(i + 1).padStart(2, '0'),
      model,
      control: { state: 'RUNNING', reason: null, at: startedAt },
      noPane: false,
      finalFrame: false,
    })),
  }
  h.fake.runs.push(run)
  return run
}

/** The calls the mod made to claudish, as `tool` or `tool:mode`. */
export function modVerbs(h: Harness): string[] {
  return h.fake.calls.map(c => (c.tool === 'team' ? `team:${String(c.args.mode)}` : c.tool))
}

/** A few polls: by then the mod has noticed a change and named it in a prompt (nothing holds a wake-up). */
export const NOTICED_MS = 3_000
