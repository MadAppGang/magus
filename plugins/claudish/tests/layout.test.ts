// Pure layout: colour spelling, the tab's viewport and style budget, the tab's fit from the
// engine's Pane props, and the band's column plan at the widths that matter.

import { describe, expect, test } from 'claude-code/testing'
import type { ClaudishFrame, ClaudishRun, ClaudishRuns, ClaudishSlot, ClaudishStyleSpan } from '../types'
import { PANE_LINE_COST, PANE_SEGMENT_COST, PANE_STYLE_BUDGET } from '../hooks/status/domain'
import { LOOPS_MARK, TOOLS_MARK, bandModel, colorSpelling, count, dollars, fitColumns, paneCost, paneFit, paneLines, planWidth, providerName, tokenIO, type BandInput } from '../hooks/status/layout'

const fit = (columns = 200, rows = 60, paint = true) => ({ columns, rows, paint })

function frame(lines: string[], styles?: ClaudishStyleSpan[][]): ClaudishFrame {
  return { seq: 1, cols: 160, rows: lines.length, cursor: null, lines, ...(styles ? { styles } : {}) }
}

const span = (col: number, len: number, fg: ClaudishStyleSpan['fg'], bold = false): ClaudishStyleSpan => ({ col, len, fg, bg: null, bold })

describe('layout: colour spelling', () => {
  test('rgb, the cube, the grey ramp and the 16 named', () => {
    expect(colorSpelling({ rgb: 0x0a0b0c })).toBe('#0a0b0c')
    expect(colorSpelling({ index: 16 })).toBe('#000000')
    expect(colorSpelling({ index: 196 })).toBe('#ff0000')
    expect(colorSpelling({ index: 208 })).toBe('#ff8700')
    expect(colorSpelling({ index: 231 })).toBe('#ffffff')
    expect(colorSpelling({ index: 232 })).toBe('#080808')
    expect(colorSpelling({ index: 255 })).toBe('#eeeeee')
    expect(colorSpelling({ index: 1 })).toBe('#cd0000')
    expect(colorSpelling({ index: 12 })).toBe('#5c5cff')
  })
})

describe('layout: paneLines', () => {
  test('segments cut at span boundaries reproduce the line exactly; a short frame is top-aligned (no blank rows above it)', () => {
    const line = '✕ an error line drawn red, then plain'
    const out = paneLines(frame([line], [[span(0, 5, { index: 1 }, true), span(11, 4, { rgb: 0x112233 })]]), fit())
    expect(out.painted).toBe(true)
    // R6.5: top-aligned: the one line is the first drawn, with no blank line above it
    expect(out.lines).toHaveLength(1)
    const parts = out.lines[0]!
    expect(parts.map(p => (typeof p === 'string' ? p : p.text)).join('')).toBe(line)
    expect(parts[0]).toEqual({ text: '✕ an ', color: '#cd0000', bold: true })
    expect(parts[2]).toEqual({ text: 'line', color: '#112233' })
  })

  test('a line holding a wide character draws plain; paint off draws every line plain', () => {
    const out = paneLines(frame(['漢字 here', 'ascii'], [[span(0, 2, { index: 1 })], [span(0, 2, { index: 1 })]]), fit())
    expect(out.lines).toHaveLength(2)
    expect(out.lines[0]).toEqual(['漢字 here'])
    expect(typeof out.lines[1]![0]).toBe('object')
    const off = paneLines(frame(['ascii'], [[span(0, 2, { index: 1 })]]), fit(200, 60, false))
    expect(off).toEqual({ lines: [['ascii']], painted: false })
  })

  test('the viewport: trailing blanks trimmed, the last rows-1 lines, each cut at columns + 1', () => {
    const lines = Array.from({ length: 50 }, (_, i) => (i <= 46 ? `${i} ${'w'.repeat(150)}` : ''))
    const out = paneLines(frame(lines), fit(80, 20))
    expect(out.lines).toHaveLength(19)
    expect((out.lines[18]![0] as string).startsWith('46 ')).toBe(true)
    expect((out.lines[0]![0] as string).startsWith('28 ')).toBe(true)
    expect(Array.from(out.lines[0]![0] as string)).toHaveLength(81)
  })

  test('the style budget: exactly at the budget paints, one segment more draws the whole frame plain', () => {
    // 50 lines × (64 + 40 characters + 7 × 128) = 50,000
    const lines = Array.from({ length: 50 }, () => 'x'.repeat(40))
    const seven = (extra: number) => lines.map((_, i) => Array.from({ length: 7 + (i === 0 ? extra : 0) }, (_, k) => span(k * 5, 5, { index: 16 + ((i + k) % 200) })))
    expect(PANE_LINE_COST + 40 + 7 * PANE_SEGMENT_COST).toBe(PANE_STYLE_BUDGET / 50)
    // a tab exactly the frame's height (50 lines + the header row), so no blank padding is costed
    const at = paneLines(frame(lines, seven(0)), fit(200, 51))
    expect(paneCost(at.lines)).toBe(PANE_STYLE_BUDGET)
    expect(at.painted).toBe(true)
    const over = paneLines(frame(lines, seven(1)), fit(200, 51))
    expect(over.painted).toBe(false)
    expect(over.lines.every(l => l.length === 1 && typeof l[0] === 'string')).toBe(true)
  })

  test('paneFit reads the engine\'s Pane props: the width, and the height from the scroll window', () => {
    expect(paneFit({ bodyColumns: 80, scroll: { bodyRows: 20 } }, 'terminal')).toEqual({ columns: 80, rows: 20, paint: true })
    const missing = paneFit({ bodyColumns: 80 }, 'desktop')
    expect(missing).toEqual({ columns: 80, rows: 20, paint: true })
    expect(paneFit({ bodyColumns: Number.NaN, scroll: { bodyRows: Number.POSITIVE_INFINITY } }, 'vscode')).toEqual({ columns: 80, rows: 20, paint: false })
  })
})

function slot(n: string, over: Partial<ClaudishSlot> = {}): ClaudishSlot {
  return {
    slot: n, model: 'gpt-6.1-sol', provider: 'OpenRouter', state: 'RUNNING', reason: null,
    tokensIn: 48_100, tokensOut: 2300, toolCalls: 12, turnsCompleted: 3, idleSeconds: 4,
    lastActivityAt: 0, activity: 'thinking', asked: false, costUsd: null, ...over,
  }
}

function run(id: string, slots: ClaudishSlot[], over: Partial<ClaudishRun> = {}): ClaudishRun {
  return {
    id, epoch: 0, ref: { kind: 'panel', server: 's', token: id, address: `/w/${id}` }, label: 'plan-review', generation: 1,
    slots, activityAt: 0, missedPolls: 0, missingSince: null, unreachableSince: null, unknownSince: {},
    personStops: [], waits: {}, lostReason: null, settledAt: null, ...over,
  }
}

function input(list: ClaudishRun[], over: Partial<BandInput> = {}): BandInput {
  const runs: ClaudishRuns = { epoch: 0, starts: {}, list }
  const can = { cancel: true, capture: true, spans: true, resize: true }
  return {
    runs, feeds: { 's#panel': { kind: 'speaks', version: 1, can, declined: 0 }, 's#delegation': { kind: 'speaks', version: 1, can, declined: 0 } },
    stops: {}, ledger: { epoch: 0, entries: {} }, earlier: { runs: 0, done: 0, failed: 0, stopped: 0 },
    bodyColumns: 120, maxRows: 20, now: 0, panel: { open: false, active: null }, ...over,
  }
}

describe('layout: the band', () => {
  const four = [slot('01'), slot('02', { model: 'kimi-k3', activity: 'Bash' }), slot('03', { state: 'COMPLETED', idleSeconds: null }), slot('04', { state: 'FAILED', reason: 'blocked', idleSeconds: null })]

  test('the planned row fits bodyColumns at 120, 59 and 41; at 20 the header draws alone; the model is never dropped', () => {
    for (const cols of [120, 59, 41]) {
      const model = bandModel(input([run('a', four)], { bodyColumns: cols }))!
      expect(model.plan).not.toBeNull()
      expect(planWidth(model.plan!)).toBeLessThanOrEqual(cols)
    }
    expect(bandModel(input([run('a', four)], { bodyColumns: 59 }))!.plan!.activity).toBe(0)
    const narrow = bandModel(input([run('a', four)], { bodyColumns: 20 }))!
    expect(narrow.plan).toBeNull()
    expect(narrow.rows).toEqual([])
    const rows = bandModel(input([run('a', four)]))!.rows
    // §9 floor: lead 2 + id 2 + code 5 + model min(8, content) + Stop 9 + Show 8 + 5 gaps
    // §10 floor: lead 2 + id 2 + code 5 + model (min(8, content) + 2) + Stop 9 + Show 8 + 5 gaps
    const floor = fitColumns(41, rows)!
    expect(planWidth(floor)).toBe(41)
    expect(floor.model).toBe(10) // shrunk to 8 cells of text plus its padding, never dropped
    expect([floor.id, floor.badge, floor.provider, floor.tokens, floor.tools, floor.loops, floor.cost, floor.meter, floor.activity]).toEqual([2, 5, 0, 0, 0, 0, 0, 0, 0])
    expect(fitColumns(40, rows)).toBeNull()
    // a model shorter than 8 keeps its own width at the floor
    const short = bandModel(input([run('a', [slot('01', { model: 'm-x' })])]))!.rows
    expect(planWidth(fitColumns(36, short)!)).toBe(36)
    expect(fitColumns(36, short)!.model).toBe(5) // 3 cells of text plus its padding
    expect(fitColumns(35, short)).toBeNull()
  })

  test('count (R6.1): the integer below 1000; one decimal and k below 9 950; a whole k below 999 500; then one decimal and M', () => {
    expect(count(0)).toBe('0')
    expect(count(850)).toBe('850')
    expect(count(999)).toBe('999')
    expect(count(1000)).toBe('1.0k')
    expect(count(5_500)).toBe('5.5k')
    expect(count(9_949)).toBe('9.9k')
    expect(count(9_950)).toBe('10k') // never 10.0k
    expect(count(12_700)).toBe('13k') // not 12.7k
    expect(count(999_499)).toBe('999k')
    expect(count(999_500)).toBe('1.0M') // never 1000k
    expect(count(2_345_678)).toBe('2.3M')
    expect(count(null)).toBe('—')
    for (const n of [9_950, 12_700, 48_100, 999_499]) expect(count(n)).not.toMatch(/\.\dk$/)
  })

  test('tokens (R6.1): in then out, each value in its own unit; an unknown value reads —, both unknown the cell reads —', () => {
    expect(tokenIO(12_700, 780)).toBe('↑13k ↓780')
    expect(tokenIO(850, 120)).toBe('↑850 ↓120')
    expect(tokenIO(999, 1000)).toBe('↑999 ↓1.0k')
    expect(tokenIO(42_900, 37)).toBe('↑43k ↓37') // measured live: a native slot's few output tokens
    expect(tokenIO(42_900, 0)).toBe('↑43k ↓0')
    expect(tokenIO(10_000, 49)).toBe('↑10k ↓49')
    expect(tokenIO(37, 42_900)).toBe('↑37 ↓43k') // either side
    expect(tokenIO(2_345_678, 40_000)).toBe('↑2.3M ↓40k')
    expect(tokenIO(5_000_000, 900)).toBe('↑5.0M ↓900')
    expect(tokenIO(12_000, null)).toBe('↑12k ↓—')
    expect(tokenIO(null, 780)).toBe('↑— ↓780')
    expect(tokenIO(null, null)).toBe('—')
    for (const [a, b] of [[42_900, 37], [2_345_678, 40_000], [999_960, 10], [1000, 0], [0, 7_000_000]] as const) {
      expect(tokenIO(a, b)).not.toMatch(/[↑↓]-?0\.0[kM]/) // a few real tokens never read as none
    }
    const row = bandModel(input([run('a', [slot('01', { tokensIn: 42_900, tokensOut: 37 })])]))!.rows[0]!
    expect([row.tokensIn, row.tokensOut]).toEqual(['↑43k', '↓37']) // the two halves of the tokens part
  })

  test('cost: <$0.01, $x.xx below $10, $xx.x below $100, $xxx; — when claudish reports none', () => {
    expect(dollars(0.004)).toBe('<$0.01')
    expect(dollars(0.42)).toBe('$0.42')
    expect(dollars(9.994)).toBe('$9.99')
    expect(dollars(12.34)).toBe('$12.3')
    expect(dollars(123.4)).toBe('$123')
    expect(dollars(null)).toBe('—')
    const row = bandModel(input([run('a', [slot('01', { costUsd: 0.42 })])]))!.rows[0]!
    expect(row.cost).toBe('$0.42')
  })

  test('cost (R6.1): negative, non-finite or missing reads —; the provider drops a trailing (Native), any case', () => {
    expect(dollars(-0.5)).toBe('—')
    expect(dollars(Number.NaN)).toBe('—')
    expect(dollars(Number.POSITIVE_INFINITY)).toBe('—')
    expect(dollars(undefined)).toBe('—')
    expect(dollars(0.009)).toBe('<$0.01')
    expect(dollars(0.01)).toBe('$0.01')
    expect(dollars(99.4)).toBe('$99.4')
    expect(dollars(100)).toBe('$100')
    expect(providerName('Anthropic (Native)')).toBe('Anthropic')
    expect(providerName('Anthropic (native)')).toBe('Anthropic')
    expect(providerName('Anthropic (NATIVE)  ')).toBe('Anthropic')
    expect(providerName('OpenRouter')).toBe('OpenRouter')
    expect(providerName('Native Labs')).toBe('Native Labs') // only a trailing (Native) goes
  })

  test('tool calls and loops: the marks ƒ and ↻; the row carries the bare count, — when unknown (R6.2 draws ƒ8 / ↻1, the mark touching it)', () => {
    expect(TOOLS_MARK).toBe('ƒ')
    expect(LOOPS_MARK).toBe('↻')
    const m = bandModel(input([run('a', [slot('01', { toolCalls: 8, turnsCompleted: 1 })])]))!
    expect([m.rows[0]!.tools, m.rows[0]!.loops]).toEqual(['8', '1'])
    const unknown = bandModel(input([run('a', [slot('01', { toolCalls: null, turnsCompleted: null })])]))!.rows[0]!
    expect([unknown.tools, unknown.loops]).toEqual(['—', '—'])
  })

  test('nothing to draw: no run and nothing compacted → null; a run of a feed that never spoke is not drawn', () => {
    expect(bandModel(input([]))).toBeNull()
    expect(bandModel(input([run('a', [])], { feeds: {} }))).toBeNull()
    expect(bandModel(input([], { earlier: { runs: 3, done: 3, failed: 0, stopped: 0 } }))?.header.map(s => s.text).join('')).toBe('◆ claudish · 3 earlier runs')
  })

  test('ids: the slot for one run, label/slot for several, label·N for a repeated path, the label for a delegation', () => {
    expect(bandModel(input([run('a', four)]))!.rows.map(r => r.id)).toEqual(['01', '02', '03', '04'])
    const deleg = run('d', [slot('a1b2c3d4-0000')], { ref: { kind: 'delegation', server: 's', token: 'a1b2c3d4-0000', address: 'a1b2c3d4-0000' }, label: '#a1b2c3' })
    const ids = bandModel(input([run('a', [slot('01')]), run('b', [slot('01')], { generation: 2 }), deleg]))!.rows.map(r => r.id)
    expect(ids).toEqual(['plan-review/01', 'plan-review·2/01', '#a1b2c3'])
  })

  test('order: needs you, then live, then terminal rows of the most recent run first', () => {
    const waiting = slot('05', { state: 'AWAITING_INPUT' })
    const m = bandModel(input([run('a', [slot('01', { state: 'COMPLETED', idleSeconds: null }), slot('02')]), run('b', [slot('01', { state: 'FAILED', idleSeconds: null }), waiting])]))!
    expect(m.rows.map(r => r.key)).toEqual(['b/05', 'a/02', 'b/01', 'a/01'])
    expect(m.rows[0]!.attention).toBe(true)
    expect(m.header.map(s => s.text).join('')).toBe('◆ claudish · 1 needs you · 1 running · 1 done · 1 failed')
    expect(m.header.find(s => s.text.includes('needs you'))?.color).toBe('permission')
  })

  test('height: past maxRows terminal rows fold into one line; attention and live rows stay', () => {
    const many = [slot('01'), ...['02', '03', '04', '05'].map(n => slot(n, { state: 'COMPLETED', idleSeconds: null })), slot('06', { state: 'CANCELLED', reason: 'cancelled', idleSeconds: null })]
    const m = bandModel(input([run('a', many)], { maxRows: 4 }))!
    expect(m.rows.map(r => r.key)).toEqual(['a/01'])
    expect(m.more).toBe('+5 more: 4 done · 1 stopped')
  })

  test('unreachable: a live slot draws ? unknown with no stale activity; a terminal slot keeps its state', () => {
    const m = bandModel(input([run('a', four, { unreachableSince: 5 })]))!
    expect(m.rows.map(r => `${r.badge.code} ${r.word}`)).toEqual(['??? unknown', '??? unknown', 'END done', 'ERR failed'])
    expect(m.rows[0]!.activity).toBe('')
    expect(m.rows[3]!.activity).toBe('blocked')
  })

  test('Stop: drawn only for a live slot of a feed that can cancel; armed reads confirm, sent reads stopping', () => {
    const base = input([run('a', four)], { stops: { 'a/01': { kind: 'armed', until: 9 }, 'a/02': { kind: 'sent', at: 1 } } })
    expect(bandModel(base)!.rows.map(r => r.stop)).toEqual(['confirm', 'stopping', 'none', 'none'])
    const noCancel = { kind: 'speaks' as const, version: 1, can: { cancel: false, capture: true, spans: true, resize: true }, declined: 0 }
    expect(bandModel({ ...base, feeds: { 's#panel': noCancel } })!.rows.every(r => r.stop === 'none')).toBe(true)
  })

  test('the stale-meter (R6.7): a cell at each of 5, 30, 60, 90, 120 s; below 5 s streaming with no number; warning from three cells, error at five', () => {
    const at = (idleSeconds: number) => bandModel(input([run('a', [slot('01', { idleSeconds })])]))!.rows[0]!.meter
    expect(at(3)).toEqual({ filled: 0, number: '', color: 'success', flowing: true, idle: 3 })
    expect(at(4)).toEqual({ filled: 0, number: '', color: 'success', flowing: true, idle: 4 })
    expect(at(5)).toEqual({ filled: 1, number: '5s', color: 'success', flowing: false, idle: 5 })
    expect(at(12)).toEqual({ filled: 1, number: '12s', color: 'success', flowing: false, idle: 12 })
    expect(at(42)).toEqual({ filled: 2, number: '42s', color: 'success', flowing: false, idle: 42 })
    expect(at(65)).toEqual({ filled: 3, number: '1m', color: 'warning', flowing: false, idle: 65 })
    expect(at(95)).toEqual({ filled: 4, number: '1m', color: 'warning', flowing: false, idle: 95 })
    expect(at(130)).toEqual({ filled: 5, number: '2m', color: 'error', flowing: false, idle: 130 })
    const done = bandModel(input([run('a', [slot('01', { state: 'COMPLETED', idleSeconds: null })])]))!.rows[0]!
    expect(done.meter).toBeNull()
    const blind = bandModel(input([run('a', [slot('01', { idleSeconds: null })])]))!.rows[0]!
    expect(blind.meter).toBeNull() // RUNNING with an unknown idle time
  })
})
