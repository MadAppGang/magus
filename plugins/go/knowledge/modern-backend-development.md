# Modern Go Backend Development (2024-2025)

A comprehensive guide to building production-ready Go backend services using current best practices, tools, and patterns.

---

## Table of Contents

- [Philosophy & Overview](#philosophy--overview)
- [Development Workflow](#development-workflow)
- [HTTP APIs with Chi Router](#http-apis-with-chi-router)
- [Database Integration](#database-integration)
- [Testing Strategy](#testing-strategy)
- [Code Quality & Tooling](#code-quality--tooling)
- [Error Handling & Configuration](#error-handling--configuration)
- [Common Patterns & Anti-Patterns](#common-patterns--anti-patterns)

---

## Philosophy & Overview

Go backend development has matured significantly with clear community consensus emerging around tools and patterns. For teams building production applications with Chi, pgx, MongoDB, and native Go approaches, the modern workflow emphasizes:

- **Simplicity over frameworks** - Use focused libraries, not heavyweight frameworks
- **Explicit dependency management over magic** - Constructor injection, not DI containers
- **Clean separation of concerns** - Clear layers with well-defined responsibilities
- **Standard library first** - Leverage stdlib before adding dependencies

### Key Paradigm Shifts (2024-2025)

**What Changed:**

- **golang-standards/project-layout** is deprecated → Official guidance favoring simple structures
- **Multiple hot reload options** → Air is the clear winner
- **Fragmented linting** → golangci-lint v2 (March 2025) as the standard
- **Framework attempts** → Embracing Go's philosophy of explicitness
- **ORM-heavy patterns** → Direct driver usage with repository pattern

**Current Community Consensus:**

- Air for hot reload and development workflow
- Chi for HTTP routing (composable, standards-based)
- pgx for PostgreSQL (native driver, not database/sql)
- Official MongoDB driver with BSON patterns
- testcontainers-go for integration testing
- golangci-lint v2 for comprehensive linting
- Go 1.21+ structured logging with slog

---

## Development Workflow

### Hot Reload with Air

**Why Air?** Clear winner over CompileDaemon and alternatives due to:
- Better Docker integration
- Superior configurability
- Active maintenance through 2024
- Fast, reliable rebuilds

**Installation:**

```bash
go install github.com/cosmtrek/air@latest
```

**Initialize in your project:**

```bash
air init  # Creates .air.toml configuration
```

**Basic `.air.toml` configuration:**

```toml
root = "."
testdata_dir = "testdata"
tmp_dir = "tmp"

[build]
  args_bin = []
  bin = "./tmp/main"
  cmd = "go build -o ./tmp/main ./cmd/server"
  delay = 1000
  exclude_dir = ["assets", "tmp", "vendor", "testdata"]
  exclude_file = []
  exclude_regex = ["_test.go"]
  exclude_unchanged = false
  follow_symlink = false
  full_bin = ""
  include_dir = []
  include_ext = ["go", "tpl", "tmpl", "html"]
  include_file = []
  kill_delay = "0s"
  log = "build-errors.log"
  poll = false
  poll_interval = 0
  rerun = false
  rerun_delay = 500
  send_interrupt = false
  stop_on_error = false

[color]
  app = ""
  build = "yellow"
  main = "magenta"
  runner = "green"
  watcher = "cyan"

[log]
  main_only = false
  time = false

[misc]
  clean_on_exit = false

[screen]
  clear_on_rebuild = false
  keep_scroll = true
```

**Usage:**

```bash
air  # Run with hot reload
```

---

### IDE Setup: VS Code

**Why VS Code?** Community standard with:
- Official Go extension with gopls language server
- Excellent debugging support with Delve integration
- Seamless formatting and linting integration

**Essential settings.json configuration:**

```json
{
  "go.formatTool": "goimports",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports": true
  },
  "go.lintTool": "golangci-lint",
  "go.lintOnSave": "workspace",
  "go.useLanguageServer": true,
  "gopls": {
    "ui.semanticTokens": true,
    "ui.completion.usePlaceholders": true
  }
}
```

**Required tool installations:**

```bash
# Language server
go install golang.org/x/tools/gopls@latest

# Debugger
go install github.com/go-delve/delve/cmd/dlv@latest

# Primary linter
go install honnef.co/go/tools/cmd/staticcheck@latest

# Meta-linter (includes many linters)
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Import management
go install golang.org/x/tools/cmd/goimports@latest
```

---

### Project Structure

**Start simple, evolve based on actual needs.** Don't create directories "just for organization."

**Official Go guidance from go.dev:**
- Explicitly warns against premature directory structure
- Favor simplicity and natural evolution
- Use `cmd/` for executables
- Use `internal/` for private packages (compiler-enforced)

**Typical production structure:**

```
myproject/
├── cmd/
│   └── server/
│       └── main.go          # Entry point
├── internal/
│   ├── domain/              # Business entities & interfaces
│   │   ├── user.go
│   │   └── repository.go
│   ├── handler/             # HTTP handlers
│   │   ├── user.go
│   │   └── middleware.go
│   ├── service/             # Business logic
│   │   └── user.go
│   ├── repository/          # Data access implementations
│   │   └── postgres/
│   │       └── user.go
│   └── router/              # Route setup
│       └── router.go
├── migrations/              # Database migrations
│   ├── 001_create_users.sql
│   └── 002_add_indexes.sql
├── config/
│   ├── config.go
│   └── dev.yaml
├── .air.toml
├── go.mod
└── go.sum
```

**Why this structure works:**

- `cmd/server/main.go` - Single responsibility: wiring dependencies
- `internal/domain/` - Business entities, repository interfaces (no dependencies)
- `internal/service/` - Business logic orchestration
- `internal/repository/` - Data access implementations
- `internal/handler/` - HTTP layer (thin, delegates to services)
- `internal/router/` - Route configuration and middleware setup

**Key principle:** `internal/` is compiler-enforced as private to your module. External packages cannot import from `internal/`.

---

### Daily Development Workflow

```bash
# Terminal 1: Run application with hot reload
air

# Terminal 2: Run tests (continuous or on-demand)
go test -v ./...

# VS Code: Edit with automatic formatting and linting
# - Save triggers goimports (formatting + import management)
# - Linting shows issues inline
# - Integrated debugger for breakpoints

# Run linter manually
golangci-lint run

# Run tests with coverage
go test -race -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

**Fast feedback loop:**
1. Edit code in VS Code
2. Air automatically rebuilds on save
3. Application restarts immediately
4. Test changes in browser/API client
5. Inline linting catches issues
6. Integrated debugger for troubleshooting

---

## HTTP APIs with Chi Router

### Why Chi?

Chi is **not a framework** - it's a lightweight, composable router that works with standard `net/http` handlers.

**Benefits:**

- Standard library compatible (`http.Handler`, `http.HandlerFunc`)
- Composable middleware
- Clean route organization with groups and mounting
- URL parameter extraction
- No framework lock-in
- Minimal overhead

**Installation:**

```bash
go get -u github.com/go-chi/chi/v5
```

---

### Route Organization

**Basic router setup:**

```go
package router

import (
    "net/http"
    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
)

func New(userHandler *handler.UserHandler) http.Handler {
    r := chi.NewRouter()

    // Global middleware
    r.Use(middleware.RequestID)
    r.Use(middleware.RealIP)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)

    // Health check
    r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })

    // API routes
    r.Route("/api/v1", func(r chi.Router) {
        // Public routes
        r.Post("/auth/login", userHandler.Login)
        r.Post("/auth/register", userHandler.Register)

        // Protected routes
        r.Group(func(r chi.Router) {
            r.Use(AuthMiddleware) // Authentication required

            r.Route("/users", func(r chi.Router) {
                r.Get("/", userHandler.List)
                r.Post("/", userHandler.Create)

                r.Route("/{userID}", func(r chi.Router) {
                    r.Use(UserCtx) // Load user into context
                    r.Get("/", userHandler.Get)
                    r.Put("/", userHandler.Update)
                    r.Delete("/", userHandler.Delete)
                })
            })
        })
    })

    return r
}
```

**Key patterns:**

- `r.Route()` - Nested route groups with path prefix
- `r.Mount()` - Attach sub-routers (for modular apps)
- `r.Group()` - Isolate middleware stacks
- `r.Use()` - Apply middleware to all subsequent routes
- `r.With()` - Apply middleware inline to specific handlers

---

### Middleware Composition

Middleware signature: `func(http.Handler) http.Handler`

**Execution order matters:**

1. Request ID generation (for tracing)
2. Real IP detection (behind proxies)
3. Logging (with request ID)
4. Panic recovery (catch panics, return 500)

**Custom middleware example:**

```go
package middleware

import (
    "context"
    "net/http"
    "strings"
)

func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Extract token from Authorization header
        authHeader := r.Header.Get("Authorization")
        if authHeader == "" {
            http.Error(w, "Unauthorized", http.StatusUnauthorized)
            return
        }

        token := strings.TrimPrefix(authHeader, "Bearer ")

        // Validate token (pseudo-code)
        userID, err := validateToken(token)
        if err != nil {
            http.Error(w, "Invalid token", http.StatusUnauthorized)
            return
        }

        // Add user ID to context
        ctx := context.WithValue(r.Context(), userIDKey, userID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Apply to specific routes
r.Group(func(r chi.Router) {
    r.Use(AuthMiddleware)
    r.Get("/protected", protectedHandler)
})
```

**Inline middleware with `With()`:**

```go
r.With(paginate).Get("/articles", listArticles)
// Pagination only applies to this endpoint
```

---

### Context Usage

**Use context for request-scoped data:**
- Authenticated user information
- Request IDs for tracing
- Loaded resources (loaded in middleware)

**Typed context keys (avoid collisions):**

```go
package handler

type contextKey string

const (
    userIDKey  contextKey = "user_id"
    articleKey contextKey = "article"
)

// Middleware: Add to context
func UserCtx(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        userID := chi.URLParam(r, "userID")

        // Load user from database
        user, err := userRepo.GetByID(r.Context(), userID)
        if err != nil {
            http.Error(w, "User not found", http.StatusNotFound)
            return
        }

        ctx := context.WithValue(r.Context(), articleKey, user)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Handler: Retrieve from context
func (h *UserHandler) Get(w http.ResponseWriter, r *http.Request) {
    user := r.Context().Value(articleKey).(*User)

    // Use loaded user
    respondJSON(w, http.StatusOK, user)
}
```

**Modern best practice:** Extract context values early in handlers, then pass as explicit parameters to business logic. Keeps domain logic context-free and testable.

```go
func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
    // Extract from context at handler boundary
    user := r.Context().Value(articleKey).(*User)
    userID := r.Context().Value(userIDKey).(string)

    var req UpdateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "Invalid request", http.StatusBadRequest)
        return
    }

    // Pass explicitly to business logic (no context needed)
    if err := h.service.UpdateUser(userID, req); err != nil {
        handleError(w, err)
        return
    }

    respondJSON(w, http.StatusOK, user)
}
```

---

### Error Handling in Handlers

**Custom handler type that returns errors:**

```go
package handler

type Handler func(http.ResponseWriter, *http.Request) error

// Adapter converts custom Handler to standard http.HandlerFunc
func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if err := h(w, r); err != nil {
        handleError(w, err)
    }
}

func handleError(w http.ResponseWriter, err error) {
    // Check for custom error types with HTTP status
    var httpErr interface{ HTTPStatus() int }
    if errors.As(err, &httpErr) {
        http.Error(w, err.Error(), httpErr.HTTPStatus())
        return
    }

    // Default to 500 for unknown errors
    http.Error(w, "Internal server error", http.StatusInternalServerError)
}

// Usage in handlers
func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) error {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        return NewBadRequestError("Invalid request body")
    }

    user, err := h.service.CreateUser(r.Context(), req)
    if err != nil {
        return err // Let adapter handle error response
    }

    return respondJSON(w, http.StatusCreated, user)
}
```

**Custom error types with HTTP status:**

```go
type HTTPError struct {
    Status  int
    Message string
}

func (e *HTTPError) Error() string {
    return e.Message
}

func (e *HTTPError) HTTPStatus() int {
    return e.Status
}

func NewBadRequestError(msg string) error {
    return &HTTPError{Status: http.StatusBadRequest, Message: msg}
}

func NewNotFoundError(msg string) error {
    return &HTTPError{Status: http.StatusNotFound, Message: msg}
}
```

---

## Database Integration

### PostgreSQL with pgx

**Why pgx over database/sql?**

- 10-50% better performance
- Significantly fewer allocations
- Native PostgreSQL features (COPY, LISTEN/NOTIFY, array types)
- Better connection pooling
- Rich context support

**Installation:**

```bash
go get github.com/jackc/pgx/v5
```

**Connection pooling setup:**

```go
package database

import (
    "context"
    "fmt"
    "github.com/jackc/pgx/v5/pgxpool"
)

func NewPool(ctx context.Context, connString string) (*pgxpool.Pool, error) {
    config, err := pgxpool.ParseConfig(connString)
    if err != nil {
        return nil, fmt.Errorf("parsing config: %w", err)
    }

    // Pool sizing: CPU_cores * 4 for typical workloads
    config.MaxConns = 20
    config.MinConns = 5

    // Connection lifecycle (important for cloud databases)
    config.MaxConnLifetime = 30 * time.Minute
    config.HealthCheckPeriod = 1 * time.Minute

    pool, err := pgxpool.NewWithConfig(ctx, config)
    if err != nil {
        return nil, fmt.Errorf("creating pool: %w", err)
    }

    // Verify connection
    if err := pool.Ping(ctx); err != nil {
        return nil, fmt.Errorf("ping failed: %w", err)
    }

    return pool, nil
}
```

**Connection string format:**

```
postgres://username:password@localhost:5432/database?sslmode=disable
```

---

### Repository Pattern with pgx

**Clean separation: domain interfaces, concrete implementations**

**1. Define repository interface in domain layer:**

```go
package domain

import "context"

type User struct {
    ID        string
    Email     string
    Name      string
    CreatedAt time.Time
    UpdatedAt time.Time
}

type UserRepository interface {
    GetByID(ctx context.Context, id string) (*User, error)
    GetByEmail(ctx context.Context, email string) (*User, error)
    List(ctx context.Context, limit, offset int) ([]*User, error)
    Create(ctx context.Context, user *User) error
    Update(ctx context.Context, user *User) error
    Delete(ctx context.Context, id string) error
}
```

**2. Implement repository in repository layer:**

```go
package postgres

import (
    "context"
    "fmt"
    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
    "myapp/internal/domain"
)

// DBTX interface allows methods to accept pool or transaction
type DBTX interface {
    Exec(ctx context.Context, sql string, args ...interface{}) (pgx.CommandTag, error)
    Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
    QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
}

type UserRepository struct {
    db DBTX
}

func NewUserRepository(pool *pgxpool.Pool) *UserRepository {
    return &UserRepository{db: pool}
}

func (r *UserRepository) GetByID(ctx context.Context, id string) (*domain.User, error) {
    query := `
        SELECT id, email, name, created_at, updated_at
        FROM users
        WHERE id = $1
    `

    var user domain.User
    err := r.db.QueryRow(ctx, query, id).Scan(
        &user.ID,
        &user.Email,
        &user.Name,
        &user.CreatedAt,
        &user.UpdatedAt,
    )
    if err != nil {
        if errors.Is(err, pgx.ErrNoRows) {
            return nil, domain.ErrNotFound
        }
        return nil, fmt.Errorf("querying user: %w", err)
    }

    return &user, nil
}

func (r *UserRepository) List(ctx context.Context, limit, offset int) ([]*domain.User, error) {
    query := `
        SELECT id, email, name, created_at, updated_at
        FROM users
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
    `

    rows, err := r.db.Query(ctx, query, limit, offset)
    if err != nil {
        return nil, fmt.Errorf("querying users: %w", err)
    }
    defer rows.Close()

    users := make([]*domain.User, 0)
    for rows.Next() {
        var user domain.User
        if err := rows.Scan(&user.ID, &user.Email, &user.Name, &user.CreatedAt, &user.UpdatedAt); err != nil {
            return nil, fmt.Errorf("scanning user: %w", err)
        }
        users = append(users, &user)
    }

    if err := rows.Err(); err != nil {
        return nil, fmt.Errorf("iterating rows: %w", err)
    }

    return users, nil
}

func (r *UserRepository) Create(ctx context.Context, user *domain.User) error {
    query := `
        INSERT INTO users (id, email, name, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
    `

    _, err := r.db.Exec(ctx, query,
        user.ID,
        user.Email,
        user.Name,
        user.CreatedAt,
        user.UpdatedAt,
    )
    if err != nil {
        return fmt.Errorf("inserting user: %w", err)
    }

    return nil
}
```

**DBTX pattern benefits:**
- Same repository methods work with pool or transaction
- Caller controls transaction scope
- No repository changes needed for transactional operations

---

### Transaction Management

**Automatic transaction handling with `BeginFunc`:**

```go
func (s *UserService) CreateUserWithProfile(ctx context.Context, req CreateUserRequest) error {
    return s.pool.BeginFunc(ctx, func(tx pgx.Tx) error {
        // Create repository with transaction
        userRepo := postgres.NewUserRepository(tx)
        profileRepo := postgres.NewProfileRepository(tx)

        // Create user
        user := &domain.User{
            ID:    generateID(),
            Email: req.Email,
            Name:  req.Name,
        }
        if err := userRepo.Create(ctx, user); err != nil {
            return err // Automatic rollback
        }

        // Create profile
        profile := &domain.Profile{
            UserID: user.ID,
            Bio:    req.Bio,
        }
        if err := profileRepo.Create(ctx, profile); err != nil {
            return err // Automatic rollback
        }

        return nil // Automatic commit
    })
}
```

**BeginFunc automatically:**
- Commits if function returns `nil`
- Rolls back if function returns error
- Handles panics with rollback

---

### MongoDB Integration

**Official MongoDB driver patterns**

**Installation:**

```bash
go get go.mongodb.org/mongo-driver/mongo
```

**Client setup:**

```go
package database

import (
    "context"
    "go.mongodb.org/mongo-driver/mongo"
    "go.mongodb.org/mongo-driver/mongo/options"
)

func NewMongoClient(ctx context.Context, uri string) (*mongo.Client, error) {
    opts := options.Client().
        ApplyURI(uri).
        SetMaxPoolSize(20).
        SetMinPoolSize(5).
        SetCompressors([]string{"zstd", "zlib", "snappy"})

    client, err := mongo.Connect(ctx, opts)
    if err != nil {
        return nil, fmt.Errorf("connecting to MongoDB: %w", err)
    }

    // Verify connection
    if err := client.Ping(ctx, nil); err != nil {
        return nil, fmt.Errorf("ping failed: %w", err)
    }

    return client, nil
}
```

**BSON handling:**

- `bson.D` - Ordered documents (sequence matters)
- `bson.M` - Unordered maps (most queries)
- `bson.A` - Arrays

**Repository example:**

```go
package mongo

import (
    "context"
    "fmt"
    "go.mongodb.org/mongo-driver/bson"
    "go.mongodb.org/mongo-driver/mongo"
    "myapp/internal/domain"
)

type UserRepository struct {
    collection *mongo.Collection
}

func NewUserRepository(db *mongo.Database) *UserRepository {
    return &UserRepository{
        collection: db.Collection("users"),
    }
}

func (r *UserRepository) GetByID(ctx context.Context, id string) (*domain.User, error) {
    filter := bson.M{"_id": id}

    var user domain.User
    err := r.collection.FindOne(ctx, filter).Decode(&user)
    if err != nil {
        if errors.Is(err, mongo.ErrNoDocuments) {
            return nil, domain.ErrNotFound
        }
        return nil, fmt.Errorf("finding user: %w", err)
    }

    return &user, nil
}

func (r *UserRepository) List(ctx context.Context, limit, offset int64) ([]*domain.User, error) {
    opts := options.Find().
        SetLimit(limit).
        SetSkip(offset).
        SetSort(bson.D{{Key: "created_at", Value: -1}})

    cursor, err := r.collection.Find(ctx, bson.M{}, opts)
    if err != nil {
        return nil, fmt.Errorf("finding users: %w", err)
    }
    defer cursor.Close(ctx)

    var users []*domain.User
    if err := cursor.All(ctx, &users); err != nil {
        return nil, fmt.Errorf("decoding users: %w", err)
    }

    return users, nil
}
```

**Aggregation pipelines:**

```go
func (r *UserRepository) GetActiveUsersWithStats(ctx context.Context) ([]*UserStats, error) {
    pipeline := mongo.Pipeline{
        // Match active users
        {{Key: "$match", Value: bson.D{{Key: "status", Value: "active"}}}},

        // Lookup related data
        {{Key: "$lookup", Value: bson.D{
            {Key: "from", Value: "posts"},
            {Key: "localField", Value: "_id"},
            {Key: "foreignField", Value: "user_id"},
            {Key: "as", Value: "posts"},
        }}},

        // Add computed fields
        {{Key: "$addFields", Value: bson.D{
            {Key: "post_count", Value: bson.D{{Key: "$size", Value: "$posts"}}},
        }}},

        // Project final shape
        {{Key: "$project", Value: bson.D{
            {Key: "name", Value: 1},
            {Key: "email", Value: 1},
            {Key: "post_count", Value: 1},
        }}},
    }

    opts := options.Aggregate().SetAllowDiskUse(true)
    cursor, err := r.collection.Aggregate(ctx, pipeline, opts)
    if err != nil {
        return nil, fmt.Errorf("aggregating: %w", err)
    }
    defer cursor.Close(ctx)

    var results []*UserStats
    if err := cursor.All(ctx, &results); err != nil {
        return nil, fmt.Errorf("decoding results: %w", err)
    }

    return results, nil
}
```

**Performance tips for aggregation:**
- Match and project early to reduce document size
- Use indexes (put indexed fields in `$match` stages)
- Set `AllowDiskUse(true)` for operations exceeding 100MB memory limit per stage

---

### Transaction Support (MongoDB)

**Requires replica sets**

```go
func (s *UserService) TransferCredits(ctx context.Context, fromID, toID string, amount int) error {
    session, err := s.client.StartSession()
    if err != nil {
        return fmt.Errorf("starting session: %w", err)
    }
    defer session.EndSession(ctx)

    _, err = session.WithTransaction(ctx, func(sessCtx mongo.SessionContext) (interface{}, error) {
        // Deduct from sender
        if err := s.userRepo.DeductCredits(sessCtx, fromID, amount); err != nil {
            return nil, err
        }

        // Add to receiver
        if err := s.userRepo.AddCredits(sessCtx, toID, amount); err != nil {
            return nil, err
        }

        return nil, nil
    })

    return err
}
```

**Transaction best practices:**
- Keep transactions short
- Use appropriate read concern: `readconcern.Snapshot()`
- Use appropriate write concern: `writeconcern.Majority()`
- Operations use `sessCtx` instead of regular context

---

## Testing Strategy

### Table-Driven Tests

**The canonical Go pattern for reducing test duplication**

**Slice-based test tables:**

```go
func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        want    bool
        wantErr bool
    }{
        {
            name:    "valid email",
            email:   "user@example.com",
            want:    true,
            wantErr: false,
        },
        {
            name:    "missing @ symbol",
            email:   "userexample.com",
            want:    false,
            wantErr: true,
        },
        {
            name:    "empty email",
            email:   "",
            want:    false,
            wantErr: true,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // Run subtests in parallel

            got, err := ValidateEmail(tt.email)
            if (err != nil) != tt.wantErr {
                t.Errorf("ValidateEmail() error = %v, wantErr %v", err, tt.wantErr)
                return
            }
            if got != tt.want {
                t.Errorf("ValidateEmail() = %v, want %v", got, tt.want)
            }
        })
    }
}
```

**Map-based test tables (better unordered execution):**

```go
func TestFormatCurrency(t *testing.T) {
    tests := map[string]struct {
        amount   int
        currency string
        want     string
    }{
        "USD dollars":    {amount: 100, currency: "USD", want: "$1.00"},
        "EUR euros":      {amount: 250, currency: "EUR", want: "€2.50"},
        "zero amount":    {amount: 0, currency: "USD", want: "$0.00"},
        "negative amount": {amount: -50, currency: "USD", want: "-$0.50"},
    }

    for name, tt := range tests {
        t.Run(name, func(t *testing.T) {
            t.Parallel()

            got := FormatCurrency(tt.amount, tt.currency)
            if got != tt.want {
                t.Errorf("got %v, want %v", got, tt.want)
            }
        })
    }
}
```

---

### Integration Testing with testcontainers-go

**Modern standard for Docker-based integration tests**

**Installation:**

```bash
go get github.com/testcontainers/testcontainers-go
```

**Docker Compose integration:**

```go
//go:build integration

package integration_test

import (
    "context"
    "testing"
    "github.com/testcontainers/testcontainers-go"
    "github.com/testcontainers/testcontainers-go/compose"
)

func TestUserRepository_Integration(t *testing.T) {
    ctx := context.Background()

    // Start Docker Compose
    composeStack := compose.NewDockerComposeWith(
        compose.WithStackFiles("testdata/docker-compose.test.yml"),
    )

    t.Cleanup(func() {
        if err := composeStack.Down(ctx); err != nil {
            t.Fatalf("failed to tear down: %v", err)
        }
    })

    if err := composeStack.Up(ctx, compose.Wait(true)); err != nil {
        t.Fatalf("failed to start compose: %v", err)
    }

    // Run tests against real database
    // ...
}
```

**Build tags separate unit vs integration tests:**

```go
//go:build integration
```

**Run commands:**

```bash
# Run unit tests (no tag, runs by default)
go test ./...

# Run integration tests
go test -tags=integration ./...

# Run both
go test -tags=integration ./...
```

---

### Unit vs Integration Testing

**Decision matrix:**

| Test Type | When to Use | What to Mock |
|-----------|-------------|--------------|
| **Unit Tests** | Business logic in services | Repository interfaces |
| **Integration Tests** | Database queries, transactions | Nothing (use real DB) |
| **HTTP Handler Tests** | Request/response handling | Service layer |

**Unit test with mocks (testify/mock):**

```go
package service_test

import (
    "context"
    "testing"
    "github.com/stretchr/testify/mock"
    "github.com/stretchr/testify/require"
)

type MockUserRepository struct {
    mock.Mock
}

func (m *MockUserRepository) GetByID(ctx context.Context, id string) (*domain.User, error) {
    args := m.Called(ctx, id)
    if args.Get(0) == nil {
        return nil, args.Error(1)
    }
    return args.Get(0).(*domain.User), args.Error(1)
}

func TestUserService_GetUser(t *testing.T) {
    mockRepo := new(MockUserRepository)
    service := NewUserService(mockRepo)

    expectedUser := &domain.User{ID: "123", Name: "John"}
    mockRepo.On("GetByID", mock.Anything, "123").Return(expectedUser, nil)

    user, err := service.GetUser(context.Background(), "123")

    require.NoError(t, err)
    require.Equal(t, expectedUser, user)
    mockRepo.AssertExpectations(t)
}
```

**Integration test with real database:**

```go
//go:build integration

func TestUserRepository_Create(t *testing.T) {
    // Setup real database (via testcontainers)
    pool := setupTestDB(t)
    defer pool.Close()

    repo := postgres.NewUserRepository(pool)

    user := &domain.User{
        ID:    "test-123",
        Email: "test@example.com",
        Name:  "Test User",
    }

    err := repo.Create(context.Background(), user)
    require.NoError(t, err)

    // Verify in database
    retrieved, err := repo.GetByID(context.Background(), user.ID)
    require.NoError(t, err)
    require.Equal(t, user.Email, retrieved.Email)
}
```

---

### HTTP Handler Testing

**Testing Chi handlers with URL parameters:**

**Helper function for Chi routing context:**

```go
func withURLParams(r *http.Request, params map[string]string) *http.Request {
    rctx := chi.NewRouteContext()
    for key, value := range params {
        rctx.URLParams.Add(key, value)
    }
    return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}
```

**Handler test example:**

```go
func TestUserHandler_Get(t *testing.T) {
    mockService := new(MockUserService)
    handler := NewUserHandler(mockService)

    expectedUser := &domain.User{ID: "123", Name: "John"}
    mockService.On("GetUser", mock.Anything, "123").Return(expectedUser, nil)

    // Create request
    req := httptest.NewRequest("GET", "/users/123", nil)
    req = withURLParams(req, map[string]string{"userID": "123"})

    // Create response recorder
    rr := httptest.NewRecorder()

    // Call handler
    handler.Get(rr, req)

    // Assert response
    require.Equal(t, http.StatusOK, rr.Code)

    var response domain.User
    err := json.Unmarshal(rr.Body.Bytes(), &response)
    require.NoError(t, err)
    require.Equal(t, expectedUser.ID, response.ID)
}
```

**Alternative: Test through real Chi router:**

```go
func TestUserHandler_Get_ThroughRouter(t *testing.T) {
    mockService := new(MockUserService)
    handler := NewUserHandler(mockService)

    expectedUser := &domain.User{ID: "123", Name: "John"}
    mockService.On("GetUser", mock.Anything, "123").Return(expectedUser, nil)

    // Setup real router
    r := chi.NewRouter()
    r.Get("/users/{userID}", handler.Get)

    // Create request
    req := httptest.NewRequest("GET", "/users/123", nil)
    rr := httptest.NewRecorder()

    // Serve through router (populates routing context)
    r.ServeHTTP(rr, req)

    require.Equal(t, http.StatusOK, rr.Code)
}
```

---

## Code Quality & Tooling

### Database Migrations with Goose

**Modern migration tool with SQL and Go support**

**Installation:**

```bash
go install github.com/pressly/goose/v3/cmd/goose@latest
```

**Create migration:**

```bash
goose -dir migrations create create_users sql
# Creates: migrations/20241113120000_create_users.sql
```

**SQL migration format:**

```sql
-- +goose Up
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- +goose Down
DROP TABLE users;
```

**Go migrations (for complex logic):**

```go
package migrations

import (
    "database/sql"
    "github.com/pressly/goose/v3"
)

func init() {
    goose.AddMigration(upComplexOperation, downComplexOperation)
}

func upComplexOperation(tx *sql.Tx) error {
    // Complex migration logic with full Go capabilities
    return nil
}

func downComplexOperation(tx *sql.Tx) error {
    // Rollback logic
    return nil
}
```

**Special annotations:**

```sql
-- +goose NO TRANSACTION
-- For operations that can't run in transactions
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
```

**Hybrid versioning for teams:**

Development workflow:
1. Developers create timestamp-based migrations (avoid conflicts)
2. On merge to main, CI runs `goose fix` to convert to sequential numbering
3. Production uses clean, sequential version history

**Makefile integration:**

```makefile
DB_URL=postgres://user:pass@localhost:5432/mydb?sslmode=disable

.PHONY: migrate-up
migrate-up:
	goose -dir migrations postgres "$(DB_URL)" up

.PHONY: migrate-down
migrate-down:
	goose -dir migrations postgres "$(DB_URL)" down

.PHONY: migrate-status
migrate-status:
	goose -dir migrations postgres "$(DB_URL)" status

.PHONY: migrate-create
migrate-create:
	@read -p "Migration name: " name; \
	goose -dir migrations create $$name sql
```

**Embedded migrations (single binary deployment):**

```go
package main

import (
    "embed"
    "github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var embedMigrations embed.FS

func runMigrations(db *sql.DB) error {
    goose.SetBaseFS(embedMigrations)

    if err := goose.Up(db, "migrations"); err != nil {
        return fmt.Errorf("running migrations: %w", err)
    }

    return nil
}
```

---

### golangci-lint v2 (March 2025)

**The standard meta-linter for Go**

**Installation:**

```bash
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

**v2 Configuration (`.golangci.yml`):**

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
    - govet              # Official Go vet
    - staticcheck        # Advanced static analysis (150+ checks)

    # Error handling
    - errcheck           # Unchecked errors
    - errorlint          # Error wrapping issues

    # Security
    - gosec              # Security issues

    # Code quality
    - revive             # Modern golint replacement
    - gocyclo            # Cyclomatic complexity
    - dupl               # Code duplication
    - gofmt              # Formatting issues
    - ineffassign        # Ineffectual assignments
    - unconvert          # Unnecessary conversions

    # Performance
    - prealloc           # Slice preallocation opportunities

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
        severity: warning
      - name: unexported-return
        severity: warning
      - name: var-naming
        severity: warning

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

**Run linter:**

```bash
# Full lint
golangci-lint run

# Fast mode (for pre-commit hooks)
golangci-lint run --fast

# Specific paths
golangci-lint run ./internal/...

# Show all issues
golangci-lint run --max-issues-per-linter=0 --max-same-issues=0
```

---

### Pre-commit Hooks

**Native Git hooks approach:**

**Create `.githooks/pre-commit`:**

```bash
#!/bin/bash

set -e

echo "Running pre-commit checks..."

# Format check
echo "Checking formatting..."
if [ "$(gofmt -l . | wc -l)" -gt 0 ]; then
    echo "Code is not formatted. Run 'gofmt -w .'"
    exit 1
fi

# Fast linting
echo "Running linters..."
golangci-lint run --fast

# Quick tests
echo "Running tests..."
go test -short ./...

echo "Pre-commit checks passed!"
```

**Make executable and configure Git:**

```bash
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

**Keep it fast (< 10 seconds):**
- Use `golangci-lint run --fast`
- Use `go test -short ./...`
- Run comprehensive checks in CI, not locally

---

### GitHub Actions Integration

**`.github/workflows/ci.yml`:**

```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: golangci-lint
        uses: golangci/golangci-lint-action@v4
        with:
          version: latest
          args: --timeout=5m
          only-new-issues: true  # Focus PR reviews on changed code

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: Run tests
        run: go test -race -coverprofile=coverage.out ./...

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage.out
```

---

## Error Handling & Configuration

### Modern Error Handling (Go 1.13+)

**Error wrapping with `%w`:**

```go
import (
    "errors"
    "fmt"
)

// Wrap errors to build context chain
func LoadUser(id string) (*User, error) {
    user, err := db.GetUser(id)
    if err != nil {
        return nil, fmt.Errorf("loading user %s: %w", id, err)
    }
    return user, nil
}

// Check for specific errors in chain
if errors.Is(err, sql.ErrNoRows) {
    // Handle not found
}

// Extract specific error types
var netErr *net.Error
if errors.As(err, &netErr) {
    if netErr.Timeout() {
        // Handle timeout
    }
}
```

**Best practices:**
- **Always add context when wrapping:** `fmt.Errorf("context: %w", err)`
- **Handle errors once:** Either log OR return, not both
- **Log at boundaries:** HTTP handlers, message consumers, scheduled jobs
- **Return wrapped errors from lower layers**

---

### HTTP Error Handling

**Sentinel errors with HTTP status codes:**

```go
package domain

import "errors"

// Sentinel errors
var (
    ErrNotFound      = errors.New("resource not found")
    ErrUnauthorized  = errors.New("unauthorized")
    ErrBadRequest    = errors.New("bad request")
    ErrConflict      = errors.New("resource conflict")
)

// HTTP status mapping
func HTTPStatusForError(err error) int {
    switch {
    case errors.Is(err, ErrNotFound):
        return http.StatusNotFound
    case errors.Is(err, ErrUnauthorized):
        return http.StatusUnauthorized
    case errors.Is(err, ErrBadRequest):
        return http.StatusBadRequest
    case errors.Is(err, ErrConflict):
        return http.StatusConflict
    default:
        return http.StatusInternalServerError
    }
}
```

**Custom error types with behavior:**

```go
type HTTPError struct {
    Status  int
    Message string
    Err     error
}

func (e *HTTPError) Error() string {
    if e.Err != nil {
        return fmt.Sprintf("%s: %v", e.Message, e.Err)
    }
    return e.Message
}

func (e *HTTPError) Unwrap() error {
    return e.Err
}

func (e *HTTPError) HTTPStatus() int {
    return e.Status
}

// Usage
func (s *UserService) GetUser(ctx context.Context, id string) (*User, error) {
    user, err := s.repo.GetByID(ctx, id)
    if err != nil {
        if errors.Is(err, domain.ErrNotFound) {
            return nil, &HTTPError{
                Status:  http.StatusNotFound,
                Message: "User not found",
                Err:     err,
            }
        }
        return nil, fmt.Errorf("getting user: %w", err)
    }
    return user, nil
}
```

**Handler middleware for error translation:**

```go
func handleError(w http.ResponseWriter, err error) {
    // Check for HTTPError interface
    var httpErr interface{ HTTPStatus() int }
    if errors.As(err, &httpErr) {
        status := httpErr.HTTPStatus()
        http.Error(w, err.Error(), status)

        // Log server errors only
        if status >= 500 {
            log.Printf("Server error: %v", err)
        }
        return
    }

    // Default to 500 for unknown errors
    log.Printf("Unknown error: %v", err)
    http.Error(w, "Internal server error", http.StatusInternalServerError)
}
```

---

### Structured Logging with slog (Go 1.21+)

**Standard library structured logging**

```go
package main

import (
    "log/slog"
    "os"
)

func setupLogger() {
    // JSON handler for production
    logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))
    slog.SetDefault(logger)
}

// Log with structured context
slog.Info("user created",
    "user_id", user.ID,
    "email", user.Email,
    "ip", clientIP,
)

slog.Error("failed to create user",
    "error", err,
    "user_id", userID,
    "input", request,
)
```

**Logging best practices:**
- **Log at architectural boundaries** (handlers, consumers, jobs)
- **Never log sensitive data** (passwords, tokens, full request bodies)
- **Use key-value pairs** for machine-readable logs
- **Return wrapped errors** from internal functions, log once at boundary

---

### Configuration Management with Viper

**Flexible config with YAML + environment variables**

**Installation:**

```bash
go get github.com/spf13/viper
```

**Configuration struct:**

```go
package config

type Config struct {
    Server   ServerConfig   `mapstructure:"server"`
    Database DatabaseConfig `mapstructure:"database"`
    Redis    RedisConfig    `mapstructure:"redis"`
}

type ServerConfig struct {
    Port int    `mapstructure:"port"`
    Host string `mapstructure:"host"`
}

type DatabaseConfig struct {
    URL          string `mapstructure:"url"`
    MaxConns     int    `mapstructure:"max_conns"`
    MinConns     int    `mapstructure:"min_conns"`
    MaxLifetime  int    `mapstructure:"max_lifetime"` // minutes
}

type RedisConfig struct {
    Addr     string `mapstructure:"addr"`
    Password string `mapstructure:"password"`
    DB       int    `mapstructure:"db"`
}
```

**Loading configuration:**

```go
package config

import (
    "fmt"
    "github.com/spf13/viper"
)

func Load() (*Config, error) {
    // Set defaults
    viper.SetDefault("server.port", 8080)
    viper.SetDefault("server.host", "localhost")
    viper.SetDefault("database.max_conns", 20)
    viper.SetDefault("database.min_conns", 5)

    // Load config file
    viper.SetConfigName("config")
    viper.SetConfigType("yaml")
    viper.AddConfigPath("./config")
    viper.AddConfigPath(".")

    if err := viper.ReadInConfig(); err != nil {
        // Config file not found is acceptable (use defaults + env vars)
        if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
            return nil, fmt.Errorf("reading config: %w", err)
        }
    }

    // Enable environment variable overrides
    viper.AutomaticEnv()
    viper.SetEnvPrefix("APP") // APP_SERVER_PORT overrides server.port

    // Unmarshal into struct
    var config Config
    if err := viper.Unmarshal(&config); err != nil {
        return nil, fmt.Errorf("unmarshaling config: %w", err)
    }

    return &config, nil
}
```

**`config/config.yaml`:**

```yaml
server:
  port: 8080
  host: "0.0.0.0"

database:
  url: "postgres://user:pass@localhost:5432/mydb?sslmode=disable"
  max_conns: 20
  min_conns: 5
  max_lifetime: 30

redis:
  addr: "localhost:6379"
  password: ""
  db: 0
```

**Configuration precedence:**
1. Defaults (lowest priority)
2. Config file
3. Environment variables (highest priority)

**Local vs Production:**
- **Development:** Use `config/dev.yaml` (gitignored)
- **Production:** Use environment variables
- **Repository:** Commit `config/config.example.yaml` with placeholders
- **Never commit secrets!**

---

### Dependency Injection

**Manual constructor injection (recommended for most apps):**

```go
package main

func main() {
    // Load config
    cfg, err := config.Load()
    if err != nil {
        log.Fatal(err)
    }

    // Initialize database
    pool, err := database.NewPool(context.Background(), cfg.Database.URL)
    if err != nil {
        log.Fatal(err)
    }
    defer pool.Close()

    // Create repositories
    userRepo := postgres.NewUserRepository(pool)
    postRepo := postgres.NewPostRepository(pool)

    // Create services
    userService := service.NewUserService(userRepo)
    postService := service.NewPostService(postRepo, userService)

    // Create handlers
    userHandler := handler.NewUserHandler(userService)
    postHandler := handler.NewPostHandler(postService)

    // Create router
    r := router.New(userHandler, postHandler)

    // Start server
    log.Printf("Server starting on %s:%d", cfg.Server.Host, cfg.Server.Port)
    if err := http.ListenAndServe(fmt.Sprintf(":%d", cfg.Server.Port), r); err != nil {
        log.Fatal(err)
    }
}
```

**Benefits of manual injection:**
- Explicit dependencies (clear what depends on what)
- No reflection or magic
- Simple to understand and debug
- Compile-time safety

**For complex apps: Google Wire (compile-time DI):**

```bash
go get github.com/google/wire/cmd/wire
```

```go
//go:build wireinject

package main

import (
    "github.com/google/wire"
)

func InitializeApp(cfg *config.Config) (*App, error) {
    wire.Build(
        database.NewPool,
        postgres.NewUserRepository,
        service.NewUserService,
        handler.NewUserHandler,
        router.New,
        NewApp,
    )
    return &App{}, nil
}
```

Wire generates regular Go code at compile time (no runtime overhead).

---

## Common Patterns & Anti-Patterns

### Context Usage Rules

**Do:**
- ✅ Pass as first parameter named `ctx`
- ✅ Use for cancellation and timeouts
- ✅ Store request-scoped data (request ID, auth info)
- ✅ Propagate cancellation through operation chains

**Don't:**
- ❌ Store in structs
- ❌ Use for passing application dependencies (DB connections, config)
- ❌ Create custom context types

**Good example:**

```go
func (h *UserHandler) Get(w http.ResponseWriter, r *http.Request) {
    // Extract from context at boundary
    userID := r.Context().Value(userIDKey).(string)

    // Pass explicitly to business logic
    user, err := h.service.GetUser(r.Context(), userID)
    if err != nil {
        handleError(w, err)
        return
    }

    respondJSON(w, http.StatusOK, user)
}

// Service layer: context for cancellation only
func (s *UserService) GetUser(ctx context.Context, userID string) (*User, error) {
    // Use ctx for cancellation, pass userID explicitly
    return s.repo.GetByID(ctx, userID)
}
```

**Timeouts and cancellation:**

```go
// Create timeout context
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

// Pass to operations
result, err := longRunningOperation(ctx)
if err != nil {
    if errors.Is(err, context.DeadlineExceeded) {
        // Handle timeout
    }
}
```

---

### Goroutine Patterns

**`net/http` automatically spawns goroutine per request**

**Worker pool pattern (limit concurrency):**

```go
func ProcessJobs(ctx context.Context, jobs <-chan Job) {
    const numWorkers = 10
    var wg sync.WaitGroup

    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()

            for {
                select {
                case <-ctx.Done():
                    return // Exit on cancellation
                case job, ok := <-jobs:
                    if !ok {
                        return // Channel closed
                    }
                    process(job)
                }
            }
        }()
    }

    wg.Wait()
}
```

**Fan-out pattern (parallel processing):**

```go
func ProcessBatch(items []Item) ([]Result, error) {
    results := make(chan Result, len(items))
    errors := make(chan error, len(items))
    var wg sync.WaitGroup

    for _, item := range items {
        wg.Add(1)
        go func(item Item) {
            defer wg.Done()

            result, err := process(item)
            if err != nil {
                errors <- err
                return
            }
            results <- result
        }(item)
    }

    // Wait and close channels
    go func() {
        wg.Wait()
        close(results)
        close(errors)
    }()

    // Collect results
    var finalResults []Result
    for result := range results {
        finalResults = append(finalResults, result)
    }

    // Check for errors
    for err := range errors {
        return nil, err
    }

    return finalResults, nil
}
```

**Always provide exit paths with context cancellation!**

---

### Anti-Patterns to Avoid

**❌ Single model with multiple responsibilities:**

```go
// BAD: One struct for everything
type User struct {
    ID        string    `json:"id" db:"id" gorm:"primaryKey"`
    Email     string    `json:"email" db:"email" validate:"email"`
    Password  string    `json:"password" db:"password"`
    CreatedAt time.Time `json:"created_at" db:"created_at"`
}
```

**✅ Separate concerns:**

```go
// Domain model (business logic)
type User struct {
    ID        string
    Email     string
    CreatedAt time.Time
}

// Database model
type UserDB struct {
    ID        string    `db:"id"`
    Email     string    `db:"email"`
    CreatedAt time.Time `db:"created_at"`
}

// API request
type CreateUserRequest struct {
    Email    string `json:"email" validate:"required,email"`
    Password string `json:"password" validate:"required,min=8"`
}

// API response (never expose passwords!)
type UserResponse struct {
    ID        string    `json:"id"`
    Email     string    `json:"email"`
    CreatedAt time.Time `json:"created_at"`
}
```

**❌ Variable shadowing with `:=`:**

```go
// BAD
var user *User
if condition {
    user, err := loadUser()  // Creates NEW user variable in inner scope!
    if err != nil {
        return err
    }
}
// user is still nil here!
```

**✅ Proper assignment:**

```go
// GOOD
var user *User
var err error
if condition {
    user, err = loadUser()  // Assigns to outer scope variable
    if err != nil {
        return err
    }
}
```

**❌ Ignoring errors:**

```go
// BAD
json.NewDecoder(r.Body).Decode(&req)  // Error ignored!
```

**✅ Handle all errors:**

```go
// GOOD
if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
    return fmt.Errorf("decoding request: %w", err)
}
```

**❌ Starting design from database schema:**

Design domain models first, then map to storage!

---

### Performance Optimization

**Profile first, optimize second!**

```bash
# CPU profiling
go test -cpuprofile=cpu.prof -bench=.
go tool pprof cpu.prof

# Memory profiling
go test -memprofile=mem.prof -bench=.
go tool pprof mem.prof
```

**Common optimizations:**

**1. Preallocate slices:**

```go
// Before
var users []User
for _, id := range ids {
    users = append(users, loadUser(id))
}

// After
users := make([]User, 0, len(ids))  // Preallocate capacity
for _, id := range ids {
    users = append(users, loadUser(id))
}
```

**2. Use `sync.Pool` for temporary objects:**

```go
var bufferPool = sync.Pool{
    New: func() interface{} {
        return new(bytes.Buffer)
    },
}

func processData(data []byte) []byte {
    buf := bufferPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufferPool.Put(buf)
    }()

    buf.Write(data)
    // Process...
    return buf.Bytes()
}
```

**3. Build strings with `strings.Builder`:**

```go
// Before (slow, many allocations)
s := ""
for _, part := range parts {
    s += part
}

// After (fast, single allocation)
var b strings.Builder
for _, part := range parts {
    b.WriteString(part)
}
s := b.String()
```

**4. Limit goroutine creation:**

Use worker pools or semaphores instead of unlimited `go` spawning.

**5. Pass small structs by value, large by pointer:**

```go
type SmallStruct struct {
    ID   int
    Name string
}

func process(s SmallStruct) {}  // By value is fine

type LargeStruct struct {
    // Many fields...
}

func process(s *LargeStruct) {}  // By pointer for large structs
```

---

## Conclusion: The Modern Go Backend Workflow

The convergence of these patterns creates a development workflow optimized for productivity and maintainability:

**Key Insights for 2024-2025:**

1. **Go has matured** - The stdlib and focused community tools handle most needs
2. **Simplicity wins** - You don't need ORMs, heavy frameworks, or complex DI containers
3. **Native Go shines** - Direct drivers (pgx, MongoDB), Chi router, constructor injection
4. **Tooling is stable** - Air, golangci-lint v2, testcontainers, Goose, slog
5. **Focus on business logic** - Not framework mechanics

**Daily Development Workflow:**

1. **Run Air** for instant feedback on code changes
2. **Edit in VS Code** with automatic formatting and linting
3. **Write tests** (unit + integration) as you build features
4. **Use golangci-lint** to catch issues automatically
5. **Create migrations with Goose** for schema changes
6. **Structure code by domain**, not technical layers

**Feature Development Workflow:**

1. **Create migration** for schema changes
2. **Define domain models** (business logic, no infrastructure)
3. **Implement repository interfaces** (data access with pgx/MongoDB)
4. **Write service layer** (orchestrate repositories)
5. **Build Chi handlers** (translate HTTP to service calls)
6. **Test each layer** appropriately
7. **Lint and review**

**The Future is Stable:**

Go's 2024-2025 landscape emphasizes **refining** rather than **revolutionizing**:

- Generics finding practical applications (without overwhelming codebases)
- Structured logging (slog) as the observability foundation
- Improved error handling for production debugging
- Proven patterns over new frameworks

**For backend services, the native Go approach delivers:**

✅ **Productivity** (fast feedback, simple tooling)
✅ **Performance** (direct drivers, efficient concurrency)
✅ **Maintainability** (clear separation, explicit dependencies)
✅ **Long-term stability** (patterns that remain relevant as Go evolves)

---

**This is modern Go backend development in 2024-2025.**

Simple. Explicit. Maintainable. Fast.
