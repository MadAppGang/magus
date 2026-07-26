# Performance Optimization

## Introduction

Performance optimization in Go often involves reducing allocations, reusing buffers, and careful use of the standard library. This document showcases production patterns for high-performance code.

---

## Example 1: Object Pooling (Docker/Moby)

**Project:** Docker/Moby
**File:** `pkg/pools/pools.go`
**Link:** https://github.com/moby/moby/blob/master/pkg/pools/pools.go

**Pattern:** Buffer pool to reduce allocations.

```go
type BufioReaderPool struct {
    pool sync.Pool
}

func newBufioReaderPoolWithSize(size int) *BufioReaderPool {
    return &BufioReaderPool{
        pool: sync.Pool{
            New: func() any {
                return bufio.NewReaderSize(nil, size)
            },
        },
    }
}

// Get buffer from pool
func (bufPool *BufioReaderPool) Get(r io.Reader) *bufio.Reader {
    buf := bufPool.pool.Get().(*bufio.Reader)
    buf.Reset(r)  // Reset for new reader
    return buf
}

// Return buffer to pool
func (bufPool *BufioReaderPool) Put(b *bufio.Reader) {
    b.Reset(nil)  // Clear reference
    bufPool.pool.Put(b)
}

// Pre-configured pools
var (
    BufioReader32KPool = newBufioReaderPoolWithSize(32 * 1024)
    buffer32KPool      = newBytePool(32 * 1024)
)

// Convenience wrapper
func Copy(dst io.Writer, src io.Reader) (int64, error) {
    buf := buffer32KPool.Get()
    written, err := io.CopyBuffer(dst, src, *buf)
    buffer32KPool.Put(buf)
    return written, err
}
```

**Why this is excellent:**
- Reduces GC pressure
- Type-safe API
- Reset prevents data leakage
- Pre-configured common sizes
- Zero-allocation I/O

---

## Example 2: UTC Time Optimization (CockroachDB)

**Project:** CockroachDB
**File:** `pkg/util/timeutil/time.go`
**Link:** https://github.com/cockroachdb/cockroach/blob/master/pkg/util/timeutil/time.go

**Pattern:** Preserve monotonic clock while enforcing UTC.

```go
// timeLayout matches time.Time internal structure
type timeLayout struct {
    wall uint64
    ext  int64
    loc  *time.Location
}

// Now returns UTC time while preserving monotonic clock
func Now() time.Time {
    t := time.Now()

    // Direct location manipulation via unsafe
    x := (*timeLayout)(unsafe.Pointer(&t))
    x.loc = nil  // nil location = UTC

    return t
}

// Standard library approach strips monotonic clock
func NowNoMono() time.Time {
    return time.Now().UTC()  // Slower, loses monotonic part
}
```

**Why this is excellent:**
- Preserves nanosecond precision
- Avoids allocation from `.UTC()`
- Maintains monotonic clock for comparisons
- Clear documentation of trade-offs

---

## When to Use

- **sync.Pool** - For frequently allocated/deallocated objects (buffers, temporary objects)
- **Pre-allocated slices** - Use `make([]T, 0, capacity)` when you know the approximate size
- **String building** - Use `strings.Builder` instead of string concatenation in loops
- **Buffer reuse** - Reset and reuse buffers instead of allocating new ones
- **Profiling first** - Use `pprof` to identify actual bottlenecks before optimizing
- **Benchmarking** - Write benchmarks (`BenchmarkXxx`) to validate optimizations
- **Escape analysis** - Use `go build -gcflags='-m'` to see what escapes to heap

**Source Projects:**
- Docker/Moby: https://github.com/moby/moby
- CockroachDB: https://github.com/cockroachdb/cockroach
