// Silent degradation: how each feed (server × run kind) is classified from what claudish
// answers, on both surfaces: state, calls and debug lines, and what the band draws of it.

import { expect, test } from 'claude-code/testing'
import type { ClaudishFeedSupport, ClaudishLedger, ClaudishRuns } from '../types'
import { MONITOR_GRACE_MS } from '../hooks/status/domain'
import { CREATE_TOOL, ENGINE_DRAWING, TEAM_TOOL, harness, start, type FakeOptions, type Harness, type ListOverride } from './fake-claudish'
import { PRECONTRACT_LIST_ERROR, contractError } from './scenario'
import { mountBand, mountPane } from './ui'

const SURFACES = ['terminal', 'desktop'] as const
const PANEL = 'plugin:claudish:claudish#panel'
const DELEG = 'plugin:claudish:claudish#delegation'

const runs = (h: Harness) => (h.state.get('runs') ?? { epoch: 0, starts: {}, list: [] }) as ClaudishRuns
const feeds = (h: Harness) => (h.state.get('feeds') ?? {}) as Record<string, ClaudishFeedSupport>
const states = (h: Harness, i = 0) => runs(h).list[i]?.slots.map(s => s.state)
const ledger = (h: Harness) => (h.state.get('wakeLedger') ?? { epoch: 0, entries: {} }) as ClaudishLedger

/** A run is drawn while it has a slot or its feed speaks (architecture §3.4). */
const drawn = (h: Harness) => runs(h).list.filter(r => r.slots.length > 0 || feeds(h)[`${r.ref.server}#${r.ref.kind}`]?.kind === 'speaks')

/** A list override that answers `make(n)` from the n-th call on, once `from` is reached. */
function after(from: number, make: (n: number) => ListOverride | undefined) {
  return (n: number) => (n >= from ? make(n) : undefined)
}

for (const surface of SURFACES) {
  test(`feeds: pre-contract (10.3.0) — silent, 0 team list calls, exactly 1 list_sessions call [${surface}]`, async ($, on) => {
    const h = harness(on, { precontract: true })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    await $.tool.call({ tool: CREATE_TOOL, model: 'haiku-4.5', prompt: 'x' })
    await h.clock.advance(60_000)
    expect(feeds(h)[PANEL]).toMatchObject({ kind: 'unsupported', spoke: false })
    expect(feeds(h)[DELEG]).toMatchObject({ kind: 'unsupported', spoke: false })
    expect(drawn(h)).toEqual([])
    expect(await (await mountBand($, surface)).drawn()).toEqual(ENGINE_DRAWING) // no plugin element in the band
    expect(h.submits).toEqual([])
    expect(h.debug).toHaveLength(2) // one per feed
    expect(h.fake.listCalls('runs')).toHaveLength(0)
    expect(h.fake.listCalls('sessions')).toHaveLength(1)
  })

  test(`feeds: version 2 — the delegation feed declines on its first answer [${surface}]`, async ($, on) => {
    const h = harness(on, { version2: true })
    await start($, surface)
    await $.tool.call({ tool: CREATE_TOOL, model: 'haiku-4.5', prompt: 'x' })
    await h.clock.advance(60_000)
    expect(feeds(h)[DELEG]).toMatchObject({ kind: 'unsupported', spoke: false })
    expect(drawn(h)).toEqual([])
    expect(await (await mountBand($, surface)).drawn()).toEqual(ENGINE_DRAWING)
    expect(h.debug).toHaveLength(1)
    expect(h.fake.listCalls('sessions')).toHaveLength(1)
  })

  for (const [name, options] of [
    ['refused ×3 (a ContractError while probing)', { listAnswer: () => ({ text: contractError('invalid_args', 'x'), isError: true }) }],
    ['rejected ×3 (deny while probing)', { listAnswer: () => ({ deny: 'transport closed' }) }],
  ] as [string, FakeOptions][]) {
    test(`feeds: ${name} — unsupported after the third, not before [${surface}]`, async ($, on) => {
      const h = harness(on, options)
      await start($, surface)
      await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
      await h.clock.advance(0)
      await h.clock.advance(1000) // two bad answers (the second after a 2 s backoff is not yet due)
      expect(feeds(h)[PANEL]?.kind).toBe('probing')
      await h.clock.advance(60_000)
      expect(feeds(h)[PANEL]).toMatchObject({ kind: 'unsupported', spoke: false })
      expect(h.fake.listCalls('runs')).toHaveLength(3)
      expect(drawn(h)).toEqual([])
      expect(h.debug).toHaveLength(1)
    })
  }

  test(`feeds: given up while probing, then a contract start answer — watched again [${surface}]`, async ($, on) => {
    let down = true
    const h = harness(on, { listAnswer: () => (down ? { deny: 'transport closed' } : undefined) })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    await h.clock.advance(60_000)
    expect(feeds(h)[PANEL]).toMatchObject({ kind: 'unsupported', spoke: false })
    down = false
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r2' })
    expect(feeds(h)[PANEL]?.kind).toBe('probing')
    await h.clock.advance(1000)
    expect(feeds(h)[PANEL]?.kind).toBe('speaks')
    expect(drawn(h).length).toBeGreaterThan(0)
    h.fake.set(h.fake.runs[1]!.runId, '01', 'COMPLETED')
    await h.clock.advance(1000)
    expect(h.submits).toHaveLength(1)
  })

  test(`feeds: one bad frame — a speaking feed survives one garbled answer [${surface}]`, async ($, on) => {
    const h = harness(on, { listAnswer: n => (n === 3 ? { text: '<<<not json' } : undefined) })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    await h.clock.advance(1000) // calls 1, 2
    await h.clock.advance(1000) // call 3: garbled
    expect(feeds(h)[PANEL]?.kind).toBe('speaks')
    expect(runs(h).list[0]?.unreachableSince).not.toBeNull()
    expect(states(h)).toEqual(['RUNNING', 'RUNNING', 'RUNNING', 'RUNNING'])
    await h.clock.advance(3000)
    expect(runs(h).list[0]?.unreachableSince).toBeNull()
    h.fake.set(h.fake.runs[0]!.runId, '03', 'COMPLETED')
    await h.clock.advance(1000)
    expect(states(h)).toEqual(['RUNNING', 'RUNNING', 'COMPLETED', 'RUNNING'])
    await h.clock.advance(5000)
    expect(h.submits).toHaveLength(1) // the later transition wakes once
    expect(h.submits[0]).toContain('slot 03 grok-4.6: COMPLETED')
  })

  test(`feeds: many garbled answers — never unsupported; LOST at 5 min [${surface}]`, async ($, on) => {
    const h = harness(on, { listAnswer: after(2, () => ({ text: '<<<' })) })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    await h.clock.advance(1000)
    await h.clock.advance(4 * 60_000)
    expect(feeds(h)[PANEL]?.kind).toBe('speaks')
    expect(states(h)?.every(s => s === 'RUNNING')).toBe(true)
    const band = await mountBand($, surface)
    expect(await band.findAll({ type: 'Text', text: /^\? unknown/ })).toHaveLength(4)
    expect(await band.findAll({ type: 'Text', text: /▶ running/ })).toHaveLength(0) // never a stale running row
    await h.clock.advance(2 * 60_000)
    expect(states(h)?.every(s => s === 'LOST')).toBe(true)
    expect(runs(h).list[0]?.lostReason).toBe('unreachable')
    expect(feeds(h)[PANEL]?.kind).toBe('speaks')
    expect(h.submits).toHaveLength(1) // one wake, naming the four LOST slots
    expect(h.submits[0]!.match(/no longer reported by claudish, so check its status/g)).toHaveLength(4)
  })

  test(`feeds: one bad entry — that row reads unknown model, the feed still speaks [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: row => (row.slot === '02' ? { ...row, model: null } : row) })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r2', models: ['m-x'] })
    await h.clock.advance(1000)
    expect(feeds(h)[PANEL]?.kind).toBe('speaks')
    expect(runs(h).list[0]?.slots.map(s => s.model)).toEqual(['gpt-6.1-sol', 'unknown model', 'grok-4.6', 'glm-5.3'])
    expect(runs(h).list[1]?.slots.map(s => s.model)).toEqual(['m-x'])
    expect(await (await mountBand($, surface)).find({ type: 'Text', text: /^unknown model/ })).toBeDefined()
  })

  test(`feeds: no capture — Show opens the tab with the unavailable note; 0 capture calls [${surface}]`, async ($, on) => {
    const h = harness(on, { noCapture: true })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    await h.clock.advance(1000)
    const band = await mountBand($, surface)
    await band.press({ key: `show:${runs(h).list[0]!.id}/02` })
    await h.clock.advance(30_000)
    expect(h.opens).toHaveLength(1)
    const pane = await mountPane($, surface, h.opens[0]!.id)
    expect(await pane.find({ type: 'Text', text: /Live screen not available from this claudish version/ })).toBeDefined()
    expect(h.fake.captureCalls()).toHaveLength(0)
  })

  test(`feeds: no cancel — no Stop on any row [${surface}]`, async ($, on) => {
    const h = harness(on, { noCancel: true })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    await h.clock.advance(1000)
    const band = await mountBand($, surface)
    expect((await band.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('stop:'))).toHaveLength(0)
    expect(await band.findAll({ type: 'Button', text: 'Show' })).toHaveLength(4)
  })

  for (const [what, override] of [
    ['precontract (an object with no contract_version)', { text: JSON.stringify({ runs: [] }) }],
    ['precontract (a plain-text error)', { text: PRECONTRACT_LIST_ERROR, isError: true }],
    ['declines (contract version 2)', { text: JSON.stringify({ contract_version: 2, capabilities: ['list'], runs: [] }) }],
  ] as [string, ListOverride][]) {
    test(`feeds: one ${what} frame from a speaking feed — it stays, no LOST [${surface}]`, async ($, on) => {
      const h = harness(on, { listAnswer: n => (n === 3 ? override : undefined) })
      await start($, surface)
      await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
      await h.clock.advance(2000)
      expect(feeds(h)[PANEL]).toMatchObject({ kind: 'speaks', declined: 1 })
      expect(runs(h).list[0]?.unreachableSince).not.toBeNull()
      await h.clock.advance(5000)
      expect(feeds(h)[PANEL]).toMatchObject({ kind: 'speaks', declined: 0 })
      expect(runs(h).list[0]?.unreachableSince).toBeNull()
      expect(states(h)?.includes('LOST')).toBe(false)
      expect(runs(h).list[0]?.lostReason).toBeNull()
      expect(h.attempts).toHaveLength(0) // no wake for one odd frame
      h.fake.set(h.fake.runs[0]!.runId, '02', 'COMPLETED')
      await h.clock.advance(3000)
      expect(h.submits).toHaveLength(1) // a later transition wakes once
    })
  }

  test(`feeds: withdrawn — three declarations end live slots LOST, polling of that feed stops [${surface}]`, async ($, on) => {
    let withdrawn = false
    const h = harness(on, { listAnswer: () => (withdrawn ? { text: PRECONTRACT_LIST_ERROR, isError: true } : undefined) })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    const runId = h.fake.runs[0]!.runId
    await $.turn.start({ text: 'go', turnId: 't1' }) // a main turn holds 01's notice: one pending ledger entry
    h.fake.set(runId, '01', 'COMPLETED')
    await h.clock.advance(1000)
    expect(Object.values(ledger(h).entries).map(e => e.kind)).toEqual(['pending'])
    withdrawn = true
    await h.clock.advance(1000)
    await h.clock.advance(1000)
    expect(feeds(h)[PANEL]?.kind).toBe('speaks')
    await h.clock.advance(1000)
    expect(feeds(h)[PANEL]).toMatchObject({ kind: 'unsupported', spoke: true })
    expect(states(h)).toEqual(['COMPLETED', 'LOST', 'LOST', 'LOST'])
    expect(runs(h).list[0]?.lostReason).toBe('contract withdrawn')
    expect(drawn(h)).toHaveLength(1)
    expect(h.debug.filter(l => l.includes('withdrawn'))).toHaveLength(1)
    const n = h.fake.listCalls('runs').length
    await h.clock.advance(30_000)
    expect(h.fake.listCalls('runs')).toHaveLength(n)
    expect(h.attempts).toHaveLength(0)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await h.clock.settle()
    await h.clock.advance(MONITOR_GRACE_MS) // a settled run is held after the turn for the monitor line it kept queued
    expect(h.submits).toHaveLength(1) // 1 wake names the LOST slots; the pending entry is delivered with it
    expect(h.submits[0]).toContain('slot 01 gpt-6.1-sol: COMPLETED')
    expect(h.submits[0]!.match(/no longer reported by claudish/g)).toHaveLength(3)
    expect(Object.values(ledger(h).entries).every(e => e.kind === 'delivered')).toBe(true)
  })

  test(`feeds: withdrawn — a run never listed on that feed gets the synthetic * slot, LOST [${surface}]`, async ($, on) => {
    let withdrawn = false
    const h = harness(on, { listAnswer: () => (withdrawn ? { text: JSON.stringify({ runs: [] }) } : undefined) })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    await h.clock.advance(1000)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r2' })
    h.fake.runs[1]!.hidden = true
    await h.clock.advance(1000)
    withdrawn = true
    await h.clock.advance(3000)
    expect(feeds(h)[PANEL]).toMatchObject({ kind: 'unsupported', spoke: true })
    expect(runs(h).list[1]?.slots.map(s => [s.slot, s.state])).toEqual([['*', 'LOST']])
    expect(runs(h).list[1]?.settledAt).not.toBeNull()
    await h.clock.advance(MONITOR_GRACE_MS) // settled runs wait for claudish's monitor line first; none comes
    expect(h.submits).toHaveLength(1) // one wake: r1's LOST slots and r2 never listed
    expect(h.submits[0]).toContain("run r2 never appeared in claudish's list, so check its status")
  })

  test(`feeds: an absent server — no claudish call, no loop work [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await h.clock.advance(60_000)
    expect(h.fake.calls).toEqual([])
    expect(h.debug).toEqual([])
  })

  test(`feeds: a direct registration answers under its own server name [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await $.tool.call({ tool: 'mcp__claudish__team', mode: 'run', path: 'r1' })
    await h.clock.advance(1000)
    expect(h.fake.listCalls('runs').every(c => c.server === 'claudish')).toBe(true)
    expect(feeds(h)['claudish#panel']?.kind).toBe('speaks')
  })
}
