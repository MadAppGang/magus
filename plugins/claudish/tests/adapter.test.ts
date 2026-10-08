import type { McpToolResult } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { ClaudishRunRef } from '../types'
import { makeClaudishSource, type McpCall } from '../hooks/status/claudish-source'
import type { CallSeen, FeedAnswer, PollResult } from '../hooks/status/run-source'
import { GOLDEN_CAPTURE, GOLDEN_LIST, GOLDEN_UNCHANGED, PRECONTRACT_LIST_ERROR, contractError, frame, slotRow } from './scenario'

type Recorded = { server: string; tool: string; args: Record<string, unknown> }

const reply = (text: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text }], isError })

/** An adapter over a stub that answers each call with `answer(call)` and records it. */
function stubbed(answer: (c: Recorded) => McpToolResult | Error) {
  const calls: Recorded[] = []
  const call: McpCall = async (server, tool, args) => {
    const c = { server, tool, args }
    calls.push(c)
    const a = answer(c)
    if (a instanceof Error) throw a
    return a
  }
  return { source: makeClaudishSource(call), calls }
}

const SERVER = 'plugin:claudish:claudish'
const PANEL: ClaudishRunRef = { kind: 'panel', server: SERVER, token: 'review-0000000-000001', address: '/w/proj/ai-docs/sessions/x/review' }
const DELEG: ClaudishRunRef = { kind: 'delegation', server: SERVER, token: 'a1b2c3d4-0000', address: 'a1b2c3d4-0000' }
const META = { contract_version: 1, capabilities: ['list', 'status', 'cancel', 'capture', 'capture_since_seq', 'capture_spans'] }
const NOW = Date.parse('2026-10-07T00:00:00.000Z')

async function pollOne(answer: McpToolResult | Error, ref: ClaudishRunRef = PANEL): Promise<{ feed: FeedAnswer | undefined; run: PollResult | undefined; calls: Recorded[] }> {
  const { source, calls } = stubbed(() => answer)
  const batch = await source.poll([{ id: 'r', ref }])
  return { feed: batch.feeds.get(`${ref.server}#${ref.kind}`), run: batch.runs.get('r'), calls }
}

function listOf(slots: Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...META, runs: [{ run_id: PANEL.token, path: PANEL.address, kind: 'run', started_at: '2026-10-07T00:00:00.000Z', finished_at: null, state: 'ACTIVE', outcome: null, slots }], ...extra })
}

const ROW = slotRow({ slot: '01', model: 'grok-4.6', startedAt: NOW, now: NOW + 10_000, control: { state: 'RUNNING', reason: null, at: NOW } })

describe('adapter: golden answers (contract v1 examples, verbatim)', () => {
  test('the §A list example decodes into one slot', async () => {
    const { feed, run } = await pollOne(reply(GOLDEN_LIST))
    expect(feed).toEqual({ kind: 'speaks', version: 1, can: { cancel: true, capture: true, spans: true } })
    expect(run).toEqual({
      kind: 'ok',
      slots: [{
        slot: '01', model: 'internal', provider: 'Anthropic (native)', state: 'RUNNING', reason: null,
        tokensIn: 61211, tokensOut: 812, toolCalls: 3, turnsCompleted: 0, idleSeconds: 0,
        lastActivityAt: Date.parse('2026-10-02T11:00:41.120Z'), activity: 'Bash', asked: false,
      }],
    })
  })
  test('the §D capture example decodes into a frame; the unchanged example into unchanged', async () => {
    const { source } = stubbed(() => reply(GOLDEN_CAPTURE))
    const r = await source.capture(PANEL, '01', 0, false)
    expect(r.kind).toBe('frame')
    if (r.kind !== 'frame') return
    expect(r.final).toBe(false)
    expect(r.frame.seq).toBe(57)
    expect(r.frame.cursor).toEqual({ row: 44, col: 2 })
    expect(r.frame.lines).toHaveLength(50)
    expect(r.frame.lines[3]).toBe('❯ Reply with exactly PEAR')
    expect(r.frame.styles).toBeUndefined()
    const u = await stubbed(() => reply(GOLDEN_UNCHANGED)).source.capture(PANEL, '01', 57, false)
    expect(u).toEqual({ kind: 'unchanged', final: false })
  })
})

describe('adapter: list → domain', () => {
  test('SlotRow fields map per the table', async () => {
    const { run } = await pollOne(reply(listOf([{ ...ROW, reason: 'not-a-reason', cost_usd: 1.5, pane: 'p' }])))
    expect(run?.kind).toBe('ok')
    if (run?.kind !== 'ok') return
    const s = run.slots[0]
    expect(s).toEqual({
      slot: '01', model: 'grok-4.6', provider: 'OpenRouter', state: 'RUNNING', reason: null,
      tokensIn: 1000 + 9000, tokensOut: 600, toolCalls: 3, turnsCompleted: 1, idleSeconds: 0,
      lastActivityAt: NOW + 10_000, activity: 'Bash', asked: false,
    })
  })
  test('closed-set reason kept; unknown state word → UNKNOWN; absent state → UNKNOWN; absent model → unknown model', async () => {
    const { run } = await pollOne(reply(listOf([
      { ...ROW, slot: '01', state: 'FAILED', reason: 'blocked', idle_seconds: null },
      { ...ROW, slot: '02', state: 'PAUSED' },
      { ...ROW, slot: '03', state: undefined },
      { ...ROW, slot: '04', model: undefined },
      { ...ROW, slot: '05', tokens_in: 'lots', tool_calls: Infinity, last_activity_at: 'yesterday' },
      { ...ROW, slot: '06', model: 'bad model with spaces', provider: '\u001b[31mRed\u001b[0m\nProvider', activity: 'x'.repeat(100) },
    ])))
    if (run?.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(run)}`)
    const [s1, s2, s3, s4, s5, s6] = run.slots
    expect([s1?.state, s1?.reason, s1?.idleSeconds]).toEqual(['FAILED', 'blocked', null])
    expect(s2?.state).toBe('UNKNOWN')
    expect(s3?.state).toBe('UNKNOWN')
    expect(s4?.model).toBe('unknown model')
    expect([s5?.tokensIn, s5?.toolCalls, s5?.lastActivityAt]).toEqual([null, null, null])
    expect(s6?.model).toBe('unknown model')
    expect(s6?.provider).toBe('Red Provider')
    expect(s6?.activity).toHaveLength(60)
  })
  test('asked is true only for AWAITING_INPUT on a question', async () => {
    const { run } = await pollOne(reply(listOf([
      { ...ROW, slot: '01', state: 'AWAITING_INPUT', activity: 'AskUserQuestion' },
      { ...ROW, slot: '02', state: 'AWAITING_INPUT', activity: null },
      { ...ROW, slot: '03', state: 'RUNNING', activity: 'AskUserQuestion' },
    ])))
    if (run?.kind !== 'ok') throw new Error('expected ok')
    expect(run.slots.map(s => s.asked)).toEqual([true, false, false])
  })
  test('a delegation row: slot is its session id', async () => {
    const row = { ...ROW, slot: DELEG.token, session_id: DELEG.token, started_at: 'x', completed_at: null, elapsed_seconds: 3 }
    const { run, calls } = await pollOne(reply(JSON.stringify({ ...META, sessions: [row] })), DELEG)
    expect(calls).toEqual([{ server: SERVER, tool: 'list_sessions', args: { include_completed: true } }])
    if (run?.kind !== 'ok') throw new Error('expected ok')
    expect(run.slots[0]?.slot).toBe(DELEG.token)
  })
})

describe('adapter: feed classification', () => {
  const cases: [string, McpToolResult | Error, FeedAnswer['kind'], string?][] = [
    ['rejection → unanswered', new Error('transport closed'), 'unanswered'],
    ['isError + ContractError → refused{code}', reply(contractError('invalid_args', 'x'), true), 'refused'],
    ["isError + 10.3.0's plain text → precontract", reply(PRECONTRACT_LIST_ERROR, true), 'precontract'],
    ['not JSON, isError false → garbled', reply('<<<'), 'garbled'],
    ['a JSON array → garbled', reply('[]'), 'garbled'],
    ["no contract_version (10.3.0's list_sessions) → precontract", reply(JSON.stringify({ sessions: [] })), 'precontract'],
    ['capabilities not a string array → precontract', reply(JSON.stringify({ contract_version: 1, capabilities: [1], runs: [] })), 'precontract'],
    ['contract_version 2 → declines', reply(JSON.stringify({ ...META, contract_version: 2, runs: [] })), 'declines'],
    ['no list capability → declines', reply(JSON.stringify({ contract_version: 1, capabilities: ['status'], runs: [] })), 'declines'],
    ['no runs array → garbled', reply(JSON.stringify({ ...META })), 'garbled'],
  ]
  for (const [name, answer, kind] of cases) {
    test(name, async () => {
      const { feed, run } = await pollOne(answer)
      expect(feed?.kind).toBe(kind)
      expect(run).toBeUndefined()
      if (feed?.kind === 'refused') expect(feed.code).toBe('invalid_args')
    })
  }
  test('a watched slot lacking model or state still speaks', async () => {
    const { feed } = await pollOne(reply(listOf([{ ...ROW, model: null, state: null }])))
    expect(feed?.kind).toBe('speaks')
  })
  test('without capture_since_seq: capture and spans false', async () => {
    const { feed } = await pollOne(reply(JSON.stringify({ contract_version: 1, capabilities: ['list', 'cancel', 'capture', 'capture_spans'], runs: [] })))
    expect(feed).toEqual({ kind: 'speaks', version: 1, can: { cancel: true, capture: false, spans: false } })
  })
  test('without capture_spans: spans false, capture still true', async () => {
    const { feed } = await pollOne(reply(JSON.stringify({ contract_version: 1, capabilities: ['list', 'capture', 'capture_since_seq'], runs: [] })))
    expect(feed).toEqual({ kind: 'speaks', version: 1, can: { cancel: false, capture: true, spans: false } })
  })
})

describe('adapter: recognizeCall', () => {
  const source = makeClaudishSource(async () => reply('{}'))
  const startAnswer = (extra: Record<string, unknown> = {}, run: Record<string, unknown> = {}) =>
    JSON.stringify({ started: true, run_id: 'r1-abc-123456', run: { run_id: 'r1-abc-123456', path: '/w/r1', state: 'ACTIVE', ...run }, ...extra })
  const seen = (tool: string, args: Record<string, unknown>, text: string | null, isError = false): CallSeen => ({ tool, args, answer: { text, isError } })

  test('team run with run_id and run.path → start keyed by run_id, addressed by run.path', () => {
    expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__team', { mode: 'run', path: 'r1/' }, startAnswer()))).toEqual({
      kind: 'start', ref: { kind: 'panel', server: 'plugin:claudish:claudish', token: 'r1-abc-123456', address: '/w/r1' }, label: 'r1',
    })
  })
  test('the same from mcp__claudish__team → server claudish', () => {
    const r = source.recognizeCall(seen('mcp__claudish__team', { mode: 'run' }, startAnswer()))
    expect(r.kind === 'start' && r.ref.server).toBe('claudish')
  })
  test('no run_id → precontract', () => {
    const r = source.recognizeCall(seen('mcp__plugin_claudish_claudish__team', { mode: 'run' }, JSON.stringify({ started: true, session_path: '/w/r1' })))
    expect(r).toEqual({ kind: 'precontract', server: 'plugin:claudish:claudish', runKind: 'panel', reason: 'no run_id: pre-contract claudish' })
  })
  test('run.state SETTLED → other; run-and-judge with an ACTIVE run → start', () => {
    expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__team', { mode: 'run' }, startAnswer({}, { state: 'SETTLED' }))).kind).toBe('other')
    expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__team', { mode: 'run-and-judge' }, startAnswer())).kind).toBe('start')
  })
  test('no run.path, even with an absolute args.path → unidentified', () => {
    const text = JSON.stringify({ run_id: 'x', run: { run_id: 'x', state: 'ACTIVE' } })
    expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__team', { mode: 'run', path: '/w/abs' }, text)).kind).toBe('unidentified')
  })
  test('create_session with session_id → start; non-JSON → unidentified', () => {
    const r = source.recognizeCall(seen('mcp__plugin_claudish_claudish__create_session', {}, JSON.stringify({ session_id: 'a1b2c3d4-x', state: 'STARTING' })))
    expect(r).toEqual({ kind: 'start', ref: { kind: 'delegation', server: SERVER, token: 'a1b2c3d4-x', address: 'a1b2c3d4-x' }, label: '#a1b2c3' })
    expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__create_session', {}, 'started!')).kind).toBe('unidentified')
  })
  test('judge, status, cancel, capture → other; another server → other; an errored start → other', () => {
    for (const mode of ['judge', 'status', 'cancel', 'capture', 'list', 'result']) {
      expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__team', { mode }, startAnswer())).kind).toBe('other')
    }
    expect(source.recognizeCall(seen('mcp__other__team', { mode: 'run' }, startAnswer())).kind).toBe('other')
    expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__team', { mode: 'run' }, 'Error: invalid_args: x', true)).kind).toBe('other')
    for (const tool of ['get_output', 'get_diagnostics', 'list_sessions', 'cancel_session', 'capture_session', 'send_input']) {
      expect(source.recognizeCall(seen(`mcp__plugin_claudish_claudish__${tool}`, {}, '{"session_id":"x"}')).kind).toBe('other')
    }
  })
})

describe('adapter: attribution', () => {
  test('two watched runs at one path, each matched by its own run_id; a judge row matches neither', async () => {
    const run = (run_id: string, state: string, kind = 'run') => ({ run_id, path: '/w/r', kind, started_at: 'x', finished_at: null, state: 'ACTIVE', outcome: null, slots: [{ ...ROW, state }] })
    const text = JSON.stringify({ ...META, runs: [run('r-2', 'RUNNING'), run('r-1', 'COMPLETED'), run('j-1', 'FAILED', 'judge')] })
    const { source } = stubbed(() => reply(text))
    const ref = (token: string): ClaudishRunRef => ({ kind: 'panel', server: SERVER, token, address: '/w/r' })
    const batch = await source.poll([{ id: 'a', ref: ref('r-1') }, { id: 'b', ref: ref('r-2') }, { id: 'c', ref: ref('r-3') }])
    const state = (id: string) => { const r = batch.runs.get(id); return r?.kind === 'ok' ? r.slots[0]?.state : r?.kind }
    expect([state('a'), state('b'), state('c')]).toEqual(['COMPLETED', 'RUNNING', 'missing'])
  })
  test('a row whose slots cannot be listed → missing with a reason', async () => {
    const { run } = await pollOne(reply(JSON.stringify({ ...META, runs: [{ run_id: PANEL.token, path: PANEL.address, slots: 'nope' }] })))
    expect(run).toEqual({ kind: 'missing', reason: 'run row has no slots array' })
  })
})

describe('adapter: stop and capture args', () => {
  test('cancel sends mode, path, slot and run_id, and nothing else', async () => {
    const { source, calls } = stubbed(() => reply(JSON.stringify({ run_id: PANEL.token, path: PANEL.address, results: [{ slot: '01', state: 'CANCELLED', changed: true }] })))
    expect(await source.stop(PANEL, '01')).toEqual({ kind: 'stopped', changed: true })
    expect(calls).toEqual([{ server: SERVER, tool: 'team', args: { mode: 'cancel', path: PANEL.address, slot: '01', run_id: PANEL.token } }])
  })
  test('changed:false → stopped{changed:false}; unknown_slot → failed; cancel_session', async () => {
    expect(await stubbed(() => reply(JSON.stringify({ results: [{ slot: '01', state: 'COMPLETED', changed: false }] }))).source.stop(PANEL, '01')).toEqual({ kind: 'stopped', changed: false })
    expect(await stubbed(() => reply(contractError('unknown_slot', 'x'), true)).source.stop(PANEL, '09')).toEqual({ kind: 'failed', reason: 'unknown_slot' })
    const d = stubbed(() => reply(JSON.stringify({ session_id: DELEG.token, state: 'CANCELLED', changed: true })))
    expect(await d.source.stop(DELEG, DELEG.token)).toEqual({ kind: 'stopped', changed: true })
    expect(d.calls[0]).toEqual({ server: SERVER, tool: 'cancel_session', args: { session_id: DELEG.token } })
  })
  test('capture sends since_seq and run_id, and spans:true iff asked (absent otherwise)', async () => {
    const { source, calls } = stubbed(() => reply(GOLDEN_UNCHANGED))
    await source.capture(PANEL, '02', 12, false)
    await source.capture(PANEL, '02', 12, true)
    await source.capture(DELEG, DELEG.token, 0, false)
    expect(calls.map(c => c.args)).toEqual([
      { mode: 'capture', path: PANEL.address, slot: '02', run_id: PANEL.token, since_seq: 12 },
      { mode: 'capture', path: PANEL.address, slot: '02', run_id: PANEL.token, since_seq: 12, spans: true },
      { session_id: DELEG.token, since_seq: 0 },
    ])
    expect('spans' in (calls[0]?.args ?? {})).toBe(false)
  })
  test('seq 0 → unchanged; final passed through; unknown_run/unknown_session → gone; invalid_args → unavailable', async () => {
    const cap = (body: string, isError = false) => stubbed(() => reply(body, isError)).source.capture(PANEL, '01', 0, false)
    expect(await cap(JSON.stringify({ seq: 0, cols: 160, rows: 50, cursor: { x: 0, y: 0 }, final: true, lines: [] }))).toEqual({ kind: 'unchanged', final: true })
    const f = await cap(JSON.stringify(frame({ seq: 3, model: 'm', slot: '01', final: true, spans: false })))
    expect(f.kind === 'frame' && f.final).toBe(true)
    expect(await cap(contractError('unknown_run', 'x'), true)).toEqual({ kind: 'gone' })
    expect(await cap(contractError('unknown_session', 'x'), true)).toEqual({ kind: 'gone' })
    expect(await cap(contractError('invalid_args', 'x'), true)).toEqual({ kind: 'unavailable', reason: 'invalid_args' })
    expect((await cap(JSON.stringify({ seq: 2, cols: 160, rows: 50 }))).kind).toBe('unavailable')
  })
  test('lines: SGR and C0 stripped, tabs expanded, cut to cols, cursor outside the screen → null', async () => {
    const body = JSON.stringify({ seq: 1, cols: 10, rows: 2, cursor: { x: 10, y: 0 }, final: false, lines: ['\u001b[31mab\tc\u0007', 'x'.repeat(30)] })
    const r = await stubbed(() => reply(body)).source.capture(PANEL, '01', 0, false)
    if (r.kind !== 'frame') throw new Error('expected frame')
    expect(r.frame.lines).toEqual(['ab      c', 'x'.repeat(10)])
    expect(r.frame.cursor).toBeNull()
  })
})

describe('adapter: spans decode', () => {
  const withSpans = async (spans: unknown, lines = 1, cols = 160) => {
    const body = JSON.stringify({ seq: 1, cols, rows: lines, cursor: { x: 0, y: 0 }, final: false, lines: new Array(lines).fill('text'), spans })
    const r = await stubbed(() => reply(body)).source.capture(PANEL, '01', 0, true)
    if (r.kind !== 'frame') throw new Error('expected frame')
    return r.frame.styles
  }
  test('bold-only, indexed, truecolor, out-of-range colour', async () => {
    expect(await withSpans([[[0, 4, -1, -1, 1]]])).toEqual([[{ col: 0, len: 4, fg: null, bg: null, bold: true }]])
    expect(await withSpans([[[0, 4, 1, -1, 0]]])).toEqual([[{ col: 0, len: 4, fg: { index: 1 }, bg: null, bold: false }]])
    expect(await withSpans([[[0, 4, 16_777_216 + 0x0a0b0c, -1, 0]]])).toEqual([[{ col: 0, len: 4, fg: { rgb: 0x0a0b0c }, bg: null, bold: false }]])
    expect(await withSpans([[[0, 4, 300, -1, 1]]])).toEqual([[{ col: 0, len: 4, fg: null, bg: null, bold: true }]])
  })
  test('clipped past cols; len 0 and non-integers dropped; overlap dropped; adjacent identical merged; default-only dropped', async () => {
    expect(await withSpans([[[150, 20, 1, -1, 0]]])).toEqual([[{ col: 150, len: 10, fg: { index: 1 }, bg: null, bold: false }]])
    expect(await withSpans([[[0, 0, 1, -1, 0], [1, 2.5, 1, -1, 0], [200, 1, 1, -1, 0]]])).toEqual([[]])
    expect(await withSpans([[[0, 5, 1, -1, 0], [3, 4, 2, -1, 0]]])).toEqual([[{ col: 0, len: 5, fg: { index: 1 }, bg: null, bold: false }]])
    expect(await withSpans([[[0, 2, 1, -1, 0], [2, 3, 1, -1, 0]]])).toEqual([[{ col: 0, len: 5, fg: { index: 1 }, bg: null, bold: false }]])
    expect(await withSpans([[[0, 2, -1, -1, 0]]])).toEqual([[]])
  })
  test('30 distinct spans on a line → the leftmost 24', async () => {
    const line = Array.from({ length: 30 }, (_, i) => [i * 2, 1, i % 2 === 0 ? 1 : 2, -1, 0])
    const styles = await withSpans([line])
    expect(styles?.[0]).toHaveLength(24)
    expect(styles?.[0]?.[23]?.col).toBe(46)
  })
  test('spans of the wrong length → no styles, still a frame; an entry that is not an array → that line plain', async () => {
    expect(await withSpans([[], []], 1)).toBeUndefined()
    expect(await withSpans(['nope', [[0, 1, 1, -1, 0]]], 2)).toEqual([[], [{ col: 0, len: 1, fg: { index: 1 }, bg: null, bold: false }]])
  })
  test('spans are not decoded when they were not asked for', async () => {
    const body = JSON.stringify({ ...frame({ seq: 2, model: 'm', slot: '01', final: false, spans: true }) })
    const r = await stubbed(() => reply(body)).source.capture(PANEL, '01', 0, false)
    expect(r.kind === 'frame' && r.frame.styles).toBeUndefined()
  })
})

describe('adapter: wording', () => {
  const source = makeClaudishSource(async () => reply('{}'))
  test('runLine names the address and per-start id in claudish spelling', () => {
    expect(source.runLine(PANEL, 'review·2')).toBe(`Run review·2 (path "${PANEL.address}", run_id "${PANEL.token}"):`)
    expect(source.runLine(DELEG, '#a1b2c3')).toBe(`Delegation #a1b2c3 (session_id "${DELEG.token}"):`)
  })
  test('fetchHint per kind and state', () => {
    expect(source.fetchHint(PANEL, [])).toBe(`team(mode="status", path="${PANEL.address}", run_id="${PANEL.token}") then read each finished slot's response file`)
    const d = (state: 'COMPLETED' | 'FAILED' | 'AWAITING_INPUT' | 'AWAITING_PERMISSION', asked = false) => source.fetchHint(DELEG, [{ slot: DELEG.token, state, asked }])
    expect(d('COMPLETED')).toBe(`get_output(session_id="${DELEG.token}")`)
    expect(d('FAILED')).toBe(`get_diagnostics(session_id="${DELEG.token}")`)
    expect(d('AWAITING_INPUT')).toContain('send_input')
    expect(d('AWAITING_INPUT', true)).toContain('asking a question')
    expect(d('AWAITING_PERMISSION')).toContain(`cancel_session(session_id="${DELEG.token}")`)
  })
})

describe('adapter: display-safe ids', () => {
  const source = makeClaudishSource(async () => reply('{}'))
  const seen = (tool: string, args: Record<string, unknown>, text: string): CallSeen => ({ tool, args, answer: { text, isError: false } })
  const team = (runId: string, path: string) => JSON.stringify({ run_id: runId, run: { run_id: runId, path, state: 'ACTIVE' } })
  test('a run_id, session_id or run.path carrying controls, quotes or escapes → unidentified, never watched', () => {
    const bad: [string, string][] = [['r1\u001b[2J', '/w/r1'], ['r1"x', '/w/r1'], ['r1', '/w/r1\u0007'], ['r1', '/w/"r1'], ['r1', '/w/r1\\x'], ['r1', '/w/‮r1']]
    for (const [runId, path] of bad) {
      expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__team', { mode: 'run' }, team(runId, path))).kind).toBe('unidentified')
    }
    for (const id of ['a\nb', 'x"y', ' lead', '\u001b]0;t\u0007']) {
      expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__create_session', {}, JSON.stringify({ session_id: id }))).kind).toBe('unidentified')
    }
    expect(source.recognizeCall(seen('mcp__plugin_claudish_claudish__team', { mode: 'run' }, team('r1-abc', '/w/my review'))).kind).toBe('start')
  })
  test('a slot id that is not a plain id → that run row reads missing, as a row with no slot id', async () => {
    const { run } = await pollOne(reply(listOf([slotRow({ slot: '01\u001b[31m', model: 'm', startedAt: NOW, now: NOW, control: { state: 'RUNNING', reason: null, at: NOW } })])))
    expect(run).toEqual({ kind: 'missing', reason: 'a slot row has no slot id' })
  })
  test('quoted values in the wake text use string syntax', () => {
    expect(source.runLine({ ...PANEL, address: '/w/my review' }, 'r')).toBe(`Run r (path "/w/my review", run_id "${PANEL.token}"):`)
  })
})

describe('adapter: monitor lines', () => {
  const source = makeClaudishSource(async () => reply('{}'))
  const wrap = (line: string) =>
    `<task-notification>\n<task-id>b1</task-id>\n<summary>Monitor event: "Progress of claudish create_session and team runs"</summary>\n<event>${line}</event>\n</task-notification>`
  test('session ends and waits, as the README writes them, inside a task notification', () => {
    const text = [
      'claudish-monitor: session 1a2b3c4d completed model=MODEL_ID elapsed=7m41s turns=5 tools=22 cost=$0.09 next: get_output 1a2b3c4d',
      'claudish-monitor: session 9f8e7d6c needs-input model=MODEL_ID elapsed=1m12s turns=1 next: send_input 9f8e7d6c',
      'claudish-monitor: session 9f8e7d6c needs-input model=MODEL_ID elapsed=1m12s turns=1 waited=0m03s',
      'claudish-monitor: session 5e5e5e5e failed model=m reason=no-terminal-record next: get_diagnostics 5e5e5e5e',
      'claudish-monitor: session 6f6f6f6f timeout model=m elapsed=1h05m',
      'claudish-monitor: session 7a7a7a7a cancelled model=m',
    ].map(wrap).join('\n')
    expect(source.monitorReports(text)).toEqual([
      { kind: 'delegation', token: '1a2b3c4d', event: 'ended' },
      { kind: 'delegation', token: '9f8e7d6c', event: 'waiting' },
      { kind: 'delegation', token: '9f8e7d6c', event: 'waiting' },
      { kind: 'delegation', token: '5e5e5e5e', event: 'ended' },
      { kind: 'delegation', token: '6f6f6f6f', event: 'ended' },
      { kind: 'delegation', token: '7a7a7a7a', event: 'ended' },
    ])
  })
  test('a team end is named by its record id (the monitor_record of the start answer); its path is not read', () => {
    const team = (path: string, state = 'completed') =>
      `claudish-monitor: team team-5e6f7a8b ${state} elapsed=12m03s slots=4 ok=3 failed=1 cancelled=0 path=${path} next: team-status`
    const ended = [{ kind: 'panel', record: 'team-5e6f7a8b', event: 'ended' }]
    expect(source.monitorReports(team('ai-docs/sessions/RUN/reviews/my%20panel'))).toEqual(ended)
    expect(source.monitorReports(team('/tmp/x%25y', 'failed'))).toEqual(ended)
    expect(source.monitorReports(team('...reviews/panel', 'cancelled'))).toEqual(ended)
    expect(source.monitorReports('claudish-monitor: team team-1 completed slots=4')).toEqual([{ kind: 'panel', record: 'team-1', event: 'ended' }])
    expect(source.monitorReports('claudish-monitor: team team-1 completed path=%E0%A4%A')).toEqual([{ kind: 'panel', record: 'team-1', event: 'ended' }])
  })
  test('starts, heartbeats, notices, a team timeout, bad grammar and quoted mentions → nothing', () => {
    for (const line of [
      'claudish-monitor: session 1a2b3c4d started model=m',
      'claudish-monitor: session 1a2b3c4d running model=m elapsed=5m00s replies=3',
      'claudish-monitor: team team-1 started slots=4 path=r1',
      'claudish-monitor: team team-1 running elapsed=5m00s slots=4 ok=1 failed=0 cancelled=0 running=3 path=r1',
      'claudish-monitor: team team-1 timeout path=r1',
      'claudish-monitor: notice no-session-identity: this monitor started without CLAUDE_PID, so it cannot tell.',
      'claudish-monitor: notice claudish-too-old: this Claude Code session runs claudish 10.3.0',
      'claudish-monitor: session 1a2b3c4d exploded',
      'claudish-monitor: session bad"id completed',
      'claudish-monitor: session 1a2b3c4d completed model=has space in it',
      'The monitor said `claudish-monitor: session 1a2b3c4d completed` earlier.',
      'claudish-monitor:session 1a2b3c4d completed',
    ]) {
      expect(source.monitorReports(wrap(line))).toEqual([])
    }
  })
})
