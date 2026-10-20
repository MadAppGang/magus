import { test, expect } from 'claude-code/testing'
import type { PaneOpenArgs } from 'claude-code'
import { harness, start } from '../fake-claudish'
import { REAP_MS } from '../scenario'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, walk, type Mounted, type Node } from '../ui'
import { POLL, delegate, team } from './support'
import { DARK, bandRow, chips, expectInk, frameLines, keyOf, pressChip, runtimePart, themeKeysOnly, visibleText } from './v2-support'

async function rowWithId(b: Mounted, id: string): Promise<Node> {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const prefix = new RegExp(`^(?:  |▌ )${escaped}\\s* (?:NEW|RUN|ASK|END|ERR|TMO|NIL|FMT|STP|LST|\\?\\?\\?) `)
  const rows = walk(await b.drawn()).map(x => x.node).filter(n => n.type === 'Box'
    && prefix.test(visibleText(n)) && chips(n, 'Show').length + chips(n, 'Hide').length === 1)
  const row = rows[rows.length - 1]
  if (!row) throw new Error(`no visible row with id ${id}`)
  return row
}

async function showId(b: Mounted, id: string): Promise<void> {
  await b.press({ key: keyOf(chips(await rowWithId(b, id), 'Show')[0]!) })
}

async function hideId(b: Mounted, id: string): Promise<void> {
  await b.press({ key: keyOf(chips(await rowWithId(b, id), 'Hide')[0]!) })
}

async function tabHeader(p: Mounted, model: string): Promise<Node> {
  const candidates = walk(await p.drawn()).filter(x => !x.inFrame).map(x => x.node)
    .filter(n => n.type === 'Box' && /^ (?:NEW|RUN|ASK|END|ERR|TMO|NIL|FMT|STP|LST|\?\?\?) /.test(visibleText(n))
      && visibleText(n).includes(model))
  const result = candidates[candidates.length - 1]
  if (!result) throw new Error(`no badge-led tab header for ${model}`)
  return result
}

for (const surface of SURFACES) {
  test(`v2 §6/§7: Show asks for 120 dock columns, 24 inline rows and close on Escape, even from the band at its floor [${surface}]`, async ($, on) => {
    const observed: PaneOpenArgs[] = []
    // Register before the harness's answering hook: a spy beneath that hook would never run.
    on('ui.open', {}, async (_$, e, next) => { observed.push({ ...e }); return next(e) })
    const h = harness(on)
    await start($, surface)
    await team($, h, 'show-size', ['size-model'])
    const b = await mountBand($, surface, bandProps(160))
    const showKey = keyOf(chips(await bandRow(b, 'size-model'), 'Show')[0]!)
    expect(observed).toHaveLength(0)
    expect(h.fake.captureCalls()).toHaveLength(0)
    await b.redraw(bandProps(41)) // §10 floor for a 10-character model: 2 + 2 + 5 + (8 + 2) + 9 + 8 + 5 gaps
    await b.press({ key: showKey })
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({ title: 'size-model', columns: 120, rows: 24, closeOnEscape: true })
    expect(h.opens).toHaveLength(1)
    expect(h.panes[0]?.isPlaced).toBe(true)
    expect(h.toasts.some(t => t.includes('not drawn yet'))).toBe(false)
    await h.clock.advance(0) // the first capture is due at once: no poll interval passes
    expect(h.fake.captureCalls().length).toBeGreaterThan(0)
    await b.unmount()
  })

  test(`v2 §6: an unplaced Show toasts the engine reason without claiming it is drawn [${surface}]`, async ($, on) => {
    const reason = 'This attached surface does not place panes.'
    const observed: PaneOpenArgs[] = []
    on('ui.open', {}, (_$, e) => {
      observed.push({ ...e })
      return { value: { isPlaced: false as const, reason } }
    })
    const h = harness(on)
    await start($, surface)
    await team($, h, 'unplaced-show', ['unplaced-model'])
    const b = await mountBand($, surface)
    await pressChip(b, 'unplaced-model', 'Show')
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({ columns: 120, rows: 24 })
    expect(h.toasts).toEqual([`Show unplaced-model: not drawn yet. ${reason}`])
    expect(h.toasts[0]).not.toMatch(/opened successfully|now drawn/)
    expect(h.fake.cancelCalls()).toHaveLength(0)
    await b.unmount()
  })

  test(`v2 §6/§9: duplicate team model titles add label/slot; Hide then Show brings both tabs back, never a duplicate [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'title-run', ['same-model', 'same-model'])
    const b = await mountBand($, surface)
    await showId(b, '01')
    expect(h.opens).toHaveLength(1)
    expect(h.opens[0]?.title).toBe('same-model')
    const tab01 = h.opens[0]!.id
    await showId(b, '02')
    // §8: the open comes first, so a taken title is fixed once the open tabs are read (a retitle of the same id)
    const tab02 = h.opens[1]!.id
    expect(tab02).not.toBe(tab01)
    expect(h.opens.slice(1).every(o => o.id === tab02)).toBe(true)
    expect(h.opens.at(-1)?.title).toBe('same-model (title-run/02)')
    expect(h.panes.find(p => p.id === tab02)?.title).toBe('same-model (title-run/02)')
    expect(h.panes).toHaveLength(2)
    await b.redraw()
    const opened = h.opens.length
    await hideId(b, '02')
    // §9: Hide puts every Show tab away
    expect([...h.closes].sort()).toEqual([tab01, tab02].sort())
    expect(h.panes).toHaveLength(0)
    await b.redraw()
    await showId(b, '02')
    // both come back under their own ids and titles, the pressed one opened last (any retitle comes after)
    const again = h.opens.slice(opened)
    expect(again.map(o => o.id).slice(0, 2)).toEqual([tab01, tab02])
    expect(again.every(o => o.id === tab01 || o.id === tab02)).toBe(true)
    expect(h.panes.find(p => p.id === tab01)?.title).toBe('same-model')
    expect(h.panes.find(p => p.id === tab02)?.title).toBe('same-model (title-run/02)')
    expect(h.panes.find(p => p.id === tab02)?.isShown).toBe(true)
    expect(h.panes).toHaveLength(2)
    expect(h.opens.every(o => !o.title?.includes('(title-run/02) (title-run/02)'))).toBe(true)
    await b.unmount()
  })

  test(`v2 §6: duplicate delegation model title adds only its label, never the session id [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'team-title', ['haiku-4.5'])
    const b = await mountBand($, surface)
    await showId(b, '01')
    expect(h.opens[0]?.title).toBe('haiku-4.5')
    const s = await delegate($, h)
    await b.redraw()
    const label = `#${s.id.slice(0, 6)}`
    await showId(b, label)
    const tab = h.opens[1]!.id
    expect(h.opens.slice(1).every(o => o.id === tab)).toBe(true)
    const title = h.panes.find(p => p.id === tab)?.title
    expect(title).toBe(`haiku-4.5 (${label})`)
    expect(h.opens.at(-1)?.title).toBe(title)
    expect(title).not.toContain(s.id)
    expect(title).not.toContain(`${label}/`)
    expect(h.panes).toHaveLength(2)
    await b.unmount()
  })

  test(`v2 §6: tab header starts with the row badge, then bold model, provider, meter and activity [${surface}]`, async ($, on) => {
    const h = harness(on, { rowPatch: row => ({ ...row, idle_seconds: 42, activity: 'thinking' }) })
    await start($, surface)
    await team($, h, 'tab-header', ['header-model'])
    const b = await mountBand($, surface)
    const badge = visibleText(await bandRow(b, 'header-model')).slice(
      visibleText(await bandRow(b, 'header-model')).indexOf(' RUN '),
      visibleText(await bandRow(b, 'header-model')).indexOf(' RUN ') + 12,
    )
    await pressChip(b, 'header-model', 'Show')
    const p = await mountPane($, surface, h.opens[0]!.id, paneProps(120, 24))
    const hdr = await tabHeader(p, 'header-model')
    const text = visibleText(hdr)
    expect(text.startsWith(`${badge} header-model`)).toBe(true)
    expect(text).toContain(' · OpenRouter')
    expect(text).toContain('▰▰▱▱▱ 42s')
    expect(text).toContain(' · thinking')
    expect(text.indexOf('OpenRouter')).toBeLessThan(text.indexOf('▰▰▱▱▱'))
    expect(text.indexOf('▰▰▱▱▱')).toBeLessThan(text.indexOf('thinking'))
    expectInk(hdr, ' RUN ', { color: DARK.ink, backgroundColor: DARK.run, bold: true }) // §9: the row's solid badge
    expectInk(hdr, badge.slice(5), { color: DARK.run, backgroundColor: undefined }) // §9: the runtime in the hue, no fill
    expectInk(hdr, 'header-model', { bold: true })
    expectInk(hdr, '▰▰▱▱▱ 42s', { color: 'success' })
    expect(text).not.toMatch(/^header-model|▶ running|idle | · ended/)
    expect(chips(await p.drawn())).toHaveLength(0)
    themeKeysOnly(await p.drawn())
    await p.unmount()
    await b.unmount()
  })

  test(`v2 §6: an ended FMT tab explains the missed format without empty or shape_mismatch [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'format-tab', ['format-tab-model'])
    h.fake.set(r.runId, '01', 'EMPTY', 'shape_mismatch')
    await h.clock.advance(POLL)
    const b = await mountBand($, surface)
    await pressChip(b, 'format-tab-model', 'Show')
    await h.clock.advance(REAP_MS + POLL)
    const p = await mountPane($, surface, h.opens[0]!.id, paneProps(160, 24))
    const hdr = await tabHeader(p, 'format-tab-model')
    const text = visibleText(hdr)
    expect(text.startsWith(` FMT ${runtimePart('1s')} format-tab-model`)).toBe(true)
    expect(text).toContain(' · the answer missed the required format')
    expect(text).toContain(' · ended')
    expectInk(hdr, ' FMT ', { color: DARK.ink, backgroundColor: DARK.format, bold: true })
    expectInk(hdr, runtimePart('1s'), { color: DARK.format, backgroundColor: undefined }) // §9: plain text in the hue
    expect(text).not.toMatch(/ NIL |empty|shape_mismatch|[▰▱]|idle /)
    await p.unmount()
    await b.unmount()
  })

  for (const bodyRows of [8, 4] as const) {
    test(`v2 §6: a three-line child frame is bottom-aligned in ${bodyRows} body rows [${surface}]`, async ($, on) => {
      const lines = ['short answer', '❯ short prompt', 'child status']
      const h = harness(on, { noSpans: true, frame: args => ({
        seq: args.seq, cols: 80, rows: lines.length, cursor: { x: 2, y: 1 }, final: args.final, lines,
      }) })
      await start($, surface)
      await team($, h, 'short-frame', ['short-model'])
      const b = await mountBand($, surface)
      await pressChip(b, 'short-model', 'Show')
      await h.clock.advance(0) // the first capture is due at once: no poll interval passes
      const p = await mountPane($, surface, h.opens[0]!.id, paneProps(80, bodyRows))
      const frame = frameLines(await p.drawn())
      // a blank row may be drawn as a space, so it keeps its height: compare what is visible
      expect(frame.map(l => l.trimEnd())).toEqual([...new Array<string>(bodyRows - 1 - lines.length).fill(''), ...lines])
      expect(frame).toHaveLength(bodyRows - 1)
      expect(frame[frame.length - 1]).toBe('child status')
      expect(frame[frame.length - 2]).toBe('❯ short prompt')
      expect(frame[frame.length - 1]).not.toBe('')
      if (bodyRows === 8) expect(frame[0]).not.toBe('short answer')
      expect(chips(await p.drawn())).toHaveLength(0)
      await p.unmount()
      await b.unmount()
    })
  }

  // §7/§8/§9: Hide, written from the spec text only.
  test(`v2 §9: a row reads [ Hide ] while its tab is open, drawn and not hidden; Hide puts every tab away, each keeping its view; every row then reads [ Show ] [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'hide-run', ['hide-model', 'other-model'])
    const b = await mountBand($, surface)
    expect(chips(await bandRow(b, 'hide-model'), 'Hide')).toHaveLength(0)
    await pressChip(b, 'hide-model', 'Show')
    const tab = h.opens[0]!.id
    expect(h.opens[0]).toMatchObject({ closeOnEscape: true })
    await b.redraw()
    const row = await bandRow(b, 'hide-model')
    expect(chips(row, 'Show')).toHaveLength(0)
    const hide = chips(row, 'Hide')
    expect(hide).toHaveLength(1)
    expect(hide[0]!.props?.label).toBe('Hide')
    expectInk(hide[0], '[ Hide ]', { color: 'suggestion', bold: true, backgroundColor: undefined })
    expect(chips(await bandRow(b, 'other-model'), 'Show')).toHaveLength(1) // its tab is not open
    await pressChip(b, 'other-model', 'Show')
    const other = h.opens[1]!.id
    await b.redraw()
    expect(chips(await bandRow(b, 'other-model'), 'Hide')).toHaveLength(1)
    await pressChip(b, 'hide-model', 'Hide')
    expect([...h.closes].sort()).toEqual([tab, other].sort())
    expect(h.panes).toHaveLength(0)
    expect(h.state.get(`panes/${tab}`)).toMatchObject({ slot: '01' }) // the view is kept
    expect(h.state.get(`panes/${other}`)).toMatchObject({ slot: '02' })
    await b.redraw()
    for (const model of ['hide-model', 'other-model']) {
      expect(chips(await bandRow(b, model), 'Show')).toHaveLength(1)
      expect(chips(await bandRow(b, model), 'Hide')).toHaveLength(0)
    }
    expect(h.fake.cancelCalls()).toHaveLength(0)
    themeKeysOnly(await b.drawn())
    await b.unmount()
  })

  test(`v2 §8: a tab Claude Code keeps undrawn reads [ Show ], and pressing it opens the tab again [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'undrawn-run', ['undrawn-model'])
    const b = await mountBand($, surface)
    await pressChip(b, 'undrawn-model', 'Show')
    const tab = h.opens[0]!.id
    // open, but not drawn, until the person asks again
    h.panesAnswer = () => (h.opens.length === 1 ? h.panes.map(p => (p.id === tab ? { ...p, isPlaced: false, isShown: false } : p)) : h.panes)
    await b.redraw()
    expect(chips(await bandRow(b, 'undrawn-model'), 'Hide')).toHaveLength(0)
    expect(chips(await bandRow(b, 'undrawn-model'), 'Show')).toHaveLength(1)
    await pressChip(b, 'undrawn-model', 'Show')
    expect(h.opens.length).toBeGreaterThanOrEqual(2)
    expect(h.opens.every(o => o.id === tab)).toBe(true)
    expect(h.closes.every(id => id === tab)).toBe(true)
    await b.redraw()
    expect(chips(await bandRow(b, 'undrawn-model'), 'Hide')).toHaveLength(1)
    await b.unmount()
  })

  test(`v2 §8/§9: the press opens before anything else: its first calls are the opens, the pressed tab last, before any other call [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'first-call', ['first-model', 'second-model'])
    const b = await mountBand($, surface)
    // a lone Show: the first call is its open
    let before = h.uiCalls.length
    await pressChip(b, 'first-model', 'Show')
    expect(h.uiCalls.slice(before)[0], `calls: ${h.uiCalls.slice(before).join(', ')}`).toBe('open')
    await pressChip(b, 'second-model', 'Show')
    const [first, second] = [h.opens[0]!.id, h.opens[1]!.id]
    await b.redraw()
    await pressChip(b, 'first-model', 'Hide')
    await b.redraw()
    // a Show after Hide: every restore open and the pressed open come first, the pressed one last
    before = h.uiCalls.length
    const opens = h.opens.length
    await pressChip(b, 'first-model', 'Show')
    expect(h.uiCalls.slice(before, before + 2), `calls: ${h.uiCalls.slice(before).join(', ')}`).toEqual(['open', 'open'])
    expect(h.opens.slice(opens, opens + 2).map(o => o.id)).toEqual([second, first])
    await b.unmount()
  })
}
