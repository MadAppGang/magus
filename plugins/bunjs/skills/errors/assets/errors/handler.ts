/**
 * The centralized error handler — one place that decides what an error MEANS.
 *
 * Route handlers should throw and move on. They must not each decide a status code,
 * a log level and a response shape; that is how a codebase ends up with four
 * different JSON error envelopes and a 500 that leaks a stack trace to the client.
 *
 * Two entry points, and they exist for different reasons:
 *   toResponse()             — the transport boundary. Turns any thrown value into
 *                              a safe HTTP response, and reports it exactly once.
 *   installProcessHandlers() — the last resort. Catches what escaped every boundary.
 */
import { AppError } from "./app-error";

export interface ErrorReport {
  level: "warn" | "error";
  event: "request_failed" | "unhandled_rejection" | "uncaught_exception";
  requestId?: string;
  [key: string]: unknown;
}

/** Plug your logger in here. Defaults to console with a JSON line. */
export type Reporter = (report: ErrorReport) => void;

export const defaultReporter: Reporter = (report) => {
  const line = JSON.stringify(report);
  if (report.level === "error") console.error(line);
  else console.warn(line);
};

/** The single error envelope every client sees. Shape it once, here. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    issues?: ReadonlyArray<{ path: string; message: string }>;
  };
}

export interface ToResponseOptions {
  requestId?: string;
  reporter?: Reporter;
}

/**
 * Convert any thrown value into a Response.
 *
 * The message rule is the security-relevant part: a 5xx message is REPLACED with a
 * generic string. Internal messages routinely embed table names, file paths and
 * upstream URLs, and a stack trace in a response body is a free map of your system.
 * The real message still reaches the log, keyed by requestId so support can find it.
 */
export function toResponse(err: unknown, options: ToResponseOptions = {}): Response {
  const { requestId, reporter = defaultReporter } = options;
  const appErr = err instanceof AppError ? err : null;
  const status = appErr?.status ?? 500;
  const operational = AppError.isOperational(err);

  reporter({
    level: operational ? "warn" : "error",
    event: "request_failed",
    ...(requestId ? { requestId } : {}),
    ...(appErr ? appErr.toLog() : { unknownError: describeUnknown(err) }),
  });

  const expose = appErr?.exposeMessage ?? false;
  const body: ErrorBody = {
    error: {
      code: appErr?.code ?? "INTERNAL",
      message: expose ? (appErr as AppError).message : genericMessageFor(status),
      ...(requestId ? { requestId } : {}),
      ...(hasIssues(appErr) ? { issues: appErr.issues } : {}),
    },
  };

  const headers: Record<string, string> = { "content-type": "application/json" };
  // A 429 without Retry-After forces clients to guess, and they guess badly.
  if (appErr && "retryAfterSeconds" in appErr) {
    headers["retry-after"] = String((appErr as { retryAfterSeconds: number }).retryAfterSeconds);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function hasIssues(e: AppError | null): e is AppError & { issues: ReadonlyArray<{ path: string; message: string }> } {
  return e !== null && Array.isArray((e as { issues?: unknown }).issues);
}

function genericMessageFor(status: number): string {
  return status >= 500 ? "Internal server error" : "Request could not be processed";
}

/** Someone threw a string, a number, or `{ code: 42 }`. Record it without crashing the handler. */
function describeUnknown(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { thrown: typeof err, value: safeStringify(err) };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v); // circular, or a throwing toJSON
  }
}

export interface ProcessHandlerOptions {
  reporter?: Reporter;
  /**
   * Called before exit so you can drain the server. Give it a deadline —
   * a shutdown that hangs is worse than an abrupt one, because the orchestrator
   * will SIGKILL you anyway and you lose the log line explaining why.
   */
  onFatal?: () => Promise<void> | void;
  /** Hard cap on onFatal. Default 5s. */
  graceMs?: number;
  /** Injectable for tests. Defaults to process.exit. */
  exit?: (code: number) => void;
}

/**
 * Last-resort handlers.
 *
 * MEASURED (Bun 1.3.10): an unhandled rejection fires this event and does NOT
 * terminate the process — Bun keeps serving with a promise chain in an unknown
 * state. That silence is the danger, so we treat a non-operational escape as
 * fatal ourselves rather than pretending the process is healthy.
 *
 * An OPERATIONAL error reaching this point is a bug in your boundaries, not a
 * reason to die — it is logged loudly and the process continues.
 */
export function installProcessHandlers(options: ProcessHandlerOptions = {}): () => void {
  const { reporter = defaultReporter, onFatal, graceMs = 5000, exit = (c: number) => process.exit(c) } = options;
  let dying = false;

  const fatal = async (event: ErrorReport["event"], err: unknown) => {
    reporter({
      level: "error",
      event,
      ...(err instanceof AppError ? err.toLog() : { unknownError: describeUnknown(err) }),
    });

    if (AppError.isOperational(err)) return; // handled type, wrong place — log and live
    if (dying) return; // a second fault mid-shutdown must not restart the dance
    dying = true;

    try {
      // Race the drain against the deadline; never await an unbounded shutdown.
      if (onFatal) await Promise.race([Promise.resolve(onFatal()), Bun.sleep(graceMs)]);
    } catch {
      /* a failing shutdown must not mask the original fault */
    }
    exit(1);
  };

  const onRejection = (reason: unknown) => void fatal("unhandled_rejection", reason);
  const onException = (err: unknown) => void fatal("uncaught_exception", err);

  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);

  // Returning the uninstaller keeps tests from leaking listeners between files.
  return () => {
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onException);
  };
}
