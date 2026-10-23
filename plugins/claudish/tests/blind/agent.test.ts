// Blind coverage of MTL-191: expected values come from the spec and public contract.
import { expect } from 'claude-code/testing'
import { test } from '../kit'
import type { ClaudishRun, ClaudishRunRef, ClaudishSlot, ClaudishPaneView } from '../../types'
import { batchAgent, slotAgent } from '../../hooks/status/domain'
import { makeClaudishSource } from '../../hooks/status/claudish-source'
import {
  bandAgent, bandModel, fitColumns, paneAgentLine, paneAgentRows, paneModel,
  planWidth, rowAgentText, type BandInput,
} from '../../hooks/status/layout'
import { CREATE_TOOL, TEAM_TOOL, harness, start } from '../fake-claudish'
import { slotRow, type Json } from '../scenario'
import { bandProps, mountBand, mountPane, paneProps, SURFACES } from '../ui'
import { keyOf, outerTexts, rowsOf, rowFor, showButton, startDelegation, startTeam, textOf } from './helpers'

const R = 'dev:reviewer'
const Q = 'dev:qa-engineer'
const NOW = Date.parse('2026-10-23T00:00:00Z')
function slot(n: string, over: Partial<ClaudishSlot> = {}): ClaudishSlot {
  return {
    slot: n, model: 'gpt-6.1-sol', provider: 'OpenRouter', state: 'RUNNING', reason: null,
    tokensIn: 48_100, tokensOut: 2300, toolCalls: 12, turnsCompleted: 3, idleSeconds: 4,
    lastActivityAt: 0, activity: 'thinking', asked: false, costUsd: null, ...over,
  }
}
function run(id: string, slots: ClaudishSlot[], over: Partial<ClaudishRun> = {}): ClaudishRun {
  return {
    id, epoch: 0, ref: { kind: 'panel', server: 's', token: id, address: `runs/${id}` },
    label: 'plan-review', generation: 1, slots, activityAt: 0, missedPolls: 0,
    missingSince: null, unreachableSince: null, unknownSince: {}, personStops: [],
    waits: {}, lostReason: null, settledAt: null, ...over,
  }
}
function input(list: ClaudishRun[], over: Partial<BandInput> = {}): BandInput {
  const can = { cancel: true, capture: true, spans: true, resize: true }
  return {
    runs: { epoch: 0, starts: {}, list },
    feeds: {
      's#panel': { kind: 'speaks', version: 1, can, declined: 0 },
      's#delegation': { kind: 'speaks', version: 1, can, declined: 0 },
    },
    stops: {}, ledger: { epoch: 0, entries: {} },
    earlier: { runs: 0, done: 0, failed: 0, stopped: 0 },
    bodyColumns: 120, maxRows: 20, now: NOW, panel: { open: false, active: null }, ...over,
  }
}
const matching = () => [
  slot('01', { agentRequested: R, agent: R }),
  slot('02', { state: 'COMPLETED', agentRequested: R, agent: R }),
  slot('03', { agentRequested: R, agent: R }),
]
const rejected = () => [
  slot('01', { agentRequested: R, agent: R }),
  slot('02', { state: 'FAILED', agentRequested: R, agent: null, reason: 'agent_rejected', detail: 'agent not found' }),
]
const mixed = () => [
  slot('01', { agentRequested: R, agent: R }),
  slot('02', { agentRequested: Q, agent: Q }),
  slot('03', { agentRequested: null, agent: null }),
]
const header = (m: NonNullable<ReturnType<typeof bandModel>>) => m.header.map(s => s.text).join('')
const view = (r: ClaudishRun, s: ClaudishSlot): ClaudishPaneView => ({
  runId: r.id, slot: s.slot, model: s.model, status: 'live', frame: null, note: null,
})
const pane = (i: BandInput, r: ClaudishRun, s: ClaudishSlot) =>
  paneModel(view(r, s), i.runs, { columns: 80, rows: 20, paint: true }, NOW, i.feeds)

type Case = {
  id: string; req: string; rows: () => ClaudishSlot[]; delegation?: boolean
  batch: ReturnType<typeof batchAgent>; header: string; rowText: string[]
  lines: (string | null)[]; mismatch?: number
}
const cases: Case[] = [
  {
    id: '1 one agent per batch', req: 'REQ-3 REQ-6', rows: matching,
    batch: { kind: 'one', name: R },
    header: '◆ claudish  plan-review · 2 running · 1 done · dev:reviewer',
    rowText: ['', '', ''], lines: ['Agent: dev:reviewer', 'Agent: dev:reviewer', 'Agent: dev:reviewer'],
  },
  {
    id: '2 mixed agents', req: 'REQ-4 REQ-6', rows: mixed, batch: { kind: 'mixed' },
    header: '◆ claudish  plan-review · 3 running · mixed agents',
    rowText: [R, Q, 'no agent'], lines: ['Agent: dev:reviewer', 'Agent: dev:qa-engineer', 'Agent: none'],
  },
  {
    id: '3 matching single delegation', req: 'REQ-3 REQ-6',
    rows: () => [slot('d', { state: 'COMPLETED', agentRequested: R, agent: R })], delegation: true,
    batch: { kind: 'one', name: R }, header: '◆ claudish · 1 done · dev:reviewer',
    rowText: [''], lines: ['Agent: dev:reviewer'],
  },
  {
    id: '4 rejected mismatch', req: 'REQ-5 REQ-6', rows: rejected,
    batch: { kind: 'one', name: R },
    header: '◆ claudish  plan-review · 1 running · 1 failed · dev:reviewer',
    rowText: ['', 'requested dev:reviewer, loaded none'],
    lines: ['Agent: dev:reviewer', 'Agent: none (requested dev:reviewer) · agent_rejected: agent not found'], mismatch: 1,
  },
  {
    id: '4b different loaded agent', req: 'REQ-5 REQ-6',
    rows: () => [slot('01', { state: 'COMPLETED', agentRequested: R, agent: 'dev:other', reason: 'blocked', detail: 'unrelated detail' })],
    batch: { kind: 'one', name: 'dev:other' },
    header: '◆ claudish  plan-review · 1 done · dev:other',
    rowText: ['requested dev:reviewer, loaded dev:other'],
    lines: ['Agent: dev:other (requested dev:reviewer)'], mismatch: 0,
  },
  {
    id: '5 STARTING requested only', req: 'REQ-5 REQ-6',
    rows: () => [slot('01', { state: 'STARTING', agentRequested: R, agent: null })],
    batch: { kind: 'one', name: R }, header: '◆ claudish  plan-review · 1 running · dev:reviewer',
    rowText: [''], lines: ['Agent: dev:reviewer (requested)'],
  },
  {
    id: '6 no agent', req: 'REQ-2 REQ-7',
    rows: () => [slot('01', { agentRequested: null, agent: null }), slot('02', { state: 'COMPLETED', agentRequested: null, agent: null })],
    batch: { kind: 'none' }, header: '◆ claudish  plan-review · 1 running · 1 done',
    rowText: ['', ''], lines: [null, null],
  },
  {
    id: '7 keys absent', req: 'REQ-2 REQ-7',
    rows: () => [slot('01'), slot('02', { state: 'COMPLETED' })],
    batch: { kind: 'none' }, header: '◆ claudish  plan-review · 1 running · 1 done',
    rowText: ['', ''], lines: [null, null],
  },
]

for (const c of cases) {
  test(`agent case ${c.id}: exact batch/header/rows and every detail line [${c.req}]`, () => {
    const slots = c.rows()
    const r = run('a', slots, c.delegation ? {
      ref: { kind: 'delegation', server: 's', token: 'a', address: 'a' }, label: '#d00000',
    } : {})
    const i = input([r])
    const m = bandModel(i)!
    expect(m).not.toBeNull()
    expect(batchAgent(slots)).toEqual(c.batch)
    expect(bandAgent(i.runs, i.feeds)).toEqual(c.batch)
    expect(header(m)).toBe(c.header)
    expect(m.rows.map(r => r.agent)).toEqual(c.rowText)
    expect(m.rows.map(r => r.agentMismatch)).toEqual(slots.map((_, n) => n === c.mismatch))
    expect(paneAgentRows(i.runs, i.feeds)).toBe(c.batch.kind === 'none' ? 0 : 1)
    if (c.rowText.every(t => t === '')) expect(m.plan!.agent).toBe(0)
    if (c.batch.kind === 'mixed') expect(m.header[m.header.length - 1]!.dim).toBe(true)
    slots.forEach((s, n) => {
      const mismatch = n === c.mismatch
      expect(rowAgentText(slotAgent(s), c.batch)).toBe(c.rowText[n])
      const text = c.lines[n]
      expect(paneAgentLine(s, c.batch)).toEqual(text === null ? null : { text, mismatch })
      const p = pane(i, r, s)
      expect(p.agent).toEqual(text === null ? [] : [{ text, ...(mismatch ? { color: 'warning' } : {}) }])
      if (s.reason === 'agent_rejected') expect(p.header.map(x => x.text).join('')).not.toContain('agent_rejected')
    })
  })
}

test('agent case 6/7: entire band and pane output preserve null/absent equivalence [REQ-2 REQ-7]', () => {
  const absent = run('a', cases[7]!.rows())
  const explicit = run('a', cases[6]!.rows())
  const a = input([absent]), b = input([explicit])
  expect(bandModel(a)).toEqual(bandModel(b))
  absent.slots.forEach((s, n) => {
    expect(pane(a, absent, s)).toEqual(pane(b, explicit, explicit.slots[n]!))
    expect(paneAgentLine(s)).toBeNull()
  })
})

test('agent edge semantics: loaded-only, synthetic slots, mixed mismatch and default pane batch [REQ-3 REQ-4 REQ-5]', () => {
  expect(slotAgent({ state: 'RUNNING', agent: 'x' })).toEqual({
    requested: null, loaded: 'x', name: 'x', mismatch: false,
  })
  expect(slotAgent({ state: 'STARTING', agentRequested: R, agent: null })).toEqual({
    requested: R, loaded: null, name: R, mismatch: false,
  })
  expect(batchAgent([])).toEqual({ kind: 'none' })
  expect(batchAgent([slot('*')])).toEqual({ kind: 'none' })
  expect(batchAgent([slot('*'), ...matching()])).toEqual({ kind: 'one', name: R })
  expect(rowAgentText(slotAgent(rejected()[1]!), { kind: 'mixed' })).toBe('requested dev:reviewer, loaded none')
  const plain = mixed()[2]!
  expect(paneAgentLine(plain)).toBeNull()
  expect(paneAgentLine(plain, { kind: 'mixed' })).toEqual({ text: 'Agent: none', mismatch: false })
})

const countSegments = ['◆ claudish', '  plan-review', ' · 2 running', ' · 1 done', ' · dev:reviewer']
test('agent case 8: header stays uncut at every width and agent follows counts [REQ-8]', () => {
  for (const bodyColumns of [120, 60, 45, 41]) {
    const m = bandModel(input([run('a', matching())], { bodyColumns }))!
    expect(m.header.map(s => s.text)).toEqual(countSegments)
    expect(m.rows.map(r => r.agent)).toEqual(['', '', ''])
  }
})

test('agent case 9: shown live runs determine agent, before earlier run notices [REQ-9]', () => {
  // A different old agent makes accidental inclusion of the hidden run observable.
  const old = run('o', [slot('01', { state: 'COMPLETED', agentRequested: Q, agent: Q })], { settledAt: 100 })
  const live = run('p', [slot('01', { agentRequested: R, agent: R })], { label: 'audit' })
  const a = run('a', matching())
  const i = input([old, live, a])
  expect(bandAgent(i.runs, i.feeds)).toEqual({ kind: 'one', name: R })
  expect(paneAgentRows(i.runs, i.feeds)).toBe(1)
  expect(header(bandModel(i)!)).toBe('◆ claudish · 3 running · 1 done · dev:reviewer · 1 earlier run')
  expect(bandModel(i)!.rows.map(r => r.agent)).toEqual(['', '', '', ''])
  expect(header(bandModel(input([a], { earlier: { runs: 2, done: 2, failed: 0, stopped: 0 } }))!))
    .toBe('◆ claudish  plan-review · 2 running · 1 done · dev:reviewer · 2 earlier runs')
  const tableOld = run('o', [slot('01', { state: 'COMPLETED', agentRequested: R, agent: R })], { settledAt: 100 })
  expect(header(bandModel(input([tableOld, live, a]))!)).toBe(header(bandModel(i)!))
})

test('agent widths: floor remains 41; rejected row retains badge and fits 60 [REQ-8]', () => {
  const mixedRows = bandModel(input([run('a', mixed())]))!.rows
  const floor = fitColumns(41, mixedRows)!
  expect(planWidth(floor)).toBe(41)
  expect(floor.agent).toBe(0)
  const m = bandModel(input([run('a', rejected())], { bodyColumns: 60 }))!
  expect(m.rows).toHaveLength(2)
  expect(m.plan!.badge).toBeGreaterThan(0)
  expect(planWidth(m.plan!)).toBeLessThanOrEqual(60)
  expect(m.plan!.agent === 0 || m.plan!.agent >= 12).toBe(true)
})

test('agent header: bounded name and parked notice after the agent [REQ-8 REQ-9]', () => {
  const name = 'a'.repeat(40)
  const long = bandModel(input([run('a', [slot('01', { agent: name })])]))!
  expect(header(long)).toBe('◆ claudish  plan-review · 1 running · ' + 'a'.repeat(31) + '…')
  const i = input([run('a', matching())], {
    ledger: { epoch: 0, entries: {
      'a/02': { kind: 'parked', state: 'COMPLETED', at: NOW, attempts: 1, reason: 'not delivered', retryAt: NOW + 1000 },
    } },
  })
  expect(header(bandModel(i)!)).toBe('◆ claudish  plan-review · 2 running · 1 done · dev:reviewer · 1 notice not delivered')
})

test('agent row reservation: every mixed tab has a line; frame holds 18 vs 19 lines [REQ-6 REQ-10]', () => {
  const r = run('a', mixed()), i = input([r])
  for (const s of r.slots) {
    expect(paneAgentRows(i.runs, i.feeds)).toBe(1)
    expect(pane(i, r, s).agent).toHaveLength(1)
  }
  for (const [slots, expected] of [[matching(), 18], [cases[6]!.rows(), 19]] as const) {
    const r = run('a', slots), i = input([r])
    const lines = Array.from({ length: 30 }, (_, n) => 'line ' + n)
    const v = { ...view(r, slots[0]!), frame: { seq: 1, cols: 80, rows: 30, cursor: null, lines } }
    const p = paneModel(v, i.runs, { columns: 80, rows: 20, paint: false }, NOW, i.feeds)
    expect(p.body.kind).toBe('frame')
    if (p.body.kind !== 'frame') throw new Error('expected frame body')
    expect(p.body.lines).toHaveLength(expected)
  }
})

// Both wire feeds are exercised independently. Equality checks ensure rejection never
// repairs a bad identifier or accidentally changes a metric/state alongside it.
const META = { contract_version: 1, capabilities: ['list', 'status', 'cancel', 'capture', 'capture_since_seq', 'capture_spans'] }
async function decode(kind: 'panel' | 'delegation', fields: Json) {
  const ref: ClaudishRunRef = { kind, server: 's', token: 'r', address: 'r' }
  const row = {
    ...slotRow({ slot: '01', model: 'gpt-6.1-sol', startedAt: NOW, now: NOW + 10_000,
      control: { state: 'RUNNING', reason: null, at: NOW } }),
    ...fields,
  }
  const answer = kind === 'panel'
    ? { ...META, runs: [{ run_id: 'r', path: 'r', kind: 'run', started_at: new Date(NOW).toISOString(), finished_at: null, state: 'ACTIVE', outcome: null, slots: [row] }] }
    : { ...META, sessions: [{ ...row, session_id: 'r', started_at: new Date(NOW).toISOString(), completed_at: null, elapsed_seconds: 10 }] }
  const source = makeClaudishSource(async () => ({ content: [{ type: 'text', text: JSON.stringify(answer) }], isError: false }))
  const result = (await source.poll([{ id: 'r', ref }])).runs.get('r')
  expect(result?.kind).toBe('ok')
  if (result?.kind !== 'ok') throw new Error('expected decoded row, got ' + JSON.stringify(result))
  expect(result.slots).toHaveLength(1)
  return result.slots[0]!
}
for (const kind of ['panel', 'delegation'] as const) {
  test(`agent decoder ${kind}: valid identifiers unchanged and null/absent have no keys [REQ-1 REQ-2]`, async () => {
    const baseline = await decode(kind, {})
    expect(Object.prototype.hasOwnProperty.call(baseline, 'agentRequested')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(baseline, 'agent')).toBe(false)
    expect(await decode(kind, { agent_requested: null, agent: null })).toEqual(baseline)
    for (const value of [R, 'reviewer', 'plugin:name', 'a:b:c', 'qa_engineer.v2', 'a'.repeat(64)]) {
      expect(await decode(kind, { agent_requested: value, agent: value }))
        .toEqual({ ...baseline, agentRequested: value, agent: value })
      expect(await decode(kind, { agent_requested: value })).toEqual({ ...baseline, agentRequested: value })
      expect(await decode(kind, { agent: value })).toEqual({ ...baseline, agent: value })
    }
  })
  test(`agent decoder ${kind}: unsafe strings and nonstrings are omitted independently [REQ-2]`, async () => {
    const baseline = await decode(kind, {})
    for (const value of ['', ' dev:reviewer', 'dev reviewer', 'a"b', '\u001b[31mx', 'dev:reviewer\n', ':x', 'x:', 'a'.repeat(65), 42, {}]) {
      expect(await decode(kind, { agent_requested: value, agent: value })).toEqual(baseline)
      expect(await decode(kind, { agent_requested: value, agent: R })).toEqual({ ...baseline, agent: R })
      expect(await decode(kind, { agent_requested: R, agent: value })).toEqual({ ...baseline, agentRequested: R })
    }
  })
}

test('agent source authority: start arguments never supply missing row agents [REQ-1 REQ-7 REQ-11]', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'plan-review',
    models: ['authority-team'], input: 'review', agent: R } as never)
  await $.tool.call({ tool: CREATE_TOOL, model: 'authority-session', prompt: 'review', agent: R } as never)
  await h.clock.advance(3_000)
  for (const surface of SURFACES) {
    const b = await mountBand($, surface, WIDE)
    const tree = await b.drawn()
    expect(rowsOf(tree), surface).toHaveLength(2)
    expect(textOf(tree), surface).not.toContain(R)
    expect(textOf(tree), surface).not.toContain('mixed agents')
    for (const model of ['authority-team', 'authority-session']) {
      await b.press({ key: keyOf(showButton(rowFor(await b.drawn(), model))!)! })
      const p = await mountPane($, surface, PANE, paneProps(120, 30))
      expect(textOf(await p.drawn()), surface).not.toContain('Agent:')
      await p.unmount()
    }
    await b.unmount()
  }
})

const PANE = 'claudish-show'
const WIDE = bandProps(200, 40)
const occurrences = (s: string, needle: string) => s.split(needle).length - 1
/**
 * The Show pane draws its tab strip, then a rule, then the detail panel. Spec rule 5 places the
 * agent line first in the detail panel, so the lines after the first rule are what it governs.
 */
function detailLines(paneText: string): string[] {
  const lines = paneText.split('\n')
  const rule = lines.findIndex(l => /^─+$/.test(l.trim()))
  if (rule < 1) throw new Error('expected a tab strip and a rule above the detail panel, got ' + JSON.stringify(paneText.slice(0, 200)))
  return lines.slice(rule + 1)
}
/** Spec rule 5: the agent line is the detail panel's first line, directly above the slot's own header. */
function expectAgentFirst(paneText: string, line: string, model: string, surface: string) {
  const detail = detailLines(paneText)
  expect(detail[0]!.trimStart().startsWith(line), `${surface}: first detail line ${JSON.stringify(detail[0])}`).toBe(true)
  expect(detail[1], `${surface}: slot header follows the agent line`).toMatch(/ (NEW|RUN|ASK|END|ERR|TMO|NIL|FMT|STP) /)
  expect(detail[1], surface).toContain(model)
}
/** The band header: Text elements with no Text above them that show the header mark. */
const headerTexts = (tree: unknown) => outerTexts(tree).filter(n => textOf(n).includes('◆ claudish'))

test('agent surfaces: homogeneous team shows agent once and every detail starts with it [REQ-3 REQ-6 REQ-11]', async ($, on) => {
  const h = harness(on, { rowPatch: row => ({ ...row, agent_requested: R, agent: R }) })
  await start($)
  const models = ['agent-first', 'agent-second', 'agent-third']
  const r = await startTeam($, h, 'plan-review', models)
  h.fake.set(r.runId, '02', 'COMPLETED')
  await h.clock.advance(3_000)
  for (const surface of SURFACES) {
    const band = await mountBand($, surface, WIDE)
    const tree = await band.drawn()
    expect(occurrences(textOf(tree), R), surface).toBe(1)
    const rows = rowsOf(tree)
    expect(rows, surface).toHaveLength(3)
    for (const row of rows) expect(textOf(row), surface).not.toContain(R)
    for (const model of models) {
      await band.press({ key: keyOf(showButton(rowFor(await band.drawn(), model))!)! })
      const p = await mountPane($, surface, PANE, paneProps(120, 30))
      expectAgentFirst(textOf(await p.drawn()), 'Agent: dev:reviewer', model, surface)
      await p.unmount()
    }
    await band.unmount()
  }
})

for (const mode of ['mixed', 'rejected', 'starting', 'other', 'delegation'] as const) {
  test(`agent surfaces: ${mode} rows and first detail line obey contract [REQ-4 REQ-5 REQ-6 REQ-11]`, async ($, on) => {
    const h = harness(on, { rowPatch: row => {
      if (mode === 'mixed') return { ...row, agent_requested: row.slot === '01' ? R : row.slot === '02' ? Q : null, agent: row.slot === '01' ? R : row.slot === '02' ? Q : null }
      if (mode === 'starting') return { ...row, state: 'STARTING', agent_requested: R, agent: null }
      if (mode === 'rejected') return row.slot === '02'
        ? { ...row, state: 'FAILED', agent_requested: R, agent: null, reason: 'agent_rejected', reason_detail: 'agent not found' }
        : { ...row, agent_requested: R, agent: R }
      return { ...row, agent_requested: R, agent: mode === 'other' ? 'dev:other' : R }
    } })
    await start($)
    const models = mode === 'mixed' ? ['mixed-first', 'mixed-second', 'mixed-third']
      : mode === 'rejected' ? ['reject-first', 'reject-second'] : ['agent-selected']
    if (mode === 'delegation') await startDelegation($, h, models[0]!)
    else await startTeam($, h, 'plan-review', models)
    await h.clock.advance(3_000)
    const expectedRows = mode === 'mixed' ? [R, Q, 'no agent']
      : mode === 'rejected' ? ['', 'requested dev:reviewer, loaded none']
      : mode === 'other' ? ['requested dev:reviewer, loaded dev:other'] : ['']
    const lines = mode === 'mixed' ? ['Agent: dev:reviewer', 'Agent: dev:qa-engineer', 'Agent: none']
      : mode === 'rejected' ? ['Agent: dev:reviewer', 'Agent: none (requested dev:reviewer) · agent_rejected: agent not found']
      : mode === 'starting' ? ['Agent: dev:reviewer (requested)']
      : mode === 'other' ? ['Agent: dev:other (requested dev:reviewer)'] : ['Agent: dev:reviewer']
    for (const surface of SURFACES) {
      const band = await mountBand($, surface, WIDE)
      const tree = await band.drawn()
      expect(rowsOf(tree), surface).toHaveLength(models.length)
      if (mode === 'mixed') expect(textOf(tree), surface).toContain('mixed agents')
      for (let n = 0; n < models.length; n++) {
        const row = rowFor(tree, models[n]!)
        expect(row, surface).toBeDefined()
        if (expectedRows[n]) expect(textOf(row), surface).toContain(expectedRows[n]!)
        else expect(textOf(row), surface).not.toContain(R)
        await band.press({ key: keyOf(showButton(rowFor(await band.drawn(), models[n]!))!)! })
        const p = await mountPane($, surface, PANE, paneProps(120, 30))
        expectAgentFirst(textOf(await p.drawn()), lines[n]!, models[n]!, surface)
        await p.unmount()
      }
      await band.unmount()
    }
  })
}

test('agent surfaces case 8: narrow header uses one truncate-end Text, counts before agent and badges retained [REQ-8 REQ-11]', async ($, on) => {
  const h = harness(on, { rowPatch: row => ({ ...row, agent_requested: R, agent: R }) })
  await start($)
  const r = await startTeam($, h, 'plan-review', ['agent-first', 'agent-second', 'agent-third'])
  h.fake.set(r.runId, '02', 'COMPLETED')
  await h.clock.advance(3_000)
  for (const surface of SURFACES) {
    const b = await mountBand($, surface, bandProps(45, 20))
    const t = await b.drawn()
    const headers = headerTexts(t)
    expect(headers, surface).toHaveLength(1)
    expect(headers[0]!.props?.wrap, surface).toBe('truncate-end')
    expect(textOf(headers[0]), surface).toBe(countSegments.join(''))
    const rows = rowsOf(t)
    expect(rows, surface).toHaveLength(3)
    expect(rows.map(textOf).filter(t => t.includes(' RUN ')), surface).toHaveLength(2)
    expect(rows.map(textOf).filter(t => t.includes(' END ')), surface).toHaveLength(1)
    await b.unmount()
  }
})

for (const kind of ['team', 'delegation'] as const) {
  for (const variant of ['absent', 'null', 'unsafe'] as const) {
    test(`agent surfaces ${kind}/${variant}: old header and no agent detail [REQ-2 REQ-7 REQ-11]`, async ($, on) => {
      const fields: Json = variant === 'absent' ? {}
        : variant === 'null' ? { agent_requested: null, agent: null }
        : { agent_requested: 'bad agent', agent: '\u001b[31mx' }
      const h = harness(on, { rowPatch: row => ({ ...row, ...fields }) })
      await start($)
      if (kind === 'team') await startTeam($, h, 'plan-review', ['baseline-model'])
      else await startDelegation($, h, 'baseline-model')
      await h.clock.advance(3_000)
      for (const surface of SURFACES) {
        const b = await mountBand($, surface, WIDE)
        const tree = await b.drawn()
        const headers = headerTexts(tree)
        expect(headers, surface).toHaveLength(1)
        expect(textOf(headers[0]), surface).toBe(kind === 'team'
          ? '◆ claudish  plan-review · 1 running' : '◆ claudish · 1 running')
        expect(rowsOf(tree), surface).toHaveLength(1)
        expect(textOf(tree), surface).not.toMatch(/mixed agents|no agent|unknown agent|bad agent|requested|31mx/)
        await b.press({ key: keyOf(showButton(rowFor(tree, 'baseline-model'))!)! })
        const p = await mountPane($, surface, PANE, paneProps(120, 30))
        expect(textOf(await p.drawn()), surface).not.toContain('Agent:')
        await p.unmount()
        await b.unmount()
      }
    })
  }
}
