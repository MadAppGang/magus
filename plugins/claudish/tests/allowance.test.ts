import { expect } from 'claude-code/testing'
import { test } from './kit'
import { harness, start, SERVERS, TEAM_TOOL } from './fake-claudish'
import { SURFACES, mountBand, mountPane, bandProps, type Mounted } from './ui'
import { ALLOWANCE_BUTTON_KEY, FORECAST_HIDE_KEY } from '../hooks/status/allowance'
import { FORECAST_PANE_ID, SHOW_PANE_ID } from '../hooks/status/domain'
import type { AllowanceVariant } from './allowance-scenario'
const row = (band: Mounted) => band.find({ type: 'Button', key: ALLOWANCE_BUTTON_KEY })
const variants: AllowanceVariant[] = ['warn', 'no-evidence', 'unavailable', 'capability-absent', 'unknown-tool-error', 'unknown-tool-reject', 'refused']
for (const surface of SURFACES) {
  for (const allowance of variants) test(`REQ-15 ${allowance} draws allowance row only for an ok report, without runs [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance })
    await start($, surface)
    await h.clock.advance(1)
    const b = await mountBand($, surface)
    if (allowance === 'warn') expect(await row(b)).toBeDefined()
    else expect(await row(b)).toBeUndefined()
    expect(h.toasts).toHaveLength(0)
    await b.unmount()
  })
  // The report describes claudish's Codex pool: only a session claudish launched on `cx@`/`codex@`
  // spends it. A plain Claude Code session (unset) and any other route never ask and never draw.
  for (const [activeModel, shown] of [[null, false], ['gpt-test', false], ['or@openai/gpt-test', false], ['cx@gpt-test', true], ['CODEX@gpt-test', true]] as const) {
    test(`allowance row and its poll only on the Codex pool: CLAUDISH_ACTIVE_MODEL_NAME ${activeModel ?? 'unset'} → ${shown ? 'shown' : 'none'} [${surface}]`, async ($, on) => {
      const h = harness(on, { allowance: 'warn', activeModel })
      await start($, surface)
      await h.clock.advance(60_000)
      const b = await mountBand($, surface)
      if (shown) expect(await row(b)).toBeDefined()
      else expect(await row(b)).toBeUndefined()
      expect(h.fake.calls.some(c => c.tool === 'allowance_status')).toBe(shown)
      await b.unmount()
    })
  }
  test(`a forecast panel drawn off the Codex pool is put away and draws nothing [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'warn', activeModel: null })
    await start($, surface)
    const p = await mountPane($, surface, FORECAST_PANE_ID)
    await h.clock.advance(1)
    expect(h.closes).toContain(FORECAST_PANE_ID)
    expect(h.fake.calls.some(c => c.tool === 'allowance_status')).toBe(false)
    await p.unmount()
  })
  test(`REQ-16 row takes exactly one run-band budget row; run band wins at maxRows 1 [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'warn' })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'allowance-budget' })
    await h.clock.advance(1000)
    const b = await mountBand($, surface, bandProps(140, 4))
    expect(await row(b)).toBeDefined()
    const runRows = async () => (await b.findAll({ type: 'Box' })).filter(n => n.key?.startsWith('row:')).map(n => n.key)
    const withAllowance = await runRows()
    expect(withAllowance.length).toBeGreaterThan(0)
    await b.redraw(bandProps(140, 1))
    expect(await row(b)).toBeUndefined()
    h.fake.options.allowance = 'unavailable'
    await h.clock.advance(60_000)
    await b.redraw(bandProps(140, 3))
    expect(await row(b)).toBeUndefined()
    expect(await runRows()).toEqual(withAllowance)
    await b.unmount()
  })
  test(`REQ-17 Show reaches ui.open before pane discovery, renders forecast, and Hide closes it [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'warn' })
    await start($, surface)
    await h.clock.advance(1)
    const b = await mountBand($, surface)
    expect(await row(b)).toBeDefined()
    const before = h.uiCalls.length
    await b.press({ key: ALLOWANCE_BUTTON_KEY })
    expect(h.uiCalls[before]).toBe('open')
    expect(h.panes.map(p => p.id)).toEqual([FORECAST_PANE_ID])
    const p = await mountPane($, surface, FORECAST_PANE_ID)
    expect(await p.find({ type: 'Text', text: /LEFT NOW/ })).toBeDefined()
    expect(await p.find({ type: 'Button', key: FORECAST_HIDE_KEY })).toBeDefined()
    await p.press({ key: FORECAST_HIDE_KEY })
    expect(h.closes).toContain(FORECAST_PANE_ID)
    expect(h.panes).toHaveLength(0)
    await p.unmount()
    await b.unmount()
  })
  test(`REQ-17 allowance and run panes are exclusive in both directions [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'warn' })
    await start($, surface)
    await $.tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'allowance-exclusive' })
    await h.clock.advance(1000)
    const b = await mountBand($, surface)
    await b.press({ key: ALLOWANCE_BUTTON_KEY })
    expect(h.panes.map(p => p.id)).toEqual([FORECAST_PANE_ID])
    await b.redraw()
    const runShow = (await b.findAll({ type: 'Button' })).find(n => n.props.label === 'Show' && n.key !== ALLOWANCE_BUTTON_KEY)
    expect(runShow).toBeDefined()
    await b.press({ key: runShow!.key! })
    expect(h.panes.map(p => p.id)).toEqual([SHOW_PANE_ID])
    await b.redraw()
    await b.press({ key: ALLOWANCE_BUTTON_KEY })
    expect(h.panes.map(p => p.id)).toEqual([FORECAST_PANE_ID])
    await b.unmount()
  })
  for (const allowance of ['warn', 'no-evidence', 'unavailable', 'refused', 'capability-absent', 'unknown-tool-error'] as const)
    test(`REQ-18 ${allowance} cadence at exact boundary [${surface}]`, async ($, on) => {
      const h = harness(on, { allowance })
      await start($, surface)
      await h.clock.advance(1)
      const initial = h.fake.allowanceCalls()
      expect(initial.length).toBeGreaterThan(0)
      const lastAt = initial[initial.length-1]!.at
      // No answer stops the loop. A server without the tool is no claudish answer yet: in the first
      // minute it is probed again in 5 s, every candidate server asked anew.
      const unheard = allowance === 'unknown-tool-error'
      const interval = allowance === 'warn' ? 60_000 : unheard ? 5_000 : 300_000
      await h.clock.advance(lastAt + interval - 1 - h.clock.now())
      expect(h.fake.allowanceCalls()).toHaveLength(initial.length)
      await h.clock.advance(1)
      expect(h.fake.allowanceCalls()).toHaveLength(initial.length + (unheard ? SERVERS.length : 1))
    })
  test(`REQ-18 REQ-25 Show loads panel slices on first open and retains the band refresh threshold [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'warn' })
    await start($, surface)
    await h.clock.advance(1)
    const b = await mountBand($, surface)
    const initial = h.fake.allowanceCalls().length
    await b.press({ key: ALLOWANCE_BUTTON_KEY })
    // Row actions return void: settle the press's effects and any due timer before asserting.
    await h.clock.settle()
    await h.clock.advance(0)
    expect(h.fake.allowanceCalls().slice(initial).map(c => c.args)).toEqual([
      { sections: ['accounts', 'alerts', 'burn'] },
      { sections: ['accounts', 'combined', 'trajectory'], horizon_hours: 144 },
    ])
    const afterOpen = h.fake.allowanceCalls().length
    // Once the panel's slice is present, another Show before 15 seconds must not refresh the band.
    const p = await mountPane($, surface, FORECAST_PANE_ID)
    await p.press({ key: FORECAST_HIDE_KEY })
    await h.clock.settle()
    await h.clock.advance(14_999)
    await b.redraw()
    await b.press({ key: ALLOWANCE_BUTTON_KEY })
    await h.clock.settle()
    expect(h.fake.allowanceCalls()).toHaveLength(afterOpen)
    await p.redraw()
    await p.press({ key: FORECAST_HIDE_KEY })
    await h.clock.advance(1)
    await b.redraw()
    await b.press({ key: ALLOWANCE_BUTTON_KEY })
    await h.clock.settle()
    await h.clock.advance(0)
    expect(h.fake.allowanceCalls().slice(afterOpen).map(c => c.args)).toEqual([
      { sections: ['accounts', 'alerts', 'burn'] },
      { sections: ['accounts', 'combined', 'trajectory'], horizon_hours: 144 },
    ])
    await p.unmount()
    await b.unmount()
  })
  // A /clear dispatches no session.start (SessionEndInput), so the chain must outlive it.
  test(`REQ-19 clear keeps allowance reading and keeps polling at 60 s [${surface}]`, async ($, on) => {
    const h = harness(on, { allowance: 'warn' })
    await start($, surface)
    await h.clock.advance(1)
    await $.session.end({ reason: 'clear', sessionId: 'allowance-old-session', resume: { id: 'allowance-old-session' } })
    const b = await mountBand($, surface)
    expect(await row(b)).toBeDefined()
    const calls = h.fake.allowanceCalls()
    const before = calls.length
    await h.clock.advance(calls[before-1]!.at + 60_000 - 1 - h.clock.now())
    expect(h.fake.allowanceCalls()).toHaveLength(before)
    await h.clock.advance(1)
    expect(h.fake.allowanceCalls()).toHaveLength(before + 1)
    await b.unmount()
  })
}
