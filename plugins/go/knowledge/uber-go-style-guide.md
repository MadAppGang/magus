# Uber Go Style Guide (Updated for 2024-2025)

**Based on:** [uber-go/guide](https://github.com/uber-go/guide)
**Last Reviewed:** November 2025
**Go Versions:** Covers Go 1.21+ features and best practices

---

## Table of Contents

- [Introduction](#introduction)
- [Guidelines](#guidelines)
  - [Pointers to Interfaces](#pointers-to-interfaces)
  - [Verify Interface Compliance](#verify-interface-compliance)
  - [Receivers and Interfaces](#receivers-and-interfaces)
  - [Zero-value Mutexes are Valid](#zero-value-mutexes-are-valid)
  - [Copy Slices and Maps at Boundaries](#copy-slices-and-maps-at-boundaries)
  - [Defer to Clean Up](#defer-to-clean-up)
  - [Channel Size is One or None](#channel-size-is-one-or-none)
  - [Start Enums at One](#start-enums-at-one)
  - [Use "time" to handle time](#use-time-to-handle-time)
  - [Errors](#errors)
  - [Handle Type Assertion Failures](#handle-type-assertion-failures)
  - [Don't Panic](#dont-panic)
  - [Use Atomic Operations](#use-atomic-operations)
  - [Avoid Mutable Globals](#avoid-mutable-globals)
  - [Avoid Embedding Types in Public Structs](#avoid-embedding-types-in-public-structs)
  - [Avoid Using Built-In Names](#avoid-using-built-in-names)
  - [Avoid init()](#avoid-init)
  - [Exit in Main](#exit-in-main)
  - [Use field tags in marshaled structs](#use-field-tags-in-marshaled-structs)
  - [Don't fire-and-forget goroutines](#dont-fire-and-forget-goroutines)
- [Performance](#performance)
- [Style](#style)
- [Patterns](#patterns)
- [Linting](#linting)

---

## Introduction

**Purpose:** This guide manages complexity in Go codebases by providing detailed conventions for writing maintainable, idiomatic Go code.

**Origins:** Created by Prashant Varanasi and Simon Newton at Uber, amended over years based on community feedback.

**Foundation:** Builds upon:
1. [Effective Go](https://go.dev/doc/effective_go)
2. [Go Common Mistakes](https://github.com/golang/go/wiki/CommonMistakes)
3. [Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments)

**Target:** Code samples accurate for **Go 1.21+** (includes structured logging with `slog`, improved error handling, and generics support from Go 1.18+).

**Editor Setup:**
- Run `goimports` on save
- Run `golint` and `go vet` for error checking
- See [IDE support](https://go.dev/wiki/IDEsAndTextEditorPlugins)

---

## Guidelines

### Pointers to Interfaces

**Rule:** You almost never need a pointer to an interface.

**Why:** An interface is already two fields:
1. A pointer to type information
2. A pointer to the data (or the value itself if small)

**Implementation:**

```go
// ❌ BAD: Pointer to interface
func process(r *io.Reader) {
    // ...
}

// ✅ GOOD: Interface by value
func process(r io.Reader) {
    // ...
}
```

**Exception:** If you need interface methods to modify the underlying data, the underlying type must use a pointer receiver.

---

### Verify Interface Compliance

**Rule:** Verify interface compliance at compile time where appropriate.

**When to use:**
- Exported types required to implement specific interfaces (API contract)
- Types part of a collection implementing the same interface
- Cases where violating an interface breaks users

```go
// ❌ BAD: No compile-time verification
type Handler struct {
    // ...
}

func (h *Handler) ServeHTTP(
    w http.ResponseWriter,
    r *http.Request,
) {
    // ...
}

// ✅ GOOD: Compile-time verification
type Handler struct {
    // ...
}

var _ http.Handler = (*Handler)(nil)

func (h *Handler) ServeHTTP(
    w http.ResponseWriter,
    r *http.Request,
) {
    // ...
}
```

**Right-hand side values:**
- `nil` for pointer types (like `*Handler`)
- `nil` for slices and maps
- Empty struct for struct types

```go
type LogHandler struct {
    h   http.Handler
    log *zap.Logger
}

var _ http.Handler = LogHandler{}

func (h LogHandler) ServeHTTP(
    w http.ResponseWriter,
    r *http.Request,
) {
    // ...
}
```

---

### Receivers and Interfaces

**Key concepts:**

**Value receivers:**
- Can be called on pointers AND values
- Method does not modify receiver

**Pointer receivers:**
- Can only be called on pointers or addressable values
- Method modifies receiver

```go
type S struct {
    data string
}

func (s S) Read() string {
    return s.data
}

func (s *S) Write(str string) {
    s.data = str
}

// Usage with maps:
sVals := map[int]S{1: {"A"}}

// ✅ Can call Read (value receiver)
sVals[1].Read()

// ❌ Cannot call Write (pointer receiver, map values not addressable)
// sVals[1].Write("test")  // Compilation error

// ✅ With pointer map:
sPtrs := map[int]*S{1: {"A"}}
sPtrs[1].Read()   // Works
sPtrs[1].Write("test")  // Works
```

**Interface satisfaction:**

```go
type F interface {
    f()
}

type S1 struct{}
func (s S1) f() {}

type S2 struct{}
func (s *S2) f() {}

s1Val := S1{}
s1Ptr := &S1{}
s2Val := S2{}
s2Ptr := &S2{}

var i F
i = s1Val  // ✅ Works
i = s1Ptr  // ✅ Works
i = s2Ptr  // ✅ Works
// i = s2Val  // ❌ Doesn't compile (no value receiver for f)
```

**Reference:** [Effective Go: Pointers vs. Values](https://go.dev/doc/effective_go#pointers_vs_values)

---

### Zero-value Mutexes are Valid

**Rule:** The zero-value of `sync.Mutex` and `sync.RWMutex` is valid. You almost never need a pointer to a mutex.

```go
// ❌ BAD: Unnecessary pointer
mu := new(sync.Mutex)
mu.Lock()

// ✅ GOOD: Use zero value
var mu sync.Mutex
mu.Lock()
```

**In structs (pointer receiver):**

```go
// ❌ BAD: Embedded mutex exposes Lock/Unlock
type SMap struct {
    sync.Mutex  // Now part of public API!

    data map[string]string
}

func NewSMap() *SMap {
    return &SMap{
        data: make(map[string]string),
    }
}

func (m *SMap) Get(k string) string {
    m.Lock()
    defer m.Unlock()
    return m.data[k]
}

// ✅ GOOD: Unexported field
type SMap struct {
    mu sync.Mutex  // Implementation detail

    data map[string]string
}

func NewSMap() *SMap {
    return &SMap{
        data: make(map[string]string),
    }
}

func (m *SMap) Get(k string) string {
    m.mu.Lock()
    defer m.mu.Unlock()
    return m.data[k]
}
```

**Why:** The `Mutex` field and its methods become unintentionally part of the exported API when embedded.

---

### Copy Slices and Maps at Boundaries

**Rule:** Slices and maps contain pointers to underlying data. Be careful when copying them.

#### Receiving Slices and Maps

```go
// ❌ BAD: Stores reference, allows external modification
func (d *Driver) SetTrips(trips []Trip) {
    d.trips = trips
}

trips := ...
d1.SetTrips(trips)
trips[0] = ...  // Modifies d1.trips!

// ✅ GOOD: Defensive copy
func (d *Driver) SetTrips(trips []Trip) {
    d.trips = make([]Trip, len(trips))
    copy(d.trips, trips)
}

trips := ...
d1.SetTrips(trips)
trips[0] = ...  // d1.trips unaffected
```

#### Returning Slices and Maps

```go
// ❌ BAD: Exposes internal state
type Stats struct {
    mu       sync.Mutex
    counters map[string]int
}

func (s *Stats) Snapshot() map[string]int {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.counters  // No longer protected by mutex!
}

snapshot := stats.Snapshot()
// Data race on access to snapshot

// ✅ GOOD: Return copy
type Stats struct {
    mu       sync.Mutex
    counters map[string]int
}

func (s *Stats) Snapshot() map[string]int {
    s.mu.Lock()
    defer s.mu.Unlock()

    result := make(map[string]int, len(s.counters))
    for k, v := range s.counters {
        result[k] = v
    }
    return result
}

snapshot := stats.Snapshot()  // Safe copy
```

---

### Defer to Clean Up

**Rule:** Use `defer` to clean up resources (files, locks, connections).

```go
// ❌ BAD: Easy to miss unlocks with multiple returns
p.Lock()
if p.count < 10 {
    p.Unlock()
    return p.count
}
p.count++
newCount := p.count
p.Unlock()
return newCount

// ✅ GOOD: Defer ensures cleanup
p.Lock()
defer p.Unlock()

if p.count < 10 {
    return p.count
}
p.count++
return p.count
```

**Performance:** Defer has extremely small overhead. The readability win is worth the miniscule cost, especially for larger methods.

**When to avoid:** Only if you can prove function execution time is in the order of nanoseconds.

---

### Channel Size is One or None

**Rule:** Channels should usually be unbuffered (size 0) or have a size of one.

**Default:** Unbuffered channels

```go
// ❌ BAD: Arbitrary buffer size
c := make(chan int, 64)  // Why 64?

// ✅ GOOD: Unbuffered (default)
c := make(chan int)

// ✅ GOOD: Size of one (specific synchronization need)
c := make(chan int, 1)
```

**Other sizes:** Must be subject to high-level scrutiny. Consider:
- How is the size determined?
- What prevents the channel from filling under load?
- What happens when writers are blocked?

---

### Start Enums at One

**Rule:** Start enumerations at a non-zero value (usually 1).

**Why:** Variables have a 0 default value. Starting at 1 avoids confusion with uninitialized values.

```go
// ❌ BAD: Zero value is "Add"
type Operation int

const (
    Add Operation = iota
    Subtract
    Multiply
)
// Add=0, Subtract=1, Multiply=2

// ✅ GOOD: Start at 1
type Operation int

const (
    Add Operation = iota + 1
    Subtract
    Multiply
)
// Add=1, Subtract=2, Multiply=3
```

**Exception:** When zero value is the desirable default behavior:

```go
type LogOutput int

const (
    LogToStdout LogOutput = iota  // 0 is default
    LogToFile
    LogToRemote
)
// LogToStdout=0, LogToFile=1, LogToRemote=2
```

---

### Use "time" to handle time

**Rule:** Always use the `"time"` package. Time is complex, and incorrect assumptions include:
1. A day has 24 hours
2. An hour has 60 minutes
3. A week has 7 days
4. A year has 365 days

#### Use `time.Time` for instants of time

```go
// ❌ BAD: Using int for time
func isActive(now, start, stop int) bool {
    return start <= now && now < stop
}

// ✅ GOOD: Use time.Time
func isActive(now, start, stop time.Time) bool {
    return (start.Before(now) || start.Equal(now)) && now.Before(stop)
}
```

#### Use `time.Duration` for periods of time

```go
// ❌ BAD: Ambiguous units
func poll(delay int) {
    for {
        // ...
        time.Sleep(time.Duration(delay) * time.Millisecond)
    }
}
poll(10)  // Was it seconds or milliseconds?

// ✅ GOOD: Explicit duration
func poll(delay time.Duration) {
    for {
        // ...
        time.Sleep(delay)
    }
}
poll(10*time.Second)  // Clear units
```

#### Adding time: Use `Time.AddDate` vs `Time.Add`

```go
// Same time of day, next calendar day
newDay := t.AddDate(0 /* years */, 0 /* months */, 1 /* days */)

// Exactly 24 hours later (may be different time of day due to DST)
maybeNewDay := t.Add(24 * time.Hour)
```

#### Use `time.Time` and `time.Duration` with external systems

**JSON:**
```go
// ❌ BAD: No unit in field name
type Config struct {
    Interval int `json:"interval"`
}
// {"interval": 2}

// ✅ GOOD: Unit in field name
type Config struct {
    IntervalMillis int `json:"intervalMillis"`
}
// {"intervalMillis": 2000}
```

**Note:** `encoding/json` supports `time.Time` as RFC 3339 string via `UnmarshalJSON`.

**Command-line flags:** `flag` supports `time.Duration` via `time.ParseDuration`

**YAML:** `gopkg.in/yaml.v2` supports `time.Time` as RFC 3339 string and `time.Duration` via `time.ParseDuration`

**Timestamp format:** Use RFC 3339 (`time.RFC3339`) when `time.Time` isn't possible.

**Limitations:** The `time` package does not support:
- Parsing timestamps with leap seconds ([#8728](https://github.com/golang/go/issues/8728))
- Accounting for leap seconds in calculations ([#15190](https://github.com/golang/go/issues/15190))

---

### Errors

#### Error Types

**Decision tree for error declarations:**

| Error matching needed? | Error Message | Guidance |
|------------------------|---------------|----------|
| No | static | `errors.New` |
| No | dynamic | `fmt.Errorf` |
| Yes | static | top-level `var` with `errors.New` |
| Yes | dynamic | custom error type |

**Static error, no matching:**

```go
// package foo
func Open() error {
    return errors.New("could not open")
}

// package bar
if err := foo.Open(); err != nil {
    panic("unknown error")  // Can't handle specifically
}
```

**Static error, with matching:**

```go
// package foo
var ErrCouldNotOpen = errors.New("could not open")

func Open() error {
    return ErrCouldNotOpen
}

// package bar
if err := foo.Open(); err != nil {
    if errors.Is(err, foo.ErrCouldNotOpen) {
        // Handle specifically
    } else {
        panic("unknown error")
    }
}
```

**Dynamic error, no matching:**

```go
// package foo
func Open(file string) error {
    return fmt.Errorf("file %q not found", file)
}

// package bar
if err := foo.Open("testfile.txt"); err != nil {
    panic("unknown error")  // Can't handle specifically
}
```

**Dynamic error, with matching:**

```go
// package foo
type NotFoundError struct {
    File string
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("file %q not found", e.File)
}

func Open(file string) error {
    return &NotFoundError{File: file}
}

// package bar
if err := foo.Open("testfile.txt"); err != nil {
    var notFound *NotFoundError
    if errors.As(err, &notFound) {
        // Handle specifically
    } else {
        panic("unknown error")
    }
}
```

**Note:** Exported error variables/types become part of the public API.

#### Error Wrapping

**Three options for propagating errors:**

1. Return original error as-is (no additional context needed)
2. Add context with `fmt.Errorf` and `%w` verb (caller should access underlying error)
3. Add context with `fmt.Errorf` and `%v` verb (obfuscate underlying error)

**Use `%w` for wrapping (default):**

```go
s, err := store.New()
if err != nil {
    return fmt.Errorf("new store: %w", err)
}
```

**Use `%v` to obfuscate:**

```go
s, err := store.New()
if err != nil {
    return fmt.Errorf("new store: %v", err)  // Caller can't match underlying error
}
```

**Keep context succinct:**

```go
// ❌ BAD: States the obvious, piles up
s, err := store.New()
if err != nil {
    return fmt.Errorf("failed to create new store: %w", err)
}
// Result: "failed to x: failed to y: failed to create new store: the error"

// ✅ GOOD: Concise context
s, err := store.New()
if err != nil {
    return fmt.Errorf("new store: %w", err)
}
// Result: "x: y: new store: the error"
```

**For other systems:** Make errors clear (e.g., `err` tag or "Failed" prefix in logs).

**See also:** [Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)

#### Error Naming

**For error values (global variables):**

Use prefix `Err` or `err` depending on export:

```go
var (
    // Exported errors for users to match with errors.Is
    ErrBrokenLink   = errors.New("link is broken")
    ErrCouldNotOpen = errors.New("could not open")

    // Unexported error (internal use only)
    errNotFound = errors.New("not found")
)
```

**For custom error types:**

Use suffix `Error`:

```go
// Exported error type
type NotFoundError struct {
    File string
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("file %q not found", e.File)
}

// Unexported error type
type resolveError struct {
    Path string
}

func (e *resolveError) Error() string {
    return fmt.Sprintf("resolve %q", e.Path)
}
```

#### Handle Errors Once

**Rule:** Handle each error only once. Don't log and return.

**Handling options:**
- Match error with `errors.Is` or `errors.As` and handle branches differently
- Log and degrade gracefully (if error is recoverable)
- Return a well-defined error (domain-specific failure)
- Return error, wrapped or verbatim

**❌ BAD: Log and return**

```go
u, err := getUser(id)
if err != nil {
    log.Printf("Could not get user %q: %v", id, err)
    return err  // Caller will also handle, causing duplicate logs
}
```

**✅ GOOD: Wrap and return**

```go
u, err := getUser(id)
if err != nil {
    return fmt.Errorf("get user %q: %w", id, err)
}
```

**✅ GOOD: Log and degrade gracefully**

```go
if err := emitMetrics(); err != nil {
    log.Printf("Could not emit metrics: %v", err)
    // Continue without metrics
}
```

**✅ GOOD: Match and degrade gracefully**

```go
tz, err := getUserTimeZone(id)
if err != nil {
    if errors.Is(err, ErrUserNotFound) {
        tz = time.UTC  // Use default
    } else {
        return fmt.Errorf("get user %q: %w", id, err)
    }
}
```

---

### Handle Type Assertion Failures

**Rule:** Always use the "comma ok" idiom for type assertions.

```go
// ❌ BAD: Panics on incorrect type
t := i.(string)

// ✅ GOOD: Handles failure gracefully
t, ok := i.(string)
if !ok {
    // Handle error gracefully
}
```

---

### Don't Panic

**Rule:** Code running in production must avoid panics. Panics are a major source of cascading failures.

```go
// ❌ BAD: Panic for expected errors
func run(args []string) {
    if len(args) == 0 {
        panic("an argument is required")
    }
    // ...
}

func main() {
    run(os.Args[1:])
}

// ✅ GOOD: Return error
func run(args []string) error {
    if len(args) == 0 {
        return errors.New("an argument is required")
    }
    // ...
    return nil
}

func main() {
    if err := run(os.Args[1:]); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

**When to panic:**
- Irrecoverable events (nil dereference)
- Program initialization failures (bad things at startup)

**Example acceptable panic:**

```go
var _statusTemplate = template.Must(template.New("name").Parse("_statusHTML"))
```

**In tests:** Prefer `t.Fatal` or `t.FailNow` over panics.

```go
// ❌ BAD
func TestFoo(t *testing.T) {
    f, err := os.CreateTemp("", "test")
    if err != nil {
        panic("failed to set up test")
    }
}

// ✅ GOOD
func TestFoo(t *testing.T) {
    f, err := os.CreateTemp("", "test")
    if err != nil {
        t.Fatal("failed to set up test")
    }
}
```

---

### Use Atomic Operations

**2024 Update:** Go 1.19+ improved `sync/atomic` with type-safe methods.

#### Option 1: Use `sync/atomic` (Go 1.19+)

```go
type foo struct {
    running atomic.Bool
}

func (f *foo) start() {
    if f.running.Swap(true) {
        // Already running
        return
    }
    // Start the Foo
}

func (f *foo) isRunning() bool {
    return f.running.Load()
}
```

#### Option 2: Use `go.uber.org/atomic` (older codebases)

**Why:** Adds type safety to atomic operations by hiding underlying types.

```go
// ❌ BAD: Easy to forget atomic operations
type foo struct {
    running int32  // atomic
}

func (f *foo) start() {
    if atomic.SwapInt32(&f.running, 1) == 1 {
        // Already running
        return
    }
    // Start the Foo
}

func (f *foo) isRunning() bool {
    return f.running == 1  // Race condition!
}

// ✅ GOOD: Type-safe atomic
type foo struct {
    running atomic.Bool
}

func (f *foo) start() {
    if f.running.Swap(true) {
        // Already running
        return
    }
    // Start the Foo
}

func (f *foo) isRunning() bool {
    return f.running.Load()
}
```

**Recommendation for 2024:** Use `sync/atomic` for Go 1.19+ projects. Use `go.uber.org/atomic` for consistency in older codebases.

---

### Avoid Mutable Globals

**Rule:** Avoid mutating global variables. Use dependency injection instead.

```go
// ❌ BAD: Mutable global
// sign.go
var _timeNow = time.Now

func sign(msg string) string {
    now := _timeNow()
    return signWithTime(msg, now)
}

// sign_test.go
func TestSign(t *testing.T) {
    oldTimeNow := _timeNow
    _timeNow = func() time.Time {
        return someFixedTime
    }
    defer func() { _timeNow = oldTimeNow }()

    assert.Equal(t, want, sign(give))
}

// ✅ GOOD: Dependency injection
// sign.go
type signer struct {
    now func() time.Time
}

func newSigner() *signer {
    return &signer{
        now: time.Now,
    }
}

func (s *signer) Sign(msg string) string {
    now := s.now()
    return signWithTime(msg, now)
}

// sign_test.go
func TestSigner(t *testing.T) {
    s := newSigner()
    s.now = func() time.Time {
        return someFixedTime
    }

    assert.Equal(t, want, s.Sign(give))
}
```

---

### Avoid Embedding Types in Public Structs

**Rule:** Embedded types leak implementation details and inhibit type evolution.

```go
// ❌ BAD: Embedded type in public API
type ConcreteList struct {
    *AbstractList  // Exposes all AbstractList methods
}

// ✅ GOOD: Delegate explicitly
type ConcreteList struct {
    list *AbstractList
}

func (l *ConcreteList) Add(e Entity) {
    l.list.Add(e)
}

func (l *ConcreteList) Remove(e Entity) {
    l.list.Remove(e)
}
```

**Why embedding is problematic:**
- Adding methods to embedded interface is a breaking change
- Removing methods from embedded struct is a breaking change
- Removing the embedded type is a breaking change
- Replacing the embedded type is a breaking change

**When embedding is acceptable:**
- Private types
- Composition for convenience (not public API)
- Rare cases where you truly want to expose all methods

---

### Avoid Using Built-In Names

**Rule:** Don't shadow built-in identifiers.

**Built-ins to avoid shadowing:**
- Types: `bool`, `int`, `string`, `error`, etc.
- Functions: `append`, `cap`, `close`, `copy`, `delete`, `len`, `make`, `new`, `panic`, `print`, `println`, `recover`
- Constants: `true`, `false`, `iota`, `nil`

```go
// ❌ BAD: Shadows builtin
var error string
// `error` shadows the builtin

func handleErrorMessage(error string) {
    // `error` shadows the builtin
}

type Foo struct {
    error  error   // Ambiguous
    string string  // Ambiguous
}

// ✅ GOOD: Clear names
var errorMessage string

func handleErrorMessage(msg string) {
    // `error` refers to the builtin
}

type Foo struct {
    err error
    str string
}
```

**Note:** The compiler won't error, but `go vet` will catch these.

---

### Avoid init()

**Rule:** Avoid `init()` where possible. When unavoidable, code should:

1. Be completely deterministic
2. Avoid depending on ordering of other `init()` functions
3. Avoid accessing global or environment state
4. Avoid I/O (filesystem, network, system calls)

**Code that can't satisfy these requirements belongs in:**
- A helper called from `main()`
- Part of `main()` itself
- Libraries should be completely deterministic (no "init magic")

```go
// ❌ BAD: init() with side effects
var _defaultFoo Foo

func init() {
    _defaultFoo = Foo{
        // ...
    }
}

// ✅ GOOD: Explicit initialization
var _defaultFoo = Foo{
    // ...
}

// or, better for testability:
var _defaultFoo = defaultFoo()

func defaultFoo() Foo {
    return Foo{
        // ...
    }
}
```

**❌ BAD: I/O in init()**

```go
type Config struct {
    // ...
}

var _config Config

func init() {
    // Bad: based on current directory
    cwd, _ := os.Getwd()

    // Bad: I/O
    raw, _ := os.ReadFile(
        path.Join(cwd, "config", "config.yaml"),
    )

    yaml.Unmarshal(raw, &_config)
}
```

**✅ GOOD: Explicit loading function**

```go
type Config struct {
    // ...
}

func loadConfig() Config {
    cwd, err := os.Getwd()
    // handle err

    raw, err := os.ReadFile(
        path.Join(cwd, "config", "config.yaml"),
    )
    // handle err

    var config Config
    yaml.Unmarshal(raw, &config)

    return config
}
```

**When init() is acceptable:**
- Complex expressions that can't be single assignments
- Pluggable hooks (database/sql dialects, encoding registries)
- Optimizations for Google Cloud Functions or deterministic precomputation

---

### Exit in Main

**Rule:** Call `os.Exit` or `log.Fatal*` only in `main()`. All other functions should return errors.

```go
// ❌ BAD: Exit in helper function
func main() {
    body := readFile(path)
    fmt.Println(body)
}

func readFile(path string) string {
    f, err := os.Open(path)
    if err != nil {
        log.Fatal(err)  // Exits program, skips cleanup
    }

    b, err := io.ReadAll(f)
    if err != nil {
        log.Fatal(err)
    }

    return string(b)
}

// ✅ GOOD: Return errors
func main() {
    body, err := readFile(path)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(body)
}

func readFile(path string) (string, error) {
    f, err := os.Open(path)
    if err != nil {
        return "", err
    }

    b, err := io.ReadAll(f)
    if err != nil {
        return "", err
    }

    return string(b), nil
}
```

**Why:**
- Non-obvious control flow
- Difficult to test (exits test runner)
- Skips cleanup (deferred functions don't run)

#### Exit Once

**Rule:** Prefer calling `os.Exit` or `log.Fatal` at most once in `main()`.

```go
// ❌ BAD: Multiple exit points
package main

func main() {
    args := os.Args[1:]
    if len(args) != 1 {
        log.Fatal("missing file")
    }
    name := args[0]

    f, err := os.Open(name)
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()

    // If we call log.Fatal after this, f.Close won't be called

    b, err := io.ReadAll(f)
    if err != nil {
        log.Fatal(err)
    }

    // ...
}

// ✅ GOOD: Single exit point
package main

func main() {
    if err := run(); err != nil {
        log.Fatal(err)
    }
}

func run() error {
    args := os.Args[1:]
    if len(args) != 1 {
        return errors.New("missing file")
    }
    name := args[0]

    f, err := os.Open(name)
    if err != nil {
        return err
    }
    defer f.Close()

    b, err := io.ReadAll(f)
    if err != nil {
        return err
    }

    // ...
    return nil
}
```

**Alternative: Return exit code**

```go
func main() {
    os.Exit(run(os.Args))
}

func run(args []string) (exitCode int) {
    // ...
    return 0
}
```

**Flexibility:** The `run()` function is not prescriptive. You may:
- Accept unparsed command-line arguments
- Parse arguments in `main()` and pass to `run()`
- Use custom error type to carry exit code
- Put business logic in different abstraction layer

**Key requirement:** Single place in `main()` responsible for exiting.

---

### Use field tags in marshaled structs

**Rule:** Any struct field marshaled to JSON, YAML, or other formats should be annotated with relevant tags.

```go
// ❌ BAD: No tags (not safe to rename)
type Stock struct {
    Price int
    Name  string
}

bytes, err := json.Marshal(Stock{
    Price: 137,
    Name:  "UBER",
})

// ✅ GOOD: Tags make contract explicit
type Stock struct {
    Price int    `json:"price"`
    Name  string `json:"name"`
    // Safe to rename Name to Symbol
}

bytes, err := json.Marshal(Stock{
    Price: 137,
    Name:  "UBER",
})
```

**Rationale:** Serialized form is a contract between systems. Field names in tags make the contract explicit and guard against accidental breaking changes.

---

### Don't fire-and-forget goroutines

**Rule:** Goroutines are lightweight but not free. Don't leak goroutines in production.

**Every goroutine must:**
- Have a predictable time when it will stop running; OR
- Have a way to signal it should stop

**In both cases:** Code must block and wait for the goroutine to finish.

```go
// ❌ BAD: No way to stop
go func() {
    for {
        flush()
        time.Sleep(delay)
    }
}()

// ✅ GOOD: Can stop and wait
var (
    stop = make(chan struct{})
    done = make(chan struct{})
)
go func() {
    defer close(done)

    ticker := time.NewTicker(delay)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            flush()
        case <-stop:
            return
        }
    }
}()

// Later...
close(stop)  // Signal to stop
<-done       // Wait for exit
```

#### Wait for goroutines to exit

**Two popular ways:**

**1. Use `sync.WaitGroup` (multiple goroutines):**

```go
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        // ...
    }()
}

wg.Wait()
```

**2. Use `chan struct{}` (single goroutine):**

```go
done := make(chan struct{})
go func() {
    defer close(done)
    // ...
}()

<-done
```

#### No goroutines in init()

**Rule:** `init()` functions should not spawn goroutines. See [Avoid init()](#avoid-init).

**If a package needs a background goroutine:**
- Expose an object managing the goroutine's lifetime
- Provide a method (`Close`, `Stop`, `Shutdown`) that signals the goroutine to stop and waits for it

```go
// ❌ BAD: Unconditional goroutine in init
func init() {
    go doWork()
}

func doWork() {
    for {
        // ...
    }
}

// ✅ GOOD: User-controlled lifecycle
type Worker struct {
    stop chan struct{}
    done chan struct{}
    // ...
}

func NewWorker(...) *Worker {
    w := &Worker{
        stop: make(chan struct{}),
        done: make(chan struct{}),
        // ...
    }
    go w.doWork()
    return w
}

func (w *Worker) doWork() {
    defer close(w.done)
    for {
        // ...
        select {
        case <-w.stop:
            return
        default:
        }
    }
}

func (w *Worker) Shutdown() {
    close(w.stop)
    <-w.done
}
```

**Note:** Use `WaitGroups` if managing multiple goroutines.

---

## Performance

**Note:** Performance-specific guidelines apply only to the hot path.

### Prefer strconv over fmt

**Rule:** When converting primitives to/from strings, `strconv` is faster than `fmt`.

```go
// ❌ BAD: Using fmt.Sprint
for i := 0; i < b.N; i++ {
    s := fmt.Sprint(rand.Int())
}
// BenchmarkFmtSprint-4    143 ns/op    2 allocs/op

// ✅ GOOD: Using strconv
for i := 0; i < b.N; i++ {
    s := strconv.Itoa(rand.Int())
}
// BenchmarkStrconv-4    64.2 ns/op    1 allocs/op
```

---

### Avoid repeated string-to-byte conversions

**Rule:** Don't create byte slices from fixed strings repeatedly. Perform conversion once.

```go
// ❌ BAD: Repeated conversion
for i := 0; i < b.N; i++ {
    w.Write([]byte("Hello world"))
}
// BenchmarkBad-4   50000000   22.2 ns/op

// ✅ GOOD: Convert once
data := []byte("Hello world")
for i := 0; i < b.N; i++ {
    w.Write(data)
}
// BenchmarkGood-4  500000000   3.25 ns/op
```

---

### Prefer Specifying Container Capacity

**Rule:** Specify container capacity where possible to allocate memory upfront.

#### Specifying Map Capacity Hints

```go
// ❌ BAD: No size hint
m := make(map[string]os.FileInfo)

files, _ := os.ReadDir("./files")
for _, f := range files {
    m[f.Name()] = f
}

// ✅ GOOD: Size hint
files, _ := os.ReadDir("./files")

m := make(map[string]os.DirEntry, len(files))
for _, f := range files {
    m[f.Name()] = f
}
```

**Note:** Map capacity hints approximate hashmap bucket count. Allocations may still occur when adding elements.

#### Specifying Slice Capacity

```go
// ❌ BAD: No capacity
for n := 0; n < b.N; n++ {
    data := make([]int, 0)
    for k := 0; k < size; k++ {
        data = append(data, k)
    }
}
// BenchmarkBad-4    100000000    2.48s

// ✅ GOOD: Pre-allocated capacity
for n := 0; n < b.N; n++ {
    data := make([]int, 0, size)
    for k := 0; k < size; k++ {
        data = append(data, k)
    }
}
// BenchmarkGood-4   100000000    0.21s
```

**Note:** Unlike maps, slice capacity is not a hint. The compiler allocates enough memory for the specified capacity.

---

## Style

### Avoid overly long lines

**Rule:** Aim to wrap lines before reaching 99 characters (soft limit).

**Rationale:** Reduces horizontal scrolling and improves readability.

---

### Be Consistent

**Rule:** Above all else, be consistent.

**Why consistency matters:**
- Easier to maintain
- Easier to rationalize
- Requires less cognitive overhead
- Easier to migrate or update

**Apply changes at package level or larger:** Sub-package level changes violate consistency.

---

### Group Similar Declarations

**Rule:** Go supports grouping similar declarations.

```go
// ❌ BAD: Separate declarations
import "a"
import "b"

const a = 1
const b = 2

var a = 1
var b = 2

type Area float64
type Volume float64

// ✅ GOOD: Grouped declarations
import (
    "a"
    "b"
)

const (
    a = 1
    b = 2
)

var (
    a = 1
    b = 2
)

type (
    Area   float64
    Volume float64
)
```

**Only group related declarations:**

```go
// ❌ BAD: Unrelated grouped
type Operation int

const (
    Add Operation = iota + 1
    Subtract
    Multiply
    EnvVar = "MY_ENV"  // Unrelated!
)

// ✅ GOOD: Separate unrelated
type Operation int

const (
    Add Operation = iota + 1
    Subtract
    Multiply
)

const EnvVar = "MY_ENV"
```

**Groups work inside functions:**

```go
// ❌ BAD
func f() string {
    red := color.New(0xff0000)
    green := color.New(0x00ff00)
    blue := color.New(0x0000ff)
    // ...
}

// ✅ GOOD
func f() string {
    var (
        red   = color.New(0xff0000)
        green = color.New(0x00ff00)
        blue  = color.New(0x0000ff)
    )
    // ...
}
```

**Exception:** Variables declared adjacent to other variables should be grouped, even if unrelated.

```go
// ❌ BAD
func (c *client) request() {
    caller := c.name
    format := "json"
    timeout := 5*time.Second
    var err error
    // ...
}

// ✅ GOOD
func (c *client) request() {
    var (
        caller  = c.name
        format  = "json"
        timeout = 5*time.Second
        err     error
    )
    // ...
}
```

---

### Import Group Ordering

**Rule:** Two import groups:
1. Standard library
2. Everything else

**Applied by `goimports` by default.**

```go
// ❌ BAD: Single group
import (
    "fmt"
    "os"
    "go.uber.org/atomic"
    "golang.org/x/sync/errgroup"
)

// ✅ GOOD: Two groups
import (
    "fmt"
    "os"

    "go.uber.org/atomic"
    "golang.org/x/sync/errgroup"
)
```

---

### Package Names

**Rules:**
- All lower-case (no capitals or underscores)
- Doesn't need renaming at most call sites
- Short and succinct
- Not plural (e.g., `net/url`, not `net/urls`)
- Not "common", "util", "shared", or "lib"

**See also:**
- [Package Names](https://go.dev/blog/package-names)
- [Style guideline for Go packages](https://rakyll.org/style-packages/)

---

### Function Names

**Rule:** Use `MixedCaps` for function names (Go community convention).

**Exception:** Test functions may contain underscores for grouping:

```go
func TestMyFunction_WhatIsBeingTested(t *testing.T) {
    // ...
}
```

---

### Import Aliasing

**Rule:** Import aliasing must be used if package name doesn't match last element of import path.

```go
import (
    "net/http"

    client "example.com/client-go"
    trace "example.com/trace/v2"
)
```

**In all other scenarios, avoid import aliases unless there's a direct conflict.**

```go
// ❌ BAD: Unnecessary alias
import (
    "fmt"
    "os"
    runtimetrace "runtime/trace"

    nettrace "golang.net/x/trace"
)

// ✅ GOOD: Alias only on conflict
import (
    "fmt"
    "os"
    "runtime/trace"

    nettrace "golang.net/x/trace"
)
```

---

### Function Grouping and Ordering

**Rules:**
- Functions should be sorted in rough call order
- Functions in a file should be grouped by receiver

**Therefore:**
1. Exported functions appear first (after `struct`, `const`, `var` definitions)
2. `newXYZ()`/`NewXYZ()` may appear after type definition, before other methods
3. Plain utility functions appear towards the end

```go
// ❌ BAD: Poor ordering
func (s *something) Cost() {
    return calcCost(s.weights)
}

type something struct{ ... }

func calcCost(n []int) int {...}

func (s *something) Stop() {...}

func newSomething() *something {
    return &something{}
}

// ✅ GOOD: Logical ordering
type something struct{ ... }

func newSomething() *something {
    return &something{}
}

func (s *something) Cost() {
    return calcCost(s.weights)
}

func (s *something) Stop() {...}

func calcCost(n []int) int {...}
```

---

### Reduce Nesting

**Rule:** Handle error cases/special conditions first, return early, reduce nesting.

```go
// ❌ BAD: Deep nesting
for _, v := range data {
    if v.F1 == 1 {
        v = process(v)
        if err := v.Call(); err == nil {
            v.Send()
        } else {
            return err
        }
    } else {
        log.Printf("Invalid v: %v", v)
    }
}

// ✅ GOOD: Early returns, shallow nesting
for _, v := range data {
    if v.F1 != 1 {
        log.Printf("Invalid v: %v", v)
        continue
    }

    v = process(v)
    if err := v.Call(); err != nil {
        return err
    }
    v.Send()
}
```

---

### Unnecessary Else

**Rule:** If a variable is set in both branches, replace with single if.

```go
// ❌ BAD: Unnecessary else
var a int
if b {
    a = 100
} else {
    a = 10
}

// ✅ GOOD: Simpler
a := 10
if b {
    a = 100
}
```

---

### Top-level Variable Declarations

**Rule:** At the top level, use standard `var` keyword. Don't specify type unless it differs from expression.

```go
// ❌ BAD: Redundant type
var _s string = F()

func F() string { return "A" }

// ✅ GOOD: Type inferred
var _s = F()

func F() string { return "A" }
```

**Specify type if expression doesn't match desired type:**

```go
type myError struct{}

func (myError) Error() string { return "error" }

func F() myError { return myError{} }

var _e error = F()
// F returns myError but we want error
```

---

### Prefix Unexported Globals with _

**Rule:** Prefix unexported top-level `vars` and `consts` with `_`.

**Rationale:** Makes it clear when they're used that they're global symbols.

```go
// ❌ BAD: Unclear scope
// foo.go
const (
    defaultPort = 8080
    defaultUser = "user"
)

// bar.go
func Bar() {
    defaultPort := 9090  // Shadows global!
    ...
    fmt.Println("Default port", defaultPort)
}

// ✅ GOOD: Clear global
// foo.go
const (
    _defaultPort = 8080
    _defaultUser = "user"
)
```

**Exception:** Unexported error values may use prefix `err` without underscore. See [Error Naming](#error-naming).

---

### Embedding in Structs

**Rule:** Embedded types should be at the top of field list with empty line separator.

```go
// ❌ BAD: Embedded field not at top
type Client struct {
    version int
    http.Client
}

// ✅ GOOD: Embedded field at top
type Client struct {
    http.Client

    version int
}
```

**Embedding should:**
- Provide tangible benefit
- Add or augment functionality semantically
- Have zero adverse user-facing effects

**Exception:** Mutexes should not be embedded, even on unexported types. See [Zero-value Mutexes](#zero-value-mutexes-are-valid).

**Embedding should NOT:**
- Be purely cosmetic or convenience-oriented
- Make outer types more difficult to construct
- Affect outer types' zero values (if useful before, should remain useful)
- Expose unrelated functions/fields as side-effect
- Expose unexported types
- Affect copy semantics
- Change outer type's API or type semantics
- Embed non-canonical form of inner type
- Expose implementation details
- Allow users to observe/control internals
- Change inner function behavior in surprising ways

**Litmus test:** "Would all exported inner methods/fields be added directly to outer type?" If answer is "some" or "no", don't embed—use a field.

```go
// ❌ BAD: Exposes Lock/Unlock unintentionally
type A struct {
    sync.Mutex  // Lock() and Unlock() now available
}

// ✅ GOOD: Use field
type countingWriteCloser struct {
    io.WriteCloser

    count int
}

func (w *countingWriteCloser) Write(bs []byte) (int, error) {
    w.count += len(bs)
    return w.WriteCloser.Write(bs)
}

// ❌ BAD: Pointer changes zero value usefulness
type Book struct {
    io.ReadWriter  // Nil pointer!

    // other fields
}

var b Book
b.Read(...)  // panic: nil pointer

// ✅ GOOD: Useful zero value
type Book struct {
    bytes.Buffer

    // other fields
}

var b Book
b.Read(...)  // ok
```

---

### Local Variable Declarations

**Rule:** Use short variable declarations (`:=`) if variable is being set explicitly.

```go
// ❌ BAD: Unnecessary var
var s = "foo"

// ✅ GOOD: Short declaration
s := "foo"
```

**However, use `var` when default value is clearer:**

```go
// ❌ BAD: Empty slice initialization unclear
func f(list []int) {
    filtered := []int{}
    for _, v := range list {
        if v > 10 {
            filtered = append(filtered, v)
        }
    }
}

// ✅ GOOD: Var makes zero value clear
func f(list []int) {
    var filtered []int
    for _, v := range list {
        if v > 10 {
            filtered = append(filtered, v)
        }
    }
}
```

---

### nil is a valid slice

**Key points:**

**1. Return nil instead of zero-length slice:**

```go
// ❌ BAD: Returns empty slice
if x == "" {
    return []int{}
}

// ✅ GOOD: Returns nil
if x == "" {
    return nil
}
```

**2. Check length, not nil:**

```go
// ❌ BAD: Checks nil
func isEmpty(s []string) bool {
    return s == nil
}

// ✅ GOOD: Checks length
func isEmpty(s []string) bool {
    return len(s) == 0
}
```

**3. Zero value (nil) is usable immediately:**

```go
// ❌ BAD: Unnecessary initialization
nums := []int{}
// or: nums := make([]int)

if add1 {
    nums = append(nums, 1)
}

// ✅ GOOD: Use zero value
var nums []int

if add1 {
    nums = append(nums, 1)
}
```

**Remember:** A nil slice is not equivalent to an allocated slice of length 0 (they may be treated differently, e.g., in serialization).

---

### Reduce Scope of Variables

**Rule:** Reduce scope of variables where possible. Don't reduce if it conflicts with [Reduce Nesting](#reduce-nesting).

```go
// ❌ BAD: Unnecessarily wide scope
err := os.WriteFile(name, data, 0644)
if err != nil {
    return err
}

// ✅ GOOD: Narrow scope
if err := os.WriteFile(name, data, 0644); err != nil {
    return err
}
```

**If you need result outside if, don't reduce scope:**

```go
// ❌ BAD: Result trapped in if scope
if data, err := os.ReadFile(name); err == nil {
    err = cfg.Decode(data)
    if err != nil {
        return err
    }

    fmt.Println(cfg)
    return nil
} else {
    return err
}

// ✅ GOOD: Result available outside if
data, err := os.ReadFile(name)
if err != nil {
    return err
}

if err := cfg.Decode(data); err != nil {
    return err
}

fmt.Println(cfg)
return nil
```

**Constants:** Don't make global unless used in multiple functions/files or part of external contract.

---

### Avoid Naked Parameters

**Rule:** Add C-style comments (`/* ... */`) for parameter names when meaning is not obvious.

```go
// ❌ BAD: What do the bools mean?
// func printInfo(name string, isLocal, done bool)
printInfo("foo", true, true)

// ✅ GOOD: Comments clarify
// func printInfo(name string, isLocal, done bool)
printInfo("foo", true /* isLocal */, true /* done */)
```

**Better yet, replace naked bool types with custom types:**

```go
type Region int

const (
    UnknownRegion Region = iota
    Local
)

type Status int

const (
    StatusReady Status = iota + 1
    StatusDone
    // Maybe StatusInProgress in future
)

func printInfo(name string, region Region, status Status)
```

---

### Use Raw String Literals to Avoid Escaping

**Rule:** Use raw string literals (backticks) to avoid hand-escaped strings.

```go
// ❌ BAD: Escaped string
wantError := "unknown name:\"test\""

// ✅ GOOD: Raw string literal
wantError := `unknown error:"test"`
```

---

### Initializing Structs

#### Use Field Names to Initialize Structs

**Rule:** Almost always specify field names when initializing structs (enforced by `go vet`).

```go
// ❌ BAD: Positional initialization
k := User{"John", "Doe", true}

// ✅ GOOD: Named fields
k := User{
    FirstName: "John",
    LastName:  "Doe",
    Admin:     true,
}
```

**Exception:** Field names may be omitted in test tables with 3 or fewer fields.

```go
tests := []struct{
    op   Operation
    want string
}{
    {Add, "add"},
    {Subtract, "subtract"},
}
```

#### Omit Zero Value Fields in Structs

**Rule:** Omit fields with zero values unless they provide meaningful context.

```go
// ❌ BAD: Explicit zero values
user := User{
    FirstName: "John",
    LastName:  "Doe",
    MiddleName: "",     // Unnecessary
    Admin:      false,  // Unnecessary
}

// ✅ GOOD: Omit zero values
user := User{
    FirstName: "John",
    LastName:  "Doe",
}
```

**Include zero values where meaningful:** For example, test cases can benefit from explicit zero values.

```go
tests := []struct{
    give string
    want int
}{
    {give: "0", want: 0},  // Explicit zero is meaningful
    // ...
}
```

#### Use var for Zero Value Structs

**Rule:** When all fields omitted, use `var` form.

```go
// ❌ BAD: Empty initializer
user := User{}

// ✅ GOOD: var for zero value
var user User
```

**Why:** Differentiates zero-valued structs from those with non-zero fields (similar to map/slice initialization).

#### Initializing Struct References

**Rule:** Use `&T{}` instead of `new(T)` for consistency.

```go
// ❌ BAD: Inconsistent
sval := T{Name: "foo"}

sptr := new(T)
sptr.Name = "bar"

// ✅ GOOD: Consistent
sval := T{Name: "foo"}

sptr := &T{Name: "bar"}
```

---

### Initializing Maps

**Rule:** Prefer `make(..)` for empty maps. Use map literals for fixed lists.

```go
// ❌ BAD: Declaration and initialization look similar
var (
    m1 = map[T1]T2{}  // Safe to read/write
    m2 map[T1]T2      // Panics on writes
)

// ✅ GOOD: Visually distinct
var (
    m1 = make(map[T1]T2)  // Safe to read/write
    m2 map[T1]T2          // Panics on writes
)
```

**Provide capacity hints when possible:**

```go
m := make(map[T1]T2, 3)
m[k1] = v1
m[k2] = v2
m[k3] = v3
```

**For fixed lists, use map literals:**

```go
m := map[T1]T2{
    k1: v1,
    k2: v2,
    k3: v3,
}
```

**Rule of thumb:** Use map literals for fixed elements at initialization; otherwise use `make` (with size hint if available).

---

### Format Strings outside Printf

**Rule:** If declaring format strings outside string literal, make them `const`.

```go
// ❌ BAD: Not const
msg := "unexpected values %v, %v\n"
fmt.Printf(msg, 1, 2)

// ✅ GOOD: const allows go vet to check
const msg = "unexpected values %v, %v\n"
fmt.Printf(msg, 1, 2)
```

**Why:** Helps `go vet` perform static analysis of format string.

---

### Naming Printf-style Functions

**Rule:** When declaring Printf-style function, ensure `go vet` can detect and check it.

**Use predefined Printf-style function names when possible:**

```go
func Wrapf(err error, format string, args ...interface{}) error
```

**If not using predefined names, end name with `f`:**

```go
func MyCustomf(format string, args ...interface{})
```

**`go vet` can check specific names:**

```bash
go vet -printfuncs=wrapf,statusf
```

**See also:** [go vet: Printf family check](https://pkg.go.dev/cmd/vet)

---

## Patterns

### Test Tables

**Rule:** Use table-driven tests with subtests to reduce code duplication.

```go
// ❌ BAD: Repetitive tests
func TestSplitHostPort(t *testing.T) {
    host, port, err := net.SplitHostPort("192.0.2.0:8000")
    require.NoError(t, err)
    assert.Equal(t, "192.0.2.0", host)
    assert.Equal(t, "8000", port)

    host, port, err = net.SplitHostPort("192.0.2.0:http")
    require.NoError(t, err)
    assert.Equal(t, "192.0.2.0", host)
    assert.Equal(t, "http", port)

    // ... more repetition
}

// ✅ GOOD: Table-driven
func TestSplitHostPort(t *testing.T) {
    tests := []struct{
        give     string
        wantHost string
        wantPort string
    }{
        {
            give:     "192.0.2.0:8000",
            wantHost: "192.0.2.0",
            wantPort: "8000",
        },
        {
            give:     "192.0.2.0:http",
            wantHost: "192.0.2.0",
            wantPort: "http",
        },
        {
            give:     ":8000",
            wantHost: "",
            wantPort: "8000",
        },
        {
            give:     "1:8",
            wantHost: "1",
            wantPort: "8",
        },
    }

    for _, tt := range tests {
        t.Run(tt.give, func(t *testing.T) {
            host, port, err := net.SplitHostPort(tt.give)
            require.NoError(t, err)
            assert.Equal(t, tt.wantHost, host)
            assert.Equal(t, tt.wantPort, port)
        })
    }
}
```

**Conventions:**
- Slice of structs called `tests`
- Each test case: `tt`
- Input values: `give` prefix
- Output values: `want` prefix

#### Avoid Unnecessary Complexity in Table Tests

**Rule:** Split complex table tests into multiple test tables or individual tests.

**Avoid:**
- Multiple branching pathways (`shouldError`, `expectCall`)
- Many if statements for mock expectations
- Functions inside tables (`setupMocks func(*FooMock)`)

**Ideals:**
- Focus on narrowest unit of behavior
- Minimize "test depth" (successive dependent assertions)
- Ensure all table fields used in all tests
- Ensure all test logic runs for all table cases

**Exception:** If test body is short and straightforward, single branching for success/failure is acceptable:

```go
tests := []struct{
    give    string
    want    string
    wantErr error
}{
    // ...
}

for _, tt := range tests {
    t.Run(tt.give, func(t *testing.T) {
        got, err := process(tt.give)
        if tt.wantErr != nil {
            require.EqualError(t, err, tt.wantErr.Error())
            return
        }
        require.NoError(t, err)
        assert.Equal(t, tt.want, got)
    })
}
```

#### Parallel Tests

**Rule:** Parallel tests must explicitly assign loop variables.

```go
tests := []struct{
    give string
    // ...
}{
    // ...
}

for _, tt := range tests {
    tt := tt  // Capture for t.Parallel()
    t.Run(tt.give, func(t *testing.T) {
        t.Parallel()
        // ...
    })
}
```

**Why:** Without `tt := tt`, most tests will receive unexpected or changing values for `tt`.

---

### Functional Options

**Pattern:** Declare opaque `Option` type that records information in internal struct. Accept variadic options.

**Use for:**
- Optional arguments in constructors
- Public APIs you foresee needing to expand
- Functions with 3+ arguments

```go
// ❌ BAD: Required arguments for defaults
// package db

func Open(addr string, cache bool, logger *zap.Logger) (*Connection, error) {
    // ...
}

// Usage:
db.Open(addr, db.DefaultCache, zap.NewNop())
db.Open(addr, db.DefaultCache, log)
db.Open(addr, false /* cache */, zap.NewNop())

// ✅ GOOD: Functional options
// package db

type Option interface {
    // ...
}

func WithCache(c bool) Option {
    // ...
}

func WithLogger(log *zap.Logger) Option {
    // ...
}

func Open(addr string, opts ...Option) (*Connection, error) {
    // ...
}

// Usage:
db.Open(addr)
db.Open(addr, db.WithLogger(log))
db.Open(addr, db.WithCache(false))
db.Open(addr, db.WithCache(false), db.WithLogger(log))
```

**Implementation:**

```go
type options struct {
    cache  bool
    logger *zap.Logger
}

type Option interface {
    apply(*options)
}

type cacheOption bool

func (c cacheOption) apply(opts *options) {
    opts.cache = bool(c)
}

func WithCache(c bool) Option {
    return cacheOption(c)
}

type loggerOption struct {
    Log *zap.Logger
}

func (l loggerOption) apply(opts *options) {
    opts.logger = l.Log
}

func WithLogger(log *zap.Logger) Option {
    return loggerOption{Log: log}
}

func Open(addr string, opts ...Option) (*Connection, error) {
    options := options{
        cache:  defaultCache,
        logger: zap.NewNop(),
    }

    for _, o := range opts {
        o.apply(&options)
    }

    // ...
}
```

**Why not closures?** The pattern above provides:
- More flexibility for authors
- Easier to debug and test
- Options can be compared in tests/mocks
- Options can implement other interfaces (e.g., `fmt.Stringer`)

**See also:**
- [Self-referential functions and the design of options](https://commandcenter.blogspot.com/2014/01/self-referential-functions-and-design.html)
- [Functional options for friendly APIs](https://dave.cheney.net/2014/10/17/functional-options-for-friendly-apis)

---

## Linting

**Rule:** Lint consistently across codebase.

### Recommended Linters (Minimum)

- **errcheck** - Ensure errors are handled
- **goimports** - Format code and manage imports
- **golint** - Point out common style mistakes (deprecated, use revive)
- **govet** - Analyze code for common mistakes
- **staticcheck** - Various static analysis checks

### Lint Runners

**Recommended:** [golangci-lint](https://github.com/golangci/golangci-lint)

**Why:**
- Performance in larger codebases
- Ability to configure multiple canonical linters at once
- Active maintenance

**2024 Update:** golangci-lint v2 (released March 2025) separates formatters from linters in configuration.

**Example `.golangci.yml` config:**

```yaml
# golangci-lint v2 configuration
run:
  timeout: 5m
  tests: true
  modules-download-mode: readonly

# v2: Separate formatters from linters
formatters:
  goimports:
    enabled: true
  golines:
    enabled: true
    max-len: 120

linters:
  disable-all: true
  enable:
    # Official Go linters
    - govet
    - staticcheck

    # Error handling
    - errcheck
    - errorlint

    # Security
    - gosec

    # Code quality
    - revive          # Modern golint replacement
    - gocyclo         # Cyclomatic complexity
    - dupl            # Code duplication
    - gofmt           # Formatting
    - ineffassign     # Ineffectual assignments
    - unconvert       # Unnecessary conversions

    # Performance
    - prealloc        # Slice preallocation

linters-settings:
  govet:
    check-shadowing: true

  staticcheck:
    checks: ["all"]

  errcheck:
    check-type-assertions: true
    check-blank: true

  revive:
    severity: warning
    rules:
      - name: exported
      - name: unexported-return
      - name: var-naming

  gocyclo:
    min-complexity: 15

  gosec:
    excludes:
      - G104  # Duplicates errcheck

issues:
  exclude-rules:
    # Exclude some linters from test files
    - path: _test\.go
      linters:
        - gocyclo
        - dupl

  max-issues-per-linter: 0
  max-same-issues: 0
```

**Run commands:**

```bash
# Full lint
golangci-lint run

# Fast mode (for pre-commit)
golangci-lint run --fast

# Specific paths
golangci-lint run ./internal/...

# Show all issues
golangci-lint run --max-issues-per-linter=0 --max-same-issues=0
```

---

## 2024-2025 Updates Summary

**Key changes from original guide:**

1. **Atomic Operations:** Updated to mention `sync/atomic` improvements in Go 1.19+ as primary recommendation, with `go.uber.org/atomic` as alternative for older codebases

2. **Generics:** Added context about Go 1.18+ generics (not extensively covered in original guide)

3. **Linting:** Updated to mention golangci-lint v2 (March 2025) with new configuration format

4. **Structured Logging:** Added context about Go 1.21+ `slog` package (referenced in error handling sections)

5. **Error Handling:** Reinforced modern error wrapping with `%w` (Go 1.13+)

6. **Code Examples:** Verified all examples work with Go 1.21+

7. **Best Practices:** All guidelines remain valid and widely adopted in 2024-2025 Go community

**This guide remains highly relevant and is considered a standard reference for Go style at scale.**

---

**Source:** [uber-go/guide](https://github.com/uber-go/guide)
**Last Updated:** November 2025
**Maintained by:** Uber Engineering
**License:** CC-BY-4.0
