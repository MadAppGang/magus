/**
 * Decorator and Chain of Responsibility, in the form every Bun/Express server uses.
 *
 * See references/patterns/decorator.md and references/patterns/chain-of-responsibility.md.
 * The difference between the two patterns is visible right here in the type: a middleware
 * that always calls `next` is a Decorator; one that may return without calling `next` is a
 * Chain of Responsibility link. Same signature, different guarantee.
 */

export type Handler = (req: Request) => Promise<Response>;

/** `next` is a thunk, so a middleware can decline to call it and short-circuit. */
export type Middleware = (req: Request, next: () => Promise<Response>) => Promise<Response>;

/**
 * Compose middleware around a terminal handler.
 *
 * Order is outermost-first: `compose([a, b], h)` runs a -> b -> h. That matches reading
 * order, which is the only ordering people reliably predict.
 *
 * reduceRight is what builds the nesting; a left fold would invert the stack silently.
 */
export function compose(middleware: readonly Middleware[], terminal: Handler): Handler {
  return middleware.reduceRight<Handler>(
    (next, mw) => (req) => mw(req, () => next(req)),
    terminal,
  );
}

/** Decorator: always delegates, adds timing. */
export function withTiming(onDone: (ms: number, res: Response) => void): Middleware {
  return async (_req, next) => {
    const started = performance.now();
    const res = await next();
    onDone(performance.now() - started, res);
    return res;
  };
}

/**
 * Chain of Responsibility link: may NOT delegate. This is the distinction that
 * decorator.md and chain-of-responsibility.md both turn on.
 */
export function requireHeader(name: string, status = 401): Middleware {
  // The return annotation is load-bearing: without it the ternary widens `new Response`
  // to the ambient (undici) Response and stops matching `Middleware`.
  return async (req, next): Promise<Response> => {
    if (req.headers.get(name)) return next();
    return new Response("forbidden", { status });
  };
}

/**
 * Proxy (caching): may skip the inner call entirely. See references/patterns/proxy.md.
 *
 * Two details that are the difference between this working and quietly breaking:
 *
 *   1. The map holds a PROMISE, inserted before the first await. Ten concurrent misses
 *      therefore find the same in-flight entry instead of each launching the work --
 *      that is what prevents a cache stampede.
 *   2. It stores the response BYTES, not the Response object. A Response body is a
 *      single-use stream, so returning the same object twice gives the second caller an
 *      empty body. Rebuilding a fresh Response per caller is what makes the hit safe.
 */
type CachedBody = { body: ArrayBuffer; status: number; headers: [string, string][] };

export function withCache(keyOf: (req: Request) => string | null): Middleware {
  const inflight = new Map<string, Promise<CachedBody>>();

  return async (req, next): Promise<Response> => {
    const key = keyOf(req);
    if (key === null) return next();

    // Store the BYTES, not the Response. A Response body is a single-use stream, so
    // handing the same object to two callers means the second reads an empty body.
    let entry = inflight.get(key);
    if (!entry) {
      entry = next().then(async (res) => ({
        body: await res.arrayBuffer(),
        status: res.status,
        headers: [...res.headers] as [string, string][],
      }));
      inflight.set(key, entry); // set BEFORE awaiting: that is what collapses the stampede
    }

    try {
      const hit = await entry;
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    } catch (err) {
      inflight.delete(key); // never cache a failure
      throw err;
    }
  };
}
