// Blind tests: completion wake-up (spec "Completion wake-up"; stop-wake contract §3.6;
// decisions-rev4 #1; decisions-monitor-dedupe). A wake is a prompt the engine ACCEPTED (`h.submits`).
//
// Monitor dedupe (FINAL): a delegation's needs-input entries and terminal states, and the last
// units of a team run that has SETTLED, are held for G = 10 s waiting for claudish's plugin
// monitor line. A matching line within the hold means no mod prompt; none means exactly one
// prompt after the hold. Per-slot team transitions before the run settles are not held.

import { expect, test } from 'claude-code/testing'
import { harness, start, TEAM_TOOL, CREATE_TOOL } from '../fake-claudish'
import { bandProps, mountBand, SURFACES } from '../ui'
import { monitorRecordOf } from '../scenario'
import { MONITOR_GRACE_MS, PAST_HOLD_MS, SLOW, foreignRun, isEngineDrawing, monitorLine, namedWith, startDelegation, startTeam } from './helpers'

const MODELS = ['gpt-6.1-sol', 'kimi-k3', 'grok-4.6', 'glm-5.3'] as const

test('wake: one accepted prompt per terminal transition, naming run, slot, model, state and a fetch hint', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const run = await startTeam($, h, 'review', MODELS)
  await h.clock.advance(3_000)
  expect(h.submits, 'nothing while all run').toHaveLength(0)

  h.fake.set(run.runId, '03', 'COMPLETED')
  await h.clock.advance(3_000)
  expect(h.submits).toHaveLength(1)
  const w = h.submits[0]!
  expect(w, 'names the run').toContain(run.runId)
  expect(w, 'names the slot').toContain('03')
  expect(namedWith(h.submits, 'grok-4.6', 'COMPLETED'), 'model and state on one line').toBe(1)
  expect(w, 'a fetch hint').toMatch(/status/)
  expect(w, 'never the provider (child-produced / display text)').not.toContain('OpenRouter')
  expect(w, 'never the activity').not.toMatch(/\b(Bash|thinking|background|finishing)\b/)
  expect(h.toasts.some(t => t.includes('grok-4.6')), 'a toast announces it').toBe(true)

  await h.clock.advance(60_000)
  expect(h.submits, 'exactly once').toHaveLength(1)

  h.fake.set(run.runId, '04', 'FAILED', 'blocked')
  await h.clock.advance(3_000)
  expect(h.submits).toHaveLength(2)
  expect(namedWith(h.submits.slice(1), 'glm-5.3', 'FAILED')).toBe(1)
  expect(h.submits[1]!, 'with its reason').toContain('blocked')
  expect(namedWith(h.submits, 'grok-4.6', 'COMPLETED'), 'the earlier one is not repeated').toBe(1)
  expect(h.toasts.some(t => t.includes('glm-5.3'))).toBe(true)

  await h.clock.advance(60_000)
  expect(h.submits).toHaveLength(2)
})

test('wake: transitions seen together share one prompt; each is named exactly once', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const run = await startTeam($, h, 'review', MODELS)
  await h.clock.advance(3_000)
  h.fake.set(run.runId, '01', 'COMPLETED')
  h.fake.set(run.runId, '02', 'EMPTY', 'empty_output')
  await h.clock.advance(3_000)
  expect(h.submits).toHaveLength(1)
  expect(namedWith(h.submits, 'gpt-6.1-sol', 'COMPLETED')).toBe(1)
  expect(namedWith(h.submits, 'kimi-k3', 'EMPTY')).toBe(1)
  h.fake.set(run.runId, '03', 'COMPLETED')
  h.fake.set(run.runId, '04', 'COMPLETED')
  await h.clock.advance(60_000)
  for (const [model, state] of [['gpt-6.1-sol', 'COMPLETED'], ['kimi-k3', 'EMPTY'], ['grok-4.6', 'COMPLETED'], ['glm-5.3', 'COMPLETED']] as const) {
    expect(namedWith(h.submits, model, state), `${model} named once`).toBe(1)
  }
})

test('wake: a cancel the model asked for still wakes, once', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const run = await startTeam($, h, 'review', ['gpt-6.1-sol', 'kimi-k3'])
  await h.clock.advance(3_000)
  await $.tool.call({ tool: TEAM_TOOL, mode: 'cancel', path: run.path, slot: '02', run_id: run.runId } as never)
  await h.clock.advance(5_000)
  expect(namedWith(h.submits, 'kimi-k3', 'CANCELLED')).toBe(1)
  await h.clock.advance(30_000)
  expect(namedWith(h.submits, 'kimi-k3', 'CANCELLED')).toBe(1)
})

test('wake: held while the main turn runs, delivered at its end; a subagent turn end does not release it', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  await $.turn.start({ text: 'review the plan', turnId: 't1' })
  const run = await startTeam($, h, 'review', ['gpt-6.1-sol', 'kimi-k3'])
  await h.clock.advance(3_000)
  h.fake.set(run.runId, '01', 'COMPLETED')
  await h.clock.advance(10_000)
  expect(h.attempts, 'no prompt while the turn runs').toHaveLength(0)
  expect(h.toasts.some(t => t.includes('gpt-6.1-sol')), 'the toast is not held').toBe(true)

  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 'sub-1', agentId: 'agent-1', reason: 'answer' } as never)
  await h.clock.advance(2_000)
  expect(h.attempts, "a subagent's turn end is not the main turn's").toHaveLength(0)

  await $.turn.complete({ answer: 'started', durationMs: 13_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await h.clock.advance(1_000)
  expect(h.submits).toHaveLength(1)
  expect(namedWith(h.submits, 'gpt-6.1-sol', 'COMPLETED')).toBe(1)
  await h.clock.advance(60_000)
  expect(h.submits).toHaveLength(1)
})

test('wake: a delegation wakes once per entry into waiting, and again when it ends', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const s = await startDelegation($, h, 'haiku-4.5', 'do the task')
  await h.clock.advance(3_000)
  expect(h.submits).toHaveLength(0)

  h.fake.set(s.id, s.id, 'AWAITING_INPUT', null, { activity: null, turnsCompleted: 1 })
  await h.clock.advance(PAST_HOLD_MS)
  expect(h.submits, 'first entry wakes (no monitor line, after the hold)').toHaveLength(1)
  expect(h.submits[0]!).toContain(s.id)
  expect(h.submits[0]!).toMatch(/waiting for input/)
  expect(h.submits[0]!, 'how to fetch / answer it').toMatch(/get_output|send_input/)
  await h.clock.advance(30_000)
  expect(h.submits, 'staying in the state is not a new entry').toHaveLength(1)

  await $.tool.call({ tool: 'mcp__plugin_claudish_claudish__send_input', session_id: s.id, input: 'go on' } as never)
  await h.clock.advance(3_000)
  expect(h.submits).toHaveLength(1)
  h.fake.set(s.id, s.id, 'AWAITING_INPUT', null, { activity: null, turnsCompleted: 2 })
  await h.clock.advance(PAST_HOLD_MS)
  expect(h.submits, 're-entry wakes again').toHaveLength(2)

  await $.tool.call({ tool: 'mcp__plugin_claudish_claudish__send_input', session_id: s.id, input: 'and more' } as never)
  await h.clock.advance(3_000)
  h.fake.set(s.id, s.id, 'AWAITING_PERMISSION', null, { activity: 'Bash' })
  await h.clock.advance(PAST_HOLD_MS)
  expect(h.submits, 'a permission wait wakes too').toHaveLength(3)
  expect(h.submits[2]!).toMatch(/permission/)

  h.fake.set(s.id, s.id, 'COMPLETED')
  await h.clock.advance(PAST_HOLD_MS)
  expect(h.submits).toHaveLength(4)
  expect(namedWith(h.submits.slice(3), 'haiku-4.5', 'COMPLETED')).toBe(1)
  await h.clock.advance(60_000)
  expect(h.submits, 'exactly once per entry and end').toHaveLength(4)
})

test('wake: a delegation started waiting (no prompt) wakes once for that entry', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const s = await startDelegation($, h, 'haiku-4.5', null)
  await h.clock.advance(5_000 + PAST_HOLD_MS)
  expect(h.submits).toHaveLength(1)
  expect(h.submits[0]!).toContain(s.id)
  await h.clock.advance(60_000)
  expect(h.submits).toHaveLength(1)
})

test('wake: nothing for runs or sessions this session did not start', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const run = foreignRun(h, '/elsewhere/review', ['other-model', 'other-model-2'])
  await h.clock.advance(3_000)
  h.fake.set(run.runId, '01', 'COMPLETED')
  h.fake.set(run.runId, '02', 'FAILED', 'api_error')
  await h.clock.advance(30_000)
  expect(h.attempts).toHaveLength(0)
  expect(h.toasts.filter(t => t.includes('other-model'))).toHaveLength(0)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, bandProps(200, 40))
    expect(isEngineDrawing(await ui.drawn()), surface).toBe(true)
    await ui.unmount()
  }
})

test('wake: a dropped prompt is retried until accepted, then never again', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  let drops = 1
  h.submitAnswer = text => (drops-- > 0 ? { drop: 'busy' } : { text })
  const run = await startTeam($, h, 'review', ['gpt-6.1-sol'])
  await h.clock.advance(3_000)
  // One slot: its COMPLETED settles the run, so the unit is held for the monitor first.
  h.fake.set(run.runId, '01', 'COMPLETED')
  await h.clock.advance(PAST_HOLD_MS)
  expect(h.attempts.length, 'attempted once the hold ran out').toBeGreaterThanOrEqual(1)
  expect(h.submits, 'the first attempt was dropped').toHaveLength(0)
  await h.clock.advance(45_000)
  expect(h.submits, 'retried and accepted').toHaveLength(1)
  expect(namedWith(h.submits, 'gpt-6.1-sol', 'COMPLETED')).toBe(1)
  const attempts = h.attempts.length
  await h.clock.advance(15 * 60_000)
  expect(h.submits).toHaveLength(1)
  expect(h.attempts.length, 'no further attempt once delivered').toBe(attempts)
})

test('wake: the model starting a delegation is observed through its own tool call', SLOW, async ($, on) => {
  // create_session's answer is the only start signal; the mod must not need a channel frame.
  const h = harness(on)
  await start($)
  await $.tool.call({ tool: CREATE_TOOL, model: 'haiku-4.5', prompt: 'x' } as never)
  const s = h.fake.sessions[0]!
  await h.clock.advance(3_000)
  h.fake.set(s.id, s.id, 'FAILED', 'child_exited')
  await h.clock.advance(PAST_HOLD_MS)
  expect(namedWith(h.submits, 'haiku-4.5', 'FAILED')).toBe(1)
  expect(h.submits[0]!).toContain('child_exited')
  await h.clock.advance(60_000)
  expect(h.submits, 'exactly once').toHaveLength(1)
})

// ── monitor dedupe (decisions-monitor-dedupe #2, #6) ──────────────────────────

test('wake: a monitor needs-input line within the hold replaces the mod prompt for that entry', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const s = await startDelegation($, h, 'haiku-4.5', 'do the task')
  await h.clock.advance(3_000)

  h.fake.set(s.id, s.id, 'AWAITING_INPUT', null, { activity: null, turnsCompleted: 1 })
  await h.clock.advance(3_000)
  expect(h.attempts, 'held for the monitor: nothing yet').toHaveLength(0)
  const row = await monitorLine($, `claudish-monitor: session ${s.id} needs-input model=haiku-4.5 next: send_input ${s.id}`)
  expect(h.appended.at(-1), 'the row passes beneath the plugin unchanged').toEqual(row)
  await h.clock.advance(PAST_HOLD_MS + 60_000)
  expect(h.attempts, 'the monitor line woke the model; the mod sends nothing').toHaveLength(0)

  // Control in the same world: the end, with no monitor line, still wakes exactly once.
  await $.tool.call({ tool: 'mcp__plugin_claudish_claudish__send_input', session_id: s.id, input: 'go on' } as never)
  await h.clock.advance(3_000)
  h.fake.set(s.id, s.id, 'COMPLETED')
  await h.clock.advance(PAST_HOLD_MS)
  expect(h.submits).toHaveLength(1)
  expect(namedWith(h.submits, 'haiku-4.5', 'COMPLETED')).toBe(1)
  expect(h.submits[0]!, 'the delivered wait is not repeated').not.toMatch(/waiting for input/)
  await h.clock.advance(60_000)
  expect(h.submits).toHaveLength(1)
})

test('wake: a monitor end line within the hold replaces the mod prompt for a delegation', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const s = await startDelegation($, h, 'haiku-4.5', 'do the task')
  await h.clock.advance(3_000)
  h.fake.set(s.id, s.id, 'COMPLETED')
  await h.clock.advance(3_000)
  expect(h.attempts, 'held for the monitor').toHaveLength(0)
  await monitorLine($, `claudish-monitor: session ${s.id} completed model=haiku-4.5 next: get_output ${s.id}`)
  await h.clock.advance(PAST_HOLD_MS + 60_000)
  expect(h.attempts, 'no mod prompt').toHaveLength(0)
})

test('wake: a settled team run whose monitor line arrives within the hold sends no prompt for its last slot', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  // A space in a parent directory: the monitor's path is percent-encoded; the run id stays one token.
  const run = await startTeam($, h, 'plan panel/review', ['gpt-6.1-sol', 'kimi-k3'])
  await h.clock.advance(3_000)

  // Not a settle (02 still runs): not held, wakes at once.
  h.fake.set(run.runId, '01', 'COMPLETED')
  await h.clock.advance(3_000)
  expect(h.submits, 'a per-slot change before the settle is not held').toHaveLength(1)
  expect(namedWith(h.submits, 'gpt-6.1-sol', 'COMPLETED')).toBe(1)

  // The settle: held; claudish's monitor reports the run (path percent-encoded, project-relative).
  h.fake.set(run.runId, '02', 'COMPLETED')
  await h.clock.advance(3_000)
  expect(h.submits).toHaveLength(1)
  await monitorLine($, `claudish-monitor: team ${monitorRecordOf(run.runId)} completed slots=2 path=plan%20panel/review next: team-status`)
  await h.clock.advance(PAST_HOLD_MS + 60_000)
  expect(h.attempts, 'the monitor line covered the settle').toHaveLength(1)
  expect(namedWith(h.attempts, 'kimi-k3', 'COMPLETED'), 'the last slot is not prompted').toBe(0)
  expect(h.toasts.some(t => t.includes('kimi-k3')), 'toasts are unchanged by the dedupe').toBe(true)
})

test('wake: a monitor line for another session or another run at the same path does not stand in; exactly one prompt after the hold', SLOW, async ($, on) => {
  const h = harness(on)
  await start($)
  const s = await startDelegation($, h, 'haiku-4.5', 'do the task')
  const run = await startTeam($, h, 'review', ['gpt-6.1-sol'])
  await h.clock.advance(3_000)
  h.fake.set(s.id, s.id, 'COMPLETED')
  h.fake.set(run.runId, '01', 'COMPLETED')
  await h.clock.advance(3_000)
  const other = 'ffffffff-0000-4000-8000-000000000099'
  await monitorLine($, `claudish-monitor: session ${other} completed model=haiku-4.5 next: get_output ${other}`)
  await monitorLine($, `claudish-monitor: team team-ffffff completed slots=1 path=review next: team-status`) // another run, same path
  await h.clock.advance(MONITOR_GRACE_MS - 8_000)
  expect(h.attempts, 'still inside the hold').toHaveLength(0)
  await h.clock.advance(PAST_HOLD_MS)
  expect(namedWith(h.submits, 'haiku-4.5', 'COMPLETED'), 'the delegation wakes once').toBe(1)
  expect(namedWith(h.submits, 'gpt-6.1-sol', 'COMPLETED'), 'the run wakes once').toBe(1)
  await h.clock.advance(60_000)
  expect(namedWith(h.submits, 'haiku-4.5', 'COMPLETED')).toBe(1)
  expect(namedWith(h.submits, 'gpt-6.1-sol', 'COMPLETED')).toBe(1)
})
