# Proxy

**Intent:** provide a placeholder for another object to control access to it.

## The force

You need something to happen *around* access to an object, and the object should not know
about it, and clients should not have to change. The four standard reasons:

| Kind | Controls | Example |
|---|---|---|
| **Virtual** | when it is created | do not load the 4 GB model until first use |
| **Caching** | whether the call happens | return a memoized result, skip the network |
| **Protection** | who may call | reject unless the caller has the role |
| **Remote** | where it runs | the local stand-in for a service across the network |

## Structure

Same interface as the subject, so clients cannot tell the difference.

```ts
interface ImageStore { fetch(id: string): Promise<Blob> }

class CachingImageStore implements ImageStore {
  #cache = new Map<string, Promise<Blob>>();
  constructor(private inner: ImageStore) {}

  fetch(id: string): Promise<Blob> {
    let hit = this.#cache.get(id);
    if (!hit) this.#cache.set(id, (hit = this.inner.fetch(id)));   // may NOT delegate
    return hit;
  }
}
```

**The line that defines the pattern is "may not delegate".** A Decorator always calls
through and adds something; a Proxy decides whether the call happens at all. Caching the
*promise* rather than the resolved value is also what prevents a cache stampede, where
concurrent misses all trigger the same fetch.

## Does TypeScript already do this

**JavaScript has a built-in `Proxy`**, which intercepts operations without writing a wrapper
class per interface:

```ts
const audited = new Proxy(service, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => { log.info({ method: String(prop) }); return value.apply(target, args) };
  },
});
```

**Use it sparingly.** It is genuinely useful for cross-cutting interception (ORMs, mocking
libraries, reactivity systems use it heavily), but it defeats static typing, it is slower
than a direct call, and behaviour becomes invisible at the call site. For a known interface,
an explicit wrapper class is easier to read and to type.

For the lazy-initialization case, a getter or `??=` is usually all you need:

```ts
let model: Model | undefined;
const getModel = () => (model ??= loadHugeModel());   // virtual proxy, one line
```

## Trade-offs

| Gain | Cost |
|---|---|
| Client code is unchanged; the subject is unaware | An extra hop, and a response that may not reflect reality (cache) |
| Cross-cutting concerns stay out of business logic | Behaviour becomes invisible: a "call" may be a cache hit or a rejection |
| Expensive work is deferred until genuinely needed | Caches need invalidation, which is its own problem |

## When NOT to use this

- **The behaviour always runs and only adds something.** That is `decorator.md`.
- **Callers need to know whether it was a cache hit or a real call.** Hiding it is the
  pattern's purpose, and it becomes a liability when correctness depends on the difference.
- **You would use JS `Proxy` on a hot path.** Measure first; interception costs.
- **Access control is the whole application's concern.** Middleware at the boundary is
  clearer than a proxy per object.

## Relations

- **Decorator** (`decorator.md`) is the same structure with the opposite intent; the test is
  whether the wrapper may skip the inner call.
- **Adapter** (`adapter.md`) changes the interface; Proxy keeps it identical.
- **Facade** (`facade.md`) simplifies a subsystem; Proxy stands in for a single object.
- The circuit breaker and retry wrappers in `bunjs:errors` are proxies by this definition:
  they may refuse to make the call at all.
