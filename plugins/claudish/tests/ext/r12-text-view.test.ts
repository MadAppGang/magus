// T1–T6, MTL-373: written from the spec and public contracts, without implementation reads.
// Run with claude plugin test, not standalone bun test. TEST/REQ ids map to the QA plan.
// Assertions observe public source results, external MCP requests, drawn text and engine scrolls.

import type { McpToolResult, On, UiScrollInput, UiScrollResult } from 'claude-code'
import { expect, type Engine } from 'claude-code/testing'
import { test } from '../kit'
import type { ClaudishPaneView, ClaudishRunRef, ClaudishRuns, ClaudishShowTab } from '../../types'
import type { Cell, Host, Store } from '../../hooks/status/host'
import { refresh, resetText, textOf as tabText } from '../../hooks/status/transcript'
import { makeClaudishSource, type McpCall } from '../../hooks/status/claudish-source'
import {
  CWD, CREATE_TOOL, SERVERS, harness, start,
  type FakeOptions, type Harness, type ListOverride, type Recorded,
} from '../fake-claudish'
import { contractError } from '../scenario'
import {
  bandProps, mountBand, mountPane, paneProps, SURFACES, walk,
  type Mounted, type Node, type Surface,
} from '../ui'
import { children as nodeChildren, modelCall, POLL, team } from './support'
import { pressChip, visibleText } from './v2-support'

// SHOW_PANE_ID's published value, not an implementation import.
const SHOW = 'claudish-show'
const TEXT_POLL = 2_000 // T4.4's specified interval, deliberately not imported from production.
const KINDS = ['panel', 'delegation'] as const
type Kind = typeof KINDS[number]
type Wire = Pick<Recorded, 'server' | 'tool' | 'args'>
type Line = { kind: string; text: string; cont?: boolean }
type Child = { ref: ClaudishRunRef; slot: string; model: string }
const wire = ({ server, tool, args }: Recorded): Wire => ({ server, tool, args })
const reply = (body: unknown, isError = false): McpToolResult => ({
  content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }], isError,
})
const page = (cursor: string, lines: Line[] = [], more = false, final = false): ListOverride => ({
  text: JSON.stringify({ cursor, lines, more, final }),
})
const line = (text: string, kind = 'assistant', cont?: boolean): Line => ({
  kind, text, ...(cont === undefined ? {} : { cont }),
})

function refFor(id: string, kind: Kind, server: string = SERVERS[0]): ClaudishRunRef {
  return { kind, server, token: id, address: kind === 'panel' ? CWD + '/' + id : id }
}
function transcriptRequest(ref: ClaudishRunRef, slot: string, since: string | null): Wire {
  const cursor = since === null ? {} : { since }
  return ref.kind === 'panel'
    ? { server: ref.server, tool: 'team', args: { mode: 'transcript', path: ref.address, slot, run_id: ref.token, ...cursor } }
    : { server: ref.server, tool: 'transcript_session', args: { session_id: ref.token, ...cursor } }
}
function scrollRequest(child: Child, move: { by: number } | { to: 'end' }): Wire {
  return child.ref.kind === 'panel'
    ? { server: child.ref.server, tool: 'team', args: {
      mode: 'scroll', path: child.ref.address, slot: child.slot, run_id: child.ref.token, ...move,
    } }
    : { server: child.ref.server, tool: 'scroll_session', args: { session_id: child.ref.token, ...move } }
}
// The permitted public adapter seam; this records the wire boundary, not private helper calls.
function adapter(answer: McpToolResult | Error) {
  const sent: Wire[] = []
  const call: McpCall = async (server, tool, args) => {
    sent.push({ server, tool, args })
    if (answer instanceof Error) throw answer
    return answer
  }
  return { source: makeClaudishSource(call), sent }
}

for (const kind of KINDS) {
  for (const rich of [false, true]) for (const announced of [false, true]) {
    // REQ-1, REQ-2
    test('T1.1 T1.2 TEST-1: ' + kind + ' rich=' + rich + ' transcript=' + announced + ' preserves the feature shape', async () => {
      const id = 'r12-cap-' + kind + '-' + rich + '-' + announced
      const capabilities = ['list', ...(rich ? [
        'status', 'cancel', 'capture', 'capture_since_seq', 'capture_spans', 'resize', 'scroll', 'allowance',
      ] : []), ...(announced ? ['transcript'] : [])]
      const { source } = adapter(reply({ contract_version: 1, capabilities, runs: [], sessions: [] }))

      const feed = (await source.poll([{ id, ref: refFor(id, kind) }])).feeds.get(SERVERS[0] + '#' + kind)

      expect(feed).toEqual({ kind: 'speaks', version: 1, can: {
        cancel: rich, capture: rich, spans: rich, resize: rich,
        ...(rich ? { scroll: true, allowance: true } : {}),
        ...(announced ? { transcript: true } : {}),
      } })
      if (feed?.kind !== 'speaks') throw new Error('expected a speaking feed')
      expect(Object.prototype.hasOwnProperty.call(feed.can, 'transcript')).toBe(announced)
    })
  }

  for (const server of SERVERS) for (const since of [null, '0', 'older:/+=='] as const) {
    // REQ-3, REQ-4, REQ-11
    test('T2.1 T2.2 T4.1 TEST-2: ' + kind + ' on ' + server + ' passes ' + JSON.stringify(since) + ' exactly', async () => {
      const ref = refFor('r12-wire-' + kind + '-' + server + '-' + String(since), kind, server)
      const slot = kind === 'panel' ? '02' : ref.token
      const identity = kind === 'panel'
        ? { run_id: ref.token, path: ref.address, slot }
        : { session_id: ref.token }
      const { source, sent } = adapter(reply({
        ...identity, cursor: 'next:opaque/+==', lines: [{ kind: 'assistant', text: 'answer' }], more: false, final: true,
      }))

      expect(await source.transcript(ref, slot, since)).toEqual({
        kind: 'lines', cursor: 'next:opaque/+==',
        lines: [{ kind: 'assistant', text: 'answer', cont: false }], more: false, final: true,
      })
      expect(sent).toEqual([transcriptRequest(ref, slot, since)])
    })
  }

  for (const more of [false, true]) for (const final of [false, true]) {
    // REQ-5
    test('T2.3 TEST-3: ' + kind + ' skips malformed lines and preserves more=' + more + ' final=' + final, async () => {
      const ref = refFor('r12-lines-' + kind + '-' + more + '-' + final, kind)
      const { source } = adapter(reply({ cursor: 'opaque', more, final, lines: [
        { kind: 'user', text: 'first' }, null, 17, 'not a line', {},
        { kind: 'assistant' }, { text: 'no kind' }, { kind: 7, text: 'bad kind' },
        { kind: 'tool', text: false }, { kind: 'assistant', text: 'part', cont: true },
        { kind: 'future_kind', text: 'still visible', cont: false }, { kind: 'assistant', text: '' },
      ] }))

      expect(await source.transcript(ref, '02', null)).toEqual({
        kind: 'lines', cursor: 'opaque', more, final, lines: [
          { kind: 'user', text: 'first', cont: false },
          { kind: 'assistant', text: 'part', cont: true },
          { kind: 'future_kind', text: 'still visible', cont: false },
          { kind: 'assistant', text: '', cont: false },
        ],
      })
    })
  }

  // REQ-6
  test('T2.4 TEST-4: ' + kind + ' removes controls without flattening newlines or ordinary spaces', async () => {
    const ref = refFor('r12-sanitize-' + kind, kind)
    const { source } = adapter(reply({ cursor: 'clean', more: false, final: false, lines: [{
      kind: 'assistant', text: 'A\u0000\u0001\u0007\u0008\u000b\u000c\u000d\u001b\u001f\u007f\u0080\u009fB\tC\n  D\t\tE',
    }] }))

    expect(await source.transcript(ref, '02', null)).toEqual({
      kind: 'lines', cursor: 'clean', more: false, final: false,
      lines: [{ kind: 'assistant', text: 'AB  C\n  D    E', cont: false }],
    })
  })

  for (const code of ['unknown_session', 'unknown_run', 'unknown_slot']) {
    // REQ-7
    test('T2.5 TEST-5: ' + kind + ' maps ' + code + ' to gone', async () => {
      const { source } = adapter(reply(contractError(code, 'not retained'), true))
      expect(await source.transcript(refFor('r12-gone-source-' + kind + '-' + code, kind), '02', null)).toEqual({ kind: 'gone' })
    })
  }
  const failures: { name: string; answer: McpToolResult | Error }[] = [
    { name: 'invalid_args', answer: reply(contractError('invalid_args', 'invalid cursor'), true) },
    { name: 'other contract error', answer: reply(contractError('busy', 'try later'), true) },
    { name: 'plain error', answer: reply('transcript refused', true) },
    { name: 'isError with valid body', answer: reply({ cursor: 'x', lines: [], more: false, final: false }, true) },
    { name: 'transport rejection', answer: new Error('transport closed') },
    { name: 'non JSON', answer: reply('not JSON') },
    { name: 'null', answer: reply('null') },
    { name: 'array', answer: reply('[]') },
    { name: 'empty content', answer: { content: [], isError: false } },
    { name: 'missing cursor', answer: reply({ lines: [], more: false, final: false }) },
    { name: 'missing lines', answer: reply({ cursor: 'x', more: false, final: false }) },
    { name: 'null lines', answer: reply({ cursor: 'x', lines: null, more: false, final: false }) },
    { name: 'object lines', answer: reply({ cursor: 'x', lines: {}, more: false, final: false }) },
  ]
  for (const [i, c] of failures.entries()) {
    // REQ-7
    test('T2.5 TEST-6: ' + kind + ' ' + c.name + ' fails with a diagnostic rather than throwing', async () => {
      const { source } = adapter(c.answer)

      const result = await source.transcript(refFor('r12-failure-' + kind + '-' + i, kind), '02', null)

      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error('expected failed, got ' + JSON.stringify(result))
      expect(typeof result.reason).toBe('string')
      expect(result.reason.trim().length).toBeGreaterThan(0)
    })
  }
}

const ENGINE_RESULT: UiScrollResult = { deny: 'R12 downstream window received this person scroll' }
function world(on: On, id: string, options: FakeOptions = {}) {
  const h = harness(on, {
    listTranscript: true, listScroll: true, noResize: true,
    sessionId: n => id + '-session-' + n,
    frame: ({ model, seq, final }) => ({
      seq, final, cols: 120, rows: 2, cursor: null, lines: ['SCREEN ' + model, 'child prompt'],
    }),
    ...options,
  })
  const windowEvents: UiScrollInput[] = []
  on('ui.scroll', (_$, e) => {
    windowEvents.push(e)
    return e.origin.kind === 'person' ? ENGINE_RESULT : {}
  })
  return { h, windowEvents }
}
function forChild(c: Wire, child: Child): boolean {
  return c.server === child.ref.server && (child.ref.kind === 'panel'
    ? c.tool === 'team' && c.args.path === child.ref.address && c.args.run_id === child.ref.token && c.args.slot === child.slot
    : c.args.session_id === child.ref.token)
}
const reads = (h: Harness, child?: Child) => h.fake.transcriptCalls().filter(c => !child || forChild(c, child))
const count = (h: Harness, child?: Child) => reads(h, child).length
const lastCursor = (n: number) => 'opaque:' + n + '/+=='
function event(by: number): UiScrollInput {
  return { component: 'Pane', requestId: SHOW, offset: 8, by, bodyRows: 8, contentRows: 50, origin: { kind: 'person' } }
}
async function until(h: Harness, ready: () => boolean, message: string, within = 3_000) {
  await h.clock.settle()
  for (let elapsed = 0; !ready() && elapsed < within; elapsed += 25) await h.clock.advance(25)
  expect(ready(), message).toBe(true)
}
async function oneChild($: Engine, h: Harness, id: string, kind: Kind): Promise<Child> {
  // Short visible labels avoid depending on unrelated model-name truncation rules.
  // Unique run/session identities, not these labels, isolate transcript caches between tests.
  const model = kind + '-' + (h.fake.runs.length + h.fake.sessions.length + 1)
  if (kind === 'panel') {
    const r = await team($, h, id, [model])
    return { ref: { kind, server: SERVERS[0], token: r.runId, address: r.path }, slot: '01', model }
  }
  await modelCall($, CREATE_TOOL, { model, prompt: 'Work on this isolated test task' })
  const s = h.fake.sessions[h.fake.sessions.length - 1]
  if (!s) throw new Error('no test session started')
  await h.clock.advance(POLL)
  return { ref: { kind, server: SERVERS[0], token: s.id, address: s.id }, slot: s.id, model: s.model }
}
async function panelChildren($: Engine, h: Harness, id: string): Promise<Child[]> {
  const label = 'panel-' + (h.fake.runs.length + 1)
  const r = await team($, h, id, [label + '-a', label + '-b'])
  return r.slots.map(s => ({
    ref: { kind: 'panel', server: SERVERS[0], token: r.runId, address: r.path },
    slot: s.slot, model: s.model,
  }))
}
async function open($: Engine, h: Harness, surface: Surface, child: Child, columns = 120, rows = 12) {
  const b = await mountBand($, surface, bandProps(220, 40))
  let p: Mounted | undefined
  try {
    await pressChip(b, child.model, 'Show')
    p = await mountPane($, surface, SHOW, paneProps(columns, rows))
    await h.clock.settle()
    expect(h.opens.some(x => x.id === SHOW)).toBe(true)
    return { b, p }
  } catch (error) {
    if (p) await p.unmount()
    await b.unmount()
    throw error
  }
}
async function close(p: Mounted, b: Mounted) { await p.unmount(); await b.unmount() }
async function pressLabel(p: Mounted, label: string) {
  await p.redraw()
  const buttons = (await p.findAll({ type: 'Button' })).filter(b => b.props.label === label)
  expect(buttons, 'exactly one visible ' + label + ' button').toHaveLength(1)
  expect(typeof buttons[0]!.key).toBe('string')
  await p.press({ key: buttons[0]!.key! })
}
async function expectMode(p: Mounted, mode: 'screen' | 'text') {
  await p.redraw()
  const labels = (await p.findAll({ type: 'Button' })).map(x => x.props.label)
  expect(labels.filter(x => x === (mode === 'text' ? 'Screen' : 'Text'))).toHaveLength(1)
  expect(labels).not.toContain(mode === 'text' ? 'Text' : 'Screen')
}
async function textOf(p: Mounted) { await p.redraw(); return visibleText(await p.drawn()) }
async function pickText(p: Mounted, h: Harness, child: Child) {
  await expectMode(p, 'screen')
  await pressLabel(p, 'Text')
  await until(h, () => count(h, child) > 0, 'first transcript request')
  await expectMode(p, 'text')
}
async function nextPoll(h: Harness, child: Child, answeredAt?: number) {
  const before = count(h, child)
  // Other callers use synchronous answers; a held answer supplies its actual arrival time.
  const at = answeredAt ?? reads(h, child)[before - 1]!.at
  const delta = at + TEXT_POLL - 1 - h.clock.now()
  expect(delta >= 0, 'the prior read was observed before its next deadline').toBe(true)
  await h.clock.advance(delta)
  expect(count(h, child), 'no transcript poll at 1999 ms').toBe(before)
  await h.clock.advance(1)
  expect(count(h, child), 'one transcript poll at 2000 ms').toBe(before + 1)
  expect(reads(h, child)[before]!.at - at).toBe(TEXT_POLL)
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>(r => { release = r })
  return { promise, release }
}
// Logical text rows from the engine's public Ink drawing vocabulary, not pixel/cell layout.
// Inline Text and horizontal children share rows; column children and newlines do not.
// No private element keys or buffer state; nesting the mark in a separate Text is equally valid.
function rowsOf(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return String(value).split('\n')
  if (!value || typeof value !== 'object') return []
  const n = value as Node
  if (n.type === 'Button' || n.props?.display === 'none') return []
  if (n.type === 'Text') return visibleText(n).split('\n')
  const parts = nodeChildren(n).map(rowsOf)
  if (n.type !== 'Box') return parts.flat()
  const direction = n.props?.flexDirection ?? 'row'
  if (direction === 'column') return parts.flat()
  if (direction === 'column-reverse') return parts.reverse().flat()
  if (direction === 'row-reverse') parts.reverse()
  const height = Math.max(0, ...parts.map(rows => rows.length))
  return Array.from({ length: height }, (_, i) => parts.map(rows => rows[i] ?? '').join(''))
}
async function rowsOfPane(p: Mounted) { await p.redraw(); return rowsOf(await p.drawn()) }

type StoreValue<K extends keyof Store> = Awaited<ReturnType<Store[K]['read']>>
function memoryCell<T>(initial: T): Cell<T> {
  let value = initial
  return {
    read: async () => value,
    update: async fn => { value = fn(value); return value },
    claim: async fn => {
      const [next, claimed] = fn(value)
      value = next
      return [value, claimed] as const
    },
  }
}
function activeTab(h: Harness): string {
  const id = (h.state.get('showTab') as ClaudishShowTab | undefined)?.active
  if (!id) throw new Error('Show did not select a tab')
  return id
}

// Seed from the engine's published state, so tab ids come from Show rather than a copied hash.
// No engine-backed Store: refresh sees only these in-memory cells and the fake Host boundary.
async function textHost(h: Harness, id: string, transcript: Host['source']['transcript']) {
  const paneCells = new Map<string, Cell<ClaudishPaneView | null>>()
  const paneCell = (tab: string) => {
    let cell = paneCells.get(tab)
    if (!cell) { cell = memoryCell<ClaudishPaneView | null>(null); paneCells.set(tab, cell) }
    return cell
  }
  const store: Store = {
    runs: memoryCell<StoreValue<'runs'>>({ epoch: 0, starts: {}, list: [] }),
    feeds: memoryCell<StoreValue<'feeds'>>({}),
    stopRequests: memoryCell<StoreValue<'stopRequests'>>({}),
    ledger: memoryCell<StoreValue<'ledger'>>({ epoch: 0, entries: {} }),
    turn: memoryCell<StoreValue<'turn'>>({ isRunning: false, since: 0 }),
    earlier: memoryCell<StoreValue<'earlier'>>({ runs: 0, done: 0, failed: 0, stopped: 0 }),
    showTab: memoryCell<StoreValue<'showTab'>>({ active: null }),
    textView: memoryCell<StoreValue<'textView'>>({ rev: 0, modes: {} }),
    allowance: memoryCell<StoreValue<'allowance'>>({ kind: 'probing' }),
    panes: {
      read: tab => paneCell(tab).read(),
      update: (tab, fn) => paneCell(tab).update(fn),
      claim: (tab, fn) => paneCell(tab).claim(fn),
    },
  }
  const scrollEnds: string[] = []
  const timers: { ms: number; fn: () => void; cancelled: boolean }[] = []
  const unusedSource = (): never => { throw new Error('This test only supplies transcript answers') }
  const host: Host = {
    store,
    source: {
      recognizeCall: unusedSource, poll: unusedSource, stop: unusedSource,
      capture: unusedSource, resize: unusedSource, scroll: unusedSource, transcript,
      runLine: unusedSource, fetchHint: unusedSource,
      allowance: unusedSource, resolveAllowance: unusedSource,
    },
    now: async () => h.clock.now(),
    after: (ms, fn) => {
      const timer = { ms, fn, cancelled: false }
      timers.push(timer)
      return { cancel: () => { timer.cancelled = true } }
    },
    panes: async () => [{ id: SHOW, title: 'claudish', isPlaced: true, isShown: true, isFocused: false }],
    scrollEnd: async pane => { scrollEnds.push(pane) },
    toast: () => {}, status: () => {}, debug: () => {},
    submit: async () => ({ accepted: false, reason: 'not used by transcript tests' }),
    close: async () => {}, messages: async () => [], sessionId: async () => id,
  }
  const select = async (tab: string) => {
    const view = h.state.get('panes/' + tab) as ClaudishPaneView | null | undefined
    const runs = h.state.get('runs') as ClaudishRuns | undefined
    const run = runs?.list.find(r => r.id === view?.runId)
    if (!view || !run || !runs) throw new Error('Show did not publish its run and pane')
    await store.runs.update(v => ({
      epoch: runs.epoch, starts: { ...runs.starts },
      list: [...v.list.filter(r => r.id !== run.id), run],
    }))
    await store.feeds.update(v => ({
      ...v, [run.ref.server + '#' + run.ref.kind]: {
        kind: 'speaks', version: 1, declined: 0,
        can: { cancel: false, capture: false, spans: false, resize: false, transcript: true },
      },
    }))
    await store.panes.update(tab, () => ({ ...view }))
    await store.showTab.update(() => ({ active: tab }))
    await store.textView.update(v => ({ ...v, modes: { ...v.modes, [tab]: 'text' } }))
  }
  await select(id)
  return { host, scrollEnds, timers, select }
}

for (const surface of SURFACES) {
  for (const kind of KINDS) {
    for (const ended of [false, true]) {
      // REQ-2, REQ-8, REQ-12
      test('T1.2 T3.1 T4.2 TEST-7: unsupported ' + kind + ' ended=' + ended + ' stays screen-only [' + surface + ']', async ($, on) => {
        const id = 'r12-unsupported-' + surface + '-' + kind + '-' + ended
        const { h } = world(on, id, { listTranscript: undefined })
        await start($, surface)
        const child = await oneChild($, h, id, kind)
        if (ended) { h.fake.set(child.ref.token, child.slot, 'COMPLETED'); await h.clock.advance(POLL) }
        const { b, p } = await open($, h, surface, child)
        try {
          await until(h, () => h.fake.captureCalls().some(c => forChild(c, child)), 'screen captured')
          await h.clock.advance(6_000)
          const labels = (await p.findAll({ type: 'Button' })).map(x => x.props.label)
          expect(labels).not.toContain('Text')
          expect(labels).not.toContain('Screen')
          expect(await textOf(p)).toContain('SCREEN ' + child.model)
          expect(reads(h)).toEqual([])
          expect(h.fake.listCalls().length).toBeGreaterThan(0)
        } finally { await close(p, b) }
      })
    }

    // REQ-8, REQ-9, REQ-11, REQ-12
    test('T3.1 T3.2 T4.1 T4.2 TEST-8: live ' + kind + ' reads only after Text is pressed [' + surface + ']', async ($, on) => {
      const id = 'r12-live-' + surface + '-' + kind
      const { h } = world(on, id, { transcriptAnswer: () => page('first', [line(id + ' transcript')], false, true) })
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child)
      try {
        await h.clock.advance(6_000)
        await expectMode(p, 'screen')
        expect(await textOf(p)).toContain('SCREEN ' + child.model)
        expect(reads(h)).toEqual([])

        await pickText(p, h, child)

        expect(reads(h).map(wire)).toEqual([transcriptRequest(child.ref, child.slot, null)])
        expect(await textOf(p)).toContain(id + ' transcript')
        expect(await textOf(p)).not.toContain('SCREEN ' + child.model)
      } finally { await close(p, b) }
    })

    // REQ-11, REQ-13, REQ-18: final=true does not override more=true.
    test('T4.1 T4.3 T5.1 TEST-11: ' + kind + ' immediately drains an empty page and cross-page continuation [' + surface + ']', async ($, on) => {
      const id = 'r12-drain-' + surface + '-' + kind
      const { h } = world(on, id, { transcriptAnswer: (_call, n) =>
        n === 1 ? page('empty:advanced', [], true, false)
          : n === 2 ? page('fragment', [line(id + '-alpha')], true, true)
            : page('done', [line('-omega', 'assistant', true)], false, true),
      })
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child)
      try {
        const at = h.clock.now()
        await pressLabel(p, 'Text')
        await h.clock.settle()

        expect(reads(h).map(wire)).toEqual([
          transcriptRequest(child.ref, child.slot, null),
          transcriptRequest(child.ref, child.slot, 'empty:advanced'),
          transcriptRequest(child.ref, child.slot, 'fragment'),
        ])
        expect(reads(h).map(c => c.at)).toEqual([at, at, at])
        expect(h.clock.now()).toBe(at)
        expect((await rowsOfPane(p)).filter(r => r.includes(id + '-alpha'))).toEqual(['  ' + id + '-alpha-omega'])
        await h.clock.advance(6_000)
        expect(count(h)).toBe(3)
      } finally { await close(p, b) }
    })

    for (const empty of [false, true]) {
      // REQ-13
      test('T4.3 TEST-12: ' + kind + ' caps a more burst at ten calls, empty=' + empty + ' [' + surface + ']', async ($, on) => {
        const id = 'r12-burst-' + surface + '-' + kind + '-' + empty
        const { h } = world(on, id, { transcriptAnswer: (_call, n) =>
          page(lastCursor(n), empty ? [] : [line(id + '-row-' + n)], true, false),
        })
        await start($, surface)
        const child = await oneChild($, h, id, kind)
        const { b, p } = await open($, h, surface, child)
        try {
          const at = h.clock.now()
          await pressLabel(p, 'Text')
          await h.clock.settle()

          expect(count(h)).toBe(10)
          expect(reads(h).map(c => c.at)).toEqual(new Array(10).fill(at))
          expect(reads(h).map(wire)).toEqual(Array.from({ length: 10 }, (_, i) =>
            transcriptRequest(child.ref, child.slot, i === 0 ? null : lastCursor(i))))
          expect(h.clock.now()).toBe(at)
        } finally { await close(p, b) }
      })
    }

    for (const ended of [false, true]) {
      // REQ-11, REQ-14. Finished sessions may remain non-final beyond the screen's grace period.
      test('T4.1 T4.4 TEST-13: ' + kind + ' ended=' + ended + ' polls at 2000 ms until final [' + surface + ']', async ($, on) => {
        const id = 'r12-poll-' + surface + '-' + kind + '-' + ended
        const { h } = world(on, id, { transcriptAnswer: (_call, n) => page(lastCursor(n), [line(id + '-row-' + n)]) })
        await start($, surface)
        const child = await oneChild($, h, id, kind)
        if (ended) { h.fake.set(child.ref.token, child.slot, 'COMPLETED'); await h.clock.advance(POLL) }
        const { b, p } = await open($, h, surface, child)
        try {
          if (!ended) await pickText(p, h, child)
          else {
            await until(h, () => count(h, child) > 0, 'ended transcript begins')
            await expectMode(p, 'text')
          }
          expect(count(h, child)).toBe(1)
          for (let i = 0; i < (ended ? 16 : 2); i++) await nextPoll(h, child)
          const beforeFinal = count(h, child)
          expect(reads(h, child).map(wire)).toEqual(Array.from({ length: beforeFinal }, (_, i) =>
            transcriptRequest(child.ref, child.slot, i === 0 ? null : lastCursor(i))))
          if (ended) expect(reads(h, child)[beforeFinal - 1]!.at - reads(h, child)[0]!.at).toBe(32_000)

          h.fake.options.transcriptAnswer = () => page('final', [line(id + '-last')], false, true)
          await nextPoll(h, child)
          expect(await textOf(p)).toContain(id + '-last')
          await h.clock.advance(10_000)

          expect(count(h, child)).toBe(beforeFinal + 1)
        } finally { await close(p, b) }
      })
    }

    // REQ-11, REQ-15
    test('T4.1 T4.5 TEST-14: ' + kind + ' pauses on Screen and resumes with its cursor [' + surface + ']', async ($, on) => {
      const id = 'r12-resume-' + surface + '-' + kind
      const { h } = world(on, id, { transcriptAnswer: (_call, n) => page(lastCursor(n), [line(id + '-row-' + n)]) })
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child)
      try {
        await pickText(p, h, child)
        await nextPoll(h, child)
        const before = count(h, child)
        await pressLabel(p, 'Screen')
        await h.clock.settle()
        await expectMode(p, 'screen')
        await h.clock.advance(7_000)
        expect(count(h, child)).toBe(before)
        expect(await textOf(p)).toContain('SCREEN ' + child.model)

        await pressLabel(p, 'Text')
        await until(h, () => count(h, child) > before, 'resumed transcript')
        expect(count(h, child)).toBe(before + 1)
        expect(wire(reads(h, child)[before]!)).toEqual(transcriptRequest(child.ref, child.slot, lastCursor(before)))
        expect(await textOf(p)).toContain(id + '-row-1')
        expect(await textOf(p)).toContain(id + '-row-' + (before + 1))
        await nextPoll(h, child)
      } finally { await close(p, b) }
    })

    for (const code of ['unknown_run', 'unknown_session', 'unknown_slot']) {
      // REQ-16
      test('T4.6 TEST-16: ' + kind + ' ' + code + ' shows retention message and stops [' + surface + ']', async ($, on) => {
        const id = 'r12-ui-gone-' + surface + '-' + kind + '-' + code
        const { h } = world(on, id, { transcriptAnswer: () => ({ text: contractError(code, 'not retained'), isError: true }) })
        await start($, surface)
        const child = await oneChild($, h, id, kind)
        const { b, p } = await open($, h, surface, child)
        try {
          await pickText(p, h, child)
          expect(await textOf(p)).toContain('claudish no longer keeps this session')
          expect(await textOf(p)).not.toContain('Reading the transcript…')
          await h.clock.advance(8_000)
          expect(count(h, child)).toBe(1)
        } finally { await close(p, b) }
      })
    }

    // REQ-16
    test('T4.6 TEST-17: ' + kind + ' removes the unavailable line after a successful retry [' + surface + ']', async ($, on) => {
      const id = 'r12-recover-' + surface + '-' + kind
      const { h } = world(on, id, { transcriptAnswer: (_call, n) => n === 1
        ? { text: contractError('invalid_args', 'retryable test failure'), isError: true }
        : page('recovered', [line(id + '-recovered')], false, true),
      })
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child)
      try {
        await pickText(p, h, child)
        expect((await rowsOfPane(p)).some(r => r.startsWith('transcript unavailable:'))).toBe(true)
        expect(await textOf(p)).not.toContain('Reading the transcript…')

        await nextPoll(h, child)

        expect(await textOf(p)).toContain(id + '-recovered')
        expect(await textOf(p)).not.toContain('transcript unavailable:')
        expect(await textOf(p)).not.toContain('Reading the transcript…')
        expect(reads(h).map(wire)).toEqual([
          transcriptRequest(child.ref, child.slot, null), transcriptRequest(child.ref, child.slot, null),
        ])
      } finally { await close(p, b) }
    })

    // REQ-17. Establish a real screen resize before measuring, so this isn't satisfied by noResize.
    test('T4.7 TEST-18: ' + kind + ' transcript pagination, polls and retries never control the child [' + surface + ']', async ($, on) => {
      const id = 'r12-readonly-' + surface + '-' + kind
      const { h } = world(on, id, {
        noResize: false,
        transcriptAnswer: (_call, n) => n === 3
          ? { text: contractError('busy', 'try again'), isError: true }
          : page(lastCursor(n), [line(id + '-row-' + n)], n === 1, n >= 4),
      })
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child, 120, 40)
      try {
        await until(h, () => h.fake.resizeCalls().some(c => forChild(c, child)), 'initial screen resize')
        await h.clock.advance(POLL)
        await p.redraw()
        await h.clock.settle()
        const before = h.fake.calls.length

        await pickText(p, h, child)
        expect(count(h, child)).toBe(2)
        await nextPoll(h, child)
        await nextPoll(h, child)
        await h.clock.advance(4_000)

        expect(count(h, child)).toBe(4)
        expect(reads(h, child).map(wire)).toEqual([
          transcriptRequest(child.ref, child.slot, null),
          transcriptRequest(child.ref, child.slot, lastCursor(1)),
          transcriptRequest(child.ref, child.slot, lastCursor(2)),
          transcriptRequest(child.ref, child.slot, lastCursor(2)),
        ])
        expect(await textOf(p)).toContain(id + '-row-4')
        const controls = h.fake.calls.slice(before).filter(c =>
          c.tool === 'send_input' || c.tool === 'scroll_session' || c.tool === 'resize_session'
          || (c.tool === 'team' && ['scroll', 'resize', 'send_input'].includes(String(c.args.mode))))
        expect(controls).toEqual([])
      } finally { await close(p, b) }
    })

    // REQ-14, REQ-20: response gate is released in finally even when an assertion fails.
    test('T4.4 T5.3 TEST-21: ' + kind + ' shows Reading the transcript until actual lines arrive [' + surface + ']', async ($, on) => {
      const id = 'r12-loading-' + surface + '-' + kind
      const held = gate()
      let answeredAt: number | undefined
      const { h } = world(on, id, { transcriptAnswer: async (_call, n) => {
        if (n === 1) {
          await held.promise
          answeredAt = h.clock.now()
          return page('empty')
        }
        return page('ready', [line(id + '-ready')], false, true)
      } })
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child)
      let press: Promise<unknown> | undefined
      try {
        press = pressLabel(p, 'Text')
        await until(h, () => count(h, child) === 1, 'held initial transcript request')
        expect(await textOf(p)).toContain('Reading the transcript…')
        expect(await textOf(p)).not.toContain('transcript unavailable:')

        // A slow response must not start another read at the request's old deadline.
        await h.clock.advance(TEXT_POLL + 25)
        expect(count(h, child)).toBe(1)
        held.release()
        await h.clock.settle()
        await press
        if (answeredAt === undefined) throw new Error('the held answer did not arrive')
        expect(answeredAt).toBeGreaterThan(reads(h, child)[0]!.at)
        expect(await textOf(p)).toContain('Reading the transcript…')
        await nextPoll(h, child, answeredAt)

        expect(await textOf(p)).toContain(id + '-ready')
        expect(await textOf(p)).not.toContain('Reading the transcript…')
      } finally {
        held.release()
        await h.clock.settle()
        if (press) await press
        await close(p, b)
      }
    })

    // REQ-22 / T5.5: the kit cannot implement plugin-origin ui.scroll; observe the specified Host port.
    test('T5.5 TEST-23: ' + kind + ' scrolls Show once per tab, only after its first lines, through a fake Host [' + surface + ']', async ($, on) => {
      const id = 'r12-first-end-host-' + surface + '-' + kind
      const { h } = world(on, id)
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const second = await oneChild($, h, id + '-second', kind)
      const { b, p } = await open($, h, surface, child, 100, 8)
      try {
        const firstTab = activeTab(h)
        const calls: Parameters<Host['source']['transcript']>[] = []
        const perChild = new Map<string, number>()
        const fake = await textHost(h, firstTab, async (ref, slot, since) => {
          calls.push([ref, slot, since])
          const key = ref.token + '/' + slot
          const n = (perChild.get(key) ?? 0) + 1
          perChild.set(key, n)
          return {
            kind: 'lines', cursor: lastCursor(n), more: false, final: false,
            lines: n === 1 ? [] : [{ kind: 'assistant', text: id + '-' + slot + '-row-' + n, cont: false }],
          }
        })

        await refresh(fake.host, firstTab)
        expect(calls).toHaveLength(1)
        expect(fake.scrollEnds).toEqual([]) // an answered but empty transcript is not first content
        await refresh(fake.host, firstTab)
        expect(calls).toHaveLength(2)
        expect(fake.scrollEnds).toEqual([SHOW])
        await refresh(fake.host, firstTab)
        expect(calls).toHaveLength(3)
        expect(fake.scrollEnds).toEqual([SHOW])

        // Select the second screen tab only to obtain its public id and pane data.
        // The actual text reads and end-scrolls below still go solely through the fake Host.
        await pressLabel(p, second.model)
        const secondTab = activeTab(h)
        expect(secondTab).not.toBe(firstTab)
        await fake.select(secondTab)
        await refresh(fake.host, secondTab)
        expect(calls).toHaveLength(4)
        expect(fake.scrollEnds).toEqual([SHOW])
        await refresh(fake.host, secondTab)
        expect(calls).toHaveLength(5)
        expect(fake.scrollEnds).toEqual([SHOW, SHOW])
        await refresh(fake.host, secondTab)
        expect(calls).toHaveLength(6)
        expect(fake.scrollEnds).toEqual([SHOW, SHOW])

        await fake.select(firstTab)
        await refresh(fake.host, firstTab)
        expect(calls).toHaveLength(7)
        expect(fake.scrollEnds).toEqual([SHOW, SHOW])
        expect(reads(h)).toEqual([]) // no live-engine transcript read supplied the test's answers
      } finally {
        resetText()
        await close(p, b)
      }
    })

    // REQ-26 / T4.8 (new requirement): exercise both target-lookup and in-flight-answer overlap.
    test('T4.8 TEST-27: ' + kind + ' overlapping refreshes send one transcript request and draw its line once [' + surface + ']', async ($, on) => {
      const id = 'r12-overlap-host-' + surface + '-' + kind
      const { h } = world(on, id)
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child)
      const lookup = gate()
      const answer = gate()
      const pending: Promise<unknown>[] = []
      try {
        const tab = activeTab(h)
        const body = 'one transcript row ' + id
        const calls: Parameters<Host['source']['transcript']>[] = []
        const fake = await textHost(h, tab, async (ref, slot, since) => {
          calls.push([ref, slot, since])
          await answer.promise
          return {
            kind: 'lines', cursor: id + '-cursor', more: false, final: true,
            lines: [{ kind: 'assistant', text: body, cont: false }],
          }
        })
        let holdFirstLookup = true
        const holdLookup = <Args extends unknown[], Result>(read: (...args: Args) => Promise<Result>) =>
          async (...args: Args): Promise<Result> => {
            if (holdFirstLookup) {
              holdFirstLookup = false
              await lookup.promise
            }
            return read(...args)
          }
        // Hold the first target-state read, whichever public input is consulted first.
        // Do not require a particular lookup order or a call to any one Store member.
        fake.host.store.runs.read = holdLookup(fake.host.store.runs.read)
        fake.host.store.feeds.read = holdLookup(fake.host.store.feeds.read)
        fake.host.store.panes.read = holdLookup(fake.host.store.panes.read)
        fake.host.store.showTab.read = holdLookup(fake.host.store.showTab.read)
        fake.host.store.textView.read = holdLookup(fake.host.store.textView.read)
        fake.host.panes = holdLookup(fake.host.panes)

        // Start both without awaiting either. Only the first target lookup is held:
        // a guard acquired too late lets the second call overtake it and send a request.
        pending.push(refresh(fake.host, tab), refresh(fake.host, tab))
        await h.clock.settle()
        expect(calls, 'no second read may overtake the held target lookup').toHaveLength(0)
        lookup.release()
        await h.clock.settle()
        expect(calls).toEqual([[child.ref, child.slot, null]])

        // Also reject another refresh while that one transcript answer is outstanding.
        pending.push(refresh(fake.host, tab))
        await h.clock.settle()
        expect(calls).toHaveLength(1)
        answer.release()
        await Promise.all(pending)
        expect(calls).toHaveLength(1)

        expect(tabText(tab)?.lines).toEqual([{ kind: 'assistant', text: body }])
        expect(calls).toHaveLength(1)
        expect(reads(h)).toEqual([])
      } finally {
        lookup.release()
        answer.release()
        await Promise.allSettled(pending)
        resetText()
        await close(p, b)
      }
    })

    // REQ-23
    test('T6.1 TEST-24: ' + kind + ' text scroll reaches the engine unchanged without scrolling a child [' + surface + ']', async ($, on) => {
      const id = 'r12-local-scroll-' + surface + '-' + kind
      const { h, windowEvents } = world(on, id, {
        transcriptAnswer: () => page('done', Array.from({ length: 40 }, (_, i) => line('local-row-' + i)), false, true),
      })
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child)
      try {
        await pickText(p, h, child)
        const events = [event(-3), event(4)]
        for (const e of events) expect(await $.ui.scroll(e)).toEqual(ENGINE_RESULT)
        await h.clock.settle()
        expect(windowEvents.filter(e => e.origin.kind === 'person')).toEqual(events)
        expect(h.fake.scrollCalls()).toEqual([])
      } finally { await close(p, b) }
    })

    // REQ-24
    test('T6.2 TEST-25: ' + kind + ' live screen still forwards scrolling to only its child [' + surface + ']', async ($, on) => {
      const id = 'r12-screen-scroll-' + surface + '-' + kind
      const { h, windowEvents } = world(on, id)
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child)
      try {
        await expectMode(p, 'screen')
        expect(await $.ui.scroll(event(-3))).toEqual({})
        await h.clock.settle()
        expect(h.fake.scrollCalls().map(wire)).toEqual([scrollRequest(child, { by: -3 })])
        expect(windowEvents.filter(e => e.origin.kind === 'person')).toEqual([])
        expect(reads(h)).toEqual([])
      } finally { await close(p, b) }
    })

    // REQ-25
    test('T6.3 TEST-26: ' + kind + ' returns the scrolled child to end before reading Text [' + surface + ']', async ($, on) => {
      const id = 'r12-return-end-' + surface + '-' + kind
      const { h } = world(on, id, { transcriptAnswer: () => page('done', [line(id + '-text')], false, true) })
      await start($, surface)
      const child = await oneChild($, h, id, kind)
      const { b, p } = await open($, h, surface, child)
      try {
        expect(await $.ui.scroll(event(-4))).toEqual({})
        await h.clock.settle()
        expect(h.fake.scrollCalls().map(wire)).toEqual([scrollRequest(child, { by: -4 })])
        const before = h.fake.calls.length

        await pickText(p, h, child)

        const relevant = h.fake.calls.slice(before).filter(c =>
          c.tool === 'scroll_session' || c.tool === 'transcript_session'
          || (c.tool === 'team' && (c.args.mode === 'scroll' || c.args.mode === 'transcript')))
        expect(relevant.map(wire)).toEqual([
          scrollRequest(child, { to: 'end' }), transcriptRequest(child.ref, child.slot, null),
        ])
        expect(await textOf(p)).toContain(id + '-text')
        const e = event(-2)
        expect(await $.ui.scroll(e)).toEqual(ENGINE_RESULT)
        await h.clock.settle()
        expect(h.fake.scrollCalls()).toHaveLength(2)
      } finally { await close(p, b) }
    })
  }

  for (const ending of ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EMPTY', 'LOST', 'settled', 'pane-ended']) {
    // REQ-9: server-terminal slots have a live sibling; LOST withdraws a run; pane-ended still lists RUNNING.
    test('T3.2 TEST-9: ' + ending + ' selects Text without a personal pick [' + surface + ']', async ($, on) => {
      const id = 'r12-default-' + surface + '-' + ending
      const { h } = world(on, id, {
        transcriptAnswer: () => page('done', [line(id + '-transcript')], false, true),
        ...(ending === 'pane-ended' ? { frame: ({ seq, model }: { seq: number; model: string }) => ({
          seq, final: true, cols: 120, rows: 1, cursor: null, lines: ['SCREEN ' + model],
        }) } : {}),
      })
      await start($, surface)
      const child = ending === 'settled' || ending === 'pane-ended'
        ? await oneChild($, h, id, 'panel')
        : (await panelChildren($, h, id))[0]!
      if (ending === 'LOST') {
        // Withdraw the live list entry while retaining its transcript at the server.
        // Never restore it as COMPLETED: that would let a broken LOST default pass.
        h.fake.runs[0]!.hidden = true
        await h.clock.advance(35_000)
      } else if (ending !== 'pane-ended') {
        h.fake.set(child.ref.token, child.slot, ending === 'settled' ? 'COMPLETED' : ending)
        await h.clock.advance(POLL)
      }
      const { b, p } = await open($, h, surface, child)
      try {
        await p.redraw()
        await until(h, () => count(h, child) > 0, 'automatic ended transcript')
        await expectMode(p, 'text')
        expect(await textOf(p)).toContain(id + '-transcript')
        if (ending === 'LOST') expect(visibleText(await b.drawn())).toContain(' LST ')
        if (ending === 'pane-ended') expect(h.fake.runs[0]!.slots[0]!.control.state).toBe('RUNNING')
      } finally { await close(p, b) }
    })
  }

  // REQ-8, REQ-10, REQ-12
  test('T3.1 T3.3 T4.2 TEST-10: personal mode choices stay with their tab, including Screen after end [' + surface + ']', async ($, on) => {
    const id = 'r12-per-tab-' + surface
    const { h } = world(on, id, { transcriptAnswer: (call, n) =>
      page(lastCursor(n), [line('TEXT ' + String(call.args.slot ?? call.args.session_id))], false, true),
    })
    await start($, surface)
    const [a, bChild] = await panelChildren($, h, id)
    const ended = await oneChild($, h, id + '-delegation', 'delegation')
    h.fake.set(ended.ref.token, ended.slot, 'COMPLETED')
    await h.clock.advance(POLL)
    const { b, p } = await open($, h, surface, a!)
    try {
      await pickText(p, h, a!)
      expect(await textOf(p)).toContain('TEXT ' + a!.slot)
      await pressLabel(p, bChild!.model)
      await h.clock.settle()
      await expectMode(p, 'screen')
      expect(count(h, bChild)).toBe(0)
      await pressLabel(p, a!.model)
      await h.clock.settle()
      await expectMode(p, 'text')
      expect(await textOf(p)).toContain('TEXT ' + a!.slot)

      await pressLabel(p, ended.model)
      await until(h, () => count(h, ended) > 0, 'ended delegation text')
      await expectMode(p, 'text')
      await pressLabel(p, 'Screen')
      await expectMode(p, 'screen')
      await pressLabel(p, a!.model)
      await expectMode(p, 'text')
      await pressLabel(p, ended.model)
      await h.clock.advance(4_000)
      await expectMode(p, 'screen')
      expect(await textOf(p)).toContain('SCREEN ' + ended.model)
    } finally { await close(p, b) }
  })

  // REQ-11, REQ-15: non-first team slot versus a delegation catches misaddressed cursor caches.
  test('T4.1 T4.5 TEST-15: changing tabs pauses hidden text and resumes the right cursor [' + surface + ']', async ($, on) => {
    const id = 'r12-tab-resume-' + surface
    const { h } = world(on, id, { transcriptAnswer: (c, n) =>
      page(lastCursor(n), [line('TARGET ' + String(c.args.slot ?? c.args.session_id) + '-' + n)]),
    })
    await start($, surface)
    const target = (await panelChildren($, h, id))[1]!
    const other = await oneChild($, h, id + '-other', 'delegation')
    const { b, p } = await open($, h, surface, target)
    try {
      await pickText(p, h, target)
      await nextPoll(h, target)
      const before = count(h, target)
      await pressLabel(p, other.model)
      await expectMode(p, 'screen')
      await h.clock.advance(7_000)
      expect(count(h, target)).toBe(before)
      expect(count(h, other)).toBe(0)
      await pickText(p, h, other)
      await nextPoll(h, other)
      const otherBefore = count(h, other)
      expect(count(h, target)).toBe(before)

      await pressLabel(p, target.model)
      await until(h, () => count(h, target) > before, 'returned team tab')
      expect(wire(reads(h, target)[before]!)).toEqual(transcriptRequest(target.ref, target.slot, lastCursor(before)))
      await nextPoll(h, target)
      expect(count(h, other)).toBe(otherBefore)
      expect(await textOf(p)).toContain('TARGET ' + target.slot + '-1')
      expect(await textOf(p)).not.toContain('TARGET ' + other.slot)
    } finally { await close(p, b) }
  })

  // REQ-18, REQ-19
  test('T5.1 T5.2 TEST-19: marks all kinds and joins only same-kind continuation rows [' + surface + ']', async ($, on) => {
    const id = 'r12-marks-' + surface
    const { h } = world(on, id, { transcriptAnswer: () => page('done', [
      line('mark-user', 'user'), line('mark-tool', 'tool'), line('mark-system', 'system'), line('mark-error', 'error'),
      line('mark-assistant'), line('mark-task', 'task_file'), line('mark-future', 'future_kind'),
      line('chain-a'), line('-b', 'assistant', true), line('-c', 'assistant', true),
      line('separate-tool', 'tool', true), line('separate-assistant', 'assistant', true),
    ], false, true) })
    await start($, surface)
    const child = await oneChild($, h, id, 'delegation')
    const { b, p } = await open($, h, surface, child)
    try {
      await pickText(p, h, child)
      const rows = (await rowsOfPane(p)).filter(r => /mark-|chain-|separate-/.test(r))
      expect(rows).toEqual([
        '› mark-user', '⏺ mark-tool', '· mark-system', '! mark-error',
        '  mark-assistant', '  mark-task', '  mark-future', '  chain-a-b-c',
        '⏺ separate-tool', '  separate-assistant',
      ])
    } finally { await close(p, b) }
  })

  // REQ-18. The kit exposes the tree, not painted cells; the host visual-run gap is in the plan.
  test('T5.1 TEST-20: narrow text keeps long paragraphs, newline rows and rows beyond the pane [' + surface + ']', async ($, on) => {
    const id = 'r12-wrap-' + surface
    const long = 'LONG-BEGIN ' + 'word '.repeat(60) + 'LONG-END'
    const { h } = world(on, id, { transcriptAnswer: () => page('done', [
      line(long), line('newline-first\nnewline-second\nnewline-third'),
      ...Array.from({ length: 24 }, (_, i) => line('overflow-row-' + String(i).padStart(2, '0'))),
    ], false, true) })
    await start($, surface)
    const child = await oneChild($, h, id, 'panel')
    const { b, p } = await open($, h, surface, child, 32, 6)
    try {
      await pickText(p, h, child)
      const tree = await p.drawn()
      expect(visibleText(tree)).toContain(long)
      const rows = rowsOf(tree)
      expect(rows.filter(r => r.includes('newline-')).map(r => r.trim())).toEqual([
        'newline-first', 'newline-second', 'newline-third',
      ])
      expect(rows.filter(r => r.includes('overflow-row-')).map(r => r.trim())).toEqual(
        Array.from({ length: 24 }, (_, i) => 'overflow-row-' + String(i).padStart(2, '0')))
      const textNodes = walk(tree).map(x => x.node).filter(n =>
        n.type === 'Text' && visibleText(n).includes('LONG-BEGIN'))
      expect(textNodes.length).toBeGreaterThan(0)
      for (const n of textNodes) expect(n.props?.wrap === undefined || n.props.wrap === 'wrap').toBe(true)
    } finally { await close(p, b) }
  })

  // REQ-21: wire pages stay at 200 lines; the capacity oracle is literal specification data.
  test('T5.4 TEST-22: retains 2000 newest lines per tab and reports cumulative drops first [' + surface + ']', async ($, on) => {
    const id = 'r12-retention-' + surface
    const retained = (from: number, length: number) => Array.from({ length }, (_, i) =>
      line('keep:' + String(from + i).padStart(4, '0')))
    const { h } = world(on, id, { transcriptAnswer: (c, n) => {
      if (c.args.slot === '02') return page('other-final', [line('other-tab-only')], false, true)
      if (n <= 10) return page(lastCursor(n), retained((n - 1) * 200 + 1, 200), n < 10)
      if (n === 11) return page(lastCursor(n), retained(2001, 3))
      return page('final', retained(2004, 200), false, true)
    } })
    await start($, surface)
    const [a, other] = await panelChildren($, h, id)
    const { b, p } = await open($, h, surface, a!, 120, 12)
    const kept = async () => (await rowsOfPane(p)).filter(r => /keep:\d{4}/.test(r)).map(r => r.trim())
    try {
      await pickText(p, h, a!)
      expect(count(h, a)).toBe(10)
      expect(await kept()).toEqual(Array.from({ length: 2000 }, (_, i) => 'keep:' + String(i + 1).padStart(4, '0')))
      expect(await textOf(p)).not.toContain('earlier lines not kept')

      await nextPoll(h, a!)
      expect(await kept()).toEqual(Array.from({ length: 2000 }, (_, i) => 'keep:' + String(i + 4).padStart(4, '0')))
      expect((await rowsOfPane(p)).filter(r => /keep:|earlier lines not kept/.test(r))[0]).toBe('… 3 earlier lines not kept')
      await nextPoll(h, a!)
      expect(await kept()).toEqual(Array.from({ length: 2000 }, (_, i) => 'keep:' + String(i + 204).padStart(4, '0')))
      expect((await rowsOfPane(p)).filter(r => /keep:|earlier lines not kept/.test(r))[0]).toBe('… 203 earlier lines not kept')

      await pressLabel(p, other!.model)
      await pickText(p, h, other!)
      expect(await textOf(p)).toContain('other-tab-only')
      expect(await textOf(p)).not.toContain('earlier lines not kept')
      expect(await kept()).toEqual([])
      await pressLabel(p, a!.model)
      await expectMode(p, 'text')
      expect((await kept()).length).toBe(2000)
      expect(await textOf(p)).toContain('… 203 earlier lines not kept')
      expect(await textOf(p)).not.toContain('other-tab-only')
    } finally { await close(p, b) }
  })
}
