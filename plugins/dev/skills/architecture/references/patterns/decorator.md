# Decorator

**Intent:** attach additional responsibilities to an object dynamically, keeping the same
interface, so decorators can be stacked.

## The force

You need optional, combinable behaviour: logging, caching, retry, compression, metrics.
Inheritance cannot express combinations — `LoggingRetryingCachingHandler` is the start of a
combinatorial explosion, and it fixes the choice at compile time.

## Structure

A decorator implements the same interface as the thing it wraps and holds one of them.

```ts
interface DataSource { read(key: string): Promise<string> }

class FileDataSource implements DataSource {
  async read(key: string) { return Bun.file(key).text() }
}

class LoggingSource implements DataSource {
  constructor(private inner: DataSource) {}
  async read(key: string) {
    const started = performance.now();
    const value = await this.inner.read(key);           // always delegates
    log.info({ key, ms: performance.now() - started });
    return value;
  }
}

// Same interface in, same interface out — so they stack in any order.
const source: DataSource = new LoggingSource(new CachingSource(new FileDataSource()));
```

**Order is significant and is a design decision.** Logging outside caching reports every
call including cache hits; logging inside reports only misses. Neither is wrong, but the
stack silently encodes which one you meant.

## Does TypeScript already do this

**Yes, and the function form is usually better.** Higher-order functions are decorators
without the class ceremony, and this is exactly how middleware works in Bun and Express:

```ts
type Handler = (req: Request) => Promise<Response>;

const withLogging = (next: Handler): Handler => async (req) => {
  const started = performance.now();
  const res = await next(req);
  log.info({ path: new URL(req.url).pathname, status: res.status, ms: performance.now() - started });
  return res;
};

const withAuth = (next: Handler): Handler => async (req) =>
  req.headers.get("authorization") ? next(req) : new Response("unauthorized", { status: 401 });

const app = withLogging(withAuth(routes));   // the decorator pattern, no classes
```

**Note that `withAuth` may not call `next`.** Strictly, short-circuiting makes it a Proxy
(`proxy.md`) rather than a Decorator. Middleware pipelines routinely mix both, which is
fine, but knowing which one you wrote tells you whether the inner handler is guaranteed to
run.

**Do not confuse this with TypeScript's `@decorator` syntax.** That is a language feature
for annotating declarations, unrelated to the GoF pattern despite the shared name.

Use the class form when a decorator needs its own state (a cache map, a circuit breaker's
counters) or several methods.

## Trade-offs

| Gain | Cost |
|---|---|
| Combine behaviours at runtime in any order | Stack traces gain a frame per layer; debugging gets harder |
| Each concern is a small, separately testable unit | No single file shows what actually happens to a call |
| Adds responsibility without touching the wrapped class | Identity breaks: the wrapper is not the wrapped object |

## When NOT to use this

- **The behaviour is not optional.** If every instance needs it, put it in the class.
- **You are already 4+ layers deep.** That is `UNI-08` Decorator Hell in `dev:code-roast`'s
  `sin-registry.md` at 5+ layers. Collapse into an explicit pipeline you can read in one place.
- **Callers depend on the concrete type.** `instanceof` and property access past the
  interface break once wrapped.
- **You need to intercept and possibly skip the call.** That is `proxy.md`.

## Relations

- **Proxy** (`proxy.md`) is structurally identical; Proxy controls *access* (may not
  delegate), Decorator adds *behaviour* (always delegates).
- **Adapter** (`adapter.md`) changes the interface; Decorator preserves it.
- **Composite** (`composite.md`) shares the recursive structure; a Decorator is effectively a
  Composite with exactly one child and behaviour instead of aggregation.
- **Chain of Responsibility** (`chain-of-responsibility.md`) also passes along a chain, but
  any link may stop the request; decorators are all expected to run.
