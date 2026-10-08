// Stop while Claude Code's permission dialog for the cancel stays open. Measured live on 2.1.292
// against claudish 10.4.1: with the read-only allow as a PermissionRequest hook, every poll
// `team(mode:list)` the mod raised behind an open dialog queued there ("2 of 2" → "11 of 11");
// the same allow as a PreToolUse hook answers before the permission check, and a held 15 s
// dialog queued none. So the poll does not pause for a pending cancel: it keeps polling, and
// the guarantees left are one cancel per double press however long the dialog stays open, and
// one toast with Stop given back when the cancel is refused.
//
// What this kit cannot model: Claude Code's permission queue. Here every mcp.call answers at
// once, so "nothing stacks" is not observable. What it does assert is the precondition the
// live measurement rests on: every call the mod raises while the cancel is pending is one of
// the read-only verbs the plugin's PreToolUse hook allows (tests/claudish-status covers the
// hook itself), at most one poll per tick.

import { expect, test } from 'claude-code/testing'
import type { ClaudishRuns, ClaudishStopRequest } from '../types'
import { TEAM_TOOL, harness, start, type Harness } from './fake-claudish'
import { SURFACES, mountBand } from './ui'

const runs = (h: Harness) => (h.state.get('runs') ?? { epoch: 0, starts: {}, list: [] }) as ClaudishRuns
const stops = (h: Harness) => (h.state.get('stopRequests') ?? {}) as Record<string, ClaudishStopRequest>
const modRun = (h: Harness) => runs(h).list[0]!

/** The calls allow-read-verbs.ts allows before the permission check: they never queue behind a dialog. */
const READ_ONLY = new Set(['team:list', 'team:status', 'team:capture', 'list_sessions:', 'capture_session:'])

async function teamRun($: unknown, h: Harness, path = 'r1') {
  await ($ as { tool: { call: (e: unknown) => Promise<unknown> } }).tool.call({ tool: TEAM_TOOL, mode: 'run', path })
  await h.clock.advance(1000)
}

for (const surface of SURFACES) {
  test(`stop flood: a cancel whose dialog stays open 60 s is sent once, and the poll carries on with read-only calls [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const id = modRun(h).id
    const key = `${id}/01`
    const band = await mountBand($, surface)
    await band.press({ key: `show:${id}/02` }) // a live Show tab: captures run on the ticks too
    await h.clock.advance(2000)
    expect(h.fake.captureCalls().length, 'the tab captures before the press').toBeGreaterThan(0)

    await band.press({ key: `stop:${key}` })
    const dialog = h.fake.holdCancels() // Claude Code's permission question for the cancel, open
    const pressing = band.press({ key: `stop:${key}` })
    await h.clock.settle()
    expect(h.fake.cancelCalls(), 'the double press sent its cancel').toHaveLength(1)
    const sentAt = h.fake.calls.length
    const listsAt = h.fake.listCalls().length
    const capturesAt = h.fake.captureCalls().length

    for (let s = 0; s < 60; s++) await h.clock.advance(1000) // sixty poll ticks' worth, nobody answering
    expect(h.fake.cancelCalls(), 'still exactly one cancel after 60 s').toHaveLength(1)
    const during = h.fake.calls.slice(sentAt).map(c => `${c.tool}:${String(c.args.mode ?? '')}`)
    expect(during.filter(c => !READ_ONLY.has(c)), 'only read-only calls while the cancel is pending').toEqual([])
    const lists = h.fake.listCalls().length - listsAt
    expect(lists, 'the poll carries on while the dialog is open').toBeGreaterThan(0)
    expect(lists, 'at most one list per tick: the loop never piles calls up').toBeLessThanOrEqual(61)
    expect(h.fake.captureCalls().length, 'the Show tab keeps capturing').toBeGreaterThan(capturesAt)
    expect(await band.find({ key: `stop:${key}` }), 'no Stop to press while it is open').toBeUndefined()
    expect(stops(h)[key]?.kind).toBe('sending')

    dialog.release() // the person answers Yes
    await pressing
    await h.clock.settle()
    await h.clock.advance(2000)
    expect(h.fake.cancelCalls(), 'one cancel, answered').toHaveLength(1)
    expect(h.fake.runs[0]!.slots[0]!.control.state).toBe('CANCELLED')
    await h.clock.advance(30_000)
    expect(h.fake.cancelCalls()).toHaveLength(1)
    expect(h.toasts.filter(t => /^Stop /.test(t)), 'no Stop failure or timeout toast').toEqual([])
    expect(h.toasts).toEqual(['01 gpt-6.1-sol stopped ■']) // the wake's own terminal toast, once
  })

  test(`stop flood: a denied cancel — one toast, the button back to Stop, no retry, the poll never paused [${surface}]`, async ($, on) => {
    const h = harness(on, { denyCancel: 'permission denied by the person' })
    await start($, surface)
    await teamRun($, h)
    const key = `${modRun(h).id}/01`
    const band = await mountBand($, surface)
    await band.press({ key: `stop:${key}` })
    const dialog = h.fake.holdCancels()
    const pressing = band.press({ key: `stop:${key}` })
    await h.clock.settle()
    const listsAt = h.fake.listCalls().length
    for (let s = 0; s < 35; s++) await h.clock.advance(1000) // the person reads the dialog, then says No
    expect(h.fake.listCalls().length, 'polled while the dialog was open').toBeGreaterThan(listsAt)
    dialog.release()
    await pressing
    await h.clock.settle()
    expect(h.fake.cancelCalls()).toHaveLength(1)
    expect(h.toasts).toHaveLength(1)
    expect(h.toasts[0]).toMatch(/^Stop failed for 01 gpt-6\.1-sol: .*permission denied/)
    expect(stops(h)[key]).toBeUndefined()
    expect(modRun(h).personStops).toEqual([])
    expect((await band.find({ key: `stop:${key}` }))?.props.label).toBe('Stop')
    const listsAfter = h.fake.listCalls().length
    await h.clock.advance(30_000)
    expect(h.fake.cancelCalls(), 'no retry').toHaveLength(1)
    expect(h.toasts, 'exactly one toast').toHaveLength(1)
    expect(h.fake.listCalls().length, 'the poll carries on after the denial').toBeGreaterThan(listsAfter)
    expect(h.fake.runs[0]!.slots[0]!.control.state).toBe('RUNNING')
    expect((await band.find({ key: `stop:${key}` }))?.props.label).toBe('Stop')
  })
}
