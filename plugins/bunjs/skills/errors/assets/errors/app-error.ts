/**
 * AppError — the single error type your own code throws.
 *
 * The whole point is the `isOperational` flag. It answers one question that every
 * catch block, every logger and every process handler needs and that a bare `Error`
 * cannot answer: **is this a situation I anticipated, or is my program broken?**
 *
 *   operational  → a user typed a bad email, a payment declined, an upstream 503.
 *                  Expected. Answer the caller, log at warn, keep serving.
 *   programmer   → undefined is not a function, a failed invariant, a bad migration.
 *                  Unexpected. The process is now of unknown correctness. Log at
 *                  error with the full stack, and let the supervisor restart it.
 *
 * Conflating the two is what produces both of the classic failure modes: a server
 * that 500s on a validation error, and a server that limps along for hours with a
 * corrupted module because someone wrapped `main()` in a try/catch that swallowed
 * a TypeError.
 */

/** Machine-readable, stable across refactors. Clients switch on this, never on the message. */
export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UPSTREAM_FAILURE"
  | "INTERNAL";

export interface AppErrorOptions {
  /** HTTP status to answer with when this reaches a transport boundary. */
  status?: number;
  /** Stable machine code for clients. */
  code?: ErrorCode;
  /**
   * False means "my program is broken". Defaults to TRUE because anything
   * constructed as an AppError was, by definition, anticipated by the author.
   */
  isOperational?: boolean;
  /**
   * Structured detail for logs. Never rendered to the client — assume it holds
   * internal identifiers. Keep secrets out of it anyway; logs get shipped.
   */
  context?: Record<string, unknown>;
  /** The lower-level error this wraps. Preserved as a real `cause` chain. */
  cause?: unknown;
  /** Safe to show a user? Defaults true for 4xx, false for 5xx. */
  exposeMessage?: boolean;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly isOperational: boolean;
  readonly context: Record<string, unknown>;
  readonly exposeMessage: boolean;

  constructor(message: string, options: AppErrorOptions = {}) {
    // Pass cause through the real Error option so `error.cause` and Bun's
    // console formatting both show the chain without us reimplementing it.
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);

    this.name = new.target.name; // subclass name, not "Error"
    this.status = options.status ?? 500;
    this.code = options.code ?? (this.status < 500 ? "BAD_REQUEST" : "INTERNAL");
    this.isOperational = options.isOperational ?? true;
    this.context = options.context ?? {};
    this.exposeMessage = options.exposeMessage ?? this.status < 500;

    // Drop this constructor frame so the stack points at the throw site.
    // Guarded: captureStackTrace is V8/JSC-specific, absent on some targets.
    Error.captureStackTrace?.(this, new.target);
  }

  /**
   * Walk the `cause` chain. Useful in a handler that needs the original driver
   * error for classification without pattern-matching on message strings.
   * Cycle-safe: a self-referencing cause terminates instead of hanging.
   */
  static chain(err: unknown, limit = 10): unknown[] {
    const out: unknown[] = [];
    const seen = new Set<unknown>();
    let cur = err;
    while (cur != null && out.length < limit && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = (cur as { cause?: unknown }).cause;
    }
    return out;
  }

  /**
   * The classification every boundary needs.
   *
   * Anything that is not an AppError is treated as a programmer error — that is
   * the safe default. A `TypeError` escaping from a route handler is a bug, and
   * silently reporting it as a handled 400 is how bugs survive to production.
   */
  static isOperational(err: unknown): boolean {
    return err instanceof AppError && err.isOperational;
  }

  /** Structured form for a JSON logger. Includes the cause chain, flattened. */
  toLog(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      isOperational: this.isOperational,
      ...(Object.keys(this.context).length > 0 ? { context: this.context } : {}),
      stack: this.stack,
      ...(this.cause !== undefined ? { cause: describeCause(this.cause) } : {}),
    };
  }
}

/** Render an unknown cause without assuming it is an Error — it often is not. */
function describeCause(cause: unknown): unknown {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
      ...(cause.cause !== undefined ? { cause: describeCause(cause.cause) } : {}),
    };
  }
  return cause;
}
