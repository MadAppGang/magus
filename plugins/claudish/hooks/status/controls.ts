// What the band's and the panel's buttons do. State goes through the Store it is handed (bound to
// the render dispatch whose tree held the button); effects through the Host. No engine
// interface spelled here, and no claudish tool named: Stop reaches claudish through the
// port's `stop`.

import type { ClaudishPaneView } from '../../types'
import { SHOW_COLUMNS, SHOW_PANE_ID, SHOW_PANE_TITLE, SHOW_ROWS, STOP_CONFIRM_MS, assertNever, paneId, slotKey, withPersonStop } from './domain'
import type { Host, PressUi, Store } from './host'
import type { SlotTarget } from './layout'
import type { StopResult } from './run-source'

type StopMove = 'arm' | 'send' | 'none'

/**
 * Slot keys whose cancel call has not answered yet. A cancel waits on Claude Code's own
 * permission dialog first, for as long as the person takes to read it; the poll carries on
 * meanwhile (its read-only calls are allowed before the permission check, so none queues
 * behind that dialog). Module state: it dies with a reload, as does the closure awaiting
 * the call.
 */
const cancelling = new Set<string>()

function without<T>(m: Readonly<Record<string, T>>, key: string): Record<string, T> {
  if (!(key in m)) return m as Record<string, T>
  const next = { ...m }
  delete next[key]
  return next
}

/**
 * Stop needs two presses within STOP_CONFIRM_MS, and cancels only that slot. ONE update
 * decides which press this is and claims the move it makes, so two presses in one tick,
 * or a press racing the expiry timer, can never both send.
 */
export async function pressStop(press: Store, host: Host, target: SlotTarget): Promise<void> {
  const key = slotKey(target.runId, target.slot)
  const now = await host.now()
  const until = now + STOP_CONFIRM_MS
  const [, move] = await press.stopRequests.claim<StopMove>(m => {
    const r = m[key]
    if (r?.kind === 'armed' && now < r.until) return [{ ...m, [key]: { kind: 'sending', at: now } }, 'send']
    if (r?.kind === 'sending' || r?.kind === 'sent') return [m, 'none']
    return [{ ...m, [key]: { kind: 'armed', until } }, 'arm'] // the first press, or an expired arm
  })
  switch (move) {
    case 'none':
      return
    case 'arm':
      // A timer: the session-bound Store, since this press's dispatch is long gone by then.
      host.after(STOP_CONFIRM_MS, () => {
        void host.store.stopRequests.update(m => {
          const r = m[key]
          return r?.kind === 'armed' && r.until === until ? without(m, key) : m
        })
      })
      return
    case 'send': {
      // However long the first cancel's dialog stays open, a slot never gets a second one: the
      // claim above already refuses while the request is `sending`; this holds even when the
      // atom was reset under a pending call (a /clear, a resume).
      if (cancelling.has(key)) return
      cancelling.add(key)
      try {
        await sendStop(press, host, target, key)
      } finally {
        cancelling.delete(key)
      }
      return
    }
    default:
      assertNever(move)
  }
}

/** The one cancel of a double press, and its answer: a failure of any kind toasts once and gives Stop back. */
async function sendStop(press: Store, host: Host, target: SlotTarget, key: string): Promise<void> {
  let res: StopResult
  try {
    // Provenance is written BEFORE the cancel is sent, so no poll can see CANCELLED without it.
    await press.runs.update(v => (v.epoch !== target.epoch ? v : withPersonStop(v, target.runId, target.slot, true)))
    res = await host.source.stop(target.ref, target.slot)
  } catch (err) {
    res = { kind: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
  // The answer can come long after the press (Claude Code asks its own question first), so
  // what follows writes through the session-bound Store, as a timer does.
  const after = host.store
  if (res.kind === 'failed') {
    try {
      await after.runs.update(v => withPersonStop(v, target.runId, target.slot, false)) // roll provenance back
      await after.stopRequests.update(m => without(m, key))
    } finally {
      host.toast(`Stop failed for ${target.slot} ${target.model}: ${res.reason}`)
    }
    return
  }
  // The confirmation timeout starts now that the cancel answered, never while its dialog was open.
  const answeredAt = await host.now()
  await after.stopRequests.update(m => (m[key]?.kind === 'sending' ? { ...m, [key]: { kind: 'sent', at: answeredAt } } : m))
  if (!res.changed) {
    // already terminal: this press stopped nothing, so the wake never credits the person
    await after.runs.update(v => withPersonStop(v, target.runId, target.slot, false))
  }
}

function seed(target: SlotTarget): () => ClaudishPaneView {
  return () => ({ runId: target.runId, slot: target.slot, model: target.model, status: 'waiting', frame: null, note: null })
}

/** Makes a slot's tab the panel's active one, its view seeded `waiting` when it has none yet. Returns the tab's id. */
export async function pressTab(press: Store, target: SlotTarget): Promise<string> {
  const id = paneId(target.runId, target.slot)
  await press.showTab.update(() => ({ active: id }))
  if ((await press.panes.read(id)) === null) await press.panes.update(id, seed(target))
  return id
}

/**
 * Show opens the panel on this slot's tab; with the panel open, it only moves it to that tab. The
 * panel holds a tab for every slot the band shows (poll.ts seeds them), so no slot needs a Show
 * of its own to be there. Should Claude Code keep the panel undrawn, a toast gives its reason
 * rather than nothing happening. Returns the tab's id, for its first capture.
 */
export async function pressShow(press: Store, ui: PressUi, host: Host, target: SlotTarget): Promise<string> {
  // The open is the press's first call: Claude Code places a pane at any width only while the
  // person's press is behind it, and an open after an await reads as unasked (measured at 106
  // columns). Opening the open panel only retitles it.
  const opening = ui.open(SHOW_PANE_ID, SHOW_PANE_TITLE, { columns: SHOW_COLUMNS, rows: SHOW_ROWS })
  const id = await pressTab(press, target)
  const opened = await opening
  if (!opened.isPlaced) host.toast(`Show ${target.model}: not drawn yet. ${opened.reason}`, 8_000)
  return id
}

/** Hide puts the panel away. Its tabs and their views stay: the next Show brings them back as they were. */
export async function pressHide(ui: PressUi): Promise<void> {
  await ui.close(SHOW_PANE_ID)
}
