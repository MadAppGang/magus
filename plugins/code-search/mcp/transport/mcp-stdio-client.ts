/**
 * mcp-stdio-client.ts — the one MCP client. All six adapters use it; none of them
 * spawns a process, sets a timer, or handles a restart.
 *
 * Four methods are the entire surface an adapter needs: `initialize`,
 * `notifications/initialized`, `tools/list`, `tools/call`.
 *
 * THE INVARIANT: nothing here throws. Every failure — spawn `ENOENT`, handshake
 * timeout, per-call timeout, mid-session crash, a line that is not JSON, valid JSON
 * that is not a JSON-RPC response, an upstream JSON-RPC `error`, or the permanent
 * unready latch — is returned as a `BackendNote` the adapter puts in `Outcome.notes`.
 * A rejected promise here becomes a tool error in the host, and one or two of those
 * early in a session stop the agent calling the tool for the rest of it.
 *
 * An upstream `isError: true` on a `tools/call` result is NOT a transport failure. It
 * is a well-formed answer and is handed to the adapter, which decides whether it is a
 * recoverable condition or a genuine malfunction.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { BackendNote } from "../core/ports";
import { encode, makeLineReader, type RpcNotification, type RpcRequest } from "./jsonrpc";

export interface McpClientSpec {
  engineId: string;
  command: string;
  args: readonly string[];
  env?: Readonly<Record<string, string>>;
  cwd: string;
}

export interface McpClientOptions {
  /** Kill an unused child after this long. The next call re-spawns. */
  idleMs: number;
  /**
   * Deadline for one request, handshake included.
   *
   * PER ENGINE, not global: the composition root fills it from that engine's
   * `callTimeoutMs` setting, falling back to `MCP_CLIENT_DEFAULTS.callMs`. Every
   * timeout note quotes this number back verbatim, so the value an operator
   * configured is the value they read in the failure.
   */
  callMs: number;
  /** Consecutive failures tolerated before the client latches permanently unready. */
  maxRestarts: number;
  /** Delay before start attempt n+1, indexed by consecutive failure count. */
  backoffMs: readonly number[];
  /** stderr ONLY. stdout is the JSON-RPC channel; one stray line corrupts the session. */
  log: (line: string) => void;
}

/**
 * The values §C specifies, so the composition root does not restate them and the
 * tests can compress each one independently.
 */
export const MCP_CLIENT_DEFAULTS: Omit<McpClientOptions, "log"> = {
  idleMs: 300_000,
  // The FALLBACK deadline, not a global one. An engine that needs longer says so in
  // `engines.<id>.callTimeoutMs`; raising this instead would buy that one engine its
  // headroom by making every other engine's hang take just as long to notice.
  callMs: 30_000,
  maxRestarts: 3,
  // TWO entries, not three, and that is deliberate. The latch above fires at
  // `consecutiveFailures >= maxRestarts`, so with maxRestarts: 3 only failures 1 and 2
  // ever schedule a retry — the third latches instead. A third backoff entry would be
  // unreachable config, which reads as a 16s wait that never happens. Raise maxRestarts
  // and this array together, or neither.
  backoffMs: [1_000, 4_000],
};

export interface UpstreamTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export type CallResult =
  | { ok: true; content: unknown; isError: boolean }
  | { ok: false; note: BackendNote };

export type ListToolsResult =
  | { ok: true; tools: UpstreamTool[] }
  | { ok: false; note: BackendNote };

export interface McpClient {
  /** Spawns if not running. Returns a note instead of throwing on any failure. */
  listTools(): Promise<ListToolsResult>;
  call(tool: string, args: unknown): Promise<CallResult>;
  /** True once maxRestarts is exhausted. Latched for the process lifetime. */
  isPermanentlyUnready(): boolean;
  lastFailure(): BackendNote | undefined;
  dispose(): Promise<void>;
  /** Monotonic count of crash-class failures (spawn, timeout, child gone) settled on ANY
   *  call, counted or uncounted. A caller that compares it before and after its own call
   *  learns whether the engine crashed under it, without reading the latch state. */
  failureSeq(): number;
  /** Consecutive counted failures, as the latch sees them. 0 means no backoff is armed. */
  streak(): number;
  /**
   * A view sharing this client's child. Its calls behave exactly like the owner's, except
   * that their failures and successes leave `streak()`, the backoff, the first failure,
   * the latch and `lastFailure()` unchanged; a crash-class failure still raises
   * `failureSeq()`. `dispose()` on the view is a no-op. `view.uncounted()` returns the view.
   * One more difference: a view call that times out abandons its own request and leaves
   * the shared child running, so it can never fail an owner call in flight on that child.
   *
   * It exists for opportunistic callers (the Grep merge) whose failures must not cost
   * `code_search` its engine: the latch is reached after exactly as many counted failures
   * as it would be without them.
   */
  uncounted(): McpClient;
}

const PROTOCOL_VERSION = "2024-11-05";

/** Grace between SIGTERM and SIGKILL when stopping a child. */
const KILL_GRACE_MS = 2_000;

/** Child stderr is kept to this many trailing characters and used verbatim as the
 *  crash message. Enough for a stack trace, small enough to put in a tool result. */
const STDERR_RING = 4_096;

/**
 * MCP requires `clientInfo.version`. This names the transport, not the plugin — a peer
 * that needs the plugin version reads `serverInfo` from our own server half.
 */
const CLIENT_INFO = { name: "code-search-mcp-client", version: "1.0.0" } as const;

/** How a request ended. Every variant is non-throwing by construction. */
type Settled =
  | { kind: "ok"; result: unknown }
  | { kind: "rpc-error"; code: number; detail: string }
  | { kind: "malformed"; detail: string }
  | { kind: "timeout" }
  | { kind: "gone"; detail: string };

interface Pending {
  settle: (s: Settled) => void;
}

/**
 * A failure before anyone has decided whether it counts. Whether a failure moves the
 * latch depends on WHO made the call (owner or uncounted view), not on what failed, so
 * the note is built first and settled by the caller.
 */
interface Failure {
  note: BackendNote;
  /** Crash class: spawn failure, timeout, child gone. These are what the latch counts and
   *  what `failureSeq` reports; a protocol failure leaves the child healthy. */
  crash: boolean;
}

type StartOutcome = { ok: true } | { ok: false; failure: Failure };
type Started = { ok: true } | { ok: false; note: BackendNote };

export function makeMcpClient(spec: McpClientSpec, opts: McpClientOptions): McpClient {
  const pending = new Map<number, Pending>();

  let child: ChildProcess | undefined;
  let starting: Promise<StartOutcome> | undefined;
  let stderrRing = "";
  let nextId = 1;

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  let consecutiveFailures = 0;
  let nextAttemptAt = 0;
  let firstFailure: BackendNote | undefined;
  let latched: BackendNote | undefined;
  let lastNote: BackendNote | undefined;
  let disposed = false;
  // Every crash-class failure settled on any call, owner or view. Never reset: a caller
  // compares two readings, so only monotonicity matters.
  let failureCount = 0;

  // One crash is one failure however many calls were waiting on it. Without this,
  // three concurrent calls sharing a child would latch the engine on a single crash.
  let startEpoch = 0;
  let countedEpoch = -1;

  // ---------------------------------------------------------------- notes

  /** A crash-class failure: the child's own stderr is the best evidence. */
  function crashFailure(what: string): Failure {
    const captured = stderrRing.trim();
    return {
      crash: true,
      note: {
        level: "error",
        code: "backend_unavailable",
        message: captured ? `${spec.engineId} ${what}: ${captured}` : `${spec.engineId} ${what}`,
      },
    };
  }

  /** A well-framed but unusable answer. The child is healthy, so its stderr is noise
   *  here and is deliberately left out. */
  function protocolFailure(what: string): Failure {
    return {
      crash: false,
      note: { level: "error", code: "backend_unavailable", message: `${spec.engineId} ${what}` },
    };
  }

  /**
   * Hand a failure to the caller that made the call. An owner call remembers it and, for
   * a crash, counts it toward the latch. An uncounted call changes none of the latch
   * state; it only raises `failureCount`, so its caller can still tell a crash happened.
   */
  function settle(failure: Failure, counted: boolean): BackendNote {
    if (failure.crash) failureCount += 1;
    if (!counted) return failure.note;
    return failure.crash ? recordFailure(failure.note) : remember(failure.note);
  }

  function remember(note: BackendNote): BackendNote {
    lastNote = note;
    return note;
  }

  /**
   * Count a failure that left us without a usable child, and arm the backoff.
   *
   * The caller still gets its own note; the latch only governs LATER calls, so the
   * failure that trips it is still reported for what it was.
   */
  function recordFailure(note: BackendNote): BackendNote {
    if (countedEpoch === startEpoch) return remember(note);
    countedEpoch = startEpoch;

    consecutiveFailures += 1;
    if (!firstFailure) firstFailure = note;

    if (consecutiveFailures >= opts.maxRestarts) {
      latched = remember({
        level: "error",
        code: "backend_unavailable",
        message: `${spec.engineId} failed ${consecutiveFailures} times in a row and will not be started again this session`,
        // The original crash reason is the only actionable thing we have: whatever
        // the user must fix, it is described there, not in the latch itself.
        remedy: firstFailure.message,
      });
      opts.log(`${spec.engineId}: permanently unready — ${firstFailure.message}`);
    } else {
      // Hold the next start off for the backoff. An engine that dies on every spawn
      // would otherwise be re-spawned as fast as the caller can ask.
      const step = Math.min(consecutiveFailures - 1, opts.backoffMs.length - 1);
      nextAttemptAt = Date.now() + (opts.backoffMs[step] ?? 0);
    }
    return remember(note);
  }

  function resetFailures(): void {
    consecutiveFailures = 0;
    nextAttemptAt = 0;
    firstFailure = undefined;
  }

  function failureOf(s: Exclude<Settled, { kind: "ok" }>, label: string): Failure {
    switch (s.kind) {
      case "timeout":
        return crashFailure(`did not answer ${label} within ${opts.callMs}ms`);
      case "gone":
        return crashFailure(`${s.detail} during ${label}`);
      case "rpc-error":
        return protocolFailure(`refused ${label}: ${s.detail} (JSON-RPC ${s.code})`);
      case "malformed":
        return protocolFailure(`returned an unusable answer to ${label}: ${s.detail}`);
    }
  }

  // ---------------------------------------------------------------- timers

  function clearIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  function clearKill(): void {
    if (killTimer) clearTimeout(killTimer);
    killTimer = undefined;
  }

  /** Rolling idle window, restarted on every request and every response. */
  function touchIdle(): void {
    clearIdle();
    if (!child) return;
    idleTimer = unref(
      setTimeout(() => {
        idleTimer = undefined;
        if (pending.size > 0) {
          touchIdle();
          return;
        }
        opts.log(`${spec.engineId}: idle ${opts.idleMs}ms, stopping child`);
        void killChild(`was stopped after ${opts.idleMs}ms idle`);
      }, opts.idleMs),
    );
  }

  // ---------------------------------------------------------------- child

  function failAllPending(detail: string): void {
    if (pending.size === 0) return;
    const waiting = [...pending.values()];
    pending.clear();
    for (const p of waiting) p.settle({ kind: "gone", detail });
  }

  function killChild(reason: string): Promise<void> {
    const proc = child;
    child = undefined;
    clearIdle();
    failAllPending(reason);
    if (!proc) return Promise.resolve();

    return new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve();
        return;
      }
      proc.once("exit", () => {
        clearKill();
        resolve();
      });
      proc.once("error", () => {
        clearKill();
        resolve();
      });
      try {
        proc.kill("SIGTERM");
      } catch {
        resolve();
        return;
      }
      killTimer = unref(
        setTimeout(() => {
          killTimer = undefined;
          try {
            proc.kill("SIGKILL");
          } catch {
            // Already gone; the exit listener above has resolved or will.
          }
          // The child is unref'd, so teardown must finish even if SIGKILL is never
          // observed — a hung engine may not hold the facade open.
          resolve();
        }, KILL_GRACE_MS),
      );
    });
  }

  /**
   * One start attempt is shared by every caller waiting on it, owner and view alike, and
   * each settles the outcome as its own: an owner sharing a view's failed start counts it
   * (once per epoch, as before), and a view sharing an owner's counts nothing.
   */
  async function ensureChild(counted: boolean): Promise<Started> {
    if (disposed) return { ok: false, note: settle(protocolFailure("client is disposed"), counted) };
    if (latched) return { ok: false, note: counted ? remember(latched) : latched };

    let attempt = starting;
    if (attempt === undefined) {
      if (child) return { ok: true };
      const fresh = doStart();
      attempt = fresh;
      starting = fresh;
      const clear = () => {
        if (starting === fresh) starting = undefined;
      };
      void fresh.then(clear, clear);
    }
    const outcome = await attempt;
    return outcome.ok ? outcome : { ok: false, note: settle(outcome.failure, counted) };
  }

  async function doStart(): Promise<StartOutcome> {
    const wait = nextAttemptAt - Date.now();
    if (wait > 0) await delay(wait);
    if (disposed) {
      return { ok: false, failure: protocolFailure("client is disposed") };
    }

    startEpoch += 1;
    stderrRing = "";
    let proc: ChildProcess;
    try {
      proc = spawn(spec.command, [...spec.args], {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      return { ok: false, failure: crashFailure(`could not be started (${describe(err)})`) };
    }

    // A hung engine may not hold the facade open. The child's own handle and each
    // stdio socket are separate refs on the loop, so all four are unref'd.
    proc.unref();
    unrefStream(proc.stdin);
    unrefStream(proc.stdout);
    unrefStream(proc.stderr);

    // A write to a dead child emits EPIPE on the stream; unhandled, that is a
    // process-level crash of the facade over a failure we already report.
    proc.stdin?.on("error", () => {});

    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", makeLineReader(onMessage));

    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      stderrRing = (stderrRing + chunk).slice(-STDERR_RING);
    });

    // Both handlers are inert once this child has been replaced. A child we already
    // gave up on is dying on our own instruction, and its exit must not fail the
    // requests already in flight on its successor — which is how one slow start used
    // to poison the restart that followed it.
    proc.once("error", (err: Error) => {
      if (child !== proc) return;
      child = undefined;
      clearIdle();
      failAllPending(`could not be started (${describe(err)})`);
    });

    proc.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (child !== proc) return;
      child = undefined;
      clearIdle();
      clearKill();
      failAllPending(signal ? `was killed by ${signal}` : `exited with code ${code ?? "unknown"}`);
    });

    child = proc;

    // The handshake is the shared start, not anyone's call: a timeout here kills the
    // child (and the failed start is settled per caller by `ensureChild`).
    const init = await request(
      "initialize",
      { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, clientInfo: CLIENT_INFO },
      true,
    );

    if (init.kind !== "ok") {
      const failure = failureOf(init, "the handshake");
      await killChild("handshake failed");
      return { ok: false, failure };
    }

    // A handshake that completes is NOT evidence the engine works, so it does not
    // reset the failure count. An engine that starts cleanly and then times out on
    // every call would otherwise never reach the latch.
    notify("notifications/initialized", {});
    opts.log(`${spec.engineId}: started (${spec.command})`);
    return { ok: true };
  }

  // ---------------------------------------------------------------- protocol

  function onMessage(msg: unknown): void {
    if (!isRecord(msg)) return;

    const id = msg["id"];
    // No id: a server-initiated notification. Nothing here subscribes to any.
    if (typeof id !== "number") return;

    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    touchIdle();

    const err = msg["error"];
    if (err !== undefined) {
      const rec = isRecord(err) ? err : {};
      p.settle({
        kind: "rpc-error",
        code: typeof rec["code"] === "number" ? rec["code"] : 0,
        detail: typeof rec["message"] === "string" ? rec["message"] : JSON.stringify(err),
      });
      return;
    }

    if (!("result" in msg)) {
      p.settle({ kind: "malformed", detail: "response carried neither result nor error" });
      return;
    }
    p.settle({ kind: "ok", result: msg["result"] });
  }

  /**
   * `counted` decides what a timeout does to the shared child. An owner timeout kills it.
   * An uncounted (view) timeout only abandons its own request: killing the child would
   * fail every owner request in flight on it, each as a counted crash, so Grep could cost
   * `code_search` its engine by a route the latch rules otherwise forbid. A child that is
   * really hung is then killed by the next owner timeout, which is owner evidence.
   */
  function request(method: string, params: unknown, counted: boolean): Promise<Settled> {
    const proc = child;
    const stdin = proc?.stdin;
    if (!proc || !stdin) {
      return Promise.resolve({ kind: "gone", detail: "has no live process" });
    }

    const id = nextId++;
    return new Promise<Settled>((resolve) => {
      const timer = unref(
        setTimeout(() => {
          pending.delete(id);
          resolve({ kind: "timeout" });
          // A server that missed one deadline is not trustworthy for the next
          // request, so the child goes rather than the request being retried on it.
          // A late reply to an abandoned id finds no pending entry and is dropped.
          if (counted) void killChild(`timed out on ${method}`);
        }, opts.callMs),
      );

      pending.set(id, {
        settle: (s) => {
          clearTimeout(timer);
          resolve(s);
        },
      });
      touchIdle();

      const message: RpcRequest = { jsonrpc: "2.0", id, method, params };
      try {
        stdin.write(encode(message));
      } catch (err) {
        pending.delete(id);
        clearTimeout(timer);
        resolve({ kind: "gone", detail: `could not be written to (${describe(err)})` });
      }
    });
  }

  function notify(method: string, params: unknown): void {
    const message: RpcNotification = { jsonrpc: "2.0", method, params };
    try {
      child?.stdin?.write(encode(message));
    } catch {
      // The child died between the handshake response and this line. The next
      // request reports it; a notification has no reply to fail.
    }
  }

  // ---------------------------------------------------------------- surface

  async function listTools(counted: boolean): Promise<ListToolsResult> {
    const started = await ensureChild(counted);
    if (!started.ok) return started;

    const s = await request("tools/list", {}, counted);
    if (s.kind !== "ok") return { ok: false, note: settle(failureOf(s, "tools/list"), counted) };
    // An uncounted success is no evidence for the owner's streak either way: clearing it
    // would let an opportunistic caller hold a failing engine back from its latch.
    if (counted) resetFailures();

    const result = s.result;
    if (!isRecord(result) || !Array.isArray(result["tools"])) {
      return {
        ok: false,
        note: settle(protocolFailure("returned a tools/list result with no tools array"), counted),
      };
    }

    const tools: UpstreamTool[] = [];
    for (const entry of result["tools"]) {
      if (!isRecord(entry)) continue;
      const name = entry["name"];
      // A nameless tool cannot be called, so it cannot be listed. Dropping one is
      // better than refusing the whole list over a single malformed entry.
      if (typeof name !== "string" || name === "") continue;
      tools.push({
        name,
        description: typeof entry["description"] === "string" ? entry["description"] : "",
        inputSchema: entry["inputSchema"],
      });
    }
    return { ok: true, tools };
  }

  async function call(tool: string, args: unknown, counted: boolean): Promise<CallResult> {
    const started = await ensureChild(counted);
    if (!started.ok) return started;

    const s = await request("tools/call", { name: tool, arguments: args ?? {} }, counted);
    if (s.kind !== "ok") return { ok: false, note: settle(failureOf(s, tool), counted) };
    if (counted) resetFailures();

    const result = s.result;
    if (!isRecord(result) || !("content" in result)) {
      return {
        ok: false,
        note: settle(protocolFailure(`returned a ${tool} result that is not an MCP tool result`), counted),
      };
    }
    return { ok: true, content: result["content"], isError: result["isError"] === true };
  }

  async function dispose(): Promise<void> {
    disposed = true;
    unregisterTeardown(teardown);
    clearIdle();
    await killChild("client disposed");
    clearKill();
  }

  // Last-resort synchronous kill: an `exit` handler cannot await anything.
  const teardown = () => {
    try {
      child?.kill("SIGKILL");
    } catch {
      // Nothing left to do at process exit.
    }
  };
  registerTeardown(teardown);

  const isPermanentlyUnready = (): boolean => latched !== undefined;
  const lastFailure = (): BackendNote | undefined => lastNote;
  const failureSeq = (): number => failureCount;
  const streak = (): number => consecutiveFailures;

  // The view shares the child, the pending map and the start attempt; only the
  // bookkeeping after a call differs. Its dispose is a no-op because the child is the
  // owner's to stop.
  const view: McpClient = {
    listTools: () => listTools(false),
    call: (tool, args) => call(tool, args, false),
    isPermanentlyUnready,
    lastFailure,
    dispose: () => Promise.resolve(),
    failureSeq,
    streak,
    uncounted: () => view,
  };

  return {
    listTools: () => listTools(true),
    call: (tool, args) => call(tool, args, true),
    isPermanentlyUnready,
    lastFailure,
    dispose,
    failureSeq,
    streak,
    uncounted: () => view,
  };
}

// -------------------------------------------------------------------- helpers

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    unref(setTimeout(resolve, ms));
  });
}

function unref<T>(timer: T): T {
  const u = (timer as { unref?: () => void }).unref;
  if (typeof u === "function") u.call(timer);
  return timer;
}

/** Child stdio are sockets whose handles ref the loop independently of the child. */
function unrefStream(stream: unknown): void {
  const u = (stream as { unref?: () => void } | null | undefined)?.unref;
  if (typeof u === "function") u.call(stream);
}

// ------------------------------------------------------- process-wide teardown

/**
 * One set of process listeners for every client in the process, not one set each.
 *
 * That matters for the signal path: adding a SIGINT/SIGTERM listener suppresses the
 * default terminate, so this module would otherwise make the facade ignore Ctrl-C.
 * With a single shared listener, "am I the only handler?" is answerable, and the
 * default is restored when nothing else has opted in.
 */
const teardowns = new Set<() => void>();
const signalHandlers = new Map<NodeJS.Signals, () => void>();
const TEARDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
let hooksInstalled = false;

function runTeardowns(): void {
  for (const t of [...teardowns]) t();
}

function installProcessHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on("exit", runTeardowns);
  for (const sig of TEARDOWN_SIGNALS) {
    const handler = () => {
      runTeardowns();
      if (process.listenerCount(sig) === 1) {
        removeProcessHooks();
        process.kill(process.pid, sig);
      }
    };
    signalHandlers.set(sig, handler);
    process.on(sig, handler);
  }
}

function removeProcessHooks(): void {
  if (!hooksInstalled) return;
  hooksInstalled = false;
  process.removeListener("exit", runTeardowns);
  for (const [sig, handler] of signalHandlers) process.removeListener(sig, handler);
  signalHandlers.clear();
}

function registerTeardown(t: () => void): void {
  teardowns.add(t);
  installProcessHooks();
}

function unregisterTeardown(t: () => void): void {
  teardowns.delete(t);
  if (teardowns.size === 0) removeProcessHooks();
}
