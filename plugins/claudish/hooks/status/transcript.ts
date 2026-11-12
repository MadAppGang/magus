/**
 * The Show panel's text view: a tab's conversation as plain lines, read from claudish
 * (transcript_session / team mode "transcript") and drawn as one tall tree the engine scrolls itself.
 *
 * Why beside the screen view: the screen is the child's live terminal, and a finished child cannot
 * scroll (its process has exited). The transcript is complete from the first turn and outlives the
 * child, so a finished tab opens on it.
 *
 * The lines live here, in the module, not in $.state: a long session's transcript is large, and a
 * reload simply reads it again. $.state keeps only a redraw counter and each tab's chosen mode.
 */

import type { ClaudishShowMode, ClaudishTextView } from '../../types'
import { SHOW_PANE_ID, feedKey, isTerminal, viewedElsewhere } from './domain'
import type { Host } from './host'
import { activeTab, showTabs } from './layout'
import { replayFailed } from './replay'
import type { TranscriptCursor, TranscriptLine, TranscriptResult } from './run-source'

/** Lines kept per tab; earlier ones are dropped, and the view says how many. */
export const TEXT_KEEP_LINES = 2_000
/** Pages read in one go when a tab has more waiting (claudish answers at most 200 lines a page). */
export const TEXT_PAGES_PER_READ = 10
/** While a shown text tab is not final, it is read again this often. */
export const TEXT_POLL_MS = 2_000
/** A transcript answer later than this counts as failed. */
export const TEXT_TIMEOUT_MS = 10_000

/** One whole line: cont chains joined. */
export type TextLine = { kind: string; text: string }

export type TabText = {
  cursor: TranscriptCursor | null
  lines: TextLine[]
  /** lines dropped from the top to stay within TEXT_KEEP_LINES */
  dropped: number
  final: boolean
  /** why the last read failed; null after a good one */
  note: string | null
}

type TabState = TabText & { reading: boolean; timer: { cancel(): void } | null; opened: boolean }

const tabs = new Map<string, TabState>()

/** The tab's text as last read; undefined before its first read. */
export function textOf(id: string): TabText | undefined {
  return tabs.get(id)
}

/**
 * The mode a tab draws: the person's pick, else the screen while the child runs or a replay can draw
 * it, else text (where claudish can give it). replays: a finished tab can open on its real interface.
 */
export function modeOf(view: ClaudishTextView, id: string, ended: boolean, canText: boolean, replays = false): ClaudishShowMode {
  if (!canText) return 'screen'
  return view.modes[id] ?? (ended && !replays ? 'text' : 'screen')
}

/** Appends a page, joining each cont line onto the one before it (a chain may cross pages). */
export function appendLines(into: TextLine[], page: readonly TranscriptLine[]): void {
  for (const l of page) {
    const last = into[into.length - 1]
    if (l.cont && last && last.kind === l.kind) last.text += l.text
    else into.push({ kind: l.kind, text: l.text })
  }
}

type Target = { id: string; read: (since: TranscriptCursor | null) => Promise<TranscriptResult> }

/** The tab's transcript reader, while its feed announces the transcript capability and no other viewer holds the tab; null otherwise. */
async function targetOf(host: Host, id: string): Promise<Target | null> {
  const view = await host.store.panes.read(id)
  if (!view || viewedElsewhere(view)) return null
  const run = (await host.store.runs.read()).list.find(r => r.id === view.runId)
  if (!run) return null
  const support = (await host.store.feeds.read())[feedKey(run.ref)]
  if (support?.kind !== 'speaks' || support.can.transcript !== true) return null
  return { id, read: since => bounded(host, host.source.transcript(run.ref, view.slot, since)) }
}

function bounded(host: Host, p: Promise<TranscriptResult>): Promise<TranscriptResult> {
  return new Promise(resolve => {
    const timer = host.after(TEXT_TIMEOUT_MS, () => resolve({ kind: 'failed', reason: 'no answer' }))
    p.then(
      r => { timer.cancel(); resolve(r) },
      (e: unknown) => { timer.cancel(); resolve({ kind: 'failed', reason: e instanceof Error ? e.message : String(e) }) },
    )
  })
}

/** Whether the tab is the one the placed Show panel draws, in text mode. */
async function shownAsText(host: Host, id: string): Promise<boolean> {
  return (await shownTextTab(host)) === id
}

/** The tab the placed Show panel draws when it draws it as text; null otherwise. */
export async function shownTextTab(host: Host): Promise<string | null> {
  if (!(await host.panes()).some(p => p.id === SHOW_PANE_ID && p.isPlaced)) return null
  const runs = await host.store.runs.read()
  const feeds = await host.store.feeds.read()
  const tab = activeTab(showTabs(runs, feeds), (await host.store.showTab.read()).active)
  if (!tab) return null
  const pane = await host.store.panes.read(tab.id)
  const run = pane ? runs.list.find(r => r.id === pane.runId) : undefined
  const slot = run?.slots.find(s => s.slot === pane?.slot)
  const ended = pane?.status === 'ended' || (slot !== undefined && isTerminal(slot.state)) || (run?.settledAt ?? null) !== null
  const support = run ? feeds[feedKey(run.ref)] : undefined
  const canText = support?.kind === 'speaks' && support.can.transcript === true
  const replays = support?.kind === 'speaks' && support.can.replay === true && !replayFailed(tab.id)
  return modeOf(await host.store.textView.read(), tab.id, ended, canText, replays) === 'text' ? tab.id : null
}

/**
 * Reads what the tab has after its cursor, a few pages at most, then redraws. While the tab stays
 * shown as text and is not final, it reads again after TEXT_POLL_MS. Never rejects.
 */
export async function refresh(host: Host, id: string): Promise<void> {
  let st = tabs.get(id)
  if (!st) {
    st = { cursor: null, lines: [], dropped: 0, final: false, note: null, reading: false, timer: null, opened: false }
    tabs.set(id, st)
  }
  if (st.reading || st.final) return
  // Claimed before the first await: a redraw and a press can both arrive here, and two reads from
  // one cursor would append the same lines twice.
  st.reading = true
  let changed = false
  try {
    const t = await targetOf(host, id)
    if (!t) return
    st.timer?.cancel()
    st.timer = null
    for (let page = 0; page < TEXT_PAGES_PER_READ; page++) {
      if (page > 0 && viewedElsewhere(await host.store.panes.read(id))) break
      const r = await t.read(st.cursor)
      if (r.kind !== 'lines') {
        const note = r.kind === 'gone' ? 'claudish no longer keeps this session' : `transcript unavailable: ${r.reason}`
        if (st.note !== note) { st.note = note; changed = true }
        if (r.kind === 'gone') st.final = true
        break
      }
      if (st.note !== null) { st.note = null; changed = true }
      if (r.lines.length > 0) { appendLines(st.lines, r.lines); changed = true }
      st.cursor = r.cursor
      if (r.final && !r.more) { st.final = true; changed = true }
      if (!r.more) break
    }
    if (st.lines.length > TEXT_KEEP_LINES) {
      const cut = st.lines.length - TEXT_KEEP_LINES
      st.lines.splice(0, cut)
      st.dropped += cut
    }
  } finally {
    st.reading = false
  }
  // Scheduled before the redraw: the redraw must find this tab already waiting, or it reads again.
  if (!st.final && st.timer === null) {
    const state = st
    state.timer = host.after(TEXT_POLL_MS, () => {
      state.timer = null
      void shownAsText(host, id).then(shown => (shown ? refresh(host, id) : undefined)).catch(err => host.debug(`claudish Show text read failed: ${err instanceof Error ? err.message : String(err)}`))
    })
  }
  if (changed) await host.store.textView.update(v => ({ ...v, rev: v.rev + 1 }))
  // The first lines open at the newest; from there the engine follows the end while at it. Not the
  // first read: claudish can answer more:true with no lines over records that render nothing.
  if (!st.opened && st.lines.length > 0) {
    st.opened = true
    await host.scrollEnd(SHOW_PANE_ID)
  }
}

/**
 * The panel draws this tab as text: reads it when nothing is under way. A tab left and come back to
 * has no timer (a tick that found it not shown stopped there), so this is what starts it again.
 */
export function keepReading(host: Host, id: string): void {
  const st = tabs.get(id)
  if (st && (st.reading || st.final || st.timer !== null)) return
  void refresh(host, id)
}

/** The person's Screen / Text press on a tab. Text reads the transcript at once. */
export async function setMode(host: Host, id: string, mode: ClaudishShowMode): Promise<void> {
  await host.store.textView.update(v => ({ ...v, modes: { ...v.modes, [id]: mode } }))
  if (mode === 'text') await refresh(host, id)
}

/** Forgets the text of tabs no longer listed. */
export function prune(keep: ReadonlySet<string>): void {
  for (const [id, st] of tabs) {
    if (keep.has(id)) continue
    st.timer?.cancel()
    tabs.delete(id)
  }
}

/** Test seam: forgets every tab's text. */
export function resetText(): void {
  for (const st of tabs.values()) st.timer?.cancel()
  tabs.clear()
}
