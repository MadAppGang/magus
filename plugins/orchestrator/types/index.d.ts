// The orchestrator status mod's state contract and the state record's shapes.
// Self-contained: no import, no reference. Every name is led by `Orchestrator`, so it
// cannot collide when another plugin's type root receives this file. The bun side
// (scripts/lib/state-core.ts, hooks/status/model.ts) declares the same shapes as TS types.

export type OrchestratorRole = 'triage' | 'manager' | 'child'

export type OrchestratorTicket = { id: string; url: string | null }

export type OrchestratorTask = { n: number; step: string; who: string; state: string }

export type OrchestratorDepKind = 'session' | 'pr' | 'release'

export type OrchestratorDep = {
  kind: OrchestratorDepKind
  /** session: a family key or a name; pr: a full URL; release: `<artifact> <version>` */
  ref: string
  note: string | null
  since: number
  doneAt: number | null
}

export type OrchestratorHold = { what: string; since: number }

/** `<stateDir>/sessions/<key>.json` merged with `<stateDir>/progress/<key>.json`: the read view. */
export type OrchestratorRecord = {
  schema: 1
  key: string
  sessionId: string
  previousIds: string[]
  role: OrchestratorRole
  name: string | null
  ticket: OrchestratorTicket | null
  /** the parent's family key, never a session id */
  parent: string | null
  product: string
  cwd: string
  pid: number | null
  procStart: string | null
  herdr: { pane: string; tab: string | null; workspace: string | null } | null
  createdAt: number
  updatedAt: number
  rev: number
  tasks: OrchestratorTask[]
  deps: OrchestratorDep[]
  blocked: { reason: string; since: number } | null
  holds: OrchestratorHold[]
  state: 'active' | 'done'
  doneAt: number | null
}

/** `<stateDir>/claims/<launch id>.json`: written once by the launcher. */
export type OrchestratorClaim = {
  schema: 1
  key: string
  role: 'manager' | 'child'
  name: string
  ticket: OrchestratorTicket | null
  parent: string | null
  product: string
  createdAt: number
}

/** `unknown`: only where liveness could not be read at all (fs or ps refused). */
export type OrchestratorStatus = 'working' | 'idle' | 'waiting' | 'blocked' | 'done' | 'gone' | 'unknown'

export type OrchestratorRowDep = OrchestratorDep & { open: boolean; problem: 'gone' | 'not found' | null }

export type OrchestratorTarget =
  | { mux: 'tmux'; pane: string; window: string | null; session: string | null }
  | { mux: 'herdr'; pane: string; tab: string | null }

/** One session of the family as the band and the panel draw it. */
export type OrchestratorRow = {
  key: string
  sessionId: string
  /** distance from the top of the drawn tree */
  depth: number
  role: OrchestratorRole
  /** session file name ?? record name; null hides Msg */
  name: string | null
  /** name ?? ticket id ?? key */
  label: string
  ticket: OrchestratorTicket | null
  status: OrchestratorStatus
  /** ms epoch the status began */
  since: number | null
  /** Claude Code waiting on the user, or `blocked` */
  needsYou: boolean
  waits: string | null
  progress: { done: number; total: number } | null
  tasks: OrchestratorTask[]
  deps: OrchestratorRowDep[]
  holds: OrchestratorHold[]
  isSelf: boolean
  /** listed by triage as an orphan of its product */
  adopted: boolean
  target: OrchestratorTarget | null
}

/** Every row of this session's family (the tree rule), not cut to what the band fits. */
export type OrchestratorRowsState = { at: number; selfKey: string | null; rows: OrchestratorRow[] }

/** The panel: closed; open with `key: null` is the session list; open with a key shows that session. */
export type OrchestratorShowState = { open: boolean; key: string | null; page: number }

/** The last capture of the shown session's screen. */
export type OrchestratorScreenState = { key: string | null; lines: string[]; at: number; error: string | null; misses: number }

declare module 'claude-code' {
  interface PluginState {
    orchestrator: {
      rows: OrchestratorRowsState
      show: OrchestratorShowState
      screen: OrchestratorScreenState
    }
  }
}
