// The band above the prompt and its two buttons, drawn through the plugin on both
// surfaces: header and rows, live values, colours, narrow widths, Stop (press twice
// within 4 s) and Show (one tab per slot).

import { expect, test } from 'claude-code/testing'
import type { ClaudishRuns, ClaudishStopRequest } from '../types'
import { SHOW_COLUMNS, SHOW_PANE_ID, SHOW_PANE_TITLE, SHOW_ROWS, STOP_CONFIRM_MS, STOP_SENT_TIMEOUT_MS, THEME_KEYS } from '../hooks/status/domain'
import { ENGINE_DRAWING, engineOwn, TEAM_TOOL, harness, start, type Harness } from './fake-claudish'
import { SURFACES, bandProps, mountBand, mountPane, texts, walk, type Mounted } from './ui'

const runs = (h: Harness) => (h.state.get('runs') ?? { epoch: 0, starts: {}, list: [] }) as ClaudishRuns
const stops = (h: Harness) => (h.state.get('stopRequests') ?? {}) as Record<string, ClaudishStopRequest>
const modRun = (h: Harness, i = 0) => runs(h).list[i]!

/** Spec §9/§10's dark palette (the kit sets no theme), worked from its table and formulas. */
const DARK = {
  run: '#89B4FA', done: '#22E06B', fail: '#FF4D5E', stopped: '#5A5E78',
  model: '#5B6CE0', modelQuiet: '#293165', tokensIn: '#0F592A', tokensOut: '#16803D', tools: '#4FD6BE', loops: '#B794F6', cost: '#FFD479',
  ink: '#0B0B12', snow: '#FFFFFF',
} as const

/**
 * R6.2/R6.5: a hue's quiet fill in the dark palette, the hue mixed 55 % toward black (tool calls,
 * loops and cost sit on it; so does the shown Show tab, on the run hue's). Where a channel lands on
 * an exact half the spec leaves the rounding open, so both spellings are allowed.
 */
function quiet(hex: string): string[] {
  const opts = [0, 1, 2].map(i => {
    const exact = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) * 0.45
    return Math.abs(exact - Math.floor(exact) - 0.5) < 1e-6 ? [Math.floor(exact), Math.ceil(exact)] : [Math.round(exact)]
  })
  const two = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
  return opts[0]!.flatMap(r => opts[1]!.flatMap(g => opts[2]!.map(b => `#${two(r)}${two(g)}${two(b)}`)))
}
const ALLOWED = [...THEME_KEYS, ...Object.values(DARK), ...[DARK.run, DARK.tools, DARK.loops, DARK.cost].flatMap(quiet)]
  .map(c => (c.startsWith('#') ? c.toUpperCase() : c))

/** The shown Show tab's id, from the published `showTab` state. */
const shownTab = (h: Harness) => (h.state.get('showTab') as { active?: string | null } | undefined)?.active ?? null

/** The band header's Hide button (R6.5), if drawn. */
async function headerHide(band: Mounted) {
  return (await band.findAll({ type: 'Button' })).find(b => b.props.label === 'Hide')
}

/** A team run of four slots, listed once. */
async function teamRun($: unknown, h: Harness, path = 'r1') {
  await ($ as { tool: { call: (e: unknown) => Promise<unknown> } }).tool.call({ tool: TEAM_TOOL, mode: 'run', path })
  await h.clock.advance(1000)
}

/** A row's status badge: the 3-letter code Text, with its ink and fill. */
async function badgeOf(band: Mounted, rowKey: string): Promise<{ code: string; color: unknown; backgroundColor: unknown } | undefined> {
  const row = await band.find({ key: `row:${rowKey}` })
  if (!row) return undefined
  const textOf = (n: { children?: unknown[]; props?: Record<string, unknown> }) => String(n.children?.[0] ?? n.props?.children ?? '')
  const cell = walk(row).map(w => w.node).find(n => n.type === 'Text' && n.props?.backgroundColor !== undefined && /^ ([A-Z]{3}|\?{3}) $/.test(textOf(n)))
  return cell ? { code: textOf(cell).trim(), color: cell.props?.color, backgroundColor: cell.props?.backgroundColor } : undefined
}

for (const surface of SURFACES) {
  test(`band: header and rows [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const run = h.fake.runs[0]!
    h.fake.set(run.runId, '03', 'COMPLETED')
    h.fake.set(run.runId, '04', 'FAILED', 'blocked')
    await h.clock.advance(1000)
    const band = await mountBand($, surface)
    const header = await band.find({ type: 'Text', text: /◆ claudish/ })
    expect(header?.text).toBe('◆ claudish  r1 · 2 running · 1 done · 1 failed')
    expect(await band.findAll({ type: 'Button', text: 'Show' })).toHaveLength(4)
    expect(await band.findAll({ type: 'Button', text: 'Stop' })).toHaveLength(2)
    // one row per slot, the live ones first
    const id = modRun(h).id
    const rows = (await band.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('row:')).map(b => b.key)
    expect(rows).toEqual([`row:${id}/01`, `row:${id}/02`, `row:${id}/03`, `row:${id}/04`])
    // R6.2/R6.4: a row with a timeline draws no activity; the failed slot's live cell ends on its reason
    expect(await band.find({ type: 'Text', text: 'blocked' })).toBeUndefined()
    const cell = await band.find({ type: 'Client', key: `timeline:${id}/04` })
    // R6.4: the kit reports the module resolved from the plugin root; the band names it ./flow.tsx
    expect(cell?.props.module === './flow.tsx' || /(^|\/)hooks\/status\/flow\.tsx$/.test(String(cell?.props.module))).toBe(true)
    await band.resize({ columns: (cell!.props.props as { width: number }).width, rows: 1, in: `timeline:${id}/04` })
    expect(await band.find({ text: ' blocked ', in: `timeline:${id}/04` })).toBeDefined()
  })

  test(`band: values change [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const band = await mountBand($, surface)
    const tokens = async () => (await texts(band)).find(t => /^\s*↑[\d.]+k?\s+↓[\d.]+k?\s*$/.test(t))
    const before = await tokens()
    expect(before).toBeDefined()
    await h.clock.advance(2000)
    expect(await tokens()).not.toBe(before)
  })

  test(`band: colours are theme keys, outside the frame [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const run = h.fake.runs[0]!
    const id = modRun(h).id
    h.fake.set(run.runId, '02', 'COMPLETED')
    h.fake.set(run.runId, '03', 'FAILED', 'api_error')
    h.fake.set(run.runId, '04', 'CANCELLED', 'cancelled')
    await h.clock.advance(1000)
    const band = await mountBand($, surface)
    await band.press({ key: `show:${id}/01` })
    await h.clock.advance(1000)
    const pane = await mountPane($, surface, SHOW_PANE_ID)
    let frameColours = 0
    for (const tree of [await band.drawn(), await pane.drawn()]) {
      for (const { node, inFrame } of walk(tree)) {
        for (const prop of ['color', 'backgroundColor'] as const) {
          const c = node.props?.[prop]
          if (c === undefined) continue
          if (inFrame) {
            expect(String(c)).toMatch(/^#[0-9a-f]{6}$/)
            frameColours += 1
          } else {
            // R6.6: theme keys, except the badges and value text, which draw the palette's hex (with R6.2's quiet inks)
            expect(ALLOWED, `${node.type}.${prop}=${String(c)}`).toContain(String(c).startsWith('#') ? String(c).toUpperCase() : c)
          }
        }
      }
    }
    expect(frameColours).toBeGreaterThan(0) // the tab is painted: the check covered a frame
    expect(await badgeOf(band, `${id}/01`)).toEqual({ code: 'RUN', color: DARK.ink, backgroundColor: DARK.run })
    expect(await badgeOf(band, `${id}/02`)).toEqual({ code: 'END', color: DARK.ink, backgroundColor: DARK.done })
    expect(await badgeOf(band, `${id}/03`)).toEqual({ code: 'ERR', color: DARK.ink, backgroundColor: DARK.fail })
    expect(await badgeOf(band, `${id}/04`)).toEqual({ code: 'STP', color: DARK.snow, backgroundColor: DARK.stopped })
  })

  test(`band: narrow — one line per row, columns dropped by priority, header alone below the floor [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const activities = /^(Bash|Read|thinking|background|finishing)\s*$/
    for (const cols of [120, 59, 41]) {
      const band = await mountBand($, surface, bandProps(cols))
      const rows = (await band.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('row:'))
      expect(rows).toHaveLength(4)
      for (const r of rows) expect(r.props.flexDirection).toBe('row')
      for (const t of await band.findAll({ type: 'Text' })) expect(t.props.wrap).toBe('truncate-end')
      if (cols <= 59) expect((await texts(band)).some(t => activities.test(t))).toBe(false)
      expect(await band.findAll({ type: 'Button', text: 'Show' })).toHaveLength(4)
      await band.unmount()
    }
    const narrow = await mountBand($, surface, bandProps(40)) // one cell below the floor: 2 + 2 + 5 + model (8 + 2) + 9 + 8 + 5 gaps = 41
    expect(await narrow.findAll({ type: 'Button' })).toHaveLength(0)
    expect((await narrow.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('row:'))).toHaveLength(0)
    expect((await narrow.find({ type: 'Text', text: /◆ claudish/ }))?.text).toBe('◆ claudish  r1 · 4 running')
  })

  test(`band: unreachable rows draw ???, never RUN; terminal rows keep their state [${surface}]`, async ($, on) => {
    let refuse = false
    const h = harness(on, { listAnswer: () => (refuse ? { deny: 'transport down' } : undefined) })
    await start($, surface)
    await teamRun($, h)
    h.fake.set(h.fake.runs[0]!.runId, '04', 'COMPLETED')
    await h.clock.advance(1000)
    refuse = true
    await h.clock.advance(1000)
    const id = modRun(h).id
    const band = await mountBand($, surface)
    expect((await badgeOf(band, `${id}/01`))?.code).toBe('???')
    expect((await badgeOf(band, `${id}/04`))?.code).toBe('END')
    refuse = false
    await h.clock.advance(31_000)
    expect((await badgeOf(band, `${id}/01`))?.code).toBe('RUN')
  })

  test(`band: the latest run stays drawn when settled; an older settled run folds into the earlier-run count; an older live run stays [${surface}]`, async ($, on) => {
    const h = harness(on, { models: ['m-a', 'm-b'] })
    await start($, surface)
    await teamRun($, h)
    const run = h.fake.runs[0]!
    h.fake.set(run.runId, '01', 'COMPLETED')
    h.fake.set(run.runId, '02', 'FAILED', 'api_error')
    await h.clock.advance(1000)
    await h.clock.advance(2 * 3600_000)
    const band = await mountBand($, surface)
    // the most recent run is drawn however long ago it settled
    expect((await band.find({ type: 'Text', text: /◆ claudish/ }))?.text).toBe('◆ claudish  r1 · 1 done · 1 failed')
    expect(await band.findAll({ type: 'Button', text: 'Show' })).toHaveLength(2)
    // a newer run starts: the settled one is no longer drawn, only counted
    await teamRun($, h, 'r2')
    const second = modRun(h, 1).id
    const rowKeys = async () => (await band.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('row:')).map(b => b.key)
    expect((await band.find({ type: 'Text', text: /◆ claudish/ }))?.text).toBe('◆ claudish  r2 · 2 running · 1 earlier run')
    expect(await rowKeys()).toEqual([`row:${second}/01`, `row:${second}/02`])
    // a third run starts while the second is live: both are drawn, ids read label/slot, no run label in the header
    await teamRun($, h, 'r3')
    const third = modRun(h, 2).id
    expect((await band.find({ type: 'Text', text: /◆ claudish/ }))?.text).toBe('◆ claudish · 4 running · 1 earlier run')
    expect((await rowKeys()).sort()).toEqual([`row:${second}/01`, `row:${second}/02`, `row:${third}/01`, `row:${third}/02`].sort())
    expect(await band.find({ type: 'Text', text: /^r2\/01\s*$/ })).toBeDefined()
  })

  test(`band: Stop once, then expiry [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const key = `${modRun(h).id}/01`
    const band = await mountBand($, surface)
    await band.press({ key: `stop:${key}` })
    expect((await band.find({ key: `stop:${key}` }))?.props.label).toBe('Stop?')
    await h.clock.advance(STOP_CONFIRM_MS + 1000)
    expect((await band.find({ key: `stop:${key}` }))?.props.label).toBe('Stop')
    expect(h.fake.cancelCalls()).toHaveLength(0)
    expect(modRun(h).slots[0]?.state).toBe('RUNNING')
  })

  test(`band: Stop twice — exactly one cancel of that slot [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const run = h.fake.runs[0]!
    const key = `${modRun(h).id}/01`
    const band = await mountBand($, surface)
    await band.press({ key: `stop:${key}` })
    await h.clock.advance(1000)
    await band.press({ key: `stop:${key}` })
    expect(h.fake.cancelCalls()).toHaveLength(1)
    expect(h.fake.cancelCalls()[0]?.args).toEqual({ mode: 'cancel', path: '/w/r1', slot: '01', run_id: run.runId })
    await h.clock.advance(1000)
    expect(await badgeOf(band, key)).toEqual({ code: 'STP', color: DARK.snow, backgroundColor: DARK.stopped })
    expect(await band.find({ key: `stop:${key}` })).toBeUndefined()
    expect(stops(h)[key]).toBeUndefined()
  })

  test(`band: Stop twice in the same tick — one cancel; a press and the expiry timer — one claim wins [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const key = `${modRun(h).id}/01`
    const band = await mountBand($, surface)
    await band.press({ key: `stop:${key}` })
    await Promise.all([band.press({ key: `stop:${key}` }), band.press({ key: `stop:${key}` })])
    expect(h.fake.cancelCalls()).toHaveLength(1)
    // slot 02: the second press races the 4 s expiry timer (host.store) in one tick
    const key2 = `${modRun(h).id}/02`
    await band.press({ key: `stop:${key2}` })
    await Promise.all([h.clock.advance(STOP_CONFIRM_MS), band.press({ key: `stop:${key2}` })])
    const sent = h.fake.cancelCalls().filter(c => c.args.slot === '02').length
    const after = stops(h)[key2]
    expect(sent === 1 ? after?.kind !== 'armed' : after?.kind === 'armed').toBe(true)
    expect(sent).toBeLessThanOrEqual(1)
  })

  test(`band: Stop is not drawn on a terminal row [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    h.fake.set(h.fake.runs[0]!.runId, '03', 'COMPLETED')
    await h.clock.advance(1000)
    const band = await mountBand($, surface)
    expect(await band.find({ key: `stop:${modRun(h).id}/03` })).toBeUndefined()
    expect(await band.find({ key: `show:${modRun(h).id}/03` })).toBeDefined()
  })

  test(`band: Stop failure — a toast, the button back [${surface}]`, async ($, on) => {
    const h = harness(on, { cancelError: 'unknown_slot' })
    await start($, surface)
    await teamRun($, h)
    const key = `${modRun(h).id}/01`
    const band = await mountBand($, surface)
    await band.press({ key: `stop:${key}` })
    await band.press({ key: `stop:${key}` })
    expect(h.fake.cancelCalls()).toHaveLength(1)
    expect(h.toasts).toHaveLength(1)
    expect(h.toasts[0]).toMatch(/^Stop failed for 01 gpt-6\.1-sol: unknown_slot/)
    expect(stops(h)[key]).toBeUndefined()
    expect((await band.find({ key: `stop:${key}` }))?.props.label).toBe('Stop')
  })

  test(`band: Stop stall — the cancel answered but the slot runs on: after 20 s the button returns, with a toast [${surface}]`, async ($, on) => {
    const h = harness(on, { cancelNoEffect: true })
    await start($, surface)
    await teamRun($, h)
    const key = `${modRun(h).id}/01`
    const band = await mountBand($, surface)
    await band.press({ key: `stop:${key}` })
    await band.press({ key: `stop:${key}` })
    expect(await band.find({ type: 'Text', text: 'stopping…' })).toBeDefined()
    await h.clock.advance(STOP_SENT_TIMEOUT_MS - 2000)
    expect(h.toasts).toHaveLength(0)
    await h.clock.advance(4000)
    expect(h.toasts).toHaveLength(1)
    expect(h.toasts[0]).toMatch(/Stop not confirmed for 01/)
    expect((await band.find({ key: `stop:${key}` }))?.props.label).toBe('Stop')
  })

  test(`band: Stop dialog open — no timeout while the cancel awaits its answer; the 20 s start when it answers [${surface}]`, async ($, on) => {
    const h = harness(on, { cancelNoEffect: true })
    await start($, surface)
    await teamRun($, h)
    const key = `${modRun(h).id}/01`
    const band = await mountBand($, surface)
    await band.press({ key: `stop:${key}` })
    const dialog = h.fake.holdCancels() // Claude Code's own permission question, still open
    const pressing = band.press({ key: `stop:${key}` })
    await h.clock.settle()
    await h.clock.advance(STOP_SENT_TIMEOUT_MS + 15_000)
    expect(h.toasts).toHaveLength(0)
    expect(await band.find({ type: 'Text', text: 'stopping…' })).toBeDefined()
    expect(await band.find({ key: `stop:${key}` })).toBeUndefined() // no Stop to press again while it is open
    dialog.release()
    await pressing
    await h.clock.settle()
    expect(h.fake.cancelCalls()).toHaveLength(1)
    await h.clock.advance(STOP_SENT_TIMEOUT_MS - 2000)
    expect(h.toasts).toHaveLength(0)
    await h.clock.advance(4000)
    expect(h.toasts).toEqual(['Stop not confirmed for 01; press Stop again'])
  })

  test(`band: a survey holds the band — no plugin element [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const band = await mountBand($, surface, bandProps(140, 20, true))
    expect(engineOwn(await band.drawn())).toEqual(ENGINE_DRAWING)
  })

  test(`band: no runs — nothing drawn, no claudish call [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const band = await mountBand($, surface)
    await h.clock.advance(10_000)
    expect(engineOwn(await band.drawn())).toEqual(ENGINE_DRAWING)
    expect(h.fake.calls).toHaveLength(0)
  })

  test(`band: Show opens the one Show pane on that slot's tab; the header's Hide puts it away keeping every view; the next Show brings it back [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const id = modRun(h).id
    const band = await mountBand($, surface)
    const label = async (slot: string) => (await band.find({ key: `show:${id}/${slot}` }))?.props.label
    expect(await label('02')).toBe('Show')
    expect(await headerHide(band)).toBeUndefined()
    const first = h.uiCalls.length
    await band.press({ key: `show:${id}/02` })
    expect(h.uiCalls[first]).toBe('open') // R6.5: the press's first call
    const tab02 = shownTab(h)
    expect(tab02).toMatch(/^cl_[0-9a-f]{8}$/)
    expect(h.state.get(`panes/${tab02}`)).toMatchObject({ slot: '02' })
    await band.press({ key: `show:${id}/03` })
    const tab03 = shownTab(h)
    expect(tab03).not.toBe(tab02)
    expect(h.state.get(`panes/${tab03}`)).toMatchObject({ slot: '03' })
    // one pane for every slot, never one per slot
    expect(h.opens.length).toBeGreaterThan(0)
    expect(h.opens.every(o => o.id === SHOW_PANE_ID && o.title === SHOW_PANE_TITLE && o.columns === SHOW_COLUMNS && o.rows === SHOW_ROWS && o.closeOnEscape === true)).toBe(true)
    expect(h.panes.map(p => p.id)).toEqual([SHOW_PANE_ID])
    await band.redraw()
    // a row always reads Show; Hide is the header's
    expect(await label('02')).toBe('Show')
    expect(await label('03')).toBe('Show')
    const hide = await headerHide(band)
    expect(hide).toBeDefined()
    await band.press({ key: hide!.key! })
    expect(h.closes).toEqual([SHOW_PANE_ID])
    expect(h.panes).toEqual([])
    // the tabs and their views stay, and the shown tab is remembered
    expect(h.state.get(`panes/${tab02}`)).toMatchObject({ slot: '02' })
    expect(h.state.get(`panes/${tab03}`)).toMatchObject({ slot: '03' })
    expect(shownTab(h)).toBe(tab03)
    expect(h.state.get('hiddenTabs')).toBeUndefined() // R6.5 replaces the hidden-tab list
    await band.redraw()
    expect(await headerHide(band)).toBeUndefined()
    const opens = h.opens.length
    await band.press({ key: `show:${id}/02` })
    expect(h.opens.slice(opens).map(o => o.id)).toEqual([SHOW_PANE_ID])
    expect(shownTab(h)).toBe(tab02)
    expect(h.panes).toHaveLength(1)
    await band.redraw()
    expect(await headerHide(band)).toBeDefined()
  })

  test(`band: Show on an open but undrawn panel — no Hide in the header; the press opens claudish-show first and shows that slot's tab [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const id = modRun(h).id
    const band = await mountBand($, surface)
    await band.press({ key: `show:${id}/03` })
    // the surface keeps the pane undrawn until the person asks again
    h.panesAnswer = () => (h.opens.length === 1 ? h.panes.map(p => ({ ...p, isShown: false, isPlaced: false })) : h.panes)
    await band.redraw()
    expect(await headerHide(band)).toBeUndefined()
    expect((await band.find({ key: `show:${id}/02` }))?.props.label).toBe('Show')
    const calls = h.uiCalls.length
    await band.press({ key: `show:${id}/02` })
    expect(h.uiCalls[calls]).toBe('open')
    expect(h.opens.at(-1)?.id).toBe(SHOW_PANE_ID)
    expect(h.state.get(`panes/${shownTab(h)}`)).toMatchObject({ slot: '02' })
    expect(h.toasts).toEqual([]) // the open answered placed: nothing to say
    await band.redraw()
    expect(await headerHide(band)).toBeDefined()
  })
}
