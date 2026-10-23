// The claudish status mod's state contract and domain types.
// Self-contained: no import, no reference. Every name is led by `Claudish`, so it
// cannot collide when another plugin's type root receives this file.
// claudish's own wire vocabulary never appears here: hooks/claudish-source.ts maps it.

/** The closed set of slot states, plus the mod's own LOST and UNKNOWN. */
export type ClaudishSlotState =
  | 'STARTING' | 'RUNNING' | 'AWAITING_INPUT' | 'AWAITING_PERMISSION'   // live
  | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT' | 'EMPTY'          // claudish terminal
  | 'LOST'                                                              // the mod's own terminal
  | 'UNKNOWN'                                                           // the mod's own live-ish: a state outside the set, or none

/** panel = a team run; delegation = a delegated session. Never the tool names. */
export type ClaudishRunKind = 'panel' | 'delegation'

export type ClaudishRunRef = {
  kind: ClaudishRunKind
  /** the MCP server name of the process that started it, derived from the starting tool's name */
  server: string
  /** claudish's per-start id from the start answer. Opaque */
  token: string
  /** panel: the absolute session directory; delegation: the per-start id again. Opaque */
  address: string
}

export type ClaudishFeatures = { cancel: boolean; capture: boolean; spans: boolean; resize: boolean }

export type ClaudishFeedSupport =
  | { kind: 'probing'; strikes: number }
  | { kind: 'speaks'; version: number; can: ClaudishFeatures; declined: number }
  | { kind: 'unsupported'; reason: string; at: number; spoke: boolean }

export type ClaudishSlot = {
  /** panel: "01"…; delegation: its per-start id; a run that was never listed: "*" */
  slot: string
  model: string
  provider: string | null
  state: ClaudishSlotState
  reason: string | null
  /** the failure in the provider's own words (claudish's reason_detail), when claudish sends one */
  detail?: string | null
  /** the agent the caller asked for (claudish's agent_requested); absent when claudish sends none or an unsafe name */
  agentRequested?: string | null
  /** the agent Claude Code actually loaded, as claudish read it from the child's transcript; absent likewise */
  agent?: string | null
  tokensIn: number | null
  tokensOut: number | null
  toolCalls: number | null
  turnsCompleted: number | null
  /** what the slot cost in US dollars, as claudish reports it; null when unknown or billed by a subscription */
  costUsd: number | null
  /** null in terminal states */
  idleSeconds: number | null
  /** epoch ms */
  lastActivityAt: number | null
  /** display and wait-entry signature only, never wake text */
  activity: string | null
  /** waiting for input on a question (the adapter's comparison); false otherwise */
  asked: boolean
  /** claudish's last steps of the slot's current turn, oldest first (its `recent`); absent when claudish sends none */
  recent?: ClaudishRecentStep[]
}

/** One step claudish saw in a slot's transcript: what the model said or thought, a tool call, or a question. */
export type ClaudishRecentStep = {
  /** epoch ms the step began */
  at: number
  kind: 'text' | 'thinking' | 'tool' | 'ask'
  /** the tool's name, for a `tool` step */
  tool: string | null
  /** one line: the words, the tool's target (a path, a command's first line), or the question */
  summary: string
}

/** Per slot of a run: the entries into AWAITING_INPUT / AWAITING_PERMISSION seen so far. */
export type ClaudishWait = {
  /** 1 after the first entry; +1 per re-entry; never lowered */
  entries: number
  /** signature of the current waiting observation; null while the slot is not waiting */
  sig: string | null
}

export type ClaudishRun = {
  /** hex8(fnv1a32(kind|server|token)): one per start */
  id: string
  /** the conversation epoch it was started in */
  epoch: number
  ref: ClaudishRunRef
  label: string
  /** 1 + starts of this epoch already made at the same ref.address */
  generation: number
  slots: ClaudishSlot[]
  /** when the mod saw the run start (epoch ms): each slot's runtime counts from it; absent = unknown, drawn — */
  startedAt?: number
  /** last poll whose answer showed activity; drives cadence only */
  activityAt: number
  missedPolls: number
  missingSince: number | null
  unreachableSince: number | null
  /** slot → when it entered UNKNOWN */
  unknownSince: Record<string, number>
  /** slots the person confirmed Stop on; written before the cancel is sent */
  personStops: string[]
  /** slot → its wait entries */
  waits: Record<string, ClaudishWait>
  lostReason: string | null
  /** when every slot became terminal; never on an empty slot list */
  settledAt: number | null
  /** slot → what it did, one step per change the polls saw; absent on a run recorded before trails */
  trails?: Record<string, ClaudishTrailStep[]>
}

/** What a slot was doing, as the band's timeline draws it. */
export type ClaudishTrailKind = 'start' | 'say' | 'think' | 'tool' | 'background' | 'finish' | 'idle' | 'wait' | 'done' | 'fail' | 'stop'

/**
 * One change of what a slot does: from `at` (epoch ms) until the next step. `tool` names the tool
 * of a `tool` step; `text` is its one line (the words, the tool's target, the failure), when known.
 */
export type ClaudishTrailStep = { at: number; kind: ClaudishTrailKind; tool: string | null; text?: string }

export type ClaudishFrame = {
  seq: number
  cols: number
  rows: number
  cursor: { row: number; col: number } | null
  /** exactly `rows` entries, plain text, right-trimmed */
  lines: string[]
  /** the child's colours, one array per line (same length as lines); absent = plain */
  styles?: ClaudishStyleSpan[][]
}

export type ClaudishColor = { index: number } | { rgb: number }

export type ClaudishStyleSpan = {
  col: number
  len: number
  fg: ClaudishColor | null
  bg: ClaudishColor | null
  bold: boolean
}

export type ClaudishPaneView = {
  runId: string
  slot: string
  model: string
  status: 'waiting' | 'live' | 'unavailable' | 'ended'
  frame: ClaudishFrame | null
  note: string | null
}

/** armed: the first press, until the confirm window ends. sending: the cancel is out, its answer not
 *  back (Claude Code's own permission question may be open); never timed out. sent: answered at `at`. */
export type ClaudishStopRequest =
  | { kind: 'armed'; until: number }
  | { kind: 'sending'; at: number }
  | { kind: 'sent'; at: number }

export type ClaudishWakeEntry =
  | { kind: 'pending'; state: ClaudishSlotState; at: number; attempts: number; retryAt: number | null }
  | { kind: 'inflight'; state: ClaudishSlotState; at: number; attempts: number; nonce: string; since: number }
  | { kind: 'parked'; state: ClaudishSlotState; at: number; attempts: number; reason: string; retryAt: number }
  | { kind: 'delivered'; at: number; nonce: string }

export type ClaudishRuns = { epoch: number; starts: Record<string, number>; list: ClaudishRun[] }
export type ClaudishLedger = { epoch: number; entries: Record<string, ClaudishWakeEntry> }
export type ClaudishTurn = { isRunning: boolean; since: number }
/** The Show panel's active tab: a slot's tab id (its view's member id); null before the first Show. */
export type ClaudishShowTab = { active: string | null }
export type ClaudishEarlier = { runs: number; done: number; failed: number; stopped: number }

declare module 'claude-code' {
  interface PluginState {
    claudish: {
      /** the epoch lives inside the atom it fences; starts: per ref.address, starts this epoch */
      runs: ClaudishRuns
      /** key: `${server}#${kind}`; absent = probing, 0 strikes */
      feeds: Record<string, ClaudishFeedSupport>
      /** key: `${runId}/${slot}` */
      stopRequests: Record<string, ClaudishStopRequest>
      /** member id = pane id = Pane requestId */
      panes: StateFamily<ClaudishPaneView | null>
      /** key: `${runId}/${slot}` (terminal) or `${runId}/${slot}#w${n}` (the n-th wait entry) */
      wakeLedger: ClaudishLedger
      turn: ClaudishTurn
      earlier: ClaudishEarlier
      /** which tab the Show panel shows; kept while the panel is hidden */
      showTab: ClaudishShowTab
    }
  }
}
