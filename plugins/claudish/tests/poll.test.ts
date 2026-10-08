import type { Register } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { ClaudishFeedSupport, ClaudishLedger, ClaudishRuns } from '../types'
import { MONITOR_GRACE_MS } from '../hooks/status/domain'
import { CREATE_TOOL, TEAM_TOOL, harness, start, type Harness } from './fake-claudish'
import { monitorRecordOf } from './scenario'

const FEED = 'plugin:claudish:claudish#panel'
const DFEED = 'plugin:claudish:claudish#delegation'

const runs = (h: Harness) => (h.state.get('runs') ?? { epoch: 0, starts: {}, list: [] }) as ClaudishRuns
const feeds = (h: Harness) => (h.state.get('feeds') ?? {}) as Record<string, ClaudishFeedSupport>
const ledger = (h: Harness) => (h.state.get('wakeLedger') ?? { epoch: 0, entries: {} }) as ClaudishLedger
const slotState = (h: Harness, i: number, slot: string) => runs(h).list[i]?.slots.find(s => s.slot === slot)?.state

test('poll: registration — a claudish start through the plugin hook is watched and listed', async ($, on) => {
  const h = harness(on)
  await start($)
  const ran = await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1/', models: ['gpt-6.1-sol', 'kimi-k3'] })
  expect(ran.isError).toBeUndefined()
  expect(runs(h).list).toHaveLength(1)
  const run = runs(h).list[0]
  expect(run?.ref).toEqual({ kind: 'panel', server: 'plugin:claudish:claudish', token: h.fake.runs[0]?.runId, address: '/w/r1', monitor: monitorRecordOf(h.fake.runs[0]!.runId) })
  expect(run?.label).toBe('r1')
  expect(run?.generation).toBe(1)
  await h.clock.advance(1000)
  expect(h.fake.listCalls('runs').length).toBeGreaterThanOrEqual(1)
  expect(feeds(h)[FEED]?.kind).toBe('speaks')
  expect(runs(h).list[0]?.slots.map(s => s.slot)).toEqual(['01', '02'])
  expect(slotState(h, 0, '01')).toBe('RUNNING')
  expect(runs(h).list[0]?.missedPolls).toBe(0)
})

const DENY_BENEATH = {
  name: 'deny-beneath',
  tier: 'append' as const,
  register(on: Parameters<Register>[0]) {
    on('tool.call', ($, e, next) => ((e as unknown as { path?: string }).path === 'denied' ? { deny: 'denied by policy' } : next(e)))
  },
}

test('poll: registration — other tools, denied and errored starts add nothing', { plugins: [DENY_BENEATH] }, async ($, on) => {
  const h = harness(on)
  await start($)
  const denied = await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'denied' })
  expect(denied.deny).toBe('denied by policy')
  await $.tool.call({ tool: 'mcp__other__team', mode: 'run', path: 'r1' })
  await $.tool.call({ tool: TEAM_TOOL, mode: 'status', path: 'r1' })
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r2' })
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r2' }) // refused: r2 is still active
  expect(runs(h).list).toHaveLength(1)
  expect(h.debug).toEqual([])
})

test('poll: an unidentified start adds nothing and logs one debug line', async ($, on) => {
  const h = harness(on, { noRunPath: true })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: '/w/abs' })
  expect(runs(h).list).toHaveLength(0)
  expect(h.debug).toHaveLength(1)
  expect(h.debug[0]).toMatch(/not watched/)
})

test('poll: an already settled start is not watched', async ($, on) => {
  const h = harness(on, { startSettled: true })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'done' })
  expect(runs(h).list).toHaveLength(0)
  await h.clock.advance(5000)
  expect(h.fake.listCalls()).toHaveLength(0)
})

test('poll: pre-contract start — no run, panel feed unsupported, one debug line, 0 list calls', async ($, on) => {
  const h = harness(on, { precontract: true })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  expect(runs(h).list).toHaveLength(0)
  expect(feeds(h)[FEED]?.kind).toBe('unsupported')
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r2' })
  await h.clock.advance(60_000)
  expect(h.debug).toHaveLength(1)
  expect(h.fake.listCalls('runs')).toHaveLength(0)
})

test('poll: same path twice — two runs, own run ids, generations 1 and 2, never inheriting', async ($, on) => {
  const h = harness(on, { models: ['m-a', 'm-b'] })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: '/w/r1' })
  await h.clock.advance(1000)
  const first = h.fake.runs[0]!
  h.fake.set(first.runId, '01', 'COMPLETED')
  h.fake.set(first.runId, '02', 'COMPLETED')
  await h.clock.advance(1000)
  expect(runs(h).list[0]?.settledAt).not.toBeNull()
  await h.clock.advance(MONITOR_GRACE_MS) // a settled run waits for claudish's monitor line; none comes
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: '/w/r1' })
  const second = h.fake.runs[1]!
  expect(second.runId).not.toBe(first.runId)
  expect(runs(h).list.map(r => r.generation)).toEqual([1, 2])
  expect(runs(h).list[0]?.id).not.toBe(runs(h).list[1]?.id)
  await h.clock.advance(1000)
  expect(runs(h).list[1]?.settledAt).toBeNull()
  expect(slotState(h, 1, '01')).toBe('RUNNING')
  h.fake.set(second.runId, '01', 'FAILED', 'blocked')
  await h.clock.advance(1000)
  expect(slotState(h, 1, '01')).toBe('FAILED')
  expect(runs(h).list[1]?.slots[0]?.reason).toBe('blocked')
  expect(slotState(h, 0, '01')).toBe('COMPLETED')
  // each run wakes on its own transitions: 2 wakes in total, under disjoint ledger keys
  expect(h.submits).toHaveLength(2)
  expect(h.submits[0]).toContain(`run_id "${first.runId}"`)
  expect(h.submits[1]).toContain(`Run r1·2 (path "/w/r1", run_id "${second.runId}")`)
  const [a, b] = runs(h).list.map(r => r.id)
  expect(Object.keys(ledger(h).entries).sort()).toEqual([`${a}/01`, `${a}/02`, `${b}/01`].sort())
})

test('poll: same basename at two paths — two runs, each matched to its own row', async ($, on) => {
  const h = harness(on, { models: ['m-a'] })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: '/w/a/r' })
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: '/w/b/r' })
  h.fake.set(h.fake.runs[1]!.runId, '01', 'COMPLETED')
  await h.clock.advance(1000)
  expect(runs(h).list).toHaveLength(2)
  expect(slotState(h, 0, '01')).toBe('RUNNING')
  expect(slotState(h, 1, '01')).toBe('COMPLETED')
})

test('poll: delegations are listed with completed sessions, and one that completes is seen COMPLETED', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.tool.call({ tool: CREATE_TOOL, model: 'haiku-4.5', prompt: 'do it' })
  const s = h.fake.sessions[0]!
  const run = runs(h).list[0]
  expect(run?.ref.kind).toBe('delegation')
  expect(run?.label).toBe(`#${s.id.slice(0, 6)}`)
  await h.clock.advance(1000)
  h.fake.set(s.id, s.id, 'COMPLETED')
  await h.clock.advance(1000)
  expect(h.fake.listCalls('sessions').every(c => c.args.include_completed === true)).toBe(true)
  expect(slotState(h, 0, s.id)).toBe('COMPLETED')
  expect(runs(h).list[0]?.lostReason).toBeNull()
  expect(feeds(h)[DFEED]?.kind).toBe('speaks')
  await h.clock.advance(10_000)
  expect(h.submits).toHaveLength(1) // wakes once, never LOST
  expect(h.submits[0]).toContain('haiku-4.5: COMPLETED')
})

test('poll: server restart — the run vanishes, LOST only after ≥5 misses spanning ≥30 s', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  h.fake.restart()
  await h.clock.advance(4000)
  expect(slotState(h, 0, '01')).toBe('RUNNING')
  await h.clock.advance(60_000)
  expect(slotState(h, 0, '01')).toBe('LOST')
  expect(runs(h).list[0]?.lostReason).toBe('vanished')
  expect(runs(h).list[0]?.settledAt).not.toBeNull()
  const listed = h.fake.listCalls('runs').length
  await h.clock.advance(10_000)
  expect(h.fake.listCalls('runs').length).toBe(listed)
  expect(h.submits).toHaveLength(1) // one wake telling the model to check its status
  expect(h.submits[0]!.match(/no longer reported by claudish, so check its status/g)).toHaveLength(4)
})

test('poll: never listed — synthetic * slot LOST after the missing deadline, then no more list calls', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  h.fake.runs[0]!.hidden = true
  await h.clock.advance(2000)
  expect(runs(h).list[0]?.slots).toEqual([])
  expect(runs(h).list[0]?.settledAt).toBeNull()
  await h.clock.advance(40_000)
  const run = runs(h).list[0]
  expect(run?.slots.map(s => [s.slot, s.state])).toEqual([['*', 'LOST']])
  expect(run?.lostReason).toBe('never listed')
  expect(run?.settledAt).not.toBeNull()
  const listed = h.fake.listCalls('runs').length
  await h.clock.advance(10_000)
  expect(h.fake.listCalls('runs').length).toBe(listed)
  expect(h.submits).toHaveLength(1) // one wake saying it never appeared
  expect(h.submits[0]).toContain("run r1 never appeared in claudish's list, so check its status")
})

test('poll: missing tolerance — 4 misses then reappearance resets; bookkeeping is written', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  h.fake.runs[0]!.hidden = true
  await h.clock.advance(3000)
  expect(runs(h).list[0]?.missedPolls).toBeGreaterThanOrEqual(3)
  h.fake.runs[0]!.hidden = false
  await h.clock.advance(1000)
  expect(runs(h).list[0]?.missedPolls).toBe(0)
  expect(runs(h).list[0]?.missingSince).toBeNull()
  h.fake.runs[0]!.hidden = true
  await h.clock.advance(3000)
  expect(slotState(h, 0, '01')).toBe('RUNNING')
  expect(runs(h).list[0]?.lostReason).toBeNull()
})

test('poll: unknown bound — a state outside the set is UNKNOWN, LOST after 10 min', async ($, on) => {
  const h = harness(on, { models: ['m-a'] })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  h.fake.set(h.fake.runs[0]!.runId, '01', 'PAUSED')
  await h.clock.advance(1000)
  expect(slotState(h, 0, '01')).toBe('UNKNOWN')
  await h.clock.advance(9 * 60_000)
  expect(slotState(h, 0, '01')).toBe('UNKNOWN')
  await h.clock.advance(61_000)
  expect(slotState(h, 0, '01')).toBe('LOST')
  expect(runs(h).list[0]?.lostReason).toBe('unknown state')
})

test('poll: missing slot — a live slot its listed run stops listing is LOST after 30 s; a reappearing one is not', async ($, on) => {
  const h = harness(on, { models: ['m-a', 'm-b'] })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  const run = h.fake.runs[0]!
  const dropped = run.slots.splice(1, 1)
  await h.clock.advance(10_000)
  expect(slotState(h, 0, '02')).toBe('RUNNING')
  run.slots.push(...dropped)
  await h.clock.advance(1000)
  expect(runs(h).list[0]?.unknownSince).toEqual({})
  run.slots.splice(1, 1)
  await h.clock.advance(29_000)
  expect(slotState(h, 0, '02')).toBe('RUNNING')
  await h.clock.advance(2000)
  expect(slotState(h, 0, '02')).toBe('LOST')
  expect(slotState(h, 0, '01')).toBe('RUNNING')
  expect(runs(h).list[0]?.lostReason).toBe('slot missing')
})

test('poll: a tick that throws after the last merge is retried — the run still wakes, once', async ($, on) => {
  const h = harness(on, { models: ['m-a'] })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  let misses = 12 // more than one update retries (8 passes): that ledger write does not converge, so the tick throws
  h.failWrite = key => key === 'wakeLedger' && misses-- > 0
  h.fake.set(h.fake.runs[0]!.runId, '01', 'COMPLETED')
  await h.clock.advance(1000)
  expect(runs(h).list[0]?.settledAt).not.toBeNull()
  expect(h.debug.some(l => l.includes('poll tick failed'))).toBe(true)
  expect(h.submits).toHaveLength(0)
  await h.clock.advance(MONITOR_GRACE_MS + 60_000)
  expect(h.submits).toHaveLength(1)
  expect(h.submits[0]).toContain('slot 01 m-a: COMPLETED')
  await h.clock.advance(120_000)
  expect(h.submits).toHaveLength(1)
})

test('poll: unreachable — refusals of a speaking feed: LOST at 5 min, one debug line per run', async ($, on) => {
  let refuse = false
  const h = harness(on, { listAnswer: () => (refuse ? { text: '{"error":{"code":"invalid_args","message":"x"}}', isError: true } : undefined) })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  refuse = true
  await h.clock.advance(2000)
  expect(runs(h).list[0]?.unreachableSince).not.toBeNull()
  expect(feeds(h)[FEED]?.kind).toBe('speaks')
  await h.clock.advance(5 * 60_000 + 30_000)
  expect(slotState(h, 0, '01')).toBe('LOST')
  expect(runs(h).list[0]?.lostReason).toBe('unreachable')
  expect(h.debug.filter(l => l.includes('not answering'))).toHaveLength(1)
})

test('poll: bookkeeping persists — unreachable then an identical ok clears unreachableSince', async ($, on) => {
  let refuse = false
  const h = harness(on, { listAnswer: () => (refuse ? { deny: 'transport down' } : undefined) })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  const runId = h.fake.runs[0]!.runId
  for (const s of ['01', '02', '03', '04']) h.fake.set(runId, s, 'COMPLETED')
  h.fake.set(runId, '04', 'RUNNING')
  await h.clock.advance(1000)
  refuse = true
  await h.clock.advance(3000)
  expect(runs(h).list[0]?.unreachableSince).not.toBeNull()
  refuse = false
  await h.clock.advance(31_000)
  expect(runs(h).list[0]?.unreachableSince).toBeNull()
})

test('poll: cadence — 1 s while active, exponential backoff on refusals, reset on ok', async ($, on) => {
  let refuse = false
  const h = harness(on, { models: ['m-a'], listAnswer: () => (refuse ? { deny: 'down' } : undefined) })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  const before = h.fake.listCalls('runs').length
  await h.clock.advance(5000)
  expect(h.fake.listCalls('runs').length - before).toBe(5) // active: one a second
  refuse = true
  const b0 = h.fake.listCalls('runs').length
  await h.clock.advance(1000) // refused → failures 1 → next in 2 s
  await h.clock.advance(2000) // refused → failures 2 → next in 4 s
  await h.clock.advance(4000) // refused → failures 3 → next in 8 s
  expect(h.fake.listCalls('runs').length - b0).toBe(3)
  await h.clock.advance(7000)
  expect(h.fake.listCalls('runs').length - b0).toBe(3)
  refuse = false
  await h.clock.advance(1000) // the 8 s tick answers ok → failures 0
  const b1 = h.fake.listCalls('runs').length
  expect(b1 - b0).toBe(4)
  await h.clock.advance(1000)
  expect(h.fake.listCalls('runs').length - b1).toBe(1)
})

test('poll: backoff caps at 30 s', async ($, on) => {
  let refuse = false
  const h = harness(on, { models: ['m-a'], listAnswer: () => (refuse ? { deny: 'down' } : undefined) })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  refuse = true
  await h.clock.advance(1000 + 2000 + 4000 + 8000 + 16000) // five refusals
  const b0 = h.fake.listCalls('runs').length
  await h.clock.advance(29_000)
  expect(h.fake.listCalls('runs').length).toBe(b0)
  await h.clock.advance(1000)
  expect(h.fake.listCalls('runs').length).toBe(b0 + 1)
})

test('poll: quiet cadence — 3 s after 30 s without an activity change while idle keeps rising', async ($, on) => {
  const h = harness(on, { models: ['m-a'], rowPatch: row => ({ ...row, tokens_in: 1, tokens_out: 1, tool_calls: 1, turns_completed: 0, last_activity_at: '2026-10-07T00:00:00.000Z', activity: 'Bash' }) })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(31_000)
  const b0 = h.fake.listCalls('runs').length
  await h.clock.advance(9000)
  expect(h.fake.listCalls('runs').length - b0).toBe(3)
})

test('poll: unchanged ticks write no runs version', async ($, on) => {
  const h = harness(on, { models: ['m-a'] })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  h.fake.set(h.fake.runs[0]!.runId, '01', 'COMPLETED')
  await h.clock.advance(1000)
  const writes = h.writes.filter(([k]) => k === 'runs').length
  await h.clock.advance(10_000)
  expect(h.writes.filter(([k]) => k === 'runs').length).toBe(writes)
})

test('poll: a throwing tick does not end the chain', async ($, on) => {
  const h = harness(on, { models: ['m-a'] })
  let throws = 1
  h.panesAnswer = () => {
    if (throws-- > 0) throw new Error('panes exploded')
    return []
  }
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  await h.clock.advance(5000)
  expect(h.debug.filter(l => l.includes('tick failed'))).toHaveLength(1)
  expect(h.fake.listCalls('runs').length).toBeGreaterThanOrEqual(3)
})

test('poll: empty slots — a run missing for two polls is not settled and stays watched', async ($, on) => {
  const h = harness(on)
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  h.fake.runs[0]!.hidden = true
  await h.clock.advance(2000)
  expect(runs(h).list[0]?.settledAt).toBeNull()
  const n = h.fake.listCalls('runs').length
  await h.clock.advance(1000)
  expect(h.fake.listCalls('runs').length).toBe(n + 1)
})

test('poll: a start landing while the list answer is in flight is not marked unreachable', async ($, on) => {
  let release: (() => void) | null = null
  let holdNext = false
  const h = harness(on, {
    models: ['m-a'],
    beforeList: () => (holdNext ? new Promise<void>(r => { release = r }) : undefined),
  })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  holdNext = true
  await h.clock.advance(1000) // this tick asks for r1, and its answer is held
  holdNext = false
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r2' })
  ;(release as (() => void) | null)?.()
  await h.clock.settle()
  const r2 = runs(h).list.find(r => r.label === 'r2')
  expect(r2?.unreachableSince).toBeNull()
  await h.clock.advance(1000)
  expect(runs(h).list.find(r => r.label === 'r2')?.slots[0]?.state).toBe('RUNNING')
})

test('poll: handshake — a start landing while the stopping tick awaits ui.panes is polled next tick', async ($, on) => {
  const h = harness(on, { models: ['m-a'] })
  let hold: (() => void) | null = null
  let holding = false
  h.panesAnswer = async () => {
    if (holding) await new Promise<void>(r => { hold = r })
    return []
  }
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  h.fake.set(h.fake.runs[0]!.runId, '01', 'COMPLETED')
  holding = true
  const ticking = h.clock.advance(1000) // the tick that sees r1 settle, then waits on ui.panes
  await h.clock.settle()
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r2' }) // lands while the tick is held
  holding = false
  expect(hold).not.toBeNull()
  ;(hold as (() => void) | null)?.()
  await ticking
  await h.clock.settle() // the released tick finishes and decides, without the clock moving
  const before = h.fake.listCalls('runs').length
  await h.clock.advance(1000)
  expect(h.fake.listCalls('runs').length).toBe(before + 1)
  expect(runs(h).list[1]?.slots.map(s => s.state)).toEqual(['RUNNING'])
  // never two chains: one list call per tick
  const b = h.fake.listCalls('runs').length
  await h.clock.advance(3000)
  expect(h.fake.listCalls('runs').length - b).toBe(3)
})

test('poll: generation after compaction — the label count never repeats', async ($, on) => {
  const h = harness(on, { models: ['m-a'], startSettled: false })
  await start($)
  for (let i = 0; i < 101; i++) {
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: '/w/r1' })
    h.fake.set(h.fake.runs[i]!.runId, '01', 'COMPLETED')
    await h.clock.advance(1000)
  }
  expect(runs(h).list.length).toBeLessThanOrEqual(100)
  expect((h.state.get('earlier') as { runs: number } | undefined)?.runs).toBeGreaterThanOrEqual(1)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: '/w/r1' })
  const last = runs(h).list[runs(h).list.length - 1]
  expect(last?.generation).toBe(102)
  expect(runs(h).starts['/w/r1']).toBe(102)
})

test('state from a timer (EA-12) — a timer update lands on top of a hook write', async ($, on) => {
  const h = harness(on, { models: ['m-a'] })
  await start($)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' }) // the observer hook writes runs
  await h.clock.advance(1000) // the timer's tick updates runs through host.store
  const list = runs(h).list
  expect(list).toHaveLength(1)
  expect(list[0]?.slots).toHaveLength(1) // the tick's merge is on top of the hook's append
  await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r2' }) // another hook write after the timer's
  await h.clock.advance(1000)
  expect(runs(h).list.map(r => r.slots.length)).toEqual([1, 1])
  expect(h.debug.filter(l => l.includes('did not converge'))).toEqual([])
})

test('poll: clear fences a start answer held across it', async ($, on) => {
  let release: (() => void) | null = null
  const h = harness(on, {
    models: ['m-a'],
    beforeModelCall: async args => {
      if (args.path === 'held') await new Promise<void>(r => { release = r })
    },
  })
  await start($)
  const call = $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'held' })
  await h.clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  ;(release as (() => void) | null)?.()
  await call
  expect(runs(h).list).toHaveLength(0)
  expect(runs(h).epoch).toBe(1)
})
