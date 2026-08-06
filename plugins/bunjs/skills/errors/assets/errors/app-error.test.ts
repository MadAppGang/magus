import { describe, test, expect } from "bun:test";
import { AppError } from "./app-error";
import { BadRequest, Bug, NotFound, Timeout, ValidationFailed, assertNever } from "./catalog";

describe("AppError classification", () => {
  test("an AppError is operational by default — you anticipated it by throwing it", () => {
    expect(AppError.isOperational(new BadRequest("bad email"))).toBe(true);
  });

  test("a Bug is NOT operational — that is what routes it to crash-and-restart", () => {
    expect(AppError.isOperational(new Bug("invariant violated"))).toBe(false);
  });

  test("a plain Error is treated as a programmer error, which is the safe default", () => {
    expect(AppError.isOperational(new TypeError("x is not a function"))).toBe(false);
    expect(AppError.isOperational("a thrown string")).toBe(false);
    expect(AppError.isOperational(undefined)).toBe(false);
  });
});

describe("AppError shape", () => {
  test("name is the subclass name, so logs say NotFound not Error", () => {
    expect(new NotFound("user", 7).name).toBe("NotFound");
    expect(new BadRequest("x").name).toBe("BadRequest");
  });

  test("status drives the default code and message exposure", () => {
    const client = new AppError("visible", { status: 400 });
    expect(client.code).toBe("BAD_REQUEST");
    expect(client.exposeMessage).toBe(true);

    const server = new AppError("SELECT * FROM secret_table failed", { status: 500 });
    expect(server.code).toBe("INTERNAL");
    expect(server.exposeMessage).toBe(false);
  });

  test("instanceof survives subclassing (the extends-Error trap)", () => {
    const e = new NotFound("user", 1);
    expect(e).toBeInstanceOf(NotFound);
    expect(e).toBeInstanceOf(AppError);
    expect(e).toBeInstanceOf(Error);
  });

  test("NotFound puts the resource and id in context, not only in the message", () => {
    const e = new NotFound("invoice", "inv_42");
    expect(e.message).toBe("invoice 'inv_42' not found");
    expect(e.context).toEqual({ resource: "invoice", id: "inv_42" });
  });

  test("stack points at the throw site, not at the AppError constructor", () => {
    const e = new BadRequest("boom");
    const firstFrame = (e.stack ?? "").split("\n")[1] ?? "";
    expect(firstFrame).not.toContain("new AppError");
    expect(firstFrame).not.toContain("new BadRequest");
  });
});

describe("cause chains", () => {
  test("cause is a real Error option, so error.cause is populated", () => {
    const driver = new Error("ECONNREFUSED");
    const wrapped = new Timeout("db.query", 500, { cause: driver });
    expect(wrapped.cause).toBe(driver);
  });

  test("chain() walks nested causes", () => {
    const a = new Error("socket closed");
    const b = new AppError("driver failed", { cause: a });
    const c = new AppError("checkout failed", { cause: b });
    expect(AppError.chain(c)).toEqual([c, b, a]);
  });

  test("chain() terminates on a cycle instead of hanging", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b; // deliberate cycle
    expect(AppError.chain(a)).toEqual([a, b]);
  });

  test("chain() respects the limit", () => {
    let err = new Error("deepest");
    for (let i = 0; i < 20; i++) err = new Error(`layer-${i}`, { cause: err });
    expect(AppError.chain(err, 4)).toHaveLength(4);
  });

  test("toLog() flattens the cause chain and keeps the stack", () => {
    const wrapped = new Timeout("db.query", 500, { cause: new Error("ECONNREFUSED") });
    const log = wrapped.toLog();
    expect(log.code).toBe("TIMEOUT");
    expect(log.isOperational).toBe(true);
    expect(log.context).toEqual({ operation: "db.query", timeoutMs: 500 });
    expect((log.cause as { message: string }).message).toBe("ECONNREFUSED");
    expect(typeof log.stack).toBe("string");
  });

  test("toLog() survives a non-Error cause", () => {
    const e = new AppError("weird", { cause: { code: 42 } });
    expect(e.toLog().cause).toEqual({ code: 42 });
  });
});

describe("ValidationFailed", () => {
  test("carries per-field issues through to the log", () => {
    const e = new ValidationFailed([{ path: "email", message: "must be an email" }]);
    expect(e.status).toBe(422);
    expect(e.toLog().issues).toEqual([{ path: "email", message: "must be an email" }]);
  });
});

describe("assertNever", () => {
  test("throws a non-operational Bug when a value escapes the union", () => {
    // Simulates a value parsed from JSON that the types promised could not exist.
    const rogue = "unexpected" as never;
    expect(() => assertNever(rogue, "status")).toThrow(/Unhandled status/);
    try {
      assertNever(rogue);
    } catch (err) {
      expect(AppError.isOperational(err)).toBe(false);
    }
  });
});
