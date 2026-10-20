// Spec R6.5 (the Show panel: one pane, tabs inside), drawn through the plugin on both surfaces.
// One pane `claudish-show` for every slot; Show opens it first and picks the slot's tab; Hide lives in
// the band's header; tabs follow the band and are seeded before any Show; labels add the slot's place
// when two share a model; the strip's look; a tab press.
// Written from spec.md only; the shown tab is read from the published `showTab` state.

import { expect } from 'claude-code/testing'
import { test } from '../kit'
import type { PaneOpenArgs } from 'claude-code'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, walk, type Node } from '../ui'
import { DARK, POLL, QUIET_DARK, delegate, team } from './support'
import { chips, expectInk, inkOf, keyOf, pressChip, tabHeader, visibleText } from './v2-support'
import { SHOW_PANE, TAB_ID, activeTab, drawnRows, runsOf, views } from './r6-support'

/** The band header's Hide button, if drawn: a Button labelled Hide that sits in no row. */
async function headerHide(b: Awaited<ReturnType<typeof mountBand>>): Promise<Node | undefined> {
  const tree = await b.drawn()
  const rows = drawnRows(tree)
  const hides = walk(tree).map(x => x.node).filter(n => n.type === 'Button' && n.props?.label === 'Hide')
  for (const r of rows) for (const hide of hides) expect(walk(r).map(x => x.node)).not.toContain(hide)
  expect(hides.length).toBeLessThanOrEqual(1)
  return hides[0]
}

/** The tab strip's labels, in order: each tab is a Button whose `label` prop is its label. */
async function tabLabels(p: Awaited<ReturnType<typeof mountPane>>): Promise<string[]> {
  // R10.3: the strip's row also carries the panel's own Hide, which is not a tab
  return (await p.findAll({ type: 'Button' })).map(f => String(f.props.label)).filter(l => l !== 'Hide')
}

for (const surface of SURFACES) {
  test(`R6.5: Show opens ONE pane claudish-show (title claudish, 120 columns, 24 rows, Escape closes) as the press's first call, and picks the slot's tab [${surface}]`, async ($, on) => {
    const observed: PaneOpenArgs[] = []
    on('ui.open', {}, async (_$, e, next) => { observed.push({ ...e }); return next(e) })
    const h = harness(on)
    await start($, surface)
    await team($, h, 'one-pane', ['m-one', 'm-two', 'm-three'])
    const b = await mountBand($, surface, bandProps(160))
    expect(observed).toHaveLength(0)
    expect(activeTab(h)).toBeNull()
    let calls = h.uiCalls.length
    await pressChip(b, 'm-two', 'Show')
    expect(h.uiCalls[calls], `calls: ${h.uiCalls.slice(calls).join(', ')}`).toBe('open')
    expect(observed[0]).toMatchObject({ id: SHOW_PANE, title: 'claudish', columns: 120, rows: 24, closeOnEscape: true })
    const two = activeTab(h)
    expect(two).toMatch(TAB_ID)
    expect(views(h).get(two!)).toMatchObject({ slot: '02', model: 'm-two' })
    // with the panel open, Show only switches the tab: still the one pane
    await b.redraw()
    calls = h.uiCalls.length
    await pressChip(b, 'm-three', 'Show')
    if (h.uiCalls.length > calls) expect(h.uiCalls[calls]).toBe('open')
    const three = activeTab(h)
    expect(three).toMatch(TAB_ID)
    expect(three).not.toBe(two)
    expect(views(h).get(three!)).toMatchObject({ slot: '03', model: 'm-three' })
    // never one pane per slot
    expect(observed.every(o => o.id === SHOW_PANE)).toBe(true)
    expect(h.opens.some(o => TAB_ID.test(o.id))).toBe(false)
    expect(h.panes.map(p => p.id)).toEqual([SHOW_PANE])
    expect(h.toasts.some(t => t.includes('not drawn yet'))).toBe(false)
    await b.unmount()
  })

  test(`R6.5: an open that is not placed toasts "Show <model>: not drawn yet. <reason>" for 8 s [${surface}]`, async ($, on) => {
    const reason = 'Too narrow for an unasked pane.'
    const toasts: { text: string; timeoutMs?: number }[] = []
    on('ui.open', {}, () => ({ value: { isPlaced: false as const, reason } }))
    on('ui.toast', {}, async (_$, e, next) => { toasts.push({ ...e }); return next(e) })
    const h = harness(on)
    await start($, surface)
    await team($, h, 'unplaced', ['unplaced-model'])
    const b = await mountBand($, surface, bandProps(160))
    await pressChip(b, 'unplaced-model', 'Show')
    const mine = toasts.filter(t => t.text.startsWith('Show '))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ text: `Show unplaced-model: not drawn yet. ${reason}`, timeoutMs: 8_000 })
    expect(h.toasts).toContain(`Show unplaced-model: not drawn yet. ${reason}`)
    await b.redraw()
    expect(await headerHide(b), 'an undrawn panel has no Hide').toBeUndefined()
    await b.unmount()
  })

  test(`R6.5: Hide is in the band's header while the pane is open and drawn; it closes claudish-show and keeps every tab and view, so Show brings the panel back as it was [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'hide', ['h-one', 'h-two'])
    const b = await mountBand($, surface, bandProps(160))
    expect(await headerHide(b), 'no Hide before the panel opens').toBeUndefined()
    await pressChip(b, 'h-two', 'Show')
    await h.clock.advance(POLL)
    await b.redraw()
    const hide = await headerHide(b)
    expect(hide).toBeDefined()
    expect(visibleText(hide)).toBe('[ Hide ]')
    expectInk(hide, '[ Hide ]', { color: 'suggestion', bold: true, backgroundColor: undefined })
    // at the header's right edge, in an 8-cell box
    // one drawing: the Hide node and the boxes holding it come from the same tree
    const tree = await b.drawn()
    const hideHere = walk(tree).map(x => x.node).find(n => n.type === 'Button' && n.props?.label === 'Hide')
    expect(hideHere).toBeDefined()
    const box = walk(tree).map(x => x.node).filter(n => n.type === 'Box' && walk(n).some(x => x.node === hideHere))
    expect(box.some(n => n.props?.width === 8)).toBe(true)
    const headerBox = box.filter(n => visibleText(n).includes('◆ claudish') && !drawnRows(n).length).at(-1)
    expect(headerBox, 'the header line holds the Hide').toBeDefined()
    expect(visibleText(headerBox).trimEnd().endsWith('[ Hide ]')).toBe(true)
    // open but undrawn: no Hide
    const placed = h.panesAnswer
    h.panesAnswer = () => h.panes.map(p => ({ ...p, isPlaced: false, isShown: false }))
    await b.redraw()
    expect(await headerHide(b)).toBeUndefined()
    h.panesAnswer = placed
    await b.redraw()
    const active = activeTab(h)
    const kept = views(h)
    expect([...kept.values()].map(v => v.slot).sort()).toEqual(['01', '02'])
    await b.press({ key: keyOf((await headerHide(b))!) })
    expect(h.closes).toEqual([SHOW_PANE])
    expect(h.panes).toEqual([])
    // the tabs and their views stay; the shown tab is remembered
    expect([...views(h).keys()].sort()).toEqual([...kept.keys()].sort())
    expect(activeTab(h)).toBe(active)
    await b.redraw()
    expect(await headerHide(b)).toBeUndefined()
    // put away, the tabs keep being captured, at the closed rate: at most every 10 s each
    await h.clock.advance(POLL)
    const hiddenAt = h.clock.now()
    await h.clock.advance(30_000)
    for (const slot of ['01', '02']) {
      const at = h.fake.captureCalls().filter(c => c.args.slot === slot && c.at >= hiddenAt).map(c => c.at)
      expect(at.length, `${slot} still captured while put away`).toBeGreaterThan(0)
      expect(at.slice(1).every((t, i) => t - at[i]! >= 10_000), `${slot} at the closed rate`).toBe(true)
    }
    // the next Show brings it back, as it was: no view starts over
    const writes = h.writes.length
    const calls = h.uiCalls.length
    await pressChip(b, 'h-two', 'Show')
    expect(h.uiCalls[calls]).toBe('open')
    expect(h.opens.at(-1)?.id).toBe(SHOW_PANE)
    expect(activeTab(h)).toBe(active)
    expect(h.writes.slice(writes).filter(([k, v]) => k.startsWith('panes/') && (v as { status?: string } | null)?.status === 'waiting')).toHaveLength(0)
    await b.redraw()
    expect(await headerHide(b)).toBeDefined()
    // no row ever reads Hide
    for (const r of drawnRows(await b.drawn())) expect(chips(r, 'Hide')).toHaveLength(0)
    await b.unmount()
  })

  test(`R6.5: tabs follow the band — every slot is seeded waiting as soon as it is listed, before any Show; a run that leaves the band loses its views [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const a = await team($, h, 'run-a', ['a-one', 'a-two'])
    expect(h.opens).toHaveLength(0)
    const seeded = views(h)
    // each view's first write is `waiting`; the closed panel's capture then fills it before any Show
    const firstWrite = (id: string) => h.writes.find(([k]) => k === `panes/${id}`)?.[1] as { status?: string } | undefined
    expect([...seeded.entries()].map(([id, v]) => [v.slot, firstWrite(id)?.status]).sort()).toEqual([['01', 'waiting'], ['02', 'waiting']])
    expect([...seeded.values()].every(v => v.frame !== null), 'a screen is held before any Show').toBe(true)
    for (const id of seeded.keys()) expect(id).toMatch(TAB_ID)
    const aTabs = [...seeded.keys()]
    // run-a settles, run-b starts: run-a is no longer drawn
    h.fake.set(a.runId, '01', 'COMPLETED')
    h.fake.set(a.runId, '02', 'COMPLETED')
    await h.clock.advance(POLL)
    await team($, h, 'run-b', ['b-one'])
    await h.clock.advance(POLL)
    for (const id of aTabs) expect(h.state.get(`panes/${id}`) ?? null, `${id} cleared`).toBeNull()
    expect([...views(h).values()].map(v => v.model)).toEqual(['b-one'])
    const b = await mountBand($, surface, bandProps(160))
    await pressChip(b, 'b-one', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(100, 24))
    expect(await tabLabels(p)).toEqual(['b-one'])
    expect(visibleText(await p.drawn())).not.toMatch(/a-one|a-two/)
    await p.unmount()
    await b.unmount()
  })

  test(`R6.5: tab labels — the model; two tabs sharing a model add the slot id, label/slot across runs, or a delegation's label [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'dupes', ['kimi-k3', 'kimi-k3', 'glm-5.3'])
    const b = await mountBand($, surface, bandProps(180, 30))
    await pressChip(b, 'glm-5.3', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 24))
    expect(await tabLabels(p)).toEqual(['kimi-k3 01', 'kimi-k3 02', 'glm-5.3'])
    // a delegation of a model the team also runs: two runs drawn, so the team's place is label/slot
    await team($, h, 'tt', ['haiku-4.5'])
    const s = await delegate($, h)
    await b.redraw()
    await p.redraw()
    const labels = await tabLabels(p)
    const label = `#${s.id.slice(0, 6)}`
    expect(labels).toContain('haiku-4.5 tt/01')
    expect(labels).toContain(`haiku-4.5 ${label}`)
    expect(labels.some(l => l.includes(s.id))).toBe(false) // never the session id
    expect(labels).toContain('kimi-k3 dupes/01')
    expect(labels).toContain('kimi-k3 dupes/02')
    expect(labels).toContain('glm-5.3') // unique: the model alone
    await p.unmount()
    await b.unmount()
  })

  test(`R6.5: the strip — ● label per tab, dots in the state's hue, labels inactive, the shown one bold in run text on the run quiet fill, │ between tabs, a ─ rule the pane's width; pressing a tab shows it [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'strip', ['s-one', 's-two', 's-three'])
    h.fake.set(r.runId, '03', 'COMPLETED')
    await h.clock.advance(POLL)
    const b = await mountBand($, surface, bandProps(160))
    await pressChip(b, 's-one', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(90, 24))
    let tree = await p.drawn()
    const text = visibleText(tree)
    for (const l of ['s-one', 's-two', 's-three']) expect(text).toContain(` ● ${l} `)
    // dots: run hue for the live slots, done hue for the ended one (palette.text, the hue itself in dark)
    const dots: unknown[] = []
    for (const x of runsOf(tree)) for (const ch of Array.from(x.text)) if (ch === '●') dots.push(x.color)
    expect(dots).toEqual([DARK.run, DARK.run, DARK.done])
    // the shown tab: bold, run text colour, on the run hue's quiet fill; the others inactive
    for (const ink of inkOf(tree, 's-one')) {
      expect(ink.bold).toBe(true)
      expect(ink.color).toBe(DARK.run)
      expect(QUIET_DARK.run.map(c => c.toUpperCase())).toContain(String(ink.backgroundColor).toUpperCase())
    }
    for (const l of ['s-two', 's-three']) for (const ink of inkOf(tree, l)) expect(ink.color).toBe('inactive')
    // separators and the rule
    const seps = runsOf(tree).filter(x => x.text.includes('│'))
    expect(seps.reduce((n, x) => n + Array.from(x.text).filter(c => c === '│').length, 0)).toBe(2)
    for (const x of seps) expect(x.color).toBe('subtle')
    const rule = runsOf(tree).filter(x => x.text === '─'.repeat(90))
    expect(rule).toHaveLength(1)
    expect(rule[0]!.color).toBe('subtle')
    // the strip draws no Stop or Show: its Buttons are the tabs and, since R10.3, one Hide
    expect(await tabLabels(p)).toEqual(['s-one', 's-two', 's-three'])
    expect((await p.findAll({ type: 'Button' })).filter(f => f.props.label === 'Hide')).toHaveLength(1)
    // pressing a tab shows it
    const tab = (await p.findAll({ type: 'Button' })).find(f => f.props.label === 's-three')!
    await p.press({ key: tab.key! })
    expect(views(h).get(activeTab(h)!)).toMatchObject({ slot: '03' })
    await p.redraw()
    tree = await p.drawn()
    for (const ink of inkOf(tree, 's-three')) expect(ink.bold).toBe(true)
    for (const ink of inkOf(tree, 's-one')) expect(ink.color).toBe('inactive')
    expect(visibleText(await tabHeader(p, 's-three'))).toMatch(/^ END /)
    await p.unmount()
    await b.unmount()
  })

  test(`R6.5: the shown tab is the one last picked while it is a tab, else the first; no tab at all reads "No run to show." dim [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const empty = await mountPane($, surface, SHOW_PANE, paneProps(100, 24))
    const none = await empty.find({ type: 'Text', text: 'No run to show.' })
    expect(none).toBeDefined()
    expect(none!.props.dimColor).toBe(true)
    await empty.unmount()
    const a = await team($, h, 'first-a', ['fa-one'])
    const b = await mountBand($, surface, bandProps(160))
    await pressChip(b, 'fa-one', 'Show')
    // the picked tab's run leaves the band: the first tab is shown
    h.fake.set(a.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    await team($, h, 'first-b', ['fb-one', 'fb-two'])
    await h.clock.advance(POLL)
    const p = await mountPane($, surface, SHOW_PANE, paneProps(100, 24))
    expect(await tabLabels(p)).toEqual(['fb-one', 'fb-two'])
    expect(visibleText(await tabHeader(p, 'fb-one'))).toContain('fb-one')
    expect(await p.find({ type: 'Text', text: 'No run to show.' })).toBeUndefined()
    await p.unmount()
    await b.unmount()
  })

  // The top-aligned screen (R6.5) is pinned by v2-show.test.ts, rewritten from bottom-aligned.
}

