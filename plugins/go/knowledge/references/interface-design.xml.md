# Interface Design - Production Patterns

<knowledge type="implementation_patterns" category="Interface Design">
  <overview>
    Small, focused interfaces are a cornerstone of idiomatic Go design. This document showcases production-quality interface patterns from real codebases, demonstrating how to design minimal, composable interfaces that are easy to implement and test.
  </overview>

  <source_projects>
    <project name="Go Standard Library" url="https://github.com/golang/go">
      database/sql, context packages
    </project>
    <project name="Terraform" url="https://github.com/hashicorp/terraform">
      Provider and backend abstractions
    </project>
  </source_projects>

  <patterns>
    <pattern name="Small, Focused Interfaces" difficulty="beginner" priority="critical">
      <source>
        <project>Go Standard Library</project>
        <file>src/database/sql/driver/driver.go</file>
        <link>https://github.com/golang/go/blob/master/src/database/sql/driver/driver.go</link>
      </source>

      <description>
        Single-responsibility interfaces that compose into larger behaviors.
        The database/sql/driver package demonstrates perfect interface segregation
        where each interface has a single, clear purpose.
      </description>

      <code language="go">
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
      </code>

      <analysis>
        <strengths>
          - Each interface has a single, clear purpose
          - Easy to implement incrementally
          - Supports optional enhancement through additional interfaces
          - Minimal coupling between components
          - Testable in isolation
        </strengths>

        <design_decisions>
          - Driver and Connector are separate (different initialization strategies)
          - Conn, Stmt, Rows follow natural lifecycle (prepare, execute, iterate)
          - Result and Tx are minimal (2 methods each)
          - Each interface can be mocked independently for testing
        </design_decisions>

        <when_to_use>
          - Designing package APIs that others will implement
          - Creating database drivers or similar abstraction layers
          - Building testable systems (small interfaces are easy to mock)
          - Supporting incremental implementation (implement Driver, then add Connector)
        </when_to_use>

        <best_practices>
          - Keep interfaces small (1-5 methods)
          - Each interface should have a single responsibility
          - Use interface composition rather than large interfaces
          - Define interfaces where used, not where implemented
          - Accept interfaces, return structs
        </best_practices>
      </analysis>
    </pattern>

    <pattern name="Request-Response Interface" difficulty="intermediate" priority="high">
      <source>
        <project>Terraform</project>
        <file>internal/providers/provider.go</file>
        <link>https://github.com/hashicorp/terraform/blob/main/internal/providers/provider.go</link>
      </source>

      <description>
        Request-response interface pattern for plugin communication.
        Terraform's provider interface demonstrates how to design clean,
        strongly-typed RPC-style interfaces with comprehensive diagnostics.
      </description>

      <code language="go">
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
      </code>

      <analysis>
        <strengths>
          - Request-response symmetry provides clarity
          - Each operation is self-contained
          - Strongly typed for compile-time safety
          - Includes diagnostics in every response
          - Supports capability negotiation
          - Methods grouped by concern (schema, validation, lifecycle, operations)
        </strengths>

        <design_decisions>
          - Request/Response types instead of multiple parameters
          - Response types include diagnostics (errors and warnings)
          - Lifecycle methods (Stop, Close) return simple errors
          - Schema operations return responses (not errors)
          - All resource operations follow same pattern
        </design_decisions>

        <when_to_use>
          - Building plugin systems (gRPC, HTTP-RPC)
          - Designing extensible platforms
          - Creating testable service boundaries
          - Implementing third-party integrations
          - Any RPC-style communication
        </when_to_use>

        <best_practices>
          - Use request/response structs (not multiple parameters)
          - Include diagnostics/errors in response types
          - Group related methods together
          - Keep method signatures consistent within groups
          - Version your request/response types explicitly
        </best_practices>
      </analysis>
    </pattern>

    <pattern name="Context Interface" difficulty="beginner" priority="critical">
      <source>
        <project>Go Standard Library</project>
        <file>src/context/context.go</file>
        <link>https://github.com/golang/go/blob/master/src/context/context.go</link>
      </source>

      <description>
        Minimal interface for cancellation and deadline propagation.
        The context.Context interface is the canonical example of a small,
        essential interface that enables powerful patterns across the entire ecosystem.
      </description>

      <code language="go">
```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```
      </code>

      <analysis>
        <strengths>
          - Only 4 methods, all essential
          - Composition-friendly (contexts derive from contexts)
          - Clear separation of concerns (deadline, cancellation, values)
          - Channel-based Done() enables select statements
          - Widely composable across the ecosystem
          - Immutable and thread-safe by design
        </strengths>

        <design_decisions>
          - Deadline returns (time, bool) not error (optional deadline)
          - Done() returns receive-only channel (prevents misuse)
          - Err() explains why Done was closed
          - Value() uses any (predates generics)
          - No Cancel() method (contexts are immutable)
        </design_decisions>

        <when_to_use>
          - Any operation that can be cancelled
          - Operations with timeouts or deadlines
          - Passing request-scoped values
          - Coordinating goroutines
          - HTTP handlers and RPC methods
        </when_to_use>

        <best_practices>
          - Context as first parameter, named ctx
          - Never store Context in a struct
          - Pass context explicitly through call chain
          - Use context.Background() for top-level
          - Use context.TODO() when uncertain
          - Always defer cancel() functions
        </best_practices>
      </analysis>
    </pattern>

    <pattern name="Backend Abstraction Interface" difficulty="intermediate" priority="medium">
      <source>
        <project>Terraform</project>
        <file>internal/backend/backend.go</file>
        <link>https://github.com/hashicorp/terraform/blob/main/internal/backend/backend.go</link>
      </source>

      <description>
        Plugin-style backend abstraction for state storage.
        Demonstrates how to design clean lifecycle interfaces with
        diagnostic-rich error handling.
      </description>

      <code language="go">
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
      </code>

      <analysis>
        <strengths>
          - Clean lifecycle (schema → prepare → configure)
          - Workspace abstraction enables multi-environment support
          - Diagnostic return type provides rich error context
          - Decouples state storage from application logic
          - Schema-first design enables validation
        </strengths>

        <design_decisions>
          - ConfigSchema() is query method (no error)
          - PrepareConfig() normalizes/validates config
          - Configure() applies configuration
          - StateMgr() returns interface (abstraction)
          - Diagnostics instead of errors (warnings + errors)
        </design_decisions>

        <when_to_use>
          - Building pluggable storage backends
          - Implementing multi-environment systems
          - Creating schema-validated configuration systems
          - Designing lifecycle-aware abstractions
        </when_to_use>

        <best_practices>
          - Define schema first (enables validation)
          - Separate prepare from configure (validation vs application)
          - Return interfaces, not concrete types (StateMgr)
          - Use rich diagnostic types when simple errors insufficient
          - Design for multi-tenancy (workspaces)
        </best_practices>
      </analysis>
    </pattern>
  </patterns>

  <anti_patterns>
    <anti_pattern name="Large Interfaces" severity="high">
      <description>
        Interfaces with more than 7 methods typically violate single responsibility
        principle and become difficult to implement and test.
      </description>

      <example_bad>
```go
// ❌ BAD - Interface doing too much
type UserService interface {
    // User CRUD
    CreateUser(User) error
    GetUser(ID) (User, error)
    UpdateUser(User) error
    DeleteUser(ID) error

    // Authentication
    Login(credentials) (Token, error)
    Logout(Token) error
    RefreshToken(Token) (Token, error)

    // Authorization
    CheckPermission(User, Resource) bool
    GrantPermission(User, Permission) error
    RevokePermission(User, Permission) error

    // Notifications
    SendEmail(User, Message) error
    SendSMS(User, Message) error
}
```
      </example_bad>

      <instead_use>
        Split into focused interfaces:
        - UserRepository (CRUD)
        - AuthenticationService (login, tokens)
        - AuthorizationService (permissions)
        - NotificationService (communications)
      </instead_use>

      <why_bad>
        - Hard to implement (must implement all 13 methods)
        - Hard to test (mock needs all methods)
        - Hard to maintain (changes affect many implementers)
        - Violates Interface Segregation Principle
        - Forces unnecessary dependencies
      </why_bad>
    </anti_pattern>

    <anti_pattern name="Interface with 'I' Prefix" severity="medium">
      <description>
        Using "I" prefix (IUserService, IRepository) is not idiomatic in Go.
        Go interfaces should be named after their behavior, not prefixed.
      </description>

      <example_bad>
```go
// ❌ BAD - Not idiomatic Go
type IUserRepository interface {
    Save(User) error
}

type IEmailSender interface {
    Send(Email) error
}
```
      </example_bad>

      <example_good>
```go
// ✅ GOOD - Idiomatic Go naming
type UserRepository interface {
    Save(User) error
}

type EmailSender interface {
    Send(Email) error
}

// Or describe the behavior:
type UserStorer interface {
    Store(User) error
}

type Mailer interface {
    Mail(Email) error
}
```
      </example_good>

      <why_bad>
        - Not idiomatic (Go community convention)
        - Unnecessary prefix (type system makes it clear)
        - Hurts readability
      </why_bad>
    </anti_pattern>

    <anti_pattern name="Defining Interfaces in Implementation Package" severity="medium">
      <description>
        Interfaces should be defined where they are used, not where they are implemented.
        This enables consumer-driven interface design.
      </description>

      <example_bad>
```go
// ❌ BAD - Interface in implementation package
package postgres

type UserRepository interface {
    Get(ID) (User, error)
    Save(User) error
}

type PostgresUserRepository struct {}

func (r *PostgresUserRepository) Get(ID) (User, error) { /*...*/ }
func (r *PostgresUserRepository) Save(User) error { /*...*/ }
```
      </example_bad>

      <example_good>
```go
// ✅ GOOD - Interface in consumer package
package service

// Define interface where you use it
type UserRepository interface {
    Get(ID) (User, error)
    Save(User) error
}

type UserService struct {
    repo UserRepository  // Depends on interface
}

// Implementation in separate package
package postgres

import "myapp/service"

type PostgresUserRepository struct {}

// Implements service.UserRepository implicitly
func (r *PostgresUserRepository) Get(ID) (User, error) { /*...*/ }
func (r *PostgresUserRepository) Save(User) error { /*...*/ }
```
      </example_good>

      <why_bad>
        - Couples interface to implementation
        - Makes testing harder (import concrete package)
        - Prevents consumer-driven design
        - Increases coupling between packages
      </why_bad>

      <instead_use>
        - Define interfaces in the package that uses them
        - Keep interfaces minimal (only methods you need)
        - Let implementations live in separate packages
        - Accept interfaces, return structs
      </instead_use>
    </anti_pattern>
  </anti_patterns>

  <summary>
    <key_principles>
      <principle priority="critical">Keep interfaces small (1-5 methods preferred)</principle>
      <principle priority="high">Each interface should have single responsibility</principle>
      <principle priority="high">Define interfaces where used, not where implemented</principle>
      <principle priority="medium">Accept interfaces, return structs</principle>
      <principle priority="medium">Use composition over large interfaces</principle>
    </key_principles>

    <when_to_use>
      <use_case>
        <scenario>Package API design</scenario>
        <pattern>Small, Focused Interfaces</pattern>
        <reference>database/sql/driver pattern</reference>
      </use_case>

      <use_case>
        <scenario>Plugin systems and RPC</scenario>
        <pattern>Request-Response Interface</pattern>
        <reference>Terraform provider pattern</reference>
      </use_case>

      <use_case>
        <scenario>Cancellation and timeouts</scenario>
        <pattern>Context Interface</pattern>
        <reference>Go standard context package</reference>
      </use_case>

      <use_case>
        <scenario>Pluggable backends</scenario>
        <pattern>Backend Abstraction Interface</pattern>
        <reference>Terraform backend pattern</reference>
      </use_case>
    </when_to_use>

    <learning_path>
      <step level="beginner">
        Study the Context interface - understand why each of the 4 methods is essential
      </step>
      <step level="beginner">
        Review database/sql/driver - see how small interfaces compose into full functionality
      </step>
      <step level="intermediate">
        Analyze Terraform provider interface - learn request-response patterns
      </step>
      <step level="intermediate">
        Study Terraform backend interface - understand lifecycle-aware design
      </step>
      <step level="advanced">
        Design your own interface hierarchies using composition of small interfaces
      </step>
    </learning_path>

    <quick_reference>
      <rule>Interface size: 1-5 methods (ideal), max 7 methods</rule>
      <rule>Naming: Describe behavior (Reader, Writer), not implementation (FileReader)</rule>
      <rule>Location: Define where used, implement elsewhere</rule>
      <rule>Parameters: Use request/response structs for plugin interfaces</rule>
      <rule>Returns: Accept interfaces, return structs</rule>
      <rule>No "I" prefix (not idiomatic in Go)</rule>
    </quick_reference>
  </summary>
</knowledge>
