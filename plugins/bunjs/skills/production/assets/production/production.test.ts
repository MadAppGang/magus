import { describe, test, expect, mock } from "bun:test";
import { createLogger, serializeError, runHealthChecks, type Fields, type HealthCheck } from "./logger";
import { installShutdown, readinessFlag, type StoppableServer } from "./shutdown";

function capture() {
  const lines: string[] = [];
  return {
    lines,
    write: (l: string) => void lines.push(l),
    parsed: () => lines.map((l) => JSON.parse(l) as Fields),
  };
}

const fixedNow = () => new Date("2026-08-06T12:00:00.000Z");

describe("createLogger", () => {
  test("emits one JSON object per line with level, time and msg", () => {
    const out = capture();
    createLogger({ write: out.write, now: fixedNow }).info("server started", { port: 3000 });

    expect(out.lines).toHaveLength(1);
    expect(out.parsed()[0]).toEqual({
      level: "info",
      time: "2026-08-06T12:00:00.000Z",
      msg: "server started",
      port: 3000,
    });
  });

  test("filters below the configured level", () => {
    const out = capture();
    const log = createLogger({ level: "warn", write: out.write, now: fixedNow });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(out.parsed().map((l) => l.level)).toEqual(["warn", "error"]);
  });

  test("a filtered line costs nothing — the payload is never built", () => {
    const out = capture();
    const log = createLogger({ level: "error", write: out.write });
    let evaluated = 0;
    for (let i = 0; i < 10_000; i++) {
      log.debug("noisy", { get expensive() { evaluated++; return "x"; } } as unknown as Fields);
    }
    // The getter is only touched during serialisation, which never happens.
    expect(evaluated).toBe(0);
    expect(out.lines).toHaveLength(0);
  });

  test("base fields appear on every line", () => {
    const out = capture();
    const log = createLogger({ base: { service: "api", version: "1.2.3" }, write: out.write, now: fixedNow });
    log.info("a");
    log.error("b");
    for (const line of out.parsed()) expect(line).toMatchObject({ service: "api", version: "1.2.3" });
  });

  test("child() adds permanent fields without touching the parent", () => {
    const out = capture();
    const log = createLogger({ base: { service: "api" }, write: out.write, now: fixedNow });
    const requestLog = log.child({ requestId: "req_1" });

    requestLog.info("handled");
    log.info("global");

    const [child, parent] = out.parsed();
    expect(child).toMatchObject({ service: "api", requestId: "req_1" });
    expect(parent!.requestId).toBeUndefined();
  });

  test("children nest", () => {
    const out = capture();
    const log = createLogger({ write: out.write, now: fixedNow });
    log.child({ a: 1 }).child({ b: 2 }).info("deep");
    expect(out.parsed()[0]).toMatchObject({ a: 1, b: 2 });
  });

  test("redact is applied to per-call fields", () => {
    const out = capture();
    const log = createLogger({
      write: out.write,
      now: fixedNow,
      redact: (f) => ({ ...f, ...(f.password ? { password: "[REDACTED]" } : {}) }),
    });
    log.info("login", { user: "a@b.c", password: "hunter2" });

    const line = out.lines[0]!;
    expect(line).not.toContain("hunter2");
    expect(line).toContain("[REDACTED]");
  });

  test("does not throw on a circular object — a logger must never take down the app", () => {
    const out = capture();
    const log = createLogger({ write: out.write, now: fixedNow });
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() => log.info("circular", { circular })).not.toThrow();
    expect(out.lines[0]).toContain("[circular]");
  });

  test("does not throw on BigInt — JSON.stringify rejects it outright", () => {
    const out = capture();
    const log = createLogger({ write: out.write, now: fixedNow });
    expect(() => log.info("big", { n: 9007199254740993n })).not.toThrow();
    expect(out.lines[0]).toContain("9007199254740993");
  });
});

describe("serializeError", () => {
  test("captures name, message and stack — JSON.stringify(err) alone gives {}", () => {
    expect(JSON.stringify(new Error("boom"))).toBe("{}"); // the trap, demonstrated

    const out = serializeError(new Error("boom")) as Record<string, unknown>;
    expect(out.name).toBe("Error");
    expect(out.message).toBe("boom");
    expect(typeof out.stack).toBe("string");
  });

  test("carries custom fields an AppError-style class adds", () => {
    class AppError extends Error {
      constructor(msg: string, readonly code: string, readonly status: number) {
        super(msg);
        this.name = "AppError";
      }
    }
    const out = serializeError(new AppError("nope", "NOT_FOUND", 404)) as Record<string, unknown>;
    expect(out).toMatchObject({ name: "AppError", code: "NOT_FOUND", status: 404 });
  });

  test("walks the cause chain", () => {
    /** The recursive shape serializeError produces for a chained Error. */
    interface SerializedError {
      name: string;
      message: string;
      stack?: string;
      cause?: SerializedError;
    }

    const err = new Error("outer", { cause: new Error("inner", { cause: new Error("root") }) });
    const out = serializeError(err) as SerializedError;
    expect(out.message).toBe("outer");
    expect(out.cause?.message).toBe("inner");
    expect(out.cause?.cause?.message).toBe("root");
  });

  test("stops at max depth rather than recursing forever", () => {
    let err = new Error("deepest");
    for (let i = 0; i < 30; i++) err = new Error(`layer-${i}`, { cause: err });
    expect(() => serializeError(err)).not.toThrow();
  });

  test("passes non-Errors through — people throw strings", () => {
    expect(serializeError("a string")).toBe("a string");
    expect(serializeError({ code: 42 })).toEqual({ code: 42 } as unknown as Record<string, unknown>);
  });

  test("the logger serialises err/error fields automatically", () => {
    const out = capture();
    createLogger({ write: out.write, now: fixedNow }).error("failed", { err: new Error("boom") });
    const line = out.parsed()[0]!;
    expect((line.err as Record<string, unknown>).message).toBe("boom");
  });
});

describe("runHealthChecks", () => {
  const ok = (name: string, critical = true): HealthCheck => ({ name, critical, check: () => true });
  const bad = (name: string, critical = true): HealthCheck => ({ name, critical, check: () => false });

  test("all passing is ok", async () => {
    const report = await runHealthChecks([ok("db"), ok("cache")]);
    expect(report.status).toBe("ok");
    expect(report.checks.db?.ok).toBe(true);
  });

  test("a failing CRITICAL check makes the service unhealthy", async () => {
    expect((await runHealthChecks([bad("db"), ok("cache")])).status).toBe("unhealthy");
  });

  test("a failing NON-critical check is only degraded — traffic keeps flowing", async () => {
    // This is the distinction that stops a cache blip from taking the service out.
    const report = await runHealthChecks([ok("db"), bad("cache", false)]);
    expect(report.status).toBe("degraded");
    expect(report.checks.cache?.critical).toBe(false);
  });

  test("a throwing check is a failure, and its message is recorded", async () => {
    const report = await runHealthChecks([
      { name: "db", check: () => { throw new Error("ECONNREFUSED"); } },
    ]);
    expect(report.status).toBe("unhealthy");
    expect(report.checks.db?.error).toBe("ECONNREFUSED");
  });

  test("a hanging check times out rather than hanging the probe", async () => {
    const started = Bun.nanoseconds();
    const report = await runHealthChecks([
      { name: "slow", timeoutMs: 30, check: () => new Promise<boolean>(() => {}) },
    ]);
    expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(500);
    expect(report.checks.slow?.ok).toBe(false);
  });

  test("checks run concurrently, not one after another", async () => {
    const slow = (name: string): HealthCheck => ({
      name,
      check: async () => { await Bun.sleep(60); return true; },
    });
    const started = Bun.nanoseconds();
    await runHealthChecks([slow("a"), slow("b"), slow("c")]);
    // Sequential would be ~180ms.
    expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(150);
  });

  test("records a duration per check, so a slow dependency is visible", async () => {
    const report = await runHealthChecks([ok("db")]);
    expect(report.checks.db?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("readinessFlag", () => {
  test("starts not-ready and flips both ways", () => {
    const flag = readinessFlag();
    expect(flag.isReady).toBe(false);
    flag.markReady();
    expect(flag.isReady).toBe(true);
    flag.markNotReady();
    expect(flag.isReady).toBe(false);
  });
});

describe("installShutdown", () => {
  function fakeServer() {
    const calls: Array<boolean | undefined> = [];
    return {
      calls,
      server: {
        stop: mock(async (force?: boolean) => {
          calls.push(force);
        }),
      } satisfies StoppableServer & { stop: ReturnType<typeof mock> },
    };
  }

  test("runs the sequence in the order that does not drop traffic", async () => {
    const order: string[] = [];
    const exit = mock((_c: number) => {});
    const { server } = fakeServer();
    (server.stop as ReturnType<typeof mock>).mockImplementation(async () => void order.push("stop"));

    const uninstall = installShutdown(server, {
      drainDelayMs: 20,
      onNotReady: () => order.push("not-ready"),
      resources: [{ name: "db", close: () => void order.push("db-closed") }],
      log: () => {},
      exit,
      signals: ["SIGUSR2"],
    });

    process.emit("SIGUSR2");
    await Bun.sleep(200);

    // Readiness FIRST, listener after the drain delay, resources last.
    expect(order).toEqual(["not-ready", "stop", "db-closed"]);
    expect(exit).toHaveBeenCalledWith(0);
    uninstall();
  });

  test("stop() is called WITHOUT force, so in-flight requests drain", async () => {
    const exit = mock((_c: number) => {});
    const { server, calls } = fakeServer();
    const uninstall = installShutdown(server, { drainDelayMs: 0, log: () => {}, exit, signals: ["SIGUSR2"] });

    process.emit("SIGUSR2");
    await Bun.sleep(120);

    expect(calls[0]).toBeUndefined(); // undefined, not true
    uninstall();
  });

  test("a second signal does not restart the sequence — resources must close once", async () => {
    const exit = mock((_c: number) => {});
    const closeDb = mock(async () => { await Bun.sleep(30); });
    const { server } = fakeServer();

    const uninstall = installShutdown(server, {
      drainDelayMs: 10,
      resources: [{ name: "db", close: closeDb }],
      log: () => {},
      exit,
      signals: ["SIGUSR2"],
    });

    process.emit("SIGUSR2");
    await Bun.sleep(5);
    process.emit("SIGUSR2");
    await Bun.sleep(200);

    expect(closeDb).toHaveBeenCalledTimes(1);
    uninstall();
  });

  test("a failing resource does not prevent the others from closing", async () => {
    const closed: string[] = [];
    const exit = mock((_c: number) => {});
    const { server } = fakeServer();

    const uninstall = installShutdown(server, {
      drainDelayMs: 0,
      resources: [
        { name: "bad", close: () => { throw new Error("close failed"); } },
        { name: "good", close: () => void closed.push("good") },
      ],
      log: () => {},
      exit,
      signals: ["SIGUSR2"],
    });

    process.emit("SIGUSR2");
    await Bun.sleep(150);

    expect(closed).toEqual(["good"]);
    expect(exit).toHaveBeenCalledWith(0);
    uninstall();
  });

  test("the deadline forces a close rather than hanging past the orchestrator's grace period", async () => {
    const exit = mock((_c: number) => {});
    const { server, calls } = fakeServer();
    (server.stop as ReturnType<typeof mock>).mockImplementation(
      async (force?: boolean) => {
        calls.push(force);
        if (!force) await Bun.sleep(10_000); // graceful drain never completes
      },
    );

    const uninstall = installShutdown(server, {
      drainDelayMs: 0,
      timeoutMs: 40,
      log: () => {},
      exit,
      signals: ["SIGUSR2"],
    });

    process.emit("SIGUSR2");
    await Bun.sleep(300);

    expect(calls).toContain(true); // force-close happened
    expect(exit).toHaveBeenCalledWith(0);
    uninstall();
  });

  test("uninstall removes listeners so test files do not leak into each other", () => {
    const before = process.listenerCount("SIGUSR2");
    const uninstall = installShutdown(fakeServer().server, { log: () => {}, exit: () => {}, signals: ["SIGUSR2"] });
    expect(process.listenerCount("SIGUSR2")).toBe(before + 1);
    uninstall();
    expect(process.listenerCount("SIGUSR2")).toBe(before);
  });
});
