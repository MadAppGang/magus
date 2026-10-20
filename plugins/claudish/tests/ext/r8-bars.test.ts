// R8.1–R8.2 only: black-box engine-kit component tests, on both Client-capable surfaces.
// Expectations come from spec.md and the public rendering contract, never implementation imports.
// Host runner: claude plugin test plugins/claudish. See R8-TEST-PLAN.md for REQ/TEST ids.

import type { On } from 'claude-code'
import { expect, test, type Engine } from 'claude-code/testing'
import { harness, start, type Harness } from '../fake-claudish'
import { iso, type Json } from '../scenario'
import { bandProps, mountBand, SURFACES, type Mounted, type Surface } from '../ui'
import { team } from './support'
import {
  TIMELINE_DARK, TIMELINE_LIGHT, blockTime, cellDrawing, expectFlushRight, isFlowModule,
  runIds, runsOf, silentFor, timeline, timelineKey, untilPoll,
} from './r6-support'

type Step = { kind: 'tool' | 'thinking' | 'text' | 'ask'; tool: string | null; summary: string }
const toolStep = (tool: string, summary = `finished ${tool}`): Step => ({ kind: 'tool', tool, summary })
const ACTIVE = toolStep('Bash', 'current words')
const BAND_COLUMNS = 240

// R6.4's family table, expressed as testdata rather than an implementation classifier.
const FAMILIES = [
  ['Read', 'read'], ['Grep', 'read'], ['Glob', 'read'], ['LS', 'read'], ['NotebookRead', 'read'],
  ['Edit', 'edit'], ['MultiEdit', 'edit'], ['Write', 'edit'], ['NotebookEdit', 'edit'],
  ['Bash', 'run'], ['BashOutput', 'run'], ['WebFetch', 'web'],
  ['Task', 'agent'], ['Agent', 'agent'], ['mcp__srv__name', 'agent'], ['UnlistedTool', 'other'],
] as const

/** Each test owns its MCP world. Long histories arrive in legal batches of at most 20 recent steps. */
async function setup($: Engine, on: On, surface: Surface, finished: Step[], current = ACTIVE, theme = 'dark') {
  const extra: { row: Json } = { row: { activity: 'Bash', tool_calls: 1 } }
  const h: Harness = harness(on, {
    theme,
    rowPatch: row => silentFor(() => h, () => 1)({ ...row, ...extra.row }),
  })
  await start($, surface)
  const r = await team($, h, 'r8-bars', ['r8-model'])
  const all = [...finished, current]
  const recent = all.map((s, i): Json => ({ at: iso(r.startedAt + i * 1_000), ...s }))
  await h.clock.set(r.startedAt + (all.length + 2) * 1_000)
  for (let from = 0; from < recent.length; from += 20) {
    extra.row = { ...extra.row, recent: recent.slice(from, from + 20) }
    await untilPoll(h)
  }
  const key = timelineKey(runIds(h)[0]!, '01')
  const b = await mountBand($, surface, bandProps(BAND_COLUMNS))
  return { h, r, extra, recent, key, b }
}

/** R6.3 gives all spare columns to the cell: adjust the band by the measured width difference. */
async function atWidth(b: Mounted, key: string, width: number) {
  await b.redraw(bandProps(BAND_COLUMNS))
  const initial = (await timeline(b, key)).props.width
  await b.redraw(bandProps(BAND_COLUMNS + width - initial))
  const drawing = await cellDrawing(b, key)
  expect(drawing.props.width, `the public cell is ${width} columns wide`).toBe(width)
  return drawing
}

/** One entry per visible bar, even when several characters share a Text run. */
function barsOf(tree: unknown) {
  return runsOf(tree).flatMap(ink => Array.from(ink.text).filter(ch => ch === '▌').map(() => ink))
}

for (const surface of SURFACES) {
  for (const [theme, palette] of [['light', TIMELINE_LIGHT], ['dark', TIMELINE_DARK]] as const) {
    test(`R8.1 R8.2 TEST-1 REQ-1 REQ-9: ${theme} finished steps are full-colour foreground bars in oldest-first order, with the retained palette only [${surface}]`, async ($, on) => {
      const finished: Step[] = [
        ...FAMILIES.map(([name]) => toolStep(name)),
        { kind: 'thinking', tool: null, summary: 'finished thinking' },
        { kind: 'text', tool: null, summary: 'finished speaking' },
        { kind: 'ask', tool: null, summary: 'finished question' },
      ]
      const { b, key } = await setup($, on, surface, finished, ACTIVE, theme)
      const view = await atWidth(b, key, 160)

      const bars = barsOf(view.tree)
      expect(bars.map(ink => ink.color)).toEqual([
        ...FAMILIES.map(([, family]) => palette[family]), palette.think, palette.say, palette.ask,
      ])
      expect(view.text.startsWith(`${'▌'.repeat(finished.length)} `)).toBe(true)
      for (const ink of bars) {
        expect(ink.backgroundColor ?? null).toBeNull()
        expect(ink.dimColor).not.toBe(true)
      }
      // Exact object comparison also rejects R8.2's removed foldCount/foldTime/foldInk keys.
      expect(view.props.c).toEqual(palette)
      await b.unmount()
    })
  }

  test(`R8.1 TEST-2 REQ-2: four consecutive read-family steps draw four bars without an N× badge [${surface}]`, async ($, on) => {
    const { b, key } = await setup($, on, surface, ['Read', 'Grep', 'Glob', 'Read'].map(name => toolStep(name)))
    const view = await atWidth(b, key, 70)

    expect(barsOf(view.tree).map(ink => ink.color)).toEqual(Array(4).fill(TIMELINE_DARK.read))
    // R8.1 (clarified): bars and their one space at the left, blanks, then the words right-aligned
    // against the flush-right badge.
    expect(view.text).toMatch(/^▌▌▌▌ \s*current words  Bash  \d*:\d\d $/)
    expectFlushRight(view.tree, 70, `current words  Bash  ${blockTime(view.props.elapsed - 4_000)} `)
    expect(view.text).not.toContain('×')
    await b.unmount()
  })

  // Both sides of even/odd floor boundaries, including the first wide-cell width (30).
  for (const [width, kept] of [[30, 14], [31, 14], [32, 15], [33, 15], [52, 25], [53, 25]] as const) {
    test(`R8.1 TEST-3 REQ-3: width ${width} keeps the newest ${kept} finished bars and draws no fold count or past times [${surface}]`, async ($, on) => {
      const pattern = [
        ['Read', TIMELINE_DARK.read], ['Edit', TIMELINE_DARK.edit], ['Bash', TIMELINE_DARK.run],
        ['WebFetch', TIMELINE_DARK.web], ['Agent', TIMELINE_DARK.agent], ['UnlistedTool', TIMELINE_DARK.other],
      ] as const
      const finished = Array.from({ length: 36 }, (_, i) => toolStep(pattern[i % pattern.length]![0]))
      const { b, key } = await setup($, on, surface, finished)
      const view = await atWidth(b, key, width)
      const expected = Array.from({ length: 36 }, (_, i) => pattern[i % pattern.length]![1]).slice(-kept)

      expect(barsOf(view.tree).map(ink => ink.color)).toEqual(expected)
      expect(view.text.startsWith(`${'▌'.repeat(kept)} `)).toBe(true)
      expect(view.text).not.toMatch(/\+\d+|×/)
      // Only the current job has a time; discarded steps have neither times nor a count.
      expect(view.text.match(/\d*:\d\d/g) ?? []).toHaveLength(1)
      expectFlushRight(view.tree, width, ` Bash  ${blockTime(view.props.elapsed - 36_000)} `)
      await b.unmount()
    })
  }

  test(`R8.1 TEST-4 REQ-4: exactly one space separates the finished bars from current words [${surface}]`, async ($, on) => {
    const { b, key } = await setup($, on, surface, [toolStep('Read'), toolStep('Edit')])
    const view = await atWidth(b, key, 70)

    expect(barsOf(view.tree)).toHaveLength(2)
    // R8.1 (clarified): one space follows the last bar, then only blanks up to the words, which sit
    // one space left of the flush-right badge.
    expect(view.text.slice(0, 3)).toBe('▌▌ ')
    expect(view.text).toMatch(/^▌▌ \s*current words  Bash  \d*:\d\d $/)
    expectFlushRight(view.tree, 70, `current words  Bash  ${blockTime(view.props.elapsed - 2_000)} `)
    await b.unmount()
  })

  test(`R8.1 TEST-5 REQ-4 REQ-5: no finished steps means no leading bars or separator before the current job [${surface}]`, async ($, on) => {
    const { b, key } = await setup($, on, surface, [])
    const view = await atWidth(b, key, 70)

    expect(barsOf(view.tree)).toHaveLength(0)
    // R8.1 (clarified): with no finished step the row starts with blanks or the words — never a bar
    // or a leading separator — and the words stay right-aligned against the badge.
    expect(view.text).not.toContain('▌')
    expect(view.text).toMatch(/^\s*current words  Bash  \d*:\d\d $/)
    expectFlushRight(view.tree, 70, `current words  Bash  ${blockTime(view.props.elapsed)} `)
    await b.unmount()
  })

  for (const width of [30, 70]) {
    test(`R8.1 TEST-6 REQ-5: width ${width} cuts long words with … between the bars and a whole flush-right badge [${surface}]`, async ($, on) => {
      const words = `run ${'every single test in the repository '.repeat(20)}`
      const { b, key } = await setup($, on, surface,
        [toolStep('Read'), toolStep('Edit'), toolStep('Agent')], toolStep('Bash', words))
      const view = await atWidth(b, key, width)

      expect(barsOf(view.tree)).toHaveLength(3)
      // R8.1 (clarified): bars and their space at the left, blanks if any, then the cut words ending
      // in … one space left of the whole flush-right badge.
      expect(view.text).toMatch(/^▌▌▌ \s*run [^▌]*…  Bash  \d*:\d\d $/)
      expect(view.text).not.toContain(words)
      expectFlushRight(view.tree, width, ` Bash  ${blockTime(view.props.elapsed - 3_000)} `)
      await b.unmount()
    })
  }

  // R8.1: the bar cap also yields to the shown job's badge — at most width − (badge cells) − 2 —
  // so a long tool name's badge stays whole at 30 columns. Badge = ` name ` + ` time `.
  for (const [tool, shown] of [['WebSearch', 'WebSearch'], ['mcp__srv__create_session', 'create_session']] as const) {
    test(`R8.1 TEST-9 REQ-3 REQ-5: width 30 with 20 finished steps keeps the whole ${shown} badge flush right and draws fewer bars than the half-cell cap [${surface}]`, async ($, on) => {
      const width = 30
      const finished = Array.from({ length: 20 }, (_, i) => toolStep(i % 2 === 0 ? 'Read' : 'Edit'))
      const { b, key } = await setup($, on, surface, finished, toolStep(tool, 'current words'))
      const view = await atWidth(b, key, width)

      const badge = ` ${shown}  ${blockTime(view.props.elapsed - finished.length * 1_000)} `
      const halfCap = Math.floor(width / 2) - 1
      const kept = Math.min(halfCap, width - Array.from(badge).length - 2)
      expect(kept, 'the badge needs more room than the half-cell cap leaves').toBeLessThan(halfCap)

      // The whole two-part badge, name not cut, ends at the cell's right edge.
      expectFlushRight(view.tree, width, badge)
      expect(view.text).toContain(` ${shown} `)
      // The newest `kept` steps are bars, oldest of them at the left; older ones are not drawn.
      const colours = finished.map((_, i) => (i % 2 === 0 ? TIMELINE_DARK.read : TIMELINE_DARK.edit))
      expect(barsOf(view.tree).map(ink => ink.color)).toEqual(colours.slice(-kept))
      expect(view.text.startsWith(`${'▌'.repeat(kept)} `)).toBe(true)
      expect(view.text).not.toMatch(/\+\d+|×/)
      await b.unmount()
    })
  }

  test(`R8.1 TEST-7 REQ-6: a leaving Read job is not a bar during scroll-out and becomes one after it has gone [${surface}]`, async ($, on) => {
    const { h, extra, recent, b, key } = await setup($, on, surface, [], toolStep('Read', 'old target'))
    const initial = await atWidth(b, key, 70)
    expect(initial.text).toContain('old target')
    expect(barsOf(initial.tree)).toHaveLength(0)

    // R8.1: the scroll's clock starts at the new step's own `at`. Stamp `at` when the poll that
    // first carries the step is answered (the row patch reads `recent` then), not before untilPoll
    // advances the clock, so the cell receives the step well inside the old job's scroll-out
    // (old job's cells / 150 s). The stamp is taken once and kept for every later poll.
    let newAt: number | null = null
    const base = extra.row
    extra.row = {
      ...base,
      get recent(): Json[] {
        newAt ??= h.clock.now()
        return [...recent, { at: iso(newAt), kind: 'tool', tool: 'Bash', summary: 'new target' }]
      },
    }
    await untilPoll(h)
    expect(newAt, 'the poll carried the new step').not.toBeNull()
    await b.redraw()
    const leaving = await cellDrawing(b, key)

    // The next step has reached the Client, but the still-visible previous job is not history yet.
    expect(leaving.props.steps.at(-1)).toMatchObject({ k: 'tool', tool: 'Bash', x: 'new target' })
    expect(leaving.text).toContain('old target')
    expect(barsOf(leaving.tree)).toHaveLength(0)
    await b.advance(10) // well inside this short job's scroll-out at 150 cells/s
    expect(barsOf(await b.drawn({ in: key }))).toHaveLength(0)

    await b.advance(2_000) // beyond scroll-out plus scroll-in for these short jobs
    const arrived = await cellDrawing(b, key)
    expect(barsOf(arrived.tree).map(ink => ink.color)).toEqual([TIMELINE_DARK.read])
    // R8.1 (clarified): the bar and its space at the left, blanks, then the words against the badge.
    expect(arrived.text).toMatch(/^▌ \s*new target  Bash  \d*:\d\d $/)
    expect(arrived.text).not.toContain('old target')
    const tail = / Bash  \d*:\d\d $/.exec(arrived.text)
    expect(tail, arrived.text).not.toBeNull()
    expectFlushRight(arrived.tree, 70, tail![0])
    await b.unmount()
  })

  test(`R8.2 TEST-8 REQ-7: the live Client has exactly the current props and no before prop [${surface}]`, async ($, on) => {
    const { h, r, b, key } = await setup($, on, surface, [toolStep('Read')])
    const { found, props } = await timeline(b, key)

    expect(isFlowModule(found.props.module)).toBe(true)
    expect(Object.keys(props).sort()).toEqual([
      'c', 'elapsed', 'endedFor', 'idle', 'live', 'look', 'staleAfter', 'staleFull', 'steps', 'width',
    ])
    expect(props).toMatchObject({ look: 'badges', live: true, idle: 1, staleAfter: 5, staleFull: 120 })
    expect(props.elapsed).toBe(h.clock.now() - r.startedAt)
    expect(props.steps.map(s => s.tool)).toEqual(['Read', 'Bash'])
    expect(props.width).toBeGreaterThanOrEqual(30)
    await b.unmount()
  })
}
