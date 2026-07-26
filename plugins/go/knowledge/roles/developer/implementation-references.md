# Implementation Reference Index - Developer Role

Quick access to production-quality Go code examples from industry-leading projects, curated for daily development work.

## About These References

All examples are extracted from real, production codebases:
- **Go Standard Library** (database/sql, context, testing)
- **Docker/Moby** (containerization platform)
- **Hugo** (static site generator)
- **CockroachDB** (distributed SQL database)
- **Terraform** (infrastructure as code)

Each reference file contains complete, working code with analysis and GitHub links to the original source.

---

## Core Implementation Patterns for Developers

### 1. Interface Design
**[📖 View Complete Reference](../../references/interface-design.md)**

Learn to write clean, composable interfaces that are fundamental to Go development.

**What you'll find:**
- Small, focused interfaces (database/sql/driver pattern)
- Request-response patterns (Terraform providers)
- Context interface pattern (minimal, essential methods)
- Backend abstraction patterns

**When to use:**
- Designing package APIs
- Defining service contracts
- Creating testable code
- Building plugin systems

**Key principle:** Keep interfaces small (1-5 methods), accept interfaces, return structs.

---

### 2. Constructor Patterns
**[📖 View Complete Reference](../../references/constructor-patterns.md)**

Master proper initialization patterns to prevent bugs and make code maintainable.

**What you'll find:**
- Functional options pattern (Docker client)
- Resource management in constructors (database/sql)
- Multi-stage initialization (Hugo)
- Plugin client constructors
- Buffer pool factories

**When to use:**
- Initializing services with optional configuration
- Managing background resources (connections, goroutines)
- Creating reusable object pools
- Building clients with multiple configuration options

**Key principle:** Use `NewX()` naming, start background goroutines in constructors, prefer functional options for extensibility.

---

### 3. Error Handling
**[📖 View Complete Reference](../../references/error-handling.md)**

Implement robust error handling patterns critical for production code.

**What you'll find:**
- Sentinel errors for testable conditions
- Retry with error classification
- Deferred error handling

**When to use:**
- Defining package-level errors
- Implementing retry logic
- Simplifying call sites
- Distinguishing error types

**Key principle:** Use sentinel errors for well-known conditions, wrap with context, retry only transient errors.

---

### 4. Context Usage
**[📖 View Complete Reference](../../references/context-usage.md)**

Enable cancellation, timeouts, and request-scoped values in your code.

**What you'll find:**
- Context-aware database operations (standard pattern)
- Lifecycle-tied contexts (CockroachDB)
- Signal-to-context bridges (Terraform)
- Context best practices (official Go patterns)

**When to use:**
- Any operation that can be cancelled
- Operations with timeouts
- Passing request-scoped data
- Graceful shutdown

**Key principle:** Context as first parameter named `ctx`, always defer cancel(), never store in structs.

---

### 5. Concurrency Patterns
**[📖 View Complete Reference](../../references/concurrency-patterns.md)**

Master Go's concurrency primitives with production-tested patterns.

**What you'll find:**
- Goroutine lifecycle management (CockroachDB Stopper)
- Exponential backoff with jittered retry
- Connection pool management (database/sql)

**When to use:**
- Managing goroutine lifecycles
- Implementing retry logic
- Building connection pools
- Coordinating concurrent work

**Key principle:** Track all goroutines, use exponential backoff with jitter, provide shutdown mechanisms.

---

### 6. Testing Patterns
**[📖 View Complete Reference](../../references/testing-patterns.md)**

Write tests that document behavior and prevent regressions.

**What you'll find:**
- Table-driven tests with subtests
- Test helpers with `t.Helper()`
- Time mocking for deterministic tests

**When to use:**
- Writing unit tests
- Testing multiple scenarios
- Creating reusable assertions
- Testing time-dependent code

**Key principle:** Use table-driven tests, mark helpers with `t.Helper()`, inject time sources for testability.

---

### 7. HTTP/API Patterns
**[📖 View Complete Reference](../../references/http-api-patterns.md)**

Build and consume HTTP APIs with composable patterns.

**What you'll find:**
- Functional options for HTTP clients (Docker)
- Composable client configuration

**When to use:**
- Building HTTP clients
- Configuring API clients
- Setting timeouts and retries
- Managing transport options

**Key principle:** Use functional options for client config, set sensible timeouts, use context for cancellation.

---

### 8. Performance Optimization
**[📖 View Complete Reference](../../references/performance-optimization.md)**

Optimize hot paths and reduce allocations.

**What you'll find:**
- Object pooling with `sync.Pool` (Docker)
- UTC time optimization (CockroachDB)
- Buffer reuse patterns

**When to use:**
- High-throughput code paths
- Reducing GC pressure
- Optimizing hot paths
- Working with time-sensitive code

**Key principle:** Profile before optimizing, use `sync.Pool` for frequent allocations, reset pooled objects.

---

## Additional Implementation Patterns

These patterns are important but less frequently used in daily development:

### Package Organization
**[📖 View Complete Reference](../../references/package-organization.md)**

Learn how to structure codebases from production projects (Hugo, Docker, CockroachDB).

### Configuration Management
**[📖 View Complete Reference](../../references/configuration-management.md)**

Multi-source configuration, environment overrides, and validation patterns (Hugo, Terraform).

### CLI Architecture
**[📖 View Complete Reference](../../references/cli-architecture.md)**

Meta command patterns and interruptible operations (Terraform).

### Plugin Systems
**[📖 View Complete Reference](../../references/plugin-systems.md)**

gRPC and HTTP-based plugin architectures (Terraform, Docker).

---

## Learning Path

### For New Go Developers
1. Start with **[Interface Design](../../references/interface-design.md)** and **[Constructor Patterns](../../references/constructor-patterns.md)**
2. Master **[Error Handling](../../references/error-handling.md)** and **[Context Usage](../../references/context-usage.md)**
3. Study **[Testing Patterns](../../references/testing-patterns.md)** thoroughly
4. Then move to **[Concurrency Patterns](../../references/concurrency-patterns.md)**

### For Experienced Developers
1. Focus on **[Concurrency Patterns](../../references/concurrency-patterns.md)** for production-ready code
2. Study **[Performance Optimization](../../references/performance-optimization.md)** for high-scale systems
3. Review **[HTTP/API Patterns](../../references/http-api-patterns.md)** for service development

---

## Complete Reference Collection

**[📚 Browse All References](../../references/README.md)** - Master index of all 12 implementation pattern references with 40+ real code examples.

---

## Additional Resources

- **[Best Practices](./best-practices.md)** - Developer role-specific guidelines and principles
- **[Go Proverbs](../../go-proverbs.md)** - Simple, poetic truths about Go
- **[Uber Go Style Guide](../../uber-go-style-guide.md)** - Industry-standard style guide
- **[100 Go Mistakes](../../100-go-mistakes.md)** - Common pitfalls to avoid
- **[Modern Backend Development](../../modern-backend-development.md)** - Contemporary practices

---

**Last Updated:** 2025-11-14
**Role:** Developer
**Focus:** Practical implementation patterns for daily development work
