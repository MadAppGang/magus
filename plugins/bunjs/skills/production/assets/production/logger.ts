/**
 * Structured JSON logging.
 *
 * The reason to bother: `console.log("user " + id + " failed")` is unqueryable. You cannot
 * ask "how many failures for this user in the last hour" without a regex over text, and
 * that regex breaks the first time someone edits the message. One JSON object per line
 * makes every field a queryable dimension.
 *
 * Dependency-free on purpose. pino is excellent and a fine substitute; the contract that
 * matters is one JSON object per line, with a level, a timestamp and a message.
 */

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

export type Fields = Record<string, unknown>;

export interface LoggerOptions {
  level?: Level;
  /** Fields attached to every line — service name, version, environment. */
  base?: Fields;
  /** Where lines go. Injectable so tests never touch stdout. */
  write?: (line: string) => void;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Applied to every payload before writing. Wire your redactor in here. */
  redact?: (fields: Fields) => Fields;
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  /** A logger with extra permanent fields — the request-scoped pattern. */
  child(fields: Fields): Logger;
  readonly level: Level;
}

/**
 * Serialise an Error properly.
 *
 * `JSON.stringify(new Error("x"))` is `{}` — name, message and stack are all
 * non-enumerable. Logging an error without this produces a line that says nothing,
 * which is discovered at the worst possible moment.
 */
export function serializeError(err: unknown, depth = 5): unknown {
  if (depth <= 0) return "[max depth]";
  if (!(err instanceof Error)) return err;
  const out: Fields = { name: err.name, message: err.message, stack: err.stack };
  // Carry the extra fields an AppError-style class adds (code, status, context).
  for (const key of Object.keys(err) as (keyof typeof err)[]) {
    if (key !== "name" && key !== "message" && key !== "stack") out[key as string] = err[key];
  }
  if (err.cause !== undefined) out.cause = serializeError(err.cause, depth - 1);
  return out;
}

/** Circular references make JSON.stringify throw — a logger must never throw. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
      }
      if (typeof v === "bigint") return v.toString(); // JSON.stringify throws on BigInt
      return v;
    });
  } catch (err) {
    return JSON.stringify({ level: "error", msg: "log serialisation failed", error: String(err) });
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    level = "info",
    base = {},
    write = (line: string) => console.log(line),
    now = () => new Date(),
    redact = (f) => f,
  } = options;

  const make = (bound: Fields): Logger => {
    const emit = (lvl: Level, msg: string, fields?: Fields) => {
      // Cheapest possible early exit: a filtered-out debug line must not pay for
      // serialisation. This is what makes leaving debug logs in the code affordable.
      if (LEVELS[lvl] < LEVELS[level]) return;

      const payload: Fields = {
        // Fixed leading order keeps lines readable by eye as well as by machine.
        level: lvl,
        time: now().toISOString(),
        msg,
        ...bound,
        ...redact(fields ?? {}),
      };
      if (payload.err !== undefined) payload.err = serializeError(payload.err);
      if (payload.error !== undefined) payload.error = serializeError(payload.error);
      write(safeStringify(payload));
    };

    return {
      level,
      debug: (msg, fields) => emit("debug", msg, fields),
      info: (msg, fields) => emit("info", msg, fields),
      warn: (msg, fields) => emit("warn", msg, fields),
      error: (msg, fields) => emit("error", msg, fields),
      child: (fields) => make({ ...bound, ...fields }),
    };
  };

  return make(base);
}

/**
 * Health checks.
 *
 * Liveness and readiness answer different questions, and conflating them causes outages:
 * a liveness probe that checks the database will restart a perfectly healthy process
 * during a database blip, turning a partial outage into a total one.
 *
 *   liveness  — "is this process wedged?"   Check NOTHING external. Restart fixes it or nothing does.
 *   readiness — "should traffic come here?" Check only what you cannot serve ANY request without.
 */
export interface HealthCheck {
  name: string;
  /** Must be fast and must not throw — a throwing check is treated as a failure. */
  check: () => Promise<boolean> | boolean;
  /** A non-critical check reports its state but never makes the service unready. */
  critical?: boolean;
  timeoutMs?: number;
}

export interface HealthReport {
  status: "ok" | "degraded" | "unhealthy";
  checks: Record<string, { ok: boolean; critical: boolean; durationMs: number; error?: string }>;
}

export async function runHealthChecks(checks: readonly HealthCheck[]): Promise<HealthReport> {
  const results = await Promise.all(
    checks.map(async (c) => {
      const started = Bun.nanoseconds();
      const timeoutMs = c.timeoutMs ?? 1000;
      let ok = false;
      let error: string | undefined;
      try {
        // A hanging dependency must not hang the probe — an unanswered probe is
        // treated as a failure by every orchestrator, but slowly and confusingly.
        ok = await Promise.race([
          Promise.resolve(c.check()),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
        ]);
        if (!ok) error ??= "check returned false or timed out";
      } catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : String(err);
      }
      return {
        name: c.name,
        ok,
        critical: c.critical ?? true,
        durationMs: Math.round((Bun.nanoseconds() - started) / 1e6),
        error,
      };
    }),
  );

  const report: HealthReport["checks"] = {};
  for (const r of results) {
    report[r.name] = { ok: r.ok, critical: r.critical, durationMs: r.durationMs, ...(r.error ? { error: r.error } : {}) };
  }

  const criticalFailed = results.some((r) => r.critical && !r.ok);
  const anyFailed = results.some((r) => !r.ok);
  return {
    status: criticalFailed ? "unhealthy" : anyFailed ? "degraded" : "ok",
    checks: report,
  };
}
