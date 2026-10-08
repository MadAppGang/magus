// The completion wake-up: every terminal transition of a drawn run this conversation
// started, and every entry of one of its delegations into a waiting state, is named in
// exactly one prompt the engine accepted. The ledger (one atom, through host.store) holds
// delivery: pending → inflight → delivered, or back to pending / parked on a refusal.
//
// claudish's own session monitor reports some of the same changes, and its line is a turn of
// its own. Where it reports, it is the primary: such a change is held for MONITOR_GRACE_MS,
// and a matching line in a row of the conversation marks it delivered without a prompt.
// Otherwise the prompt goes as before. A line arriving after the prompt cannot be taken back.
//
// Takes a Host only. Names no claudish tool or field: the run line and the fetch line of
// the text come from the port's runLine and fetchHint, monitor lines from monitorReports.

import type {
  Frozen,
  Next,
  SessionAppendInput,
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
  MONITOR_GRACE_MS,
  PARKED_RETRY_MS,
  STATE_LOOK,
  WAKE_HOLD_GUARD_MS,
  WAKE_QUICK_ATTEMPTS,
  WAKE_RETRY_MS,
  fnv1a32,
  hex8,
  isDrawn,
  isTerminal,
  isWaiting,
  parseWakeKey,
  runLabel,
  wakeUnits,
  type WakeUnit,
} from './domain'
import type { Host, TranscriptRow } from './host'
import type { FetchSlot, MonitorReport, RunSource } from './run-source'

// ── module state: dies with a hot reload, which session.start rebuilds ───────

/** The one wake timer: cancelled and replaced when an earlier time is asked. */
let timer: { at: number; t: Timer } | null = null
let flushSeq = 0
/** Monitor reports seen in the last MONITOR_GRACE_MS, for changes noticed after their line. */
let sightings: Sighting[] = []
const SIGHTINGS_MAX = 200

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
    entries[u.key] = u.held
      ? { kind: 'pending', state: u.state, at: now, attempts: 0, retryAt: null, heldUntil: now + MONITOR_GRACE_MS }
      : { kind: 'pending', state: u.state, at: now, attempts: 0, retryAt: null }
  }
  return [{ ...l, entries }, created] as const
}

/** A held entry waits for the monitor's line until its hold ends, at a turn's end too. */
function isDue(e: ClaudishWakeEntry, now: number, atTurnEnd: boolean): boolean {
  if (e.kind !== 'pending' && e.kind !== 'parked') return false
  if (e.kind === 'pending' && e.heldUntil !== undefined && e.heldUntil > now) return false
  return atTurnEnd || e.retryAt === null || e.retryAt <= now
}

/** Moves every due pending or parked entry to inflight under `nonce`; they are the claim. While any entry
 *  of a run is still held, the run's due entries wait with it: the monitor's line, if it comes, stands
 *  for them all, and if it does not, one prompt names the run at the hold's end. Taking a held entry
 *  early is what made the monitor's line a second notice for the same change. */
export function claimDue(
  l: ClaudishLedger,
  now: number,
  atTurnEnd: boolean,
  nonce: string,
): readonly [ClaudishLedger, Claimed[]] {
  const claimed: Claimed[] = []
  const entries = { ...l.entries }
  const heldRuns = runHolds(l, now)
  for (const [key, e] of Object.entries(l.entries)) {
    if (!isDue(e, now, atTurnEnd) || e.kind === 'delivered' || e.kind === 'inflight' || heldRuns.has(parseWakeKey(key).runId)) continue
    entries[key] = { kind: 'inflight', state: e.state, at: e.at, attempts: e.attempts, nonce, since: now }
    claimed.push({ key, state: e.state, wasParked: e.kind === 'parked' })
  }
  return claimed.length === 0 ? [l, claimed] as const : [{ ...l, entries }, claimed] as const
}

/**
 * The main loop's turn ended: every held entry is held MONITOR_GRACE_MS from now. While a turn
 * runs, Claude Code queues the monitor's line and hands it over only after the turn, so a hold
 * that ran out during the turn gave the line no chance (measured: the mod prompted 6 ms after
 * the turn ended, and the queued line then started a second turn).
 */
export function reholdAtTurnEnd(l: ClaudishLedger, now: number): ClaudishLedger {
  let changed = false
  const entries = { ...l.entries }
  for (const [key, e] of Object.entries(l.entries)) {
    if (e.kind !== 'pending' || e.heldUntil === undefined || e.heldUntil >= now + MONITOR_GRACE_MS) continue
    entries[key] = { ...e, heldUntil: now + MONITOR_GRACE_MS }
    changed = true
  }
  return changed ? { ...l, entries } : l
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

// ── the monitor's lines ───────────────────────────────────────────────────────

/** One monitor report and when its row was seen. */
export type Sighting = { at: number; report: MonitorReport }

/** Does a monitor report stand for this wake key of this run? A delegation's end stands for its
 *  waits too (the monitor reports no wait still open at the end); a panel run's end, matched by the
 *  record id its start answer named, stands for every key of the run once the mod has seen it settle. */
export function reports(run: ClaudishRun, isWait: boolean, r: MonitorReport): boolean {
  if (r.kind === 'delegation') {
    return run.ref.kind === 'delegation' && r.token === run.ref.token && (r.event === 'ended' || isWait)
  }
  if (isWait || !monitorCovers(run)) return false
  return run.ref.kind === 'panel' && r.record === run.ref.monitor
}

/** Would claudish's monitor report this unit's change? Every unit of a delegation; a panel run's once
 *  it settled, when its start answer named the record the monitor reports it by. */
export function monitorCovers(run: ClaudishRun): boolean {
  if (run.ref.kind === 'delegation') return true
  return run.settledAt !== null && run.ref.monitor !== undefined
}

/**
 * Marks delivered (by the monitor) every pending or parked entry a sighting stands for: one
 * seen after the change was noticed, or at most MONITOR_GRACE_MS before. The marked keys are the claim.
 */
export function monitorDeliver(
  l: ClaudishLedger,
  runs: ClaudishRuns,
  seen: readonly Sighting[],
  now: number,
): readonly [ClaudishLedger, string[]] {
  if (l.epoch !== runs.epoch || seen.length === 0) return [l, []] as const
  const moved: string[] = []
  const entries = { ...l.entries }
  for (const [key, e] of Object.entries(l.entries)) {
    if (e.kind !== 'pending' && e.kind !== 'parked') continue
    const k = parseWakeKey(key)
    const run = runs.list.find(r => r.id === k.runId)
    if (!run || !seen.some(s => s.at >= e.at - MONITOR_GRACE_MS && reports(run, k.wait !== null, s.report))) continue
    entries[key] = { kind: 'delivered', at: now, nonce: 'monitor', by: 'monitor' }
    moved.push(key)
  }
  return moved.length === 0 ? [l, moved] as const : [{ ...l, entries }, moved] as const
}

/** The text of a row the monitor's line could arrive in: not the model's, not a tool's, not typed by the person. */
export function notificationText(e: Frozen<SessionAppendInput>): string | null {
  if (e.message.type === 'assistant' || e.door === 'response' || e.door === 'tool-result' || e.door === 'tool-message') return null
  const kind = e.origin.kind
  if (kind === 'model' || kind === 'tool' || kind === 'composer' || kind === 'bridge') return null
  const blocks = Array.isArray(e.message.content) ? e.message.content : []
  const texts: string[] = []
  for (const b of blocks) {
    const block = b as { type?: unknown; text?: unknown }
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
  }
  return texts.length === 0 ? null : texts.join('\n')
}

function sightingsAt(now: number): Sighting[] {
  sightings = sightings.filter(s => s.at >= now - MONITOR_GRACE_MS).slice(-SIGHTINGS_MAX)
  return sightings
}

/**
 * session.append, observe-only: a row of the conversation carrying claudish's monitor lines
 * stands the wake down for the changes they report. Synchronous up to the parse; never throws.
 */
export function observeRow(host: Host, e: Frozen<SessionAppendInput>): void {
  let found: MonitorReport[]
  try {
    const text = notificationText(e)
    found = text === null ? [] : host.source.monitorReports(text)
  } catch {
    return
  }
  if (found.length === 0) return
  standDown(host, found).catch((err: unknown) => {
    try {
      host.debug(`claudish wake: monitor line not applied: ${err instanceof Error ? err.message : String(err)}`)
    } catch {
      // the environment that saw the row is gone (a reload)
    }
  })
}

async function standDown(host: Host, found: readonly MonitorReport[]): Promise<void> {
  const now = await host.now()
  sightings = [...sightingsAt(now), ...found.map(report => ({ at: now, report }))].slice(-SIGHTINGS_MAX)
  const seen = sightings
  const runs = await host.store.runs.read()
  const [after, moved] = await host.store.ledger.claim(l => monitorDeliver(l, runs, seen, now))
  for (const key of moved) host.debug(`claudish wake: ${key} delivered by claudish's session monitor`)
  armTimer(host, earliestRetryAt(after, now), now)
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

/** The latest hold still running per run: claimDue holds the run's due entries until then. */
function runHolds(l: ClaudishLedger, now: number): Map<string, number> {
  const holds = new Map<string, number>()
  for (const [key, e] of Object.entries(l.entries)) {
    if (e.kind !== 'pending' || e.heldUntil === undefined || e.heldUntil <= now) continue
    const runId = parseWakeKey(key).runId
    holds.set(runId, Math.max(holds.get(runId) ?? 0, e.heldUntil))
  }
  return holds
}

/** The earliest time a pending or parked entry can be claimed, or null when none is owed. */
export function earliestRetryAt(l: ClaudishLedger, now: number): number | null {
  const holds = runHolds(l, now)
  let at: number | null = null
  for (const [key, e] of Object.entries(l.entries)) {
    if (e.kind !== 'pending' && e.kind !== 'parked') continue
    const held = holds.get(parseWakeKey(key).runId) ?? -Infinity
    const due = Math.max(e.retryAt ?? now, held)
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
  const look = STATE_LOOK[unit.state]
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
function terminalPhrase(run: ClaudishRun, slot: string, state: ClaudishSlotState, reason: string | null): string {
  switch (state) {
    case 'CANCELLED':
      return run.personStops.includes(slot) ? 'CANCELLED (stopped by the person)' : 'CANCELLED'
    case 'TIMEOUT':
      return 'TIMEOUT'
    case 'FAILED':
    case 'EMPTY':
      return reason ? `${state} (${reason})` : state
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
        phrase = terminalPhrase(run, sc.slot, sc.terminal, now?.reason ?? null)
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

/** The main loop's turn ended: notices it held, and parked ones, are delivered now. */
export async function onTurnComplete(
  host: Host,
  e: Frozen<TurnCompleteInput>,
  next: Next<'turn.complete'>,
): Promise<TurnCompleteResult> {
  const result = await next(e)
  if (e.agentId === undefined) {
    await host.store.turn.update(t => (t.isRunning ? { isRunning: false, since: 0 } : t))
    const now = await host.now()
    await host.store.ledger.update(l => reholdAtTurnEnd(l, now))
    flushDetached(host, { atTurnEnd: true })
  }
  return result
}

// ── notice and flush ──────────────────────────────────────────────────────────

/**
 * From the poll tick: creates a pending entry for each owed unit of a drawn run that has
 * none (held when claudish's monitor reports that change too, and delivered at once when its
 * line was already seen), toasts each one created, and flushes. Writes nothing when every
 * unit has an entry.
 */
export async function notice(
  host: Host,
  epoch: number,
  runs: ClaudishRuns,
  feeds: Readonly<Record<string, ClaudishFeedSupport>>,
): Promise<void> {
  const drawn = runs.list.filter(r => isDrawn(r, feeds))
  const units = wakeUnits(drawn).map(u => {
    const run = drawn.find(r => r.id === parseWakeKey(u.key).runId)
    return run && monitorCovers(run) ? { ...u, held: true } : u
  })
  if (units.length === 0) return
  const before = await host.store.ledger.read()
  if (before.epoch !== epoch || units.every(u => u.key in before.entries)) return
  const now = await host.now()
  const seen = sightingsAt(now)
  const [, made] = await host.store.ledger.claim(l => {
    const [withNew, created] = createPending(l, epoch, units, now)
    if (created.length === 0) return [withNew, { created, moved: [] as string[] }] as const
    const [written, moved] = monitorDeliver(withNew, runs, seen, now)
    return [written, { created, moved }] as const
  })
  for (const u of made.created) {
    const t = toastText(runs.list, u)
    host.toast(t.text, t.timeoutMs)
  }
  for (const key of made.moved) host.debug(`claudish wake: ${key} delivered by claudish's session monitor`)
  if (made.created.length > 0) await flush(host)
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
