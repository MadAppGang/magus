// R10.1–R10.3 only, written from spec.md and the public contract, without implementation reads.
// Observation boundary: recorded MCP requests (resize, capture, list), ui.open/ui.close, the drawn
// panel and band, and the published showTab / panes state. No private resize state is inspected.
// Run with the host's engine kit (`claude plugin test plugins/claudish`). See R10-TEST-PLAN.md for ids.

import { expect, type Engine } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start, type Harness, type Recorded } from '../fake-claudish'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, walk, type Mounted, type Node } from '../ui'
import { POLL, delegate, team } from './support'
import { expectInk, keyOf, pressChip, visibleText } from './v2-support'
import { SHOW_PANE, activeTab, expectFlushRight, views } from './r6-support'


const isResize = (c: Recorded) => c.tool === 'resize_session' || (c.tool === 'team' && c.args.mode === 'resize')
const isCapture = (c: Recorded) => c.tool === 'capture_session' || (c.tool === 'team' && c.args.mode === 'capture')
const sessionResizes = (h: Harness, id: string) => h.fake.resizeCalls().filter(c => c.tool === 'resize_session' && c.args.session_id === id)
const sessionCaptures = (h: Harness, id: string) => h.fake.captureCalls().filter(c => c.tool === 'capture_session' && c.args.session_id === id)
const sizes = (calls: Recorded[]) => calls.map(c => [c.args.cols, c.args.rows])

/** Bounded mock time, with an assertion if the required external event never occurs. */
async function until(h: Harness, ready: () => boolean, what: string, within = 7_000): Promise<void> {
  await h.clock.settle()
  for (let elapsed = 0; !ready() && elapsed < within; elapsed += 50) await h.clock.advance(50)
  await h.clock.settle()
  expect(ready(), what).toBe(true)
}

/** Show `model`, draw the panel at columns x rows, and wait for the first resize: the panel's size is now known. */
async function drawOnce($: Engine, h: Harness, surface: (typeof SURFACES)[number], model: string, columns: number, rows: number) {
  const b = await mountBand($, surface, bandProps(200, 30))
  await pressChip(b, model, 'Show')
  const p = await mountPane($, surface, SHOW_PANE, paneProps(columns, rows))
  await until(h, () => h.fake.resizeCalls().length > 0, 'the drawn panel resizes its shown session')
  return { b, p }
}

/** The band header's Hide (R6.5): puts the panel away. The test then drops its own mount of the pane. */
async function hideFromBand(h: Harness, b: Mounted, p: Mounted): Promise<void> {
  await b.redraw()
  const hide = (await b.findAll({ type: 'Button' })).filter(x => x.props.label === 'Hide')
  expect(hide).toHaveLength(1)
  await b.press({ key: hide[0]!.key! })
  await p.unmount()
  expect(h.closes).toContain(SHOW_PANE)
  expect(h.panes.filter(x => x.id === SHOW_PANE)).toHaveLength(0)
}

async function reopen($: Engine, b: Mounted, surface: (typeof SURFACES)[number], model: string, columns: number, rows: number) {
  await b.redraw()
  await pressChip(b, model, 'Show')
  return mountPane($, surface, SHOW_PANE, paneProps(columns, rows))
}

/** R10.3: the panel's own Hide Button (exactly one), and the strip row holding it and the tabs. */
async function panelHide(p: Mounted): Promise<{ hide: Node; strip: Node; tree: unknown }> {
  const tree = await p.drawn()
  const nodes = walk(tree).map(x => x.node)
  const hides = nodes.filter(n => n.type === 'Button' && n.props?.label === 'Hide')
  expect(hides, 'the panel draws exactly one Hide').toHaveLength(1)
  const hide = hides[0]!
  const tabsOf = (n: Node) => walk(n).map(x => x.node).filter(x => x.type === 'Button' && x.props?.label !== 'Hide')
  const holders = nodes.filter(n => n.type === 'Box' && walk(n).some(x => x.node === hide) && tabsOf(n).length > 0)
  // the deepest Box holding Hide and a tab is the strip's row
  const strip = holders.filter(n => !holders.some(o => o !== n && walk(n).slice(1).some(x => x.node === o))).at(-1)
  expect(strip, 'Hide sits in the tab strip row, with the tabs').toBeDefined()
  return { hide, strip: strip!, tree }
}

for (const surface of SURFACES) {
  // ── R10.1 ──────────────────────────────────────────────────────────────────

  // TEST-R10-1 / REQ-R10-1, REQ-R10-2, REQ-R10-3
  test(`R10.1 TEST-R10-1: a session started while the panel is closed, after it drew, is resized to the panel's last size at a tick, with no capture [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'closed-start', ['closed-one'])
    const { b, p } = await drawOnce($, h, surface, 'closed-one', 120, 40)
    // the panel's LAST size is the one kept: redraw before hiding
    await p.redraw(paneProps(130, 44))
    await until(h, () => h.fake.resizeCalls().some(c => c.args.cols === 130), 'the redraw size reaches the shown session')
    await hideFromBand(h, b, p)
    const captures = h.fake.captureCalls().length

    const s = await delegate($, h)
    await until(h, () => sessionResizes(h, s.id).length > 0, 'the new session is resized while the panel is closed', 3_000)
    await h.clock.advance(4_000) // once per size

    expect(sessionResizes(h, s.id).map(c => ({ tool: c.tool, args: c.args }))).toEqual([
      { tool: 'resize_session', args: { session_id: s.id, cols: 130, rows: 41 } },
    ])
    expect(sessionCaptures(h, s.id), 'resized without any capture').toHaveLength(0)
    expect(h.fake.captureCalls(), 'no capture at all while the panel is closed').toHaveLength(captures)
    await b.unmount()
  })

  // TEST-R10-2 / REQ-R10-2: before the panel has ever drawn in this load, there is no size to give.
  test(`R10.1 TEST-R10-2: no session is resized before the panel has ever drawn, open or not [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'never-drawn', ['never-one', 'never-two'])
    const s = await delegate($, h)
    const b = await mountBand($, surface, bandProps(200, 30))
    await h.clock.advance(10_000)
    expect(h.fake.resizeCalls()).toHaveLength(0)
    expect(h.fake.listCalls().length, 'the runs were polled, so a resize had its chance').toBeGreaterThan(2)

    await pressChip(b, 'never-one', 'Show') // open, not yet drawn
    await h.clock.advance(3_000)
    expect(h.fake.resizeCalls()).toHaveLength(0)

    // positive control: the first drawing makes every running session eligible
    const p = await mountPane($, surface, SHOW_PANE, paneProps(110, 30))
    await until(h, () => h.fake.resizeCalls().length >= 3, 'the first drawing resizes every running session')
    await h.clock.advance(3_000)
    const calls = h.fake.resizeCalls()
    expect(calls).toHaveLength(3)
    expect(calls.every(c => c.args.cols === 110 && c.args.rows === 27)).toBe(true)
    expect(calls.filter(c => c.tool === 'team' && c.args.run_id === r.runId).map(c => c.args.slot).sort()).toEqual(['01', '02'])
    expect(sessionResizes(h, s.id)).toHaveLength(1)
    await p.unmount()
    await b.unmount()
  })

  // TEST-R10-3 / REQ-R10-4: a feed whose resize is false is never resized, panel open or closed.
  test(`R10.1 TEST-R10-3: a feed without resize is never resized, while open, while closed, or for a session started while closed [${surface}]`, async ($, on) => {
    const h = harness(on, { noResize: true })
    await start($, surface)
    await team($, h, 'no-resize', ['nr-one'])
    const b = await mountBand($, surface, bandProps(200, 30))
    await pressChip(b, 'nr-one', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(120, 40))
    await until(h, () => h.fake.captureCalls().length > 0, 'positive control: the drawn panel captures')
    await h.clock.advance(3_000)
    await hideFromBand(h, b, p)
    await delegate($, h)
    await h.clock.advance(6_000)
    const again = await reopen($, b, surface, 'nr-one', 150, 46)
    const captures = h.fake.captureCalls().length
    await until(h, () => h.fake.captureCalls().length > captures, 'positive control: the reopened panel captures')
    await h.clock.advance(6_000)

    expect(h.fake.resizeCalls()).toHaveLength(0)
    expect(h.fake.listCalls().length).toBeGreaterThan(0)
    await again.unmount()
    await b.unmount()
  })

  // TEST-R10-4 / REQ-R10-3, REQ-R10-4, REQ-R10-5: started and finished entirely while closed.
  test(`R10.1 TEST-R10-4: a session started and finished entirely while the panel is closed was resized while it ran, and never after [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'short-run', ['short-keep'])
    const { b, p } = await drawOnce($, h, surface, 'short-keep', 120, 40)
    await hideFromBand(h, b, p)
    const captures = h.fake.captureCalls().length

    const s = await delegate($, h)
    await until(h, () => sessionResizes(h, s.id).length > 0, 'resized at its first tick', 3_000)
    const resizedAt = sessionResizes(h, s.id)[0]!.at
    h.fake.set(s.id, s.id, 'COMPLETED')
    const endedAt = h.clock.now()
    await h.clock.advance(6_000)

    expect(sizes(sessionResizes(h, s.id))).toEqual([[120, 37]])
    expect(resizedAt).toBeLessThanOrEqual(endedAt)
    expect(sessionCaptures(h, s.id)).toHaveLength(0)
    expect(h.fake.captureCalls()).toHaveLength(captures)

    // reopening at a NEW size: the finished session is left alone (R10.1 last bullet)
    const again = await reopen($, b, surface, 'short-keep', 140, 40)
    await until(h, () => h.fake.resizeCalls().some(c => c.tool === 'team' && c.args.cols === 140), 'positive control: the live slot takes the new size')
    await h.clock.advance(3_000)
    expect(sizes(sessionResizes(h, s.id))).toEqual([[120, 37]])
    await again.unmount()
    await b.unmount()
  })

  // ── R10.2 ──────────────────────────────────────────────────────────────────

  // TEST-R10-5 / REQ-R10-5, REQ-R10-7: a session that ends is not resized again, even at a new panel size.
  test(`R10.2 TEST-R10-5: a session that ends is not resized again, while its live sibling takes each new size [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'end-later', ['end-keep'])
    const { b, p } = await drawOnce($, h, surface, 'end-keep', 120, 40)
    await hideFromBand(h, b, p)
    const s = await delegate($, h)
    await until(h, () => sessionResizes(h, s.id).length > 0, 'the session is resized while it runs', 3_000)
    h.fake.set(s.id, s.id, 'COMPLETED')
    await h.clock.advance(POLL * 2)

    const again = await reopen($, b, surface, 'end-keep', 150, 46)
    await until(h, () => h.fake.resizeCalls().some(c => c.tool === 'team' && c.args.cols === 150), 'the live sibling takes the new size')
    await again.redraw(paneProps(160, 46))
    await until(h, () => h.fake.resizeCalls().some(c => c.tool === 'team' && c.args.cols === 160), 'and the next one')
    await h.clock.advance(3_000)

    expect(sizes(sessionResizes(h, s.id))).toEqual([[120, 37]])
    expect(sizes(h.fake.resizeCalls().filter(c => c.tool === 'team'))).toEqual([[120, 37], [150, 43], [160, 43]])
    await again.unmount()
    await b.unmount()
  })

  // TEST-R10-6 / REQ-R10-6: Hide → reopen at the same size sends nothing, for every running session.
  test(`R10.2 TEST-R10-6: hiding and reopening the panel at the same size sends no resize to any running session [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'same-size', ['same-one', 'same-two'])
    const s = await delegate($, h)
    const { b, p } = await drawOnce($, h, surface, 'same-one', 120, 40)
    await until(h, () => h.fake.resizeCalls().length >= 3, 'every running session takes the size')
    await h.clock.advance(3_000)
    expect(h.fake.resizeCalls()).toHaveLength(3)

    await hideFromBand(h, b, p)
    await h.clock.advance(6_000) // closed, every session still running, its size unchanged
    expect(h.fake.resizeCalls()).toHaveLength(3)

    const captures = h.fake.captureCalls().length
    const again = await reopen($, b, surface, 'same-one', 120, 40)
    await until(h, () => h.fake.captureCalls().length > captures, 'positive control: the reopened panel captures')
    await h.clock.advance(6_000)

    expect(h.fake.resizeCalls()).toHaveLength(3)
    expect(sizes(h.fake.resizeCalls()).every(([c, r]) => c === 120 && r === 37)).toBe(true)
    expect(sessionResizes(h, s.id)).toHaveLength(1)
    // switching the shown tab is not a new size either
    await b.redraw()
    await pressChip(b, 'same-two', 'Show')
    await h.clock.advance(3_000)
    expect(h.fake.resizeCalls()).toHaveLength(3)
    await again.unmount()
    await b.unmount()
  })

  // TEST-R10-7 / REQ-R10-7: a new size reaches every running session once, the shown one before its capture.
  test(`R10.2 TEST-R10-7: a new panel size resizes each running session once at its next tick; the shown tab before its capture [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'new-size', ['new-one', 'new-two'])
    const s = await delegate($, h)
    const { b, p } = await drawOnce($, h, surface, 'new-one', 120, 40)
    await until(h, () => h.fake.resizeCalls().length >= 3, 'first size everywhere')
    const before = h.fake.calls.length
    const drawnAt = h.clock.now()

    await p.redraw(paneProps(100, 30))
    await until(h, () => h.fake.resizeCalls().filter(c => c.args.cols === 100).length >= 3, 'the new size everywhere', 3_000)
    await h.clock.advance(4_000)

    const fresh = h.fake.calls.slice(before).filter(isResize)
    expect(fresh).toHaveLength(3)
    expect(fresh.every(c => c.args.cols === 100 && c.args.rows === 27 && c.at - drawnAt < 3_000)).toBe(true)
    expect(sessionResizes(h, s.id).map(c => c.args.cols)).toEqual([120, 100])
    const shown = fresh.find(c => c.tool === 'team' && c.args.slot === '01')!
    const next = h.fake.calls.slice(h.fake.calls.indexOf(shown) + 1)
      .find(c => (isResize(c) || isCapture(c)) && c.tool === 'team' && c.args.slot === '01' && c.args.run_id === shown.args.run_id)
    expect(next && isCapture(next), 'the shown tab: its resize, then its capture').toBe(true)
    await p.unmount()
    await b.unmount()
  })

  // TEST-R10-8 / REQ-R10-8 (re-synced R10.2): missing from list answers is not leaving; the run stays in the
  // mod's list, so the session listed again is the same pane at the same size and is NOT asked again.
  test(`R10.2 TEST-R10-8: a running session absent from list answers and listed again at the same size is not resized again; a new size still resizes it once [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const r = await team($, h, 'unlisted', ['gone-one'])
    const { b, p } = await drawOnce($, h, surface, 'gone-one', 120, 40)
    await h.clock.advance(4_000)
    expect(h.fake.resizeCalls()).toHaveLength(1) // once per size while listed

    r.hidden = true
    const listed = h.fake.listCalls('runs').length
    await until(h, () => h.fake.listCalls('runs').length >= listed + 2, 'two polls answer without the run')
    r.hidden = false
    const relisted = h.fake.listCalls('runs').length
    await until(h, () => h.fake.listCalls('runs').length >= relisted + 2, 'two polls answer with the run again')
    const captures = h.fake.captureCalls().length
    await h.clock.advance(4_000)

    // control: the panel is still open and capturing the relisted session, so a resize had its chance
    expect(h.fake.captureCalls().length).toBeGreaterThan(captures)
    expect(sizes(h.fake.resizeCalls())).toEqual([[120, 37]])

    // positive control: a new panel size still reaches the session, exactly once
    await p.redraw(paneProps(130, 44))
    await until(h, () => h.fake.resizeCalls().length >= 2, 'a new size resizes the relisted session')
    await h.clock.advance(3_000)
    expect(sizes(h.fake.resizeCalls())).toEqual([[120, 37], [130, 41]])
    expect(h.fake.resizeCalls().every(c => c.tool === 'team' && c.args.run_id === r.runId && c.args.slot === '01')).toBe(true)
    await p.unmount()
    await b.unmount()
  })

  // ── R10.3 ──────────────────────────────────────────────────────────────────

  // TEST-R10-9 / REQ-R10-9: the strip ends with [ Hide ], drawn as the band's Hide.
  test(`R10.3 TEST-R10-9: the tab strip row ends with a [ Hide ] Button, flush right, in suggestion, bold, 8 cells [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'strip-hide', ['sh-one', 'sh-two'])
    const b = await mountBand($, surface, bandProps(200, 30))
    await pressChip(b, 'sh-one', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(100, 24))
    await h.clock.advance(POLL)
    await p.redraw()

    const { hide, strip, tree } = await panelHide(p)
    expect(visibleText(hide)).toBe('[ Hide ]')
    expectInk(hide, '[ Hide ]', { color: 'suggestion', bold: true, backgroundColor: undefined })
    const boxes = walk(tree).map(x => x.node).filter(n => n.type === 'Box' && walk(n).some(x => x.node === hide))
    expect(boxes.some(n => n.props?.width === 8), 'Hide in an 8-cell box').toBe(true)
    const text = visibleText(strip)
    expect(text.indexOf('sh-one')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('sh-two')).toBeLessThan(text.indexOf('[ Hide ]'))
    expectFlushRight(strip, 100, '[ Hide ]')
    // the tabs are still the strip's other Buttons
    expect((await p.findAll({ type: 'Button' })).map(f => f.props.label).filter(l => l !== 'Hide')).toEqual(['sh-one', 'sh-two'])
    await p.unmount()
    await b.unmount()
  })

  // TEST-R10-10 / REQ-R10-9: tabs shrink first; Hide never shrinks.
  test(`R10.3 TEST-R10-10: in a narrow panel with long tab labels, Hide stays whole and flush right [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'narrow-hide', ['a-rather-long-model-name-one', 'a-rather-long-model-name-two', 'a-rather-long-model-name-three'])
    const b = await mountBand($, surface, bandProps(200, 30))
    await pressChip(b, 'a-rather-long-model-name-one', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(44, 24))
    await h.clock.advance(POLL)
    await p.redraw()

    const { hide, strip, tree } = await panelHide(p)
    expect(visibleText(hide)).toBe('[ Hide ]')
    const boxes = walk(tree).map(x => x.node).filter(n => n.type === 'Box' && walk(n).some(x => x.node === hide))
    expect(boxes.some(n => n.props?.width === 8)).toBe(true)
    expect(visibleText(strip).endsWith('[ Hide ]')).toBe(true)
    expect(Array.from(visibleText(strip)).length).toBeLessThanOrEqual(44)
    await p.unmount()
    await b.unmount()
  })

  // TEST-R10-11 / REQ-R10-10: pressing it puts the panel away, as the band's Hide does.
  test(`R10.3 TEST-R10-11: pressing the panel's Hide closes claudish-show, keeps the tabs and views, and stops capture [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'press-hide', ['ph-one', 'ph-two'])
    const b = await mountBand($, surface, bandProps(200, 30))
    await pressChip(b, 'ph-two', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(100, 24))
    await until(h, () => h.fake.captureCalls().length > 0, 'positive control: the open panel captures')
    const active = activeTab(h)
    const kept = [...views(h).keys()].sort()
    expect(kept).toHaveLength(2)

    const { hide } = await panelHide(p)
    await p.press({ key: keyOf(hide) })
    expect(h.closes).toEqual([SHOW_PANE])
    expect(h.panes.filter(x => x.id === SHOW_PANE)).toHaveLength(0)
    expect([...views(h).keys()].sort()).toEqual(kept)
    expect(activeTab(h)).toBe(active)
    await p.unmount()
    await b.redraw()
    expect((await b.findAll({ type: 'Button' })).filter(x => x.props.label === 'Hide'), 'the band header has no Hide once closed').toHaveLength(0)
    await h.clock.advance(POLL)
    const n = h.fake.captureCalls().length
    await h.clock.advance(8_000)
    expect(h.fake.captureCalls()).toHaveLength(n)
    await b.unmount()
  })

  // TEST-R10-12 / REQ-R10-10: the next Show reopens the panel with the same tabs.
  test(`R10.3 TEST-R10-12: after the panel's Hide, the next Show reopens the one panel with the same tabs [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await team($, h, 'reopen-hide', ['rh-one', 'rh-two', 'rh-three'])
    const b = await mountBand($, surface, bandProps(200, 30))
    await pressChip(b, 'rh-two', 'Show')
    const p = await mountPane($, surface, SHOW_PANE, paneProps(110, 24))
    await h.clock.advance(POLL)
    const tabs = (await p.findAll({ type: 'Button' })).map(f => f.props.label).filter(l => l !== 'Hide')
    expect(tabs).toEqual(['rh-one', 'rh-two', 'rh-three'])
    const ids = [...views(h).keys()].sort()

    await p.press({ key: keyOf((await panelHide(p)).hide) })
    await p.unmount()
    expect(h.closes).toContain(SHOW_PANE)
    const opens = h.opens.length

    const again = await reopen($, b, surface, 'rh-two', 110, 24)
    expect(h.opens.length).toBe(opens + 1)
    expect(h.opens.at(-1)!.id).toBe(SHOW_PANE)
    expect(h.panes.map(x => x.id)).toEqual([SHOW_PANE])
    expect((await again.findAll({ type: 'Button' })).map(f => f.props.label).filter(l => l !== 'Hide')).toEqual(tabs)
    expect([...views(h).keys()].sort()).toEqual(ids)
    expect(views(h).get(activeTab(h)!)).toMatchObject({ model: 'rh-two' })
    await panelHide(again) // and the reopened panel carries its Hide again
    await again.unmount()
    await b.unmount()
  })
}
