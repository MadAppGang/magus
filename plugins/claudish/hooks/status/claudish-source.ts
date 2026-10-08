// THE ADAPTER: claudish mod contract v1 (sections A–E), and the line grammar of claudish's
// own session monitor, → the mod's domain types.
//
// The only module of the mod that names a claudish tool, a mode, an argument, a capability,
// a response field or a monitor line's words. (The plugin's PreToolUse command hook,
// hooks/allow-read-verbs.ts, names claudish's read-only tools too; it is not part of the mod.)
// It calls MCP only through the McpCall it was given (register.tsx builds the mod's one MCP
// closure), holds no state, and decides nothing about display, cadence, support policy or
// waking: it reports what the server answered, and what the monitor said.

import type { McpToolResult } from 'claude-code'
import type { ClaudishColor, ClaudishFrame, ClaudishRunKind, ClaudishRunRef, ClaudishSlot, ClaudishSlotState, ClaudishStyleSpan } from '../../types'
import { STYLE_SPANS_PER_LINE, feedKey, sanitize } from './domain'
import type {
  CallSeen,
  CaptureResult,
  FeedAnswer,
  FetchSlot,
  PollBatch,
  PollResult,
  RecognizedCall,
  RunSource,
  MonitorReport,
  StopResult,
  WatchedRun,
} from './run-source'

/** The tool.call matcher: claudish installed through the plugin, or registered directly. */
export const CLAUDISH_TOOL = /^mcp__(plugin_claudish_claudish|claudish)__([a-z_]+)$/

/** Tool-name segment → the server name the engine's mcp.call takes ("Reaching claudish"). */
const SERVER_OF: Readonly<Record<string, string>> = {
  plugin_claudish_claudish: 'plugin:claudish:claudish',
  claudish: 'claudish',
}

export type McpCall = (server: string, tool: string, args: Record<string, unknown>) => Promise<McpToolResult>

// ── contract v1 vocabulary ────────────────────────────────────────────────────

const CONTRACT_VERSION = 1
const SLOT_STATES: ReadonlySet<string> = new Set([
  'STARTING', 'RUNNING', 'AWAITING_INPUT', 'AWAITING_PERMISSION',
  'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EMPTY',
])
const FAILURE_REASONS: ReadonlySet<string> = new Set([
  'cancelled', 'timeout', 'boot_timeout', 'boot_blocked', 'first_run_dialog', 'agent_rejected',
  'prompt_not_accepted', 'prompt_not_read', 'child_exited', 'pane_lost', 'blocked', 'api_error',
  'refused', 'empty_output', 'shape_mismatch',
])
const GONE_CODES: ReadonlySet<string> = new Set(['unknown_run', 'unknown_session', 'unknown_slot'])
const QUESTION_ACTIVITY = 'AskUserQuestion'
const MODEL_ID = /^[\w.@:/-]{1,80}$/
const PRECONTRACT_START = 'no run_id: pre-contract claudish'

type Json = Record<string, unknown>

// ── decoding helpers ──────────────────────────────────────────────────────────

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseObject(text: string | null | undefined): Json | null {
  if (typeof text !== 'string') return null
  try {
    const v: unknown = JSON.parse(text)
    return isObject(v) ? v : null
  } catch {
    return null
  }
}

/** content[0].text of an MCP answer (the contract answers in one text block). */
function firstText(result: McpToolResult): string | null {
  const block = Array.isArray(result.content) ? result.content[0] : undefined
  return isObject(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : null
}

/** The ContractError code of an error body, or null when the body is not one. */
function contractErrorCode(text: string | null): string | null {
  const body = parseObject(text)
  const err = body && isObject(body.error) ? body.error : null
  return err && typeof err.code === 'string' && typeof err.message === 'string' ? err.code : null
}

function short(text: unknown): string {
  const s = text instanceof Error ? text.message : typeof text === 'string' ? text : String(text)
  return sanitize(s, 120) || 'no reason given'
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' ? sanitize(v, max) : null
}

/** Server text the mod shows and quotes to the model as it stands: display-safe already, no quote or backslash. */
function isSafeText(text: string, max: number): boolean {
  return text.length > 0 && text.length <= max && sanitize(text, max) === text && !/["\\]/.test(text)
}

/** A run_id, session_id or slot id. */
const isSafeId = (id: string): boolean => isSafeText(id, 128)

/** run.path: absolute, and display-safe. */
const isSafePath = (path: string): boolean => path.startsWith('/') && isSafeText(path, 4096)

function lastSegment(path: string): string {
  const parts = path.split('/').filter(p => p.length > 0)
  return (parts[parts.length - 1] ?? path).slice(0, 16)
}

// ── recognizing a start ───────────────────────────────────────────────────────

function recognizeCall(call: CallSeen): RecognizedCall {
  const m = CLAUDISH_TOOL.exec(call.tool)
  const server = m ? SERVER_OF[m[1] ?? ''] : undefined
  if (!m || !server) return { kind: 'other' }
  const verb = m[2]
  if (call.answer.isError) return { kind: 'other' }

  if (verb === 'team') {
    const mode = call.args.mode
    if (mode !== 'run' && mode !== 'run-and-judge') return { kind: 'other' }
    const body = parseObject(call.answer.text)
    if (!body) return { kind: 'unidentified', reason: 'team start answer is not a JSON object' }
    if (typeof body.run_id !== 'string' || body.run_id.length === 0) {
      return { kind: 'precontract', server, runKind: 'panel', reason: PRECONTRACT_START }
    }
    if (!isSafeId(body.run_id)) return { kind: 'unidentified', reason: 'team start answer has a run_id that is not display-safe' }
    const run = isObject(body.run) ? body.run : null
    if (run?.state === 'SETTLED') return { kind: 'other' }
    const path = run?.path
    if (typeof path !== 'string' || !path.startsWith('/')) {
      return { kind: 'unidentified', reason: 'team start answer has no absolute run.path' }
    }
    if (!isSafePath(path)) return { kind: 'unidentified', reason: 'team start answer has a run.path that is not display-safe' }
    // The monitor names the run by its end record, not by run_id: kept so its line matches this start alone.
    const monitor = typeof body.monitor_record === 'string' && isSafeId(body.monitor_record) ? body.monitor_record : null
    const ref: ClaudishRunRef = monitor === null
      ? { kind: 'panel', server, token: body.run_id, address: path }
      : { kind: 'panel', server, token: body.run_id, address: path, monitor }
    return { kind: 'start', ref, label: lastSegment(path) }
  }

  if (verb === 'create_session') {
    const body = parseObject(call.answer.text)
    if (!body) return { kind: 'unidentified', reason: 'create_session answer is not a JSON object' }
    const id = body.session_id
    if (typeof id !== 'string' || id.length === 0) {
      return { kind: 'unidentified', reason: 'create_session answer has no session_id' }
    }
    if (!isSafeId(id)) return { kind: 'unidentified', reason: 'create_session answer has a session_id that is not display-safe' }
    const ref: ClaudishRunRef = { kind: 'delegation', server, token: id, address: id }
    return { kind: 'start', ref, label: `#${id.slice(0, 6)}` }
  }

  return { kind: 'other' }
}

// ── one list answer: classification, then rows ───────────────────────────────

type Classified = { answer: FeedAnswer; rows: Json[] }

function classify(result: McpToolResult | Error, rowsKey: 'runs' | 'sessions'): Classified {
  const none: Json[] = []
  // 1. the call itself failed
  if (result instanceof Error) return { answer: { kind: 'unanswered', reason: short(result) }, rows: none }
  const text = firstText(result)
  // 2. an error: the contract's error body, or a server that predates the contract
  if (result.isError === true) {
    const code = contractErrorCode(text)
    return code !== null
      ? { answer: { kind: 'refused', code }, rows: none }
      : { answer: { kind: 'precontract', reason: `error answer without a contract error body: ${short(text ?? '')}` }, rows: none }
  }
  // 3. not a JSON object
  const body = parseObject(text)
  if (!body) return { answer: { kind: 'garbled', reason: 'answer is not a JSON object' }, rows: none }
  // 4. no contract declaration
  const version = body.contract_version
  const caps = body.capabilities
  if (typeof version !== 'number' || !Number.isInteger(version)
    || !Array.isArray(caps) || !caps.every(c => typeof c === 'string')) {
    return { answer: { kind: 'precontract', reason: 'answer carries no contract_version and capabilities' }, rows: none }
  }
  // 5. a version this mapping does not read, or no list capability
  if (version !== CONTRACT_VERSION) return { answer: { kind: 'declines', reason: `contract version ${version}` }, rows: none }
  const has = (c: string) => (caps as string[]).includes(c)
  if (!has('list')) return { answer: { kind: 'declines', reason: 'no list capability' }, rows: none }
  // 6. the row array
  const rows = body[rowsKey]
  if (!Array.isArray(rows)) return { answer: { kind: 'garbled', reason: `answer has no ${rowsKey} array` }, rows: none }
  // 7. speaks
  const capture = has('capture') && has('capture_since_seq')
  return {
    answer: { kind: 'speaks', version: 1, can: { cancel: has('cancel'), capture, spans: capture && has('capture_spans') } },
    rows: rows.filter(isObject),
  }
}

function mapSlot(row: Json): ClaudishSlot | null {
  if (typeof row.slot !== 'string' || !isSafeId(row.slot)) return null
  const model = typeof row.model === 'string' ? sanitize(row.model, 80) : ''
  const state: ClaudishSlotState = typeof row.state === 'string' && SLOT_STATES.has(row.state)
    ? (row.state as ClaudishSlotState)
    : 'UNKNOWN'
  const activity = str(row.activity, 60) || null
  const lastAt = typeof row.last_activity_at === 'string' ? Date.parse(row.last_activity_at) : NaN
  return {
    slot: row.slot,
    model: MODEL_ID.test(model) ? model : 'unknown model',
    provider: str(row.provider, 40) || null,
    state,
    reason: typeof row.reason === 'string' && FAILURE_REASONS.has(row.reason) ? row.reason : null,
    tokensIn: num(row.tokens_in),
    tokensOut: num(row.tokens_out),
    toolCalls: num(row.tool_calls),
    turnsCompleted: num(row.turns_completed),
    idleSeconds: num(row.idle_seconds),
    lastActivityAt: Number.isFinite(lastAt) ? lastAt : null,
    activity,
    asked: state === 'AWAITING_INPUT' && row.activity === QUESTION_ACTIVITY,
  }
}

/** A watched run's row, matched by its own per-start id, exactly. */
function pollResult(kind: ClaudishRunKind, rows: readonly Json[], token: string): PollResult {
  if (kind === 'panel') {
    const row = rows.find(r => r.run_id === token)
    if (!row) return { kind: 'missing', reason: null }
    if (!Array.isArray(row.slots)) return { kind: 'missing', reason: 'run row has no slots array' }
    const slots: ClaudishSlot[] = []
    for (const s of row.slots) {
      const mapped = isObject(s) ? mapSlot(s) : null
      if (!mapped) return { kind: 'missing', reason: 'a slot row has no slot id' }
      slots.push(mapped)
    }
    return { kind: 'ok', slots }
  }
  const row = rows.find(r => r.session_id === token)
  if (!row) return { kind: 'missing', reason: null }
  const mapped = mapSlot(row)
  return mapped ? { kind: 'ok', slots: [mapped] } : { kind: 'missing', reason: 'session row has no slot id' }
}

// ── stop ──────────────────────────────────────────────────────────────────────

function stopResult(result: McpToolResult | Error, ref: ClaudishRunRef, slot: string): StopResult {
  if (result instanceof Error) return { kind: 'failed', reason: short(result) }
  const text = firstText(result)
  if (result.isError === true) return { kind: 'failed', reason: contractErrorCode(text) ?? short(text ?? '') }
  const body = parseObject(text)
  if (!body) return { kind: 'failed', reason: 'cancel answer is not a JSON object' }
  if (ref.kind === 'delegation') {
    return typeof body.changed === 'boolean'
      ? { kind: 'stopped', changed: body.changed }
      : { kind: 'failed', reason: 'cancel answer has no changed flag' }
  }
  const entry = Array.isArray(body.results) ? body.results.find(r => isObject(r) && r.slot === slot) : undefined
  return isObject(entry) && typeof entry.changed === 'boolean'
    ? { kind: 'stopped', changed: entry.changed }
    : { kind: 'failed', reason: `cancel answer has no result for slot ${slot}` }
}

// ── capture ───────────────────────────────────────────────────────────────────

const SGR_OR_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g
const C0 = /[\u0000-\u0008\u000a-\u001f\u007f]/g

function cleanLine(line: string, cols: number): string {
  let out = ''
  for (const ch of line.replace(SGR_OR_CSI, '').replace(C0, '')) {
    if (ch === '\t') out += ' '.repeat(8 - (out.length % 8))
    else out += ch
  }
  return out.slice(0, cols).replace(/\s+$/, '')
}

function color(c: number): ClaudishColor | null {
  if (c >= 0 && c <= 255) return { index: c }
  if (c >= 16_777_216) return { rgb: c & 0xffffff }
  return null
}

function sameStyle(a: ClaudishStyleSpan, b: ClaudishStyleSpan): boolean {
  const eq = (x: ClaudishColor | null, y: ClaudishColor | null) => JSON.stringify(x) === JSON.stringify(y)
  return a.bold === b.bold && eq(a.fg, b.fg) && eq(a.bg, b.bg)
}

/** One line's span tuples → sorted, non-overlapping, merged spans, at most STYLE_SPANS_PER_LINE. */
function decodeLine(raw: unknown, cols: number): ClaudishStyleSpan[] {
  if (!Array.isArray(raw)) return []
  const spans: ClaudishStyleSpan[] = []
  for (const t of raw) {
    if (!Array.isArray(t) || t.length !== 5 || !t.every(n => Number.isInteger(n))) continue
    const [col, len, fg, bg, attr] = t as [number, number, number, number, number]
    if (col < 0 || len < 1 || col >= cols) continue
    const span: ClaudishStyleSpan = { col, len: Math.min(col + len, cols) - col, fg: color(fg), bg: color(bg), bold: (attr & 1) === 1 }
    if (span.fg === null && span.bg === null && !span.bold) continue
    spans.push(span)
  }
  spans.sort((a, b) => a.col - b.col)
  const kept: ClaudishStyleSpan[] = []
  for (const s of spans) {
    const prev = kept[kept.length - 1]
    if (prev && s.col < prev.col + prev.len) continue
    if (prev && prev.col + prev.len === s.col && sameStyle(prev, s)) {
      kept[kept.length - 1] = { ...prev, len: prev.len + s.len }
      continue
    }
    kept.push(s)
  }
  return kept.slice(0, STYLE_SPANS_PER_LINE)
}

function decodeSpans(raw: unknown, rows: number, cols: number): ClaudishStyleSpan[][] | undefined {
  if (!Array.isArray(raw) || raw.length !== rows) return undefined
  return raw.map(line => decodeLine(line, cols))
}

function captureResult(result: McpToolResult | Error, withSpans: boolean): CaptureResult {
  if (result instanceof Error) return { kind: 'unavailable', reason: short(result) }
  const text = firstText(result)
  if (result.isError === true) {
    const code = contractErrorCode(text)
    if (code !== null && GONE_CODES.has(code)) return { kind: 'gone' }
    return { kind: 'unavailable', reason: code ?? short(text ?? '') }
  }
  const body = parseObject(text)
  if (!body) return { kind: 'unavailable', reason: 'capture answer is not a JSON object' }
  const final = body.final === true
  if (body.unchanged === true) return { kind: 'unchanged', final }
  const { seq, cols, rows, lines } = body
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0
    || typeof cols !== 'number' || !Number.isInteger(cols) || cols < 1
    || typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1
    || !Array.isArray(lines) || !lines.every(l => typeof l === 'string')) {
    return { kind: 'unavailable', reason: 'capture answer is malformed' }
  }
  if (seq === 0) return { kind: 'unchanged', final }
  const kept = (lines as string[]).slice(0, rows).map(l => cleanLine(l, cols))
  while (kept.length < rows) kept.push('')
  const cur = isObject(body.cursor) ? body.cursor : null
  const x = cur ? num(cur.x) : null
  const y = cur ? num(cur.y) : null
  const frame: ClaudishFrame = {
    seq,
    cols,
    rows,
    cursor: x !== null && y !== null && x >= 0 && y >= 0 && x < cols && y < rows ? { row: y, col: x } : null,
    lines: kept,
  }
  if (withSpans) {
    const styles = lines.length === rows ? decodeSpans(body.spans, rows, cols) : undefined
    if (styles) frame.styles = styles
  }
  return { kind: 'frame', frame, final }
}

// ── wording the wake text borrows ────────────────────────────────────────────

/** A quoted value of the wake text: JSON string syntax, so no quote inside can end it early. */
const q = (s: string): string => JSON.stringify(s)

function runLine(ref: ClaudishRunRef, label: string): string {
  return ref.kind === 'panel'
    ? `Run ${label} (path ${q(ref.address)}, run_id ${q(ref.token)}):`
    : `Delegation ${label} (session_id ${q(ref.token)}):`
}

function delegationHint(id: string, s: FetchSlot): string {
  const sid = `session_id=${q(id)}`
  switch (s.state) {
    case 'COMPLETED':
      return `get_output(${sid})`
    case 'AWAITING_INPUT':
      return s.asked
        ? `Read its answer with get_output(${sid}); reply with send_input(${sid}, …): it is asking a question; send_input declines the question and sends your text as its next prompt`
        : `Read its answer with get_output(${sid}); reply with send_input(${sid}, …)`
    case 'AWAITING_PERMISSION':
      return `it is waiting on a permission dialog; get_output(${sid}) shows it; send_input declines the dialog and sends your text as its next prompt; cancel_session(${sid}) stops it`
    case 'STARTING':
    case 'RUNNING':
    case 'UNKNOWN':
      return `get_output(${sid}) once it finishes`
    default:
      return `get_diagnostics(${sid})`
  }
}

function fetchHint(ref: ClaudishRunRef, slots: readonly FetchSlot[]): string {
  if (ref.kind === 'panel') {
    return `team(mode="status", path=${q(ref.address)}, run_id=${q(ref.token)}) then read each finished slot's response file`
  }
  const s = slots[0] ?? { slot: ref.token, state: 'COMPLETED' as const, asked: false }
  return delegationHint(ref.token, s)
}

// ── claudish's session monitor: its line grammar (plugin README, "Session progress monitor") ──

const MONITOR_PREFIX = 'claudish-monitor: '
const MONITOR_ID = '[A-Za-z0-9._-]{1,64}'
// value = 1*200 printable ASCII without space " & < = >
const MONITOR_LINE = new RegExp(
  `^claudish-monitor: (session|team) (${MONITOR_ID}) (started|running|needs-input|completed|failed|timeout|cancelled)`
  + `((?: [a-z]+=[!#-%'-;?-~]{1,200})*)`
  + `(?: next: (?:(?:get_output|get_diagnostics|send_input) ${MONITOR_ID}|team-status))?$`,
)
const SESSION_ENDS: ReadonlySet<string> = new Set(['completed', 'failed', 'timeout', 'cancelled'])
const TEAM_ENDS: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled'])

/** Each candidate line of a row's text: at a line's start, or right after a tag (`<event>…`), cut at the next tag. */
function monitorLines(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    let from = 0
    for (;;) {
      const at = raw.indexOf(MONITOR_PREFIX, from)
      if (at < 0) break
      from = at + MONITOR_PREFIX.length
      const before = raw.slice(0, at).trimStart()
      if (before !== '' && !before.endsWith('>')) continue
      const end = raw.indexOf('<', at)
      out.push((end < 0 ? raw.slice(at) : raw.slice(at, end)).trimEnd())
    }
  }
  return out
}

/** A team line names its run by the start answer's `monitor_record`; its `path` is not an identity (one
 *  directory can hold run after run), so it is not read. */
function monitorReports(text: string): MonitorReport[] {
  const out: MonitorReport[] = []
  for (const line of monitorLines(text)) {
    const m = MONITOR_LINE.exec(line)
    if (!m) continue
    const [, record, id = '', state = ''] = m
    if (record === 'session') {
      if (state === 'needs-input') out.push({ kind: 'delegation', token: id, event: 'waiting' })
      else if (SESSION_ENDS.has(state)) out.push({ kind: 'delegation', token: id, event: 'ended' })
      continue
    }
    if (TEAM_ENDS.has(state)) out.push({ kind: 'panel', record: id, event: 'ended' })
  }
  return out
}

// ── the adapter ───────────────────────────────────────────────────────────────

const settleCall = (p: Promise<McpToolResult>): Promise<McpToolResult | Error> =>
  p.then(
    r => r,
    (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
  )

/** The one RunSource. register.tsx passes its one MCP closure; tests may pass a stub. */
export function makeClaudishSource(call: McpCall): RunSource {
  return {
    recognizeCall,

    async poll(runs: readonly WatchedRun[]): Promise<PollBatch> {
      const byFeed = new Map<string, WatchedRun[]>()
      for (const r of runs) {
        const key = feedKey(r.ref)
        byFeed.set(key, [...(byFeed.get(key) ?? []), r])
      }
      const feeds = new Map<string, FeedAnswer>()
      const results = new Map<string, PollResult>()
      await Promise.all([...byFeed.entries()].map(async ([key, watched]) => {
        const first = watched[0]
        if (!first) return
        const { kind, server } = first.ref
        const answer = kind === 'panel'
          ? await settleCall(call(server, 'team', { mode: 'list' }))
          : await settleCall(call(server, 'list_sessions', { include_completed: true }))
        const { answer: feed, rows } = classify(answer, kind === 'panel' ? 'runs' : 'sessions')
        feeds.set(key, feed)
        if (feed.kind !== 'speaks') return
        for (const w of watched) results.set(w.id, pollResult(kind, rows, w.ref.token))
      }))
      return { feeds, runs: results }
    },

    async stop(ref: ClaudishRunRef, slot: string): Promise<StopResult> {
      const answer = ref.kind === 'panel'
        ? await settleCall(call(ref.server, 'team', { mode: 'cancel', path: ref.address, slot, run_id: ref.token }))
        : await settleCall(call(ref.server, 'cancel_session', { session_id: ref.token }))
      return stopResult(answer, ref, slot)
    },

    async capture(ref: ClaudishRunRef, slot: string, sinceSeq: number, withSpans: boolean): Promise<CaptureResult> {
      const spans = withSpans ? { spans: true } : {}
      const answer = ref.kind === 'panel'
        ? await settleCall(call(ref.server, 'team', { mode: 'capture', path: ref.address, slot, run_id: ref.token, since_seq: sinceSeq, ...spans }))
        : await settleCall(call(ref.server, 'capture_session', { session_id: ref.token, since_seq: sinceSeq, ...spans }))
      return captureResult(answer, withSpans)
    },

    runLine,
    fetchHint,
    monitorReports,
  }
}
