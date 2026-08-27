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
const CLIENT_INFO = { name: "code-analysis-mcp-client", version: "1.0.0" } as const;

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

type StartOutcome = { ok: true } | { ok: false; note: BackendNote };

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

  // One crash is one failure however many calls were waiting on it. Without this,
  // three concurrent calls sharing a child would latch the engine on a single crash.
  let startEpoch = 0;
  let countedEpoch = -1;

  // ---------------------------------------------------------------- notes

  /** A note for a crash-class failure: the child's own stderr is the best evidence. */
  function crashNote(what: string): BackendNote {
    const captured = stderrRing.trim();
    return remember({
      level: "error",
      code: "backend_unavailable",
      message: captured
        ? `${spec.engineId} ${what}: ${captured}`
        : `${spec.engineId} ${what}`,
    });
  }

  /** A note for a well-framed but unusable answer. The child is healthy, so its
   *  stderr is noise here and is deliberately left out. */
  function protocolNote(what: string): BackendNote {
    return remember({
      level: "error",
      code: "backend_unavailable",
      message: `${spec.engineId} ${what}`,
    });
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

  function settleNote(s: Exclude<Settled, { kind: "ok" }>, label: string): BackendNote {
    switch (s.kind) {
      case "timeout":
        return recordFailure(crashNote(`did not answer ${label} within ${opts.callMs}ms`));
      case "gone":
        return recordFailure(crashNote(`${s.detail} during ${label}`));
      case "rpc-error":
        return protocolNote(`refused ${label}: ${s.detail} (JSON-RPC ${s.code})`);
      case "malformed":
        return protocolNote(`returned an unusable answer to ${label}: ${s.detail}`);
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

  function ensureChild(): Promise<StartOutcome> {
    if (disposed) return Promise.resolve({ ok: false, note: protocolNote("client is disposed") });
    if (latched) return Promise.resolve({ ok: false, note: remember(latched) });
    if (starting) return starting;
    if (child) return Promise.resolve({ ok: true });

    const attempt = doStart();
    starting = attempt;
    const clear = () => {
      if (starting === attempt) starting = undefined;
    };
    void attempt.then(clear, clear);
    return attempt;
  }

  async function doStart(): Promise<StartOutcome> {
    const wait = nextAttemptAt - Date.now();
    if (wait > 0) await delay(wait);
    if (disposed) {
      return { ok: false, note: protocolNote("client is disposed") };
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
      return { ok: false, note: recordFailure(crashNote(`could not be started (${describe(err)})`)) };
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

    const init = await request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: CLIENT_INFO,
    });

    if (init.kind !== "ok") {
      const note = settleNote(init, "the handshake");
      await killChild("handshake failed");
      return { ok: false, note };
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

  function request(method: string, params: unknown): Promise<Settled> {
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
          void killChild(`timed out on ${method}`);
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

  async function listTools(): Promise<ListToolsResult> {
    const started = await ensureChild();
    if (!started.ok) return started;

    const s = await request("tools/list", {});
    if (s.kind !== "ok") return { ok: false, note: settleNote(s, "tools/list") };
    resetFailures();

    const result = s.result;
    if (!isRecord(result) || !Array.isArray(result["tools"])) {
      return { ok: false, note: protocolNote("returned a tools/list result with no tools array") };
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

  async function call(tool: string, args: unknown): Promise<CallResult> {
    const started = await ensureChild();
    if (!started.ok) return started;

    const s = await request("tools/call", { name: tool, arguments: args ?? {} });
    if (s.kind !== "ok") return { ok: false, note: settleNote(s, tool) };
    resetFailures();

    const result = s.result;
    if (!isRecord(result) || !("content" in result)) {
      return {
        ok: false,
        note: protocolNote(`returned a ${tool} result that is not an MCP tool result`),
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

  return {
    listTools,
    call,
    isPermanentlyUnready: () => latched !== undefined,
    lastFailure: () => lastNote,
    dispose,
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
