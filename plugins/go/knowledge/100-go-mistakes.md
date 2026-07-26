# 100 Go Mistakes and How to Avoid Them

Comprehensive Guidelines Extracted from "100 Go Mistakes and How to Avoid Them"

**Document Purpose:** This document provides AI agents with mistake-free, professional-grade Go coding principles extracted from the comprehensive book "100 Go Mistakes and How to Avoid Them" by Teiva Harsanyi (2022).

**Target Audience:** AI code generation systems creating production-quality Go code

**Last Updated:** 2025-11-13

---

## Table of Contents

1. [Code and Project Organization](#1-code-and-project-organization)
2. [Data Types](#2-data-types)
3. [Control Structures](#3-control-structures)
4. [Strings](#4-strings)
5. [Functions and Methods](#5-functions-and-methods)
6. [Error Management](#6-error-management)
7. [Concurrency: Foundations](#7-concurrency-foundations)
8. [Concurrency: Practice](#8-concurrency-practice)
9. [Standard Library](#9-standard-library)
10. [Testing](#10-testing)
11. [Optimizations](#11-optimizations)
12. [Summary: Core Principles](#summary-core-principles-for-ai-agents)

---

## 1. Code and Project Organization

### 1.1 Variable Shadowing

**Problem:** Variables redeclared in inner blocks can cause unintended side effects.

**Principles:**

* **ALWAYS** use assignment operator `=` when you need to assign to an outer variable from an inner block
* **NEVER** use short declaration `:=` in inner blocks if you intend to modify outer variables
* **PREFER** temporary variables + explicit assignment over short declaration in nested scopes

```go
// ❌ WRONG: Shadows outer variable
var client *http.Client
if tracing {
    client, err := createClientWithTracing()  // Shadows outer client!
    if err != nil { return err }
}

// ✅ CORRECT Option 1: Use assignment operator
var client *http.Client
var err error
if tracing {
    client, err = createClientWithTracing()  // Assigns to outer client
    if err != nil { return err }
}

// ✅ CORRECT Option 2: Temporary variable
var client *http.Client
if tracing {
    c, err := createClientWithTracing()
    if err != nil { return err }
    client = c
}
```

---

### 1.2 Nested Code

**Problem:** Excessive nesting reduces readability and increases cognitive load.

**Principles:**

* **ALWAYS** align the happy path to the left
* **ALWAYS** return early for error cases
* **ALWAYS** omit else blocks when if block returns
* **NEVER** exceed 3-4 levels of nesting
* **PREFER** guard clauses over nested if/else

```go
// ❌ WRONG: Excessive nesting
func join(s1, s2 string, max int) (string, error) {
    if s1 == "" {
        return "", errors.New("s1 is empty")
    } else {
        if s2 == "" {
            return "", errors.New("s2 is empty")
        } else {
            concat, err := concatenate(s1, s2)
            if err != nil {
                return "", err
            } else {
                if len(concat) > max {
                    return concat[:max], nil
                } else {
                    return concat, nil
                }
            }
        }
    }
}

// ✅ CORRECT: Happy path aligned left
func join(s1, s2 string, max int) (string, error) {
    if s1 == "" {
        return "", errors.New("s1 is empty")
    }
    if s2 == "" {
        return "", errors.New("s2 is empty")
    }
    concat, err := concatenate(s1, s2)
    if err != nil {
        return "", err
    }
    if len(concat) > max {
        return concat[:max], nil
    }
    return concat, nil
}
```

---

### 1.3 Init Functions

**Problem:** Misuse of `init` functions leads to poor error management and testing difficulties.

**Principles:**

* **AVOID** `init` functions for setting up resources (databases, connections)
* **NEVER** use `init` for operations that can fail and need error handling
* **NEVER** create global variables that hold resources in `init`
* **ONLY** use `init` for:
  * Static HTTP configuration (routes, handlers)
  * Immutable configuration that cannot fail
  * Side-effect imports (when necessary)
* **PREFER** explicit initialization functions that return errors

```go
// ❌ WRONG: Database in init
var db *sql.DB
func init() {
    dataSourceName := os.Getenv("MYSQL_DATA_SOURCE_NAME")
    d, err := sql.Open("mysql", dataSourceName)
    if err != nil {
        log.Panic(err)  // Forced to panic, no error handling flexibility
    }
    db = d  // Global variable
}

// ✅ CORRECT: Explicit initialization
func createClient(dsn string) (*sql.DB, error) {
    db, err := sql.Open("mysql", dsn)
    if err != nil {
        return nil, err
    }
    return db, nil
}

// ✅ ACCEPTABLE: Static HTTP configuration
func init() {
    http.HandleFunc("/blog", redirectHandler)
    http.Handle("/favicon.ico", http.FileServer(http.Dir("static")))
}
```

---

### 1.4 Getters and Setters

**Problem:** Overusing getters/setters adds needless complexity.

**Principles:**

* **AVOID** getters/setters unless necessary for:
  * Future functionality (validation, computation, debugging)
  * Encapsulation of behavior
  * Forward compatibility guarantees
* **NEVER** use `GetX()` naming - use `X()` for getters
* **ALWAYS** use `SetX()` for setters
* **PREFER** direct field access when no behavior is needed

```go
// ✅ CORRECT: Direct access (no getter/setter needed)
customer.Balance = 100

// ✅ CORRECT: When behavior is needed
type Customer struct {
    balance float64  // unexported
}

func (c *Customer) Balance() float64 {  // Not GetBalance()
    return c.balance
}

func (c *Customer) SetBalance(amount float64) {
    if amount < 0 {
        amount = 0  // Validation logic
    }
    c.balance = amount
}
```

---

### 1.5 Interface Pollution

**Problem:** Creating unnecessary interfaces makes code harder to understand.

**Principles:**

* **DISCOVER** abstractions, don't create them prematurely
* **ONLY** create interfaces when you have a concrete need:
  1. Common behavior across multiple types
  2. Decoupling from implementation (testing, flexibility)
  3. Restricting behavior to specific methods
* **NEVER** create interfaces "just in case"
* **PREFER** concrete types until abstraction is proven necessary
* **REMEMBER:** "The bigger the interface, the weaker the abstraction" (Rob Pike)

```go
// ❌ WRONG: Premature abstraction
type CustomerStorage interface {
    StoreCustomer(Customer) error
    GetCustomer(string) (Customer, error)
    UpdateCustomer(Customer) error
    GetAllCustomers() ([]Customer, error)
    GetCustomersWithoutContract() ([]Customer, error)
    GetCustomersWithNegativeBalance() ([]Customer, error)
}

// ✅ CORRECT: Start with concrete implementation
type CustomerStore struct {
    // fields
}

func (s *CustomerStore) StoreCustomer(c Customer) error { ... }
// ... other methods

// ✅ CORRECT: Client creates interface when needed
type customerGetter interface {
    GetAllCustomers() ([]Customer, error)
}
```

---

### 1.6 Interface Placement

**Problem:** Placing interfaces on the producer side reduces flexibility.

**Principles:**

* **PLACE** interfaces on the consumer side (not producer side)
* **DEFINE** interfaces where they are used, not where they are implemented
* **LET** clients decide what abstraction they need
* **EXCEPTION:** Standard library patterns (io.Reader, encoding interfaces)

```go
// ❌ WRONG: Producer-side interface
package store

type CustomerStorage interface {
    GetAllCustomers() ([]Customer, error)
}

type Store struct { ... }
func (s *Store) GetAllCustomers() ([]Customer, error) { ... }

// ✅ CORRECT: Consumer-side interface
package client

type customerGetter interface {
    GetAllCustomers() ([]store.Customer, error)
}

func process(cg customerGetter) {
    customers, _ := cg.GetAllCustomers()
    // ...
}
```

---

### 1.7 Returning Interfaces

**Problem:** Returning interfaces restricts flexibility and creates dependencies.

**Principles:**

* **RETURN** concrete implementations (structs)
* **ACCEPT** interfaces as parameters
* **FOLLOW** Postel's Law: "Be conservative in what you do, be liberal in what you accept"
* **EXCEPTION:** Intentional abstractions (error, io.Reader)

```go
// ❌ WRONG: Returns interface
func NewStore() CustomerStorage {
    return &InMemoryStore{}
}

// ✅ CORRECT: Returns concrete type
func NewStore() *InMemoryStore {
    return &InMemoryStore{}
}

// ✅ CORRECT: Accepts interface
func Process(storage CustomerStorage) error {
    // ...
}
```

---

### 1.8 The any Type

**Problem:** Overusing `any` loses type safety and expressiveness.

**Principles:**

* **AVOID** `any` unless absolutely necessary
* **ONLY** use `any` when:
  * Genuinely any type is acceptable (json.Marshal, fmt.Printf)
  * Working with heterogeneous collections
* **PREFER** specific types or generics over `any`
* **NEVER** use `any` in function signatures where specific types work

```go
// ❌ WRONG: Loses type safety
type Store struct{}

func (s *Store) Get(id string) (any, error) {
    // ...
}

func (s *Store) Set(id string, v any) error {
    // ...
}

// ✅ CORRECT: Explicit types
func (s *Store) GetContract(id string) (Contract, error) {
    // ...
}

func (s *Store) SetContract(id string, contract Contract) error {
    // ...
}

// ✅ ACCEPTABLE: Genuinely any type needed
func Marshal(v any) ([]byte, error) {  // Like json.Marshal
    // ...
}
```

---

### 1.9 Generics

**Problem:** Confusion about when to use generics vs concrete types.

**Principles:**

* **USE** generics for:
  * Data structures (linked lists, trees, heaps)
  * Functions working with slices/maps/channels of any type
  * Factoring out behaviors (not just types)
* **AVOID** generics when:
  * Only calling methods of the type (use interfaces)
  * Code becomes more complex
  * Premature abstraction
* **WAIT** until you're about to write boilerplate code before using generics

```go
// ✅ CORRECT: Generic data structure
type Node[T any] struct {
    Val  T
    next *Node[T]
}

// ✅ CORRECT: Generic merge function
func merge[T any](ch1, ch2 <-chan T) <-chan T {
    // ...
}

// ❌ WRONG: Just calling a method
func foo[T io.Writer](w T) {
    b := getBytes()
    _, _ = w.Write(b)  // Just use io.Writer directly!
}

// ✅ CORRECT: Use interface directly
func foo(w io.Writer) {
    b := getBytes()
    _, _ = w.Write(b)
}
```

---

### 1.10 Type Embedding

**Problem:** Unintended promotion of fields and methods.

**Principles:**

* **UNDERSTAND** that embedded fields are promoted
* **BE CAREFUL** with method conflicts
* **USE** embedding for composition, not inheritance
* **PREFER** explicit fields when behavior isn't meant to be promoted

```go
// Type embedding promotes fields
type Foo struct {
    Bar  // Embedded field
}

type Bar struct {
    Baz int
}

foo := Foo{}
foo.Baz = 42  // Promoted from Bar
foo.Bar.Baz = 42  // Same field, explicit path
```

---

## 2. Data Types

### 2.1 Integer Overflows

**Problem:** Integer overflows are silent in Go.

**Principles:**

* **ALWAYS** check for overflows in critical arithmetic operations
* **NEVER** assume integer operations are safe from overflow
* **IMPLEMENT** custom overflow detection when necessary

```go
// ✅ CORRECT: Detect overflow when incrementing
func IncrementInt32(counter int32) (int32, error) {
    if counter == math.MaxInt32 {
        return 0, errors.New("int32 overflow")
    }
    return counter + 1, nil
}

// ✅ CORRECT: Detect overflow in addition
func AddInt32(a, b int32) (int32, error) {
    if a > math.MaxInt32-b {
        return 0, errors.New("int32 overflow")
    }
    return a + b, nil
}
```

---

### 2.2 Floating Point Comparisons

**Problem:** Direct floating-point comparisons are unreliable.

**Principles:**

* **NEVER** use `==` or `!=` for floating-point comparisons
* **ALWAYS** compare within a delta/epsilon
* **GROUP** operations with similar magnitude for accuracy
* **PERFORM** multiplication/division before addition/subtraction

```go
// ❌ WRONG: Direct comparison
if f1 == f2 {
    // ...
}

// ✅ CORRECT: Delta comparison
const epsilon = 1e-9
if math.Abs(f1-f2) < epsilon {
    // ...
}

// ✅ CORRECT: Ordered operations for accuracy
// Do this: (1.0001 + 1.0002) + 100000
// Not this: 100000 + (1.0001 + 1.0002)
```

---

### 2.3 Slice Length and Capacity

**Problem:** Confusion between length and capacity causes bugs.

**Principles:**

* **UNDERSTAND:**
  * Length = number of available elements
  * Capacity = size of backing array
* **INITIALIZE** slices with known size/capacity to avoid reallocations
* **USE** `make([]T, length, capacity)` for pre-allocation

```go
// ❌ WRONG: No pre-allocation
s := []int{}
for i := 0; i < 1000000; i++ {
    s = append(s, i)  // Multiple reallocations
}

// ✅ CORRECT: Pre-allocate capacity
s := make([]int, 0, 1000000)
for i := 0; i < 1000000; i++ {
    s = append(s, i)  // No reallocations
}

// ✅ CORRECT: Pre-allocate length when values known
s := make([]int, 1000000)
for i := 0; i < 1000000; i++ {
    s[i] = i  // Direct assignment, faster than append
}
```

---

### 2.4 Slice Copies and Side Effects

**Problem:** Slicing creates views of the same backing array, causing unintended mutations.

**Principles:**

* **UNDERSTAND** that slicing creates a new slice header, not a copy of data
* **USE** `copy()` to create independent slices
* **USE** full slice expression `s[low:high:max]` to limit capacity
* **BE AWARE** `append` can mutate original slice if capacity allows

```go
// ❌ WRONG: Unintended side effect
s1 := []int{1, 2, 3}
s2 := s1[0:2]  // s2 shares backing array with s1
s2 = append(s2, 10)  // Mutates s1[2]!

// ✅ CORRECT Option 1: Copy
s1 := []int{1, 2, 3}
s2 := make([]int, 2)
copy(s2, s1)  // Independent copy
s2 = append(s2, 10)  // Doesn't affect s1

// ✅ CORRECT Option 2: Full slice expression
s1 := []int{1, 2, 3}
s2 := s1[0:2:2]  // Length=2, Capacity=2
s2 = append(s2, 10)  // Forces new allocation, doesn't affect s1
```

---

### 2.5 Slice Memory Leaks

**Problem:** Slicing can leak capacity or pointer references.

**Principles:**

* **COPY** slices when keeping small parts of large slices
* **SET TO NIL** pointer fields in slice elements outside range
* **UNDERSTAND** GC won't reclaim backing array if any slice references it

**Capacity Leak:**

```go
// ❌ WRONG: Leaks capacity
func getMessageType(msg []byte) []byte {
    return msg[:5]  // Keeps entire backing array (e.g., 1MB)
}

// ✅ CORRECT: Copy to avoid leak
func getMessageType(msg []byte) []byte {
    msgType := make([]byte, 5)
    copy(msgType, msg)
    return msgType  // Only 5 bytes
}
```

**Pointer Leak:**

```go
// ❌ WRONG: Doesn't release memory
func keepFirstTwo(foos []Foo) []Foo {
    return foos[:2]  // GC can't collect remaining elements
}

// ✅ CORRECT Option 1: Copy
func keepFirstTwo(foos []Foo) []Foo {
    res := make([]Foo, 2)
    copy(res, foos)
    return res
}

// ✅ CORRECT Option 2: Nil out pointers
func keepFirstTwo(foos []Foo) []Foo {
    for i := 2; i < len(foos); i++ {
        foos[i].v = nil  // Release references
    }
    return foos[:2]
}
```

---

### 2.6 Nil vs Empty Slices

**Problem:** Confusion between nil and empty slices.

**Principles:**

* **UNDERSTAND:**
  * Nil slice: `var s []int` (no allocation)
  * Empty slice: `s := []int{}` (allocation)
* **CHECK** length, not nil, to test if slice is empty
* **NEVER** distinguish nil/empty in APIs (ambiguous semantics)
* **PREFER** nil slices to avoid unnecessary allocations

```go
// ✅ CORRECT: Check length, works for both nil and empty
func isEmpty(s []int) bool {
    return len(s) == 0  // Works for nil and empty
}

// ❌ WRONG: Distinguishes nil from empty (ambiguous)
func process(s []int) {
    if s == nil {
        // Different behavior for nil vs empty
    }
}

// ✅ CORRECT: Treat nil and empty the same
func process(s []int) {
    if len(s) == 0 {
        // Same behavior for nil and empty
    }
}
```

---

### 2.7 Map Initialization

**Problem:** Not pre-sizing maps causes performance issues.

**Principles:**

* **INITIALIZE** maps with size when known: `make(map[K]V, size)`
* **UNDERSTAND** maps grow by doubling buckets (expensive)
* **PRE-SIZE** to avoid rebalancing overhead

```go
// ❌ WRONG: No pre-sizing
m := make(map[string]int)
for i := 0; i < 1_000_000; i++ {
    m[strconv.Itoa(i)] = i  // Multiple growths
}

// ✅ CORRECT: Pre-sized
m := make(map[string]int, 1_000_000)
for i := 0; i < 1_000_000; i++ {
    m[strconv.Itoa(i)] = i  // No growths
}
```

---

### 2.8 Map Memory Leaks

**Problem:** Maps never shrink, causing memory leaks.

**Principles:**

* **UNDERSTAND** removing elements from map doesn't reduce bucket count
* **RECREATE** map periodically if it grows/shrinks significantly
* **USE** pointers for large values to reduce memory footprint

```go
// Problem: Map grew to 1M buckets, then emptied
// But bucket count stays at 1M!

// ✅ CORRECT Option 1: Recreate map
m := make(map[int][128]byte, 1_000_000)
// ... use map, then clear it
// Periodically:
m = make(map[int][128]byte)  // Fresh map with minimal buckets

// ✅ CORRECT Option 2: Use pointers for large values
m := make(map[int]*[128]byte)  // Only pointer-size per bucket entry
```

---

### 2.9 Value Comparisons

**Problem:** Not all types are comparable with `==`.

**Principles:**

* **COMPARABLE** types:
  * Booleans, numerics, strings, pointers, channels, interfaces
  * Arrays and structs composed of comparable types
* **NOT COMPARABLE:** slices, maps, functions
* **USE** `reflect.DeepEqual` for complex types (with performance cost)
* **IMPLEMENT** custom equality methods for performance-critical code
* **USE** `bytes.Equal` for byte slices (optimized)

```go
// ❌ WRONG: Can't compare slices
s1 := []int{1, 2, 3}
s2 := []int{1, 2, 3}
// if s1 == s2 { }  // Compilation error

// ✅ CORRECT Option 1: reflect.DeepEqual (slower)
if reflect.DeepEqual(s1, s2) {
    // ...
}

// ✅ CORRECT Option 2: Custom method (faster)
func equalSlices(a, b []int) bool {
    if len(a) != len(b) {
        return false
    }
    for i, v := range a {
        if v != b[i] {
            return false
        }
    }
    return true
}

// ✅ CORRECT: Use standard library when available
b1 := []byte{1, 2, 3}
b2 := []byte{1, 2, 3}
if bytes.Equal(b1, b2) {  // Optimized
    // ...
}
```

---

## 3. Control Structures

### 3.1 Range Loop Value Copies

**Problem:** Range loop values are copies, mutations don't affect original.

**Principles:**

* **UNDERSTAND** range value is a copy of the element
* **USE** index to modify slice/array elements
* **NEVER** expect mutations of value variable to affect original

```go
// ❌ WRONG: Doesn't modify slice
accounts := []Account{{Balance: 100}, {Balance: 200}}
for _, a := range accounts {
    a.Balance += 1000  // Modifies copy only!
}

// ✅ CORRECT Option 1: Use index
for i := range accounts {
    accounts[i].Balance += 1000
}

// ✅ CORRECT Option 2: Traditional for loop
for i := 0; i < len(accounts); i++ {
    accounts[i].Balance += 1000
}

// ✅ ACCEPTABLE: Slice of pointers (if already designed that way)
accounts := []*Account{{Balance: 100}, {Balance: 200}}
for _, a := range accounts {
    a.Balance += 1000  // Modifies through pointer
}
```

---

### 3.2 Range Expression Evaluation

**Problem:** Range expression is evaluated only once, before loop starts.

**Principles:**

* **UNDERSTAND** range operates on a copy of the expression
* **MODIFYING** original collection during iteration doesn't affect loop
* **USE** traditional for loop if you need dynamic termination

```go
// Range loop: Terminates after initial length
s := []int{0, 1, 2}
for range s {
    s = append(s, 10)  // Doesn't extend loop
}
// Loop ran 3 times

// Traditional for: Evaluates len(s) each iteration
s := []int{0, 1, 2}
for i := 0; i < len(s); i++ {
    s = append(s, 10)  // Infinite loop!
}
```

---

### 3.3 Range Loop with Pointers

**Problem:** Loop variable has single address, storing pointers to it causes issues.

**Principles:**

* **NEVER** store pointers to loop variable across iterations
* **CREATE** local copy or use slice index for unique addresses

```go
// ❌ WRONG: All pointers reference same variable
var results []*Customer
for _, customer := range customers {
    results = append(results, &customer)  // Same address every iteration!
}
// All pointers point to last customer

// ✅ CORRECT Option 1: Local variable
var results []*Customer
for _, customer := range customers {
    c := customer  // New variable each iteration
    results = append(results, &c)
}

// ✅ CORRECT Option 2: Use index
var results []*Customer
for i := range customers {
    results = append(results, &customers[i])
}
```

---

### 3.4 Map Iteration Order

**Problem:** Assuming deterministic map iteration order.

**Principles:**

* **NEVER** assume any ordering in map iteration:
  * Not sorted by key
  * Not insertion order
  * Not consistent between iterations
* **USE** separate ordered structure if order matters
* **UNDERSTAND** iteration order is intentionally randomized

```go
// ❌ WRONG: Assuming order
m := map[string]int{"a": 1, "b": 2, "c": 3}
for k := range m {
    fmt.Println(k)  // Order is unpredictable
}

// ✅ CORRECT: Explicitly sort when order needed
m := map[string]int{"a": 1, "b": 2, "c": 3}
keys := make([]string, 0, len(m))
for k := range m {
    keys = append(keys, k)
}
sort.Strings(keys)
for _, k := range keys {
    fmt.Println(k, m[k])  // Predictable order
}
```

---

### 3.5 Map Updates During Iteration

**Problem:** Adding entries during iteration has undefined behavior.

**Principles:**

* **UNDERSTAND** new entries may or may not appear in iteration
* **AVOID** modifying map during iteration
* **COPY** map if you need to iterate and update

```go
// ❌ WRONG: Undefined behavior
m := map[int]bool{0: true, 1: false, 2: true}
for k, v := range m {
    if v {
        m[10+k] = true  // May or may not iterate over this
    }
}

// ✅ CORRECT: Iterate over copy
m := map[int]bool{0: true, 1: false, 2: true}
m2 := copyMap(m)
for k, v := range m {
    m2[k] = v
    if v {
        m2[10+k] = true
    }
}
```

---

### 3.6 Break Statement

**Problem:** `break` affects innermost loop/switch/select, not always intended target.

**Principles:**

* **USE** labels to break specific outer loops
* **UNDERSTAND** break terminates innermost for/switch/select
* **PREFER** labeled breaks over state variables

```go
// ❌ WRONG: Breaks switch, not loop
for i := 0; i < 5; i++ {
    switch i {
    case 2:
        break  // Breaks switch, not loop!
    }
}
// Prints: 0 1 2 3 4

// ✅ CORRECT: Labeled break
loop:
for i := 0; i < 5; i++ {
    switch i {
    case 2:
        break loop  // Breaks loop
    }
}
// Prints: 0 1 2
```

---

### 3.7 Defer in Loops

**Problem:** Defer is executed when function returns, not when loop iterates.

**Principles:**

* **AVOID** `defer` inside loops (causes resource leaks)
* **EXTRACT** loop body to separate function if defer is needed
* **CLOSE** resources manually in loops if defer can't be used

```go
// ❌ WRONG: Files not closed until function returns
func readFiles(ch <-chan string) error {
    for path := range ch {
        file, err := os.Open(path)
        if err != nil { return err }
        defer file.Close()  // Accumulated until function returns!
        // ...
    }
    return nil
}

// ✅ CORRECT: Extract to function
func readFiles(ch <-chan string) error {
    for path := range ch {
        if err := readFile(path); err != nil {
            return err
        }
    }
    return nil
}

func readFile(path string) error {
    file, err := os.Open(path)
    if err != nil { return err }
    defer file.Close()  // Closes after this function
    // ...
    return nil
}
```

---

## 4. Strings

### 4.1 Runes and String Iteration

**Problem:** Strings are UTF-8 bytes, not characters.

**Principles:**

* **UNDERSTAND** string is sequence of bytes, not runes
* **USE** `for _, r := range s` to iterate over runes
* **USE** `for i := 0; i < len(s); i++` to iterate over bytes
* **USE** `utf8.RuneCountInString()` for character count

```go
s := "hello 世界"

// ❌ WRONG: len() returns bytes, not characters
fmt.Println(len(s))  // 13, not 8

// ✅ CORRECT: Count runes
fmt.Println(utf8.RuneCountInString(s))  // 8

// Iterate over runes
for i, r := range s {
    fmt.Printf("Position %d: %c\n", i, r)
}
```

---

### 4.2 String Concatenation

**Problem:** Using `+` for string concatenation is inefficient in loops.

**Principles:**

* **USE** `strings.Builder` for concatenation in loops
* **AVOID** `+=` in loops (creates new string each iteration)
* **PRE-SIZE** Builder when size is known

```go
// ❌ WRONG: Inefficient
var s string
for i := 0; i < 1000; i++ {
    s += "x"  // Creates 1000 strings
}

// ✅ CORRECT: Use strings.Builder
var b strings.Builder
b.Grow(1000)  // Pre-size
for i := 0; i < 1000; i++ {
    b.WriteString("x")
}
s := b.String()
```

---

## 5. Functions and Methods

### 5.1 Receiver Types

**Problem:** Choosing between value and pointer receivers.

**Principles:**

* **USE** pointer receivers when:
  * Method mutates receiver
  * Receiver is large struct (copy is expensive)
  * Consistency (if one method uses pointer, all should)
* **USE** value receivers when:
  * Method doesn't mutate receiver
  * Receiver is small (map, func, chan, or small struct)
  * Receiver is immutable type
* **BE CONSISTENT** across all methods of a type

```go
// ✅ CORRECT: Pointer receiver for mutation
func (c *Customer) UpdateBalance(amount float64) {
    c.Balance += amount
}

// ✅ CORRECT: Value receiver for small immutable type
type Point struct{ X, Y int }

func (p Point) String() string {
    return fmt.Sprintf("(%d, %d)", p.X, p.Y)
}
```

---

### 5.2 Named Result Parameters

**Problem:** Misuse or overuse of named result parameters.

**Principles:**

* **USE** named results for:
  * Documentation (especially in interfaces)
  * Early returns with default zero values
  * Defer functions that modify results
* **AVOID** named results:
  * In short functions (adds clutter)
  * When names don't add clarity
* **BE CAREFUL** with shadowing in functions with named results

```go
// ✅ GOOD: Documenting interface
type DB interface {
    Get(key string) (value string, found bool, err error)
}

// ✅ GOOD: Defer modifies result
func process() (err error) {
    f, err := os.Open("file")
    if err != nil { return err }
    defer func() {
        closeErr := f.Close()
        if err == nil {
            err = closeErr
        }
    }()
    // ...
    return nil
}

// ❌ WRONG: Unnecessary in short function
func add(a, b int) (sum int) {
    return a + b
}

// ✅ CORRECT: No names needed
func add(a, b int) int {
    return a + b
}
```

---

### 5.3 Defer Evaluation

**Problem:** Defer arguments are evaluated immediately, not when defer executes.

**Principles:**

* **UNDERSTAND** defer arguments evaluated at defer statement time
* **USE** closures to defer with dynamic values
* **BE AWARE** of pointer vs value receiver evaluation

```go
// ❌ WRONG: Evaluates immediately
status := "start"
defer notify(status)  // Captures "start"
status = "done"
// defer will call notify("start"), not notify("done")

// ✅ CORRECT: Use closure
status := "start"
defer func() {
    notify(status)  // Evaluates status when defer runs
}()
status = "done"
// defer will call notify("done")
```

---

## 6. Error Management

### 6.1 Panic Usage

**Problem:** Overusing panic instead of proper error handling.

**Principles:**

* **ONLY** panic for:
  * Programming errors (impossible state, bugs)
  * Initialization failures (init functions)
* **NEVER** panic in:
  * Library code (except init)
  * Public APIs
  * Expected error conditions
* **RETURN** errors instead of panicking
* **RECOVER** from panics only when absolutely necessary

```go
// ❌ WRONG: Panic for expected errors
func getUser(id string) User {
    user, err := db.Query(id)
    if err != nil {
        panic(err)  // Don't panic for DB errors!
    }
    return user
}

// ✅ CORRECT: Return error
func getUser(id string) (User, error) {
    user, err := db.Query(id)
    if err != nil {
        return User{}, err
    }
    return user, nil
}

// ✅ ACCEPTABLE: Panic for impossible state
func process(items []Item) {
    if len(items) == 0 {
        panic("BUG: process called with empty items")
    }
    // ...
}
```

---

### 6.2 Error Wrapping

**Problem:** Not providing enough context or wrapping incorrectly.

**Principles:**

* **WRAP** errors with context using `fmt.Errorf("context: %w", err)`
* **ONLY** wrap when adding valuable context
* **PRESERVE** error chain for `errors.Is()` and `errors.As()`
* **DON'T** wrap if no context added

```go
// ✅ CORRECT: Wrap with context
func getUser(id string) (User, error) {
    user, err := db.Query(id)
    if err != nil {
        return User{}, fmt.Errorf("get user %s: %w", id, err)
    }
    return user, nil
}

// ✅ CORRECT: Can use errors.Is()
if errors.Is(err, sql.ErrNoRows) {
    // Handle not found
}

// ❌ WRONG: Loses error chain
return User{}, fmt.Errorf("get user: %v", err)  // Use %w, not %v!
```

---

### 6.3 Error Type Checking

**Problem:** Checking error types incorrectly with wrapped errors.

**Principles:**

* **USE** `errors.Is()` for sentinel errors
* **USE** `errors.As()` for error types
* **NEVER** use `==` or type assertion with wrapped errors

```go
// ❌ WRONG: Doesn't work with wrapped errors
if err == sql.ErrNoRows {
    // Won't match if err is wrapped!
}

// ✅ CORRECT: Works with wrapped errors
if errors.Is(err, sql.ErrNoRows) {
    // Matches even if wrapped
}

// ❌ WRONG: Type assertion doesn't work with wrapped
if _, ok := err.(*MyError); ok {
    // Won't work if wrapped!
}

// ✅ CORRECT: errors.As works with wrapped
var myErr *MyError
if errors.As(err, &myErr) {
    // Works even if wrapped
}
```

---

### 6.4 Handling Errors Twice

**Problem:** Logging and returning errors (handled twice).

**Principles:**

* **CHOOSE** one: log OR return error (not both)
* **LET** caller decide how to handle
* **LOG** only at the boundary (main, HTTP handler)

```go
// ❌ WRONG: Handles error twice
func process() error {
    err := do()
    if err != nil {
        log.Printf("error: %v", err)  // Logs here
        return err  // And returns (handled twice)
    }
    return nil
}

// ✅ CORRECT: Return error, let caller handle
func process() error {
    err := do()
    if err != nil {
        return fmt.Errorf("process: %w", err)
    }
    return nil
}

// ✅ CORRECT: Log at boundary
func main() {
    err := process()
    if err != nil {
        log.Fatalf("error: %v", err)  // Only log here
    }
}
```

---

### 6.5 Defer Error Handling

**Problem:** Not handling errors from defer statements.

**Principles:**

* **ALWAYS** handle errors from defer (Close, Flush, etc.)
* **CHECK** error in defer closure
* **COMBINE** with named result if needed

```go
// ❌ WRONG: Ignores close error
func process() error {
    f, err := os.Open("file")
    if err != nil { return err }
    defer f.Close()  // Ignores error!
    // ...
}

// ✅ CORRECT: Handle close error
func process() (err error) {
    f, err := os.Open("file")
    if err != nil { return err }
    defer func() {
        closeErr := f.Close()
        if err == nil {  // Only override if no previous error
            err = closeErr
        }
    }()
    // ...
    return nil
}
```

---

## 7. Concurrency: Foundations

### 7.1 Concurrency vs Parallelism

**Problem:** Confusing concurrency with parallelism.

**Principles:**

* **CONCURRENCY:** Structure (dealing with multiple things at once)
* **PARALLELISM:** Execution (doing multiple things simultaneously)
* **UNDERSTAND:** Concurrent code isn't always faster than sequential
* **BENCHMARK** before assuming concurrency improves performance

---

### 7.2 Channels vs Mutexes

**Problem:** Choosing between channels and mutexes.

**Principles:**

* **USE** channels for:
  * Communication between goroutines
  * Coordination and orchestration
  * Transferring ownership
* **USE** mutexes for:
  * Shared state protection
  * Parallel goroutines accessing same data
  * Cache implementations
* **GUIDELINE:** "Share memory by communicating; don't communicate by sharing memory"

```go
// ✅ CORRECT: Channels for communication
func worker(jobs <-chan Job, results chan<- Result) {
    for job := range jobs {
        results <- process(job)
    }
}

// ✅ CORRECT: Mutex for shared state
type Cache struct {
    mu    sync.RWMutex
    items map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    val, ok := c.items[key]
    return val, ok
}
```

---

### 7.3 Data Races

**Problem:** Multiple goroutines accessing same memory with at least one write.

**Principles:**

* **PREVENT** data races with:
  1. Atomic operations (sync/atomic)
  2. Mutexes (sync.Mutex, sync.RWMutex)
  3. Channels (communication instead of shared memory)
* **RUN** tests with `-race` flag
* **UNDERSTAND:** Data-race-free doesn't mean deterministic (race conditions can still exist)

```go
// ❌ WRONG: Data race
i := 0
go func() { i++ }()
go func() { i++ }()
// Data race on i

// ✅ CORRECT Option 1: Atomic
var i int64
go func() { atomic.AddInt64(&i, 1) }()
go func() { atomic.AddInt64(&i, 1) }()

// ✅ CORRECT Option 2: Mutex
i := 0
mu := sync.Mutex{}
go func() {
    mu.Lock()
    i++
    mu.Unlock()
}()
go func() {
    mu.Lock()
    i++
    mu.Unlock()
}()

// ✅ CORRECT Option 3: Channel
i := 0
ch := make(chan int)
go func() { ch <- 1 }()
go func() { ch <- 1 }()
i += <-ch
i += <-ch
```

---

### 7.4 Workload Types

**Problem:** Not considering workload type when sizing goroutine pools.

**Principles:**

* **CPU-bound:** Pool size = `runtime.GOMAXPROCS(0)` (number of CPU cores)
* **I/O-bound:** Pool size depends on external system capacity
* **BENCHMARK** different pool sizes
* **AVOID** creating unlimited goroutines

```go
// ✅ CORRECT: CPU-bound workload
func processParallel(items []Item) {
    workers := runtime.GOMAXPROCS(0)
    // Create worker pool of size `workers`
}

// ✅ CORRECT: I/O-bound workload (database)
func queryParallel(queries []Query) {
    workers := 100  // Based on DB connection pool size
    // Create worker pool
}
```

---

### 7.5 Context Usage

**Problem:** Misunderstanding context purpose and usage.

**Principles:**

* **USE** context for:
  * Cancellation signals
  * Deadlines/timeouts
  * Request-scoped values (tracing IDs, etc.)
* **ALWAYS** pass context as first parameter
* **ALWAYS** defer `cancel()` when creating context with timeout/cancellation
* **USE** `context.Background()` for top-level contexts
* **USE** `context.TODO()` when context is unclear

```go
// ✅ CORRECT: Timeout context
func fetchData(ctx context.Context) error {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()  // Always defer cancel

    // ... fetch with context
    return nil
}

// ✅ CORRECT: Cancellation
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    go worker(ctx)

    // ... when done
    cancel()  // Signal workers to stop
}

// ✅ CORRECT: Context values
type key string
const requestIDKey key = "request-id"

ctx := context.WithValue(ctx, requestIDKey, "12345")
// Later:
if id, ok := ctx.Value(requestIDKey).(string); ok {
    // Use request ID
}
```

---

## 8. Concurrency: Practice

### 8.1 Context Propagation

**Problem:** Propagating context inappropriately (especially HTTP request context).

**Principles:**

* **BE CAREFUL** propagating HTTP request context to async operations
* **UNDERSTAND** HTTP request context cancels when response is written
* **CREATE** detached context for async operations if needed
* **PRESERVE** context values even when detaching cancellation

```go
// ❌ WRONG: Request context cancels when response written
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        publish(r.Context(), data)  // May cancel prematurely!
    }()
    writeResponse(w, response)  // Cancels context
}

// ✅ CORRECT: Detached context
func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        publish(context.Background(), data)  // Independent
    }()
    writeResponse(w, response)
}

// ✅ CORRECT: Detach cancellation but keep values
type detachedCtx struct {
    ctx context.Context
}

func (d detachedCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (d detachedCtx) Done() <-chan struct{}       { return nil }
func (d detachedCtx) Err() error                  { return nil }
func (d detachedCtx) Value(key any) any           { return d.ctx.Value(key) }

func handler(w http.ResponseWriter, r *http.Request) {
    go func() {
        publish(detachedCtx{r.Context()}, data)
    }()
    writeResponse(w, response)
}
```

---

### 8.2 Goroutine Lifecycle

**Problem:** Starting goroutines without knowing when they'll stop.

**Principles:**

* **ALWAYS** have clear goroutine exit conditions
* **NEVER** start goroutines without cleanup plan
* **USE** context for cancellation signals
* **WAIT** for goroutines to complete before exiting application
* **CLOSE** resources in goroutines before exiting

```go
// ❌ WRONG: No clear exit
func main() {
    ch := someSource()
    go func() {
        for msg := range ch {  // When does this end?
            process(msg)
        }
    }()
    // Application exits, goroutine leaked
}

// ✅ CORRECT: Clear lifecycle management
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    wg := sync.WaitGroup{}
    wg.Add(1)

    go func() {
        defer wg.Done()
        for {
            select {
            case msg := <-ch:
                process(msg)
            case <-ctx.Done():
                return  // Clear exit
            }
        }
    }()

    // ... do work
    cancel()  // Signal stop
    wg.Wait()  // Wait for cleanup
}
```

---

### 8.3 Goroutines and Loop Variables

**Problem:** Goroutines capturing loop variables reference same variable.

**Principles:**

* **ALWAYS** create local copy of loop variable for goroutines
* **UNDERSTAND** closures capture variables, not values

```go
// ❌ WRONG: All goroutines reference same variable
for _, item := range items {
    go func() {
        process(item)  // All see last item!
    }()
}

// ✅ CORRECT Option 1: Local copy
for _, item := range items {
    item := item  // Shadow with local copy
    go func() {
        process(item)
    }()
}

// ✅ CORRECT Option 2: Function parameter
for _, item := range items {
    go func(i Item) {
        process(i)
    }(item)
}
```

---

### 8.4 Select and Channels

**Problem:** Assuming deterministic select behavior.

**Principles:**

* **UNDERSTAND** select randomly chooses when multiple cases are ready
* **USE** select for channel multiplexing
* **IMPLEMENT** timeouts with `time.After()` or context

```go
// ✅ CORRECT: Non-deterministic choice
select {
case msg := <-ch1:
    // Process from ch1
case msg := <-ch2:
    // Process from ch2  (random if both ready)
case <-ctx.Done():
    // Timeout/cancellation
}

// ✅ CORRECT: Timeout pattern
select {
case result := <-ch:
    return result
case <-time.After(5 * time.Second):
    return timeout error
}
```

---

### 8.5 Nil Channels

**Problem:** Not leveraging nil channel behavior.

**Principles:**

* **UNDERSTAND:**
  * Send to nil channel blocks forever
  * Receive from nil channel blocks forever
  * Can be used to disable select cases
* **USE** nil channels to disable select cases dynamically

```go
// ✅ CORRECT: Use nil to disable case
func merge(ch1, ch2 <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for ch1 != nil || ch2 != nil {
            select {
            case v, ok := <-ch1:
                if !ok {
                    ch1 = nil  // Disable this case
                    continue
                }
                out <- v
            case v, ok := <-ch2:
                if !ok {
                    ch2 = nil  // Disable this case
                    continue
                }
                out <- v
            }
        }
    }()
    return out
}
```

---

### 8.6 Channel Sizes

**Problem:** Not understanding implications of buffered vs unbuffered channels.

**Principles:**

* **DEFAULT** to unbuffered channels (explicit synchronization)
* **BUFFER** channels only when:
  * Known and fixed number of messages
  * Want to decouple send/receive timing
  * Avoiding goroutine leaks in edge cases
* **UNDERSTAND** buffer size is not a performance tuning knob
* **REMEMBER** unbuffered provides synchronization guarantee

```go
// ✅ CORRECT: Unbuffered for synchronization
ch := make(chan int)  // Unbuffered
go func() {
    ch <- 1  // Blocks until received
}()
<-ch  // Synchronized

// ✅ CORRECT: Buffered for known size
ch := make(chan int, 10)  // Workers pool size
for i := 0; i < 10; i++ {
    ch <- i  // Won't block
}
```

---

### 8.7 WaitGroup Usage

**Problem:** Incorrect WaitGroup patterns.

**Principles:**

* **CALL** `Add()` before starting goroutine
* **ALWAYS** call `Done()` with defer
* **WAIT** in main goroutine only
* **NEVER** copy `sync.WaitGroup` (pass by pointer)

```go
// ❌ WRONG: Add() after goroutine start
for i := 0; i < 10; i++ {
    go func() {
        wg.Add(1)  // Race condition!
        defer wg.Done()
        // work
    }()
}

// ✅ CORRECT: Add() before goroutine
wg := sync.WaitGroup{}
for i := 0; i < 10; i++ {
    wg.Add(1)  // Before goroutine
    go func() {
        defer wg.Done()
        // work
    }()
}
wg.Wait()
```

---

### 8.8 Errgroup Usage

**Problem:** Not using errgroup for goroutine error handling.

**Principles:**

* **USE** `golang.org/x/sync/errgroup` for goroutines that can return errors
* **PREFER** errgroup over manual WaitGroup + error channel
* **LEVERAGE** automatic context cancellation on first error

```go
// ✅ CORRECT: Using errgroup
import "golang.org/x/sync/errgroup"

func process(items []Item) error {
    g, ctx := errgroup.WithContext(context.Background())

    for _, item := range items {
        item := item
        g.Go(func() error {
            return processItem(ctx, item)
        })
    }

    return g.Wait()  // Returns first error
}
```

---

### 8.9 Sync Types

**Problem:** Copying sync types (Mutex, WaitGroup, etc.).

**Principles:**

* **NEVER** copy sync types:
  * sync.Mutex, sync.RWMutex
  * sync.WaitGroup
  * sync.Cond
  * sync.Pool
* **ALWAYS** pass by pointer or embed in struct
* **USE** `go vet` to detect copying

```go
// ❌ WRONG: Copies mutex
type Counter struct {
    mu    sync.Mutex
    count int
}

func (c Counter) Inc() {  // Value receiver copies mutex!
    c.mu.Lock()
    defer c.mu.Unlock()
    c.count++
}

// ✅ CORRECT: Pointer receiver
func (c *Counter) Inc() {  // Pointer receiver
    c.mu.Lock()
    defer c.mu.Unlock()
    c.count++
}
```

---

## 9. Standard Library

### 9.1 Time Duration

**Problem:** Passing wrong time duration units.

**Principles:**

* **ALWAYS** use time constants: `time.Second`, `time.Millisecond`, etc.
* **NEVER** pass bare integers to duration parameters
* **BE EXPLICIT** about units

```go
// ❌ WRONG: What unit is this?
time.Sleep(1000)  // Nanoseconds? Milliseconds?

// ✅ CORRECT: Explicit units
time.Sleep(1000 * time.Millisecond)
time.Sleep(1 * time.Second)

// ✅ CORRECT: Duration variable
timeout := 30 * time.Second
ctx, cancel := context.WithTimeout(ctx, timeout)
```

---

### 9.2 time.After Leaks

**Problem:** Using `time.After` in loops causes memory leaks.

**Principles:**

* **AVOID** `time.After` in loops (timer not garbage collected)
* **USE** `time.NewTimer` and reset it
* **STOP** timers explicitly when done

```go
// ❌ WRONG: Leaks timers
for {
    select {
    case <-ch:
        // ...
    case <-time.After(1 * time.Second):  // New timer each iteration!
        // ...
    }
}

// ✅ CORRECT: Reuse timer
timer := time.NewTimer(1 * time.Second)
defer timer.Stop()
for {
    select {
    case <-ch:
        // ...
    case <-timer.C:
        // ...
        timer.Reset(1 * time.Second)
    }
}
```

---

### 9.3 JSON Handling

**Problem:** Common JSON marshaling/unmarshaling mistakes.

**Principles:**

* **EXPORT** struct fields for JSON (capitalize first letter)
* **USE** struct tags for custom names: `json:"name"`
* **HANDLE** embedded structs carefully (can cause unexpected behavior)
* **USE** `omitempty` for optional fields
* **BE AWARE** of monotonic clock stripping in `time.Time`

```go
// ❌ WRONG: Unexported fields not marshaled
type User struct {
    name string  // Won't be in JSON!
    age  int     // Won't be in JSON!
}

// ✅ CORRECT: Exported fields
type User struct {
    Name string `json:"name"`
    Age  int    `json:"age,omitempty"`  // Omit if zero
}
```

---

### 9.4 SQL Best Practices

**Problem:** Common database/sql mistakes.

**Principles:**

* **ALWAYS** handle connection pooling
* **USE** prepared statements for repeated queries
* **CHECK** row iteration errors with `rows.Err()`
* **CLOSE** rows with defer
* **HANDLE** NULL values with `sql.Null*` types

```go
// ✅ CORRECT: SQL best practices
func query(db *sql.DB) error {
    rows, err := db.Query("SELECT id, name FROM users WHERE age > ?", 18)
    if err != nil {
        return err
    }
    defer rows.Close()  // Always close

    for rows.Next() {
        var id int
        var name string
        if err := rows.Scan(&id, &name); err != nil {
            return err
        }
        // process row
    }

    return rows.Err()  // Check iteration errors
}

// ✅ CORRECT: Handle NULL
var name sql.NullString
if err := rows.Scan(&id, &name); err != nil {
    return err
}
if name.Valid {
    // Use name.String
}
```

---

### 9.5 Closing Resources

**Problem:** Not closing HTTP bodies, file handles, SQL rows.

**Principles:**

* **ALWAYS** close:
  * HTTP response bodies
  * SQL rows
  * Files
  * Network connections
* **USE** defer immediately after checking error
* **HANDLE** close errors (especially for writes)

```go
// ✅ CORRECT: Close HTTP body
resp, err := http.Get(url)
if err != nil {
    return err
}
defer resp.Body.Close()  // Always close

body, err := io.ReadAll(resp.Body)
// ...

// ✅ CORRECT: Close file with error handling
func writeFile(data []byte) (err error) {
    f, err := os.Create("file.txt")
    if err != nil {
        return err
    }
    defer func() {
        closeErr := f.Close()
        if err == nil {
            err = closeErr  // Capture close error
        }
    }()

    _, err = f.Write(data)
    return err
}
```

---

### 9.6 HTTP Client/Server Configuration

**Problem:** Using default HTTP client/server without timeouts.

**Principles:**

* **NEVER** use `http.DefaultClient` in production
* **ALWAYS** configure timeouts:
  * Client: Timeout, DialContext, TLSHandshakeTimeout
  * Server: ReadTimeout, WriteTimeout, IdleTimeout
* **SET** reasonable limits

```go
// ❌ WRONG: No timeouts
resp, err := http.Get(url)  // Uses http.DefaultClient

// ✅ CORRECT: Configured client
client := &http.Client{
    Timeout: 30 * time.Second,
    Transport: &http.Transport{
        DialContext: (&net.Dialer{
            Timeout: 5 * time.Second,
        }).DialContext,
        TLSHandshakeTimeout: 5 * time.Second,
    },
}
resp, err := client.Get(url)

// ✅ CORRECT: Configured server
server := &http.Server{
    Addr:         ":8080",
    Handler:      handler,
    ReadTimeout:  15 * time.Second,
    WriteTimeout: 15 * time.Second,
    IdleTimeout:  60 * time.Second,
}
```

---

## 10. Testing

### 10.1 Test Organization

**Problem:** Not categorizing tests (unit, integration, e2e).

**Principles:**

* **SEPARATE** unit tests from integration tests
* **USE** build tags: `//go:build integration`
* **USE** short mode: `if testing.Short() { t.Skip() }`
* **RUN** unit tests frequently, integration tests less often

```go
//go:build integration

package mypackage_test

func TestDatabaseIntegration(t *testing.T) {
    // Integration test
}

// Run only integration tests:
// go test -tags=integration

// Or using short mode:
func TestSlow(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping in short mode")
    }
    // slow test
}

// go test -short  (skips slow tests)
```

---

### 10.2 Race Detector

**Problem:** Not running tests with race detector.

**Principles:**

* **ALWAYS** run tests with `-race` flag in CI
* **FIX** all data races before merging
* **UNDERSTAND** race detector has runtime overhead (slower, more memory)

```bash
# Run tests with race detector
go test -race ./...

# Run specific test with race detector
go test -race -run TestConcurrent
```

---

### 10.3 Test Execution Modes

**Problem:** Not using parallel and shuffle flags.

**Principles:**

* **USE** `t.Parallel()` for independent tests
* **USE** `-shuffle` flag to detect test dependencies
* **AVOID** global state in tests

```go
// ✅ CORRECT: Parallel test
func TestSomething(t *testing.T) {
    t.Parallel()  // Can run in parallel
    // ...
}

// Run tests:
// go test -parallel 8        # Run 8 tests in parallel
// go test -shuffle=on        # Randomize test order
```

---

### 10.4 Table-Driven Tests

**Problem:** Duplicating test logic instead of using tables.

**Principles:**

* **USE** table-driven tests for multiple scenarios
* **NAME** test cases clearly
* **ISOLATE** each test case

```go
// ✅ CORRECT: Table-driven test
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive", 2, 3, 5},
        {"negative", -1, -1, -2},
        {"mixed", 5, -3, 2},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()
            result := add(tt.a, tt.b)
            if result != tt.expected {
                t.Errorf("add(%d, %d) = %d; want %d",
                    tt.a, tt.b, result, tt.expected)
            }
        })
    }
}
```

---

### 10.5 Time in Tests

**Problem:** Using `time.Sleep` in tests.

**Principles:**

* **AVOID** `time.Sleep` (flaky tests)
* **USE** polling with timeout
* **INJECT** time dependencies for testing
* **USE** channels or sync primitives for synchronization

```go
// ❌ WRONG: Sleep-based test
func TestAsync(t *testing.T) {
    startAsync()
    time.Sleep(100 * time.Millisecond)  // Flaky!
    // assert result
}

// ✅ CORRECT: Polling with timeout
func TestAsync(t *testing.T) {
    startAsync()

    timeout := time.After(1 * time.Second)
    tick := time.NewTicker(10 * time.Millisecond)
    defer tick.Stop()

    for {
        select {
        case <-timeout:
            t.Fatal("timeout waiting for result")
        case <-tick.C:
            if checkCondition() {
                return
            }
        }
    }
}

// ✅ CORRECT: Channel synchronization
func TestAsync(t *testing.T) {
    done := make(chan struct{})
    startAsync(func() {
        close(done)
    })

    select {
    case <-done:
        // Success
    case <-time.After(1 * time.Second):
        t.Fatal("timeout")
    }
}
```

---

### 10.6 Testing Utilities

**Problem:** Not using standard library testing utilities.

**Principles:**

* **USE** `httptest.Server` for HTTP testing
* **USE** `iotest` for I/O testing
* **USE** `testing.TB` interface for shared helpers

```go
// ✅ CORRECT: HTTP testing
func TestHandler(t *testing.T) {
    server := httptest.NewServer(http.HandlerFunc(myHandler))
    defer server.Close()

    resp, err := http.Get(server.URL)
    // test response
}

// ✅ CORRECT: Helper function
func assertEqual(tb testing.TB, got, want any) {
    tb.Helper()  // Marks as helper
    if !reflect.DeepEqual(got, want) {
        tb.Errorf("got %v; want %v", got, want)
    }
}
```

---

### 10.7 Benchmark Best Practices

**Problem:** Writing inaccurate benchmarks.

**Principles:**

* **RESET** timer if doing setup: `b.ResetTimer()`
* **PREVENT** compiler optimizations with result assignment
* **USE** `b.N` for iteration count
* **RUN** with `-benchmem` for memory stats

```go
// ✅ CORRECT: Proper benchmark
func BenchmarkProcess(b *testing.B) {
    // Setup
    data := setupData()

    b.ResetTimer()  // Reset after setup

    var result int  // Prevent optimization
    for i := 0; i < b.N; i++ {
        result = process(data)
    }
    _ = result  // Prevent optimization
}

// Run:
// go test -bench=. -benchmem
```

---

## 11. Optimizations

### 11.1 CPU Caches

**Problem:** Not considering CPU cache effects.

**Principles:**

* **UNDERSTAND:** Cache lines are typically 64 bytes
* **PREFER** sequential memory access
* **USE** struct of arrays over array of structs for hot loops
* **ALIGN** frequently accessed fields together

```go
// ❌ WRONG: Array of structs (cache inefficient)
type Point struct {
    X, Y, Z float64
}
points := []Point{ /* ... */ }
for i := range points {
    points[i].X += 1  // Loads entire struct
}

// ✅ CORRECT: Struct of arrays (cache efficient)
type Points struct {
    X, Y, Z []float64
}
points := Points{
    X: make([]float64, n),
    Y: make([]float64, n),
    Z: make([]float64, n),
}
for i := range points.X {
    points.X[i] += 1  // Sequential access
}
```

---

### 11.2 False Sharing

**Problem:** Concurrent access to variables on same cache line.

**Principles:**

* **PAD** frequently modified concurrent variables
* **SEPARATE** hot variables to different cache lines
* **USE** padding or explicit spacing

```go
// ❌ WRONG: False sharing
type Counter struct {
    a int64  // Same cache line as b
    b int64  // False sharing!
}

// ✅ CORRECT: Padding to avoid false sharing
type Counter struct {
    a int64
    _ [56]byte  // Pad to separate cache lines
    b int64
}
```

---

### 11.3 Stack vs Heap

**Problem:** Not understanding escape analysis.

**Principles:**

* **UNDERSTAND:** Stack allocation is faster than heap
* **CHECK** escape analysis: `go build -gcflags='-m'`
* **AVOID** unnecessary heap allocations
* **RETURN** values when possible instead of pointers

```bash
# Check escape analysis
go build -gcflags='-m' .

# See detailed escape analysis
go build -gcflags='-m -m' .
```

---

### 11.4 Reducing Allocations

**Problem:** Unnecessary allocations hurt performance.

**Principles:**

* **REUSE** buffers with `sync.Pool`
* **PRE-ALLOCATE** slices and maps when size known
* **AVOID** string concatenation in loops (use `strings.Builder`)
* **PROFILE** to find allocation hotspots

```go
// ✅ CORRECT: sync.Pool for buffer reuse
var bufferPool = sync.Pool{
    New: func() any {
        return new(bytes.Buffer)
    },
}

func process() []byte {
    buf := bufferPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufferPool.Put(buf)
    }()

    // Use buf
    return buf.Bytes()
}
```

---

### 11.5 Inlining

**Problem:** Not understanding inlining benefits and limitations.

**Principles:**

* **UNDERSTAND:** Compiler inlines small functions automatically
* **CHECK:** `go build -gcflags='-m'` shows inlining decisions
* **AVOID** premature optimization
* **KEEP** functions small when performance critical

```bash
# Check inlining decisions
go build -gcflags='-m' . 2>&1 | grep inline
```

---

### 11.6 Profiling

**Problem:** Optimizing without measuring.

**Principles:**

* **PROFILE** before optimizing
* **USE** pprof for CPU and memory profiling
* **USE** execution tracer for concurrency analysis
* **BENCHMARK** before and after changes

```go
import _ "net/http/pprof"

func main() {
    go func() {
        http.ListenAndServe("localhost:6060", nil)
    }()
    // ...
}

// Access profiles:
// http://localhost:6060/debug/pprof/
```

```bash
# CPU profiling
go test -cpuprofile=cpu.prof -bench=.
go tool pprof cpu.prof

# Memory profiling
go test -memprofile=mem.prof -bench=.
go tool pprof mem.prof

# Execution trace
go test -trace=trace.out
go tool trace trace.out
```

---

### 11.7 Garbage Collector

**Problem:** Not understanding GC impact.

**Principles:**

* **UNDERSTAND:** GC tuning via `GOGC` environment variable
* **REDUCE** allocations to reduce GC pressure
* **MONITOR:** GC stats with `runtime.ReadMemStats`
* **AVOID** premature GC tuning

```go
// Monitor GC stats
var m runtime.MemStats
runtime.ReadMemStats(&m)
fmt.Printf("Alloc = %v MB", m.Alloc/1024/1024)
fmt.Printf("NumGC = %v\n", m.NumGC)
```

---

## Summary: Core Principles for AI Agents

When generating Go code, AI agents should prioritize:

### 1. Simplicity and Readability

* Align happy path to the left
* Return early for errors
* Avoid deep nesting (max 3-4 levels)
* Use descriptive names

### 2. Error Handling

* Always return errors, rarely panic
* Wrap errors with context (`%w`)
* Use `errors.Is()` and `errors.As()`
* Handle or propagate, never both

### 3. Concurrency Safety

* Always have clear goroutine exit conditions
* Use `-race` detector
* Choose channels for coordination, mutexes for state
* Understand context lifecycle

### 4. Memory Efficiency

* Pre-allocate slices and maps when size known
* Copy slices to avoid capacity leaks
* Be careful with slice pointers
* Understand map growth behavior

### 5. Type Safety

* Avoid `any` unless necessary
* Prefer concrete types over interfaces
* Place interfaces on consumer side
* Use generics for data structures, not methods

### 6. Testing

* Write table-driven tests
* Run with `-race` flag
* Avoid `time.Sleep`, use channels
* Separate unit and integration tests

### 7. Standard Library

* Configure HTTP client/server timeouts
* Close resources with defer
* Use proper SQL patterns
* Handle time durations explicitly

### 8. Performance

* Profile before optimizing
* Reduce allocations
* Consider CPU cache effects
* Understand escape analysis

---

## Document Metadata

**Source:** "100 Go Mistakes and How to Avoid Them" by Teiva Harsanyi (Manning Publications, 2022)

**Extraction Date:** 2025-11-13

**AI Agent Compliance:** Code generated following these principles should be:

* Free from common Go mistakes
* Production-ready
* Maintainable
* Performant
* Safe for concurrent use

**Validation:** AI-generated code should be validated with:

* `go vet`
* `go test -race`
* `golangci-lint`
* Code review

---

**END OF DOCUMENT**
