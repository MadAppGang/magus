# Package Organization

## Introduction

How you organize your Go packages significantly impacts code maintainability and team productivity. This document showcases proven package organization strategies from production codebases.

---

## Example 1: Domain-Driven Organization (Hugo)

**Project:** Hugo
**File:** Repository structure
**Link:** https://github.com/gohugoio/hugo

**Pattern:** Organize by domain/feature rather than technical layer.

```
hugo/
├── commands/       # CLI command implementations
├── config/         # Configuration management
├── hugolib/        # Core site generation
├── markup/         # Content parsing (Markdown, Org, etc.)
├── resources/      # Asset pipeline
├── output/         # Output format handling
├── tpl/            # Template system
├── modules/        # Hugo Modules
├── compare/        # Comparison utilities
├── identity/       # Identity/hashing
├── hugofs/         # Filesystem abstractions
└── helpers/        # Shared utilities
```

**Why this is excellent:**
- Clear domain boundaries
- Easy to find related code
- Reduces coupling between domains
- Supports parallel development

---

## Example 2: Layered Architecture (Docker/Moby)

**Project:** Docker/Moby
**File:** Repository structure
**Link:** https://github.com/moby/moby

**Pattern:** Separate public API, internal implementation, and reusable packages.

```
moby/
├── api/            # Public API definitions
│   └── types/      # Shared types
├── client/         # Client library
├── daemon/         # Daemon implementation
├── pkg/            # Reusable packages
│   ├── plugins/
│   ├── pools/
│   └── jsonmessage/
├── internal/       # Private implementation
└── cmd/            # Executable entry points
```

**Why this is excellent:**
- Clear public vs. private boundaries
- Reusable packages in pkg/
- API contracts separated from implementation
- Internal package prevents external imports

---

## Example 3: Utility Package Organization (CockroachDB)

**Project:** CockroachDB
**File:** `pkg/util/` structure
**Link:** https://github.com/cockroachdb/cockroach

**Pattern:** Focused utility packages with single responsibility.

```
pkg/util/
├── stop/           # Goroutine lifecycle management
├── timeutil/       # Time utilities and mocking
├── retry/          # Retry logic with backoff
├── syncutil/       # Synchronization utilities
└── ...
```

**Why this is excellent:**
- Each util package has clear purpose
- Testable in isolation
- Avoids "utils" dump package
- Clear naming indicates functionality

---

## When to Use

- **Domain-driven organization** - When your application has distinct business domains
- **Layered architecture** - For clear separation of API, implementation, and utilities
- **pkg/ directory** - For reusable packages that could be extracted to separate repos
- **internal/ directory** - For private implementation details that shouldn't be imported
- **Focused utility packages** - Instead of a single "utils" package, create focused packages like `retry/`, `timeutil/`, etc.

**Source Projects:**
- Hugo: https://github.com/gohugoio/hugo
- Docker/Moby: https://github.com/moby/moby
- CockroachDB: https://github.com/cockroachdb/cockroach
