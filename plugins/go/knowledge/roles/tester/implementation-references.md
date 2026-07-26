# Implementation Reference Index - Tester Role

Production-quality Go testing patterns and quality assurance techniques from industry-leading projects.

## About These References

All examples are extracted from real, production codebases:
- **Go Standard Library** (database/sql, context, testing)
- **Docker/Moby** (containerization platform)
- **Hugo** (static site generator)
- **CockroachDB** (distributed SQL database)
- **Terraform** (infrastructure as code)

Each reference file contains complete, working code with testing strategies and GitHub links to original sources.

---

## Core Testing Patterns

### 1. Testing Patterns
**[📖 View Complete Reference](../../references/testing-patterns.md)**

Master production-tested patterns for comprehensive test coverage.

**What you'll find:**
- Table-driven tests with subtests (Go standard library)
- Test helpers with `t.Helper()` for clean error reporting
- Time mocking for deterministic tests (CockroachDB)
- Parallel test execution

**When to use:**
- Unit testing with multiple scenarios
- Integration testing
- Testing time-dependent behavior
- Creating reusable test utilities

**Testing strategies:**
- Use `t.Run()` for hierarchical test organization
- Mark helper functions with `t.Helper()` for better stack traces
- Inject time sources (`TimeSource` interface) for determinism
- Run independent tests in parallel with `t.Parallel()`

**Key examples:**
```go
// Table-driven pattern
tests := []struct {
    name string
    input int
    want int
}{
    {"positive", 5, 5},
    {"negative", -5, 5},
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        // ... test logic
    })
}
```

---

### 2. Interface Design for Testability
**[📖 View Complete Reference](../../references/interface-design.md)**

Understand how small, focused interfaces enable comprehensive testing.

**What you'll find:**
- Database driver interfaces (easily mockable)
- Provider interfaces (request-response testability)
- Context interface (cancellation testing)

**Testing applications:**
- Create mock implementations for unit tests
- Test interface contracts independently
- Verify error handling at interface boundaries
- Test optional interface implementations

**Mock-friendly patterns:**
- Small interfaces (1-5 methods) are easier to mock
- Request-response patterns enable input/output verification
- Interface segregation allows partial mocking
- Return errors for failure case testing

---

### 3. Error Handling Verification
**[📖 View Complete Reference](../../references/error-handling.md)**

Test error conditions and recovery mechanisms comprehensively.

**What you'll find:**
- Sentinel errors for testable error conditions
- Retry logic with error classification
- Deferred error handling patterns

**Testing strategies:**
- Use `errors.Is()` to verify sentinel errors in tests
- Test retry limits and backoff behavior
- Verify error wrapping preserves context
- Test error recovery and cleanup paths

**Critical test cases:**
```go
// Test sentinel error
err := db.QueryRow("...").Scan(&id)
if !errors.Is(err, sql.ErrNoRows) {
    t.Errorf("expected ErrNoRows, got %v", err)
}

// Test retry behavior
attempts := 0
err := retry.Do(func() error {
    attempts++
    return errors.New("transient")
})
if attempts != maxRetries {
    t.Errorf("expected %d attempts, got %d", maxRetries, attempts)
}
```

---

### 4. Context Usage Testing
**[📖 View Complete Reference](../../references/context-usage.md)**

Test cancellation, timeouts, and context propagation.

**What you'll find:**
- Context-aware database operations
- Lifecycle-tied contexts
- Signal-to-context bridges
- Context best practices

**Testing scenarios:**
- Test context cancellation propagation
- Verify timeout behavior
- Test graceful shutdown mechanisms
- Verify context value propagation

**Critical tests:**
- Operations respect cancellation
- Timeouts trigger correctly
- Resources cleanup on context cancellation
- Context values are accessible in nested calls

**Example test:**
```go
func TestOperationCancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())

    // Start operation
    errCh := make(chan error)
    go func() {
        errCh <- service.LongOperation(ctx)
    }()

    // Cancel immediately
    cancel()

    // Verify cancellation
    select {
    case err := <-errCh:
        if !errors.Is(err, context.Canceled) {
            t.Errorf("expected context.Canceled, got %v", err)
        }
    case <-time.After(time.Second):
        t.Fatal("operation did not respect cancellation")
    }
}
```

---

### 5. Concurrency Testing
**[📖 View Complete Reference](../../references/concurrency-patterns.md)**

Test concurrent code for race conditions and proper synchronization.

**What you'll find:**
- Goroutine lifecycle management (CockroachDB Stopper)
- Exponential backoff with retry
- Connection pool management

**Testing focus:**
- Run tests with `-race` flag to detect data races
- Test goroutine leaks (use runtime.NumGoroutine())
- Verify graceful shutdown completes
- Test concurrent access patterns
- Verify retry backoff timing

**Critical concurrency tests:**
```go
func TestGracefulShutdown(t *testing.T) {
    stopper := NewStopper()

    // Start background tasks
    var completed atomic.Int32
    for i := 0; i < 10; i++ {
        stopper.RunAsyncTask(ctx, TaskOpts{}, func(ctx context.Context) {
            time.Sleep(100 * time.Millisecond)
            completed.Add(1)
        })
    }

    // Trigger shutdown
    stopper.Stop(ctx)

    // Verify all tasks completed
    if completed.Load() != 10 {
        t.Errorf("expected 10 completed tasks, got %d", completed.Load())
    }
}
```

---

### 6. Constructor Pattern Testing
**[📖 View Complete Reference](../../references/constructor-patterns.md)**

Test initialization, resource management, and option validation.

**What you'll find:**
- Functional options pattern testing
- Resource lifecycle verification
- Multi-stage initialization testing

**Testing strategies:**
- Test default values when no options provided
- Test each functional option independently
- Verify resource cleanup (defer, Close())
- Test option validation and error returns
- Verify background goroutines start correctly

**Constructor test patterns:**
```go
func TestClientOptions(t *testing.T) {
    tests := []struct {
        name string
        opts []ClientOption
        want ClientConfig
    }{
        {"defaults", nil, defaultConfig},
        {"custom host", []ClientOption{WithHost("custom")}, customConfig},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            client, err := NewClient(tt.opts...)
            assertNoError(t, err)
            assertEqual(t, client.config, tt.want)
        })
    }
}
```

---

### 7. Configuration Management Testing
**[📖 View Complete Reference](../../references/configuration-management.md)**

Test multi-source configuration, overrides, and validation.

**What you'll find:**
- Layered configuration loading
- Environment variable overrides
- Dependency validation

**Testing requirements:**
- Test configuration precedence (defaults < file < env < flags)
- Verify environment variable parsing
- Test validation failure cases
- Verify configuration merging
- Test missing required fields

---

### 8. HTTP/API Testing
**[📖 View Complete Reference](../../references/http-api-patterns.md)**

Test HTTP clients with timeouts, retries, and error handling.

**What you'll find:**
- Functional options for HTTP clients
- Composable client configuration

**Testing approaches:**
- Use `httptest.Server` for testing HTTP clients
- Test timeout behavior
- Verify retry logic
- Test connection pooling
- Verify request/response handling

---

## Quality Assurance Patterns

### Performance Testing
**[📖 View Complete Reference](../../references/performance-optimization.md)**

Benchmark and verify performance optimizations.

**Testing focus:**
- Write benchmarks with `testing.B`
- Test object pool efficiency
- Verify allocation counts (`testing.AllocsPerRun`)
- Benchmark hot paths
- Compare before/after optimization

**Benchmark example:**
```go
func BenchmarkWithPool(b *testing.B) {
    pool := NewBufferPool(32 * 1024)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        buf := pool.Get()
        // ... use buffer
        pool.Put(buf)
    }
}
```

---

### Package Organization Review
**[📖 View Complete Reference](../../references/package-organization.md)**

Verify package structure supports testability.

**Testing checklist:**
- Internal packages prevent external imports (test boundary enforcement)
- Public APIs have comprehensive test coverage
- Test dependencies don't leak into production code
- Mock implementations available for interfaces

---

### Plugin System Testing
**[📖 View Complete Reference](../../references/plugin-systems.md)**

Test plugin architectures and integrations.

**Testing strategies:**
- Test plugin lifecycle (init, use, shutdown)
- Verify schema validation
- Test plugin isolation
- Verify error handling across plugin boundaries

---

### CLI Testing
**[📖 View Complete Reference](../../references/cli-architecture.md)**

Test CLI applications end-to-end.

**Testing approaches:**
- Test flag parsing and validation
- Verify signal handling (SIGINT, SIGTERM)
- Test command composition
- Verify output formatting

---

## Testing Workflow

### For Comprehensive Test Coverage

1. **Start with:** [Testing Patterns](../../references/testing-patterns.md) - Learn table-driven tests and helpers
2. **Test interfaces:** [Interface Design](../../references/interface-design.md) - Mock and verify contracts
3. **Test errors:** [Error Handling Verification](../../references/error-handling.md) - Cover all error paths
4. **Test concurrency:** [Concurrency Testing](../../references/concurrency-patterns.md) - Race detection and lifecycle
5. **Test time:** Use time mocking from [Testing Patterns](../../references/testing-patterns.md) for determinism

### For Integration Testing

1. **Test contexts:** [Context Usage Testing](../../references/context-usage.md) - Cancellation and timeouts
2. **Test configuration:** [Configuration Management](../../references/configuration-management.md) - Multi-source config
3. **Test HTTP:** [HTTP/API Testing](../../references/http-api-patterns.md) - Client behavior

### For Performance Testing

1. **Benchmark:** [Performance Testing](../../references/performance-optimization.md) - Write benchmarks
2. **Profile:** Use pprof to identify bottlenecks
3. **Optimize:** Verify optimizations with benchmarks

---

## Complete Reference Collection

**[📚 Browse All References](../../references/README.md)** - Master index of all 12 implementation pattern references with 40+ real code examples.

---

## Additional Resources

- **[Best Practices](./best-practices.md)** - Tester role-specific guidelines and quality assurance principles
- **[Go Testing Documentation](https://pkg.go.dev/testing)** - Official testing package documentation
- **[Uber Go Style Guide](../../uber-go-style-guide.md)** - Industry-standard style guide with testing sections

---

**Last Updated:** 2025-11-14
**Role:** Tester
**Focus:** Comprehensive testing strategies, quality assurance, and testability patterns
