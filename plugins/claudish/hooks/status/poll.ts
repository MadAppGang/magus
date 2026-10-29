// The tool.call observer and the poll loop: handshake, cadence, backoff, feed support,
// the run merge, the hand-off to the wake, stop-request pruning, compaction and captures.
// Takes a Host only. Hands the allowance loop (allowance-poll.ts) the two things only this loop
// sees: the server name of the model's own claudish call, and a list answer announcing the report.
// Names no claudish tool or field: the adapter behind host.source speaks claudish.

import type { Frozen, Next, SessionEndInput, ToolCallInput, ToolCallResult } from 'claude-code'
import type { ClaudishFeedSupport, ClaudishPaneView, ClaudishRun, ClaudishRuns } from '../../types'
import {
  FINAL_GRACE_MS,
  NO_CAPTURE_NOTE,
  NO_SCREEN_NOTE,
  SHOW_PANE_ID,
  compaction,
  feedKey,
  isTerminal,
  paneId,
  mergeRun,
  newRun,
  pruneStops,
  runId,
  sameData,
  withoutLedgerKeys,
  withoutRuns,
  type RunObservation,
} from './domain'
import * as allowancePoll from './allowance-poll'
import { serverOfTool } from './claudish-source'
import type { Host } from './host'
import { activeTab, showTabs } from './layout'
import type { FeedAnswer, PollBatch, ResizeResult } from './run-source'
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
/** A tab of a closed panel is captured at most this often, and once more when its slot ends. */
export const CLOSED_CAPTURE_MS = 10_000

// ── module state: dies with a hot reload, which session.start restarts ───────

type Phase = 'idle' | 'scheduled' | 'running'
/** gen: the number of the one scheduled tick that may run; an earlier one fires as a no-op. */
const loop: { phase: Phase; rerun: boolean; failures: number; gen: number } = { phase: 'idle', rerun: false, failures: 0, gen: 0 }
/** pane id → last capture attempt, whatever its answer. Not drawn, so not in state. */
const lastAttemptAt = new Map<string, number>()
/** pane id → the first tick that found its slot terminal. */
const terminalSeenAt = new Map<string, number>()
/** tick failure messages already logged once. */
const loggedFailures = new Set<string>()
/** The size the Show panel last drew a tab's child at, from its render; null before the first. */
let panelSize: Size | null = null
/** pane id → the size its child was last given (or refused). Asked again only when the panel's size moves. */
const askedSize = new Map<string, Size>()
/** pane ids whose resize answer is still out. Another capture pass skips them: the pass that sent the
 *  resize captures the tab once the answer is back, so no capture shows the size before it. */
const resizing = new Set<string>()

type Size = { cols: number; rows: number }
const sameSize = (a: Size | null | undefined, b: Size | null | undefined): boolean =>
  !!a && !!b && a.cols === b.cols && a.rows === b.rows

/** A resize answer later than this counts as failed, so a call that never answers cannot hold its tab. */
export const RESIZE_TIMEOUT_MS = 5_000
/** After a new panel size, the shown tab is captured again this long after, to catch its redraw. */
export const SETTLE_CAPTURE_MS: readonly number[] = [250, 750]
/** Sizes asked for in one capture of a tab, so a panel dragged without pause still gets captured. */
const RESIZE_ROUNDS = 3

/** One resize, never rejecting and never longer than RESIZE_TIMEOUT_MS: either becomes a failed answer. */
function resizeBounded(host: Host, ref: ClaudishRun['ref'], slot: string, size: Size): Promise<ResizeResult> {
  return new Promise(resolve => {
    const timer = host.after(RESIZE_TIMEOUT_MS, () => resolve({ kind: 'failed', reason: 'no answer' }))
    host.source.resize(ref, slot, size.cols, size.rows).then(
      r => { timer.cancel(); resolve(r) },
      (e: unknown) => { timer.cancel(); resolve({ kind: 'failed', reason: e instanceof Error ? e.message : String(e) }) },
    )
  })
}

/**
 * Resizes one session to the panel's size, once per size whatever the answer. The panel can move
 * again while an answer is out (a drag), so it asks for the newest size before returning.
 */
async function fitToPanel(host: Host, id: string, ref: ClaudishRun['ref'], slot: string): Promise<void> {
  for (let round = 0; round < RESIZE_ROUNDS; round++) {
    const size = panelSize
    if (!size || sameSize(askedSize.get(id), size)) return
    askedSize.set(id, size) // a refusal is not retried until the size moves
    resizing.add(id)
    const rs = await resizeBounded(host, ref, slot, size).finally(() => resizing.delete(id))
    if (rs.kind === 'failed') host.debug(`claudish Show resize to ${size.cols}x${size.rows} failed: ${rs.reason}`)
  }
}

/**
 * Every running session takes the panel's last size, shown or not and panel open or not, so a
 * session that ends before anyone opens it was already drawing at that size: an ended screen can
 * no longer redraw. The size is the session's, so a session forgets it only when it is no longer
 * running.
 */
async function fitLive(host: Host, runs: ClaudishRuns, feeds: Readonly<Record<string, ClaudishFeedSupport>>): Promise<void> {
  const live = new Set<string>()
  const fits: Promise<void>[] = []
  for (const run of runs.list) {
    const support = feeds[feedKey(run.ref)]
    for (const slot of run.slots) {
      if (slot.slot === '*' || isTerminal(slot.state)) continue
      const id = paneId(run.id, slot.slot)
      live.add(id)
      // A run whose server is not answering would only spend the 5 s bound; it is asked once it answers.
      if (run.settledAt !== null || run.unreachableSince !== null) continue
      if (support?.kind !== 'speaks' || !support.can.resize || resizing.has(id)) continue
      fits.push(fitToPanel(host, id, run.ref, slot.slot))
    }
  }
  // All at once: one slow answer must not hold the tick's captures behind every other session.
  await Promise.all(fits)
  for (const id of [...askedSize.keys()]) if (!live.has(id)) askedSize.delete(id)
}

/**
 * The Show panel's render reports the size its tabs' children are drawn at. A new size captures the
 * shown tab now (resizing its child first), not at the loop's next tick, which can be a back-off
 * away. Hidden tabs take the new size at their own next capture.
 */
export function notePanelSize(host: Host, size: Size, shownId: string | null): void {
  if (sameSize(panelSize, size)) return
  panelSize = size
  if (shownId === null) return ensureLoop(host)
  void captureOpened(host, shownId)
  // The session redraws a moment after its resize answer, so the capture right after can still
  // show the old drawing; these catch the redraw instead of the next tick, a second or two later.
  for (const ms of SETTLE_CAPTURE_MS) host.after(ms, () => void captureOpened(host, shownId, false))
}

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
    // The model reached claudish under this name: the allowance loop may ask there before it resolves one.
    allowancePoll.noteServer(serverOfTool(String(e.tool)))
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
function schedule(host: Host, ms: number): void {
  const gen = ++loop.gen
  loop.phase = 'scheduled'
  host.after(ms, () => {
    if (gen === loop.gen) void tick(host)
  })
}

export function ensureLoop(host: Host): void {
  switch (loop.phase) {
    case 'idle':
    case 'scheduled': // the pending tick can be a quiet one, seconds away: run now, and it fires as a no-op
      schedule(host, 0)
      return
    case 'running':
      loop.rerun = true
      return
  }
}

/**
 * A tab Show (or a tab press) just made active: its first screen is captured now, not at the
 * loop's next tick, which can be a whole poll interval away while one is already scheduled.
 * Then the loop carries on. `kick` false (a settle capture after a resize) leaves the loop as it is:
 * it is not a press, so it must not run a tick of its own (R11.3).
 */
export async function captureOpened(host: Host, id: string, kick = true): Promise<void> {
  try {
    if (await panelOpen(host)) await captures(host, [{ id, inPanel: true, isShown: true }], await host.store.runs.read(), await host.store.feeds.read(), await host.now(), false)
  } catch (err) {
    host.debug(`claudish Show capture failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (kick) ensureLoop(host)
}

async function panelOpen(host: Host): Promise<boolean> {
  return (await host.panes()).some(p => p.id === SHOW_PANE_ID && p.isPlaced)
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
  let open: TabRef[] = []
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
    // A list answer announcing the allowance report: a claudish upgraded under this session. Only a
    // trigger: the allowance loop probes again if it had found the report unsupported.
    if ([...batch.feeds.values()].some(a => a.kind === 'speaks' && a.can.allowance === true)) allowancePoll.reprobe(host)

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

    await fitLive(host, runsNow, feedsNow)
    open = await syncTabs(host, runsNow, feedsNow)
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
      schedule(host, delay(watchedNow, tabs.shownLive, now))
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


/** A tab the capture pass visits: its id (its view's member id), whether the panel is open, and whether it shows the tab. */
type TabRef = { id: string; inPanel: boolean; isShown: boolean }

/** Tab ids this load has given a view, so a tab whose run left the band has its view cleared. */
const seeded = new Set<string>()

/**
 * The panel's tabs follow the runs the band shows: every slot gets a view (`waiting`) as soon as
 * it is listed, so its tab is there before anyone presses Show, and a tab whose run left the band
 * loses its view. Returns every tab to capture, the panel open or not: a closed panel's tabs are
 * captured at the closed rate, so Show opens on a screen already held and a slot that ends while
 * the panel is closed keeps its last screen. A tab is shown only while the panel is open (the one
 * last picked, else the first).
 */
async function syncTabs(host: Host, runs: ClaudishRuns, feeds: Readonly<Record<string, ClaudishFeedSupport>>): Promise<TabRef[]> {
  const tabs = showTabs(runs, feeds)
  const ids = new Set(tabs.map(t => t.id))
  for (const id of [...seeded]) {
    if (ids.has(id)) continue
    seeded.delete(id)
    await host.store.panes.update(id, () => null)
  }
  for (const t of tabs) {
    if (seeded.has(t.id)) continue
    seeded.add(t.id)
    const { runId, slot, model } = t.target
    await host.store.panes.update(t.id, v => v ?? { runId, slot, model, status: 'waiting', frame: null, note: null })
  }
  const inPanel = await panelOpen(host)
  const active = inPanel ? activeTab(tabs, (await host.store.showTab.read()).active) : null
  return tabs.map(t => ({ id: t.id, inPanel, isShown: t.id === active?.id }))
}

// ── captures: the panel's tabs, open or closed ───────────────────────────────────────────────

type TabsOutcome = { shownLive: boolean; capturing: number }

/**
 * Captures every open tab that is due (architecture §3.4, "Captures"). Returns whether
 * a shown tab is live, and how many open tabs can still produce frames: those keep the
 * loop alive; an ended tab, or one whose feed offers no capture, costs nothing.
 */
async function captures(
  host: Host,
  open: readonly TabRef[],
  runs: ClaudishRuns,
  feeds: Readonly<Record<string, ClaudishFeedSupport>>,
  now: number,
  everyTab = true,
): Promise<TabsOutcome> {
  const out: TabsOutcome = { shownLive: false, capturing: 0 }
  // A tab closed before its run ended leaves its bookkeeping behind: drop it with the tab. Only a
  // pass over every open tab knows which are closed.
  if (everyTab) {
    const openIds = new Set(open.map(p => p.id))
    for (const id of [...lastAttemptAt.keys()]) if (!openIds.has(id)) lastAttemptAt.delete(id)
    for (const id of [...terminalSeenAt.keys()]) if (!openIds.has(id)) terminalSeenAt.delete(id)
  }
  const end = (v: ClaudishPaneView | null): ClaudishPaneView | null =>
    v ? { ...v, status: 'ended', note: v.frame ? null : NO_SCREEN_NOTE } : v
  for (const p of open) {
    const view = await host.store.panes.read(p.id)
    // An ended tab with no screen is asked once more when it is opened: claudish keeps a closed
    // pane's last screen, so the answer is that screen, not a guess that none exists.
    const retry = !everyTab && view?.status === 'ended' && view.frame === null
    if (!view || (view.status === 'ended' && !retry)) {
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
    if (retry) {
      // One shot: a screen is stored, anything else leaves the tab ended as it was.
      const r = await host.source.capture(run.ref, view.slot, 0, support.can.spans)
      if (r.kind === 'frame') await host.store.panes.update(p.id, v => (v ? { ...v, frame: r.frame, note: null } : v))
      continue
    }
    out.capturing += 1
    if (p.isShown) out.shownLive = true
    const slot = run.slots.find(s => s.slot === view.slot)
    const justEnded = slot !== undefined && isTerminal(slot.state) && !terminalSeenAt.has(p.id)
    if (justEnded) terminalSeenAt.set(p.id, now)
    const seenAt = terminalSeenAt.get(p.id)
    const graceOver = seenAt !== undefined && now - seenAt >= FINAL_GRACE_MS
    const last = lastAttemptAt.get(p.id)
    // The tick that first finds the slot ended asks for its final screen whatever the rate.
    const due = last === undefined || justEnded
      || (view.status === 'unavailable' ? now - last >= UNAVAILABLE_RETRY_MS
        : p.isShown || now - last >= (p.inPanel ? HIDDEN_CAPTURE_MS : CLOSED_CAPTURE_MS))
    if (!due || resizing.has(p.id)) continue
    lastAttemptAt.set(p.id, now)
    // Fit the child to the panel before reading its screen, so this capture already shows it reflowed.
    // A finished slot is left as it is: its pane no longer redraws.
    if (support.can.resize && !(slot && isTerminal(slot.state))) await fitToPanel(host, p.id, run.ref, view.slot)
    const r = await host.source.capture(run.ref, view.slot, view.frame?.seq ?? 0, support.can.spans)
    let ended = false
    switch (r.kind) {
      case 'frame':
        // A finished slot whose pane keeps redrawing still ends at the grace: nothing else would stop it.
        ended = r.final || graceOver
        await host.store.panes.update(p.id, v => (v ? { ...v, status: ended ? 'ended' : 'live', frame: r.frame, note: null } : v))
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
