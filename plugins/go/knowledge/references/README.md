# Go Reference Examples - Atomic Reference Guide

This directory contains focused, atomic reference files extracted from production Go codebases. Each file covers a specific aspect of Go development with real-world examples.

## Reference Files

### [Interface Design](./interface-design.md)
**Focus:** Small, focused interfaces and composition patterns

Learn how to design minimal, composable interfaces from production systems. Covers:
- Single-responsibility interfaces (database/sql/driver)
- Request-response patterns (Terraform providers)
- The Context interface pattern
- Backend abstraction patterns

**When to use:** Designing new interfaces or refactoring existing ones

---

### [Constructor Patterns](./constructor-patterns.md)
**Focus:** Object initialization and configuration

Explore Go's factory function patterns and initialization strategies. Covers:
- Functional options pattern (Docker client)
- Resource management in constructors (database/sql)
- Multi-stage initialization for circular dependencies (Hugo)
- Plugin client constructors with transport abstraction
- Object pool factories

**When to use:** Creating complex objects with optional configuration or managing resource lifecycles

---

### [Error Handling](./error-handling.md)
**Focus:** Error creation, classification, and handling

Master Go's explicit error handling patterns. Covers:
- Sentinel errors for common conditions
- Retry logic with error classification
- Deferred error handling
- Error wrapping with context

**When to use:** Designing error handling strategies for APIs or implementing retry logic

---

### [Context Usage](./context-usage.md)
**Focus:** Cancellation, timeouts, and request-scoped values

Learn how to use Go's context package effectively. Covers:
- Context-aware database operations
- Lifecycle-tied contexts (CockroachDB Stopper)
- Signal-to-context bridges (Terraform)
- Context best practices from the standard library

**When to use:** Implementing cancellable operations or managing component lifecycles

---

### [Package Organization](./package-organization.md)
**Focus:** Code structure and package boundaries

Understand how to organize Go codebases at scale. Covers:
- Domain-driven organization (Hugo)
- Layered architecture (Docker/Moby)
- Focused utility packages (CockroachDB)
- Public vs. private package boundaries

**When to use:** Structuring new projects or refactoring package boundaries

---

### [CLI Architecture](./cli-architecture.md)
**Focus:** Command-line interface patterns

Build robust CLI applications with consistent behavior. Covers:
- Meta command pattern for shared functionality (Terraform)
- Graceful shutdown handling
- Composable flag sets
- Interruptible long-running operations

**When to use:** Building CLI tools or adding commands to existing CLIs

---

### [Plugin Systems](./plugin-systems.md)
**Focus:** Extensibility through plugins

Design plugin architectures with process isolation. Covers:
- gRPC-based plugins with schema caching (Terraform)
- HTTP-over-Unix-socket plugins (Docker)
- Multiple communication patterns (RPC, streaming, file transfer)

**When to use:** Adding plugin support or designing extensible systems

---

### [Concurrency Patterns](./concurrency-patterns.md)
**Focus:** Goroutines, channels, and synchronization

Master Go's concurrency primitives safely. Covers:
- Structured concurrency with graceful shutdown (CockroachDB Stopper)
- Exponential backoff with jittered retry
- Connection pool management with channels
- Context cancellation propagation

**When to use:** Managing goroutine lifecycles or implementing retry logic

---

### [Configuration Management](./configuration-management.md)
**Focus:** Multi-source configuration and validation

Handle complex configuration from multiple sources. Covers:
- Layered configuration (defaults → files → env vars → flags)
- Environment variable override patterns
- Hierarchical configuration for modular systems
- Version constraint validation

**When to use:** Implementing application configuration or validating dependencies

---

### [Testing Patterns](./testing-patterns.md)
**Focus:** Test organization and reliability

Write maintainable, fast, and deterministic tests. Covers:
- Table-driven tests with subtests
- Test helpers with proper error reporting
- Time injection for deterministic tests
- Parallel test execution

**When to use:** Writing tests or improving test suite organization

---

### [HTTP/API Patterns](./http-api-patterns.md)
**Focus:** HTTP clients and API design

Build robust HTTP clients with flexible configuration. Covers:
- Functional options for HTTP clients (Docker)
- Context-aware requests
- Connection pooling and timeouts
- Composable client configuration

**When to use:** Building HTTP clients or designing REST APIs

---

### [Performance Optimization](./performance-optimization.md)
**Focus:** Reducing allocations and improving throughput

Optimize Go code with proven techniques. Covers:
- Object pooling with sync.Pool (Docker)
- Buffer reuse patterns
- UTC time optimization preserving monotonic clock
- Zero-allocation I/O

**When to use:** Optimizing hot paths or reducing GC pressure

---

## Source Projects

All examples are extracted from production-quality open-source projects:

- **Go Standard Library**: https://github.com/golang/go
- **Docker/Moby**: https://github.com/moby/moby
- **Hugo**: https://github.com/gohugoio/hugo
- **CockroachDB**: https://github.com/cockroachdb/cockroach
- **Terraform**: https://github.com/hashicorp/terraform

## How to Use This Guide

1. **Browse by topic** - Each file is self-contained and focuses on a specific pattern
2. **Search for patterns** - Use your editor's search to find specific examples
3. **Copy and adapt** - All examples are production-tested and can be adapted to your needs
4. **Cross-reference** - Many patterns work together (e.g., context + concurrency)

## Additional Resources

- **Effective Go**: https://golang.org/doc/effective_go
- **Go Code Review Comments**: https://github.com/golang/go/wiki/CodeReviewComments
- **Go Standard Library**: https://pkg.go.dev/std

---

**Generated:** 2025-11-14
**Total Examples:** 40+ real code examples from production systems
**Maintained by:** Claude Code Plugin Project
