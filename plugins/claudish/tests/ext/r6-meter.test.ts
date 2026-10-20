// Spec R6.7 (stale-meter thresholds), drawn through the plugin. The meter shows in the Show tab
// header, and in a band row only where there is no timeline: on a surface whose element table has
// no `Client` (vscode). Its cells fill at 5, 30, 60, 90 and 120 s; below 5 s no number; colours
// success / warning / error by cells. Written from spec.md only.

import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start, type Harness } from '../fake-claudish'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, walk } from '../ui'
import { POLL, team } from './support'
import { expectInk, pressChip, tabHeader, visibleText } from './v2-support'
import { SHOW_PANE, silentFor, untilPoll } from './r6-support'

const METER = /[▰▱]{5}(?: \d+[smh])?/g

/** A team of one RUNNING slot, `thinking`, silent for `seconds` at every poll. */
function silentHarness(on: Parameters<typeof harness>[0], seconds: number | null): Harness {
  const h: Harness = harness(on, { rowPatch: row => silentFor(() => h, () => seconds)({ ...row, activity: 'thinking' }) })
  return h
}

for (const surface of SURFACES) {
  // The threshold edges in the Show tab header are pinned by v2-meter.test.ts, rewritten to R6.7.

  test(`R6.7: no meter in the tab header for a slot that is not RUNNING, or RUNNING with an unknown idle time [${surface}]`, async ($, on) => {
    let unknown = false
    const h: Harness = harness(on, { rowPatch: row => (unknown ? { ...row, idle_seconds: null, last_activity_at: null } : silentFor(() => h, () => 45)(row)) })
    await start($, surface)
    const r = await team($, h, 'no-meter', ['ended-model', 'blind-model'])
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    const b = await mountBand($, surface, bandProps(160))
    await pressChip(b, 'ended-model', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 24))
    expect(visibleText(await tabHeader(p, 'ended-model'))).not.toMatch(/[▰▱]/)
    await b.redraw()
    unknown = true
    await h.clock.advance(POLL)
    await b.redraw()
    await pressChip(b, 'blind-model', 'Show')
    await p.redraw()
    const blind = visibleText(await tabHeader(p, 'blind-model'))
    expect(blind).toContain(' RUN ')
    expect(blind).not.toMatch(/[▰▱]|NaN|idle /)
    await p.unmount()
    await b.unmount()
  })
}

// R6.4/R6.7: a surface whose element table has no Client (vscode) draws the stale-meter text in the row.
for (const [seconds, meter, color] of [[4, null, 'success'], [5, '▰▱▱▱▱ 5s', 'success'], [65, '▰▰▰▱▱ 1m', 'warning'], [130, '▰▰▰▰▰ 2m', 'error']] as const) {
  test(`R6.7: on a surface without Client the row draws the meter instead — ${seconds}s ${meter ?? 'no number'} in ${color} [vscode]`, async ($, on) => {
    const h = silentHarness(on, seconds)
    await start($, 'terminal')
    await team($, h, 'no-client', ['vs-model'])
    await untilPoll(h)
    const b = await $.ui.mount({ plugin: 'claudish', surface: 'vscode', component: 'AbovePrompt', props: bandProps(160) as never })
    const tree = await b.drawn()
    expect(walk(tree).some(x => x.node.type === 'Client')).toBe(false)
    const rows = walk(tree).map(x => x.node).filter(n => n.type === 'Box' && visibleText(n).includes('vs-model') && / RUN /.test(visibleText(n)))
    const row = rows[rows.length - 1]
    expect(row).toBeDefined()
    const meters = visibleText(row).match(METER) ?? []
    expect(meters).toHaveLength(1)
    // below 5 s the band animates its streaming meter (contract: Meter.flowing), so only the absence of a number is fixed
    if (meter === null) expect(meters[0]).not.toMatch(/\d/)
    else expect(meters[0]).toBe(meter)
    expectInk(row, meters[0]!, { color })
    await b.unmount()
  })
}
