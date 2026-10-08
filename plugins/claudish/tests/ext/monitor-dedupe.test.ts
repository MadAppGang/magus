import { test, expect } from 'claude-code/testing'
import { harness, start } from '../fake-claudish'
import { SURFACES } from '../ui'
import { monitorRecordOf } from '../scenario'
import { POLL, GRACE, append, delegate, delivered, entries, modelCall, team } from './support'

for (const surface of SURFACES) {
  for (const [state, monitor, reason] of [
    ['COMPLETED', 'completed', null], ['FAILED', 'failed', 'api_error'],
    ['TIMEOUT', 'timeout', 'timeout'], ['CANCELLED', 'cancelled', 'cancelled'],
    ['EMPTY', 'failed', 'empty_output'],
  ] as const) {
    test(`ext monitor: ${state} line within grace delivers without a prompt [${surface}]`, async ($, on) => {
      const h = harness(on)
      await start($, surface)
      const s = await delegate($, h)
      h.fake.set(s.id, s.id, state, reason)
      await h.clock.advance(POLL)
      expect(h.submits).toHaveLength(0)
      await h.clock.advance(3_000)
      await append($, h, `claudish-monitor: session ${s.id} ${monitor} model=haiku-4.5 elapsed=1m12s turns=1 tools=3 cost=$0.00`)
      expect(delivered(h)).toHaveLength(1)
      expect(delivered(h)[0]!.by).toBe('monitor')
      expect(h.toasts).toHaveLength(1)
      await h.clock.advance(GRACE + 30_000)
      expect(h.attempts).toHaveLength(0)
    })
  }

  test(`ext monitor: each needs-input line covers only its matching wait [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const s = await delegate($, h)
    h.fake.set(s.id, s.id, 'AWAITING_INPUT', null, { turnsCompleted: 1, activity: null })
    await h.clock.advance(POLL)
    await append($, h, `claudish-monitor: session ${s.id} needs-input model=haiku-4.5 elapsed=1m12s turns=1 next: send_input ${s.id}`)
    expect(delivered(h)).toHaveLength(1)
    await h.clock.advance(GRACE + 5_000)
    expect(h.submits).toHaveLength(0)
    await modelCall($, 'mcp__plugin_claudish_claudish__send_input', { session_id: s.id, input: 'Continue' })
    await h.clock.advance(POLL)
    h.fake.set(s.id, s.id, 'AWAITING_INPUT', null, { turnsCompleted: 2, activity: null })
    await h.clock.advance(POLL + GRACE + POLL)
    expect(h.submits).toHaveLength(1)
    expect(delivered(h)).toHaveLength(2)
    expect(delivered(h).filter(e => e.by === 'monitor')).toHaveLength(1)
  })

  test(`ext monitor: a recent line before discovery is primary [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const s = await delegate($, h)
    h.fake.set(s.id, s.id, 'COMPLETED')
    await append($, h, `claudish-monitor: session ${s.id} completed next: get_output ${s.id}`)
    await h.clock.advance(POLL + GRACE + POLL)
    expect(h.submits).toHaveLength(0)
    expect(delivered(h)).toHaveLength(1)
    expect(delivered(h)[0]!.by).toBe('monitor')
  })

  test(`ext monitor: stale prior line cannot consume a future terminal event [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const s = await delegate($, h)
    await append($, h, `claudish-monitor: session ${s.id} completed`)
    await h.clock.advance(GRACE + 2_000)
    h.fake.set(s.id, s.id, 'COMPLETED')
    await h.clock.advance(POLL + GRACE + POLL)
    expect(h.submits).toHaveLength(1)
    expect(delivered(h)[0]!.by).not.toBe('monitor')
  })

  test(`ext monitor: no line means not before 10 seconds, then exactly one fallback [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const s = await delegate($, h)
    h.fake.set(s.id, s.id, 'COMPLETED')
    await h.clock.advance(POLL)
    const pending = entries(h).find(e => e.kind === 'pending')
    expect(pending).toBeDefined()
    expect(typeof pending?.at).toBe('number')
    const deadline = pending!.at + GRACE
    expect(deadline - h.clock.now()).toBeGreaterThanOrEqual(GRACE - POLL)
    expect(deadline - h.clock.now()).toBeLessThanOrEqual(GRACE)
    await h.clock.set(deadline - 1)
    expect(h.attempts).toHaveLength(0)
    await h.clock.advance(2)
    expect(h.submits).toHaveLength(1)
    await h.clock.advance(30_000)
    expect(h.submits).toHaveLength(1)
  })

  test(`ext monitor: partial team completion is immediate, not held [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h)
    const at = h.clock.now()
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    expect(h.clock.now() - at).toBeLessThan(GRACE)
    expect(h.submits).toHaveLength(1)
    expect(delivered(h)).toHaveLength(1)
  })

  test(`ext monitor: settled team matches its record id and covers final units [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'sessions/review one')
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    expect(h.submits).toHaveLength(1)
    h.fake.set(r.runId, '02', 'COMPLETED')
    h.fake.set(r.runId, '03', 'COMPLETED')
    await h.clock.advance(POLL)
    expect(h.submits).toHaveLength(1)
    await append($, h, `claudish-monitor: team ${monitorRecordOf(r.runId)} completed elapsed=1m12s slots=3 ok=3 failed=0 cancelled=0 path=sessions%2Freview%20one next: team-status`)
    expect(delivered(h)).toHaveLength(3)
    expect(delivered(h).filter(e => e.by === 'monitor')).toHaveLength(2)
    await h.clock.advance(GRACE + 30_000)
    expect(h.submits).toHaveLength(1)
    expect(h.toasts).toHaveLength(3)
  })

  test(`ext monitor: a different session or run has no suppressing effect [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const s = await delegate($, h)
    const r = await team($, h, 'owned-team', ['team-model'])
    h.fake.set(s.id, s.id, 'COMPLETED')
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    for (const line of [
      'claudish-monitor: session another-session completed',
      'claudish-monitor: team other-team completed path=someone-elses-team',
      'claudish-monitor: team owned-team cancelled path=owned-team',
    ]) await append($, h, line)
    expect(delivered(h)).toHaveLength(0)
    await h.clock.advance(GRACE + POLL)
    expect(delivered(h)).toHaveLength(2)
    expect(delivered(h).filter(e => e.by === 'monitor')).toHaveLength(0)
    const text = h.submits.join('\n')
    expect(text).toContain(s.id)
    expect(text).toContain(r.runId)
  })

  test(`ext monitor: malformed and unrelated rows pass through unchanged and cannot dedupe [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const s = await delegate($, h)
    const r = await team($, h, 'monitor-team', ['team-model'])
    h.fake.set(s.id, s.id, 'COMPLETED')
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    for (const line of [
      'not-claudish-monitor: session foreign completed',
      'claudish-monitor:',
      `claudish-monitor: session ${s.id} nonsense`,
      `claudish-monitor: session ${s.id} completed model=bad&value`,
      'claudish-monitor: team monitor-team completed path=%ZZ',
      'claudish-monitor: notice claudish-too-old: upgrade',
      'claudish-monitor: notice no-session-identity: exiting',
      'Unrelated notification',
    ]) await append($, h, line, { extra: 'keep this second block too' })
    expect(delivered(h)).toHaveLength(0)
    await h.clock.advance(GRACE + POLL)
    expect(delivered(h)).toHaveLength(2)
    expect(h.submits.join('\n')).toContain(s.id)
    expect(h.submits.join('\n')).toContain(r.runId)
  })
}
