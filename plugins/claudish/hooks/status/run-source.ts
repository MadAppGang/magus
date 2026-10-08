// THE PORT. The mod's core (poll, wake, controls, band, pane) speaks to claudish only
// through this shape, in the mod's own vocabulary. One adapter implements it
// (claudish-source.ts); nothing here names a claudish tool, mode, argument, capability
// or response field. Types only.

import type {
  ClaudishFeatures,
  ClaudishFrame,
  ClaudishRunKind,
  ClaudishRunRef,
  ClaudishSlot,
  ClaudishSlotState,
} from '../../types'

/** What the model's claudish tool call was, as observed after it ran. Engine envelope already stripped. */
export type CallSeen = {
  /** the engine's tool name, e.g. mcp__<server>__<tool> */
  tool: string
  /** the tool's own arguments only */
  args: Readonly<Record<string, unknown>>
  answer: {
    /** the result as the model reads it (text blocks joined) */
    text: string | null
    isError: boolean
  }
}

/** Only run starts matter to the core. Reads, cancels, judges and already-settled answers are 'other'. */
export type RecognizedCall =
  | { kind: 'start'; ref: ClaudishRunRef; label: string }
  /** a start answer that decodes but carries no per-start id: the server predates the contract */
  | { kind: 'precontract'; server: string; runKind: ClaudishRunKind; reason: string }
  /** a start answer that does not decode, or lacks its address or per-start id: one debug line */
  | { kind: 'unidentified'; reason: string }
  | { kind: 'other' }

/** What one feed (server × run kind) answered this tick. Facts, not policy: poll.ts decides support. */
export type FeedAnswer =
  /** the contract version 1, list capability present, answer decodes */
  | { kind: 'speaks'; version: 1; can: ClaudishFeatures }
  /** a declaration by the server, not a glitch: no contract version, or a non-contract error body */
  | { kind: 'precontract'; reason: string }
  /** the contract declared, but a version other than 1, or no list capability */
  | { kind: 'declines'; reason: string }
  /** not an error, but does not decode, or its row array is missing */
  | { kind: 'garbled'; reason: string }
  /** an error answer carrying the contract's error body (its code) */
  | { kind: 'refused'; code: string }
  /** the call rejected (transport, deny, protocol error) */
  | { kind: 'unanswered'; reason: string }

export type PollResult =
  | { kind: 'ok'; slots: ClaudishSlot[] }
  /** the feed spoke, but no row carries this run's per-start id (ref.token); or its row is too defective to list */
  | { kind: 'missing'; reason: string | null }

export type PollBatch = {
  /** key: feedKey(ref) = `${server}#${kind}` */
  feeds: ReadonlyMap<string, FeedAnswer>
  /** key: run id; only runs of feeds that answered 'speaks' */
  runs: ReadonlyMap<string, PollResult>
}

export type StopResult =
  /** changed = this call moved the slot to CANCELLED */
  | { kind: 'stopped'; changed: boolean }
  | { kind: 'failed'; reason: string }

export type CaptureResult =
  /** a screen with seq ≥ 1; final = the pane is closed */
  | { kind: 'frame'; frame: ClaudishFrame; final: boolean }
  /** nothing new, or seq 0 (no frame yet, or a pane that never spawned) */
  | { kind: 'unchanged'; final: boolean }
  /** the run, session or slot is no longer retained */
  | { kind: 'gone' }
  /** any other error, a rejection, or an unparseable answer */
  | { kind: 'unavailable'; reason: string }

/** A watched run as poll() needs it: the mod's run id and its ref. */
export type WatchedRun = { id: string; ref: ClaudishRunRef }

export type FetchSlot = { slot: string; state: ClaudishSlotState; asked: boolean }

/**
 * One change claudish's own session monitor reported in a row of this conversation, in the
 * mod's vocabulary. Only the changes the wake can stand down for: a run's end, and a
 * delegation's entry into a wait. Each is matched against a run's ref, never trusted further.
 */
export type MonitorReport =
  /** token: the delegation's per-start id (ref.token) */
  | { kind: 'delegation'; token: string; event: 'ended' | 'waiting' }
  /** record: the id the line names the run by, matched against ref.monitor exactly (a path can be reused) */
  | { kind: 'panel'; record: string; event: 'ended' }

export type RunSource = {
  recognizeCall(call: CallSeen): RecognizedCall
  /** One list call per feed that has a watched run; answers keyed by feed and by run id. Several runs may
   *  share a ref.address (one path started twice); each is matched by its own ref.token, exactly. */
  poll(runs: readonly WatchedRun[]): Promise<PollBatch>
  stop(ref: ClaudishRunRef, slot: string): Promise<StopResult>
  /** sinceSeq: the last seq drawn, 0 before the first frame. withSpans: ask for the child's colours;
   *  poll.ts passes the feed's can.spans, and nothing else may ask. */
  capture(ref: ClaudishRunRef, slot: string, sinceSeq: number, withSpans: boolean): Promise<CaptureResult>
  /** The wake text's line naming one run for the model: its label plus claudish's own address and id. */
  runLine(ref: ClaudishRunRef, label: string): string
  /** One sentence telling the model which call fetches these slots' results, or answers a waiting delegation. */
  fetchHint(ref: ClaudishRunRef, slots: readonly FetchSlot[]): string
  /** Every monitor report in one row's text, in order. Pure; text that is not the monitor's yields nothing. */
  monitorReports(text: string): MonitorReport[]
}
