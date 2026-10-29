import { expect } from 'claude-code/testing'
import { test } from './kit'
import { harness, start } from './fake-claudish'
import { SURFACES, mountBand, mountPane } from './ui'
import { ALLOWANCE_BUTTON_KEY } from '../hooks/status/allowance'
import { FORECAST_PANE_ID } from '../hooks/status/domain'

const BAND = { sections: ['accounts', 'alerts', 'burn'] }
const FORECAST = { sections: ['accounts', 'combined', 'trajectory'], horizon_hours: 144 }
const SESSIONS = { sections: ['sessions'] }

for (const surface of SURFACES) {
  // Phase 4f: the band draws takeover badges and the ┈ switch window from the forecast slice, so a
  // closed panel asks it on the first ok band answer and then every 5 min; never the sessions slice.
  test(`REQ-24 closed forecast panel polls the band slice at 60 seconds and its forecast slice at 5 minutes [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'warn' })
    await start($, surface)
    await h.clock.advance(1)
    const initial = h.fake.allowanceCalls()
    expect(initial.map(c => c.args)).toEqual([BAND, FORECAST])
    const due = initial[0]!.at + 60_000
    await h.clock.advance(due - h.clock.now() - 1)
    expect(h.fake.allowanceCalls()).toHaveLength(2)
    await h.clock.advance(1)
    expect(h.fake.allowanceCalls().map(c => c.args)).toEqual([BAND, FORECAST, BAND])
    // Ticks at 120, 180 and 240 s ask the band alone; the 300 s tick asks the forecast again.
    await h.clock.advance(initial[0]!.at + 240_000 - h.clock.now())
    expect(h.fake.allowanceCalls().map(c => c.args)).toEqual([BAND, FORECAST, BAND, BAND, BAND, BAND])
    await h.clock.advance(60_000)
    expect(h.fake.allowanceCalls().slice(6).map(c => c.args)).toEqual([BAND, FORECAST])
    expect(h.fake.allowanceCalls().some(c => JSON.stringify(c.args) === JSON.stringify(SESSIONS))).toBe(false)
  })
  test(`REQ-25 opening panel asks the forecast at 144h and never the sessions slice, then renders it [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'warn' })
    await start($, surface)
    await h.clock.advance(1)
    const b = await mountBand($, surface)
    const before = h.fake.allowanceCalls().length
    await b.press({ key: ALLOWANCE_BUTTON_KEY })
    await h.clock.settle()
    await h.clock.advance(0)
    expect(h.fake.allowanceCalls().slice(before).map(c => c.args)).toEqual([BAND, FORECAST])
    const p = await mountPane($, surface, FORECAST_PANE_ID)
    // The forecast slice's takeovers draw the NEXT SWITCH card (the v12 panel has no FORECAST strip).
    expect(await p.find({ type: 'Text', text: /NEXT SWITCH/ })).toBeDefined()
    // The design has no SESSIONS section (Phase 4h).
    expect(await p.find({ type: 'Text', text: /SESSIONS/ })).toBeUndefined()
    const count = h.fake.allowanceCalls().length
    await h.clock.advance(60_000)
    expect(h.fake.allowanceCalls().slice(count).map(c => c.args)).toEqual([BAND, FORECAST])
    await p.unmount()
    await b.unmount()
  })
  test(`REQ-29 claudish ignoring sections supplies a whole view without redundant panel calls [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'ignores-sections' })
    await start($, surface)
    await h.clock.advance(1)
    const b = await mountBand($, surface)
    expect(await b.find({ type: 'Button', key: ALLOWANCE_BUTTON_KEY })).toBeDefined()
    const before = h.fake.allowanceCalls().length
    await b.press({ key: ALLOWANCE_BUTTON_KEY })
    await h.clock.settle()
    await h.clock.advance(0)
    // A first open may refresh the band, but whole reports never need another slice.
    for (const call of h.fake.allowanceCalls().slice(before)) expect(call.args).toEqual(BAND)
    const p = await mountPane($, surface, FORECAST_PANE_ID)
    // The whole report's takeovers draw the card the forecast slice would.
    expect(await p.find({ type: 'Text', text: /NEXT SWITCH/ })).toBeDefined()
    expect(await p.find({ type: 'Text', text: /Asking claudish/ })).toBeUndefined()
    const count = h.fake.allowanceCalls().length
    await h.clock.advance(60_000)
    expect(h.fake.allowanceCalls().slice(count).map(c => c.args)).toEqual([BAND])
    expect(h.toasts).toHaveLength(0)
    await p.unmount()
    await b.unmount()
  })
  test(`REQ-29 sections rejection stays quiet, logs once, retries at five minutes without whole-report fallback [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'refused' })
    await start($, surface)
    await h.clock.advance(1)
    const b = await mountBand($, surface)
    expect(await b.find({ type: 'Button', key: ALLOWANCE_BUTTON_KEY })).toBeUndefined()
    const initial = h.fake.allowanceCalls()
    expect(initial).toHaveLength(1)
    const logs = () => h.debug.filter(s => /allowance/i.test(s))
    expect(logs()).toHaveLength(1)
    await h.clock.advance(initial[0]!.at + 300_000 - h.clock.now() - 1)
    expect(h.fake.allowanceCalls()).toHaveLength(1)
    await h.clock.advance(1)
    expect(h.fake.allowanceCalls().map(c => c.args)).toEqual([BAND, BAND])
    expect(logs()).toHaveLength(1)
    expect(h.toasts).toHaveLength(0)
    await b.unmount()
  })
}
