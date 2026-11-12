// Who holds a tab's live view: the one path that writes it to the tab, and the order that keeps an
// answer older than a press from undoing that press. The order is logical, not a clock: every call
// that can report a holder takes a number just before it is sent, and a granted press raises its
// tab's floor to a fresh number when the grant arrives. A call sent after the press went out may
// still have been served before it, so only a number taken after the grant is certain to see it.
// Takes a Host only. Names no claudish tool or field.

import type { ClaudishViewer } from '../../types'
import { sanitize, withClaimNote, withViewer, withoutViewer } from './domain'
import type { Host } from './host'
import type { ResizeResult } from './run-source'

let order = 0
/** pane id → the lowest order an answer may carry and still be applied. */
const floors = new Map<string, number>()

/** Taken immediately before a call that can report a holder is sent. */
export function askOrder(): number {
  return ++order
}

/** Writes the holder an answer reported, unless a press came after that answer was asked for. True when it changed the tab. */
export async function applyViewer(host: Host, id: string, viewer: ClaudishViewer, asked: number): Promise<boolean> {
  if (asked < (floors.get(id) ?? 0)) return false
  const [, changed] = await host.store.panes.claim(id, v => {
    if (!v) return [v, false] as const
    const next = withViewer(v, viewer)
    return [next, next !== v] as const
  })
  return changed
}

/** Forgets the holder of a tab no answer will speak for any more. Writes only when there is one to forget. */
export async function clearViewer(host: Host, id: string): Promise<void> {
  const view = await host.store.panes.read(id)
  if (view && withoutViewer(view) !== view) await host.store.panes.update(id, v => (v ? withoutViewer(v) : v))
}

/** Records why a press made no call, on a tab that is still collapsed. */
export async function noteClaimRefused(host: Host, id: string, note: string): Promise<void> {
  await host.store.panes.update(id, v => (v ? withClaimNote(v, note) : v))
}

export type ClaimOutcome = 'taken' | 'refused' | 'gone'

/** What a resize sent by a press did. A resize is a claim, so an answer naming no holder is a grant. */
export async function settleClaim(host: Host, id: string, answer: ResizeResult): Promise<ClaimOutcome> {
  switch (answer.kind) {
    case 'gone':
      return 'gone'
    case 'failed':
      await noteClaimRefused(host, id, sanitize(answer.reason, 120))
      return 'refused'
    case 'resized': {
      const viewer: ClaudishViewer = answer.viewer ?? { kind: 'here' }
      if (viewer.kind === 'elsewhere') {
        await host.store.panes.update(id, v => (v ? withClaimNote(withViewer(v, viewer), `claudish left the view with ${viewer.label}`) : v))
        return 'refused'
      }
      floors.set(id, askOrder())
      await host.store.panes.update(id, v => (v ? withViewer(v, viewer) : v))
      return 'taken'
    }
  }
}

export function forgetViewOrder(id: string): void {
  floors.delete(id)
}

/** Test seam: forgets every floor. */
export function resetViewOrder(): void {
  floors.clear()
  order = 0
}
