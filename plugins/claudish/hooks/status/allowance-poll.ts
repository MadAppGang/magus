// The allowance report's own loop: probe, then every 60 s while claudish reports, and every 5 min
// while it has nothing to report or says it cannot. No answer is final: a claudish upgraded under
// the session is found by the next slow probe (or at once, by reprobe). Until claudish first answers
// from its contract, a probe that reached no claudish (its MCP server still connecting, or a server
// without the tool yet) is repeated every 5 s for the first minute, so the row appears seconds after
// claudish connects. Separate from poll.ts, whose 1–3 s run poll goes idle when no run is watched;
// the allowance row is ambient and wants neither.
// Takes a Host only. Names no claudish tool or field: host.source asks, nextAllowance decides.
//
// One chain at a time: `gen` numbers the one timer that may run a fetch, so a second start, a stop,
// or a refresh makes every older timer fire as a no-op, and an answer that lands after its chain
// was stopped or replaced is dropped.
//
// Each tick asks the band's slice of the report. What follows a partial `ok` band answer:
// - the forecast panel is drawn → the panel's slice (the forecast), every tick (60 s);
// - it is not → the forecast slice alone (accounts, combined, trajectory; the band draws its
//   takeover badges and ┈ switch window from it) when no forecast slice has been answered since the
//   loop started, or the last one is ALLOWANCE_SLOW_MS or older: so on the first `ok` band answer,
//   then every 5 min. A forecast slice that fails is asked again on the next tick.
// So a cold start with the panel closed asks band, forecast; then band every 60 s; then band,
// forecast at the first tick 5 min or more after the last forecast answer. A whole report (a
// claudish that ignores `sections`) carries every part, and no slice follows it.
// Every slice merges into one view: a part an answer does not carry keeps its last value, the
// header is the newest answer's, and `parts` records when each part arrived. Only the band's answer
// decides the allowance's kind and the cadence; a slice that fails leaves the view as it was.

import type { Timer } from 'claude-code'
import type { ClaudishAllowance, ClaudishAllowancePart, ClaudishAllowanceView } from '../../types'
import { SERVER_CANDIDATES } from './claudish-source'
import { FORECAST_PANE_ID } from './domain'
import type { Host } from './host'
import type { AllowanceAnswer, AllowanceAsk } from './run-source'

// ── cadence ───────────────────────────────────────────────────────────────────

/** While claudish reports: claudish caches its evaluation for 5 min, so a minute keeps the row current. */
export const ALLOWANCE_POLL_MS = 60_000
/** While there is nothing to report yet, claudish refused, or it stopped answering. */
export const ALLOWANCE_SLOW_MS = 300_000
/** An ask (or a whole server resolution) with no answer by then reads as unanswered. A cold
 *  claudish evaluation takes up to about 3.7 s. */
export const ALLOWANCE_TIMEOUT_MS = 10_000
/** A Show press asks again now when the report it would show is older than this. */
export const SHOW_REFRESH_MS = 15_000
/** Before claudish has answered from its contract: the probe interval while it may still be connecting. */
export const ALLOWANCE_PROBE_MS = 5_000
/** How long after the loop's first probe the quick probes go on: past Claude Code's 30 s MCP connect timeout. */
export const ALLOWANCE_CONNECT_MS = 60_000

/** The forecast panel's slices, asked in this order while it is drawn. */
export const PANEL_ASKS: readonly AllowanceAsk[] = ['forecast']
/** The band's own slow slice, asked while the panel is not drawn: the takeovers and refills it draws. */
export const BAND_TRAJECTORY_ASK: AllowanceAsk = 'forecast'

// ── the decision ──────────────────────────────────────────────────────────────

/** Every part of a view: what a whole report carries. */
export const ALLOWANCE_PARTS: readonly ClaudishAllowancePart[] = ['accounts', 'pool', 'rate', 'gaps', 'forecast']

/**
 * `next`'s header with `parts` taken from `next` and every other part kept from `prev`. Pure.
 * accounts · pool (remaining, capacity) · rate · gaps · forecast (refills, forecast, switches, slower,
 * history).
 */
export function mergeView(prev: ClaudishAllowanceView, next: ClaudishAllowanceView, parts: readonly ClaudishAllowancePart[]): ClaudishAllowanceView {
  const has = (p: ClaudishAllowancePart) => parts.includes(p)
  const from = (p: ClaudishAllowancePart) => (has(p) ? next : prev)
  const forecast = from('forecast')
  const view: ClaudishAllowanceView = {
    generatedAt: next.generatedAt,
    status: next.status,
    evidence: next.evidence,
    unit: next.unit,
    blockedNow: next.blockedNow,
    rate: from('rate').rate,
    accounts: from('accounts').accounts,
    pool: {
      remaining: from('pool').pool.remaining,
      capacity: from('pool').pool.capacity,
    },
    gaps: from('gaps').gaps,
    refills: forecast.refills,
    forecast: forecast.forecast,
    switches: forecast.switches,
  }
  if (forecast.history !== undefined) view.history = forecast.history
  if (forecast.slower !== undefined) view.slower = forecast.slower
  return view
}

/** When each part of a ready allowance arrived: its own record, or every part at `at` (a whole report). */
export function partTimes(a: Extract<ClaudishAllowance, { kind: 'ready' }>): Partial<Record<ClaudishAllowancePart, number>> {
  return a.parts ?? Object.fromEntries(ALLOWANCE_PARTS.map(p => [p, a.at]))
}

/**
 * A report merged into what is held: a whole one (no `parts`) replaces it; a partial one replaces
 * its parts of a ready view and stamps them `now`. Failures are the caller's.
 */
function merged(prev: ClaudishAllowance, answer: Extract<AllowanceAnswer, { kind: 'report' }>, now: number, failures: number): ClaudishAllowance {
  if (answer.parts === undefined) return { kind: 'ready', view: answer.view, at: now, failures }
  const stamped = Object.fromEntries(answer.parts.map(p => [p, now])) as Partial<Record<ClaudishAllowancePart, number>>
  if (prev.kind !== 'ready') return { kind: 'ready', view: answer.view, at: now, failures, parts: stamped }
  return { kind: 'ready', view: mergeView(prev.view, answer.view, answer.parts), at: now, failures, parts: { ...partTimes(prev), ...stamped } }
}

/**
 * What one band answer makes of the allowance, and when to ask next. Pure. Never stops: an
 * unsupported claudish is asked again every 5 min, which is what finds an upgrade under the session.
 *
 * - a report → ready (failures 0), merged into a ready view when partial: 60 s when `ok`, 5 min
 *   while `insufficient-evidence`
 * - none → none, 5 min · refused → refused, 5 min
 * - precontract | declines → unsupported, 5 min
 * - garbled | unanswered → a ready view is kept with one more failure, 60 s on the first and 5 min
 *   from the second; anything else is kept as it is, 5 min
 *
 * The delay is the steady cadence; probeDelay shortens it while claudish may still be connecting.
 */
export function nextAllowance(prev: ClaudishAllowance, answer: AllowanceAnswer, now: number): readonly [ClaudishAllowance, number] {
  switch (answer.kind) {
    case 'report': {
      const next = merged(prev, answer, now, 0)
      const status = next.kind === 'ready' ? next.view.status : answer.view.status
      return [next, status === 'ok' ? ALLOWANCE_POLL_MS : ALLOWANCE_SLOW_MS] as const
    }
    case 'none':
      return [{ kind: 'none', reason: answer.reason, at: now }, ALLOWANCE_SLOW_MS] as const
    case 'refused':
      return [{ kind: 'refused', code: answer.code, at: now }, ALLOWANCE_SLOW_MS] as const
    case 'precontract':
    case 'declines':
      return [{ kind: 'unsupported', reason: answer.reason, at: now }, ALLOWANCE_SLOW_MS] as const
    case 'garbled':
    case 'unanswered': {
      if (prev.kind !== 'ready') return [prev, ALLOWANCE_SLOW_MS] as const
      const failures = prev.failures + 1
      return [{ ...prev, failures }, failures >= 2 ? ALLOWANCE_SLOW_MS : ALLOWANCE_POLL_MS] as const
    }
  }
}

/** An answer only claudish's contract gives: the server asked is claudish, whatever it said. */
const fromContract = (answer: AllowanceAnswer): boolean =>
  answer.kind === 'report' || answer.kind === 'none' || answer.kind === 'refused' || answer.kind === 'declines'

/**
 * When to ask next, given nextAllowance's steady `delay`. Pure. Until claudish has answered from its
 * contract (`heard`), an answer that is not from it (no server by that name yet, no such tool yet,
 * a timeout, a body that is not claudish's) is asked again in ALLOWANCE_PROBE_MS while the loop is
 * younger than ALLOWANCE_CONNECT_MS (`elapsed` since its first probe): Claude Code connects a
 * plugin's MCP server after the hooks module starts, and the first probe can beat it. Every other
 * case keeps `delay`, so an old claudish costs at most one call per 5 min once the minute is over.
 */
export function probeDelay(answer: AllowanceAnswer, delay: number, heard: boolean, elapsed: number): number {
  if (heard || fromContract(answer) || elapsed >= ALLOWANCE_CONNECT_MS) return delay
  return Math.min(delay, ALLOWANCE_PROBE_MS)
}

/**
 * What one forecast-panel answer makes of the allowance. Pure. A report merges as the band's does,
 * keeping the band's failure count (a ready view) or starting at 0; any other answer changes
 * nothing: the band's ask alone decides support, refusal and cadence; the part kept stays as it was.
 */
export function withPanelAnswer(prev: ClaudishAllowance, answer: AllowanceAnswer, now: number): ClaudishAllowance {
  if (answer.kind !== 'report') return prev
  return merged(prev, answer, now, prev.kind === 'ready' ? prev.failures : 0)
}

// ── module state: dies with a hot reload, which session.start restarts ───────

type Phase = 'idle' | 'scheduled' | 'fetching'

const loop: {
  phase: Phase
  /** the chain that may run; an older timer or answer is a no-op */
  gen: number
  /** the claudish server name the report is asked of; null until one answers from the contract */
  server: string | null
  /** the pending timer, cancelled when the chain is replaced or stopped */
  timer: Timer | null
  /** when the last answer landed (the host's clock); null before the first */
  answeredAt: number | null
  /** when the forecast panel's slices were last asked and answered (the host's clock); null before the first */
  panelAt: number | null
  /** when a forecast slice (the band's or the panel's) or a whole report was last answered (the host's clock); null before the first */
  trajectoryAt: number | null
  /** the host the live chain runs on */
  host: Host | null
  /** when the loop's first probe landed (the host's clock); null before it: the quick-probe window's start */
  firstAt: number | null
  /** whether claudish has answered from its contract since the loop started: ends the quick probes */
  heard: boolean
} = { phase: 'idle', gen: 0, server: null, timer: null, answeredAt: null, panelAt: null, trajectoryAt: null, host: null, firstAt: null, heard: false }

/** The loop as it stands, for logs and tests. */
export function allowanceLoop(): Readonly<{ phase: Phase; gen: number; server: string | null; answeredAt: number | null; panelAt: number | null; trajectoryAt: number | null; heard: boolean }> {
  return { phase: loop.phase, gen: loop.gen, server: loop.server, answeredAt: loop.answeredAt, panelAt: loop.panelAt, trajectoryAt: loop.trajectoryAt, heard: loop.heard }
}

/**
 * Whether the band asks its forecast slice now, the panel not being drawn. Pure. Yes when none has
 * been answered (`at` null) or the last is ALLOWANCE_SLOW_MS or older.
 */
export function trajectoryDue(at: number | null, now: number): boolean {
  return at === null || now - at >= ALLOWANCE_SLOW_MS
}

function schedule(host: Host, ms: number): void {
  try {
    loop.timer?.cancel()
  } catch {
    // a timer of an interface already gone: its gen is stale either way
  }
  const gen = ++loop.gen
  loop.phase = 'scheduled'
  loop.host = host
  loop.timer = host.after(ms, () => {
    if (gen === loop.gen) void tick(host, gen)
  })
}

/**
 * Starts the chain; a no-op while one is scheduled or fetching on this host. A chain on another
 * host (an earlier session.start's closures, which a new start replaces) is replaced, not joined.
 */
export function start(host: Host): void {
  if (loop.phase !== 'idle' && loop.host === host) return
  schedule(host, 0)
}

/**
 * Ends the chain: a timer already set fires as a no-op, and an answer still out is dropped. The
 * resolved server is forgotten, so the next session start resolves it again, quick probes and all.
 * For a session end the process does not outlive (onSessionEnd decides).
 */
export function stop(): void {
  try {
    loop.timer?.cancel()
  } catch {
    // its gen is retired below, so it fires as a no-op anyway
  }
  loop.timer = null
  loop.gen += 1
  loop.phase = 'idle'
  loop.server = null
  loop.panelAt = null
  loop.trajectoryAt = null
  loop.host = null
  loop.firstAt = null
  loop.heard = false
}

/**
 * A session.end. A `/clear` or an in-process resume ends the conversation but not the process, and
 * Claude Code dispatches no session.start for the conversation that follows (2.1.312, and the
 * engine's SessionEndInput says so), so nothing would start a stopped chain again: the chain is kept
 * (the same claudish server, the same 60 s cadence), and only the panel's slices are forgotten, so the
 * next Show asks them afresh (the band's forecast slice keeps its 5 min cadence: the takeovers are
 * the pool's). The allowance is the account
 * pool's, not the conversation's: the band's report stays true across the clear, as the run poll
 * keeps watching across it too (poll.onSessionEnd resets only what belonged to the old conversation).
 * Every other reason ends the process: the chain stops.
 */
export function onSessionEnd(reason: string): void {
  if (reason === 'clear' || reason === 'resume') {
    loop.panelAt = null
    return
  }
  stop()
}

/**
 * Probes now when the report was found unsupported: a list answer just announced the report
 * (claudish was upgraded under this session). An unsupported chain waits its 5 min, so the wait is
 * cut short; a chain that is idle (its interface refused) is started. A fetch already out, a
 * supported report, or an unsupported answer younger than ALLOWANCE_PROBE_MS (list answers come
 * every 1–3 s) is left alone.
 */
export function reprobe(host: Host): void {
  if (loop.phase === 'fetching') return
  void Promise.all([host.store.allowance.read(), host.now()]).then(
    ([a, now]) => {
      if (a.kind !== 'unsupported' || now - a.at < ALLOWANCE_PROBE_MS) return
      if (loop.phase === 'idle') start(host) // start re-checks the phase: two reprobes make one chain
      else if (loop.phase === 'scheduled') schedule(host, 0)
    },
    (err: unknown) => host.debug(`claudish allowance re-probe failed: ${err instanceof Error ? err.message : String(err)}`),
  )
}

/** A claudish server name seen on the model's own call: adopted only while none is resolved. */
export function noteServer(server: string | null): void {
  if (server !== null && loop.server === null) loop.server = server
}

/**
 * A Show press: when the band's answer or the panel's slices are older than SHOW_REFRESH_MS (the
 * slices never asked yet count as older), the scheduled ask runs now instead, and asks the panel's
 * slices too since the panel is now drawn. A fetch already out, or a stopped loop, is left alone.
 */
export async function refreshIfOlder(host: Host, ms: number = SHOW_REFRESH_MS): Promise<void> {
  if (loop.phase !== 'scheduled') return
  const now = await host.now()
  if (loop.phase !== 'scheduled') return
  const fresh = (at: number | null) => at !== null && now - at < ms
  if (fresh(loop.answeredAt) && fresh(loop.panelAt)) return
  schedule(host, 0)
}

// ── one ask ───────────────────────────────────────────────────────────────────

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The report from the resolved server, or the first candidate answering from the contract. */
async function ask(host: Host, gen: number): Promise<AllowanceAnswer> {
  const known = loop.server
  if (known !== null) return host.source.allowance(known)
  const resolved = await host.source.resolveAllowance(SERVER_CANDIDATES)
  // A name noted from the model's own call while this resolution was out wins.
  if (gen === loop.gen && loop.server === null && resolved.server !== null) loop.server = resolved.server
  return resolved.answer
}

/** One ask, never rejecting and never longer than ALLOWANCE_TIMEOUT_MS: either reads as unanswered. */
function bounded(host: Host, asking: () => Promise<AllowanceAnswer>): Promise<AllowanceAnswer> {
  return new Promise(resolve => {
    const timer = host.after(ALLOWANCE_TIMEOUT_MS, () =>
      resolve({ kind: 'unanswered', reason: `no answer in ${ALLOWANCE_TIMEOUT_MS / 1000} s` }))
    asking().then(
      a => { timer.cancel(); resolve(a) },
      (err: unknown) => { timer.cancel(); resolve({ kind: 'unanswered', reason: message(err) }) },
    )
  })
}

/**
 * A debug line when something is wrong, once per change: claudish cannot report (unsupported),
 * refused, or a kept report's ask failed. A report, claudish's normal "no account pool" answer
 * (none: the commonest install, whose reason the panel shows), and the same state again write
 * none: the mod is silent while it works, as the run poll is.
 */
function changeLine(prev: ClaudishAllowance, written: ClaudishAllowance, answer: AllowanceAnswer): string | null {
  if (written.kind === 'ready') return written.failures === 1 ? `claudish allowance: report kept, its ask failed (${describe(answer)})` : null
  if (written.kind === 'none' || written.kind === 'probing') return null
  return prev.kind === written.kind ? null : `claudish allowance: ${written.kind} (${describe(answer)})`
}

/**
 * One fetch, then the next. Never rejects: its timer can fire after its session's interface is
 * gone (a closed test environment, a session ended mid-ask), where every host call may refuse.
 */
async function tick(host: Host, gen: number): Promise<void> {
  loop.phase = 'fetching'
  loop.timer = null
  try {
    const answer = await bounded(host, () => ask(host, gen))
    if (gen !== loop.gen) return // stopped, or replaced, while the ask was out
    const now = await host.now()
    let prev: ClaudishAllowance = { kind: 'probing' }
    const [written, delay] = await host.store.allowance.claim(p => {
      prev = p
      return nextAllowance(p, answer, now)
    })
    if (gen !== loop.gen) return
    loop.answeredAt = now
    loop.firstAt ??= now
    const wait = probeDelay(answer, delay, loop.heard, now - loop.firstAt)
    if (fromContract(answer)) loop.heard = true
    const line = changeLine(prev, written, answer)
    if (line !== null) host.debug(line)
    // A whole report (a claudish that ignores the slice it was asked) already carries every part;
    // a report that is not `ok` draws no forecast. Only a partial `ok` one asks more: the panel's
    // slices while it is drawn, else the band's forecast slice when it is due.
    if (answer.kind === 'report' && answer.parts === undefined) {
      loop.panelAt = now
      loop.trajectoryAt = now
    } else if (answer.kind === 'report' && written.kind === 'ready' && written.view.status === 'ok') {
      if (await panelDrawn(host)) await askPanel(host, gen)
      else if (trajectoryDue(loop.trajectoryAt, now)) await askTrajectory(host, gen)
    }
    if (gen !== loop.gen) return
    schedule(host, wait)
  } catch (err) {
    if (gen !== loop.gen) return
    try {
      host.debug(`claudish allowance tick failed: ${message(err)}`)
      schedule(host, ALLOWANCE_SLOW_MS)
    } catch {
      // the interface itself refuses: this chain is over; the next session.start (a fresh load of
      // the module) begins another, and a reprobe restarts an unsupported one
      if (gen === loop.gen) loop.phase = 'idle'
    }
  }
}

/** Claude Code lists the forecast panel as drawn; a refusal reads as not drawn. */
async function panelDrawn(host: Host): Promise<boolean> {
  try {
    return (await host.panes()).some(p => p.id === FORECAST_PANE_ID && p.isPlaced)
  } catch {
    return false
  }
}

/**
 * One slice of the server the band's answer came from, merged as it lands (withPanelAnswer).
 * A forecast slice that brings a report stamps trajectoryAt. A stale chain's answer is dropped.
 */
async function askSlice(host: Host, gen: number, server: string, slice: AllowanceAsk): Promise<void> {
  if (gen !== loop.gen) return
  const answer = await bounded(host, () => host.source.allowance(server, slice))
  if (gen !== loop.gen) return
  const now = await host.now()
  await host.store.allowance.update(p => withPanelAnswer(p, answer, now))
  if (gen === loop.gen && answer.kind === 'report' && slice === BAND_TRAJECTORY_ASK) loop.trajectoryAt = now
}

/**
 * While the forecast panel is drawn: its slices, one ask each, each merged as it lands. Writes no
 * debug line: a slice that fails leaves its part as it was.
 */
async function askPanel(host: Host, gen: number): Promise<void> {
  const server = loop.server
  if (server === null) return
  for (const slice of PANEL_ASKS) {
    await askSlice(host, gen, server, slice)
    if (gen !== loop.gen) return
  }
  loop.panelAt = await host.now()
}

/**
 * While the panel is not drawn: the band's forecast slice alone, merged as the panel's is. A failure
 * leaves trajectoryAt as it was, so the next tick asks again; it writes no debug line either.
 */
async function askTrajectory(host: Host, gen: number): Promise<void> {
  const server = loop.server
  if (server !== null) await askSlice(host, gen, server, BAND_TRAJECTORY_ASK)
}

function describe(answer: AllowanceAnswer): string {
  switch (answer.kind) {
    case 'report':
      return `report, ${answer.view.status}`
    case 'refused':
      return `refused: ${answer.code}`
    default:
      return `${answer.kind}: ${answer.reason}`
  }
}
