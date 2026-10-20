import { expect } from 'claude-code/testing'
import { test } from '../kit'
import type { PaneOpenArgs } from 'claude-code'
import { harness, start } from '../fake-claudish'
import { REAP_MS } from '../scenario'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, walk, type Mounted, type Node } from '../ui'
import { POLL, delegate, team } from './support'
import { DARK, bandRow, chips, expectInk, frameLines, keyOf, pressChip, runtimePart, themeKeysOnly, visibleText } from './v2-support'
import { SHOW_PANE, activeTab, drawnRows, silentFor, untilPoll, views } from './r6-support'

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

/** R6.5: the band header's Hide (no row reads Hide). */
async function pressHeaderHide(b: Mounted): Promise<void> {
  const hide = (await b.findAll({ type: 'Button' })).filter(x => x.props.label === 'Hide')
  expect(hide).toHaveLength(1)
  await b.press({ key: hide[0]!.key! })
}

/** The Show panel's tab labels, in order (each tab a Button whose `label` prop is its label). */
async function tabLabels(p: Mounted): Promise<string[]> {
  // R10.3: the strip's row also carries the panel's own Hide, which is not a tab
  return (await p.findAll({ type: 'Button' })).map(f => String(f.props.label)).filter(l => l !== 'Hide')
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
  test(`R6.5: Show opens the one pane claudish-show — title claudish, 120 dock columns, 24 inline rows, close on Escape — even from the band at its floor [${surface}]`, async ($, on) => {
    const observed: PaneOpenArgs[] = []
    // Register before the harness's answering hook: a spy beneath that hook would never run.
    on('ui.open', {}, async (_$, e, next) => { observed.push({ ...e }); return next(e) })
    const h = harness(on)
    await start($, surface)
    await team($, h, 'show-size', ['size-model'])
    const b = await mountBand($, surface, bandProps(160))
    const showKey = keyOf(chips(await bandRow(b, 'size-model'), 'Show')[0]!)
    expect(observed).toHaveLength(0)
    const capturedBefore = h.fake.captureCalls().length
    await b.redraw(bandProps(41)) // R6.3 floor for a 10-character model: 2 + 2 + 5 + (8 + 2) + 9 + 8 + 5 gaps
    await b.press({ key: showKey })
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({ id: SHOW_PANE, title: 'claudish', columns: 120, rows: 24, closeOnEscape: true })
    expect(h.opens).toHaveLength(1)
    expect(h.panes[0]?.isPlaced).toBe(true)
    expect(views(h).get(activeTab(h)!)).toMatchObject({ slot: '01', model: 'size-model' })
    expect(h.toasts.some(t => t.includes('not drawn yet'))).toBe(false)
    await h.clock.advance(0) // the press captures at once: no poll interval passes
    expect(h.fake.captureCalls().length).toBeGreaterThan(capturedBefore)
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

  test(`R6.5: two tabs of one model add their slot id to the label; Hide then Show brings the panel back with both tabs, never a second pane [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'title-run', ['same-model', 'same-model'])
    const b = await mountBand($, surface)
    await showId(b, '01')
    const tab01 = activeTab(h)
    await showId(b, '02')
    const tab02 = activeTab(h)
    expect(tab02).not.toBe(tab01)
    expect(h.opens.every(o => o.id === SHOW_PANE && o.title === 'claudish')).toBe(true)
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 24))
    expect(await tabLabels(p)).toEqual(['same-model 01', 'same-model 02'])
    expect((await tabLabels(p)).some(l => l.includes('(') || l.includes('title-run'))).toBe(false) // one run: the slot id alone
    await b.redraw()
    await pressHeaderHide(b)
    expect(h.closes).toEqual([SHOW_PANE])
    expect(h.panes).toHaveLength(0)
    await b.redraw()
    await showId(b, '02')
    expect(h.panes.map(x => x.id)).toEqual([SHOW_PANE])
    expect(activeTab(h)).toBe(tab02)
    await p.redraw()
    expect(await tabLabels(p)).toEqual(['same-model 01', 'same-model 02'])
    await p.unmount()
    await b.unmount()
  })

  test(`R6.5: a delegation sharing a model with a team slot adds only its label, never the session id; the team slot adds label/slot [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'team-title', ['haiku-4.5'])
    const b = await mountBand($, surface)
    await showId(b, '01')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 24))
    expect(await tabLabels(p)).toEqual(['haiku-4.5'])
    const s = await delegate($, h)
    await b.redraw()
    const label = `#${s.id.slice(0, 6)}`
    await showId(b, label)
    await p.redraw()
    const labels = await tabLabels(p)
    expect(labels).toContain(`haiku-4.5 ${label}`)
    expect(labels).toContain('haiku-4.5 team-title/01') // two runs drawn: label/slot
    expect(labels.some(l => l.includes(s.id))).toBe(false)
    expect(labels.some(l => l.includes(`${label}/`))).toBe(false)
    expect(views(h).get(activeTab(h)!)).toMatchObject({ model: 'haiku-4.5' })
    expect(h.panes.map(x => x.id)).toEqual([SHOW_PANE])
    await p.unmount()
    await b.unmount()
  })

  test(`v2 §6: tab header starts with the row badge, then bold model, provider, meter and activity [${surface}]`, async ($, on) => {
    const h: ReturnType<typeof harness> = harness(on, { rowPatch: row => silentFor(() => h, () => 42)({ ...row, activity: 'thinking' }) })
    await start($, surface)
    await team($, h, 'tab-header', ['header-model'])
    const b = await mountBand($, surface)
    await pressChip(b, 'header-model', 'Show')
    await untilPoll(h) // read right after a poll: the silence is exactly 42 s
    const rowText = visibleText(await bandRow(b, 'header-model'))
    const badge = rowText.slice(rowText.indexOf(' RUN '), rowText.indexOf(' RUN ') + 12)
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 24))
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
    // R6.5 + R10.3: the panel's only Buttons are its tabs and its one Hide: no Stop or Show inside it
    expect((await p.findAll({ type: 'Button' })).map(f => f.props.label).filter(l => l !== 'Hide')).toEqual(['header-model'])
    expect((await p.findAll({ type: 'Button' })).filter(f => f.props.label === 'Hide')).toHaveLength(1)
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

  for (const [bodyRows, kept] of [[8, 3], [4, 1]] as const) {
    test(`R6.5: a three-line child frame is top-aligned in ${bodyRows} body rows, right under the tab header [${surface}]`, async ($, on) => {
      const lines = ['short answer', '❯ short prompt', 'child status']
      const h = harness(on, { noSpans: true, frame: args => ({
        seq: args.seq, cols: 80, rows: lines.length, cursor: { x: 2, y: 1 }, final: args.final, lines,
      }) })
      await start($, surface)
      await team($, h, 'short-frame', ['short-model'])
      const b = await mountBand($, surface)
      await pressChip(b, 'short-model', 'Show')
      await h.clock.advance(0) // the first capture is due at once: no poll interval passes
      const p = await mountPane($, surface, SHOW_PANE, paneProps(80, bodyRows))
      const frame = frameLines(await p.drawn()).map(l => l.trimEnd())
      // room = rows less the strip and its rule; the frame keeps its last room − 1 lines
      const expected = lines.slice(lines.length - kept)
      expect(frame.slice(0, kept)).toEqual(expected)
      expect(frame.slice(kept).every(l => l === ''), 'blank rows only below the screen').toBe(true)
      expect(frame[0]).not.toBe('')
      expect(frame[0]).toBe(expected[0])
      if (bodyRows === 8) expect(frame[0]).toBe('short answer') // top-aligned, never bottom
      await p.unmount()
      await b.unmount()
    })
  }

  // §7/§8/§9: Hide, written from the spec text only.
  test(`R6.5: no row reads [ Hide ]; the header carries it while the panel is open and drawn; it puts the panel away keeping every view; rows read [ Show ] throughout [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'hide-run', ['hide-model', 'other-model'])
    const b = await mountBand($, surface)
    const hides = async () => (await b.findAll({ type: 'Button' })).filter(x => x.props.label === 'Hide')
    expect(await hides()).toHaveLength(0)
    await pressChip(b, 'hide-model', 'Show')
    expect(h.opens[0]).toMatchObject({ id: SHOW_PANE, closeOnEscape: true })
    const tab = activeTab(h)!
    await b.redraw()
    for (const model of ['hide-model', 'other-model']) {
      expect(chips(await bandRow(b, model), 'Show')).toHaveLength(1)
      expect(chips(await bandRow(b, model), 'Hide')).toHaveLength(0)
    }
    const hide = await hides()
    expect(hide).toHaveLength(1)
    expect(hide[0]!.props.label).toBe('Hide')
    const hideNode = walk(await b.drawn()).map(x => x.node).find(n => n.type === 'Button' && n.props?.label === 'Hide')
    expectInk(hideNode, '[ Hide ]', { color: 'suggestion', bold: true, backgroundColor: undefined })
    for (const r of drawnRows(await b.drawn())) expect(walk(r).map(x => x.node)).not.toContain(hideNode)
    await pressChip(b, 'other-model', 'Show')
    const other = activeTab(h)!
    await b.redraw()
    await pressHeaderHide(b)
    expect(h.closes).toEqual([SHOW_PANE])
    expect(h.panes).toHaveLength(0)
    expect(h.state.get(`panes/${tab}`)).toMatchObject({ slot: '01' }) // the views are kept
    expect(h.state.get(`panes/${other}`)).toMatchObject({ slot: '02' })
    await b.redraw()
    expect(await hides()).toHaveLength(0)
    for (const model of ['hide-model', 'other-model']) {
      expect(chips(await bandRow(b, model), 'Show')).toHaveLength(1)
      expect(chips(await bandRow(b, model), 'Hide')).toHaveLength(0)
    }
    expect(h.fake.cancelCalls()).toHaveLength(0)
    themeKeysOnly(await b.drawn())
    await b.unmount()
  })

  test(`R6.5: a panel Claude Code keeps undrawn has no Hide in the header; Show opens it again as the person's request [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'undrawn-run', ['undrawn-model'])
    const b = await mountBand($, surface)
    await pressChip(b, 'undrawn-model', 'Show')
    // open, but not drawn, until the person asks again
    h.panesAnswer = () => (h.opens.length === 1 ? h.panes.map(p => ({ ...p, isPlaced: false, isShown: false })) : h.panes)
    await b.redraw()
    expect((await b.findAll({ type: 'Button' })).filter(x => x.props.label === 'Hide')).toHaveLength(0)
    expect(chips(await bandRow(b, 'undrawn-model'), 'Show')).toHaveLength(1)
    const calls = h.uiCalls.length
    await pressChip(b, 'undrawn-model', 'Show')
    expect(h.uiCalls[calls]).toBe('open')
    expect(h.opens.length).toBeGreaterThanOrEqual(2)
    expect(h.opens.every(o => o.id === SHOW_PANE)).toBe(true)
    expect(h.closes.every(id => id === SHOW_PANE)).toBe(true)
    await b.redraw()
    expect((await b.findAll({ type: 'Button' })).filter(x => x.props.label === 'Hide')).toHaveLength(1)
    expect(chips(await bandRow(b, 'undrawn-model'), 'Hide')).toHaveLength(0)
    await b.unmount()
  })

  test(`R6.5: every Show press opens claudish-show before anything else — the first, after a switch, and after Hide [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'first-call', ['first-model', 'second-model'])
    const b = await mountBand($, surface)
    let before = h.uiCalls.length
    await pressChip(b, 'first-model', 'Show')
    expect(h.uiCalls.slice(before)[0], `calls: ${h.uiCalls.slice(before).join(', ')}`).toBe('open')
    before = h.uiCalls.length
    await pressChip(b, 'second-model', 'Show')
    if (h.uiCalls.length > before) expect(h.uiCalls[before]).toBe('open') // a switch: nothing before the open, if any
    await b.redraw()
    await pressHeaderHide(b)
    await b.redraw()
    before = h.uiCalls.length
    const opens = h.opens.length
    await pressChip(b, 'first-model', 'Show')
    expect(h.uiCalls[before], `calls: ${h.uiCalls.slice(before).join(', ')}`).toBe('open')
    expect(h.opens.slice(opens).map(o => o.id)).toEqual([SHOW_PANE])
    expect(views(h).get(activeTab(h)!)).toMatchObject({ slot: '01' })
    await b.unmount()
  })
}
