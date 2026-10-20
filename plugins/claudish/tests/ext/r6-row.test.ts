// Spec R6.2 (the row, left to right) and R6.6 (colours), drawn through the plugin on both surfaces.
// Written from spec.md only: the block with no gap inside, one space each side of every part, the
// marks with no space before their number, the quiet inks, the filled Show of the shown tab, no Hide
// on any row, and a Stop column only while some row can be stopped.

import { test, expect } from 'claude-code/testing'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, walk, type Node } from '../ui'
import { DARK, POLL, QUIET_DARK, children, team, themeOnly } from './support'
import { bandRow, chip, chips, expectInk, expectInkOneOf, inkOf, pressChip, visibleText } from './v2-support'
import {
  SHOW_PANE, TIMELINE_DARK, TIMELINE_LIGHT, TIMELINE_ONLY_DARK, drawnRows, runIds, runsOf, timeline, timelineKey,
} from './r6-support'

for (const surface of SURFACES) {
  test(`R6.2: the block — model, provider, tokens, tool calls, loops and cost touch with no gap, one space each side of each part [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, provider: 'OpenRouter', tokens_in: 5_500, tokens_out: 300, tool_calls: 8, turns_completed: 1, cost_usd: 0.42 }) })
    await start($, surface)
    await team($, h, 'block', ['value-model'])
    const b = await mountBand($, surface, bandProps(160))
    const row = await bandRow(b, 'value-model')
    const block = ' value-model  OpenRouter  ↑5.5k  ↓300  ƒ8  ↻1  $0.42 '
    expect(visibleText(row)).toContain(block)
    // ONE top-level part: some element draws exactly the block, and nothing inside it adds a gap
    const exact = walk(row).map(x => x.node).filter(n => visibleText(n) === block)
    expect(exact.length, 'an element that is exactly the block').toBeGreaterThan(0)
    for (const holder of exact.slice(0, 1)) {
      for (const { node } of walk(holder)) {
        if (node.type !== 'Box') continue
        expect(Number(node.props?.gap ?? 0), 'no gap inside the block').toBe(0)
        expect(Number(node.props?.columnGap ?? 0), 'no column gap inside the block').toBe(0)
        for (const c of children(node)) {
          const p = (c as Node | undefined)?.props ?? {}
          for (const m of ['margin', 'marginX', 'marginLeft', 'marginRight']) expect(Number(p[m] ?? 0), `no ${m} inside the block`).toBe(0)
        }
      }
    }
    // the in and out halves are two adjacent Text runs (found by text and ink: a Text's key is not observable)
    const runs = runsOf(row)
    const inRun = runs.findIndex(r => r.text.includes('↑5.5k'))
    expect(inRun).toBeGreaterThanOrEqual(0)
    const after = runs.slice(inRun + 1).find(r => r.text.length > 0)
    expect(after?.text.trimStart().startsWith('↓300'), 'the out half follows the in half directly').toBe(true)
    // inks
    expectInk(row, ' value-model ', { color: DARK.snow, backgroundColor: DARK.model, bold: true })
    expectInk(row, ' OpenRouter ', { color: DARK.snow, backgroundColor: DARK.modelQuiet, bold: true })
    expectInk(row, ' ↑5.5k ', { color: DARK.snow, backgroundColor: DARK.tokensIn })
    expectInk(row, ' ↓300 ', { color: DARK.snow, backgroundColor: DARK.tokensOut })
    for (const ink of [...inkOf(row, ' ↑5.5k '), ...inkOf(row, ' ↓300 ')]) expect(ink.bold).not.toBe(true) // regular weight
    for (const [part, quiet] of [[' ƒ8 ', QUIET_DARK.tools], [' ↻1 ', QUIET_DARK.loops], [' $0.42 ', QUIET_DARK.cost]] as const) {
      expectInk(row, part, { color: DARK.snow, bold: true })
      expectInkOneOf(row, part, 'backgroundColor', quiet)
    }
    // the marks touch their numbers; no word in the block
    const t = visibleText(row)
    expect(t).not.toMatch(/ƒ \d|↻ \d/)
    expect(t.replace('value-model', '')).not.toMatch(/tools?|loops?|tokens/)
    // the badge: the code solid and bold, the runtime in the hue, no fill, not bold, right-aligned in 7
    expectInk(row, ' RUN ', { color: DARK.ink, backgroundColor: DARK.run, bold: true })
    const at = t.indexOf(' RUN ') + 5
    const runtime = t.slice(at, at + 7)
    expect(runtime).toMatch(/^ *\d+s $/)
    for (const ink of inkOf(row, runtime)) {
      expect(ink.color).toBe(DARK.run)
      expect(ink.backgroundColor).toBeUndefined()
      expect(ink.bold).not.toBe(true)
    }
    await b.unmount()
  })

  test(`R6.2: unknown values — tokens one ' — ' part on the in ink and no out part; ƒ— and ↻— [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, provider: 'OpenRouter', tokens_in: null, tokens_out: null, tool_calls: null, turns_completed: null, cost_usd: null }) })
    await start($, surface)
    await team($, h, 'unknowns', ['none-model'])
    const b = await mountBand($, surface, bandProps(160))
    const row = await bandRow(b, 'none-model')
    expect(visibleText(row)).toContain(' none-model  OpenRouter  —  ƒ—  ↻—  — ')
    expect(visibleText(row)).not.toMatch(/[↑↓]|null|NaN/)
    // tokens come first in the block, so the first ' — ' is the tokens part; the cost's comes last
    expectInk(row, ' — ', { backgroundColor: DARK.tokensIn })
    // no out part: nothing in the row is drawn on the out ink
    for (const r of runsOf(row)) expect(String(r.backgroundColor).toUpperCase()).not.toBe(DARK.tokensOut)
    expect(runsOf(row).filter(r => String(r.backgroundColor).toUpperCase() === DARK.tokensIn).map(r => r.text).join('')).toBe(' — ')
    expectInkOneOf(row, ' ƒ— ', 'backgroundColor', QUIET_DARK.tools)
    expectInkOneOf(row, ' ↻— ', 'backgroundColor', QUIET_DARK.loops)
    await b.unmount()
  })

  test(`R6.2: Show always reads Show; the shown tab's row is filled (inverseText on ide), the others plain ide; no row ever reads Hide [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'shows', ['p-one', 'p-two', 'p-three'])
    const b = await mountBand($, surface, bandProps(160))
    for (const model of ['p-one', 'p-two', 'p-three']) {
      expectInk(await chip(b, model, 'Show'), '[ Show ]', { color: 'ide', bold: true, backgroundColor: undefined })
    }
    await pressChip(b, 'p-two', 'Show')
    await b.redraw()
    const shown = await chip(b, 'p-two', 'Show')
    expect(shown.props?.label).toBe('Show')
    expectInk(shown, '[ Show ]', { color: 'inverseText', backgroundColor: 'ide', bold: true })
    for (const model of ['p-one', 'p-three']) {
      expectInk(await chip(b, model, 'Show'), '[ Show ]', { color: 'ide', bold: true, backgroundColor: undefined })
    }
    // the filled look follows the shown tab
    await pressChip(b, 'p-one', 'Show')
    await b.redraw()
    expectInk(await chip(b, 'p-one', 'Show'), '[ Show ]', { color: 'inverseText', backgroundColor: 'ide', bold: true })
    expectInk(await chip(b, 'p-two', 'Show'), '[ Show ]', { color: 'ide', bold: true, backgroundColor: undefined })
    // negative: Hide lives in the header now, never in a row
    const rows = drawnRows(await b.drawn())
    expect(rows).toHaveLength(3)
    for (const r of rows) {
      expect(chips(r, 'Hide')).toHaveLength(0)
      expect(walk(r).some(x => x.node.type === 'Button' && x.node.props?.label === 'Hide')).toBe(false)
    }
    await b.unmount()
  })

  test(`R6.2: the Stop column exists only while some row can be stopped; its 9 cells and gap go to the live cell [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, tokens_in: 5_500, tokens_out: 300, tool_calls: 8, turns_completed: 1, cost_usd: 0.42 }) })
    await start($, surface)
    const r = await team($, h, 'stop-col', ['stop-model'])
    const key = timelineKey(runIds(h)[0]!, '01')
    const b = await mountBand($, surface, bandProps(140))
    const live = await bandRow(b, 'stop-model')
    expect(chips(live, 'Stop')).toHaveLength(1)
    const before = (await timeline(b, key)).props.width
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    await b.redraw()
    const ended = await bandRow(b, 'stop-model')
    expect(chips(ended, 'Stop')).toHaveLength(0)
    expect(walk(await b.drawn()).some(x => x.node.type === 'Button' && /^Stop\??$/.test(String(x.node.props?.label)))).toBe(false)
    // no empty 9-cell Stop box left behind
    expect(walk(ended).some(x => x.node.type === 'Box' && x.node.props?.width === 9)).toBe(false)
    expect((await timeline(b, key)).props.width).toBe(before + 10)
    await b.unmount()
  })

  test(`R6.2: a feed that does not offer cancel draws no Stop column at all [${surface}]`, async ($, on) => {
    const h = harness(on, { noCancel: true })
    await start($, surface)
    await team($, h, 'no-cancel', ['nc-one', 'nc-two'])
    const b = await mountBand($, surface, bandProps(140))
    for (const r of drawnRows(await b.drawn())) {
      expect(walk(r).some(x => x.node.type === 'Button' && /^Stop\??$/.test(String(x.node.props?.label)))).toBe(false)
      expect(walk(r).some(x => x.node.type === 'Box' && x.node.props?.width === 9)).toBe(false)
    }
    await b.unmount()
  })

  test(`R6.6 R8.2 REQ-9 REQ-10: the band and the Show panel use only the allowed theme keys and palette colours; timeline colours only inside the Clients [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'colours', ['co-one', 'co-two', 'co-three', 'co-four'])
    h.fake.set(r.runId, '02', 'COMPLETED')
    h.fake.set(r.runId, '03', 'FAILED', 'api_error')
    h.fake.set(r.runId, '04', 'CANCELLED', 'cancelled')
    await h.clock.advance(POLL)
    const b = await mountBand($, surface, bandProps(160))
    await pressChip(b, 'co-one', 'Show')
    await b.redraw()
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 24))
    for (const tree of [await b.drawn(), await p.drawn()]) {
      themeOnly(tree) // allowed set, and none of diffAdded, diffRemoved, their dimmed forms, merged, text
      for (const { node, inFrame } of walk(tree)) {
        if (inFrame) continue
        for (const prop of ['color', 'backgroundColor']) {
          const v = node.props?.[prop]
          if (typeof v === 'string') expect(TIMELINE_ONLY_DARK.map(c => c.toUpperCase())).not.toContain(v.toUpperCase())
        }
      }
    }
    // the timeline colours reach the Clients as their `c` prop: the dark table exactly (the kit sets no theme)
    const id = runIds(h)[0]!
    for (const slot of ['01', '02', '03', '04']) expect((await timeline(b, timelineKey(id, slot))).props.c).toEqual(TIMELINE_DARK)
    await p.unmount()
    await b.unmount()
  })

  test(`R6.6 R8.2 REQ-9: a light theme hands the Clients the light timeline table without fold colours [${surface}]`, async ($, on) => {
    const h = harness(on, { theme: 'light' })
    await start($, surface)
    await team($, h, 'light', ['light-model'])
    const b = await mountBand($, surface, bandProps(160))
    const { props } = await timeline(b, timelineKey(runIds(h)[0]!, '01'))
    expect(props.c).toEqual(TIMELINE_LIGHT)
    expect(props.c).not.toEqual(TIMELINE_DARK)
    await b.unmount()
  })
}
