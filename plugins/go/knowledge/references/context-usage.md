# Context Usage

## Introduction

The `context` package provides a standardized way to pass deadlines, cancellation signals, and request-scoped values across API boundaries. This document showcases production patterns for effective context usage.

---

## Example 1: Context-Aware Database Operations (database/sql)

**Project:** Go Standard Library
**File:** `src/database/sql/sql.go`
**Link:** https://github.com/golang/go/blob/master/src/database/sql/sql.go

**Pattern:** Context variants for cancellation and timeout support.

```go
// All major operations have context variants

func (db *DB) QueryContext(ctx context.Context, query string, args ...any) (*Rows, error)
func (db *DB) ExecContext(ctx context.Context, query string, args ...any) (Result, error)
func (db *DB) PrepareContext(ctx context.Context, query string) (*Stmt, error)

// Transaction creation with context
func (db *DB) BeginTx(ctx context.Context, opts *TxOptions) (*Tx, error) {
    // ...
    ctx, cancel := context.WithCancel(ctx)
    tx := &Tx{
        db:     db,
        dc:     dc,
        ctx:    ctx,
        cancel: cancel,
    }

    // Monitor context cancellation
    go tx.awaitDone()

    return tx, nil
}

func (tx *Tx) awaitDone() {
    <-tx.ctx.Done()
    // Rollback on cancellation
    tx.rollback(true)
}
```

**Why this is excellent:**
- Consistent naming convention (MethodContext)
- Background goroutine monitors cancellation
- Graceful cleanup on context cancellation
- Timeout support through context deadlines

---

## Example 2: Context for Lifecycle Management (CockroachDB)

**Project:** CockroachDB
**File:** `pkg/util/stop/stopper.go`
**Link:** https://github.com/cockroachdb/cockroach/blob/master/pkg/util/stop/stopper.go

**Pattern:** Context tied to component lifecycle for automatic cancellation.

```go
func (s *Stopper) WithCancelOnQuiesce(ctx context.Context) (context.Context, func()) {
    ctx, cancel := context.WithCancel(ctx)

    s.mu.RLock()
    defer s.mu.RUnlock()

    // If already stopping, cancel immediately
    if s.refuseRLocked() {
        cancel()
        return ctx, func() {}
    }

    // Register cancellation function
    id := atomic.AddInt64(&s.mu.idAlloc, 1)
    s.mu.qCancels.Store(id, &cancel)

    // Return cleanup function
    return ctx, func() {
        cancel()
        s.mu.qCancels.Delete(id)
    }
}
```

**Why this is excellent:**
- Automatic cancellation on component shutdown
- Cleanup function removes registration
- Immediate cancellation if already stopped
- Enables "set and forget" context propagation

---

## Example 3: Interruptible Context (Terraform)

**Project:** Terraform
**File:** `internal/command/meta.go`
**Link:** https://github.com/hashicorp/terraform/blob/main/internal/command/meta.go

**Pattern:** Context cancellation from OS signals.

```go
func (m *Meta) InterruptibleContext(base context.Context)
    (context.Context, context.CancelFunc) {

    if m.ShutdownCh == nil {
        return base, func() {}
    }

    ctx, cancel := context.WithCancel(base)

    // Monitor shutdown channel
    go func() {
        select {
        case <-m.ShutdownCh:
            cancel()
        case <-ctx.Done():
            // Context already cancelled
        }
    }()

    return ctx, cancel
}
```

**Why this is excellent:**
- Bridges OS signals to context cancellation
- Graceful handling of Ctrl-C
- Cleanup goroutine on either signal
- Nil channel check for testing scenarios

---

## Example 4: Context Best Practices (Go Standard Library)

**Project:** Go Standard Library
**File:** `src/context/context.go`
**Link:** https://github.com/golang/go/blob/master/src/context/context.go

**Pattern:** Documentation of context best practices.

```go
// Creating base contexts
ctx := context.Background()  // For main, init, and top-level requests
ctx := context.TODO()        // When uncertain which context to use

// Creating derived contexts
ctx, cancel := context.WithCancel(parentCtx)
defer cancel()  // Always defer cancel

ctx, cancel := context.WithDeadline(parentCtx, time.Now().Add(5*time.Second))
defer cancel()

ctx, cancel := context.WithTimeout(parentCtx, 100*time.Millisecond)
defer cancel()

ctx := context.WithValue(parentCtx, userKey, userData)
```

**Best practices from documentation:**
- Pass Context as first parameter, typically named `ctx`
- Do not store Contexts in structs; pass explicitly
- Do not pass nil Context; use context.TODO() if uncertain
- Use context Values only for request-scoped data
- Same Context may be passed to functions running in different goroutines

---

## When to Use

- **Context as first parameter** - Standard Go convention for cancellable operations
- **Always defer cancel()** - Even if you think the context won't be cancelled
- **Lifecycle-tied contexts** - Automatically cancel contexts when components shut down
- **Signal handling** - Bridge OS signals (SIGINT, SIGTERM) to context cancellation
- **Timeout operations** - Use `context.WithTimeout()` for operations with time limits
- **Request-scoped values** - Store request IDs, authentication tokens, etc. (use sparingly)

**Source Projects:**
- Go Standard Library: https://github.com/golang/go
- CockroachDB: https://github.com/cockroachdb/cockroach
- Terraform: https://github.com/hashicorp/terraform
