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

/** allowance: true when a list answer announces claudish's allowance report; absent when it does not
 *  (and on a feed recorded before this field). A trigger to re-probe only: allowance_status decides support. */
export type ClaudishFeatures = { cancel: boolean; capture: boolean; spans: boolean; resize: boolean; allowance?: boolean }

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

// ── the allowance report (claudish's Codex account pool) ─────────────────────
// All times are epoch ms; fractions are 0..1; rates are compute units per hour (cu/h) whatever the
// view's `unit`, which is the pool's (remaining and capacity).
// hooks/status/allowance-source.ts maps claudish's wire report onto these.

export type ClaudishAllowanceSpan = '5h' | 'week'

export type ClaudishAllowanceWindow = {
  span: ClaudishAllowanceSpan
  usedFraction: number
  resetAt: number | null
  /** claudish read the window from the account, not inferred it from a reset */
  observed: boolean
}

export type ClaudishAllowanceAccount = {
  /** 1-based profile number: its place in claudish's `account list`, disabled accounts counted (T2);
   *  on a claudish that does not report the place, its position among the accounts reported */
  number: number
  /** the account's name as claudish labels it ("default", "second"), display-safe, at most 40
   *  characters: the forecast panel names the account by it; null when claudish sends none */
  label: string | null
  /** the plan class, display-safe, at most 40 characters */
  plan: string | null
  /** a 5h and a week window at most; any other window length is dropped */
  windows: ClaudishAllowanceWindow[]
  /** the account in use now; null when claudish does not report it (older than T2) */
  active: boolean | null
  /** the median share of the governing window expected to expire unused at its next refill (T4); null when unknown */
  lostShare: number | null
  /** when that refill is (epoch ms); absent or null when claudish does not say */
  lostAt?: number | null
  /** the governing window claudish names (`binding`: len:300 → 5h, len:10080 → week); absent or
   *  null when claudish sends none or another length */
  binding?: ClaudishAllowanceSpan | null
}

/** A projected time with no allowance left, from claudish's thresholded alerts: the only source of a future ╳. */
export type ClaudishAllowanceGap = {
  level: 'warn' | 'critical'
  /** the median start */
  startAt: number
  /** the median end; null when claudish projects none */
  endAt: number | null
  /** the median length in hours */
  hours: number | null
  /** the probability the gap happens */
  pGap: number
  /** claudish's one-line remedy, display-safe, at most 160 characters */
  remedy: string
  /** the numbers of the accounts whose windows bind it */
  accounts: number[]
}

/** A window refill: claudish's trajectory reset. */
export type ClaudishAllowanceRefill = { at: number; account: number | null; span: ClaudishAllowanceSpan | null; projected: boolean }

/** One hour of claudish's forecast of the pool's remaining allowance, and the share of paths blocked then. */
export type ClaudishAllowancePoint = { at: number; p10: number; p50: number; p90: number; pBlocked: number }

/**
 * When an account takes over (its first takeover inside the horizon, T3): `at` the usual time,
 * `soonest`..`latest` its likely window, `probability` the share of paths where it happens,
 * `likelihood` the shape of its hourly likelihood (absent or null when claudish sends none).
 */
export type ClaudishAllowanceSwitch = { account: number; at: number; soonest: number; latest: number; probability?: number; likelihood?: ClaudishAllowanceLikelihood | null }

/**
 * A takeover's likelihood per hour: `p[i]` is the relative likelihood that it falls in the hour
 * starting at `start + i h` (epoch ms, on the hour). Peak-normalised (max 1); shape only, never
 * where to mark the takeover (that is the switch's `at`). `[1]` is a takeover at a fixed refill.
 */
export type ClaudishAllowanceLikelihood = { start: number; p: number[] }

/** A projected blocked run (claudish's `trajectory.blocked[]` shape): `from`..`to` epoch ms, the window that binds it, the share of paths blocked. */
export type ClaudishAllowanceBlocked = { from: number; to: number; kind: '7d' | '5h'; probability: number }

/**
 * claudish's slower scenario (`trajectory.slower`): the same paths with every hour's demand ×
 * `factor` (0 < factor < 1), its takeovers and blocked runs by the same rules. NOT guaranteed
 * better: a slower switch or gap can come earlier; nothing is derived from comparing the two.
 */
export type ClaudishAllowanceSlower = { factor: number; switches: ClaudishAllowanceSwitch[]; blocked: ClaudishAllowanceBlocked[] }

/** One hour of an account's own remaining allowance (T6): `observed` read, not inferred from a refill. */
export type ClaudishAllowanceHistoryPoint = { at: number; remaining: number; observed: boolean }

/** An account's last 24 hours (T6), by profile number. */
export type ClaudishAllowanceHistory = { account: number; points: ClaudishAllowanceHistoryPoint[] }

/**
 * The parts of a view one answer may carry: a partial answer replaces only these, the rest of the
 * view keeps its last value. accounts; pool (remaining and capacity); rate; gaps; forecast
 * (refills, forecast, switches, history, slower).
 */
export type ClaudishAllowancePart = 'accounts' | 'pool' | 'rate' | 'gaps' | 'forecast'

export type ClaudishAllowanceView = {
  generatedAt: number
  status: 'ok' | 'insufficient-evidence'
  evidence: 'none' | 'window-only' | 'partial' | 'full'
  /** the pool quantities' unit (remaining and capacity); never the rates' */
  unit: 'cu' | 'account-fraction'
  /** in cu/h (claudish's `burn.unit`; a burn in any other unit decodes as null). short: the recent rate; long: the day's; safe: the sustainable rate (null on insufficient evidence; T1) */
  rate: { short: number | null; long: number | null; safe: number | null }
  accounts: ClaudishAllowanceAccount[]
  pool: { remaining: number | null; capacity: number | null }
  gaps: ClaudishAllowanceGap[]
  /** nothing is left now: the only source of the now-cell ╳ */
  blockedNow: boolean
  refills: ClaudishAllowanceRefill[]
  forecast: ClaudishAllowancePoint[]
  /** null when claudish does not report takeovers (older than T3), or the forecast part has not arrived */
  switches: ClaudishAllowanceSwitch[] | null
  /** each account's last 24 hours (T6); absent or null when claudish does not report it */
  history?: ClaudishAllowanceHistory[] | null
  /** the slower scenario; absent or null when claudish does not report it (older) or it does not decode */
  slower?: ClaudishAllowanceSlower | null
}

/** The allowance as the mod holds it: what the last answer said, and when. */
export type ClaudishAllowance =
  | { kind: 'probing' }
  /** this claudish has no allowance report (older, or the capability absent) */
  | { kind: 'unsupported'; reason: string; at: number }
  /** claudish answered no report, with its reason (no account pool) */
  | { kind: 'none'; reason: string; at: number }
  /** claudish answered a contract error */
  | { kind: 'refused'; code: string; at: number }
  /**
   * failures: the band's asks since the view that brought nothing new (the view is kept). at: when
   * the newest answer arrived. parts: when each part of the view last arrived; absent = every part
   * at `at` (a full report); a part missing from it has not arrived yet.
   */
  | { kind: 'ready'; view: ClaudishAllowanceView; at: number; failures: number; parts?: Partial<Record<ClaudishAllowancePart, number>> }

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
      /** claudish's allowance report, polled on its own cadence */
      allowance: ClaudishAllowance
    }
  }
}
