// THE PORT. The mod's core (poll, wake, controls, band, pane) speaks to claudish only
// through this shape, in the mod's own vocabulary. Two adapters implement it:
// claudish-source.ts (runs and their feeds) and allowance-source.ts (the allowance report);
// nothing here names a claudish tool, mode, argument, capability or response field. Types only.

import type {
  ClaudishAllowancePart,
  ClaudishAllowanceView,
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

export type ResizeResult =
  /** the size claudish set, after its own clamping */
  | { kind: 'resized'; cols: number; rows: number }
  /** the run, session or slot is no longer retained */
  | { kind: 'gone' }
  /** any other error (resize_unsupported included), a rejection, or an unparseable answer */
  | { kind: 'failed'; reason: string }

/** A watched run as poll() needs it: the mod's run id and its ref. */
export type WatchedRun = { id: string; ref: ClaudishRunRef }

export type FetchSlot = { slot: string; state: ClaudishSlotState; asked: boolean }

/**
 * Which slice of the allowance report one ask is for: what the band row draws (accounts, rate,
 * gaps), or the forecast (accounts, pool, forecast) the band's takeovers and the forecast panel
 * draw. Each is one small answer; the whole report is too large for one tool answer.
 */
export type AllowanceAsk = 'band' | 'forecast'

/** What one ask for the allowance report answered. Facts, not policy: allowance-poll.ts decides cadence and support. */
export type AllowanceAnswer =
  /** parts: the parts of the view this answer carries; absent = a whole report (every part) */
  | { kind: 'report'; view: ClaudishAllowanceView; parts?: readonly ClaudishAllowancePart[] }
  /** claudish has no report to give (no account pool), in its own words */
  | { kind: 'none'; reason: string }
  /** an error answer without the contract's error body: a claudish that predates the report (unknown tool) */
  | { kind: 'precontract'; reason: string }
  /** the contract declared, but a version other than 1, or no allowance capability */
  | { kind: 'declines'; reason: string }
  /** an error answer carrying the contract's error body (its code) */
  | { kind: 'refused'; code: string }
  /** not a JSON object, or a version 1 report that does not decode */
  | { kind: 'garbled'; reason: string }
  /** the call rejected (transport, timeout, a server not connected under that name) */
  | { kind: 'unanswered'; reason: string }

/** The first server whose answer came from the contract, with that answer; null and the telling failure when none did. */
export type AllowanceResolution = { server: string | null; answer: AllowanceAnswer }

export type RunSource = {
  recognizeCall(call: CallSeen): RecognizedCall
  /** One list call per feed that has a watched run; answers keyed by feed and by run id. Several runs may
   *  share a ref.address (one path started twice); each is matched by its own ref.token, exactly. */
  poll(runs: readonly WatchedRun[]): Promise<PollBatch>
  stop(ref: ClaudishRunRef, slot: string): Promise<StopResult>
  /** sinceSeq: the last seq drawn, 0 before the first frame. withSpans: ask for the child's colours;
   *  poll.ts passes the feed's can.spans, and nothing else may ask. */
  capture(ref: ClaudishRunRef, slot: string, sinceSeq: number, withSpans: boolean): Promise<CaptureResult>
  /** Sets the child's terminal size, so it draws to the Show panel's size. poll.ts calls it only
   *  where the feed's can.resize is true. */
  resize(ref: ClaudishRunRef, slot: string, cols: number, rows: number): Promise<ResizeResult>
  /** The wake text's line naming one run for the model: its label plus claudish's own address and id. */
  runLine(ref: ClaudishRunRef, label: string): string
  /** One sentence telling the model which call fetches these slots' results, or answers a waiting delegation. */
  fetchHint(ref: ClaudishRunRef, slots: readonly FetchSlot[]): string
  /** One slice of the allowance report (default: the band's), asked of one server. */
  allowance(server: string, ask?: AllowanceAsk): Promise<AllowanceAnswer>
  /** The band's slice, asked of each candidate server in order until one answers from the contract. */
  resolveAllowance(candidates: readonly string[]): Promise<AllowanceResolution>
}

/** What claudish-source.ts implements: everything but the allowance report. */
export type RunFeeds = Omit<RunSource, 'allowance' | 'resolveAllowance'>
