import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, SURFACES, walk } from '../ui'
import { team } from './support'
import { bandRow, chip, chips, header, keyOf, pressChip, rowByShow, visibleText } from './v2-support'

for (const surface of SURFACES) {
  test(`v2 §9/§10: 41 columns draws code, the model badge cut to 8 and both whole buttons; 40 draws only the header [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'floor', ['floor-model'])
    const b = await mountBand($, surface, bandProps(160))
    const showKey = keyOf(await chip(b, 'floor-model', 'Show'))
    // §10 floor: lead 2 + id 2 + code 5 + model (min(8, content) + 2) + Stop 9 + Show 8 + 5 gaps = 41
    await b.redraw(bandProps(41))
    const row = await rowByShow(b, showKey)
    expect(visibleText(row)).toContain(' RUN ')
    expect(chips(row, 'Stop')).toHaveLength(1)
    expect(chips(row, 'Show')).toHaveLength(1)
    expect(visibleText(chips(row, 'Stop')[0])).toBe('[ Stop ]')
    expect(visibleText(chips(row, 'Show')[0])).toBe('[ Show ]')
    expect(visibleText(row).slice(0, visibleText(row).indexOf(' RUN ')).trim()).toBe('01')
    expect(visibleText(row)).toContain('floor-m…') // the model shrinks to 8, never dropped
    expect(visibleText(row)).not.toMatch(/floor-model|OpenRouter|\d+s|tools|loops?|[ƒ↻↑↓$—]|[▰▱]|\n/)
    // Arming must not push Show off the 41-cell floor.
    await b.press({ key: keyOf(chips(row, 'Stop')[0]!) })
    await b.redraw(bandProps(41))
    const armed = await rowByShow(b, showKey)
    expect(visibleText(chips(armed, 'Stop?')[0])).toBe('[ Stop? ]')
    expect(chips(armed, 'Show')).toHaveLength(1)
    expect(visibleText(armed)).not.toContain('confirm?')
    await b.redraw(bandProps(40))
    expect(visibleText(await header(b))).toContain('◆ claudish')
    expect(chips(await b.drawn())).toHaveLength(0)
    expect(visibleText(await b.drawn())).not.toMatch(/ RUN |floor-model|Stop\??|Show/)
    expect(h.fake.cancelCalls()).toHaveLength(0)
    await b.unmount()
  })

  test(`R6.3: narrowing drops columns in the exact specified order — provider, loops, tool calls, tokens, cost, the live cell, then the runtime, the id to 2, the model to 8 [${surface}]`, { timeoutMs: 60_000 }, async ($, on) => {
    const model = 'model-column-with-a-longname' // 28 characters: the model column's cap
    const h = harness(on, { rowPatch: row => ({
      ...row, provider: 'provider-column', tokens_in: 48_100, tokens_out: 2_300,
      tool_calls: 123, turns_completed: 2, cost_usd: 0.004, idle_seconds: 42, activity: 'thinking',
    }) })
    await start($, surface)
    await team($, h, 'id-column-alpha', [model])
    await team($, h, 'id-column-beta', ['other-model'])
    const b = await mountBand($, surface, bandProps(200))
    const showKey = keyOf(await chip(b, model, 'Show'))
    const initial = visibleText(await rowByShow(b, showKey))
    for (const content of ['↑48k', '↓2.3k', 'ƒ123', 'provider-column', '↻2', '<$0.01', 'id-column-alpha/01']) {
      expect(initial).toContain(content)
    }
    // R6.2: a row with a timeline has an empty activity and no stale-meter text
    expect(initial).not.toMatch(/thinking|[▰▱]/)
    const firstMissing: Record<string, number> = {}
    const order = ['provider', 'loops', 'tools', 'tokens', 'cost', 'live', 'runtime', 'id2', 'model8']
    for (let width = 199; width >= 41; width -= 1) {
      await b.redraw(bandProps(width))
      const row = await rowByShow(b, showKey)
      const text = visibleText(row)
      const codeAt = text.indexOf(' RUN ')
      expect(codeAt).toBeGreaterThanOrEqual(0)
      const id = text.slice(0, codeAt).trim()
      // the model is its badge's own padded half; the shortest Text starting with it is that half
      const modelPart = walk(row).map(x => x.node).filter(n => n.type === 'Text')
        .map(n => visibleText(n).trim()).filter(t => t.startsWith('model-')).sort((x, y) => x.length - y.length)[0]
      const gone = {
        provider: !text.includes('provider-column'),
        loops: !text.includes('↻2'),
        tools: !text.includes('ƒ123'),
        tokens: !text.includes('↑48k'),
        cost: !text.includes('<$0.01'),
        live: !walk(row).some(x => x.node.type === 'Client'),
        runtime: !/^ *\d+s /.test(text.slice(codeAt + 5, codeAt + 12)),
        id2: Array.from(id).length <= 2,
        model8: modelPart !== undefined && Array.from(modelPart).length <= 8,
      }
      expect(text).toContain('model-') // the model is never dropped
      expect(text).not.toMatch(/thinking|[▰▱]/)
      for (const [name, isGone] of Object.entries(gone)) {
        if (isGone && firstMissing[name] === undefined) firstMissing[name] = width
      }
      expect(chips(row, 'Stop')).toHaveLength(1)
      expect(chips(row, 'Show')).toHaveLength(1)
      expect(text).not.toContain('\n')
      // a lower-priority column cannot disappear while a higher-priority one is still present
      for (let i = 1; i < order.length; i += 1) {
        if (gone[order[i] as keyof typeof gone]) expect(gone[order[i - 1] as keyof typeof gone]).toBe(true)
      }
    }
    expect(Object.keys(firstMissing).sort()).toEqual([...order].sort())
    for (let i = 1; i < order.length; i += 1) {
      expect(firstMissing[order[i - 1]!]).toBeGreaterThan(firstMissing[order[i]!]!)
    }
    await b.unmount()
  })

  test(`v2 §5: column widths and Show position do not change when Stop arms [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'stable-chips', ['stable-model'])
    const b = await mountBand($, surface, bandProps(120))
    const row = await bandRow(b, 'stable-model')
    const boxes = (tree: unknown) => walk(tree).map(x => x.node).filter(n => n.type === 'Box')
      .map(n => ({ width: n.props?.width, gap: n.props?.gap, columnGap: n.props?.columnGap }))
    const before = boxes(row)
    const showKey = keyOf(await chip(b, 'stable-model', 'Show'))
    // Button has no width prop in the engine. Its column reserves the stated cells.
    const columnWidths = (tree: unknown, name: string) => walk(tree).map(x => x.node)
      .filter(n => n.type === 'Box' && chips(n, name).length === 1 && typeof n.props?.width === 'number')
      .map(n => n.props!.width)
    expect(columnWidths(row, 'Stop')).toContain(9) // §7
    expect(columnWidths(row, 'Show')).toContain(8)
    await pressChip(b, 'stable-model', 'Stop')
    await b.redraw()
    const armed = await bandRow(b, 'stable-model')
    expect(boxes(armed)).toEqual(before)
    expect(columnWidths(armed, 'Stop?')).toContain(9)
    expect(keyOf(await chip(b, 'stable-model', 'Show'))).toBe(showKey)
    expect(chips(armed, 'Stop')).toHaveLength(0)
    expect(visibleText(armed)).not.toContain('confirm?')
    await b.unmount()
  })
}
