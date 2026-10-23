// Blind coverage of MTL-191 "pending" vs "mismatch" (spec Display rules, rule 5; contract
// cases 5b and 5c). Expected values come from the spec and public contract only.
import { expect } from 'claude-code/testing'
import { test } from '../kit'
import type { ClaudishRun, ClaudishSlot, ClaudishSlotState, ClaudishPaneView } from '../../types'
import { batchAgent, slotAgent } from '../../hooks/status/domain'
import {
  bandAgent, bandModel, paneAgentLine, paneAgentRows, paneModel,
  rowAgentText, type BandInput,
} from '../../hooks/status/layout'

const R = 'dev:reviewer'
const OTHER = 'dev:other'
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
const header = (m: NonNullable<ReturnType<typeof bandModel>>) => m.header.map(s => s.text).join('')
const view = (r: ClaudishRun, s: ClaudishSlot): ClaudishPaneView => ({
  runId: r.id, slot: s.slot, model: s.model, status: 'live', frame: null, note: null,
})
const pane = (i: BandInput, r: ClaudishRun, s: ClaudishSlot) =>
  paneModel(view(r, s), i.runs, { columns: 80, rows: 20, paint: true }, NOW, i.feeds)

// 1. Case 5b: a live row whose transcript has not been read yet is pending, not a mismatch.
for (const state of ['RUNNING', 'AWAITING_INPUT', 'AWAITING_PERMISSION'] as const satisfies readonly ClaudishSlotState[]) {
  test(`agent pending case 5b ${state}: requested only is no mismatch, header names it, plain detail line [REQ-5 pending]`, () => {
    const s = slot('01', { state, agentRequested: R, agent: null })
    const r = run('a', [s])
    const i = input([r])
    expect(slotAgent(s)).toEqual({ requested: R, loaded: null, name: R, mismatch: false })
    expect(batchAgent([s])).toEqual({ kind: 'one', name: R })
    expect(bandAgent(i.runs, i.feeds)).toEqual({ kind: 'one', name: R })
    expect(paneAgentRows(i.runs, i.feeds)).toBe(1)
    const m = bandModel(i)!
    expect(m).not.toBeNull()
    expect(header(m).endsWith(' · dev:reviewer')).toBe(true)
    if (state === 'RUNNING') expect(header(m)).toBe('◆ claudish  plan-review · 1 running · dev:reviewer')
    expect(m.rows.map(x => x.agent)).toEqual([''])
    expect(m.rows.map(x => x.agentMismatch)).toEqual([false])
    expect(rowAgentText(slotAgent(s), { kind: 'one', name: R })).toBe('')
    expect(paneAgentLine(s, { kind: 'one', name: R })).toEqual({ text: 'Agent: dev:reviewer (requested)', mismatch: false })
    expect(pane(i, r, s).agent).toEqual([{ text: 'Agent: dev:reviewer (requested)' }])
  })
}

// 2. Case 5c: a live row that loaded a different agent IS a mismatch.
test('agent pending case 5c RUNNING: different loaded agent is a mismatch with warning detail line [REQ-5 mismatch]', () => {
  const s = slot('01', { state: 'RUNNING', agentRequested: R, agent: OTHER })
  const r = run('a', [s])
  const i = input([r])
  const batch = { kind: 'one', name: OTHER } as const
  expect(slotAgent(s)).toEqual({ requested: R, loaded: OTHER, name: OTHER, mismatch: true })
  expect(batchAgent([s])).toEqual(batch)
  expect(bandAgent(i.runs, i.feeds)).toEqual(batch)
  expect(paneAgentRows(i.runs, i.feeds)).toBe(1)
  const m = bandModel(i)!
  expect(header(m)).toBe('◆ claudish  plan-review · 1 running · dev:other')
  expect(m.rows.map(x => x.agent)).toEqual(['requested dev:reviewer, loaded dev:other'])
  expect(m.rows.map(x => x.agentMismatch)).toEqual([true])
  expect(rowAgentText(slotAgent(s), batch)).toBe('requested dev:reviewer, loaded dev:other')
  expect(paneAgentLine(s, batch)).toEqual({ text: 'Agent: dev:other (requested dev:reviewer)', mismatch: true })
  expect(pane(i, r, s).agent).toEqual([{ text: 'Agent: dev:other (requested dev:reviewer)', color: 'warning' }])
})

// 3. The settled side: once a row is terminal, a null loaded agent is no longer "not read yet".
const settled: { state: ClaudishSlotState; over: Partial<ClaudishSlot> }[] = [
  { state: 'COMPLETED', over: {} },
  { state: 'FAILED', over: { reason: 'provider_error', detail: 'upstream 502' } },
  { state: 'CANCELLED', over: {} },
]
for (const c of settled) {
  test(`agent pending settled ${c.state}: requested with loaded none is a mismatch with warning detail line [REQ-5 mismatch]`, () => {
    const s = slot('01', { state: c.state, agentRequested: R, agent: null, ...c.over })
    const r = run('a', [s])
    const i = input([r])
    const batch = { kind: 'one', name: R } as const
    expect(slotAgent(s)).toEqual({ requested: R, loaded: null, name: R, mismatch: true })
    expect(batchAgent([s])).toEqual(batch)
    expect(paneAgentRows(i.runs, i.feeds)).toBe(1)
    const m = bandModel(i)!
    expect(header(m).endsWith(' · dev:reviewer')).toBe(true)
    expect(m.rows.map(x => x.agent)).toEqual(['requested dev:reviewer, loaded none'])
    expect(m.rows.map(x => x.agentMismatch)).toEqual([true])
    expect(rowAgentText(slotAgent(s), batch)).toBe('requested dev:reviewer, loaded none')
    // The reason is appended only for agent_rejected (rule 5); none of these carries it.
    expect(paneAgentLine(s, batch)).toEqual({ text: 'Agent: none (requested dev:reviewer)', mismatch: true })
    expect(pane(i, r, s).agent).toEqual([{ text: 'Agent: none (requested dev:reviewer)', color: 'warning' }])
  })
}

// 4. A pending slot does not split a batch: its row agent is the requested name.
test('agent pending team: one loaded and one pending slot form one batch with no row agent text [REQ-3 REQ-5 pending]', () => {
  const loaded = slot('01', { state: 'RUNNING', agentRequested: R, agent: R })
  const pending = slot('02', { state: 'RUNNING', agentRequested: R, agent: null })
  const r = run('a', [loaded, pending])
  const i = input([r])
  const batch = { kind: 'one', name: R } as const
  expect(batchAgent([loaded, pending])).toEqual(batch)
  expect(bandAgent(i.runs, i.feeds)).toEqual(batch)
  expect(paneAgentRows(i.runs, i.feeds)).toBe(1)
  const m = bandModel(i)!
  expect(header(m)).toBe('◆ claudish  plan-review · 2 running · dev:reviewer')
  expect(m.rows.map(x => x.agent)).toEqual(['', ''])
  expect(m.rows.map(x => x.agentMismatch)).toEqual([false, false])
  expect(m.plan!.agent).toBe(0)
  expect(rowAgentText(slotAgent(loaded), batch)).toBe('')
  expect(rowAgentText(slotAgent(pending), batch)).toBe('')
  expect(pane(i, r, loaded).agent).toEqual([{ text: 'Agent: dev:reviewer' }])
  expect(pane(i, r, pending).agent).toEqual([{ text: 'Agent: dev:reviewer (requested)' }])
})
