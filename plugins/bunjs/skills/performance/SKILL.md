---
name: performance
description: Diagnose and fix Bun/TypeScript performance — event-loop blocking, measured native fast paths, benchmarking that does not lie, streaming, caching, workers, memory. Ships a tested benchmark harness.
disable-model-invocation: true
---

# Performance

The first rule is unglamorous and skipping it is why most optimisation work is wasted:
**measure before you change anything.** Intuition about JavaScript performance is unreliable, and
this skill opens with a measurement that proves it.

## The folklore this skill disproves

"Always use `Bun.file()`, it's faster than `node:fs`." MEASURED on Bun 1.3.10, 1 MiB whole-file
read, 50 iterations, two independent runs (ms/op):

| Operation | run A | run B |
|---|---|---|
| `Bun.file(p).text()` | 0.124 | 0.133 |
| `node:fs/promises readFile(p,"utf8")` | **0.112** | **0.097** |
| `Bun.file(p).bytes()` | **0.084** | **0.093** |

1 MiB write: `Bun.write` 0.188 / 0.244 vs `node:fs writeFile` **0.151 / 0.132**.

**`Bun.file()` was not faster for whole-file reads or writes, in either run.** The ordering was
stable across runs, so this is not noise. The repeatable win is smaller and more specific: `.bytes()`
beat `.text()` both times, because it skips UTF-8 decoding.

The lesson is not "use node:fs". It is that a plausible, widely-repeated claim did not survive
contact with a stopwatch — on *this* machine, at *this* size. Measure yours.

Where Bun's natives genuinely win, measured here: **`Bun.hash` (wyhash) is ~10x faster than
`Bun.CryptoHasher("sha256")`** (0.033 vs 0.376 ms/MiB). Use it for cache keys and change
detection — never for anything security-bearing.

## Copy the harness in

**18 tests ship with this code and pass** (`bun test`, `tsc --noEmit` clean, Bun 1.3.10).

```bash
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/performance}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"  # that var is UNSET in a Bash tool (MEASURED) — so paste it. `:?` would ABORT the block and copy nothing
mkdir -p bench; if [ -d "$SKILL/assets" ]; then cp -r "$SKILL/assets/perf" bench/support   # bench harness + tests
else echo "SKILL is still the placeholder — paste the real dir above and re-run"; fi
```

It corrects the three ways hand-rolled benchmarks lie:

1. **No warmup** — JavaScriptCore interprets first and optimises once a function is hot, so early
   iterations measure the interpreter.
2. **One sample reported as the number** — scheduler noise, GC and CPU frequency scaling move
   results by tens of percent.
3. **A mean** — one GC pause destroys it. The harness reports **median, min, p95 and MAD**.

It also **calibrates iterations automatically**, which matters more than it sounds: MEASURED,
`Bun.nanoseconds()` has **~42 ns granularity** (consecutive-call deltas were `42, 0, 42, 0, 0`).
A single timed call around anything sub-microsecond reports `0` or `42` — a confidently wrong
number. A shipped test asserts the harness picks >1000 iterations for `() => 1 + 1`.

`compare()` refuses to call a difference a win when it falls inside the measured spread, because
"5% faster" with 15% variance is how no-op micro-optimisations get merged.

## Event-loop blocking is the number that matters for a server

Throughput and responsiveness are different measurements, and for a service the second one decides
whether requests time out. MEASURED — a 1 ms `setInterval` running alongside a 4×10⁷-iteration
accumulate:

| Approach | wall time | timer fires during it |
|---|---|---|
| one blocking loop | **30 ms** | **1** |
| 40 chunks with `await Bun.sleep(0)` between | **181 ms** | **40** |

**Yielding restored responsiveness (1 → 40) but made the same work 6x slower.** Chunking is a
latency/throughput *trade*, not a free win — which is why it belongs on request-path work and not
on a batch job nobody is waiting for.

`measureLoopBlocking(fn)` in the harness reports both numbers so the trade is visible rather than
assumed.

Concrete offenders on a request path, worst first:

| Blocking work | MEASURED cost |
|---|---|
| `JSON.parse` of a 1.81 MiB payload | **76 ms** — the loop serves nobody for that whole time |
| `Bun.password.hash` (argon2id default) | **~96 ms** — deliberate, and why login needs a rate limit not a cost reduction |
| `crypto` `*Sync`, `readFileSync`, big `sort`/`map` chains | proportional to size |

## The optimisation order

Work down this list. Steps 1–3 usually make step 4 unnecessary.

1. **Do it fewer times.** Caching, batching, and the N+1 query. One query returning 100 rows beats
   100 queries returning one, by orders of magnitude that no code tuning reaches.
2. **Do it off the request path.** Enqueue the email, the thumbnail, the webhook. The user waits
   for a database write, not for your image pipeline.
3. **Do it lazily or incrementally.** Stream instead of buffering; paginate instead of loading
   everything; compute on read if reads are rarer than writes.
4. **Make it faster.** The last resort, and where nearly all wasted effort goes.

**Algorithmic complexity dominates everything else.** An accidental O(n²) — a `find` inside a
`map`, an `includes` inside a loop — beats every micro-optimisation you could apply to it. Replacing
an array `includes` with a `Set.has` inside a loop over 10,000 items is a 10,000x reduction in
comparisons; nothing in step 4 comes close.

## Where the time actually goes

Before optimising code, check whether the code is the problem at all. In a typical service the
ranking is:

1. **Database** — missing index, N+1, unbounded query. Usually 10–100x anything else.
2. **Network** — serial upstream calls that could be `Promise.all`; missing timeouts.
3. **Serialisation** — see the 76 ms `JSON.parse` above.
4. **Application logic** — genuinely last, far more often than people expect.

Add timing around each boundary before profiling function-level detail. `Bun.nanoseconds()` around
a query is cheap and answers the question faster than a profiler.

## Bun-specific notes, measured

- **`bun build --compile`** produces a **58 MB** binary, and `--bytecode --minify` does **not**
  shrink it — the runtime dominates. Compile for distribution, not for size.
- **`--smol`** trades memory for more frequent GC. For memory-constrained sidecars, not throughput.
- **Workers** (`node:worker_threads`) are the answer for genuinely CPU-bound work — they move it
  off the main loop entirely rather than trading 6x throughput for responsiveness. Worth it only
  when the work exceeds the ~1 ms postMessage overhead by a wide margin.
- **`reusePort: true`** on `Bun.serve` lets multiple processes share a port, which is how you use
  more than one core without a proxy.

## Acceptance — before reporting done

1. **A before/after measurement, from the same harness, in the same session.** "Feels faster" is
   not a result. Include the spread — a change inside the noise band is not a change.
2. The benchmark ran with warmup and multiple samples. A single-run number is not evidence.
3. `bun test` and `tsc --noEmit` still clean — an optimisation that breaks behaviour is a
   regression regardless of its numbers.
4. You optimised something the profiler pointed at, not something that looked slow.
5. Complexity did not increase for a gain inside the noise. Slower obvious code beats faster
   incomprehensible code until a measurement says otherwise.

## References

| File | Read it when |
|---|---|
| `references/profiling.md` | finding the bottleneck — timing boundaries, heap snapshots, `bun:jsc`, load testing, what the numbers mean |
| `references/optimisation-patterns.md` | caching, batching, N+1, streaming, workers, memory and GC pressure, data-structure choices |
