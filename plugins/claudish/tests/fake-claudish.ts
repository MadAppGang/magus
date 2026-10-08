// The engine-kit fake of claudish (contract v1, sections A–E), and the test harness that
// stands beneath the plugin: `mcp.call` (the mod's calls), `tool.call` (the model's
// claudish calls), and the engine events the mod's effects reach (clock, ui.log,
// ui.toast, ui.status, ui.panes, prompt.submit, turn.start/complete, session.start/end, a state.set spy,
// and a session.append spy: the 2.1.292 kit has no core for that event, so a raised row rejects
// once it is past the plugin, after the spy has recorded it).
//
// Answers come from scenario.ts at the mocked clock's time. Every mod call is recorded
// in `calls`. Any server name other than the contract's two is denied, so a wrong
// spelling fails tests. Under `precontract` it answers what claudish 10.3.0 answered.

import type { McpToolResult, On, ToolCallResult, UiPane } from 'claude-code'
import { mock, type MockClock } from 'claude-code/testing'
import {
  CAPABILITIES,
  PRECONTRACT_LIST_ERROR,
  REAP_MS,
  basename,
  contractError,
  frame,
  isTerminal,
  iso,
  mintRunId,
  monitorRecordOf,
  neverSpawned,
  precontractUnknownTool,
  seqAt,
  slotRow,
  type Json,
  type SlotControl,
} from './scenario'

export const SERVERS = ['plugin:claudish:claudish', 'claudish'] as const
export const TEAM_TOOL = 'mcp__plugin_claudish_claudish__team'
export const CREATE_TOOL = 'mcp__plugin_claudish_claudish__create_session'
export const CWD = '/w'

/** One override of a list answer: a whole answer, an error text, or a rejection. */
export type ListOverride = { text: string; isError?: boolean } | { deny: string }

export type FakeOptions = {
  /** answer as claudish 10.3.0 did */
  precontract?: boolean
  /** contract_version 2 on every list answer */
  version2?: boolean
  /** no "list" capability */
  declines?: boolean
  noCapture?: boolean
  noCancel?: boolean
  noSpans?: boolean
  /** the n-th (1-based) list call of a kind: answer this instead, or undefined to answer normally */
  listAnswer?: (n: number, kind: 'runs' | 'sessions') => ListOverride | undefined
  /** rewrite a slot row before it is listed (a defective entry) */
  rowPatch?: (row: Json) => Json
  /** a team start answers its run already SETTLED */
  startSettled?: boolean
  /** a team start answer without run.path */
  noRunPath?: boolean
  /** a team start answer with monitor_record null (no monitor record for the run) */
  noMonitorRecord?: boolean
  /** models per team start (default four) */
  models?: readonly string[]
  /** awaited before a list call is answered (to hold a list answer) */
  beforeList?: () => Promise<void> | void
  /** awaited before the model's claudish call is answered (to hold a start answer) */
  beforeModelCall?: (args: Json) => Promise<void> | void
  /** capture answers: a rejection, retention over (unknown_run / unknown_session), or never `final` */
  rejectCapture?: boolean
  captureGone?: boolean
  neverFinal?: boolean
  /** slots whose pane never spawned (capture answers seq 0, final) */
  noPane?: readonly string[]
  /** a cancel answers this ContractError code instead of cancelling */
  cancelError?: string
  /** a cancel answers changed:true but the slot keeps running (a stall) */
  cancelNoEffect?: boolean
  /** a cancel is refused before it reaches claudish (the person answered No in Claude Code's dialog): mcp.call rejects */
  denyCancel?: string
  /** build the captured screen instead of scenario.frame (lines and spans as the contract sends them) */
  frame?: (args: { seq: number; model: string; slot: string; final: boolean; spans: boolean }) => Json
}

export type FakeSlot = { slot: string; model: string; control: SlotControl; noPane: boolean; finalFrame: boolean }
export type FakeRun = { runId: string; path: string; startedAt: number; slots: FakeSlot[]; hidden: boolean }
export type FakeSession = { id: string; model: string; startedAt: number; control: SlotControl; noPane: boolean }
export type Recorded = { server: string; tool: string; args: Json; at: number }

export type Fake = {
  readonly options: FakeOptions
  readonly runs: FakeRun[]
  readonly sessions: FakeSession[]
  /** every call the mod made through mcp.call */
  readonly calls: Recorded[]
  /** set a slot's state (any word) from now */
  set(runOrSession: string, slot: string, state: string, reason?: string | null, extra?: Partial<SlotControl>): void
  /** forget every run and session, as a server restart does */
  restart(): void
  listCalls(kind?: 'runs' | 'sessions'): Recorded[]
  captureCalls(): Recorded[]
  cancelCalls(): Recorded[]
  /** hold every cancel answer until release() */
  holdCancels(): { release(): void }
}

export type SubmitAnswer = { text: string } | { drop: string }

export type Opened = { id: string; title: string | undefined; columns: number | undefined }

export type Harness = {
  clock: MockClock
  /** every ui.open and ui.close the plugin made */
  opens: Opened[]
  closes: string[]
  fake: Fake
  debug: string[]
  toasts: string[]
  statuses: (string | undefined)[]
  /** every prompt the engine accepted from the plugin */
  submits: string[]
  /** every prompt the plugin submitted, accepted or dropped */
  attempts: string[]
  /** how prompt.submit answers; a test may replace it (to drop, or to hold the answer) */
  submitAnswer: (text: string) => SubmitAnswer | Promise<SubmitAnswer>
  /** every row the engine kept through session.append, as the bottom received it */
  appended: unknown[]
  /** the plugin's last written value per `key` (or `key/id` for a family member) */
  state: Map<string, unknown>
  /** one state.set per write: [key, value] */
  writes: [string, unknown][]
  /** answer ui.panes with these */
  panes: UiPane[]
  /** what ui.panes answers; a test may replace it (to hold or throw) */
  panesAnswer: () => Promise<UiPane[]> | UiPane[]
  /** a state.set whose key this answers true for misses (isSet false: another write beat it), as contention does */
  failWrite: ((key: string) => boolean) | null
}

/** What the engine draws of its own at a site the plugin passes on (a stand-in, recognisable by key). */
export const ENGINE_DRAWING = { type: 'Box', props: { key: 'engine-own' }, children: [] }

const SLOT_IDS = ['01', '02', '03', '04', '05', '06', '07', '08']

function text(body: unknown, isError = false): McpToolResult {
  return { content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }], isError }
}

function meta(o: FakeOptions): Json {
  const caps = CAPABILITIES.filter(c =>
    !(o.declines && c === 'list')
    && !(o.noCapture && (c === 'capture' || c === 'capture_since_seq' || c === 'capture_spans'))
    && !(o.noCancel && c === 'cancel')
    && !(o.noSpans && c === 'capture_spans'))
  return { contract_version: o.version2 ? 2 : 1, capabilities: caps }
}

function absolute(path: unknown): string {
  const p = typeof path === 'string' ? path : 'run'
  const abs = p.startsWith('/') ? p : `${CWD}/${p}`
  return abs.replace(/\/+$/, '')
}

/** The fake claudish world, beneath the plugin. */
export function fakeClaudish(on: On, clock: MockClock, options: FakeOptions = {}): Fake {
  const runs: FakeRun[] = []
  const sessions: FakeSession[] = []
  const calls: Recorded[] = []
  const listCount = { runs: 0, sessions: 0 }
  let starts = 0
  let gate: Promise<void> | null = null

  const now = () => clock.now()

  function runRow(run: FakeRun): Json {
    const t = now()
    const slots = run.slots.map(s => {
      const row = slotRow({ slot: s.slot, model: s.model, startedAt: run.startedAt, now: t, control: s.control, pane: s.noPane ? null : undefined })
      return options.rowPatch ? options.rowPatch(row) : row
    })
    const settled = run.slots.every(s => isTerminal(s.control.state))
    const finished = settled ? Math.max(...run.slots.map(s => s.control.at)) : null
    return {
      run_id: run.runId,
      path: run.path,
      kind: 'run',
      started_at: iso(run.startedAt),
      finished_at: finished === null ? null : iso(finished),
      state: settled ? 'SETTLED' : 'ACTIVE',
      outcome: settled ? (run.slots.every(s => s.control.state === 'COMPLETED') ? 'ok' : 'partial') : null,
      slots,
    }
  }

  function sessionRow(s: FakeSession): Json {
    const row = slotRow({ slot: s.id, model: s.model, startedAt: s.startedAt, now: now(), control: s.control, pane: s.noPane ? null : undefined })
    const patched = options.rowPatch ? options.rowPatch(row) : row
    return {
      ...patched,
      session_id: s.id,
      started_at: iso(s.startedAt),
      completed_at: isTerminal(s.control.state) ? iso(s.control.at) : null,
      elapsed_seconds: Math.floor((now() - s.startedAt) / 1000),
    }
  }

  function findSlot(key: string, slot: string): { control: SlotControl } | undefined {
    const run = runs.find(r => r.runId === key || r.path === key)
    if (run) return run.slots.find(s => s.slot === slot)
    return sessions.find(s => s.id === key)
  }

  function cancelSlot(target: { control: SlotControl }): { state: string; changed: boolean } {
    if (isTerminal(target.control.state)) return { state: target.control.state, changed: false }
    if (options.cancelNoEffect) return { state: 'CANCELLED', changed: true }
    target.control = { state: 'CANCELLED', reason: 'cancelled', at: now() }
    return { state: 'CANCELLED', changed: true }
  }

  function capture(startedAt: number, model: string, slot: string, control: SlotControl, noPane: boolean, args: Json): McpToolResult {
    if (noPane || options.noPane?.includes(slot)) return text(neverSpawned())
    const seq = seqAt(startedAt, now(), control)
    const final = !options.neverFinal && isTerminal(control.state) && now() - control.at >= REAP_MS
    if (args.since_seq === seq) return text({ unchanged: true, seq, final })
    return text((options.frame ?? frame)({ seq, model, slot, final, spans: args.spans === true }))
  }

  // ── the mod's calls ─────────────────────────────────────────────────────────
  on('mcp.call', async ($, e) => {
    const args = (e.args ?? {}) as Json
    calls.push({ server: e.server, tool: e.tool, args, at: now() })
    if (!(SERVERS as readonly string[]).includes(e.server)) return { deny: `unknown server ${e.server}` }

    if ((e.tool === 'team' && args.mode === 'list') || e.tool === 'list_sessions') await options.beforeList?.()
    if (e.tool === 'team' && args.mode === 'list') {
      listCount.runs += 1
      const o = options.listAnswer?.(listCount.runs, 'runs')
      if (o) return 'deny' in o ? { deny: o.deny } : { value: text(o.text, o.isError === true) }
      if (options.precontract) return { value: text(PRECONTRACT_LIST_ERROR, true) }
      return { value: text({ ...meta(options), runs: runs.filter(r => !r.hidden).map(runRow) }) }
    }
    if (e.tool === 'list_sessions') {
      listCount.sessions += 1
      const o = options.listAnswer?.(listCount.sessions, 'sessions')
      if (o) return 'deny' in o ? { deny: o.deny } : { value: text(o.text, o.isError === true) }
      const rows = sessions.filter(s => args.include_completed === true || !isTerminal(s.control.state)).map(sessionRow)
      if (options.precontract) return { value: text({ sessions: rows }) }
      return { value: text({ ...meta(options), sessions: rows }) }
    }
    if (options.precontract && (e.tool === 'capture_session' || (e.tool === 'team' && args.mode === 'capture'))) {
      return { value: text(e.tool === 'team' ? 'Error: Unknown mode: capture' : precontractUnknownTool(e.tool), true) }
    }
    if ((e.tool === 'team' && args.mode === 'cancel') || e.tool === 'cancel_session') {
      if (gate) await gate
      if (options.denyCancel !== undefined) return { deny: options.denyCancel }
      if (options.cancelError) return { value: text(contractError(options.cancelError, 'cancel refused'), true) }
    }
    if (e.tool === 'team' && args.mode === 'cancel') {
      const run = runs.find(r => r.runId === args.run_id && r.path === args.path)
      if (!run) return { value: text(contractError('unknown_run', 'no such run'), true) }
      const targets = typeof args.slot === 'string' ? run.slots.filter(s => s.slot === args.slot) : run.slots
      if (targets.length === 0) return { value: text(contractError('unknown_slot', 'no such slot'), true) }
      const results = targets.map(s => ({ slot: s.slot, ...cancelSlot(s) }))
      return { value: text({ run_id: run.runId, path: run.path, results }) }
    }
    if (e.tool === 'cancel_session') {
      const s = sessions.find(x => x.id === args.session_id)
      if (!s) return { value: text(contractError('unknown_session', 'no such session'), true) }
      return { value: text({ session_id: s.id, ...cancelSlot(s) }) }
    }
    if ((e.tool === 'team' && args.mode === 'capture') || e.tool === 'capture_session') {
      if (options.rejectCapture) return { deny: 'capture rejected' }
      if (options.captureGone) return { value: text(contractError(e.tool === 'team' ? 'unknown_run' : 'unknown_session', 'retention over'), true) }
    }
    if (e.tool === 'team' && args.mode === 'capture') {
      const run = runs.find(r => r.runId === args.run_id && r.path === args.path)
      if (!run) return { value: text(contractError('unknown_run', 'no such run'), true) }
      const s = run.slots.find(x => x.slot === args.slot)
      if (!s) return { value: text(contractError('unknown_slot', 'no such slot'), true) }
      return { value: capture(run.startedAt, s.model, s.slot, s.control, s.noPane, args) }
    }
    if (e.tool === 'capture_session') {
      const s = sessions.find(x => x.id === args.session_id)
      if (!s) return { value: text(contractError('unknown_session', 'no such session'), true) }
      return { value: capture(s.startedAt, s.model, s.id, s.control, s.noPane, args) }
    }
    return { value: text(contractError('invalid_args', `fake has no ${e.tool} ${String(args.mode ?? '')}`), true) }
  })

  // ── the model's calls (beneath the plugin's tool.call observer) ─────────────
  on('tool.call', async ($, e): Promise<ToolCallResult> => {
    const m = /^mcp__(plugin_claudish_claudish|claudish|[a-z_]+)__([a-z_]+)$/.exec(String(e.tool))
    const verb = m?.[2]
    const args = e as unknown as Json
    await options.beforeModelCall?.(args)
    const answer = (body: unknown, isError = false): ToolCallResult => {
      const t = typeof body === 'string' ? body : JSON.stringify(body)
      return isError ? { isError: true, result: t, text: t } : { result: body, text: t }
    }
    if (verb === 'team' && (args.mode === 'run' || args.mode === 'run-and-judge')) {
      const path = absolute(args.path)
      if (runs.some(r => r.path === path && !r.slots.every(s => isTerminal(s.control.state)))) {
        return answer(`Error: invalid_args: a run at ${path} is still active`, true)
      }
      starts += 1
      const teamSessionId = basename(path)
      const startedAt = now()
      const runId = mintRunId(teamSessionId, startedAt, starts)
      const models = (Array.isArray(args.models) ? args.models : options.models ?? ['gpt-6.1-sol', 'kimi-k3', 'grok-4.6', 'glm-5.3']) as string[]
      const run: FakeRun = {
        runId, path, startedAt, hidden: false,
        slots: models.map((model, i) => ({
          slot: SLOT_IDS[i] ?? String(i + 1).padStart(2, '0'),
          model,
          control: { state: options.startSettled ? 'COMPLETED' : 'RUNNING', reason: null, at: startedAt },
          noPane: false,
          finalFrame: false,
        })),
      }
      runs.push(run)
      const slots = Object.fromEntries(run.slots.map(s => [s.model, s.slot]))
      if (options.precontract) {
        return answer({ started: true, team_session_id: teamSessionId, session_path: path, slots, next: {}, note: '' })
      }
      const row = runRow(run)
      if (options.noRunPath) delete row.path
      return answer({ started: true, run_id: runId, team_session_id: teamSessionId, session_path: path, monitor_record: options.noMonitorRecord ? null : monitorRecordOf(runId), slots, run: row, next: {}, note: '' })
    }
    if (verb === 'create_session') {
      starts += 1
      const id = `${(0xa1b2c3d4 + starts).toString(16)}-0000-4000-8000-${String(starts).padStart(12, '0')}`
      const startedAt = now()
      const prompt = typeof args.prompt === 'string' && args.prompt.length > 0
      sessions.push({
        id, model: typeof args.model === 'string' ? args.model : 'haiku-4.5', startedAt, noPane: false,
        control: { state: prompt ? 'RUNNING' : 'AWAITING_INPUT', reason: null, at: startedAt, turnsCompleted: 0, activity: prompt ? undefined : null },
      })
      return options.precontract ? answer({ session_id: id, status: 'starting' }) : answer({ session_id: id, state: 'STARTING' })
    }
    if (verb === 'send_input') {
      const s = sessions.find(x => x.id === args.session_id)
      if (s && !isTerminal(s.control.state)) s.control = { ...s.control, state: 'RUNNING', at: now(), activity: undefined }
      return answer({ session_id: args.session_id, sent: true })
    }
    if (verb === 'team' && args.mode === 'cancel') {
      const run = runs.find(r => r.path === absolute(args.path) && (args.run_id === undefined || r.runId === args.run_id))
      const targets = run ? run.slots.filter(s => args.slot === undefined || s.slot === args.slot) : []
      return answer({ run_id: run?.runId, path: run?.path, results: targets.map(s => ({ slot: s.slot, ...cancelSlot(s) })) })
    }
    if (verb === 'team') {
      const run = [...runs].reverse().find(r => r.path === absolute(args.path))
      return answer(run ? { ...meta(options), run: runRow(run) } : { note: 'no run' })
    }
    return answer({ ok: true })
  })

  return {
    options,
    runs,
    sessions,
    calls,
    set(key, slot, state, reason = null, extra = {}) {
      const target = findSlot(key, slot)
      if (!target) throw new Error(`fake: no slot ${key}/${slot}`)
      target.control = { ...target.control, ...extra, state, reason, at: now() }
    },
    restart() {
      runs.splice(0, runs.length)
      sessions.splice(0, sessions.length)
    },
    listCalls(kind) {
      return calls.filter(c =>
        kind === 'sessions' ? c.tool === 'list_sessions'
          : kind === 'runs' ? c.tool === 'team' && c.args.mode === 'list'
          : c.tool === 'list_sessions' || (c.tool === 'team' && c.args.mode === 'list'))
    },
    captureCalls() {
      return calls.filter(c => c.tool === 'capture_session' || (c.tool === 'team' && c.args.mode === 'capture'))
    },
    cancelCalls() {
      return calls.filter(c => c.tool === 'cancel_session' || (c.tool === 'team' && c.args.mode === 'cancel'))
    },
    holdCancels() {
      let release!: () => void
      gate = new Promise<void>(r => { release = r })
      return { release: () => { gate = null; release() } }
    },
  }
}

/** Everything beneath the plugin a Phase 1 test needs, registered before the first engine call. */
export function harness(on: On, options: FakeOptions = {}): Harness {
  const clock = mock.clock(on, { now: Date.parse('2026-10-07T00:00:00.000Z') })
  const h: Harness = {
    clock,
    opens: [],
    closes: [],
    fake: fakeClaudish(on, clock, options),
    debug: [],
    toasts: [],
    statuses: [],
    submits: [],
    attempts: [],
    submitAnswer: text => ({ text }),
    appended: [],
    state: new Map(),
    writes: [],
    panes: [],
    panesAnswer: () => h.panes,
    failWrite: null,
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('ui.log', ($, e) => {
    if (e.to === 'debug') h.debug.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    h.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    h.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.panes', async () => ({ value: await h.panesAnswer() }))
  // The engine's own drawing, beneath the plugins: what a site shows when the plugin passes.
  on('ui.render', () => ENGINE_DRAWING as never)
  // A surface that shows the pane it opened last; the rest are tabs behind it.
  on('ui.open', ($, e) => {
    h.opens.push({ id: e.id, title: e.title, columns: e.columns })
    const title = e.title ?? e.id
    const others = h.panes.filter(p => p.id !== e.id).map(p => ({ ...p, isShown: false }))
    h.panes = [...others, { id: e.id, title, isShown: true, isFocused: false, isPlaced: true }]
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    h.closes.push(e.id)
    h.panes = h.panes.filter(p => p.id !== e.id)
    return { value: undefined }
  })
  on('prompt.submit', async ($, e) => {
    h.attempts.push(e.text)
    const answer = await h.submitAnswer(e.text)
    if ('text' in answer) h.submits.push(e.text)
    return answer
  })
  // Every row the plugin passed on, as it arrived here; the kit's own core keeps it.
  on('session.append', ($, e, next) => {
    h.appended.push(e)
    return next(e)
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('state.set', async ($, e, next) => {
    const key = e.id === undefined ? e.key : `${e.key}/${e.id}`
    if (h.failWrite?.(key)) return { value: { isSet: false, version: 0 } }
    h.state.set(key, e.value)
    h.writes.push([key, e.value])
    return next(e)
  })
  return h
}

/** Starts the session the plugin's hooks run in. */
export async function start($: { session: { start: (e: { cwd: string; surface: 'terminal' | 'desktop'; isInteractive: boolean }) => Promise<unknown> } }, surface: 'terminal' | 'desktop' = 'terminal'): Promise<void> {
  await $.session.start({ cwd: CWD, surface, isInteractive: true })
}
