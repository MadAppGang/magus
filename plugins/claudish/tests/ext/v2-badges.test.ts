import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start } from '../fake-claudish'
import { mountBand, SURFACES } from '../ui'
import { POLL, team } from './support'
import { DARK, arrangeLost, arrangeStart, bandRow, expectInk, header, inkOf, runtimePart, themeKeysOnly, visibleText } from './v2-support'

// §9: every code is a solid badge of its state's hue, bold; the runtime is plain text in the hue.
const BADGES = [
  { state: 'STARTING', code: 'NEW', fg: DARK.ink, bg: DARK.run, group: 'running' },
  { state: 'RUNNING', code: 'RUN', fg: DARK.ink, bg: DARK.run, group: 'running' },
  { state: 'AWAITING_INPUT', code: 'ASK', fg: DARK.ink, bg: DARK.ask, group: 'needs you' },
  { state: 'AWAITING_PERMISSION', code: 'ASK', fg: DARK.ink, bg: DARK.ask, group: 'needs you' },
  { state: 'COMPLETED', code: 'END', fg: DARK.ink, bg: DARK.done, group: 'done' },
  { state: 'FAILED', code: 'ERR', fg: DARK.ink, bg: DARK.fail, group: 'failed', reason: 'api_error' },
  { state: 'TIMEOUT', code: 'TMO', fg: DARK.ink, bg: DARK.fail, group: 'failed', reason: 'timeout' },
  { state: 'EMPTY', code: 'NIL', fg: DARK.ink, bg: DARK.fail, group: 'failed', reason: 'empty_output' },
  { state: 'CANCELLED', code: 'STP', fg: DARK.snow, bg: DARK.stopped, group: 'stopped', reason: 'cancelled' },
  { state: 'UNKNOWN', code: '???', fg: DARK.snow, bg: DARK.stopped, group: 'running' },
] as const

for (const surface of SURFACES) {
  for (const c of BADGES) {
    test(`v2 §2/§9: ${c.state} draws ${c.code} as a solid bold badge, its runtime in the hue [${surface}]`, async ($, on) => {
      const h = harness(on)
      await start($, surface)
      const r = await team($, h, 'badge-run', ['badge-model'])
      h.fake.set(r.runId, '01', c.state, 'reason' in c ? c.reason : null)
      await h.clock.advance(POLL)
      const b = await mountBand($, surface)
      const row = await bandRow(b, 'badge-model')
      const text = visibleText(row)
      const code = ` ${c.code} `
      expect(text).toContain(code)
      expectInk(row, code, { color: c.fg, backgroundColor: c.bg, bold: true })
      const runtime = text.slice(text.indexOf(code) + code.length, text.indexOf(code) + code.length + 7)
      expect(runtime).toHaveLength(7)
      expect(runtime).toMatch(/^ *\d+s $/)
      for (const ink of inkOf(row, code)) expect(ink.dimColor).not.toBe(true)
      // §9: the runtime is plain text in the state's hue, no fill
      expectInk(row, runtime, { color: c.bg, backgroundColor: undefined })
      for (const ink of inkOf(row, runtime)) {
        expect(ink.bold).not.toBe(true)
        expect(ink.dimColor).not.toBe(true)
      }
      expect(visibleText(await header(b))).toContain(` · 1 ${c.group}`)
      expect(text).not.toMatch(/◌ starting|▶ running|◇ input|◇ permit|✓ done|✕ failed|✕ timeout|✕ empty|■ stopped|\? unknown/)
      themeKeysOnly(await b.drawn())
      await b.unmount()
    })
  }

  test(`v2 §2: shape_mismatch is FMT and wrong format, never NIL, empty or failed [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'format-run', ['format-model'])
    h.fake.set(r.runId, '01', 'EMPTY', 'shape_mismatch')
    await h.clock.advance(POLL)
    const b = await mountBand($, surface)
    const row = await bandRow(b, 'format-model')
    expectInk(row, ' FMT ', { color: DARK.ink, backgroundColor: DARK.format, bold: true })
    expect(visibleText(await header(b))).toBe('◆ claudish  format-run · 1 wrong format')
    expectInk(await header(b), '1 wrong format', { color: 'warning' })
    expect(visibleText(row)).not.toMatch(/ NIL |empty|shape_mismatch/)
    expect(visibleText(await header(b))).not.toContain('failed')
    // Stop's red button is absent on this terminal row, so no row element is red (the theme's or the fail hue).
    for (const ink of inkOf(row, visibleText(row))) {
      for (const red of ['error', DARK.fail]) {
        expect(ink.color).not.toBe(red)
        expect(ink.backgroundColor).not.toBe(red)
      }
    }
    const notices = h.toasts.filter(t => t.includes('format-model'))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('wrong format')
    expect(notices[0]).not.toMatch(/empty|failed|shape_mismatch/)
    await h.clock.advance(20_000)
    expect(h.toasts.filter(t => t.includes('format-model'))).toHaveLength(1)
    await b.unmount()
  })

  test(`v2 §2: header groups are needs you, running, done, wrong format, failed, stopped [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'groups', ['ask-model', 'run-model', 'done-model', 'fmt-model', 'fail-model', 'stop-model'])
    h.fake.set(r.runId, '01', 'AWAITING_INPUT')
    h.fake.set(r.runId, '03', 'COMPLETED')
    h.fake.set(r.runId, '04', 'EMPTY', 'shape_mismatch')
    h.fake.set(r.runId, '05', 'FAILED', 'api_error')
    h.fake.set(r.runId, '06', 'CANCELLED', 'cancelled')
    await h.clock.advance(POLL)
    const b = await mountBand($, surface)
    expect(visibleText(await header(b))).toBe('◆ claudish  groups · 1 needs you · 1 running · 1 done · 1 wrong format · 1 failed · 1 stopped')
    expect(visibleText(await header(b))).not.toContain('2 failed')
    expect(visibleText(await header(b))).not.toContain('empty')
    await b.unmount()
  })

  test(`v2 §2: LOST draws LST with loud ink, not ERR or TMO [${surface}]`, async ($, on) => {
    const h = harness(on)
    const setLost = arrangeLost(on)
    await start($, surface)
    const r = await team($, h, 'lost-run', ['lost-model'])
    setLost(r.runId, '01')
    const b = await mountBand($, surface)
    const row = await bandRow(b, 'lost-model')
    expectInk(row, ' LST ', { color: DARK.ink, backgroundColor: DARK.fail, bold: true })
    expect(visibleText(await header(b))).toContain('1 failed')
    expect(visibleText(row)).not.toMatch(/ ERR | TMO | RUN /)
    await b.unmount()
  })

  test(`v2 §2: an unreachable run makes only its live slots unclear [${surface}]`, async ($, on) => {
    let unreachable = false
    const h = harness(on, { listAnswer: (_n, kind) => unreachable && kind === 'runs' ? { deny: 'server unreachable' } : undefined })
    await start($, surface)
    const r = await team($, h, 'unreachable', ['live-model', 'ended-model'])
    h.fake.set(r.runId, '02', 'COMPLETED')
    await h.clock.advance(POLL)
    unreachable = true
    await h.clock.advance(POLL)
    const b = await mountBand($, surface)
    expectInk(await bandRow(b, 'live-model'), ' ??? ', { color: DARK.snow, backgroundColor: DARK.stopped })
    expect(visibleText(await bandRow(b, 'live-model'))).not.toContain(' RUN ')
    expectInk(await bandRow(b, 'ended-model'), ' END ', { color: DARK.ink, backgroundColor: DARK.done })
    expect(visibleText(await bandRow(b, 'ended-model'))).not.toContain(' ??? ')
    expect(visibleText(await header(b))).toContain('1 running · 1 done')
    await b.unmount()
  })

  for (const [seconds, formatted] of [
    [42, '42s'], [17 * 60, '17m'], [3 * 3600 + 12 * 60, '3h12m'],
    [10 * 3600, '10h'], [13 * 3600, '13h'], [6 * 86400 + 2 * 3600, '6d02h'],
    [10 * 86400, '10d'], [12 * 86400, '12d'],
  ] as const) {
    test(`v2 §2: runtime ${seconds}s formats as ${formatted} in seven cells [${surface}]`, async ($, on) => {
      const h = harness(on)
      const setStart = arrangeStart(on)
      await start($, surface)
      const r = await team($, h, 'runtime', ['runtime-model'])
      setStart(r.runId, h.clock.now() - seconds * 1000)
      const b = await mountBand($, surface)
      expect(visibleText(await bandRow(b, 'runtime-model'))).toContain(` RUN ${runtimePart(formatted)}`)
      expect(visibleText(await bandRow(b, 'runtime-model'))).not.toContain('idle ')
      await b.unmount()
    })
  }

  test(`v2 §2: unknown runtime draws an em dash, never zero or NaN [${surface}]`, async ($, on) => {
    const h = harness(on)
    const setStart = arrangeStart(on)
    await start($, surface)
    const r = await team($, h, 'unknown-start', ['unknown-model'])
    setStart(r.runId, undefined)
    const b = await mountBand($, surface)
    const row = visibleText(await bandRow(b, 'unknown-model'))
    expect(row).toContain(` RUN ${runtimePart('—')}`)
    expect(row).not.toMatch(/NaN|undefined| RUN \s*0s /)
    await b.unmount()
  })

  test(`v2 §2: live runtime advances but terminal runtime freezes at last activity [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'clock-run', ['clock-model'])
    await h.clock.set(r.startedAt + 42_000)
    const b = await mountBand($, surface)
    expect(visibleText(await bandRow(b, 'clock-model'))).toContain(` RUN ${runtimePart('42s')}`)
    await h.clock.advance(1_000)
    await b.redraw()
    expect(visibleText(await bandRow(b, 'clock-model'))).toContain(` RUN ${runtimePart('43s')}`)
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    await b.redraw()
    expect(visibleText(await bandRow(b, 'clock-model'))).toContain(` END ${runtimePart('43s')}`)
    await h.clock.advance(20_000)
    await b.redraw()
    expect(visibleText(await bandRow(b, 'clock-model'))).toContain(` END ${runtimePart('43s')}`)
    expect(visibleText(await bandRow(b, 'clock-model'))).not.toContain(runtimePart('64s'))
    await b.unmount()
  })
}
