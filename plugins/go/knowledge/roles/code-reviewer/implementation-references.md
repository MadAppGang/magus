# Implementation Reference Index - Code Reviewer Role

Production-quality Go patterns and anti-patterns from industry-leading projects, curated for effective code review.

## About These References

All examples are extracted from real, production codebases:
- **Go Standard Library** (database/sql, context, testing)
- **Docker/Moby** (containerization platform)
- **Hugo** (static site generator)
- **CockroachDB** (distributed SQL database)
- **Terraform** (infrastructure as code)

Use these references as benchmarks when reviewing code for quality, correctness, and adherence to Go idioms.

---

## Code Review Focus Areas

### 1. Interface Design Review
**[📖 View Complete Reference](../../references/interface-design.md)**

Verify interfaces are small, focused, and follow Go conventions.

**Review checklist:**
- ✅ Interfaces are small (1-5 methods preferred)
- ✅ Interfaces defined where used, not where implemented
- ✅ Names are clear and follow Go conventions (Reader, Writer, etc.)
- ✅ Methods have clear, single responsibilities
- ✅ Optional capabilities use separate interfaces (not one large interface)

**Red flags:**
- ❌ Large interfaces (>7 methods) - consider splitting
- ❌ Interfaces with "I" prefix (IService) - not idiomatic
- ❌ Interfaces defined in implementation package
- ❌ Mixed concerns (read + write + config in one interface)

**Production examples to reference:**
- database/sql/driver - Perfect interface segregation
- Terraform providers - Request-response clarity
- Context interface - Minimal, essential methods

---

### 2. Constructor Pattern Review
**[📖 View Complete Reference](../../references/constructor-patterns.md)**

Ensure initialization is correct, safe, and idiomatic.

**Review checklist:**
- ✅ Constructors named `NewX()` or `NewXWithY()`
- ✅ Functional options for extensibility (if needed)
- ✅ Errors returned for initialization failures
- ✅ Background goroutines tracked for cleanup
- ✅ Resources have clear ownership and lifecycle

**Red flags:**
- ❌ `init()` functions with side effects
- ❌ Global mutable state
- ❌ Constructors that never fail (no error return when they should)
- ❌ Goroutines launched without shutdown mechanism
- ❌ Config structs when functional options would be better

**Questions to ask:**
- Are default values sensible?
- Can this be initialized with just `&Type{}`?
- Are background resources cleaned up?
- Is the initialization backward-compatible?

**Production examples to reference:**
- Docker client - Functional options pattern
- database/sql OpenDB - Resource lifecycle management
- Hugo site initialization - Multi-stage initialization

---

### 3. Error Handling Review
**[📖 View Complete Reference](../../references/error-handling.md)**

Verify robust error handling and proper error propagation.

**Review checklist:**
- ✅ Errors wrapped with context: `fmt.Errorf("context: %w", err)`
- ✅ Sentinel errors are package-level vars
- ✅ Errors checked, not ignored
- ✅ Retry logic uses error classification
- ✅ Error messages are actionable and lowercase

**Red flags:**
- ❌ Ignored errors: `_ = functionThatReturnsError()`
- ❌ Panic in library code (reserve for programmer errors only)
- ❌ String comparison of errors
- ❌ Generic error messages ("error occurred")
- ❌ Errors swallowed without logging

**Best practices:**
- Use `errors.Is()` for sentinel error checking
- Use `errors.As()` for type assertion
- Only retry on transient errors
- Preserve stack traces with wrapping

**Production examples to reference:**
- database/sql - Sentinel errors and retry logic
- Go standard library - Error wrapping patterns

---

### 4. Context Usage Review
**[📖 View Complete Reference](../../references/context-usage.md)**

Ensure proper context usage for cancellation and timeouts.

**Review checklist:**
- ✅ Context is first parameter, named `ctx`
- ✅ Context passed to downstream calls
- ✅ `cancel()` functions are deferred
- ✅ Context used for cancellation, not state storage
- ✅ Operations respect context cancellation

**Red flags:**
- ❌ Context stored in structs
- ❌ `nil` context passed (use `context.TODO()` instead)
- ❌ Context.Value() used for non-request-scoped data
- ❌ Cancel functions not called (resource leak)
- ❌ Ignoring context cancellation in loops

**Critical checks:**
```go
// ✅ GOOD
func (s *Service) Process(ctx context.Context, data Data) error {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()

    select {
    case <-ctx.Done():
        return ctx.Err()
    case result := <-s.processChan:
        return s.handle(ctx, result)
    }
}

// ❌ BAD - context not checked
func (s *Service) Process(ctx context.Context, data Data) error {
    for range 1000000 {
        // Long loop ignoring ctx.Done()
    }
}
```

**Production examples to reference:**
- database/sql - Context-aware operations
- CockroachDB Stopper - Lifecycle-tied contexts
- Terraform - Signal-to-context bridges

---

### 5. Concurrency Review
**[📖 View Complete Reference](../../references/concurrency-patterns.md)**

Verify concurrent code is safe, correct, and leak-free.

**Review checklist:**
- ✅ All goroutines have shutdown mechanism
- ✅ Shared state protected by mutexes or channels
- ✅ WaitGroups used correctly
- ✅ No goroutine leaks (verify with `-race` flag)
- ✅ Channels closed by sender, not receiver
- ✅ Select statements handle all cases

**Red flags:**
- ❌ Goroutines without shutdown (leak risk)
- ❌ Shared state without synchronization (race condition)
- ❌ Deferred mutex unlocks in loops
- ❌ Closing channels in multiple places
- ❌ Select without default when non-blocking needed

**Critical race conditions:**
```go
// ❌ BAD - race condition
type Counter struct {
    count int
}
func (c *Counter) Increment() {
    c.count++ // RACE!
}

// ✅ GOOD - protected with mutex
type Counter struct {
    mu    sync.Mutex
    count int
}
func (c *Counter) Increment() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.count++
}

// ✅ BETTER - use atomic
type Counter struct {
    count atomic.Int64
}
func (c *Counter) Increment() {
    c.count.Add(1)
}
```

**Production examples to reference:**
- CockroachDB Stopper - Goroutine lifecycle management
- database/sql - Connection pool coordination
- CockroachDB retry - Exponential backoff

---

### 6. Testing Review
**[📖 View Complete Reference](../../references/testing-patterns.md)**

Ensure comprehensive test coverage and quality.

**Review checklist:**
- ✅ Table-driven tests for multiple scenarios
- ✅ Test helpers marked with `t.Helper()`
- ✅ Subtests used with `t.Run()`
- ✅ Error cases tested
- ✅ Tests can run in parallel (`t.Parallel()`)
- ✅ Tests are deterministic (no flaky tests)

**Red flags:**
- ❌ Tests depend on execution order
- ❌ Tests use real time (use time mocking)
- ❌ Tests have hardcoded sleeps
- ❌ Tests share global state
- ❌ No negative test cases

**Test quality indicators:**
```go
// ✅ GOOD - table-driven with subtests
func TestParse(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    Result
        wantErr bool
    }{
        {"valid", "input", expectedResult, false},
        {"invalid", "bad", Result{}, true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()
            got, err := Parse(tt.input)
            if (err != nil) != tt.wantErr {
                t.Errorf("Parse() error = %v, wantErr %v", err, tt.wantErr)
            }
            if !reflect.DeepEqual(got, tt.want) {
                t.Errorf("Parse() = %v, want %v", got, tt.want)
            }
        })
    }
}
```

**Production examples to reference:**
- Go standard library - Table-driven test patterns
- Go testing package - Test helpers
- CockroachDB - Time mocking patterns

---

### 7. Package Organization Review
**[📖 View Complete Reference](../../references/package-organization.md)**

Verify package structure is logical and maintainable.

**Review checklist:**
- ✅ Package names are lowercase, single word
- ✅ Package has clear, single responsibility
- ✅ `internal/` used for private code
- ✅ Cyclic dependencies avoided
- ✅ Package documentation (package comment)

**Red flags:**
- ❌ "util" or "common" packages (too broad)
- ❌ Circular package dependencies
- ❌ Packages named after implementation (e.g., "mysql", "postgres" - use abstraction)
- ❌ Large packages (>1000 lines) without clear organization

**Package naming:**
```go
// ✅ GOOD
package http      // Clear, single word
package user      // Domain-based
package retry     // Describes functionality

// ❌ BAD
package HttpUtils       // PascalCase, unclear
package user_service    // Snake case
package myPackage       // Unclear, generic
```

**Production examples to reference:**
- Hugo - Domain-driven organization
- Docker/Moby - Layered architecture
- CockroachDB - Focused utility packages

---

### 8. Performance Considerations
**[📖 View Complete Reference](../../references/performance-optimization.md)**

Identify performance issues and optimization opportunities.

**Review checklist:**
- ✅ Object pooling for hot paths (if profiled)
- ✅ Efficient string building (`strings.Builder`)
- ✅ Preallocated slices when size known
- ✅ Avoid unnecessary allocations
- ✅ Benchmark tests for critical paths

**Red flags:**
- ❌ String concatenation in loops (`s += x`)
- ❌ Growing slices without initial capacity
- ❌ Premature optimization without profiling
- ❌ Excessive allocations in hot paths

**Optimization patterns:**
```go
// ❌ BAD - inefficient string building
func BuildString(items []string) string {
    s := ""
    for _, item := range items {
        s += item + ","  // Allocates on every iteration!
    }
    return s
}

// ✅ GOOD - efficient string building
func BuildString(items []string) string {
    var sb strings.Builder
    sb.Grow(len(items) * 10) // Preallocate
    for i, item := range items {
        if i > 0 {
            sb.WriteByte(',')
        }
        sb.WriteString(item)
    }
    return sb.String()
}
```

**Production examples to reference:**
- Docker/Moby - Object pooling with `sync.Pool`
- CockroachDB - UTC time optimization

---

### 9. Configuration Management Review
**[📖 View Complete Reference](../../references/configuration-management.md)**

Verify configuration is robust and maintainable.

**Review checklist:**
- ✅ Clear configuration precedence
- ✅ Environment variable support
- ✅ Validation with clear error messages
- ✅ Sensible defaults
- ✅ Configuration immutable after initialization

**Red flags:**
- ❌ Mutable global configuration
- ❌ No validation
- ❌ Unclear precedence (env vs file vs flags)
- ❌ Secrets in configuration files

---

### 10. HTTP/API Review
**[📖 View Complete Reference](../../references/http-api-patterns.md)**

Ensure HTTP clients are robust and well-configured.

**Review checklist:**
- ✅ Timeouts configured
- ✅ Context passed for cancellation
- ✅ Retry logic (if appropriate)
- ✅ Connection pooling configured
- ✅ Error handling

**Red flags:**
- ❌ No timeout (default is infinite!)
- ❌ Ignoring response.Body.Close()
- ❌ Creating new HTTP client per request

---

## Review Workflow

### Quick Review Checklist

1. **Interfaces:** Small, focused, properly located? → [Interface Design](../../references/interface-design.md)
2. **Constructors:** Idiomatic, safe, backward-compatible? → [Constructor Patterns](../../references/constructor-patterns.md)
3. **Errors:** Wrapped, checked, actionable? → [Error Handling](../../references/error-handling.md)
4. **Context:** Proper usage, cancellation respected? → [Context Usage](../../references/context-usage.md)
5. **Concurrency:** Safe, leak-free, race-free? → [Concurrency Patterns](../../references/concurrency-patterns.md)
6. **Tests:** Comprehensive, deterministic, maintainable? → [Testing Patterns](../../references/testing-patterns.md)
7. **Packages:** Logical structure, no cycles? → [Package Organization](../../references/package-organization.md)
8. **Performance:** Profiled, optimized appropriately? → [Performance Optimization](../../references/performance-optimization.md)

### Deep Review Areas

- **Plugin Systems:** [Plugin Systems Reference](../../references/plugin-systems.md)
- **CLI Tools:** [CLI Architecture Reference](../../references/cli-architecture.md)
- **Configuration:** [Configuration Management Reference](../../references/configuration-management.md)

---

## Common Anti-Patterns to Catch

### 1. Goroutine Leaks
```go
// ❌ BAD
go func() {
    for {
        // No way to stop this!
    }
}()

// ✅ GOOD
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

go func() {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            // Work
        }
    }
}()
```

### 2. Ignoring Errors
```go
// ❌ BAD
_ = doSomething()

// ✅ GOOD
if err := doSomething(); err != nil {
    return fmt.Errorf("failed to do something: %w", err)
}
```

### 3. Storing Context in Struct
```go
// ❌ BAD
type Service struct {
    ctx context.Context
}

// ✅ GOOD
type Service struct {
    // No context!
}

func (s *Service) Process(ctx context.Context) error {
    // Pass context as parameter
}
```

---

## Complete Reference Collection

**[📚 Browse All References](../../references/README.md)** - Master index of all 12 implementation pattern references with 40+ real code examples.

---

## Additional Resources

- **[Best Practices](./best-practices.md)** - Code reviewer role-specific guidelines
- **[Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments)** - Official Go review checklist
- **[Uber Go Style Guide](../../uber-go-style-guide.md)** - Industry-standard style guide
- **[100 Go Mistakes](../../100-go-mistakes.md)** - Common mistakes to watch for

---

**Last Updated:** 2025-11-14
**Role:** Code Reviewer
**Focus:** Code quality, correctness, idioms, and maintainability
