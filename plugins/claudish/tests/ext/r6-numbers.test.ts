// Spec R6.1 (numbers), drawn through the plugin: the count boundaries in the tokens part, the cost
// cell (SUB, —, dollars), and the provider name without its ` (Native)` suffix in the row and the
// Show tab header. Written from spec.md only; every expected string is worked from R6.1's rules.

import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, walk, type Node } from '../ui'
import { DARK, QUIET_DARK, team } from './support'
import { bandRow, expectInk, expectInkOneOf, pressChip, tabHeader, visibleText } from './v2-support'
import { SHOW_PANE, runsOf } from './r6-support'

/**
 * The tokens part of a row (R6.2): two adjacent Text runs, the in half on `tokensIn` and the out half on
 * `tokensOut`. A Text's key is not observable in a drawn tree, so each half is found by its ink.
 */
function tokenHalves(row: Node): { in: string; out: string } {
  const runs = runsOf(row)
  const on = (fill: string) => runs.filter(r => String(r.backgroundColor).toUpperCase() === fill).map(r => r.text).join('')
  const inAt = runs.findIndex(r => String(r.backgroundColor).toUpperCase() === DARK.tokensIn)
  const outAt = runs.findIndex(r => String(r.backgroundColor).toUpperCase() === DARK.tokensOut)
  expect(inAt, 'the in half is drawn').toBeGreaterThanOrEqual(0)
  expect(outAt, 'the out half is drawn').toBeGreaterThan(inAt)
  // adjacent: nothing visible between the two halves
  expect(runs.slice(inAt, outAt).every(r => String(r.backgroundColor).toUpperCase() === DARK.tokensIn)).toBe(true)
  return { in: on(DARK.tokensIn), out: on(DARK.tokensOut) }
}

const squeeze = (s: string) => s.replace(/\s+/g, ' ').trim()

for (const surface of SURFACES) {
  test(`R6.1: counts — 999 / 1.0k, 9.9k / 10k, 999k / 1.0M; 12 700 reads 13k [${surface}]`, async ($, on) => {
    const IN: Record<string, number> = { '01': 999, '02': 1_000, '03': 9_949, '04': 9_950, '05': 999_499, '06': 999_500 }
    const OUT: Record<string, number> = { '01': 0, '02': 12_700, '03': 5_500, '04': 850, '05': 2_345_678, '06': 999 }
    const h = harness(on, { rowPatch: r => ({ ...r, tokens_in: IN[String(r.slot)], tokens_out: OUT[String(r.slot)] }) })
    await start($, surface)
    await team($, h, 'counts', ['c-01', 'c-02', 'c-03', 'c-04', 'c-05', 'c-06'])
    const b = await mountBand($, surface, bandProps(200, 20))
    const expected: [string, string][] = [
      ['c-01', '↑999 ↓0'], ['c-02', '↑1.0k ↓13k'], ['c-03', '↑9.9k ↓5.5k'],
      ['c-04', '↑10k ↓850'], ['c-05', '↑999k ↓2.3M'], ['c-06', '↑1.0M ↓999'],
    ]
    for (const [model, shown] of expected) {
      const row = await bandRow(b, model)
      const halves = tokenHalves(row)
      // one space each side of the content; the value right-aligned to the widest row
      expect(halves.in.endsWith(' '), model).toBe(true)
      expect(halves.out.startsWith(' ') && halves.out.endsWith(' '), model).toBe(true)
      expect(squeeze(`${halves.in} ${halves.out}`), model).toBe(shown)
    }
    const all = visibleText(await b.drawn())
    // negative: the old one-decimal k above 9 950, and a k count that should have become M
    for (const wrong of ['12.7k', '10.0k', '999.5k', '1000k', '1000.0k', '999.9k']) expect(all).not.toContain(wrong)
    await b.unmount()
  })

  test(`R6.1: the cost cell — SUB for a cost of 0 or a native provider reporting none, — for any other unknown, dollars otherwise [${surface}]`, async ($, on) => {
    const rows: Record<string, { cost_usd: number | null; provider: string }> = {
      '01': { cost_usd: 0, provider: 'OpenRouter' },
      '02': { cost_usd: null, provider: 'Anthropic (Native)' },
      '03': { cost_usd: null, provider: 'anthropic (NATIVE)' }, // any case
      '04': { cost_usd: null, provider: 'OpenRouter' },
      '05': { cost_usd: 0.004, provider: 'Moonshot' },
      '06': { cost_usd: 0.42, provider: 'Moonshot' },
      '07': { cost_usd: 12.34, provider: 'Moonshot' },
      '08': { cost_usd: -1, provider: 'Moonshot' }, // negative: unknown, never a negative amount
    }
    const h = harness(on, { rowPatch: r => ({ ...r, ...rows[String(r.slot)] }) })
    await start($, surface)
    await team($, h, 'costs', ['k-01', 'k-02', 'k-03', 'k-04', 'k-05', 'k-06', 'k-07', 'k-08'])
    const b = await mountBand($, surface, bandProps(200, 20))
    const costOf = async (model: string) => walk(await bandRow(b, model)).map(x => x.node)
      .filter(n => n.type === 'Text').map(n => visibleText(n).trim())
    for (const [model, shown] of [
      ['k-01', 'SUB'], ['k-02', 'SUB'], ['k-03', 'SUB'], ['k-04', '—'],
      ['k-05', '<$0.01'], ['k-06', '$0.42'], ['k-07', '$12.3'], ['k-08', '—'],
    ] as const) {
      const row = await bandRow(b, model)
      expect(await costOf(model), `${model} reads ${shown}`).toContain(shown)
      expect(visibleText(row)).toContain(` ${shown} `) // one space each side (R6.2), right-aligned
      if (shown !== '—') {
        expectInk(row, shown, { color: DARK.snow, bold: true })
        expectInkOneOf(row, shown, 'backgroundColor', QUIET_DARK.cost)
      }
    }
    expect(visibleText(await bandRow(b, 'k-04'))).not.toMatch(/SUB|\$/)
    expect(visibleText(await bandRow(b, 'k-08'))).not.toMatch(/SUB|\$|-1|-\$/)
    expect(visibleText(await bandRow(b, 'k-05'))).not.toContain('SUB')
    await b.unmount()
  })

  test(`R6.1: a provider's trailing (Native) is dropped in the row and in the Show tab header [${surface}]`, async ($, on) => {
    // any case, surrounding spaces
    const providers: Record<string, string> = { '01': 'Anthropic (Native)', '02': 'Vendor  (NATIVE) ', '03': 'OpenRouter' }
    const h = harness(on, { rowPatch: r => ({ ...r, provider: providers[String(r.slot)], cost_usd: null }) })
    await start($, surface)
    await team($, h, 'prov-run', ['n-sonnet', 'n-other', 'n-routed']) // a label that cannot itself match /native/
    const b = await mountBand($, surface, bandProps(200, 20))
    const texts = async (model: string) => walk(await bandRow(b, model)).map(x => x.node)
      .filter(n => n.type === 'Text').map(n => visibleText(n).trim())
    expect(await texts('n-sonnet')).toContain('Anthropic')
    expect(await texts('n-other')).toContain('Vendor')
    expect(await texts('n-routed')).toContain('OpenRouter')
    // never the suffix, in any case, anywhere in the band
    expect(visibleText(await b.drawn())).not.toMatch(/native/i)
    // the cost cell still reads claudish's own provider: a native route reporting no cost is SUB
    expect(await texts('n-sonnet')).toContain('SUB')
    expect(await texts('n-routed')).toContain('—')
    await pressChip(b, 'n-sonnet', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 24))
    const hdr = visibleText(await tabHeader(p, 'n-sonnet'))
    expect(hdr).toContain(' · Anthropic')
    expect(hdr).not.toMatch(/native/i)
    await p.unmount()
    await b.unmount()
  })
}
