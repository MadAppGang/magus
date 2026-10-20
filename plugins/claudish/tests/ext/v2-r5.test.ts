// Spec §10 (Revision R5), written from the spec text only: the model badge (model solid, provider
// quiet, no gap between them), the final tokens badge (two fixed inks, both regular), and the SUB cost.
// No implementation import: every expected hex is worked from the §9 formulas and the §10 hues.

import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, SURFACES, walk, type Node } from '../ui'
import { QUIET_DARK, team } from './support'
import { DARK, bandRow, expectInk, expectInkOneOf, inkOf, visibleText } from './v2-support'

/** The Text elements of a row, as drawn. */
const textsOf = (row: Node) => walk(row).map(x => x.node).filter(n => n.type === 'Text')

for (const surface of SURFACES) {
  test(`v2 §10: the model is a badge, its name on the indigo solid fill, bold; the provider is its quiet half [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, provider: 'OpenRouter' }) })
    await start($, surface)
    await team($, h, 'model-badge', ['r5-model'])
    const b = await mountBand($, surface, bandProps(200))
    const row = await bandRow(b, 'r5-model')
    // each half padded one space either side
    expect(textsOf(row).map(visibleText)).toContain(' r5-model ')
    expect(textsOf(row).map(visibleText)).toContain(' OpenRouter ')
    expectInk(row, ' r5-model ', { color: DARK.snow, backgroundColor: DARK.model, bold: true })
    expectInk(row, ' OpenRouter ', { color: DARK.snow, backgroundColor: DARK.modelQuiet })
    for (const ink of inkOf(row, ' r5-model ')) expect(ink.dimColor).not.toBe(true)
    await b.unmount()
  })

  test(`v2 §10: there is no gap between the model and its provider; the row's gap falls before and after the badge [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, provider: 'OpenRouter' }) })
    await start($, surface)
    await team($, h, 'no-gap', ['gap-model'])
    const b = await mountBand($, surface, bandProps(200))
    const row = await bandRow(b, 'gap-model')
    const halves = textsOf(row)
    const model = halves.find(n => visibleText(n) === ' gap-model ')!
    const provider = halves.find(n => visibleText(n) === ' OpenRouter ')!
    expect(model).toBeDefined()
    expect(provider).toBeDefined()
    // the two halves sit in ONE element, the provider straight after the model, so the row's gap
    // (between its children) can never fall between them
    const holder = walk(row).map(x => x.node).filter(n => {
      const kids = ((n.children ?? n.props?.children ?? []) as unknown[]).flat(Infinity)
      return kids.includes(model) && kids.includes(provider)
    })
    expect(holder.length).toBeGreaterThan(0)
    const inner = holder[holder.length - 1]!
    expect(inner.type).not.toBe('Box') // not two cells of the row: a Box child each would get the gap
    const kids = ((inner.children ?? inner.props?.children ?? []) as unknown[]).flat(Infinity)
    expect(kids.indexOf(provider)).toBe(kids.indexOf(model) + 1)
    expect(visibleText(inner)).toBe(' gap-model  OpenRouter ')
    await b.unmount()
  })

  test(`v2 §10/R6.1: tokens are two fixed inks, ↑13k on the in fill and ↓780 on the out fill, both regular, never the model's colours [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: r => ({ ...r, tokens_in: 12_700, tokens_out: 780 }) })
    await start($, surface)
    await team($, h, 'green', ['green-model'])
    const b = await mountBand($, surface, bandProps(200))
    const row = await bandRow(b, 'green-model')
    expectInk(row, ' ↑13k ', { color: DARK.snow, backgroundColor: DARK.tokensIn })
    expectInk(row, ' ↓780 ', { color: DARK.snow, backgroundColor: DARK.tokensOut })
    for (const ink of [...inkOf(row, ' ↑13k '), ...inkOf(row, ' ↓780 ')]) expect(ink.bold).not.toBe(true)
    // the two badges differ: no tokens half is on the model's fills
    for (const half of [' ↑13k ', ' ↓780 ']) {
      for (const ink of inkOf(row, half)) {
        expect(ink.backgroundColor).not.toBe(DARK.modelQuiet)
        expect(ink.backgroundColor).not.toBe(DARK.model)
      }
    }
    expect(visibleText(row)).not.toContain('12.7k')
    await b.unmount()
  })

  test(`R6.1/R6.2: the cost reads SUB for a cost of 0 or a native provider reporting none, — for any other unknown; on the cost quiet ink, bold [${surface}]`, async ($, on) => {
    const rows: Record<string, { cost_usd: number | null; provider: string }> = {
      '01': { cost_usd: 0, provider: 'OpenRouter' }, // a subscription route: claudish reports 0
      '02': { cost_usd: null, provider: 'Anthropic (native)' }, // a native model reports no cost
      '03': { cost_usd: null, provider: 'Anthropic (Native)' },
      '04': { cost_usd: null, provider: 'OpenRouter' }, // unknown on another route
      '05': { cost_usd: 0.0096, provider: 'Moonshot' }, // metered: a real charge
    }
    const h = harness(on, { rowPatch: r => ({ ...r, ...rows[String(r.slot)] }) })
    await start($, surface)
    await team($, h, 'sub', ['sub-zero', 'sub-nat-lo', 'sub-nat-up', 'sub-unknown', 'sub-metered'])
    const b = await mountBand($, surface, bandProps(200))
    const cell = async (model: string) => textsOf(await bandRow(b, model)).map(n => visibleText(n).trim())
    for (const model of ['sub-zero', 'sub-nat-lo', 'sub-nat-up']) {
      expect(await cell(model), model).toContain('SUB')
      expect(visibleText(await bandRow(b, model)), model).toContain(' SUB ')
      expectInk(await bandRow(b, model), 'SUB', { color: DARK.snow, bold: true })
      expectInkOneOf(await bandRow(b, model), 'SUB', 'backgroundColor', QUIET_DARK.cost)
      expect(visibleText(await bandRow(b, model)), model).not.toMatch(/\$|—|native/i)
    }
    expect(await cell('sub-unknown')).toContain('—')
    expect(visibleText(await bandRow(b, 'sub-unknown'))).not.toMatch(/SUB|\$/)
    expect(await cell('sub-metered')).toContain('<$0.01')
    expectInk(await bandRow(b, 'sub-metered'), '<$0.01', { color: DARK.snow, bold: true })
    expectInkOneOf(await bandRow(b, 'sub-metered'), '<$0.01', 'backgroundColor', QUIET_DARK.cost)
    expect(visibleText(await bandRow(b, 'sub-metered'))).not.toContain('SUB')
    await b.unmount()
  })
}
