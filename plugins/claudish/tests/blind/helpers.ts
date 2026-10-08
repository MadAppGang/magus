// Blind-test helpers: reads over a drawn tree (rows, buttons, inherited colours) and the
// model-side starts that put a run into the session. Written from the spec and the UI /
// stop-wake contracts only; no knowledge of the implementation's element keys.
//
// Home: plugins/claudish/tests/blind/helpers.ts (the harness sits one level up).

import type { Engine } from 'claude-code/testing'
import { CREATE_TOOL, TEAM_TOOL, type FakeRun, type FakeSession, type Harness } from '../fake-claudish'
import { walk } from '../ui'

export type N = { type?: string; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }

/** UI contract §4.2: the only colours the mod's own drawing may use. */
export const THEME_KEYS = ['claude', 'permission', 'success', 'error', 'warning', 'inactive', 'subtle'] as const

/** UI contract §4.2: state → glyph, word, theme key. */
export const STATE_LOOK = {
  STARTING: { glyph: '◌', word: 'starting', color: 'warning' },
  RUNNING: { glyph: '▶', word: 'running', color: 'warning' },
  AWAITING_INPUT: { glyph: '◇', word: 'input', color: 'permission' },
  AWAITING_PERMISSION: { glyph: '◇', word: 'permit', color: 'permission' },
  COMPLETED: { glyph: '✓', word: 'done', color: 'success' },
  FAILED: { glyph: '✕', word: 'failed', color: 'error' },
  TIMEOUT: { glyph: '✕', word: 'timeout', color: 'error' },
  EMPTY: { glyph: '✕', word: 'empty', color: 'error' },
  CANCELLED: { glyph: '■', word: 'stopped', color: 'inactive' },
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

/** What a subtree shows: Buttons as `[ label ]`, a column Box line by line, a row Box with its gap. */
export function textOf(t: unknown): string {
  if (typeof t === 'string') return t
  if (typeof t === 'number') return String(t)
  if (t === null || typeof t !== 'object') return ''
  const n = t as N
  if (n.type === 'Button') return `[ ${labelOf(n)} ]`
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

/** The state glyphs a row leads with (UI contract §4.2); the one field narrowing never drops. */
const GLYPHS = [...new Set(Object.values(STATE_LOOK).map(l => l.glyph))]

/**
 * Every band row, one per slot: for each `Show` Button, the deepest non-header node that holds
 * exactly that one Show AND shows a state glyph. The glyph (not the model id) identifies the row
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
      if (!GLYPHS.some(g => t.includes(g))) continue
      if (buttonsIn(n).filter(b => labelOf(b) === 'Show').length !== 1) continue
      if (!best || depth > best.depth) best = { node: n, depth }
    }
    return best?.node
  }).filter((n): n is N => n !== undefined)
}

export function stopButton(row: N | undefined): N | undefined {
  return row ? buttonsIn(row).find(b => labelOf(b) === 'Stop' || labelOf(b) === 'confirm?') : undefined
}

export function showButton(row: N | undefined): N | undefined {
  return row ? buttonsIn(row).find(b => labelOf(b) === 'Show') : undefined
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

/** decisions-monitor-dedupe #2: how long the mod holds a unit the plugin monitor covers. */
export const MONITOR_GRACE_MS = 10_000
/** Past the hold plus a few polls: a held unit with no monitor line has woken by then. */
export const PAST_HOLD_MS = MONITOR_GRACE_MS + 4_000

let rowSeq = 0

/**
 * The plugin monitor's stdout line, kept as the session keeps it: a background task's
 * notification row (user role, isMeta, origin `task-notification`) with the line on its own
 * line. Resolves with the row sent. The 2.1.292 kit has no core for `session.append`, so the
 * call rejects once the row is past the plugin (after the harness spy recorded it); exactly
 * that rejection is swallowed, any other is rethrown.
 */
export async function monitorLine($: Engine, line: string): Promise<unknown> {
  rowSeq += 1
  const row = {
    message: {
      type: 'user',
      role: 'user',
      isMeta: true,
      content: [{ type: 'text', text: `<task-notification>\n<task-id>claudish-sessions</task-id>\n<event>\n${line}\n</event>\n</task-notification>` }],
    },
    door: 'delivery',
    origin: { kind: 'task-notification' },
    uuid: `00000000-0000-4000-8000-${String(rowSeq).padStart(12, '0')}`,
  }
  const session = ($ as unknown as { session: { append: (e: unknown) => Promise<unknown> } }).session
  await session.append(row).catch((err: unknown) => {
    const m = err instanceof Error ? err.message : String(err)
    if (!/session\.append|no implementation/i.test(m)) throw err
  })
  return row
}
