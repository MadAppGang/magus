// Spec R6.3 (column fit), drawn through the plugin on both surfaces: the example floor (41 draws
// rows, 40 the header alone), the drop order, and that no row is ever wider than the band, a row
// with a timeline exactly as wide, at every width from 30 to 200. Measured on the drawn description.

import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, SURFACES, walk } from '../ui'
import { POLL, team } from './support'
import { chip, chips, header, keyOf, rowByShow, visibleText } from './v2-support'
import { clientsIn, drawnRows, naturalCells } from './r6-support'

for (const surface of SURFACES) {
  test(`R6.3: the example floor — 41 columns draw the row at exactly 41 cells; 40 draw the header alone [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'floor', ['floor-model-long'])
    const b = await mountBand($, surface, bandProps(160))
    const showKey = keyOf(await chip(b, 'floor-model-long', 'Show'))
    // id 01, a model of 8+ characters, one stoppable row: 2 + 2 + 5 + 10 + 9 + 8 + 5 gaps = 41
    await b.redraw(bandProps(41))
    const row = await rowByShow(b, showKey)
    expect(naturalCells(row)).toBe(41)
    const t = visibleText(row)
    expect(t).toContain(' RUN ')
    expect(t).toContain(' floor-m… ') // the model at 8 cells of text, padded: never dropped
    expect(chips(row, 'Stop')).toHaveLength(1)
    expect(chips(row, 'Show')).toHaveLength(1)
    expect(clientsIn(row), 'the live cell is dropped at the floor').toHaveLength(0)
    expect(t).not.toMatch(/OpenRouter|[↑↓ƒ↻$]|\d+s /)
    await b.redraw(bandProps(40))
    expect(drawnRows(await b.drawn())).toHaveLength(0)
    expect(walk(await b.drawn()).some(x => x.node.type === 'Button')).toBe(false) // no Button, not even Hide
    expect(visibleText(await header(b))).toContain('◆ claudish')
    await b.unmount()
  })

  // The drop order (R6.3) is pinned by v2-fit.test.ts, rewritten to R6.

  test(`R6.3: at every width from 30 to 200 no row is wider than the band, and a row with a timeline is exactly as wide [${surface}]`, { timeoutMs: 120_000 }, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'every-width', ['a-long-model-name-x', 'kimi-k3', 'glm-5.3'])
    h.fake.set(r.runId, '03', 'COMPLETED')
    await h.clock.advance(POLL)
    const b = await mountBand($, surface, bandProps(200))
    let exactRows = 0
    for (let width = 200; width >= 30; width -= 1) {
      await b.redraw(bandProps(width))
      const tree = await b.drawn()
      const rows = drawnRows(tree)
      // floor: 2 + 2 + 5 + 10 + 9 + 8 + 5 gaps = 41; below it, the header alone
      if (width < 41) {
        expect(rows, `@${width}`).toHaveLength(0)
        expect(walk(tree).some(x => x.node.type === 'Button'), `@${width}: no Button`).toBe(false)
        continue
      }
      expect(rows, `@${width}`).toHaveLength(3)
      for (const row of rows) {
        const w = naturalCells(row)
        expect(w, `@${width}: "${visibleText(row)}" is ${w} cells`).toBeLessThanOrEqual(width)
        if (clientsIn(row).length > 0) {
          expect(w, `@${width}: a row with a timeline fills the band exactly`).toBe(width)
          exactRows += 1
        }
        expect(visibleText(row)).not.toContain('\n')
      }
    }
    expect(exactRows).toBeGreaterThan(0)
    await b.unmount()
  })
}
