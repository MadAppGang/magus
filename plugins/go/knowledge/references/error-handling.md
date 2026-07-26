# Error Handling

## Introduction

Go's explicit error handling is one of its defining features. This document demonstrates production-proven patterns for creating, classifying, and handling errors effectively.

---

## Example 1: Sentinel Errors (database/sql)

**Project:** Go Standard Library
**File:** `src/database/sql/sql.go`
**Link:** https://github.com/golang/go/blob/master/src/database/sql/sql.go

**Pattern:** Package-level error constants for common conditions.

```go
// Sentinel errors for common conditions
var (
    ErrNoRows    = errors.New("sql: no rows in result set")
    ErrConnDone  = errors.New("sql: connection is already closed")
    ErrTxDone    = errors.New("sql: transaction already committed/rolled back")
)

// Usage in code
func (db *DB) QueryRowContext(ctx context.Context, query string, args ...any) *Row {
    rows, err := db.QueryContext(ctx, query, args...)
    return &Row{rows: rows, err: err}
}

// User code can check
err := db.QueryRow("SELECT ...").Scan(&id)
if err == sql.ErrNoRows {
    // Handle missing row
}
```

**Why this is excellent:**
- Clear, testable error conditions
- Works with errors.Is()
- Self-documenting through names
- Avoids string comparison

---

## Example 2: Retry with Error Classification (database/sql)

**Project:** Go Standard Library
**File:** `src/database/sql/sql.go`
**Link:** https://github.com/golang/go/blob/master/src/database/sql/sql.go

**Pattern:** Retry logic based on error type inspection.

```go
const maxBadConnRetries = 2

func (db *DB) retry(fn func(strategy connReuseStrategy) error) error {
    for i := int64(0); i < maxBadConnRetries; i++ {
        err := fn(cachedOrNewConn)

        // Success or non-retryable error
        if err == nil || !errors.Is(err, driver.ErrBadConn) {
            return err
        }

        // Bad connection - retry with new connection
    }

    // Final attempt with fresh connection
    return fn(alwaysNewConn)
}
```

**Why this is excellent:**
- Distinguishes transient vs. permanent failures
- Uses errors.Is() for error inspection
- Bounded retry attempts
- Strategy pattern for connection selection

---

## Example 3: Deferred Error Handling (database/sql)

**Project:** Go Standard Library
**File:** `src/database/sql/sql.go`
**Link:** https://github.com/golang/go/blob/master/src/database/sql/sql.go

**Pattern:** Store error in result object for later retrieval.

```go
type Row struct {
    rows *Rows
    err  error  // Deferred error from QueryRow
}

func (db *DB) QueryRowContext(ctx context.Context, query string, args ...any) *Row {
    rows, err := db.QueryContext(ctx, query, args...)
    return &Row{rows: rows, err: err}
}

func (r *Row) Scan(dest ...any) error {
    if r.err != nil {
        return r.err  // Return stored error
    }

    // ... perform scan
}
```

**Why this is excellent:**
- Simplifies call sites (no immediate error check)
- Error is eventually checked at Scan()
- Common for one-row queries
- Maintains error information through call chain

---

## When to Use

- **Sentinel errors** - For well-defined error conditions that callers may need to check
- **Error wrapping** - Use `fmt.Errorf("context: %w", err)` to add context while preserving the original error
- **Retry with classification** - Distinguish between transient and permanent failures using `errors.Is()` or `errors.As()`
- **Deferred errors** - When immediate error handling would complicate the API (use sparingly)
- **Custom error types** - When you need to include structured data with errors

**Source Projects:**
- Go Standard Library: https://github.com/golang/go
