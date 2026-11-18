// Constants of the orchestrator status mod: the pane, its sizes, the cadences and the glyphs.
// Pure: no import, no IO.

/** The one pane: the session list, or one session's tasks, dependencies and screen. */
export const SHOW_PANE_ID = 'orchestrator-show'
export const SHOW_PANE_TITLE = 'orchestrator'
/** The body columns the pane asks for while docked: a request, the person's own width wins. */
export const SHOW_COLUMNS = 100
/** The body rows the pane asks for while inline above the prompt. */
export const SHOW_ROWS = 24

/** While this session owns no record: one existence check of its index entry, this often. */
export const PLAIN_CHECK_MS = 5_000
/** A tick while a drawn row is neither done nor gone. */
export const ACTIVE_TICK_MS = 2_000
/** A tick while every drawn row is done or gone. */
export const QUIET_TICK_MS = 10_000
/** A tick that threw waits this long times 2^failures, at most BACKOFF_MAX_MS. */
export const BACKOFF_BASE_MS = 2_000
export const BACKOFF_MAX_MS = 30_000
/** The shown session's screen is captured this often while the pane is placed. */
export const CAPTURE_MS = 1_000
/** Captures failing in a row before the capture loop stops and says the pane is gone. */
export const CAPTURE_MISSES = 3
/** A rows snapshot whose rows did not change is still rewritten this often, so ages move. */
export const AGE_REFRESH_MS = 10_000
/** A record whose session is gone and that was not updated for this long is skipped. */
export const STALE_RECORD_MS = 24 * 3_600_000
/** Every host command the mod runs gives up after this long. */
export const RUN_TIMEOUT_MS = 3_000
/** A process found live is checked against a fresh `ps` snapshot again after this long. */
export const LIVE_RECHECK_MS = 10_000
/** Below this many band columns a row keeps only its label, its status and Show. */
export const NARROW_COLUMNS = 60

export const GONE_SCREEN_NOTE = 'the pane is gone'
export const OTHER_MUX_NOTE = 'not reachable from this multiplexer'
export const SELF_SCREEN_NOTE = 'this session'
export const NO_TARGET_NOTE = 'no pane recorded for this session'

/** The role badge on a row, where it has room for the name. */
export const ROLE_BADGE: Readonly<Record<'triage' | 'manager' | 'child', string>> = { triage: 'triage', manager: 'manager', child: 'worker' }
/** The role badge on a row, where it has no room for the name. */
export const ROLE_SHORT: Readonly<Record<'triage' | 'manager' | 'child', string>> = { triage: 'TR', manager: 'MNG', child: 'WRK' }

/** The glyph before a row's label, by status. */
export const STATUS_GLYPH: Readonly<Record<'working' | 'idle' | 'waiting' | 'blocked' | 'done' | 'gone' | 'unknown', string>> = {
  working: '●',
  idle: '○',
  waiting: '◷',
  blocked: '■',
  done: '✓',
  gone: '×',
  unknown: '?',
}

/** The glyph before a row's label while it needs the user, whatever its status. */
export const NEEDS_YOU_GLYPH = '⚠'

/** The word a status badge shows while its row needs the user, whatever its status. */
export const NEEDS_YOU_WORD = 'needs you'

/** The word a status badge shows: the status, or NEEDS_YOU_WORD while the row needs the user. */
export function statusWordOf(status: keyof typeof STATUS_GLYPH, needsYou: boolean): string {
  return needsYou ? NEEDS_YOU_WORD : status
}

/** The theme fill of a status badge; a row that needs the user fills `warning` instead. */
export const STATUS_FILL: Readonly<Record<keyof typeof STATUS_GLYPH, string>> = {
  working: 'success',
  idle: 'inactive',
  waiting: 'permission',
  blocked: 'error',
  done: 'merged',
  gone: 'subtle',
  unknown: 'subtle',
}

/** The cells a badge takes beyond its text: one space each side. */
export const BADGE_PAD = 2

/** The theme fill of a role badge. */
export const ROLE_FILL: Readonly<Record<keyof typeof ROLE_BADGE, string>> = { triage: 'claude', manager: 'ide', child: 'suggestion' }

export function assertNever(value: never): never {
  throw new Error(`unexpected value: ${JSON.stringify(value)}`)
}
