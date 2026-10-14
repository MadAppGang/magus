/**
 * service.ts — one merge request, from a route's input to the block appended after it.
 *
 * The use case at the centre of the merge, and deliberately the only stateful module in
 * `grep/`. Everything it touches outside its own memory goes through `GrepPort`: the
 * engine, the oracle walk, file reads, realpath, the clock and the one timer. That is
 * what lets the concurrency and deadline rules below be tested with a fake clock and no
 * socket, engine or rg running.
 *
 * THE PIPELINE, per request (every step that fails answers "append nothing"; P6):
 *   1. gates, cheapest first: the merge gate (D12), identity, the route's parser, the
 *      oracle binary, cwd and root containment, the slow map, the engine state, the late
 *      breaker;
 *   2. an engine slot (2, FIFO, bounded by the request's deadline), with identical
 *      in-flight queries coalesced into one call;
 *   3. the oracle: a single-flight `rg --files` walk with the route's own flags over the
 *      call's roots, so a candidate counts only if the call's search could have read it;
 *   4. sequential candidate reads under the request's AbortSignal; a candidate with a NUL
 *      byte, invalid UTF-8 or no lines is dropped; then `planExtras`;
 *   5. `formatBlock`, or nothing once the deadline has passed.
 * There is no Read-deny filter (R10.1: accepted by the user).
 *
 * WHY THE MERGE HAS ITS OWN ENGINE STATE. Its engine calls go through the transport's
 * uncounted view, so they can never latch the engine `code_search` depends on. The flip
 * side is that the transport no longer stops the merge from hammering a crashing engine,
 * so this module does: a doubling pause after `unavailable`, and an off switch after
 * repeated upstream errors or an engine that cannot search at all.
 *
 * ENGINE CALLS ARE NEVER CANCELLED. The transport sends no MCP cancellation, and a view
 * timeout deliberately leaves the shared engine child running (killing it would fail
 * `code_search` calls in flight on it), so a call that outlives its request keeps running
 * and keeps its slot until it settles. Its lateness is what the breaker counts.
 */

import { resolve as resolvePath } from "node:path";
import type { BackendNote, Hit } from "../core/ports";
import { formatBlock } from "./block";
import { parseBashGrep } from "./bash-grep";
import { isDecline, type SearchCall } from "./call";
import { parseGrepToolInput } from "./grep-tool";
import { splitLines } from "./lines";
import { normaliseLine, planExtras, rebase, type Candidate, type Plan } from "./merge";

// ---------------------------------------------------------------------------
// Constants (exported so tests read them, never restate them)
// ---------------------------------------------------------------------------

/** From the request's receipt. The wrapper's curl and the hook's fetch give up at 1.5 s;
 *  this leaves the frame time to cross the socket before that. */
export const SERVER_DEADLINE_MS = 1_400;
/** Hits asked of the engine. */
export const ENGINE_LIMIT = 20;
/** Lines (content) or files (files mode) in the block at most. */
export const EXTRAS_MAX = 10;
/** Concurrent engine calls. Two, so a cold engine can make at most two calls late. */
export const GREP_ENGINE_SLOTS = 2;
export const GREP_PAUSE_MIN_MS = 30_000;
export const GREP_PAUSE_MAX_MS = 600_000;
/** Consecutive upstream errors that switch the merge off for the session. */
export const UPSTREAM_STREAK = 3;
/** Consecutive late engine calls that open the breaker, and for how long. */
export const LATE_STREAK = 3;
export const LATE_OPEN_MS = 60_000;
/** A candidate modified this recently is not trusted to match what grep read. */
export const RECENT_MTIME_MS = 2_000;
/** A walk slower than this, or listing more paths than the next constant, marks its
 *  oracle key slow (measured: 153,662 paths walk in about 250 ms, warm). */
export const ORACLE_SLOW_MS = 500;
export const ORACLE_MAX_PATHS = 300_000;
export const SLOW_DISABLE_MS = 600_000;
export const SLOW_MAP_MAX = 64;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Candidate bytes one request may decode and split, summed (review round 6). Measured
 *  (Bun 1.4.0, Apple silicon), planning newline-dense 2 MiB files one at a time and
 *  releasing each: about 8 ms per MiB, so 8 MiB costs about 65 ms of the 1400 ms deadline,
 *  with one line table alive at a time. Four maximum-size files, or many ordinary ones. */
export const GREP_DECODE_BUDGET_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Contract types (P6)
// ---------------------------------------------------------------------------

export type EngineSearchResult =
  | { kind: "ok"; hits: readonly Hit[]; lineBase: 0 | 1; notes: readonly BackendNote[] }
  | { kind: "unavailable"; note: BackendNote }
  | { kind: "upstream-error"; note: BackendNote }
  | { kind: "unsupported" };

export interface FileId {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

/** The oracle's binary (D13). A claude binary runs its embedded ripgrep only when its
 *  argv[0] is `rg`; a system `rg` is spawned plainly. */
export interface OracleBin {
  path: string;
  argv0?: "rg";
}

export type WalkResult =
  | { kind: "done"; paths: readonly string[]; elapsedMs: number }
  | { kind: "killed"; elapsedMs: number }
  | { kind: "failed" };

export type ReadResult =
  | { kind: "ok"; bytes: Uint8Array; before: FileId; after: FileId }
  | { kind: "missing" | "too-big" | "aborted" };

export interface GrepPort {
  /** Never rejects. */
  engineSearch(q: { pattern: string; limit: number; glob?: string }): Promise<EngineSearchResult>;
  /** `rg --no-config --files --null <args> -- <roots>` from `cwd`. The roots are absolute,
   *  so the paths come back absolute, as rg prints them. */
  walk(q: {
    bin: OracleBin;
    cwd: string;
    args: readonly string[];
    roots: readonly string[];
    signal: AbortSignal;
  }): Promise<WalkResult>;
  /** `absPath` is canonical (a `realpath` result under the project). "ok" only when the
   *  bytes provably come from that file inside the project: a path whose directories
   *  change around the read is "missing" (port.ts, `pinChain`). */
  readCandidate(absPath: string, maxBytes: number, signal: AbortSignal): Promise<ReadResult>;
  realpath(p: string): Promise<string | undefined>;
  /** `stat` (symlinks followed). The service reads `regular` to tell a file root from a
   *  directory root. */
  statBin(p: string): Promise<{ regular: boolean; executable: boolean; uid: number } | undefined>;
  ppid(): number;
  uid(): number;
  now(): number;
  /** The service's only timer, so tests can drive it with a fake clock. Resolves early
   *  when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface GrepRequest {
  ppid: number;
  callerPid: number;
  cwd: string;
  receivedAt: number;
  input: { kind: "bash"; argv: string[] } | { kind: "tool"; json: unknown };
}

export type GrepReason =
  | "appended"
  | "no_extras"
  | "no_candidates"
  | "identity"
  | "argv"
  | "offset"
  | "gate_closed"
  | "outside"
  | "file_target"
  | "oracle_unavailable"
  | "slow"
  | "paused"
  | "off"
  | "busy"
  | "cooling"
  | "deadline"
  | "unavailable"
  | "upstream_error"
  | "unsupported";

export interface GrepConfig {
  projectReal: string;
  /** D13. Absent: every request answers `oracle_unavailable`. */
  oracleBin?: OracleBin;
  client: { isPermanentlyUnready(): boolean; streak(): number };
  /** One line per request (P9). Never carries request bytes beyond the caller pid, the
   *  route and the mode. Optional: the service is silent without it. */
  log?: (line: string) => void;
  /** D12, evaluated per request before any other work: why the merge gate is closed
   *  now, or `undefined` when it is open. Absent means open. A gate that throws or
   *  rejects is treated as closed. It may answer through a promise, and runs inside the
   *  request's deadline (review round 5): the server's reader stats and reads settings
   *  files asynchronously, so a slow filesystem costs this request, not the event loop. */
  gate?: () => string | undefined | Promise<string | undefined>;
}

export interface GrepStateSnapshot {
  pausedUntil: number;
  pauseMs: number;
  upstreamStreak: number;
  off: "upstream" | "unsupported" | null;
  lateStreak: number;
  breakerOpenUntil: number;
  inFlight: number;
  waiting: number;
  slowKeys: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const EMPTY = new Uint8Array(0);

/** One engine call, shared by every request asking the same question while it is in
 *  flight. Its deadline is the latest among its waiters, so lateness is judged once. */
interface Flight {
  key: string;
  q: { pattern: string; limit: number; glob?: string };
  deadline: number;
  state: "waiting" | "running";
  done: Promise<FlightOutcome>;
  resolve(r: FlightOutcome): void;
}

/** What a flight's waiters get: the engine's answer; `expired` (every waiter's deadline
 *  passed while it queued); or the merge state that held it back when its turn came. */
type FlightOutcome = EngineSearchResult | "expired" | "off" | "paused" | "cooling";

/** One oracle walk, shared while it is in flight and never cached after it ends. */
interface Walk {
  deadline: number;
  settled: boolean;
  done: Promise<WalkResult>;
}

/** A root of the call, resolved. `operand` is as written; `undefined` is the cwd. */
interface Root {
  operand: string | undefined;
  real: string;
  /** `real` relative to the project root: "" at the root. */
  rel: string;
  file: boolean;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function sameFile(a: FileId, b: FileId): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

/** `path` inside `projectReal` (or equal to it), by path segments. */
function within(projectReal: string, path: string): boolean {
  if (path === projectReal) return true;
  const prefix = projectReal.endsWith("/") ? projectReal : `${projectReal}/`;
  return path.startsWith(prefix);
}

function relativeTo(projectReal: string, path: string): string {
  if (path === projectReal) return "";
  const prefix = projectReal.endsWith("/") ? projectReal : `${projectReal}/`;
  return path.slice(prefix.length);
}

function joinUnder(projectReal: string, rel: string): string {
  return projectReal.endsWith("/") ? `${projectReal}${rel}` : `${projectReal}/${rel}`;
}

/**
 * P5's path spelling: the operand without its trailing `/`, then `/` and the rest;
 * no operand (the cwd) → the rest alone; a file root → the operand itself. So `.` gives
 * `./x` and `src/` gives `src/x`, as grep prints them.
 */
export function spellPath(operand: string | undefined, rest: string): string {
  if (operand === undefined) return rest;
  if (rest === "") return operand;
  const trimmed = operand.replace(/\/+$/u, "");
  return `${trimmed}/${rest}`;
}

function decode(bytes: Uint8Array): string | undefined {
  // A NUL is binary to grep (`-I` skips the file), so its lines are not printed the way
  // the matcher would assume. Dropping the candidate loses an extra, never duplicates one.
  if (bytes.includes(0)) return undefined;
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function countLines(block: Uint8Array): number {
  let n = 0;
  for (const byte of block) if (byte === 0x0a) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function makeGrepService(
  port: GrepPort,
  config: GrepConfig,
): {
  /** `payload` is the block (empty unless `appended`); the socket frames it. */
  handle(req: GrepRequest): Promise<{ payload: Uint8Array; reason: GrepReason }>;
  state(): GrepStateSnapshot;
} {
  // Engine state for the merge: per server, reset only by a restart.
  let pausedUntil = 0;
  let pauseMs = GREP_PAUSE_MIN_MS;
  let upstreamStreak = 0;
  let off: "upstream" | "unsupported" | null = null;
  let lateStreak = 0;
  let breakerOpenUntil = 0;

  const flights = new Map<string, Flight>();
  const queue: Flight[] = [];
  let running = 0;

  const walks = new Map<string, Walk>();
  /** Oracle key → slow until. Insertion order is recency, so the first key is the LRU. */
  const slow = new Map<string, number>();

  // ------------------------------------------------------------- slow map

  function isSlow(key: string): boolean {
    const until = slow.get(key);
    if (until === undefined) return false;
    slow.delete(key);
    if (port.now() >= until) return false;
    slow.set(key, until);
    return true;
  }

  function markSlow(key: string): void {
    slow.delete(key);
    slow.set(key, port.now() + SLOW_DISABLE_MS);
    while (slow.size > SLOW_MAP_MAX) {
      const oldest = slow.keys().next();
      if (oldest.done === true) break;
      slow.delete(oldest.value);
    }
  }

  // ------------------------------------------------------------- engine slots

  /** The effect of one settled engine call on the merge's state. Once per call, however
   *  many requests shared it. */
  function apply(result: EngineSearchResult, at: number): void {
    switch (result.kind) {
      case "ok":
        upstreamStreak = 0;
        pauseMs = GREP_PAUSE_MIN_MS;
        return;
      case "unavailable":
        // Uncounted failures cannot latch the engine, so retrying is safe; the doubling
        // pause only bounds how often the merge respawns an engine that keeps crashing.
        pausedUntil = at + pauseMs;
        pauseMs = Math.min(2 * pauseMs, GREP_PAUSE_MAX_MS);
        return;
      case "upstream-error":
        upstreamStreak += 1;
        if (upstreamStreak >= UPSTREAM_STREAK) off = "upstream";
        return;
      case "unsupported":
        off = "unsupported";
        return;
    }
  }

  /**
   * Why no engine call may start now, or `undefined`. A permanently unready engine is off
   * for the session as surely as one the merge turned off itself; neither is worth a
   * call. `streak() > 0` means the owner's backoff is armed: an uncounted call would wait
   * inside it, and could spawn into a crash the owner is still pacing.
   */
  function engineHeld(): "off" | "paused" | "cooling" | undefined {
    if (off !== null || config.client.isPermanentlyUnready()) return "off";
    if (config.client.streak() !== 0 || port.now() < pausedUntil) return "paused";
    if (port.now() < breakerOpenUntil) return "cooling";
    return undefined;
  }

  function pump(): void {
    while (running < GREP_ENGINE_SLOTS && queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      // Every waiter of a flight whose latest deadline has passed has already answered
      // `busy`. Running it now would only spend a slot on an answer nobody reads.
      if (port.now() >= next.deadline) {
        flights.delete(next.key);
        next.resolve("expired");
        continue;
      }
      // The state a flight queued under may have changed since: the flight that just
      // settled can have paused the merge, switched it off or opened the breaker. Its
      // waiters get that answer instead of an engine call (review round 4: 8 queued
      // calls against an unavailable engine drove the pause straight to its cap).
      const held = engineHeld();
      if (held !== undefined) {
        flights.delete(next.key);
        next.resolve(held);
        continue;
      }
      void run(next);
    }
  }

  async function run(flight: Flight): Promise<void> {
    running += 1;
    flight.state = "running";
    let result: EngineSearchResult;
    try {
      result = await port.engineSearch(flight.q);
    } catch (error) {
      // The port promises never to reject; a break of that promise is still an engine
      // that did not answer, not a reason to leak a slot.
      result = {
        kind: "unavailable",
        note: { level: "error", code: "backend_unavailable", message: `engine search threw: ${String(error)}` },
      };
    }
    running -= 1;
    flights.delete(flight.key);

    // Late at the deadline itself, not only after it: a waiter's timer fires at
    // `now >= deadline`, so a call settling at that instant has already been answered
    // `deadline`, and calling it in time would hide exactly the call the breaker counts.
    const at = port.now();
    if (at >= flight.deadline) {
      lateStreak += 1;
      if (lateStreak >= LATE_STREAK) {
        breakerOpenUntil = at + LATE_OPEN_MS;
        lateStreak = 0;
      }
    } else {
      lateStreak = 0;
    }
    apply(result, at);
    flight.resolve(result);
    pump();
  }

  function joinFlight(q: { pattern: string; limit: number; glob?: string }, deadline: number): Flight {
    const key = `${q.pattern}\0${q.glob ?? ""}`;
    const existing = flights.get(key);
    if (existing !== undefined) {
      existing.deadline = Math.max(existing.deadline, deadline);
      return existing;
    }
    let resolve: (r: FlightOutcome) => void = () => undefined;
    const done = new Promise<FlightOutcome>((r) => {
      resolve = r;
    });
    const flight: Flight = { key, q, deadline, state: "waiting", done, resolve };
    flights.set(key, flight);
    queue.push(flight);
    pump();
    return flight;
  }

  // ------------------------------------------------------------- oracle

  function joinWalk(
    key: string,
    bin: OracleBin,
    args: readonly string[],
    roots: readonly string[],
    deadline: number,
  ): Walk {
    const existing = walks.get(key);
    if (existing !== undefined) {
      existing.deadline = Math.max(existing.deadline, deadline);
      return existing;
    }
    const kill = new AbortController();
    const timer = new AbortController();
    const walk: Walk = { deadline, settled: false, done: Promise.resolve({ kind: "failed" }) };
    walks.set(key, walk);

    walk.done = (async (): Promise<WalkResult> => {
      let result: WalkResult;
      try {
        // From the project root, over absolute roots (D7).
        result = await port.walk({ bin, cwd: config.projectReal, args, roots, signal: kill.signal });
      } catch {
        result = { kind: "failed" };
      }
      walk.settled = true;
      walks.delete(key);
      timer.abort();
      // Slow only on the walk's OWN evidence. A walk killed by a deadline before it
      // was slow says nothing about the tree, only about the engine that ate the time.
      if (result.kind === "done" && (result.elapsedMs > ORACLE_SLOW_MS || result.paths.length > ORACLE_MAX_PATHS)) {
        markSlow(key);
      } else if (result.kind === "killed" && result.elapsedMs > ORACLE_SLOW_MS) {
        markSlow(key);
      }
      return result;
    })();

    // The walk lives until the LATEST deadline among the requests waiting on it; a
    // later joiner moves that deadline, so the timer re-reads it after every wake.
    void (async () => {
      while (!walk.settled) {
        const wait = walk.deadline - port.now();
        if (wait <= 0) {
          kill.abort();
          return;
        }
        try {
          await port.sleep(wait, timer.signal);
        } catch {
          // A fake timer may reject on abort; the loop condition decides either way.
        }
      }
    })();
    return walk;
  }

  // ------------------------------------------------------------- the request

  async function gateClosed(): Promise<boolean> {
    if (config.gate === undefined) return false;
    try {
      return (await config.gate()) !== undefined;
    } catch {
      return true;
    }
  }

  /**
   * Every root realpath'd inside the project, or the reason it is not merged. `signal` is
   * the request's deadline: checked before and after each filesystem call, so a request
   * that already answered `deadline` starts no more of them (review round 5). A call
   * already started cannot be cancelled; it is the only one left behind.
   */
  async function resolveRoots(
    call: SearchCall,
    cwd: string,
    cwdReal: string,
    signal: AbortSignal,
  ): Promise<Root[] | "outside" | "file_target" | "aborted"> {
    if (call.roots.length === 0) {
      return [{ operand: undefined, real: cwdReal, rel: relativeTo(config.projectReal, cwdReal), file: false }];
    }
    const roots: Root[] = [];
    for (const operand of call.roots) {
      if (signal.aborted) return "aborted";
      // Against the request's cwd as sent: that is where the operand was written.
      const real = await port.realpath(resolvePath(cwd, operand));
      if (signal.aborted) return "aborted";
      if (real === undefined || !within(config.projectReal, real)) return "outside";
      const stat = await port.statBin(real);
      if (signal.aborted) return "aborted";
      if (stat === undefined) return "outside";
      if (stat.regular && call.route === "tool") return "file_target";
      roots.push({ operand, real, rel: relativeTo(config.projectReal, real), file: stat.regular });
    }
    return roots;
  }

  async function handle(req: GrepRequest): Promise<{ payload: Uint8Array; reason: GrepReason }> {
    const deadline = req.receivedAt + SERVER_DEADLINE_MS;
    const timing = { engine: -1, oracle: -1, read: -1 };
    let mode: SearchCall["mode"] | "-" = "-";
    let extras = 0;

    const done = (reason: GrepReason, payload: Uint8Array = EMPTY) => {
      config.log?.(
        `merge ${req.callerPid} ${req.input.kind} ${mode} ${reason} engine=${timing.engine} oracle=${timing.oracle} read=${timing.read} extras=${extras}`,
      );
      return { payload: reason === "appended" ? payload : EMPTY, reason };
    };

    // The request's deadline: one timer, cancelled on the way out, armed at entry (review
    // rounds 4 and 5): a slow or hung gate, realpath, stat or read must answer `deadline`
    // too, not hold the request past the client's own timeout. Every await below races it,
    // and reads and root resolution observe its abort signal.
    const expired = new AbortController();
    const timer = new AbortController();
    const fire = (): void => {
      if (!timer.signal.aborted) expired.abort();
    };
    port.sleep(Math.max(0, deadline - port.now()), timer.signal).then(fire, fire);
    const deadlineHit = new Promise<"deadline">((resolve) => {
      if (expired.signal.aborted) resolve("deadline");
      else expired.signal.addEventListener("abort", () => resolve("deadline"), { once: true });
    });
    /** `work`'s value, or "deadline" if the request's deadline comes first. */
    const beforeDeadline = <T>(work: Promise<T>): Promise<{ value: T } | "deadline"> =>
      Promise.race([work.then((value) => ({ value })), deadlineHit]);

    try {
      // 1. Gates. The merge gate before any other work (D12), then identity: a request for
      //    another session's parent says nothing about this one, and costs nothing to refuse.
      const gateAnswer = await beforeDeadline(gateClosed());
      if (gateAnswer === "deadline") return done("deadline");
      if (gateAnswer.value) return done("gate_closed");
      const parent = port.ppid();
      if (!Number.isInteger(req.ppid) || parent <= 1 || req.ppid !== parent) return done("identity");

      const parsed = req.input.kind === "bash" ? parseBashGrep(req.input.argv) : parseGrepToolInput(req.input.json);
      if (isDecline(parsed)) return done(parsed.decline === "offset" ? "offset" : "argv");
      const call: SearchCall = parsed;
      mode = call.mode;

      const bin = config.oracleBin;
      if (bin === undefined) return done("oracle_unavailable");

      if (!req.cwd.startsWith("/")) return done("outside");

      const cwdAnswer = await beforeDeadline(port.realpath(req.cwd));
      if (cwdAnswer === "deadline") return done("deadline");
      const cwdReal = cwdAnswer.value;
      if (cwdReal === undefined || !within(config.projectReal, cwdReal)) return done("outside");
      const rootsAnswer = await beforeDeadline(resolveRoots(call, req.cwd, cwdReal, expired.signal));
      if (rootsAnswer === "deadline" || rootsAnswer.value === "aborted") return done("deadline");
      const roots = rootsAnswer.value;
      if (roots === "outside" || roots === "file_target") return done(roots);
      const rootReals = roots.map((root) => root.real);

      const oracleKey = `${call.walkArgs.join("\0")}\0\0${rootReals.join("\0")}`;
      if (isSlow(oracleKey)) return done("slow");

      // The merge's own state, as `pump` rechecks it for a queued flight.
      const held = engineHeld();
      if (held !== undefined) return done(held);

      // 2. The engine (D14): a glob only for a single directory root below the project root.
      const only = roots.length === 1 ? roots[0] : undefined;
      const glob = only !== undefined && !only.file && only.rel !== "" ? `${only.rel}/**` : undefined;
      const q = glob === undefined
        ? { pattern: call.pattern, limit: ENGINE_LIMIT }
        : { pattern: call.pattern, limit: ENGINE_LIMIT, glob };
      const engineStart = port.now();
      const flight = joinFlight(q, deadline);
      const engine = await Promise.race([flight.done, deadlineHit]);
      timing.engine = port.now() - engineStart;
      if (engine === "deadline") return done(flight.state === "waiting" ? "busy" : "deadline");
      if (engine === "expired") return done("busy");
      if (engine === "off" || engine === "paused" || engine === "cooling") return done(engine);
      if (engine.kind === "unavailable") return done("unavailable");
      if (engine.kind === "upstream-error") return done("upstream_error");
      if (engine.kind === "unsupported") return done("unsupported");

      // Scope: each hit to the first root that holds it, spelled from that root's operand
      // (P5), in engine rank order. Content mode needs the engine's own line; a hit
      // without one cannot be placed.
      const byPath = new Map<string, { path: string; rank: number; raws: number[] }>();
      engine.hits.slice(0, ENGINE_LIMIT).forEach((hit, rank) => {
        if (call.mode === "content" && hit.rawLine === undefined) return;
        let path: string | undefined;
        for (const root of roots) {
          const rest = root.file ? (hit.file === root.rel ? "" : undefined) : rebase(hit.file, root.rel);
          if (rest === undefined) continue;
          path = spellPath(root.operand, rest);
          break;
        }
        if (path === undefined) return;
        const abs = joinUnder(config.projectReal, hit.file);
        let entry = byPath.get(abs);
        if (entry === undefined) {
          entry = { path, rank, raws: [] };
          byPath.set(abs, entry);
        }
        if (hit.rawLine !== undefined) entry.raws.push(hit.rawLine);
      });
      if (byPath.size === 0) return done("no_candidates");

      // 3. The oracle: the files the call's search could have read.
      const oracleStart = port.now();
      const walk = joinWalk(oracleKey, bin, call.walkArgs, rootReals, deadline);
      const listed = await Promise.race([walk.done, deadlineHit]);
      timing.oracle = port.now() - oracleStart;
      if (listed === "deadline" || listed.kind === "killed") return done("deadline");
      if (listed.kind === "failed") return done("oracle_unavailable");
      const searched = new Set(listed.paths);

      // 4. Reads, one at a time, each raced against the deadline and under its signal
      //    (review round 5): the request answers at the deadline whatever a realpath or a
      //    read is doing. A filesystem call already started cannot be cancelled, so at most
      //    one per request is left behind it, and the read stops at its next signal check.
      //
      //    Planned one candidate at a time, in rank order (`byPath` was filled in engine
      //    rank order, so its iteration order is `planExtras`' own), and each line table is
      //    dropped once planned (review round 6, measured: keeping all 20 tables of
      //    newline-dense 2 MB files took the server from 15 to 427 MiB RSS). Planning stops
      //    at EXTRAS_MAX extras, and reading at GREP_DECODE_BUDGET_BYTES. Per candidate, the
      //    plan is exactly what `planExtras` gives over all of them at once.
      const readStart = port.now();
      const plan: Plan = call.mode === "files" ? { mode: "files", paths: [] } : { mode: "content", files: [] };
      let planned = 0;
      let decoded = 0;
      const spelled = new Set<string>();
      for (const [abs, entry] of byPath) {
        if (expired.signal.aborted || port.now() >= deadline) break;
        if (planned >= EXTRAS_MAX) break;
        if (!searched.has(abs)) continue;
        // One entry per spelled path, the better-ranked one (as `planExtras` dedups).
        if (spelled.has(entry.path)) continue;
        spelled.add(entry.path);
        // Belt to the oracle's braces: a path that resolves outside the project is never
        // read, whatever the walk listed.
        const realAnswer = await beforeDeadline(port.realpath(abs));
        if (realAnswer === "deadline") break;
        const real = realAnswer.value;
        if (real === undefined || real === config.projectReal || !within(config.projectReal, real)) continue;
        // The canonical path that passed the check, so the port binds the read to it.
        const readAnswer = await beforeDeadline(port.readCandidate(real, MAX_FILE_BYTES, expired.signal));
        if (readAnswer === "deadline") break;
        const read = readAnswer.value;
        if (read.kind === "aborted") break;
        if (read.kind !== "ok") continue;
        // Dedup is exact only for a file grep and this read both saw unchanged. A file
        // whose identity moved during the read, or that was written in the last two
        // seconds, is dropped: a missed extra, never a duplicate.
        if (!sameFile(read.before, read.after)) continue;
        if (!(read.before.mtimeMs < req.receivedAt - RECENT_MTIME_MS)) continue;
        // The aggregate budget: a file that would take the request past it ends the reads.
        // A missed extra, never a wrong one.
        if (decoded + read.bytes.length > GREP_DECODE_BUDGET_BYTES) break;
        decoded += read.bytes.length;
        // P6 step 11, before planning: a NUL byte, invalid UTF-8 (both in `decode`) or no
        // lines once a leading BOM is gone. These are the files ugrep `-I` skips (P0-4
        // finding 4); an empty one would otherwise be offered in files mode as a file
        // grep never searched.
        const text = decode(read.bytes);
        if (text === undefined) continue;
        const lines = splitLines(text);
        if (lines.length === 0) continue;
        const hitLines: number[] = [];
        if (call.mode === "content") {
          for (const raw of entry.raws) {
            const line = normaliseLine(raw, engine.lineBase, lines.length);
            if (line !== undefined) hitLines.push(line);
          }
        }
        const candidate: Candidate = { path: entry.path, lines, hitLines, rank: entry.rank };
        const one = planExtras(call, [candidate], EXTRAS_MAX - planned);
        if (one.mode === "files" && plan.mode === "files") {
          plan.paths.push(...one.paths);
          planned += one.paths.length;
        } else if (one.mode === "content" && plan.mode === "content") {
          plan.files.push(...one.files);
          for (const file of one.files) planned += file.lines.length;
        }
      }
      timing.read = port.now() - readStart;
      if (expired.signal.aborted) return done("deadline");

      // 5. The block.
      const block = formatBlock(plan, call);
      if (block.length === 0) return done("no_extras");
      extras = countLines(block) - 2;
      if (expired.signal.aborted || port.now() >= deadline) return done("deadline");
      return done("appended", block);
    } finally {
      timer.abort();
    }
  }

  function state(): GrepStateSnapshot {
    const now = port.now();
    for (const [key, until] of slow) if (now >= until) slow.delete(key);
    return {
      pausedUntil,
      pauseMs,
      upstreamStreak,
      off,
      lateStreak,
      breakerOpenUntil,
      inFlight: running,
      waiting: queue.length,
      slowKeys: slow.size,
    };
  }

  return { handle, state };
}
