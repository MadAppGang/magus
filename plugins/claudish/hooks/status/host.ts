// The shapes register.tsx fills with closures over a dispatch's engine interface, and
// four pure helpers. No engine-interface spelling and no state reference live here: the
// engine's static scan reads a state reference only where its plugin and key are
// literals of the file that uses it, and follows the engine interface into no import.

import type { PromptSubmitResult, Timer, UiOpenResult, UiPane } from 'claude-code'
import type {
  ClaudishEarlier,
  ClaudishFeedSupport,
  ClaudishLedger,
  ClaudishPaneView,
  ClaudishRuns,
  ClaudishStopRequest,
  ClaudishTurn,
} from '../../types'
import type { RunSource } from './run-source'

/** One atom, through closures over one dispatch. */
export type Cell<T> = {
  read(): Promise<T>
  /** resolves what it wrote */
  update(fn: (v: T) => T): Promise<T>
  /** one update whose fn also returns a claim; resolves [written, the claim of the pass that wrote] */
  claim<C>(fn: (v: T) => readonly [T, C]): Promise<readonly [T, C]>
}

/** One family, member by computed id. */
export type Member<T> = {
  read(id: string): Promise<T>
  update(id: string, fn: (v: T) => T): Promise<T>
  claim<C>(id: string, fn: (v: T) => readonly [T, C]): Promise<readonly [T, C]>
}

export type Store = {
  runs: Cell<ClaudishRuns>
  feeds: Cell<Record<string, ClaudishFeedSupport>>
  stopRequests: Cell<Record<string, ClaudishStopRequest>>
  ledger: Cell<ClaudishLedger>
  turn: Cell<ClaudishTurn>
  earlier: Cell<ClaudishEarlier>
  panes: Member<ClaudishPaneView | null>
}

export type SubmitOutcome = { accepted: true } | { accepted: false; reason: string }

export type TranscriptRow = { role: string; text: string }

/** Everything timer code may do, bound once per load in session.start. */
export type Host = {
  /** bound to the session.start dispatch; what timer code uses */
  store: Store
  source: RunSource
  /** the directory the session started in (session.start's cwd): where a monitor line's relative path starts */
  cwd: string
  /** the engine's clock.now */
  now(): Promise<number>
  /** the engine's clock.after */
  after(ms: number, fn: () => void): Timer
  toast(text: string, timeoutMs?: number): void
  /** the engine's ui.status: one pinned line per plugin; undefined clears it */
  status(text: string | undefined): void
  /** the engine's prompt.submit; a drop and a rejection both read as not accepted */
  submit(text: string): Promise<SubmitOutcome>
  /** the engine's ui.log to the debug log */
  debug(text: string): void
  panes(): Promise<readonly UiPane[]>
  /** the engine's ui.open; columns: the body width asked for while docked (a request) */
  open(id: string, title: string, columns?: number): Promise<UiOpenResult>
  close(id: string): Promise<void>
  /** the engine's session.messages; recovery only */
  messages(): Promise<readonly TranscriptRow[]>
}

const MAX_PASSES = 8

/** The fn an update retries, throwing once it has been asked more than MAX_PASSES times. */
export function capped<T>(fn: (v: T) => T): (v: T) => T {
  let passes = 0
  return v => {
    passes += 1
    if (passes > MAX_PASSES) throw new Error(`state update did not converge in ${MAX_PASSES} passes`)
    return fn(v)
  }
}

/** One update through the given closure, keeping the claim of the pass that wrote: every pass
 *  assigns (never appends to) the claim, so the last pass, whose write landed, wins. */
export async function claimVia<T, C>(
  apply: (fn: (v: T) => T) => Promise<T>,
  fn: (v: T) => readonly [T, C],
): Promise<readonly [T, C]> {
  let claimed!: C
  const written = await apply(v => {
    const [next, c] = fn(v)
    claimed = c
    return next
  })
  return [written, claimed] as const
}

/** A submit's answer: the prompt that entered, or a drop. */
export function toAccepted(result: PromptSubmitResult | { drop: string }): SubmitOutcome {
  return 'drop' in result && typeof result.drop === 'string'
    ? { accepted: false, reason: result.drop }
    : { accepted: true }
}

/** A submit that rejected. */
export function rejected(err: unknown): SubmitOutcome {
  const reason = err instanceof Error ? err.message : String(err)
  return { accepted: false, reason: reason.slice(0, 120) || 'rejected' }
}
