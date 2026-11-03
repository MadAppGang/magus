// R1–R4: spec-derived scroll tests. Run with claude plugin test, not standalone bun test.
// Only public results, outgoing MCP messages, engine window events, logs and rendered text.
// REQ/TEST numbers map to the accompanying QA plan. No private scroll state is inspected.

import type { McpToolResult, On, UiScrollInput, UiScrollResult } from 'claude-code'
import { expect, type Engine } from 'claude-code/testing'
import { test } from '../kit'
import type { ClaudishRunRef } from '../../types'
import { makeClaudishSource, type McpCall } from '../../hooks/status/claudish-source'
import { CWD, harness, start, SERVERS, type FakeOptions, type Harness, type Recorded } from '../fake-claudish'
import { contractError, type Json } from '../scenario'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, type Mounted, type Surface } from '../ui'
import { delegate, team, POLL } from './support'
import { pressChip, visibleText } from './v2-support'
import { SHOW_PANE } from './r6-support'

type Move = { by: number } | { to: 'end' }
type Wire = Pick<Recorded, 'server' | 'tool' | 'args'>
const wire = ({ server, tool, args }: Recorded): Wire => ({ server, tool, args })
const reply = (body: unknown, isError = false): McpToolResult => ({
  content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }], isError,
})

// Existing public adapter-construction seam from r7-resize.test.ts.
function adapter(answer: McpToolResult | Error) {
  const sent: Wire[] = []
  const call: McpCall = async (server, tool, args) => {
    sent.push({ server, tool, args })
    if (answer instanceof Error) throw answer
    return answer
  }
  return { source: makeClaudishSource(call), sent }
}

function request(ref: ClaudishRunRef, slot: string, move: Move): Wire {
  return ref.kind === 'panel'
    ? { server: ref.server, tool: 'team', args: { mode: 'scroll', path: ref.address, slot, run_id: ref.token, ...move } }
    : { server: ref.server, tool: 'scroll_session', args: { session_id: ref.token, ...move } }
}

const KINDS = ['panel', 'delegation'] as const
for (const kind of KINDS) {
  const ref: ClaudishRunRef = { kind, server: SERVERS[0], token: 'scroll-token', address: kind === 'panel' ? `${CWD}/scroll-address` : 'scroll-token' }

  // REQ-1, REQ-2: exact objects detect scroll:false or scroll:undefined as well as other flag changes.
  for (const capture of [false, true]) for (const since of [false, true]) for (const scroll of [false, true]) {
    test(`R1.1 R1.2 TEST-1: ${kind} capture=${capture} since=${since} scroll=${scroll} exposes only supported flags`, async () => {
      const capabilities = ['list', 'status', 'cancel', 'capture_spans', 'resize', 'allowance',
        ...(capture ? ['capture'] : []), ...(since ? ['capture_since_seq'] : []), ...(scroll ? ['scroll'] : [])]
      const { source } = adapter(reply({ contract_version: 1, capabilities, runs: [], sessions: [] }))

      const feed = (await source.poll([{ id: 'watched', ref }])).feeds.get(`${ref.server}#${kind}`)

      expect(feed).toEqual({ kind: 'speaks', version: 1, can: {
        cancel: true, capture: capture && since, spans: capture && since, resize: capture && since, allowance: true,
        ...(capture && since && scroll ? { scroll: true } : {}),
      } })
      if (feed?.kind !== 'speaks') throw new Error('expected speaking feed')
      expect(Object.prototype.hasOwnProperty.call(feed.can, 'scroll')).toBe(capture && since && scroll)
    })
  }
  for (const missing of ['cancel', 'capture_spans', 'resize', 'allowance']) {
    test(`R1.1 R1.2 TEST-1: ${kind} scroll support does not depend on ${missing}`, async () => {
      const capabilities = ['list', 'cancel', 'capture', 'capture_since_seq', 'capture_spans', 'resize', 'allowance', 'scroll']
        .filter(c => c !== missing)
      const { source } = adapter(reply({ contract_version: 1, capabilities, runs: [], sessions: [] }))

      expect((await source.poll([{ id: 'watched', ref }])).feeds.get(`${ref.server}#${kind}`)).toEqual({
        kind: 'speaks', version: 1, can: {
          cancel: missing !== 'cancel', capture: true, spans: missing !== 'capture_spans', resize: missing !== 'resize',
          ...(missing === 'allowance' ? {} : { allowance: true }), scroll: true,
        },
      })
    })
  }

  // REQ-3, REQ-4, REQ-5: no internal method spies; this is the external protocol boundary.
  for (const server of SERVERS) for (const move of [{ by: -3 }, { by: 3 }, { to: 'end' }] as const) {
    test(`R2.1 R2.2 R2.3 TEST-2: ${kind} on ${server} sends exactly ${JSON.stringify(move)} and returns seq`, async () => {
      const target = { ...ref, server }
      const body = kind === 'panel'
        ? { run_id: target.token, path: target.address, slot: '02', seq: 17 }
        : { session_id: target.token, seq: 17 }
      const { source, sent } = adapter(reply(body))

      expect(await source.scroll(target, kind === 'panel' ? '02' : target.token, move)).toEqual({ kind: 'scrolled', seq: 17 })
      expect(sent).toEqual([request(target, '02', move)])
    })
  }
  for (const seq of [0, 1, 73]) {
    test(`R2.3 TEST-3: ${kind} accepts seq ${seq} without requiring identity echoes`, async () => {
      const { source } = adapter(reply({ seq }))
      expect(await source.scroll(ref, '02', { by: -1 })).toEqual({ kind: 'scrolled', seq })
    })
  }
  for (const code of ['unknown_run', 'unknown_session', 'unknown_slot']) {
    test(`R2.4 TEST-4: ${kind} ${code} is gone`, async () => {
      const { source } = adapter(reply(contractError(code, 'not retained'), true))
      expect(await source.scroll(ref, '02', { by: -1 })).toEqual({ kind: 'gone' })
    })
  }
  const failures: { name: string; answer: McpToolResult | Error }[] = [
    ...['scroll_unavailable', 'invalid_args', 'other_contract_error'].map(code => ({
      name: code, answer: reply(contractError(code, 'not sent'), true),
    })),
    { name: 'transport rejected', answer: new Error('connection closed') },
    { name: 'plain MCP error', answer: reply('scroll refused', true) },
    { name: 'error flag with otherwise valid seq', answer: reply({ seq: 12 }, true) },
    { name: 'non JSON', answer: reply('not JSON') },
    { name: 'null object', answer: reply('null') },
    { name: 'array', answer: reply('[{"seq":3}]') },
    { name: 'empty content', answer: { content: [], isError: false } },
    { name: 'missing seq', answer: reply({}) },
    ...[
      { name: 'negative seq', seq: -1 }, { name: 'fractional seq', seq: 0.5 },
      { name: 'string seq', seq: '3' }, { name: 'null seq', seq: null }, { name: 'boolean seq', seq: true },
    ].map(c => ({ name: c.name, answer: reply({ seq: c.seq }) })),
    { name: 'nonfinite seq', answer: reply('{"seq":1e309}') },
  ]
  for (const c of failures) {
    test(`R2.4 TEST-5: ${kind} ${c.name} returns failed with a diagnostic`, async () => {
      const { source } = adapter(c.answer)
      const result = await source.scroll(ref, '02', { to: 'end' })

      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error(`expected failed, got ${JSON.stringify(result)}`)
      expect(typeof result.reason).toBe('string')
      expect(result.reason.trim().length).toBeGreaterThan(0)
    })
  }
}

// Engine window behavior is an external observation: next(e) must reach it unchanged.
const ENGINE_RESULT: UiScrollResult = { deny: 'R11 engine window received the scroll' }
function world(on: On, options: FakeOptions = {}) {
  const h = harness(on, {
    listScroll: true,
    frame: ({ model, seq, final }) => ({ seq, final, cols: 120, rows: 2, cursor: null, lines: [`R11 ${model} screen ${seq}`, 'child prompt'] }),
    ...options,
  })
  const windowEvents: UiScrollInput[] = []
  on('ui.scroll', (_$, e) => { windowEvents.push(e); return ENGINE_RESULT })
  return { h, windowEvents }
}

function event(by: number, patch: Partial<UiScrollInput> = {}): UiScrollInput {
  // A fitted captured screen has no local rows to move. e.by, NOT clamped offset, must drive the child.
  return { component: 'Pane', requestId: SHOW_PANE, offset: 0, by, bodyRows: 30, contentRows: 2, origin: { kind: 'person' }, ...patch }
}
type Child = { ref: ClaudishRunRef; slot: string; model: string }
function forChild(c: Wire, child: Child): boolean {
  return c.server === child.ref.server && (child.ref.kind === 'panel'
    ? c.tool === 'team' && c.args.path === child.ref.address && c.args.run_id === child.ref.token && c.args.slot === child.slot
    : c.args.session_id === child.ref.token)
}
const scrolls = (h: Harness) => h.fake.scrollCalls().map(wire)
const moves = (h: Harness): Json[] => h.fake.scrollCalls().map(c => 'to' in c.args ? { to: c.args.to } : { by: c.args.by })

async function until(h: Harness, ready: () => boolean, message: string, within = 3_000) {
  await h.clock.settle()
  for (let elapsed = 0; !ready() && elapsed < within; elapsed += 25) await h.clock.advance(25)
  expect(ready(), message).toBe(true)
}

async function children($: Engine, h: Harness): Promise<Child[]> {
  const r = await team($, h, 'scroll-team', ['scroll-a', 'scroll-b'])
  const s = await delegate($, h)
  return [
    ...r.slots.map(slot => ({ ref: { kind: 'panel' as const, server: SERVERS[0], token: r.runId, address: r.path }, slot: slot.slot, model: slot.model })),
    { ref: { kind: 'delegation', server: SERVERS[0], token: s.id, address: s.id }, slot: s.id, model: s.model },
  ]
}
async function oneChild($: Engine, h: Harness, kind: typeof KINDS[number]): Promise<Child> {
  if (kind === 'delegation') {
    const s = await delegate($, h)
    return { ref: { kind, server: SERVERS[0], token: s.id, address: s.id }, slot: s.id, model: s.model }
  }
  const r = await team($, h, 'scroll-single', ['scroll-a'])
  return { ref: { kind, server: SERVERS[0], token: r.runId, address: r.path }, slot: '01', model: 'scroll-a' }
}
async function open($: Engine, h: Harness, surface: Surface, child: Child) {
  const b = await mountBand($, surface, bandProps(200, 30))
  await pressChip(b, child.model, 'Show')
  const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 30))
  await h.clock.settle()
  expect(h.opens.some(x => x.id === SHOW_PANE)).toBe(true)
  expect((await p.findAll({ type: 'Button' })).some(x => x.props.label === child.model)).toBe(true)
  return { b, p }
}
async function pressLabel(p: Mounted, label: string) {
  await p.redraw()
  const buttons = (await p.findAll({ type: 'Button' })).filter(x => x.props.label === label)
  expect(buttons, `one visible ${label} button`).toHaveLength(1)
  expect(typeof buttons[0]!.key).toBe('string')
  await p.press({ key: buttons[0]!.key! })
}
async function move($: Engine, h: Harness, by: number) {
  expect(await $.ui.scroll(event(by))).toEqual({})
  await h.clock.settle()
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>(r => { release = r })
  return { promise, release }
}
// Observe without awaiting a held dispatch; rejection is surfaced explicitly, never unhandled.
function pending(promise: Promise<UiScrollResult>) {
  const state: { done: boolean; result?: UiScrollResult; error?: unknown } = { done: false }
  const finished = promise.then(result => { state.done = true; state.result = result }, error => { state.done = true; state.error = error })
  return { state, finished }
}
async function accepted(p: ReturnType<typeof pending>) {
  await p.finished
  expect(p.state.error).toBeUndefined()
  expect(p.state.result).toEqual({})
}
async function close(p: Mounted, b: Mounted) { await p.unmount(); await b.unmount() }

for (const surface of SURFACES) {
  // REQ-7, REQ-8: mix kinds, target a non-first team slot, then a delegation.
  test(`R3.1 R3.2 TEST-6: person -3 scrolls only the shown child and leaves the panel window still [${surface}]`, async ($, on) => {
    const { h, windowEvents } = world(on)
    await start($, surface)
    const targets = await children($, h)
    const { b, p } = await open($, h, surface, targets[1]!)
    try {
      await move($, h, -3)
      expect(scrolls(h)).toEqual([request(targets[1]!.ref, targets[1]!.slot, { by: -3 })])
      expect(windowEvents).toEqual([])

      await pressLabel(p, targets[2]!.model)
      await h.clock.settle() // leaving the first scrolled tab legitimately sends end
      const before = h.fake.scrollCalls().length
      await move($, h, -3)
      expect(scrolls(h).slice(before)).toEqual([request(targets[2]!.ref, targets[2]!.slot, { by: -3 })])
      expect(windowEvents).toEqual([])
    } finally { await close(p, b) }
  })

  for (const kind of KINDS) {
    for (const by of [-1, -200, -201, -450, 450]) {
      test(`R3.2 R3.3 TEST-7: ${kind} move ${by} is losslessly sent in nonzero chunks of at most 200 [${surface}]`, async ($, on) => {
        const { h } = world(on)
        await start($, surface)
        const child = await oneChild($, h, kind)
        const { b, p } = await open($, h, surface, child)
        try {
          if (by > 0) await move($, h, -800) // keep the downward move short of the live bottom
          const before = h.fake.scrollCalls().length
          await move($, h, by)
          const sent = h.fake.scrollCalls().slice(before)
          expect(sent.length).toBeGreaterThan(0)
          expect(sent.every(c => forChild(c, child))).toBe(true)
          const rows = sent.map(c => c.args.by)
          expect(rows.every(n => typeof n === 'number' && Number.isInteger(n) && Math.sign(n) === Math.sign(by) && Math.abs(n) <= 200)).toBe(true)
          expect(rows.reduce<number>((n, row) => n + Number(row), 0)).toBe(by)
          for (const c of sent) expect(wire(c)).toEqual(request(child.ref, child.slot, { by: Number(c.args.by) }))
          if (Math.abs(by) <= 200) expect(sent).toHaveLength(1)
          else expect(sent.length).toBeGreaterThan(1)
        } finally { await close(p, b) }
      })
    }

    // REQ-10: the held MCP response is outside the product, not a private queue inspection.
    for (const cancel of [false, true]) {
      test(`R3.4 TEST-${cancel ? 9 : 8}: ${kind} held scroll ${cancel ? 'cancels opposite queued moves without a zero call' : 'sums mixed queued moves into one serialized call'} [${surface}]`, async ($, on) => {
        const held = gate()
        let arrivals = 0
        const { h } = world(on, { beforeScroll: async () => { if (++arrivals === 1) await held.promise } })
        await start($, surface)
        const child = await oneChild($, h, kind)
        const { b, p } = await open($, h, surface, child)
        const dispatches: ReturnType<typeof pending>[] = []
        try {
          dispatches.push(pending($.ui.scroll(event(-3))))
          await h.clock.settle()
          expect(h.fake.scrollCalls()).toHaveLength(1)
          for (const by of cancel ? [-4, 4] : [-4, 2, -5]) {
            dispatches.push(pending($.ui.scroll(event(by))))
            await h.clock.settle()
          }
          await h.clock.advance(100)
          expect(h.fake.scrollCalls(), 'no second request before the first answer').toHaveLength(1)

          held.release()
          await h.clock.settle()
          for (const d of dispatches) await accepted(d)
          expect(scrolls(h)).toEqual([
            request(child.ref, child.slot, { by: -3 }),
            ...(cancel ? [] : [request(child.ref, child.slot, { by: -7 })]),
          ])
        } finally {
          held.release()
          await h.clock.settle()
          await Promise.all(dispatches.map(d => d.finished))
          await close(p, b)
        }
      })
    }

    // REQ-11: do NOT advance time after releasing the scroll; a periodic capture cannot satisfy this.
    test(`R3.5 TEST-10: ${kind} captures and displays the moved screen immediately after scroll answers [${surface}]`, async ($, on) => {
      const held = gate()
      let changed = false
      const { h } = world(on, {
        beforeScroll: async () => { await held.promise; changed = true },
        frame: ({ seq, final }) => ({ seq, final, cols: 120, rows: 1, cursor: null, lines: [changed ? 'R11 older transcript visible' : 'R11 live bottom visible'] }),
      })
      await start($, surface)
      const child = await oneChild($, h, kind)
      const { b, p } = await open($, h, surface, child)
      let dispatch: ReturnType<typeof pending> | undefined
      try {
        await until(h, () => h.fake.captureCalls().some(c => forChild(c, child)), 'initial child capture')
        await p.redraw()
        expect(visibleText(await p.drawn())).toContain('R11 live bottom visible')
        dispatch = pending($.ui.scroll(event(-3)))
        await h.clock.settle()
        expect(h.fake.scrollCalls()).toHaveLength(1)
        const before = h.fake.calls.length
        const now = h.clock.now()

        held.release()
        await h.clock.settle()
        await accepted(dispatch)
        const captures = h.fake.calls.slice(before).filter(c =>
          (c.tool === 'capture_session' || (c.tool === 'team' && c.args.mode === 'capture')) && forChild(c, child))
        expect(captures.length, 'a new capture without clock advancement').toBeGreaterThan(0)
        expect(h.clock.now()).toBe(now)
        expect(captures[0]!.at).toBe(now)
        await p.redraw()
        expect(visibleText(await p.drawn())).toContain('R11 older transcript visible')
        expect(visibleText(await p.drawn())).not.toContain('R11 live bottom visible')
      } finally {
        held.release()
        await h.clock.settle()
        if (dispatch) await dispatch.finished
        await close(p, b)
      }
    })

    // REQ-13: one debug line, not an exact sentence the spec never prescribed.
    for (const failure of ['scroll_unavailable', 'unknown_run', 'unknown_session', 'unknown_slot', 'other_error', 'rejected']) {
      test(`R3.7 TEST-15: ${kind} ${failure} logs once without throwing and the next event scrolls [${surface}]`, async ($, on) => {
        const { h, windowEvents } = world(on, failure === 'rejected' ? { denyScroll: 'connection closed' } : { scrollError: failure })
        await start($, surface)
        const child = await oneChild($, h, kind)
        const { b, p } = await open($, h, surface, child)
        try {
          const before = h.debug.length
          await move($, h, -3)
          const debug = h.debug.slice(before)
          expect(debug).toHaveLength(1)
          expect(debug[0]!.trim().length).toBeGreaterThan(0)
          expect(scrolls(h)).toEqual([request(child.ref, child.slot, { by: -3 })])
          expect(windowEvents).toEqual([])

          h.fake.options.scrollError = undefined
          h.fake.options.denyScroll = undefined
          await move($, h, -2)
          expect(scrolls(h)).toEqual([
            request(child.ref, child.slot, { by: -3 }), request(child.ref, child.slot, { by: -2 }),
          ])
          expect(h.debug.slice(before)).toEqual(debug)
          expect(windowEvents).toEqual([])
        } finally { await close(p, b) }
      })
    }

    // REQ-14: the timeout must release the tab while the first MCP response is STILL held.
    test(`R3.8 TEST-16: ${kind} fails at 5000ms, not 4999ms, and accepts another event [${surface}]`, async ($, on) => {
      const held = gate()
      let arrivals = 0
      const { h } = world(on, { beforeScroll: async () => { if (++arrivals === 1) await held.promise } })
      await start($, surface)
      const child = await oneChild($, h, kind)
      const { b, p } = await open($, h, surface, child)
      const before = h.debug.length
      const first = pending($.ui.scroll(event(-3)))
      try {
        await h.clock.settle()
        expect(h.fake.scrollCalls()).toHaveLength(1)
        const sentAt = h.fake.scrollCalls()[0]!.at
        expect(h.clock.now()).toBe(sentAt)
        await h.clock.advance(4_999)
        expect(h.debug.slice(before)).toEqual([])

        await h.clock.advance(1)
        expect(h.clock.now() - sentAt).toBe(5_000)
        expect(h.debug.slice(before)).toHaveLength(1)
        expect(h.debug[before]!.trim().length).toBeGreaterThan(0)
        await accepted(first)
        await move($, h, -2) // first response not released
        expect(scrolls(h)).toEqual([
          request(child.ref, child.slot, { by: -3 }), request(child.ref, child.slot, { by: -2 }),
        ])
      } finally {
        held.release()
        await h.clock.settle()
        await first.finished
        await close(p, b)
      }
    })
  }

  // REQ-12: both no request AND unchanged pass-through, with a distinct downstream result.
  for (const scenario of ['no scroll', 'no capture', 'plugin origin', 'zero', 'another pane'] as const) {
    test(`R3.6 TEST-11: ${scenario} passes the unchanged event to the engine without scrolling a child [${surface}]`, async ($, on) => {
      const { h, windowEvents } = world(on, {
        ...(scenario === 'no scroll' ? { listScroll: false } : {}),
        ...(scenario === 'no capture' ? { noCapture: true } : {}),
      })
      await start($, surface)
      const child = await oneChild($, h, 'panel')
      const { b, p } = await open($, h, surface, child)
      try {
        const e = event(scenario === 'zero' ? 0 : -3, scenario === 'plugin origin'
          ? { origin: { kind: 'plugin', name: 'other-plugin' } }
          : scenario === 'another pane' ? { requestId: 'other-pane' } : {})
        expect(await $.ui.scroll(e)).toEqual(ENGINE_RESULT)
        await h.clock.settle()
        expect(windowEvents).toEqual([e])
        expect(scrolls(h)).toEqual([])
        expect(h.fake.listCalls().length).toBeGreaterThan(0)
      } finally { await close(p, b) }
    })
  }

  for (const state of ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EMPTY', 'LOST']) {
    test(`R3.6 TEST-12: shown ${state} slot with a live sibling passes scrolling on [${surface}]`, async ($, on) => {
      const { h, windowEvents } = world(on, { neverFinal: true })
      await start($, surface)
      const targets = await children($, h)
      const child = targets[0]!
      if (state === 'LOST') {
        h.fake.runs[0]!.slots.splice(0, 1) // withdraw a server row, never manufacture private mod state
        await h.clock.advance(35_000)
      } else {
        h.fake.set(child.ref.token, child.slot, state)
        await h.clock.advance(POLL)
      }
      const { b, p } = await open($, h, surface, child)
      try {
        const e = event(-3)
        expect(await $.ui.scroll(e)).toEqual(ENGINE_RESULT)
        await h.clock.settle()
        expect(windowEvents).toEqual([e])
        expect(scrolls(h)).toEqual([])
        // Positive control: the same pane still forwards when its live sibling is selected.
        await pressLabel(p, targets[1]!.model)
        await move($, h, -3)
        expect(scrolls(h)).toEqual([request(targets[1]!.ref, targets[1]!.slot, { by: -3 })])
      } finally { await close(p, b) }
    })
  }

  test(`R3.6 TEST-13: a settled run's retained screen passes scroll to the engine [${surface}]`, async ($, on) => {
    const { h, windowEvents } = world(on, { neverFinal: true })
    await start($, surface)
    const child = await oneChild($, h, 'panel')
    const { b, p } = await open($, h, surface, child)
    try {
      h.fake.set(child.ref.token, child.slot, 'COMPLETED')
      await h.clock.advance(POLL)
      await p.redraw()
      const e = event(-3)
      expect(await $.ui.scroll(e)).toEqual(ENGINE_RESULT)
      await h.clock.settle()
      expect(windowEvents).toEqual([e])
      expect(scrolls(h)).toEqual([])
    } finally { await close(p, b) }
  })

  test(`R3.6 TEST-14: a run with no shown tab passes scroll to the engine [${surface}]`, async ($, on) => {
    const { h, windowEvents } = world(on)
    await start($, surface)
    await oneChild($, h, 'panel')
    expect(h.fake.listCalls().length).toBeGreaterThan(0)
    const e = event(-3)
    expect(await $.ui.scroll(e)).toEqual(ENGINE_RESULT)
    await h.clock.settle()
    expect(windowEvents).toEqual([e])
    expect(scrolls(h)).toEqual([])
    expect(h.opens).toEqual([])
  })

  for (const kind of KINDS) {
    const cases: { name: string; input: number[]; output: Move[] }[] = [
      { name: 'down at bottom', input: [1], output: [{ to: 'end' }] },
      { name: 'equal distance', input: [-5, 5], output: [{ by: -5 }, { to: 'end' }] },
      { name: 'overshoot', input: [-5, 9], output: [{ by: -5 }, { to: 'end' }] },
      { name: 'net of earlier down', input: [-5, 2, 3], output: [{ by: -5 }, { by: 2 }, { to: 'end' }] },
      { name: 'new up after partial down', input: [-5, 2, -4, 6, 1], output: [{ by: -5 }, { by: 2 }, { by: -4 }, { by: 6 }, { to: 'end' }] },
    ]
    for (const c of cases) {
      test(`R4.1 TEST-17: ${kind} ${c.name} returns to end at the net bottom [${surface}]`, async ($, on) => {
        const { h } = world(on)
        await start($, surface)
        const child = await oneChild($, h, kind)
        const { b, p } = await open($, h, surface, child)
        try {
          for (const by of c.input) await move($, h, by)
          expect(scrolls(h)).toEqual(c.output.map(m => request(child.ref, child.slot, m)))
        } finally { await close(p, b) }
      })
    }

    test(`R4.1 R4.5 TEST-18: ${kind} returning to end clears the old distance before scrolling again [${surface}]`, async ($, on) => {
      const { h } = world(on)
      await start($, surface)
      const child = await oneChild($, h, kind)
      const { b, p } = await open($, h, surface, child)
      try {
        for (const by of [-5, 5, -2, 1, 1]) await move($, h, by)
        const expected = [{ by: -5 }, { to: 'end' }, { by: -2 }, { by: 1 }, { to: 'end' }]
        expect(moves(h)).toEqual(expected)
        await pressLabel(p, 'Hide')
        await h.clock.settle()
        expect(h.closes).toContain(SHOW_PANE)
        expect(moves(h)).toEqual(expected)
      } finally { await close(p, b) }
    })

    test(`R4.2 R4.5 TEST-19: ${kind} downward capture with unchanged text sends end despite a newer seq [${surface}]`, async ($, on) => {
      const { h } = world(on, {
        frame: ({ seq, final }) => ({ seq, final, cols: 120, rows: 2, cursor: null, lines: ['R11 unchanged bottom text', 'child prompt'] }),
      })
      await start($, surface)
      const targets = await children($, h)
      const child = targets[kind === 'panel' ? 0 : 2]!
      const { b, p } = await open($, h, surface, child)
      try {
        await until(h, () => h.fake.captureCalls().some(c => forChild(c, child)), 'initial screen captured')
        await move($, h, -10)
        expect(moves(h)).toEqual([{ by: -10 }]) // unchanged text while going UP is not this rule
        const before = h.fake.calls.length

        await move($, h, 1)
        expect(scrolls(h)).toEqual([
          request(child.ref, child.slot, { by: -10 }),
          request(child.ref, child.slot, { by: 1 }),
          request(child.ref, child.slot, { to: 'end' }),
        ])
        const after = h.fake.calls.slice(before)
        const endIndex = after.findIndex(c => c.args.to === 'end')
        expect(endIndex).toBeGreaterThan(0)
        expect(after.slice(1, endIndex).some(c => forChild(c, child)
          && (c.tool === 'capture_session' || c.args.mode === 'capture'))).toBe(true)
        await p.redraw()
        expect(visibleText(await p.drawn())).toContain('R11 unchanged bottom text')
        const count = h.fake.scrollCalls().length
        await pressLabel(p, targets[1]!.model)
        await h.clock.settle()
        expect(h.fake.scrollCalls()).toHaveLength(count)
      } finally { await close(p, b) }
    })
  }

  // REQ-17, REQ-19: two scrolled children in succession, one untouched child, then revisit both.
  test(`R4.3 R4.5 TEST-20: tab switching resets only the departing scrolled children, once [${surface}]`, async ($, on) => {
    const { h } = world(on)
    await start($, surface)
    const targets = await children($, h)
    const a = targets[0]!, untouched = targets[1]!, d = targets[2]!
    const { b, p } = await open($, h, surface, a)
    try {
      await move($, h, -4)
      await pressLabel(p, d.model)
      await h.clock.settle()
      expect(scrolls(h)).toEqual([request(a.ref, a.slot, { by: -4 }), request(a.ref, a.slot, { to: 'end' })])
      await move($, h, -2)
      await pressLabel(p, untouched.model)
      await h.clock.settle()
      expect(scrolls(h)).toEqual([
        request(a.ref, a.slot, { by: -4 }), request(a.ref, a.slot, { to: 'end' }),
        request(d.ref, d.slot, { by: -2 }), request(d.ref, d.slot, { to: 'end' }),
      ])
      for (const child of [a, d, untouched]) {
        await pressLabel(p, child.model)
        await h.clock.settle()
      }
      expect(h.fake.scrollCalls()).toHaveLength(4)
    } finally { await close(p, b) }
  })

  for (const control of ['pane', 'band'] as const) for (const kind of KINDS) {
    test(`R4.4 R4.5 TEST-21: ${control} Hide restores the scrolled ${kind} once, not untouched siblings [${surface}]`, async ($, on) => {
      const { h } = world(on)
      await start($, surface)
      const targets = await children($, h)
      const child = targets[kind === 'panel' ? 0 : 2]!
      const opened = await open($, h, surface, child)
      const b = opened.b
      let p = opened.p
      try {
        await move($, h, -4)
        await pressLabel(control === 'pane' ? p : b, 'Hide')
        await h.clock.settle()
        expect(scrolls(h)).toEqual([
          request(child.ref, child.slot, { by: -4 }), request(child.ref, child.slot, { to: 'end' }),
        ])
        expect(h.closes).toContain(SHOW_PANE)
        await p.unmount()
        await b.redraw()
        await pressChip(b, child.model, 'Show')
        p = await mountPane($, surface, SHOW_PANE, paneProps(120, 30))
        const closed = h.closes.length

        await pressLabel(control === 'pane' ? p : b, 'Hide')
        await h.clock.settle()
        expect(h.closes.length).toBeGreaterThan(closed)
        expect(h.fake.scrollCalls()).toHaveLength(2)
      } finally { await close(p, b) }
    })
  }

  test(`R4.3 R4.4 R4.5 TEST-22: leaving and hiding untouched tabs sends no scroll [${surface}]`, async ($, on) => {
    const { h } = world(on)
    await start($, surface)
    const targets = await children($, h)
    const { b, p } = await open($, h, surface, targets[0]!)
    try {
      await pressLabel(p, targets[1]!.model)
      await h.clock.settle()
      expect((await p.findAll({ type: 'Button' })).some(x => x.props.label === targets[1]!.model)).toBe(true)
      await pressLabel(p, 'Hide')
      await h.clock.settle()
      expect(h.closes).toContain(SHOW_PANE)
      expect(scrolls(h)).toEqual([])
    } finally { await close(p, b) }
  })
}
