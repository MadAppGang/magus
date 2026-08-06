# Optimisation patterns

Ordered by payoff. The first three usually make the last unnecessary.

## 1. Do it fewer times

### N+1 queries

The single most common real performance bug, and it hides well because each individual query is fast.

```ts
const orders = await db.query("SELECT * FROM orders WHERE user_id = ?").all(userId);
for (const o of orders) o.items = await db.query("SELECT * FROM items WHERE order_id = ?").all(o.id);
// 1 + N round trips
```

```ts
const orders = await db.query("SELECT * FROM orders WHERE user_id = ?").all(userId);
const items = await db.query(`SELECT * FROM items WHERE order_id IN (${orders.map(() => "?").join(",")})`).all(...orders.map(o => o.id));
const byOrder = Map.groupBy(items, (i) => i.order_id);          // 2 round trips, total
for (const o of orders) o.items = byOrder.get(o.id) ?? [];
```

At 1 ms per round trip and 100 orders that is 101 ms → 2 ms. No code tuning reaches that.

Guard it: log `queryCount` per request and alert when it scales with result-set size.

### Caching

Cache when the value is expensive, reused, and tolerably stale. All three, or you are adding a
correctness risk for nothing.

```ts
const cache = new Map<string, { value: T; expiresAt: number }>();

function cached(key: string, ttlMs: number, compute: () => T): T {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = compute();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
```

Two things that make this production-safe rather than a new incident:

- **Bound it.** An unbounded `Map` keyed by anything user-controlled is a memory leak an attacker
  can drive. Cap the size with LRU eviction, or sweep expired entries on an `unref()`'d interval.
- **Have an invalidation story before you add it.** "How does this get stale, and what fixes it?"
  If the answer is "restart the service", the cache is a future outage.

**Stampede**: when a hot key expires, every concurrent request recomputes it simultaneously.
Deduplicate by caching the *promise*, not the value, so concurrent callers await the same work.

`Bun.hash` is the right hash for a cache key — MEASURED ~10x faster than sha256, and a cache key
needs no cryptographic property.

### HTTP caching costs nothing

An `ETag` and a 304 means the response never leaves the server. `withETag()` in the `http-service`
skill handles the parts people get wrong (`*`, comma-separated lists, `W/` weak prefixes).

## 2. Do it off the request path

The user waits for the database write; they should not wait for the email, the thumbnail, the
webhook, the analytics event.

```ts
await db.createUser(input);
queue.enqueue({ type: "send_welcome_email", userId });   // returns immediately
return created(user, `/users/${user.id}`);
```

`void doThing().catch(report)` is the in-process version — acceptable for genuinely
fire-and-forget work, but remember the measured Bun behaviour: an unhandled rejection **does not
terminate the process**, so an uncaught failure here means the work silently did not happen. Always
attach the `.catch`.

Work that must not be lost belongs in a durable queue, not a floating promise. A process restart
loses everything in memory.

## 3. Do it lazily or incrementally

### Stream instead of buffering

MEASURED: `JSON.parse` of a 1.81 MiB payload takes **76 ms** of pure event-loop blocking, and
`stringify` is the same order. Streaming keeps peak memory flat and lets the client start parsing
immediately. `streamJsonArray()` ships in the `http-service` skill.

The trade is real: once the first byte is sent the status is committed, so a mid-stream failure
cannot become a 500. Stream only what you can produce reliably.

### Paginate

Cursor pagination, not offset. `OFFSET 10000` makes the database scan and discard 10,000 rows and
gets slower the deeper you page — and it silently skips or duplicates rows when the underlying set
changes between requests.

### Bounded concurrency

`Promise.all` over 50,000 items opens 50,000 connections. Use a worker-pool map (see the `errors`
skill's `async-pitfalls.md`) with a limit matched to your connection pool.

Conversely, **serial awaits that could be concurrent** are the opposite waste:

```ts
const user = await getUser(id);        // ✗ 3 round trips in series
const orders = await getOrders(id);
const prefs = await getPrefs(id);

const [user, orders, prefs] = await Promise.all([getUser(id), getOrders(id), getPrefs(id)]);  // ✓ 1
```

## 4. Make it faster

Last, and where most wasted effort goes.

### Complexity first

An accidental O(n²) beats every micro-optimisation applied to it:

```ts
const active = users.filter((u) => activeIds.includes(u.id));   // O(n·m)
const activeSet = new Set(activeIds);
const active = users.filter((u) => activeSet.has(u.id));        // O(n)
```

At 10,000 × 10,000 that is 100,000,000 comparisons versus 10,000 lookups. The tells: `find`,
`includes`, `indexOf` or `filter` **inside** a loop or another array method.

### Data structures

| Need | Use | Not |
|---|---|---|
| membership test | `Set` | `Array.includes` |
| keyed lookup | `Map` | object with dynamic keys |
| grouping | `Map.groupBy` / `Object.groupBy` | manual reduce into an object |
| numeric buffers | `TypedArray` | `Array<number>` |

`Map` also beats a plain object for user-controlled keys because it is immune to prototype
pollution — a security property as well as a performance one.

### Native over user-land

Bun replaces most of the classic utility set, and native is both faster and one fewer dependency:
`structuredClone`, `Object.groupBy`, `Array.at/toSorted/flatMap`, `Bun.deepEquals`,
`Bun.stringWidth`, `Bun.escapeHTML`, `Bun.hash`.

### CPU-bound work belongs in a worker

MEASURED, chunking with `await Bun.sleep(0)` kept the loop responsive (1 → 40 timer fires) but made
the work **6x slower** (30 ms → 181 ms). A `node:worker_threads` worker avoids that trade entirely
by moving the work off the main loop:

```ts
const worker = new Worker(new URL("./heavy.ts", import.meta.url).href);
worker.postMessage(payload);
```

Worth it only when the work substantially exceeds the ~1 ms postMessage and serialisation overhead.
For 5 ms of work it is a loss; for 500 ms it is the only correct answer.

## Memory and GC

Allocation pressure shows up as latency, because GC pauses land on whatever is running.

- **Reuse buffers** in hot loops rather than allocating per iteration.
- **Do not retain more than you need.** A closure capturing a large object keeps it alive; slice out
  the field you need.
- **Prefer `.bytes()` to `.text()`** when you do not need a string — MEASURED, it was faster in both
  runs precisely because it skips decoding and the string allocation.
- `--smol` reduces heap size at the cost of more frequent GC. For memory-constrained sidecars, not
  for throughput.

## The rule

**Slower obvious code beats faster incomprehensible code until a measurement says otherwise.**
Every optimisation costs readability, and readability is what lets the next person fix the real
bottleneck. Pay that cost only where a profiler pointed.
