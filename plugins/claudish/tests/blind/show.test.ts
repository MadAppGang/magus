// Blind tests: Show, one read-only live tab per slot or session (spec "Layout", "Buttons",
// "Non-functional"; decisions-rev4 #2; mod contract §D; UI contract §4.2 frame colours).

import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, mountPane, paneProps, walk, SURFACES } from '../ui'
import { SLOW, buttonsIn, keyOf, labelOf, modVerbs, nodesOf, rowFor, showButton, startDelegation, startTeam, textOf } from './helpers'

const WIDE = bandProps(200, 40)
const HEX = /^#[0-9a-f]{6}$/

/** The mod may only read (list/status/capture) and cancel; nothing it sends is input to a child. */
// R7.3: a resize is not input, so `team` mode `resize` and `resize_session` join the allowed calls.
const ALLOWED_VERBS = ['team:list', 'team:status', 'team:capture', 'team:cancel', 'team:resize', 'list_sessions', 'capture_session', 'cancel_session', 'resize_session']

/** R6.5: the one Show pane, and the shown tab (a slot's view id) from the published `showTab` state. */
const PANE = 'claudish-show'
const shownSlot = (h: ReturnType<typeof harness>) => {
  const active = (h.state.get('showTab') as { active?: string | null } | undefined)?.active
  return active ? (h.state.get(`panes/${active}`) as { slot?: string; model?: string } | null | undefined) : undefined
}
/** The band's Hide: a Button labelled Hide in no row (R6.5 moved it to the header). */
function headerHide(tree: unknown) {
  return buttonsIn(tree).filter(b => labelOf(b) === 'Hide')[0]
}

test('show: one pane for every slot — Show opens claudish-show on the slot tab; the header Hide closes it; Show again reuses the pane; another slot switches the tab', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const s1 = `s1-${surface}`, s2 = `s2-${surface}`
    await startTeam($, h, `show-tabs-${surface}`, [s1, s2])
    await h.clock.advance(3_000)
    const ui = await mountBand($, surface, WIDE)
    const opens0 = h.opens.length

    await ui.press({ key: keyOf(showButton(rowFor(await ui.drawn(), s1))!)! })
    expect(h.opens.length - opens0, `${surface}: one open`).toBe(1)
    const first = h.opens[h.opens.length - 1]!
    expect(first.id, `${surface}: the one Show pane`).toBe(PANE)
    expect(first.title, `${surface}: titled claudish, not by model`).toBe('claudish')
    expect(shownSlot(h)?.model, `${surface}: that slot's tab is shown`).toBe(s1)

    // R6.5: the row keeps reading Show; Hide is in the header while the pane is open and drawn
    await ui.redraw(WIDE as never)
    expect(showButton(rowFor(await ui.drawn(), s1)), `${surface}: Show stays on the row`).toBeDefined()
    expect(rowFor(await ui.drawn(), s1) && buttonsIn(rowFor(await ui.drawn(), s1)!).some(b => labelOf(b) === 'Hide'), `${surface}: no Hide on a row`).toBe(false)
    const hide = headerHide(await ui.drawn())
    expect(hide && labelOf(hide), `${surface}: Hide in the header`).toBe('Hide')
    await ui.press({ key: keyOf(hide!)! })
    expect(h.closes, `${surface}: Hide closed the pane`).toContain(PANE)
    expect(h.panes.filter(p => p.id === PANE), `${surface}: pane gone`).toHaveLength(0)
    await ui.redraw(WIDE as never)
    expect(headerHide(await ui.drawn()), `${surface}: no Hide once closed`).toBeUndefined()
    const back = showButton(rowFor(await ui.drawn(), s1))
    await ui.press({ key: keyOf(back!)! })
    const again = h.opens[h.opens.length - 1]!
    expect(again.id, `${surface}: reopen reuses the pane`).toBe(PANE)
    expect(h.panes.filter(p => p.id === PANE), `${surface}: still one pane`).toHaveLength(1)

    await ui.press({ key: keyOf(showButton(rowFor(await ui.drawn(), s2))!)! })
    expect(h.opens.every(o => o.id === PANE), `${surface}: never one pane per slot`).toBe(true)
    expect(shownSlot(h)?.model, `${surface}: another slot, another tab`).toBe(s2)
    expect(h.panes.map(p => p.id)).toEqual([PANE])
    await ui.unmount()
  }
})

test('show: a delegation shows in its own tab and captures by session_id', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const model = `dshow-${surface}`
    const s = await startDelegation($, h, model, 'task')
    await h.clock.advance(3_000)
    const ui = await mountBand($, surface, WIDE)
    await ui.press({ key: keyOf(showButton(rowFor(await ui.drawn(), model))!)! })
    const opened = h.opens[h.opens.length - 1]!
    expect(opened.id).toBe(PANE)
    expect(shownSlot(h)?.model).toBe(model)
    await h.clock.advance(3_000)
    const caps = h.fake.captureCalls().filter(c => c.args.session_id === s.id)
    expect(caps.length, surface).toBeGreaterThan(0)
    expect(caps.every(c => c.tool === 'capture_session')).toBe(true)
    await ui.unmount()
  }
})

test('show: the tab is a read-only live view, captured only while the panel is open, with since_seq', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const model = `live-${surface}`
    const run = await startTeam($, h, `show-live-${surface}`, [model, `quiet-${surface}`])
    const capsOf = (slot: string) => h.fake.captureCalls().filter(c => c.args.run_id === run.runId && c.args.slot === slot)
    await h.clock.advance(5_000)
    expect(capsOf('01'), `${surface}: no capture before the panel is open`).toHaveLength(0)
    expect(capsOf('02'), `${surface}: no capture before the panel is open`).toHaveLength(0)

    const band = await mountBand($, surface, WIDE)
    await band.press({ key: keyOf(showButton(rowFor(await band.drawn(), model))!)! })
    await h.clock.advance(4_000)
    expect(capsOf('01').length, `${surface}: the shown tab repaints ~1 s`).toBeGreaterThanOrEqual(2)
    expect(capsOf('01').some(c => typeof c.args.since_seq === 'number'), `${surface}: since_seq on repeat`).toBe(true)
    expect(capsOf('01').every(c => c.args.path === run.path)).toBe(true)

    // A 30-row panel on the 160x50 screen: room 28 (less the strip and its rule), header 1, so the
    // last 27 non-blank lines of the screen: the prompt and status line stay, the banner is cut.
    const pane = await mountPane($, surface, PANE, paneProps(120, 30))
    const tree = await pane.drawn()
    const shown = textOf(tree)
    expect(shown, `${surface}: the child's status line (screen bottom)`).toMatch(new RegExp(`${model} · seq \\d+`))
    expect(shown, `${surface}: the child's prompt row`).toMatch(/^❯/m)
    expect(shown, `${surface}: a short tab cuts the top, not the bottom`).not.toContain('Claude Code v2.1.287')
    const kinds = new Set(nodesOf(tree).map(n => n.type))
    expect(kinds.has('Input'), `${surface}: no input field`).toBe(false)
    expect(kinds.has('Select'), `${surface}: no select`).toBe(false)

    const seqRe = new RegExp(`${model} · seq (\\d+)`)
    const counter = seqRe.exec(shown)?.[1]
    await h.clock.advance(3_000)
    const later = seqRe.exec(textOf(await pane.drawn()))?.[1]
    expect(counter, `${surface}: frame seq drawn`).toBeDefined()
    expect(later, `${surface}: frame seq still drawn`).toBeDefined()
    expect(later).not.toBe(counter)
    await pane.unmount()

    // The person closes the panel: capturing stops for every tab.
    h.panes = h.panes.filter(p => p.id !== PANE)
    await h.clock.advance(3_000)
    const n = h.fake.captureCalls().length
    await h.clock.advance(6_000)
    expect(h.fake.captureCalls().length, `${surface}: no capture once the panel is closed`).toBe(n)
    await band.unmount()
  }
  expect(modVerbs(h).filter(v => !ALLOWED_VERBS.includes(v)), 'the mod sent no input to claudish').toEqual([])
})

test('show: the child colours are painted inside the frame when capture_spans is advertised', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  for (const surface of SURFACES) {
    const model = `paint-${surface}`
    await startTeam($, h, `show-spans-${surface}`, [model])
    await h.clock.advance(3_000)
    const band = await mountBand($, surface, WIDE)
    await band.press({ key: keyOf(showButton(rowFor(await band.drawn(), model))!)! })
    const id = h.opens[h.opens.length - 1]!.id
    await h.clock.advance(3_000)
    const pane = await mountPane($, surface, id, paneProps(170, 52))
    const colours: string[] = []
    let frameSeen = false
    for (const { node, inFrame } of walk(await pane.drawn())) {
      if (node.type === 'Box' && (node.props?.key === 'frame' || (node as { key?: unknown }).key === 'frame')) frameSeen = true
      if (!inFrame) continue
      for (const prop of ['color', 'backgroundColor']) {
        const v = node.props?.[prop]
        if (v !== undefined) colours.push(String(v))
      }
    }
    expect(frameSeen, `${surface}: frame Box drawn`).toBe(true)
    expect(colours.length, `${surface}: spans painted`).toBeGreaterThan(0)
    for (const c of colours) expect(c, `${surface}: frame colours are #rrggbb`).toMatch(HEX)
    expect(colours, `${surface}: the truecolor border`).toContain('#5f87af')
    await pane.unmount()
    await band.unmount()
  }
})

test('show: without capture_spans the frame is plain text, no colour', SLOW, async ($, on) => {
  const h = harness(on, { noSpans: true })
  await start($)
  for (const surface of SURFACES) {
    const model = `plain-${surface}`
    await startTeam($, h, `show-plain-${surface}`, [model])
    await h.clock.advance(3_000)
    const band = await mountBand($, surface, WIDE)
    await band.press({ key: keyOf(showButton(rowFor(await band.drawn(), model))!)! })
    const id = h.opens[h.opens.length - 1]!.id
    await h.clock.advance(3_000)
    const pane = await mountPane($, surface, id, paneProps(170, 52))
    const tree = await pane.drawn()
    expect(textOf(tree), surface).toContain('Claude Code v2.1.287')
    for (const { node, inFrame } of walk(tree)) {
      if (!inFrame) continue
      expect(node.props?.color, `${surface}: no colour in a plain frame`).toBeUndefined()
      expect(node.props?.backgroundColor).toBeUndefined()
    }
    await pane.unmount()
    await band.unmount()
  }
})
