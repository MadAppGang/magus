// Blind tests: the status band above the prompt (spec "Status rows", "Colours", "Layout";
// UI contract §4.1–4.3). Every body loops over both surfaces.

import { expect, test } from 'claude-code/testing'
import { harness, start } from '../fake-claudish'
import { bandProps, mountBand, walk, SURFACES } from '../ui'
import {
  ALLOWED_COLOURS,
  SLOW,
  STATE_LOOK,
  buttonsIn,
  colorsOf,
  fillsOf,
  foreignRun,
  isEngineDrawing,
  labelOf,
  outerTexts,
  rowFor,
  rowsOf,
  showButton,
  startDelegation,
  startTeam,
  stopButton,
  textOf,
} from './helpers'

const MODELS = ['gpt-6.1-sol', 'kimi-k3', 'grok-4.6', 'glm-5.3'] as const

test('band: nothing drawn when this session has started no claudish run', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  await h.clock.advance(5_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    expect(isEngineDrawing(await ui.drawn()), `${surface}: band must pass to the engine`).toBe(true)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  }
})

test('band: a run claudish lists but this session did not start draws nothing', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  foreignRun(h, '/elsewhere/review', ['other-model'])
  await h.clock.advance(5_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface)
    const tree = await ui.drawn()
    expect(isEngineDrawing(tree), `${surface}`).toBe(true)
    expect(textOf(tree)).not.toContain('other-model')
    await ui.unmount()
  }
})

test('band: one header and one row per slot, each row with Stop and Show', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  await startTeam($, h, 'review', MODELS)
  await h.clock.advance(5_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const tree = await ui.drawn()
    expect(textOf(tree)).toContain('◆ claudish')
    const rows = rowsOf(tree)
    expect(rows, `${surface}: one row per slot`).toHaveLength(MODELS.length)
    for (const model of MODELS) {
      const row = rowFor(tree, model)
      expect(row, `${surface}: row for ${model}`).toBeDefined()
      expect(stopButton(row) && labelOf(stopButton(row)!)).toBe('Stop')
      expect(showButton(row)).toBeDefined()
    }
    expect(buttonsIn(tree).filter(b => labelOf(b) === 'Show')).toHaveLength(MODELS.length)
    expect(buttonsIn(tree).filter(b => labelOf(b) === 'Stop')).toHaveLength(MODELS.length)
    await ui.unmount()
  }
})

test('band: a row shows its fields in order (badge, model/provider, tokens, tools, loops, cost, stale-meter/activity, buttons)', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const run = await startTeam($, h, 'review', MODELS)
  h.fake.set(run.runId, '01', 'RUNNING', null, { activity: 'Bash' })
  await h.clock.advance(10_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const row = rowFor(await ui.drawn(), 'gpt-6.1-sol')
    expect(row, surface).toBeDefined()
    const t = textOf(row)
    const at = (re: RegExp) => {
      const m = re.exec(t)
      expect(m, `${surface}: ${re} in "${t}"`).not.toBeNull()
      return m!.index
    }
    const state = at(/ RUN \s+\d+s\b/) // the badge: code, then the runtime
    const model = at(/gpt-6\.1-sol/)
    const provider = at(/OpenRouter/)
    // UI contract §4.3: both halves compact with one decimal (`48.1k/2.3k`, `12.0k/0.4k`).
    // spec 2.4.0 §8: in then out, each value in its own unit; tools and loops a symbol and a number
    const tokens = at(/↑\d+\.\dk\s+↓\d+(\.\dk)?/) // §9: one split badge, each half padded
    const tools = at(/ƒ \d+/)
    const loops = at(/↻ \d+/)
    const cost = at(/ — /) // §9: the fake reports no cost_usd, so —
    const idle = at(/[▰▱]{5}/) // the stale-meter, where idle was
    const activity = at(/\bBash\b/)
    const stop = at(/\[ Stop \]/)
    const show = at(/\[ Show \]/)
    // UI contract §4.2/§4.3 order (orchestrator ruling over requirements' "provider / model"):
    // the model, then the provider in its own column after it.
    expect(state).toBeLessThan(model)
    expect(model, `${surface}: model before provider`).toBeLessThan(provider)
    expect(provider).toBeLessThan(tokens)
    expect(tokens).toBeLessThan(tools)
    expect(tools).toBeLessThan(loops)
    expect(loops).toBeLessThan(cost)
    expect(cost).toBeLessThan(idle)
    expect(idle).toBeLessThan(activity)
    expect(activity).toBeLessThan(stop)
    expect(stop).toBeLessThan(show)
    await ui.unmount()
  }
})

test('band: rows update in real time from the ~1 s poll', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  await startTeam($, h, 'review', ['gpt-6.1-sol'])
  await h.clock.advance(4_000)
  const lists1 = h.fake.listCalls('runs').length
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const before = textOf(rowFor(await ui.drawn(), 'gpt-6.1-sol'))
    await h.clock.advance(12_000)
    const after = textOf(rowFor(await ui.drawn(), 'gpt-6.1-sol'))
    expect(after, `${surface}: tokens/tools move between polls`).not.toBe(before)
    await ui.unmount()
  }
  // ~1 s cadence while active: well over one list call per 3 s of active time.
  expect(h.fake.listCalls('runs').length - lists1).toBeGreaterThanOrEqual(8)
})

test('band: header summarises the set (· N running · N done · N failed)', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const run = await startTeam($, h, 'review', MODELS)
  await h.clock.advance(3_000)
  h.fake.set(run.runId, '03', 'COMPLETED')
  h.fake.set(run.runId, '04', 'FAILED', 'blocked')
  await h.clock.advance(3_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const tree = await ui.drawn()
    expect(textOf(tree)).toMatch(/◆ claudish\s+review\s*·\s*2 running\s*·\s*1 done\s*·\s*1 failed/)
    expect(colorsOf(tree, /◆/)).toContain('claude')
    await ui.unmount()
  }
})

test('band: every state draws its badge code in its tone\'s ink and fill', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const team = ['m-start', 'm-run', 'm-done', 'm-fail', 'm-timeout', 'm-empty', 'm-stop', 'm-format']
  const run = await startTeam($, h, 'states', team)
  const waitIn = await startDelegation($, h, 'd-input', 'first task')
  const waitPerm = await startDelegation($, h, 'd-permit', 'second task')
  await h.clock.advance(3_000)
  h.fake.set(run.runId, '01', 'STARTING')
  h.fake.set(run.runId, '03', 'COMPLETED')
  h.fake.set(run.runId, '04', 'FAILED', 'api_error')
  h.fake.set(run.runId, '05', 'TIMEOUT', 'timeout')
  h.fake.set(run.runId, '06', 'EMPTY', 'empty_output')
  h.fake.set(run.runId, '07', 'CANCELLED', 'cancelled')
  h.fake.set(run.runId, '08', 'EMPTY', 'shape_mismatch')
  h.fake.set(waitIn.id, waitIn.id, 'AWAITING_INPUT', null, { activity: null })
  h.fake.set(waitPerm.id, waitPerm.id, 'AWAITING_PERMISSION', null, { activity: 'Bash' })
  await h.clock.advance(3_000)
  const expected: [string, keyof typeof STATE_LOOK][] = [
    ['m-start', 'STARTING'], ['m-run', 'RUNNING'], ['m-done', 'COMPLETED'], ['m-fail', 'FAILED'],
    ['m-timeout', 'TIMEOUT'], ['m-empty', 'EMPTY'], ['m-stop', 'CANCELLED'], ['m-format', 'WRONG_FORMAT'],
    ['d-input', 'AWAITING_INPUT'], ['d-permit', 'AWAITING_PERMISSION'],
  ]
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(220, 40))
    const tree = await ui.drawn()
    for (const [model, state] of expected) {
      const look = STATE_LOOK[state]
      const row = rowFor(tree, model)
      expect(row, `${surface}: row ${model}`).toBeDefined()
      const code = new RegExp(`^ ${look.code} $`)
      expect(textOf(row), `${surface}: ${model} ${state}`).toContain(` ${look.code} `)
      const colours = colorsOf(row, code)
      expect(colours.length, `${surface}: ${model} code drawn`).toBeGreaterThan(0)
      expect(colours[0], `${surface}: ${model} ${state} ink`).toBe(look.fg)
      expect(fillsOf(row, code)[0], `${surface}: ${model} ${state} fill`).toBe(look.bg)
      // §9: the runtime that follows is plain text in the same hue, no fill
      expect(colorsOf(row, /^\s+\d+s $/)[0], `${surface}: ${model} runtime hue`).toBe(look.bg)
      expect(fillsOf(row, /^\s+\d+s $/)[0], `${surface}: ${model} runtime fill`).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('band: Stop is not offered on terminal states; Show stays', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const run = await startTeam($, h, 'review', MODELS)
  await h.clock.advance(3_000)
  h.fake.set(run.runId, '01', 'COMPLETED')
  h.fake.set(run.runId, '02', 'FAILED', 'child_exited')
  h.fake.set(run.runId, '03', 'CANCELLED', 'cancelled')
  await h.clock.advance(3_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const tree = await ui.drawn()
    for (const model of ['gpt-6.1-sol', 'kimi-k3', 'grok-4.6']) {
      const row = rowFor(tree, model)
      expect(stopButton(row), `${surface}: no Stop on terminal ${model}`).toBeUndefined()
      expect(showButton(row), `${surface}: Show on ${model}`).toBeDefined()
    }
    expect(stopButton(rowFor(tree, 'glm-5.3')), `${surface}: Stop on the live slot`).toBeDefined()
    await ui.unmount()
  }
})

test('band: Stop is not offered when the feed does not advertise cancel', SLOW, async ($, on) => {
  const h = harness(on, { noCancel: true })
  await start($)
  await startTeam($, h, 'review', MODELS)
  await h.clock.advance(5_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const tree = await ui.drawn()
    expect(rowsOf(tree), surface).toHaveLength(MODELS.length)
    expect(buttonsIn(tree).filter(b => labelOf(b) === 'Stop' || labelOf(b) === 'Stop?')).toHaveLength(0)
    await ui.unmount()
  }
})

test('band: colours are theme keys, or the §9 palette for the badges, never any other raw colour', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const run = await startTeam($, h, 'review', MODELS)
  const d = await startDelegation($, h, 'haiku-4.5', null)
  await h.clock.advance(3_000)
  h.fake.set(run.runId, '02', 'COMPLETED')
  h.fake.set(run.runId, '03', 'FAILED', 'blocked')
  h.fake.set(run.runId, '04', 'CANCELLED', 'cancelled')
  void d
  await h.clock.advance(3_000)
  for (const surface of SURFACES) {
    for (const width of [200, 80]) {
      const ui = await mountBand($, surface, bandProps(width, 40))
      for (const { node } of walk(await ui.drawn())) {
        for (const prop of ['color', 'backgroundColor']) {
          const v = node.props?.[prop]
          if (v === undefined) continue
          expect(ALLOWED_COLOURS as readonly unknown[], `${surface}@${width}: ${node.type}.${prop}=${String(v)}`).toContain(v)
        }
      }
      await ui.unmount()
    }
  }
})

test('band: the stale-meter fills on a RUNNING slot silent past the threshold', SLOW, async ($, on) => {
  const h = harness(on, {
    rowPatch: row => (row.slot === '01' && row.state === 'RUNNING' ? { ...row, idle_seconds: 240, activity: 'Bash' } : row),
  })
  await start($)
  await startTeam($, h, 'review', ['gpt-6.1-sol', 'kimi-k3'])
  await h.clock.advance(5_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const tree = await ui.drawn()
    const quiet = rowFor(tree, 'gpt-6.1-sol')
    expect(textOf(quiet), surface).toMatch(/▰▰▰▰▰ 4m/)
    expect(colorsOf(quiet, /▰/)[0], `${surface}: a full meter is drawn in error`).toBe('error')
    const lively = textOf(rowFor(tree, 'kimi-k3'))
    expect(lively, `${surface}: a lively row's meter is empty`).toMatch(/▱▱▱▱▱/)
    expect(lively, `${surface}: a lively row has no filled cell`).not.toContain('▰')
    await ui.unmount()
  }
})

test('band: an unknown number draws — rather than a guess', SLOW, async ($, on) => {
  const h = harness(on, {
    rowPatch: row => (row.slot === '02' ? { ...row, tokens_in: null, tokens_out: null } : row),
  })
  await start($)
  await startTeam($, h, 'review', ['gpt-6.1-sol', 'kimi-k3'])
  await h.clock.advance(5_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const t = textOf(rowFor(await ui.drawn(), 'kimi-k3'))
    expect(t, surface).toContain('—')
    expect(t).not.toMatch(/\bnull\b|NaN|undefined/)
    await ui.unmount()
  }
})

test('band: narrowing drops activity, then provider, loops, tools, tokens; the model is never dropped; rows fit and never wrap', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const run = await startTeam($, h, 'review', ['gpt-6.1-sol', 'kimi-k3'])
  h.fake.set(run.runId, '01', 'RUNNING', null, { activity: 'Bash' })
  h.fake.set(run.runId, '02', 'RUNNING', null, { activity: 'Bash' })
  await h.clock.advance(10_000)
  const widths = [200, 160, 140, 120, 110, 100, 90, 80, 70, 59, 50, 41]
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    let sawDrop = false
    for (const width of widths) {
      await ui.redraw(bandProps(width, 40) as never)
      const tree = await ui.drawn()
      const rows = rowsOf(tree)
      expect(rows.length, `${surface}@${width}: rows still drawn`).toBe(2)
      for (const row of rows) {
        const t = textOf(row)
        expect(t.includes('\n'), `${surface}@${width}: a row is one line`).toBe(false)
        expect(t.length, `${surface}@${width}: "${t}" fits`).toBeLessThanOrEqual(width)
        const activity = /\bBash\b/.test(t)
        const provider = /OpenRouter/.test(t)
        const loops = /↻ \d+/.test(t)
        const tools = /ƒ \d+/.test(t)
        const tokens = /↑\S+\s+↓\S+/.test(t)
        if (width === 200) expect(activity && provider && loops && tools && tokens, `${surface}@200: all columns`).toBe(true)
        // §9 drop priority: activity goes first, then provider, loops, tools, tokens.
        if (activity) expect(provider, `${surface}@${width}: provider dropped before activity`).toBe(true)
        if (provider) expect(loops, `${surface}@${width}: loops dropped before provider`).toBe(true)
        if (loops) expect(tools, `${surface}@${width}: tools dropped before loops`).toBe(true)
        if (tools) expect(tokens, `${surface}@${width}: tokens dropped before tools`).toBe(true)
        // §9: the model shrinks (to 8 at the floor, gpt-6.1-sol cut with …) but is never dropped
        expect(t, `${surface}@${width}: the model stays`).toMatch(/gpt-6\.1|kimi-k3/)
        if (!activity) sawDrop = true
      }
      for (const text of outerTexts(tree)) {
        expect(text.props?.wrap, `${surface}@${width}: Text "${textOf(text)}" must truncate, never wrap`).toBe('truncate-end')
      }
    }
    expect(sawDrop, `${surface}: activity dropped somewhere between 200 and 41`).toBe(true)
    await ui.unmount()
  }
})

test('band: below the row floor only the header is drawn, no Button is cut', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  await startTeam($, h, 'review', ['gpt-6.1-sol', 'kimi-k3'])
  await h.clock.advance(5_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(20, 40))
    const tree = await ui.drawn()
    expect(textOf(tree), surface).toContain('◆ claudish')
    expect(buttonsIn(tree), `${surface}: header only`).toHaveLength(0)
    await ui.unmount()
  }
})

test('band: yields to a survey', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  await startTeam($, h, 'review', MODELS)
  await h.clock.advance(5_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40, true))
    expect(isEngineDrawing(await ui.drawn()), `${surface}: survey wins`).toBe(true)
    await ui.redraw(bandProps(200, 40, false) as never)
    expect(textOf(await ui.drawn()), `${surface}: band back once the survey is gone`).toContain('◆ claudish')
    await ui.unmount()
  }
})

test('band: panel slots and delegations share the row format and buttons', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  await startTeam($, h, 'review', ['gpt-6.1-sol'])
  await startDelegation($, h, 'haiku-4.5', 'do the task')
  await h.clock.advance(5_000)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    const tree = await ui.drawn()
    for (const model of ['gpt-6.1-sol', 'haiku-4.5']) {
      const row = rowFor(tree, model)
      expect(row, `${surface}: ${model}`).toBeDefined()
      expect(textOf(row)).toContain(' RUN ')
      expect(textOf(row)).toMatch(/ƒ \d+/)
      expect(stopButton(row)).toBeDefined()
      expect(showButton(row)).toBeDefined()
    }
    await ui.unmount()
  }
})
