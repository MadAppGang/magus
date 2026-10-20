import { test, expect } from 'claude-code/testing'
import { harness, start } from '../fake-claudish'
import { mountBand, SURFACES } from '../ui'
import { POLL, delegate, team } from './support'
import { bandRow, chip, chips, expectInk, keyOf, pressChip, themeKeysOnly, visibleText } from './v2-support'

for (const surface of SURFACES) {
  test(`v2 §7: Show and Stop are bracketed buttons in their colour, bold, with no fill and no hotkeys [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'chips', ['chip-model'])
    const b = await mountBand($, surface)
    const show = await chip(b, 'chip-model', 'Show')
    const stop = await chip(b, 'chip-model', 'Stop')
    expect(visibleText(show)).toBe('[ Show ]')
    expectInk(show, '[ Show ]', { color: 'ide', bold: true, backgroundColor: undefined })
    expect(visibleText(stop)).toBe('[ Stop ]')
    expectInk(stop, '[ Stop ]', { color: 'error', bold: true, backgroundColor: undefined })
    // The label prop is the bare word.
    expect(show.props?.label).toBe('Show')
    expect(stop.props?.label).toBe('Stop')
    // On the terminal, plain keeps the engine from adding its own [ ... ] around the drawn one.
    if (surface === 'terminal') {
      expect(show.props?.plain).toBe(true)
      expect(stop.props?.plain).toBe(true)
    }
    for (const control of [show, stop]) {
      expect(control.props?.hotkey).toBeUndefined()
      expect(control.props?.action).toBeUndefined()
    }
    expect(visibleText(await b.drawn())).not.toMatch(/confirm\?|\[ \[/)
    expect(h.fake.cancelCalls()).toHaveLength(0)
    themeKeysOnly(await b.drawn())
    await b.unmount()
  })

  test(`v2 §4: first press arms Stop? and the second within four seconds cancels only that slot once [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'stop-target', ['first-model', 'target-model', 'third-model'])
    const b = await mountBand($, surface)
    await pressChip(b, 'target-model', 'Stop')
    expect(h.fake.cancelCalls()).toHaveLength(0)
    expect(r.slots.map(s => s.control.state)).toEqual(['RUNNING', 'RUNNING', 'RUNNING'])
    await b.redraw()
    const armed = await chip(b, 'target-model', 'Stop?')
    expect(visibleText(armed)).toBe('[ Stop? ]')
    expect(armed.props?.label).toBe('Stop?')
    expectInk(armed, '[ Stop? ]', { color: 'inverseText', backgroundColor: 'error', bold: true }) // the one filled button
    expect(chips(await bandRow(b, 'target-model'), 'Stop')).toHaveLength(0)
    expect(visibleText(await b.drawn())).not.toContain('confirm?')
    expect(await chip(b, 'target-model', 'Show')).toBeDefined()
    await h.clock.advance(3_999)
    await b.redraw()
    await pressChip(b, 'target-model', 'Stop?')
    expect(h.fake.cancelCalls()).toHaveLength(1)
    expect(h.fake.cancelCalls()[0]).toMatchObject({
      server: 'plugin:claudish:claudish', tool: 'team',
      args: { mode: 'cancel', path: r.path, run_id: r.runId, slot: '02' },
    })
    expect(Object.keys(h.fake.cancelCalls()[0]!.args).sort()).toEqual(['mode', 'path', 'run_id', 'slot'])
    expect(r.slots.map(s => s.control.state)).toEqual(['RUNNING', 'CANCELLED', 'RUNNING'])
    await h.clock.advance(POLL + 10_000)
    await b.redraw()
    expect(chips(await bandRow(b, 'target-model'), 'Stop')).toHaveLength(0)
    expect(chips(await bandRow(b, 'target-model'), 'Stop?')).toHaveLength(0)
    expect(await chip(b, 'target-model', 'Show')).toBeDefined()
    expect(h.fake.cancelCalls()).toHaveLength(1)
    await b.unmount()
  })

  test(`v2 §4: the arm expires at exactly four seconds and a deadline press only re-arms [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'expiry', ['expiry-model'])
    const b = await mountBand($, surface)
    await pressChip(b, 'expiry-model', 'Stop')
    await h.clock.advance(3_999)
    await b.redraw()
    expect(await chip(b, 'expiry-model', 'Stop?')).toBeDefined()
    await h.clock.advance(1)
    await b.redraw()
    const stop = await chip(b, 'expiry-model', 'Stop')
    expect(visibleText(stop)).toBe('[ Stop ]')
    expectInk(stop, '[ Stop ]', { color: 'error', bold: true, backgroundColor: undefined })
    expect(chips(await b.drawn(), 'Stop?')).toHaveLength(0)
    expect(visibleText(await b.drawn())).not.toContain('confirm?')
    await pressChip(b, 'expiry-model', 'Stop')
    await b.redraw()
    expect(await chip(b, 'expiry-model', 'Stop?')).toBeDefined()
    expect(h.fake.cancelCalls()).toHaveLength(0)
    expect(r.slots[0]!.control.state).toBe('RUNNING')
    await b.unmount()
  })

  test(`v2 §4: simultaneous second presses cannot send duplicate cancels [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'simultaneous', ['race-model'])
    const b = await mountBand($, surface)
    await pressChip(b, 'race-model', 'Stop')
    await b.redraw()
    const key = keyOf(await chip(b, 'race-model', 'Stop?'))
    await Promise.all([b.press({ key }), b.press({ key })])
    expect(h.fake.cancelCalls()).toHaveLength(1)
    await h.clock.advance(10_000)
    expect(h.fake.cancelCalls()).toHaveLength(1)
    expect(visibleText(await b.drawn())).not.toContain('confirm?')
    await b.unmount()
  })

  test(`v2 §4: delegation Stop? cancels only the session id, never a team or pane [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const s = await delegate($, h)
    const b = await mountBand($, surface)
    await pressChip(b, s.model, 'Stop')
    await b.redraw()
    await pressChip(b, s.model, 'Stop?')
    expect(h.fake.cancelCalls()).toHaveLength(1)
    expect(h.fake.cancelCalls()[0]).toMatchObject({ tool: 'cancel_session', args: { session_id: s.id } })
    expect(Object.keys(h.fake.cancelCalls()[0]!.args)).toEqual(['session_id'])
    await h.clock.advance(POLL)
    await b.redraw()
    expect(visibleText(await bandRow(b, s.model))).toContain(' STP ')
    expect(chips(await bandRow(b, s.model), 'Stop')).toHaveLength(0)
    expect(await chip(b, s.model, 'Show')).toBeDefined()
    expect(visibleText(await b.drawn())).not.toContain('confirm?')
    await b.unmount()
  })
}
