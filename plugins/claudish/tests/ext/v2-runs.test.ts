import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start } from '../fake-claudish'
import { mountBand, SURFACES } from '../ui'
import { POLL, delegate, team } from './support'
import { arrangeEarlier, bandRow, chips, header, visibleText } from './v2-support'

for (const surface of SURFACES) {
  test(`v2 §1: newer run hides an older settled run and counts one earlier run [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const old = await team($, h, 'old-review', ['old-model'])
    h.fake.set(old.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    await team($, h, 'team-long', ['latest-model'])
    const b = await mountBand($, surface)
    expect(visibleText(await header(b))).toBe('◆ claudish  team-long · 1 running · 1 earlier run')
    expect(visibleText(await bandRow(b, 'latest-model'))).toMatch(/^  01\s* RUN /)
    const drawing = visibleText(await b.drawn())
    expect(drawing).not.toContain('old-model')
    expect(drawing).not.toContain('old-review/01')
    expect(drawing).not.toContain('1 done')
    expect(drawing).not.toContain('1 earlier runs')
    expect(chips(await b.drawn(), 'Show')).toHaveLength(1)
    await b.unmount()
  })

  test(`v2 §1: older partly-live run stays drawn with label/slot ids [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const old = await team($, h, 'old-live', ['old-running', 'old-done'])
    h.fake.set(old.runId, '02', 'COMPLETED')
    await h.clock.advance(POLL)
    await team($, h, 'new-run', ['new-model'])
    const b = await mountBand($, surface)
    expect(visibleText(await bandRow(b, 'old-running'))).toMatch(/^  old-live\/01\s* RUN /)
    expect(visibleText(await bandRow(b, 'old-done'))).toMatch(/^  old-live\/02\s* END /)
    expect(visibleText(await bandRow(b, 'new-model'))).toMatch(/^  new-run\/01\s* RUN /)
    expect(visibleText(await header(b))).toBe('◆ claudish · 2 running · 1 done')
    expect(visibleText(await header(b))).not.toContain('earlier')
    expect(visibleText(await header(b))).not.toContain('◆ claudish  new-run')
    expect(chips(await b.drawn(), 'Show')).toHaveLength(3)
    await b.unmount()
  })

  test(`v2 §1: last-started settled run stays while an older run is live [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'still-working', ['live-model'])
    const latest = await team($, h, 'last-started', ['last-model'])
    h.fake.set(latest.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    const b = await mountBand($, surface)
    expect(visibleText(await bandRow(b, 'last-model'))).toContain(' END ')
    expect(visibleText(await bandRow(b, 'live-model'))).toContain(' RUN ')
    expect(visibleText(await header(b))).toBe('◆ claudish · 1 running · 1 done')
    expect(visibleText(await b.drawn())).not.toContain('earlier')
    await b.unmount()
  })

  test(`v2 §1: hidden run count adds compacted runs without adding their status counts [${surface}]`, async ($, on) => {
    const h = harness(on)
    const setEarlier = arrangeEarlier(on)
    await start($, surface)
    const old = await team($, h, 'old-folded', ['hidden-model'])
    h.fake.set(old.runId, '01', 'FAILED', 'api_error')
    await h.clock.advance(POLL)
    await team($, h, 'team-long', ['latest-model'])
    setEarlier({ runs: 1, done: 3, failed: 4, stopped: 2 })
    const b = await mountBand($, surface)
    expect(visibleText(await header(b))).toBe('◆ claudish  team-long · 1 running · 2 earlier runs')
    expect(visibleText(await b.drawn())).not.toContain('hidden-model')
    expect(visibleText(await header(b))).not.toMatch(/done|failed|stopped|\+2 earlier|2 earlier run$/)
    await b.unmount()
  })

  test(`v2 §1: two hidden settled runs use the plural without compaction [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    for (const label of ['old-one', 'old-two']) {
      const r = await team($, h, label, [`${label}-model`])
      h.fake.set(r.runId, '01', 'COMPLETED')
      await h.clock.advance(POLL)
    }
    await team($, h, 'latest', ['latest-model'])
    const b = await mountBand($, surface)
    expect(visibleText(await header(b))).toBe('◆ claudish  latest · 1 running · 2 earlier runs')
    expect(visibleText(await b.drawn())).not.toMatch(/old-one-model|old-two-model|2 done/)
    expect(chips(await b.drawn(), 'Show')).toHaveLength(1)
    await b.unmount()
  })

  test(`v2 §1: single team names the header and uses bare slot ids with no zero earlier suffix [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'team-long', ['first-model', 'second-model'])
    const b = await mountBand($, surface)
    expect(visibleText(await header(b))).toBe('◆ claudish  team-long · 2 running')
    expect(visibleText(await bandRow(b, 'first-model'))).toMatch(/^  01\s* RUN /)
    expect(visibleText(await bandRow(b, 'second-model'))).toMatch(/^  02\s* RUN /)
    expect(visibleText(await b.drawn())).not.toContain('team-long/01')
    expect(visibleText(await header(b))).not.toContain('earlier')
    await b.unmount()
  })

  test(`v2 §1: a delegation uses its label even beside a team, never its full session id [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const s = await delegate($, h)
    const label = `#${s.id.slice(0, 6)}`
    const b = await mountBand($, surface)
    expect(visibleText(await bandRow(b, s.model))).toMatch(new RegExp(`^  ${label}\\s* RUN `))
    expect(visibleText(await header(b))).toBe('◆ claudish · 1 running')
    await team($, h, 'team-long', ['team-model'])
    await b.redraw()
    expect(visibleText(await bandRow(b, s.model))).toMatch(new RegExp(`^  ${label}\\s* RUN `))
    expect(visibleText(await bandRow(b, 'team-model'))).toMatch(/^  team-long\/01\s* RUN /)
    expect(visibleText(await b.drawn())).not.toContain(s.id)
    expect(visibleText(await b.drawn())).not.toContain(`${label}/${s.id}`)
    expect(visibleText(await header(b))).not.toContain('◆ claudish  team-long')
    await b.unmount()
  })
}
