// The scripted claudish world, pure, shared by the engine-kit fake (fake-claudish.ts) and
// the live fake MCP server (tests/claudish-status/fake-claudish-server.ts). No imports:
// it runs under `claude plugin test` (no Node) and under bun alike.
//
// Golden answers: the contract's own JSON examples, copied VERBATIM from mod contract v1
// (§A list answer, §D capture and unchanged answers). If the contract text changes, these
// copies are the one place to update.

// ── golden answers (contract v1, verbatim) ───────────────────────────────────

/** §A. `team(mode="list")` → TeamListResult */
export const GOLDEN_LIST = `{"contract_version":1,"capabilities":["list","status","cancel","capture","capture_since_seq","capture_spans"],
 "runs":[{"run_id":"review-0000000-000001","path":"/w/proj/ai-docs/sessions/x/review","kind":"run","started_at":"2026-10-02T11:00:00.000Z",
  "finished_at":null,"state":"ACTIVE","outcome":null,
  "slots":[{"slot":"01","model":"internal","provider":"Anthropic (native)","state":"RUNNING","reason":null,
            "tokens_in":61211,"tokens_out":812,"cost_usd":null,"tool_calls":3,"turns_completed":0,
            "last_activity_at":"2026-10-02T11:00:41.120Z","idle_seconds":0,"activity":"Bash",
            "pane":"c48211-kq3j9x2-t01-a1b2c3"}]}]}`

/** §D. CaptureResult */
export const GOLDEN_CAPTURE = `{"seq":57,"cols":160,"rows":50,"cursor":{"x":2,"y":44},"final":false,
 "lines":[" ▐▛███▛█   Claude Code v2.1.287","▝▜██████▀  Haiku 4.5 · Claude Max","", "❯ Reply with exactly PEAR","","⏺ PEAR", "…"]}`

/** §D. CaptureUnchanged */
export const GOLDEN_UNCHANGED = `{"unchanged":true,"seq":57,"final":false}`

// ── contract vocabulary the fakes answer with ────────────────────────────────

export const CAPABILITIES = ['list', 'status', 'cancel', 'capture', 'capture_since_seq', 'capture_spans'] as const
export const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EMPTY'] as const

export type Json = Record<string, unknown>

/** What a scripted slot is doing, as the world's controls set it. */
export type SlotControl = {
  state: string
  reason: string | null
  /** ms when it entered this state (counters freeze at a terminal state's `at`) */
  at: number
  activity?: string | null
  turnsCompleted?: number
}

const ACTIVITIES = ['Bash', 'Read', 'thinking', 'background', 'finishing'] as const

export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

export function isTerminal(state: string): boolean {
  return (TERMINAL as readonly string[]).includes(state)
}

/**
 * One SlotRow (§B) at `now` for a slot started at `startedAt`. While running, tokens rise
 * +900/+60 a second, tool calls +1 every 3 s, loops +1 every 10 s, activity cycles every
 * 2 s and idle resets every 2 s. A terminal or waiting slot's counters freeze where they
 * stood (a waiting one's idle keeps rising).
 */
export function slotRow(args: {
  slot: string
  model: string
  provider?: string | null
  startedAt: number
  now: number
  control: SlotControl
  pane?: string | null
}): Json {
  const { control } = args
  const terminal = isTerminal(control.state)
  const waiting = control.state === 'AWAITING_INPUT' || control.state === 'AWAITING_PERMISSION'
  // A waiting child does nothing: its counters stand still, as a terminal one's do; only idle rises.
  const until = terminal || waiting ? Math.min(args.now, control.at) : args.now
  const sec = Math.max(0, Math.floor((until - args.startedAt) / 1000))
  const idle = terminal ? null : waiting ? Math.max(0, Math.floor((args.now - until) / 1000)) : sec % 2
  const activity = terminal ? null
    : control.activity !== undefined ? control.activity
    : waiting ? null
    : ACTIVITIES[Math.floor(sec / 2) % ACTIVITIES.length] ?? null
  return {
    slot: args.slot,
    model: args.model,
    provider: args.provider === undefined ? 'OpenRouter' : args.provider,
    state: control.state,
    reason: control.reason,
    tokens_in: 1000 + 900 * sec,
    tokens_out: 60 * sec,
    cost_usd: null,
    tool_calls: Math.floor(sec / 3),
    turns_completed: control.turnsCompleted ?? Math.floor(sec / 10),
    last_activity_at: iso(args.startedAt + (sec - (terminal || waiting ? 0 : idle ?? 0)) * 1000),
    idle_seconds: idle,
    activity,
    pane: args.pane === undefined ? `fake-pane-${args.slot}` : args.pane,
  }
}

// ── capture frames ────────────────────────────────────────────────────────────

export const COLS = 160
export const ROWS = 50
export const TRUECOLOR_BORDER = 16_777_216 + 0x5f87af
export const RED_INDEX = 1
export const CUBE_INDEX = 208

/**
 * A 160 × 50 fake Claude Code screen: a banner at the top, a counter line, one line wider
 * than 120 columns, and the prompt and status line at the bottom. With `spans`, the
 * banner is bold, the prompt border truecolor, one line indexed red and one indexed 208.
 */
export function frame(args: { seq: number; model: string; slot: string; final: boolean; spans: boolean }): Json {
  const lines: string[] = new Array<string>(ROWS).fill('')
  lines[0] = ' ▐▛███▛█   Claude Code v2.1.287'
  lines[1] = `▝▜██████▀  ${args.model} · fake claudish slot ${args.slot}`
  lines[3] = `❯ working on the task (frame ${args.seq})`
  lines[5] = `⏺ counter ${args.seq}`
  lines[6] = `  ⎿ ${'wide output '.repeat(12).trim()}`
  lines[8] = '✕ an error line drawn red'
  lines[9] = '✻ an orange line'
  lines[44] = '─'.repeat(COLS)
  lines[45] = '❯ '
  lines[46] = '─'.repeat(COLS)
  lines[47] = `  ${args.model} · seq ${args.seq}`
  const out: Json = { seq: args.seq, cols: COLS, rows: ROWS, cursor: { x: 2, y: 45 }, final: args.final, lines }
  if (args.spans) {
    const spans: number[][][] = lines.map(() => [])
    spans[0] = [[0, 30, -1, -1, 1]]
    spans[8] = [[0, 25, RED_INDEX, -1, 0]]
    spans[9] = [[0, 16, CUBE_INDEX, -1, 0]]
    spans[44] = [[0, COLS, TRUECOLOR_BORDER, -1, 0]]
    spans[46] = [[0, COLS, TRUECOLOR_BORDER, -1, 0]]
    out.spans = spans
  }
  return out
}

/** A slot whose pane never spawned (§D): seq 0, 50 empty lines, final. */
export function neverSpawned(): Json {
  return { seq: 0, cols: COLS, rows: ROWS, cursor: { x: 0, y: 0 }, final: true, lines: new Array<string>(ROWS).fill('') }
}

/** The seq a running slot's screen stands at: +1 a second while live, frozen when it ends. */
export function seqAt(startedAt: number, now: number, control: SlotControl): number {
  const until = isTerminal(control.state) ? Math.min(now, control.at) : now
  return 1 + Math.max(0, Math.floor((until - startedAt) / 1000))
}

/** A terminal slot's pane closes in the background (§C): `final` 8 s after it ended. */
export const REAP_MS = 8_000

// ── answers measured on claudish 10.3.0 (pre-contract) ───────────────────────

export const PRECONTRACT_LIST_ERROR = 'Error: Unknown mode: list'
export const precontractUnknownTool = (tool: string) => `Error: Unknown tool "${tool}"`

export function contractError(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } })
}

/** run_id format: `<team_session_id>-<base36 start ms>-<6 hex>` */
export function mintRunId(teamSessionId: string, startMs: number, n: number): string {
  return `${teamSessionId}-${startMs.toString(36)}-${(0x9c41e0 + n * 7919).toString(16).slice(-6).padStart(6, '0')}`
}

/** The id claudish 10.4 names a team run by in its start answer (`monitor_record`) and in its monitor lines. */
export function monitorRecordOf(runId: string): string {
  return `team-${runId.slice(-6)}`
}

export function basename(path: string): string {
  const parts = path.split('/').filter(p => p.length > 0)
  return parts[parts.length - 1] ?? path
}
