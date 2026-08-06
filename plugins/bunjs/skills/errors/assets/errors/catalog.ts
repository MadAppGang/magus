/**
 * The concrete errors your code throws.
 *
 * These exist so that a throw site reads as a decision — `throw new NotFound("user", id)`
 * — instead of a status-code puzzle. Every one is operational by default: you wrote the
 * throw, so you anticipated the case.
 *
 * The one that is NOT operational is `Bug`. Use it for violated invariants — the
 * "this cannot happen" branch. Marking it non-operational is what routes it to the
 * crash-and-restart path instead of quietly becoming a 500 that nobody pages on.
 */
import { AppError, type AppErrorOptions } from "./app-error";

type Extra = Omit<AppErrorOptions, "status" | "code" | "isOperational">;

export class BadRequest extends AppError {
  constructor(message: string, extra: Extra = {}) {
    super(message, { ...extra, status: 400, code: "BAD_REQUEST" });
  }
}

/** 401 — we do not know who you are. (HTTP misnames this "Unauthorized".) */
export class Unauthenticated extends AppError {
  constructor(message = "Authentication required", extra: Extra = {}) {
    super(message, { ...extra, status: 401, code: "UNAUTHENTICATED" });
  }
}

/** 403 — we know who you are, and you may not. */
export class Forbidden extends AppError {
  constructor(message = "Not permitted", extra: Extra = {}) {
    super(message, { ...extra, status: 403, code: "FORBIDDEN" });
  }
}

export class NotFound extends AppError {
  constructor(resource: string, id?: string | number, extra: Extra = {}) {
    super(id === undefined ? `${resource} not found` : `${resource} '${id}' not found`, {
      ...extra,
      status: 404,
      code: "NOT_FOUND",
      context: { ...extra.context, resource, ...(id === undefined ? {} : { id }) },
    });
  }
}

/** 409 — the request is valid but conflicts with current state (duplicate key, stale version). */
export class Conflict extends AppError {
  constructor(message: string, extra: Extra = {}) {
    super(message, { ...extra, status: 409, code: "CONFLICT" });
  }
}

/**
 * 422 — syntactically fine, semantically rejected. This is the one to throw from a
 * schema validator, carrying the per-field issues so the client can render them.
 */
export class ValidationFailed extends AppError {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>, message = "Validation failed", extra: Extra = {}) {
    super(message, { ...extra, status: 422, code: "UNPROCESSABLE" });
    this.issues = issues;
  }

  override toLog(): Record<string, unknown> {
    return { ...super.toLog(), issues: this.issues };
  }
}

export class RateLimited extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = "Too many requests", extra: Extra = {}) {
    super(message, { ...extra, status: 429, code: "RATE_LIMITED" });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 504-ish — our own deadline elapsed. Distinct from an upstream that answered slowly with an error. */
export class Timeout extends AppError {
  constructor(operation: string, ms: number, extra: Extra = {}) {
    super(`${operation} timed out after ${ms}ms`, {
      ...extra,
      status: 504,
      code: "TIMEOUT",
      context: { ...extra.context, operation, timeoutMs: ms },
    });
  }
}

/**
 * 502 — a dependency failed. Operational: upstreams fail, that is normal and
 * you planned for it. Always pass the driver error as `cause` so the log keeps
 * the real reason (`ECONNREFUSED`) that your message flattens away.
 */
export class UpstreamFailure extends AppError {
  constructor(service: string, extra: Extra = {}) {
    super(`Upstream '${service}' failed`, {
      ...extra,
      status: 502,
      code: "UPSTREAM_FAILURE",
      context: { ...extra.context, service },
    });
  }
}

/**
 * A violated invariant — the branch you believed unreachable.
 *
 * `isOperational: false` is the entire point: this is the one error in the catalog
 * that says "the process is now suspect, restart it". Do not use it for bad input.
 */
export class Bug extends AppError {
  constructor(message: string, extra: Extra = {}) {
    super(message, { ...extra, status: 500, code: "INTERNAL", isOperational: false, exposeMessage: false });
  }
}

/**
 * Exhaustiveness helper. In a `switch` over a union, the `default` branch calling
 * `assertNever(x)` fails at COMPILE time when someone adds a variant — and throws
 * a `Bug` at runtime if a value sneaks past the types (parsed JSON, a DB column).
 */
export function assertNever(value: never, what = "value"): never {
  throw new Bug(`Unhandled ${what}: ${JSON.stringify(value)}`);
}
