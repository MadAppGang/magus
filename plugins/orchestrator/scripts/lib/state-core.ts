// Pure core of the orchestration state record: the schema of the identity,
// progress and claim files, their parsers, the progress operations, family
// keys, and the text formats the CLI, the hooks and the status mod share.
//
// No IO and no imports: nothing here reads the clock, the environment, the
// filesystem or the process table. The time, hashes and process facts are
// passed in, so every function is a plain mapping from arguments to result and
// the mod can import this file across directories.

/** The three levels of an orchestrated family. */
export type OrchestratorRole = "triage" | "manager" | "child";

export type OrchestratorTicket = { id: string; url: string | null };

export type OrchestratorHerdr = { pane: string; tab: string | null; workspace: string | null };

/** `<stateDir>/sessions/<key>.json`: written only by the binding code (SessionStart hook, `register`). */
export type OrchestratorIdentity = {
  schema: 1;
  /** The file's name: `l-<hex>` (launched), `t-<hex>` (triage), `s-<session id>` (registered by hand). */
  key: string;
  /** The session currently bound; the record is owned by the session whose id equals this. */
  sessionId: string;
  /** Session ids bound before (a /clear, a resume of an older id), newest last. */
  previousIds: string[];
  role: OrchestratorRole;
  /** Claim name or `register --name`; a fallback address only. */
  name: string | null;
  ticket: OrchestratorTicket | null;
  /** The parent's family key, never a session id. */
  parent: string | null;
  /** Main checkout of the family's triage. */
  product: string;
  cwd: string;
  /** Claude Code's pid at bind: with `procStart`, the recorded incarnation. */
  pid: number | null;
  /** That process's start time from its session file: C-locale `ps -o lstart=` form, UTC. */
  procStart: string | null;
  herdr: OrchestratorHerdr | null;
  createdAt: number;
  /** ms; strictly increasing per file. */
  updatedAt: number;
};

export type OrchestratorTask = { n: number; step: string; who: string; state: string };

export type OrchestratorDepKind = "session" | "pr" | "release";

export type OrchestratorDep = {
  kind: OrchestratorDepKind;
  /** session: a family key or a name; pr: a full URL; release: `<artifact> <version>`. */
  ref: string;
  note: string | null;
  since: number;
  doneAt: number | null;
};

export type OrchestratorHold = { what: string; since: number };

/** `<stateDir>/progress/<key>.json`: written only by the owning session's `orch-state` verbs. */
export type OrchestratorProgress = {
  schema: 1;
  key: string;
  /** +1 per write of this file. */
  rev: number;
  /** ms; strictly increasing per file. */
  updatedAt: number;
  tasks: OrchestratorTask[];
  deps: OrchestratorDep[];
  blocked: { reason: string; since: number } | null;
  holds: OrchestratorHold[];
  state: "active" | "done";
  doneAt: number | null;
};

/**
 * The read view every reader uses: the identity file merged with the progress
 * file. A missing or bad progress file reads as empty. `updatedAt` is the larger
 * of the two files' values.
 */
export type OrchestratorRecord = OrchestratorIdentity & Omit<OrchestratorProgress, "schema" | "key" | "updatedAt">;

/** `<stateDir>/claims/<launch id>.json`: written once by the launcher, read by the binder. */
export type OrchestratorClaim = {
  schema: 1;
  /** The launch id; it becomes the record's key. */
  key: string;
  role: "manager" | "child";
  name: string;
  ticket: OrchestratorTicket | null;
  /** The launcher's own family key, or null when it owns no record. */
  parent: string | null;
  product: string;
  createdAt: number;
};

/** A progress operation, one per `orch-state` write verb. */
export type OrchestratorOp =
  | { op: "tasks"; tasks: readonly OrchestratorTask[] }
  | { op: "dep-add"; kind: OrchestratorDepKind; ref: string; note: string | null }
  | { op: "dep-done"; kind: OrchestratorDepKind; ref: string }
  | { op: "dep-drop"; kind: OrchestratorDepKind; ref: string }
  | { op: "block"; reason: string }
  | { op: "unblock" }
  | { op: "hold"; what: string }
  | { op: "release"; what: string }
  | { op: "done" };

/** Length caps `applyOp` applies to text the CLI stores. */
export const TEXT_CAPS = { step: 200, reason: 200, note: 200, ref: 300 } as const;

const ROLES: readonly OrchestratorRole[] = ["triage", "manager", "child"];
const DEP_KINDS: readonly OrchestratorDepKind[] = ["session", "pr", "release"];

const SESSION_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const KEY_RE = /^(l|t|s)-[A-Za-z0-9-]{8,72}$/;

/** True when `id` may be used as a session id in a path (`^[A-Za-z0-9-]{8,64}$`). */
export function isSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

/** True when `key` is a family key (`^(l|t|s)-[A-Za-z0-9-]{8,72}$`). */
export function isFamilyKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function isRole(value: unknown): value is OrchestratorRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isDepKind(value: unknown): value is OrchestratorDepKind {
  return typeof value === "string" && (DEP_KINDS as readonly string[]).includes(value);
}

/** The triage key of a product: `t-` and the first 12 hex digits of sha256(product), passed in as `productHash`. */
export function triageKey(productHash: string): string {
  return `t-${productHash.toLowerCase().slice(0, 12)}`;
}

/** The key of a manager or child registered by hand: `s-<session id>`. */
export function sessionKey(sessionId: string): string {
  return `s-${sessionId}`;
}

/** A launch id from a UUID: `l-` and its 32 hex digits, dashes dropped. */
export function launchKey(uuid: string): string {
  return `l-${uuid.replaceAll("-", "").toLowerCase()}`;
}

// --- parsing --------------------------------------------------------------------

type Obj = Record<string, unknown>;

function parseObject(text: string): Obj | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : null;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function ticketOf(value: unknown): OrchestratorTicket | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Obj;
  if (typeof t.id !== "string" || t.id === "") return null;
  return { id: t.id, url: stringOrNull(t.url) };
}

function herdrOf(value: unknown): OrchestratorHerdr | null {
  if (typeof value !== "object" || value === null) return null;
  const h = value as Obj;
  if (typeof h.pane !== "string" || h.pane === "") return null;
  return { pane: h.pane, tab: stringOrNull(h.tab), workspace: stringOrNull(h.workspace) };
}

/**
 * Parses an identity file. Required: `schema` 1, a family `key`, a session id
 * `sessionId`, a `role`, string `product` and `cwd`, numeric `createdAt` and
 * `updatedAt`. The other fields default to empty or null when missing or of the
 * wrong type. Unknown fields are ignored. Returns null for anything else. Never throws.
 */
export function parseIdentity(text: string): OrchestratorIdentity | null {
  const o = parseObject(text);
  if (o === null || o.schema !== 1) return null;
  if (typeof o.key !== "string" || !isFamilyKey(o.key)) return null;
  if (typeof o.sessionId !== "string" || !isSessionId(o.sessionId)) return null;
  if (!isRole(o.role)) return null;
  if (typeof o.product !== "string" || typeof o.cwd !== "string") return null;
  if (!isFiniteNumber(o.createdAt) || !isFiniteNumber(o.updatedAt)) return null;
  const previousIds = Array.isArray(o.previousIds) ? o.previousIds.filter((id): id is string => typeof id === "string") : [];
  const pid = numberOrNull(o.pid);
  return {
    schema: 1,
    key: o.key,
    sessionId: o.sessionId,
    previousIds,
    role: o.role,
    name: stringOrNull(o.name),
    ticket: ticketOf(o.ticket),
    parent: typeof o.parent === "string" && isFamilyKey(o.parent) ? o.parent : null,
    product: o.product,
    cwd: o.cwd,
    pid: pid !== null && Number.isInteger(pid) && pid > 0 ? pid : null,
    procStart: stringOrNull(o.procStart),
    herdr: herdrOf(o.herdr),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** An empty progress file for `key`: rev 0, nothing recorded, active. */
export function emptyProgress(key: string): OrchestratorProgress {
  return { schema: 1, key, rev: 0, updatedAt: 0, tasks: [], deps: [], blocked: null, holds: [], state: "active", doneAt: null };
}

function taskOf(value: unknown): OrchestratorTask | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Obj;
  if (!isFiniteNumber(t.n) || !Number.isInteger(t.n) || t.n < 1) return null;
  if (typeof t.step !== "string" || typeof t.who !== "string" || typeof t.state !== "string") return null;
  return { n: t.n, step: t.step, who: t.who, state: t.state };
}

function depOf(value: unknown): OrchestratorDep | null {
  if (typeof value !== "object" || value === null) return null;
  const d = value as Obj;
  if (!isDepKind(d.kind) || typeof d.ref !== "string" || !isFiniteNumber(d.since)) return null;
  return { kind: d.kind, ref: d.ref, note: stringOrNull(d.note), since: d.since, doneAt: numberOrNull(d.doneAt) };
}

function holdOf(value: unknown): OrchestratorHold | null {
  if (typeof value !== "object" || value === null) return null;
  const h = value as Obj;
  if (typeof h.what !== "string" || !isFiniteNumber(h.since)) return null;
  return { what: h.what, since: h.since };
}

function listOf<T>(value: unknown, item: (v: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const v of value) {
    const parsed = item(v);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/**
 * Parses a progress file for `key`. A file that is not JSON, has another
 * schema or names another key reads as `emptyProgress(key)`; malformed list
 * items are dropped. Never throws.
 */
export function parseProgress(text: string | null, key: string): OrchestratorProgress {
  if (text === null) return emptyProgress(key);
  const o = parseObject(text);
  if (o === null || o.schema !== 1 || o.key !== key) return emptyProgress(key);
  const blocked =
    typeof o.blocked === "object" && o.blocked !== null && typeof (o.blocked as Obj).reason === "string" && isFiniteNumber((o.blocked as Obj).since)
      ? { reason: (o.blocked as Obj).reason as string, since: (o.blocked as Obj).since as number }
      : null;
  const rev = isFiniteNumber(o.rev) && Number.isInteger(o.rev) && o.rev >= 0 ? o.rev : 0;
  return {
    schema: 1,
    key,
    rev,
    updatedAt: isFiniteNumber(o.updatedAt) ? o.updatedAt : 0,
    tasks: listOf(o.tasks, taskOf),
    deps: listOf(o.deps, depOf),
    blocked,
    holds: listOf(o.holds, holdOf),
    state: o.state === "done" ? "done" : "active",
    doneAt: numberOrNull(o.doneAt),
  };
}

/**
 * Merges the identity file and the progress file into the read view. Null when
 * the identity file is bad (`parseIdentity`); a missing or bad progress file
 * reads as empty. Never throws.
 */
export function parseRecord(identityText: string, progressText: string | null): OrchestratorRecord | null {
  const identity = parseIdentity(identityText);
  if (identity === null) return null;
  return mergeRecord(identity, parseProgress(progressText, identity.key));
}

/** The read view of an identity and its progress; `updatedAt` is the larger of the two. */
export function mergeRecord(identity: OrchestratorIdentity, progress: OrchestratorProgress): OrchestratorRecord {
  return {
    ...identity,
    rev: progress.rev,
    tasks: progress.tasks,
    deps: progress.deps,
    blocked: progress.blocked,
    holds: progress.holds,
    state: progress.state,
    doneAt: progress.doneAt,
    updatedAt: Math.max(identity.updatedAt, progress.updatedAt),
  };
}

/**
 * Parses a claim file: `schema` 1, a launch `key` (`l-…`), role `manager` or
 * `child`, string `name` and `product`, numeric `createdAt`; `ticket` and
 * `parent` may be null. Null for anything else. Never throws.
 */
export function parseClaim(text: string): OrchestratorClaim | null {
  const o = parseObject(text);
  if (o === null || o.schema !== 1) return null;
  if (typeof o.key !== "string" || !isFamilyKey(o.key) || !o.key.startsWith("l-")) return null;
  if (o.role !== "manager" && o.role !== "child") return null;
  if (typeof o.name !== "string" || typeof o.product !== "string" || !isFiniteNumber(o.createdAt)) return null;
  if (o.parent !== null && o.parent !== undefined && (typeof o.parent !== "string" || !isFamilyKey(o.parent))) return null;
  return {
    schema: 1,
    key: o.key,
    role: o.role,
    name: o.name,
    ticket: ticketOf(o.ticket),
    parent: typeof o.parent === "string" ? o.parent : null,
    product: o.product,
    createdAt: o.createdAt,
  };
}

/** The live facts a bind records: who is bound now, where, and which process. */
export type OrchestratorBindFacts = {
  sessionId: string;
  cwd: string;
  pid: number | null;
  procStart: string | null;
  herdr: OrchestratorHerdr | null;
  now: number;
};

/** The identity a claim's first bind writes. */
export function recordFromClaim(claim: OrchestratorClaim, bind: OrchestratorBindFacts): OrchestratorIdentity {
  return {
    schema: 1,
    key: claim.key,
    sessionId: bind.sessionId,
    previousIds: [],
    role: claim.role,
    name: claim.name,
    ticket: claim.ticket,
    parent: claim.parent,
    product: claim.product,
    cwd: bind.cwd,
    pid: bind.pid,
    procStart: bind.procStart,
    herdr: bind.herdr,
    createdAt: bind.now,
    updatedAt: bind.now,
  };
}

/** The next value of a per-file `updatedAt`: `max(now, previous + 1)`, so it strictly increases. */
export function nextUpdatedAt(previous: number, now: number): number {
  return Math.max(now, previous + 1);
}

/**
 * Refreshes or rebinds an identity to `bind`. When `bind.sessionId` differs from
 * the bound one, the old id is appended to `previousIds`: the full history of ids
 * bound before, newest last, kept even when an old id is bound again. The key,
 * role, name, parent, product and ticket are kept. `updatedAt` strictly increases.
 */
export function rebindIdentity(identity: OrchestratorIdentity, bind: OrchestratorBindFacts): OrchestratorIdentity {
  const moved = identity.sessionId !== bind.sessionId;
  const previousIds = moved ? [...identity.previousIds.filter((id) => id !== identity.sessionId), identity.sessionId] : identity.previousIds;
  return {
    ...identity,
    sessionId: bind.sessionId,
    previousIds,
    cwd: bind.cwd,
    pid: bind.pid,
    procStart: bind.procStart,
    herdr: bind.herdr,
    updatedAt: nextUpdatedAt(identity.updatedAt, bind.now),
  };
}

// --- progress operations ----------------------------------------------------------

function cap(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** The fields `applyOp` reads and writes; both a progress file and a record carry them. */
type ProgressFields = Pick<OrchestratorProgress, "rev" | "updatedAt" | "tasks" | "deps" | "blocked" | "holds" | "state" | "doneAt">;

/**
 * Applies one operation and returns a new value; the input is not changed.
 * `rev` becomes `rev + 1` and `updatedAt` becomes `max(now, updatedAt + 1)` on
 * every call. `tasks`, `dep-add`, `block` and `hold` also set `state: active`
 * and `doneAt: null`. Text is capped: step and reason and note at 200, ref at 300.
 *
 * - `tasks` replaces the list (steps capped).
 * - `dep-add` adds a dependency, or re-opens one with the same `depKey`
 *   (`doneAt` cleared, the note replaced when one is given, `since` kept).
 * - `dep-done` sets `doneAt` on the matching dependency; `dep-drop` removes it.
 *   Neither changes anything else when none matches.
 * - `block` sets `blocked` (a fresh `since`); `unblock` clears it.
 * - `hold` adds a hold unless one with the same text exists; `release` removes it.
 * - `done` sets `state: done` and `doneAt: now`.
 */
export function applyOp<T extends ProgressFields>(progress: T, op: OrchestratorOp, now: number): T {
  const next: T = {
    ...progress,
    tasks: [...progress.tasks],
    deps: [...progress.deps],
    holds: [...progress.holds],
    rev: progress.rev + 1,
    updatedAt: nextUpdatedAt(progress.updatedAt, now),
  };
  const reopen = (): void => {
    next.state = "active";
    next.doneAt = null;
  };
  switch (op.op) {
    case "tasks":
      next.tasks = op.tasks.map((t) => ({ n: t.n, step: cap(t.step, TEXT_CAPS.step), who: t.who, state: t.state }));
      reopen();
      break;
    case "dep-add": {
      const ref = cap(op.ref, TEXT_CAPS.ref);
      const note = op.note === null ? null : cap(op.note, TEXT_CAPS.note);
      const key = depKey({ kind: op.kind, ref });
      const i = next.deps.findIndex((d) => depKey(d) === key);
      const existing = i >= 0 ? next.deps[i] : undefined;
      if (existing !== undefined) next.deps[i] = { ...existing, doneAt: null, note: note ?? existing.note };
      else next.deps.push({ kind: op.kind, ref, note, since: now, doneAt: null });
      reopen();
      break;
    }
    case "dep-done": {
      const key = depKey({ kind: op.kind, ref: cap(op.ref, TEXT_CAPS.ref) });
      next.deps = next.deps.map((d) => (depKey(d) === key ? { ...d, doneAt: now } : d));
      break;
    }
    case "dep-drop": {
      const key = depKey({ kind: op.kind, ref: cap(op.ref, TEXT_CAPS.ref) });
      next.deps = next.deps.filter((d) => depKey(d) !== key);
      break;
    }
    case "block":
      next.blocked = { reason: cap(op.reason, TEXT_CAPS.reason), since: now };
      reopen();
      break;
    case "unblock":
      next.blocked = null;
      break;
    case "hold":
      if (!next.holds.some((h) => h.what === op.what)) next.holds.push({ what: op.what, since: now });
      reopen();
      break;
    case "release":
      next.holds = next.holds.filter((h) => h.what !== op.what);
      break;
    case "done":
      next.state = "done";
      next.doneAt = now;
      break;
  }
  return next;
}

// --- dependencies -----------------------------------------------------------------

/** The identity `dep add/done/drop` match on: `<kind>:<ref>`. */
export function depKey(dep: { kind: OrchestratorDepKind; ref: string }): string {
  return `${dep.kind}:${dep.ref}`;
}

export type DepSpec = { ok: true; kind: OrchestratorDepKind; ref: string } | { ok: false; error: string };

/**
 * Parses a `<kind>:<ref>` argument. The kind is `session`, `pr` or `release`;
 * the ref is trimmed and must be non-empty. A `pr` ref must be a full URL
 * (`https://…`). Never throws.
 */
export function parseDepSpec(text: string): DepSpec {
  const colon = text.indexOf(":");
  if (colon < 0) return { ok: false, error: `expected <kind>:<ref>, got ${JSON.stringify(text)}` };
  const kind = text.slice(0, colon).trim();
  const ref = text.slice(colon + 1).trim();
  if (!isDepKind(kind)) return { ok: false, error: `unknown dependency kind ${JSON.stringify(kind)}; one of: ${DEP_KINDS.join(" ")}` };
  if (ref === "") return { ok: false, error: `the ${kind} dependency needs a ref` };
  if (kind === "pr" && !/^https:\/\/\S+$/.test(ref)) return { ok: false, error: `a pr dependency is the pull request's full URL, got ${JSON.stringify(ref)}` };
  return { ok: true, kind, ref };
}

/** What a session dependency's target looks like to the reader: one entry per record the ref matches. */
export type SessionTargetState = "live" | "done" | "gone";

export type ResolvedDep = OrchestratorDep & { open: boolean; problem: "gone" | "not found" | null };

/**
 * Resolves every dependency of `record`. A `pr` or `release` dependency is open
 * until its `doneAt` is set. A `session` dependency is closed when its `doneAt`
 * is set or its single matching target is done; zero or several matches leave
 * it open with problem `not found`; a target that is gone leaves it open with
 * problem `gone`. `resolveSession(ref)` returns the state of every non-pruned
 * record of the reader's product whose key or name is `ref`.
 */
export function resolveDeps(record: Pick<OrchestratorRecord, "deps">, resolveSession: (ref: string) => readonly SessionTargetState[]): ResolvedDep[] {
  return record.deps.map((dep) => {
    if (dep.doneAt !== null) return { ...dep, open: false, problem: null };
    if (dep.kind !== "session") return { ...dep, open: true, problem: null };
    const matches = resolveSession(dep.ref);
    if (matches.length !== 1) return { ...dep, open: true, problem: "not found" };
    const target = matches[0];
    if (target === "done") return { ...dep, open: false, problem: null };
    return { ...dep, open: true, problem: target === "gone" ? "gone" : null };
  });
}

/** The open dependencies of `record`, resolved as `resolveDeps` does. */
export function openDeps(record: Pick<OrchestratorRecord, "deps">, resolveSession: (ref: string) => readonly SessionTargetState[]): ResolvedDep[] {
  return resolveDeps(record, resolveSession).filter((d) => d.open);
}

// --- tickets ----------------------------------------------------------------------

const BARE_ISSUE_RE = /^#?([1-9][0-9]*)$/;

/**
 * Normalises a ticket id for storage. `#N` or a bare `N` is a GitHub issue:
 * `owner/repo#N` when `originRepo` is known, else `#N`. Anything else is
 * returned as given.
 */
export function normaliseTicketId(id: string, originRepo: string | null): string {
  const m = BARE_ISSUE_RE.exec(id);
  if (m === null) return id;
  return originRepo !== null && originRepo !== "" ? `${originRepo}#${m[1]}` : `#${m[1]}`;
}

// --- the progress table -----------------------------------------------------------

const TABLE_HEADER = ["#", "step", "who", "state"];
const SEPARATOR_CELL_RE = /^:?-+:?$/;

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|");
}

/** Splits a markdown table row into trimmed cells; `\|` is a literal bar. */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Reads the progress table from `text`: the first markdown table whose header
 * cells are, case-insensitively, `#`, `Step`, `Who`, `State`. Its rows run until
 * the first line that is not a table row; the separator row is skipped; cells
 * are trimmed and `\|` is a literal bar. `n` comes from the `#` cell, and a row
 * whose `#` is not a positive integer is skipped. Null when there is no such
 * table or it has no rows. Never throws.
 */
export function parseTasksTable(text: string): OrchestratorTask[] | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!isTableRow(line)) continue;
    const header = splitRow(line).map((c) => c.toLowerCase());
    if (header.length !== TABLE_HEADER.length || header.some((c, j) => c !== TABLE_HEADER[j])) continue;
    const tasks: OrchestratorTask[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j] ?? "";
      if (!isTableRow(row)) break;
      const cells = splitRow(row);
      if (cells.every((c) => SEPARATOR_CELL_RE.test(c))) continue;
      const nCell = cells[0] ?? "";
      if (!/^[1-9][0-9]*$/.test(nCell)) continue;
      const n = Number.parseInt(nCell, 10);
      if (!Number.isSafeInteger(n)) continue;
      tasks.push({ n, step: cells[1] ?? "", who: cells[2] ?? "", state: cells[3] ?? "" });
    }
    return tasks.length > 0 ? tasks : null;
  }
  return null;
}

function tableCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replaceAll("|", "\\|");
}

/**
 * Renders tasks as the progress table: `| # | Step | Who | State |`,
 * `|---|---|---|---|`, then one `| n | step | who | state |` row per task, a `|`
 * inside a cell written as `\|`. Lines end with `\n`.
 */
export function renderTasksTable(tasks: readonly OrchestratorTask[]): string {
  const rows = tasks.map((t) => `| ${t.n} | ${tableCell(t.step)} | ${tableCell(t.who)} | ${tableCell(t.state)} |`);
  return ["| # | Step | Who | State |", "|---|---|---|---|", ...rows].join("\n") + "\n";
}

const DONE_RE = /^done\b/i;
const CLOSED_RE = /^(moved|dropped)\b/i;

/**
 * Progress as shown: `done` counts tasks whose state starts with `done`;
 * `total` is every task except the closed ones (state starting with `moved` or
 * `dropped`). Null when there are no tasks.
 */
export function progressOf(tasks: readonly OrchestratorTask[]): { done: number; total: number } | null {
  if (tasks.length === 0) return null;
  const done = tasks.filter((t) => DONE_RE.test(t.state.trim())).length;
  const closed = tasks.filter((t) => CLOSED_RE.test(t.state.trim())).length;
  return { done, total: tasks.length - closed };
}

// --- process start times ------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LSTART_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) +(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +(\d{1,2}) +(\d{2}):(\d{2}):(\d{2}) +(\d{4})$/;

/**
 * Reads the C-locale `ps -o lstart=` form `Www Mmm d HH:MM:SS YYYY` (runs of
 * spaces between fields, surrounding whitespace ignored) as a UTC instant, in
 * epoch ms. Null for any other form, including the local day-month form
 * `Www d Mmm HH:MM:SS YYYY`, and for a date that does not exist. Never throws.
 */
export function parseLstart(text: string): number | null {
  const m = LSTART_RE.exec(text.trim());
  if (m === null) return null;
  const month = MONTHS.indexOf(m[2] ?? "");
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const year = Number(m[7]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month, day, hour, minute, second);
  const check = new Date(ms);
  if (check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  return ms;
}

/**
 * True when a recorded `procStart` and a `ps` lstart name the same process
 * start: both parse (`parseLstart`) and are at most 1 s apart. False when either
 * is missing or does not parse, so an incarnation that cannot be checked is
 * never adopted.
 */
export function sameProcess(procStart: string | null | undefined, lstart: string | null | undefined): boolean {
  if (procStart === null || procStart === undefined || lstart === null || lstart === undefined) return false;
  const a = parseLstart(procStart);
  const b = parseLstart(lstart);
  return a !== null && b !== null && Math.abs(a - b) <= 1000;
}

/**
 * The argv that lists pids with their start time in the form `parseLstart`
 * reads: `ps` under `TZ=UTC LC_ALL=C`, so the store and the mod compare the
 * same string.
 */
export function psArgv(pids: readonly number[]): string[] {
  return ["env", "TZ=UTC", "LC_ALL=C", "ps", "-o", "pid=,lstart=", "-p", pids.join(",")];
}

/** `psArgv`'s answer: pid → lstart for each running pid listed. */
export function parsePsStarts(stdout: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (m !== null) out.set(Number(m[1]), m[2] ?? "");
  }
  return out;
}

// --- tmux -------------------------------------------------------------------------

/**
 * Parses a Claude Code session file's `tmux` field. `<session>:@<window>.%<pane>`
 * (e.g. `circle:@95.%474`) gives `{ session, window: '@95', pane: '%474' }`; a bare
 * `%<pane>` gives the pane alone; anything else is null.
 */
export function parseTmuxField(text: string): { session: string | null; window: string | null; pane: string } | null {
  const full = /^(.+):(@\d+)\.(%\d+)$/.exec(text);
  if (full !== null) return { session: full[1] ?? "", window: full[2] ?? "", pane: full[3] ?? "" };
  if (/^%\d+$/.test(text)) return { session: null, window: null, pane: text };
  return null;
}
