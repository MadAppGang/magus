// Pure: records, Claude Code's session files and process liveness merged into the rows the
// band and the panel draw. The tree rule (which sessions a session sees), read-time pruning,
// orphan adoption, status, since, waits and the row's jump target. No IO, no clock: every
// fact arrives as an argument, so a spec can pin each decision.

import type {
  OrchestratorRecord,
  OrchestratorRow,
  OrchestratorRowDep,
  OrchestratorStatus,
  OrchestratorTarget,
  OrchestratorWaiter,
} from '../../types'
import { isFamilyKey, parseRecord, progressOf, resolveDeps, sameProcess, type SessionTargetState } from '../../scripts/lib/state-core'
import { STALE_RECORD_MS } from './domain'
import { targetOf } from './mux'

/** What the mod keeps of `<config dir>/sessions/<pid>.json`. Missing fields read as null. */
export type SessionFile = {
  pid: number
  sessionId: string | null
  procStart: string | null
  status: string | null
  waitingFor: string | null
  name: string | null
  cwd: string | null
  tmux: string | null
  statusUpdatedAt: number | null
  updatedAt: number | null
}

/** Where the mod reads: the orchestrator state dir and Claude Code's session files. */
export type Paths = { stateDir: string; sessionsDir: string }

/**
 * The state dir is `ORCHESTRATOR_STATE_DIR` when it is absolute, else `<home>/.claude/orchestrator`
 * (a relative override is ignored, not resolved against whatever the cwd happens to be);
 * the session files live in `<CLAUDE_CONFIG_DIR or home/.claude>/sessions`. Null without an
 * absolute home or state dir to stand on.
 */
export function pathsOf(env: { home?: string; claudeConfigDir?: string; stateDir?: string }): Paths | null {
  const home = env.home && env.home.startsWith('/') ? env.home.replace(/\/+$/, '') : null
  const fromEnv = env.stateDir?.trim()
  const stateDir = fromEnv && fromEnv.startsWith('/')
    ? fromEnv.replace(/\/+$/, '') || '/'
    : home === null ? null : `${home}/.claude/orchestrator`
  const config = env.claudeConfigDir?.trim() || (home === null ? null : `${home}/.claude`)
  if (stateDir === null || config === null) return null
  return { stateDir, sessionsDir: `${config.replace(/\/+$/, '')}/sessions` }
}

export function aliasPathOf(paths: Paths, sessionId: string): string {
  return `${paths.stateDir}/by-session/${sessionId}`
}

export function identityPathOf(paths: Paths, key: string): string {
  return `${paths.stateDir}/sessions/${key}.json`
}

export function progressPathOf(paths: Paths, key: string): string {
  return `${paths.stateDir}/progress/${key}.json`
}

/** A record file's key from its name in `sessions/`: `<key>.json`, never a `*.tmp` leftover. */
export function keyOfFileName(name: string): string | null {
  if (!name.endsWith('.json')) return null
  const key = name.slice(0, -'.json'.length)
  return isFamilyKey(key) ? key : null
}

/** A session file listing keeps only these names (the directory also holds `*.key` files). */
export const SESSION_FILE_RE = /^\d+\.json$/

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** One session file's text, or null when it is not JSON or carries no numeric pid. Never throws. */
export function parseSessionFile(text: string): SessionFile | null {
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof o !== 'object' || o === null) return null
  const r = o as Record<string, unknown>
  const pid = num(r.pid)
  if (pid === null || !Number.isInteger(pid) || pid <= 0) return null
  return {
    pid,
    sessionId: str(r.sessionId),
    procStart: str(r.procStart),
    status: str(r.status),
    waitingFor: str(r.waitingFor),
    name: str(r.name),
    cwd: str(r.cwd),
    tmux: str(r.tmux),
    statusUpdatedAt: num(r.statusUpdatedAt),
    updatedAt: num(r.updatedAt),
  }
}

/** Both files of one key, read raw: the identity's text and the progress file's (null when missing). */
export type RecordFiles = { identity: string; progress: string | null }

/** Parses every key's files; a bad identity file drops the key. */
export function parseRecords(files: ReadonlyMap<string, RecordFiles>): OrchestratorRecord[] {
  const out: OrchestratorRecord[] = []
  for (const [key, f] of files) {
    const record = parseRecord(f.identity, f.progress)
    if (record !== null && record.key === key) out.push(record as OrchestratorRecord)
  }
  return out
}

// ── the tree rule ──────────────────────────────────────────────────────────────

/** One drawn position: a key and how deep it sits in the drawn tree. */
export type TreeEntry = { key: string; depth: number; adopted: boolean }

function childrenOf(records: readonly OrchestratorRecord[]): Map<string, OrchestratorRecord[]> {
  const byParent = new Map<string, OrchestratorRecord[]>()
  for (const r of records) {
    if (r.parent === null) continue
    const list = byParent.get(r.parent) ?? []
    list.push(r)
    byParent.set(r.parent, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key))
  return byParent
}

/**
 * The orphans a triage lists: records of its product whose role is not triage and whose
 * `parent` is null or names a key with no record. Sorted by creation.
 */
export function orphansOf(triage: OrchestratorRecord, records: readonly OrchestratorRecord[]): OrchestratorRecord[] {
  const keys = new Set(records.map(r => r.key))
  return records
    .filter(r => r.product === triage.product && r.role !== 'triage' && r.key !== triage.key && (r.parent === null || !keys.has(r.parent)))
    .sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key))
}

/**
 * The drawn tree of `selfKey`: its ancestors (the parent chain upward, top first), itself,
 * then every descendant depth first. A triage also lists its product's orphans, marked
 * adopted, each with its descendants. Siblings never appear. A key appears once; a parent
 * cycle stops the walk. Empty when `selfKey` has no record.
 */
export function familyTree(selfKey: string, records: readonly OrchestratorRecord[]): TreeEntry[] {
  const byKey = new Map(records.map(r => [r.key, r] as const))
  const self = byKey.get(selfKey)
  if (!self) return []
  const ancestors: OrchestratorRecord[] = []
  const seen = new Set<string>([selfKey])
  for (let p = self.parent; p !== null; ) {
    const r = byKey.get(p)
    if (!r || seen.has(r.key)) break
    seen.add(r.key)
    ancestors.unshift(r)
    p = r.parent
  }
  const out: TreeEntry[] = ancestors.map((r, i) => ({ key: r.key, depth: i, adopted: false }))
  const kids = childrenOf(records)
  const walk = (r: OrchestratorRecord, depth: number, adopted: boolean) => {
    out.push({ key: r.key, depth, adopted })
    for (const c of kids.get(r.key) ?? []) {
      if (seen.has(c.key)) continue
      seen.add(c.key)
      walk(c, depth + 1, false)
    }
  }
  walk(self, ancestors.length, false)
  if (self.role === 'triage') {
    for (const o of orphansOf(self, records)) {
      if (seen.has(o.key)) continue
      seen.add(o.key)
      walk(o, ancestors.length + 1, true)
    }
  }
  return out
}

/** The keys `familyTree` draws, in its order. */
export function visibleKeys(selfKey: string, records: readonly OrchestratorRecord[]): string[] {
  return familyTree(selfKey, records).map(e => e.key)
}

// ── liveness ───────────────────────────────────────────────────────────────────

/** A record's process as the tick found it: live or not, and the session file adopted for it. */
export type Liveness = { live: boolean; file: SessionFile | null }

/**
 * The pids one `ps` call must cover: every recorded incarnation's pid, and for a record with
 * none, the pid of each scanned session file carrying its session id.
 */
export function pidsToCheck(records: readonly OrchestratorRecord[], scanned: readonly SessionFile[]): number[] {
  const pids = new Set<number>()
  for (const r of records) {
    if (r.pid !== null && r.procStart !== null) pids.add(r.pid)
    else for (const f of scanned) if (f.sessionId === r.sessionId) pids.add(f.pid)
  }
  return [...pids].sort((a, b) => a - b)
}

/** True when the record names an incarnation (`pid` and `procStart`) to check. */
export function hasIncarnation(r: OrchestratorRecord): boolean {
  return r.pid !== null && r.procStart !== null
}

/**
 * Liveness by the recorded incarnation, never by a session file: the recorded pid must be in
 * `starts` (pid → `ps` lstart) with the recorded start time. Only then is `files.get(pid)`
 * adopted, and only when its own `procStart` matches the record's too. A record with no
 * incarnation is matched to a scanned file whose `sessionId` equals its own, live when that
 * file's pid passes the same check.
 */
export function livenessOf(
  r: OrchestratorRecord,
  starts: ReadonlyMap<number, string>,
  files: ReadonlyMap<number, SessionFile>,
  scanned: readonly SessionFile[],
): Liveness {
  if (r.pid !== null && r.procStart !== null) {
    const live = sameProcess(r.procStart, starts.get(r.pid) ?? null)
    if (!live) return { live: false, file: null }
    const f = files.get(r.pid)
    return { live: true, file: f && f.pid === r.pid && sameProcess(r.procStart, f.procStart) ? f : null }
  }
  for (const f of scanned) {
    if (f.sessionId !== r.sessionId) continue
    if (sameProcess(f.procStart, starts.get(f.pid) ?? null)) return { live: true, file: f }
  }
  return { live: false, file: null }
}

const PROBLEM_MAX = 60

const CONTROL_RE = /[\u0000-\u001f\u007f]/g

/**
 * The first non-empty line of `text`, control characters turned to spaces and runs of space
 * collapsed, cut to PROBLEM_MAX characters (code points, so a surrogate pair is never split).
 * `dropDigits` also removes every run of digits.
 */
function firstLine(text: string, dropDigits = false): string {
  const raw = text.split(/\r?\n/).find(l => l.trim() !== '') ?? ''
  const plain = (dropDigits ? raw.replace(/\d+/g, '') : raw).replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...plain]
  return chars.length > PROBLEM_MAX ? `${chars.slice(0, PROBLEM_MAX - 1).join('')}…` : plain
}

/**
 * Why a `ps` run gave no snapshot, short: `ps refused (<the error's first line>)` when it could
 * not start, `ps exited <code> (<stderr's first line>)` when it exited non-zero; null when it
 * succeeded. A refusal's message loses its digit runs (pids, timings), so a refusal that
 * repeats reads the same and the rows are not rewritten for it.
 */
export function psProblem(r: { exitCode: number; stderr: string } | { refused: string }): string | null {
  if ('refused' in r) {
    const why = firstLine(r.refused, true)
    return why === '' ? 'ps refused' : `ps refused (${why})`
  }
  if (r.exitCode === 0) return null
  const why = firstLine(r.stderr)
  return why === '' ? `ps exited ${r.exitCode}` : `ps exited ${r.exitCode} (${why})`
}

/** A record skipped at read time: its session is gone and it was not updated for 24 h. */
export function isStale(r: OrchestratorRecord, live: boolean, now: number): boolean {
  return !live && now - r.updatedAt > STALE_RECORD_MS
}

// ── status ─────────────────────────────────────────────────────────────────────

/** Claude Code's session status, mapped: busy and shell work, waiting waits, anything else is idle. */
export function sessionActivity(status: string | null): 'working' | 'waiting' | 'idle' {
  if (status === 'busy' || status === 'shell') return 'working'
  if (status === 'waiting') return 'waiting'
  return 'idle'
}

export type StatusView = { status: OrchestratorStatus; needsYou: boolean; since: number | null; waits: string | null }

/** `<kind> <ref>` of a dependency, as `waits` shows it. */
export function depLabel(d: { kind: string; ref: string }): string {
  return `${d.kind} ${d.ref}`
}

/**
 * The status of one record, first match wins: done and not live; not live (gone); done;
 * Claude Code waiting on the user; blocked; busy or shell (working); an open dependency
 * (waiting, not needing the user); idle. `known: false` (liveness unreadable) gives `unknown`
 * where liveness would decide.
 */
export function statusOf(r: OrchestratorRecord, live: Liveness, deps: readonly OrchestratorRowDep[], known = true): StatusView {
  const file = live.file
  if (!known) {
    if (r.state === 'done') return { status: 'done', needsYou: false, since: r.doneAt, waits: null }
    if (r.blocked) return { status: 'blocked', needsYou: true, since: r.blocked.since, waits: r.blocked.reason }
    return { status: 'unknown', needsYou: false, since: null, waits: null }
  }
  if (!live.live && r.state === 'done') return { status: 'done', needsYou: false, since: r.doneAt, waits: null }
  if (!live.live) return { status: 'gone', needsYou: false, since: file?.updatedAt ?? r.updatedAt, waits: null }
  if (r.state === 'done') return { status: 'done', needsYou: false, since: r.doneAt, waits: null }
  const activity = sessionActivity(file?.status ?? null)
  if (activity === 'waiting') return { status: 'waiting', needsYou: true, since: file?.statusUpdatedAt ?? null, waits: file?.waitingFor ?? null }
  if (r.blocked) return { status: 'blocked', needsYou: true, since: r.blocked.since, waits: r.blocked.reason }
  if (activity === 'working') return { status: 'working', needsYou: false, since: file?.statusUpdatedAt ?? null, waits: null }
  const open = deps.find(d => d.open)
  if (open) return { status: 'waiting', needsYou: false, since: open.since, waits: depLabel(open) }
  return { status: 'idle', needsYou: false, since: file?.statusUpdatedAt ?? null, waits: null }
}

/** A session dependency's targets as the reader sees them: every record of the product whose key or name is `ref`. */
export function sessionResolver(
  product: string,
  records: readonly OrchestratorRecord[],
  liveOf: (key: string) => boolean,
): (ref: string) => SessionTargetState[] {
  return ref =>
    records
      .filter(r => r.product === product && (r.key === ref || r.name === ref))
      .map(r => (r.state === 'done' ? 'done' : liveOf(r.key) ? 'live' : 'gone'))
}

// ── labels ─────────────────────────────────────────────────────────────────────

/**
 * A row's label: name ?? ticket id ?? key. A name led by the lower-cased ticket id and `-`
 * reads `<ticket id> <rest of the name>`, and `labelTicket` names the id it leads with.
 */
export function ticketLabel(
  name: string | null,
  ticket: { id: string } | null,
  key: string,
): { label: string; labelTicket: string | null } {
  if (name !== null && ticket !== null && ticket.id !== '') {
    const lead = `${ticket.id.toLowerCase()}-`
    if (name.startsWith(lead) && name.length > lead.length) return { label: `${ticket.id} ${name.slice(lead.length)}`, labelTicket: ticket.id }
  }
  return { label: name ?? ticket?.id ?? key, labelTicket: null }
}

/**
 * The one record a session dependency's ref names (key or name, of `product`), as
 * `sessionResolver` matches it; null when none or more than one does.
 */
function sessionTarget(product: string, records: readonly OrchestratorRecord[], ref: string): OrchestratorRecord | null {
  const matches = records.filter(r => r.product === product && (r.key === ref || r.name === ref))
  return matches.length === 1 ? matches[0]! : null
}

// ── rows ───────────────────────────────────────────────────────────────────────

export type MergeInput = {
  selfKey: string
  /** every parsed record in the state dir */
  records: readonly OrchestratorRecord[]
  /** liveness by key; a key missing reads as not live */
  live: ReadonlyMap<string, Liveness>
  /** false when the session files or `ps` could not be read at all */
  known: boolean
  now: number
}

/**
 * The rows of `selfKey`'s family, in tree order. Records gone for more than 24 h are skipped
 * (never self). Session dependencies resolve against every non-skipped record of self's
 * product, before the tree rule picks the rows; each row also lists the unfinished, not gone
 * sessions of the product, drawn or not, whose open session dependency names it.
 */
export function mergeRows(input: MergeInput): OrchestratorRow[] {
  const { selfKey, now, known } = input
  const liveOf = (key: string) => input.live.get(key)?.live ?? false
  const kept = input.records.filter(r => r.key === selfKey || !known || !isStale(r, liveOf(r.key), now))
  const self = kept.find(r => r.key === selfKey)
  if (!self) return []
  const byKey = new Map(kept.map(r => [r.key, r] as const))
  const resolve = sessionResolver(self.product, kept, liveOf)
  const nameOf = (r: OrchestratorRecord) => input.live.get(r.key)?.file?.name ?? r.name
  const labelOf = (r: OrchestratorRecord) => ticketLabel(nameOf(r), r.ticket, r.key)
  const depsOf = (r: OrchestratorRecord): OrchestratorRowDep[] =>
    (resolveDeps(r, resolve) as OrchestratorRowDep[]).map(d => {
      const to = d.kind === 'session' ? sessionTarget(self.product, kept, d.ref) : null
      return { ...d, label: to === null ? null : labelOf(to).label }
    })
  // the reverse edges: every unfinished, not gone session of the product with an open session
  // dependency on a record, in record order
  const waiters = new Map<string, OrchestratorWaiter[]>()
  for (const w of kept) {
    // a gone session waits on nobody; with liveness unreadable, nobody is known gone
    if (w.product !== self.product || w.state === 'done' || (known && !liveOf(w.key))) continue
    for (const d of resolveDeps(w, resolve)) {
      if (d.kind !== 'session' || !d.open) continue
      const to = sessionTarget(self.product, kept, d.ref)
      if (to === null || to.key === w.key) continue
      const list = waiters.get(to.key) ?? []
      if (!list.some(x => x.key === w.key)) list.push({ key: w.key, label: labelOf(w).label, role: w.role })
      waiters.set(to.key, list)
    }
  }
  return familyTree(selfKey, kept).flatMap(entry => {
    const r = byKey.get(entry.key)
    if (!r) return []
    const live = input.live.get(r.key) ?? { live: false, file: null }
    const deps = depsOf(r)
    const view = statusOf(r, live, deps, known)
    const name = nameOf(r)
    const { label, labelTicket } = labelOf(r)
    const target: OrchestratorTarget | null = targetOf(r, live.file)
    const row: OrchestratorRow = {
      key: r.key,
      sessionId: r.sessionId,
      depth: entry.depth,
      role: r.role,
      name,
      label,
      labelTicket,
      ticket: r.ticket,
      status: view.status,
      since: view.since,
      needsYou: view.needsYou,
      waits: view.waits,
      progress: progressOf(r.tasks),
      tasks: r.tasks,
      deps: [...deps].sort((a, b) => Number(b.open) - Number(a.open) || a.since - b.since),
      holds: r.holds,
      isSelf: r.key === selfKey,
      adopted: entry.adopted,
      target,
      waitedOnBy: waiters.get(r.key) ?? [],
    }
    return [row]
  })
}

/** True when a row is still in motion: neither done nor gone. */
export function isActive(row: OrchestratorRow): boolean {
  return row.status !== 'done' && row.status !== 'gone'
}

/** True when two row lists draw the same. */
export function sameRows(a: readonly OrchestratorRow[], b: readonly OrchestratorRow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
