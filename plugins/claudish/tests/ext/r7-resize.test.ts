// R7.1–R7.4 (with R9.1 sizes and R10's when/which), written from spec.md and the public contract, without implementation reads.
// MCP requests, captured text and debug lines are the observation boundary. No private resize state.
// Run with the host's engine kit, not standalone bun test. See R7-TEST-PLAN.md for TEST/REQ ids.

import type { McpToolResult } from 'claude-code'
import { expect } from 'claude-code/testing'
import { test } from '../kit'
import type { ClaudishRunRef } from '../../types'
import { makeClaudishSource, type McpCall } from '../../hooks/status/claudish-source'
import { CWD, harness, start, type Harness, type Recorded } from '../fake-claudish'
import { contractError, type Json } from '../scenario'
import { bandProps, mountBand, mountPane, paneProps, SURFACES } from '../ui'
import { POLL, delegate, team } from './support'
import { frameLines, pressChip, visibleText } from './v2-support'
import { SHOW_PANE } from './r6-support'

const SERVER = 'plugin:claudish:claudish'
const PANEL: ClaudishRunRef = { kind: 'panel', server: SERVER, token: 'r7-review-000001', address: `${CWD}/r7-review` }
const DELEGATION: ClaudishRunRef = { kind: 'delegation', server: 'claudish', token: 'r7-session-000001', address: 'r7-session-000001' }
const REFS = [PANEL, DELEGATION] as const

type WireCall = { server: string; tool: string; args: Json }
const reply = (body: unknown, isError = false): McpToolResult => ({
  content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }], isError,
})

/** Same adapter-construction seam as adapter.test.ts; only its public RunSource methods are used. */
function adapter(answer: McpToolResult | Error) {
  const calls: WireCall[] = []
  const call: McpCall = async (server, tool, args) => {
    calls.push({ server, tool, args })
    if (answer instanceof Error) throw answer
    return answer
  }
  return { source: makeClaudishSource(call), calls }
}

// TEST-1, TEST-2 / REQ-1: full truth table, independently for team and delegation list answers.
const capabilityCases = [
  { name: 'all three', capture: true, since: true, resize: true },
  { name: 'no resize', capture: true, since: true, resize: false },
  { name: 'no capture_since_seq', capture: true, since: false, resize: true },
  { name: 'no capture', capture: false, since: true, resize: true },
  { name: 'only resize', capture: false, since: false, resize: true },
  { name: 'only capture', capture: true, since: false, resize: false },
  { name: 'only capture_since_seq', capture: false, since: true, resize: false },
  { name: 'none of the three', capture: false, since: false, resize: false },
]
for (const ref of REFS) {
  for (const c of capabilityCases) {
    test(`R7.1 TEST-1: ${ref.kind} with ${c.name} enables resize iff resize and both capture capabilities are present`, async () => {
      const capabilities = ['list', 'status', 'cancel', 'capture_spans',
        ...(c.capture ? ['capture'] : []), ...(c.since ? ['capture_since_seq'] : []), ...(c.resize ? ['resize'] : [])]
      const { source } = adapter(reply({ contract_version: 1, capabilities, runs: [], sessions: [] }))

      const batch = await source.poll([{ id: 'watched', ref }])

      expect(batch.feeds.get(`${ref.server}#${ref.kind}`)).toEqual({
        kind: 'speaks', version: 1,
        can: { cancel: true, capture: c.capture && c.since, spans: c.capture && c.since,
          resize: c.resize && c.capture && c.since },
      })
    })
  }
  for (const missing of ['cancel', 'capture_spans']) {
    test(`R7.1 TEST-2: ${ref.kind} without ${missing} still enables resize and preserves the other feature flags`, async () => {
      const capabilities = ['list', 'cancel', 'capture', 'capture_since_seq', 'capture_spans', 'resize'].filter(c => c !== missing)
      const { source } = adapter(reply({ contract_version: 1, capabilities, runs: [], sessions: [] }))

      const batch = await source.poll([{ id: 'watched', ref }])

      expect(batch.feeds.get(`${ref.server}#${ref.kind}`)).toEqual({
        kind: 'speaks', version: 1,
        can: { cancel: missing !== 'cancel', capture: true, spans: missing !== 'capture_spans', resize: true },
      })
    })
  }

  // TEST-3/4 / REQ-8, REQ-13: returned dimensions, not the requested size or changed flag, are decoded.
  for (const changed of [true, false]) {
    const id = ref.kind === 'panel' ? 4 : 3
    test(`R7.3 R7.4 TEST-${id}: ${ref.kind} resize sends only its wire arguments and decodes the returned size when changed=${changed}`, async () => {
      const body = ref.kind === 'panel'
        ? { run_id: ref.token, path: ref.address, slot: '02', cols: 80, rows: 24, changed, seq: 7 }
        : { session_id: ref.token, cols: 80, rows: 24, changed, seq: 7 }
      const { source, calls } = adapter(reply(body))

      const result = await source.resize(ref, ref.kind === 'panel' ? '02' : ref.token, 31, 10)

      expect(result).toEqual({ kind: 'resized', cols: 80, rows: 24 })
      expect(calls).toEqual([ref.kind === 'panel'
        ? { server: ref.server, tool: 'team', args: { mode: 'resize', path: ref.address, slot: '02', run_id: ref.token, cols: 31, rows: 10 } }
        : { server: ref.server, tool: 'resize_session', args: { session_id: ref.token, cols: 31, rows: 10 } }])
    })
  }

  test(`R7.4 TEST-${ref.kind === 'panel' ? 4 : 3}: ${ref.kind} decodes a dimension-only answer without inventing metadata requirements or echoing its request`, async () => {
    const { source } = adapter(reply({ cols: 111, rows: 37 }))

    expect(await source.resize(ref, '02', 120, 40)).toEqual({ kind: 'resized', cols: 111, rows: 37 })
  })

  // TEST-5 / REQ-14: all three named retention errors, including unknown_slot.
  for (const code of ['unknown_run', 'unknown_session', 'unknown_slot']) {
    test(`R7.4 TEST-5: ${ref.kind} resize answer ${code} decodes as gone`, async () => {
      const { source } = adapter(reply(contractError(code, 'not retained'), true))

      expect(await source.resize(ref, '02', 120, 36)).toEqual({ kind: 'gone' })
    })
  }

  // TEST-6 / REQ-15: diagnostic wording is exact only where the spec supplies the source code/text.
  const failures: { name: string; answer: McpToolResult | Error; reason?: string }[] = [
    { name: 'resize_unsupported', answer: reply(contractError('resize_unsupported', 'pane cannot resize'), true), reason: 'resize_unsupported' },
    { name: 'invalid_args', answer: reply(contractError('invalid_args', 'bad size'), true), reason: 'invalid_args' },
    { name: 'transport rejection', answer: new Error('resize transport closed'), reason: 'resize transport closed' },
    { name: 'plain error text', answer: reply('resize refused by server', true), reason: 'resize refused by server' },
    { name: 'non-JSON answer', answer: reply('not a resize answer') },
    { name: 'null answer', answer: reply('null') },
    { name: 'array answer', answer: reply('[]') },
    { name: 'missing rows', answer: reply({ cols: 120 }) },
    { name: 'missing cols', answer: reply({ rows: 36 }) },
    { name: 'string cols', answer: reply({ cols: '120', rows: 36 }) },
    { name: 'string rows', answer: reply({ cols: 120, rows: '36' }) },
    { name: 'null rows', answer: reply({ cols: 120, rows: null }) },
    { name: 'empty MCP content', answer: { content: [], isError: false } },
  ]
  for (const c of failures) {
    test(`R7.4 TEST-6: ${ref.kind} ${c.name} decodes as failed with a reason`, async () => {
      const { source } = adapter(c.answer)

      const result = await source.resize(ref, '02', 120, 36)

      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error(`expected failed, got ${JSON.stringify(result)}`)
      if (c.reason !== undefined) expect(result).toEqual({ kind: 'failed', reason: c.reason })
      else {
        expect(typeof result.reason).toBe('string')
        expect(result.reason.trim().length).toBeGreaterThan(0)
      }
    })
  }
}

const isResize = (c: WireCall) => c.tool === 'resize_session' || (c.tool === 'team' && c.args.mode === 'resize')
const isCapture = (c: WireCall) => c.tool === 'capture_session' || (c.tool === 'team' && c.args.mode === 'capture')
const wire = ({ server, tool, args }: Recorded): WireCall => ({ server, tool, args })
function target(c: WireCall): string {
  return c.tool === 'team' ? `${c.server}:${String(c.args.run_id)}:${String(c.args.path)}:${String(c.args.slot)}`
    : `${c.server}:${String(c.args.session_id)}`
}

/** Bounded mock time, with an assertion if the required external event never occurs. */
async function until(h: Harness, ready: () => boolean, what: string, within = 7_000): Promise<void> {
  await h.clock.settle()
  for (let elapsed = 0; !ready() && elapsed < within; elapsed += 50) await h.clock.advance(50)
  await h.clock.settle()
  expect(ready(), what).toBe(true)
}

function expectPaired(h: Harness, resized: Recorded): void {
  const index = h.fake.calls.indexOf(resized)
  expect(index).toBeGreaterThanOrEqual(0)
  const captured = h.fake.calls[index + 1]
  expect(captured, 'resize must be immediately followed by its own capture').toBeDefined()
  expect(isCapture(captured!)).toBe(true)
  expect(target(captured!)).toBe(target(resized))
}

/**
 * R10.2: the SHOWN tab is still resized at once, before its capture. With several running sessions the
 * tick's resize pass may put other sessions' resizes in between, so this asks only that the next call
 * naming the same target is its capture, made in the same pass (within one shown-tab repaint, 1 s).
 */
function expectBeforeOwnCapture(h: Harness, resized: Recorded): void {
  const index = h.fake.calls.indexOf(resized)
  expect(index).toBeGreaterThanOrEqual(0)
  const next = h.fake.calls.slice(index + 1).find(c => (isResize(c) || isCapture(c)) && target(c) === target(resized))
  expect(next, 'the shown tab is captured after its resize').toBeDefined()
  expect(isCapture(next!), 'the next call naming the shown tab is its capture, not a second resize').toBe(true)
  expect(next!.at - resized.at).toBeLessThanOrEqual(1_000)
}

/** Stable screen words so a resize result cannot masquerade as a child frame. */
const SCREEN = 'R7 child screen stays visible'
function screen({ seq, final }: { seq: number; final: boolean }): Json {
  return { seq, final, cols: 160, rows: 2, cursor: null, lines: [SCREEN, 'child prompt'] }
}

for (const surface of SURFACES) {
  // TEST-7 / REQ-3, R9.1: literal oracles, rather than reusing a production sizing helper.
  // R9.1: cols = max(40, columns), rows = max(24, rows - 3).
  const sizes = [
    { columns: 136, rows: 43, cols: 136, height: 40 },
    { columns: 80, rows: 27, cols: 80, height: 24 },
    { columns: 79, rows: 26, cols: 79, height: 24 },
    { columns: 151, rows: 14, cols: 151, height: 24 },
    { columns: 49, rows: 45, cols: 49, height: 42 },
    { columns: 81, rows: 28, cols: 81, height: 25 },
  ]
  for (const size of sizes) {
    test(`R7.2 R9.1 TEST-7: body ${size.columns}x${size.rows} requests ${size.cols}x${size.height} [${surface}]`, async ($, on) => {
      const h = harness(on)
      await start($, surface)
      const r = await team($, h, 'size-rule', ['size-model'])
      const b = await mountBand($, surface, bandProps(180))
      await pressChip(b, 'size-model', 'Show')
      const p = await mountPane($, surface, SHOW_PANE, paneProps(size.columns, size.rows))

      await until(h, () => h.fake.resizeCalls().length > 0, 'the drawn live tab is resized')

      expect(h.fake.resizeCalls().map(wire)).toEqual([{
        server: SERVER, tool: 'team',
        args: { mode: 'resize', path: r.path, run_id: r.runId, slot: '01', cols: size.cols, rows: size.height },
      }])
      expectPaired(h, h.fake.resizeCalls()[0]!)
      await p.unmount()
      await b.unmount()
    })
  }

  // R9.1: a typical docked panel, 55 columns wide, is given exactly its own width, not a floor.
  test(`R9.1 TEST-23: a 55-column docked panel asks for exactly 55 columns [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'docked-size', ['docked-model'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'docked-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(55, 30))

    await until(h, () => h.fake.resizeCalls().length > 0, 'the docked panel is resized')

    expect(h.fake.resizeCalls().map(wire)).toEqual([{
      server: SERVER, tool: 'team',
      args: { mode: 'resize', path: r.path, run_id: r.runId, slot: '01', cols: 55, rows: 27 },
    }])
    expectPaired(h, h.fake.resizeCalls()[0]!)
    await p.unmount()
    await b.unmount()
  })

  // TEST-8 / REQ-3: inherited fallbacks, observable through the Pane's own props.
  for (const name of ['absent dimensions', 'absent height', 'non-finite dimensions'] as const) {
    test(`R7.2 TEST-8: ${name} uses the existing panel fallbacks before clamping [${surface}]`, async ($, on) => {
      const h = harness(on)
      await start($, surface)
      await team($, h, 'fallback-size', ['fallback-model'])
      const b = await mountBand($, surface, bandProps(180))
      await pressChip(b, 'fallback-model', 'Show')
      const props: Json = { ...paneProps(133, 43) }
      if (name === 'non-finite dimensions') {
        props.bodyColumns = Number.NaN
        props.scroll = { offset: 0, bodyRows: Number.POSITIVE_INFINITY }
      } else {
        delete props.scroll
        if (name === 'absent dimensions') delete props.bodyColumns
      }
      const p = await mountPane($, surface, SHOW_PANE, props as ReturnType<typeof paneProps>)

      await until(h, () => h.fake.resizeCalls().length > 0, 'fallback-sized panel is resized')

      expect(h.fake.resizeCalls().map(c => ({ cols: c.args.cols, rows: c.args.rows }))).toEqual([
        { cols: name === 'absent height' ? 133 : 80, rows: 24 },
      ])
      await p.unmount()
      await b.unmount()
    })
  }

  // TEST-9, TEST-10 / REQ-4, REQ-5, REQ-8, REQ-9; R10.1: hidden tabs are resized at the tick, not with their capture.
  test(`R7.2 R10.1 R10.2 TEST-9 TEST-10: team slots and delegation each receive the shared panel size once; the shown tab before its capture [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'shared-size', ['team-one', 'team-two'])
    const s = await delegate($, h)
    const b = await mountBand($, surface, bandProps(200, 30))
    await pressChip(b, 'team-one', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(132, 44))

    await until(h, () => h.fake.resizeCalls().length >= 3, 'every tab, including inactive tabs, resizes')

    await h.clock.advance(3_000) // once per size: further ticks add nothing
    const calls = h.fake.resizeCalls()
    expect(calls).toHaveLength(3)
    for (const slot of ['01', '02']) expect(calls.map(wire)).toContainEqual({
      server: SERVER, tool: 'team', args: { mode: 'resize', path: r.path, run_id: r.runId, slot, cols: 132, rows: 41 },
    })
    expect(calls.map(wire)).toContainEqual({
      server: SERVER, tool: 'resize_session', args: { session_id: s.id, cols: 132, rows: 41 },
    })
    // R10.2: the shown tab (team-one, slot 01) is still resized before its capture; hidden ones need no capture
    expectBeforeOwnCapture(h, calls.find(c => c.args.slot === '01')!)
    await p.unmount()
    await b.unmount()
  })

  // TEST-11 / REQ-5: sending resize first is insufficient; its answer must precede capture.
  test(`R7.3 TEST-11: a held resize answer prevents capture until the resized session is ready [${surface}]`, async ($, on) => {
    let release: (() => void) | null = null
    let holding = true
    on('mcp.call', {}, async (_$, e, next) => {
      const c = { server: e.server, tool: e.tool, args: (e.args ?? {}) as Json }
      const answer = await next(e)
      if (holding && isResize(c)) await new Promise<void>(r => { release = r })
      return answer
    })
    const h = harness(on, { frame: screen })
    await start($, surface)
    await team($, h, 'held-resize', ['held-model'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'held-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 39))
    try {
      await until(h, () => release !== null, 'resize request reached the held MCP response')
      const resizing = h.fake.resizeCalls()[0]!
      const index = h.fake.calls.indexOf(resizing)
      const captures = h.fake.captureCalls().length

      await h.clock.advance(2_000)

      expect(h.fake.calls.slice(index + 1).filter(isCapture)).toHaveLength(0)
      expect(h.fake.captureCalls()).toHaveLength(captures)
      holding = false
      ;(release as (() => void) | null)?.()
      await until(h, () => h.fake.captureCalls().length > captures, 'capture follows the released resize answer')
      const after = h.fake.calls.slice(index + 1).filter(isCapture)
      expect(after.length).toBeGreaterThan(0)
      expect(target(after[0]!)).toBe(target(resizing))
    } finally {
      holding = false
      ;(release as (() => void) | null)?.()
      await h.clock.settle()
      await p.unmount()
      await b.unmount()
    }
  })

  // TEST-12 / REQ-5, REQ-6: an opened panel is not yet a measured panel.
  test(`R7.3 TEST-12: no resize occurs while closed or before the panel's first drawing [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'not-drawn', ['not-drawn-model'])
    const b = await mountBand($, surface, bandProps(180))
    await h.clock.advance(3_000)
    expect(h.fake.resizeCalls()).toHaveLength(0)
    expect(h.fake.captureCalls()).toHaveLength(0)

    await pressChip(b, 'not-drawn-model', 'Show')
    await h.clock.advance(2_000)
    expect(h.fake.resizeCalls()).toHaveLength(0)
    const p = await mountPane($, surface, SHOW_PANE, paneProps(123, 42))
    await until(h, () => h.fake.resizeCalls().length > 0, 'first drawing makes resize eligible')

    expect(h.fake.resizeCalls().map(c => [c.args.cols, c.args.rows])).toEqual([[123, 39]])
    expectPaired(h, h.fake.resizeCalls()[0]!)
    await p.unmount()
    await b.unmount()
  })

  // TEST-13 / REQ-9: periodic captures and selecting an existing tab are not new sizes.
  test(`R7.3 TEST-13: repeated captures, identical redraws and tab selection do not repeat a successful size request [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'once-size', ['once-one', 'once-two'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'once-one', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(140, 43))
    await until(h, () => h.fake.resizeCalls().length >= 2, 'both tabs receive their first size')
    expect(h.fake.resizeCalls()).toHaveLength(2)
    const before = h.fake.captureCalls().length

    for (const model of ['once-two', 'once-one', 'once-two']) {
      const tab = (await p.findAll({ type: 'Button' })).find(t => t.props.label === model)
      expect(tab).toBeDefined()
      await p.press({ key: tab!.key! })
      await p.redraw(paneProps(140, 43))
      await h.clock.advance(POLL)
    }
    await h.clock.advance(6_000)

    expect(h.fake.captureCalls().length).toBeGreaterThan(before)
    expect(h.fake.resizeCalls()).toHaveLength(2)
    await p.unmount()
    await b.unmount()
  })

  // TEST-14 / REQ-9, REQ-10, REQ-12: refusal is remembered, but not across effective size changes.
  test(`R7.3 R7.4 TEST-14: resize_unsupported is attempted and logged once per size while captures continue [${surface}]`, async ($, on) => {
    const h = harness(on, { resizeError: 'resize_unsupported', frame: screen })
    await start($, surface)
    await team($, h, 'refused-resize', ['refused-model'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'refused-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(126, 40))
    await until(h, () => h.fake.resizeCalls().length > 0, 'first resize refusal arrives')
    const captures = h.fake.captureCalls().length

    await h.clock.advance(6_000)
    await p.redraw(paneProps(126, 40))

    expect(h.fake.resizeCalls()).toHaveLength(1)
    expect(h.fake.captureCalls().length).toBeGreaterThan(captures)
    expect(h.debug.filter(t => t.startsWith('claudish Show resize to '))).toEqual([
      'claudish Show resize to 126x37 failed: resize_unsupported',
    ])
    expect(visibleText(await p.drawn())).toContain(SCREEN)
    expect(visibleText(await p.drawn())).not.toContain('resize_unsupported')
    await p.redraw(paneProps(127, 40))
    await until(h, () => h.fake.resizeCalls().length >= 2, 'a different size gets a fresh attempt')
    await h.clock.advance(3_000)
    expect(h.fake.resizeCalls().map(c => [c.args.cols, c.args.rows])).toEqual([[126, 37], [127, 37]])
    expect(h.debug.filter(t => t.startsWith('claudish Show resize to '))).toEqual([
      'claudish Show resize to 126x37 failed: resize_unsupported',
      'claudish Show resize to 127x37 failed: resize_unsupported',
    ])
    for (const c of h.fake.resizeCalls()) expectPaired(h, c)
    await p.unmount()
    await b.unmount()
  })

  // TEST-15 / REQ-9, REQ-10: last requested size, not a set of every historical size.
  test(`R7.3 TEST-15: width-only and height-only changes, then returning to the original size, each resize once [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'change-size', ['change-model'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'change-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 40))
    await until(h, () => h.fake.resizeCalls().length > 0, 'initial size requested')

    const changes = [[121, 40], [121, 41], [120, 40]] as const
    for (let i = 0; i < changes.length; i++) {
      const [cols, rows] = changes[i]!
      await p.redraw(paneProps(cols, rows))
      await until(h, () => h.fake.resizeCalls().length >= i + 2, 'next size requested at a capture')
      await h.clock.advance(POLL)
      expect(h.fake.resizeCalls()).toHaveLength(i + 2)
    }

    expect(h.fake.resizeCalls().map(c => [c.args.cols, c.args.rows])).toEqual([[120, 37], [121, 37], [121, 38], [120, 37]])
    for (const c of h.fake.resizeCalls()) expectPaired(h, c)
    await p.unmount()
    await b.unmount()
  })

  // TEST-15 / REQ-3, REQ-9, R9.1: changing the physical panel within the 40x24 clamp is not a new requested size.
  test(`R9.1 R7.3 TEST-15: panel changes that still clamp to 40x24 do not repeat resize [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'clamped-size', ['clamped-model'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'clamped-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(30, 20))
    await until(h, () => h.fake.resizeCalls().length > 0, 'initial clamped size requested')
    const captures = h.fake.captureCalls().length

    await p.redraw(paneProps(39, 26))
    await h.clock.advance(POLL)
    await p.redraw(paneProps(40, 27))
    await h.clock.advance(POLL)

    expect(h.fake.resizeCalls().map(c => [c.args.cols, c.args.rows])).toEqual([[40, 24]])
    expect(h.fake.captureCalls().length).toBeGreaterThan(captures)
    await p.redraw(paneProps(40, 28))
    await until(h, () => h.fake.resizeCalls().length >= 2, 'height above the clamp requests a new size')
    expect(h.fake.resizeCalls().map(c => [c.args.cols, c.args.rows])).toEqual([[40, 24], [40, 25]])
    await p.unmount()
    await b.unmount()
  })

  // TEST-16 / REQ-10: the drawing wakes the loop, not merely the next status deadline.
  test(`R7.3 TEST-16: a new panel size wakes capture while status polling is backed off [${surface}]`, async ($, on) => {
    let refusing = false
    const h = harness(on, { listAnswer: () => refusing ? { deny: 'list temporarily offline' } : undefined })
    await start($, surface)
    await team($, h, 'wake-size', ['wake-size-model'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'wake-size-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 40))
    await until(h, () => h.fake.resizeCalls().length > 0, 'initial size requested')
    refusing = true
    const listed = h.fake.listCalls().length
    await until(h, () => h.fake.listCalls().length >= listed + 4, 'status polling has backed off', 20_000)
    const requestedAt = h.clock.now()

    await p.redraw(paneProps(150, 46))
    await until(h, () => h.fake.resizeCalls().some(c => c.args.cols === 150), 'size change wakes capture before backed-off status', 1_000)

    const changed = h.fake.resizeCalls().filter(c => c.args.cols === 150)
    expect(changed).toHaveLength(1)
    expect(changed[0]!.args.rows).toBe(43)
    expect(changed[0]!.at - requestedAt).toBeLessThanOrEqual(1_000)
    expectPaired(h, changed[0]!)
    await p.unmount()
    await b.unmount()
  })

  // TEST-17 / REQ-7: use real wire terminal states; keep one sibling live so both tabs stay listed.
  for (const ended of ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EMPTY']) {
    test(`R7.3 TEST-17: ${ended} slots are not resized, even when their retained screen is captured [${surface}]`, async ($, on) => {
      const h = harness(on, { neverFinal: true, frame: screen })
      await start($, surface)
      const r = await team($, h, 'finished-size', ['finished-model', 'live-model'])
      h.fake.set(r.runId, '01', ended)
      await h.clock.advance(POLL)
      const b = await mountBand($, surface, bandProps(180))
      await pressChip(b, 'finished-model', 'Show')
      const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 40))
      await until(h, () => h.fake.resizeCalls().some(c => c.args.slot === '02'), 'live sibling is resized')
      await p.redraw(paneProps(130, 44))
      await until(h, () => h.fake.resizeCalls().some(c => c.args.cols === 130), 'live sibling receives changed size')

      expect(h.fake.resizeCalls().map(c => c.args.slot)).toEqual(['02', '02'])
      expect(h.fake.captureCalls().some(c => c.args.slot === '01')).toBe(true)
      expect(visibleText(await p.drawn())).toContain(SCREEN)
      await p.unmount()
      await b.unmount()
    })
  }

  // TEST-17 / REQ-7: reach the mod's LOST state through a disappearing server row, not private state.
  test(`R7.3 TEST-17: a LOST slot is not resized while its live sibling still receives the panel size [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'lost-size', ['lost-model', 'surviving-model'])
    r.slots.splice(0, 1)
    await h.clock.advance(35_000)
    const b = await mountBand($, surface, bandProps(180))
    expect(visibleText(await b.drawn())).toContain(' LST ')

    await pressChip(b, 'lost-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 40))
    await until(h, () => h.fake.resizeCalls().length > 0, 'surviving sibling resizes')
    await p.redraw(paneProps(130, 44))
    await until(h, () => h.fake.resizeCalls().some(c => c.args.cols === 130), 'surviving sibling gets the changed size')

    expect(h.fake.resizeCalls().map(c => c.args.slot)).toEqual(['02', '02'])
    await p.unmount()
    await b.unmount()
  })

  // TEST-18 / REQ-2: positive Show control avoids an empty fake-call assertion passing vacuously.
  for (const unsupported of ['noResize', 'noCapture'] as const) {
    test(`R7.1 R7.3 TEST-18: ${unsupported} feed never receives resize when Show is opened or resized [${surface}]`, async ($, on) => {
      const h = harness(on, { [unsupported]: true, frame: screen })
      await start($, surface)
      await team($, h, 'unsupported-size', ['unsupported-model'])
      const b = await mountBand($, surface, bandProps(180))
      await pressChip(b, 'unsupported-model', 'Show')
      const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 40))
      await h.clock.advance(6_000)
      await p.redraw(paneProps(150, 46))
      await h.clock.advance(6_000)

      expect(h.fake.resizeCalls()).toHaveLength(0)
      expect(h.fake.listCalls().length).toBeGreaterThan(0)
      if (unsupported === 'noResize') {
        expect(h.fake.captureCalls().length).toBeGreaterThan(0)
        expect(visibleText(await p.drawn())).toContain(SCREEN)
      } else expect(h.fake.captureCalls()).toHaveLength(0)
      await p.unmount()
      await b.unmount()
    })
  }

  // TEST-19 / REQ-10, R10.1, R10.2: a hidden tab no longer waits for its 5-second capture; it is resized at the next tick.
  test(`R10.1 R10.2 TEST-19: an inactive tab gets a changed size at the next tick, ahead of its next capture [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'due-size', ['due-one', 'due-two'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'due-one', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 40))
    await until(h, () => h.fake.resizeCalls().length >= 2, 'both tabs receive initial size')
    const hiddenLast = h.fake.captureCalls().filter(c => c.args.slot === '02').at(-1)
    expect(hiddenLast).toBeDefined()
    expect(h.clock.now() - hiddenLast!.at).toBeLessThan(1_000)
    const before = h.fake.calls.length
    const redrawnAt = h.clock.now()

    await p.redraw(paneProps(145, 47))
    // The hidden tab's next capture is at least 4 s away (5-second cadence, last capture < 1 s ago);
    // R10.1 resizes it at the next poll tick instead, well inside that.
    await until(h, () => h.fake.resizeCalls().filter(c => c.args.cols === 145).length >= 2, 'both tabs resized at the next tick', 3_000)

    const changed = h.fake.resizeCalls().filter(c => c.args.cols === 145)
    expect(changed.map(c => c.args.slot).sort()).toEqual(['01', '02'])
    expect(changed.every(c => c.args.rows === 44)).toBe(true)
    const hidden = changed.find(c => c.args.slot === '02')!
    expect(hidden.at - redrawnAt).toBeLessThan(3_000)
    // no capture of the hidden tab came between the new drawing and its resize
    const hiddenIndex = h.fake.calls.indexOf(hidden)
    expect(h.fake.calls.slice(before, hiddenIndex).filter(c => isCapture(c) && c.args.slot === '02')).toHaveLength(0)
    expectBeforeOwnCapture(h, changed.find(c => c.args.slot === '01')!)
    await h.clock.advance(6_000) // once per size
    expect(h.fake.resizeCalls().filter(c => c.args.cols === 145)).toHaveLength(2)
    await p.unmount()
    await b.unmount()
  })

  // TEST-20 / R10.2 (replaces R7.3's "forgets"): the size belongs to the session, so Hide and reopen at the same size send nothing.
  test(`R10.2 TEST-20: Hide stops capture; reopening at the same size sends no resize, a new size sends one [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'reopen-size', ['reopen-model'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'reopen-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(128, 42))
    await until(h, () => h.fake.resizeCalls().length > 0, 'initial panel resized')
    await b.redraw()
    const hide = (await b.findAll({ type: 'Button' })).find(button => button.props.label === 'Hide')
    expect(hide).toBeDefined()

    await b.press({ key: hide!.key! })
    await p.unmount()
    expect(h.closes).toContain(SHOW_PANE)
    const count = h.fake.captureCalls().length
    await h.clock.advance(6_000)
    expect(h.fake.resizeCalls()).toHaveLength(1)
    expect(h.fake.captureCalls()).toHaveLength(count)
    await b.redraw()
    await pressChip(b, 'reopen-model', 'Show')
    const reopened = await mountPane($, surface, SHOW_PANE, paneProps(128, 42))
    // positive control: the reopened panel captures again, so a resize would have had its chance
    await until(h, () => h.fake.captureCalls().length > count, 'reopened panel captures again')
    await h.clock.advance(4_000)
    expect(h.fake.captureCalls().length).toBeGreaterThan(count + 1)
    expect(h.fake.resizeCalls().map(c => [c.args.cols, c.args.rows])).toEqual([[128, 39]])

    await reopened.redraw(paneProps(140, 42))
    await until(h, () => h.fake.resizeCalls().length >= 2, 'a new size is requested once')
    await h.clock.advance(3_000)
    expect(h.fake.resizeCalls().map(c => [c.args.cols, c.args.rows])).toEqual([[128, 39], [140, 39]])
    expectPaired(h, h.fake.resizeCalls()[1]!)
    await reopened.unmount()
    await b.unmount()
  })

  // TEST-21 / REQ-9, REQ-12, REQ-14: gone/failed resize must not end, replace, or poison the tab.
  for (const answer of ['success', 'unknown_run', 'unknown_session', 'unknown_slot', 'resize_unsupported'] as const) {
    test(`R7.4 TEST-21: ${answer} resize answer leaves the captured screen visible and does not suppress capture [${surface}]`, async ($, on) => {
      let resizeAnswered = false
      let holding = true
      let release: (() => void) | null = null
      on('mcp.call', {}, async (_$, e, next) => {
        const c = { server: e.server, tool: e.tool, args: (e.args ?? {}) as Json }
        if (holding && resizeAnswered && isCapture(c)) await new Promise<void>(r => { release = r })
        const result = await next(e)
        if (isResize(c)) resizeAnswered = true
        return result
      })
      const h = harness(on, { resizeError: answer === 'success' ? undefined : answer, frame: screen })
      await start($, surface)
      await team($, h, 'answer-size', ['answer-model'])
      const b = await mountBand($, surface, bandProps(180))
      await pressChip(b, 'answer-model', 'Show')
      await until(h, () => h.fake.captureCalls().length > 0, 'seed screen captured before the panel size is known')
      const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 40))
      try {
        await until(h, () => release !== null, 'capture after resize is held so its answer cannot mask a screen change')
        await p.redraw()
        // Observe the tab AFTER resize answers, but BEFORE its following capture can overwrite it.
        expect(frameLines(await p.drawn())).toEqual([SCREEN, 'child prompt'])
        const pendingText = visibleText(await p.drawn())
        expect(pendingText).not.toContain('resize refused')
        expect(pendingText).not.toContain('failed:')
        expect(pendingText).not.toContain('not retained')
        const first = h.fake.captureCalls().length

        holding = false
        ;(release as (() => void) | null)?.()
        await until(h, () => h.fake.captureCalls().length > first, 'capture still succeeds after the resize answer')
        await h.clock.advance(5_000)
        await p.redraw()

        expect(h.fake.resizeCalls()).toHaveLength(1)
        expect(h.fake.captureCalls().length).toBeGreaterThan(first)
        expectPaired(h, h.fake.resizeCalls()[0]!)
        expect(frameLines(await p.drawn())).toEqual([SCREEN, 'child prompt'])
        if (answer === 'resize_unsupported') expect(h.debug.filter(t => t.startsWith('claudish Show resize to '))).toEqual([
          'claudish Show resize to 120x37 failed: resize_unsupported',
        ])
        else expect(h.debug.filter(t => t.startsWith('claudish Show resize to '))).toEqual([])
      } finally {
        holding = false
        ;(release as (() => void) | null)?.()
        await h.clock.settle()
        await p.unmount()
        await b.unmount()
      }
    })
  }

  // TEST-22 / REQ-3, R9.1: the 40-column request minimum does not make a narrower drawing wider than the panel.
  test(`R9.1 TEST-22: a panel under 40 columns asks for 40x24 but still cuts the captured wide line [${surface}]`, async ($, on) => {
    const long = `wide-child-${'x'.repeat(149)}`
    const h = harness(on, { frame: ({ seq, final }) => ({ seq, final, cols: 160, rows: 1, cursor: null, lines: [long] }) })
    await start($, surface)
    await team($, h, 'cut-size', ['cut-model'])
    const b = await mountBand($, surface, bandProps(180))
    await pressChip(b, 'cut-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(35, 20))
    await until(h, () => h.fake.resizeCalls().length > 0, 'minimum size requested')
    await p.redraw()

    expect(h.fake.resizeCalls().map(c => [c.args.cols, c.args.rows])).toEqual([[40, 24]])
    const lines = frameLines(await p.drawn())
    expect(lines).toHaveLength(1)
    // Existing R6 viewport convention includes one extra character before terminal clipping.
    expect(lines[0]).toBe(long.slice(0, 36))
    expect(lines[0]).not.toBe(long)
    await p.unmount()
    await b.unmount()
  })
}
