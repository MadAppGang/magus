// Spec-derived view-band coverage. Run in the real plugin with claude plugin test.
// Observations: external MCP traffic, published state, and what the two host surfaces draw.
import type { On } from 'claude-code'
import { expect, type Engine } from 'claude-code/testing'
import { test } from './kit'
import type {
  ClaudishFeedSupport, ClaudishPaneView, ClaudishReplays, ClaudishRuns,
  ClaudishShowTab, ClaudishTextView, ClaudishViewer,
} from '../types'
import { resetViewOrder } from '../hooks/status/view'
import {
  CREATE_TOOL, SERVERS, TEAM_TOOL, harness, start,
  type Harness, type ListOverride, type Recorded,
} from './fake-claudish'
import { contractError, isTerminal, iso, slotRow, type Json } from './scenario'
import {
  bandProps, mountBand, mountPane, paneProps, SURFACES,
  type Mounted, type Surface,
} from './ui'
import { modelCall } from './ext/support'
import { bandRow, pressChip, visibleText } from './ext/v2-support'

const SERVER = SERVERS[0]
const SHOW = 'claudish-show'
const SEQ = 73
const OMIT = Symbol('no wire view key')
const HERE = holder('claude_code', 'this Claude Code')
const AWAY = holder('herdr', 'Herdr window')
const LIVE_KINDS = ['session', 'team'] as const
const KINDS = [...LIVE_KINDS, 'replay'] as const
type Kind = typeof KINDS[number]
type Feed = 'runs' | 'sessions'
type Target = {
  kind: Kind; key: string; slot: string; token: string; address: string
  model: string; server: string; feed: Feed
}
type Views = { b: Mounted; p: Mounted }
type Gate = { promise: Promise<void>; release(): void; sent: boolean }
type World = {
  h: Harness
  capable: Record<Feed, boolean>
  replaySupport: boolean
  defaultView: unknown
  views: Map<string, unknown>
  captureViews: Map<string, unknown>
  openView: unknown
  resizeView: unknown
  missing: Set<string>
  captureOverride: ((call: Recorded, target: Target) => ListOverride | undefined) | null
  resizeOverride: ((call: Recorded, target: Target) => ListOverride | undefined) | null
  nextListGate: { feed: Feed; gate: Gate } | null
  forceTextTab: string | null
}
type Prepared = { w: World; v: Views; t: Target; size: { cols: number; rows: number }; anchor?: Target }

function holder(name: string, label: unknown): Json {
  return { holder: name, label, since: '2026-11-10T00:00:00.000Z', claim_id: 'opaque-grant' }
}
const answer = (body: unknown): ListOverride => ({ text: JSON.stringify(body) })
const wire = ({ server, tool, args }: Recorded) => ({ server, tool, args })
const field = (raw: unknown): Json => raw === OMIT ? {} : { view: raw }
const getView = (w: World, key: string) => w.views.has(key) ? w.views.get(key) : w.defaultView

function gate(): Gate {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release, sent: false }
}
function callsFor(c: Recorded, t: Target) {
  return c.server === t.server && (t.kind === 'team'
    ? c.tool === 'team' && c.args.path === t.address && c.args.run_id === t.token && c.args.slot === t.slot
    : c.args.session_id === t.token)
}
function listWire(feed: Feed) {
  return feed === 'runs'
    ? { server: SERVER, tool: 'team', args: { mode: 'list' } }
    : { server: SERVER, tool: 'list_sessions', args: { include_completed: true } }
}
function resizeWire(t: Target, cols: unknown, rows: unknown) {
  return t.kind === 'team'
    ? { server: t.server, tool: 'team', args: { mode: 'resize', path: t.address, slot: t.slot, run_id: t.token, cols, rows } }
    : { server: t.server, tool: 'resize_session', args: { session_id: t.token, cols, rows } }
}
function captureWire(t: Target, since: unknown) {
  return t.kind === 'team'
    ? { server: t.server, tool: 'team', args: { mode: 'capture', path: t.address, slot: t.slot, run_id: t.token, since_seq: since } }
    : { server: t.server, tool: 'capture_session', args: { session_id: t.token, since_seq: since } }
}
const ownResizes = (w: World, t: Target, from = 0) => w.h.fake.calls.slice(from).filter(c =>
  callsFor(c, t) && (c.tool === 'resize_session' || c.args.mode === 'resize'))
const ownCaptures = (w: World, t: Target, from = 0) => w.h.fake.calls.slice(from).filter(c =>
  callsFor(c, t) && (c.tool === 'capture_session' || c.args.mode === 'capture'))
const ownTranscripts = (w: World, t: Target, from = 0) => w.h.fake.calls.slice(from).filter(c =>
  callsFor(c, t) && (c.tool === 'transcript_session' || c.args.mode === 'transcript'))
const runs = (w: World) => (w.h.state.get('runs') as ClaudishRuns | undefined)?.list ?? []
function active(w: World) {
  const id = (w.h.state.get('showTab') as ClaudishShowTab | undefined)?.active
  if (!id) throw new Error('Show did not publish its active tab')
  return id
}
function pane(w: World, id = active(w)): ClaudishPaneView {
  const p = w.h.state.get('panes/' + id) as ClaudishPaneView | undefined
  if (!p) throw new Error('No published pane for ' + id)
  return p
}
const replays = (w: World) => (w.h.state.get('replays') as ClaudishReplays | undefined) ?? {}

function targetOf(w: World, c: Recorded): Target | undefined {
  if (c.tool === 'team') {
    const run = w.h.fake.runs.find(r => r.runId === c.args.run_id && r.path === c.args.path)
    const s = run?.slots.find(s => s.slot === c.args.slot)
    return run && s ? {
      kind: 'team', key: s.slot, slot: s.slot, token: run.runId, address: run.path,
      model: s.model, server: c.server, feed: 'runs',
    } : undefined
  }
  const r = w.h.fake.replays.find(r => r.id === c.args.session_id)
  if (r) return {
    kind: 'replay', key: r.id, slot: r.slot, token: r.id, address: r.id,
    model: r.model, server: c.server, feed: 'sessions',
  }
  const s = w.h.fake.sessions.find(s => s.id === c.args.session_id)
  return s ? {
    kind: 'session', key: s.id, slot: s.id, token: s.id, address: s.id,
    model: s.model, server: c.server, feed: 'sessions',
  } : undefined
}

// Contract-shaped server testdata. Counters and frames are fixed so repeated identical
// observations have no clock-dependent data differences in the capability-absent comparison.
function listBody(w: World, feed: Feed): Json {
  const meta = {
    contract_version: 1,
    capabilities: ['list', 'status', 'cancel', 'capture', 'capture_since_seq', 'resize', 'transcript',
      ...(w.replaySupport ? ['replay'] : []), ...(w.capable[feed] ? ['view'] : [])],
  }
  if (feed === 'runs') return { ...meta, runs: w.h.fake.runs.filter(r => !r.hidden).map(r => ({
    run_id: r.runId, path: r.path, kind: 'run', started_at: iso(r.startedAt),
    finished_at: r.slots.every(s => isTerminal(s.control.state)) ? iso(r.startedAt) : null,
    state: r.slots.every(s => isTerminal(s.control.state)) ? 'SETTLED' : 'ACTIVE',
    outcome: null,
    slots: r.slots.filter(s => !w.missing.has(s.slot)).map(s => ({
      ...slotRow({ slot: s.slot, model: s.model, startedAt: r.startedAt, now: r.startedAt, control: s.control }),
      ...field(getView(w, s.slot)),
    })),
  })) }
  return { ...meta, sessions: w.h.fake.sessions.filter(s => !w.missing.has(s.id)).map(s => ({
    ...slotRow({ slot: s.id, model: s.model, startedAt: s.startedAt, now: s.startedAt, control: s.control }),
    session_id: s.id, started_at: iso(s.startedAt),
    completed_at: isTerminal(s.control.state) ? iso(s.control.at) : null, elapsed_seconds: 0,
    ...field(getView(w, s.id)),
  })) }
}
function frameBody(t: Target, raw: unknown, shape: 'frame' | 'unchanged', final = false): Json {
  return shape === 'unchanged'
    ? { seq: SEQ, unchanged: true, final, ...field(raw) }
    : { seq: SEQ, cols: 136, rows: 40, final, cursor: null,
      lines: Array.from({ length: 40 }, (_, i) => i === 0
        ? (t.kind === 'replay' ? 'REPLAY ' : 'SCREEN ') + t.model : ''),
      ...field(raw) }
}
function originalEnded(w: World, t: Target) {
  if (t.kind === 'replay') return false
  return t.kind === 'team'
    ? isTerminal(w.h.fake.runs.find(r => r.runId === t.token)!.slots.find(s => s.slot === t.slot)!.control.state)
    : isTerminal(w.h.fake.sessions.find(s => s.id === t.token)!.control.state)
}
function world(on: On, capable = true): World {
  resetViewOrder()
  const w: World = {
    h: undefined as unknown as Harness,
    capable: { runs: capable, sessions: capable }, replaySupport: false,
    defaultView: HERE, views: new Map(), captureViews: new Map(),
    openView: HERE, resizeView: HERE, missing: new Set(),
    captureOverride: null, resizeOverride: null, nextListGate: null, forceTextTab: null,
  }
  let replaySerial = 0
  let grantSerial = 0
  const grant = (raw: unknown): unknown => raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, since: iso(w.h.clock.now()), claim_id: 'view-grant-' + (++grantSerial) }
    : raw
  w.h = harness(on, {
    listReplay: true,
    sessionId: n => 'view-session-' + n,
    viewAnswer: async c => {
      const feed: Feed | null = c.tool === 'list_sessions' ? 'sessions'
        : c.tool === 'team' && c.args.mode === 'list' ? 'runs' : null
      if (feed) {
        // Serialize BEFORE a gate: later changes to the fake must not freshen a stale answer.
        const body = answer(listBody(w, feed))
        const held = w.nextListGate
        if (held?.feed === feed) {
          w.nextListGate = null
          held.gate.sent = true
          await held.gate.promise
        }
        return body
      }
      const t = targetOf(w, c)
      if (!t) return undefined
      if (c.tool === 'capture_session' || c.args.mode === 'capture') {
        const override = w.captureOverride?.(c, t)
        if (override) return override
        const raw = w.captureViews.has(t.key) ? w.captureViews.get(t.key) : getView(w, t.key)
        return answer(frameBody(t, raw, c.args.since_seq === SEQ ? 'unchanged' : 'frame', originalEnded(w, t)))
      }
      if (c.tool === 'resize_session' || c.args.mode === 'resize') {
        const override = w.resizeOverride?.(c, t)
        if (override) return override
        // This is the server's contract: an explicit resize grants a fresh view even at the same size.
        const tracks = w.capable[t.kind === 'team' ? 'runs' : 'sessions']
        const granted = grant(w.resizeView)
        w.views.set(t.key, granted === OMIT && tracks ? grant(HERE) : granted)
        return answer({ cols: c.args.cols, rows: c.args.rows, changed: false, seq: SEQ, ...field(granted) })
      }
      return undefined
    },
    replayOpenAnswer: () => {
      const replayId = 'view-replay-' + (++replaySerial)
      const granted = grant(w.openView)
      w.views.set(replayId, granted)
      return answer({ replay_id: replayId, seq: 0, ...field(granted) })
    },
    transcriptAnswer: c => answer({
      cursor: 'view-text', more: false, final: targetOf(w, c) ? originalEnded(w, targetOf(w, c)!) : true,
      lines: [{ kind: 'assistant', text: 'TEXT ' + (targetOf(w, c)?.model ?? 'retained child') }],
    }),
  })
  // Published state is a host input too. This seeds a saved Text selection for TEST-25
  // without calling a private module or requiring a mode switch on a collapsed body.
  on('state.get', { plugin: 'claudish', key: 'textView' }, async (_$, e, next) => {
    const r = await next(e)
    if (!w.forceTextTab || 'deny' in r) return r
    const previous = r.value.value as ClaudishTextView | undefined
    return { value: { ...r.value, value: {
      rev: previous?.rev ?? 0, modes: { ...previous?.modes, [w.forceTextTab]: 'text' },
    } } }
  })
  return w
}

async function until(w: World, ready: () => boolean, why: string, within = 6_000) {
  await w.h.clock.settle()
  for (let elapsed = 0; !ready() && elapsed < within; elapsed += 25) await w.h.clock.advance(25)
  expect(ready(), why).toBe(true)
}
async function nextPoll(w: World, feed: Feed) {
  const count = w.h.fake.listCalls(feed).length
  await until(w, () => w.h.fake.listCalls(feed).length > count, 'next ' + feed + ' list poll')
  await w.h.clock.settle()
}
async function press(p: Mounted, label: string) {
  await p.redraw()
  const buttons = (await p.findAll({ type: 'Button' })).filter(b => b.props.label === label)
  expect(buttons, 'one pressable ' + label).toHaveLength(1)
  expect(typeof buttons[0]!.key).toBe('string')
  await p.press({ key: buttons[0]!.key! })
}
async function create($: Engine, w: World, kind: 'session' | 'team', n = 1): Promise<Target[]> {
  const models = Array.from({ length: n }, (_, i) => kind + '-view-child-' + (i + 1))
  if (kind === 'team') {
    await modelCall($, TEAM_TOOL, { mode: 'run', path: 'view-test', models })
    await w.h.clock.advance(1_500)
    const r = w.h.fake.runs.at(-1)!
    return r.slots.map(s => ({
      kind, key: s.slot, slot: s.slot, token: r.runId, address: r.path,
      model: s.model, server: SERVER, feed: 'runs',
    }))
  }
  const before = w.h.fake.sessions.length
  for (const model of models) await modelCall($, CREATE_TOOL, { model, prompt: 'A deterministic test task' })
  await w.h.clock.advance(1_500)
  return w.h.fake.sessions.slice(before).map(s => ({
    kind, key: s.id, slot: s.id, token: s.id, address: s.id,
    model: s.model, server: SERVER, feed: 'sessions',
  }))
}
function end(w: World, t: Target, state = 'COMPLETED') {
  w.h.fake.set(t.token, t.slot, state)
}
async function open($: Engine, w: World, surface: Surface, t: Target): Promise<Views> {
  const b = await mountBand($, surface, bandProps(240, 60))
  let p: Mounted | undefined
  try {
    await pressChip(b, t.model, 'Show')
    p = await mountPane($, surface, SHOW, paneProps(136, 43))
    await w.h.clock.settle()
    return { b, p }
  } catch (error) {
    if (p) await p.unmount()
    await b.unmount()
    throw error
  }
}
async function prepare($: Engine, w: World, surface: Surface, kind: Kind): Promise<Prepared> {
  await start($, surface)
  let anchor: Target | undefined
  if (kind === 'replay') {
    w.replaySupport = true
    ;[anchor] = await create($, w, 'team')
    // The live team supplies a list-tick clock, but must not produce screen-content calls.
    if (w.capable.runs) w.views.set(anchor!.key, AWAY)
    await nextPoll(w, 'runs')
  }
  const original = (await create($, w, kind === 'team' ? 'team' : 'session'))[0]!
  const v = await open($, w, surface, original)
  try {
    // Establish the dock measurement while the original is live. Replay open can
    // carry that size itself; it need not issue a redundant initial resize.
    await until(w, () => ownResizes(w, original).some(c => c.args.cols === 136 && c.args.rows === 40), 'live dock viewport measured')
    const measured = ownResizes(w, original).at(-1)!
    const size = { cols: Number(measured.args.cols), rows: Number(measured.args.rows) }
    let t = original
    if (kind === 'replay') {
      end(w, original)
      await nextPoll(w, 'sessions')
      await until(w, () => Boolean(replays(w)[active(w)]), 'replay-open published its id')
      const replayId = replays(w)[active(w)]!.replayId
      t = { ...original, kind: 'replay', key: replayId, token: replayId, address: replayId }
      // The still-mounted panel keeps the measured dock size for later band presses.
      await until(w, () => ownCaptures(w, t).length > 0, 'initial replay screen')
    }
    await w.h.clock.advance(2_000)
    return { w, v, t, size, anchor }
  } catch (error) {
    await v.p.unmount()
    await v.b.unmount()
    throw error
  }
}
async function dispose($: Engine, w: World, v?: Views) {
  w.forceTextTab = null
  w.nextListGate?.gate.release()
  w.nextListGate = null
  w.h.panes = []
  try {
    await $.session.end({ reason: 'clear', sessionId: 'view-test', resume: { id: 'view-test' } })
    await w.h.clock.settle()
  } finally {
    if (v) { await v.p.unmount(); await v.b.unmount() }
    resetViewOrder()
  }
}
async function collapsed(w: World, v: Views, label = 'Herdr window') {
  await until(w, () => pane(w).viewer?.kind === 'elsewhere', 'foreign viewer applied')
  await v.p.redraw()
  const bands = (await v.p.findAll({ type: 'Button' })).filter(b => b.props.label === 'viewing in ' + label)
  expect(bands, 'one exact foreign-view Button').toHaveLength(1)
  expect(typeof bands[0]!.key).toBe('string')
  const labels = (await v.p.findAll({ type: 'Button' })).map(b => b.props.label)
  expect(labels).not.toContain('Screen')
  expect(labels).not.toContain('Text')
  expect(labels).toContain('Hide')
  expect(labels).toContain(pane(w).model)
  await v.b.redraw()
  expect(visibleText(await v.b.drawn())).toContain('◆ claudish')
  const drawn = visibleText(await v.p.drawn())
  expect(drawn).toContain('viewing in ' + label)
  expect(drawn).not.toContain('SCREEN ')
  expect(drawn).not.toContain('REPLAY ')
  expect(drawn).not.toContain('TEXT ')
}
async function noBand(v: Views) {
  await v.p.redraw()
  expect((await v.p.findAll({ type: 'Button' })).filter(b => String(b.props.label).startsWith('viewing in '))).toEqual([])
}
async function collapse(w: World, v: Views, t: Target, raw: unknown = AWAY) {
  w.views.set(t.key, raw)
  if (t.kind === 'replay') await until(w, () => pane(w).viewer?.kind === 'elsewhere', 'replay capture reports foreign viewer')
  else await nextPoll(w, t.feed)
  const viewer = pane(w).viewer
  if (viewer?.kind !== 'elsewhere') throw new Error('Target did not collapse')
  await collapsed(w, v, viewer.label)
  await w.h.clock.settle()
}
// Preserve every observed field. Only host-allocated press handles and wake
// nonces are world-local identities; keep their equality/reuse relationships.
function observationData() {
  const handles = new Map<unknown, string>()
  const nonces = new Map<unknown, string>()
  function identity(ids: Map<unknown, string>, kind: string, value: unknown): unknown {
    if (typeof value !== 'string' && typeof value !== 'number') return value
    if (!ids.has(value)) ids.set(value, kind + '-' + (ids.size + 1))
    return ids.get(value)!
  }
  function copy(value: unknown, scope: 'plain' | 'drawing' | 'ledger', parent = ''): unknown {
    if (Array.isArray(value)) return value.map(v => copy(v, scope, parent))
    if (!value || typeof value !== 'object') {
      expect(typeof value, 'observations must be data, not unobservable callbacks').not.toBe('function')
      return value
    }
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key,
      scope === 'drawing' && parent === 'press' && key === 'handle'
        ? identity(handles, 'press', v)
        : scope === 'ledger' && key === 'nonce'
          ? identity(nonces, 'nonce', v)
          : copy(v, scope, key),
    ]))
  }
  return {
    calls: (w: World) => copy(w.h.fake.calls, 'plain'),
    state: (w: World) => [...w.h.state.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, copy(value, key === 'wakeLedger' ? 'ledger' : 'plain')]),
    writes: (w: World) => w.h.writes.map(([key, value]) =>
      [key, copy(value, key === 'wakeLedger' ? 'ledger' : 'plain')]),
    drawing: (value: unknown) => copy(value, 'drawing'),
  }
}

async function legacyObservation($: Engine, on: On, surface: Surface, kind: Kind, raw: unknown) {
  const w = world(on, false)
  setAll(w, raw)
  const data = observationData()
  const checkpoints: unknown[] = []
  let v: Views | undefined
  let disposed = false
  async function checkpoint() {
    if (v) { await v.b.redraw(); await v.p.redraw() }
    checkpoints.push({
      at: w.h.clock.now(),
      state: data.state(w),
      drawing: v ? {
        band: data.drawing(await v.b.drawn()),
        panel: data.drawing(await v.p.drawn()),
      } : null,
    })
  }
  try {
    // No readiness-driven clock advances: both fresh engines execute precisely
    // this schedule. create advances exactly 1,500 ms; open only settles work.
    await start($, surface)
    await checkpoint()
    if (kind === 'replay') {
      w.replaySupport = true
      await create($, w, 'team')
      await checkpoint()
    }
    const original = (await create($, w, kind === 'team' ? 'team' : 'session'))[0]!
    await checkpoint()
    v = await open($, w, surface, original)
    await w.h.clock.advance(2_000)
    expect(ownResizes(w, original).some(c => c.args.cols === 136 && c.args.rows === 40),
      'the fixed schedule measures the shown dock').toBe(true)
    await checkpoint()
    let t = original
    if (kind === 'replay') {
      end(w, original)
      await w.h.clock.advance(4_000)
      const replay = replays(w)[active(w)]
      expect(replay, 'the fixed schedule opens the replay').toBeDefined()
      const replayId = replay!.replayId
      t = { ...original, kind: 'replay', key: replayId, token: replayId, address: replayId }
      await checkpoint()
    }
    // Include short and long intervals, retaining hidden-tab cadence calls and
    // the header's actual age text instead of trying to make time disappear.
    for (const ms of [1_000, 1_000, 5_000, 10_000]) {
      await w.h.clock.advance(ms)
      await checkpoint()
    }
    expect(ownCaptures(w, t).length, 'the comparison includes target screen captures').toBeGreaterThan(0)
    await noBand(v)
    expect(visibleText(await v.p.drawn())).toContain(
      (kind === 'replay' ? 'REPLAY ' : 'SCREEN ') + t.model)
    const feeds = w.h.state.get('feeds') as Record<string, ClaudishFeedSupport>
    for (const feed of Object.values(feeds)) if (feed.kind === 'speaks') {
      expect(Object.prototype.hasOwnProperty.call(feed.can, 'viewer')).toBe(false)
    }
    for (const [key, value] of w.h.state) if (key.startsWith('panes/') && value) {
      expect(Object.prototype.hasOwnProperty.call(value, 'viewer')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(value, 'claimNote')).toBe(false)
    }
    noWireStored(w)
    // Include teardown traffic and writes too; keep the visible checkpoints
    // from before teardown alongside the complete final observation.
    await dispose($, w, v)
    disposed = true
    return { checkpoints, calls: data.calls(w), state: data.state(w), writes: data.writes(w) }
  } finally {
    if (!disposed) await dispose($, w, v)
  }
}
function noWireStored(w: World) {
  const encoded = JSON.stringify(runs(w))
  expect(encoded).not.toContain('"view":')
  expect(encoded).not.toContain('"viewer":')
  expect(encoded).not.toContain('"viewers":')
  expect(encoded).not.toContain('"claim_id":')
  for (const [key, value] of w.h.state) if (key.startsWith('panes/') && value) {
    const p = value as ClaudishPaneView
    if (p.viewer?.kind === 'elsewhere') expect(p.viewer).toEqual({ kind: 'elsewhere', label: p.viewer.label })
    expect(JSON.stringify(p.viewer ?? null)).not.toContain('claim_id')
  }
}
async function immediateClaim(w: World, t: Target, boundary: number, size: { cols: unknown; rows: unknown }) {
  await w.h.clock.settle()
  for (let i = 0; ownCaptures(w, t, boundary).length === 0 && i < 4; i++) await w.h.clock.advance(25)
  expect(ownResizes(w, t, boundary).map(wire)).toEqual([resizeWire(t, size.cols, size.rows)])
  const capture = ownCaptures(w, t, boundary)[0]
  expect(capture, 'grant resumes capture without waiting for a list tick').toBeDefined()
  expect([0, SEQ]).toContain(capture!.args.since_seq)
  expect(wire(capture!)).toEqual(captureWire(t, capture!.args.since_seq))
  expect(w.h.fake.calls.indexOf(capture!)).toBeGreaterThan(w.h.fake.calls.indexOf(ownResizes(w, t, boundary)[0]!))
}
function setAll(w: World, raw: unknown) {
  w.defaultView = raw
  w.openView = raw
  w.resizeView = raw
  for (const key of w.views.keys()) w.views.set(key, raw)
  w.captureViews.clear()
}

for (const surface of SURFACES) {
  for (const kind of KINDS) {
    // REQ-1 / R1: each kit test gets a fresh engine and host world. Share only
    // immutable observations, never an engine, clock, fake server or stored state.
    // Run both TEST-1 worlds: whichever finishes second performs the whole
    // comparison, so the pair works in either execution order.
    const observations = new Map<string, Awaited<ReturnType<typeof legacyObservation>>>()
    for (const variant of ['no view key', 'stray view field'] as const) {
      test('TEST-1 REQ-1: capability-absent ' + kind + ' fresh world with ' + variant + ' [' + surface + ']', async ($, on) => {
        const observed = await legacyObservation($, on, surface, kind,
          variant === 'no view key' ? OMIT : holder('claude_code_other', 'Other Claude'))
        expect(observations.has(variant), 'each world contributes once to the comparison').toBe(false)
        observations.set(variant, observed)
        if (observations.size === 2) {
          expect(observations.get('stray view field'),
            'fresh capability-absent worlds have identical ordered calls, stored data, writes and drawing')
            .toEqual(observations.get('no view key'))
          observations.clear()
        }
      })
    }
  }

  test('TEST-2 REQ-1 REQ-4: one feed cannot lend its view capability to another [' + surface + ']', async ($, on) => {
    const w = world(on)
    w.capable.runs = false
    w.defaultView = AWAY
    let b: Mounted | undefined
    try {
      await start($, surface)
      const a = (await create($, w, 'team'))[0]!
      const bSession = (await create($, w, 'session'))[0]!
      const boundary = w.h.fake.calls.length
      // The panel is closed: allow its ten-second capture interval and then a
      // list tick. Observe the whole interval for forbidden session traffic.
      await w.h.clock.advance(10_000)
      await nextPoll(w, 'sessions')
      const panelReads = ownCaptures(w, a, boundary)
      expect(panelReads.length).toBeGreaterThan(0)
      for (const c of panelReads) expect(wire(c)).toEqual(captureWire(a, c.args.since_seq))
      expect(ownCaptures(w, bSession, boundary)).toEqual([])
      expect(ownTranscripts(w, bSession, boundary)).toEqual([])
      const feeds = w.h.state.get('feeds') as Record<string, ClaudishFeedSupport>
      const teamFeed = feeds[SERVER + '#panel']
      const sessionFeed = feeds[SERVER + '#delegation']
      expect(teamFeed?.kind).toBe('speaks')
      expect(sessionFeed?.kind).toBe('speaks')
      if (teamFeed?.kind !== 'speaks' || sessionFeed?.kind !== 'speaks') throw new Error('feeds did not speak v1')
      expect(teamFeed.version).toBe(1)
      expect(sessionFeed.version).toBe(1)
      expect(Object.prototype.hasOwnProperty.call(teamFeed.can, 'viewer')).toBe(false)
      expect(sessionFeed.can.viewer).toBe(true)
      b = await mountBand($, surface, bandProps(240, 60))
      expect(visibleText(await bandRow(b, bSession.model))).toContain(' RUN ')
      noWireStored(w)
    } finally { if (b) await b.unmount(); await dispose($, w) }
  })

  const holders: { name: string; raw: unknown; decoded: ClaudishViewer }[] = [
    { name: 'null', raw: null, decoded: { kind: 'nobody' } },
    { name: 'claude_code', raw: HERE, decoded: { kind: 'here' } },
    ...['herdr', 'herdr_app', 'terminal', 'claude_code_other', 'future_viewer'].map(name => ({
      name, raw: holder(name, 'Named window'), decoded: { kind: 'elsewhere' as const, label: 'Named window' },
    })),
  ]
  for (const kind of LIVE_KINDS) {
    for (const c of holders) {
      test('TEST-3 REQ-2 REQ-3 REQ-4 REQ-8: ' + kind + ' draws and polls correctly for ' + c.name + ' [' + surface + ']', async ($, on) => {
        const w = world(on)
        let v: Views | undefined
        try {
          const ready = await prepare($, w, surface, kind)
          v = ready.v
          const t = ready.t
          w.views.set(t.key, c.raw)
          const boundary = w.h.fake.calls.length
          await nextPoll(w, t.feed)
          expect(pane(w).viewer).toEqual(c.decoded)
          expect(ownResizes(w, t, boundary)).toEqual([])
          if (c.decoded.kind === 'elsewhere') {
            await collapsed(w, v, c.decoded.label)
            const after = w.h.fake.calls.length
            await nextPoll(w, t.feed)
            expect(ownCaptures(w, t, boundary)).toEqual([])
            expect(ownTranscripts(w, t, boundary)).toEqual([])
            expect(ownResizes(w, t, after)).toEqual([])
          } else {
            await noBand(v)
            expect(ownCaptures(w, t, boundary).length).toBeGreaterThan(0)
            expect(visibleText(await v.p.drawn())).toContain('SCREEN ' + t.model)
          }
          await v.b.redraw()
          expect(visibleText(await bandRow(v.b, t.model))).toContain(' RUN ')
          expect((await v.p.findAll({ type: 'Button' })).some(b => b.props.label === t.model)).toBe(true)
          noWireStored(w)
        } finally { await dispose($, w, v) }
      })
    }

    test('TEST-4 REQ-3 REQ-4: first capable ' + kind + ' list collapses before any capture [' + surface + ']', async ($, on) => {
      const w = world(on)
      w.defaultView = AWAY
      let b: Mounted | undefined
      try {
        await start($, surface)
        const t = (await create($, w, kind))[0]!
        expect(w.h.fake.listCalls(t.feed).length).toBeGreaterThan(0)
        expect(w.h.fake.listCalls(t.feed).map(wire).every(c => JSON.stringify(c) === JSON.stringify(listWire(t.feed)))).toBe(true)
        expect(ownCaptures(w, t)).toEqual([])
        expect(ownTranscripts(w, t)).toEqual([])
        expect(ownResizes(w, t)).toEqual([])
        b = await mountBand($, surface, bandProps(240, 60))
        const row = await bandRow(b, t.model)
        expect(visibleText(row)).toContain(' RUN ')
        expect(visibleText(row)).toContain('Show')
      } finally { if (b) await b.unmount(); await dispose($, w) }
    })
  }

  const labels: { name: string; raw: unknown; exact?: string }[] = [
    { name: '40 characters', raw: holder('herdr', 'L'.repeat(40)), exact: 'L'.repeat(40) },
    { name: '41 characters', raw: holder('herdr', 'L'.repeat(41)) },
    { name: 'ANSI and control characters', raw: holder('herdr', '\u001b[31mHerdr\u001b[0m\nWindow\tA') },
    { name: 'missing label', raw: { holder: 'herdr' }, exact: 'another window' },
    { name: 'empty label', raw: holder('herdr', ''), exact: 'another window' },
    { name: 'whitespace label', raw: holder('herdr', ' \n\t '), exact: 'another window' },
  ]
  for (const c of labels) {
    test('TEST-5 REQ-2 REQ-3: ' + c.name + ' yields a usable safe band [' + surface + ']', async ($, on) => {
      const w = world(on)
      let v: Views | undefined
      try {
        const ready = await prepare($, w, surface, 'session')
        v = ready.v
        w.views.set(ready.t.key, c.raw)
        await nextPoll(w, 'sessions')
        const viewer = pane(w).viewer
        expect(viewer?.kind).toBe('elsewhere')
        if (viewer?.kind !== 'elsewhere') throw new Error('foreign string holder was discarded')
        expect(viewer.label.trim().length).toBeGreaterThan(0)
        expect(viewer.label.length).toBeLessThanOrEqual(40)
        expect(viewer.label).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
        expect(viewer.label).not.toContain('[31m')
        if (c.exact !== undefined) expect(viewer.label).toBe(c.exact)
        if (c.name === 'ANSI and control characters') expect(viewer.label).toContain('Herdr')
        await collapsed(w, v, viewer.label)
        noWireStored(w)
      } finally { await dispose($, w, v) }
    })
  }

  const malformed = [
    { name: 'omitted row key', raw: OMIT }, { name: 'boolean', raw: false },
    { name: 'string', raw: 'herdr' }, { name: 'array', raw: [] },
    { name: 'empty object', raw: {} }, { name: 'numeric holder', raw: { holder: 42 } },
    { name: 'null holder', raw: { holder: null } },
  ]
  for (const c of malformed) {
    test('TEST-6 REQ-2 REQ-6 REQ-8: ' + c.name + ' becomes nobody without claiming [' + surface + ']', async ($, on) => {
      const w = world(on)
      let v: Views | undefined
      try {
        const ready = await prepare($, w, surface, 'session')
        v = ready.v
        await collapse(w, v, ready.t)
        const boundary = w.h.fake.calls.length
        w.views.set(ready.t.key, c.raw)
        await nextPoll(w, 'sessions')
        expect(pane(w).viewer).toEqual({ kind: 'nobody' })
        await noBand(v)
        expect(ownResizes(w, ready.t, boundary)).toEqual([])
        expect(ownCaptures(w, ready.t, boundary).length).toBeGreaterThan(0)
      } finally { await dispose($, w, v) }
    })
  }

  for (const kind of LIVE_KINDS) {
    test('TEST-7 REQ-3 REQ-4: ' + kind + ' collapse replaces Text and stops transcript reads [' + surface + ']', async ($, on) => {
      const w = world(on)
      let v: Views | undefined
      try {
        const ready = await prepare($, w, surface, kind)
        v = ready.v
        await press(v.p, 'Text')
        await until(w, () => ownTranscripts(w, ready.t).length > 0, 'Text body read')
        await v.p.redraw()
        expect(visibleText(await v.p.drawn())).toContain('TEXT ' + ready.t.model)
        await collapse(w, v, ready.t)
        const boundary = w.h.fake.calls.length
        await nextPoll(w, ready.t.feed)
        await nextPoll(w, ready.t.feed)
        await v.p.redraw()
        await collapsed(w, v)
        expect(ownCaptures(w, ready.t, boundary)).toEqual([])
        expect(ownTranscripts(w, ready.t, boundary)).toEqual([])
        expect(ownResizes(w, ready.t, boundary)).toEqual([])
      } finally { await dispose($, w, v) }
    })
  }

  for (const kind of KINDS) {
    for (const grant of [{ name: 'here', raw: HERE }, { name: 'nobody', raw: null }, { name: 'no answer key', raw: OMIT }]) {
      test('TEST-8 REQ-5 REQ-8: ' + kind + ' band press claims unchanged size on ' + grant.name + ' grant [' + surface + ']', async ($, on) => {
        const w = world(on)
        let v: Views | undefined
        try {
          const ready = await prepare($, w, surface, kind)
          v = ready.v
          const t = ready.t
          const measured = ready.size
          expect(measured).toEqual({ cols: 136, rows: 40 })
          await collapse(w, v, t)
          w.resizeView = grant.raw
          const boundary = w.h.fake.calls.length
          await press(v.p, 'viewing in Herdr window')
          await immediateClaim(w, t, boundary, measured)

          // A prompt list refresh is allowed; the grant must still resize exactly
          // once and resume capture promptly after that resize (immediateClaim).
          await noBand(v)
          expect(pane(w).claimNote).toBeUndefined()
          expect(pane(w).viewer).toEqual(grant.raw === null ? { kind: 'nobody' } : { kind: 'here' })
        } finally { await dispose($, w, v) }
      })
    }

    for (const outcome of ['failed', 'elsewhere', 'gone'] as const) {
      const testId = outcome === 'failed' ? 9 : outcome === 'elsewhere' ? 10 : 11
      test('TEST-' + testId + ' REQ-5 REQ-8 REQ-9: ' + kind + ' ' + outcome + ' press answer is handled visibly [' + surface + ']', async ($, on) => {
        const w = world(on)
        let v: Views | undefined
        try {
          const ready = await prepare($, w, surface, kind)
          v = ready.v
          const t = ready.t
          await collapse(w, v, t)
          w.resizeOverride = (c, target) => {
            if (!callsFor(c, t)) return undefined
            if (outcome === 'failed') return { text: contractError('resize_unsupported', 'pane cannot resize'), isError: true }
            if (outcome === 'gone') {
              w.missing.add(target.key)
              return { text: contractError(t.kind === 'team' ? 'unknown_slot' : 'unknown_session', 'not retained'), isError: true }
            }
            w.views.set(target.key, holder('claude_code_other', 'Other Claude'))
            return answer({ cols: c.args.cols, rows: c.args.rows, changed: false, view: getView(w, target.key) })
          }
          const boundary = w.h.fake.calls.length

          await press(v.p, 'viewing in Herdr window')
          await w.h.clock.settle()

          expect(ownResizes(w, t, boundary).map(wire)).toEqual([resizeWire(t, 136, 40)])
          expect(ownCaptures(w, t, boundary)).toEqual([])
          if (outcome === 'gone') {
            await noBand(v)
            if (kind !== 'replay') expect(pane(w).status).toBe('ended')
            else {
              await until(w, () => w.h.fake.transcriptCalls().some(c => c.args.session_id === t.slot), 'gone replay falls back to its original transcript')
              await v.p.redraw()
              expect(visibleText(await v.p.drawn())).toContain('TEXT ')
            }
            const count = ownCaptures(w, t).length
            await w.h.clock.advance(10_000)
            expect(ownCaptures(w, t)).toHaveLength(count)
          } else {
            const label = outcome === 'failed' ? 'Herdr window' : 'Other Claude'
            await collapsed(w, v, label)
            const reason = outcome === 'failed' ? 'resize_unsupported' : 'claudish left the view with Other Claude'
            expect(visibleText(await v.p.drawn())).toContain('Could not take the view: ' + reason)
            const after = w.h.fake.calls.length
            // Redraw alone must neither retry the claim nor fetch content.
            await v.p.redraw()
            await w.h.clock.settle()
            expect(ownResizes(w, t, after)).toEqual([])
            expect(ownCaptures(w, t, after)).toEqual([])
          }
        } finally { await dispose($, w, v) }
      })
    }
  }

  test('TEST-12 REQ-4 REQ-8 REQ-9: collapsed replay captures exactly once per list poll with the last seq [' + surface + ']', async ($, on) => {
    const w = world(on)
    let v: Views | undefined
    try {
      const ready = await prepare($, w, surface, 'replay')
      v = ready.v
      await collapse(w, v, ready.t)
      await nextPoll(w, 'runs')
      const boundary = w.h.fake.calls.length
      for (let i = 0; i < 4; i++) {
        await v.p.redraw()
        await nextPoll(w, 'runs')
        await v.p.redraw()
      }
      const lists = w.h.fake.calls.slice(boundary).filter(c => c.tool === 'team' && c.args.mode === 'list')
      const captures = ownCaptures(w, ready.t, boundary)
      expect(lists).toHaveLength(4)
      expect(lists.map(wire)).toEqual(Array.from({ length: 4 }, () => listWire('runs')))
      expect(captures.map(wire)).toEqual(Array.from({ length: 4 }, () => captureWire(ready.t, SEQ)))
      for (let i = 0; i < lists.length; i++) {
        const afterList = w.h.fake.calls.indexOf(lists[i]!)
        const beforeNext = i + 1 < lists.length ? w.h.fake.calls.indexOf(lists[i + 1]!) : w.h.fake.calls.length
        expect(w.h.fake.calls.slice(afterList + 1, beforeNext).filter(c => callsFor(c, ready.t) && c.tool === 'capture_session')).toHaveLength(1)
      }
      expect(w.h.fake.transcriptCalls().filter(c => w.h.fake.calls.indexOf(c) >= boundary)).toEqual([])
      await collapsed(w, v)
      const replayId = ready.t.token
      expect(replays(w)[active(w)]?.replayId).toBe(replayId)
    } finally { await dispose($, w, v) }
  })

  for (const kind of LIVE_KINDS) {
    test('TEST-13 REQ-6 REQ-8: ' + kind + ' list changes collapse then expand without a passive claim [' + surface + ']', async ($, on) => {
      const w = world(on)
      let v: Views | undefined
      try {
        const ready = await prepare($, w, surface, kind)
        v = ready.v
        const boundary = w.h.fake.calls.length
        await collapse(w, v, ready.t)
        w.views.set(ready.t.key, null)
        await nextPoll(w, ready.t.feed)
        await noBand(v)
        expect(pane(w).viewer).toEqual({ kind: 'nobody' })
        expect(ownCaptures(w, ready.t, boundary).length).toBeGreaterThan(0)
        expect(ownResizes(w, ready.t, boundary)).toEqual([])
      } finally { await dispose($, w, v) }
    })

    for (const shape of ['frame', 'unchanged'] as const) {
      test('TEST-14 REQ-2 REQ-4 REQ-8: ' + kind + ' ' + shape + ' capture can collapse its own panel [' + surface + ']', async ($, on) => {
        const w = world(on)
        let v: Views | undefined
        try {
          const ready = await prepare($, w, surface, kind)
          v = ready.v
          const t = ready.t
          let answered: Recorded | undefined
          w.captureOverride = (c, target) => {
            if (!callsFor(c, t)) return undefined
            answered = c
            w.views.set(target.key, AWAY)
            return answer(frameBody(target, AWAY, shape))
          }
          await until(w, () => Boolean(answered), 'next ' + shape + ' capture reports foreign ownership')
          await collapsed(w, v)
          expect(wire(answered!)).toEqual(captureWire(t, answered!.args.since_seq))
          const boundary = w.h.fake.calls.length
          await nextPoll(w, t.feed)
          await nextPoll(w, t.feed)
          expect(ownCaptures(w, t, boundary)).toEqual([])
          expect(ownTranscripts(w, t, boundary)).toEqual([])
          expect(ownResizes(w, t, boundary)).toEqual([])
        } finally { await dispose($, w, v) }
      })
    }

    test('TEST-15 REQ-6 REQ-8: shown own-held ' + kind + ' size-change resize can transfer the view [' + surface + ']', async ($, on) => {
      const w = world(on)
      let v: Views | undefined
      try {
        const ready = await prepare($, w, surface, kind)
        v = ready.v
        w.resizeView = holder('terminal', 'Terminal window')
        const boundary = w.h.fake.calls.length
        await v.p.redraw(paneProps(145, 49))
        await until(w, () => ownResizes(w, ready.t, boundary).length > 0, 'shown size change sends resize')
        expect(ownResizes(w, ready.t, boundary).map(wire)).toEqual([resizeWire(ready.t, 145, 46)])
        await collapsed(w, v, 'Terminal window')
        const after = w.h.fake.calls.length
        await nextPoll(w, ready.t.feed)
        expect(ownCaptures(w, ready.t, after)).toEqual([])
      } finally { await dispose($, w, v) }
    })
  }

  for (const c of [
    { name: 'null', raw: null, away: false }, { name: 'here', raw: HERE, away: false },
    { name: 'herdr', raw: AWAY, away: true },
    { name: 'claude_code_other', raw: holder('claude_code_other', 'Herdr window'), away: true },
    { name: 'unknown', raw: holder('future_viewer', 'Herdr window'), away: true },
  ]) {
    test('TEST-16 REQ-2 REQ-3 REQ-8: replay-open with ' + c.name + ' refreshes the panel [' + surface + ']', async ($, on) => {
      const w = world(on)
      w.replaySupport = true
      w.openView = c.raw
      let v: Views | undefined
      try {
        await start($, surface)
        const anchor = (await create($, w, 'team'))[0]!
        w.views.set(anchor.key, AWAY)
        const original = (await create($, w, 'session'))[0]!
        end(w, original)
        await nextPoll(w, 'sessions')
        v = await open($, w, surface, original)
        await until(w, () => Boolean(replays(w)[active(w)]), 'replay-open answer stored')
        const replayId = replays(w)[active(w)]!.replayId
        const t = { ...original, kind: 'replay' as const, key: replayId, token: replayId, address: replayId }
        const opens = w.h.fake.replayOpenCalls()
        expect(opens).toHaveLength(1)
        const sent = opens[0]!
        const { cols, rows, ...address } = sent.args
        expect(wire({ ...sent, args: address })).toEqual({
          server: SERVER, tool: 'replay_session', args: { session_id: original.token },
        })
        if (cols !== undefined) expect(Number.isFinite(cols)).toBe(true)
        if (rows !== undefined) expect(Number.isFinite(rows)).toBe(true)
        if (c.away) {
          await collapsed(w, v)
          const boundary = w.h.fake.calls.length
          await nextPoll(w, 'runs')
          const capture = ownCaptures(w, t, boundary)[0]
          expect(capture, 'collapsed replay-open keeps its one tick capture').toBeDefined()
          expect([0, SEQ]).toContain(capture!.args.since_seq)
          expect(ownCaptures(w, t, boundary).map(wire)).toEqual([captureWire(t, capture!.args.since_seq)])
          expect(ownTranscripts(w, original, boundary)).toEqual([])
        } else {
          await until(w, () => ownCaptures(w, t).length > 0, 'normal replay captures')
          await noBand(v)
          expect(pane(w).viewer).toEqual(c.raw === null ? { kind: 'nobody' } : { kind: 'here' })
          expect(visibleText(await v.p.drawn())).toContain('REPLAY ' + original.model)
        }
        noWireStored(w)
      } finally { await dispose($, w, v) }
    })
  }

  for (const raw of [HERE, null]) {
    test('TEST-17 REQ-6 REQ-8: collapsed replay unchanged capture expands on ' + (raw === null ? 'null' : 'here') + ' [' + surface + ']', async ($, on) => {
      const w = world(on)
      let v: Views | undefined
      try {
        const ready = await prepare($, w, surface, 'replay')
        v = ready.v
        await collapse(w, v, ready.t)
        w.views.set(ready.t.key, raw)
        const boundary = w.h.fake.calls.length
        await nextPoll(w, 'runs')
        await noBand(v)
        expect(pane(w).viewer).toEqual(raw === null ? { kind: 'nobody' } : { kind: 'here' })
        expect(ownCaptures(w, ready.t, boundary)[0] && wire(ownCaptures(w, ready.t, boundary)[0]!)).toEqual(captureWire(ready.t, SEQ))
        expect(ownResizes(w, ready.t, boundary)).toEqual([])
        const after = ownCaptures(w, ready.t).length
        await until(w, () => ownCaptures(w, ready.t).length > after, 'expanded replay resumes ordinary captures')
      } finally { await dispose($, w, v) }
    })
  }

  for (const kind of LIVE_KINDS) {
    test('TEST-18 REQ-6: background fitting never claims hidden or unshown null/foreign ' + kind + ' items [' + surface + ']', async ($, on) => {
      const w = world(on)
      w.defaultView = null
      w.views.set(kind === 'team' ? '01' : 'view-session-1', HERE)
      w.views.set(kind === 'team' ? '03' : 'view-session-3', AWAY)
      let v: Views | undefined
      try {
        await start($, surface)
        const list = await create($, w, kind, 3)
        const shown = list[0]!
        for (const t of list.slice(1)) expect(ownResizes(w, t)).toEqual([])
        v = await open($, w, surface, shown)
        await until(w, () => ownResizes(w, shown).some(c => c.args.cols === 136), 'shown own-held item fits')
        const boundary = w.h.fake.calls.length
        await v.p.redraw(paneProps(145, 49))
        await until(w, () => ownResizes(w, shown, boundary).length > 0, 'shown own-held item resizes')
        expect(ownResizes(w, shown, boundary).map(wire)).toEqual([resizeWire(shown, 145, 46)])
        for (const t of list.slice(1)) expect(ownResizes(w, t)).toEqual([])

        await press(v.p, 'Hide')
        const hidden = w.h.fake.calls.length
        await v.p.redraw(paneProps(151, 52))
        await nextPoll(w, shown.feed)
        await nextPoll(w, shown.feed)
        for (const t of list) expect(ownResizes(w, t, hidden)).toEqual([])
      } finally { await dispose($, w, v) }
    })

    test('TEST-19 REQ-5 REQ-6: Show and tab expansion always resize ' + kind + ' even at the unchanged dock size [' + surface + ']', async ($, on) => {
      const w = world(on)
      w.defaultView = null
      let v: Views | undefined
      try {
        await start($, surface)
        const list = await create($, w, kind, 2)
        v = await open($, w, surface, list[0]!)
        await until(w, () => ownResizes(w, list[0]!).some(c => c.args.cols === 136 && c.args.rows === 40), 'first shown tab measured')
        await w.h.clock.advance(2_000)
        for (const t of [list[1]!, list[0]!]) {
          const boundary = w.h.fake.calls.length
          await press(v.p, t.model)
          await immediateClaim(w, t, boundary, { cols: 136, rows: 40 })
          await noBand(v)
        }
        await press(v.p, 'Hide')
        await v.b.redraw()
        const boundary = w.h.fake.calls.length
        await pressChip(v.b, list[0]!.model, 'Show')
        await v.p.redraw()
        await immediateClaim(w, list[0]!, boundary, { cols: 136, rows: 40 })
      } finally { await dispose($, w, v) }
    })

    test('TEST-20 REQ-7: an older ' + kind + ' list cannot re-collapse after a successful band press [' + surface + ']', async ($, on) => {
      const w = world(on)
      const held = gate()
      let v: Views | undefined
      try {
        const ready = await prepare($, w, surface, kind)
        v = ready.v
        await collapse(w, v, ready.t)
        w.nextListGate = { feed: ready.t.feed, gate: held }
        await until(w, () => held.sent, 'foreign-holder list was sent before the press')
        const boundary = w.h.fake.calls.length
        await press(v.p, 'viewing in Herdr window')
        await w.h.clock.settle()
        expect(ownResizes(w, ready.t, boundary).map(wire)).toEqual([resizeWire(ready.t, 136, 40)])
        expect(pane(w).viewer).toEqual({ kind: 'here' })
        const grantedWrites = w.h.writes.length
        const paneKey = 'panes/' + active(w)

        held.release()
        await w.h.clock.settle()

        expect(w.h.writes.slice(grantedWrites).filter(([key, value]) =>
          key === paneKey && (value as ClaudishPaneView | null)?.viewer?.kind === 'elsewhere'),
        'even a transient foreign-view write would re-collapse the granted tab').toEqual([])
        expect(pane(w).viewer).toEqual({ kind: 'here' })
        await noBand(v)
        expect(pane(w).claimNote).toBeUndefined()
        await nextPoll(w, ready.t.feed)
        await noBand(v)
      } finally { held.release(); await w.h.clock.settle(); await dispose($, w, v) }
    })

    for (const state of ['COMPLETED', 'FAILED']) {
      test('TEST-21 REQ-4 REQ-9: collapsed ' + kind + ' ' + state + ' ends normally and cannot sustain polling [' + surface + ']', async ($, on) => {
        const w = world(on)
        let v: Views | undefined
        try {
          const ready = await prepare($, w, surface, kind)
          v = ready.v
          await collapse(w, v, ready.t)
          end(w, ready.t, state)
          await nextPoll(w, ready.t.feed)
          await until(w, () => pane(w).status === 'ended', 'terminal collapsed item ends')
          await noBand(v)
          await v.b.redraw()
          expect(visibleText(await bandRow(v.b, ready.t.model))).toContain(state === 'FAILED' ? ' ERR ' : ' END ')
          expect(w.h.fake.replayOpenCalls()).toEqual([])
          await w.h.clock.advance(30_000)
          const boundary = w.h.fake.calls.length
          await w.h.clock.advance(60_000)
          expect(w.h.fake.calls.slice(boundary).filter(c =>
            c.tool !== 'allowance_status')).toEqual([])
        } finally { await dispose($, w, v) }
      })
    }
  }

  for (const shape of ['frame', 'unchanged'] as const) {
    test('TEST-22 REQ-8 REQ-9: a collapsed replay ' + shape + ' with final true ends without keeping the loop alive [' + surface + ']', async ($, on) => {
      const w = world(on)
      let v: Views | undefined
      try {
        const ready = await prepare($, w, surface, 'replay')
        v = ready.v
        await collapse(w, v, ready.t)
        end(w, ready.anchor!)
        let finalCall: Recorded | undefined
        w.captureOverride = (c, t) => {
          if (!callsFor(c, ready.t)) return undefined
          finalCall = c
          return answer(frameBody(t, AWAY, shape, true))
        }
        await until(w, () => Boolean(finalCall), 'collapsed replay still polled without another live run')
        expect(wire(finalCall!)).toEqual(captureWire(ready.t, SEQ))
        await noBand(v)
        await w.h.clock.settle()
        await v.p.redraw()
        expect(visibleText(await v.p.drawn())).toContain('TEXT ')
        const count = ownCaptures(w, ready.t).length
        await w.h.clock.advance(30_000)
        expect(ownCaptures(w, ready.t)).toHaveLength(count)
        const boundary = w.h.fake.calls.length
        await w.h.clock.advance(60_000)
        expect(w.h.fake.calls.slice(boundary).filter(c => c.tool !== 'allowance_status')).toEqual([])
      } finally { await dispose($, w, v) }
    })
  }

  for (const kind of LIVE_KINDS) {
    test('TEST-23 REQ-6 REQ-8: a ten-second null claim lapse leaves ' + kind + ' expanded without reclaiming [' + surface + ']', async ($, on) => {
      const w = world(on)
      let v: Views | undefined
      try {
        const ready = await prepare($, w, surface, kind)
        v = ready.v
        const at = w.h.clock.now() + 10_000
        const boundary = w.h.fake.calls.length
        w.captureOverride = (c, t) => {
          if (!callsFor(c, ready.t)) return undefined
          const raw = w.h.clock.now() < at ? HERE : null
          w.views.set(t.key, raw)
          return answer(frameBody(t, raw, c.args.since_seq === SEQ ? 'unchanged' : 'frame'))
        }
        await until(w, () => w.h.clock.now() >= at && pane(w).viewer?.kind === 'nobody', 'server reports expired claim', 12_000)
        await noBand(v)
        expect(visibleText(await v.p.drawn())).toContain('SCREEN ' + ready.t.model)
        expect(ownResizes(w, ready.t, boundary)).toEqual([])
        const count = ownCaptures(w, ready.t).length
        await nextPoll(w, ready.t.feed)
        expect(ownCaptures(w, ready.t).length).toBeGreaterThan(count)
      } finally { await dispose($, w, v) }
    })

    for (const shape of ['frame', 'unchanged'] as const) {
      test('TEST-24 REQ-2 REQ-8: ' + kind + ' ' + shape + ' without a view key preserves ownership [' + surface + ']', async ($, on) => {
        const w = world(on)
        let v: Views | undefined
        try {
          const ready = await prepare($, w, surface, kind)
          v = ready.v
          let answered = false
          w.captureOverride = (c, t) => {
            if (!callsFor(c, ready.t)) return undefined
            answered = true
            return answer(frameBody(t, OMIT, shape))
          }
          const boundary = w.h.fake.calls.length
          await until(w, () => answered, 'keyless capture answer')
          expect(pane(w).viewer).toEqual({ kind: 'here' })
          await noBand(v)
          expect(ownResizes(w, ready.t, boundary)).toEqual([])
        } finally { await dispose($, w, v) }
      })
    }
  }

  test('TEST-24 REQ-2 REQ-8: collapsed replay unchanged answer without view is no ownership signal [' + surface + ']', async ($, on) => {
    const w = world(on)
    let v: Views | undefined
    try {
      const ready = await prepare($, w, surface, 'replay')
      v = ready.v
      await collapse(w, v, ready.t)
      w.captureViews.set(ready.t.key, OMIT)
      const boundary = w.h.fake.calls.length
      await nextPoll(w, 'runs')
      expect(ownCaptures(w, ready.t, boundary).map(wire)).toEqual([captureWire(ready.t, SEQ)])
      expect(pane(w).viewer).toEqual({ kind: 'elsewhere', label: 'Herdr window' })
      await collapsed(w, v)
      expect(ownResizes(w, ready.t, boundary)).toEqual([])
    } finally { await dispose($, w, v) }
  })

  test('TEST-25 REQ-3 REQ-4: collapsed replay band replaces a saved Text mode too [' + surface + ']', async ($, on) => {
    const w = world(on)
    let v: Views | undefined
    try {
      const ready = await prepare($, w, surface, 'replay')
      v = ready.v
      await collapse(w, v, ready.t)
      w.forceTextTab = active(w)
      await v.p.redraw()
      await collapsed(w, v)
      const boundary = w.h.fake.calls.length
      await nextPoll(w, 'runs')
      await collapsed(w, v)
      expect(ownCaptures(w, ready.t, boundary).map(wire)).toEqual([captureWire(ready.t, SEQ)])
      expect(w.h.fake.transcriptCalls().filter(c => w.h.fake.calls.indexOf(c) >= boundary)).toEqual([])
    } finally { await dispose($, w, v) }
  })
}
