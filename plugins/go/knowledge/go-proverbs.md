# Go Proverbs

Based on Rob Pike's "Go Proverbs" talk

These proverbs capture the essence of Go's philosophy and provide guidance for writing idiomatic, maintainable Go code. Like proverbs in the game of Go, they are short, memorable, and carry deeper wisdom that reveals itself with experience.

---

## 1. Don't communicate by sharing memory; share memory by communicating

**What it means:** Instead of using shared memory protected by locks, pass data between goroutines using channels.

**Why it matters:**

* When you send data over a channel, the ownership transfers
* No simultaneous access means no race conditions
* Makes concurrent code safer and easier to reason about

**In practice:**

```go
// Less idiomatic: shared memory with mutex
var cache map[string]string
var mu sync.Mutex

func updateCache(key, value string) {
    mu.Lock()
    cache[key] = value
    mu.Unlock()
}

// More idiomatic: communicate via channels
type CacheUpdate struct {
    key   string
    value string
}

updates := make(chan CacheUpdate)
go func() {
    cache := make(map[string]string)
    for update := range updates {
        cache[update.key] = update.value
    }
}()
```

---

## 2. Concurrency is not parallelism

**What it means:** Concurrency is about structure; parallelism is about execution.

**The distinction:**

* **Concurrency:** A way of structuring your program to make it easier to understand and scalable
* **Parallelism:** The simultaneous execution of multiple goroutines

**Why it matters:**

* Concurrent programs can run on a single core
* Parallel execution requires multiple cores
* Good concurrent design enables parallelism but doesn't require it

**In practice:** Design your program with concurrent components (goroutines, channels) that coordinate independently. Whether they run in parallel is a runtime decision.

---

## 3. Channels orchestrate; mutexes serialize

**What it means:** Use channels for coordination and flow control; use mutexes for protecting state.

**When to use each:**

**Channels for orchestration:**

* Coordinating multiple goroutines
* Implementing pipelines
* Broadcasting signals
* Managing lifecycle

**Mutexes for serialization:**

* Protecting shared state
* Fine-grained locking
* Simple, quick operations
* Caching

**In practice:**

```go
// Mutex: protecting simple state
type Counter struct {
    mu sync.Mutex
    count int
}

func (c *Counter) Increment() {
    c.mu.Lock()
    c.count++
    c.mu.Unlock()
}

// Channel: orchestrating work
func worker(jobs <-chan Job, results chan<- Result) {
    for job := range jobs {
        results <- process(job)
    }
}
```

---

## 4. The bigger the interface, the weaker the abstraction

**What it means:** Small interfaces are more powerful and flexible than large ones.

**Why it matters:**

* Small interfaces are easier to implement
* More implementations means more reusability
* Forces you to think about the essential behavior

**The power of small interfaces:**

* `io.Reader` has one method - countless implementations
* `io.Writer` has one method - countless implementations
* Empty interface has zero methods - universally satisfied

**In practice:**

```go
// Weak abstraction: too many methods
type DataStore interface {
    Save(data Data) error
    Load(id string) (Data, error)
    Delete(id string) error
    List() ([]Data, error)
    Count() (int, error)
    Search(query string) ([]Data, error)
}

// Strong abstraction: focused interface
type Saver interface {
    Save(data Data) error
}

type Loader interface {
    Load(id string) (Data, error)
}

// Compose small interfaces as needed
type Repository interface {
    Saver
    Loader
}
```

---

## 5. Make the zero value useful

**What it means:** Design your types so their zero value is ready to use without initialization.

**Why it matters:**

* Reduces API surface (fewer constructors needed)
* Makes complex data structures easier to work with
* Enables composition without special initialization

**Examples from stdlib:**

* `sync.Mutex` - ready to use as declared
* `bytes.Buffer` - valid empty buffer
* Slices, maps (as zero values) - safe to read from

**In practice:**

```go
// Good: zero value is useful
type Logger struct {
    prefix string
    writer io.Writer // nil is ok, can be checked
}

func (l *Logger) Log(msg string) {
    if l.writer == nil {
        l.writer = os.Stderr
    }
    fmt.Fprintf(l.writer, "%s: %s\n", l.prefix, msg)
}

// Usage: no constructor needed for basic case
var log Logger
log.Log("hello") // works immediately
```

---

## 6. interface{} says nothing

**What it means:** The empty interface carries no information about what it contains.

**Why it matters:**

* No compile-time type safety
* Forces runtime type assertions
* Makes code harder to understand and maintain
* Similar to programming in dynamically typed languages

**Common misuse:**

```go
// Weak: loses all type information
func Process(data interface{}) error {
    // Now what? Type assertion required
    // No compile-time guarantees
}

// Better: use a small interface with actual requirements
type Processor interface {
    Process() error
}

func Process(p Processor) error {
    return p.Process()
}
```

**When it's appropriate:**

* Truly generic containers (rare)
* Reflection-based libraries (encoding/json, fmt)
* When you genuinely need to handle any type

---

## 7. Gofmt's style is no one's favorite, yet gofmt is everyone's favourite

**What it means:** Having a standard format matters more than personal preferences.

**Why it matters:**

* Eliminates bikeshedding and style debates
* Makes code reviews focus on logic, not formatting
* Enables team productivity
* Creates consistency across the entire ecosystem

**The principle:** Don't argue about formatting. Run gofmt and move on. Even if you don't love the style, you'll love not arguing about it.

**In practice:**

* Configure your editor to run gofmt on save
* Use `gofmt -w` to format files
* Better yet, use `goimports`, which also manages imports
* Add formatting checks to CI/CD

---

## 8. A little copying is better than a little dependency

**What it means:** Sometimes duplicating a small amount of code is better than adding a dependency.

**Why it matters:**

* Dependencies add complexity
* Larger dependency trees increase build times
* More dependencies mean more maintenance burden
* Copies can be customised for your specific needs

**Real example from stdlib:** The `strconv` package implements its own `isPrint` function instead of depending on the `unicode` package, saving ~150KB of data tables. A test ensures they stay in sync.

**Guidelines:**

* Small, self-contained functions are candidates for copying
* Avoid depending on large libraries for trivial functionality
* Document where copied code came from
* Consider the trade-off: maintenance vs. dependency weight

**In practice:**

```go
// Instead of importing a full library for one utility
// import "github.com/someone/utils" // 50+ functions, but you need 1

// Consider copying the small function you need
func contains(slice []string, item string) bool {
    for _, s := range slice {
        if s == item {
            return true
        }
    }
    return false
}
```

---

## 9. Syscall must always be guarded with build tags

**What it means:** System calls are platform-specific and must use build tags.

**Why it matters:**

* System calls are inherently non-portable
* Different OSes have different syscalls
* Attempting to compile for the wrong platform will fail
* Makes platform-specific code explicit

**In practice:**

```go
//go:build linux
// +build linux

package mypackage

import "syscall"

func platformSpecific() error {
    return syscall.Setuid(1000)
}
```

**The principle:** If you're importing the `syscall` package, you should have a build tag. If you think you're writing portable code with `syscall`, you're using the wrong package—use `os` or another portable abstraction instead.

---

## 10. Cgo must always be guarded with build tags

**What it means:** C interop is platform-specific and should use build tags.

**Why it matters:**

* C code behaviour varies by platform
* C libraries may not be available on all systems
* Build tags make requirements explicit
* Prevents mysterious build failures

**In practice:**

```go
//go:build cgo && linux
// +build cgo,linux

package mypackage

/*
#include <stdio.h>
*/
import "C"
```

---

## 11. Cgo is not Go

**What it means:** Using Cgo sacrifices many of Go's benefits.

**What you lose with Cgo:**

* Memory safety
* Easy deployment (now need C libraries)
* Fast compilation
* Simplicity
* Cross-compilation ease
* Debugging clarity

**Statistics:** Rob Pike notes that at Google, ~90% of "Go runtime is corrupted" bugs turn out to be Cgo or SWIG issues, not Go code.

**When to use Cgo:**

* Absolutely necessary to interface with existing C libraries
* Performance-critical code that must use C
* No pure Go alternative exists

**When to avoid Cgo:**

* For convenience
* Because you're more comfortable with C
* To use a C library when a Go alternative exists

**Remember:** "A program that uses Cgo is a C program."

---

## 12. With the unsafe package, there are no guarantees

**What it means:** Using `unsafe` bypasses Go's type safety and memory safety guarantees.

**Why it matters:**

* No guarantees about compatibility across Go versions
* Code may break on runtime updates
* Violates memory safety
* Makes code non-portable

**Common misuse:**

```go
// This might break in future Go versions
type StringHeader struct {
    Data uintptr
    Len  int
}

s := "hello"
header := (*StringHeader)(unsafe.Pointer(&s))
```

**When it's appropriate:**

* Very low-level system programming
* Performance-critical code after benchmarking proves the necessity
* Interfacing with C or system calls
* You understand you're on your own

**The contract:** If you use `unsafe`, don't complain when your code breaks in a new Go version. You opted out of stability guarantees.

---

## 13. Clear is better than clever

**What it means:** Optimise for readability and maintainability over cleverness.

**Why it matters:**

* Code is read far more than it is written
* Clever code is hard to debug
* Team members need to understand your code
* Future you will thank present you

**In practice:**

```go
// Clever but unclear
func f(x int) int { return x&1 == 0 && x > 0 || x < 0 && x&1 == 1 ? 1 : 0 }

// Clear and maintainable
func isOppositeSignAndParity(x int) bool {
    isEven := x%2 == 0
    isPositive := x > 0

    evenAndPositive := isEven && isPositive
    oddAndNegative := !isEven && !isPositive

    return evenAndPositive || oddAndNegative
}
```

**Guidelines:**

* Write for the reader, not the writer
* Use clear variable names
* Break complex expressions into named steps
* Comment the "why," not the "what"

---

## 14. Reflection is never clear

**What it means:** Code using the `reflect` package is inherently difficult to understand.

**Why it matters:**

* Only runtime checks (no compile-time safety)
* Code is hard to read and understand
* Easy to get wrong
* Performance overhead

**Who should use reflection:**

* Library authors (encoding/json, ORMs)
* Framework developers
* Probably not you (initially)

**When you think you need reflection:** Ask yourself:

1. Can I use an interface instead?
2. Can I use code generation?
3. Do I really need this flexibility?

**In practice:** Most beginners who reach for `reflect` are actually solving the wrong problem. They usually need better interface design or to accept some reasonable duplication.

---

## 15. Errors are values

**What it means:** Errors are just values you can program with, not control flow.

**Why it matters:**

* Enables creative error-handling strategies
* Errors can be wrapped, decorated, stored, or transformed
* Not limited to just "return up the stack"

**Common mistake:**

```go
// Just checking and returning
if err != nil {
    return err
}
if err != nil {
    return err
}
if err != nil {
    return err
}
```

**Better approaches:**

```go
// Example 1: Error accumulator
type ErrorWriter struct {
    w   io.Writer
    err error
}

func (ew *ErrorWriter) Write(buf []byte) {
    if ew.err != nil {
        return
    }
    _, ew.err = ew.w.Write(buf)
}

// Now multiple writes become clean
ew := &ErrorWriter{w: w}
ew.Write(p1)
ew.Write(p2)
ew.Write(p3)
if ew.err != nil {
    return ew.err
}

// Example 2: Error collector
var errs []error
for _, item := range items {
    if err := process(item); err != nil {
        errs = append(errs, fmt.Errorf("item %v: %w", item, err))
    }
}
if len(errs) > 0 {
    return fmt.Errorf("processing errors: %v", errs)
}
```

---

## 16. Don't just check errors, handle them gracefully

**What it means:** Think about what should happen when an error occurs, don't just return it.

**Why it matters:**

* Error handling is a critical part of your program's behaviour
* Users need meaningful error messages
* Errors should provide context about what went wrong

**Levels of error handling:**

**Level 1: Just return (least context)**

```go
if err != nil {
    return err
}
```

**Level 2: Add context**

```go
if err != nil {
    return fmt.Errorf("failed to open config file: %w", err)
}
```

**Level 3: Make decisions**

```go
if err != nil {
    if errors.Is(err, os.ErrNotExist) {
        // Use defaults
        config = defaultConfig()
    } else {
        return fmt.Errorf("failed to load config: %w", err)
    }
}
```

**Level 4: Comprehensive handling**

```go
if err != nil {
    log.Printf("Warning: failed to load user preferences: %v. Using defaults.", err)
    config = defaultConfig()
    metrics.IncrementConfigErrors()
}
```

**Guidelines:**

* Add context that helps with debugging
* Consider whether to retry, use defaults, or abort
* Log when appropriate
* Think about what the caller needs to know

---

## 17. Design the architecture, name the components, and document the details

**What it means:** Good design flows through architecture → naming → documentation.

**The process:**

**1. Design the architecture**

* Think about the big picture
* Identify major components
* Consider how pieces interact
* Plan for concurrency and scaling

**2. Name the components**

* Names carry the design
* Good names make code self-documenting
* Names should reflect purpose, not implementation
* Names are the primary way users understand your code

**3. Document the details**

* Explain what the docs can't convey
* Clarify non-obvious behaviour
* Provide usage examples
* Explain the "why" when needed

**In practice:**

```go
// Architecture: request pipeline with rate limiting
// Components: RateLimiter, RequestQueue, WorkerPool
// Names carry the design

type RateLimiter struct {
    // Limits requests per second across all workers
    // Uses token bucket algorithm
}

type RequestQueue struct {
    // Thread-safe queue with priority support
    // Blocks when full to apply backpressure
}

type WorkerPool struct {
    // Manages fixed number of concurrent workers
    // Auto-scales based on queue depth
}
```

---

## 18. Documentation is for users

**What it means:** Write documentation from the user's perspective, not the implementer's.

**Why it matters:**

* Users don't care how it works; they care how to use it
* Godoc is what users see first
* Good docs reduce support burden
* Makes your package accessible

**Common mistakes:**

```go
// Bad: describes implementation
// ProcessData takes a Data struct and calls internal methods
// to validate and transform it using a series of pipes
func ProcessData(d Data) error

// Good: describes purpose and usage
// ProcessData validates and normalizes the data for storage.
// It returns an error if validation fails.
// Example:
//   if err := ProcessData(data); err != nil {
//       log.Fatal(err)
//   }
func ProcessData(d Data) error
```

**Guidelines:**

* Start with what it does, not how
* Include examples in doc comments
* Explain parameters and return values
* Mention important edge cases
* Think like someone who's never seen your code

---

## 19. Don't panic

**What it means:** Panics should be rare and reserved for truly exceptional situations.

**Why it matters:**

* Panics are hard to recover from properly
* They bypass normal error handling
* They can crash entire programs
* They make code harder to test

**When to panic:**

* Programmer errors (impossible conditions in correct code)
* Initialisation failures that make the program unusable
* Violating invariants that should never happen

**When NOT to panic:**

* Expected errors (file not found, network timeout)
* User input validation
* Anything that might happen during normal operation
* Library code (almost never)

**In practice:**

```go
// Bad: panics on expected errors
func LoadConfig(path string) Config {
    data, err := os.ReadFile(path)
    if err != nil {
        panic(err) // File might not exist!
    }
    // ...
}

// Good: returns errors
func LoadConfig(path string) (Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return Config{}, fmt.Errorf("reading config: %w", err)
    }
    // ...
}

// Acceptable panic: programmer error
func process(index int, items []Item) {
    if index < 0 || index >= len(items) {
        panic("index out of bounds: should never happen")
    }
    // ...
}
```

---

## Conclusion

These proverbs capture the spirit of idiomatic Go programming. They're guidelines, not rigid rules—sometimes context dictates breaking them. But understanding these principles will help you write Go code that is:

* **Clear** - Easy to read and understand
* **Safe** - Concurrent without race conditions
* **Maintainable** - Designed for long-term evolution
* **Idiomatic** - Fits naturally in the Go ecosystem

As Rob Pike notes, these proverbs are meant to be short, memorable, and somewhat poetic—capturing big ideas in small phrases. They're tools for teaching, for code reviews, and for thinking about what makes Go code feel "Go-like."

**Remember:** these ideas take time to internalise. Don't worry if they don't all make sense immediately. As you write more Go, you'll find yourself naturally gravitating toward these patterns.

---

*"The name for the language is obviously the same as the game, and that's not entirely a coincidence."* - Rob Pike

## Further Reading

* [Effective Go](https://go.dev/doc/effective_go)
* [Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments)
* [Rob Pike's Go Proverbs Talk](https://www.youtube.com/watch?v=PAAkCSZUG1c)
