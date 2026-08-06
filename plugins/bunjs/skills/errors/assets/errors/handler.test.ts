import { describe, test, expect, mock } from "bun:test";
import { toResponse, installProcessHandlers, type ErrorBody, type ErrorReport } from "./handler";
import { AppError } from "./app-error";
import { BadRequest, Bug, NotFound, RateLimited, ValidationFailed } from "./catalog";

function collector() {
  const reports: ErrorReport[] = [];
  return { reports, reporter: (r: ErrorReport) => void reports.push(r) };
}

/** `Response.json()` is `unknown` by design; assert the envelope once, here. */
const readBody = (res: Response): Promise<ErrorBody> => res.json() as Promise<ErrorBody>;

describe("toResponse — client-facing shape", () => {
  test("a 4xx exposes its message, because the caller can act on it", async () => {
    const { reporter } = collector();
    const res = toResponse(new BadRequest("email must contain @"), { reporter });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "BAD_REQUEST", message: "email must contain @" } });
  });

  test("a 5xx REPLACES the message — internal detail must not reach the client", async () => {
    const { reporter, reports } = collector();
    const leaky = new AppError("SELECT * FROM users WHERE token='abc' failed at /srv/app/db.ts", { status: 500 });
    const res = toResponse(leaky, { reporter });

    const body = await readBody(res);
    expect(body.error.message).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("SELECT");
    expect(JSON.stringify(body)).not.toContain("/srv/app");
    // …but the real message is still recoverable from the log.
    expect(reports[0]?.message).toContain("SELECT");
  });

  test("an unknown thrown value becomes a 500 without crashing the handler", async () => {
    const { reporter, reports } = collector();
    for (const thrown of ["a string", 42, null, undefined, { weird: true }]) {
      const res = toResponse(thrown, { reporter });
      expect(res.status).toBe(500);
      expect((await readBody(res)).error.message).toBe("Internal server error");
    }
    expect(reports).toHaveLength(5);
    expect(reports.every((r) => r.level === "error")).toBe(true);
  });

  test("a circular thrown object does not throw inside the error handler", () => {
    const { reporter } = collector();
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(() => toResponse(circular, { reporter })).not.toThrow();
  });

  test("requestId is echoed so a user can quote it to support", async () => {
    const { reporter } = collector();
    const res = toResponse(new NotFound("user", 9), { requestId: "req_abc", reporter });
    expect((await readBody(res)).error.requestId).toBe("req_abc");
  });

  test("validation issues reach the client — they are the actionable part", async () => {
    const { reporter } = collector();
    const res = toResponse(new ValidationFailed([{ path: "age", message: "must be >= 0" }]), { reporter });
    expect(res.status).toBe(422);
    expect((await readBody(res)).error.issues).toEqual([{ path: "age", message: "must be >= 0" }]);
  });

  test("a 429 sets Retry-After, so clients stop guessing", () => {
    const { reporter } = collector();
    const res = toResponse(new RateLimited(30), { reporter });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });
});

describe("toResponse — log levels", () => {
  test("operational errors log at warn, programmer errors at error", () => {
    const { reporter, reports } = collector();
    toResponse(new NotFound("user", 1), { reporter });
    toResponse(new Bug("invariant"), { reporter });
    toResponse(new TypeError("x is not a function"), { reporter });
    expect(reports.map((r) => r.level)).toEqual(["warn", "error", "error"]);
  });

  test("reports exactly once per error — double reporting corrupts alert counts", () => {
    const { reporter, reports } = collector();
    toResponse(new NotFound("user", 1), { reporter });
    expect(reports).toHaveLength(1);
  });
});

describe("installProcessHandlers", () => {
  test("a non-operational rejection triggers onFatal and exit(1)", async () => {
    const exit = mock((_code: number) => {});
    const onFatal = mock(async () => {});
    const { reporter, reports } = collector();
    const uninstall = installProcessHandlers({ reporter, onFatal, exit });

    process.emit("unhandledRejection", new TypeError("boom"), Promise.resolve());
    await Bun.sleep(10);

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(reports[0]?.event).toBe("unhandled_rejection");
    uninstall();
  });

  test("an OPERATIONAL escape is logged but does not kill the process", async () => {
    const exit = mock((_code: number) => {});
    const onFatal = mock(async () => {});
    const { reporter, reports } = collector();
    const uninstall = installProcessHandlers({ reporter, onFatal, exit });

    process.emit("unhandledRejection", new BadRequest("stray but handled type"), Promise.resolve());
    await Bun.sleep(10);

    expect(reports[0]?.level).toBe("error"); // still loud — it escaped a boundary
    expect(onFatal).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    uninstall();
  });

  test("a second fault mid-shutdown does not restart the shutdown", async () => {
    const exit = mock((_code: number) => {});
    let running = 0;
    let maxConcurrent = 0;
    const onFatal = mock(async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await Bun.sleep(30);
      running--;
    });
    const { reporter } = collector();
    const uninstall = installProcessHandlers({ reporter, onFatal, exit });

    process.emit("uncaughtException", new TypeError("first"));
    await Bun.sleep(5);
    process.emit("uncaughtException", new TypeError("second"));
    await Bun.sleep(60);

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);
    uninstall();
  });

  test("a hanging onFatal cannot block exit past graceMs", async () => {
    const exit = mock((_code: number) => {});
    const { reporter } = collector();
    const uninstall = installProcessHandlers({
      reporter,
      graceMs: 20,
      onFatal: () => new Promise<void>(() => {}), // never resolves
      exit,
    });

    process.emit("uncaughtException", new TypeError("boom"));
    await Bun.sleep(120);

    expect(exit).toHaveBeenCalledWith(1);
    uninstall();
  });

  test("a throwing onFatal still exits — shutdown failure must not mask the fault", async () => {
    const exit = mock((_code: number) => {});
    const { reporter } = collector();
    const uninstall = installProcessHandlers({
      reporter,
      onFatal: () => {
        throw new Error("drain failed");
      },
      exit,
    });

    process.emit("uncaughtException", new TypeError("boom"));
    await Bun.sleep(20);

    expect(exit).toHaveBeenCalledWith(1);
    uninstall();
  });

  test("uninstall removes the listeners, so test files do not leak into each other", () => {
    const before = process.listenerCount("unhandledRejection");
    const uninstall = installProcessHandlers({ reporter: () => {}, exit: () => {} });
    expect(process.listenerCount("unhandledRejection")).toBe(before + 1);
    uninstall();
    expect(process.listenerCount("unhandledRejection")).toBe(before);
  });
});
