# Testing Patterns

## Introduction

Go's testing package is minimal but powerful. This document showcases production patterns for writing maintainable, fast, and reliable tests.

---

## Example 1: Table-Driven Tests with Subtests (Go Standard Library)

**Project:** Go Standard Library
**File:** `src/testing/testing.go`
**Link:** https://github.com/golang/go/blob/master/src/testing/testing.go

**Pattern:** Hierarchical test organization with parallel execution.

```go
func TestFoo(t *testing.T) {
    // Setup shared across subtests
    db := setupDatabase()
    defer db.Close()

    tests := []struct {
        name    string
        input   int
        want    int
    }{
        {"positive", 5, 5},
        {"negative", -5, 5},
        {"zero", 0, 0},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()  // Run subtests in parallel

            got := abs(tt.input)
            if got != tt.want {
                t.Errorf("abs(%d) = %d; want %d",
                    tt.input, got, tt.want)
            }
        })
    }
}

// Grouped parallel tests
func TestGroupedParallel(t *testing.T) {
    tests := []struct {
        name string
        fn   func(*testing.T)
    }{
        {"A", testA},
        {"B", testB},
        {"C", testC},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()
            tt.fn(t)
        })
    }
}
```

**Why this is excellent:**
- Clear test case organization
- Parallel execution for speed
- Shared setup/teardown
- Hierarchical naming (TestFoo/positive)
- Easy to add new test cases

---

## Example 2: Test Helpers (Go Standard Library)

**Project:** Go Standard Library
**File:** `src/testing/testing.go`
**Link:** https://github.com/golang/go/blob/master/src/testing/testing.go

**Pattern:** Mark helper functions to improve error reporting.

```go
// Helper function for test assertions
func assertEqual(t *testing.T, got, want interface{}) {
    t.Helper()  // Mark as helper to skip in stack traces

    if !reflect.DeepEqual(got, want) {
        t.Errorf("got %v; want %v", got, want)
    }
}

func assertNoError(t *testing.T, err error) {
    t.Helper()

    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

// Usage in tests
func TestSomething(t *testing.T) {
    result, err := doSomething()
    assertNoError(t, err)           // Error points to this line
    assertEqual(t, result, expected) // Not to assertEqual internals
}
```

**Why this is excellent:**
- Clearer error messages
- Reusable assertion logic
- Error points to actual test line
- Reduces test boilerplate

---

## Example 3: Time Mocking (CockroachDB)

**Project:** CockroachDB
**File:** `pkg/util/timeutil/time.go`
**Link:** https://github.com/cockroachdb/cockroach/blob/master/pkg/util/timeutil/time.go

**Pattern:** Injectable time source for deterministic tests.

```go
// Production: Use real time with UTC enforcement
func Now() time.Time {
    t := time.Now()
    // Unsafe pointer manipulation to preserve monotonic clock
    x := (*timeLayout)(unsafe.Pointer(&t))
    x.loc = nil  // nil = UTC
    return t
}

// Testing: Use manual time source (from manual_time.go)
type ManualTime struct {
    mu      sync.RWMutex
    current time.Time
}

func NewManualTime(start time.Time) *ManualTime {
    return &ManualTime{current: start}
}

func (m *ManualTime) Now() time.Time {
    m.mu.RLock()
    defer m.mu.RUnlock()
    return m.current
}

func (m *ManualTime) Advance(d time.Duration) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.current = m.current.Add(d)
}

// TimeSource interface enables injection
type TimeSource interface {
    Now() time.Time
}

// Usage in code
type Service struct {
    timeSource TimeSource
}

func (s *Service) Process() {
    timestamp := s.timeSource.Now()
    // ... use timestamp
}

// Test with manual time
func TestService(t *testing.T) {
    clock := timeutil.NewManualTime(time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC))
    svc := &Service{timeSource: clock}

    // Control time in tests
    clock.Advance(5 * time.Minute)
    // ... assertions
}
```

**Why this is excellent:**
- Deterministic time in tests
- No sleeps needed
- UTC enforcement in production
- Preserves monotonic clock readings
- Interface-based injection

---

## When to Use

- **Table-driven tests** - Always prefer table-driven tests for testing multiple scenarios
- **Subtests with t.Run()** - Organize related test cases and enable selective test execution
- **t.Parallel()** - Speed up test suites by running independent tests in parallel
- **t.Helper()** - Mark assertion helpers to improve error reporting
- **Time injection** - Use injectable time sources for deterministic tests
- **Test fixtures** - Use `testdata/` directory for test input files
- **Golden files** - Store expected outputs and use `-update` flag to regenerate them

**Source Projects:**
- Go Standard Library: https://github.com/golang/go
- CockroachDB: https://github.com/cockroachdb/cockroach
