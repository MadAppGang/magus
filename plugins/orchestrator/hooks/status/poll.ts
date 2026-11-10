// The tick and the capture loop. Takes a Host only.
//
// A tick: is this session in a family (its index entry exists and names a record whose
// sessionId is its own id)? If not, nothing else is read and the next check is 5 s away. If
// so: every record, one `ps` over the recorded pids, the session files of the live ones, the
// merge into rows, ROWS. The capture loop reads the shown session's screen into SCREEN once a
// second while the pane is placed.

import type { OrchestratorRecord, OrchestratorRow } from '../../types'
import { isSessionId, parseIdentity, parsePsStarts, psArgv } from '../../scripts/lib/state-core'
import {
  ACTIVE_TICK_MS,
  AGE_REFRESH_MS,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  CAPTURE_MISSES,
  CAPTURE_MS,
  GONE_SCREEN_NOTE,
  PLAIN_CHECK_MS,
  QUIET_TICK_MS,
  RUN_TIMEOUT_MS,
  SHOW_PANE_ID,
} from './domain'
import { EMPTY_ROWS, messageOf, type Host, type OrchestratorEnv } from './host'
import { screenNote } from './layout'
import {
  SESSION_FILE_RE,
  aliasPathOf,
  familyTree,
  hasIncarnation,
  identityPathOf,
  isActive,
  keyOfFileName,
  livenessOf,
  mergeRows,
  parseRecords,
  parseSessionFile,
  pathsOf,
  pidsToCheck,
  progressPathOf,
  sameRows,
  type Liveness,
  type Paths,
  type RecordFiles,
  type SessionFile,
} from './model'
import { captureArgv, ownMuxOf, type OwnMux } from './mux'
import { sameProcess } from '../../scripts/lib/state-core'

// ── module state: dies with a hot reload; the first hook after it starts the loop again ──

type Phase = 'idle' | 'scheduled' | 'running'
/** gen: the number of the one scheduled tick that may run; an earlier one fires as a no-op. */
const loop: { phase: Phase; rerun: boolean; failures: number; gen: number } = { phase: 'idle', rerun: false, failures: 0, gen: 0 }
/** The capture loop: its generation (a stop or a restart bumps it) and whether one is pending. */
const capture: { gen: number; live: boolean } = { gen: 0, live: false }
/** The environment does not change under a running process: read once per load. */
let envCache: OrchestratorEnv | null = null

export async function envOf(host: Host): Promise<OrchestratorEnv> {
  envCache ??= await host.env()
  return envCache
}

/** The multiplexer this session runs in, from its own row; none before the first tick. */
export async function ownMux(host: Host): Promise<OwnMux> {
  const { selfKey, rows } = await host.store.rows.read()
  const self = selfKey === null ? undefined : rows.find(r => r.key === selfKey)
  return ownMuxOf(self ?? null, await envOf(host))
}

// ── the loop ──────────────────────────────────────────────────────────────────

function schedule(host: Host, ms: number): void {
  const gen = ++loop.gen
  loop.phase = 'scheduled'
  host.after(ms, () => {
    if (gen === loop.gen) void tick(host)
  })
}

/** Starts the loop when none runs; otherwise does nothing (every render calls it). */
export function ensureLoop(host: Host): void {
  if (loop.phase === 'idle') schedule(host, 0)
}

/** Runs a tick now rather than at the next scheduled one: a press that changes what is drawn. */
export function kick(host: Host): void {
  if (loop.phase === 'running') loop.rerun = true
  else schedule(host, 0)
}

function backoff(): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (loop.failures - 1), BACKOFF_MAX_MS)
}

/**
 * The key of the record this session owns, or null. While the index entry is missing this is
 * one `exists` and nothing else. Ownership is the record's `sessionId`, never the entry alone.
 */
async function ownedKey(host: Host, paths: Paths, sessionId: string): Promise<string | null> {
  if (!isSessionId(sessionId)) return null
  const alias = aliasPathOf(paths, sessionId)
  if (!(await host.exists(alias))) return null
  const key = (await host.read(alias))?.trim() ?? ''
  const text = key === '' ? null : await host.read(identityPathOf(paths, key))
  const identity = text === null ? null : parseIdentity(text)
  return identity !== null && identity.key === key && identity.sessionId === sessionId ? key : null
}

async function readRecords(host: Host, paths: Paths): Promise<OrchestratorRecord[]> {
  const files = new Map<string, RecordFiles>()
  for (const entry of await host.list(`${paths.stateDir}/sessions`)) {
    const key = keyOfFileName(entry.name)
    if (key === null) continue
    const identity = await host.read(identityPathOf(paths, key))
    if (identity === null) continue
    files.set(key, { identity, progress: await host.read(progressPathOf(paths, key)) })
  }
  return parseRecords(files)
}

async function scanSessionFiles(host: Host, paths: Paths): Promise<SessionFile[]> {
  const out: SessionFile[] = []
  for (const entry of await host.list(paths.sessionsDir)) {
    if (!SESSION_FILE_RE.test(entry.name)) continue
    const text = await host.read(`${paths.sessionsDir}/${entry.name}`)
    const file = text === null ? null : parseSessionFile(text)
    if (file !== null) out.push(file)
  }
  return out
}

/**
 * Liveness of every candidate: one `ps` over the recorded pids (and, for a record with no
 * recorded incarnation, the pids of session files carrying its id), then the session file of
 * each live recorded pid. `known: false` when `ps` could not run at all.
 */
async function livenessAll(host: Host, paths: Paths, candidates: readonly OrchestratorRecord[]): Promise<{ live: Map<string, Liveness>; known: boolean }> {
  const scanned = candidates.some(r => !hasIncarnation(r)) ? await scanSessionFiles(host, paths) : []
  const pids = pidsToCheck(candidates, scanned)
  let starts = new Map<number, string>()
  let known = true
  if (pids.length > 0) {
    // ps exits non-zero when some pid is not running; what it printed still counts
    const r = await host.run(psArgv(pids), RUN_TIMEOUT_MS)
    if (r === null) known = false
    else starts = parsePsStarts(r.stdout)
  }
  const files = new Map<number, SessionFile>()
  for (const r of candidates) {
    // only the recorded incarnation's file: a pid now held by another process is never read
    if (r.pid === null || files.has(r.pid) || !sameProcess(r.procStart, starts.get(r.pid) ?? null)) continue
    const text = await host.read(`${paths.sessionsDir}/${r.pid}.json`)
    const file = text === null ? null : parseSessionFile(text)
    if (file !== null) files.set(r.pid, file)
  }
  const live = new Map<string, Liveness>()
  for (const r of candidates) live.set(r.key, livenessOf(r, starts, files, scanned))
  return { live, known }
}

/** The rows of `selfKey`'s family, read now. */
async function familyRows(host: Host, paths: Paths, selfKey: string, now: number): Promise<OrchestratorRow[]> {
  const records = await readRecords(host, paths)
  const self = records.find(r => r.key === selfKey)
  if (!self) return []
  const inTree = new Set(familyTree(selfKey, records).map(e => e.key))
  const candidates = records.filter(r => r.product === self.product || inTree.has(r.key))
  const { live, known } = await livenessAll(host, paths, candidates)
  return mergeRows({ selfKey, records: candidates, live, known, now })
}

/** One tick; then the next is scheduled by what it found. */
export async function tick(host: Host): Promise<void> {
  loop.phase = 'running'
  loop.rerun = false
  let delay = PLAIN_CHECK_MS
  try {
    const paths = pathsOf(await envOf(host))
    const sessionId = await host.sessionId()
    const selfKey = paths === null ? null : await ownedKey(host, paths, sessionId)
    const before = await host.store.rows.read()
    if (paths === null || selfKey === null) {
      if (before.selfKey !== null || before.rows.length > 0) await host.store.rows.update(() => EMPTY_ROWS)
    } else {
      const now = await host.now()
      const rows = await familyRows(host, paths, selfKey, now)
      await host.store.rows.update(prev =>
        prev.selfKey === selfKey && sameRows(prev.rows, rows) && now - prev.at < AGE_REFRESH_MS ? prev : { at: now, selfKey, rows },
      )
      if (before.selfKey === null) host.invalidate()
      delay = rows.some(isActive) ? ACTIVE_TICK_MS : QUIET_TICK_MS
    }
    loop.failures = 0
  } catch (err) {
    loop.failures += 1
    delay = backoff()
    host.debug(`orchestrator tick failed (${loop.failures}): ${messageOf(err)}`)
  }
  schedule(host, loop.rerun ? 0 : delay)
}

// ── the capture loop ─────────────────────────────────────────────────────────

/** Stops the capture loop: the pane closed, or it shows nothing to capture. */
export function stopCapture(): void {
  capture.gen += 1
  capture.live = false
}

/** Starts the capture loop when none runs (every pane render calls it). */
export function ensureCapture(host: Host): void {
  if (capture.live) return
  captureNow(host)
}

/** Captures now and keeps capturing: a Show press, or a switch to another session. */
export function captureNow(host: Host): void {
  const gen = ++capture.gen
  capture.live = true
  void captureTick(host, gen)
}

function trimScreen(stdout: string): string[] {
  const lines = stdout.replace(/\r/g, '').split('\n')
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  return lines
}

async function captureTick(host: Host, gen: number): Promise<void> {
  if (gen !== capture.gen) return
  let again = false
  try {
    again = await captureOnce(host)
  } catch (err) {
    host.debug(`orchestrator capture failed: ${messageOf(err)}`)
    again = true
  }
  if (gen !== capture.gen) return
  if (again) host.after(CAPTURE_MS, () => void captureTick(host, gen))
  else capture.live = false
}

/** One capture of the shown session; false when there is nothing (more) to capture. */
async function captureOnce(host: Host): Promise<boolean> {
  const show = await host.store.show.read()
  if (!show.open || show.key === null) return false
  if (!(await host.panes()).some(p => p.id === SHOW_PANE_ID && p.isPlaced)) return false
  const row = (await host.store.rows.read()).rows.find(r => r.key === show.key)
  if (!row || row.target === null || screenNote(row, await ownMux(host)) !== null) return false
  const key = row.key
  const screen = await host.store.screen.read()
  if (screen.key === key && screen.error === GONE_SCREEN_NOTE) return false
  const r = await host.run(captureArgv(row.target), RUN_TIMEOUT_MS)
  const now = await host.now()
  if (r !== null && r.exitCode === 0) {
    await host.store.screen.update(() => ({ key, lines: trimScreen(r.stdout), at: now, error: null, misses: 0 }))
    return true
  }
  const written = await host.store.screen.update(s => {
    const misses = (s.key === key ? s.misses : 0) + 1
    return {
      key,
      lines: s.key === key ? s.lines : [],
      at: s.key === key ? s.at : now,
      error: misses >= CAPTURE_MISSES ? GONE_SCREEN_NOTE : null,
      misses,
    }
  })
  return written.error === null
}
