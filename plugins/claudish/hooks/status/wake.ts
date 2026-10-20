// The completion wake-up: every terminal transition of a drawn run this conversation
// started, and every entry of one of its delegations into a waiting state, is named in
// exactly one prompt the engine accepted. The ledger (one atom, through host.store) holds
// delivery: pending → inflight → delivered, or back to pending / parked on a refusal. A change
// is due as soon as the mod notices it; only the main loop's running turn defers it.
//
// Takes a Host only. Names no claudish tool or field: the run line and the fetch line of
// the text come from the port's runLine and fetchHint.

import type {
  Frozen,
  Next,
  Timer,
  TurnCompleteInput,
  TurnCompleteResult,
  TurnStartInput,
  TurnStartResult,
} from 'claude-code'
import type {
  ClaudishFeedSupport,
  ClaudishLedger,
  ClaudishRun,
  ClaudishRuns,
  ClaudishSlotState,
  ClaudishWakeEntry,
} from '../../types'
import {
  PARKED_RETRY_MS,
  WAKE_HOLD_GUARD_MS,
  WAKE_QUICK_ATTEMPTS,
  WAKE_RETRY_MS,
  fnv1a32,
  hex8,
  lookOf,
  isDrawn,
  isTerminal,
  isWaiting,
  parseWakeKey,
  runLabel,
  wakeUnits,
  type WakeUnit,
} from './domain'
import type { Host, TranscriptRow } from './host'
import type { FetchSlot, RunSource } from './run-source'

// ── module state: dies with a hot reload, which session.start rebuilds ───────

/** The one wake timer: cancelled and replaced when an earlier time is asked. */
let timer: { at: number; t: Timer } | null = null
let flushSeq = 0

// ── pure ledger moves ─────────────────────────────────────────────────────────

export type Claimed = { key: string; state: ClaudishSlotState; wasParked: boolean }

/** Adds a pending entry for each unit with none; the created units are the claim. */
export function createPending(
  l: ClaudishLedger,
  epoch: number,
  units: readonly WakeUnit[],
  now: number,
): readonly [ClaudishLedger, WakeUnit[]] {
  if (l.epoch !== epoch) return [l, []] as const
  const created = units.filter(u => !(u.key in l.entries))
  if (created.length === 0) return [l, []] as const
  const entries = { ...l.entries }
  for (const u of created) {
    entries[u.key] = { kind: 'pending', state: u.state, at: now, attempts: 0, retryAt: null }
  }
  return [{ ...l, entries }, created] as const
}

/** A pending or parked entry is due once its retry time has come, and at every main-loop turn end. */
function isDue(e: ClaudishWakeEntry, now: number, atTurnEnd: boolean): boolean {
  if (e.kind !== 'pending' && e.kind !== 'parked') return false
  return atTurnEnd || e.retryAt === null || e.retryAt <= now
}

/** Moves every due pending or parked entry to inflight under `nonce`; they are the claim. */
export function claimDue(
  l: ClaudishLedger,
  now: number,
  atTurnEnd: boolean,
  nonce: string,
): readonly [ClaudishLedger, Claimed[]] {
  const claimed: Claimed[] = []
  const entries = { ...l.entries }
  for (const [key, e] of Object.entries(l.entries)) {
    if (!isDue(e, now, atTurnEnd) || e.kind === 'delivered' || e.kind === 'inflight') continue
    entries[key] = { kind: 'inflight', state: e.state, at: e.at, attempts: e.attempts, nonce, since: now }
    claimed.push({ key, state: e.state, wasParked: e.kind === 'parked' })
  }
  return claimed.length === 0 ? [l, claimed] as const : [{ ...l, entries }, claimed] as const
}

/** The submit carrying `nonce` was accepted: its entries are delivered. */
export function markDelivered(l: ClaudishLedger, nonce: string, now: number): ClaudishLedger {
  let changed = false
  const entries = { ...l.entries }
  for (const [key, e] of Object.entries(l.entries)) {
    if (e.kind !== 'inflight' || e.nonce !== nonce) continue
    entries[key] = { kind: 'delivered', at: now, nonce }
    changed = true
  }
  return changed ? { ...l, entries } : l
}

/** The submit carrying `nonce` was refused: back to pending with a back-off, or parked after three attempts. */
export function markRefused(l: ClaudishLedger, nonce: string, now: number, reason: string): ClaudishLedger {
  let changed = false
  const entries = { ...l.entries }
  for (const [key, e] of Object.entries(l.entries)) {
    if (e.kind !== 'inflight' || e.nonce !== nonce) continue
    const attempts = e.attempts + 1
    entries[key] = attempts < WAKE_QUICK_ATTEMPTS
      ? { kind: 'pending', state: e.state, at: e.at, attempts, retryAt: now + WAKE_RETRY_MS * attempts }
      : { kind: 'parked', state: e.state, at: e.at, attempts, reason, retryAt: now + PARKED_RETRY_MS }
    changed = true
  }
  return changed ? { ...l, entries } : l
}

/**
 * After a reload, each inflight entry is settled from the transcript: a user row holding
 * its nonce means the prompt entered (delivered); otherwise it is owed again (pending,
 * attempts kept). `stranded`: the nonces the reload caught inflight. An entry claimed
 * since, by this load's own flush, is that flush's to settle and is left alone.
 */
export function reconcileInflight(
  l: ClaudishLedger,
  rows: readonly TranscriptRow[],
  stranded?: ReadonlySet<string>,
): ClaudishLedger {
  let changed = false
  const entries = { ...l.entries }
  for (const [key, e] of Object.entries(l.entries)) {
    if (e.kind !== 'inflight' || (stranded !== undefined && !stranded.has(e.nonce))) continue
    const seen = rows.some(r => r.role === 'user' && typeof r.text === 'string' && r.text.includes(`(ref ${e.nonce})`))
    entries[key] = seen
      ? { kind: 'delivered', at: e.since, nonce: e.nonce }
      : { kind: 'pending', state: e.state, at: e.at, attempts: e.attempts, retryAt: null }
    changed = true
  }
  return changed ? { ...l, entries } : l
}

/** The earliest time a pending or parked entry can be claimed, or null when none is owed. */
export function earliestRetryAt(l: ClaudishLedger, now: number): number | null {
  let at: number | null = null
  for (const e of Object.values(l.entries)) {
    if (e.kind !== 'pending' && e.kind !== 'parked') continue
    const due = e.retryAt ?? now
    at = at === null ? due : Math.min(at, due)
  }
  return at
}

// ── wording ───────────────────────────────────────────────────────────────────

type Words = Pick<RunSource, 'runLine' | 'fetchHint'>

/** How a slot is named for the person and the model: its slot id, or a delegation's label. */
function slotName(run: ClaudishRun, slot: string): string {
  return run.ref.kind === 'delegation' ? runLabel(run) : slot
}

function waitWord(state: ClaudishSlotState): string {
  return state === 'AWAITING_PERMISSION' ? 'permission' : 'input'
}

/** The toast for one new unit: `03 grok-4.6 done ✓`, `#a1b2c3 haiku-4.5 waiting for input ◇`. */
export function toastText(runs: readonly ClaudishRun[], unit: WakeUnit): { text: string; timeoutMs: number } {
  const k = parseWakeKey(unit.key)
  const run = runs.find(r => r.id === k.runId)
  const slot = run?.slots.find(s => s.slot === k.slot)
  const name = run ? (k.slot === '*' ? runLabel(run) : `${slotName(run, k.slot)} ${slot?.model ?? ''}`.trim()) : k.slot
  if (k.wait !== null) return { text: `${name} waiting for ${waitWord(unit.state)} ◇`, timeoutMs: 4_000 }
  const look = lookOf(unit.state, slot?.reason ?? null)
  return { text: `${name} ${look.word} ${look.glyph}`, timeoutMs: look.group === 'failed' ? 6_000 : 4_000 }
}

/** Short names of claimed keys for a toast or the status line: `03 grok-4.6`, `#a1b2c3 haiku-4.5`. */
function keyLabels(runs: readonly ClaudishRun[], keys: readonly string[]): string {
  const names: string[] = []
  for (const key of keys) {
    const k = parseWakeKey(key)
    const run = runs.find(r => r.id === k.runId)
    const model = run?.slots.find(s => s.slot === k.slot)?.model
    const name = run ? (k.slot === '*' ? runLabel(run) : `${slotName(run, k.slot)}${model ? ` ${model}` : ''}`) : key
    if (!names.includes(name)) names.push(name)
  }
  return names.join(', ')
}

/** What one terminal state reads as in the text, with the reason claudish gave (closed set only). */
function terminalPhrase(run: ClaudishRun, slot: string, state: ClaudishSlotState, reason: string | null, detail: string | null = null): string {
  switch (state) {
    case 'CANCELLED':
      return run.personStops.includes(slot) ? 'CANCELLED (stopped by the person)' : 'CANCELLED'
    case 'TIMEOUT':
      return 'TIMEOUT'
    case 'FAILED':
    case 'EMPTY':
      if (reason && detail) return `${state} (${reason}: ${detail})`
      return reason ? `${state} (${reason})` : detail ? `${state} (${detail})` : state
    case 'LOST':
      return 'no longer reported by claudish, so check its status'
    default:
      return state
  }
}

function waitingPhrase(state: ClaudishSlotState, asked: boolean): string {
  if (state === 'AWAITING_PERMISSION') return 'is waiting on a permission dialog'
  return asked ? 'is asking a question and waiting for an answer' : 'finished its turn and is waiting for input'
}

/** How each terminal state is counted in a run's tally, in the order the tally names them. */
const OUTCOMES: readonly (readonly [ClaudishSlotState, string])[] = [
  ['COMPLETED', 'completed'],
  ['FAILED', 'failed'],
  ['EMPTY', 'empty'],
  ['TIMEOUT', 'timed out'],
  ['CANCELLED', 'cancelled'],
  ['LOST', 'lost'],
]

/**
 * A panel run's standing, said outright: how many slots are done and how they ended, and, once
 * every slot is terminal, that the run is finished. The model must not infer the end from the
 * absence of a "still running" line. Null for a run with no slots yet.
 */
function progressLine(run: ClaudishRun): string | null {
  const total = run.slots.length
  if (total === 0) return null
  const done = run.slots.filter(s => isTerminal(s.state))
  const tally = OUTCOMES
    .map(([state, word]) => [done.filter(s => s.state === state).length, word] as const)
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(', ')
  const counted = `${done.length} of ${total} ${total === 1 ? 'slot' : 'slots'} done${tally ? ` (${tally})` : ''}`
  return done.length === total
    ? `  run finished: ${counted}. No more messages will arrive for this run.`
    : `  progress: ${counted}`
}

type SlotClaim = { slot: string; terminal: ClaudishSlotState | null; wait: { n: number; state: ClaudishSlotState } | null }

function fetchLine(hint: string, states: readonly ClaudishSlotState[]): string {
  if (/^[A-Z]/.test(hint)) return `${hint}.`
  return states.every(isTerminal) ? `Fetch the result now: ${hint}.` : `Next: ${hint}.`
}

/**
 * The prompt naming every claimed key (pure). Only sanctioned identifiers reach it: the run
 * line and fetch line from the port, slot ids, sanitised model ids, states, closed-set
 * reasons, fixed phrases and the nonce. Never activity, provider or screen text.
 */
export function composeWake(
  runs: readonly ClaudishRun[],
  claimed: readonly { key: string; state: ClaudishSlotState }[],
  nonce: string,
  words: Words,
): string {
  const byRun = new Map<string, Map<string, SlotClaim>>()
  const orphans: { key: string; state: ClaudishSlotState }[] = []
  for (const c of claimed) {
    const k = parseWakeKey(c.key)
    if (!runs.some(r => r.id === k.runId)) {
      orphans.push(c)
      continue
    }
    const slots = byRun.get(k.runId) ?? new Map<string, SlotClaim>()
    byRun.set(k.runId, slots)
    const sc = slots.get(k.slot) ?? { slot: k.slot, terminal: null, wait: null }
    if (k.wait === null) sc.terminal = c.state
    else if (sc.wait === null || k.wait > sc.wait.n) sc.wait = { n: k.wait, state: c.state }
    slots.set(k.slot, sc)
  }

  let finished = 0
  let waiting = 0
  const blocks: string[] = []
  for (const run of runs) {
    const slots = byRun.get(run.id)
    if (!slots) continue
    const lines: string[] = [words.runLine(run.ref, runLabel(run))]
    const fetch: FetchSlot[] = []
    for (const sc of slots.values()) {
      const now = run.slots.find(s => s.slot === sc.slot)
      const current = now?.state ?? sc.terminal ?? sc.wait?.state ?? 'UNKNOWN'
      const asked = now?.asked ?? false
      let phrase: string
      if (sc.slot === '*') {
        lines.push(`  - run ${runLabel(run)} never appeared in claudish's list, so check its status`)
        finished += 1
        fetch.push({ slot: sc.slot, state: 'LOST', asked: false })
        continue
      }
      if (sc.terminal !== null) {
        finished += 1
        phrase = terminalPhrase(run, sc.slot, sc.terminal, now?.reason ?? null, now?.detail ?? null)
        if (sc.wait !== null) {
          const had = `it had been waiting for ${waitWord(sc.wait.state)}`
          phrase = phrase.endsWith(')') ? `${phrase.slice(0, -1)}; ${had})` : `${phrase} (${had})`
        }
        fetch.push({ slot: sc.slot, state: sc.terminal, asked: false })
      } else {
        const wait = sc.wait ?? { n: 0, state: 'AWAITING_INPUT' as ClaudishSlotState }
        waiting += 1
        phrase = isWaiting(current) ? waitingPhrase(current, asked) : `waited for ${waitWord(wait.state)}; now ${current}`
        fetch.push({ slot: sc.slot, state: current, asked })
      }
      const model = now?.model ?? 'unknown model'
      lines.push(run.ref.kind === 'delegation' ? `  - ${model}: ${phrase}` : `  - slot ${sc.slot} ${model}: ${phrase}`)
    }
    const running = run.ref.kind === 'panel'
      ? run.slots.filter(s => !isTerminal(s.state) && !slots.has(s.slot)).map(s => `${s.slot} ${s.model}`)
      : []
    if (running.length > 0) lines.push(`  still running: ${running.join(', ')}`)
    const progress = run.ref.kind === 'panel' ? progressLine(run) : null
    if (progress !== null) lines.push(progress)
    lines.push(fetchLine(words.fetchHint(run.ref, fetch), fetch.map(f => f.state)))
    if (running.length > 0) lines.push('Another message like this arrives as each running slot finishes.')
    else if (run.ref.kind === 'delegation' && fetch.some(f => !isTerminal(f.state))) {
      lines.push('Another message like this arrives each time it waits again, and when it ends.')
    }
    blocks.push(lines.join('\n'))
  }
  if (orphans.length > 0) {
    finished += orphans.length
    blocks.push(['Runs no longer listed here:', ...orphans.map(o => `  - ${o.key}: ${o.state}`)].join('\n'))
  }

  const heads: string[] = []
  if (finished > 0) heads.push(`${finished} ${finished === 1 ? 'slot' : 'slots'} finished`)
  if (waiting > 0) heads.push(waiting === 1 ? 'a delegated session is waiting for you' : `${waiting} delegated sessions are waiting for you`)
  const head = heads.join('; ')
  return [`${head.charAt(0).toUpperCase()}${head.slice(1)}. (ref ${nonce})`, ...blocks].join('\n')
}

// ── the timer ─────────────────────────────────────────────────────────────────

function cancelTimer(): void {
  timer?.t.cancel()
  timer = null
}

/** Keeps one timer armed for the earliest owed time; none when nothing is owed. */
function armTimer(host: Host, at: number | null, now: number): void {
  if (at === null) {
    cancelTimer()
    return
  }
  if (timer !== null && timer.at <= at) return
  cancelTimer()
  const armed = { at, t: host.after(Math.max(0, at - now), () => {
    if (timer === armed) timer = null
    flushDetached(host)
  }) }
  timer = armed
}

/** A flush nobody awaits (a timer, a turn's end, a load): a failure is one debug line, never an unhandled rejection. */
export function flushDetached(host: Host, opts: { atTurnEnd?: boolean } = {}): void {
  flush(host, opts).catch((err: unknown) => {
    try {
      host.debug(`claudish wake: flush failed: ${err instanceof Error ? err.message : String(err)}`)
    } catch {
      // the environment that armed it is gone (a reload); the next load's flush owns the ledger
    }
  })
}

// ── session boundaries and turns ──────────────────────────────────────────────

/** session.start: the volatile state a reload strands is reset (a stop request never outlives
 *  the timer that would expire it; a turn flag never holds notices for a turn this load won't see end). */
export async function resetVolatile(host: Host): Promise<void> {
  cancelTimer()
  await host.store.stopRequests.update(m => (Object.keys(m).length === 0 ? m : {}))
  await host.store.turn.update(t => (t.isRunning ? { isRunning: false, since: 0 } : t))
}

/** session.start, after the reset: entries a reload caught inflight are settled from the transcript. */
export async function recover(host: Host): Promise<void> {
  const l = await host.store.ledger.read()
  const stranded = new Set(Object.values(l.entries).flatMap(e => (e.kind === 'inflight' ? [e.nonce] : [])))
  if (stranded.size === 0) return
  let rows: readonly TranscriptRow[] = []
  try {
    rows = await host.messages()
  } catch (err) {
    host.debug(`claudish wake: transcript unreadable, re-sending in-flight notices (${err instanceof Error ? err.message : String(err)})`)
  }
  await host.store.ledger.update(v => (v.epoch !== l.epoch ? v : reconcileInflight(v, Array.isArray(rows) ? rows : [], stranded)))
}

/** turn.start is raised by the main loop alone (a subagent's run raises none). */
export async function onTurnStart(
  host: Host,
  e: Frozen<TurnStartInput>,
  next: Next<'turn.start'>,
): Promise<TurnStartResult> {
  const now = await host.now()
  await host.store.turn.update(() => ({ isRunning: true, since: now }))
  return next(e)
}

/** The main loop's turn ended: notices it deferred, and parked ones, are delivered now. */
export async function onTurnComplete(
  host: Host,
  e: Frozen<TurnCompleteInput>,
  next: Next<'turn.complete'>,
): Promise<TurnCompleteResult> {
  const result = await next(e)
  if (e.agentId === undefined) {
    await host.store.turn.update(t => (t.isRunning ? { isRunning: false, since: 0 } : t))
    flushDetached(host, { atTurnEnd: true })
  }
  return result
}

// ── notice and flush ──────────────────────────────────────────────────────────

/**
 * From the poll tick: creates a pending entry for each owed unit of a drawn run that has
 * none, toasts each one created, and flushes. Writes nothing when every unit has an entry.
 */
export async function notice(
  host: Host,
  epoch: number,
  runs: ClaudishRuns,
  feeds: Readonly<Record<string, ClaudishFeedSupport>>,
): Promise<void> {
  const units = wakeUnits(runs.list.filter(r => isDrawn(r, feeds)))
  if (units.length === 0) return
  const before = await host.store.ledger.read()
  if (before.epoch !== epoch || units.every(u => u.key in before.entries)) return
  const now = await host.now()
  const [, created] = await host.store.ledger.claim(l => createPending(l, epoch, units, now))
  for (const u of created) {
    const t = toastText(runs.list, u)
    host.toast(t.text, t.timeoutMs)
  }
  if (created.length > 0) await flush(host)
}

/**
 * Delivers every due entry in one prompt, unless the main loop's turn runs (then at its
 * end). Called from notice, the main loop's turn.complete (atTurnEnd), session.start and
 * the wake timer: the complete trigger set. After it, nothing is owed or the timer is armed.
 */
export async function flush(host: Host, { atTurnEnd = false }: { atTurnEnd?: boolean } = {}): Promise<void> {
  const now = await host.now()
  const turn = await host.store.turn.read()
  if (turn.isRunning && now - turn.since < WAKE_HOLD_GUARD_MS) {
    armTimer(host, turn.since + WAKE_HOLD_GUARD_MS, now)
    return
  }
  const before = await host.store.ledger.read()
  if (!Object.values(before.entries).some(e => isDue(e, now, atTurnEnd))) {
    armTimer(host, earliestRetryAt(before, now), now)
    return
  }
  flushSeq += 1
  const nonce = `w${hex8(fnv1a32(`${now}|${flushSeq}`))}` // all 32 bits: matched as `(ref …)` in the transcript
  const [ledger, claimed] = await host.store.ledger.claim(l => claimDue(l, now, atTurnEnd, nonce))
  if (claimed.length === 0) {
    armTimer(host, earliestRetryAt(ledger, now), now)
    return
  }
  const runsNow = await host.store.runs.read()
  const text = composeWake(runsNow.list, claimed, nonce, host.source)
  const epochNow = (await host.store.ledger.read()).epoch
  if (epochNow !== ledger.epoch) return // a /clear or resume landed: those entries are gone
  const res = await host.submit(text) // no await between the epoch read and this call
  let after: ClaudishLedger
  if (res.accepted) {
    after = await host.store.ledger.update(l => markDelivered(l, nonce, now))
    const parkedLeft = Object.values(after.entries).some(e => e.kind === 'parked')
    if (!parkedLeft && claimed.some(c => c.wasParked)) host.status(undefined)
  } else {
    after = await host.store.ledger.update(l => markRefused(l, nonce, now, res.reason))
    host.toast(`Result notice for ${keyLabels(runsNow.list, claimed.map(c => c.key))} not delivered (${res.reason}); retrying`, 6_000)
    const parked = Object.entries(after.entries).filter(([, e]) => e.kind === 'parked').map(([k]) => k)
    if (parked.length > 0) {
      host.status(`${parked.length} result ${parked.length === 1 ? 'notice' : 'notices'} waiting to be delivered: ${keyLabels(runsNow.list, parked)}`)
      for (const c of claimed) {
        if (!c.wasParked && parked.includes(c.key)) host.debug(`claudish wake: notice ${c.key} parked after ${WAKE_QUICK_ATTEMPTS} refusals (${res.reason})`)
      }
    }
  }
  armTimer(host, earliestRetryAt(after, now), now)
}
