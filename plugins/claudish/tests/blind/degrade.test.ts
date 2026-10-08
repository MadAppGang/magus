// Blind tests: silent degradation (spec "Non-functional"; mod contract "Detecting the contract").
// A pre-contract claudish answers team(mode="list") with isError "Error: Unknown mode: list".

import { expect, test } from 'claude-code/testing'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, SURFACES } from '../ui'
import { SLOW, isEngineDrawing, modVerbs, startDelegation, startTeam } from './helpers'

test('degrade: pre-contract claudish draws no band rows and sends no wakes, silently', SLOW, async ($, on) => {
  const h = harness(on, { precontract: true })
  await start($)
  const run = await startTeam($, h, 'review', ['gpt-6.1-sol', 'kimi-k3'])
  const s = await startDelegation($, h, 'haiku-4.5', 'task')
  await h.clock.advance(10_000)

  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const tree = await ui.drawn()
    expect(isEngineDrawing(tree), `${surface}: no band`).toBe(true)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  }

  h.fake.set(run.runId, '01', 'COMPLETED')
  h.fake.set(run.runId, '02', 'FAILED', 'api_error')
  h.fake.set(s.id, s.id, 'COMPLETED')
  await h.clock.advance(10_000)
  expect(h.attempts, 'no wake prompt').toHaveLength(0)
  expect(h.toasts, 'no toast').toHaveLength(0)
  expect(h.statuses.filter(x => typeof x === 'string' && x.length > 0), 'no status line').toHaveLength(0)

  const debugAfter20s = h.debug.length
  expect(debugAfter20s, 'at most a line per feed, not per poll').toBeLessThanOrEqual(2)
  await h.clock.advance(60_000)
  expect(h.debug.length, 'no debug spam while polling on').toBe(debugAfter20s)
  expect(h.toasts).toHaveLength(0)
  expect(modVerbs(h).filter(v => v === 'team:capture' || v === 'capture_session' || v.endsWith('cancel')), 'no capture or cancel on a pre-contract feed').toEqual([])
})

test('degrade: an absent claudish server draws nothing and wakes nobody, without spam', SLOW, async ($, on) => {
  const h = harness(on, { listAnswer: () => ({ deny: 'no such server' }) })
  await start($)
  await startTeam($, h, 'review', ['gpt-6.1-sol'])
  await h.clock.advance(10_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    expect(isEngineDrawing(await ui.drawn()), surface).toBe(true)
    await ui.unmount()
  }
  expect(h.attempts).toHaveLength(0)
  expect(h.toasts).toHaveLength(0)
  const d = h.debug.length
  await h.clock.advance(60_000)
  expect(h.debug.length - d, 'no debug spam').toBeLessThanOrEqual(1)
  expect(h.toasts).toHaveLength(0)
})

test('degrade: a feed that does not advertise list stays silent', SLOW, async ($, on) => {
  const h = harness(on, { declines: true })
  await start($)
  await startTeam($, h, 'review', ['gpt-6.1-sol'])
  await h.clock.advance(10_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    expect(isEngineDrawing(await ui.drawn()), surface).toBe(true)
    await ui.unmount()
  }
  expect(h.attempts).toHaveLength(0)
  expect(h.toasts).toHaveLength(0)
})

test('degrade: the mod only ever calls the claudish server', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  await startTeam($, h, 'review', ['gpt-6.1-sol'])
  await h.clock.advance(10_000)
  const servers = new Set(h.fake.calls.map(c => c.server))
  expect([...servers].every(s => s === 'plugin:claudish:claudish' || s === 'claudish')).toBe(true)
})
