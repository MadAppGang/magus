import { test, expect } from 'claude-code/testing'
import { harness, start } from '../fake-claudish'
import { REAP_MS, COLS, ROWS, type Json } from '../scenario'
import { mountBand, mountPane, paneProps, SURFACES, walk } from '../ui'
import { POLL, delegate, drawingText, press, team, textOf, themeOnly } from './support'

function captured(args: { seq: number; final: boolean; spans: boolean }): Json {
  const lines = new Array<string>(ROWS).fill('')
  lines[0] = 'ALPHA BETA tail'
  lines[1] = `frame ${args.seq}`
  lines[2] = 'INDEXED'
  const out: Json = { seq: args.seq, cols: COLS, rows: ROWS, cursor: { x: 2, y: 1 }, lines, final: args.final }
  if (args.spans) {
    const spans: number[][][] = lines.map(() => [])
    spans[0] = [[0, 5, 0x1000000 + 0x112233, 0x1000000 + 0x445566, 1]]
    spans[2] = [[0, 7, 208, -1, 0]]
    out.spans = spans
  }
  return out
}

for (const surface of SURFACES) {
  test(`ext Show: one model-titled tab per slot; reopening focuses the same id [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h)
    const b = await mountBand($, surface)
    expect(h.fake.captureCalls()).toHaveLength(0)
    await press(b, 'model-a', 'Show')
    await press(b, 'model-b', 'Show')
    await press(b, 'model-a', 'Show')
    expect(h.opens).toHaveLength(3)
    expect(h.opens.map(p => p.title)).toEqual(['model-a', 'model-b', 'model-a'])
    expect(h.opens[0]!.id).toBe(h.opens[2]!.id)
    expect(h.opens[0]!.id).not.toBe(h.opens[1]!.id)
    expect(h.panes).toHaveLength(2)
    expect(h.panes.find(p => p.id === h.opens[0]!.id)?.isShown).toBe(true)
    await h.clock.advance(3_000)
    expect(h.fake.captureCalls().length).toBeGreaterThan(0)
    for (const c of h.fake.captureCalls()) {
      expect(c).toMatchObject({ tool: 'team', args: { mode: 'capture', path: r.path, run_id: r.runId } })
      expect(['01', '02']).toContain(c.args.slot)
      expect(c.args).not.toHaveProperty('pane')
    }
    await b.unmount()
  })

  test(`ext Show: delegation capture_session and incremental since_seq [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: captured })
    await start($, surface)
    const s = await delegate($, h)
    const b = await mountBand($, surface)
    await press(b, s.model, 'Show')
    await h.clock.advance(POLL)
    const p = await mountPane($, surface, h.opens[0]!.id)
    expect(await drawingText(p)).toContain('ALPHA BETA tail')
    const before = await drawingText(p)
    await h.clock.advance(3_000)
    await p.redraw()
    expect(await drawingText(p)).not.toBe(before)
    const calls = h.fake.captureCalls()
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.every(c => c.tool === 'capture_session' && c.args.session_id === s.id)).toBe(true)
    expect(calls.some(c => typeof c.args.since_seq === 'number' && (c.args.since_seq as number) >= 1)).toBe(true)
    expect(calls.every(c => c.args.spans === true)).toBe(true)
    await p.unmount()
    await b.unmount()
  })

  test(`ext Show: text and colour spans are mirrored, with theme keys only outside frame [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: captured })
    await start($, surface)
    await team($, h)
    const b = await mountBand($, surface)
    await press(b, 'model-a', 'Show')
    await h.clock.advance(POLL)
    const p = await mountPane($, surface, h.opens[0]!.id)
    const tree = await p.drawn()
    themeOnly(tree)
    const frameNodes = walk(tree).filter(x => x.inFrame).map(x => x.node)
    expect(frameNodes.length).toBeGreaterThan(0)
    const span = frameNodes.find(n => n.type === 'Text' && textOf(n) === 'ALPHA')
    expect(span).toBeDefined()
    expect(span?.props).toMatchObject({ color: '#112233', backgroundColor: '#445566', bold: true })
    expect(frameNodes.filter(n => n.type === 'Text').map(textOf).join('')).toContain('ALPHA BETA tail')
    expect(frameNodes.some(n => textOf(n) === 'INDEXED' && /^#[0-9a-f]{6}$/.test(String(n.props?.color)))).toBe(true)
    for (const n of frameNodes) {
      for (const prop of ['color', 'backgroundColor']) {
        if (n.props?.[prop] !== undefined) expect(String(n.props[prop])).toMatch(/^#[0-9a-f]{6}$/)
      }
      if (n.props?.color === '#112233') expect(textOf(n)).toBe('ALPHA')
    }
    // No child input controls, key handlers or callback-bearing frame nodes.
    expect(walk(tree).some(x => ['Input', 'Select', 'Client', 'Terminal'].includes(x.node.type ?? ''))).toBe(false)
    expect(frameNodes.some(n => Object.keys(n.props ?? {}).some(k => /^on(Key|Input|Submit|Press)/.test(k)))).toBe(false)
    expect(h.fake.calls.some(c => ['send_input', 'run_prompt', 'create_session'].includes(c.tool))).toBe(false)
    await p.unmount()
    await b.unmount()
  })

  test(`ext Show: absent capture_spans means plain text and no requested spans [${surface}]`, async ($, on) => {
    const h = harness(on, { noSpans: true, frame: captured })
    await start($, surface)
    await team($, h)
    const b = await mountBand($, surface)
    await press(b, 'model-a', 'Show')
    await h.clock.advance(POLL)
    const p = await mountPane($, surface, h.opens[0]!.id)
    expect(await drawingText(p)).toContain('ALPHA BETA tail')
    const nodes = walk(await p.drawn()).filter(x => x.inFrame).map(x => x.node)
    expect(nodes.length).toBeGreaterThan(0)
    for (const n of nodes) {
      expect(n.props?.color).toBeUndefined()
      expect(n.props?.backgroundColor).toBeUndefined()
    }
    expect(h.fake.captureCalls().every(c => c.args.spans !== true)).toBe(true)
    await p.unmount()
    await b.unmount()
  })

  test(`ext Show: stopped slot keeps its unchanged frame until final, then no more capture [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: captured })
    await start($, surface)
    const r = await team($, h)
    const b = await mountBand($, surface)
    await press(b, 'model-a', 'Show')
    await h.clock.advance(POLL)
    const p = await mountPane($, surface, h.opens[0]!.id)
    h.fake.set(r.runId, '01', 'CANCELLED', 'cancelled')
    const endedAt = h.clock.now()
    await h.clock.advance(2_000)
    await p.redraw()
    const frameText = walk(await p.drawn()).filter(x => x.inFrame && x.node.type === 'Text').map(x => textOf(x.node)).join('')
    expect(frameText).toContain('ALPHA BETA tail')
    const n = h.fake.captureCalls().length
    await h.clock.set(endedAt + REAP_MS - 1)
    expect(h.fake.captureCalls().length).toBeGreaterThan(n)
    await h.clock.advance(POLL + 1)
    await p.redraw()
    const finalText = walk(await p.drawn()).filter(x => x.inFrame && x.node.type === 'Text').map(x => textOf(x.node)).join('')
    expect(finalText).toBe(frameText)
    const finalCount = h.fake.captureCalls().length
    await h.clock.advance(30_000)
    expect(h.fake.captureCalls()).toHaveLength(finalCount)
    expect(h.closes).not.toContain(h.opens[0]!.id)
    await p.unmount()
    await b.unmount()
  })

  test(`ext Show: engine owns dock/inline placement, and only placed open tabs capture [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: captured })
    await start($, surface)
    await team($, h)
    const b = await mountBand($, surface)
    await press(b, 'model-a', 'Show')
    await h.clock.advance(POLL)
    const p = await mountPane($, surface, h.opens[0]!.id)
    await p.redraw({ ...paneProps(), placement: 'inline' })
    expect(await drawingText(p)).toContain('ALPHA BETA tail')
    themeOnly(await p.drawn())
    await p.unmount()
    // Simulate the surface closing the dock's last tab (ui.panes is authoritative).
    h.panes = []
    await h.clock.advance(POLL * 2)
    const count = h.fake.captureCalls().length
    await h.clock.advance(10_000)
    expect(h.fake.captureCalls()).toHaveLength(count)
    await b.unmount()
  })
}
