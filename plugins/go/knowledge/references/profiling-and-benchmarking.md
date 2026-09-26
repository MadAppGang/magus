# Profiling and Benchmarking

## Introduction

Measure before you change anything. This file covers the measuring half: CPU, heap and
goroutine profiles with `pprof`, benchmarks that report allocations, a statistical
before/after comparison, escape analysis, and the two GC knobs. The production examples of
what to change once you have measured are in
[performance-optimization.md](./performance-optimization.md).

The benchmark and escape-analysis output below was produced on Go 1.27. `b.Loop()` needs
Go 1.24 or newer; on older toolchains use `for i := 0; i < b.N; i++`.

---

## Profiling with pprof

**From a benchmark** (the usual route, because it isolates one code path):

```bash
go test -run=NONE -bench=BenchmarkParse -cpuprofile=cpu.prof -memprofile=mem.prof ./pkg/parse
go tool pprof -http=:8080 cpu.prof          # browser UI: flame graph, source, graph
go tool pprof -top -cum cpu.prof            # text: sorted by time including callees
```

`flat` is time spent in the function itself; `cum` includes its callees. Optimise where
`flat` is high. A high `cum` with a low `flat` means the cost is further down.

**Heap profile sample types**, chosen with `-sample_index`:

| Index | Answers |
|---|---|
| `inuse_space` (default) | what is holding memory now — leaks, oversized caches |
| `alloc_space` | what allocated the most bytes over the run — GC pressure |
| `alloc_objects` | what allocated most often — many small allocations |

Compare two profiles with `go tool pprof -base=before.prof after.prof`.

**From a running service**, import `net/http/pprof` for its side effect and serve it on a
**localhost-only** port. The handlers expose stack traces and must never face the internet:

```go
import _ "net/http/pprof"

go func() { log.Println(http.ListenAndServe("localhost:6060", nil)) }()
```

```bash
go tool pprof -http=:8080 'http://localhost:6060/debug/pprof/profile?seconds=30'  # CPU
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap
curl 'http://localhost:6060/debug/pprof/goroutine?debug=1'   # goroutines grouped by stack, with counts
curl 'http://localhost:6060/debug/pprof/goroutine?debug=2'   # every goroutine's stack, one by one
```

Reach a remote host through an SSH tunnel (`ssh -L 6060:localhost:6060 host`), not by
binding to a public address. The `block` and `mutex` profiles are empty until
`runtime.SetBlockProfileRate` and `runtime.SetMutexProfileFraction` turn them on.

**A goroutine leak** shows as a goroutine count that only grows. The `debug=1` dump groups
identical stacks with a count each; a large count parked on the same channel operation is the
leak. Use `debug=2` for the full trace of one goroutine once you know which stack to read.

---

## Benchmarks

```go
func BenchmarkParse(b *testing.B) {
    input := loadInput(b)     // setup before the loop is not timed with b.Loop
    for b.Loop() {
        Parse(input)
    }
}
```

`b.Loop()` times only the loop body and keeps the compiler from optimising the call away,
so the old `_ = result` sink and `b.ResetTimer()` after setup are no longer needed.

Compare implementations with sub-benchmarks, `b.Run("builder", …)`, so they share one run.

```bash
go test -run=NONE -bench=. -benchmem ./...      # adds B/op and allocs/op
```

A real run on Go 1.27.1 (Apple M5 Max) for a four-string `strings.Builder` join, default
`-benchtime`:

```
BenchmarkConcat-18    	78083390	        15.15 ns/op	       8 B/op	       1 allocs/op
```

`allocs/op` is usually the number to drive down: each allocation is work for the GC later.

---

## Comparing before and after

One run of each is noise. Take ten, then let `benchstat` decide whether the change is real:

```bash
go install golang.org/x/perf/cmd/benchstat@latest
go test -run=NONE -bench=. -benchmem -count=10 ./pkg/parse > old.txt
# make the change
go test -run=NONE -bench=. -benchmem -count=10 ./pkg/parse > new.txt
benchstat old.txt new.txt
```

`benchstat` prints the delta with a p-value. A delta it marks `~` is not distinguishable from
noise; do not claim it as a win.

---

## Escape analysis

```bash
go build -gcflags=-m ./pkg/parse 2>&1 | grep -E 'escapes to heap|moved to heap'
```

Grep for both phrases. A local variable that escapes is reported as `moved to heap: x`,
which a grep for `escapes to heap` alone misses. Measured on Go 1.27:

| Code | Compiler says |
|---|---|
| `x := Item{}; return &x` | `moved to heap: x` |
| `make([]byte, 1<<20)` | `escapes to heap` — too large for the stack |
| `use(&it)` on a range variable, where `use` keeps no reference | nothing escapes; the benchmark shows `0 allocs/op` |

Taking an address does not by itself allocate. Only an address that outlives the call
does: returned, stored in a field, a global or a channel, or captured by a goroutine.
Converting a value to an interface can also allocate. Read the `-m` output rather than
guessing.

The common fixes, in the order they usually pay off:

1. Size slices and maps up front when the length is known: `make([]T, 0, n)`,
   `make(map[K]V, n)`.
2. Build strings with `strings.Builder`, calling `Grow` when the final size is known.
3. Reuse short-lived buffers through a `sync.Pool`, resetting each one on `Get`.
   The pooling example in [performance-optimization.md](./performance-optimization.md)
   shows the pattern.

`defer` inside a loop is a correctness bug before it is a cost: the deferred calls run only
when the function returns, so a `mu.Lock(); defer mu.Unlock()` in a loop deadlocks on the
second iteration. Move the loop body into its own function, or unlock explicitly.

---

## GC tuning

Two knobs, both settable by environment variable or at runtime (`runtime/debug`):

| Knob | Effect |
|---|---|
| `GOGC` (default `100`) | The heap may grow by this percentage of the live heap before the next collection. `200` collects less often and uses more memory; `50` the reverse; `off` disables it. |
| `GOMEMLIMIT` (Go 1.19+) | A soft memory ceiling, for example `GOMEMLIMIT=1800MiB`. The GC works harder as the heap nears it. It is not a hard cap. |

In a container, set `GOMEMLIMIT` a little below the container's limit so the GC reacts
before the kernel kills the process. With `GOMEMLIMIT` set, `GOGC=off` collects only when
the limit is approached, which suits a batch job with a known memory budget.

Tune these last, after profiling. They trade memory for CPU; they do not remove the
allocations that caused the pressure.

**Watch the effect** with the `runtime/metrics` package or `GODEBUG=gctrace=1`, which prints
one line per collection to stderr.

---

## When to Use

- A request, a job or a test is slower than it should be, and you need to know where
- Memory grows over time and you need to know what holds it
- You made a performance change and need to show it helped
