import { test, expect } from 'claude-code/testing'
import { ENGINE_DRAWING, harness, start, type FakeOptions } from '../fake-claudish'
import { mountBand, mountPane, SURFACES } from '../ui'
import { POLL, GRACE, delegate, drawingText, modelCall, press, row, stateColor, team, themeOnly } from './support'

const unsupported: [string, FakeOptions][] = [
  ['missing server', { listAnswer: () => ({ deny: 'server not connected' }) }],
  ['claudish 10.3.0', { precontract: true }],
  ['future contract version', { version2: true }],
  ['list capability declined', { declines: true }],
  ['not JSON', { listAnswer: () => ({ text: '{broken' }) }],
  ['null JSON', { listAnswer: () => ({ text: 'null' }) }],
  ['invalid container', { listAnswer: (_, kind) => ({ text: JSON.stringify({ contract_version: 1, capabilities: ['list'], [kind === 'runs' ? 'runs' : 'sessions']: 'not an array' }) }) }],
]

for (const surface of SURFACES) {
  for (const [name, options] of unsupported) {
    test(`ext degrade: ${name} never invents rows or wakes [${surface}]`, async ($, on) => {
      const h = harness(on, options)
      await start($, surface)
      await team($, h)
      const b = await mountBand($, surface)
      await h.clock.advance(60_000)
      await b.redraw()
      expect(await b.drawn()).toEqual(ENGINE_DRAWING)
      expect(h.submits).toHaveLength(0)
      expect(h.toasts).toHaveLength(0)
      expect(h.fake.cancelCalls()).toHaveLength(0)
      expect(h.fake.captureCalls()).toHaveLength(0)
      // No repeating transcript errors; a single debug diagnostic is permitted.
      expect(h.debug.length).toBeLessThanOrEqual(1)
      await b.unmount()
    })
  }

  test(`ext degrade: delegation on pre-contract list_sessions also stays silent [${surface}]`, async ($, on) => {
    const h = harness(on, { precontract: true })
    await start($, surface)
    const s = await delegate($, h)
    h.fake.set(s.id, s.id, 'COMPLETED')
    await h.clock.advance(POLL + GRACE + 60_000)
    const b = await mountBand($, surface)
    expect(await b.drawn()).toEqual(ENGINE_DRAWING)
    expect(h.submits).toHaveLength(0)
    expect(h.toasts).toHaveLength(0)
    await b.unmount()
  })

  test(`ext degrade: unknown state is honest UNKNOWN, not guessed done or running [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, state: 'FUTURE_STATE' }) })
    await start($, surface)
    await team($, h)
    const b = await mountBand($, surface)
    stateColor(await row(b, 'model-a'), '? unknown', 'inactive')
    expect(await drawingText(b)).not.toContain('▶ running')
    expect(await drawingText(b)).not.toContain('✓ done')
    expect(h.submits).toHaveLength(0)
    themeOnly(await b.drawn())
    await b.unmount()
  })

  test(`ext degrade: transport loss after a valid feed never displays stale running [${surface}]`, async ($, on) => {
    let broken = false
    const h = harness(on, { listAnswer: () => broken ? { deny: 'temporary transport failure' } : undefined })
    await start($, surface)
    await team($, h)
    const b = await mountBand($, surface)
    expect(await drawingText(b)).toContain('▶ running')
    broken = true
    await h.clock.advance(POLL * 2)
    await b.redraw()
    stateColor(await row(b, 'model-a'), '? unknown', 'inactive')
    expect(await drawingText(b)).not.toContain('▶ running')
    expect(h.submits).toHaveLength(0)
    broken = false
    await h.clock.advance(30_000) // past the documented back-off of a failing feed
    await b.redraw()
    stateColor(await row(b, 'model-a'), '▶ running', 'warning')
    await b.unmount()
  })

  test(`ext degrade: no capture capability preserves band without a false live tab [${surface}]`, async ($, on) => {
    const h = harness(on, { noCapture: true })
    await start($, surface)
    await team($, h)
    const b = await mountBand($, surface)
    expect(await drawingText(b)).toContain('▶ running')
    const shows = await b.findAll({ type: 'Button', text: /^Show$/ })
    if (shows.length > 0) {
      await press(b, 'model-a', 'Show')
      if (h.opens.length > 0) {
        await h.clock.advance(POLL)
        const p = await mountPane($, surface, h.opens[0]!.id)
        expect(await drawingText(p)).toMatch(/not available/i)
        await p.unmount()
      }
    }
    await h.clock.advance(10_000)
    expect(h.fake.captureCalls()).toHaveLength(0)
    expect(h.submits).toHaveLength(0)
    await b.unmount()
  })

  test(`ext degrade: malformed capture is not rendered as a live screen [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: () => ({ seq: -1, cols: 'wrong', rows: 50, cursor: null, lines: [42], final: false }) })
    await start($, surface)
    await team($, h)
    const b = await mountBand($, surface)
    await press(b, 'model-a', 'Show')
    await h.clock.advance(POLL * 2)
    const p = await mountPane($, surface, h.opens[0]!.id)
    expect(await drawingText(p)).toMatch(/unavailable|waiting|no (screen|frame)|capture/i)
    themeOnly(await p.drawn())
    expect(h.submits).toHaveLength(0)
    await p.unmount()
    await b.unmount()
  })

  test(`ext scope: pre-existing and foreign-server work does not belong to this conversation [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    h.fake.sessions.push({ id: 'old-session', model: 'old-model', startedAt: h.clock.now() - 60_000, control: { state: 'COMPLETED', reason: null, at: h.clock.now() }, noPane: false })
    // The supplied fake answers this tool, but the mod must not treat it as claudish.
    await modelCall($, 'mcp__foreign__team', { mode: 'run', path: 'foreign', models: ['foreign-model'] })
    await h.clock.advance(POLL + GRACE + POLL)
    const b = await mountBand($, surface)
    expect(await b.drawn()).toEqual(ENGINE_DRAWING)
    expect(h.submits).toHaveLength(0)
    expect(h.toasts).toHaveLength(0)
    await b.unmount()
  })

  test(`ext scope: already-settled run-and-judge is not a live band run [${surface}]`, async ($, on) => {
    const h = harness(on, { startSettled: true })
    await start($, surface)
    await modelCall($, 'mcp__plugin_claudish_claudish__team', { mode: 'run-and-judge', path: 'judged', models: ['judge-model'] })
    await h.clock.advance(POLL + GRACE + POLL)
    const b = await mountBand($, surface)
    expect(await b.drawn()).toEqual(ENGINE_DRAWING)
    expect(h.submits).toHaveLength(0)
    await b.unmount()
  })
}
