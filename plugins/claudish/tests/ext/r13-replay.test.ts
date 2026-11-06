// Spec-derived replay coverage. Run with claude plugin test in the host environment.
// Only rendered output, declared state, engine inputs and external MCP traffic are observed.
import type { On, UiScrollInput } from 'claude-code'
import { expect, type Engine } from 'claude-code/testing'
import { test } from '../kit'
import type { ClaudishPaneView, ClaudishReplays, ClaudishShowTab } from '../../types'
import { resetReplay } from '../../hooks/status/replay'
import { resetText } from '../../hooks/status/transcript'
import {
  CREATE_TOOL, SERVERS, TEAM_TOOL, harness, start,
  type FakeOptions, type Harness, type ListOverride, type Recorded,
} from '../fake-claudish'
import { contractError } from '../scenario'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, type Mounted, type Surface } from '../ui'
import { modelCall, POLL, team } from './support'
import { pressChip, visibleText } from './v2-support'

// Independent expected values from replay-api.d.ts, not production imports.
const CAPTURE = 500
const QUIET_CAPTURE = 2_000
const QUIET_AFTER = 5_000
const WATCH = 1_000
const OPEN_TIMEOUT = 15_000
const OPENING = 'Opening the session…'
const SHOW = 'claudish-show'
const KINDS = ['panel', 'delegation'] as const
type Kind = typeof KINDS[number]
type Child = { kind: Kind; server: string; token: string; address: string; slot: string; model: string }
type Views = { b: Mounted; p: Mounted }
const wire = ({ server, tool, args }: Recorded) => ({ server, tool, args })
const answer = (body: unknown): ListOverride => ({ text: JSON.stringify(body) })
const failure = (code: string): ListOverride => ({ text: contractError(code, 'replay cannot start'), isError: true })
const transcript = (model: string) => 'TEXT ' + model

function world(on: On, id: string, options: FakeOptions = {}) {
  resetReplay()
  resetText()
  const h = harness(on, {
    listReplay: true, listTranscript: true, listScroll: true,
    sessionId: n => id + '-session-' + n,
    frame: ({ model, seq, final }) => ({
      seq, final, cols: 120, rows: 2, cursor: null, lines: ['SCREEN ' + model, 'child prompt'],
    }),
    ...options,
  })
  // A person event can fall through to the engine. This does not implement plugin-origin ui.scroll.
  on('ui.scroll', (_$, e) => e.origin.kind === 'person' ? {} : { deny: 'test kit has no plugin scroll' })
  h.fake.options.transcriptAnswer ??= call => {
    const c = targets(h).find(c => original(call, c))
    return answer({ cursor: 'done', more: false, final: true,
      lines: [{ kind: 'assistant', text: transcript(c?.model ?? 'unknown child') }] })
  }
  return h
}
function targets(h: Harness, server: string = SERVERS[0]): Child[] {
  return [
    ...h.fake.runs.flatMap(r => r.slots.map(s => ({
      kind: 'panel' as const, server, token: r.runId, address: r.path, slot: s.slot, model: s.model,
    }))),
    ...h.fake.sessions.map(s => ({
      kind: 'delegation' as const, server, token: s.id, address: s.id, slot: s.id, model: s.model,
    })),
  ]
}
function original(c: Recorded, child: Child) {
  // Identity alone is enough here: transcript answers may use either declared server name.
  return child.kind === 'panel'
    ? c.tool === 'team' && c.args.run_id === child.token && c.args.path === child.address && c.args.slot === child.slot
    : c.args.session_id === child.token
}
function openAddress(child: Child) {
  return child.kind === 'panel'
    ? { server: child.server, tool: 'team', args: { mode: 'replay', path: child.address, slot: child.slot, run_id: child.token } }
    : { server: child.server, tool: 'replay_session', args: { session_id: child.token } }
}
function expectOpen(c: Recorded, child: Child, size?: { cols: number; rows: number }) {
  const { cols, rows, ...address } = c.args
  expect({ ...wire(c), args: address }).toEqual(openAddress(child))
  if (size) expect({ cols, rows }).toEqual(size)
}
const opens = (h: Harness) => h.fake.replayOpenCalls()
const closes = (h: Harness) => h.fake.replayCloseCalls()
const replayReads = (h: Harness, id: string) => h.fake.captureCalls().filter(c => c.args.session_id === id)
const replayControls = (h: Harness, ids: string[], from = 0) => h.fake.calls.slice(from).filter(c =>
  ids.includes(String(c.args.session_id)) && ['capture_session', 'resize_session', 'scroll_session'].includes(c.tool))
function active(h: Harness) {
  const id = (h.state.get('showTab') as ClaudishShowTab | undefined)?.active
  if (!id) throw new Error('Show did not publish an active tab')
  return id
}
function replays(h: Harness): ClaudishReplays {
  const value = h.state.get('replays') as ClaudishReplays | undefined
  if (!value) throw new Error('replays state was not published')
  return value
}
function shownId(h: Harness) {
  const replay = replays(h)[active(h)]
  if (!replay) throw new Error('shown tab has no published replay')
  return replay.replayId
}
async function until(h: Harness, ready: () => boolean, message: string, within = 3_000) {
  await h.clock.settle()
  for (let elapsed = 0; !ready() && elapsed < within; elapsed += 25) await h.clock.advance(25)
  expect(ready(), message).toBe(true)
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
async function children($: Engine, h: Harness, id: string, kind: Kind, n = 1, server: string = SERVERS[0]) {
  const models = Array.from({ length: n }, (_, i) => 'child-' + (i + 1))
  if (kind === 'panel') {
    await team($, h, id, models, server === SERVERS[0] ? TEAM_TOOL : 'mcp__claudish__team')
  } else {
    for (const model of models) await modelCall($, server === SERVERS[0] ? CREATE_TOOL : 'mcp__claudish__create_session', {
      model, prompt: 'An isolated test task',
    })
    await h.clock.advance(POLL)
  }
  return targets(h, server)
}
async function finish(h: Harness, list: Child[], state = 'COMPLETED') {
  for (const c of list) h.fake.set(c.token, c.slot, state)
  await h.clock.advance(POLL)
}
async function press(p: Mounted, label: string) {
  await p.redraw()
  const buttons = (await p.findAll({ type: 'Button' })).filter(b => b.props.label === label)
  expect(buttons, 'one visible ' + label + ' button').toHaveLength(1)
  expect(typeof buttons[0]!.key).toBe('string')
  await p.press({ key: buttons[0]!.key! })
}
async function mode(p: Mounted, wanted: 'screen' | 'text') {
  await p.redraw()
  const labels = (await p.findAll({ type: 'Button' })).map(b => b.props.label)
  expect(labels.filter(l => l === (wanted === 'screen' ? 'Text' : 'Screen'))).toHaveLength(1)
  expect(labels).not.toContain(wanted === 'screen' ? 'Screen' : 'Text')
}
async function drawn(p: Mounted) { await p.redraw(); return visibleText(await p.drawn()) }
async function open($: Engine, h: Harness, surface: Surface, child: Child, cols = 120, rows = 32): Promise<Views> {
  const b = await mountBand($, surface, bandProps(240, 60))
  let p: Mounted | undefined
  try {
    await pressChip(b, child.model, 'Show')
    p = await mountPane($, surface, SHOW, paneProps(cols, rows))
    await h.clock.settle()
    return { b, p }
  } catch (error) {
    if (p) await p.unmount()
    await b.unmount()
    throw error
  }
}
async function ready(h: Harness, p: Mounted) {
  await until(h, () => Boolean((h.state.get('replays') as ClaudishReplays | undefined)?.[
    (h.state.get('showTab') as ClaudishShowTab | undefined)?.active ?? ''
  ]), 'selected replay allocated')
  const id = shownId(h)
  await until(h, () => replayReads(h, id).length > 0, 'replay screen captured')
  await p.redraw()
  return id
}
function wheel(by: number): UiScrollInput {
  return { component: 'Pane', requestId: SHOW, offset: 0, by, bodyRows: 30, contentRows: 2, origin: { kind: 'person' } }
}
function readOnly(h: Harness) {
  const ids = h.fake.replays.map(r => r.id)
  expect(h.fake.calls.filter(c => c.tool === 'send_input' && ids.includes(String(c.args.session_id)))).toEqual([])
  const addressed = h.fake.calls.filter(c =>
    ids.includes(String(c.args.session_id)) || ids.includes(String(c.args.replay_id)))
  expect(addressed.every(c => ['capture_session', 'resize_session', 'scroll_session', 'close_replay'].includes(c.tool))).toBe(true)
}
async function dispose(h: Harness, views?: Views) {
  h.panes = []
  if (views) { await views.p.unmount(); await views.b.unmount() }
  try {
    await h.clock.advance(WATCH + 25)
    readOnly(h)
  } finally {
    resetReplay()
    resetText()
  }
}
async function expectClosed(h: Harness, ids: string[]) {
  await until(h, () => ids.every(id => closes(h).some(c => c.args.replay_id === id)), 'all replay processes closed', WATCH + 25)
  for (const id of ids) {
    const allocated = h.fake.replays.find(r => r.id === id)
    const sent = closes(h).filter(c => c.args.replay_id === id)
    expect(sent.map(wire)).toEqual([{ server: allocated?.server ?? SERVERS[0], tool: 'close_replay', args: { replay_id: id } }])
  }
  expect(replays(h)).toEqual({})
}

for (const surface of SURFACES) {
  for (const kind of KINDS) {
    for (const server of SERVERS) {
      // REQ-1..5, REQ-11, REQ-12, REQ-28, REQ-32, REQ-33, REQ-38.
      test('TEST-1: six finished ' + kind + (kind === 'panel' ? ' slots open only the selected replay and reuse visited tabs [' : ' runs expose only the latest tab and reuse its replay [') + surface + ', ' + server + ']', async ($, on) => {
        const id = 'r13-six-' + surface + '-' + kind + '-' + server
        const h = world(on, id)
        await start($, surface)
        const list = await children($, h, id, kind, 6, server)
        // Finished delegations expose only the latest run; a panel retains all its slots.
        const firstChild = kind === 'delegation' ? list[5]! : list[3]!
        const secondChild = kind === 'delegation' ? list[3]! : list[1]!
        await finish(h, list)
        expect(opens(h)).toEqual([])
        const v = await open($, h, surface, firstChild)
        try {
          const first = await ready(h, v.p)
          const firstTab = active(h)
          expect(opens(h)).toHaveLength(1)
          expectOpen(opens(h)[0]!, firstChild)
          await mode(v.p, 'screen')
          expect(await drawn(v.p)).toContain('REPLAY ' + firstChild.model)
          expect(replays(h)).toEqual({ [firstTab]: { server, replayId: first } })

          if (kind === 'delegation') {
            const labels = (await v.p.findAll({ type: 'Button' })).map(b => b.props.label)
            for (const child of list.slice(0, -1)) expect(labels).not.toContain(child.model)
            const originalCount = h.fake.captureCalls().filter(c => original(c, firstChild)).length
            await press(v.p, firstChild.model)
            await h.clock.advance(CAPTURE * 3)
            expect(shownId(h)).toBe(first)
            expect(opens(h)).toHaveLength(1)
            expect(closes(h)).toEqual([])
            expect(h.fake.captureCalls().filter(c => original(c, firstChild))).toHaveLength(originalCount)
            expect(replayReads(h, first).every(c => c.tool === 'capture_session' && c.server === server)).toBe(true)
            return
          }

          await press(v.p, secondChild.model)
          const second = await ready(h, v.p)
          expect(second).not.toBe(first)
          expect(opens(h)).toHaveLength(2)
          expectOpen(opens(h)[1]!, secondChild)
          expect(closes(h)).toEqual([])
          const oldCount = replayReads(h, first).length
          const originalCount = h.fake.captureCalls().filter(c => original(c, secondChild)).length
          await h.clock.advance(CAPTURE * 3)
          expect(replayReads(h, first)).toHaveLength(oldCount)
          expect(h.fake.captureCalls().filter(c => original(c, secondChild))).toHaveLength(originalCount)
          expect(await drawn(v.p)).toContain('REPLAY ' + secondChild.model)
          expect(Object.values(replays(h))).toHaveLength(2)

          await press(v.p, firstChild.model)
          await until(h, () => replayReads(h, first).length > oldCount, 'revisited replay captured again')
          expect(shownId(h)).toBe(first)
          expect(opens(h)).toHaveLength(2)
          expect(closes(h)).toEqual([])
          expect(await drawn(v.p)).toContain('REPLAY ' + firstChild.model)
          for (const replayId of [first, second]) {
            expect(replayReads(h, replayId).every(c => c.tool === 'capture_session' && c.server === server)).toBe(true)
          }
        } finally { await dispose(h, v) }
      })
    }

    for (const state of ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EMPTY']) {
      // REQ-3, REQ-6, REQ-10: use the live child's size as the panel's public measurement.
      test('TEST-2: shown live ' + kind + ' opens one size-bearing replay on ' + state + ' [' + surface + ']', async ($, on) => {
        const id = 'r13-ended-' + surface + '-' + kind + '-' + state
        const h = world(on, id)
        await start($, surface)
        const list = await children($, h, id, kind)
        const v = await open($, h, surface, list[0]!, 130, 42)
        try {
          await until(h, () => h.fake.resizeCalls().some(c => original(c, list[0]!)), 'live panel size measured')
          const sized = h.fake.resizeCalls().filter(c => original(c, list[0]!)).at(-1)!
          expect(opens(h)).toEqual([])

          await finish(h, list, state)
          await ready(h, v.p)

          expect(opens(h)).toHaveLength(1)
          expectOpen(opens(h)[0]!, list[0]!, { cols: Number(sized.args.cols), rows: Number(sized.args.rows) })
          await mode(v.p, 'screen')
        } finally { await dispose(h, v) }
      })
    }

    for (const placement of ['closed', 'unplaced'] as const) {
      // REQ-3, REQ-7.
      test('TEST-3: an ending ' + kind + ' opens nothing while Show is ' + placement + ' [' + surface + ']', async ($, on) => {
        const id = 'r13-placement-' + surface + '-' + kind + '-' + placement
        const h = world(on, id)
        await start($, surface)
        const list = await children($, h, id, kind)
        const v = await open($, h, surface, list[0]!)
        try {
          if (placement === 'closed') await press(v.p, 'Hide')
          else h.panes = h.panes.map(p => ({ ...p, isPlaced: false, isShown: false }))
          await finish(h, list)
          for (let i = 0; i < 4; i++) { await v.p.redraw(); await h.clock.advance(WATCH) }
          expect(opens(h)).toEqual([])
        } finally { await dispose(h, v) }
      })
    }

    // REQ-8, REQ-13.
    test('TEST-4: a held ' + kind + ' open survives redraws with one request and an opening message [' + surface + ']', async ($, on) => {
      const id = 'r13-opening-' + surface + '-' + kind
      const held = gate()
      const h = world(on, id, {
        noPane: ['01', id + '-session-1'],
        replayOpenAnswer: async () => { await held.promise; return undefined },
      })
      await start($, surface)
      const list = await children($, h, id, kind)
      const v = await open($, h, surface, list[0]!)
      try {
        await finish(h, list)
        await until(h, () => opens(h).length === 1, 'open is pending')
        for (let i = 0; i < 5; i++) {
          expect(await drawn(v.p)).toContain(OPENING)
          await h.clock.advance(CAPTURE)
        }
        expect(opens(h)).toHaveLength(1)
        held.release()
        await ready(h, v.p)
        expect(await drawn(v.p)).toContain('REPLAY ' + list[0]!.model)
        expect(await drawn(v.p)).not.toContain(OPENING)
      } finally { held.release(); await h.clock.settle(); await dispose(h, v) }
    })

    // REQ-9, REQ-15.
    test('TEST-5: explicit Text prevents ' + kind + ' replay and both tabs retain their own modes [' + surface + ']', async ($, on) => {
      const id = 'r13-modes-' + surface + '-' + kind
      const h = world(on, id)
      await start($, surface)
      const list = await children($, h, id, kind, 2)
      if (kind === 'delegation') list.reverse()
      const v = await open($, h, surface, list[0]!)
      try {
        await press(v.p, 'Text')
        await finish(h, kind === 'panel' ? list : [list[0]!])
        await h.clock.advance(WATCH * 2)
        await mode(v.p, 'text')
        expect(opens(h)).toEqual([])
        expect(await drawn(v.p)).toContain(transcript(list[0]!.model))

        await press(v.p, list[1]!.model)
        if (kind === 'panel') await ready(h, v.p)
        else {
          await h.clock.advance(WATCH)
          expect(opens(h)).toEqual([])
        }
        await mode(v.p, 'screen')
        await press(v.p, list[0]!.model)
        await mode(v.p, 'text')
        expect(opens(h)).toHaveLength(kind === 'panel' ? 1 : 0)
        await press(v.p, 'Screen')
        await ready(h, v.p)
        expect(opens(h)).toHaveLength(kind === 'panel' ? 2 : 1)
        expectOpen(opens(h).at(-1)!, list[0]!)
        await press(v.p, list[1]!.model)
        await press(v.p, 'Text')
        await press(v.p, list[0]!.model)
        await mode(v.p, 'screen')
        await press(v.p, list[1]!.model)
        await mode(v.p, 'text')
        expect(opens(h)).toHaveLength(kind === 'panel' ? 2 : 1)
      } finally { await dispose(h, v) }
    })

    // REQ-2, REQ-14.
    test('TEST-6: finished ' + kind + ' without replay support draws Text and never opens a replay [' + surface + ']', async ($, on) => {
      const id = 'r13-no-cap-' + surface + '-' + kind
      const h = world(on, id, { listReplay: false })
      await start($, surface)
      const list = await children($, h, id, kind)
      await finish(h, list)
      const v = await open($, h, surface, list[0]!)
      try {
        await until(h, () => h.fake.transcriptCalls().length > 0, 'fallback transcript requested')
        await mode(v.p, 'text')
        expect(await drawn(v.p)).toContain(transcript(list[0]!.model))
        await h.clock.advance(OPEN_TIMEOUT + WATCH)
        expect(opens(h)).toEqual([])
      } finally { await dispose(h, v) }
    })

    const failures: { name: string; response: ListOverride }[] = [
      { name: 'unavailable', response: failure('replay_unavailable') },
      ...['unknown_run', 'unknown_session', 'unknown_slot'].map(code => ({ name: code, response: failure(code) })),
      { name: 'unparseable', response: { text: 'not JSON' } },
      { name: 'rejected', response: { deny: 'connection closed' } },
    ]
    for (const f of failures) {
      // REQ-16, REQ-17, REQ-18.
      test('TEST-7: ' + kind + ' ' + f.name + ' falls back once, isolates its sibling and retries only after reopening [' + surface + ']', async ($, on) => {
        const id = 'r13-failed-' + surface + '-' + kind + '-' + f.name
        const h = world(on, id)
        await start($, surface)
        const list = await children($, h, id, kind, 2)
        // Only the visible band entry is used for Show; the sibling is selected in the pane.
        if (kind === 'delegation') list.reverse()
        h.fake.options.replayOpenAnswer = (call, n) => original(call, list[0]!) && n === 1 ? f.response : undefined
        await finish(h, kind === 'panel' ? list : [list[0]!])
        const v = await open($, h, surface, list[0]!)
        try {
          await until(h, () => h.fake.transcriptCalls().some(c => original(c, list[0]!)), 'failure falls back to transcript')
          await mode(v.p, 'text')
          expect(await drawn(v.p)).toContain(transcript(list[0]!.model))
          for (let i = 0; i < 3; i++) { await v.p.redraw(); await h.clock.advance(WATCH) }
          expect(opens(h)).toHaveLength(1)

          await press(v.p, list[1]!.model)
          if (kind === 'panel') await ready(h, v.p)
          else {
            await h.clock.advance(WATCH)
            await mode(v.p, 'screen')
            expect(await drawn(v.p)).toContain('SCREEN ' + list[1]!.model)
          }
          expect(opens(h)).toHaveLength(kind === 'panel' ? 2 : 1)
          await press(v.p, list[0]!.model)
          await mode(v.p, 'text')
          await h.clock.advance(WATCH * 2)
          expect(opens(h)).toHaveLength(kind === 'panel' ? 2 : 1)
          await press(v.p, 'Hide')
          await h.clock.settle()
          await v.b.redraw()
          await pressChip(v.b, list[0]!.model, 'Show')
          await v.p.redraw()
          await ready(h, v.p)
          expect(opens(h)).toHaveLength(kind === 'panel' ? 3 : 2)
          expectOpen(opens(h).at(-1)!, list[0]!)
          await mode(v.p, 'screen')
        } finally { await dispose(h, v) }
      })
    }

    // REQ-16, REQ-17, REQ-20.
    test('TEST-8: ' + kind + ' open times out at 15000 ms and its late id closes immediately [' + surface + ']', async ($, on) => {
      const id = 'r13-timeout-' + surface + '-' + kind
      const held = gate()
      const h = world(on, id, { replayOpenAnswer: async () => { await held.promise; return undefined } })
      await start($, surface)
      const list = await children($, h, id, kind)
      const v = await open($, h, surface, list[0]!)
      try {
        await finish(h, list)
        await until(h, () => opens(h).length === 1, 'open pending')
        const deadline = opens(h)[0]!.at + OPEN_TIMEOUT
        await h.clock.advance(deadline - 1 - h.clock.now())
        await mode(v.p, 'screen')
        expect(h.fake.transcriptCalls()).toEqual([])
        await h.clock.advance(2)
        await v.p.redraw()
        await h.clock.settle()
        await mode(v.p, 'text')
        expect(await drawn(v.p)).toContain(transcript(list[0]!.model))
        expect(opens(h)).toHaveLength(1)

        const arrivedAt = h.clock.now()
        held.release()
        await h.clock.settle()
        expect(h.fake.replays).toHaveLength(1)
        const late = h.fake.replays[0]!.id
        expect(closes(h).map(wire)).toEqual([{ server: list[0]!.server, tool: 'close_replay', args: { replay_id: late } }])
        expect(closes(h)[0]!.at).toBe(arrivedAt)
        expect(replayControls(h, [late])).toEqual([])
        expect(replays(h)).toEqual({})
        await h.clock.advance(WATCH * 3)
        expect(opens(h)).toHaveLength(1)
      } finally { held.release(); await h.clock.settle(); await dispose(h, v) }
    })

    for (const stopped of ['final-frame', 'final-unchanged', 'gone'] as const) {
      // REQ-17, REQ-19.
      test('TEST-9: ' + kind + ' replay capture ' + stopped + ' switches to Text and never captures again [' + surface + ']', async ($, on) => {
        const id = 'r13-stopped-' + surface + '-' + kind + '-' + stopped
        const h = world(on, id)
        await start($, surface)
        const list = await children($, h, id, kind)
        await finish(h, list)
        const v = await open($, h, surface, list[0]!)
        try {
          const replayId = await ready(h, v.p)
          h.fake.options.replayCaptureAnswer = () => stopped === 'gone' ? failure('unknown_session')
            : stopped === 'final-unchanged' ? answer({ seq: 1, unchanged: true, final: true })
              : answer({ seq: 71, final: true, cols: 100, rows: 1, cursor: null, lines: ['final replay frame'] })
          const before = replayReads(h, replayId).length
          await until(h, () => replayReads(h, replayId).length > before, 'terminal replay capture')
          await v.p.redraw()
          await h.clock.settle()
          await mode(v.p, 'text')
          expect(await drawn(v.p)).toContain(transcript(list[0]!.model))
          const after = replayReads(h, replayId).length
          await h.clock.advance(QUIET_AFTER + QUIET_CAPTURE * 2)
          await v.p.redraw()
          expect(replayReads(h, replayId)).toHaveLength(after)
          expect(opens(h)).toHaveLength(1)
        } finally { await dispose(h, v) }
      })
    }

    for (const control of ['pane', 'band'] as const) {
      // REQ-1, REQ-21, REQ-26, REQ-28, REQ-38.
      test('TEST-10: ' + control + ' Hide closes all visible ' + kind + ' replays once and silences closed ids [' + surface + ']', async ($, on) => {
        const id = 'r13-hide-' + surface + '-' + kind + '-' + control
        const h = world(on, id)
        await start($, surface)
        const list = await children($, h, id, kind, kind === 'panel' ? 2 : 1)
        await finish(h, list)
        const v = await open($, h, surface, list[0]!)
        try {
          const ids = [await ready(h, v.p)]
          if (kind === 'panel') {
            await press(v.p, list[1]!.model)
            ids.push(await ready(h, v.p))
          }
          await press(control === 'pane' ? v.p : v.b, 'Hide')
          await expectClosed(h, ids)
          const boundary = h.fake.calls.length

          await v.p.redraw(paneProps(150, 48))
          await $.ui.scroll(wheel(-3))
          await h.clock.advance(QUIET_AFTER + QUIET_CAPTURE * 2)

          expect(replayControls(h, ids, boundary)).toEqual([])
          expect(closes(h)).toHaveLength(ids.length)
          expect(opens(h)).toHaveLength(ids.length)
          expect(replays(h)).toEqual({})
        } finally { await dispose(h, v) }
      })
    }

    for (const route of ['escape', 'forecast', 'narrow'] as const) {
      // REQ-22, REQ-26. These are host pane-list outcomes, not invented dismissal events.
      test('TEST-11: ' + route + ' placement loss closes every ' + kind + ' replay within the watch bound [' + surface + ']', async ($, on) => {
        const id = 'r13-watch-' + surface + '-' + kind + '-' + route
        const h = world(on, id)
        await start($, surface)
        const list = await children($, h, id, kind, kind === 'panel' ? 2 : 1)
        await finish(h, list)
        const v = await open($, h, surface, list[0]!)
        try {
          const ids = [await ready(h, v.p)]
          if (kind === 'panel') {
            await press(v.p, list[1]!.model)
            ids.push(await ready(h, v.p))
          }
          const at = h.clock.now()
          h.panes = route === 'escape' ? [] : route === 'forecast'
            ? [{ id: 'claudish-allowance', title: 'Codex allowance', isPlaced: true, isShown: true, isFocused: false }]
            : h.panes.map(p => ({ ...p, isPlaced: false, isShown: false }))
          // No redraw, ui.close, or event: only the watcher may discover this.
          await h.clock.advance(WATCH + 25)
          await expectClosed(h, ids)
          expect(closes(h).every(c => c.at - at <= WATCH + 25)).toBe(true)
          const boundary = h.fake.calls.length
          await h.clock.advance(QUIET_AFTER)
          expect(replayControls(h, ids, boundary)).toEqual([])
          expect(opens(h)).toHaveLength(ids.length)
        } finally { await dispose(h, v) }
      })
    }

    for (const route of ['Hide', 'clear'] as const) {
      // REQ-23, REQ-25, REQ-26.
      test('TEST-12: ' + kind + ' open arriving after ' + route + ' closes without any reads [' + surface + ']', async ($, on) => {
        const id = 'r13-late-' + surface + '-' + kind + '-' + route
        const held = gate()
        const h = world(on, id, { replayOpenAnswer: async () => { await held.promise; return undefined } })
        await start($, surface)
        const list = await children($, h, id, kind)
        const v = await open($, h, surface, list[0]!)
        try {
          await finish(h, list)
          await until(h, () => opens(h).length === 1, 'pending open')
          if (route === 'Hide') await press(v.p, 'Hide')
          else await $.session.end({ reason: 'clear', sessionId: id, resume: { id } })
          await h.clock.advance(WATCH + 25)
          const at = h.clock.now()
          held.release()
          await h.clock.settle()
          expect(h.fake.replays).toHaveLength(1)
          const late = h.fake.replays[0]!.id
          await expectClosed(h, [late])
          expect(closes(h)[0]!.at).toBe(at)
          expect(replayControls(h, [late])).toEqual([])
          await h.clock.advance(QUIET_AFTER)
          expect(opens(h)).toHaveLength(1)
          expect(closes(h)).toHaveLength(1)
        } finally { held.release(); await h.clock.settle(); await dispose(h, v) }
      })
    }

    // REQ-25, REQ-26.
    test('TEST-14: clear closes all ' + kind + ' replays and leaves no traffic [' + surface + ']', async ($, on) => {
      const id = 'r13-clear-' + surface + '-' + kind
      const h = world(on, id)
      await start($, surface)
      const list = await children($, h, id, kind, kind === 'panel' ? 2 : 1)
      await finish(h, list)
      const v = await open($, h, surface, list[0]!)
      try {
        const ids = [await ready(h, v.p)]
        if (kind === 'panel') {
          await press(v.p, list[1]!.model)
          ids.push(await ready(h, v.p))
        }
        await $.session.end({ reason: 'clear', sessionId: id, resume: { id } })
        await expectClosed(h, ids)
        const boundary = h.fake.calls.length
        await h.clock.advance(OPEN_TIMEOUT)
        expect(replayControls(h, ids, boundary)).toEqual([])
        expect(closes(h)).toHaveLength(ids.length)
      } finally { await dispose(h, v) }
    })

    // REQ-26, REQ-27, REQ-38.
    test('TEST-15: reopening ' + kind + ' retains its last screen while only the selected tab gets a fresh replay [' + surface + ']', async ($, on) => {
      const id = 'r13-reopen-' + surface + '-' + kind
      const held = gate()
      const h = world(on, id)
      await start($, surface)
      const list = await children($, h, id, kind, kind === 'panel' ? 2 : 1)
      await finish(h, list)
      const v = await open($, h, surface, list[0]!)
      try {
        const ids = [await ready(h, v.p)]
        if (kind === 'panel') {
          await press(v.p, list[1]!.model)
          ids.push(await ready(h, v.p))
        }
        const retained = kind === 'delegation' ? list[0]! : list[1]!
        const cached = 'REPLAY ' + retained.model
        expect(await drawn(v.p)).toContain(cached)
        await press(v.p, 'Hide')
        await expectClosed(h, ids)
        const kept = h.state.get('panes/' + active(h)) as ClaudishPaneView | undefined
        expect(kept?.frame?.lines.join('\n')).toContain(cached)
        h.fake.options.replayOpenAnswer = async () => { await held.promise; return undefined }
        await v.b.redraw()
        await pressChip(v.b, retained.model, 'Show')
        await v.p.redraw()
        await until(h, () => opens(h).length === ids.length + 1, 'one fresh replay opening')
        expectOpen(opens(h)[ids.length]!, retained)
        expect(await drawn(v.p)).toContain(cached)
        expect(await drawn(v.p)).not.toContain(OPENING)
        held.release()
        await h.clock.settle()
        const fresh = await ready(h, v.p)
        expect(ids).not.toContain(fresh)
        expect(Object.values(replays(h))).toEqual([{ server: retained.server, replayId: fresh }])
        expect(opens(h)).toHaveLength(ids.length + 1)
        const boundary = h.fake.calls.length
        await h.clock.advance(QUIET_AFTER)
        expect(replayControls(h, ids, boundary)).toEqual([])
      } finally { held.release(); await h.clock.settle(); await dispose(h, v) }
    })

    // REQ-12, REQ-30, REQ-31, REQ-32.
    test('TEST-17: ' + kind + ' captures at 500 ms, quiets after 5000 ms and carries the last drawn seq [' + surface + ']', async ($, on) => {
      const id = 'r13-cadence-' + surface + '-' + kind
      let seq = 41
      const h = world(on, id, { noResize: true, replayCaptureAnswer: call =>
        call.args.since_seq === seq ? answer({ unchanged: true, seq, final: false })
          : answer({ seq, final: false, cols: 100, rows: 1, cursor: null, lines: ['REPLAY frame ' + seq] }),
      })
      await start($, surface)
      const list = await children($, h, id, kind)
      await finish(h, list)
      const v = await open($, h, surface, list[0]!)
      try {
        const replayId = await ready(h, v.p)
        const first = replayReads(h, replayId)[0]!
        expect(first.args.since_seq).toBe(0)
        expect(await drawn(v.p)).toContain('REPLAY frame 41')
        const originalCount = h.fake.captureCalls().filter(c => original(c, list[0]!)).length
        for (let i = 1; i <= 9; i++) {
          const due = first.at + i * CAPTURE
          await h.clock.advance(due - 1 - h.clock.now())
          expect(replayReads(h, replayId)).toHaveLength(i)
          await h.clock.advance(1)
          expect(replayReads(h, replayId)).toHaveLength(i + 1)
          expect(replayReads(h, replayId).at(-1)!.at).toBe(due)
          expect(replayReads(h, replayId).at(-1)!.args.since_seq).toBe(41)
        }
        // Permit either scheduling choice at the exact transition; measure steady quiet cadence.
        await h.clock.advance(first.at + QUIET_AFTER + QUIET_CAPTURE * 2 - h.clock.now())
        const quiet = replayReads(h, replayId).filter(c => c.at > first.at + QUIET_AFTER)
        expect(quiet.length).toBeGreaterThanOrEqual(2)
        expect(quiet.slice(1).map((c, i) => c.at - quiet[i]!.at)).toEqual(new Array(quiet.length - 1).fill(QUIET_CAPTURE))
        const last = replayReads(h, replayId).at(-1)!
        const count = replayReads(h, replayId).length
        await h.clock.advance(last.at + QUIET_CAPTURE - 1 - h.clock.now())
        expect(replayReads(h, replayId)).toHaveLength(count)
        seq = 73
        await h.clock.advance(1)
        expect(replayReads(h, replayId)).toHaveLength(count + 1)
        expect(replayReads(h, replayId).at(-1)!.args.since_seq).toBe(41)
        expect(await drawn(v.p)).toContain('REPLAY frame 73')
        await h.clock.advance(QUIET_CAPTURE)
        expect(replayReads(h, replayId).at(-1)!.args.since_seq).toBe(73)
        expect(replayReads(h, replayId).every(c => c.tool === 'capture_session')).toBe(true)
        expect(h.fake.captureCalls().filter(c => original(c, list[0]!))).toHaveLength(originalCount)
      } finally { await dispose(h, v) }
    })

    // REQ-34, REQ-38.
    test('TEST-18: resizing a shown ' + kind + ' replay uses its id before the next capture' + (kind === 'panel' ? ', not its hidden sibling [' : ' [') + surface + ']', async ($, on) => {
      const id = 'r13-resize-' + surface + '-' + kind
      const h = world(on, id)
      await start($, surface)
      const list = await children($, h, id, kind, kind === 'panel' ? 2 : 1)
      const v = await open($, h, surface, list[0]!, 120, 32)
      try {
        await v.p.redraw(paneProps(145, 46))
        await until(h, () => h.fake.resizeCalls().some(c => original(c, list[0]!) && c.args.cols === 145), 'live size baseline')
        const sizeCall = h.fake.resizeCalls().filter(c => original(c, list[0]!) && c.args.cols === 145).at(-1)!
        await v.p.redraw(paneProps(120, 32))
        await finish(h, list)
        const ids = [await ready(h, v.p)]
        if (kind === 'panel') {
          await press(v.p, list[1]!.model)
          ids.push(await ready(h, v.p))
        }
        const b = ids.at(-1)!
        const selected = list.at(-1)!
        const boundary = h.fake.calls.length

        await v.p.redraw(paneProps(145, 46))
        await until(h, () => h.fake.calls.slice(boundary).some(c => c.tool === 'capture_session' && c.args.session_id === b), 'capture after resize')
        const events = replayControls(h, ids, boundary)
        const captureIndex = events.findIndex(c => c.tool === 'capture_session')
        const resizeIndex = events.findIndex(c => c.tool === 'resize_session')
        expect(resizeIndex).toBeGreaterThanOrEqual(0)
        expect(resizeIndex).toBeLessThan(captureIndex)
        expect(wire(events[resizeIndex]!)).toEqual({
          server: selected.server, tool: 'resize_session',
          args: { session_id: b, cols: sizeCall.args.cols, rows: sizeCall.args.rows },
        })
        expect(events.every(c => c.args.session_id === b)).toBe(true)
      } finally { await dispose(h, v) }
    })

    for (const by of [-1, -200, -201, -450, 450]) {
      // REQ-32, REQ-35, REQ-36, REQ-38.
      test('TEST-19: wheel ' + by + ' scrolls the shown ' + kind + ' replay in bounded lossless rows then captures it [' + surface + ']', async ($, on) => {
        const id = 'r13-wheel-' + surface + '-' + kind + '-' + by
        const h = world(on, id)
        await start($, surface)
        const list = await children($, h, id, kind)
        await finish(h, list)
        const v = await open($, h, surface, list[0]!)
        try {
          const replayId = await ready(h, v.p)
          if (by > 0) { await $.ui.scroll(wheel(-800)); await h.clock.settle() }
          const boundary = h.fake.calls.length
          await $.ui.scroll(wheel(by))
          await h.clock.settle()
          const sent = h.fake.calls.slice(boundary).filter(c => c.tool === 'scroll_session' || c.args.mode === 'scroll')
          expect(sent.length).toBeGreaterThan(0)
          const rows = sent.map(c => Number(c.args.by))
          expect(rows.every(n => Number.isInteger(n) && Math.sign(n) === Math.sign(by) && Math.abs(n) <= 200)).toBe(true)
          expect(rows.reduce((a, b) => a + b, 0)).toBe(by)
          for (const c of sent) expect(wire(c)).toEqual({
            server: list[0]!.server, tool: 'scroll_session', args: { session_id: replayId, by: c.args.by },
          })
          if (Math.abs(by) <= 200) expect(sent).toHaveLength(1)
          const lastScroll = h.fake.calls.lastIndexOf(sent.at(-1)!)
          expect(h.fake.calls.slice(lastScroll + 1).some(c => c.tool === 'capture_session' && c.args.session_id === replayId)).toBe(true)
          expect(await drawn(v.p)).toContain('REPLAY ' + list[0]!.model)
          readOnly(h)
        } finally { await dispose(h, v) }
      })
    }

    for (const unavailable of ['failed', 'unsupported'] as const) {
      // REQ-37.
      test('TEST-20: wheel on ' + unavailable + ' ' + kind + ' Screen without a replay sends no scroll [' + surface + ']', async ($, on) => {
        const id = 'r13-no-scroll-' + surface + '-' + kind + '-' + unavailable
        const h = world(on, id, {
          listReplay: unavailable !== 'unsupported',
          replayOpenAnswer: () => failure('replay_unavailable'),
        })
        await start($, surface)
        const list = await children($, h, id, kind)
        await finish(h, list)
        const v = await open($, h, surface, list[0]!)
        try {
          await until(h, () => h.fake.transcriptCalls().length > 0, 'Text fallback')
          await press(v.p, 'Screen')
          await h.clock.settle()
          const boundary = h.fake.scrollCalls().length
          await $.ui.scroll(wheel(-450))
          await h.clock.advance(WATCH)
          expect(h.fake.scrollCalls()).toHaveLength(boundary)
          expect(h.fake.replays).toEqual([])
        } finally { await dispose(h, v) }
      })
    }
  }

  // REQ-24, REQ-26. An older panel stays visible until its last live slot ends.
  test('TEST-13: a settled older panel leaves the tabs and closes only its replay [' + surface + ']', async ($, on) => {
    const id = 'r13-remove-panel-' + surface
    const h = world(on, id)
    await start($, surface)
    await team($, h, id + '-a', ['remove-a', 'keep-a-live'])
    await team($, h, id + '-b', ['remain-b'])
    const [removed, live, retained] = targets(h)
    await finish(h, [removed!, retained!])
    const v = await open($, h, surface, retained!)
    try {
      const b = await ready(h, v.p)
      await press(v.p, removed!.model)
      const a = await ready(h, v.p)
      expect(opens(h)).toHaveLength(2)
      expect(closes(h)).toEqual([])
      await press(v.p, retained!.model)
      await finish(h, [live!])
      await h.clock.advance(WATCH)
      await v.b.redraw()
      await v.p.redraw()
      expect(closes(h).map(c => c.args.replay_id)).toEqual([a])
      expect(Object.values(replays(h))).toEqual([{ server: retained!.server, replayId: b }])
      expect((await v.p.findAll({ type: 'Button' })).map(x => x.props.label)).not.toContain(removed!.model)
      expect(await drawn(v.p)).toContain('REPLAY ' + retained!.model)
      const boundary = h.fake.calls.length
      const before = replayReads(h, b).length
      await h.clock.advance(QUIET_CAPTURE + CAPTURE)
      expect(replayReads(h, b).length).toBeGreaterThan(before)
      expect(replayControls(h, [a], boundary)).toEqual([])
      expect(closes(h).map(c => c.args.replay_id)).toEqual([a])
      expect(opens(h)).toHaveLength(2)
    } finally { await dispose(h, v) }
  })

  // REQ-24, REQ-26. A newer run displaces a finished delegation without Hide.
  test('TEST-13: a newer delegation replaces a finished tab and closes its replay [' + surface + ']', async ($, on) => {
    const id = 'r13-remove-delegation-' + surface
    const h = world(on, id)
    await start($, surface)
    const [removed] = await children($, h, id, 'delegation')
    await finish(h, [removed!])
    const v = await open($, h, surface, removed!)
    try {
      const oldId = await ready(h, v.p)
      await modelCall($, CREATE_TOOL, { model: 'new-child', prompt: 'An isolated replacement task' })
      await h.clock.advance(POLL + WATCH)
      await v.b.redraw()
      await v.p.redraw()
      await expectClosed(h, [oldId])
      expect((await v.p.findAll({ type: 'Button' })).map(x => x.props.label)).not.toContain(removed!.model)
      expect(opens(h)).toHaveLength(1)
      const boundary = h.fake.calls.length
      const retained = targets(h).at(-1)!
      await press(v.p, retained.model)
      await h.clock.advance(CAPTURE)
      expect(opens(h)).toHaveLength(1)
      await finish(h, [retained])
      const fresh = await ready(h, v.p)
      expect(fresh).not.toBe(oldId)
      expectOpen(opens(h)[1]!, retained)
      expect(opens(h)).toHaveLength(2)
      expect(Object.values(replays(h))).toEqual([{ server: retained.server, replayId: fresh }])
      expect(await drawn(v.p)).toContain('REPLAY ' + retained.model)
      await h.clock.advance(QUIET_CAPTURE + CAPTURE)
      expect(replayControls(h, [oldId], boundary)).toEqual([])
      expect(closes(h).map(c => c.args.replay_id)).toEqual([oldId])
    } finally { await dispose(h, v) }
  })

  // REQ-1, REQ-29: seed only the persisted public atom, no module-private records.
  test('TEST-16: session start closes persisted replay ids on both servers when Show is unplaced [' + surface + ']', async ($, on) => {
    const id = 'r13-reload-' + surface
    const h = world(on, id)
    const saved: ClaudishReplays = {
      cl_01020304: { server: SERVERS[0], replayId: id + '-first' },
      cl_05060708: { server: SERVERS[1], replayId: id + '-second' },
    }
    let current = saved
    on('state.get', { plugin: 'claudish', key: 'replays' }, async (_$, e, next) => {
      const result = await next(e)
      return 'deny' in result ? result : { value: { ...result.value, value: current } }
    })
    on('state.set', { plugin: 'claudish', key: 'replays' }, async (_$, e, next) => {
      const result = await next(e)
      if (!('deny' in result) && result.value.isSet) current = e.value as ClaudishReplays
      return result
    })
    h.panes = [{ id: SHOW, title: 'claudish', isPlaced: false, isShown: false, isFocused: false }]
    try {
      await start($, surface)
      await h.clock.advance(WATCH + 25)
      expect(closes(h).map(wire).sort((a, b) => a.server.localeCompare(b.server))).toEqual(
        Object.values(saved).map(r => ({ server: r.server, tool: 'close_replay', args: { replay_id: r.replayId } }))
          .sort((a, b) => a.server.localeCompare(b.server)))
      expect(replays(h)).toEqual({})
      await h.clock.advance(WATCH * 3)
      expect(closes(h)).toHaveLength(2)
      expect(opens(h)).toEqual([])
    } finally { await dispose(h) }
  })
}

// REQ-39, REQ-40: real permission-hook process tests live in r13-permissions.spec.ts.
// Run separately with bun --no-env-file test ./tests/ext/r13-permissions.spec.ts.


// P9 timing expectations are copied from the public declaration, not production.
const NOT_YET_MS = 500
const NOT_YET_TRIES = 20
function unavailableReason(reason?: string): ListOverride {
  return {
    text: JSON.stringify({ error: {
      code: 'replay_unavailable',
      ...(reason === undefined ? {} : { reason }),
      message: 'Replay cannot start yet',
    } }),
    isError: true,
  }
}
const targetOpens = (h: Harness, child: Child) => opens(h).filter(c => original(c, child))

// Observe the external request at both sides of the specified deadline.
async function retryAt(h: Harness, p: Mounted, child: Child, count: number, answeredAt: number) {
  const due = answeredAt + NOT_YET_MS
  await h.clock.advance(due - 1 - h.clock.now())
  await p.redraw()
  await h.clock.settle()
  expect(targetOpens(h, child)).toHaveLength(count)
  await h.clock.advance(1)
  await h.clock.settle()
  expect(targetOpens(h, child)).toHaveLength(count + 1)
  const sent = targetOpens(h, child).at(-1)!
  expect(sent.at).toBe(due)
  expectOpen(sent, child)
}

for (const surface of SURFACES) {
  for (const kind of KINDS) {
    for (const server of SERVERS) {
      for (const transientCount of [1, 3, NOT_YET_TRIES - 1]) {
        // REQ-41, REQ-42 (P9.1–2): delay starts at the answer, not the request.
        test('TEST-21: ' + kind + ' stays on Screen through ' + transientCount + ' session_live answers then draws its replay [' + surface + ', ' + server + ']', async ($, on) => {
          const id = 'r13-transient-' + surface + '-' + kind + '-' + server + '-' + transientCount
          const held = gate()
          const h = world(on, id, {
            replayOpenAnswer: async (_call, n) => {
              if (n === 1) await held.promise
              return n <= transientCount ? unavailableReason('session_live') : undefined
            },
          })
          await start($, surface)
          const [child] = await children($, h, id, kind, 1, server)
          await finish(h, [child!])
          const v = await open($, h, surface, child!)
          try {
            await until(h, () => opens(h).length === 1, 'initial replay open pending')
            await h.clock.advance(137)
            const answeredAt = h.clock.now()
            held.release()
            await h.clock.settle()

            for (let count = 1; count <= transientCount; count++) {
              await mode(v.p, 'screen')
              expect(h.fake.transcriptCalls().filter(c => original(c, child!))).toEqual([])
              expect(h.fake.replays).toEqual([])
              // Repeated redraws do not bypass the backoff.
              for (let redraw = 0; redraw < 3; redraw++) await v.p.redraw()
              await retryAt(h, v.p, child!, count,
                count === 1 ? answeredAt : targetOpens(h, child!).at(-1)!.at)
            }
            await ready(h, v.p)
            await mode(v.p, 'screen')
            expect(await drawn(v.p)).toContain('REPLAY ' + child!.model)
            expect(targetOpens(h, child!)).toHaveLength(transientCount + 1)
            for (const call of opens(h)) expectOpen(call, child!)
            expect(h.fake.replays).toHaveLength(1)
            await h.clock.advance(NOT_YET_MS * 3)
            expect(opens(h)).toHaveLength(transientCount + 1)
            expect(h.fake.transcriptCalls().filter(c => original(c, child!))).toEqual([])
          } finally { held.release(); await h.clock.settle(); await dispose(h, v) }
        })
      }

      // REQ-41, REQ-43 (P9.1, P9.3): the cap counts answers, including the initial open.
      test('TEST-22: ' + kind + ' falls back on the twentieth session_live answer and retries only after reopening [' + surface + ', ' + server + ']', async ($, on) => {
        const id = 'r13-transient-limit-' + surface + '-' + kind + '-' + server
        const h = world(on, id, {
          replayOpenAnswer: (_call, n) => n <= NOT_YET_TRIES ? unavailableReason('session_live') : undefined,
        })
        await start($, surface)
        const [child] = await children($, h, id, kind, 1, server)
        await finish(h, [child!])
        const v = await open($, h, surface, child!)
        try {
          await until(h, () => opens(h).length === 1, 'first transient answer')
          for (let count = 1; count < NOT_YET_TRIES; count++) {
            await mode(v.p, 'screen')
            expect(h.fake.transcriptCalls().filter(c => original(c, child!))).toEqual([])
            await retryAt(h, v.p, child!, count, targetOpens(h, child!).at(-1)!.at)
          }
          await v.p.redraw()
          await h.clock.settle()
          await mode(v.p, 'text')
          expect(await drawn(v.p)).toContain(transcript(child!.model))
          expect(opens(h)).toHaveLength(NOT_YET_TRIES)
          expect(h.fake.replays).toEqual([])
          for (let i = 0; i < 3; i++) {
            await v.p.redraw()
            await h.clock.advance(NOT_YET_MS * NOT_YET_TRIES)
          }
          expect(opens(h)).toHaveLength(NOT_YET_TRIES)

          await press(v.p, 'Hide')
          await h.clock.settle()
          await v.b.redraw()
          await pressChip(v.b, child!.model, 'Show')
          await v.p.redraw()
          await ready(h, v.p)
          await mode(v.p, 'screen')
          expect(await drawn(v.p)).toContain('REPLAY ' + child!.model)
          expect(opens(h)).toHaveLength(NOT_YET_TRIES + 1)
          expectOpen(opens(h).at(-1)!, child!)
        } finally { await dispose(h, v) }
      })

      for (const reason of ['no_record', 'spawn_failed', 'boot_dialog', undefined]) {
        // REQ-44 (P9.4): only the exact session_live reason is transient.
        test('TEST-23: ' + kind + ' replay_unavailable reason ' + (reason ?? 'absent') + ' immediately falls back without retry [' + surface + ', ' + server + ']', async ($, on) => {
          const id = 'r13-permanent-' + surface + '-' + kind + '-' + server + '-' + (reason ?? 'absent')
          const h = world(on, id, { replayOpenAnswer: () => unavailableReason(reason) })
          await start($, surface)
          const [child] = await children($, h, id, kind, 1, server)
          await finish(h, [child!])
          const v = await open($, h, surface, child!)
          try {
            await h.clock.settle()
            await v.p.redraw()
            await h.clock.settle()
            await mode(v.p, 'text')
            expect(await drawn(v.p)).toContain(transcript(child!.model))
            expect(opens(h)).toHaveLength(1)
            expectOpen(opens(h)[0]!, child!)
            for (let i = 0; i < 3; i++) {
              await v.p.redraw()
              await h.clock.advance(NOT_YET_MS * NOT_YET_TRIES)
            }
            expect(opens(h)).toHaveLength(1)
            expect(h.fake.replays).toEqual([])
          } finally { await dispose(h, v) }
        })
      }
    }

    for (const route of ['Hide', 'unplaced', 'clear'] as const) {
      // REQ-45 (P9.5): a scheduled retry must not allocate an invisible process.
      test('TEST-24: ' + kind + ' stops waiting retries when the panel closes via ' + route + ' [' + surface + ']', async ($, on) => {
        const id = 'r13-transient-close-' + surface + '-' + kind + '-' + route
        const h = world(on, id, {
          replayOpenAnswer: (_call, n) => n === 1 ? unavailableReason('session_live') : undefined,
        })
        await start($, surface)
        const [child] = await children($, h, id, kind)
        await finish(h, [child!])
        const v = await open($, h, surface, child!)
        try {
          await until(h, () => opens(h).length === 1, 'first transient answer')
          await mode(v.p, 'screen')
          await h.clock.advance(100)
          if (route === 'Hide') await press(v.p, 'Hide')
          else if (route === 'unplaced') h.panes = []
          else await $.session.end({ reason: 'clear', sessionId: id, resume: { id } })
          await h.clock.settle()
          await h.clock.advance(NOT_YET_MS * (NOT_YET_TRIES + 1) + WATCH)

          expect(opens(h)).toHaveLength(1)
          expect(h.fake.replays).toEqual([])
          expect(closes(h)).toEqual([])
        } finally { await dispose(h, v) }
      })
    }

    // REQ-41 (P9.1 with P1.8): Text is a deliberate mode, not a failure.
    test('TEST-26: selecting Text during a ' + kind + ' transient wait prevents further opens [' + surface + ']', async ($, on) => {
      const id = 'r13-transient-text-' + surface + '-' + kind
      const h = world(on, id, {
        replayOpenAnswer: (_call, n) => n === 1 ? unavailableReason('session_live') : undefined,
      })
      await start($, surface)
      const [child] = await children($, h, id, kind)
      await finish(h, [child!])
      const v = await open($, h, surface, child!)
      try {
        await until(h, () => opens(h).length === 1, 'first transient answer')
        await mode(v.p, 'screen')
        await press(v.p, 'Text')
        await h.clock.settle()
        await h.clock.advance(NOT_YET_MS * (NOT_YET_TRIES + 1))
        await mode(v.p, 'text')
        expect(await drawn(v.p)).toContain(transcript(child!.model))
        expect(opens(h)).toHaveLength(1)
        expect(h.fake.replays).toEqual([])
      } finally { await dispose(h, v) }
    })
  }

  // REQ-41 (P9.1): use one panel so both finished tabs remain visible.
  test('TEST-25: switching finished panel tabs leaves the waiting hidden tab unopened [' + surface + ']', async ($, on) => {
    const id = 'r13-transient-hidden-' + surface
    const h = world(on, id)
    await start($, surface)
    const [first, second] = await children($, h, id, 'panel', 2)
    h.fake.options.replayOpenAnswer = (call, n) =>
      original(call, first!) && n === 1 ? unavailableReason('session_live') : undefined
    await finish(h, [first!, second!])
    const v = await open($, h, surface, first!)
    try {
      await until(h, () => targetOpens(h, first!).length === 1, 'first tab waits')
      await mode(v.p, 'screen')
      await press(v.p, second!.model)
      await ready(h, v.p)
      await h.clock.advance(NOT_YET_MS * (NOT_YET_TRIES + 1))
      await mode(v.p, 'screen')
      expect(await drawn(v.p)).toContain('REPLAY ' + second!.model)
      expect(targetOpens(h, first!)).toHaveLength(1)
      expect(targetOpens(h, second!)).toHaveLength(1)
      expectOpen(targetOpens(h, second!)[0]!, second!)
      expect(h.fake.replays).toHaveLength(1)
    } finally { await dispose(h, v) }
  })

  // REQ-42, REQ-43 (P9.2–3 with P3.2): exhaustion belongs to its tab.
  test('TEST-27: an exhausted finished tab does not consume its sibling retry budget [' + surface + ']', async ($, on) => {
    const id = 'r13-transient-isolated-' + surface
    const h = world(on, id)
    await start($, surface)
    const [first, second] = await children($, h, id, 'panel', 2)
    h.fake.options.replayOpenAnswer = (call, n) =>
      original(call, first!) || n === 1 ? unavailableReason('session_live') : undefined
    await finish(h, [first!, second!])
    const v = await open($, h, surface, first!)
    try {
      await until(h, () => targetOpens(h, first!).length === 1, 'first tab waits')
      for (let count = 1; count < NOT_YET_TRIES; count++) {
        await retryAt(h, v.p, first!, count, targetOpens(h, first!).at(-1)!.at)
      }
      await v.p.redraw()
      await h.clock.settle()
      await mode(v.p, 'text')
      expect(await drawn(v.p)).toContain(transcript(first!.model))
      expect(targetOpens(h, second!)).toEqual([])

      await press(v.p, second!.model)
      await until(h, () => targetOpens(h, second!).length === 1, 'sibling first transient answer')
      await mode(v.p, 'screen')
      await retryAt(h, v.p, second!, 1, targetOpens(h, second!)[0]!.at)
      await ready(h, v.p)
      expect(await drawn(v.p)).toContain('REPLAY ' + second!.model)
      expect(targetOpens(h, second!)).toHaveLength(2)
      expect(targetOpens(h, first!)).toHaveLength(NOT_YET_TRIES)

      await press(v.p, first!.model)
      await mode(v.p, 'text')
      expect(await drawn(v.p)).toContain(transcript(first!.model))
      await h.clock.advance(NOT_YET_MS * NOT_YET_TRIES)
      expect(targetOpens(h, first!)).toHaveLength(NOT_YET_TRIES)
      expect(targetOpens(h, second!)).toHaveLength(2)
      expect(closes(h)).toEqual([])
    } finally { await dispose(h, v) }
  })
}
