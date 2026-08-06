/**
 * Middleware for `Bun.serve`'s declarative `routes`.
 *
 * Bun has no middleware concept — `routes` maps a pattern to a handler and that is all.
 * The usual workaround is to abandon `routes` and hand-roll dispatch inside `fetch()`,
 * which throws away Bun's native radix router and the typed `req.params` that come with it.
 *
 * This wraps handlers instead. Composition is explicit and per-route, which is more
 * typing than a global `app.use()` but has a property global middleware never has:
 * reading a route tells you exactly what runs for it. No action-at-a-distance about
 * whether auth applied.
 */

/** Bun's route handler shape: a BunRequest (Request + params + cookies) and the Server. */
export type Handler<P extends string = string> = (
  req: Bun.BunRequest<P>,
  server: Bun.Server<never>,
) => Response | Promise<Response>;

export type Middleware = <P extends string>(next: Handler<P>) => Handler<P>;

/**
 * Compose middleware left-to-right: `chain(a, b)(handler)` runs a, then b, then handler.
 *
 * `reduceRight` is what makes the reading order match the execution order. With
 * `reduce`, `chain(logging, auth)` would run auth first — the reverse of how it reads,
 * which is exactly the kind of subtlety that puts auth after logging by accident.
 */
export function chain(...middleware: Middleware[]): Middleware {
  return <P extends string>(handler: Handler<P>): Handler<P> =>
    middleware.reduceRight<Handler<P>>((next, mw) => mw(next), handler);
}

/**
 * Per-request context, propagated without threading a parameter through every function.
 *
 * `AsyncLocalStorage` survives `await` boundaries, which a module-level variable does
 * not: with concurrent requests, a plain `let currentRequestId` is overwritten by the
 * next request while the first is still awaiting, and your logs attribute lines to the
 * wrong request. That bug only appears under load, which is the worst time to find it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  startedAt: number;
  /** Populated by requireAuth; absent on anonymous routes. */
  user?: { id: string; roles: readonly string[] };
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Returns undefined outside a request — callers must handle that (background jobs, boot). */
export const currentContext = (): RequestContext | undefined => storage.getStore();
export const currentRequestId = (): string | undefined => storage.getStore()?.requestId;

/**
 * Assigns a request id and makes it ambient. Put this OUTERMOST so everything
 * downstream — including the error handler — can label its output.
 *
 * An inbound `x-request-id` is honoured so a trace survives across services, but it is
 * length-capped: it lands in logs, and an unbounded attacker-controlled string is a
 * log-injection and log-cost problem.
 */
export const withRequestId =
  (header = "x-request-id"): Middleware =>
  (next) =>
  (req, server) => {
    const inbound = req.headers.get(header);
    const requestId = inbound && inbound.length <= 200 ? inbound : crypto.randomUUID();
    const ctx: RequestContext = { requestId, startedAt: Date.now() };

    return storage.run(ctx, async () => {
      const res = await next(req, server);
      // Header mutation on an existing Response is allowed in Bun; clone only if frozen.
      try {
        res.headers.set(header, requestId);
        return res;
      } catch {
        const copy = new Response(res.body, res);
        copy.headers.set(header, requestId);
        return copy;
      }
    });
  };

export interface AccessLogLine {
  event: "request";
  requestId?: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip?: string;
}

/**
 * Access logging.
 *
 * Logs on the way OUT and inside a `finally`, so a throwing handler still produces a
 * line. A logger that only records successes is worse than none — it makes an outage
 * look like a traffic drop.
 *
 * The path is logged WITHOUT the query string: query strings carry tokens, emails and
 * search terms, and access logs are the most widely-shipped, longest-retained data you
 * produce.
 */
export const accessLog =
  (write: (line: AccessLogLine) => void = (l) => console.info(JSON.stringify(l))): Middleware =>
  (next) =>
  async (req, server) => {
    const startedAt = Bun.nanoseconds();
    const url = new URL(req.url);
    let status = 500; // if the handler throws, that is what the client will get
    try {
      const res = await next(req, server);
      status = res.status;
      return res;
    } finally {
      write({
        event: "request",
        requestId: currentRequestId(),
        method: req.method,
        path: url.pathname,
        status,
        durationMs: Math.round((Bun.nanoseconds() - startedAt) / 1e6),
        ip: server.requestIP(req)?.address,
      });
    }
  };

/**
 * Method allow-list producing a real 405.
 *
 * MEASURED (Bun 1.3.10): a `routes` entry declared as `{ GET, POST }` does NOT answer 405
 * for an unlisted method — the request falls through to the `fetch()` handler and
 * typically becomes a 404. That is wrong, and it matters: 404 tells a client the resource
 * does not exist, 405 tells it the resource exists but the verb is wrong.
 *
 * RFC 9110 requires the `Allow` header on a 405.
 */
export const allowMethods =
  (...methods: string[]): Middleware =>
  (next) =>
  (req, server) => {
    const allowed = methods.map((m) => m.toUpperCase());
    if (!allowed.includes(req.method.toUpperCase())) {
      return new Response(null, { status: 405, headers: { allow: allowed.join(", ") } });
    }
    return next(req, server);
  };

/**
 * Wall-clock cap on a handler.
 *
 * `Bun.serve`'s `idleTimeout` covers a *stalled connection*, not a handler that is busy
 * awaiting a slow dependency forever. Without this, one hung upstream holds connections
 * until the whole server stops accepting.
 */
export const timeout =
  (ms: number): Middleware =>
  (next) =>
  async (req, server) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<Response>((resolve) => {
      timer = setTimeout(() => resolve(new Response(null, { status: 504 })), ms);
    });
    try {
      return await Promise.race([next(req, server), expired]);
    } finally {
      clearTimeout(timer); // else the timer pins the loop open for the full budget
    }
  };
