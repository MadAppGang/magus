// The scripted allowance_status answers, pure, shared by the engine-kit fake (fake-claudish.ts) and
// the live fake MCP server (tests/claudish-status/fake-claudish-server.ts). Imports only scenario.ts,
// which imports nothing: it runs under `claude plugin test` (no Node) and under bun alike.
//
// Golden answers: claudish's own allowance_status TEXTS, copied VERBATIM from claudish
// packages/cli/src/auth/accounts/allowance-status-golden.ts on branch feat/allowance-report-fields
// at commit 824ce22f (UNRELEASED: the report's T1–T6 fields). The same texts are the files in
// tests/claudish-status/allowance/testdata/ (PROVENANCE.md there); on a claudish contract bump,
// re-copy both.
//
// The fakes answer as that claudish answers a `sections` argument: the report's header and only
// the named sections, with a sorted top-level `sections` list; an empty list or an unknown name is
// claudish's own invalid_args. `ignores-sections` answers as claudish 14.5.x does: the whole report
// whatever it is asked.

import { contractError, precontractUnknownTool } from './scenario'

// ── golden answers (claudish feat/allowance-report-fields 824ce22f, verbatim) ─

/** Supported, a WARN alert (alerts[] and trajectory.blocked[] both carry the gap). testdata/warn.json */
export const GOLDEN_ALLOWANCE_WARN = `{"contract_version":1,"capabilities":["list","status","cancel","capture","capture_since_seq","capture_spans","resize","allowance"],"allowance":{"schema":"claudish.allowance.v1","generatedAt":"2026-10-26T09:00:00.000Z","forecastAt":"2026-10-26T08:57:12.000Z","provider":"openai-codex","strategy":"lookahead","alertModel":"ebr","evidence":"full","unit":"cu","assumption":null,"horizonHours":168,"accounts":[{"label":"work","id":"aaaaaaaaaaaa","planClass":"pro","deliverable":0.52,"binding":"len:10080","windows":[{"key":"len:10080","displayId":"7d","usedFraction":0.48,"resetAt":"2026-10-31T09:00:00.000Z","provenance":"observed","semantics":"fixed-start"}],"lambda":null,"calibration":{"beta":"calibrated","kappa":null},"active":true,"order":0,"lostAtReset":{"at":"2026-10-31T09:00:00.000Z","p10":0,"p50":0,"p90":0.02}},{"label":"home","id":"bbbbbbbbbbbb","planClass":"plus","deliverable":0.32,"binding":"len:300","windows":[{"key":"len:10080","displayId":"7d","usedFraction":0.36,"resetAt":"2026-11-01T06:00:00.000Z","provenance":"observed","semantics":"fixed-start"},{"key":"len:300","displayId":"5h","usedFraction":0.81,"resetAt":"2026-10-26T11:00:00.000Z","provenance":"observed","semantics":"sliding"}],"lambda":null,"calibration":{"beta":"coarse","kappa":"calibrated"},"active":false,"order":1,"lostAtReset":{"at":"2026-11-01T06:00:00.000Z","p10":0,"p50":0.01,"p90":0.06}}],"combined":{"remainingNow":58000000,"capacity":100000000},"burn":{"long":410000,"short":520000,"sustainable":246000,"unit":"cu/h"},"alerts":[{"level":"warn","since":"2026-10-26T08:15:00.000Z","gapStartEpoch":1793282400000,"gapStart":{"p10":"2026-10-29T08:00:00.000Z","p25":"2026-10-29T11:00:00.000Z","p50":"2026-10-29T14:00:00.000Z","p75":"2026-10-29T17:00:00.000Z","p90":"2026-10-29T20:00:00.000Z"},"gapEnd":{"p10":"2026-10-31T09:00:00.000Z","p25":"2026-10-31T09:00:00.000Z","p50":"2026-10-31T09:00:00.000Z","p75":"2026-10-31T09:00:00.000Z","p90":"2026-10-31T09:00:00.000Z"},"gapHours":{"p10":31,"p25":37,"p50":43,"p75":49,"p90":55},"pGap":0.86,"binding":[{"account":"work","window":"7d"},{"account":"home","window":"7d"}],"remedy":{"kind":"cut","cutToPercent":60,"until":"2026-10-31T09:00:00.000Z","pauseHours":14,"reason":null,"text":"cut to 60 % of current rate until Sat 09:00, or pause 14 h"}}],"blockedNow":false,"status":"ok","trajectory":{"history":[{"at":"2026-10-26T06:00:00.000Z","remaining":0.61,"provenance":"observed"},{"at":"2026-10-26T07:00:00.000Z","remaining":0.6,"provenance":"observed"},{"at":"2026-10-26T08:00:00.000Z","remaining":0.59,"provenance":"observed"},{"at":"2026-10-26T09:00:00.000Z","remaining":0.58,"provenance":"observed"}],"historyByAccount":[{"accountId":"aaaaaaaaaaaa","history":[{"at":"2026-10-26T06:00:00.000Z","remaining":0.29,"provenance":"observed"},{"at":"2026-10-26T07:00:00.000Z","remaining":0.28,"provenance":"observed"},{"at":"2026-10-26T08:00:00.000Z","remaining":0.27,"provenance":"observed"},{"at":"2026-10-26T09:00:00.000Z","remaining":0.26,"provenance":"observed"}]},{"accountId":"bbbbbbbbbbbb","history":[{"at":"2026-10-26T06:00:00.000Z","remaining":0.32,"provenance":"observed"},{"at":"2026-10-26T07:00:00.000Z","remaining":0.32,"provenance":"observed"},{"at":"2026-10-26T08:00:00.000Z","remaining":0.32,"provenance":"observed"},{"at":"2026-10-26T09:00:00.000Z","remaining":0.32,"provenance":"observed"}]}],"forecast":[{"at":"2026-10-27T09:00:00.000Z","p10":0.38,"p50":0.45,"p90":0.5,"pBlocked":0},{"at":"2026-10-28T09:00:00.000Z","p10":0.16,"p50":0.27,"p90":0.36,"pBlocked":0.02},{"at":"2026-10-29T09:00:00.000Z","p10":0,"p50":0.08,"p90":0.21,"pBlocked":0.31},{"at":"2026-10-30T09:00:00.000Z","p10":0,"p50":0,"p90":0.04,"pBlocked":0.86},{"at":"2026-10-31T09:00:00.000Z","p10":0.48,"p50":0.5,"p90":0.5,"pBlocked":0}],"resets":[{"at":"2026-10-31T09:00:00.000Z","account":"work","window":"7d","projected":false},{"at":"2026-11-01T06:00:00.000Z","account":"home","window":"7d","projected":false}],"blocked":[{"from":"2026-10-29T14:00:00.000Z","to":"2026-10-31T09:00:00.000Z","kind":"7d","probability":0.86}],"switches":[{"accountId":"bbbbbbbbbbbb","soonest":"2026-10-28T09:00:00.000Z","usual":"2026-10-28T20:00:00.000Z","latest":"2026-10-29T06:00:00.000Z","probability":0.97},{"accountId":"aaaaaaaaaaaa","soonest":"2026-10-31T09:00:00.000Z","usual":"2026-10-31T09:00:00.000Z","latest":"2026-10-31T09:00:00.000Z","probability":0.86}],"spark48":"▇▇▇▆▆▆▅▅▅▄▄▄▃▃▃▂▂▂▁▁▁   ▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒┊▁▁▁"},"sessions":[{"session":"1a2b3c4d","parent":"5e6f7a8b","account":"work","window":"7d","share":0.38,"usedFraction":0.19,"cu":19000000,"tokens":{"in":41200000,"out":900000,"cacheRead":35000000,"cacheWrite":0},"models":{"gpt-6-astra":412},"exactness":"pro-rata","firstAt":"2026-10-26T01:12:00.000Z","lastAt":"2026-10-26T08:55:00.000Z"},{"session":"9f8e7d6c","parent":null,"account":"work","window":"7d","share":0.21,"usedFraction":0.11,"cu":11000000,"tokens":{"in":22000000,"out":400000,"cacheRead":18500000,"cacheWrite":0},"models":{"gpt-6-astra":230},"exactness":"pro-rata","firstAt":"2026-10-25T13:40:00.000Z","lastAt":"2026-10-26T07:30:00.000Z"},{"session":"unattributed","parent":null,"account":"all","window":"7d","share":0.12,"usedFraction":0.06,"cu":6000000,"tokens":{"in":0,"out":0,"cacheRead":0,"cacheWrite":0},"models":{},"exactness":"external-unidentified","firstAt":"2026-10-24T09:00:00.000Z","lastAt":"2026-10-26T09:00:00.000Z"}]}}`

/** Supported, `insufficient-evidence`. testdata/no-evidence.json */
export const GOLDEN_ALLOWANCE_NO_EVIDENCE = `{"contract_version":1,"capabilities":["list","status","cancel","capture","capture_since_seq","capture_spans","resize","allowance"],"allowance":{"schema":"claudish.allowance.v1","generatedAt":"2026-10-26T09:00:00.000Z","forecastAt":null,"provider":"openai-codex","strategy":"sticky","alertModel":"sticky","evidence":"none","unit":"account-fraction","assumption":"equal-capacity","horizonHours":168,"accounts":[],"combined":{"remainingNow":null,"capacity":null},"burn":{"long":null,"short":null,"sustainable":null,"unit":"account-fraction/h"},"alerts":[],"blockedNow":false,"status":"insufficient-evidence","trajectory":{"history":[],"historyByAccount":[],"forecast":[],"resets":[],"blocked":[],"switches":[],"spark48":""},"sessions":[]}}`

/** Supported, `allowance: null` with a reason (no account pool). testdata/unavailable.json */
export const GOLDEN_ALLOWANCE_UNAVAILABLE = `{"contract_version":1,"capabilities":["list","status","cancel","capture","capture_since_seq","capture_spans","resize","allowance"],"allowance":null,"reason":"no account pool is configured for openai-codex"}`

// ── the variants the fakes answer ─────────────────────────────────────────────

/**
 * What allowance_status answers:
 * - warn, no-evidence, unavailable: the golden answers above, cut to the `sections` asked;
 * - ignores-sections: the whole WARN answer whatever the `sections`, as claudish 14.5.x answers;
 * - capability-absent: the WARN answer with `allowance` taken out of its capabilities;
 * - unknown-tool-error: an error answer without a contract error body, as a claudish before 14.5 answers;
 * - unknown-tool-reject: the call rejects, as an MCP server that has no such tool may answer;
 * - refused: the contract's error body (claudish's own invalid_args).
 */
export const ALLOWANCE_VARIANTS = [
  'warn', 'no-evidence', 'unavailable', 'capability-absent', 'unknown-tool-error', 'unknown-tool-reject', 'refused',
  'ignores-sections',
] as const

export type AllowanceVariant = (typeof ALLOWANCE_VARIANTS)[number]

export function isAllowanceVariant(v: unknown): v is AllowanceVariant {
  return typeof v === 'string' && (ALLOWANCE_VARIANTS as readonly string[]).includes(v)
}

/** An answer's text, or a rejection of the call with this message. */
export type AllowanceReply = { text: string; isError: boolean } | { reject: string }

/** The MCP error an SDK server answers for a tool it does not have. */
export const ALLOWANCE_UNKNOWN_TOOL_REJECTION = 'MCP error -32602: Tool allowance_status not found'

/** The report's sections a caller may name (claudish's `sections` enum). */
export const ALLOWANCE_SECTIONS = ['accounts', 'combined', 'burn', 'alerts', 'trajectory', 'sessions'] as const

/** The report's header keys: a partial report keeps every one. */
const HEADER_KEYS = [
  'schema', 'generatedAt', 'forecastAt', 'provider', 'strategy', 'alertModel', 'evidence', 'unit', 'assumption',
  'horizonHours', 'status', 'blockedNow',
] as const

type AnswerBody = { contract_version: number; capabilities: string[]; allowance: Record<string, unknown> | null; [k: string]: unknown }

/**
 * A golden answer cut to the `sections` asked, as claudish cuts it: absent → the text unchanged
 * (the whole report, byte for byte); an empty list or an unknown name → invalid_args; otherwise the
 * header and the named sections only, and a sorted top-level `sections` beside contract_version.
 * Compact JSON, as claudish answers.
 */
export function cutToSections(text: string, sections: unknown): AllowanceReply {
  if (sections === undefined) return { text, isError: false }
  if (!Array.isArray(sections) || sections.length === 0
    || !sections.every(s => typeof s === 'string' && (ALLOWANCE_SECTIONS as readonly string[]).includes(s))) {
    return { text: contractError('invalid_args', `'sections' must be a non-empty list of ${ALLOWANCE_SECTIONS.join(', ')}`), isError: true }
  }
  const body = JSON.parse(text) as AnswerBody
  if (body.allowance === null) return { text, isError: false }
  const names = [...new Set(sections as string[])].sort()
  const report = body.allowance
  const allowance: Record<string, unknown> = {}
  for (const k of HEADER_KEYS) if (k in report) allowance[k] = report[k]
  for (const k of names) allowance[k] = report[k]
  const { contract_version, capabilities, ...rest } = body
  return { text: JSON.stringify({ contract_version, sections: names, capabilities, ...rest, allowance }), isError: false }
}

/** The `sections` of a call's arguments, if any. */
function sectionsOf(args: Readonly<Record<string, unknown>> | undefined): unknown {
  return args?.sections
}

export function allowanceReply(variant: AllowanceVariant, args?: Readonly<Record<string, unknown>>): AllowanceReply {
  switch (variant) {
    case 'warn':
      return cutToSections(GOLDEN_ALLOWANCE_WARN, sectionsOf(args))
    case 'no-evidence':
      return cutToSections(GOLDEN_ALLOWANCE_NO_EVIDENCE, sectionsOf(args))
    case 'unavailable':
      return cutToSections(GOLDEN_ALLOWANCE_UNAVAILABLE, sectionsOf(args))
    case 'ignores-sections':
      return { text: GOLDEN_ALLOWANCE_WARN, isError: false }
    case 'capability-absent': {
      const body = JSON.parse(GOLDEN_ALLOWANCE_WARN) as { capabilities: string[] }
      return cutToSections(JSON.stringify({ ...body, capabilities: body.capabilities.filter(c => c !== 'allowance') }), sectionsOf(args))
    }
    case 'unknown-tool-error':
      return { text: precontractUnknownTool('allowance_status'), isError: true }
    case 'unknown-tool-reject':
      return { reject: ALLOWANCE_UNKNOWN_TOOL_REJECTION }
    case 'refused':
      return { text: contractError('invalid_args', "'provider' must be 'codex'"), isError: true }
  }
}
