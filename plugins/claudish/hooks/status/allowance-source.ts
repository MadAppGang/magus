// THE SECOND ADAPTER: claudish's `allowance_status` (report claudish.allowance.v1) → the mod's
// allowance view.
//
// The only module of the mod that names `allowance_status`, its arguments, or a field of its
// report. It classifies the answer's envelope only through claudish-source.ts's classifyEnvelope,
// so it never re-checks the contract version or the capabilities itself. It calls MCP only through
// the McpCall it was given, holds no state, and decides nothing about display, cadence or
// support: it reports what the server answered.
//
// The whole report is too large for one tool answer (Claude Code saves an oversized result to a
// file and hands the caller a stub), so each ask names the report's `sections` it needs. A partial
// answer says so with a top-level `sections` list; it is decoded as exactly those parts and never
// validated as a whole report. An answer without that list is a whole report, as claudish 14.5.x
// sends whatever it is asked.
//
// Every string it passes on is display-safe: text the mod shows (reason, remedy, plan) is
// sanitized and cut to length.

import type { McpToolResult } from 'claude-code'
import type {
  ClaudishAllowanceAccount,
  ClaudishAllowanceBlocked,
  ClaudishAllowanceGap,
  ClaudishAllowanceHistory,
  ClaudishAllowanceLikelihood,
  ClaudishAllowancePart,
  ClaudishAllowancePoint,
  ClaudishAllowanceRefill,
  ClaudishAllowanceSlower,
  ClaudishAllowanceSpan,
  ClaudishAllowanceSwitch,
  ClaudishAllowanceView,
  ClaudishAllowanceWindow,
} from '../../types'
import { classifyEnvelope, isObject, num, settleCall, short, str, type Json, type McpCall } from './claudish-source'
import type { AllowanceAnswer, AllowanceAsk, AllowanceResolution, RunSource } from './run-source'

const TOOL = 'allowance_status'
const CAPABILITY = 'allowance'

/** The display caps (characters). */
const PLAN_MAX = 40
const LABEL_MAX = 40
const REMEDY_MAX = 160

/**
 * The forecast's horizon asked for, in hours: the band's ruler reaches 6 days, and so does the
 * panel's forecast. claudish's default (168) adds a day of trajectory nobody draws; alerts, the
 * safe pace and the lost share do not depend on it.
 */
export const FORECAST_HORIZON_HOURS = 144

/**
 * Each ask's report sections. The forecast and the takeovers name accounts by claudish's id and
 * label, so the forecast ask carries the accounts to number them; `combined` is the panel's pool.
 */
const SECTIONS: Readonly<Record<AllowanceAsk, readonly string[]>> = {
  band: ['accounts', 'alerts', 'burn'],
  forecast: ['accounts', 'combined', 'trajectory'],
}

/** A report section → the part of the view it fills. */
const PART_OF: Readonly<Record<string, ClaudishAllowancePart>> = {
  accounts: 'accounts',
  combined: 'pool',
  burn: 'rate',
  alerts: 'gaps',
  trajectory: 'forecast',
}

/** One ask's arguments. */
/** claudish's provider shortcuts for its OpenAI Codex pool, the one pool `allowance_status` reports. */
const CODEX_PREFIXES = ['cx@', 'codex@']

/**
 * Whether this session runs on claudish's Codex pool, from `CLAUDISH_ACTIVE_MODEL_NAME`: claudish
 * sets it to the model spec when it launches Claude Code, so it is unset in a plain Claude Code
 * session. Only an explicit `cx@`/`codex@` spec counts (claudish reads the shortcut in any case):
 * the report describes the Codex pool, which a session on any other route does not spend.
 */
export function isCodexSession(activeModel: string | null | undefined): boolean {
  const spec = (activeModel ?? '').toLowerCase()
  return CODEX_PREFIXES.some(p => spec.startsWith(p))
}

export function allowanceArgs(ask: AllowanceAsk): Record<string, unknown> {
  return ask === 'forecast'
    ? { sections: [...SECTIONS.forecast], horizon_hours: FORECAST_HORIZON_HOURS }
    : { sections: [...SECTIONS[ask]] }
}

const STATUSES: ReadonlySet<string> = new Set(['ok', 'insufficient-evidence'])
const EVIDENCE: ReadonlySet<string> = new Set(['none', 'window-only', 'partial', 'full'])
const UNITS: ReadonlySet<string> = new Set(['cu', 'account-fraction'])
/** The one rate unit the view holds. claudish's burn rates and safe pace are cu/h whatever the report's `unit` (which is the pool's). */
const RATE_UNIT = 'cu/h'
const LEVELS: ReadonlySet<string> = new Set(['warn', 'critical'])

/**
 * A window key → its span. Account windows are keyed by length (`len:300`, `len:10080`); claudish's
 * golden report keys a reset by its display id (`5h`, `7d`). Any other window is not drawn.
 */
const SPAN_OF: Readonly<Record<string, ClaudishAllowanceSpan>> = {
  'len:300': '5h',
  '5h': '5h',
  'len:10080': 'week',
  '7d': 'week',
}

// ── decoding helpers ──────────────────────────────────────────────────────────

/** An ISO time → epoch ms; null when absent or unparseable. */
function time(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

function array(v: unknown): Json[] {
  return Array.isArray(v) ? v.filter(isObject) : []
}

/** Text the mod shows: sanitized and cut; null when nothing display-safe is left. */
function text(v: unknown, max: number): string | null {
  return str(v, max) || null
}

/** A fraction 0..1, or null. */
function fraction(v: unknown): number | null {
  const n = num(v)
  return n !== null && n >= 0 && n <= 1 ? n : null
}

/**
 * An account's profile number: `order + 1` (its place in `account list`, disabled accounts
 * counted, T2), or its 1-based position among the accounts reported when claudish sends no order.
 */
function profileNumber(a: Json, i: number): number {
  const order = num(a.order)
  return order !== null && Number.isInteger(order) && order >= 0 ? order + 1 : i + 1
}

/** Account label and id → its profile number. Matched here on the raw string; the label the panel shows is the account's own, sanitized (accountsOf). */
type Numbering = ReadonlyMap<string, number>

function numbering(accounts: unknown): { byLabel: Numbering; byId: Numbering } {
  const byLabel = new Map<string, number>()
  const byId = new Map<string, number>()
  if (Array.isArray(accounts)) {
    accounts.forEach((a, i) => {
      if (!isObject(a)) return
      const n = profileNumber(a, i)
      if (typeof a.label === 'string' && !byLabel.has(a.label)) byLabel.set(a.label, n)
      if (typeof a.id === 'string' && !byId.has(a.id)) byId.set(a.id, n)
    })
  }
  return { byLabel, byId }
}

// ── the report's parts ────────────────────────────────────────────────────────

function windowOf(w: Json): ClaudishAllowanceWindow | null {
  const span = typeof w.key === 'string' ? SPAN_OF[w.key] : undefined
  const used = num(w.usedFraction)
  if (!span || used === null) return null
  return { span, usedFraction: used, resetAt: time(w.resetAt), observed: w.provenance === 'observed' }
}

/** One account per accounts[] entry, numbered by its profile number; a 5h and a week window at most. */
function accountsOf(raw: unknown): ClaudishAllowanceAccount[] {
  if (!Array.isArray(raw)) return []
  const out: ClaudishAllowanceAccount[] = []
  raw.forEach((a, i) => {
    if (!isObject(a)) return
    const windows: ClaudishAllowanceWindow[] = []
    for (const w of array(a.windows)) {
      const mapped = windowOf(w)
      if (mapped && !windows.some(x => x.span === mapped.span)) windows.push(mapped)
    }
    // T2 `active` and T4 `lostAtReset` are absent from an older claudish's report: null, as before.
    const lost = isObject(a.lostAtReset) ? a.lostAtReset : null
    const lostShare = lost ? fraction(lost.p50) : null
    out.push({
      number: profileNumber(a, i),
      label: text(a.label, LABEL_MAX),
      plan: text(a.planClass, PLAN_MAX),
      windows,
      active: typeof a.active === 'boolean' ? a.active : null,
      lostShare,
      lostAt: lost && lostShare !== null ? time(lost.at) : null,
      binding: typeof a.binding === 'string' ? SPAN_OF[a.binding] ?? null : null,
    })
  })
  return out
}

/** The median of a quantile set claudish sends (`{p10…p90}`), or null. */
function median(q: unknown): unknown {
  return isObject(q) ? q.p50 : undefined
}

/** claudish's alerts: its thresholded verdict, the only source of a future gap. */
function gapsOf(raw: unknown, accounts: Numbering): ClaudishAllowanceGap[] {
  const out: ClaudishAllowanceGap[] = []
  for (const a of array(raw)) {
    if (typeof a.level !== 'string' || !LEVELS.has(a.level)) continue
    const startAt = num(a.gapStartEpoch) ?? time(median(a.gapStart))
    const pGap = num(a.pGap)
    if (startAt === null || pGap === null) continue
    const bound = new Set<number>()
    for (const b of array(a.binding)) {
      const n = typeof b.account === 'string' ? accounts.get(b.account) : undefined
      if (n !== undefined) bound.add(n)
    }
    out.push({
      level: a.level as ClaudishAllowanceGap['level'],
      startAt,
      endAt: time(median(a.gapEnd)),
      hours: num(median(a.gapHours)),
      pGap,
      remedy: isObject(a.remedy) ? text(a.remedy.text, REMEDY_MAX) ?? '' : '',
      accounts: [...bound].sort((x, y) => x - y),
    })
  }
  return out
}

function refillsOf(raw: unknown, accounts: Numbering): ClaudishAllowanceRefill[] {
  const out: ClaudishAllowanceRefill[] = []
  for (const r of array(raw)) {
    const at = time(r.at)
    if (at === null) continue
    out.push({
      at,
      account: typeof r.account === 'string' ? accounts.get(r.account) ?? null : null,
      span: typeof r.window === 'string' ? SPAN_OF[r.window] ?? null : null,
      projected: r.projected === true,
    })
  }
  return out
}

function forecastOf(raw: unknown): ClaudishAllowancePoint[] {
  const out: ClaudishAllowancePoint[] = []
  for (const p of array(raw)) {
    const at = time(p.at)
    const [p10, p50, p90, pBlocked] = [num(p.p10), num(p.p50), num(p.p90), num(p.pBlocked)]
    if (at === null || p10 === null || p50 === null || p90 === null || pBlocked === null) continue
    out.push({ at, p10, p50, p90, pBlocked })
  }
  return out
}

/**
 * A takeover's `likelihood` (`{ start, stepHours: 1, p }`) → its start and shape; null when absent
 * or malformed (not an object, start unparseable, stepHours not 1, p not a non-empty list of finite
 * numbers): a curve that does not decode is no curve, and the card draws the range row instead.
 */
function likelihoodOf(raw: unknown): ClaudishAllowanceLikelihood | null {
  if (!isObject(raw)) return null
  const start = time(raw.start)
  if (start === null || raw.stepHours !== 1) return null
  const p = raw.p
  if (!Array.isArray(p) || p.length === 0 || !p.every(v => num(v) !== null)) return null
  return { start, p: [...(p as number[])] }
}

/** claudish's takeovers (T3), by profile number; null when it does not report them. An unknown account is dropped. */
function switchesOf(raw: unknown, accounts: Numbering): ClaudishAllowanceSwitch[] | null {
  if (!Array.isArray(raw)) return null
  const out: ClaudishAllowanceSwitch[] = []
  for (const s of array(raw)) {
    const account = typeof s.accountId === 'string' ? accounts.get(s.accountId) : undefined
    const [soonest, at, latest] = [time(s.soonest), time(s.usual), time(s.latest)]
    if (account === undefined || soonest === null || at === null || latest === null) continue
    const probability = fraction(s.probability)
    const likelihood = likelihoodOf(s.likelihood)
    out.push({ account, at, soonest, latest, ...(probability !== null ? { probability } : {}), ...(likelihood !== null ? { likelihood } : {}) })
  }
  return out
}

/** A blocked run's window (claudish's gapKind). */
const BLOCKED_KINDS: ReadonlySet<string> = new Set(['7d', '5h'])

/**
 * Blocked runs (`trajectory.blocked[]` shape); null when not a list or when any run does not decode:
 * a run dropped would read as "no gap", which is a guess.
 */
function blockedOf(raw: unknown): ClaudishAllowanceBlocked[] | null {
  if (!Array.isArray(raw)) return null
  const out: ClaudishAllowanceBlocked[] = []
  for (const b of raw) {
    if (!isObject(b)) return null
    const [from, to, probability] = [time(b.from), time(b.to), fraction(b.probability)]
    if (from === null || to === null || to < from || probability === null || typeof b.kind !== 'string' || !BLOCKED_KINDS.has(b.kind)) return null
    out.push({ from, to, kind: b.kind as ClaudishAllowanceBlocked['kind'], probability })
  }
  return out
}

/**
 * claudish's slower scenario (`trajectory.slower`): factor in (0, 1), its takeovers by switchesOf
 * and its blocked runs by blockedOf; null when absent (an older claudish) or any part is malformed.
 * Never compared with the current scenario here.
 */
function slowerOf(raw: unknown, accounts: Numbering): ClaudishAllowanceSlower | null {
  if (!isObject(raw)) return null
  const factor = num(raw.factor)
  if (factor === null || factor <= 0 || factor >= 1) return null
  const switches = switchesOf(raw.switches, accounts)
  const blocked = blockedOf(raw.blocked)
  if (switches === null || blocked === null) return null
  return { factor, switches, blocked }
}

/** Each account's last 24 hours (T6), by profile number; null when claudish does not report it. */
function historyOf(raw: unknown, accounts: Numbering): ClaudishAllowanceHistory[] | null {
  if (!Array.isArray(raw)) return null
  const out: ClaudishAllowanceHistory[] = []
  for (const h of array(raw)) {
    const account = typeof h.accountId === 'string' ? accounts.get(h.accountId) : undefined
    if (account === undefined) continue
    const points = array(h.history).flatMap(p => {
      const at = time(p.at)
      const remaining = num(p.remaining)
      return at === null || remaining === null ? [] : [{ at, remaining, observed: p.provenance === 'observed' }]
    })
    out.push({ account, points })
  }
  return out
}

/** A report's header (every answer carries it, partial or whole); a string naming what is missing. */
type Header = Pick<ClaudishAllowanceView, 'generatedAt' | 'status' | 'evidence' | 'unit' | 'blockedNow'>

function headerOf(r: Json): Header | string {
  const generatedAt = time(r.generatedAt)
  if (generatedAt === null) return 'report has no generatedAt'
  if (typeof r.status !== 'string' || !STATUSES.has(r.status)) return 'report has no known status'
  if (typeof r.evidence !== 'string' || !EVIDENCE.has(r.evidence)) return 'report has no known evidence'
  if (typeof r.unit !== 'string' || !UNITS.has(r.unit)) return 'report has no known unit'
  if (typeof r.blockedNow !== 'boolean') return 'report has no blockedNow'
  return {
    generatedAt,
    status: r.status as ClaudishAllowanceView['status'],
    evidence: r.evidence as ClaudishAllowanceView['evidence'],
    unit: r.unit as ClaudishAllowanceView['unit'],
    blockedNow: r.blockedNow,
  }
}

/** Each section's shape check: what is missing, or null when it decodes. */
function sectionMissing(r: Json, section: string): string | null {
  switch (section) {
    case 'burn':
    case 'combined':
    case 'trajectory':
      return isObject(r[section]) ? null : `report has no ${section}`
    case 'accounts':
    case 'alerts':
      return Array.isArray(r[section]) ? null : `report has no ${section} array`
    default:
      return null
  }
}

/**
 * A version 1 report, whole or the named sections of one, → the view and the parts it carries
 * (a part not carried is its empty value, for the poll to fill from the last answer). A string
 * naming what is missing when it does not decode.
 */
function viewOf(r: Json, sections: readonly string[]): { view: ClaudishAllowanceView; parts: ClaudishAllowancePart[] } | string {
  const header = headerOf(r)
  if (typeof header === 'string') return header
  for (const section of sections) {
    const missing = sectionMissing(r, section)
    if (missing !== null) return missing
  }
  const has = (section: string) => sections.includes(section)
  const { byLabel, byId } = numbering(r.accounts)
  // A burn section in any unit but cu/h is dropped (rates null) rather than guessed at; one that names no unit is taken as cu/h.
  const burn = has('burn') && isObject(r.burn) && (r.burn.unit === undefined || r.burn.unit === RATE_UNIT) ? r.burn : null
  const combined = has('combined') && isObject(r.combined) ? r.combined : null
  const trajectory = has('trajectory') && isObject(r.trajectory) ? r.trajectory : null
  // trajectory.blocked[] is not read: the ╳ comes only from alerts and blockedNow (the alerts' verdict).
  // trajectory.slower.blocked[] is read, for the slower row only (claudish has no alerts for that scenario).
  const view: ClaudishAllowanceView = {
    ...header,
    rate: { short: num(burn?.short), long: num(burn?.long), safe: num(burn?.sustainable) },
    accounts: has('accounts') ? accountsOf(r.accounts) : [],
    pool: {
      remaining: num(combined?.remainingNow),
      capacity: num(combined?.capacity),
    },
    gaps: has('alerts') ? gapsOf(r.alerts, byLabel) : [],
    refills: trajectory ? refillsOf(trajectory.resets, byLabel) : [],
    forecast: trajectory ? forecastOf(trajectory.forecast) : [],
    switches: trajectory ? switchesOf(trajectory.switches, byId) : null,
  }
  const history = trajectory ? historyOf(trajectory.historyByAccount, byId) : null
  if (history !== null) view.history = history
  const slower = trajectory ? slowerOf(trajectory.slower, byId) : null
  if (slower !== null) view.slower = slower
  const parts = [...new Set(sections.flatMap(s => (PART_OF[s] ? [PART_OF[s]] : [])))]
  return { view, parts }
}

/** The whole report's sections, in the order a whole report is checked. */
const WHOLE: readonly string[] = ['burn', 'combined', 'trajectory', 'accounts', 'alerts']

// ── the adapter ───────────────────────────────────────────────────────────────

/**
 * One `allowance_status` answer → what it says. An answer listing `sections` is a partial report of
 * exactly those (an unknown name is skipped); without the list it is a whole report.
 */
export function decodeAllowance(result: McpToolResult | Error): AllowanceAnswer {
  const envelope = classifyEnvelope(result, CAPABILITY)
  if (envelope.kind !== 'body') return envelope
  const { body } = envelope
  if (body.allowance === null) return { kind: 'none', reason: short(body.reason ?? '') }
  if (!isObject(body.allowance)) return { kind: 'garbled', reason: 'answer has no allowance report' }
  const listed = body.sections
  if (listed !== undefined && !(Array.isArray(listed) && listed.every(s => typeof s === 'string'))) {
    return { kind: 'garbled', reason: 'answer has a sections field that is not a list of names' }
  }
  const decoded = viewOf(body.allowance, listed ?? WHOLE)
  if (typeof decoded === 'string') return { kind: 'garbled', reason: decoded }
  return listed === undefined ? { kind: 'report', view: decoded.view } : { kind: 'report', view: decoded.view, parts: decoded.parts }
}

/** One slice of the allowance report (the band's by default), asked of one server. */
export async function fetchAllowance(call: McpCall, server: string, ask: AllowanceAsk = 'band'): Promise<AllowanceAnswer> {
  return decodeAllowance(await settleCall(call(server, TOOL, allowanceArgs(ask))))
}

/** An answer that came from claudish's contract: the server under that name is claudish, whatever it said. */
function fromContract(answer: AllowanceAnswer): boolean {
  return answer.kind === 'report' || answer.kind === 'none' || answer.kind === 'declines' || answer.kind === 'refused'
}

/**
 * Asks each candidate in order (the band's slice) and keeps the first whose answer came from the
 * contract. When none did: the precontract answer when any candidate answered one (an older
 * claudish is there), else the last answer (a rejection, or a garbled body).
 */
export async function resolveServer(call: McpCall, candidates: readonly string[]): Promise<AllowanceResolution> {
  let precontract: AllowanceAnswer | null = null
  let last: AllowanceAnswer = { kind: 'unanswered', reason: 'no claudish server to ask' }
  for (const server of candidates) {
    const answer = await fetchAllowance(call, server)
    if (fromContract(answer)) return { server, answer }
    if (answer.kind === 'precontract' && precontract === null) precontract = answer
    last = answer
  }
  return { server: null, answer: precontract ?? last }
}

/** The RunSource's allowance half, over the mod's one MCP closure (register.tsx joins it to the run feeds). */
export function makeAllowanceSource(call: McpCall): Pick<RunSource, 'allowance' | 'resolveAllowance'> {
  return {
    allowance: (server, ask) => fetchAllowance(call, server, ask),
    resolveAllowance: candidates => resolveServer(call, candidates),
  }
}
