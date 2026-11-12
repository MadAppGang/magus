/**
 * Scrolling the Show panel's tab: the person's wheel or scroll keys over the panel are forwarded to
 * the child session, which scrolls its own transcript; the capture right after shows the move.
 *
 * Why forward and not keep history here: claudish's capture returns only the child's visible screen,
 * and a Claude Code child draws on the alternate screen, so its terminal keeps no scrollback to read.
 * Only the child itself holds its earlier output.
 *
 * A scrolled child stays where it is while new output arrives (Claude Code, measured on 2.1.316), so
 * the mod brings it back to its live bottom (`to: "end"`): when the person scrolls down past where
 * the mod reckons the bottom is, when a downward scroll no longer moves the screen, and when the
 * person leaves the tab (another tab, or Hide).
 */

import type { ClaudishRunRef } from '../../types'
import { SHOW_PANE_ID, feedKey, isTerminal, viewedElsewhere } from './domain'
import type { Host } from './host'
import { activeTab, showTabs } from './layout'
import { captureOpened } from './poll'
import { captureReplay, replayTarget } from './replay'
import type { ScrollMove, ScrollResult } from './run-source'

/** claudish's cap on rows per scroll call; a larger move is sent as several. */
export const SCROLL_MAX_ROWS = 200
/** A scroll answer later than this counts as failed, so a call that never answers cannot hold its tab. */
export const SCROLL_TIMEOUT_MS = 5_000

type TabScroll = {
  /** rows asked for and not yet sent; wheel ticks arriving during a call add up here */
  pending: number
  sending: boolean
  /** rows the child is reckoned to be above its live bottom: 0 at the bottom, negative above it */
  above: number
  /** a by-move reached the child since its last `to: "end"` */
  moved: boolean
}

/** pane id → its scroll state. A tab with none was never scrolled. */
const tabs = new Map<string, TabScroll>()

type Target = { ref: ClaudishRunRef; slot: string; replay: boolean }

/** Where the tab's wheel goes: its open replay, else its child while the run is live and its feed takes scroll; null otherwise, and while another viewer holds the tab, whose screen a scroll would move. */
async function targetOf(host: Host, id: string): Promise<Target | null> {
  const view = await host.store.panes.read(id)
  if (viewedElsewhere(view)) return null
  const replay = replayTarget(id)
  if (replay) return { ref: replay, slot: replay.token, replay: true }
  if (!view) return null
  const runs = await host.store.runs.read()
  const run = runs.list.find(r => r.id === view.runId)
  if (!run || run.settledAt !== null) return null
  const slot = run.slots.find(s => s.slot === view.slot)
  if (!slot || isTerminal(slot.state)) return null
  const support = (await host.store.feeds.read())[feedKey(run.ref)]
  if (support?.kind !== 'speaks' || support.can.scroll !== true) return null
  return { ref: run.ref, slot: view.slot, replay: false }
}

/** One scroll call, never rejecting and never longer than SCROLL_TIMEOUT_MS: either becomes a failed answer. */
function scrollBounded(host: Host, t: Target, move: ScrollMove): Promise<ScrollResult> {
  return new Promise(resolve => {
    const timer = host.after(SCROLL_TIMEOUT_MS, () => resolve({ kind: 'failed', reason: 'no answer' }))
    host.source.scroll(t.ref, t.slot, move).then(
      r => { timer.cancel(); resolve(r) },
      (e: unknown) => { timer.cancel(); resolve({ kind: 'failed', reason: e instanceof Error ? e.message : String(e) }) },
    )
  })
}

async function screenOf(host: Host, id: string): Promise<string | null> {
  const view = await host.store.panes.read(id)
  return view?.frame ? view.frame.lines.join('\n') : null
}

/** Sends one move and captures the tab after it. Returns false when the move did not reach the child. */
async function send(host: Host, id: string, st: TabScroll, t: Target, move: ScrollMove): Promise<boolean> {
  const before = 'by' in move && move.by > 0 ? await screenOf(host, id) : null
  const r = await scrollBounded(host, t, move)
  if (r.kind !== 'scrolled') {
    host.debug(`claudish Show scroll ${'to' in move ? 'to end' : `by ${move.by}`} failed: ${r.kind === 'gone' ? 'gone' : r.reason}`)
    return false
  }
  if ('to' in move) {
    st.above = 0
    st.moved = false
  } else {
    st.above = Math.min(0, st.above + move.by)
    st.moved = true
  }
  await (t.replay ? captureReplay(host, id) : captureOpened(host, id, false))
  // A downward scroll that left the screen as it was found the child's bottom: the reckoning was
  // off (the child went back on its own, at a prompt submit). Bring it back to live from there.
  if (before !== null && st.above < 0 && (await screenOf(host, id)) === before) {
    st.above = 0
    return send(host, id, st, t, { to: 'end' })
  }
  return true
}

/** Sends what the tab has pending, one call at a time, until nothing is left or a call fails. */
async function drain(host: Host, id: string, st: TabScroll): Promise<void> {
  st.sending = true
  try {
    while (st.pending !== 0) {
      const t = await targetOf(host, id)
      if (!t) break
      const asked = st.pending
      const by = Math.max(-SCROLL_MAX_ROWS, Math.min(SCROLL_MAX_ROWS, asked))
      st.pending = asked - by
      const move: ScrollMove = by > 0 && st.above + by >= 0 ? { to: 'end' } : { by }
      if ('to' in move) st.pending = Math.max(0, st.pending) // at the bottom, further downward rows are spent
      if (!(await send(host, id, st, t, move))) break
    }
  } finally {
    st.pending = 0
    st.sending = false
  }
}

/** The tab the Show panel draws now, as its render picks it; null while the panel is not placed. */
async function shownId(host: Host): Promise<string | null> {
  if (!(await host.panes()).some(p => p.id === SHOW_PANE_ID && p.isPlaced)) return null
  const tabsNow = showTabs(await host.store.runs.read(), await host.store.feeds.read())
  return activeTab(tabsNow, (await host.store.showTab.read()).active)?.id ?? null
}

/**
 * The person's wheel or scroll keys over the Show panel: `by` rows, negative toward older output.
 * Queued on the shown tab and sent from there, without waiting: a slow child never holds the
 * person's input. False when the shown tab cannot scroll (no live child, or a claudish without
 * scroll), so the engine scrolls the panel as before.
 */
export async function forward(host: Host, by: number): Promise<boolean> {
  if (!Number.isFinite(by) || Math.trunc(by) === 0) return false
  const id = await shownId(host)
  if (id === null || !(await targetOf(host, id))) return false
  let st = tabs.get(id)
  if (!st) {
    st = { pending: 0, sending: false, above: 0, moved: false }
    tabs.set(id, st)
  }
  st.pending += Math.trunc(by)
  if (!st.sending) void drain(host, id, st).catch(err => host.debug(`claudish Show scroll failed: ${err instanceof Error ? err.message : String(err)}`))
  return true
}

/**
 * Every scrolled tab but `keep` goes back to its child's live bottom: the person left it, and a
 * child left scrolled would no longer show its new output. `keep` null: the panel was put away.
 */
export async function release(host: Host, keep: string | null): Promise<void> {
  const left = [...tabs.entries()].filter(([id]) => id !== keep)
  await Promise.all(left.map(async ([id, st]) => {
    tabs.delete(id)
    if (!st.moved && st.above === 0) return
    st.pending = 0
    const t = await targetOf(host, id)
    if (t) await send(host, id, st, t, { to: 'end' })
  }))
}

/** Test seam: forgets every tab's scroll state. */
export function resetScroll(): void {
  tabs.clear()
}
