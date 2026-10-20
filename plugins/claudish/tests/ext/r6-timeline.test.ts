// Spec R6.4 (the live cell: a timeline per slot), drawn through the plugin on both surfaces.
// What is recorded (trail steps from claudish's `recent` and from activity changes, the final step),
// how the band hands it over (a Client keyed `timeline:<runId>/<slot>` and its props), and how the
// module draws it (the badges look, an ended row, the legend, the `line` option, a narrow cell).
// Written from spec.md only. R8.1 replaces past badges with bars; R8.2 updates props and colours.
// Unchanged times and colours are worked from R6.4/R6.6.

import { expect } from 'claude-code/testing'
import { test } from '../kit'
import { harness, start, type Harness } from '../fake-claudish'
import { iso, type Json } from '../scenario'
import { bandProps, mountBand, SURFACES, walk } from '../ui'
import { POLL, children, mixCandidates, team } from './support'
import { bandRow, visibleText } from './v2-support'
import {
  TIMELINE_DARK, TIMELINE_PROP_KEYS, blockTime, cellDrawing, clientsIn, expectFlushRight, inkOfLast, runIds, runsOf,
  isFlowModule, silentFor, timeline, timelineKey, underGhost, untilPoll, type TimelineProps,
} from './r6-support'

type Kind = 'text' | 'thinking' | 'tool' | 'ask'
/** One entry of claudish's `recent` as it arrives on a row (R6.4). */
const step = (at: number, kind: Kind, tool: string | null, summary: string): Json => ({ at: iso(at), kind, tool, summary })
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A harness whose rows take per-slot extra fields, kept silent for a chosen number of seconds. */
function patched(on: Parameters<typeof harness>[0], extra: Record<string, Json>, seconds: { value: number | null }, options: Parameters<typeof harness>[1] = {}): Harness {
  const h: Harness = harness(on, {
    ...options,
    rowPatch: row => silentFor(() => h, () => seconds.value)({ ...row, ...(extra['*'] ?? {}), ...(extra[String(row.slot)] ?? {}) }),
  })
  return h
}

const kindsOf = (p: TimelineProps) => p.steps.map(s => (s.k === 'tool' ? `tool:${s.tool}` : s.k))

for (const surface of SURFACES) {
  // ── the Client and its props ─────────────────────────────────────────────

  test(`R6.4 R8.2 REQ-7: each row's live cell is a Client keyed timeline:<runId>/<slot>, module ./flow.tsx, with exactly the R8.2 props [${surface}]`, async ($, on) => {
    const seconds = { value: 3 as number | null }
    const h = patched(on, { '*': { activity: 'Bash', tool_calls: 1 } }, seconds)
    await start($, surface)
    const r = await team($, h, 'cell', ['cell-a', 'cell-b'])
    await untilPoll(h)
    const id = runIds(h)[0]!
    const b = await mountBand($, surface, bandProps(150))
    for (const slot of ['01', '02']) {
      const { found, props } = await timeline(b, timelineKey(id, slot))
      expect(isFlowModule(found.props.module), String(found.props.module)).toBe(true)
      expect(Object.keys(props).sort()).toEqual(TIMELINE_PROP_KEYS)
      expect(props).toMatchObject({ look: 'badges', live: true, idle: 3, staleAfter: 5, staleFull: 120 })
      expect(props.c).toEqual(TIMELINE_DARK)
      expect(props.elapsed).toBe(h.clock.now() - r.startedAt)
      expect(props.width).toBeGreaterThanOrEqual(30)
      if (typeof found.props.width === 'number') expect(found.props.width).toBe(props.width)
    }
    // one live cell per row; the row draws no activity text and no stale-meter beside it
    const row = await bandRow(b, 'cell-a')
    expect(clientsIn(row)).toHaveLength(1)
    expect(visibleText(row)).not.toMatch(/\bBash\b|[▰▱]/)
    await b.unmount()
  })

  // ── what is recorded ─────────────────────────────────────────────────────

  test(`R6.4: without recent, a step per change of activity kind or tool, a new step per tool call, wait for ASK, one final step and nothing after it [${surface}]`, async ($, on) => {
    const extra: Record<string, Json> = { '01': { activity: 'Bash', tool_calls: 1 } }
    const h = patched(on, extra, { value: null })
    await start($, surface)
    const r = await team($, h, 'trail', ['trail-model'])
    const key = timelineKey(runIds(h)[0]!, '01')
    const b = await mountBand($, surface, bandProps(150))
    const kinds = async () => { await b.redraw(); return kindsOf((await timeline(b, key)).props) }
    expect(await kinds()).toEqual(['tool:Bash'])
    const change = async (patch: Json) => { extra['01'] = { ...extra['01'], ...patch }; await h.clock.advance(POLL) }
    await change({ tool_calls: 2 }) // the same tool again is a new call
    expect(await kinds()).toEqual(['tool:Bash', 'tool:Bash'])
    await h.clock.advance(POLL) // nothing changed: no step
    expect(await kinds()).toEqual(['tool:Bash', 'tool:Bash'])
    await change({ activity: 'thinking' })
    await change({ activity: 'finishing' })
    await change({ activity: 'background' })
    await change({ activity: 'Read' })
    await change({ activity: null })
    expect(await kinds()).toEqual(['tool:Bash', 'tool:Bash', 'think', 'finish', 'background', 'tool:Read', 'idle'])
    h.fake.set(r.runId, '01', 'AWAITING_INPUT')
    await h.clock.advance(POLL)
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    const ended = ['tool:Bash', 'tool:Bash', 'think', 'finish', 'background', 'tool:Read', 'idle', 'wait', 'done']
    expect(await kinds()).toEqual(ended)
    // nothing is added after a final step: not from activity, a tool call, nor a late `recent`
    await change({ activity: 'Bash', tool_calls: 9, recent: [step(h.clock.now(), 'text', null, 'late words')] })
    await h.clock.advance(POLL * 2)
    expect(await kinds()).toEqual(ended)
    const { props } = await timeline(b, key)
    expect(props.live).toBe(false)
    for (let i = 1; i < props.steps.length; i++) expect(props.steps[i]!.t).toBeGreaterThanOrEqual(props.steps[i - 1]!.t)
    await b.unmount()
  })

  test(`R6.4: recent stands for the current turn — kinds map text→say, thinking→think, tool→tool, ask→wait; older steps stay, the rest is replaced [${surface}]`, async ($, on) => {
    const extra: Record<string, Json> = { '01': { activity: 'Bash', tool_calls: 1 } }
    const h = patched(on, extra, { value: null })
    await start($, surface)
    const r = await team($, h, 'recent', ['recent-model'])
    const S = r.startedAt
    const key = timelineKey(runIds(h)[0]!, '01')
    const b = await mountBand($, surface, bandProps(150))
    expect(kindsOf((await timeline(b, key)).props)).toEqual(['tool:Bash'])
    await h.clock.set(S + 10_000)
    extra['01'] = { ...extra['01'], recent: [
      step(S + 4_000, 'thinking', null, 'plan the change'),
      step(S + 6_000, 'tool', 'Read', 'src/a.ts'),
      step(S + 8_000, 'text', null, 'Reading done'),
    ] }
    await h.clock.advance(POLL)
    await b.redraw()
    let props = (await timeline(b, key)).props
    expect(kindsOf(props)).toEqual(['tool:Bash', 'think', 'tool:Read', 'say'])
    expect(props.steps.slice(1).map(s => s.x)).toEqual(['plan the change', 'src/a.ts', 'Reading done'])
    expect(props.steps.slice(1).map(s => s.t)).toEqual([4_000, 6_000, 8_000]) // ms from the run's start
    expect(props.steps[0]!.t).toBeLessThan(4_000)
    // a later recent starting at 6 s: the steps before 6 s stay, the rest is replaced
    extra['01'] = { ...extra['01'], recent: [
      step(S + 6_000, 'tool', 'Read', 'src/a.ts'),
      step(S + 9_000, 'ask', null, 'Which file next?'),
    ] }
    await h.clock.advance(POLL)
    await b.redraw()
    props = (await timeline(b, key)).props
    expect(kindsOf(props)).toEqual(['tool:Bash', 'think', 'tool:Read', 'wait'])
    expect(props.steps.map(s => s.x).slice(1)).toEqual(['plan the change', 'src/a.ts', 'Which file next?'])
    expect(props.steps.some(s => s.x === 'Reading done')).toBe(false) // replaced, not kept
    await b.unmount()
  })

  test(`R6.4 R8.2 TEST-9 REQ-8: the live cell still receives the newest 40 steps [${surface}]`, async ($, on) => {
    const extra: Record<string, Json> = { '01': { activity: 'Bash', tool_calls: 1 } }
    const h = patched(on, extra, { value: 1 })
    await start($, surface)
    const r = await team($, h, 'forty', ['forty-model'])
    const S = r.startedAt
    await h.clock.set(S + 55_000)
    // claudish sends at most its newest 20 steps, so 50 steps arrive over three polls, each list
    // starting after the previous one's last step (older steps stay, R6.4)
    const fifty = Array.from({ length: 50 }, (_, i) => step(S + i * 1_000, 'tool', i % 2 === 0 ? 'Read' : 'Edit', `f${i}.ts`))
    for (const [from, to] of [[0, 20], [20, 40], [40, 50]] as const) {
      extra['01'] = { activity: 'Bash', tool_calls: 1, recent: fifty.slice(from, to) }
      await untilPoll(h)
    }
    const b = await mountBand($, surface, bandProps(150))
    const { props } = await timeline(b, timelineKey(runIds(h)[0]!, '01'))
    expect(props.steps).toHaveLength(40)
    expect(props.steps[0]).toMatchObject({ t: 10_000, k: 'tool', tool: 'Read', x: 'f10.ts' })
    expect(props.steps[39]).toMatchObject({ t: 49_000, k: 'tool', tool: 'Edit', x: 'f49.ts' })
    await b.unmount()
  })

  test(`R6.4: a slot's final step — done, stop, or fail with "reason: detail" (or the reason alone) [${surface}]`, async ($, on) => {
    const extra: Record<string, Json> = { '*': { activity: 'Bash', tool_calls: 1 }, '02': { reason_detail: 'rate limited by the provider' } }
    const h = patched(on, extra, { value: null })
    await start($, surface)
    const r = await team($, h, 'finals', ['f-done', 'f-fail', 'f-timeout', 'f-stop'])
    h.fake.set(r.runId, '01', 'COMPLETED')
    h.fake.set(r.runId, '02', 'FAILED', 'api_error')
    h.fake.set(r.runId, '03', 'TIMEOUT', 'timeout')
    h.fake.set(r.runId, '04', 'CANCELLED', 'cancelled')
    await h.clock.advance(POLL)
    const id = runIds(h)[0]!
    const b = await mountBand($, surface, bandProps(150))
    const last = async (slot: string) => (await timeline(b, timelineKey(id, slot))).props.steps.at(-1)
    expect(await last('01')).toMatchObject({ k: 'done' })
    expect(await last('02')).toMatchObject({ k: 'fail', x: 'api_error: rate limited by the provider' })
    expect(await last('03')).toMatchObject({ k: 'fail', x: 'timeout' })
    expect(await last('04')).toMatchObject({ k: 'stop' })
    for (const slot of ['01', '02', '03', '04']) {
      const { props } = await timeline(b, timelineKey(id, slot))
      expect(props.live).toBe(false)
      expect(props.steps.filter(s => ['done', 'fail', 'stop'].includes(s.k))).toHaveLength(1) // exactly one final step
    }
    await b.unmount()
  })

  // ── how the badges look draws a live row ─────────────────────────────────

  test(`R6.4 R8.1 REQ-1 REQ-2 REQ-10: badges look — one bar per finished step, the current job's words then its name and live time flush right; the cell counts on by itself [${surface}]`, async ($, on) => {
    const extra: Record<string, Json> = {}
    const h = patched(on, extra, { value: 1 })
    await start($, surface)
    const r = await team($, h, 'badges', ['badge-model'])
    const S = r.startedAt
    await h.clock.set(S + 12_000)
    extra['01'] = { recent: [
      step(S, 'tool', 'Read', 'a.ts'),
      step(S + 2_000, 'tool', 'Read', 'b.ts'),
      step(S + 4_000, 'tool', 'Edit', 'a.ts'),
      step(S + 9_000, 'tool', 'Bash', 'bun test'),
    ] }
    await untilPoll(h)
    const key = timelineKey(runIds(h)[0]!, '01')
    const b = await mountBand($, surface, bandProps(160))
    const { tree, text, props } = await cellDrawing(b, key)
    expect(kindsOf(props)).toEqual(['tool:Read', 'tool:Read', 'tool:Edit', 'tool:Bash'])
    const live = props.elapsed - 9_000
    const time = ` ${blockTime(live)} `
    // R8.1: the two Read steps remain two bars, followed by one Edit bar and one space; then blanks,
    // then the words right-aligned one space left of the flush-right badge (R8.1 clarified).
    expect(text).toMatch(new RegExp(`^▌▌▌ \\s*bun test ${esc(` Bash ${time}`)}$`))
    expectFlushRight(tree, props.width, ` Bash ${time}`)
    for (const ink of inkOfLast(tree, ' Bash ')) {
      expect(ink.bold).toBe(true)
      expect(ink.color).toBe(TIMELINE_DARK.ink)
      expect(ink.backgroundColor).toBe(TIMELINE_DARK.run)
    }
    const timeFill = mixCandidates(TIMELINE_DARK.run, '#FFFFFF', 0.45)
    for (const ink of inkOfLast(tree, time)) {
      expect(ink.color).toBe(TIMELINE_DARK.timeInk)
      expect(timeFill.map(c => c.toUpperCase())).toContain(String(ink.backgroundColor).toUpperCase())
    }
    // R8.1: history is full-colour foreground bars, with no fill or fading.
    const bars = runsOf(tree).flatMap(ink => Array.from(ink.text).filter(ch => ch === '▌').map(() => ink))
    expect(bars.map(ink => ink.color)).toEqual([TIMELINE_DARK.read, TIMELINE_DARK.read, TIMELINE_DARK.edit])
    for (const ink of bars) {
      expect(ink.backgroundColor ?? null).toBeNull()
      expect(ink.dimColor).not.toBe(true)
    }
    // between polls the cell counts on by itself
    await b.advance(3_000)
    const later = visibleText(await b.drawn({ in: key }))
    expect(later.endsWith(` Bash  ${blockTime(live + 3_000)} `)).toBe(true)
    await b.unmount()
  })

  test(`R6.4: badges look — the current job's words are cut with … and its badge stays whole [${surface}]`, async ($, on) => {
    const extra: Record<string, Json> = {}
    const h = patched(on, extra, { value: 1 })
    await start($, surface)
    const r = await team($, h, 'cut', ['cut-model'])
    const S = r.startedAt
    await h.clock.set(S + 5_000)
    extra['01'] = { recent: [step(S + 1_000, 'tool', 'Bash', `run ${'every single test in the repository '.repeat(12)}`)] }
    await untilPoll(h)
    const b = await mountBand($, surface, bandProps(150))
    const { tree, text, props } = await cellDrawing(b, timelineKey(runIds(h)[0]!, '01'))
    const time = ` ${blockTime(props.elapsed - 1_000)} `
    expect(text).toContain('…')
    expect(text).toMatch(new RegExp(`…\\s* Bash ${esc(time)}$`))
    expectFlushRight(tree, props.width, ` Bash ${time}`)
    expect(text).not.toContain('repository '.repeat(12))
    await b.unmount()
  })

  test(`R6.4: badges look — silent (idle ≥ 5 s, not waiting) the time part turns ok / warn / bad with white text; from 3 s the cell turns at 5 s on its own; a waiting slot is never silent [${surface}]`, async ($, on) => {
    const extra: Record<string, Json> = { '01': { activity: 'Bash', tool_calls: 1 } }
    const seconds = { value: 3 as number | null }
    const h = patched(on, extra, seconds)
    await start($, surface)
    const r = await team($, h, 'silence', ['quiet-model'])
    const key = timelineKey(runIds(h)[0]!, '01')
    await untilPoll(h)
    const b = await mountBand($, surface, bandProps(150))
    const timeInk = async () => {
      const { tree } = await cellDrawing(b, key) // laid out at the width the band handed it
      const m = / (\d*:\d\d) $/.exec(visibleText(tree))
      expect(m, visibleText(tree)).not.toBeNull()
      return inkOfLast(tree, ` ${m![1]} `)
    }
    const normal = mixCandidates(TIMELINE_DARK.run, '#FFFFFF', 0.45).map(c => c.toUpperCase())
    const expectNormal = async (why: string) => {
      for (const ink of await timeInk()) {
        expect(ink.color, why).toBe(TIMELINE_DARK.timeInk)
        expect(normal, why).toContain(String(ink.backgroundColor).toUpperCase())
      }
    }
    const expectSilent = async (fill: string, why: string) => {
      for (const ink of await timeInk()) {
        expect(ink.color, why).toBe(TIMELINE_DARK.silenceInk)
        expect(ink.color, why).toBe('#FFFFFF')
        expect(ink.backgroundColor, why).toBe(fill)
      }
    }
    expect((await timeline(b, key)).props.idle).toBe(3)
    await expectNormal('3 s: streaming')
    await b.advance(1_000)
    await expectNormal('4 s: still streaming')
    await b.advance(1_000)
    await expectSilent(TIMELINE_DARK.ok, '5 s: silent, ok')
    for (const [secs, fill] of [[7, TIMELINE_DARK.ok], [29, TIMELINE_DARK.ok], [30, TIMELINE_DARK.warn], [89, TIMELINE_DARK.warn], [90, TIMELINE_DARK.bad], [240, TIMELINE_DARK.bad]] as const) {
      seconds.value = secs
      await untilPoll(h)
      await b.redraw()
      expect((await timeline(b, key)).props.idle).toBe(secs)
      await expectSilent(fill, `${secs} s`)
    }
    // waiting on the person is not silence: the asks badge keeps its own time colours
    h.fake.set(r.runId, '01', 'AWAITING_INPUT')
    extra['01'] = { activity: null, tool_calls: 1 }
    seconds.value = 40
    await untilPoll(h)
    await b.redraw()
    // the trail recorded the wait (R6.4: ASK states → wait), and the cell draws it as the current job
    expect(kindsOf((await timeline(b, key)).props).at(-1)).toBe('wait')
    // R6.4 "A new job scrolls in": the old job scrolls out (150 cells/s), the new one in (120 cells/s);
    // move the cell's own clock past it. Waiting on the person, the slot stays not silent meanwhile.
    await cellDrawing(b, key)
    await b.advance(2_000)
    const { tree } = await cellDrawing(b, key)
    expect(visibleText(tree)).toMatch(/ asks  \d*:\d\d $/)
    const askFill = mixCandidates(TIMELINE_DARK.ask, '#FFFFFF', 0.45).map(c => c.toUpperCase())
    const m = / (\d*:\d\d) $/.exec(visibleText(tree))!
    for (const ink of inkOfLast(tree, ` ${m[1]} `)) {
      expect(ink.color).toBe(TIMELINE_DARK.timeInk)
      expect(askFill).toContain(String(ink.backgroundColor).toUpperCase())
    }
    await b.unmount()
  })

  test(`R8.1 REQ-3: badges look — finished-step bars keep only the newest floor(width/2)−1 steps without a fold badge [${surface}]`, async ($, on) => {
    const extra: Record<string, Json> = { '01': { activity: 'Bash', tool_calls: 1 } }
    const h = patched(on, extra, { value: 1 })
    await start($, surface)
    const r = await team($, h, 'fold', ['fold-model'])
    const S = r.startedAt
    await h.clock.set(S + 80_000)
    // 24 finished steps of 3 s, alternating colours, then the current job. claudish sends
    // at most 20 steps, so they arrive over two polls, the second list starting after the first's last.
    const blocks = Array.from({ length: 24 }, (_, i) => step(S + i * 3_000, 'tool', i % 2 === 0 ? 'Read' : 'Edit', `f${i}`))
    extra['01'] = { activity: 'Bash', tool_calls: 1, recent: blocks.slice(0, 12) }
    await untilPoll(h)
    extra['01'] = { activity: 'Bash', tool_calls: 1, recent: [...blocks.slice(12), step(S + 72_000, 'tool', 'Bash', 'bun test')] }
    await untilPoll(h)
    const b = await mountBand($, surface, bandProps(140))
    expect((await timeline(b, timelineKey(runIds(h)[0]!, '01'))).props.steps).toHaveLength(25)
    const { tree, text, props } = await cellDrawing(b, timelineKey(runIds(h)[0]!, '01'))
    const kept = Math.min(24, Math.floor(props.width / 2) - 1)
    const bars = runsOf(tree).flatMap(ink => Array.from(ink.text).filter(ch => ch === '▌').map(() => ink.color))
    const expected = Array.from({ length: 24 }, (_, i) => i % 2 === 0 ? TIMELINE_DARK.read : TIMELINE_DARK.edit).slice(-kept)
    expect(bars).toEqual(expected)
    expect(text.startsWith(`${'▌'.repeat(kept)} `)).toBe(true)
    expect(text).not.toMatch(/\+\d+|×/)
    expectFlushRight(tree, props.width, ` Bash  ${blockTime(props.elapsed - 72_000)} `)
    await b.unmount()
  })

  // ── an ended row ─────────────────────────────────────────────────────────

  test(`R6.4: an ended row — the last words or the failure's words at the left, the end badge alone flush right, no time, no past badges [${surface}]`, async ($, on) => {
    const longWords = `All checks pass. ${'Here is the detailed summary of every change. '.repeat(6)}`
    const extra: Record<string, Json> = { '02': { reason_detail: 'rate limited by the provider' } }
    const h = patched(on, extra, { value: null })
    await start($, surface)
    const r = await team($, h, 'ended', ['e-done', 'e-fail', 'e-timeout', 'e-stop'])
    const S = r.startedAt
    await h.clock.set(S + 10_000)
    extra['01'] = { recent: [step(S, 'tool', 'Read', 'a.ts'), step(S + 5_000, 'text', null, longWords)] }
    extra['*'] = { activity: 'Edit', tool_calls: 2 }
    await h.clock.advance(POLL)
    h.fake.set(r.runId, '01', 'COMPLETED')
    h.fake.set(r.runId, '02', 'FAILED', 'api_error')
    h.fake.set(r.runId, '03', 'TIMEOUT', 'timeout')
    h.fake.set(r.runId, '04', 'CANCELLED', 'cancelled')
    await h.clock.advance(POLL)
    const id = runIds(h)[0]!
    const b = await mountBand($, surface, bandProps(150))
    for (const [slot, words, badge, fill] of [
      ['01', 'All checks pass.', ' done ', TIMELINE_DARK.done],
      ['02', 'rate limited by the provider', ' api_error ', TIMELINE_DARK.fail],
      ['03', null, ' timeout ', TIMELINE_DARK.fail],
      ['04', null, ' stopped ', TIMELINE_DARK.dim],
    ] as const) {
      const key = timelineKey(id, slot)
      const { tree, text, props } = await cellDrawing(b, key)
      expect(props.live, slot).toBe(false)
      expectFlushRight(tree, props.width, badge)
      for (const ink of inkOfLast(tree, badge)) expect(ink.backgroundColor, `${slot} end badge`).toBe(fill)
      expect(text, `${slot}: no time part, no past badge`).not.toMatch(/\d*:\d\d|\d×/)
      if (words !== null) expect(text.trimStart().startsWith(words), `${slot}: "${text}"`).toBe(true)
      else expect(text.trim(), slot).toBe(badge.trim())
    }
    // words that do not fit end in …
    const done = await cellDrawing(b, timelineKey(id, '01'))
    expect(done.text).toMatch(/…\s* done $/)
    // an ended row's elapsed is frozen at its end
    const before = done.props.elapsed
    await h.clock.advance(5_000)
    await b.redraw()
    expect((await timeline(b, timelineKey(id, '01'))).props.elapsed).toBe(before)
    expect((await timeline(b, timelineKey(id, '01'))).props.endedFor).toBeGreaterThan(done.props.endedFor)
    await b.unmount()
  })

  // ── the legend ───────────────────────────────────────────────────────────

  test(`R6.4 R8.2 REQ-9 REQ-10: the legend — one line under the rows, indented 2, a Client keyed legend naming each colour once in the order met; none with no finished step, none when the live cell is dropped, none once every row ended [${surface}]`, async ($, on) => {
    const extra: Record<string, Json> = { '01': { activity: 'Bash', tool_calls: 1 } }
    const h = patched(on, extra, { value: 1 })
    await start($, surface)
    const r = await team($, h, 'legend', ['legend-model'])
    const S = r.startedAt
    const b = await mountBand($, surface, bandProps(150))
    // one step, still current: no finished step, no legend
    expect(await b.find({ type: 'Client', key: 'legend' })).toBeUndefined()
    await h.clock.set(S + 12_000)
    extra['01'] = { recent: [
      step(S, 'tool', 'Read', 'a.ts'), step(S + 2_000, 'tool', 'Read', 'b.ts'),
      step(S + 4_000, 'tool', 'Edit', 'a.ts'), step(S + 6_000, 'tool', 'Grep', 'TODO'),
      step(S + 9_000, 'tool', 'Bash', 'bun test'),
    ] }
    await untilPoll(h)
    await b.redraw()
    const legend = await b.find({ type: 'Client', key: 'legend' })
    expect(legend).toBeDefined()
    expect(isFlowModule(legend!.props.module), String(legend!.props.module)).toBe(true)
    expect((legend!.props.props as { c: unknown }).c).toEqual(TIMELINE_DARK)
    expect(Object.keys(legend!.props.props as object).sort()).toEqual(['c', 'legend'])
    await b.resize({ columns: 120, rows: 1, in: 'legend' })
    const text = visibleText(await b.drawn({ in: 'legend' }))
    expect(text).toContain(' read ')
    expect(text).toContain(' edit ')
    expect(text.indexOf(' read ')).toBeLessThan(text.indexOf(' edit '))
    expect(text.split(' read ').length - 1).toBe(1) // Read and Grep share a colour: named once
    expect(text).not.toMatch(/ think | say /)
    // under the rows, after a 2-cell indent
    const tree = await b.drawn()
    const nodes = walk(tree).map(x => x.node)
    const legendAt = nodes.findIndex(n => n.type === 'Client' && (n.props?.key ?? (n as { key?: unknown }).key) === 'legend')
    const lastShow = nodes.map((n, i) => (n.type === 'Button' && n.props?.label === 'Show' ? i : -1)).reduce((a, c) => Math.max(a, c), -1)
    expect(legendAt).toBeGreaterThan(lastShow)
    const legendNode = nodes[legendAt]!
    const parent = nodes.find(n => children(n).includes(legendNode))!
    // R6.4: a row Box holding an empty Box of width 2 (the indent), then the legend Client
    expect(parent.type).toBe('Box')
    const siblings = children(parent)
    const at = siblings.indexOf(legendNode)
    expect(at, 'the indent comes before the legend').toBeGreaterThanOrEqual(1)
    const indent = siblings[at - 1] as { type?: string; props?: Record<string, unknown> }
    expect(indent.type).toBe('Box')
    expect(indent.props?.width, 'a 2-cell indent').toBe(2)
    expect(children(indent as never), 'the indent is empty').toHaveLength(0)
    // the plan dropped the live cell: no legend
    await b.redraw(bandProps(41))
    expect(await b.find({ type: 'Client', key: timelineKey(runIds(h)[0]!, '01') })).toBeUndefined()
    expect(await b.find({ type: 'Client', key: 'legend' })).toBeUndefined()
    // every row ended: no legend
    await b.redraw(bandProps(150))
    expect(await b.find({ type: 'Client', key: 'legend' })).toBeDefined()
    h.fake.set(r.runId, '01', 'COMPLETED')
    await h.clock.advance(POLL)
    await b.redraw()
    expect(await b.find({ type: 'Client', key: 'legend' })).toBeUndefined()
    await b.unmount()
  })

  // ── narrow ───────────────────────────────────────────────────────────────

  test(`R6.4: narrow (cell < 30) — one ▌ bar per finished step, then the badge flush right, as many bars as fit; under badge + 1 cell, a bar per step including the blinking current one [${surface}]`, { timeoutMs: 60_000 }, async ($, on) => {
    const extra: Record<string, Json> = {}
    const h = patched(on, extra, { value: 1 })
    await start($, surface)
    const r = await team($, h, 'narrow', ['narrow-model-x'])
    const S = r.startedAt
    await h.clock.set(S + 12_000)
    extra['01'] = { recent: [
      step(S, 'tool', 'Read', 'a.ts'), step(S + 2_000, 'tool', 'Read', 'b.ts'),
      step(S + 4_000, 'tool', 'Edit', 'a.ts'), step(S + 9_000, 'tool', 'Bash', 'bun test'),
    ] }
    await untilPoll(h)
    const key = timelineKey(runIds(h)[0]!, '01')
    const b = await mountBand($, surface, bandProps(150))
    const cellAt = new Map<number, number>()
    for (let width = 150; width >= 41; width -= 1) {
      await b.redraw(bandProps(width))
      const found = await b.find({ type: 'Client', key })
      if (found) cellAt.set(width, (found.props.props as TimelineProps).width)
    }
    const roomy = [...cellAt].find(([, c]) => c >= 20 && c < 30)
    // the badge is ' Bash ' + ' :0N ' = 11 cells; narrower than the badge plus one cell (< 12): bars alone
    const tight = [...cellAt].find(([, c]) => c >= 9 && c <= 11)
    const between = [...cellAt].filter(([, c]) => c >= 12 && c <= 14)
    expect(roomy, 'a band width giving a 20–29 cell').toBeDefined()
    expect(tight, 'a band width giving a 9–11 cell').toBeDefined()
    expect(between.length, 'band widths giving 12–14 cells').toBeGreaterThan(0)
    await b.redraw(bandProps(roomy![0]))
    const narrow = await cellDrawing(b, key)
    const time = ` ${blockTime(narrow.props.elapsed - 9_000)} `
    expect(Array.from(narrow.text).filter(ch => ch === '▌')).toHaveLength(3) // one per finished step
    expect(narrow.text).not.toMatch(/×|bun test/) // no past badges, no words
    expectFlushRight(narrow.tree, narrow.props.width, ` Bash ${time}`)
    const bars: unknown[] = []
    for (const x of runsOf(narrow.tree)) for (const ch of Array.from(x.text)) if (ch === '▌') bars.push(x.color)
    expect(bars).toEqual([TIMELINE_DARK.read, TIMELINE_DARK.read, TIMELINE_DARK.edit])
    // room for the badge plus one space: as many bars as fit before it (bars + 1 space + 11-cell badge)
    for (const [width, cell] of between) {
      await b.redraw(bandProps(width))
      const mid = await cellDrawing(b, key)
      expect(Array.from(mid.text).filter(ch => ch === '▌'), `${cell}-cell`).toHaveLength(Math.min(3, cell - 12))
      expect(mid.text.endsWith(` Bash ${time}`), `${cell}-cell: "${mid.text}"`).toBe(true)
    }
    // too narrow for the badge plus one cell: one bar per step, the current one included, and it blinks
    await b.redraw(bandProps(tight![0]))
    const bare = await cellDrawing(b, key)
    expect(bare.text.trim()).toBe('▌▌▌▌')
    const barColours = () => runsOf(bare.tree).flatMap(x => Array.from(x.text).filter(ch => ch === '▌').map(() => String(x.color).toUpperCase()))
    expect(barColours().slice(0, 3)).toEqual([TIMELINE_DARK.read, TIMELINE_DARK.read, TIMELINE_DARK.edit])
    const current = barColours()[3]
    await b.advance(1_000) // the cell's own clock moves one second: the current bar blinks
    const blinked = await cellDrawing(b, key)
    const after = runsOf(blinked.tree).flatMap(x => Array.from(x.text).filter(ch => ch === '▌').map(() => String(x.color).toUpperCase()))
    expect(after).toHaveLength(4)
    expect(after.slice(0, 3)).toEqual([TIMELINE_DARK.read, TIMELINE_DARK.read, TIMELINE_DARK.edit])
    expect([current, after[3]], 'full run colour on one second, faded on the next').toContain(TIMELINE_DARK.run)
    expect(after[3]).not.toBe(current)
    await b.unmount()
  })

  // ── the `line` option ────────────────────────────────────────────────────

  test(`R6.4: timeline option line — pac-man at the left, each ended step's time (2.4s, 14s, 1m05s), a ghost when silent, no legend [${surface}]`, { options: { timeline: 'line' } }, async ($, on) => {
    const extra: Record<string, Json> = {}
    const seconds = { value: 1 as number | null }
    const h = patched(on, extra, seconds)
    await start($, surface)
    const r = await team($, h, 'line', ['line-model'])
    const S = r.startedAt
    await h.clock.set(S + 85_000)
    extra['01'] = { recent: [
      step(S, 'tool', 'Read', 'a.ts'), step(S + 2_400, 'tool', 'Edit', 'a.ts'),
      step(S + 16_400, 'tool', 'Grep', 'TODO'), step(S + 81_400, 'tool', 'Bash', 'bun test'),
    ] }
    await untilPoll(h)
    const key = timelineKey(runIds(h)[0]!, '01')
    const b = await mountBand($, surface, bandProps(180))
    expect((await timeline(b, key)).props.look).toBe('line')
    expect((await timeline(b, key)).props.idle).toBe(1)
    await b.resize({ columns: (await timeline(b, key)).props.width, rows: 1, in: key })
    // 1 s of silence: streaming, so no ghost yet
    expect(visibleText(await b.drawn({ in: key }))).not.toContain('ᗣ')
    expect(await b.find({ type: 'Client', key: 'legend' })).toBeUndefined()
    // the cell counts silence on its own clock: 30 s on it is silent, and the steps have typed in
    await b.advance(30_000)
    const text = visibleText(await b.drawn({ in: key }))
    expect(text.trimStart().startsWith('ᗧ')).toBe(true)
    expect(text).toContain('ᗣ')
    // the ghost closes in over the line, so it may cover one cell of a time: never more
    for (const t of ['2.4s', '14s', '1m05s']) expect(text, t).toMatch(underGhost(t))
    expect(await b.find({ type: 'Client', key: 'legend' })).toBeUndefined()
    await b.unmount()
  })

  test(`R6.4: timeline option line — an ended row reads ✓ done, ■ stopped, and a failure ends in ✕ [${surface}]`, { options: { timeline: 'line' } }, async ($, on) => {
    const h = patched(on, { '*': { activity: 'Bash', tool_calls: 1 } }, { value: null })
    await start($, surface)
    const r = await team($, h, 'line-end', ['l-done', 'l-stop', 'l-fail'])
    h.fake.set(r.runId, '01', 'COMPLETED')
    h.fake.set(r.runId, '02', 'CANCELLED', 'cancelled')
    h.fake.set(r.runId, '03', 'FAILED', 'api_error')
    await h.clock.advance(POLL)
    const id = runIds(h)[0]!
    const b = await mountBand($, surface, bandProps(160))
    for (const slot of ['01', '02', '03']) {
      const { props } = await timeline(b, timelineKey(id, slot))
      expect(props.look).toBe('line')
      await b.resize({ columns: props.width, rows: 1, in: timelineKey(id, slot) })
    }
    await b.advance(30_000) // the death animation runs to its end
    const textOf = async (slot: string) => visibleText(await b.drawn({ in: timelineKey(id, slot) }))
    expect(await textOf('01')).toContain('✓')
    expect(await textOf('02')).toContain('■')
    expect(await textOf('03')).toContain('✕')
    expect(await textOf('01')).not.toMatch(/[■✕]/)
    expect(await textOf('02')).not.toMatch(/[✓✕]/)
    expect(await b.find({ type: 'Client', key: 'legend' })).toBeUndefined()
    await b.unmount()
  })

  test(`R6.4: the option — anything but line means badges [${surface}]`, { options: { timeline: 'badges' } }, async ($, on) => {
    const h = patched(on, { '*': { activity: 'Bash', tool_calls: 1 } }, { value: 1 })
    await start($, surface)
    await team($, h, 'option', ['option-model'])
    const b = await mountBand($, surface, bandProps(150))
    expect((await timeline(b, timelineKey(runIds(h)[0]!, '01'))).props.look).toBe('badges')
    const { text } = await cellDrawing(b, timelineKey(runIds(h)[0]!, '01'))
    expect(text).not.toContain('ᗧ')
    await b.unmount()
  })
}

