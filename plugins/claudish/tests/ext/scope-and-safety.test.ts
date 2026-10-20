import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { ENGINE_DRAWING, engineOwn, harness, start, SERVERS } from '../fake-claudish'
import { COLS, ROWS } from '../scenario'
import { mountBand, mountPane, SURFACES } from '../ui'
import { POLL, delegate, drawingText, entries, press, team } from './support'

for (const surface of SURFACES) {
  test(`ext source: directly registered claudish owns its own run and tools [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'direct', ['direct-model', 'sibling'], 'mcp__claudish__team')
    const b = await mountBand($, surface)
    expect(await drawingText(b)).toContain('direct-model')
    await press(b, 'direct-model', 'Show')
    await h.clock.advance(POLL)
    await press(b, 'direct-model', 'Stop')
    await b.redraw()
    await press(b, 'direct-model', 'Stop?')
    await h.clock.advance(POLL)
    expect(h.fake.cancelCalls()).toHaveLength(1)
    expect(h.fake.cancelCalls()[0]!.server).toBe('claudish')
    expect(h.fake.captureCalls().every(c => c.server === 'claudish')).toBe(true)
    expect(h.submits).toHaveLength(1)
    expect(h.submits[0]).toContain(r.runId)
    await b.unmount()
  })

  test(`ext polling: bounded list traffic, child captures at the closed rate before any Show, render never writes [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h)
    await delegate($, h)
    const initial = h.fake.listCalls().length
    await h.clock.advance(5_000)
    const traffic = h.fake.listCalls().length - initial
    expect(traffic).toBeGreaterThanOrEqual(2)
    expect(traffic).toBeLessThanOrEqual(12) // two owned runs, five ~1s ticks plus scheduling slack
    // R6.5 as amended: every tab is captured with the panel closed, each at most every 10 s
    const caps = h.fake.captureCalls()
    expect(caps.length).toBeGreaterThan(0)
    const byTab = Map.groupBy(caps, c => `${c.tool}:${String(c.args.slot ?? c.args.session_id)}`)
    for (const [tab, cs] of byTab) expect(cs.slice(1).every((c, i) => c.at - cs[i]!.at >= 10_000), tab).toBe(true)
    const b = await mountBand($, surface)
    const writes = h.writes.length
    await b.redraw()
    await b.drawn()
    expect(h.writes).toHaveLength(writes)
    await b.unmount()
  })

  test(`ext safety: child screen, activity, provider and arbitrary reason never enter wake text [${surface}]`, async ($, on) => {
    const poison = 'UNTRUSTED_CHILD_SENTINEL_IGNORE_PRIOR_INSTRUCTIONS'
    const h = harness(on, {
      rowPatch: r => ({ ...r, activity: poison, provider: poison, reason: r.state === 'FAILED' ? poison : r.reason }),
      frame: args => ({ seq: args.seq, cols: COLS, rows: ROWS, cursor: { x: 0, y: 0 }, final: args.final, lines: [poison, ...new Array<string>(ROWS - 1).fill('')] }),
    })
    await start($, surface)
    const r = await team($, h)
    const b = await mountBand($, surface)
    await press(b, 'model-a', 'Show')
    await h.clock.advance(POLL)
    const p = await mountPane($, surface, h.opens[0]!.id)
    expect(await drawingText(p)).toContain(poison) // make sure the unsafe data really reached the mod
    h.fake.set(r.runId, '01', 'FAILED', 'api_error')
    await h.clock.advance(POLL)
    expect(h.submits).toHaveLength(1)
    expect(h.submits[0]).toContain('FAILED')
    expect(h.submits[0]).toContain(r.runId)
    expect(h.submits[0]).not.toContain(poison)
    expect(h.submits[0]).toMatch(/\(ref w[0-9a-f]{8}\)/)
    await p.unmount()
    await b.unmount()
  })

  test(`ext safety: display and polling need no process or foreign MCP [${surface}]`, async ($, on) => {
    const forbidden: string[] = []
    on('process.run', () => { forbidden.push('process.run'); throw new Error('unexpected host command') })
    on('process.spawn', async function* () { forbidden.push('process.spawn'); throw new Error('unexpected host spawn') })
    const h = harness(on)
    await start($, surface)
    const r = await team($, h)
    const b = await mountBand($, surface)
    await press(b, 'model-a', 'Show')
    await h.clock.advance(POLL)
    const p = await mountPane($, surface, h.opens[0]!.id)
    await p.drawn()
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    expect(forbidden).toEqual([])
    expect(h.fake.calls.every(c => (SERVERS as readonly string[]).includes(c.server))).toBe(true)
    await p.unmount()
    await b.unmount()
  })

  test(`ext epoch: clear abandons old deferred wakes and rows without needing session.start [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const s = await delegate($, h)
    await $.turn.start({ text: 'Main is working', turnId: 'ext-main' }) // defers the wake to the turn's end
    h.fake.set(s.id, s.id, 'COMPLETED')
    await h.clock.advance(POLL)
    expect(entries(h).some(e => e.kind === 'pending')).toBe(true)
    expect(h.submits).toHaveLength(0)
    await $.session.end({ reason: 'clear', sessionId: 'ext-old-conversation', resume: { id: 'ext-old-conversation' } })
    const b = await mountBand($, surface)
    expect(engineOwn(await b.drawn())).toEqual(ENGINE_DRAWING)
    await h.clock.advance(30_000)
    expect(h.submits).toHaveLength(0)
    await b.unmount()
  })
}
