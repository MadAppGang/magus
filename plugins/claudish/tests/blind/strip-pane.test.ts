// R12 rendered contract tests, through the existing engine kit on both surfaces.
// Inputs: spec, public contracts, existing test helpers. No implementation imports/reads.
import { expect, type Engine } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start, type Harness, type Recorded } from '../fake-claudish'
import { bandProps, mountBand, mountPane, paneProps, SURFACES, walk, type Mounted, type Surface } from '../ui'
import { buttonsIn, keyOf, kids, labelOf, quietDark, rowFor, showButton, startDelegation, startTeam, type N } from './helpers'
import { cells, expectFlushRight } from '../ext/r6-support'
import { expectInk, expectInkOneOf, segments, tabHeader, visibleText } from '../ext/v2-support'

const PANE = 'claudish-show'
const FOUR = ['gpt-6.1-sol', 'kimi-k3', 'grok-4.6', 'glm-5.3'] as const
const EIGHT = [...FOUR, 'gemini-3.8-pro', 'qwen3.8-max', 'deepseek-v4', 'minimax-m3']
const points = (s: string) => Array.from(s).length

/** Distinctive, numbered, nonblank lines make the selected child and exact viewport observable. */
function markedFrame(a: { seq: number; model: string; slot: string; final: boolean }) {
  return {
    seq: a.seq, cols: 160, rows: 60, cursor: null, final: a.final,
    lines: Array.from({ length: 60 }, (_, i) => `slot ${a.slot} line ${String(i).padStart(2, '0')}`),
  }
}

/** Bounded mock time; never a wall-clock sleep or a silent eventual assertion. */
async function until(h: Harness, ready: () => boolean, why: string, within = 5_000): Promise<void> {
  await h.clock.settle()
  for (let elapsed = 0; !ready() && elapsed < within; elapsed += 50) await h.clock.advance(50)
  await h.clock.settle()
  expect(ready(), why).toBe(true)
}

async function stepTo(h: Harness, target: number): Promise<void> {
  while (h.clock.now() < target) await h.clock.advance(Math.min(50, target - h.clock.now()))
  await h.clock.settle()
}

async function openFromBand($: Engine, h: Harness, surface: Surface, model: string): Promise<Mounted> {
  const band = await mountBand($, surface, bandProps(240, 40))
  const show = showButton(rowFor(await band.drawn(), model))
  expect(show, `Show for ${model} is drawn`).toBeDefined()
  expect(keyOf(show!), 'the discovered Button is pressable').toBeDefined()
  await band.press({ key: keyOf(show!)! })
  expect(h.opens.at(-1)?.id).toBe(PANE)
  return band
}

/** Physical horizontal Button rows, inferred from layout descriptions, never private element keys. */
function stripRows(tree: unknown): N[] {
  const candidates = walk(tree).filter(w => !w.inFrame).map(w => w.node as N)
    .filter(n => n.type === 'Box' && n.props?.flexDirection === 'row' && buttonsIn(n).length > 0)
  // A row may have horizontal groups around its tabs and Hide. Keep the outer row, not those groups.
  return candidates.filter(n => !candidates.some(parent => parent !== n && walk(parent).slice(1).some(w => w.node === n)))
}

const rowTabs = (row: N) => buttonsIn(row).filter(b => labelOf(b) !== 'Hide')
const rowLabels = (rows: N[]) => rows.map(row => rowTabs(row).map(labelOf))
const rowDrawnTabs = (rows: N[]) => rows.map(row => rowTabs(row).map(visibleText).join('│'))

function expectStrip(tree: unknown, width: number, labels: string[][], drawnTabs: string[]): N[] {
  const rows = stripRows(tree)
  expect(rowLabels(rows), 'full accessible labels identify row membership').toEqual(labels)
  expect(rowDrawnTabs(rows), 'exact tab text, dot and padding').toEqual(drawnTabs)
  expect(buttonsIn(tree).map(labelOf), 'nothing but tabs and Hide is pressable').toEqual([
    ...labels[0]!, 'Hide', ...labels.slice(1).flat(),
  ])
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    const text = visibleText(row)
    const tabText = text.replace('[ Hide ]', '')
    expect(tabText.trim().startsWith('│'), `row ${r}: no leading separator`).toBe(false)
    expect(tabText.trim().endsWith('│'), `row ${r}: no trailing separator`).toBe(false)
    expect((text.match(/│/g) ?? []).length, `row ${r}: only same-row separators`).toBe(Math.max(0, labels[r]!.length - 1))
    expect(buttonsIn(row).filter(b => labelOf(b) === 'Hide'), `row ${r}: Hide only on row 1`).toHaveLength(r === 0 ? 1 : 0)
    for (const part of segments(row)) if (part.text.includes('│')) expect(part.ink.color).toBe('subtle')
    for (const tab of rowTabs(row)) {
      const text = visibleText(tab)
      expect(text, 'the painted tab has its dot and its surrounding spaces').toMatch(/^ ● .+ $/u)
      const label = text.slice(' ● '.length, -1)
      expect(cells(tab), 'a tab is drawn at label code points + 4').toBe(points(label) + 4)
      // Inspect an explicit drawn width when present; do not require one particular flex/wrapper recipe.
      if (typeof tab.props?.width === 'number') expect(tab.props.width).toBe(points(label) + 4)
    }
    const cost = rowTabs(row).reduce((sum, tab) => sum + points(visibleText(tab)), 0) + Math.max(0, rowTabs(row).length - 1)
    const room = r === 0 ? Math.max(0, width - 8) : width
    if (r > 0 && room < 5) {
      expect(rowTabs(row)).toHaveLength(1)
      expect(cost).toBe(5)
    } else expect(cost, `row ${r}: tabs fit before any engine flexing`).toBeLessThanOrEqual(room)
  }
  const hide = buttonsIn(rows[0]!).find(b => labelOf(b) === 'Hide')!
  expect(visibleText(hide)).toBe('[ Hide ]')
  expectInk(rows[0], '[ Hide ]', { color: 'suggestion', bold: true })
  if (width >= 8) expectFlushRight(rows[0], width, '[ Hide ]')

  const outside = walk(tree).filter(w => !w.inFrame).map(w => w.node as N)
  const ruleText = '─'.repeat(width)
  const rules = outside.filter(n => n.type === 'Text' && visibleText(n) === ruleText
    && !kids(n).some(c => !!c && typeof c === 'object' && visibleText(c) === ruleText))
  expect(rules, 'exactly one full-width rule under all strip rows').toHaveLength(1)
  expectInk(tree, ruleText, { color: 'subtle' })
  const ruleAt = outside.indexOf(rules[0]!)
  for (const button of buttonsIn(tree)) expect(outside.indexOf(button), 'the rule follows every tab and Hide').toBeLessThan(ruleAt)
  return rows
}

async function frameLines(pane: Mounted, mayBeAbsent = false): Promise<string[]> {
  const frame = await pane.find({ type: 'Box', key: 'frame' })
  if (mayBeAbsent && !frame) return []
  expect(frame, 'a captured child frame is drawn').toBeDefined()
  return (frame!.children as unknown[]).map(visibleText)
}

function publicViews(h: Harness): [string, unknown][] {
  return [...h.state.entries()].filter(([key, value]) => key.startsWith('panes/') && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
}

const teamResizes = (h: Harness, runId: string) => h.fake.resizeCalls().filter(c => c.tool === 'team' && c.args.run_id === runId)
const teamCaptures = (h: Harness, runId: string, slot: string) => h.fake.captureCalls().filter(c => c.tool === 'team' && c.args.run_id === runId && c.args.slot === slot)
const requests = (calls: Recorded[]) => calls.map(c => ({ tool: c.tool, args: c.args }))
const bySlot = (calls: Recorded[]) => [...calls].sort((a, b) => String(a.args.slot).localeCompare(String(b.args.slot)))

for (const surface of SURFACES) {
  // TEST-18 / REQ-2, REQ-7, REQ-8, REQ-14
  test(`R12.5 TEST-18: eight tabs wrap into three readable rows, Hide stays on row 1 and the rule follows row 3 [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    await startTeam($, h, 'r12-three-rows', EIGHT)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const pane = await mountPane($, surface, PANE, paneProps(40, 40))

    const tree = await pane.drawn()
    const rows = expectStrip(tree, 40, [EIGHT.slice(0, 2), EIGHT.slice(2, 5), EIGHT.slice(5)], [
      ' ● gpt-6.1-sol │ ● kimi-k3 ',
      ' ● grok-4.6 │ ● glm-5.3 │ ● gemini-3.8… ',
      ' ● qwen3.8… │ ● deepseek… │ ● minimax-… ',
    ])
    const active = rowTabs(rows[0]!)[0]!
    expectInk(active, 'gpt-6.1-sol', { bold: true })
    expectInkOneOf(active, 'gpt-6.1-sol', 'backgroundColor', quietDark('#89B4FA'))
    for (const tab of rowTabs(rows[1]!)) expectInk(tab, '●', { color: '#89B4FA' })
    expectInk(rowTabs(rows[1]!)[2], 'gemini-3.8…', { color: 'inactive' })
    for (const type of ['Input', 'Select', 'Client']) expect(await pane.findAll({ type })).toHaveLength(0)
    await pane.unmount()
    await band.unmount()
  })

  // TEST-19 / REQ-2, REQ-3, REQ-7, REQ-14
  test(`R12.1/R12.2 TEST-19: widths 15, 8 and 4 keep whole Hide alone before the singleton tab rows [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    const models = FOUR.slice(0, 3)
    await startTeam($, h, 'r12-tiny', models)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const pane = await mountPane($, surface, PANE, paneProps(15, 24))
    const cases = [
      { width: 15, text: ['', ' ● gpt-6.1-sol ', ' ● kimi-k3 ', ' ● grok-4.6 '] },
      { width: 8, text: ['', ' ● gpt… ', ' ● kim… ', ' ● gro… '] },
      { width: 4, text: ['', ' ● … ', ' ● … ', ' ● … '] },
    ]
    for (const { width, text } of cases) {
      await pane.redraw(paneProps(width, 24))
      expectStrip(await pane.drawn(), width, [[], ...models.map(model => [model])], text)
    }
    await pane.unmount()
    await band.unmount()
  })

  // TEST-20 / REQ-8, REQ-13
  test(`R12.5/R12.7 TEST-20: truncated tabs on later rows select their full-model view without changing breaks or resizing [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    const run = await startTeam($, h, 'r12-later-press', EIGHT)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const pane = await mountPane($, surface, PANE, paneProps(40, 40))
    await until(h, () => teamResizes(h, run.runId).length >= 8, 'initial size reaches all eight sessions')
    await h.clock.advance(1_000)
    const before = h.fake.resizeCalls().length
    const initialRows = rowLabels(stripRows(await pane.drawn()))
    expect(initialRows).toEqual([EIGHT.slice(0, 2), EIGHT.slice(2, 5), EIGHT.slice(5)])

    for (const index of [4, 7, 0]) {
      const model = EIGHT[index]!
      const tab = (await pane.findAll({ type: 'Button' })).find(b => b.props.label === model)
      expect(tab, 'a truncated tab still has its full accessible label').toBeDefined()
      await pane.press({ key: tab!.key! })
      await h.clock.advance(1_100)
      await pane.redraw()
      expect(visibleText(await tabHeader(pane, model))).toContain(model)
      expect(await frameLines(pane)).toContain(`slot ${String(index + 1).padStart(2, '0')} line 59`)
      expect(rowLabels(stripRows(await pane.drawn())), 'selection never rearranges rows').toEqual(initialRows)
      expect(h.fake.resizeCalls(), 'selection alone never resizes any session').toHaveLength(before)
    }
    await pane.unmount()
    await band.unmount()
  })

  // TEST-21 / REQ-8
  test(`R12.5 TEST-21: Hide in a wrapped panel closes it without clearing views and Show restores its tabs [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    await startTeam($, h, 'r12-hide', EIGHT)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const pane = await mountPane($, surface, PANE, paneProps(40, 40))
    await h.clock.settle()
    const before = publicViews(h)
    expect(before).toHaveLength(8)
    const tabLabels = rowLabels(stripRows(await pane.drawn()))
    const hides = (await pane.findAll({ type: 'Button' })).filter(button => button.props.label === 'Hide')
    expect(hides).toHaveLength(1)

    await pane.press({ key: hides[0]!.key! })
    expect(h.closes).toContain(PANE)
    expect(h.panes.filter(p => p.id === PANE)).toHaveLength(0)
    expect(publicViews(h), 'Hide retains all public tab views').toEqual(before)
    await pane.unmount()
    await band.redraw()
    const show = showButton(rowFor(await band.drawn(), FOUR[0]))
    expect(show).toBeDefined()
    await band.press({ key: keyOf(show!)! })
    const reopened = await mountPane($, surface, PANE, paneProps(40, 40))
    expect(rowLabels(stripRows(await reopened.drawn()))).toEqual(tabLabels)
    expect(visibleText(await tabHeader(reopened, FOUR[0]))).toContain(FOUR[0])
    expect(await frameLines(reopened)).toContain('slot 01 line 59')
    expect(publicViews(h).map(([key]) => key)).toEqual(before.map(([key]) => key))
    await reopened.unmount()
    await band.unmount()
  })

  // TEST-22 / REQ-7, REQ-14
  test(`R12.8 TEST-22: no tabs draws only Hide, the full-width rule and No run to show [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const pane = await mountPane($, surface, PANE, paneProps(40, 24))

    const tree = await pane.drawn()
    expectStrip(tree, 40, [[]], [''])
    expect(visibleText(tree)).toContain('No run to show.')
    expect(visibleText(tree).indexOf('No run to show.')).toBeGreaterThan(visibleText(tree).indexOf('─'.repeat(40)))
    await pane.unmount()
  })

  // TEST-23 / REQ-9
  test(`R12.6 TEST-23: one, two and three tab rows each reduce the frame by exactly their own height [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    await startTeam($, h, 'r12-viewport', EIGHT)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const pane = await mountPane($, surface, PANE, paneProps(200, 30))

    for (const { width, n } of [{ width: 200, n: 1 }, { width: 60, n: 2 }, { width: 40, n: 3 }]) {
      await pane.redraw(paneProps(width, 30))
      expect(stripRows(await pane.drawn()), `width ${width}: expected strip rows`).toHaveLength(n)
      const lines = await frameLines(pane)
      const expectedCount = 30 - n - 2
      expect(lines).toEqual(Array.from({ length: expectedCount }, (_, i) => `slot 01 line ${String(60 - expectedCount + i).padStart(2, '0')}`))
      expect(n + 1 + 1 + lines.length, 'tabs + rule + header + frame exactly fill the body').toBe(30)
    }
    await pane.unmount()
    await band.unmount()
  })

  // TEST-24 / REQ-9
  test(`R12.6 TEST-24: short screens are top-aligned and a strip taller than the pane leaves only header room [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: a => ({ seq: a.seq, final: a.final, cols: 40, rows: 2, cursor: null, lines: ['top screen', 'bottom screen'] }) })
    await start($, surface)
    await startTeam($, h, 'r12-short-screen', EIGHT)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const pane = await mountPane($, surface, PANE, paneProps(40, 12))

    expect(stripRows(await pane.drawn())).toHaveLength(3)
    const lines = await frameLines(pane)
    // R6.5: top-aligned — the short screen's lines come first, right under the header, no blank
    // rows above. The spec neither requires nor forbids trailing blanks, so only bound them:
    // room = 12 − (3 + 1) = 8, and the frame keeps at most room − 1 = 7 lines.
    expect(lines.slice(0, 2)).toEqual(['top screen', 'bottom screen'])
    expect(lines.length).toBeLessThanOrEqual(7)
    expect(lines.slice(2).every(line => line.trim() === '')).toBe(true)
    await pane.redraw(paneProps(40, 3))
    expect(stripRows(await pane.drawn())).toHaveLength(3)
    expect(await frameLines(pane, true)).toEqual([])
    expect(visibleText(await tabHeader(pane, FOUR[0]))).toContain(FOUR[0])
    await pane.unmount()
    await band.unmount()
  })

  // TEST-25 / REQ-10, REQ-11
  test(`R12.6 TEST-25: every team session receives max(40, columns) by max(24, bodyRows minus n minus 2), once per size [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    const run = await startTeam($, h, 'r12-team-sizes', EIGHT)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const first = h.fake.resizeCalls().length
    const pane = await mountPane($, surface, PANE, paneProps(200, 40))
    let from = first
    for (const size of [
      { width: 200, height: 40, n: 1, cols: 200, rows: 37 },
      { width: 60, height: 40, n: 2, cols: 60, rows: 36 },
      { width: 40, height: 40, n: 3, cols: 40, rows: 35 },
      { width: 30, height: 40, n: 4, cols: 40, rows: 34 },
      { width: 40, height: 29, n: 3, cols: 40, rows: 24 },
      { width: 40, height: 30, n: 3, cols: 40, rows: 25 },
    ]) {
      await pane.redraw(paneProps(size.width, size.height))
      expect(stripRows(await pane.drawn())).toHaveLength(size.n)
      await until(h, () => h.fake.resizeCalls().length - from >= 8, 'all running team sessions receive the changed size')
      await h.clock.advance(1_500)
      const calls = bySlot(h.fake.resizeCalls().slice(from))
      expect(requests(calls)).toEqual(run.slots.map(slot => ({
        tool: 'team', args: { mode: 'resize', path: run.path, run_id: run.runId, slot: slot.slot, cols: size.cols, rows: size.rows },
      })))
      from = h.fake.resizeCalls().length
    }
    await pane.redraw(paneProps(40, 30))
    await h.clock.advance(2_000)
    expect(h.fake.resizeCalls(), 'unchanged dimensions do not repeat a resize').toHaveLength(from)
    await pane.unmount()
    await band.unmount()
  })

  // TEST-26 / REQ-10
  test(`R12.6 TEST-26: eight delegations in three strip rows each receive resize_session with 40 columns and 35 rows [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    const sessions = []
    for (const model of EIGHT) sessions.push(await startDelegation($, h, model))
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const from = h.fake.resizeCalls().length
    const pane = await mountPane($, surface, PANE, paneProps(40, 40))

    expect(stripRows(await pane.drawn())).toHaveLength(3)
    await until(h, () => h.fake.resizeCalls().length - from >= 8, 'all eight delegations are sized')
    await h.clock.advance(1_500)
    const calls = h.fake.resizeCalls().slice(from).sort((a, b) => String(a.args.session_id).localeCompare(String(b.args.session_id)))
    expect(requests(calls)).toEqual([...sessions].sort((a, b) => a.id.localeCompare(b.id)).map(session => ({
      tool: 'resize_session', args: { session_id: session.id, cols: 40, rows: 35 },
    })))
    await pane.unmount()
    await band.unmount()
  })

  // TEST-27 / REQ-11
  test(`R12.6 TEST-27: adding and removing tabs at fixed panel dimensions changes n and resizes each still-running session once [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    const older = await startTeam($, h, 'r12-before-add', FOUR)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const pane = await mountPane($, surface, PANE, paneProps(50, 40))
    await until(h, () => teamResizes(h, older.runId).length >= 4, 'four initial sessions are sized')
    expect(stripRows(await pane.drawn())).toHaveLength(2)
    expect(teamResizes(h, older.runId).map(c => c.args.rows)).toEqual([36, 36, 36, 36])
    const from = h.fake.resizeCalls().length

    const newer = await startTeam($, h, 'r12-added', EIGHT.slice(4))
    await h.clock.advance(1_000)
    await pane.redraw(paneProps(50, 40))
    expect(stripRows(await pane.drawn())).toHaveLength(3)
    await until(h, () => older.slots.every(slot => h.fake.resizeCalls().slice(from).some(c => c.args.run_id === older.runId && c.args.slot === slot.slot && c.args.rows === 35))
      && newer.slots.every(slot => teamResizes(h, newer.runId).some(c => c.args.slot === slot.slot && c.args.rows === 35)), 'all sessions take the additional strip row')
    await h.clock.advance(1_500)
    for (const run of [older, newer]) for (const slot of run.slots) {
      expect(h.fake.resizeCalls().slice(from).filter(c => c.args.run_id === run.runId && c.args.slot === slot.slot && c.args.rows === 35)).toHaveLength(1)
    }
    const removeFrom = h.fake.resizeCalls().length
    for (const slot of older.slots) h.fake.set(older.runId, slot.slot, 'COMPLETED')
    await h.clock.advance(1_000)
    await pane.redraw(paneProps(50, 40))
    expect(stripRows(await pane.drawn())).toHaveLength(2)
    expect(rowLabels(stripRows(await pane.drawn())).flat()).toEqual(EIGHT.slice(4))
    expect(visibleText(await tabHeader(pane, EIGHT[4]!)), 'when the selected tab disappears, the first remaining tab is shown').toContain(EIGHT[4]!)
    await until(h, () => h.fake.resizeCalls().slice(removeFrom).filter(c => c.args.run_id === newer.runId && c.args.rows === 36).length >= 4, 'removing the ended older run returns one row to all remaining sessions')
    await h.clock.advance(1_500)
    expect(requests(bySlot(h.fake.resizeCalls().slice(removeFrom)))).toEqual(newer.slots.map(slot => ({
      tool: 'team', args: { mode: 'resize', path: newer.path, run_id: newer.runId, slot: slot.slot, cols: 50, rows: 36 },
    })))
    await pane.unmount()
    await band.unmount()
  })

  // TEST-28 / REQ-6, REQ-13, REQ-14
  test(`R12 Terms TEST-28: before any Show press the first tab is active and cut last, never an all-inactive panel [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    await startTeam($, h, 'r12-default-active', FOUR)
    await h.clock.advance(1_000)
    const pane = await mountPane($, surface, PANE, paneProps(56, 30))

    const rows = expectStrip(await pane.drawn(), 56, [[...FOUR]], [' ● gpt-6.1-sol │ ● kimi-… │ ● grok-… │ ● glm-5… '])
    expectInk(rowTabs(rows[0]!)[0], 'gpt-6.1-sol', { bold: true })
    expect(visibleText(await tabHeader(pane, FOUR[0]))).toContain(FOUR[0])
    expect(h.opens).toHaveLength(0)
    await pane.unmount()
  })

  // TEST-29 / REQ-1, REQ-10
  test(`R12 Terms TEST-29: absent bodyColumns uses 80 columns for wrapping, the rule and every session resize [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    const run = await startTeam($, h, 'r12-fallback-width', EIGHT)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const { bodyColumns: _omitted, ...withoutColumns } = paneProps(80, 40)
    const from = h.fake.resizeCalls().length
    // The engine may omit columns; the test helper's default type is intentionally bypassed for that case.
    const pane = await mountPane($, surface, PANE, withoutColumns as ReturnType<typeof paneProps>)

    expectStrip(await pane.drawn(), 80, [EIGHT.slice(0, 5), EIGHT.slice(5)], [
      ' ● gpt-6.1-sol │ ● kimi-k3 │ ● grok-4.6 │ ● glm-5.3 │ ● gemini-3.8-pro ',
      ' ● qwen3.8-max │ ● deepseek-v4 │ ● minimax-m3 ',
    ])
    await until(h, () => h.fake.resizeCalls().length - from >= 8, 'the fallback size reaches every session')
    await h.clock.advance(1_500)
    expect(requests(bySlot(h.fake.resizeCalls().slice(from)))).toEqual(run.slots.map(slot => ({
      tool: 'team', args: { mode: 'resize', path: run.path, run_id: run.runId, slot: slot.slot, cols: 80, rows: 36 },
    })))
    await pane.unmount()
    await band.unmount()
  })

  // TEST-30 / REQ-11, REQ-12
  test(`R12.6 TEST-30: a new strip row resizes before the shown capture and receives 250/750 ms catch-up captures [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    const run = await startTeam($, h, 'r12-height-catch-up', FOUR)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const pane = await mountPane($, surface, PANE, paneProps(51, 40))
    await until(h, () => teamResizes(h, run.runId).length >= 4, 'initial one-row size reaches all sessions')
    expect(stripRows(await pane.drawn())).toHaveLength(1)
    const polls = h.fake.listCalls().length
    await until(h, () => h.fake.listCalls().length > polls, 'align the size change just after a poll tick')
    const from = h.fake.calls.length
    const t0 = h.clock.now()

    await pane.redraw(paneProps(50, 40))
    expect(stripRows(await pane.drawn())).toHaveLength(2)
    await until(h, () => h.fake.calls.slice(from).some(c => c.tool === 'team' && c.args.mode === 'capture' && c.args.run_id === run.runId && c.args.slot === '01'), 'the shown tab captures immediately', 100)
    const newCalls = h.fake.calls.slice(from)
    const resize = newCalls.find(c => c.tool === 'team' && c.args.mode === 'resize' && c.args.run_id === run.runId && c.args.slot === '01')
    const first = newCalls.find(c => c.tool === 'team' && c.args.mode === 'capture' && c.args.run_id === run.runId && c.args.slot === '01')
    expect(resize, 'the shown session is resized before its capture').toBeDefined()
    expect(resize!.args).toEqual({ mode: 'resize', path: run.path, run_id: run.runId, slot: '01', cols: 50, rows: 36 })
    expect(newCalls.indexOf(resize!)).toBeLessThan(newCalls.indexOf(first!))
    expect(first!.at - t0, 'capture is immediate, not postponed to the next tick').toBeLessThanOrEqual(100)
    await stepTo(h, t0 + 900)
    const captures = teamCaptures(h, run.runId, '01').filter(c => c.at >= t0)
    for (const [lo, hi] of [[200, 350], [700, 850]] as const) {
      const extra = captures.filter(c => c.at >= t0 + lo && c.at <= t0 + hi)
      expect(extra.length, `catch-up capture at ${lo}–${hi} ms`).toBeGreaterThanOrEqual(1)
      for (const call of extra) expect(typeof call.args.since_seq).toBe('number')
    }
    expect(h.fake.listCalls().filter(c => c.at > t0 + 150 && c.at < t0 + 850), 'catch-up captures are not poll ticks').toHaveLength(0)
    await h.clock.advance(2_000)
    const resizes = h.fake.calls.slice(from).filter(c => c.tool === 'team' && c.args.mode === 'resize')
    expect(requests(bySlot(resizes))).toEqual(run.slots.map(slot => ({
      tool: 'team', args: { mode: 'resize', path: run.path, run_id: run.runId, slot: slot.slot, cols: 50, rows: 36 },
    })))
    await pane.unmount()
    await band.unmount()
  })

  // TEST-31 / REQ-11, REQ-13
  test(`R12.6/R12.7 TEST-31: adding a tab without changing n sizes only the new session and never repeats existing resizes [${surface}]`, async ($, on) => {
    const h = harness(on, { frame: markedFrame })
    await start($, surface)
    const run = await startTeam($, h, 'r12-same-n', FOUR)
    await h.clock.advance(1_000)
    const band = await openFromBand($, h, surface, FOUR[0])
    const pane = await mountPane($, surface, PANE, paneProps(50, 40))
    await until(h, () => teamResizes(h, run.runId).length >= 4, 'the existing sessions are already at the two-row size')
    await h.clock.advance(1_000)
    const from = h.fake.resizeCalls().length

    const added = await startDelegation($, h, 'x')
    await h.clock.advance(1_000)
    await pane.redraw(paneProps(50, 40))
    expect(stripRows(await pane.drawn())).toHaveLength(2)
    expect(rowLabels(stripRows(await pane.drawn())).flat().sort()).toEqual([...FOUR, 'x'].sort())
    await until(h, () => h.fake.resizeCalls().slice(from).some(c => c.args.session_id === added.id), 'the new session receives the already-known size')
    await h.clock.advance(2_000)
    expect(requests(h.fake.resizeCalls().slice(from))).toEqual([
      { tool: 'resize_session', args: { session_id: added.id, cols: 50, rows: 36 } },
    ])
    await pane.unmount()
    await band.unmount()
  })
}
