// Pure domain functions and constants: state classes, ids and hashes, sanitising, the
// run merge (LOST rules, wait entries, settlement), stop-request pruning and compaction.
// No engine interface, no state reference, no claudish vocabulary.

import type { ThemeKey } from 'claude-code'
import type {
  ClaudishEarlier,
  ClaudishFeedSupport,
  ClaudishLedger,
  ClaudishRun,
  ClaudishRunKind,
  ClaudishRunRef,
  ClaudishRuns,
  ClaudishSlot,
  ClaudishSlotState,
  ClaudishStopRequest,
  ClaudishWait,
} from '../../types'

// ── constants ─────────────────────────────────────────────────────────────────

/** Styled runs kept per captured line, the leftmost; the rest of the line draws plain. */
export const STYLE_SPANS_PER_LINE = 24
/** A run missing from its list is LOST only after this many misses spanning MISSING_LOST_MS. */
export const MISSING_LOST_POLLS = 5
export const MISSING_LOST_MS = 30_000
/** A speaking feed that keeps failing ends its runs LOST after this long. */
export const UNREACHABLE_LOST_MS = 5 * 60_000
/** A slot in a state outside the closed set ends LOST after this long. */
export const UNKNOWN_LOST_MS = 10 * 60_000
/** Past this many runs, the oldest settled, fully delivered runs fold into `earlier`. */
export const RUNS_CAP = 100
export const STOP_CONFIRM_MS = 4_000
export const STOP_SENT_TIMEOUT_MS = 20_000
/** A tab whose slot ended keeps capturing this long for its final screen. */
export const FINAL_GRACE_MS = 30_000
export const QUIET_AFTER_S = 120
export const NO_SCREEN_NOTE = 'Run ended before a screen was captured'
export const NO_CAPTURE_NOTE = 'Live screen not available from this claudish version'

/** The only colours the mod's own drawing uses: theme keys the engine resolves for light and dark. */
export const THEME_KEYS = ['claude', 'permission', 'success', 'error', 'warning', 'inactive', 'subtle'] as const satisfies readonly ThemeKey[]
export type StatusColor = (typeof THEME_KEYS)[number]

/** The body columns a Show tab asks for when docked: a request, the person's own width wins. */
export const SHOW_COLUMNS = 120
/** Surfaces that paint the child's colours in a Show tab; the others draw its screen plain. */
export const PAINT_SURFACES: readonly string[] = ['terminal', 'desktop']
/** What one frame line and one styled segment cost, estimated, against the style budget. */
export const PANE_LINE_COST = 64
export const PANE_SEGMENT_COST = 128
/** Past this estimate a frame draws plain: half the engine's 100,000-character tree bound. */
export const PANE_STYLE_BUDGET = 50_000

export const PANE_ID_PATTERN = /^cl_[0-9a-f]{8}$/

/** While the main loop's turn runs (for at most this long), notices wait for its end. */
export const WAKE_HOLD_GUARD_MS = 30 * 60_000
/** A refused notice is retried after attempts × this, up to WAKE_QUICK_ATTEMPTS attempts. */
export const WAKE_RETRY_MS = 30_000
export const WAKE_QUICK_ATTEMPTS = 3
/** A parked notice is retried this often, and at every main-loop turn end. */
export const PARKED_RETRY_MS = 10 * 60_000
/** A change claudish's session monitor also reports is held this long for the monitor's line, which then
 *  stands for it; a line seen up to this long before the change was noticed counts too. */
export const MONITOR_GRACE_MS = 10_000

// ── state classes ─────────────────────────────────────────────────────────────

const TERMINAL: ReadonlySet<ClaudishSlotState> = new Set<ClaudishSlotState>([
  'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EMPTY', 'LOST',
])

export function isTerminal(state: ClaudishSlotState): boolean {
  return TERMINAL.has(state)
}

export function isWaiting(state: ClaudishSlotState): boolean {
  return state === 'AWAITING_INPUT' || state === 'AWAITING_PERMISSION'
}

/** §4.2: glyph + word, the theme key, and the header word, per state. */
export const STATE_LOOK: Readonly<Record<ClaudishSlotState, { glyph: string; word: string; color: StatusColor; group: 'needs you' | 'running' | 'done' | 'failed' | 'stopped' }>> = {
  STARTING: { glyph: '◌', word: 'starting', color: 'warning', group: 'running' },
  RUNNING: { glyph: '▶', word: 'running', color: 'warning', group: 'running' },
  AWAITING_INPUT: { glyph: '◇', word: 'input', color: 'permission', group: 'needs you' },
  AWAITING_PERMISSION: { glyph: '◇', word: 'permit', color: 'permission', group: 'needs you' },
  COMPLETED: { glyph: '✓', word: 'done', color: 'success', group: 'done' },
  FAILED: { glyph: '✕', word: 'failed', color: 'error', group: 'failed' },
  TIMEOUT: { glyph: '✕', word: 'timeout', color: 'error', group: 'failed' },
  EMPTY: { glyph: '✕', word: 'empty', color: 'error', group: 'failed' },
  CANCELLED: { glyph: '■', word: 'stopped', color: 'inactive', group: 'stopped' },
  LOST: { glyph: '?', word: 'lost', color: 'error', group: 'failed' },
  UNKNOWN: { glyph: '?', word: 'unknown', color: 'inactive', group: 'running' },
}

// ── ids and hashes ────────────────────────────────────────────────────────────

/** FNV-1a, 32-bit, over UTF-16 code units. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0')
}

/** One id per start, because claudish's token is per start. */
export function runId(ref: ClaudishRunRef): string {
  return hex8(fnv1a32(`${ref.kind}|${ref.server}|${ref.token}`))
}

/** A feed is one server × one run kind: one list call per tick. */
export function feedKey(ref: { server: string; kind: ClaudishRunKind }): string {
  return `${ref.server}#${ref.kind}`
}

/** A Show tab's pane id: stable across reloads, one per slot of a run. */
export function paneId(id: string, slot: string): string {
  return `cl_${hex8(fnv1a32(`${id}/${slot}`))}`
}

/** `${runId}/${slot}`: the key of a stop request and of a terminal wake. */
export function slotKey(id: string, slot: string): string {
  return `${id}/${slot}`
}

/** `${runId}/${slot}#w${n}`: the key of a delegation slot's n-th wait entry. */
export function waitKey(id: string, slot: string, n: number): string {
  return `${id}/${slot}#w${n}`
}

/** A wake ledger key taken apart; `wait` is the entry number of a wait key, null for a terminal key. */
export function parseWakeKey(key: string): { runId: string; slot: string; wait: number | null } {
  const cut = key.indexOf('/')
  const rest = key.slice(cut + 1)
  const m = /^(.*)#w(\d+)$/.exec(rest)
  return m ? { runId: key.slice(0, cut), slot: m[1] ?? '', wait: Number(m[2]) } : { runId: key.slice(0, cut), slot: rest, wait: null }
}

/** The label a run is shown and named by: `label`, or `label·N` for the N-th start at its address. */
export function runLabel(run: ClaudishRun): string {
  return run.generation > 1 ? `${run.label}·${run.generation}` : run.label
}

/** A run is drawn while it has a slot, or while its feed speaks the contract. */
export function isDrawn(run: ClaudishRun, feeds: Readonly<Record<string, ClaudishFeedSupport>>): boolean {
  return run.slots.length > 0 || feeds[feedKey(run.ref)]?.kind === 'speaks'
}

// ── text ──────────────────────────────────────────────────────────────────────

// SGR and other CSI sequences, OSC sequences, lone escapes, C0/C1 controls and bidi overrides.
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g
const CONTROLS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g

/** Display-safe text from a server string: no escapes, no controls, one line, at most `max` characters. */
export function sanitize(text: string, max: number): string {
  return text.replace(CSI, '').replace(OSC, '').replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Structural equality of plain JSON data. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => sameData(v, bb[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  const bk = Object.keys(bo)
  return ak.length === bk.length && ak.every(k => Object.prototype.hasOwnProperty.call(bo, k) && sameData(ao[k], bo[k]))
}

// ── runs ──────────────────────────────────────────────────────────────────────

export function newRun(args: {
  id: string
  ref: ClaudishRunRef
  label: string
  epoch: number
  generation: number
  now: number
}): ClaudishRun {
  return {
    id: args.id,
    epoch: args.epoch,
    ref: args.ref,
    label: args.label,
    generation: args.generation,
    slots: [],
    activityAt: args.now,
    missedPolls: 0,
    missingSince: null,
    unreachableSince: null,
    unknownSince: {},
    personStops: [],
    waits: {},
    lostReason: null,
    settledAt: null,
  }
}

/** What one tick observed about one run. */
export type RunObservation =
  | { kind: 'ok'; slots: readonly ClaudishSlot[] }
  | { kind: 'missing' }
  /** its feed spoke the contract but answered badly this tick */
  | { kind: 'unreachable' }
  /** its feed withdrew the contract */
  | { kind: 'withdrawn' }

function lostSlot(s: ClaudishSlot): ClaudishSlot {
  return { ...s, state: 'LOST', idleSeconds: null, activity: null, asked: false }
}

/** LOST at run level: every non-terminal slot, or a synthetic `*` slot for a run never listed. */
export function applyLost(run: ClaudishRun, reason: string): ClaudishRun {
  const slots: ClaudishSlot[] = run.slots.length === 0
    ? [{
        slot: '*', model: run.label, provider: null, state: 'LOST', reason: null,
        tokensIn: null, tokensOut: null, toolCalls: null, turnsCompleted: null,
        idleSeconds: null, lastActivityAt: null, activity: null, asked: false,
      }]
    : run.slots.map(s => (isTerminal(s.state) ? s : lostSlot(s)))
  return { ...run, slots, unknownSince: {}, lostReason: run.lostReason ?? reason }
}

function waitSig(s: ClaudishSlot): string {
  return `${s.state}|${s.activity ?? ''}|${s.turnsCompleted ?? ''}|${s.toolCalls ?? ''}`
}

/** Wait entries for a delegation's slots: a new entry whenever a waiting slot's signature changes. */
function nextWaits(prev: Readonly<Record<string, ClaudishWait>>, slots: readonly ClaudishSlot[]): Record<string, ClaudishWait> {
  const waits: Record<string, ClaudishWait> = { ...prev }
  for (const s of slots) {
    const w = prev[s.slot] ?? { entries: 0, sig: null }
    if (isWaiting(s.state)) {
      const sig = waitSig(s)
      waits[s.slot] = sig === w.sig ? w : { entries: w.entries + 1, sig }
    } else if (w.sig !== null || prev[s.slot] !== undefined) {
      waits[s.slot] = { entries: w.entries, sig: null }
    }
  }
  return waits
}

function isActivity(prev: readonly ClaudishSlot[], next: readonly ClaudishSlot[]): boolean {
  if (prev.length !== next.length) return true
  return next.some(n => {
    const p = prev.find(x => x.slot === n.slot)
    if (!p) return true
    return p.state !== n.state
      || p.tokensIn !== n.tokensIn
      || p.tokensOut !== n.tokensOut
      || p.toolCalls !== n.toolCalls
      || p.turnsCompleted !== n.turnsCompleted
      || (n.lastActivityAt !== null && (p.lastActivityAt === null || n.lastActivityAt > p.lastActivityAt))
  })
}

function settle(run: ClaudishRun, now: number): ClaudishRun {
  if (run.settledAt !== null) return run
  const done = run.slots.length > 0 && run.slots.every(s => isTerminal(s.state))
  return done ? { ...run, settledAt: now } : run
}

function mergeOk(prev: ClaudishRun, observed: readonly ClaudishSlot[], now: number): ClaudishRun {
  // LOST is terminal and final in the mod: a slot that reappears keeps it.
  const seen = observed.map(s => {
    const p = prev.slots.find(x => x.slot === s.slot)
    return p?.state === 'LOST' ? p : s
  })
  // A slot the answer no longer lists keeps what it last showed, until the missing bound.
  const kept = prev.slots.filter(p => !seen.some(s => s.slot === p.slot))
  let slots = [...seen, ...kept]

  // One clock per slot whose state cannot be read: an unknown state word, or a live slot
  // its still-listed run stopped listing (else it would show running forever).
  const unknownSince: Record<string, number> = {}
  let lostReason = prev.lostReason
  slots = slots.map(s => {
    const missing = kept.includes(s) && !isTerminal(s.state)
    if (s.state !== 'UNKNOWN' && !missing) return s
    const since = prev.unknownSince[s.slot] ?? now
    if (now - since >= (missing ? MISSING_LOST_MS : UNKNOWN_LOST_MS)) {
      lostReason = lostReason ?? (missing ? 'slot missing' : 'unknown state')
      return lostSlot(s)
    }
    unknownSince[s.slot] = since
    return s
  })

  const run: ClaudishRun = {
    ...prev,
    slots,
    unknownSince,
    lostReason,
    missedPolls: 0,
    missingSince: null,
    unreachableSince: null,
    activityAt: isActivity(prev.slots, slots) ? now : prev.activityAt,
    waits: prev.ref.kind === 'delegation' ? nextWaits(prev.waits, slots) : prev.waits,
  }
  return settle(run, now)
}

/**
 * The next record of one run from what this tick observed. Returns `prev` itself when
 * no persisted field changed, so an unchanged tick writes nothing.
 */
export function mergeRun(prev: ClaudishRun, observed: RunObservation, now: number): ClaudishRun {
  if (prev.settledAt !== null) return prev
  let next: ClaudishRun
  switch (observed.kind) {
    case 'ok':
      next = mergeOk(prev, observed.slots, now)
      break
    case 'missing': {
      const missedPolls = prev.missedPolls + 1
      const missingSince = prev.missingSince ?? now
      next = { ...prev, missedPolls, missingSince }
      if (missedPolls >= MISSING_LOST_POLLS && now - missingSince >= MISSING_LOST_MS) {
        next = settle(applyLost(next, prev.slots.length === 0 ? 'never listed' : 'vanished'), now)
      }
      break
    }
    case 'unreachable': {
      const unreachableSince = prev.unreachableSince ?? now
      next = { ...prev, unreachableSince }
      if (now - unreachableSince >= UNREACHABLE_LOST_MS) next = settle(applyLost(next, 'unreachable'), now)
      break
    }
    case 'withdrawn':
      next = settle(applyLost(prev, 'contract withdrawn'), now)
      break
    default:
      return assertNever(observed)
  }
  return sameData(prev, next) ? prev : next
}

export function assertNever(x: never): never {
  throw new Error(`unexpected value: ${JSON.stringify(x)}`)
}

// ── wake units ────────────────────────────────────────────────────────────────

/** held: the change is one claudish's session monitor reports too (wake.ts decides, per run) */
export type WakeUnit = { key: string; state: ClaudishSlotState; held?: boolean }

function waitEntryState(w: ClaudishWait, n: number): ClaudishSlotState {
  const state = n === w.entries && w.sig !== null ? w.sig.slice(0, w.sig.indexOf('|')) : ''
  return state === 'AWAITING_PERMISSION' ? 'AWAITING_PERMISSION' : 'AWAITING_INPUT'
}

/**
 * Every wake unit the given (drawn) runs owe: the terminal key of each terminal slot, and
 * the key of every wait entry 1..entries of each slot whatever it is doing now. The ledger
 * decides which are new; this only lists them, so an entry a throwing tick never noticed is
 * listed again on the next.
 */
export function wakeUnits(runs: readonly ClaudishRun[]): WakeUnit[] {
  const out: WakeUnit[] = []
  for (const run of runs) {
    for (const [slot, w] of Object.entries(run.waits)) {
      for (let n = 1; n <= w.entries; n++) out.push({ key: waitKey(run.id, slot, n), state: waitEntryState(w, n) })
    }
    for (const s of run.slots) if (isTerminal(s.state)) out.push({ key: slotKey(run.id, s.slot), state: s.state })
  }
  return out
}

/** The person's Stop provenance on one slot, set or removed; the same value when nothing changes. */
export function withPersonStop(runs: ClaudishRuns, id: string, slot: string, on: boolean): ClaudishRuns {
  let changed = false
  const list = runs.list.map(r => {
    if (r.id !== id || r.personStops.includes(slot) === on) return r
    changed = true
    return { ...r, personStops: on ? [...r.personStops, slot] : r.personStops.filter(s => s !== slot) }
  })
  return changed ? { ...runs, list } : runs
}

// ── stop requests ─────────────────────────────────────────────────────────────

/**
 * Drops each stop request whose run is gone or whose slot is terminal, and each `sent`
 * one answered more than STOP_SENT_TIMEOUT_MS ago while its slot is still live (those are
 * returned, so the caller can say so). A `sending` one is never timed out: its cancel has
 * not answered, and Claude Code's own permission question may still be open.
 */
export function pruneStops(
  stops: Readonly<Record<string, ClaudishStopRequest>>,
  runs: ClaudishRuns,
  now: number,
): readonly [Record<string, ClaudishStopRequest>, string[]] {
  const next: Record<string, ClaudishStopRequest> = {}
  const timedOut: string[] = []
  let changed = false
  for (const [key, req] of Object.entries(stops)) {
    const cut = key.indexOf('/')
    const run = runs.list.find(r => r.id === key.slice(0, cut))
    const slot = run?.slots.find(s => s.slot === key.slice(cut + 1))
    if (!run || cut < 0 || (slot && isTerminal(slot.state))) {
      changed = true
      continue
    }
    if (req.kind === 'sent' && now - req.at > STOP_SENT_TIMEOUT_MS) {
      timedOut.push(key)
      changed = true
      continue
    }
    next[key] = req
  }
  return [changed ? next : (stops as Record<string, ClaudishStopRequest>), timedOut] as const
}

// ── compaction ────────────────────────────────────────────────────────────────

export type Compaction = { drop: ReadonlySet<string>; added: ClaudishEarlier }

/**
 * Past RUNS_CAP runs, the oldest settled runs whose ledger entries are all delivered
 * fold into the `earlier` counters (`added` is what to add). A run with any undelivered
 * entry is never compacted. `starts` is never touched, so a later start never reuses a
 * generation already shown.
 */
export function compaction(runs: ClaudishRuns, ledger: ClaudishLedger): Compaction | null {
  const excess = runs.list.length - RUNS_CAP
  if (excess <= 0) return null
  const drop = new Set<string>()
  const added: ClaudishEarlier = { runs: 0, done: 0, failed: 0, stopped: 0 }
  for (const run of runs.list) {
    if (drop.size >= excess) break
    if (run.settledAt === null) continue
    const prefix = `${run.id}/`
    const owed = Object.entries(ledger.entries).some(([k, e]) => k.startsWith(prefix) && e.kind !== 'delivered')
    if (owed) continue
    drop.add(run.id)
    added.runs += 1
    for (const s of run.slots) {
      if (s.state === 'COMPLETED') added.done += 1
      else if (s.state === 'CANCELLED') added.stopped += 1
      else added.failed += 1
    }
  }
  return drop.size === 0 ? null : { drop, added }
}

export function withoutRuns(runs: ClaudishRuns, drop: ReadonlySet<string>): ClaudishRuns {
  return { ...runs, list: runs.list.filter(r => !drop.has(r.id)) }
}

export function withoutLedgerKeys(ledger: ClaudishLedger, drop: ReadonlySet<string>): ClaudishLedger {
  const entries: ClaudishLedger['entries'] = {}
  for (const [k, e] of Object.entries(ledger.entries)) {
    if (!drop.has(k.slice(0, k.indexOf('/')))) entries[k] = e
  }
  return { ...ledger, entries }
}
