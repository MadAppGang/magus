// Spec §9 (Revision R4), written from the spec text only: the madbench palette and how it follows
// the theme, the split tokens badge and the value colours, the cost column, the model that is never
// dropped, Hide that puts the panel away, and tabs that belong to the current run(s).
// No implementation import: every expected hex is worked from the §9 table and formulas.

import { test, expect } from 'claude-code/testing'
import { harness, start, type FakeOptions } from '../fake-claudish'
import { bandProps, mountBand, SURFACES, walk } from '../ui'
import { POLL, team } from './support'
import { DARK, bandRow, chips, expectInk, inkOf, keyOf, pressChip, rowByShow, visibleText } from './v2-support'

/** §9/§10, the light palette: solid = hue fill with the better-contrast ink; quiet = 82 % toward white, text 38 % toward black. */
const LIGHT = {
  run: '#1D4ED8', snow: '#FFFFFF',
  model: '#4338CA', modelQuietText: '#2A237D', modelQuietFill: '#DDDBF5', // §10: indigo
  // §10 "Tokens, FINAL": two fixed inks, in #CDFFD3 and out #95FFA6, both written in #0B0B12
  tokensIn: '#CDFFD3', tokensOut: '#95FFA6', tokensText: '#0B0B12',
  tools: '#0D9488', loops: '#7C3AED', cost: '#A16207',
} as const

const codeInk = async (b: Awaited<ReturnType<typeof mountBand>>, model: string) => {
  const node = walk(await bandRow(b, model)).map(x => x.node).find(n => n.type === 'Text' && visibleText(n) === ' RUN ')
  return { color: node?.props?.color, backgroundColor: node?.props?.backgroundColor }
}

for (const surface of SURFACES) {
  // ── colours ────────────────────────────────────────────────────────────────

  test(`v2 §9/§10: tokens are one split badge on the two fixed tokens inks, both regular; tools and loops are bold text in their hues [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, tokens_in: 12_700, tokens_out: 780, tool_calls: 8, turns_completed: 1, cost_usd: 0.42 }) })
    await start($, surface)
    await team($, h, 'values', ['value-model'])
    const b = await mountBand($, surface, bandProps(200))
    const row = await bandRow(b, 'value-model')
    const text = visibleText(row)
    // each half padded one space either side
    expect(text).toContain(' ↑12.7k  ↓780 ')
    expectInk(row, ' ↑12.7k ', { color: DARK.snow, backgroundColor: DARK.tokensIn })
    expectInk(row, ' ↓780 ', { color: DARK.snow, backgroundColor: DARK.tokensOut })
    for (const ink of [...inkOf(row, ' ↑12.7k '), ...inkOf(row, ' ↓780 ')]) expect(ink.bold).not.toBe(true) // both regular
    expectInk(row, 'ƒ 8', { color: DARK.tools, bold: true, backgroundColor: undefined })
    expectInk(row, '↻ 1', { color: DARK.loops, bold: true, backgroundColor: undefined })
    expect(text).not.toMatch(/tools?|loops?/)
    await b.unmount()
  })

  for (const [name, options, light] of [
    ['a light theme', { theme: 'light' }, true],
    ['a light-daltonized theme', { theme: 'light-daltonized' }, true],
    ['a dark theme', { theme: 'dark-ansi', env: { TERM_THEME: 'light' } }, false],
    ['auto with TERM_THEME=light', { theme: 'auto', env: { TERM_THEME: 'light' } }, true],
    ['auto with TERM_THEME=dark over a light COLORFGBG', { theme: 'auto', env: { TERM_THEME: 'dark', COLORFGBG: '0;15' } }, false],
    ['auto with COLORFGBG 0;15', { theme: 'auto', env: { COLORFGBG: '0;15' } }, true],
    ['auto with COLORFGBG 0;7', { theme: 'auto', env: { COLORFGBG: '0;7' } }, true],
    ['auto with COLORFGBG 15;0', { theme: 'auto', env: { COLORFGBG: '15;0' } }, false],
    ['auto with nothing to go on', { theme: 'auto' }, false],
  ] as [string, FakeOptions, boolean][]) {
    test(`v2 §9: ${name} draws the ${light ? 'light' : 'dark'} palette [${surface}]`, async ($, on) => {
      const h = harness(on, { ...options, rowPatch: r => ({ ...r, tokens_in: 12_700, tokens_out: 780 }) })
      await start($, surface)
      await team($, h, 'palette', ['palette-model'])
      const b = await mountBand($, surface, bandProps(200))
      const row = await bandRow(b, 'palette-model')
      if (light) {
        expect(await codeInk(b, 'palette-model')).toEqual({ color: LIGHT.snow, backgroundColor: LIGHT.run })
        expectInk(row, ' ↑12.7k ', { color: LIGHT.tokensText, backgroundColor: LIGHT.tokensIn })
        expectInk(row, ' ↓780 ', { color: LIGHT.tokensText, backgroundColor: LIGHT.tokensOut })
        expectInk(row, ' palette-model ', { color: LIGHT.snow, backgroundColor: LIGHT.model, bold: true })
        expectInk(row, ' OpenRouter ', { color: LIGHT.modelQuietText, backgroundColor: LIGHT.modelQuietFill })
      } else {
        expect(await codeInk(b, 'palette-model')).toEqual({ color: DARK.ink, backgroundColor: DARK.run })
        expectInk(row, ' ↑12.7k ', { color: DARK.snow, backgroundColor: DARK.tokensIn })
        expectInk(row, ' ↓780 ', { color: DARK.snow, backgroundColor: DARK.tokensOut })
        expectInk(row, ' palette-model ', { color: DARK.snow, backgroundColor: DARK.model, bold: true })
        expectInk(row, ' OpenRouter ', { color: DARK.snow, backgroundColor: DARK.modelQuiet })
      }
      await b.unmount()
    })
  }

  test(`v2 §9: the theme is read again at every turn end [${surface}]`, async ($, on) => {
    const options: FakeOptions = { theme: 'dark' }
    const h = harness(on, options)
    await start($, surface)
    await team($, h, 'retheme', ['theme-model'])
    const b = await mountBand($, surface, bandProps(200))
    expect(await codeInk(b, 'theme-model')).toEqual({ color: DARK.ink, backgroundColor: DARK.run })
    options.theme = 'light' // the person switches theme
    await $.turn.complete({ turnId: 't-1', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' })
    await h.clock.settle()
    await b.redraw()
    expect(await codeInk(b, 'theme-model')).toEqual({ color: LIGHT.snow, backgroundColor: LIGHT.run })
    await b.unmount()
  })

  // ── cost ───────────────────────────────────────────────────────────────────

  test(`v2 §9: cost reads <$0.01, $x.xx, $xx.x, $xxx in the cost hue, bold; — when claudish reports none [${surface}]`, async ($, on) => {
    const costs: Record<string, number | null> = { '01': 0.004, '02': 0.42, '03': 12.34, '04': 123.4, '05': null }
    const h = harness(on, { rowPatch: r => ({ ...r, cost_usd: costs[String(r.slot)] ?? null }) })
    await start($, surface)
    await team($, h, 'costs', ['cost-a', 'cost-b', 'cost-c', 'cost-d', 'cost-e'])
    const b = await mountBand($, surface, bandProps(200))
    for (const [model, shown] of [['cost-a', '<$0.01'], ['cost-b', '$0.42'], ['cost-c', '$12.3'], ['cost-d', '$123']] as const) {
      const row = await bandRow(b, model)
      expect(visibleText(row), `${model} cost`).toContain(shown)
      // the column is right-aligned (spec §9 fixes the text, not the padding): compare the cell trimmed
      expect(walk(row).map(x => x.node).filter(n => n.type === 'Text').map(n => visibleText(n).trim()), `${model} cost cell`).toContain(shown)
      expectInk(row, shown, { color: DARK.cost, bold: true, backgroundColor: undefined })
    }
    const noneRow = await bandRow(b, 'cost-e')
    expect(walk(noneRow).map(x => x.node).filter(n => n.type === 'Text').map(n => visibleText(n).trim())).toContain('—')
    expect(visibleText(noneRow)).not.toMatch(/\$|NaN|null/)
    await b.unmount()
  })

  // ── the model is never dropped ─────────────────────────────────────────────

  test(`v2 §9/§10: narrowing never drops the model; at the floor it reads 8 cells of text (10 padded); one cell below, the header draws alone [${surface}]`, async ($, on) => {
    const model = 'never-dropped-model-name'
    const h = harness(on)
    await start($, surface)
    await team($, h, 'keep-model', [model])
    const b = await mountBand($, surface, bandProps(200))
    const showKey = keyOf(chips(await bandRow(b, model), 'Show')[0]!)
    // §10 floor = lead 2 + id 2 + code 5 + model (min(8, content) + 2 padding) + Stop 9 + Show 8 + 5 gaps
    const floor = 2 + 2 + 5 + (8 + 2) + 9 + 8 + 5
    for (let width = 200; width >= floor; width -= 1) {
      await b.redraw(bandProps(width))
      const text = visibleText(await rowByShow(b, showKey))
      expect(text, `@${width}`).toContain('never-d')
    }
    await b.redraw(bandProps(floor))
    const row = await rowByShow(b, showKey)
    const cells = walk(row).map(x => x.node).filter(n => n.type === 'Text').map(visibleText)
    expect(cells).toContain(' never-d… ') // §10: the model badge's half, 8 cells of text padded one space either side
    expect(cells.some(t => t.includes('never-dr'))).toBe(false)
    expect(chips(row, 'Stop')).toHaveLength(1)
    expect(chips(row, 'Show')).toHaveLength(1)
    await b.redraw(bandProps(floor - 1))
    expect(chips(await b.drawn())).toHaveLength(0)
    expect(visibleText(await b.drawn())).toContain('◆ claudish')
    expect(visibleText(await b.drawn())).not.toContain('never-d')
    await b.unmount()
  })

  // ── Hide puts the panel away; Show brings it back ──────────────────────────

  test(`v2 §9: after Hide, the next Show on any row reopens every hidden tab, the pressed tab last and in front; views kept, the list emptied [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'panel', ['p-one', 'p-two', 'p-three'])
    const b = await mountBand($, surface, bandProps(200))
    await pressChip(b, 'p-one', 'Show')
    await pressChip(b, 'p-two', 'Show')
    const [one, two] = [h.opens[0]!.id, h.opens[1]!.id]
    await b.redraw()
    await pressChip(b, 'p-two', 'Hide')
    expect([...h.closes].sort()).toEqual([one, two].sort())
    expect(h.panes).toHaveLength(0)
    const hidden = (h.state.get('hiddenTabs') ?? []) as { id: string; title: string }[]
    expect(hidden.map(t => t.id).sort()).toEqual([one, two].sort())
    expect(hidden.find(t => t.id === one)?.title).toBe('p-one')
    expect(hidden.find(t => t.id === two)?.title).toBe('p-two')
    expect(h.state.get(`panes/${one}`)).toMatchObject({ slot: '01' })
    expect(h.state.get(`panes/${two}`)).toMatchObject({ slot: '02' })
    // Show on a third row, whose tab was never open
    await b.redraw()
    const opens = h.opens.length
    const calls = h.uiCalls.length
    await pressChip(b, 'p-three', 'Show')
    const three = h.opens[h.opens.length - 1]!.id
    expect(three).not.toBe(one)
    expect(three).not.toBe(two)
    // every open made before anything else, the hidden tabs first and the pressed one last
    expect(h.uiCalls.slice(calls, calls + 3)).toEqual(['open', 'open', 'open'])
    const reopened = h.opens.slice(opens, opens + 3)
    expect(reopened.slice(0, 2).map(o => o.id).sort()).toEqual([one, two].sort())
    expect(reopened[2]!.id).toBe(three)
    expect(reopened.slice(0, 2).map(o => o.title).sort()).toEqual(['p-one', 'p-two'])
    expect(h.panes).toHaveLength(3)
    expect(h.panes.find(p => p.id === three)?.isShown).toBe(true)
    expect(h.state.get('hiddenTabs')).toEqual([])
    await b.redraw()
    for (const model of ['p-one', 'p-two', 'p-three']) expect(chips(await bandRow(b, model), 'Hide'), model).toHaveLength(1)
    await b.unmount()
  })

  test(`v2 §9: a tab Hide closed keeps its view, so the Show that restores it does not start it over [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'keep-view', ['k-model'])
    const b = await mountBand($, surface, bandProps(200))
    await pressChip(b, 'k-model', 'Show')
    const tab = h.opens[0]!.id
    await h.clock.advance(POLL)
    const before = h.state.get(`panes/${tab}`) as { status: string; frame: unknown } | null
    expect(before?.status).toBe('live')
    expect(before?.frame).not.toBeNull()
    await b.redraw()
    await pressChip(b, 'k-model', 'Hide')
    expect(h.state.get(`panes/${tab}`)).toMatchObject({ status: 'live' }) // kept through the plugin's own close
    await b.redraw()
    const writes = h.writes.length
    await pressChip(b, 'k-model', 'Show')
    expect(h.panes.map(p => p.id)).toEqual([tab])
    const restarted = h.writes.slice(writes).filter(([k, v]) => k === `panes/${tab}` && (v as { status?: string } | null)?.status === 'waiting')
    expect(restarted).toHaveLength(0) // never seeded waiting again: its view was there
    await b.unmount()
  })

  // ── tabs belong to the current run(s) ──────────────────────────────────────

  test(`v2 §9: a tab of a run the band no longer draws is closed on the next tick, its view cleared [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const a = await team($, h, 'run-a', ['a-model'])
    const b = await mountBand($, surface, bandProps(200))
    await pressChip(b, 'a-model', 'Show')
    const tab = h.opens[0]!.id
    h.fake.set(a.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL * 2)
    // settled but still the most recent run: drawn, so its tab stays
    expect(h.closes).not.toContain(tab)
    expect(h.panes.map(p => p.id)).toEqual([tab])
    await team($, h, 'run-b', ['b-model']) // a newer run: run-a, settled, leaves the band
    await h.clock.advance(POLL)
    expect(visibleText(await b.drawn())).not.toContain('a-model')
    expect(h.closes).toContain(tab)
    expect(h.panes.map(p => p.id)).not.toContain(tab)
    expect(h.state.get(`panes/${tab}`) ?? null).toBeNull()
    await b.unmount()
  })

  test(`v2 §9: a hidden tab of a run that left the band is dropped from the list; the next Show reopens only current tabs [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const a = await team($, h, 'run-a', ['a-model'])
    const b = await mountBand($, surface, bandProps(200))
    await pressChip(b, 'a-model', 'Show')
    const tab = h.opens[0]!.id
    await b.redraw()
    await pressChip(b, 'a-model', 'Hide')
    expect(((h.state.get('hiddenTabs') ?? []) as { id: string }[]).map(t => t.id)).toEqual([tab])
    h.fake.set(a.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    await team($, h, 'run-b', ['b-model'])
    await h.clock.advance(POLL)
    expect(h.state.get('hiddenTabs')).toEqual([])
    expect(h.state.get(`panes/${tab}`) ?? null).toBeNull()
    await b.redraw()
    const opens = h.opens.length
    await pressChip(b, 'b-model', 'Show')
    expect(h.opens.slice(opens).map(o => o.id)).not.toContain(tab)
    expect(h.panes.map(p => p.id)).not.toContain(tab)
    expect(h.panes).toHaveLength(1)
    await b.unmount()
  })

  // ── unknown tokens (R3, which R4 leaves in force) ──────────────────────────

  test(`v2 §8/§9: tokens with both values unknown read — alone; one unknown reads ↑— ↓780 [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => (r.slot === '01' ? { ...r, tokens_in: null, tokens_out: null } : { ...r, tokens_in: null, tokens_out: 780 }) })
    await start($, surface)
    await team($, h, 'unknown-tokens', ['none-known', 'one-known'])
    const b = await mountBand($, surface, bandProps(200))
    const noneRow = await bandRow(b, 'none-known')
    expect(visibleText(noneRow)).not.toMatch(/[↑↓]/)
    // the tokens cell reads — alone (the cost cell is — too: the fake reports no cost)
    expect(walk(noneRow).map(x => x.node).filter(n => n.type === 'Text').map(visibleText).filter(t => t.trim() === '—').length).toBeGreaterThanOrEqual(2)
    const one = visibleText(await bandRow(b, 'one-known'))
    expect(one).toMatch(/↑—\s+↓780/)
    await b.unmount()
  })
}
