// The wake stands down for claudish's own session monitor: a change the monitor reports too is
// held for MONITOR_GRACE_MS, and a matching monitor line in a row of the conversation marks it
// delivered without a prompt. Otherwise the prompt goes after the hold. The session.append
// hook only looks: every row passes on as it came.

import { expect, test } from 'claude-code/testing'
import type { ClaudishLedger, ClaudishRuns, ClaudishWakeEntry } from '../types'
import { MONITOR_GRACE_MS } from '../hooks/status/domain'
import { CREATE_TOOL, TEAM_TOOL, harness, start, type Harness } from './fake-claudish'
import { monitorRecordOf } from './scenario'

const runs = (h: Harness) => (h.state.get('runs') ?? { epoch: 0, starts: {}, list: [] }) as ClaudishRuns
const ledger = (h: Harness) => (h.state.get('wakeLedger') ?? { epoch: 0, entries: {} }) as ClaudishLedger
const entry = (h: Harness, key: string) => ledger(h).entries[key] as ClaudishWakeEntry | undefined

type Dollar = {
  tool: { call: (e: unknown) => Promise<unknown> }
  session: { append: (e: unknown) => Promise<unknown> }
  turn: { start: (e: unknown) => Promise<unknown>; complete: (e: unknown) => Promise<unknown> }
}
const D = ($: unknown) => $ as Dollar

/** Raises session.append with a row. The 2.1.292 kit has no core for it and refuses a test's own
 *  answer, so the call rejects once the row is past the plugin: the harness records it there. */
async function append($: unknown, row: unknown): Promise<void> {
  await D($).session.append(row).catch((err: unknown) => {
    if (!String(err).includes('no implementation for session.append')) throw err
  })
}

let rows = 0

/** A row as Claude Code keeps a plugin monitor's line: a task notification, the line in `<event>`. */
function notification(line: string) {
  rows += 1
  return {
    message: {
      type: 'user',
      role: 'user',
      isMeta: true,
      content: [{
        type: 'text',
        text: `<task-notification>\n<task-id>bmon${rows}</task-id>\n<summary>Monitor event: "Progress of claudish create_session and team runs started by this Claude Code session"</summary>\n<event>${line}</event>\n</task-notification>`,
      }],
    },
    door: 'delivery',
    origin: { kind: 'task-notification' },
    uuid: `row-${rows}`,
  }
}

const sessionEnd = (id: string) => `claudish-monitor: session ${id} completed model=haiku-4.5 elapsed=0m03s turns=1 tools=0 next: get_output ${id}`
const sessionWait = (id: string) => `claudish-monitor: session ${id} needs-input model=haiku-4.5 elapsed=0m03s turns=1 next: send_input ${id}`
const teamEnd = (record: string, path = 'r1') => `claudish-monitor: team ${record} completed elapsed=0m05s slots=2 ok=2 failed=0 cancelled=0 path=${path} next: team-status`

async function delegation($: unknown, h: Harness) {
  await D($).tool.call({ tool: CREATE_TOOL, model: 'haiku-4.5', prompt: 'do it' })
  await h.clock.advance(1000)
  return h.fake.sessions[h.fake.sessions.length - 1]!
}

async function teamRun($: unknown, h: Harness, path: string) {
  await D($).tool.call({ tool: TEAM_TOOL, mode: 'run', path, models: ['m-a', 'm-b'] })
  await h.clock.advance(1000)
  return h.fake.runs[h.fake.runs.length - 1]!
}

test('monitor (a): a delegation ends, the monitor line follows within the hold — no prompt; delivered by the monitor; the toast stays', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const s = await delegation($, h)
  h.fake.set(s.id, s.id, 'COMPLETED')
  await h.clock.advance(1000)
  const key = `${runs(h).list[0]!.id}/${s.id}`
  expect(entry(h, key)).toMatchObject({ kind: 'pending' })
  await h.clock.advance(4000)
  await append($, notification(sessionEnd(s.id)))
  await h.clock.settle()
  await h.clock.advance(MONITOR_GRACE_MS * 3)
  expect(h.attempts).toHaveLength(0)
  expect(entry(h, key)).toMatchObject({ kind: 'delivered', by: 'monitor' })
  expect(h.toasts).toEqual([`#${s.id.slice(0, 6)} haiku-4.5 done ✓`])
  expect(h.debug).toContain(`claudish wake: ${key} delivered by claudish's session monitor`)
})

test('monitor (a): the line arrives before the mod notices the change, and a wait line stands for its wait — no prompt for either', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const s = await delegation($, h)
  h.fake.set(s.id, s.id, 'AWAITING_INPUT', null, { turnsCompleted: 1, activity: null })
  await append($, notification(sessionWait(s.id)))
  await h.clock.advance(1000)
  await h.clock.advance(MONITOR_GRACE_MS)
  expect(h.attempts).toHaveLength(0)
  expect(entry(h, `${runs(h).list[0]!.id}/${s.id}#w1`)).toMatchObject({ kind: 'delivered', by: 'monitor' })
  h.fake.set(s.id, s.id, 'COMPLETED')
  await append($, notification(sessionEnd(s.id)))
  await h.clock.advance(1000)
  await h.clock.advance(MONITOR_GRACE_MS)
  expect(h.attempts).toHaveLength(0)
})

test('monitor (b): no monitor line — exactly one prompt, after the hold and not before', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const s = await delegation($, h)
  h.fake.set(s.id, s.id, 'COMPLETED')
  await h.clock.advance(1000)
  await h.clock.advance(MONITOR_GRACE_MS - 2000)
  expect(h.attempts).toHaveLength(0)
  await h.clock.advance(2000)
  expect(h.submits).toHaveLength(1)
  expect(h.submits[0]).toContain('haiku-4.5: COMPLETED')
  await h.clock.advance(MONITOR_GRACE_MS * 3)
  expect(h.submits).toHaveLength(1)
  await append($, notification(sessionEnd(s.id))) // a late line cannot take the prompt back
  await h.clock.advance(MONITOR_GRACE_MS)
  expect(h.submits).toHaveLength(1)
  const e = entry(h, `${runs(h).list[0]!.id}/${s.id}`)
  expect(e?.kind).toBe('delivered')
  expect(e?.kind === 'delivered' ? e.by : 'not delivered').toBeUndefined() // the prompt delivered it, not the monitor
})

test('monitor (c): a team slot ends while others run — the monitor has no line for it, so the prompt goes at once', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const run = await teamRun($, h, 'r1')
  h.fake.set(run.runId, '01', 'COMPLETED')
  await h.clock.advance(1000)
  expect(h.submits).toHaveLength(1)
  expect(h.submits[0]).toContain('slot 01 m-a: COMPLETED')
})

test('monitor (d): the run settles and the monitor reports it by its record id (monitor_record) — no prompt for the last slot', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const run = await teamRun($, h, 'reviews/plan panel')
  h.fake.set(run.runId, '01', 'COMPLETED')
  await h.clock.advance(1000)
  expect(h.submits).toHaveLength(1)
  h.fake.set(run.runId, '02', 'FAILED', 'api_error')
  await h.clock.advance(1000)
  expect(h.submits).toHaveLength(1)
  await append($, notification(teamEnd(monitorRecordOf(run.runId), 'reviews/plan%20panel')))
  await h.clock.advance(MONITOR_GRACE_MS * 2)
  expect(h.attempts).toHaveLength(1)
  const id = runs(h).list[0]!.id
  expect(entry(h, `${id}/02`)).toMatchObject({ kind: 'delivered', by: 'monitor' })
  expect(h.toasts).toEqual(['01 m-a done ✓', '02 m-b failed ✕'])
})

test('monitor (e): a line for another session or another run (same path included) changes nothing — one prompt after the hold for each', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const s = await delegation($, h)
  const run = await teamRun($, h, 'r1')
  h.fake.set(s.id, s.id, 'COMPLETED')
  h.fake.set(run.runId, '01', 'COMPLETED')
  h.fake.set(run.runId, '02', 'COMPLETED')
  await h.clock.advance(1000)
  await append($, notification(sessionEnd('ffffffff-0000-4000-8000-000000000999')))
  await append($, notification(teamEnd('team-ffffff', 'r1')))
  await append($, notification(teamEnd('team-eeeeee', '/elsewhere/r1')))
  await h.clock.advance(MONITOR_GRACE_MS)
  expect(h.submits).toHaveLength(1)
  expect(h.submits[0]).toContain('haiku-4.5: COMPLETED')
  expect(h.submits[0]).toContain('slot 02 m-b: COMPLETED')
  expect(Object.values(ledger(h).entries).filter(e => e.kind === 'delivered' && e.by === 'monitor')).toHaveLength(0)
})

test('monitor (g): a path reused within the hold — the line of the first run does not stand for the second; it gets its own prompt', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const first = await teamRun($, h, 'r1')
  h.fake.set(first.runId, '01', 'COMPLETED')
  h.fake.set(first.runId, '02', 'COMPLETED')
  await h.clock.advance(1000)
  await append($, notification(teamEnd(monitorRecordOf(first.runId))))
  await h.clock.settle()
  const second = await teamRun($, h, 'r1')
  h.fake.set(second.runId, '01', 'COMPLETED')
  h.fake.set(second.runId, '02', 'FAILED', 'api_error')
  await h.clock.advance(1000)
  await h.clock.advance(MONITOR_GRACE_MS * 2)
  expect(h.submits).toHaveLength(1)
  expect(h.submits[0]).toContain('slot 02 m-b: FAILED (api_error)')
  const [a, b] = runs(h).list
  expect(entry(h, `${a!.id}/02`)).toMatchObject({ kind: 'delivered', by: 'monitor' })
  expect(entry(h, `${b!.id}/02`)).toMatchObject({ kind: 'delivered' })
  expect(entry(h, `${b!.id}/02`)).not.toMatchObject({ by: 'monitor' })
})

test('monitor (h): a slot finished in a busy turn waits with its settled run hold — the line covers both; no prompt', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const run = await teamRun($, h, 'r1')
  await D($).turn.start({ text: 'go', turnId: 't1' })
  h.fake.set(run.runId, '01', 'COMPLETED')
  await h.clock.advance(1000)
  h.fake.set(run.runId, '02', 'COMPLETED')
  await h.clock.advance(1000)
  await D($).turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await h.clock.settle()
  expect(h.attempts, 'the due slot waits for the run hold').toHaveLength(0)
  await h.clock.advance(3000)
  await append($, notification(teamEnd(monitorRecordOf(run.runId))))
  await h.clock.advance(MONITOR_GRACE_MS * 2)
  expect(h.attempts).toHaveLength(0)
  const id = runs(h).list[0]!.id
  expect(entry(h, `${id}/01`)).toMatchObject({ kind: 'delivered', by: 'monitor' })
  expect(entry(h, `${id}/02`)).toMatchObject({ kind: 'delivered', by: 'monitor' })
})

test('monitor (i): the run settles in a long turn; the line the turn kept queued arrives just after it — no prompt', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const run = await teamRun($, h, 'r1')
  await D($).turn.start({ text: 'go', turnId: 't1' })
  h.fake.set(run.runId, '01', 'COMPLETED')
  h.fake.set(run.runId, '02', 'COMPLETED')
  await h.clock.advance(1000)
  await h.clock.advance(MONITOR_GRACE_MS * 2) // the hold taken at the settle runs out inside the turn
  await D($).turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await h.clock.settle()
  expect(h.attempts, 'no prompt the moment the turn ends').toHaveLength(0)
  await h.clock.advance(1000)
  await append($, notification(teamEnd(monitorRecordOf(run.runId))))
  await h.clock.advance(MONITOR_GRACE_MS * 2)
  expect(h.attempts).toHaveLength(0)
  const id = runs(h).list[0]!.id
  expect(entry(h, `${id}/01`)).toMatchObject({ kind: 'delivered', by: 'monitor' })
  expect(entry(h, `${id}/02`)).toMatchObject({ kind: 'delivered', by: 'monitor' })
})

test('monitor (f): malformed and foreign rows change nothing; session.append keeps every row exactly as it came', async ($, on) => {
  const h = harness(on)
  await start($ as never)
  const s = await delegation($, h)
  h.fake.set(s.id, s.id, 'COMPLETED')
  await h.clock.advance(1000)
  const line = sessionEnd(s.id)
  const sent = [
    // the model quoting the line, a tool's result carrying it, the person typing it
    { message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: line }] }, door: 'response', origin: { kind: 'model', model: 'm' }, uuid: 'f1' },
    { message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: line }] }, door: 'tool-result', origin: { kind: 'tool', tool: 'Bash' }, uuid: 'f2' },
    { message: { type: 'user', role: 'user', content: [{ type: 'text', text: line }] }, door: 'prompt', origin: { kind: 'composer' }, uuid: 'f3' },
    // not the grammar, or not a line start
    notification(`claudish-monitor: session ${s.id} exploded`),
    notification(`claudish-monitor: session ${s.id} completed model=two words`),
    { ...notification(''), message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: `see "${line}"` }] } },
    { ...notification(''), message: { type: 'user', role: 'user', isMeta: true, content: [] } },
    { ...notification(''), message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }] } },
  ]
  for (const row of sent) await append($, row)
  await h.clock.advance(MONITOR_GRACE_MS)
  expect(h.submits).toHaveLength(1)
  expect(h.appended).toEqual(sent) // what reached beneath the plugin: every row, once, unchanged
})
