// The band above the prompt and its two buttons, drawn through the plugin on both
// surfaces: header and rows, live values, colours, narrow widths, Stop (press twice
// within 4 s) and Show (one tab per slot).

import { expect, test } from 'claude-code/testing'
import type { ClaudishRuns, ClaudishStopRequest } from '../types'
import { SHOW_COLUMNS, STOP_CONFIRM_MS, STOP_SENT_TIMEOUT_MS, THEME_KEYS } from '../hooks/status/domain'
import { ENGINE_DRAWING, TEAM_TOOL, harness, start, type Harness } from './fake-claudish'
import { SURFACES, bandProps, mountBand, mountPane, texts, walk, type Mounted } from './ui'

const runs = (h: Harness) => (h.state.get('runs') ?? { epoch: 0, starts: {}, list: [] }) as ClaudishRuns
const stops = (h: Harness) => (h.state.get('stopRequests') ?? {}) as Record<string, ClaudishStopRequest>
const modRun = (h: Harness, i = 0) => runs(h).list[i]!

/** A team run of four slots, listed once. */
async function teamRun($: unknown, h: Harness, path = 'r1') {
  await ($ as { tool: { call: (e: unknown) => Promise<unknown> } }).tool.call({ tool: TEAM_TOOL, mode: 'run', path })
  await h.clock.advance(1000)
}

async function stateText(band: Mounted, rowKey: string): Promise<{ text: string; color: unknown } | undefined> {
  const row = await band.find({ key: `row:${rowKey}` })
  const cells = (row?.children ?? []) as { type?: string; props?: Record<string, unknown>; children?: unknown[] }[]
  const cell = cells.find(c => c.type === 'Text' && typeof c.props?.color === 'string' && /^[◌▶◇✓✕■?]/.test(String(c.children?.[0] ?? '')))
  return cell ? { text: String(cell.children?.[0] ?? '').trim(), color: cell.props?.color } : undefined
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
    expect(header?.text).toBe('◆ claudish · 2 running · 1 done · 1 failed')
    expect(await band.findAll({ type: 'Button', text: 'Show' })).toHaveLength(4)
    expect(await band.findAll({ type: 'Button', text: 'Stop' })).toHaveLength(2)
    // one row per slot, the live ones first
    const id = modRun(h).id
    const rows = (await band.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('row:')).map(b => b.key)
    expect(rows).toEqual([`row:${id}/01`, `row:${id}/02`, `row:${id}/03`, `row:${id}/04`])
    expect((await band.find({ type: 'Text', text: 'blocked' }))?.text).toBe('blocked')
  })

  test(`band: values change [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const band = await mountBand($, surface)
    const tokens = async () => (await texts(band)).find(t => /^\s*[\d.]+k\/\d/.test(t))
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
    const pane = await mountPane($, surface, h.opens[0]!.id)
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
            expect((THEME_KEYS as readonly unknown[]).includes(c)).toBe(true)
          }
        }
      }
    }
    expect(frameColours).toBeGreaterThan(0) // the tab is painted: the check covered a frame
    expect(await stateText(band, `${id}/01`)).toEqual({ text: '▶ running', color: 'warning' })
    expect(await stateText(band, `${id}/02`)).toEqual({ text: '✓ done', color: 'success' })
    expect(await stateText(band, `${id}/03`)).toEqual({ text: '✕ failed', color: 'error' })
    expect(await stateText(band, `${id}/04`)).toEqual({ text: '■ stopped', color: 'inactive' })
  })

  test(`band: narrow — one line per row, columns dropped by priority, header alone below the floor [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const activities = /^(Bash|Read|thinking|background|finishing)\s*$/
    for (const cols of [120, 59, 40, 29]) {
      const band = await mountBand($, surface, bandProps(cols))
      const rows = (await band.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('row:'))
      expect(rows).toHaveLength(4)
      for (const r of rows) expect(r.props.flexDirection).toBe('row')
      for (const t of await band.findAll({ type: 'Text' })) expect(t.props.wrap).toBe('truncate-end')
      if (cols <= 59) expect((await texts(band)).some(t => activities.test(t))).toBe(false)
      expect(await band.findAll({ type: 'Button', text: 'Show' })).toHaveLength(4)
      await band.unmount()
    }
    const narrow = await mountBand($, surface, bandProps(20))
    expect(await narrow.findAll({ type: 'Button' })).toHaveLength(0)
    expect((await narrow.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('row:'))).toHaveLength(0)
    expect((await narrow.find({ type: 'Text', text: /◆ claudish/ }))?.text).toBe('◆ claudish · 4 running')
  })

  test(`band: unreachable rows draw ? unknown, terminal rows keep their state [${surface}]`, async ($, on) => {
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
    expect((await stateText(band, `${id}/01`))?.text).toBe('? unknown')
    expect((await stateText(band, `${id}/04`))?.text).toBe('✓ done')
    refuse = false
    await h.clock.advance(31_000)
    expect((await stateText(band, `${id}/01`))?.text).toBe('▶ running')
  })

  test(`band: settled runs stay [${surface}]`, async ($, on) => {
    const h = harness(on, { models: ['m-a', 'm-b'] })
    await start($, surface)
    await teamRun($, h)
    const run = h.fake.runs[0]!
    h.fake.set(run.runId, '01', 'COMPLETED')
    h.fake.set(run.runId, '02', 'FAILED', 'api_error')
    await h.clock.advance(1000)
    await h.clock.advance(2 * 3600_000)
    const band = await mountBand($, surface)
    expect((await band.find({ type: 'Text', text: /◆ claudish/ }))?.text).toBe('◆ claudish · 1 done · 1 failed')
    expect(await band.findAll({ type: 'Button', text: 'Show' })).toHaveLength(2)
  })

  test(`band: Stop once, then expiry [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const key = `${modRun(h).id}/01`
    const band = await mountBand($, surface)
    await band.press({ key: `stop:${key}` })
    expect((await band.find({ key: `stop:${key}` }))?.props.label).toBe('confirm?')
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
    expect(await stateText(band, key)).toEqual({ text: '■ stopped', color: 'inactive' })
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
    expect(await band.drawn()).toEqual(ENGINE_DRAWING)
  })

  test(`band: no runs — nothing drawn, no claudish call [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    const band = await mountBand($, surface)
    await h.clock.advance(10_000)
    expect(await band.drawn()).toEqual(ENGINE_DRAWING)
    expect(h.fake.calls).toHaveLength(0)
  })

  test(`band: Show opens one tab per slot, titled by model [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const id = modRun(h).id
    const band = await mountBand($, surface)
    await band.press({ key: `show:${id}/02` })
    await band.press({ key: `show:${id}/03` })
    await band.press({ key: `show:${id}/02` })
    expect(h.opens.map(o => o.title)).toEqual(['kimi-k3', 'grok-4.6', 'kimi-k3'])
    expect(h.opens.every(o => /^cl_[0-9a-f]{8}$/.test(o.id) && o.columns === SHOW_COLUMNS)).toBe(true)
    expect(new Set(h.opens.map(o => o.id)).size).toBe(2)
    expect(h.opens[2]?.id).toBe(h.opens[0]?.id)
    expect(h.closes).toEqual([])
  })

  test(`band: Show focuses — a reopened tab that is not shown is closed and opened again [${surface}]`, async ($, on) => {
    const h = harness(on)
    await start($, surface)
    await teamRun($, h)
    const id = modRun(h).id
    const band = await mountBand($, surface)
    await band.press({ key: `show:${id}/02` })
    await band.press({ key: `show:${id}/03` })
    const tab02 = h.opens[0]!.id
    // The surface keeps 02 behind 03 even after it is opened again.
    h.panesAnswer = () => (h.opens.length >= 3 && h.closes.length === 0 ? h.panes.map(p => ({ ...p, isShown: p.id !== tab02 })) : h.panes)
    await band.press({ key: `show:${id}/02` })
    expect(h.closes).toEqual([tab02])
    expect(h.opens.map(o => o.id)).toEqual([tab02, h.opens[1]!.id, tab02, tab02])
    expect(h.state.get(`panes/${tab02}`)).toMatchObject({ status: 'waiting', slot: '02' })
  })
}
