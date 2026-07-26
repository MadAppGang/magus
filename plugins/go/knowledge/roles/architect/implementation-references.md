# Implementation Reference Index - Architect Role

Production-quality Go architectural patterns from industry-leading projects, curated for system design and architectural decision-making.

## About These References

All examples are extracted from real, production codebases:
- **Go Standard Library** (database/sql, context, testing)
- **Docker/Moby** (containerization platform)
- **Hugo** (static site generator)
- **CockroachDB** (distributed SQL database)
- **Terraform** (infrastructure as code)

Each reference file contains complete, working code with architectural analysis and GitHub links to original sources.

---

## Architectural Design Patterns

### 1. Package Organization
**[📖 View Complete Reference](../../references/package-organization.md)**

Master codebase organization strategies from production systems.

**What you'll find:**
- Domain-driven organization (Hugo)
- Layered architecture with clear boundaries (Docker/Moby)
- Focused utility packages (CockroachDB)

**When to use:**
- Designing new projects
- Restructuring existing codebases
- Defining module boundaries
- Organizing large teams

**Architectural decisions:**
- Domain-driven vs. layered vs. utility-based organization
- Public (`pkg/`) vs. private (`internal/`) boundaries
- Monorepo vs. multi-repo structure

---

### 2. Interface Design
**[📖 View Complete Reference](../../references/interface-design.md)**

Design clean, composable interfaces that define system contracts.

**What you'll find:**
- Small, focused interfaces (database/sql/driver)
- Request-response patterns (Terraform providers)
- Context interface pattern
- Backend abstraction patterns

**When to use:**
- Defining service boundaries
- Creating plugin architectures
- Designing testable systems
- Establishing API contracts

**Architectural principles:**
- Interface segregation (single responsibility)
- Dependency inversion (depend on abstractions)
- Composition over inheritance
- Accept interfaces, return structs

---

### 3. Plugin Systems
**[📖 View Complete Reference](../../references/plugin-systems.md)**

Build extensible systems with gRPC and HTTP-based plugin architectures.

**What you'll find:**
- gRPC plugin architecture with process isolation (Terraform)
- HTTP-over-Unix-socket plugins (Docker)
- Schema caching and optimization
- Bidirectional client/server patterns

**When to use:**
- Building extensible platforms
- Third-party integrations
- Process isolation requirements
- Multi-language plugin support

**Architectural trade-offs:**
- gRPC (performance, type safety) vs. HTTP (simplicity, compatibility)
- In-process vs. out-of-process plugins
- Schema versioning strategies
- Performance vs. isolation

---

### 4. Configuration Management
**[📖 View Complete Reference](../../references/configuration-management.md)**

Implement robust configuration systems with multiple sources and validation.

**What you'll find:**
- Multi-source layered configuration (Hugo)
- Environment variable overrides
- Dependency validation (Terraform)
- Hierarchical configuration trees

**When to use:**
- Multi-environment deployments
- Cloud-native applications
- Configuration inheritance
- Complex dependency management

**Architectural considerations:**
- Configuration precedence (defaults → files → env → flags)
- Validation strategies (fail-fast vs. warn)
- Hot-reload vs. restart requirements
- Secret management integration

---

### 5. Concurrency Patterns
**[📖 View Complete Reference](../../references/concurrency-patterns.md)**

Design concurrent systems with structured lifecycle management.

**What you'll find:**
- Goroutine lifecycle management (CockroachDB Stopper)
- Exponential backoff with jittered retry
- Connection pool management (database/sql)

**When to use:**
- Graceful shutdown requirements
- High-availability systems
- Resource pooling
- Retry and circuit breaker patterns

**Architectural patterns:**
- Structured concurrency (track all goroutines)
- Graceful degradation
- Bulkhead pattern (resource isolation)
- Observer pattern (lifecycle hooks)

---

### 6. CLI Architecture
**[📖 View Complete Reference](../../references/cli-architecture.md)**

Build sophisticated CLI tools with shared functionality and graceful interruption.

**What you'll find:**
- Meta command pattern (Terraform)
- Interruptible long-running operations
- Composable flag sets
- Signal-to-context bridges

**When to use:**
- Building CLI applications
- Long-running operations
- Graceful Ctrl-C handling
- Shared command infrastructure

**Architectural patterns:**
- Meta struct for shared functionality
- Command composition
- Context-based cancellation
- UI abstraction layers

---

### 7. Constructor Patterns
**[📖 View Complete Reference](../../references/constructor-patterns.md)**

Design flexible initialization with functional options and resource management.

**What you'll find:**
- Functional options pattern (Docker)
- Multi-stage initialization (Hugo)
- Resource management in constructors
- Buffer pool factories

**When to use:**
- Complex initialization requirements
- Backward-compatible APIs
- Resource lifecycle management
- Object pooling

**Design decisions:**
- Functional options vs. config structs
- Constructor vs. factory methods
- Eager vs. lazy initialization
- Singleton vs. factory patterns

---

### 8. Context Usage
**[📖 View Complete Reference](../../references/context-usage.md)**

Implement cancellation, timeouts, and request-scoped data propagation.

**What you'll find:**
- Context-aware operations (database/sql)
- Lifecycle-tied contexts (CockroachDB)
- Signal-to-context bridges (Terraform)
- Context best practices

**When to use:**
- Request tracing
- Timeout enforcement
- Graceful shutdown
- Passing request-scoped values

**Architectural guidelines:**
- Context propagation strategies
- Cancellation cascading
- Timeout budgets
- Value vs. metadata storage

---

## System-Level Patterns

### Error Handling
**[📖 View Complete Reference](../../references/error-handling.md)**

Design error handling strategies for distributed systems.

**Focus for architects:**
- Sentinel errors for API contracts
- Retry policies with backoff
- Error classification and recovery
- Deferred error handling

---

### Performance Optimization
**[📖 View Complete Reference](../../references/performance-optimization.md)**

Make informed architectural decisions about performance.

**Focus for architects:**
- Object pooling strategies
- Memory allocation patterns
- Time optimization techniques
- Benchmarking methodologies

---

### Testing Patterns
**[📖 View Complete Reference](../../references/testing-patterns.md)**

Design testable systems from the ground up.

**Focus for architects:**
- Test infrastructure design
- Dependency injection for testability
- Time abstraction for deterministic tests
- Test helper patterns

---

### HTTP/API Patterns
**[📖 View Complete Reference](../../references/http-api-patterns.md)**

Design API clients with composable configuration.

**Focus for architects:**
- Client configuration strategies
- Transport abstraction
- Timeout and retry policies
- Connection pooling

---

## Architectural Decision Framework

### When Designing New Systems

1. **Start with:** [Package Organization](../../references/package-organization.md) and [Interface Design](../../references/interface-design.md)
2. **Define boundaries:** [Plugin Systems](../../references/plugin-systems.md) if extensibility is required
3. **Plan lifecycle:** [Concurrency Patterns](../../references/concurrency-patterns.md) and [Context Usage](../../references/context-usage.md)
4. **Configure system:** [Configuration Management](../../references/configuration-management.md)
5. **Ensure quality:** [Testing Patterns](../../references/testing-patterns.md)

### When Evaluating Trade-Offs

- **Simplicity vs. Flexibility:** Review [Constructor Patterns](../../references/constructor-patterns.md) and [Interface Design](../../references/interface-design.md)
- **Performance vs. Maintainability:** Study [Performance Optimization](../../references/performance-optimization.md)
- **Monolith vs. Plugins:** Analyze [Plugin Systems](../../references/plugin-systems.md)
- **Coupling vs. Cohesion:** Examine [Package Organization](../../references/package-organization.md)

---

## Complete Reference Collection

**[📚 Browse All References](../../references/README.md)** - Master index of all 12 implementation pattern references with 40+ real code examples.

---

## Additional Resources

- **[Best Practices](./best-practices.md)** - Architect role-specific guidelines and principles
- **[Go Proverbs](../../go-proverbs.md)** - Simple, poetic truths about Go
- **[Uber Go Style Guide](../../uber-go-style-guide.md)** - Industry-standard style guide
- **[Modern Backend Development](../../modern-backend-development.md)** - Contemporary architectural practices

---

**Last Updated:** 2025-11-14
**Role:** Architect
**Focus:** System design, architectural patterns, and strategic technical decisions
