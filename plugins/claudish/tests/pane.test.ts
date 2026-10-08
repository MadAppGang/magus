// A Show tab, drawn through the plugin on both surfaces: frames and since_seq, the
// viewport (the bottom of the child's screen), the child's colours and the style budget,
// how a tab ends, cadence, the read-only guarantee, and which tabs are captured at all.

import type { Register } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { ClaudishPaneView, ClaudishRuns } from '../types'
import { FINAL_GRACE_MS, NO_SCREEN_NOTE, PANE_STYLE_BUDGET, STYLE_SPANS_PER_LINE, paneId } from '../hooks/status/domain'
import { ENGINE_DRAWING, TEAM_TOOL, harness, start, type FakeOptions, type Harness, type Recorded } from './fake-claudish'
import { COLS, CUBE_INDEX, RED_INDEX, ROWS, TRUECOLOR_BORDER, type Json } from './scenario'
import { SURFACES, mountBand, mountPane, paneProps, walk, type Mounted, type Node, type Surface } from './ui'

const runs = (h: Harness) => (h.state.get('runs') ?? { epoch: 0, starts: {}, list: [] }) as ClaudishRuns
const view = (h: Harness, id: string) => h.state.get(`panes/${id}`) as ClaudishPaneView | null | undefined
const writesOf = (h: Harness, id: string) => h.writes.filter(([k]) => k === `panes/${id}`).length
const capturesOf = (h: Harness, slot: string): Recorded[] => h.fake.captureCalls().filter(c => c.args.slot === slot)

/** Starts a team run, lists it, presses Show on `slot`; returns the tab id. */
async function showTab($: unknown, h: Harness, surface: Surface, slot = '02'): Promise<string> {
  await ($ as { tool: { call: (e: unknown) => Promise<unknown> } }).tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
  await h.clock.advance(1000)
  const band = await mountBand($, surface)
  await band.press({ key: `show:${runs(h).list[0]!.id}/${slot}` })
  return paneId(runs(h).list[0]!.id, slot)
}

/** The line Texts under the frame Box, as the text each shows. */
async function frameLines(pane: Mounted): Promise<string[]> {
  const frame = await pane.find({ type: 'Box', key: 'frame' })
  return ((frame?.children ?? []) as Node[]).map(lineText)
}

function lineText(n: unknown): string {
  if (typeof n === 'string') return n
  const node = n as Node
  return ((node.children ?? []) as unknown[]).map(lineText).join('')
}

function frameNodes(tree: unknown): Node[] {
  return walk(tree).filter(w => w.inFrame).map(w => w.node)
}

/** A screen of `rows` lines of `width` characters, each carrying `spans` distinct runs of 5 cells. */
function budgetFrame(spansPerLine: number, extraOnFirst = 0, width = 40, rows = ROWS) {
  return (a: { seq: number; final: boolean }): Json => {
    const lines = Array.from({ length: rows }, (_, i) => `${String(i).padStart(2, '0')}${'x'.repeat(width - 2)}`)
    const spans = lines.map((_, i) => Array.from({ length: spansPerLine + (i === 0 ? extraOnFirst : 0) }, (_, k) => [k * 5, 5, 16 + ((i + k) % 200), -1, 0]))
    return { seq: a.seq, cols: COLS, rows, cursor: { x: 0, y: 0 }, final: a.final, lines, spans }
  }
}

/** Every cell of every line a different truecolor. */
function heavyFrame(a: { seq: number; final: boolean }): Json {
  const lines = Array.from({ length: ROWS }, () => '#'.repeat(COLS))
  const spans = lines.map((_, i) => Array.from({ length: COLS }, (_, c) => [c, 1, 16_777_216 + i * COLS + c, -1, 0]))
  return { seq: a.seq, cols: COLS, rows: ROWS, cursor: { x: 0, y: 0 }, final: a.final, lines, spans }
}

/** Closes a pane when told to: the kit's own `$` raises no `ui.close`, so this stands in for the close mark. */
const CLOSER = {
  name: 'closer',
  register(on: Parameters<Register>[0]) {
    on('prompt.submit', async ($, e, next) => {
      const m = /^close (cl_[0-9a-f]{8})$/.exec(e.text)
      if (!m) return next(e)
      await $.ui.close({ id: m[1]! })
      return { drop: 'closed a tab' }
    })
  },
}

for (const surface of SURFACES) {
  test(`pane: frames — since_seq is the last seq drawn; an unchanged screen writes nothing [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const id = await showTab($, h, surface)
    expect(view(h, id)?.status).toBe('waiting')
    await h.clock.advance(1000)
    const pane = await mountPane($, surface, id)
    const first = view(h, id)?.frame?.seq
    expect(first).toBeGreaterThan(0)
    expect((await frameLines(pane)).some(l => l.includes(`seq ${first}`))).toBe(true)
    await h.clock.advance(2000)
    const second = view(h, id)?.frame?.seq ?? 0
    expect(second).toBeGreaterThan(first!)
    expect((await frameLines(pane)).some(l => l.includes(`seq ${second}`))).toBe(true)
    const calls = capturesOf(h, '02')
    expect(calls[0]?.args.since_seq).toBe(0)
    expect(calls.slice(1).every((c, i) => typeof c.args.since_seq === 'number' && c.args.since_seq >= (calls[i]?.args.since_seq as number))).toBe(true)
    // 02 ends: its screen stops changing; until it is final, each answer is unchanged and writes nothing
    h.fake.set(h.fake.runs[0]!.runId, '02', 'COMPLETED')
    await h.clock.advance(2000)
    const writes = writesOf(h, id)
    await h.clock.advance(3000)
    expect(capturesOf(h, '02').at(-1)?.args.since_seq).toBe(view(h, id)?.frame?.seq)
    expect(writesOf(h, id)).toBe(writes)
  })

  test(`pane: viewport — the bottom of the screen, one outer Text per line, exactly the body's rows [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(1000)
    // 24 body rows (not the 20-row fallback), so a height read from anywhere else shows
    const pane = await mountPane($, surface, id, paneProps(80, 24))
    const lines = await frameLines(pane)
    expect(lines).toHaveLength(23)
    const screen = view(h, id)!.frame!.lines
    expect(lines.at(-1)).toBe(screen[47]) // the last non-blank line of the fake screen
    expect(lines[0]).toBe(screen[25] === '' ? ' ' : screen[25]!.slice(0, 81))
    const frame = await pane.find({ type: 'Box', key: 'frame' })
    for (const line of (frame?.children ?? []) as Node[]) {
      expect(line.type).toBe('Text')
      expect(line.props?.wrap).toBe('truncate-end')
      for (const c of (line.children ?? []) as unknown[]) if (typeof c !== 'string') expect((c as Node).type).toBe('Text')
    }
    const top = (await pane.drawn()) as unknown as Node
    expect((top.children ?? []).length).toBe(2) // the header row and the frame
    expect(1 + lines.length).toBe(24) // exactly the body's rows
    // the wide line is cut at bodyColumns + 1, so the engine still truncates it with …
    expect(Math.max(...lines.map(l => Array.from(l).length))).toBe(81)
  })

  test(`pane: colours — spans asked for and painted as #rrggbb; without capture_spans, plain [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(1000)
    const pane = await mountPane($, surface, id, paneProps(170, 60))
    expect(capturesOf(h, '02').every(c => c.args.spans === true)).toBe(true)
    const nodes = frameNodes(await pane.drawn())
    const colours = new Set(nodes.map(n => n.props?.color).filter(c => c !== undefined))
    const hex = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`
    expect(colours.has(hex(TRUECOLOR_BORDER))).toBe(true)
    expect(colours.has('#cd0000')).toBe(RED_INDEX === 1)
    expect(colours.has('#ff8700')).toBe(CUBE_INDEX === 208)
    const banner = nodes.find(n => n.props?.bold === true)
    expect(lineText(banner)).toContain('Claude Code')
    // each styled run is a Text nested in its line's outer Text
    const frame = await pane.find({ type: 'Box', key: 'frame' })
    const styledLine = ((frame?.children ?? []) as Node[]).find(l => (l.children ?? []).some(c => typeof c !== 'string'))
    expect(styledLine?.type).toBe('Text')
  })

  test(`pane: colours — no capture_spans: no spans asked, no colour in the frame [${surface}]`, async ($, on) => {
    const h = harness(on, { noSpans: true })
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(2000)
    const pane = await mountPane($, surface, id, paneProps(170, 60))
    expect(capturesOf(h, '02').length).toBeGreaterThan(0)
    expect(capturesOf(h, '02').every(c => !('spans' in c.args))).toBe(true)
    expect((await frameLines(pane)).length).toBeGreaterThan(10)
    for (const n of frameNodes(await pane.drawn())) {
      expect(n.props?.color).toBeUndefined()
      expect(n.props?.backgroundColor).toBeUndefined()
      expect(n.props?.bold).toBeUndefined()
    }
  })

  for (const [name, options, painted] of [
    ['exactly the budget → painted', { frame: budgetFrame(7) }, true],
    ['one segment over → the whole frame plain', { frame: budgetFrame(7, 1) }, false],
  ] as [string, FakeOptions, boolean][]) {
    test(`pane: style budget — ${name} [${surface}]`, async ($, on) => {
      const h = harness(on, options)
      await start($, surface)
      const id = await showTab($, h, surface)
      await h.clock.advance(1000)
      const pane = await mountPane($, surface, id, paneProps(60, 60))
      expect(await frameLines(pane)).toHaveLength(ROWS)
      const coloured = frameNodes(await pane.drawn()).filter(n => n.props?.color !== undefined)
      expect(coloured.length > 0).toBe(painted)
      if (painted) expect(coloured).toHaveLength(ROWS * 7)
    })
  }

  test(`pane: style budget — every cell a different colour: 24 spans kept per line, the tree mounts plain [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: heavyFrame })
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(1000)
    expect(view(h, id)?.frame?.styles?.every(l => l.length === STYLE_SPANS_PER_LINE)).toBe(true)
    const pane = await mountPane($, surface, id, paneProps(170, 60))
    const tree = await pane.drawn()
    expect(frameNodes(tree).every(n => n.props?.color === undefined)).toBe(true)
    expect(walk(tree).length).toBeLessThan(2600)
    expect(PANE_STYLE_BUDGET).toBe(50_000)
  })

  test(`pane: final frame — captured until claudish marks the screen final, then ended [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(1000)
    h.fake.set(h.fake.runs[0]!.runId, '02', 'COMPLETED')
    await h.clock.advance(6000)
    expect(view(h, id)?.status).toBe('live') // the slot ended; its pane is not reaped yet (final:false)
    await h.clock.advance(4000)
    expect(view(h, id)?.status).toBe('ended')
    expect(view(h, id)?.note).toBeNull()
    const n = capturesOf(h, '02').length
    await h.clock.advance(20_000)
    expect(capturesOf(h, '02')).toHaveLength(n)
    const pane = await mountPane($, surface, id)
    expect(await pane.find({ type: 'Text', text: /· ended/ })).toBeDefined()
    expect((await frameLines(pane)).length).toBeGreaterThan(0)
  })

  test(`pane: final frame, never final — ended 30 s after the slot ended [${surface}]`, async ($, on) => {
    const h = harness(on, { neverFinal: true })
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(1000)
    h.fake.set(h.fake.runs[0]!.runId, '02', 'COMPLETED')
    await h.clock.advance(FINAL_GRACE_MS - 3000)
    expect(view(h, id)?.status).toBe('live')
    await h.clock.advance(6000)
    expect(view(h, id)?.status).toBe('ended')
    const n = capturesOf(h, '02').length
    await h.clock.advance(20_000)
    expect(capturesOf(h, '02')).toHaveLength(n)
  })

  test(`pane: never spawned — the one-time note, no further captures [${surface}]`, async ($, on) => {
    const h = harness(on, { noPane: ['02'] })
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(1000)
    expect(view(h, id)).toMatchObject({ status: 'ended', note: NO_SCREEN_NOTE, frame: null })
    const n = capturesOf(h, '02').length
    await h.clock.advance(20_000)
    expect(capturesOf(h, '02')).toHaveLength(n)
    const pane = await mountPane($, surface, id)
    expect(await pane.find({ type: 'Text', text: NO_SCREEN_NOTE })).toBeDefined()
  })

  test(`pane: retention over — ended at once, no further captures [${surface}]`, async ($, on) => {
    const h = harness(on, { captureGone: true })
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(1000)
    expect(view(h, id)?.status).toBe('ended')
    const n = capturesOf(h, '02').length
    expect(n).toBe(1)
    await h.clock.advance(20_000)
    expect(capturesOf(h, '02')).toHaveLength(n)
  })

  test(`pane: a tab with no view draws nothing of the plugin's own [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    void h
    const pane = await mountPane($, surface, 'cl_0123abcd')
    expect(await pane.drawn()).toEqual(ENGINE_DRAWING)
  })

  test(`pane: hidden cadence — a tab behind another is captured at most every 5 s [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await showTab($, h, surface, '02')
    const band = await mountBand($, surface)
    await band.press({ key: `show:${runs(h).list[0]!.id}/03` }) // 03 shown, 02 behind it
    const from = h.clock.now()
    await h.clock.advance(30_000)
    const hidden = capturesOf(h, '02').filter(c => c.at > from).map(c => c.at)
    expect(hidden.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < hidden.length; i++) expect(hidden[i]! - hidden[i - 1]!).toBeGreaterThanOrEqual(5000)
    expect(capturesOf(h, '03').filter(c => c.at > from).length).toBeGreaterThanOrEqual(25)
  })

  test(`pane: read-only — no input, no client, no button; only list and capture calls [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const id = await showTab($, h, surface)
    const from = h.fake.calls.length
    await h.clock.advance(5000)
    const pane = await mountPane($, surface, id)
    for (const type of ['Input', 'Client', 'Button', 'Select']) expect(await pane.findAll({ type })).toHaveLength(0)
    const kinds = h.fake.calls.slice(from).map(c => (c.tool === 'team' ? `team:${String(c.args.mode)}` : c.tool))
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds.every(k => k === 'team:list' || k === 'team:capture')).toBe(true)
  })

  test(`pane: unavailable — the note drawn, retried no sooner than 10 s [${surface}]`, async ($, on) => {
    const h = harness(on, { rejectCapture: true })
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(1000)
    expect(view(h, id)?.status).toBe('unavailable')
    const pane = await mountPane($, surface, id)
    expect(await pane.find({ type: 'Text', text: /Live screen not available/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /tools/ })).toBeDefined() // the row's numbers keep the tab useful
    await h.clock.advance(30_000)
    const at = capturesOf(h, '02').map(c => c.at)
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(10_000)
  })

  test(`pane: ended without a frame — the note after the grace, no captures after it, the loop stops [${surface}]`, async ($, on) => {
    const h = harness(on, { rejectCapture: true, models: ['m-a', 'm-b'] })
    await start($, surface)
    const id = await showTab($, h, surface)
    await h.clock.advance(1000)
    const run = h.fake.runs[0]!
    h.fake.set(run.runId, '01', 'COMPLETED')
    h.fake.set(run.runId, '02', 'COMPLETED')
    await h.clock.advance(FINAL_GRACE_MS + 11_000)
    expect(view(h, id)).toMatchObject({ status: 'ended', note: NO_SCREEN_NOTE })
    const calls = h.fake.calls.length
    await h.clock.advance(60_000)
    expect(h.fake.calls).toHaveLength(calls)
  })

  test(`pane: capture scope — no tab, no capture; a closed tab stops capturing [${surface}]`, { plugins: [CLOSER] }, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await ($ as { tool: { call: (e: unknown) => Promise<unknown> } }).tool.call({ tool: TEAM_TOOL, mode: 'run', path: 'r1' })
    await h.clock.advance(10_000)
    expect(h.fake.captureCalls()).toHaveLength(0)
    const band = await mountBand($, surface)
    await band.press({ key: `show:${runs(h).list[0]!.id}/02` })
    await h.clock.advance(3000)
    const id = h.opens[0]!.id
    expect(capturesOf(h, '02').length).toBeGreaterThan(0)
    await $.prompt.submit({ text: `close ${id}` } as never) // the stand-in closes the tab: ui.close reaches the plugin's hook
    expect(h.closes).toEqual([id])
    expect(view(h, id)).toBeNull()
    const n = h.fake.captureCalls().length
    await h.clock.advance(10_000)
    expect(h.fake.captureCalls()).toHaveLength(n)
  })
}
