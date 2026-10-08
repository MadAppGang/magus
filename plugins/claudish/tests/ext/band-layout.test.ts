import { test, expect } from 'claude-code/testing'
import { ENGINE_DRAWING, harness, start } from '../fake-claudish'
import { bandProps, mountBand, SURFACES, walk, type Node } from '../ui'
import { POLL, GRACE, children, delegate, drawingText, modelCall, press, row, stateColor, team, textOf, themeOnly } from './support'

// A small independent cell measurer for this suite's ASCII fixture and one-cell glyphs.
// This measures the DRAWN description, not the implementation's fitColumns result.
function cells(n: unknown): number {
  if (typeof n === 'string' || typeof n === 'number') return Array.from(String(n)).filter(c => c !== '️').length
  if (!n || typeof n !== 'object') return 0
  const node = n as Node
  const p = node.props ?? {}
  if (node.type === 'Button') return cells(p.label) + (p.plain ? 0 : 4)
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
    && /[▶◌◇✓✕■?]/.test(textOf(n))
    && walk(n).filter(x => x.node.type === 'Button' && x.node.props?.label === 'Show').length === 1)
  return boxes.filter(n => !children(n).some(c => boxes.includes(c as Node)))
}

for (const surface of SURFACES) {
  test(`ext band: no runs and surveys yield exactly to the engine [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const empty = await mountBand($, surface)
    expect(await empty.drawn()).toEqual(ENGINE_DRAWING)
    await empty.unmount()
    await team($, h)
    const b = await mountBand($, surface, bandProps(140, 20, true))
    expect(await b.drawn()).toEqual(ENGINE_DRAWING)
    await b.redraw(bandProps(140, 20, false))
    expect(await drawingText(b)).toContain('◆ claudish')
    expect(await b.findAll({ type: 'Button', text: /^Show$/ })).toHaveLength(3)
    const heading = walk(await b.drawn()).map(x => x.node).find(n => n.type === 'Text' && textOf(n) === '◆ claudish')
    expect(heading?.props?.color).toBe('claude')
    expect(heading?.props?.bold).toBe(true)
    await b.unmount()
  })

  test(`ext band: shrinking width drops activity, tokens, tools, provider, loops in order [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, provider: 'ProviderDisplay', tokens_in: 48_100, tokens_out: 2_300, tool_calls: 12, turns_completed: 3, idle_seconds: 12, activity: 'Bash' }) })
    await start($, surface)
    await team($, h, 'review', ['a-long-requested-model-id-0123456789'])
    const b = await mountBand($, surface, bandProps(200))
    const wide = await drawingText(b)
    expect(wide).toContain('48.1k/2.3k')
    expect(wide).toContain('12 tools')
    expect(wide).toContain('3 loops')
    expect(wide).toContain('idle 12s')
    expect(wide).toContain('ProviderDisplay')
    expect(wide).toContain('…')
    const columns = ['Bash', '48.1k/2.3k', '12 tools', 'ProviderDisplay', '3 loops']
    const firstGone = new Map<string, number>()
    for (let width = 200; width >= 29; width--) {
      await b.redraw(bandProps(width))
      const t = await drawingText(b)
      for (const c of columns) {
        if (!t.includes(c) && !firstGone.has(c)) firstGone.set(c, width)
        if (firstGone.has(c)) expect(t).not.toContain(c)
      }
    }
    expect(firstGone.size).toBe(columns.length)
    for (let i = 1; i < columns.length; i++) expect(firstGone.get(columns[i - 1]!)!).toBeGreaterThan(firstGone.get(columns[i]!)!)
    await b.unmount()
  })

  test(`ext band: 120/59/40/29 fit one-line rows; 20 is header only; arming never reflows [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h)
    const b = await mountBand($, surface)
    for (const width of [120, 59, 40, 29]) {
      await b.redraw(bandProps(width))
      const tree = await b.drawn()
      const rows = drawnRows(tree)
      expect(rows).toHaveLength(3)
      for (const r of rows) {
        expect(cells(r)).toBeLessThanOrEqual(width)
        if (width === 29) {
          expect(cells(r)).toBe(29)
          expect(textOf(r)).toContain('▶')
          expect(textOf(r)).not.toContain('running')
          expect(textOf(r)).not.toContain('model-')
          expect(textOf(r)).not.toContain('idle')
        }
        expect(textOf(r)).not.toContain('\n')
        for (const { node } of walk(r)) {
          if (node.type === 'Text') expect(node.props?.wrap).toBe('truncate-end')
          if (node.type === 'Box') expect(node.props?.flexWrap).not.toBe('wrap')
          if (node.type === 'Button') expect(node.props?.hotkey).toBeUndefined()
        }
      }
      expect(await b.findAll({ type: 'Button', text: /^Stop$/ })).toHaveLength(3)
      expect(await b.findAll({ type: 'Button', text: /^Show$/ })).toHaveLength(3)
    }
    await b.redraw(bandProps(120))
    const before = cells(await row(b, 'model-a'))
    await press(b, 'model-a', 'Stop')
    await b.redraw()
    expect(cells(await row(b, 'model-a'))).toBe(before)
    await b.redraw(bandProps(20))
    expect(await drawingText(b)).toContain('◆ claudish')
    expect(await b.findAll({ type: 'Button' })).toHaveLength(0)
    for (const { node } of walk(await b.drawn())) if (node.type === 'Text') expect(node.props?.wrap).toBe('truncate-end')
    await b.unmount()
  })

  for (const [state, label, color, reason] of [
    ['STARTING', '◌ starting', 'warning', null], ['RUNNING', '▶ running', 'warning', null],
    ['AWAITING_INPUT', '◇ input', 'permission', null], ['AWAITING_PERMISSION', '◇ permit', 'permission', null],
    ['COMPLETED', '✓ done', 'success', null], ['FAILED', '✕ failed', 'error', 'api_error'],
    ['TIMEOUT', '✕ timeout', 'error', 'timeout'], ['EMPTY', '✕ empty', 'error', 'empty_output'],
    ['CANCELLED', '■ stopped', 'inactive', 'cancelled'],
  ] as const) {
    test(`ext band: ${state} glyph, colour, header group and terminal idle [${surface}]`, async ($, on) => {
      const h = harness(on)
      await start($, surface)
      const s = await delegate($, h)
      h.fake.set(s.id, s.id, state, reason)
      await h.clock.advance(POLL)
      const b = await mountBand($, surface)
      const r = await row(b, s.model)
      stateColor(r, label, color)
      themeOnly(await b.drawn())
      const t = await drawingText(b)
      const terminal = ['COMPLETED', 'FAILED', 'TIMEOUT', 'EMPTY', 'CANCELLED'].includes(state)
      if (terminal) {
        expect(textOf(r)).not.toContain('idle ')
        expect(await b.findAll({ type: 'Button', text: /^Stop$/ })).toHaveLength(0)
      }
      if (state.startsWith('AWAITING')) {
        expect(textOf(r)).toContain('▌')
        expect(t).toContain('1 needs you')
      } else if (state === 'COMPLETED') expect(t).toContain('1 done')
      else if (state === 'CANCELLED') expect(t).toContain('1 stopped')
      else if (terminal) expect(t).toContain('1 failed')
      else expect(t).toContain('1 running')
      await b.unmount()
    })
  }

  test(`ext band: null metrics stay unknown, native provider is separate, quiet threshold is 120s [${surface}]`, async ($, on) => {
    let quiet = false
    const h = harness(on, { rowPatch: r => ({ ...r, provider: 'Anthropic (native)', tokens_in: null, tokens_out: null, idle_seconds: quiet ? 120 : 119, activity: 'thinking' }) })
    await start($, surface)
    const s = await delegate($, h)
    const b = await mountBand($, surface)
    const r = await row(b, s.model)
    expect(textOf(r)).toContain('—')
    expect(textOf(r)).not.toContain('null')
    expect(textOf(r)).not.toContain('0/0')
    expect(textOf(r)).not.toContain('⚠')
    const texts = walk(r).filter(x => x.node.type === 'Text').map(x => x.node)
    const provider = texts.find(n => textOf(n).includes('Anthropic (native)'))
    expect(provider).toBeDefined()
    expect(provider?.props?.dimColor).toBe(true)
    expect(textOf(provider)).not.toContain(s.model)
    quiet = true
    await h.clock.advance(POLL)
    await b.redraw()
    const idle = walk(await row(b, s.model)).map(x => x.node).find(n => n.type === 'Text' && textOf(n).includes('⚠'))
    expect(idle).toBeDefined()
    expect(idle?.props?.color).toBe('warning')
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
    await h.clock.advance(GRACE + POLL)
    await b.unmount()
  })
}
