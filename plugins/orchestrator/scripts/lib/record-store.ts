// The one IO module that writes orchestration state. The SessionStart hook,
// the `orch-state` CLI and the launcher all go through it.
//
// Layout under the state dir:
//
//   sessions/<key>.json      identity: written only by bindSession (hook, register)
//   progress/<key>.json      progress: written only by updateProgress (the owner's CLI verbs)
//   by-session/<sessionId>   the key, one line: an alias that finds a record, never ownership
//   claims/<launch id>.json  a launch claim: written once by the launcher, deleted only by prune
//
// Each file has one writer, and no session writes another session's files.
// Every write goes to `<file>.<pid>.<rand>.tmp` and is renamed over the file,
// so a reader always sees a whole file. A file that must be created exactly
// once (a claim's record, a triage key) is published with `linkSync`, which
// fails when the file exists. There is no lock.
//
// Ownership: a record is owned by the session whose id equals its identity's
// `sessionId`. Liveness is by the recorded incarnation (pid + procStart),
// checked with `ps`, never by a session file alone. Binding never takes a
// record from a live session other than the caller's own process.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type OrchestratorBindFacts,
  type OrchestratorClaim,
  type OrchestratorHerdr,
  type OrchestratorIdentity,
  type OrchestratorOp,
  type OrchestratorProgress,
  type OrchestratorRecord,
  type OrchestratorRole,
  type OrchestratorTicket,
  applyOp,
  isFamilyKey,
  isSessionId,
  mergeRecord,
  parseClaim,
  parseIdentity,
  parseProgress,
  parsePsStarts,
  psArgv,
  rebindIdentity,
  recordFromClaim,
  sameProcess,
  sessionKey,
  triageKey,
} from "./state-core.ts";

/** Where the store reads and writes. */
export type StoreContext = {
  /** The orchestrator state dir (`stateDir(env, home)` from window.ts). */
  stateDir: string;
  /** Claude Code's config dir: `CLAUDE_CONFIG_DIR`, else `<home>/.claude`. */
  claudeConfigDir: string;
};

/** A process Claude Code runs a session in, as its session file records it. */
export type Incarnation = { pid: number; procStart: string | null };

const CLAIM_MAX_AGE_MS = 24 * 3_600_000;
const TMP_MAX_AGE_MS = 3_600_000;
const OWN_PID_MAX_STEPS = 4;

/** Claude Code's config dir: `CLAUDE_CONFIG_DIR` when set and non-empty, else `<home>/.claude`. */
export function claudeConfigDirOf(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const fromEnv = env.CLAUDE_CONFIG_DIR?.trim();
  return fromEnv ? fromEnv : join(home, ".claude");
}

export function identityPath(ctx: StoreContext, key: string): string {
  return join(ctx.stateDir, "sessions", `${key}.json`);
}

export function progressPath(ctx: StoreContext, key: string): string {
  return join(ctx.stateDir, "progress", `${key}.json`);
}

export function aliasPath(ctx: StoreContext, sessionId: string): string {
  return join(ctx.stateDir, "by-session", sessionId);
}

export function claimPath(ctx: StoreContext, launchId: string): string {
  return join(ctx.stateDir, "claims", `${launchId}.json`);
}

// --- files ------------------------------------------------------------------------

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function tempPathFor(path: string): string {
  return `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
}

/** Writes `text` to a temp file beside `path` and renames it over `path`. Throws on failure. */
function writeAtomic(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temp = tempPathFor(path);
  try {
    writeFileSync(temp, text);
    renameSync(temp, path);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/**
 * Publishes `text` at `path` only when nothing is there: a temp file is
 * hard-linked to `path`, which fails when `path` exists. True when this call
 * created the file; false when it already existed. Throws on any other failure.
 */
function createExclusive(path: string, text: string): boolean {
  mkdirSync(join(path, ".."), { recursive: true });
  const temp = tempPathFor(path);
  writeFileSync(temp, text);
  try {
    linkSync(temp, path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    rmSync(temp, { force: true });
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// --- reads ------------------------------------------------------------------------

export function readIdentity(ctx: StoreContext, key: string): OrchestratorIdentity | null {
  if (!isFamilyKey(key)) return null;
  const text = readText(identityPath(ctx, key));
  return text === null ? null : parseIdentity(text);
}

export function readProgress(ctx: StoreContext, key: string): OrchestratorProgress {
  return parseProgress(isFamilyKey(key) ? readText(progressPath(ctx, key)) : null, key);
}

/** Both files of `key` merged into the read view, or null when the identity file is missing or bad. */
export function readRecord(ctx: StoreContext, key: string): OrchestratorRecord | null {
  const identity = readIdentity(ctx, key);
  return identity === null ? null : mergeRecord(identity, readProgress(ctx, key));
}

/** The key `by-session/<sessionId>` names, or null. An alias alone never grants ownership. */
export function aliasKey(ctx: StoreContext, sessionId: string): string | null {
  if (!isSessionId(sessionId)) return null;
  const text = readText(aliasPath(ctx, sessionId));
  if (text === null) return null;
  const key = text.trim();
  return isFamilyKey(key) ? key : null;
}

/** The key of the record this session owns: its alias names a record whose `sessionId` is this id. */
export function ownedKey(ctx: StoreContext, sessionId: string): string | null {
  const key = aliasKey(ctx, sessionId);
  if (key === null) return null;
  return readIdentity(ctx, key)?.sessionId === sessionId ? key : null;
}

export type WriteOwnership =
  | { ok: true; key: string }
  | { ok: false; reason: "not-owned" }
  | { ok: false; reason: "live-owner"; key: string; pid: number | null }
  | { ok: false; reason: "unknown-incarnation"; key: string; pid: number | null };

/**
 * The record this process may write as `sessionId`: one it owns (`ownedKey`)
 * whose recorded incarnation is this process, or is not live. A second
 * process resuming the same session id while the first is live was refused
 * at bind, and stays refused here: `live-owner`, so its progress writes and
 * session-end cleanup never touch the first one's record. When this process
 * cannot name its own Claude Code process (`self` null) and the recorded one
 * is live, that live process may be this one or another: `unknown-incarnation`,
 * and nothing is written.
 */
export function writableKey(ctx: StoreContext, sessionId: string, self: Incarnation | null): WriteOwnership {
  const key = ownedKey(ctx, sessionId);
  const identity = key === null ? null : readIdentity(ctx, key);
  if (key === null || identity === null) return { ok: false, reason: "not-owned" };
  if (mayTakeOver(ctx, identity, self)) return { ok: true, key };
  if (self === null) return { ok: false, reason: "unknown-incarnation", key, pid: identity.pid };
  return { ok: false, reason: "live-owner", key, pid: identity.pid };
}

/** The current directory; when it no longer exists (a removed worktree), `PWD`, else `home`. */
export function safeCwd(env: Readonly<Record<string, string | undefined>>, home: string): string {
  try {
    return process.cwd();
  } catch {
    return env.PWD || home;
  }
}

export function readClaim(ctx: StoreContext, launchId: string): OrchestratorClaim | null {
  if (!isFamilyKey(launchId) || !launchId.startsWith("l-")) return null;
  const text = readText(claimPath(ctx, launchId));
  const claim = text === null ? null : parseClaim(text);
  return claim?.key === launchId ? claim : null;
}

/** Every identity in the state dir, unparseable files skipped. */
export function listIdentities(ctx: StoreContext): OrchestratorIdentity[] {
  let names: string[];
  try {
    names = readdirSync(join(ctx.stateDir, "sessions"));
  } catch {
    return [];
  }
  const out: OrchestratorIdentity[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const identity = readIdentity(ctx, name.slice(0, -".json".length));
    if (identity !== null) out.push(identity);
  }
  return out;
}

// --- processes --------------------------------------------------------------------

function spawnText(argv: string[]): string | null {
  try {
    const p = Bun.spawnSync(argv, { stdout: "pipe", stderr: "ignore" });
    return p.exitCode === 0 ? p.stdout.toString() : null;
  } catch {
    return null;
  }
}

/** `ps` start times of the given pids that are running; a pid that is not running is absent. */
export function processStarts(pids: readonly number[]): Map<number, string> {
  if (pids.length === 0) return new Map();
  const text = spawnText(psArgv(pids));
  return text === null ? new Map() : parsePsStarts(text);
}

/** True when `pid` runs and started when `procStart` says. */
export function incarnationLive(pid: number, procStart: string | null): boolean {
  if (procStart === null) return false;
  return sameProcess(procStart, processStarts([pid]).get(pid) ?? null);
}

function readSessionFile(path: string): { pid: number; sessionId: string | null; procStart: string | null } | null {
  const text = readText(path);
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    if (typeof o.pid !== "number") return null;
    return {
      pid: o.pid,
      sessionId: typeof o.sessionId === "string" ? o.sessionId : null,
      procStart: typeof o.procStart === "string" ? o.procStart : null,
    };
  } catch {
    return null;
  }
}

/**
 * Whether the session bound to `identity` is live. With a recorded incarnation,
 * the recorded pid must be running with the recorded start time. Without one,
 * Claude Code's session files are searched for one whose `sessionId` is the
 * identity's, and that file's pid and start time must pass the same check; the
 * file of `exceptPid`, when given, is skipped.
 */
export function identityLive(ctx: StoreContext, identity: OrchestratorIdentity, exceptPid: number | null = null): boolean {
  if (identity.pid !== null && identity.procStart !== null) return incarnationLive(identity.pid, identity.procStart);
  const dir = join(ctx.claudeConfigDir, "sessions");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    const file = readSessionFile(join(dir, name));
    if (file === null || file.pid === exceptPid) continue;
    if (file.sessionId === identity.sessionId && incarnationLive(file.pid, file.procStart)) return true;
  }
  return false;
}

function parentPid(pid: number): number | null {
  const text = spawnText(["ps", "-o", "ppid=", "-p", String(pid)]);
  const n = text === null ? Number.NaN : Number(text.trim());
  return Number.isInteger(n) && n > 1 ? n : null;
}

/**
 * The Claude Code process this process runs under: walking up from the parent
 * process, at most four steps, the first ancestor that has
 * `<claude config dir>/sessions/<pid>.json`, with the `procStart` that file
 * records. Null when none is found. No environment variable is read: a value
 * can be inherited by a process it does not describe, and the walk cannot.
 */
export function ownPid(claudeConfigDir: string): Incarnation | null {
  let pid: number | null = process.ppid;
  for (let step = 0; step < OWN_PID_MAX_STEPS && pid !== null && pid > 1; step++) {
    const file = readSessionFile(join(claudeConfigDir, "sessions", `${pid}.json`));
    if (file !== null && file.pid === pid) return { pid, procStart: file.procStart };
    pid = parentPid(pid);
  }
  return null;
}

/** True when the identity's recorded incarnation is `self`. */
function isSelf(identity: OrchestratorIdentity, self: Incarnation | null): boolean {
  return self !== null && identity.pid === self.pid && sameProcess(identity.procStart, self.procStart);
}

// --- writes -----------------------------------------------------------------------

/** Writes the alias `by-session/<sessionId>` → `key` unless it already names that key. */
function writeAlias(ctx: StoreContext, sessionId: string, key: string): void {
  if (aliasKey(ctx, sessionId) === key) return;
  writeAtomic(aliasPath(ctx, sessionId), `${key}\n`);
}

/**
 * Applies `op` to the progress file of `key` and writes it (temp + rename).
 * Only the owning session's CLI calls this; the caller checks ownership.
 * Returns the written progress. Throws when the write fails.
 */
export function updateProgress(ctx: StoreContext, key: string, op: OrchestratorOp, now: number): OrchestratorProgress {
  if (!isFamilyKey(key)) throw new Error(`invalid family key ${JSON.stringify(key)}`);
  const next = applyOp(readProgress(ctx, key), op, now);
  writeAtomic(progressPath(ctx, key), json(next));
  return next;
}

/** Writes a launch claim. Each launch id is fresh, so the file is written once. Throws on failure. */
export function writeClaim(ctx: StoreContext, claim: OrchestratorClaim): string {
  if (!isFamilyKey(claim.key) || !claim.key.startsWith("l-")) throw new Error(`invalid launch id ${JSON.stringify(claim.key)}`);
  const path = claimPath(ctx, claim.key);
  if (!createExclusive(path, json(claim))) throw new Error(`claim ${path} already exists`);
  return path;
}

/** sha256 of a product path, hex. */
export function productHash(product: string): string {
  return createHash("sha256").update(product).digest("hex");
}

/** What a session brings to `bindSession`. */
export type BindInput = {
  sessionId: string;
  /** `ORCHESTRATOR_CLAIM`, or null. */
  claimId: string | null;
  cwd: string;
  herdr: OrchestratorHerdr | null;
  now: number;
  /** The caller's Claude Code process (`ownPid`), or null when the walk found none. */
  self: Incarnation | null;
  /** Whether the `clear` route may run: a SessionStart with source `clear`, or `register`. */
  allowClear: boolean;
  /** Present for `register`: enables the `new` route. */
  register?: {
    role: OrchestratorRole;
    name: string | null;
    ticket: OrchestratorTicket | null;
    /** The main checkout the session runs in, computed only when a new record needs it. */
    product: () => string;
  };
};

export type BindRoute = "owned" | "resume" | "claim" | "clear" | "new";

export type BindResult =
  | { ok: true; key: string; route: BindRoute; identity: OrchestratorIdentity }
  | { ok: false; reason: "unbound" }
  | { ok: false; reason: "live-owner"; key: string; sessionId: string; pid: number | null };

function bindFacts(input: BindInput): OrchestratorBindFacts {
  return {
    sessionId: input.sessionId,
    cwd: input.cwd,
    pid: input.self?.pid ?? null,
    procStart: input.self?.procStart ?? null,
    herdr: input.herdr,
    now: input.now,
  };
}

/**
 * May this caller rebind `identity`? Only when its recorded incarnation is the
 * caller's own process, or no other process holding it is live. This holds
 * for the session's own id too: a second process resuming the same id never
 * takes a live first one's record.
 */
function mayTakeOver(ctx: StoreContext, identity: OrchestratorIdentity, self: Incarnation | null): boolean {
  return isSelf(identity, self) || !identityLive(ctx, identity, self?.pid ?? null);
}

function rebind(ctx: StoreContext, identity: OrchestratorIdentity, input: BindInput, route: BindRoute): BindResult {
  const next = rebindIdentity(identity, bindFacts(input));
  writeAtomic(identityPath(ctx, identity.key), json(next));
  writeAlias(ctx, input.sessionId, identity.key);
  return { ok: true, key: identity.key, route, identity: next };
}

/** Creates `identity` when its file does not exist yet. Null when another session created it first. */
function create(ctx: StoreContext, identity: OrchestratorIdentity, input: BindInput, route: BindRoute): BindResult | null {
  if (!createExclusive(identityPath(ctx, identity.key), json(identity))) return null;
  writeAlias(ctx, input.sessionId, identity.key);
  return { ok: true, key: identity.key, route, identity };
}

function newIdentity(key: string, input: BindInput, reg: NonNullable<BindInput["register"]>, product: string): OrchestratorIdentity {
  return {
    schema: 1,
    key,
    sessionId: input.sessionId,
    previousIds: [],
    role: reg.role,
    name: reg.name,
    ticket: reg.ticket,
    parent: null,
    product,
    cwd: input.cwd,
    pid: input.self?.pid ?? null,
    procStart: input.self?.procStart ?? null,
    herdr: input.herdr,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Binds a session to a record, or refreshes the one it owns. The routes, tried
 * in order:
 *
 * - **owned**: the record already carries this session id → refresh cwd, pid,
 *   procStart and herdr ids when the recorded incarnation is this process or
 *   is not live; while another process holding it is live, `live-owner` and
 *   nothing is written.
 * - **resume**: `by-session/<id>` names a record bound to another id → rebind
 *   it when that incarnation is not live (or is this process); otherwise the
 *   session stays unbound (`live-owner`).
 * - **claim**: `claimId` names a claim and `sessions/<launch id>.json` does not
 *   exist → create it from the claim with `linkSync`, so exactly one session
 *   wins. The claim file stays; `prune` deletes it.
 * - **clear** (when `allowClear`): no alias for this id, and a record whose
 *   recorded incarnation is this process → rebind it.
 * - **new** (`register` only): triage → `t-<hash(product)>`, created, or
 *   rebound when its owner is not live, else `live-owner`; manager or child →
 *   `s-<session id>`. A triage that takes the key from another session id, or
 *   creates it over a progress file left behind, starts with no progress: the
 *   previous triage's blocks, holds, dependencies and tasks are deleted.
 *
 * Throws when a write fails.
 */
export function bindSession(ctx: StoreContext, input: BindInput): BindResult {
  if (!isSessionId(input.sessionId)) return { ok: false, reason: "unbound" };

  const alias = aliasKey(ctx, input.sessionId);
  if (alias !== null) {
    const identity = readIdentity(ctx, alias);
    if (identity !== null) {
      if (mayTakeOver(ctx, identity, input.self)) return rebind(ctx, identity, input, identity.sessionId === input.sessionId ? "owned" : "resume");
      return { ok: false, reason: "live-owner", key: identity.key, sessionId: identity.sessionId, pid: identity.pid };
    }
  }

  if (input.claimId !== null) {
    const claim = readClaim(ctx, input.claimId);
    if (claim !== null && !existsSync(identityPath(ctx, claim.key))) {
      const created = create(ctx, recordFromClaim(claim, bindFacts(input)), input, "claim");
      if (created !== null) return created;
    }
  }

  if (input.allowClear && alias === null && input.self !== null) {
    const mine = listIdentities(ctx).find((identity) => isSelf(identity, input.self));
    if (mine !== undefined) return rebind(ctx, mine, input, "clear");
  }

  const reg = input.register;
  if (reg === undefined) return { ok: false, reason: "unbound" };

  const product = reg.product();
  const triage = reg.role === "triage";
  const key = triage ? triageKey(productHash(product)) : sessionKey(input.sessionId);
  // Two attempts: a racing session may create the key between the read and the create.
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = readIdentity(ctx, key);
    if (existing === null) {
      const created = create(ctx, newIdentity(key, input, reg, product), input, "new");
      if (created === null) continue;
      if (triage) remove(progressPath(ctx, key));
      return created;
    }
    if (!mayTakeOver(ctx, existing, input.self)) return { ok: false, reason: "live-owner", key, sessionId: existing.sessionId, pid: existing.pid };
    if (triage && existing.sessionId !== input.sessionId) remove(progressPath(ctx, key));
    return rebind(ctx, existing, input, "new");
  }
  return { ok: false, reason: "unbound" };
}

/**
 * Sets the ticket of an identity the caller owns, only while it is null. The
 * identity file has one writer per session (bind, then this, sequentially).
 */
export function fillTicket(ctx: StoreContext, identity: OrchestratorIdentity, ticket: OrchestratorTicket, now: number): OrchestratorIdentity {
  if (identity.ticket !== null) return identity;
  const next: OrchestratorIdentity = { ...identity, ticket, updatedAt: Math.max(now, identity.updatedAt + 1) };
  writeAtomic(identityPath(ctx, identity.key), json(next));
  return next;
}

// --- prune ------------------------------------------------------------------------

export type PruneResult = { records: string[]; aliases: number; claims: number; temps: number };

function mtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function remove(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * Deletes what no live session needs:
 *
 * - records (both files) whose session is not live and that were not updated
 *   for `days` days, with the aliases that name them;
 * - claims older than 24 h;
 * - `*.tmp` leftovers older than 1 h.
 *
 * A record whose session is live is never deleted, whatever its age.
 */
export function prune(ctx: StoreContext, opts: { days: number; now: number }): PruneResult {
  const result: PruneResult = { records: [], aliases: 0, claims: 0, temps: 0 };
  const cutoff = opts.now - opts.days * 86_400_000;

  for (const identity of listIdentities(ctx)) {
    const updatedAt = Math.max(identity.updatedAt, readProgress(ctx, identity.key).updatedAt);
    if (updatedAt >= cutoff || identityLive(ctx, identity)) continue;
    remove(identityPath(ctx, identity.key));
    remove(progressPath(ctx, identity.key));
    result.records.push(identity.key);
  }
  if (result.records.length > 0) {
    const gone = new Set(result.records);
    const aliasDir = join(ctx.stateDir, "by-session");
    for (const name of listDir(aliasDir)) {
      if (name.endsWith(".tmp")) continue;
      const key = readText(join(aliasDir, name))?.trim() ?? "";
      if (gone.has(key) && remove(join(aliasDir, name))) result.aliases++;
    }
  }

  const claimDir = join(ctx.stateDir, "claims");
  for (const name of listDir(claimDir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(claimDir, name);
    const text = readText(path);
    const claim = text === null ? null : parseClaim(text);
    const created = claim?.createdAt ?? mtimeMs(path);
    if (created !== null && opts.now - created > CLAIM_MAX_AGE_MS && remove(path)) result.claims++;
  }

  for (const sub of ["sessions", "progress", "by-session", "claims"]) {
    const dir = join(ctx.stateDir, sub);
    for (const name of listDir(dir)) {
      if (!name.endsWith(".tmp")) continue;
      const path = join(dir, name);
      const m = mtimeMs(path);
      if (m !== null && opts.now - m > TMP_MAX_AGE_MS && remove(path)) result.temps++;
    }
  }
  return result;
}
