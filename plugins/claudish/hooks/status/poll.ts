// The tool.call observer and the poll loop: handshake, cadence, backoff, feed support,
// the run merge, the hand-off to the wake, stop-request pruning, compaction and captures.
// Takes a Host only.
// Names no claudish tool or field: the adapter behind host.source speaks claudish.

import type { Frozen, Next, SessionEndInput, ToolCallInput, ToolCallResult, UiPane } from 'claude-code'
import type { ClaudishFeedSupport, ClaudishPaneView, ClaudishRun, ClaudishRuns } from '../../types'
import {
  FINAL_GRACE_MS,
  NO_CAPTURE_NOTE,
  NO_SCREEN_NOTE,
  PANE_ID_PATTERN,
  compaction,
  feedKey,
  isTerminal,
  mergeRun,
  newRun,
  pruneStops,
  runId,
  sameData,
  withoutLedgerKeys,
  withoutRuns,
  type RunObservation,
} from './domain'
import type { Host } from './host'
import type { FeedAnswer, PollBatch } from './run-source'
import * as wake from './wake'

// ── cadence ───────────────────────────────────────────────────────────────────

export const ACTIVE_MS = 1_000
export const QUIET_MS = 3_000
/** No activity change for this long and no shown live tab: the quiet cadence. */
export const QUIET_AFTER_MS = 30_000
export const BACKOFF_MAX_MS = 30_000
/** A feed that never spoke goes silent after this many bad answers. */
export const PROBE_STRIKES = 3
/** A speaking feed is withdrawn after this many declarations with no `speaks` between. */
export const WITHDRAW_DECLARATIONS = 3
/** A tick that threw is retried, with back-off, this many times in a row before the loop rests. */
export const TICK_RETRIES = 8
/** A hidden tab is captured at most this often; an unavailable one, at most this often. */
export const HIDDEN_CAPTURE_MS = 5_000
export const UNAVAILABLE_RETRY_MS = 10_000

// ── module state: dies with a hot reload, which session.start restarts ───────

type Phase = 'idle' | 'scheduled' | 'running'
const loop: { phase: Phase; rerun: boolean; failures: number } = { phase: 'idle', rerun: false, failures: 0 }
/** pane id → last capture attempt, whatever its answer. Not drawn, so not in state. */
const lastAttemptAt = new Map<string, number>()
/** pane id → the first tick that found its slot terminal. */
const terminalSeenAt = new Map<string, number>()
/** tick failure messages already logged once. */
const loggedFailures = new Set<string>()

// ── session boundaries ────────────────────────────────────────────────────────

/** session.end with clear or resume ends the conversation: a new epoch forgets its runs. */
export async function onSessionEnd(
  host: Host,
  e: Frozen<SessionEndInput>,
  next: Next<'session.end'>,
): Promise<{ sessionId: string }> {
  if (e.reason === 'clear' || e.reason === 'resume') {
    await host.store.runs.update(v => ({ epoch: v.epoch + 1, starts: {}, list: [] }))
    await host.store.ledger.update(l => ({ epoch: l.epoch + 1, entries: {} }))
    await host.store.stopRequests.update(() => ({}))
    await host.store.earlier.update(() => ({ runs: 0, done: 0, failed: 0, stopped: 0 }))
    await host.store.turn.update(() => ({ isRunning: false, since: 0 }))
  }
  return next(e)
}

// ── the observer ──────────────────────────────────────────────────────────────

const RESERVED = new Set(['tool', 'tool_use_id', 'agentId'])

function argsOf(e: Frozen<ToolCallInput>): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) if (!RESERVED.has(k)) args[k] = v
  return args
}

/** tool.call on a claudish tool: run it unchanged, then watch a start it answered. */
export async function onClaudishCall(
  host: Host,
  e: Frozen<ToolCallInput>,
  next: Next<'tool.call'>,
): Promise<ToolCallResult> {
  const epoch = (await host.store.runs.read()).epoch
  const ran = await next(e)
  try {
    if (ran.deny !== undefined) return ran
    const seen = host.source.recognizeCall({
      tool: String(e.tool),
      args: argsOf(e),
      answer: { text: typeof ran.text === 'string' ? ran.text : null, isError: ran.isError === true },
    })
    switch (seen.kind) {
      case 'unidentified':
        host.debug(`claudish start not watched: ${seen.reason}`)
        break
      case 'precontract': {
        const key = feedKey({ server: seen.server, kind: seen.runKind })
        const now = await host.now()
        const [, moved] = await host.store.feeds.claim(f => {
          const was = f[key]
          if (was !== undefined && was.kind !== 'probing') return [f, false] as const
          const support: ClaudishFeedSupport = { kind: 'unsupported', reason: seen.reason, at: now, spoke: false }
          return [{ ...f, [key]: support }, true] as const
        })
        if (moved) host.debug(`claudish ${key}: pre-contract server, not watched (${seen.reason})`)
        break
      }
      case 'start': {
        const id = runId(seen.ref)
        const now = await host.now()
        // A start answer in the contract is the server speaking it now: a feed given up on earlier
        // (failed probes, a withdrawal, a server since restarted or upgraded) is probed again.
        const key = feedKey(seen.ref)
        const [, reopened] = await host.store.feeds.claim(f => {
          if (f[key]?.kind !== 'unsupported') return [f, false] as const
          return [{ ...f, [key]: { kind: 'probing', strikes: 0 } }, true] as const
        })
        if (reopened) host.debug(`claudish ${key}: a contract start answer, watched again`)
        await host.store.runs.update(v => {
          if (v.epoch !== epoch || v.list.some(r => r.id === id)) return v
          const before = v.starts[seen.ref.address] ?? 0
          const run = newRun({ id, ref: seen.ref, label: seen.label, epoch, generation: before + 1, now })
          return { ...v, starts: { ...v.starts, [seen.ref.address]: before + 1 }, list: [...v.list, run] }
        })
        ensureLoop(host)
        break
      }
      case 'other':
        break
    }
  } catch (err) {
    host.debug(`claudish observer failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return ran
}

// ── feed support policy ───────────────────────────────────────────────────────

type SupportOutcome = { withdrawn: Set<string>; logs: string[] }

/** The core's policy over the adapter's facts, per feed key (architecture §3.4). */
export function applySupport(
  feeds: Readonly<Record<string, ClaudishFeedSupport>>,
  answers: ReadonlyMap<string, FeedAnswer>,
  now: number,
): readonly [Record<string, ClaudishFeedSupport>, SupportOutcome] {
  const next: Record<string, ClaudishFeedSupport> = { ...feeds }
  const out: SupportOutcome = { withdrawn: new Set(), logs: [] }
  for (const [key, answer] of answers) {
    const was: ClaudishFeedSupport = feeds[key] ?? { kind: 'probing', strikes: 0 }
    if (was.kind === 'unsupported') continue
    const reason = 'reason' in answer ? answer.reason : 'code' in answer ? `refused: ${answer.code}` : ''
    if (answer.kind === 'speaks') {
      next[key] = { kind: 'speaks', version: answer.version, can: answer.can, declined: 0 }
      continue
    }
    const declares = answer.kind === 'precontract' || answer.kind === 'declines'
    if (was.kind === 'probing') {
      const strikes = was.strikes + 1
      if (declares || strikes >= PROBE_STRIKES) {
        next[key] = { kind: 'unsupported', reason, at: now, spoke: false }
        out.logs.push(`claudish ${key}: not watched (${answer.kind}: ${reason})`)
      } else {
        next[key] = { kind: 'probing', strikes }
      }
      continue
    }
    // was speaks: a bad answer is a transmission fact; only repeated declarations withdraw it.
    if (!declares) continue
    const declined = was.declined + 1
    if (declined >= WITHDRAW_DECLARATIONS) {
      next[key] = { kind: 'unsupported', reason: `contract withdrawn (${reason})`, at: now, spoke: true }
      out.withdrawn.add(key)
      out.logs.push(`claudish ${key}: contract withdrawn (${reason}); its live slots end LOST`)
    } else {
      next[key] = { ...was, declined }
    }
  }
  return [sameData(feeds, next) ? (feeds as Record<string, ClaudishFeedSupport>) : next, out] as const
}

/** Every run of this tick's merge, from the batch and the feeds as just updated. */
export function mergeAll(
  runs: ClaudishRuns,
  batch: PollBatch,
  feeds: Readonly<Record<string, ClaudishFeedSupport>>,
  withdrawn: ReadonlySet<string>,
  now: number,
): ClaudishRuns {
  let changed = false
  const list = runs.list.map(run => {
    if (run.settledAt !== null) return run
    const key = feedKey(run.ref)
    let observed: RunObservation | null = null
    if (withdrawn.has(key)) observed = { kind: 'withdrawn' }
    else if (batch.feeds.has(key) && feeds[key]?.kind === 'speaks') {
      const result = batch.runs.get(run.id)
      // A speaking feed answers every run it was asked about: no result means the run started
      // after this tick's poll went out, so it is not observed until the next tick.
      if (batch.feeds.get(key)?.kind !== 'speaks') observed = { kind: 'unreachable' }
      else if (result) observed = result.kind === 'ok' ? { kind: 'ok', slots: result.slots } : { kind: 'missing' }
    }
    if (!observed) return run
    const merged = mergeRun(run, observed, now)
    if (merged !== run) changed = true
    return merged
  })
  return changed ? { ...runs, list } : runs
}

// ── the loop ──────────────────────────────────────────────────────────────────

/** From session.start, the observer's start branch, and Show. */
export function ensureLoop(host: Host): void {
  switch (loop.phase) {
    case 'idle':
      loop.phase = 'scheduled'
      host.after(0, () => void tick(host))
      return
    case 'scheduled':
      return
    case 'running':
      loop.rerun = true
      return
  }
}

function isWatched(run: ClaudishRun, feeds: Readonly<Record<string, ClaudishFeedSupport>>): boolean {
  return run.settledAt === null && feeds[feedKey(run.ref)]?.kind !== 'unsupported'
}

function delay(watched: readonly ClaudishRun[], shownLive: boolean, now: number): number {
  if (loop.failures > 0) return Math.min(ACTIVE_MS * 2 ** loop.failures, BACKOFF_MAX_MS)
  if (loop.rerun) return ACTIVE_MS // something new arrived while this tick ran (a start, a Show)
  const lastActivity = watched.reduce((m, r) => Math.max(m, r.activityAt), -Infinity)
  return shownLive || now - lastActivity < QUIET_AFTER_MS ? ACTIVE_MS : QUIET_MS
}

const EMPTY_BATCH: PollBatch = { feeds: new Map(), runs: new Map() }
const BAD_ANSWERS: ReadonlySet<FeedAnswer['kind']> = new Set(['refused', 'unanswered', 'garbled'])

/** One tick: poll, support, merge, prune, compact, capture; then decide the next tick. */
export async function tick(host: Host): Promise<void> {
  loop.phase = 'running'
  loop.rerun = false
  let open: UiPane[] = []
  let runsNow: ClaudishRuns | null = null
  let feedsNow: Record<string, ClaudishFeedSupport> = {}
  let now = 0
  let tabs: TabsOutcome = { shownLive: false, capturing: 0 }
  let threw = false
  try {
    now = await host.now()
    runsNow = await host.store.runs.read()
    const epoch = runsNow.epoch
    feedsNow = await host.store.feeds.read()
    const feeds0 = feedsNow
    const watched = runsNow.list.filter(r => isWatched(r, feeds0))
    const batch = watched.length > 0 ? await host.source.poll(watched.map(r => ({ id: r.id, ref: r.ref }))) : EMPTY_BATCH

    const at = now
    const [feedsWritten, support] = await host.store.feeds.claim(f => applySupport(f, batch.feeds, at))
    feedsNow = feedsWritten
    for (const line of support.logs) host.debug(line)

    const before = runsNow
    const feedsAfter = feedsNow
    if (mergeAll(runsNow, batch, feedsAfter, support.withdrawn, now) !== runsNow) {
      runsNow = await host.store.runs.update(v => (v.epoch !== epoch ? v : mergeAll(v, batch, feedsAfter, support.withdrawn, at)))
    }
    if (runsNow.epoch !== epoch) return // a /clear or resume landed mid-tick: drop this tick's work
    for (const run of runsNow.list) {
      const was = before.list.find(r => r.id === run.id)
      if (run.unreachableSince !== null && was && was.unreachableSince === null) {
        host.debug(`claudish run ${run.label}: ${feedKey(run.ref)} is not answering; its rows show unknown`)
      }
    }
    // This tick's terminal transitions and wait entries: the ledger keeps each one owed until delivered.
    await wake.notice(host, epoch, runsNow, feedsNow)

    const settledRuns = runsNow
    const [, timedOut] = await host.store.stopRequests.claim(m => pruneStops(m, settledRuns, at))
    for (const key of timedOut) host.toast(`Stop not confirmed for ${key.slice(key.indexOf('/') + 1)}; press Stop again`)

    runsNow = await compact(host, runsNow, epoch)

    open = (await host.panes()).filter(p => PANE_ID_PATTERN.test(p.id))
    tabs = await captures(host, open, runsNow, feedsNow, now)

    const polled = [...batch.feeds.values()]
    loop.failures = polled.length > 0 && polled.every(a => BAD_ANSWERS.has(a.kind)) ? loop.failures + 1 : 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!loggedFailures.has(message)) {
      loggedFailures.add(message)
      host.debug(`claudish poll tick failed: ${message}`)
    }
    loop.failures += 1
    threw = true
  } finally {
    // Every value combined here was awaited above; nothing is awaited between here and the decision.
    const watchedNow = runsNow ? runsNow.list.filter(r => isWatched(r, feedsNow)) : []
    const keepGoing = loop.rerun
      || runsNow === null
      || watchedNow.length > 0
      || tabs.capturing > 0                                   // an open tab whose run can still produce frames
      || (threw && loop.failures <= TICK_RETRIES)             // a throw can land after the last merge, before its wake is owed
    if (!keepGoing) {
      loop.phase = 'idle'
    } else {
      loop.phase = 'scheduled'
      host.after(delay(watchedNow, tabs.shownLive, now), () => void tick(host))
    }
  }
}

async function compact(host: Host, runs: ClaudishRuns, epoch: number): Promise<ClaudishRuns> {
  const plan = compaction(runs, await host.store.ledger.read())
  if (!plan) return runs
  const written = await host.store.runs.update(v => (v.epoch !== epoch ? v : withoutRuns(v, plan.drop)))
  if (written.epoch !== epoch) return written
  const d = plan.added
  await host.store.earlier.update(e => ({ runs: e.runs + d.runs, done: e.done + d.done, failed: e.failed + d.failed, stopped: e.stopped + d.stopped }))
  await host.store.ledger.update(l => (l.epoch !== epoch ? l : withoutLedgerKeys(l, plan.drop)))
  return written
}


// ── captures: open Show tabs only ─────────────────────────────────────────────

type TabsOutcome = { shownLive: boolean; capturing: number }

/**
 * Captures every open tab that is due (architecture §3.4, "Captures"). Returns whether
 * a shown tab is live, and how many open tabs can still produce frames: those keep the
 * loop alive; an ended tab, or one whose feed offers no capture, costs nothing.
 */
async function captures(
  host: Host,
  open: readonly UiPane[],
  runs: ClaudishRuns,
  feeds: Readonly<Record<string, ClaudishFeedSupport>>,
  now: number,
): Promise<TabsOutcome> {
  const out: TabsOutcome = { shownLive: false, capturing: 0 }
  // A tab closed before its run ended leaves its bookkeeping behind: drop it with the tab.
  const openIds = new Set(open.map(p => p.id))
  for (const id of [...lastAttemptAt.keys()]) if (!openIds.has(id)) lastAttemptAt.delete(id)
  for (const id of [...terminalSeenAt.keys()]) if (!openIds.has(id)) terminalSeenAt.delete(id)
  const end = (v: ClaudishPaneView | null): ClaudishPaneView | null =>
    v ? { ...v, status: 'ended', note: v.frame ? null : NO_SCREEN_NOTE } : v
  for (const p of open) {
    const view = await host.store.panes.read(p.id)
    if (!view || view.status === 'ended') {
      lastAttemptAt.delete(p.id)
      terminalSeenAt.delete(p.id)
      continue
    }
    const run = runs.list.find(r => r.id === view.runId)
    if (!run) {
      await host.store.panes.update(p.id, end)
      continue
    }
    const support = feeds[feedKey(run.ref)]
    if (support?.kind !== 'speaks' || !support.can.capture) {
      if (view.status !== 'unavailable' || view.note !== NO_CAPTURE_NOTE) {
        await host.store.panes.update(p.id, v => (v ? { ...v, status: 'unavailable', note: NO_CAPTURE_NOTE } : v))
      }
      continue
    }
    out.capturing += 1
    if (p.isShown) out.shownLive = true
    const slot = run.slots.find(s => s.slot === view.slot)
    if (slot && isTerminal(slot.state) && !terminalSeenAt.has(p.id)) terminalSeenAt.set(p.id, now)
    const seenAt = terminalSeenAt.get(p.id)
    const graceOver = seenAt !== undefined && now - seenAt >= FINAL_GRACE_MS
    const last = lastAttemptAt.get(p.id)
    const due = last === undefined
      || (view.status === 'unavailable' ? now - last >= UNAVAILABLE_RETRY_MS : p.isShown || now - last >= HIDDEN_CAPTURE_MS)
    if (!due) continue
    lastAttemptAt.set(p.id, now)
    const r = await host.source.capture(run.ref, view.slot, view.frame?.seq ?? 0, support.can.spans)
    let ended = false
    switch (r.kind) {
      case 'frame':
        ended = r.final
        await host.store.panes.update(p.id, v => (v ? { ...v, status: r.final ? 'ended' : 'live', frame: r.frame, note: null } : v))
        break
      case 'unchanged':
        if (r.final || graceOver) {
          ended = true
          await host.store.panes.update(p.id, end)
        }
        break
      case 'gone':
        ended = true
        await host.store.panes.update(p.id, end)
        break
      case 'unavailable':
        ended = graceOver
        await host.store.panes.update(p.id, v => (graceOver ? end(v) : v ? { ...v, status: 'unavailable', note: r.reason } : v))
        break
    }
    if (ended) {
      out.capturing -= 1
      lastAttemptAt.delete(p.id)
      terminalSeenAt.delete(p.id)
    }
  }
  return out
}
