# Concurrency Patterns

## Introduction

Go's concurrency primitives (goroutines and channels) are powerful but require discipline to use correctly. This document showcases production patterns for managing goroutine lifecycles, retry logic, and resource pooling.

---

## Example 1: Goroutine Lifecycle Management (CockroachDB)

**Project:** CockroachDB
**File:** `pkg/util/stop/stopper.go`
**Link:** https://github.com/cockroachdb/cockroach/blob/master/pkg/util/stop/stopper.go

**Pattern:** Structured concurrency with graceful shutdown.

```go
type Stopper struct {
    quiescer chan struct{}  // Closed when quiescing
    stopped  chan struct{}  // Closed when fully stopped
    mu       struct {
        sync.RWMutex
        stopping   bool
        _numTasks  int32
        closers    []io.Closer
        qCancels   sync.Map  // Cancel functions
        idAlloc    int64
    }
}

// Register task before launching
func (s *Stopper) addTask(delta int32) int32 {
    return atomic.AddInt32(&s.mu._numTasks, delta)
}

func (s *Stopper) runPrelude() bool {
    s.mu.RLock()
    defer s.mu.RUnlock()

    if s.refuseRLocked() {
        return false  // Already stopping
    }

    s.addTask(1)  // Register before launching
    return true
}

// Launch async task with quota control
func (s *Stopper) RunAsyncTaskEx(ctx context.Context, opt TaskOpts,
    f func(context.Context)) error {

    ctx, hdl, err := s.GetHandle(ctx, opt)
    if err != nil {
        return err
    }

    go func(ctx context.Context) {
        defer hdl.Activate(ctx).Release(ctx)
        f(ctx)
    }(ctx)

    return nil
}

// Graceful shutdown
func (s *Stopper) Stop(ctx context.Context) {
    // Make stopping idempotent
    stopCalled := func() bool {
        s.mu.Lock()
        defer s.mu.Unlock()
        stopCalled := s.mu.stopping
        s.mu.stopping = true
        return stopCalled
    }()

    if stopCalled {
        <-s.stopped  // Wait for concurrent Stop()
        return
    }

    // Wait for tasks to complete
    s.Quiesce(ctx)

    // Run closers in reverse order
    s.mu.Lock()
    for i := len(s.mu.closers) - 1; i >= 0; i-- {
        s.mu.closers[i].Close()
    }
    s.mu.Unlock()

    close(s.stopped)
}

// Context cancellation on quiesce
func (s *Stopper) WithCancelOnQuiesce(ctx context.Context) (context.Context, func()) {
    ctx, cancel := context.WithCancel(ctx)

    s.mu.RLock()
    defer s.mu.RUnlock()

    if s.refuseRLocked() {
        cancel()
        return ctx, func() {}
    }

    id := atomic.AddInt64(&s.mu.idAlloc, 1)
    s.mu.qCancels.Store(id, &cancel)

    return ctx, func() {
        cancel()
        s.mu.qCancels.Delete(id)
    }
}
```

**Why this is excellent:**
- All goroutines tracked atomically
- Graceful shutdown with quiescing phase
- Idempotent Stop()
- Context cancellation propagation
- Reverse-order cleanup
- Prevents new tasks during shutdown

---

## Example 2: Retry with Exponential Backoff (CockroachDB)

**Project:** CockroachDB
**File:** `pkg/util/retry/retry.go`
**Link:** https://github.com/cockroachdb/cockroach/blob/master/pkg/util/retry/retry.go

**Pattern:** Configurable retry with jittered backoff.

```go
type Options struct {
    InitialBackoff      time.Duration  // Default: 50ms
    MaxBackoff          time.Duration  // Default: 2s
    Multiplier          float64        // Default: 2
    RandomizationFactor float64        // Default: 0.15
    MaxRetries          int
    MaxDuration         time.Duration
    PreemptivelyCancel  bool
    Closer              <-chan struct{}
}

// Exponential backoff with jitter
func (r *Retry) calculateBackoff() time.Duration {
    backoff := float64(r.opts.InitialBackoff) *
        math.Pow(r.opts.Multiplier, float64(r.currentAttempt))

    if maxBackoff := float64(r.opts.MaxBackoff); backoff > maxBackoff {
        backoff = maxBackoff
    }

    // Add randomization
    delta := r.opts.RandomizationFactor * backoff
    return time.Duration(backoff - delta + rand.Float64()*(2*delta+1))
}

// Basic retry loop
func (r *Retry) Next() bool {
    if r.currentAttempt > 0 {
        select {
        case <-r.ctx.Done():
            return false
        case <-r.opts.Closer:
            return false
        case <-time.After(r.calculateBackoff()):
        }
    }

    r.currentAttempt++

    // Check limits
    if r.opts.MaxRetries > 0 && r.currentAttempt > r.opts.MaxRetries {
        return false
    }

    if r.opts.MaxDuration > 0 && time.Since(r.start) > r.opts.MaxDuration {
        return false
    }

    return true
}

// Usage: Simple loop
for r := retry.Start(opts); r.Next(); {
    err := attemptOperation()
    if err == nil {
        return nil
    }
}

// Usage: With retryable error check
opts.DoWithRetryable(ctx, func(ctx context.Context) (bool, error) {
    err := operation()
    if err == nil {
        return false, nil
    }
    return isRetryable(err), err
})

// Usage: Fixed attempts
retry.WithMaxAttempts(ctx, opts, 3, func() error {
    return operation()
})
```

**Why this is excellent:**
- Prevents thundering herd with jitter
- Context-aware cancellation
- Multiple usage patterns
- Configurable limits (attempts, duration)
- Preemptive cancellation option

---

## Example 3: Connection Pool Management (database/sql)

**Project:** Go Standard Library
**File:** `src/database/sql/sql.go`
**Link:** https://github.com/golang/go/blob/master/src/database/sql/sql.go

**Pattern:** Background connection opener with channel-based coordination.

```go
type DB struct {
    connector    driver.Connector
    openerCh     chan struct{}
    mu           sync.Mutex
    freeConn     []*driverConn
    connRequests map[uint64]chan connRequest
    numOpen      int
    maxOpen      int
    maxIdle      int
    stop         func()  // Cancels opener goroutine
}

func OpenDB(c driver.Connector) *DB {
    ctx, cancel := context.WithCancel(context.Background())
    db := &DB{
        connector: c,
        openerCh:  make(chan struct{}, connectionRequestQueueSize),
        lastPut:   make(map[*driverConn]string),
        stop:      cancel,
    }

    // Launch background connection opener
    go db.connectionOpener(ctx)

    return db
}

// Background goroutine opens connections on demand
func (db *DB) connectionOpener(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-db.openerCh:
            db.openNewConnection(ctx)
        }
    }
}

// Signal opener when connection needed
func (db *DB) maybeOpenNewConnections() {
    numRequests := len(db.connRequests)
    if db.maxOpen > 0 {
        numCanOpen := db.maxOpen - db.numOpen
        if numRequests > numCanOpen {
            numRequests = numCanOpen
        }
    }

    for numRequests > 0 {
        db.numOpen++ // Optimistic increment
        numRequests--

        // Non-blocking send
        select {
        case db.openerCh <- struct{}{}:
        default:
            // Channel full, connection will open later
        }
    }
}
```

**Why this is excellent:**
- Separates connection creation from request handling
- Channel-based work queue
- Graceful shutdown via context
- Bounded queue prevents unbounded goroutines
- Non-blocking signaling

---

## When to Use

- **Structured concurrency (Stopper)** - When you need to manage multiple goroutines with graceful shutdown
- **Retry with backoff** - For network operations or any operation that may fail transiently
- **Jittered backoff** - Prevents thundering herd when multiple clients retry simultaneously
- **Connection pooling** - Background goroutine + channel for resource management
- **Context cancellation** - Always support context cancellation for long-running goroutines
- **WaitGroups** - For simple "wait for N goroutines to finish" scenarios

**Source Projects:**
- CockroachDB: https://github.com/cockroachdb/cockroach
- Go Standard Library: https://github.com/golang/go
