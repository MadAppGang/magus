# Go Architect Knowledge Base

**Role Focus:** System design, architecture decisions, patterns, scalability, and maintainability

**Purpose:** Guide architectural decisions for Go backend systems with battle-tested principles and patterns.

---

## Core Philosophy

### The Go Way (Rob Pike's Proverbs)

**1. Don't communicate by sharing memory; share memory by communicating**
- Design concurrent systems with channels for coordination
- Use mutexes only for protecting state
- Channels transfer ownership, eliminating race conditions

**2. Concurrency is not parallelism**
- Concurrency: Program structure (dealing with multiple things)
- Parallelism: Execution (doing multiple things simultaneously)
- Design for concurrency; let runtime handle parallelism

**3. Channels orchestrate; mutexes serialize**
- **Use channels for:**
  - Goroutine coordination
  - Pipelines and workflows
  - Broadcasting signals
  - Lifecycle management
- **Use mutexes for:**
  - Protecting shared state
  - Caches
  - Simple, quick operations

**4. The bigger the interface, the weaker the abstraction**
- Keep interfaces small (1-3 methods ideal)
- `io.Reader` and `io.Writer` are perfect examples
- Small interfaces enable more implementations
- Compose small interfaces for complex behaviors

**5. Design the architecture, name the components, document the details**
- Architecture decisions come first
- Names carry design intent
- Documentation explains the "why"

**Reference:** `../go-proverbs.md` for complete philosophical foundation

---

## System Design Principles

### Package Organization

**Start Simple, Evolve Naturally**
- Avoid premature directory structure
- Use `cmd/` for executables
- Use `internal/` for private packages (compiler-enforced)

**Typical Production Structure:**
```
myproject/
├── cmd/
│   └── server/
│       └── main.go          # Entry point, wiring only
├── internal/
│   ├── domain/              # Business entities & interfaces
│   ├── handler/             # HTTP handlers (thin)
│   ├── service/             # Business logic orchestration
│   ├── repository/          # Data access implementations
│   └── router/              # Route configuration
├── migrations/              # Database migrations
├── config/
│   └── config.go
└── go.mod
```

**Key Architectural Layers:**

1. **Domain Layer** (`internal/domain/`)
   - Core business entities
   - Repository interfaces (no implementations)
   - Business rules and validation
   - **No dependencies** on infrastructure

2. **Service Layer** (`internal/service/`)
   - Business logic orchestration
   - Coordinates between repositories
   - Transaction management
   - Domain-specific workflows

3. **Repository Layer** (`internal/repository/`)
   - Data access implementations
   - Database queries
   - External service integration
   - Implements domain interfaces

4. **Handler Layer** (`internal/handler/`)
   - HTTP/gRPC adapters
   - Request validation
   - Response formatting
   - Thin: delegates to services

**Reference:** `../modern-backend-development.md` § Project Structure

---

### Interface Design Strategy

**Consumer-Side Interfaces (Rob Pike's guidance)**

```go
// ❌ WRONG: Producer-side interface
package store

type CustomerStorage interface {
    GetAllCustomers() ([]Customer, error)
    // Many other methods...
}

type Store struct { ... }

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

**Why Consumer-Side?**
- Clients define exactly what they need
- Reduces coupling
- Easier to test (minimal mocks)
- Supports interface segregation

**Interface Sizing Guidelines:**
- 1 method: Perfect (io.Reader, io.Writer)
- 2-3 methods: Good
- 4-6 methods: Consider splitting
- 7+ methods: Too large, weak abstraction

**Reference:** `../go-proverbs.md` § Interface Design

---

### Concurrency Architecture

**Workload-Based Goroutine Sizing**

```go
// CPU-bound: Pool size = number of CPU cores
workers := runtime.GOMAXPROCS(0)

// I/O-bound: Based on external system capacity
workers := dbConnectionPoolSize // e.g., 100 for database
```

**Goroutine Lifecycle Management**

Every goroutine must have:
1. **Predictable stop time**, OR
2. **Signal mechanism to stop**

Plus: Code must block and wait for goroutine exit

```go
type Worker struct {
    stop chan struct{}
    done chan struct{}
}

func NewWorker() *Worker {
    w := &Worker{
        stop: make(chan struct{}),
        done: make(chan struct{}),
    }
    go w.run()
    return w
}

func (w *Worker) run() {
    defer close(w.done)

    ticker := time.NewTicker(interval)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            w.doWork()
        case <-w.stop:
            return
        }
    }
}

func (w *Worker) Shutdown() {
    close(w.stop)
    <-w.done
}
```

**Context Propagation Strategy**

```go
// HTTP request context: Be careful!
func handler(w http.ResponseWriter, r *http.Request) {
    // ❌ WRONG: Request context cancels when response written
    go asyncOperation(r.Context(), data)
    writeResponse(w, response)
}

// ✅ CORRECT: Detached context for background work
func handler(w http.ResponseWriter, r *http.Request) {
    go asyncOperation(context.Background(), data)
    writeResponse(w, response)
}

// ✅ CORRECT: Preserve values, detach cancellation
type detachedCtx struct {
    ctx context.Context
}

func (d detachedCtx) Deadline() (time.Time, bool) { return time.Time{}, false }
func (d detachedCtx) Done() <-chan struct{}       { return nil }
func (d detachedCtx) Err() error                  { return nil }
func (d detachedCtx) Value(key any) any           { return d.ctx.Value(key) }
```

**Reference:** `../100-go-mistakes.md` § Concurrency Practice

---

### Error Handling Architecture

**Error Type Decision Tree**

| Caller needs to match error? | Message Type | Solution |
|------------------------------|--------------|----------|
| No | Static | `errors.New` |
| No | Dynamic | `fmt.Errorf` |
| Yes | Static | Top-level var with `errors.New` |
| Yes | Dynamic | Custom error type |

**Domain Error Strategy**

```go
package domain

// Sentinel errors for common cases
var (
    ErrNotFound      = errors.New("resource not found")
    ErrUnauthorized  = errors.New("unauthorized")
    ErrConflict      = errors.New("resource conflict")
)

// Custom errors for rich context
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("%s: %s", e.Field, e.Message)
}
```

**Error Wrapping Guidelines**

```go
// ✅ Service layer: Wrap with domain context
func (s *UserService) GetUser(ctx context.Context, id string) (*User, error) {
    user, err := s.repo.GetByID(ctx, id)
    if err != nil {
        if errors.Is(err, sql.ErrNoRows) {
            return nil, domain.ErrNotFound
        }
        return nil, fmt.Errorf("get user %s: %w", id, err)
    }
    return user, nil
}

// ✅ Handler layer: Translate to HTTP status
func (h *UserHandler) Get(w http.ResponseWriter, r *http.Request) {
    user, err := h.service.GetUser(r.Context(), userID)
    if err != nil {
        switch {
        case errors.Is(err, domain.ErrNotFound):
            http.Error(w, "User not found", http.StatusNotFound)
        case errors.Is(err, domain.ErrUnauthorized):
            http.Error(w, "Unauthorized", http.StatusUnauthorized)
        default:
            log.Printf("Error: %v", err)
            http.Error(w, "Internal error", http.StatusInternalServerError)
        }
        return
    }
    respondJSON(w, http.StatusOK, user)
}
```

**Handle Errors Once (Critical Rule)**
- Log OR return, never both
- Log at architectural boundaries (handlers, consumers, scheduled jobs)
- Lower layers: wrap and return
- Top layers: log with full context

**Reference:** `../uber-go-style-guide.md` § Errors

---

## Architectural Patterns

### Dependency Injection (Manual)

**Why Manual Over Frameworks:**
- Explicit dependencies (clear what depends on what)
- No reflection or magic
- Compile-time safety
- Simple to understand and debug

```go
// main.go - Wiring layer
func main() {
    // Load config
    cfg, err := config.Load()
    if err != nil {
        log.Fatal(err)
    }

    // Initialize infrastructure
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

**For Complex Apps: Google Wire (Compile-Time)**

```go
//go:build wireinject

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

**Reference:** `../modern-backend-development.md` § Dependency Injection

---

### Repository Pattern (Direct Driver Usage)

**PostgreSQL with pgx (Native Driver)**

```go
package domain

// Domain interface
type UserRepository interface {
    GetByID(ctx context.Context, id string) (*User, error)
    Create(ctx context.Context, user *User) error
    Update(ctx context.Context, user *User) error
}
```

```go
package postgres

// DBTX allows methods to accept pool or transaction
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
    query := `SELECT id, email, name FROM users WHERE id = $1`

    var user domain.User
    err := r.db.QueryRow(ctx, query, id).Scan(&user.ID, &user.Email, &user.Name)
    if err != nil {
        if errors.Is(err, pgx.ErrNoRows) {
            return nil, domain.ErrNotFound
        }
        return nil, fmt.Errorf("querying user: %w", err)
    }

    return &user, nil
}
```

**Transaction Management**

```go
func (s *UserService) CreateUserWithProfile(ctx context.Context, req CreateUserRequest) error {
    return s.pool.BeginFunc(ctx, func(tx pgx.Tx) error {
        // Create repositories with transaction
        userRepo := postgres.NewUserRepository(tx)
        profileRepo := postgres.NewProfileRepository(tx)

        user := &domain.User{ID: generateID(), Email: req.Email}
        if err := userRepo.Create(ctx, user); err != nil {
            return err // Automatic rollback
        }

        profile := &domain.Profile{UserID: user.ID, Bio: req.Bio}
        if err := profileRepo.Create(ctx, profile); err != nil {
            return err // Automatic rollback
        }

        return nil // Automatic commit
    })
}
```

**Reference:** `../modern-backend-development.md` § Database Integration

---

### Functional Options Pattern

**When to Use:**
- Constructor with 3+ parameters
- Optional configuration
- APIs you foresee needing to expand
- Want to maintain backward compatibility

```go
type Server struct {
    addr    string
    timeout time.Duration
    maxConn int
    logger  *slog.Logger
}

type Option interface {
    apply(*Server)
}

type timeoutOption time.Duration

func (t timeoutOption) apply(s *Server) {
    s.timeout = time.Duration(t)
}

func WithTimeout(d time.Duration) Option {
    return timeoutOption(d)
}

type maxConnOption int

func (m maxConnOption) apply(s *Server) {
    s.maxConn = int(m)
}

func WithMaxConnections(n int) Option {
    return maxConnOption(n)
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{
        addr:    addr,
        timeout: 30 * time.Second, // Default
        maxConn: 100,              // Default
        logger:  slog.Default(),   // Default
    }

    for _, opt := range opts {
        opt.apply(s)
    }

    return s
}

// Usage:
server := NewServer("localhost:8080")
server := NewServer("localhost:8080", WithTimeout(60*time.Second))
server := NewServer("localhost:8080", WithTimeout(60*time.Second), WithMaxConnections(200))
```

**Benefits:**
- Backward compatible (add options without breaking callers)
- Clear default values
- Optional parameters only when needed
- Options can implement multiple interfaces

**Reference:** `../uber-go-style-guide.md` § Functional Options

---

## Performance Architecture

### CPU-Bound vs I/O-Bound Workloads

**CPU-Bound:**
- Pool size = `runtime.GOMAXPROCS(0)`
- Computational tasks
- Data processing, encoding/decoding
- Image manipulation

**I/O-Bound:**
- Pool size based on external system capacity
- Database: Match connection pool size
- HTTP APIs: Based on rate limits
- File I/O: Based on disk throughput

### Cache Architecture

**Use Mutexes for Shared State:**

```go
type Cache struct {
    mu    sync.RWMutex
    items map[string]*CachedItem
}

func (c *Cache) Get(key string) (*CachedItem, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()

    item, ok := c.items[key]
    if !ok {
        return nil, false
    }

    if time.Now().After(item.ExpiresAt) {
        return nil, false
    }

    return item, true
}

func (c *Cache) Set(key string, value interface{}, ttl time.Duration) {
    c.mu.Lock()
    defer c.mu.Unlock()

    c.items[key] = &CachedItem{
        Value:     value,
        ExpiresAt: time.Now().Add(ttl),
    }
}
```

### Memory Management

**Pre-allocate Known Sizes:**

```go
// Maps
m := make(map[string]int, expectedSize)

// Slices
s := make([]int, 0, expectedSize)
```

**Slice Memory Leaks:**

```go
// ❌ WRONG: Keeps entire backing array
func getMessageType(msg []byte) []byte {
    return msg[:5] // Leaks capacity
}

// ✅ CORRECT: Copy to avoid leak
func getMessageType(msg []byte) []byte {
    msgType := make([]byte, 5)
    copy(msgType, msg)
    return msgType
}
```

**Map Memory Leaks:**

```go
// Maps never shrink - recreate periodically if growth/shrink cycle
if len(m) < previousSize/2 && cap(m) > threshold {
    m = make(map[K]V, len(m))
    // Repopulate with current data
}
```

**Reference:** `../100-go-mistakes.md` § Data Types, Performance

---

## Security Architecture

### Configuration Management

**Team-First Configuration:**

**Shareable (committed to git):**
- Project IDs, URLs
- `.claude/settings.json` with project config
- Feature flags
- **No secrets**

**Private (environment variables):**
- API tokens, credentials
- Each developer's `.env` file
- Never committed

```go
type Config struct {
    Server   ServerConfig   `mapstructure:"server"`
    Database DatabaseConfig `mapstructure:"database"`
}

func Load() (*Config, error) {
    // Set defaults
    viper.SetDefault("server.port", 8080)

    // Load config file
    viper.SetConfigName("config")
    viper.AddConfigPath("./config")
    viper.ReadInConfig()

    // Enable environment variable overrides
    viper.AutomaticEnv()
    viper.SetEnvPrefix("APP")

    var config Config
    if err := viper.Unmarshal(&config); err != nil {
        return nil, err
    }

    return &config, nil
}
```

**Reference:** `../modern-backend-development.md` § Configuration Management

### HTTP Client/Server Timeouts

```go
// ❌ WRONG: No timeouts (production vulnerability)
resp, err := http.Get(url)

// ✅ CORRECT: Configured timeouts
client := &http.Client{
    Timeout: 30 * time.Second,
    Transport: &http.Transport{
        DialContext: (&net.Dialer{
            Timeout: 5 * time.Second,
        }).DialContext,
        TLSHandshakeTimeout: 5 * time.Second,
        MaxIdleConns:        100,
        IdleConnTimeout:     90 * time.Second,
    },
}

// Server timeouts
server := &http.Server{
    Addr:         ":8080",
    Handler:      handler,
    ReadTimeout:  15 * time.Second,
    WriteTimeout: 15 * time.Second,
    IdleTimeout:  60 * time.Second,
}
```

**Reference:** `../100-go-mistakes.md` § Standard Library

---

## Scalability Patterns

### Horizontal Scalability Checklist

**Stateless Services:**
- No in-memory session storage
- Use distributed cache (Redis)
- Database connections per instance

**Graceful Shutdown:**

```go
func main() {
    srv := &http.Server{Addr: ":8080", Handler: handler}

    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatalf("ListenAndServe: %v", err)
        }
    }()

    // Wait for interrupt signal
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    log.Println("Shutting down server...")

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := srv.Shutdown(ctx); err != nil {
        log.Fatal("Server forced to shutdown:", err)
    }

    log.Println("Server exited")
}
```

### Database Connection Pooling

```go
// PostgreSQL with pgx
config, _ := pgxpool.ParseConfig(connString)

// Pool sizing: CPU_cores * 4 for typical workloads
config.MaxConns = int32(runtime.NumCPU() * 4)
config.MinConns = 5

// Connection lifecycle (important for cloud)
config.MaxConnLifetime = 30 * time.Minute
config.HealthCheckPeriod = 1 * time.Minute

pool, err := pgxpool.NewWithConfig(ctx, config)
```

---

## Decision Framework

### When to Choose Channels vs Mutexes

**Use Channels:**
- ✅ Communication between goroutines
- ✅ Ownership transfer
- ✅ Orchestration and coordination
- ✅ Pipelines and workflows

**Use Mutexes:**
- ✅ Protecting shared state
- ✅ Cache implementations
- ✅ Simple, quick operations
- ✅ Performance-critical hot paths

### When to Use Generics (Go 1.18+)

**Use Generics:**
- ✅ Data structures (linked lists, trees, heaps)
- ✅ Functions working with slices/maps/channels of any type
- ✅ Factoring out behaviors (not just types)

**Avoid Generics:**
- ❌ Only calling methods (use interfaces)
- ❌ Code becomes more complex
- ❌ Premature abstraction

### When to Create Custom Error Types

**Use Custom Error Types When:**
- ✅ Caller needs to extract structured data from error
- ✅ Domain-specific error handling required
- ✅ Multiple related errors with shared behavior

**Use Sentinel Errors When:**
- ✅ Static error message
- ✅ Caller needs to match with `errors.Is()`
- ✅ Simple error conditions

---

## Anti-Patterns to Avoid

### 1. Premature Abstraction

```go
// ❌ WRONG: Interface before need
type CustomerStorage interface {
    Get(id string) (Customer, error)
    Save(customer Customer) error
    Delete(id string) error
    // ... 10 more methods
}

// ✅ CORRECT: Start concrete, abstract when needed
type CustomerStore struct {
    db *sql.DB
}

func (s *CustomerStore) Get(id string) (Customer, error) { ... }
```

### 2. Global Mutable State

```go
// ❌ WRONG: Mutable global
var cache = make(map[string]string)

func Get(key string) string {
    return cache[key] // Race condition!
}

// ✅ CORRECT: Encapsulated with protection
type Cache struct {
    mu    sync.RWMutex
    items map[string]string
}

func (c *Cache) Get(key string) string {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.items[key]
}
```

### 3. God Objects

```go
// ❌ WRONG: Too many responsibilities
type UserManager struct {
    db          *sql.DB
    cache       *Cache
    emailer     *Emailer
    validator   *Validator
    logger      *Logger
    metrics     *Metrics
    // ... handles everything
}

// ✅ CORRECT: Single Responsibility
type UserService struct {
    repo UserRepository
}

type EmailService struct {
    sender EmailSender
}

type ValidationService struct {
    rules []ValidationRule
}
```

### 4. Init Functions for Setup

```go
// ❌ WRONG: Resource setup in init
var db *sql.DB

func init() {
    var err error
    db, err = sql.Open("postgres", os.Getenv("DB_URL"))
    if err != nil {
        panic(err) // No error handling flexibility
    }
}

// ✅ CORRECT: Explicit initialization
func NewDatabase(connString string) (*sql.DB, error) {
    db, err := sql.Open("postgres", connString)
    if err != nil {
        return nil, fmt.Errorf("opening database: %w", err)
    }
    return db, nil
}
```

**Reference:** `../100-go-mistakes.md` § Code Organization

---

## Architecture Review Checklist

### System Design
- [ ] Package structure follows domain-driven design
- [ ] Clear separation of concerns (domain, service, repository, handler)
- [ ] Interfaces defined on consumer side
- [ ] Dependencies point inward (domain has no external deps)

### Concurrency
- [ ] All goroutines have clear lifecycle
- [ ] Shutdown mechanism implemented for all background workers
- [ ] Context properly propagated for cancellation
- [ ] Workload-appropriate goroutine pool sizing

### Error Handling
- [ ] Errors handled once (log OR return, not both)
- [ ] Domain errors defined for business rules
- [ ] Errors wrapped with context using `%w`
- [ ] Handlers translate errors to appropriate HTTP status

### Performance
- [ ] Connection pools properly sized
- [ ] Maps and slices pre-allocated when size known
- [ ] No memory leaks (slices, maps, goroutines)
- [ ] HTTP clients configured with timeouts

### Security
- [ ] No secrets in code or git
- [ ] All HTTP clients have timeouts
- [ ] Input validation at boundaries
- [ ] SQL injection prevented (parameterized queries)

### Scalability
- [ ] Stateless services (no in-memory sessions)
- [ ] Graceful shutdown implemented
- [ ] Database connection pooling configured
- [ ] Horizontal scaling possible

### Maintainability
- [ ] Dependencies injected, not global
- [ ] Configuration externalized
- [ ] Logging at appropriate levels
- [ ] Code organized by domain, not technical layers

---

## Further Reading

**Core Knowledge Base:**
- `../go-proverbs.md` - Philosophical foundation
- `../modern-backend-development.md` - Complete workflow guide
- `../100-go-mistakes.md` - Comprehensive pitfall reference
- `../uber-go-style-guide.md` - Industry-standard style guide

**External Resources:**
- [Effective Go](https://go.dev/doc/effective_go)
- [Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments)
- [Go Blog: Package Names](https://go.dev/blog/package-names)
- [The Twelve-Factor App](https://12factor.net/)

---

**Document Purpose:** Architectural decision-making for Go backend systems
**Target Audience:** System Architects, Tech Leads, Senior Engineers
**Last Updated:** November 2025
