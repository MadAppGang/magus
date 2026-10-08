// Blind tests: Stop, press twice (spec "Buttons"; stop-wake contract §3.5; mod contract §C).
// Each surface gets its own run (distinct models) so the loop's iterations never share a slot.

import { expect, test } from 'claude-code/testing'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, SURFACES } from '../ui'
import { SLOW, keyOf, labelOf, namedWith, rowFor, startDelegation, startTeam, stopButton, textOf } from './helpers'

const WIDE = bandProps(200, 40)

function cancelsFor(h: ReturnType<typeof harness>, runId: string) {
  return h.fake.cancelCalls().filter(c => c.args.run_id === runId)
}

test('stop: one press arms confirm? for 4 s; expiry cancels nothing and the button returns', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const a1 = `a1-${surface}`, a2 = `a2-${surface}`
    const run = await startTeam($, h, `stop-expire-${surface}`, [a1, a2])
    await h.clock.advance(3_000)
    const ui = await mountBand($, surface, WIDE)
    const stop = stopButton(rowFor(await ui.drawn(), a2))
    expect(stop && labelOf(stop), `${surface}: Stop offered`).toBe('Stop')
    const cancelsBefore = h.fake.cancelCalls().length

    await ui.press({ key: keyOf(stop!)! })
    const armed = stopButton(rowFor(await ui.drawn(), a2))
    expect(armed && labelOf(armed), `${surface}: first press arms`).toBe('confirm?')
    expect(h.fake.cancelCalls().length, `${surface}: first press sends nothing`).toBe(cancelsBefore)
    // Only the pressed slot is armed.
    expect(labelOf(stopButton(rowFor(await ui.drawn(), a1))!)).toBe('Stop')

    await h.clock.advance(3_000)
    expect(labelOf(stopButton(rowFor(await ui.drawn(), a2))!), `${surface}: still armed inside 4 s`).toBe('confirm?')

    await h.clock.advance(1_500)
    const back = stopButton(rowFor(await ui.drawn(), a2))
    expect(back && labelOf(back), `${surface}: reverted after 4 s`).toBe('Stop')
    expect(h.fake.cancelCalls().length, `${surface}: expiry cancels nothing`).toBe(cancelsBefore)
    expect(run.slots.find(s => s.slot === '02')!.control.state).toBe('RUNNING')

    // A press after expiry is a FIRST press again: it arms, it does not cancel.
    await ui.press({ key: keyOf(back!)! })
    expect(labelOf(stopButton(rowFor(await ui.drawn(), a2))!)).toBe('confirm?')
    expect(h.fake.cancelCalls().length, `${surface}: a press after expiry re-arms only`).toBe(cancelsBefore)
    await h.clock.advance(5_000)
    expect(h.fake.cancelCalls().length).toBe(cancelsBefore)
    await ui.unmount()
  }
})

test('stop: two presses inside 4 s cancel exactly that slot of that run, once', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const b1 = `b1-${surface}`, b2 = `b2-${surface}`, b3 = `b3-${surface}`
    const run = await startTeam($, h, `stop-twice-${surface}`, [b1, b2, b3])
    await h.clock.advance(3_000)
    const ui = await mountBand($, surface, WIDE)
    const total = h.fake.cancelCalls().length

    await ui.press({ key: keyOf(stopButton(rowFor(await ui.drawn(), b2))!)! })
    await h.clock.advance(1_000)
    await ui.press({ key: keyOf(stopButton(rowFor(await ui.drawn(), b2))!)! })

    const mine = cancelsFor(h, run.runId)
    expect(mine, `${surface}: exactly one cancel`).toHaveLength(1)
    expect(h.fake.cancelCalls().length - total, `${surface}: no cancel for any other run`).toBe(1)
    const c = mine[0]!
    expect(['plugin:claudish:claudish', 'claudish']).toContain(c.server)
    expect(c.tool).toBe('team')
    expect(c.args.mode).toBe('cancel')
    expect(c.args.slot, `${surface}: only the targeted slot`).toBe('02')
    expect(c.args.run_id).toBe(run.runId)
    expect(c.args.path).toBe(run.path)

    expect(run.slots.map(s => s.control.state)).toEqual(['RUNNING', 'CANCELLED', 'RUNNING'])
    await h.clock.advance(3_000)
    const tree = await ui.drawn()
    expect(textOf(rowFor(tree, b2)), `${surface}: stopped row`).toMatch(/■\s*stopped/)
    expect(stopButton(rowFor(tree, b2)), `${surface}: no Stop once stopped`).toBeUndefined()
    expect(stopButton(rowFor(tree, b1))).toBeDefined()
    expect(stopButton(rowFor(tree, b3))).toBeDefined()

    await h.clock.advance(10_000)
    expect(cancelsFor(h, run.runId), `${surface}: still exactly one`).toHaveLength(1)
    await ui.unmount()
  }
})

test('stop: two presses in the same tick send one cancel', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const c1 = `c1-${surface}`
    const run = await startTeam($, h, `stop-tick-${surface}`, [c1, `c2-${surface}`])
    await h.clock.advance(3_000)
    const ui = await mountBand($, surface, WIDE)
    await ui.press({ key: keyOf(stopButton(rowFor(await ui.drawn(), c1))!)! })
    const again = stopButton(rowFor(await ui.drawn(), c1))
    if (again) await ui.press({ key: keyOf(again)! })
    // a third press, should any button still be there, must not send a second cancel
    const third = stopButton(rowFor(await ui.drawn(), c1))
    if (third) await ui.press({ key: keyOf(third)! })
    await h.clock.settle()
    expect(cancelsFor(h, run.runId), surface).toHaveLength(1)
    expect(cancelsFor(h, run.runId)[0]!.args.slot).toBe('01')
    await ui.unmount()
  }
})

test('stop: a row of a later run at the same path cancels by its own run_id', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const path = `same-path-${surface}`
    const first = await startTeam($, h, path, [`r1-${surface}`])
    await h.clock.advance(2_000)
    h.fake.set(first.runId, '01', 'COMPLETED')
    await h.clock.advance(3_000)
    const second = await startTeam($, h, path, [`r2-${surface}`])
    expect(second.runId).not.toBe(first.runId)
    await h.clock.advance(3_000)
    const ui = await mountBand($, surface, WIDE)
    await ui.press({ key: keyOf(stopButton(rowFor(await ui.drawn(), `r2-${surface}`))!)! })
    await ui.press({ key: keyOf(stopButton(rowFor(await ui.drawn(), `r2-${surface}`))!)! })
    expect(cancelsFor(h, second.runId), surface).toHaveLength(1)
    expect(cancelsFor(h, first.runId), `${surface}: never the earlier round`).toHaveLength(0)
    expect(second.slots[0]!.control.state).toBe('CANCELLED')
    expect(first.slots[0]!.control.state).toBe('COMPLETED')
    await ui.unmount()
  }
})

test('stop: a delegation stops by cancel_session with its session_id', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const model = `dl-${surface}`
    const s = await startDelegation($, h, model, 'long task')
    await startDelegation($, h, `keep-${surface}`, 'other task')
    await h.clock.advance(3_000)
    const ui = await mountBand($, surface, WIDE)
    const before = h.fake.cancelCalls().length
    await ui.press({ key: keyOf(stopButton(rowFor(await ui.drawn(), model))!)! })
    await h.clock.advance(500)
    await ui.press({ key: keyOf(stopButton(rowFor(await ui.drawn(), model))!)! })
    const sent = h.fake.cancelCalls().slice(before)
    expect(sent, surface).toHaveLength(1)
    expect(sent[0]!.tool).toBe('cancel_session')
    expect(sent[0]!.args.session_id).toBe(s.id)
    expect(s.control.state).toBe('CANCELLED')
    expect(h.fake.sessions.find(x => x.model === `keep-${surface}`)!.control.state).toBe('RUNNING')
    await ui.unmount()
  }
})

test('stop: the person stopping a slot is named once in a wake, as CANCELLED', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const target = `p1-${surface}`
    await startTeam($, h, `stop-wake-${surface}`, [target, `p2-${surface}`])
    await h.clock.advance(3_000)
    const ui = await mountBand($, surface, WIDE)
    await ui.press({ key: keyOf(stopButton(rowFor(await ui.drawn(), target))!)! })
    await ui.press({ key: keyOf(stopButton(rowFor(await ui.drawn(), target))!)! })
    await h.clock.advance(5_000)
    expect(namedWith(h.submits, target, 'CANCELLED'), `${surface}: one wake names the stop`).toBe(1)
    await h.clock.advance(30_000)
    expect(namedWith(h.submits, target, 'CANCELLED'), `${surface}: never twice`).toBe(1)
    await ui.unmount()
  }
})
