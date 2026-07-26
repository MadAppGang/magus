# Interface Design

## Introduction

Small, focused interfaces are a cornerstone of idiomatic Go design. This document showcases production-quality interface patterns from real codebases, demonstrating how to design minimal, composable interfaces that are easy to implement and test.

---

## Example 1: Small, Focused Interfaces (database/sql/driver)

**Project:** Go Standard Library
**File:** `src/database/sql/driver/driver.go`
**Link:** https://github.com/golang/go/blob/master/src/database/sql/driver/driver.go

**Pattern:** Single-responsibility interfaces that compose into larger behaviors.

```go
// Core database driver interfaces - each with a single responsibility

type Driver interface {
    Open(name string) (Conn, error)
}

type Connector interface {
    Connect(context.Context) (Conn, error)
    Driver() Driver
}

type Conn interface {
    Prepare(query string) (Stmt, error)
    Close() error
    Begin() (Tx, error)
}

type Stmt interface {
    Close() error
    NumInput() int
    Exec(args []Value) (Result, error)
    Query(args []Value) (Rows, error)
}

type Rows interface {
    Columns() []string
    Close() error
    Next(dest []Value) error
}

type Result interface {
    LastInsertId() (int64, error)
    RowsAffected() (int64, error)
}

type Tx interface {
    Commit() error
    Rollback() error
}
```

**Why this is excellent:**
- Each interface has a single, clear purpose
- Easy to implement incrementally
- Supports optional enhancement through additional interfaces
- Minimal coupling between components
- Testable in isolation

---

## Example 2: Provider Interface Pattern (Terraform)

**Project:** Terraform
**File:** `internal/providers/provider.go`
**Link:** https://github.com/hashicorp/terraform/blob/main/internal/providers/provider.go

**Pattern:** Request-response interface for plugin communication.

```go
type Interface interface {
    // Schema operations
    GetProviderSchema() GetProviderSchemaResponse
    GetResourceIdentitySchemas() GetResourceIdentitySchemasResponse

    // Configuration validation
    ValidateProviderConfig(ValidateProviderConfigRequest) ValidateProviderConfigResponse
    ValidateResourceConfig(ValidateResourceConfigRequest) ValidateResourceConfigResponse
    ValidateDataResourceConfig(ValidateDataResourceConfigRequest) ValidateDataResourceConfigResponse

    // Provider lifecycle
    ConfigureProvider(ConfigureProviderRequest) ConfigureProviderResponse
    Stop() error
    Close() error

    // Resource operations
    ReadResource(ReadResourceRequest) ReadResourceResponse
    ReadDataSource(ReadDataSourceRequest) ReadDataSourceResponse
    PlanResourceChange(PlanResourceChangeRequest) PlanResourceChangeResponse
    ApplyResourceChange(ApplyResourceChangeRequest) ApplyResourceChangeResponse

    // State management
    ImportResourceState(ImportResourceStateRequest) ImportResourceStateResponse
    MoveResourceState(MoveResourceStateRequest) MoveResourceStateResponse
}
```

**Why this is excellent:**
- Request-response symmetry provides clarity
- Each operation is self-contained
- Strongly typed for compile-time safety
- Includes diagnostics in every response
- Supports capability negotiation

---

## Example 3: Context Interface (Go Standard Library)

**Project:** Go Standard Library
**File:** `src/context/context.go`
**Link:** https://github.com/golang/go/blob/master/src/context/context.go

**Pattern:** Minimal interface for cancellation and deadline propagation.

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

**Why this is excellent:**
- Only 4 methods, all essential
- Composition-friendly (contexts derive from contexts)
- Clear separation of concerns (deadline, cancellation, values)
- Channel-based Done() enables select statements
- Widely composable across the ecosystem

---

## Example 4: Backend Interface (Terraform)

**Project:** Terraform
**File:** `internal/backend/backend.go`
**Link:** https://github.com/hashicorp/terraform/blob/main/internal/backend/backend.go

**Pattern:** Plugin-style backend abstraction for state storage.

```go
type Backend interface {
    ConfigSchema() *configschema.Block
    PrepareConfig(cty.Value) (cty.Value, tfdiags.Diagnostics)
    Configure(cty.Value) tfdiags.Diagnostics
    StateMgr(workspace string) (statemgr.Full, tfdiags.Diagnostics)
    DeleteWorkspace(name string, force bool) tfdiags.Diagnostics
    Workspaces() ([]string, tfdiags.Diagnostics)
}
```

**Why this is excellent:**
- Clean lifecycle (schema → prepare → configure)
- Workspace abstraction enables multi-environment support
- Diagnostic return type provides rich error context
- Decouples state storage from application logic

---

## When to Use

- **Small interfaces (1-5 methods)** - Keep interfaces focused on a single responsibility
- **Optional interfaces** - Use type assertions to enable optional capabilities
- **Request-response pattern** - For plugin systems and RPC-style communication
- **Composition** - Build complex behaviors from simple interface combinations
- **Context interface** - For cancellation, timeouts, and request-scoped values

**Source Projects:**
- Go Standard Library: https://github.com/golang/go
- Terraform: https://github.com/hashicorp/terraform
