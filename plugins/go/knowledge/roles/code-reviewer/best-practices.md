# Go Code Reviewer Knowledge Base

**Role Focus:** Code review, quality assurance, catching bugs, enforcing standards

**Purpose:** Systematic checklist and patterns for reviewing Go code

---

## Code Review Philosophy

### Core Principles

1. **Catch bugs before production**
2. **Enforce consistent style**
3. **Share knowledge**
4. **Improve code quality**
5. **Be constructive, not critical**

### Review Priority

**P0 - Must Fix (Blockers):**
- Security vulnerabilities
- Data races
- Memory leaks
- Incorrect error handling
- Goroutine leaks

**P1 - Should Fix:**
- Performance issues
- Style violations
- Missing tests
- Poor naming

**P2 - Nice to Have:**
- Minor optimizations
- Documentation improvements
- Code organization

---

## Comprehensive Review Checklist

### 1. Error Handling

**❌ Common Mistakes:**

```go
// Not checking errors
json.NewDecoder(r.Body).Decode(&req)  // Error ignored!

// Logging and returning (handled twice)
if err != nil {
    log.Printf("Error: %v", err)
    return err
}

// Wrong error wrapping (%v instead of %w)
return fmt.Errorf("failed: %v", err)

// Not using errors.Is/errors.As
if err == sql.ErrNoRows {  // Won't work if wrapped
    // ...
}
```

**✅ What to Look For:**
- [ ] All errors checked
- [ ] Errors wrapped with context using `%w`
- [ ] Errors handled once (log OR return, not both)
- [ ] `errors.Is()` and `errors.As()` used for checking
- [ ] Defer errors handled (especially Close, Flush)
- [ ] No naked error returns (always add context)

**Example Comments:**

```
❌ Error not checked. Please handle the error from json.Decode()

❌ Error handled twice. Remove log.Printf() and let caller handle.

❌ Use %w instead of %v to preserve error chain.

❌ Use errors.Is(err, sql.ErrNoRows) instead of == for wrapped errors.
```

**Reference:** `../100-go-mistakes.md` § Error Management

---

### 2. Concurrency Issues

**❌ Common Mistakes:**

```go
// Data race
var counter int
go func() { counter++ }()
go func() { counter++ }()

// Loop variable in goroutine
for _, item := range items {
    go func() {
        process(item)  // Wrong item!
    }()
}

// No goroutine exit mechanism
go func() {
    for {
        doWork()  // When does this stop?
    }
}()

// Not waiting for goroutines
go doAsyncWork()
// Function returns immediately

// WaitGroup.Add after goroutine start
go func() {
    wg.Add(1)  // Race condition!
    defer wg.Done()
}()
```

**✅ What to Look For:**
- [ ] No data races (run with `-race` flag)
- [ ] Loop variables captured correctly
- [ ] All goroutines have clear exit conditions
- [ ] Code waits for goroutines to finish
- [ ] `WaitGroup.Add()` called before starting goroutine
- [ ] Context used for cancellation
- [ ] No goroutines in `init()`

**Example Comments:**

```
❌ Data race detected. Use sync.Mutex or atomic operations.

❌ Loop variable not captured. Add `item := item` before goroutine.

❌ Goroutine has no exit mechanism. Add context cancellation.

❌ Function returns before goroutine completes. Use WaitGroup to wait.

❌ Call wg.Add(1) before starting goroutine, not inside it.
```

**Reference:** `../100-go-mistakes.md` § Concurrency

---

### 3. Memory Leaks

**❌ Common Mistakes:**

```go
// Slice capacity leak
func getMessageType(msg []byte) []byte {
    return msg[:5]  // Keeps entire backing array
}

// Map never shrinks
m := make(map[int][128]byte, 1_000_000)
// After clearing most entries, map still uses 1M buckets

// Goroutine leak
go func() {
    for msg := range ch {  // Channel never closed
        process(msg)
    }
}()

// Time.After in loop
for {
    select {
    case <-time.After(1 * time.Second):  // New timer each iteration!
        // ...
    }
}

// Slice pointer leak
func keepFirstTwo(foos []Foo) []Foo {
    return foos[:2]  // Remaining elements not GC'd
}
```

**✅ What to Look For:**
- [ ] Slices copied when keeping small part of large slice
- [ ] Maps recreated if significant shrinking occurs
- [ ] Goroutines have clear lifecycle
- [ ] `time.NewTimer` used instead of `time.After` in loops
- [ ] Slice pointers set to nil when no longer needed

**Example Comments:**

```
❌ Slice capacity leak. Copy to avoid keeping entire backing array.

❌ Map memory leak. Recreate map periodically if size fluctuates.

❌ Goroutine leak. Ensure channel is closed or use context for cancellation.

❌ Timer leak. Use time.NewTimer() and reset it instead of time.After().

❌ Slice pointer leak. Set unused pointers to nil before slicing.
```

**Reference:** `../100-go-mistakes.md` § Data Types

---

### 4. Resource Management

**❌ Common Mistakes:**

```go
// Not closing resources
resp, _ := http.Get(url)
body, _ := io.ReadAll(resp.Body)
// resp.Body never closed!

// Not handling close errors
defer f.Close()  // Error ignored

// Defer in loop
for _, path := range paths {
    f, _ := os.Open(path)
    defer f.Close()  // Won't close until function returns!
}

// No timeouts on HTTP client
client := &http.Client{}
resp, _ := client.Get(url)  // No timeout!
```

**✅ What to Look For:**
- [ ] HTTP response bodies closed
- [ ] Files closed with defer
- [ ] SQL rows closed
- [ ] Close errors handled
- [ ] No defer in loops (extract to function)
- [ ] HTTP clients have timeouts configured

**Example Comments:**

```
❌ Response body not closed. Add `defer resp.Body.Close()`.

❌ Close error not handled. Check error in defer closure.

❌ Defer in loop. Extract to separate function.

❌ HTTP client has no timeout. Configure client with Timeout field.
```

**Reference:** `../100-go-mistakes.md` § Standard Library

---

### 5. Code Organization

**❌ Common Mistakes:**

```go
// Exported fields that should be private
type User struct {
    Password string  // Exposed in API!
}

// Interface on producer side
package store

type Storage interface {  // Should be on consumer side
    Get(id string) (*Item, error)
}

// Returning interface
func NewStore() Storage {  // Should return concrete type
    return &store{}
}

// init() with I/O
func init() {
    data, _ := os.ReadFile("config.yaml")  // Bad!
    // ...
}

// Mutable global
var cache = make(map[string]string)  // Not thread-safe
```

**✅ What to Look For:**
- [ ] Appropriate field visibility (unexported unless needed)
- [ ] Interfaces on consumer side, not producer
- [ ] Functions return concrete types, accept interfaces
- [ ] No I/O in `init()` functions
- [ ] No mutable global state
- [ ] Dependencies injected, not global

**Example Comments:**

```
❌ Password field exported. Make unexported (lowercase).

❌ Interface on producer side. Move to consumer package.

❌ Returning interface. Return concrete type *Store instead.

❌ I/O in init(). Move to explicit initialization function.

❌ Mutable global state. Use struct with mutex or dependency injection.
```

**Reference:** `../uber-go-style-guide.md` § Guidelines

---

### 6. Testing

**❌ Common Mistakes:**

```go
// No tests
// (code with 0% coverage)

// Not using table-driven tests
func TestAdd(t *testing.T) {
    if add(2, 3) != 5 { t.Error("failed") }
    if add(0, 0) != 0 { t.Error("failed") }
    // ... repetitive
}

// Not running tests with -race
// (missing data races)

// Using time.Sleep in tests
func TestAsync(t *testing.T) {
    go asyncWork()
    time.Sleep(100 * time.Millisecond)  // Flaky!
    // assert
}

// No integration tests
// (only unit tests, no database tests)
```

**✅ What to Look For:**
- [ ] Tests exist for new code
- [ ] Table-driven tests for multiple scenarios
- [ ] Tests run with `-race` flag
- [ ] No `time.Sleep` (use channels or polling)
- [ ] Integration tests for database/external services
- [ ] Tests are deterministic (no random failures)

**Example Comments:**

```
❌ No tests. Please add unit tests for this function.

❌ Repetitive tests. Use table-driven test pattern.

❌ Run tests with -race flag to check for data races.

❌ time.Sleep makes test flaky. Use channel synchronization.

❌ Missing integration test. Add test with real database.
```

**Reference:** `../modern-backend-development.md` § Testing

---

### 7. Performance

**❌ Common Mistakes:**

```go
// Not pre-allocating slices/maps
s := []int{}
for i := 0; i < 1000; i++ {
    s = append(s, i)  // Multiple allocations
}

// String concatenation in loop
var s string
for i := 0; i < 1000; i++ {
    s += "x"  // Creates 1000 strings
}

// Using fmt.Sprint instead of strconv
s := fmt.Sprint(42)

// Repeated string-to-byte conversions
for i := 0; i < n; i++ {
    w.Write([]byte("Hello"))
}
```

**✅ What to Look For:**
- [ ] Slices/maps pre-allocated when size known
- [ ] `strings.Builder` used for string concatenation
- [ ] `strconv` used instead of `fmt` for conversions
- [ ] String-to-byte conversion done once
- [ ] No unnecessary allocations in hot path

**Example Comments:**

```
❌ Pre-allocate slice capacity: make([]int, 0, 1000)

❌ Use strings.Builder instead of += for string concatenation.

❌ Use strconv.Itoa() instead of fmt.Sprint() for better performance.

❌ Convert string to []byte once outside loop.
```

**Reference:** `../uber-go-style-guide.md` § Performance

---

### 8. Security

**❌ Common Mistakes:**

```go
// SQL injection
query := fmt.Sprintf("SELECT * FROM users WHERE id = '%s'", userInput)

// Exposing sensitive data in logs
log.Printf("User: %+v", user)  // May contain password!

// No HTTP timeouts
client := &http.Client{}  // Vulnerable to slowloris

// Secrets in code
const apiKey = "sk_live_abc123"  // Should be in env vars

// No input validation
func process(input string) {
    // Direct use without validation
}
```

**✅ What to Look For:**
- [ ] Parameterized queries (no SQL injection)
- [ ] Sensitive data not logged (passwords, tokens)
- [ ] HTTP clients configured with timeouts
- [ ] No secrets in code (use environment variables)
- [ ] Input validation at boundaries
- [ ] Error messages don't expose internal details

**Example Comments:**

```
❌ SQL injection risk. Use parameterized query with $1, $2 placeholders.

❌ Potential password leak in logs. Use custom String() method.

❌ HTTP client has no timeout. Configure with Timeout field.

❌ API key in code. Move to environment variable.

❌ No input validation. Validate and sanitize user input.
```

**Reference:** `../modern-backend-development.md` § Security

---

### 9. Style and Consistency

**❌ Common Mistakes:**

```go
// No field names in struct literal
user := User{"John", "Doe", 30}

// Inconsistent naming (Get prefix)
func (c *Customer) GetBalance() float64 {  // Should be Balance()
    return c.balance
}

// Deep nesting
if cond1 {
    if cond2 {
        if cond3 {
            // ...
        }
    }
}

// No error context
return err

// Not using gofmt
// (inconsistent formatting)
```

**✅ What to Look For:**
- [ ] Field names used in struct initialization
- [ ] No `Get` prefix for getters
- [ ] Happy path aligned to left (max 3-4 nesting levels)
- [ ] Errors wrapped with context
- [ ] Code formatted with `gofmt`
- [ ] Imports organized (stdlib, then external)

**Example Comments:**

```
❌ Use field names in struct literal for clarity.

❌ Remove Get prefix. Use Balance() instead of GetBalance().

❌ Too much nesting. Return early for error cases.

❌ Add context to error: fmt.Errorf("operation failed: %w", err)

❌ Run gofmt on this file.
```

**Reference:** `../uber-go-style-guide.md` § Style

---

## Review Workflow

### Before You Start

```bash
# Pull latest
git pull origin main

# Checkout PR branch
git checkout feature-branch

# Run tests
go test ./...

# Run tests with race detector
go test -race ./...

# Run linter
golangci-lint run

# Check formatting
gofmt -l .
```

### During Review

**1. High-Level Review (5 minutes)**
- Does it solve the stated problem?
- Is the approach reasonable?
- Are there architectural concerns?
- Does it follow project patterns?

**2. Detailed Code Review (15-30 minutes)**
- Go through checklist systematically
- Check each file carefully
- Run code locally if needed
- Test edge cases

**3. Testing Review (10 minutes)**
- Tests exist and cover new code
- Tests are meaningful (not just for coverage)
- Tests run with `-race`
- Integration tests if applicable

### After Review

**Leave Constructive Feedback:**

✅ **Good:**
```
This looks good, but there's a potential race condition on line 42.
Consider using sync.Mutex to protect the shared state.

Example:
type Cache struct {
    mu    sync.RWMutex
    items map[string]string
}
```

❌ **Bad:**
```
Race condition. Fix it.
```

**Prioritize Issues:**
```
P0: [BLOCKER] Data race detected on line 42. Must fix before merge.

P1: [SHOULD FIX] Error not wrapped with context on line 67. Please add.

P2: [NIT] Consider using strconv.Itoa() instead of fmt.Sprint() for better performance.
```

---

## Common Review Scenarios

### Scenario 1: New Feature

**What to Check:**
1. Tests cover new functionality
2. Error handling complete
3. No breaking changes to API
4. Documentation updated (if public API)
5. Database migrations included (if needed)
6. No security vulnerabilities
7. Performance acceptable

### Scenario 2: Bug Fix

**What to Check:**
1. Root cause addressed (not symptom)
2. Test added to prevent regression
3. Fix doesn't introduce new bugs
4. Error handling correct
5. Changelog updated

### Scenario 3: Refactoring

**What to Check:**
1. Behavior unchanged (tests still pass)
2. Code is actually simpler
3. Performance not degraded
4. No breaking changes
5. Tests updated if needed

### Scenario 4: Performance Optimization

**What to Check:**
1. Benchmarks prove improvement
2. No correctness sacrificed for performance
3. Complexity worth the gain
4. Tested with `-race` flag
5. Profiling data provided

---

## Red Flags (Immediate Attention)

### 🚨 Critical Issues

```go
// Panic in production code
if err != nil {
    panic(err)  // 🚨 Will crash service
}

// Race condition
var counter int
for i := 0; i < 10; i++ {
    go func() { counter++ }()  // 🚨 Data race
}

// SQL injection
query := "SELECT * FROM users WHERE id = " + userInput  // 🚨 Security risk

// Goroutine leak
go func() {
    for {
        doWork()  // 🚨 No exit condition
    }
}()

// Secrets in code
const apiKey = "sk_live_..."  // 🚨 Exposed secret
```

**Action:** Request immediate fix before any other review.

---

## Review Comments Template

### Bug/Issue Found

```markdown
**Issue:** [Description of the problem]

**Why:** [Explanation of why it's a problem]

**Suggestion:**
```go
// Proposed fix
```

**Reference:** [Link to documentation or style guide]
```

### Example

```markdown
**Issue:** Error not checked on line 42

**Why:** If json.Decode fails, we'll use uninitialized data, causing
unexpected behavior or panics.

**Suggestion:**
```go
if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
    return fmt.Errorf("decoding request: %w", err)
}
```

**Reference:** ../100-go-mistakes.md § Error Management
```

---

## Approval Criteria

### Ready to Approve ✅

- [ ] No P0 (blocker) issues
- [ ] All P1 issues addressed or acknowledged
- [ ] Tests pass (including `-race`)
- [ ] Linter passes
- [ ] Code follows project conventions
- [ ] Documentation updated (if needed)
- [ ] Changes make sense and solve the problem

### Not Ready ❌

- [ ] P0 issues present
- [ ] Tests failing
- [ ] Linter errors
- [ ] Major architectural concerns
- [ ] Security vulnerabilities
- [ ] Unclear code purpose

---

## Learning from Reviews

### Track Common Issues

Keep a list of frequently caught issues:

```markdown
## Team Common Issues (Week of Nov 13)

1. Error wrapping (%v instead of %w) - 5 occurrences
2. Loop variable not captured - 3 occurrences
3. HTTP client no timeout - 2 occurrences

**Action:** Add linter rule for #1, team training for #2
```

### Share Knowledge

```markdown
## Review Highlight: Clever Error Handling

Great pattern found in PR #123 for handling multiple errors:

```go
var errs []error
for _, item := range items {
    if err := process(item); err != nil {
        errs = append(errs, fmt.Errorf("item %v: %w", item, err))
    }
}
if len(errs) > 0 {
    return fmt.Errorf("processing failed: %v", errs)
}
```

Consider using this pattern in similar scenarios!
```

---

## Tools for Reviewers

### Automated Checks

```yaml
# .golangci.yml
linters:
  enable:
    - errcheck      # Catches unchecked errors
    - gosec         # Security issues
    - govet         # Common mistakes
    - staticcheck   # Advanced analysis
    - ineffassign   # Ineffectual assignments
```

### Review Helpers

```bash
# Check for common issues
./scripts/review-checks.sh

# Run all tests with race detector
go test -race ./...

# Check test coverage
go test -cover ./...

# Find TODO/FIXME comments
grep -r "TODO\|FIXME" --include="*.go"
```

---

## Further Reading

**Core Knowledge Base:**
- `../100-go-mistakes.md` - Comprehensive mistake reference
- `../uber-go-style-guide.md` - Industry standard style
- `../go-proverbs.md` - Philosophy and principles
- `../modern-backend-development.md` - Best practices

**External Resources:**
- [Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments)
- [Effective Go](https://go.dev/doc/effective_go)

---

**Document Purpose:** Systematic code review for Go
**Target Audience:** Code Reviewers, Tech Leads, Senior Engineers
**Last Updated:** November 2025
