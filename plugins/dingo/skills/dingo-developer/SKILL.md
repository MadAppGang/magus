---
name: dingo-developer
version: 1.0.0
description: >
  Comprehensive Dingo meta-language skill covering all features: error propagation (?),
  guard let, Result/Option types, enums, pattern matching, lambdas, safe navigation (?.),
  null coalescing (??), generics, tuples, expression sugar, feature combinations,
  code review rules, anti-patterns, and Go boundary guidance.
keywords:
  - dingo
  - go
  - meta-language
  - transpiler
  - result
  - option
  - enum
  - match
  - guard
  - error propagation
  - safe navigation
  - null coalescing
  - lambdas
  - generics
  - tuples
  - code review
plugin: dingo
updated: 2026-03-28
---

# Dingo Developer

## Overview

Dingo is a meta-language for Go that transpiles `.dingo` files to idiomatic `.go` files. It
provides modern language features — Result/Option types, sum types (enums), pattern matching,
error propagation, safe navigation, null coalescing, lambdas, generics, and tuples — while
maintaining 100% Go ecosystem compatibility.

**Repository:** https://github.com/MadAppGang/dingo

**Key philosophy:** Dingo is syntax sugar over Go, not a new type system. The transpiled Go
code is clean and idiomatic. All Go syntax remains valid in `.dingo` files.

**When to use Dingo:**
- You want concise error handling with the `?` operator
- You need sum types (enums) and pattern matching
- You prefer functional patterns with lambdas
- You want `Option[T]` and `Result[T, E]` types
- You need safe navigation (`?.`) and null coalescing (`??`)

**CLI commands:**

```bash
dingo build          # Transpile + compile binary
dingo run main.dingo # Transpile + run directly
dingo go             # Generate .go files only (CI/CD)
```

---

## Error Handling

### The `?` Operator — Three Variants

**Decision tree — pick the first that applies:**

1. Just propagate the error unchanged → plain `?`
2. Add lightweight string context → `? "message"`
3. Build a custom error type or capture variables → `? |e| expr`
4. Need side effects or multi-statement logic → `guard` (see below)
5. Absence is expected, not an error → use `Option[T]` + `guard`

---

#### Variant 1: Plain Propagation

```go
// BEFORE (Go)
user, err := getUser(id)
if err != nil {
    return nil, err
}
```

```dingo
// AFTER (Dingo)
user := getUser(id)?
```

---

#### Variant 2: String Context

Generates `fmt.Errorf("message: %w", err)`.

```go
// BEFORE (Go)
config, err := loadConfig(path)
if err != nil {
    return nil, fmt.Errorf("load config: %w", err)
}
```

```dingo
// AFTER (Dingo)
config := loadConfig(path) ? "load config"
```

---

#### Variant 3: Lambda Transform

Captures local variables and builds custom error types. Both Rust-style (`|e|`) and
TypeScript-style (`e =>`) are valid.

```go
// BEFORE (Go)
resp, err := httpClient.Get(url)
if err != nil {
    return nil, &NetworkError{URL: url, Err: err}
}
```

```dingo
// AFTER — Rust-style
resp := httpClient.Get(url) ? |e| &NetworkError{URL: url, Err: e}

// AFTER — TypeScript-style (identical semantics)
resp := httpClient.Get(url) ? e => &NetworkError{URL: url, Err: e}
```

---

### Function Signature Compatibility

| Return type | `?` works? | Notes |
|---|---|---|
| `(T, error)` | YES | Most common |
| `(T1, T2, error)` | YES | Extracts last value |
| `Result[T, E]` | YES | Unwraps to T |
| `error` only (void success) | YES | Propagates error directly |
| `(T, bool)` | NO | Use `Option[T]` + guard |
| `T` only (no error) | NO | Nothing to propagate |

**`?` in void functions is a compile error.** If you need to propagate from a
void-returning call, acknowledge explicitly:

```dingo
// WRONG — compile error when function returns void
validateInput(data)?

// CORRECT
_ = validateInput(data)?
```

---

### `guard` Statement

`guard` provides early-return logic for `Result[T, E]` and `Option[T]` values. It is the
idiomatic way to flatten a "pyramid of doom" into a sequential happy path.

**CRITICAL CONSTRAINT:** `guard` ONLY works with `Result[T, E]` or `Option[T]` return types.
It does NOT work on plain booleans, integers, or other types.

```dingo
// WRONG — guard on boolean generates invalid Go (compile error)
guard user.Active else {
    return "inactive"
}

// CORRECT — guard on Option[T]
guard profile := getProfile(userID) else {
    return "no profile"
}

// CORRECT — guard on Result[T, E]
guard user := findUser(id) else |err| {
    return fmt.Errorf("find user: %w", err)
}
```

#### Guard Syntax Reference

```dingo
// Result: bind error value with |err|
guard user := findUser(id) else |err| {
    return Err(fmt.Errorf("find user: %w", err))
}

// Option: no |err| binding (None has no error value)
guard theme := getTheme(id) else {
    return "default"
}

// Reassignment: use = not := when variable already declared
guard user = refreshUser(ctx, user.ID) else |err| {
    return Err(err)
}

// Tuple destructuring
guard (lat, lng) := getCoords(address) else |err| {
    return Err(fmt.Errorf("coords: %w", err))
}
```

#### Pyramid of Doom → Flat Guard Chain

```go
// BEFORE (Go) — nested error ladder
user, err := findUser(id)
if err != nil {
    return "", fmt.Errorf("find user: %w", err)
}
profile, err := loadProfile(user.ID)
if err != nil {
    return "", fmt.Errorf("load profile: %w", err)
}
settings, err := loadSettings(profile.ID)
if err != nil {
    return "", fmt.Errorf("load settings: %w", err)
}
```

```dingo
// AFTER (Dingo) — flat guard chain
guard user     := findUser(id)              else |e| { return "", fmt.Errorf("find user: %w", e) }
guard profile  := loadProfile(user.ID)      else |e| { return "", fmt.Errorf("load profile: %w", e) }
guard settings := loadSettings(profile.ID)  else |e| { return "", fmt.Errorf("load settings: %w", e) }
```

---

### `?` in Goroutines

The `?` operator cannot propagate errors from inside goroutines (there is no enclosing
function to return to). Use channels or `sync.WaitGroup` + error collection instead.

```dingo
// WRONG — ? inside goroutine has no propagation target
go func() {
    result := fetch()?  // compile error or logic error
}()

// CORRECT — explicit error handling inside goroutines
errCh := make(chan error, 1)
go func() {
    result, err := fetch()
    if err != nil {
        errCh <- err
        return
    }
    process(result)
    errCh <- nil
}()
if err := <-errCh; err != nil {
    return nil, err
}
```

---

## Result & Option Types

### Result[T, E]

Use for operations that can fail when callers need to act on the error type.

**Constructors:** `Ok[T, E](value)` and `Err[T, E](err)`

**Methods (complete list):**

| Method | Description |
|---|---|
| `.IsOk()` | Returns true if Ok variant |
| `.IsErr()` | Returns true if Err variant |
| `.MustOk()` | Returns value; panics if Err |
| `.MustErr()` | Returns error; panics if Ok |
| `.OkOr(default)` | Returns value or default if Err |

**NOT available:** `.Unwrap()`, `.Map()`, `.FlatMap()`, `.UnwrapErr()` — these do not exist
in the dgo package. Do not use them.

```dingo
func divide(a, b int) Result[int, string] {
    if b == 0 {
        return Err[int, string]("division by zero")
    }
    return Ok[int, string](a / b)
}

result := divide(10, 2)
if result.IsOk() {
    fmt.Println(result.MustOk())  // 5
}

// Safe extraction with default
value := divide(10, 0).OkOr(0)  // 0
```

#### Result in Service Layer

```dingo
func (s *UserService) FindByID(ctx context.Context, id string) Result[User, error] {
    guard user := s.repo.FindByID(ctx, id) else |err| {
        if errors.Is(err, sql.ErrNoRows) {
            return Err[User, error](NotFoundError("user"))
        }
        return Err[User, error](InternalError(err))
    }
    return Ok[User, error](user)
}
```

---

### Option[T]

Use when absence is expected and normal — not an error condition.

**Constructors:** `Some(value)` and `None[T]()`

**Methods (complete list):**

| Method | Description |
|---|---|
| `.IsSome()` | Returns true if Some variant |
| `.IsNone()` | Returns true if None variant |
| `.MustSome()` | Returns value; panics if None |
| `.SomeOr(default)` | Returns value or default |
| `.SomeOrElse(fn)` | Returns value or calls fn() for default |

**NOT available:** `.Unwrap()`, `.Map()`, `.FlatMap()` — these do not exist in the dgo
package. Do not use them.

```dingo
func findUser(id string) Option[User] {
    user, err := db.FindByID(id)
    if err != nil {
        return None[User]()
    }
    return Some(user)
}

user := findUser("123")
if user.IsSome() {
    fmt.Println(user.MustSome().Name)
}

// Safe extraction with default
name := findUser("123").SomeOr(User{Name: "Anonymous"}).Name

// Lazy default (only computed when None)
name := findUser("123").SomeOrElse(func() User { return buildDefaultUser() }).Name
```

---

### Result vs Option — When to Use Which

| Situation | Use |
|---|---|
| Absence is expected and normal ("not found") | `Option[T]` |
| Absence needs explanation to the caller | `Result[T, E]` |
| Infrastructure/stdlib calls | `(T, error)` + `?` |
| Domain API with typed errors | `Result[T, DomainError]` |
| "Find" queries on collections | `Option[T]` |
| "Create/Update" domain operations | `Result[T, error]` |

**Rule:** If absence is the expected outcome (e.g., cache miss, optional config), use
`Option[T]`. If absence would surprise the caller and they need to know why, use `Result[T, E]`.

Do NOT mix: a function should return either `Result[T, E]` or `(T, error)` — not both.
`func f() (Result[User, string], error)` is always wrong.

---

## Enums & Sum Types

### Enum Declaration

```dingo
// Simple variants (no data)
enum Status {
    Pending
    Active
    Done
}

// Variants with data
enum Event {
    UserCreated { userID: int, email: string }
    UserDeleted { userID: int }
    EmailChanged { userID: int, oldEmail: string, newEmail: string }
}

// Mixed
enum APIResponse {
    Success { transactionID: string, amount: float64 }
    NotFound
    Error { code: int, reason: string }
}
```

### Constructor Naming

Constructors are auto-generated as `New{EnumName}{VariantName}(fieldValues...)`.

```dingo
// Simple variants (no constructor call needed — use as value)
status := Status.Pending

// Variants with data — use generated constructor
event := NewEventUserCreated(42, "user@example.com")
deleted := NewEventUserDeleted(42)
resp := NewAPIResponseSuccess("TXN-123", 99.99)
notFound := NewAPIResponseNotFound()
```

### What Enums Generate

Each enum declaration generates:
- A Go interface with a marker method
- One struct per variant containing the variant's fields
- Constructor functions `New{Enum}{Variant}(...)`

```go
// Generated Go for: enum Status { Pending; Active; Done }
type Status interface { isStatus() }
type StatusPending struct{}
type StatusActive  struct{}
type StatusDone    struct{}
func (StatusPending) isStatus() {}
func (StatusActive)  isStatus() {}
func (StatusDone)    isStatus() {}
func NewStatusPending() Status { return StatusPending{} }
func NewStatusActive()  Status { return StatusActive{} }
func NewStatusDone()    Status { return StatusDone{} }
```

### Go Pattern → Dingo Enum

```go
// BEFORE (Go) — iota enum with String() method
type OrderStatus int
const (
    OrderPending OrderStatus = iota
    OrderShipped
    OrderDelivered
    OrderCancelled
)
func (s OrderStatus) String() string { ... }
```

```dingo
// AFTER (Dingo)
enum OrderStatus { Pending; Shipped; Delivered; Cancelled }

func (s OrderStatus) String() string {
    return match s {
        OrderStatusPending   => "pending",
        OrderStatusShipped   => "shipped",
        OrderStatusDelivered => "delivered",
        OrderStatusCancelled => "cancelled",
    }
}
```

```go
// BEFORE (Go) — interface discriminated union
type Shape interface { area() float64 }
type Circle    struct { Radius float64 }
type Rectangle struct { Width, Height float64 }
func (c Circle)    area() float64 { return math.Pi * c.Radius * c.Radius }
func (r Rectangle) area() float64 { return r.Width * r.Height }
```

```dingo
// AFTER (Dingo)
enum Shape {
    Circle    { radius: float64 }
    Rectangle { width: float64, height: float64 }
}

func area(shape Shape) float64 {
    return match shape {
        ShapeCircle    { radius }        => math.Pi * radius * radius,
        ShapeRectangle { width, height } => width * height,
    }
}
```

### Do NOT Use Enum For

- `Option[T]` semantics → use dgo `Option[T]`
- `Result[T, E]` semantics → use dgo `Result[T, E]`
- Simple boolean flags → use `bool`
- Open-ended value sets (HTTP status codes, user-defined strings) → keep as `int`/`string`
- More than ~20 variants with no associated data → iota is fine
- Enums re-implementing `Option`/`Result` (e.g., `enum MaybeUser { Found { user: User }; NotFound }`)

---

## Pattern Matching

### Basic Match Syntax

```dingo
func describe(n int) string {
    return match n {
        0 => "zero",
        1 => "one",
        _ if n < 0 => "negative",
        _ if n > 100 => "large",
        _ => "other",
    }
}
```

### Match Syntax Reference

```dingo
// Named field destructuring
match status {
    StatusActive { message } => message,
    _ => "unknown",
}

// Positional destructuring (fields in declaration order)
match event {
    EventUserCreated(userID, email) => fmt.Sprintf("created: %s", email),
}

// Wildcard for unused fields
match event {
    EventOrderPlaced(orderID, _, amount) => fmt.Sprintf("%s: %.2f", orderID, amount),
}

// Guard clause on match arm
match order {
    OrderPlaced { orderID, amount, _ } if amount > 1000 =>
        fmt.Sprintf("HIGH VALUE: %s", orderID),
    OrderPlaced { orderID, _, _ } =>
        fmt.Sprintf("Order: %s", orderID),
}

// Catch-all wildcard
match status {
    StatusPending => "pending",
    StatusActive  => "active",
    _             => "other",
}
```

### Match as Expression vs Statement

```dingo
// Expression — returns a value
role := match user.Level {
    UserLevelAdmin => "admin",
    UserLevelMod   => "moderator",
    _              => "user",
}

// Statement — side effects only
match level {
    LogLevelError => log.Fatalf("fatal: %s", msg),
    LogLevelWarn  => log.Printf("warn: %s", msg),
    _             => {},
}
```

### Exhaustiveness Requirement

Match expressions are exhaustive — all variants must be handled or use `_`. A missing arm
is a compile error.

```dingo
// WRONG — compile error if Status has more variants than Pending/Active
match status {
    StatusPending => "wait",
    StatusActive  => "go",
    // Missing StatusDone, StatusCancelled!
}

// CORRECT
match status {
    StatusPending   => "wait",
    StatusActive    => "go",
    StatusDone      => "done",
    StatusCancelled => "cancelled",
}

// CORRECT — explicit wildcard
match status {
    StatusPending => "wait",
    _             => "other",
}
```

### Match Inside Lambda (Match Pipeline)

```dingo
// Map over a slice, dispatch by type in each element
descriptions := dgo.Map(events, |e| match e {
    EventUserCreated { userID, email }   => fmt.Sprintf("User %d (%s) created", userID, email),
    EventUserDeleted { userID }          => fmt.Sprintf("User %d deleted", userID),
    EventEmailChanged { userID, _, new } => fmt.Sprintf("User %d email → %s", userID, new),
})
```

---

## Lambdas & Functional Patterns

### Lambda Syntax

Dingo supports both Rust-style and TypeScript-style lambda syntax. Both generate identical Go.

```dingo
// Rust-style: |params| expr
activeUsers := dgo.Filter(users, |u| u.Active)
names       := dgo.Map(users, |u| u.Name)
sorted      := sort.Slice(users, func(i, j int) bool { return users[i].Name < users[j].Name })

// TypeScript-style: (params) => expr
activeUsers := dgo.Filter(users, u => u.Active)
names       := dgo.Map(users, u => u.Name)
pairs       := dgo.Map(pairs, (a, b) => a + b)

// Block body (multi-line)
processed := dgo.Map(users, |u| {
    name := strings.ToUpper(u.Name)
    return fmt.Sprintf("%s (%d)", name, u.Age)
})

// Explicit types (standalone, without type inference context)
double := |x int| -> int { x * 2 }
```

**Lambda guideline:** When a lambda body exceeds 3 lines, extract a named function instead.
Lambdas are for concise single-expression or short block transforms.

### dgo Package — Complete Function Reference

All functions work on `[]T` slices. Import with `import "github.com/MadAppGang/dingo/pkg/dgo"`.

**Transform:**

| Function | Signature | Description |
|---|---|---|
| `Map` | `Map[T, U any]([]T, func(T) U) []U` | Transform each element |
| `MapWithIndex` | `MapWithIndex[T, U any]([]T, func(int, T) U) []U` | Transform with index |
| `FlatMap` | `FlatMap[T, U any]([]T, func(T) []U) []U` | Map + flatten one level |
| `Flatten` | `Flatten[T any]([][]T) []T` | Flatten one level |

**Filter/Search:**

| Function | Signature | Description |
|---|---|---|
| `Filter` | `Filter[T any]([]T, func(T) bool) []T` | Keep matching elements |
| `FilterWithIndex` | `FilterWithIndex[T any]([]T, func(int, T) bool) []T` | Filter with index |
| `Find` | `Find[T any]([]T, func(T) bool) Option[T]` | First match or None |
| `FindIndex` | `FindIndex[T any]([]T, func(T) bool) Option[int]` | Index of first match |
| `Contains` | `Contains[T comparable]([]T, T) bool` | Element exists? |
| `Count` | `Count[T any]([]T, func(T) bool) int` | Count matches |

**Predicates:**

| Function | Signature | Description |
|---|---|---|
| `Any` | `Any[T any]([]T, func(T) bool) bool` | True if any match |
| `All` | `All[T any]([]T, func(T) bool) bool` | True if all match (vacuous true for empty) |
| `NoneMatch` | `NoneMatch[T any]([]T, func(T) bool) bool` | True if none match |

**Aggregation:**

| Function | Signature | Description |
|---|---|---|
| `Reduce` | `Reduce[T, R any]([]T, R, func(R, T) R) R` | Fold left |
| `GroupBy` | `GroupBy[T any, K comparable]([]T, func(T) K) map[K][]T` | Group by key |
| `Partition` | `Partition[T any]([]T, func(T) bool) ([]T, []T)` | Split by predicate |

**Ordering/Slicing:**

| Function | Signature | Description |
|---|---|---|
| `Reverse` | `Reverse[T any]([]T) []T` | Reverse order |
| `Unique` | `Unique[T comparable]([]T) []T` | Remove duplicates |
| `Take` | `Take[T any]([]T, n int) []T` | First n elements |
| `Drop` | `Drop[T any]([]T, n int) []T` | All but first n |
| `TakeWhile` | `TakeWhile[T any]([]T, func(T) bool) []T` | Take while predicate |
| `DropWhile` | `DropWhile[T any]([]T, func(T) bool) []T` | Drop while predicate |
| `Chunk` | `Chunk[T any]([]T, size int) [][]T` | Split into chunks |
| `ZipSlices` | `ZipSlices[T, U any]([]T, []U) []Pair[T, U]` | Zip two slices |
| `ForEach` | `ForEach[T any]([]T, func(T))` | Side-effect iteration |
| `ForEachWithIndex` | `ForEachWithIndex[T any]([]T, func(int, T))` | Side-effect with index |

**Important:** `dgo.First` does NOT exist. Use `dgo.Find` which returns `Option[T]`.

### Functional Pipeline Example

```dingo
// Data transformation pipeline
type OrderSummary struct {
    CustomerID string
    Total      float64
    ItemCount  int
}

func buildSummaries(orders []Order) []OrderSummary {
    return dgo.Map(
        dgo.Filter(orders, |o| o.Status == OrderStatusCompleted),
        |o| OrderSummary{
            CustomerID: o.CustomerID,
            Total:      o.Total,
            ItemCount:  len(o.Items),
        },
    )
}

// GroupBy example
func groupByStatus(orders []Order) map[OrderStatus][]Order {
    return dgo.GroupBy(orders, |o| o.Status)
}

// Find with Option
func findFirstHighValue(orders []Order) Option[Order] {
    return dgo.Find(orders, |o| o.Total > 1000.0)
}
```

### When Lambda vs Named Function

Use a lambda when:
- Body is a single expression
- Body is 1–3 lines with no branching complexity
- Used in exactly one place

Extract a named function when:
- Body exceeds 3 lines
- Body contains nested conditionals
- Reused in multiple places
- Meaningful name improves readability

---

## Safe Navigation & Null Coalescing

### Safe Navigation (`?.`)

`?.` performs a nil check before accessing a field. **Pointer field access only.**

**CRITICAL CONSTRAINT:** `?.` works for pointer field access only. Method calls with
`?.Method()` fail to parse for ALL types (pointer and interface alike). Do not use
`?.Method()`.

```dingo
type Config struct {
    Database *DatabaseConfig
}
type DatabaseConfig struct {
    Primary *ConnectionConfig
}
type ConnectionConfig struct {
    Host string
    Port int
}

// Field access through pointer chain — WORKS
host := config?.Database?.Primary?.Host
port := config?.Database?.Primary?.Port

// Method call — DOES NOT WORK (parse error)
name := user?.GetName()  // parser error
```

Generates a nil-checked assignment:

```go
var host string
if config != nil && config.Database != nil && config.Primary != nil {
    host = config.Database.Primary.Host
}
```

---

### Null Coalescing (`??`)

`??` returns the left operand if non-nil/non-zero, otherwise returns the right operand.
For pointer types, **auto-dereferences** the pointer when non-nil.

```dingo
// Basic default
name := user.Nickname ?? user.Name ?? "Anonymous"

// Pointer auto-dereference
var lang *string = user.Language
displayLang := lang ?? "en"   // returns *lang if non-nil, "en" otherwise

// Function call as fallback (lazy)
timeout := config.Timeout ?? getDefaultTimeout()

// Four-level chain
dbHost := appConfig?.Database?.Primary?.Host
    ?? appConfig?.Database?.Fallback?.Host
    ?? envConfig?.DbHost
    ?? "localhost"
```

Generated code for pointer auto-dereference:

```go
displayLang := func() string {
    if lang != nil {
        return *lang
    }
    return "en"
}()
```

---

### Combined `?.` + `??` Pattern

```go
// BEFORE (Go) — nested nil chain
var host string
if appConfig != nil && appConfig.Database != nil && appConfig.Database.Host != "" {
    host = appConfig.Database.Host
} else {
    host = "localhost"
}
```

```dingo
// AFTER (Dingo)
host := appConfig?.Database?.Host ?? "localhost"
```

---

## Generics & Tuples

### Generic Syntax

Dingo uses `<T>` syntax for generics. Go's `[T]` syntax is valid but `<T>` is the
idiomatic Dingo style.

```dingo
// Dingo-idiomatic: <T>
func Map<T, R>(items []T, f func(T) R) []R {
    result := make([]R, len(items))
    for i, item := range items {
        result[i] = f(item)
    }
    return result
}

func Stack<T>() *StackImpl[T] {
    return &StackImpl[T]{}
}

type Cache<K comparable, V any> struct {
    store map[K]V
    mu    sync.RWMutex
}
```

### Tuple Destructuring

```dingo
// Multi-return unpacking
(user, err) := fetchUser(id)
if err != nil {
    return err
}

// Ignore with _
(lat, _) := getCoordinates()

// Destructure directly
(min, max) := minMax(numbers)
```

### Tuple Type Aliases

```dingo
// Supported — generates Go type alias via runtime/tuples package
type Point2D = (float64, float64)
type Range   = (int, int)
type NameID  = (string, int)

func origin() Point2D {
    return (0.0, 0.0)
}

(x, y) := origin()
```

Generates:
```go
type Point2D = tuples.Tuple2[float64, float64]

func origin() Point2D {
    return tuples.Tuple2[float64, float64]{First: 0.0, Second: 0.0}
}
```

**Note:** Tuple type aliases require the `github.com/MadAppGang/dingo/runtime/tuples`
runtime dependency.

**When to use tuples vs structs:**
- Use tuples for transient multi-return values without stable semantic identity
- Use named structs when values have stable meaning, are stored, or benefit from named fields

---

## Expression Sugar

### Ternary Operator

```dingo
// Basic ternary
status := user.Active ? "Active" : "Inactive"

// In function arguments
greet(user.HasNickname ? user.Nickname : user.FullName)

// Return value
return isAdmin ? "Admin" : "User"

// Discount calculation
discount := order.Total > 100 ? order.Total * 0.1 : 0.0
```

**Ternary guidelines:**
- Use only for simple, side-effect-free expressions
- Maximum 2 levels of nesting before it hurts readability
- Do NOT use for function calls with side effects
- Do NOT use for complex multi-step logic

```dingo
// WRONG — side effects in ternary
value := cond ? fetchFromDB() : computeExpensive()

// WRONG — too deeply nested
result := a ? (b ? c : d) : (e ? f : g)  // use if/else

// CORRECT
label := count == 1 ? "item" : "items"
```

---

## Feature Combinations

These named combinations represent real-world patterns. Recognizing them by name helps
apply the right set of features together.

### 1. Error Propagation Stack

`?` chains for stdlib/infrastructure calls.

```dingo
func buildReport(configPath string) (*Report, error) {
    config := loadConfig(configPath) ? "load config"
    data   := fetchData(config.DataURL) ? "fetch data"
    parsed := parseData(data) ? "parse data"
    return generateReport(parsed), nil
}
```

### 2. Validation Chain

`Result[T, E]` + `guard` for sequential domain validation.

```dingo
func createOrder(req CreateOrderRequest) Result[Order, error] {
    guard user    := findUser(req.UserID)       else |err| { return Err(fmt.Errorf("user: %w", err)) }
    guard cart    := getCart(user.ID)           else |err| { return Err(fmt.Errorf("cart: %w", err)) }
    guard payment := validatePayment(req.Card)  else |err| { return Err(fmt.Errorf("payment: %w", err)) }
    guard total   := calculateTotal(cart)       else |err| { return Err(fmt.Errorf("total: %w", err)) }
    return Ok(Order{User: user, Cart: cart, Total: total})
}
```

### 3. Option Gate

`Option[T]` + `guard` for optional data with fallback.

```dingo
func getDisplayName(userID string) string {
    guard user     := findUser(userID)    else { return "Unknown" }
    guard nickname := user.Nickname       else { return user.FullName }
    return nickname
}
```

### 4. State Machine

`enum` + `match` for closed domain states.

```dingo
enum OrderState {
    Pending  { orderID: string }
    Paid     { orderID: string, transactionID: string }
    Shipped  { orderID: string, trackingNumber: string }
    Delivered { orderID: string }
    Cancelled { orderID: string, reason: string }
}

func describeState(state OrderState) string {
    return match state {
        OrderStatePending  { orderID }                    => fmt.Sprintf("%s: awaiting payment", orderID),
        OrderStatePaid     { orderID, transactionID }     => fmt.Sprintf("%s: paid (%s)", orderID, transactionID),
        OrderStateShipped  { orderID, trackingNumber }    => fmt.Sprintf("%s: in transit (%s)", orderID, trackingNumber),
        OrderStateDelivered { orderID }                   => fmt.Sprintf("%s: delivered", orderID),
        OrderStateCancelled { orderID, reason }           => fmt.Sprintf("%s: cancelled — %s", orderID, reason),
    }
}
```

### 5. Null-Safe Access

`?.` + `??` for deep config/profile navigation.

```dingo
func resolveConnection(app *AppConfig, env *EnvConfig) ConnectionParams {
    return ConnectionParams{
        Host:     app?.Database?.Primary?.Host ?? env?.DbHost ?? "localhost",
        Port:     app?.Database?.Primary?.Port ?? 5432,
        User:     app?.Database?.Credentials?.User ?? env?.DbUser ?? "postgres",
        Password: app?.Database?.Credentials?.Password ?? env?.DbPassword ?? "",
    }
}
```

### 6. Functional Pipeline

Lambdas + `dgo` functions for data transformation.

```dingo
func buildLeaderboard(users []User) []LeaderboardEntry {
    active := dgo.Filter(users, |u| u.Active && u.Score > 0)
    return dgo.Map(active, |u| LeaderboardEntry{
        Name:  u.DisplayName,
        Score: u.Score,
        Rank:  0,  // set by caller
    })
}

// With GroupBy
func categorizeByTier(users []User) map[string][]User {
    return dgo.GroupBy(users, |u| match u {
        UserTierFree    => "free",
        UserTierPro     => "pro",
        UserTierEnterprise => "enterprise",
    })
}
```

### 7. Match Pipeline

`match` inside `lambda` for type-dispatched transformation.

```dingo
func renderEvents(events []Event) []string {
    return dgo.Map(events, |e| match e {
        EventUserCreated { userID, email }   => fmt.Sprintf("[+] User %d (%s)", userID, email),
        EventUserDeleted { userID }          => fmt.Sprintf("[-] User %d", userID),
        EventEmailChanged { userID, _, new } => fmt.Sprintf("[~] User %d → %s", userID, new),
    })
}
```

### 8. Full Domain Stack

`enum + Result + guard + match + ?` for complex service/handler logic.

```dingo
func (s *PaymentService) ProcessOrder(
    ctx context.Context,
    orderID string,
) Result[PaymentReceipt, PaymentError] {

    guard order    := s.orderRepo.FindByID(ctx, orderID)  else |err| {
        return Err[PaymentReceipt, PaymentError](PaymentError{
            Code: "ORDER_NOT_FOUND", Cause: err,
        })
    }

    guard customer := s.customerRepo.Find(ctx, order.CustomerID) else |err| {
        return Err[PaymentReceipt, PaymentError](PaymentError{
            Code: "CUSTOMER_NOT_FOUND", Cause: err,
        })
    }

    // Pattern match on current order state
    total := match order.State {
        OrderStatePending { _ } => order.Total,
        OrderStatePaid    { _ } => return Err[PaymentReceipt, PaymentError](
            PaymentError{Code: "ALREADY_PAID"},
        ),
        _ => return Err[PaymentReceipt, PaymentError](
            PaymentError{Code: "INVALID_STATE"},
        ),
    }

    // Use ? for infrastructure calls
    charge := s.stripe.Charge(customer.PaymentMethod, total) ? |e| PaymentError{
        Code: "CHARGE_FAILED", Cause: e,
    }

    receipt := s.orderRepo.MarkAsPaid(ctx, orderID, charge.ID)?

    return Ok[PaymentReceipt, PaymentError](receipt)
}
```

### 9. Outcome Stack

`enum + Result + guard + match` for domain workflows with typed outcomes.

```dingo
enum ValidationOutcome {
    Valid   { sanitized: UserInput }
    Invalid { field: string, reason: string }
    Blocked { reason: string }
}

func validateRegistration(input UserInput) ValidationOutcome {
    guard sanitized := sanitizeInput(input) else |_| {
        return NewValidationOutcomeBlocked("input sanitization failed")
    }
    if !isValidEmail(sanitized.Email) {
        return NewValidationOutcomeInvalid("email", "invalid format")
    }
    if isDisposableEmail(sanitized.Email) {
        return NewValidationOutcomeBlocked("disposable email domain")
    }
    return NewValidationOutcomeValid(sanitized)
}

func handleRegistration(input UserInput) (*User, error) {
    outcome := validateRegistration(input)
    return match outcome {
        ValidationOutcomeValid { sanitized }      => createUser(sanitized),
        ValidationOutcomeInvalid { field, reason } => nil, fmt.Errorf("invalid %s: %s", field, reason),
        ValidationOutcomeBlocked { reason }        => nil, fmt.Errorf("blocked: %s", reason),
    }
}
```

---

## Code Review Rules

Apply these in priority order when reviewing `.dingo` files. All Go syntax is valid in
`.dingo` files — the question is whether the code uses Dingo to be shorter, safer, or
more domain-expressive than the equivalent Go.

**Review philosophy:** Distinguish interop boundaries (Go-like forms may still be appropriate
at public APIs and infrastructure code) from domain/service logic (Dingo should be actively
preferred).

### CHECK 1 — Error Propagation [CRITICAL]

- [ ] Any `if err != nil { return ... err }` → suggest `expr?`
- [ ] Any `if err != nil { return ... fmt.Errorf("...", err) }` → suggest `expr ? "msg"`
- [ ] Sequential `val, err := ...; if err != nil` chains → suggest `?` or `guard` chain
- [ ] Ad hoc result structs (`type XResult struct { Value T; Err error; Ok bool }`) → suggest `Result[T, E]`

### CHECK 2 — Nil Chain Guards [HIGH]

- [ ] `if a != nil && a.B != nil && a.B.C != nil { use a.B.C }` → suggest `a?.B?.C ?? default`
- [ ] Nested `if x != nil { if x.Y != nil { use x.Y.Z } }` → suggest `x?.Y?.Z`
- [ ] `if p != nil { val = *p } else { val = "default" }` → suggest `p ?? "default"`
- [ ] `if user.Language != nil { lang = *user.Language }` → suggest `lang := user.Language ?? "en"`

### CHECK 3 — Pointer Returns for Optionality [HIGH]

- [ ] Functions returning `*T` where `nil` means "not found" → suggest `Option[T]`
- [ ] Callers doing `if result == nil` (not `if err != nil`) → signal for Option
- [ ] `v, ok := lookup(k); if !ok { ... }` `(T, bool)` pattern → suggest `Option[T]` + guard
- [ ] Manual result struct that's essentially `(T, bool)` → suggest `Result[T, E]`

### CHECK 4 — Enums and Pattern Matching [HIGH]

- [ ] `type X interface{ isX() }` + implementing structs → suggest `enum` + `match`
- [ ] `type Status int; const (A Status = iota; B; C)` → suggest Dingo `enum`
- [ ] `switch v := x.(type)` on a Dingo enum type → suggest `match` (do NOT flag stdlib type switches)
- [ ] Struct with `Kind string` / `Type int` tag field + variant payloads → suggest `enum` variants
- [ ] Mutually exclusive struct fields (only one is non-zero at a time) → suggest `enum` variants

### CHECK 5 — Guard Let [MEDIUM]

- [ ] 3+ sequential `if err != nil` early returns → suggest `guard` chain
- [ ] `result.IsErr(); return result.MustErr()` pair → suggest `guard`
- [ ] `opt.IsNone(); return default` pair → suggest `guard`
- [ ] Nested `if` blocks that would flatten to a guard chain

### CHECK 6 — Functional Style [MEDIUM]

- [ ] `for` loop building slice with `append` → suggest `dgo.Map` + lambda
- [ ] `for` loop with conditional `append` → suggest `dgo.Filter` + lambda
- [ ] `for` loop with accumulator → suggest `dgo.Reduce` + lambda
- [ ] `func(u User) string { return u.Name }` passed to Map/Filter → suggest `|u| u.Name`

### CHECK 7 — Expression Sugar [LOW]

- [ ] `var x T; if cond { x = a } else { x = b }` → suggest `x := cond ? a : b`
  (Only for simple, side-effect-free expressions)
- [ ] `func Map[T any]` generic syntax in `.dingo` → suggest `func Map<T>`
- [ ] `a != nil ? a : b` pattern → suggest `a ?? b`

### Severity Guide

| Severity | Description |
|---|---|
| CRITICAL | Boilerplate that will keep appearing; massive noise |
| HIGH | Safety, optionality, or domain-modeling concern |
| MEDIUM | Flow improvement; better readability |
| LOW | Style only; no semantic impact |

### Report Format

```
=== Dingo Code Review ===
File: path/to/service.dingo

CRITICAL:
  [CR-01] Line 45: Naked error propagation
    Found:   user, err := getUser(id); if err != nil { return nil, err }
    Replace: user := getUser(id)?

  [CR-02] Line 67: Wrapped error propagation
    Found:   if err != nil { return nil, fmt.Errorf("fetch: %w", err) }
    Replace: val := fetch() ? "fetch"

HIGH:
  [CR-03] Line 23: Nil chain
    Found:   if config != nil && config.DB != nil { host = config.DB.Host }
    Replace: host := config?.DB?.Host ?? "localhost"

  [CR-11] Line 88: Pointer nil + deref
    Found:   if user.Language != nil { lang = *user.Language }
    Replace: lang := user.Language ?? "en"

MEDIUM:
  [CR-10] Lines 30–38: Sequential error ladder → use guard chain

LOW:
  [CR-08] Line 67: Verbose func literal → lambda
  [CR-09] Line 34: [T any] syntax → <T>

Summary: 2 critical, 2 high, 1 medium, 2 low
```

### Scope Limitations

This review checks **syntax and structure only**. It does NOT:
- Verify that transformations are semantically correct for your codebase
- Check that error types are compatible across callers
- Verify Result/Option methods are called correctly at all call sites
- Analyze goroutine-safety of error propagation
- Check if `Option` callers were updated when a function signature changed

Always review suggested transformations before applying.

**Final question after review:**
> Does this `.dingo` file demonstrate Dingo's strengths, or does it still read like
> Go with a different extension?

---

## Anti-Patterns

Organized by severity.

### Critical — Compile Error or Runtime Panic

**AP-1: `?` in void function**

```dingo
// WRONG — compile error
func validate(data Data) {
    validateField(data.Name)?  // nothing to return
}

// CORRECT
func validate(data Data) {
    _ = validateField(data.Name)?
}
// Or better — return an error:
func validate(data Data) error {
    validateField(data.Name)?
    return nil
}
```

**AP-2: Non-exhaustive match**

```dingo
// WRONG — compile error if Status has more than 2 variants
match status {
    StatusPending => "pending",
    StatusActive  => "active",
    // missing StatusDone, StatusCancelled
}

// CORRECT
match status {
    StatusPending   => "pending",
    StatusActive    => "active",
    StatusDone      => "done",
    StatusCancelled => "cancelled",
}
```

**AP-3: `MustOk()`/`MustSome()` without a prior check**

```dingo
// WRONG — panics at runtime if IsErr
user := findUser(id).MustSome()

// CORRECT
guard user := findUser(id) else { return "unknown" }
// or
if result.IsOk() {
    user := result.MustOk()
}
```

**AP-4: Option guard with `|err|` binding**

```dingo
// WRONG — compile error: Option has no error value
guard user := findUser(id) else |err| {  // findUser returns Option[User]
    return fmt.Errorf("not found: %w", err)
}

// CORRECT
guard user := findUser(id) else {
    return errors.New("user not found")
}
```

**AP-5: `?.` on value types (non-pointer)**

```dingo
user := User{Name: "Alice"}

// WRONG — compile error: user is not a pointer
name := user?.Name

// CORRECT
var userPtr *User = &user
name := userPtr?.Name
```

**AP-6: Mixed Result + error in function signature**

```dingo
// WRONG — never do this
func findUser(id string) (Result[User, string], error) { ... }

// CORRECT — pick one pattern
func findUser(id string) Result[User, error]   { ... }  // domain API
func findUser(id string) (*User, error)        { ... }  // Go-compat
func findUser(id string) Option[User]          { ... }  // lookup
```

---

### High — Incorrect Idiom or Incorrect Semantics

**AP-7: Re-inventing `Option[T]` with a custom enum**

```dingo
// WRONG — reinvents Option
enum MaybeUser {
    Found { user: User }
    NotFound
}

// CORRECT — use dgo Option
func findUser(id string) Option[User] { ... }
```

**AP-8: `if err != nil` in `.dingo` files (domain logic)**

```dingo
// WRONG — Go idiom in Dingo domain code
user, err := getUser(id)
if err != nil {
    return nil, err
}

// CORRECT
user := getUser(id)?
```

**AP-9: Guard reassignment confusion**

```dingo
// WRONG — user is already declared; := creates new variable
var user User
guard user := refreshUser(id) else |err| { return err }

// CORRECT — use = for reassignment
var user User
guard user = refreshUser(id) else |err| { return err }
```

**AP-10: Wrong enum variant name prefix in match**

```dingo
// WRONG — missing enum name prefix
match status {
    Pending => "wait",  // should be StatusPending
    Active  => "go",    // should be StatusActive
}

// CORRECT
match status {
    StatusPending => "wait",
    StatusActive  => "go",
}
```

**AP-11: Direct struct literal instead of constructor**

```dingo
// WRONG — bypasses generated constructor; breaks if struct changes
status := StatusActive{message: "working"}

// CORRECT — use generated constructor
status := NewStatusActive("working")
```

**AP-12: Mixing dgo Option with enum-based Option**

```dingo
// WRONG — two incompatible API styles in same codebase
dgoResult := Some(user)             // dgo package Option
enumResult := NewOptionSome(user)   // interface-based enum Option

// CORRECT — choose one; dgo Option is preferred
result := Some(user)
```

---

### Medium — Poor Domain Modeling

**AP-13: `Option` when absence needs explanation**

```dingo
// WRONG — caller can't know why it's None
func getAccountBalance(id string) Option[float64] { ... }

// CORRECT — absence has meaning (account frozen, not found, etc.)
func getAccountBalance(id string) Result[float64, BalanceError] { ... }
```

**AP-14: `enum` for open-ended values**

```dingo
// WRONG — HTTP codes are not a closed set
enum HTTPStatus {
    OK200
    NotFound404
    ServerError500
    // can never enumerate all HTTP codes
}

// CORRECT
const (
    StatusOK       = 200
    StatusNotFound = 404
)
```

**AP-15: Tuples for persistent data storage**

```dingo
// WRONG — values have stable meaning; use named struct
type UserRecord = (string, int, time.Time)  // what are these?

// CORRECT
type UserRecord struct {
    Name      string
    Age       int
    CreatedAt time.Time
}
```

**AP-16: Enum to reinvent Result/Option**

```dingo
// WRONG — custom Result with extra wrapping
enum FetchResult {
    Success { data: User }
    Error   { msg: string }
}

// CORRECT — use dgo Result directly
func fetchUser(id string) Result[User, string] { ... }
```

---

### Low — Style Issues

**AP-17: Ternary for complex multi-step logic**

```dingo
// WRONG — side effects and complex logic in ternary
result := cond ? fetchUserAndSendEmail(id) : computeExpensiveFallback()

// CORRECT — use if/else for complex logic
var result User
if cond {
    result = fetchUser(id)
    sendWelcomeEmail(result)
} else {
    result = computeFallback()
}
```

**AP-18: Lambda for complex multi-line logic**

```dingo
// WRONG — lambda too complex; extract named function
processed := dgo.Map(users, |u| {
    validated := validate(u)
    if !validated.IsOk() {
        log.Printf("invalid user: %v", u.ID)
        return defaultUser()
    }
    enriched := enrich(validated.MustOk())
    return transform(enriched)
})

// CORRECT — extract named function
func processUser(u User) User {
    validated := validate(u)
    if !validated.IsOk() {
        log.Printf("invalid user: %v", u.ID)
        return defaultUser()
    }
    enriched := enrich(validated.MustOk())
    return transform(enriched)
}

processed := dgo.Map(users, processUser)
```

**AP-19: Ternary nil check instead of `??`**

```dingo
// WRONG — reinvents ??
name := user.Nickname != nil ? user.Nickname : "Anonymous"

// CORRECT
name := user.Nickname ?? "Anonymous"
```

**AP-20: Nested match where guard is cleaner**

```dingo
// WRONG — nested match for sequential Result/Option access
result := match findUser(id) {
    Some(user) => match loadProfile(user.ID) {
        Some(profile) => profile.Name,
        None          => user.Name,
    },
    None => "unknown",
}

// CORRECT — sequential guard chain
guard user    := findUser(id)         else { return "unknown" }
guard profile := loadProfile(user.ID) else { return user.Name }
return profile.Name
```

---

## Go Boundary

### When to Stay Go-Compatible

Not everything in a `.dingo` file needs Dingo syntax. Recognizing the boundary is as
important as knowing the features.

| Layer | Recommended Style |
|---|---|
| Domain/service logic | Dingo (Result, enum, guard, match) |
| Infrastructure (DB, HTTP client, queue) | `(T, error)` + `?` for propagation |
| Public API types (library consumers) | Consider staying Go-compatible |
| Generated code (protobuf, sqlc) | Don't touch; use `?` at call sites |
| Test files | Either style; prefer Dingo for service layer tests |
| Standard library interop | `(T, error)` + `?`; avoid wrapping in Result |

### Public API Considerations

When your package will be imported by Go (non-Dingo) code:
- Keep exported function signatures using `(T, error)` not `Result[T, E]`
- Keep exported struct fields using `*T` not `Option[T]` (dgo types have dgo import dep)
- Use Dingo features internally; convert at the boundary

```dingo
// Internal implementation — full Dingo
func (s *service) processInternal(id string) Result[Output, DomainError] {
    guard user := s.findUser(id) else |err| {
        return Err[Output, DomainError](domainErr(err))
    }
    // ...
    return Ok[Output, DomainError](output)
}

// Public API — Go-compatible signature
func (s *service) Process(id string) (*Output, error) {
    result := s.processInternal(id)
    if result.IsErr() {
        return nil, result.MustErr()
    }
    out := result.MustOk()
    return &out, nil
}
```

### Infrastructure Code

```dingo
// Infrastructure code — use (T, error) + ? for stdlib interop
func (r *postgresRepo) FindByID(ctx context.Context, id string) (*User, error) {
    var user User
    err := r.db.QueryRowContext(ctx,
        "SELECT id, email, name FROM users WHERE id = $1", id,
    ).Scan(&user.ID, &user.Email, &user.Name)

    // (T, error) is correct here; ? for propagation
    if errors.Is(err, sql.ErrNoRows) {
        return nil, nil  // or convert to Option at service layer
    }
    return &user, err
}
```

---

## Migration Guide

When migrating an existing Go codebase to Dingo, apply transformations in this priority order
(highest impact + lowest risk first):

### Phase 1 — Zero Risk (apply everywhere)

| # | Transformation | Risk | Lines Saved |
|---|---|---|---|
| 1 | `if err != nil { return ... err }` → `?` | Zero | 3–4 per occurrence |
| 2 | Nil check chains → `?.` + `??` | Zero | 3–5 per chain |
| 3 | Callback `func(T) R` in Map/Filter → lambda | Zero | Style |

### Phase 2 — Low Risk (local transformations)

| # | Transformation | Risk | Notes |
|---|---|---|---|
| 4 | Interface union → `enum` + `match` | Low | 10–30 lines boilerplate eliminated |
| 5 | `iota` enum → `enum` | Low | Cleaner syntax |
| 6 | Sequential unwrap ladder → `guard` | Low | Flattens nested ifs |
| 7 | Type switch on Dingo enum → `match` | Low | Exhaustiveness gain |

### Phase 3 — Medium Risk (requires updating callers)

| # | Transformation | Risk | Notes |
|---|---|---|---|
| 8 | `*T` for optionality → `Option[T]` | Medium | Update all call sites |
| 9 | `(*T, error)` domain API → `Result[T, E]` | Medium | Only for domain APIs; update callers |

### Phase 4 — Style Only

| # | Transformation | Risk | Notes |
|---|---|---|---|
| 10 | Simple `if/else` → ternary | Zero | Only side-effect-free |

### Rollout Strategy

1. Start with leaf functions (utilities, helpers) — no callers to update
2. Move inward: repositories → services → handlers
3. Convert `(T, error)` → `Result[T, E]` only when the whole vertical slice is Dingo
4. Keep public package APIs Go-compatible until all consumers are converted
5. Infrastructure code (DB, HTTP, gRPC) stays `(T, error)` unless you control both sides

### High-Signal Migration Targets

These patterns in a `.go`-in-Dingo file indicate immediate transformation opportunity:

```
if err != nil       → at least 3× per function → ? chains
if x != nil && x.Y  → nil check chains         → ?. + ??
switch v := x.(type) → type switch on domain    → match
type X int; const ( → iota enum                 → enum
```

---

## Built-in Types Note

`Option[T]`, `Result[T, E]`, `Some()`, `None()`, `Ok()`, `Err()` are built-in Dingo
syntax — no import needed. The transpiler generates all necessary type definitions.

Only import `dgo` when writing **pure Go code** that interoperates with Dingo-generated
types, or when using the `dgo` package functions (`dgo.Map`, `dgo.Filter`, etc.).

```dingo
// No import needed — built-in Dingo
func findUser(id string) Option[User] {
    if found {
        return Some(user)
    }
    return None[User]()
}

func divide(a, b int) Result[int, string] {
    if b == 0 {
        return Err[int, string]("division by zero")
    }
    return Ok[int, string](a / b)
}
```

---

*Dingo Developer — consolidated reference for all Dingo language features.*
*Source of truth: compiler-verified behavior as of Dingo 0.14.0 (2026-03-28).*
