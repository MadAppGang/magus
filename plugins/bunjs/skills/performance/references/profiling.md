# Finding the bottleneck

## Start with boundaries, not functions

Before reaching for a profiler, time the four boundaries. This is minutes of work and usually ends
the investigation:

```ts
const t0 = Bun.nanoseconds();
const rows = await db.query(sql).all(params);
log.info("query", { ms: (Bun.nanoseconds() - t0) / 1e6, rows: rows.length });
```

Instrument: inbound handler total, each database call, each outbound HTTP call, each
serialisation of a large payload. In a typical service the ranking is database → network →
serialisation → application logic, and people reliably guess the reverse.

`rows: rows.length` is doing real work in that line. A query that is fast but returns 50,000 rows
is a serialisation and memory problem masquerading as a fast query.

## The measurement floor

MEASURED: `Bun.nanoseconds()` has **~42 ns granularity** — consecutive calls differed by
`42, 0, 42, 0, 0`. Anything below roughly a microsecond must be measured in a loop, or you are
reading quantisation noise. The shipped harness calibrates iterations for exactly this reason.

For wall-clock work (a query, a request) the granularity is irrelevant; for anything in-process
and small it is the whole story.

## Load testing tells you what a micro-benchmark cannot

A function that takes 100 µs in isolation may take 10 ms under concurrency because of GC pressure,
lock contention or connection-pool exhaustion. Only load tests surface that.

```bash
bunx autocannon -c 100 -d 30 http://localhost:3000/api/things
oha -c 100 -z 30s http://localhost:3000/api/things
```

Read the **percentiles**, not the average. An average of 200 ms is consistent with everyone getting
200 ms and with 95% getting 50 ms while 5% get 3 s — only the second is an incident.

Watch for the shape where throughput plateaus while latency climbs linearly: that is a saturated
resource (pool, thread, upstream), and no amount of code optimisation moves it. Find the pool.

Also load-test the **realistic** mix. A benchmark that hits one cached endpoint proves the cache
works, nothing more.

## Event-loop lag

The most useful continuous signal for a Bun service, because it degrades before anything else:

```ts
function loopLag(): Promise<number> {
  const started = Bun.nanoseconds();
  return new Promise((resolve) => setTimeout(() => resolve((Bun.nanoseconds() - started) / 1e6), 0));
}
```

A `setTimeout(…, 0)` that takes 40 ms to fire means something blocked the loop for 40 ms. Sample it
every few seconds and export it as a metric; rising lag predicts timeouts before users report them.

MEASURED offenders worth remembering: a single `JSON.parse` of a 1.81 MiB payload blocks for
**76 ms**; `Bun.password.hash` blocks for **~96 ms** by design.

`measureLoopBlocking(fn)` in the shipped harness gives the same signal for a specific block of code,
reporting wall time and observed timer ticks together.

## CPU profiling

```bash
bun --inspect src/index.ts     # then open the printed devtools URL, use the Profiler tab
```

Read the **flame graph bottom-up**: wide bars near the bottom are where time is actually spent.
A deep stack is not a slow stack.

Profile under realistic load. A profile of an idle process shows you the event loop waiting, which
is correct and useless.

`bun:jsc` exposes lower-level hooks when you need them:

```ts
import { generateHeapSnapshot, heapStats, memoryUsage } from "bun:jsc";
```

## Memory

```ts
const before = process.memoryUsage().heapUsed;
await doTheThing();
const grewMb = (process.memoryUsage().heapUsed - before) / 1048576;
```

Crude but effective for answering "does this scale with input size or stay flat?" — which is the
question that distinguishes streaming from buffering. The `http-service` skill's
`streamJsonArray` has a test built on exactly this shape.

**A leak is growth that does not return after GC.** Sample `heapUsed` over hours under steady load;
a sawtooth is healthy, a rising floor is a leak. To find it, take two heap snapshots minutes apart
and diff the retained sets — the object type that grew is nearly always enough to identify it.

The usual causes, in order:

| Cause | Tell |
|---|---|
| unbounded `Map`/array cache | grows with distinct keys, never shrinks |
| listeners added per request, never removed | listener count climbs |
| uncleared timers/intervals | process will not exit cleanly either |
| closures capturing large objects | retained size ≫ shallow size |

The shipped `RateLimiter` in the `security` skill is a worked example of the first: it needs
`sweep()` on an interval, or the map grows once per distinct key forever — attacker-controlled.

## Database

Almost always where the time is, and the fastest thing to check:

```sql
EXPLAIN ANALYZE SELECT …;
```

Look for sequential scans on large tables (missing index), nested loops over big row counts, and a
row estimate wildly different from actual (stale statistics).

**N+1 is the most common and most expensive.** Log query counts per request and alert when one
request issues more than a handful:

```ts
log.info("request_complete", { route, queryCount, totalQueryMs });
```

A route whose `queryCount` scales with result-set size is an N+1, and it is invisible in a
profiler that shows each query as fast.

## Interpreting a result honestly

- **Compare medians with spread.** The harness reports MAD; a difference inside it is not a
  difference.
- **Change one thing.** Two simultaneous changes give you one number and no attribution.
- **Re-measure after merging.** Benchmarks run on a quiet laptop and reality runs on a shared,
  throttled, cold-cache CI box.
- **Beware the dead-code trap.** A benchmark whose result is unused can be optimised away entirely,
  producing a spectacular and fictional number. Consume the result — the shipped harness returns
  values from its benchmarked functions for this reason.
