import { test, expect } from 'claude-code/testing'
import { harness, start } from '../fake-claudish'
import { mountBand, SURFACES } from '../ui'
import { POLL, team } from './support'
import { DARK, bandRow, expectInk, visibleText } from './v2-support'

const EDGES = [
  [0, '▱▱▱▱▱', 'success'],
  [9, '▱▱▱▱▱', 'success'],
  [10, '▰▱▱▱▱', 'success'],
  [29, '▰▱▱▱▱', 'success'],
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
    test(`v2 §3: ${seconds}s silence draws ${meter} in ${color} [${surface}]`, async ($, on) => {
      const h = harness(on, { rowPatch: row => ({ ...row, idle_seconds: seconds, activity: 'thinking' }) })
      await start($, surface)
      await team($, h, 'stale-meter', ['meter-model'])
      const b = await mountBand($, surface)
      const row = await bandRow(b, 'meter-model')
      const text = visibleText(row)
      const meters = text.match(/[▰▱]{5}(?: \d+(?:s|m|h))?/g) ?? []
      expect(meters).toEqual([meter])
      expectInk(row, meter, { color })
      expect(text).not.toMatch(/idle |⚠/)
      if (seconds < 30) expect(meters[0]).not.toMatch(/\d/)
      if (seconds < 120) expect(meters[0]).not.toContain('▰▰▰▰▰')
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

  // §8: loops are a symbol and a number, no words and no plural
  for (const [count, label] of [[1, '↻ 1'], [2, '↻ 2']] as const) {
    test(`v2 §3/§8: ${count} completed turns reads ${label} [${surface}]`, async ($, on) => {
      const h = harness(on, { rowPatch: row => ({ ...row, turns_completed: count }) })
      await start($, surface)
      await team($, h, 'loops', ['loop-model'])
      const b = await mountBand($, surface)
      const text = visibleText(await bandRow(b, 'loop-model'))
      expect(text).toContain(label)
      expect(text.replace('loop-model', '')).not.toMatch(/loops?/)
      // §9: plain bold text in the loops hue, no fill
      expectInk(await bandRow(b, 'loop-model'), label, { color: DARK.loops, bold: true, backgroundColor: undefined })
      await b.unmount()
    })
  }
}
