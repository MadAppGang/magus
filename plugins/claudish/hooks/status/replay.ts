/**
 * A finished Show tab drawn as its real interface: claudish resumes the session read only in a
 * hidden pane (a replay), and the panel draws that pane through the same capture, resize and scroll
 * calls a live child takes.
 *
 * A replay costs a whole Claude Code process, so one starts only for the tab the visible panel
 * draws. It then stays open while the panel is open, so going back to a tab is instant, and every
 * replay closes when the panel closes, however it closed (Hide, Escape, the forecast panel taking
 * its place, too narrow a terminal). The engine raises no event for that, hence the watcher.
 *
 * The open replays are kept in $.state: a reload forgets this module's variables, and a replay no
 * one remembers would run until claudish exits. The frames go into the tab's own view, where the
 * panel and the scroll code already read them.
 */

import type { ClaudishRunRef } from '../../types'
import { SHOW_PANE_ID, feedKey } from './domain'
import type { Host } from './host'
import { activeTab, showTabs } from './layout'
import { panelSizeNow } from './poll'

/** How often the shown replay is captured just after something happened to it. */
export const REPLAY_CAPTURE_MS = 500
/** How often it is captured once its screen has been still for REPLAY_QUIET_AFTER_MS. */
export const REPLAY_QUIET_CAPTURE_MS = 2_000
export const REPLAY_QUIET_AFTER_MS = 5_000
/** How often the watcher checks that the panel is still drawn. */
export const REPLAY_WATCH_MS = 1_000
/** An open answer later than this counts as failed; a replay that opens after it is closed at once. */
export const REPLAY_OPEN_TIMEOUT_MS = 15_000

export const REPLAY_OPENING_NOTE = 'Opening the session…'
/** A session that ended a moment ago is asked again after this, at most REPLAY_NOT_YET_TRIES times. */
export const REPLAY_NOT_YET_MS = 500
export const REPLAY_NOT_YET_TRIES = 20

type Tab = {
  state: 'opening' | 'open' | 'failed'
  /** how the replay is addressed: as a session, by its replay id; null until it opened */
  ref: ClaudishRunRef | null
  seq: number
  spans: boolean
  size: { cols: number; rows: number } | null
  timer: { cancel(): void } | null
  /** its capture loop runs; a redraw during a capture must not start a second one */
  looping: boolean
  capturing: boolean
  changedAt: number
}

const tabs = new Map<string, Tab>()
let watcher: { cancel(): void } | null = null
/** pane id → how many opens answered not yet, and when the next may go; cleared when the panel closes */
const notYet = new Map<string, { tries: number; until: number }>()
let adopted = false

/** A replay is addressed as a session: its id takes the place of the session id. */
function replayRef(server: string, replayId: string): ClaudishRunRef {
  return { kind: 'delegation', server, token: replayId, address: replayId }
}

/** Whether the tab's screen belongs to a replay, opening or open: the original session has nothing more to give it. */
export function replayHolds(id: string): boolean {
  const state = tabs.get(id)?.state
  return state === 'opening' || state === 'open'
}

/** Whether the tab's replay is on its way, for the panel's note. */
export function replayOpening(id: string): boolean {
  return tabs.get(id)?.state === 'opening'
}

/** Whether the tab has no replay to draw because opening it failed, or it stopped by itself. */
export function replayFailed(id: string): boolean {
  return tabs.get(id)?.state === 'failed'
}

/** The address of the tab's open replay, for the scroll code; null when it has none. */
export function replayTarget(id: string): ClaudishRunRef | null {
  const t = tabs.get(id)
  return t?.state === 'open' ? t.ref : null
}

async function panelPlaced(host: Host): Promise<boolean> {
  return (await host.panes()).some(p => p.id === SHOW_PANE_ID && p.isPlaced)
}

async function shownId(host: Host): Promise<string | null> {
  const list = showTabs(await host.store.runs.read(), await host.store.feeds.read())
  return activeTab(list, (await host.store.showTab.read()).active)?.id ?? null
}

/** The replay cannot be drawn: the panel falls back to the tab's text. rev redraws it. */
async function fail(host: Host, id: string, t: Tab, reason: string): Promise<void> {
  host.debug(`claudish Show replay of ${id} failed: ${reason}`)
  t.timer?.cancel()
  t.timer = null
  t.looping = false
  t.state = 'failed'
  t.ref = null
  await host.store.replays.update(v => {
    const { [id]: _, ...rest } = v
    return rest
  })
  await host.store.textView.update(v => ({ ...v, rev: v.rev + 1 }))
}

/** Reads the replay's screen now, fitting it to the panel first. Never rejects. */
export async function captureReplay(host: Host, id: string): Promise<void> {
  const t = tabs.get(id)
  if (!t || t.state !== 'open' || !t.ref || t.capturing) return
  t.capturing = true
  const ref = t.ref
  try {
    const size = panelSizeNow()
    if (size && (t.size?.cols !== size.cols || t.size?.rows !== size.rows)) {
      t.size = size
      const rs = await host.source.resize(ref, ref.token, size.cols, size.rows)
      if (rs.kind === 'failed') host.debug(`claudish Show replay resize failed: ${rs.reason}`)
    }
    const r = await host.source.capture(ref, ref.token, t.seq, t.spans)
    if (tabs.get(id) !== t) return
    if (r.kind === 'frame') {
      t.seq = r.frame.seq
      t.changedAt = await host.now()
      await host.store.panes.update(id, v => (v ? { ...v, frame: r.frame, note: null } : v))
    }
    if (r.kind === 'gone' || ((r.kind === 'frame' || r.kind === 'unchanged') && r.final)) {
      await fail(host, id, t, 'it stopped')
    }
  } catch (err) {
    host.debug(`claudish Show replay capture failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    t.capturing = false
  }
}

/** Captures the shown replay on a timer. A tab no longer shown stops here; the next draw of it restarts. */
function schedule(host: Host, id: string, t: Tab, ms: number): void {
  t.looping = true
  t.timer = host.after(ms, () => {
    t.timer = null
    void (async () => {
      if (tabs.get(id) !== t || t.state !== 'open' || (await shownId(host)) !== id) {
        t.looping = false
        return
      }
      await captureReplay(host, id)
      if (tabs.get(id) !== t || t.state !== 'open') return
      const quiet = (await host.now()) - t.changedAt >= REPLAY_QUIET_AFTER_MS
      schedule(host, id, t, quiet ? REPLAY_QUIET_CAPTURE_MS : REPLAY_CAPTURE_MS)
    })().catch(err => host.debug(`claudish Show replay tick failed: ${err instanceof Error ? err.message : String(err)}`))
  })
}

function watch(host: Host): void {
  if (watcher) return
  watcher = host.after(REPLAY_WATCH_MS, () => {
    watcher = null
    void (async () => {
      if (tabs.size === 0) return
      if (!(await panelPlaced(host))) return closeAll(host)
      const listed = showTabs(await host.store.runs.read(), await host.store.feeds.read())
      pruneReplays(host, new Set(listed.map(t => t.id)))
      watch(host)
    })().catch(err => host.debug(`claudish Show replay watch failed: ${err instanceof Error ? err.message : String(err)}`))
  })
}

/** Takes up the replays an earlier load left open, so the watcher and a close reach them. */
export async function adopt(host: Host): Promise<void> {
  if (adopted) return
  adopted = true
  const kept = await host.store.replays.read()
  const feeds = await host.store.feeds.read()
  const runs = await host.store.runs.read()
  for (const [id, r] of Object.entries(kept)) {
    if (tabs.has(id)) continue
    const view = await host.store.panes.read(id)
    const run = view ? runs.list.find(x => x.id === view.runId) : undefined
    const support = run ? feeds[feedKey(run.ref)] : undefined
    const spans = support?.kind === 'speaks' && support.can.spans
    // seq 0: the first capture redraws the tab, as this load holds no screen of its own to compare.
    tabs.set(id, { state: 'open', ref: replayRef(r.server, r.replayId), seq: 0, spans, size: null, timer: null, looping: false, capturing: false, changedAt: await host.now() })
  }
  if (tabs.size > 0) watch(host)
}

/**
 * The visible panel draws this finished tab on its screen: opens its replay if it has none, or
 * makes sure the open one is being captured. Called from the panel's draw, so a tab opens only by
 * being looked at. A failed tab is not tried again until the panel has closed.
 */
export function ensureReplay(host: Host, id: string, runRef: ClaudishRunRef, slot: string, spans: boolean): void {
  void (async () => {
    await adopt(host)
    const had = tabs.get(id)
    if (had) {
      if (had.state === 'open' && !had.looping) schedule(host, id, had, 0)
      return
    }
    // The engine can draw a pane it has not placed; a draw alone does not mean the person sees it.
    if (!(await panelPlaced(host)) || tabs.has(id)) return
    const waiting = notYet.get(id)
    if (waiting && (await host.now()) < waiting.until) return
    const size = panelSizeNow()
    const t: Tab = { state: 'opening', ref: null, seq: 0, spans, size, timer: null, looping: false, capturing: false, changedAt: await host.now() }
    if (tabs.has(id)) return
    tabs.set(id, t)
    watch(host)
    await host.store.textView.update(v => ({ ...v, rev: v.rev + 1 })) // the panel's note: it read this tab before it was opening
    const closeLate = (replayId: string) => host.source.replayClose(runRef.server, replayId)
    let timedOut = false
    const r = await new Promise<Awaited<ReturnType<Host['source']['replayOpen']>>>(resolve => {
      const timer = host.after(REPLAY_OPEN_TIMEOUT_MS, () => {
        timedOut = true
        resolve({ kind: 'failed', reason: 'no answer' })
      })
      host.source.replayOpen(runRef, slot, size).then(
        a => {
          timer.cancel()
          // Answered after the bound: nobody is waiting for this replay any more.
          if (timedOut && a.kind === 'opened') void closeLate(a.replayId)
          resolve(a)
        },
        (e: unknown) => {
          timer.cancel()
          resolve({ kind: 'failed', reason: e instanceof Error ? e.message : String(e) })
        },
      )
    })
    // The panel closed while it opened: this replay has no one to draw it.
    if (tabs.get(id) !== t) {
      if (r.kind === 'opened' && !timedOut) await closeLate(r.replayId)
      return
    }
    if (r.kind === 'notYet') {
      const tries = (notYet.get(id)?.tries ?? 0) + 1
      notYet.set(id, { tries, until: (await host.now()) + REPLAY_NOT_YET_MS })
      if (tries >= REPLAY_NOT_YET_TRIES) return fail(host, id, t, 'the session did not let go of its record')
      // Forget this attempt and redraw a moment later: the draw opens it again if the tab is still shown.
      tabs.delete(id)
      host.after(REPLAY_NOT_YET_MS, () => void host.store.textView.update(v => ({ ...v, rev: v.rev + 1 })).catch(() => undefined))
      return
    }
    notYet.delete(id)
    if (r.kind !== 'opened') return fail(host, id, t, r.kind === 'gone' ? 'claudish no longer keeps this session' : r.reason)
    t.state = 'open'
    t.looping = true // before the await: a redraw landing in it must not start the loop as well
    t.ref = replayRef(runRef.server, r.replayId)
    await host.store.replays.update(v => ({ ...v, [id]: { server: runRef.server, replayId: r.replayId } }))
    schedule(host, id, t, 0)
  })().catch(err => host.debug(`claudish Show replay open failed: ${err instanceof Error ? err.message : String(err)}`))
}

async function closeTabs(host: Host, ids: readonly string[]): Promise<void> {
  const refs: ClaudishRunRef[] = []
  for (const id of ids) {
    const t = tabs.get(id)
    if (!t) continue
    t.timer?.cancel()
    t.timer = null
    tabs.delete(id)
    if (t.ref) refs.push(t.ref)
  }
  // The close first: a state write can fail, and a replay left running costs a whole process. An id
  // still in state after a failed write is closed again by the next load, which is harmless.
  await Promise.all(refs.map(ref => host.source.replayClose(ref.server, ref.token)))
  await host.store.replays.update(v => {
    const rest = { ...v }
    for (const id of ids) delete rest[id]
    return rest
  })
}

/** The panel closed: every replay closes with it. The tabs' last screens stay in their views. */
export async function closeAll(host: Host): Promise<void> {
  await adopt(host)
  watcher?.cancel()
  watcher = null
  notYet.clear()
  await closeTabs(host, [...tabs.keys()])
}

/** Closes the replays of tabs no longer listed. Timer code only: the engine refuses a state write made from inside a draw. */
export function pruneReplays(host: Host, keep: ReadonlySet<string>): void {
  const gone = [...tabs.keys()].filter(id => !keep.has(id))
  if (gone.length > 0) void closeTabs(host, gone).catch(err => host.debug(`claudish Show replay close failed: ${err instanceof Error ? err.message : String(err)}`))
}

/** Test seam: forgets every replay without closing it. */
export function resetReplay(): void {
  for (const t of tabs.values()) t.timer?.cancel()
  tabs.clear()
  notYet.clear()
  watcher?.cancel()
  watcher = null
  adopted = false
}
