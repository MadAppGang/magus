import { test, expect } from 'claude-code/testing'
import { ENGINE_DRAWING, engineOwn, harness, start } from '../fake-claudish'
import { bandProps, mountBand, SURFACES, walk, type Node } from '../ui'
import { POLL, DARK, children, delegate, drawingText, modelCall, press, row, stateColor, team, textOf, themeOnly } from './support'

// A small independent cell measurer for this suite's ASCII fixture and one-cell glyphs.
// This measures the DRAWN description, not the implementation's fitColumns result.
function cells(n: unknown): number {
  if (typeof n === 'string' || typeof n === 'number') return Array.from(String(n)).filter(c => c !== '️').length
  if (!n || typeof n !== 'object') return 0
  const node = n as Node
  const p = node.props ?? {}
  // a plain Button with children draws them (a chip); otherwise its label, in `[ ]` unless plain
  if (node.type === 'Button') return p.plain && children(node).length > 0 ? children(node).reduce<number>((sum, c) => sum + cells(c), 0) : cells(p.label) + (p.plain ? 0 : 4)
  if (node.type === 'Text') return children(node).reduce<number>((sum, c) => sum + cells(c), 0)
  const kids = children(node)
  const widths = kids.map(cells)
  const horizontal = p.flexDirection === 'row' || p.flexDirection === 'row-reverse'
  const natural = horizontal ? widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * Number(p.columnGap ?? p.gap ?? 0) : Math.max(0, ...widths)
  const padding = Number(p.paddingLeft ?? p.paddingX ?? p.padding ?? 0) + Number(p.paddingRight ?? p.paddingX ?? p.padding ?? 0)
  // Text is pre-truncated by the contract; an explicit numeric Box width is its allocation.
  return typeof p.width === 'number' ? p.width : natural + padding
}
function drawnRows(tree: unknown) {
  const boxes = walk(tree).map(x => x.node).filter(n => n.type === 'Box'
    && / (NEW|RUN|ASK|END|ERR|TMO|NIL|FMT|STP|LST|\?\?\?) /.test(textOf(n))
    && walk(n).filter(x => x.node.type === 'Button' && (x.node.props?.label === 'Show' || x.node.props?.label === 'Hide')).length === 1)
  return boxes.filter(n => !children(n).some(c => boxes.includes(c as Node)))
}

for (const surface of SURFACES) {
  test(`ext band: no runs and surveys yield exactly to the engine [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const empty = await mountBand($, surface)
    expect(engineOwn(await empty.drawn())).toEqual(ENGINE_DRAWING)
    await empty.unmount()
    await team($, h)
    const b = await mountBand($, surface, bandProps(140, 20, true))
    expect(engineOwn(await b.drawn())).toEqual(ENGINE_DRAWING)
    await b.redraw(bandProps(140, 20, false))
    expect(await drawingText(b)).toContain('◆ claudish')
    expect(await b.findAll({ type: 'Button', text: /^\[ Show \]$/ })).toHaveLength(3)
    const heading = walk(await b.drawn()).map(x => x.node).find(n => n.type === 'Text' && textOf(n) === '◆ claudish')
    expect(heading?.props?.color).toBe('claude')
    expect(heading?.props?.bold).toBe(true)
    await b.unmount()
  })

  test(`ext band: shrinking width drops activity, provider, loops, tools, tokens, cost, meter in order; the model stays [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, provider: 'ProviderDisplay', tokens_in: 48_100, tokens_out: 2_300, tool_calls: 12, turns_completed: 3, cost_usd: 0.004, idle_seconds: 12, activity: 'Bash' }) })
    await start($, surface)
    await team($, h, 'review', ['a-long-requested-model-id-0123456789'])
    const b = await mountBand($, surface, bandProps(200))
    const wide = await drawingText(b)
    expect(wide).toContain('↑48.1k')
    expect(wide).toContain('↓2.3k')
    expect(wide).toContain('<$0.01')
    expect(wide).toContain('ƒ 12')
    expect(wide).toContain('↻ 3')
    expect(wide).not.toMatch(/tools|loops/) // a symbol and a number, no words
    expect(wide).toContain('▰▱▱▱▱') // 12 s of silence: one cell, no number below 30 s
    expect(wide).toContain('ProviderDisplay')
    expect(wide).toContain('…')
    // §9: activity, provider, loops, tools, tokens, cost, meter
    const columns = ['Bash', 'ProviderDisplay', '↻ 3', 'ƒ 12', '↑48.1k', '<$0.01', '▰▱▱▱▱']
    const firstGone = new Map<string, number>()
    // §10 floor for a long model: lead 2 + id 2 + code 5 + model (8 + 2) + Stop 9 + Show 8 + 5 gaps = 41
    for (let width = 200; width >= 41; width--) {
      await b.redraw(bandProps(width))
      const t = await drawingText(b)
      expect(t).toContain('a-long-') // the model shrinks but is never dropped
      for (const c of columns) {
        if (!t.includes(c) && !firstGone.has(c)) firstGone.set(c, width)
        if (firstGone.has(c)) expect(t).not.toContain(c)
      }
    }
    expect(firstGone.size).toBe(columns.length)
    for (let i = 1; i < columns.length; i++) expect(firstGone.get(columns[i - 1]!)!).toBeGreaterThan(firstGone.get(columns[i]!)!)
    await b.unmount()
  })

  test(`ext band: 120/59/40 fit one-line rows; 39 is header only; arming never reflows [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h)
    const b = await mountBand($, surface)
    for (const width of [120, 59, 40]) {
      await b.redraw(bandProps(width))
      const tree = await b.drawn()
      const rows = drawnRows(tree)
      expect(rows).toHaveLength(3)
      for (const r of rows) {
        expect(cells(r)).toBeLessThanOrEqual(width)
        if (width === 40) {
          // §10 floor: lead 2 + id 2 + code 5 + model (min(8, content: 7) + 2) + Stop 9 + Show 8 + 5 gaps
          expect(cells(r)).toBe(40)
          expect(textOf(r)).toContain(' RUN ')
          expect(textOf(r)).not.toMatch(/\d+s\b/) // the badge has dropped its runtime
          expect(textOf(r)).toMatch(/model-[abc]/) // the model is never dropped
          expect(textOf(r)).not.toMatch(/[▰▱]/) // the meter has gone
        }
        expect(textOf(r)).not.toContain('\n')
        for (const { node } of walk(r)) {
          if (node.type === 'Text') expect(node.props?.wrap).toBe('truncate-end')
          if (node.type === 'Box') expect(node.props?.flexWrap).not.toBe('wrap')
          if (node.type === 'Button') expect(node.props?.hotkey).toBeUndefined()
        }
      }
      expect(await b.findAll({ type: 'Button', text: /^\[ Stop \]$/ })).toHaveLength(3)
      expect(await b.findAll({ type: 'Button', text: /^\[ Show \]$/ })).toHaveLength(3)
    }
    await b.redraw(bandProps(120))
    const before = cells(await row(b, 'model-a'))
    await press(b, 'model-a', 'Stop')
    await b.redraw()
    expect(cells(await row(b, 'model-a'))).toBe(before)
    await b.redraw(bandProps(39)) // one cell below the floor
    expect(await drawingText(b)).toContain('◆ claudish')
    expect(await b.findAll({ type: 'Button' })).toHaveLength(0)
    for (const { node } of walk(await b.drawn())) if (node.type === 'Text') expect(node.props?.wrap).toBe('truncate-end')
    await b.unmount()
  })

  // §9: each state's code is a solid badge of its hue (dark palette in the kit)
  for (const [state, code, color, fill, reason] of [
    ['STARTING', 'NEW', DARK.ink, DARK.run, null], ['RUNNING', 'RUN', DARK.ink, DARK.run, null],
    ['AWAITING_INPUT', 'ASK', DARK.ink, DARK.ask, null], ['AWAITING_PERMISSION', 'ASK', DARK.ink, DARK.ask, null],
    ['COMPLETED', 'END', DARK.ink, DARK.done, null], ['FAILED', 'ERR', DARK.ink, DARK.fail, 'api_error'],
    ['TIMEOUT', 'TMO', DARK.ink, DARK.fail, 'timeout'], ['EMPTY', 'NIL', DARK.ink, DARK.fail, 'empty_output'],
    ['EMPTY', 'FMT', DARK.ink, DARK.format, 'shape_mismatch'],
    ['CANCELLED', 'STP', DARK.snow, DARK.stopped, 'cancelled'],
  ] as const) {
    test(`ext band: ${state} ${code} badge, colour, header group and stale-meter [${surface}]`, async ($, on) => {
      const h = harness(on)
      await start($, surface)
      const s = await delegate($, h)
      h.fake.set(s.id, s.id, state, reason)
      await h.clock.advance(POLL)
      const b = await mountBand($, surface)
      const r = await row(b, s.model)
      stateColor(r, code, color, fill)
      // §9: the runtime after it is plain text in the same hue, no fill
      const runtime = walk(r).map(x => x.node).find(n => n.type === 'Text' && /^\s+\d+s $/.test(textOf(n)))
      expect(runtime?.props?.color).toBe(fill)
      expect(runtime?.props?.backgroundColor).toBeUndefined()
      themeOnly(await b.drawn())
      const t = await drawingText(b)
      const terminal = ['COMPLETED', 'FAILED', 'TIMEOUT', 'EMPTY', 'CANCELLED'].includes(state)
      // only a RUNNING slot has a stale-meter
      if (state === 'RUNNING') expect(textOf(r)).toMatch(/[▰▱]{5}/)
      else expect(textOf(r)).not.toMatch(/[▰▱]/)
      if (terminal) expect(await b.findAll({ type: 'Button', text: /^\[ Stop \]$/ })).toHaveLength(0)
      if (code === 'FMT') {
        // a wrong-format answer is neither empty nor failed, and the activity does not repeat the reason
        expect(t).toContain('1 wrong format')
        expect(t).not.toContain('failed')
        expect(textOf(r)).not.toContain('shape_mismatch')
        const group = walk(await b.drawn()).map(x => x.node).find(n => n.type === 'Text' && textOf(n) === ' · 1 wrong format')
        expect(group?.props?.color).toBe('warning')
      } else if (state.startsWith('AWAITING')) {
        expect(textOf(r)).toContain('▌')
        expect(t).toContain('1 needs you')
      } else if (state === 'COMPLETED') expect(t).toContain('1 done')
      else if (state === 'CANCELLED') expect(t).toContain('1 stopped')
      else if (terminal) expect(t).toContain('1 failed')
      else expect(t).toContain('1 running')
      await b.unmount()
    })
  }

  test(`ext band: null metrics stay unknown, native provider is separate, the meter fills its last cell at 120s [${surface}]`, async ($, on) => {
    let quiet = false
    const h = harness(on, { rowPatch: r => ({ ...r, provider: 'Anthropic (native)', tokens_in: null, tokens_out: null, idle_seconds: quiet ? 120 : 119, activity: 'thinking' }) })
    await start($, surface)
    const s = await delegate($, h)
    const b = await mountBand($, surface)
    const r = await row(b, s.model)
    expect(textOf(r)).toContain('—')
    expect(textOf(r)).not.toContain('null')
    expect(textOf(r)).not.toContain('0/0')
    expect(textOf(r)).toContain('▰▰▰▰▱ 1m') // 119 s: four cells, warning
    expect(walk(r).map(x => x.node).find(n => n.type === 'Text' && textOf(n) === '▰▰▰▰▱')?.props?.color).toBe('warning')
    const texts = walk(r).filter(x => x.node.type === 'Text').map(x => x.node)
    // §10: the provider is the model badge's quiet half, its own Text, padded
    const provider = texts.find(n => textOf(n) === ' Anthropic (native) ')
    expect(provider).toBeDefined()
    expect(provider?.props).toMatchObject({ color: DARK.snow, backgroundColor: DARK.modelQuiet })
    expect(textOf(provider)).not.toContain(s.model)
    quiet = true
    await h.clock.advance(POLL)
    await b.redraw()
    expect(textOf(await row(b, s.model))).toContain('▰▰▰▰▰ 2m')
    const idle = walk(await row(b, s.model)).map(x => x.node).find(n => n.type === 'Text' && textOf(n) === '▰▰▰▰▰')
    expect(idle).toBeDefined()
    expect(idle?.props?.color).toBe('error')
    await b.unmount()
  })

  test(`ext band: attention first, then live, then recent terminal; height folds only terminal [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'review', ['ended-early', 'ended-late', 'still-live'])
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    h.fake.set(r.runId, '02', 'FAILED', 'blocked')
    await h.clock.advance(POLL)
    await modelCall($, 'mcp__plugin_claudish_claudish__create_session', { model: 'needs-person' })
    await h.clock.advance(POLL)
    const b = await mountBand($, surface, bandProps(200, 20))
    const t = await drawingText(b)
    expect(t.indexOf('needs-person')).toBeLessThan(t.indexOf('still-live'))
    expect(t.indexOf('still-live')).toBeLessThan(t.indexOf('ended-late'))
    expect(t.indexOf('ended-late')).toBeLessThan(t.indexOf('ended-early'))
    await b.redraw(bandProps(200, 4))
    const folded = await drawingText(b)
    expect(folded).toContain('needs-person')
    expect(folded).toContain('still-live')
    expect(folded).toMatch(/\+2 more:/)
    expect(folded).toContain('1 done')
    expect(folded).toContain('1 failed')
    expect(folded).not.toContain('ended-early')
    expect(folded).not.toContain('ended-late')
    await h.clock.advance(POLL)
    await b.unmount()
  })
}
