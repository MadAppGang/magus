import { test, expect } from 'claude-code/testing'
import { harness, start, type Harness } from '../fake-claudish'
import { bandProps, mountBand, mountPane, paneProps, SURFACES } from '../ui'
import { DARK, POLL, QUIET_DARK, team } from './support'
import { bandRow, expectInk, expectInkOneOf, pressChip, tabHeader, visibleText } from './v2-support'
import { SHOW_PANE, silentFor, untilPoll } from './r6-support'

// R6.7: one cell fills at each of 5, 30, 60, 90, 120 s; below 5 s the slot is streaming, no number;
// from 5 s the number follows the cells. Colours: 0–2 cells success, 3–4 warning, 5 error.
const EDGES = [
  [0, '▱▱▱▱▱', 'success'],
  [4, '▱▱▱▱▱', 'success'],
  [5, '▰▱▱▱▱ 5s', 'success'],
  [29, '▰▱▱▱▱ 29s', 'success'],
  [30, '▰▰▱▱▱ 30s', 'success'],
  [42, '▰▰▱▱▱ 42s', 'success'],
  [59, '▰▰▱▱▱ 59s', 'success'],
  [60, '▰▰▰▱▱ 1m', 'warning'],
  [89, '▰▰▰▱▱ 1m', 'warning'],
  [90, '▰▰▰▰▱ 1m', 'warning'],
  [119, '▰▰▰▰▱ 1m', 'warning'],
  [120, '▰▰▰▰▰ 2m', 'error'],
  [3600, '▰▰▰▰▰ 1h', 'error'],
] as const

for (const surface of SURFACES) {
  for (const [seconds, meter, color] of EDGES) {
    test(`R6.7: ${seconds}s silence draws ${meter}${seconds < 5 ? ' (no number)' : ''} in ${color}, in the Show tab header [${surface}]`, async ($, on) => {
      const h: Harness = harness(on, { rowPatch: row => silentFor(() => h, () => seconds)({ ...row, activity: 'thinking' }) })
      await start($, surface)
      await team($, h, 'stale-meter', ['meter-model'])
      const b = await mountBand($, surface, bandProps(160))
      // R6.4: the row draws its timeline, never the meter text
      expect(visibleText(await bandRow(b, 'meter-model'))).not.toMatch(/[▰▱]/)
      await pressChip(b, 'meter-model', 'Show')
      await untilPoll(h) // read right after a poll: the silence is exactly what claudish said
      const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 24))
      const hdr = await tabHeader(p, 'meter-model')
      const text = visibleText(hdr)
      const meters = text.match(/[▰▱]{5}(?: \d+(?:s|m|h))?/g) ?? []
      expect(meters).toHaveLength(1)
      expect(meters[0]).toBe(meter)
      if (seconds < 5) expect(meters[0]).not.toMatch(/\d/) // streaming: 0 cells filled, no number
      expectInk(hdr, meters[0]!, { color })
      expect(text).not.toMatch(/idle |⚠/)
      if (seconds < 120) expect(meters[0]).not.toContain('▰▰▰▰▰')
      await p.unmount()
      await b.unmount()
    })
  }

  for (const state of [
    'STARTING', 'AWAITING_INPUT', 'AWAITING_PERMISSION', 'COMPLETED',
    'FAILED', 'TIMEOUT', 'EMPTY', 'CANCELLED', 'UNKNOWN',
  ] as const) {
    test(`v2 §3: ${state} has no stale-meter even with an idle value [${surface}]`, async ($, on) => {
      const h = harness(on, { rowPatch: row => ({ ...row, idle_seconds: 120 }) })
      await start($, surface)
      const r = await team($, h, 'non-running', ['quiet-model'])
      h.fake.set(r.runId, '01', state, state === 'EMPTY' ? 'shape_mismatch' : null)
      await h.clock.advance(POLL)
      const b = await mountBand($, surface)
      const row = visibleText(await bandRow(b, 'quiet-model'))
      expect(row).toContain('quiet-model')
      expect(row).not.toMatch(/[▰▱]|idle |⚠/)
      await b.unmount()
    })
  }

  test(`v2 §3: RUNNING with unknown idle time leaves the meter blank [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: row => ({ ...row, idle_seconds: null, last_activity_at: null }) })
    await start($, surface)
    await team($, h, 'unknown-idle', ['unknown-idle-model'])
    const b = await mountBand($, surface)
    const row = visibleText(await bandRow(b, 'unknown-idle-model'))
    expect(row).toContain(' RUN ')
    expect(row).not.toMatch(/[▰▱]|idle |NaN/)
    await b.unmount()
  })

  // R6.2: loops are the mark touching a number, no words and no plural
  for (const [count, label] of [[1, '↻1'], [2, '↻2']] as const) {
    test(`R6.2: ${count} completed turns reads ${label} on the loops quiet ink [${surface}]`, async ($, on) => {
      const h = harness(on, { rowPatch: row => ({ ...row, turns_completed: count }) })
      await start($, surface)
      await team($, h, 'loops', ['loop-model'])
      const b = await mountBand($, surface)
      const text = visibleText(await bandRow(b, 'loop-model'))
      expect(text).toContain(` ${label} `) // one space each side
      expect(text).not.toMatch(/↻ \d/)
      expect(text.replace('loop-model', '')).not.toMatch(/loops?/)
      // R6.2: on the loops hue's quiet ink, bold, white text
      expectInk(await bandRow(b, 'loop-model'), ` ${label} `, { color: DARK.snow, bold: true })
      expectInkOneOf(await bandRow(b, 'loop-model'), ` ${label} `, 'backgroundColor', QUIET_DARK.loops)
      await b.unmount()
    })
  }
}
