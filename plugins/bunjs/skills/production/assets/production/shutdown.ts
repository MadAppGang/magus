/**
 * Graceful shutdown.
 *
 * The sequence matters more than the code, and getting it wrong is how a deploy drops
 * requests. When an orchestrator removes a pod it does two things roughly at once: sends
 * SIGTERM, and tells the load balancer to stop routing. Those propagate at different
 * speeds, so for a second or two after SIGTERM **traffic is still arriving**.
 *
 * Hence the ordering below:
 *   1. flip readiness to NOT ready   → the LB starts removing us on its next probe
 *   2. wait `drainDelayMs`           → let in-flight routing decisions land
 *   3. stop accepting, drain in-flight (Bun's `server.stop()` waits — MEASURED)
 *   4. close resources (DB, queues)  → only now, when nothing can still need them
 *   5. exit 0
 *
 * Stopping the server first (the obvious implementation) drops the requests the LB is
 * still sending in step 2.
 */

export interface ShutdownOptions {
  /** Called first; make your readiness endpoint report not-ready. */
  onNotReady?: () => void;
  /** Time between flipping readiness and closing the listener. Default 5s. */
  drainDelayMs?: number;
  /** Hard cap on the whole sequence. Default 25s — must be under your orchestrator's grace period. */
  timeoutMs?: number;
  /** Closed AFTER in-flight requests finish: database pools, queue consumers, flushes. */
  resources?: ReadonlyArray<{ name: string; close: () => Promise<void> | void }>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  /** Injectable for tests. */
  exit?: (code: number) => void;
  signals?: readonly NodeJS.Signals[];
}

export interface StoppableServer {
  stop(closeActiveConnections?: boolean): Promise<void> | void;
}

/**
 * Install signal handlers. Returns an uninstaller so tests do not leak listeners.
 *
 * MEASURED (Bun 1.3.10): `server.stop()` with no argument resolves only after in-flight
 * requests finish — a 300 ms request signalled at t+80 ms drained in 226 ms. That is the
 * graceful primitive; `stop(true)` force-closes and is the fallback when the deadline hits.
 */
export function installShutdown(server: StoppableServer, options: ShutdownOptions = {}): () => void {
  const {
    onNotReady,
    drainDelayMs = 5_000,
    timeoutMs = 25_000,
    resources = [],
    log = (event, fields) => console.log(JSON.stringify({ level: "info", msg: event, ...fields })),
    exit = (code: number) => process.exit(code),
    signals = ["SIGTERM", "SIGINT"] as const,
  } = options;

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    // A second SIGTERM (or an impatient operator's Ctrl-C) must not restart the
    // sequence — that would run resource cleanup twice.
    if (shuttingDown) {
      log("shutdown_already_in_progress", { signal });
      return;
    }
    shuttingDown = true;
    const started = Bun.nanoseconds();
    log("shutdown_started", { signal, drainDelayMs, timeoutMs });

    // The deadline covers the WHOLE sequence. An orchestrator SIGKILLs after its grace
    // period regardless, so exiting cleanly just before that is strictly better than
    // being killed mid-write.
    const deadline = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));

    const sequence = (async () => {
      onNotReady?.();
      log("readiness_disabled");

      if (drainDelayMs > 0) await Bun.sleep(drainDelayMs);

      log("closing_listener");
      await server.stop(); // waits for in-flight requests
      log("listener_closed", { afterMs: Math.round((Bun.nanoseconds() - started) / 1e6) });

      for (const resource of resources) {
        try {
          await resource.close();
          log("resource_closed", { resource: resource.name });
        } catch (err) {
          // One failing resource must not prevent the others from closing.
          log("resource_close_failed", { resource: resource.name, error: String(err) });
        }
      }
      return "done" as const;
    })();

    const outcome = await Promise.race([sequence, deadline]).catch((err) => {
      log("shutdown_failed", { error: String(err) });
      return "error" as const;
    });

    if (outcome === "timeout") {
      log("shutdown_timeout_forcing_close", { timeoutMs });
      try {
        await server.stop(true); // force-close whatever is left
      } catch {
        /* already stopping */
      }
    }

    log("shutdown_complete", { durationMs: Math.round((Bun.nanoseconds() - started) / 1e6), outcome });
    exit(outcome === "error" ? 1 : 0);
  };

  const handlers = signals.map((signal) => {
    const handler = () => void shutdown(signal);
    process.on(signal, handler);
    return { signal, handler };
  });

  return () => {
    for (const { signal, handler } of handlers) process.off(signal, handler);
  };
}

/**
 * Readiness flag.
 *
 * Deliberately a tiny object rather than a boolean so the shutdown sequence and the
 * health endpoint share one instance — two copies of "am I ready" drift, and the drift
 * shows up as a pod that reports ready while it is draining.
 */
export function readinessFlag(initial = false) {
  let ready = initial;
  return {
    get isReady() {
      return ready;
    },
    markReady: () => {
      ready = true;
    },
    markNotReady: () => {
      ready = false;
    },
  };
}
