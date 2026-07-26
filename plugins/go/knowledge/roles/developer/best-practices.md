# Go Developer Knowledge Base

**Role Focus:** Day-to-day coding, practical patterns, implementation, and common tasks

**Purpose:** Quick reference for Go developers writing production-quality code

---

## Daily Workflow Essentials

### Development Environment Setup

**Required Tools:**
```bash
# Language server
go install golang.org/x/tools/gopls@latest

# Debugger
go install github.com/go-delve/delve/cmd/dlv@latest

# Linter
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Import management
go install golang.org/x/tools/cmd/goimports@latest

# Hot reload
go install github.com/cosmtrek/air@latest
```

**VS Code settings.json:**
```json
{
  "go.formatTool": "goimports",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports": true
  },
  "go.lintTool": "golangci-lint",
  "go.lintOnSave": "workspace"
}
```

**Hot reload with Air:**
```bash
# Initialize
air init

# Run
air
```

**Reference:** `../modern-backend-development.md` § Development Workflow

---

## Quick Reference: Common Patterns

### Error Handling

**Always wrap errors with context:**

```go
// ✅ GOOD: Context added
user, err := repo.GetByID(ctx, id)
if err != nil {
    return nil, fmt.Errorf("get user %s: %w", id, err)
}

// ❌ BAD: No context
if err != nil {
    return nil, err
}
```

**Check specific errors:**

```go
if errors.Is(err, sql.ErrNoRows) {
    // Handle not found
}

var netErr *net.Error
if errors.As(err, &netErr) {
    if netErr.Timeout() {
        // Handle timeout
    }
}
```

**Never log AND return:**

```go
// ❌ WRONG: Handles error twice
if err != nil {
    log.Printf("Error: %v", err)
    return err
}

// ✅ CORRECT: Return, let caller decide
if err != nil {
    return fmt.Errorf("operation failed: %w", err)
}
```

**Reference:** `../uber-go-style-guide.md` § Errors

---

### Struct Initialization

**Always use field names:**

```go
// ❌ BAD
user := User{"John", "Doe", 30}

// ✅ GOOD
user := User{
    FirstName: "John",
    LastName:  "Doe",
    Age:       30,
}
```

**Omit zero values:**

```go
// ❌ BAD
user := User{
    Name:  "John",
    Email: "",      // Zero value
    Admin: false,   // Zero value
}

// ✅ GOOD
user := User{
    Name: "John",
}
```

**Use `var` for zero-value structs:**

```go
// ❌ BAD
user := User{}

// ✅ GOOD
var user User
```

**Reference:** `../uber-go-style-guide.md` § Initializing Structs

---

### Slices and Maps

**Pre-allocate when size is known:**

```go
// ❌ BAD: Multiple allocations
var items []Item
for i := 0; i < 1000; i++ {
    items = append(items, Item{})
}

// ✅ GOOD: Single allocation
items := make([]Item, 0, 1000)
for i := 0; i < 1000; i++ {
    items = append(items, Item{})
}

// Maps
m := make(map[string]int, expectedSize)
```

**Check length, not nil:**

```go
// ❌ BAD
if slice == nil {
    // ...
}

// ✅ GOOD
if len(slice) == 0 {
    // ...
}
```

**Return nil, not empty slice:**

```go
// ❌ BAD
func getItems() []Item {
    return []Item{}
}

// ✅ GOOD
func getItems() []Item {
    return nil
}
```

**Reference:** `../100-go-mistakes.md` § Data Types

---

### Concurrency Patterns

**Worker pool:**

```go
func processItems(ctx context.Context, items []Item) error {
    workers := runtime.GOMAXPROCS(0)
    jobs := make(chan Item, len(items))
    results := make(chan error, len(items))

    // Start workers
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for item := range jobs {
                if err := process(ctx, item); err != nil {
                    results <- err
                }
            }
        }()
    }

    // Send jobs
    for _, item := range items {
        jobs <- item
    }
    close(jobs)

    // Wait for completion
    go func() {
        wg.Wait()
        close(results)
    }()

    // Collect errors
    for err := range results {
        if err != nil {
            return err
        }
    }

    return nil
}
```

**Always provide exit paths:**

```go
type Worker struct {
    stop chan struct{}
    done chan struct{}
}

func (w *Worker) Start() {
    go func() {
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
    }()
}

func (w *Worker) Stop() {
    close(w.stop)
    <-w.done
}
```

**Reference:** `../100-go-mistakes.md` § Concurrency

---

### HTTP Handlers with Chi

**Basic handler pattern:**

```go
func (h *UserHandler) Get(w http.ResponseWriter, r *http.Request) {
    userID := chi.URLParam(r, "userID")

    user, err := h.service.GetUser(r.Context(), userID)
    if err != nil {
        h.handleError(w, err)
        return
    }

    respondJSON(w, http.StatusOK, user)
}

func (h *UserHandler) handleError(w http.ResponseWriter, err error) {
    switch {
    case errors.Is(err, domain.ErrNotFound):
        http.Error(w, "Not found", http.StatusNotFound)
    case errors.Is(err, domain.ErrUnauthorized):
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
    default:
        log.Printf("Error: %v", err)
        http.Error(w, "Internal error", http.StatusInternalServerError)
    }
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(data)
}
```

**Router setup:**

```go
func New(userHandler *handler.UserHandler) http.Handler {
    r := chi.NewRouter()

    // Global middleware
    r.Use(middleware.RequestID)
    r.Use(middleware.RealIP)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)

    // Routes
    r.Route("/api/v1", func(r chi.Router) {
        // Public routes
        r.Post("/login", userHandler.Login)

        // Protected routes
        r.Group(func(r chi.Router) {
            r.Use(AuthMiddleware)

            r.Route("/users", func(r chi.Router) {
                r.Get("/", userHandler.List)
                r.Post("/", userHandler.Create)
                r.Route("/{userID}", func(r chi.Router) {
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

**Reference:** `../modern-backend-development.md` § HTTP APIs

---

### Database Operations (pgx)

**Query single row:**

```go
func (r *UserRepository) GetByID(ctx context.Context, id string) (*User, error) {
    query := `SELECT id, email, name FROM users WHERE id = $1`

    var user User
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

**Query multiple rows:**

```go
func (r *UserRepository) List(ctx context.Context, limit, offset int) ([]*User, error) {
    query := `
        SELECT id, email, name
        FROM users
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
    `

    rows, err := r.db.Query(ctx, query, limit, offset)
    if err != nil {
        return nil, fmt.Errorf("querying users: %w", err)
    }
    defer rows.Close()

    users := make([]*User, 0)
    for rows.Next() {
        var user User
        if err := rows.Scan(&user.ID, &user.Email, &user.Name); err != nil {
            return nil, fmt.Errorf("scanning user: %w", err)
        }
        users = append(users, &user)
    }

    if err := rows.Err(); err != nil {
        return nil, fmt.Errorf("iterating rows: %w", err)
    }

    return users, nil
}
```

**Insert:**

```go
func (r *UserRepository) Create(ctx context.Context, user *User) error {
    query := `
        INSERT INTO users (id, email, name, created_at)
        VALUES ($1, $2, $3, $4)
    `

    _, err := r.db.Exec(ctx, query, user.ID, user.Email, user.Name, time.Now())
    if err != nil {
        return fmt.Errorf("inserting user: %w", err)
    }

    return nil
}
```

**Transaction:**

```go
func (s *UserService) CreateWithProfile(ctx context.Context, req CreateRequest) error {
    return s.pool.BeginFunc(ctx, func(tx pgx.Tx) error {
        userRepo := postgres.NewUserRepository(tx)
        profileRepo := postgres.NewProfileRepository(tx)

        user := &User{ID: generateID(), Email: req.Email}
        if err := userRepo.Create(ctx, user); err != nil {
            return err // Automatic rollback
        }

        profile := &Profile{UserID: user.ID, Bio: req.Bio}
        if err := profileRepo.Create(ctx, profile); err != nil {
            return err // Automatic rollback
        }

        return nil // Automatic commit
    })
}
```

**Reference:** `../modern-backend-development.md` § Database Integration

---

### JSON Handling

**Always use struct tags:**

```go
type User struct {
    ID        string    `json:"id"`
    Email     string    `json:"email"`
    Name      string    `json:"name"`
    CreatedAt time.Time `json:"created_at"`
}
```

**Omit empty fields:**

```go
type UserResponse struct {
    ID        string    `json:"id"`
    Email     string    `json:"email,omitempty"`
    Name      string    `json:"name,omitempty"`
    CreatedAt time.Time `json:"created_at,omitempty"`
}
```

**Parse request body:**

```go
func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "Invalid request body", http.StatusBadRequest)
        return
    }

    // Validate
    if req.Email == "" {
        http.Error(w, "Email required", http.StatusBadRequest)
        return
    }

    // Process...
}
```

**Reference:** `../100-go-mistakes.md` § Standard Library

---

### Testing Patterns

**Table-driven tests:**

```go
func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        {
            name:    "valid email",
            email:   "user@example.com",
            wantErr: false,
        },
        {
            name:    "missing @ symbol",
            email:   "userexample.com",
            wantErr: true,
        },
        {
            name:    "empty email",
            email:   "",
            wantErr: true,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()

            err := ValidateEmail(tt.email)
            if (err != nil) != tt.wantErr {
                t.Errorf("ValidateEmail() error = %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

**HTTP handler testing:**

```go
func TestUserHandler_Get(t *testing.T) {
    mockService := new(MockUserService)
    handler := NewUserHandler(mockService)

    expectedUser := &User{ID: "123", Name: "John"}
    mockService.On("GetUser", mock.Anything, "123").Return(expectedUser, nil)

    req := httptest.NewRequest("GET", "/users/123", nil)
    rr := httptest.NewRecorder()

    // Test through real router
    r := chi.NewRouter()
    r.Get("/users/{userID}", handler.Get)
    r.ServeHTTP(rr, req)

    if rr.Code != http.StatusOK {
        t.Errorf("Expected status 200, got %d", rr.Code)
    }

    var response User
    json.Unmarshal(rr.Body.Bytes(), &response)
    if response.ID != expectedUser.ID {
        t.Errorf("Expected user ID %s, got %s", expectedUser.ID, response.ID)
    }
}
```

**Reference:** `../modern-backend-development.md` § Testing

---

## Common Mistakes to Avoid

### Variable Shadowing

```go
// ❌ WRONG: Shadows outer variable
var client *http.Client
if tracing {
    client, err := createClient()  // Shadows outer client!
    if err != nil { return err }
}

// ✅ CORRECT: Assigns to outer variable
var client *http.Client
var err error
if tracing {
    client, err = createClient()
    if err != nil { return err }
}
```

### Loop Variable in Goroutines

```go
// ❌ WRONG: All goroutines see last item
for _, item := range items {
    go func() {
        process(item)  // Wrong item!
    }()
}

// ✅ CORRECT: Capture loop variable
for _, item := range items {
    item := item  // Local copy
    go func() {
        process(item)
    }()
}

// ✅ CORRECT: Pass as parameter
for _, item := range items {
    go func(i Item) {
        process(i)
    }(item)
}
```

### Range Loop Modifications

```go
// ❌ WRONG: Modifies copy
accounts := []Account{{Balance: 100}, {Balance: 200}}
for _, a := range accounts {
    a.Balance += 1000  // Modifies copy only!
}

// ✅ CORRECT: Use index
for i := range accounts {
    accounts[i].Balance += 1000
}
```

### Defer in Loops

```go
// ❌ WRONG: Defers accumulate
func processFiles(paths []string) error {
    for _, path := range paths {
        f, err := os.Open(path)
        if err != nil { return err }
        defer f.Close()  // Won't close until function returns!
        // process file
    }
    return nil
}

// ✅ CORRECT: Extract to function
func processFiles(paths []string) error {
    for _, path := range paths {
        if err := processFile(path); err != nil {
            return err
        }
    }
    return nil
}

func processFile(path string) error {
    f, err := os.Open(path)
    if err != nil { return err }
    defer f.Close()  // Closes after this function
    // process file
    return nil
}
```

### Type Assertions Without Check

```go
// ❌ WRONG: Panics on failure
t := i.(string)

// ✅ CORRECT: Check with comma-ok
t, ok := i.(string)
if !ok {
    // Handle error
}
```

**Reference:** `../100-go-mistakes.md` (entire document)

---

## Code Style Checklist

### Naming
- [ ] Use `MixedCaps` for exported names
- [ ] Use `mixedCaps` for unexported names
- [ ] No underscores in names (except test functions)
- [ ] Package names: lowercase, no underscores
- [ ] Don't use `Get` prefix for getters (use `Balance()`, not `GetBalance()`)

### Structure
- [ ] Align happy path to the left
- [ ] Return early for errors
- [ ] Max 3-4 levels of nesting
- [ ] Group similar declarations
- [ ] Two import groups: stdlib, then everything else

### Error Handling
- [ ] Always check errors
- [ ] Wrap errors with context (`%w`)
- [ ] Handle errors once (log OR return)
- [ ] Use `errors.Is()` and `errors.As()` for checking

### Concurrency
- [ ] All goroutines have exit mechanism
- [ ] Use `-race` flag in tests
- [ ] Context passed as first parameter
- [ ] Defer `cancel()` when creating context with timeout

### Performance
- [ ] Pre-allocate slices and maps when size known
- [ ] Use `strings.Builder` for string concatenation in loops
- [ ] Close resources with `defer`
- [ ] Configure HTTP timeouts

**Reference:** `../uber-go-style-guide.md`

---

## Quick Commands

### Running Tests

```bash
# All tests
go test ./...

# With coverage
go test -cover ./...

# With race detector
go test -race ./...

# Specific test
go test -run TestFunctionName

# Verbose
go test -v ./...

# Integration tests (with build tag)
go test -tags=integration ./...
```

### Linting

```bash
# Run all linters
golangci-lint run

# Fast mode
golangci-lint run --fast

# Specific path
golangci-lint run ./internal/...

# Show all issues
golangci-lint run --max-issues-per-linter=0
```

### Formatting

```bash
# Format all files
go fmt ./...

# With goimports (also fixes imports)
goimports -w .

# Check formatting
gofmt -l .
```

### Profiling

```bash
# CPU profile
go test -cpuprofile=cpu.prof -bench=.
go tool pprof cpu.prof

# Memory profile
go test -memprofile=mem.prof -bench=.
go tool pprof mem.prof

# Trace
go test -trace=trace.out
go tool trace trace.out
```

---

## Code Templates

### New HTTP Handler

```go
type UserHandler struct {
    service UserService
    logger  *slog.Logger
}

func NewUserHandler(service UserService, logger *slog.Logger) *UserHandler {
    return &UserHandler{
        service: service,
        logger:  logger,
    }
}

func (h *UserHandler) Get(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")

    user, err := h.service.GetUser(r.Context(), id)
    if err != nil {
        h.handleError(w, err)
        return
    }

    respondJSON(w, http.StatusOK, user)
}

func (h *UserHandler) handleError(w http.ResponseWriter, err error) {
    h.logger.Error("handler error", "error", err)

    switch {
    case errors.Is(err, domain.ErrNotFound):
        http.Error(w, "Not found", http.StatusNotFound)
    default:
        http.Error(w, "Internal error", http.StatusInternalServerError)
    }
}
```

### New Repository

```go
type UserRepository struct {
    db DBTX
}

func NewUserRepository(db DBTX) *UserRepository {
    return &UserRepository{db: db}
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

### New Service

```go
type UserService struct {
    repo   UserRepository
    logger *slog.Logger
}

func NewUserService(repo UserRepository, logger *slog.Logger) *UserService {
    return &UserService{
        repo:   repo,
        logger: logger,
    }
}

func (s *UserService) GetUser(ctx context.Context, id string) (*domain.User, error) {
    user, err := s.repo.GetByID(ctx, id)
    if err != nil {
        return nil, fmt.Errorf("get user %s: %w", id, err)
    }

    return user, nil
}
```

---

## Performance Tips

### String Operations

```go
// ❌ BAD: String concatenation in loop
var s string
for i := 0; i < 1000; i++ {
    s += "x"
}

// ✅ GOOD: strings.Builder
var b strings.Builder
b.Grow(1000)  // Pre-allocate
for i := 0; i < 1000; i++ {
    b.WriteString("x")
}
s := b.String()
```

### String to Bytes

```go
// ❌ BAD: Repeated conversion
for i := 0; i < b.N; i++ {
    w.Write([]byte("Hello world"))
}

// ✅ GOOD: Convert once
data := []byte("Hello world")
for i := 0; i < b.N; i++ {
    w.Write(data)
}
```

### Integer to String

```go
// ❌ BAD: Using fmt
s := fmt.Sprint(42)

// ✅ GOOD: Using strconv (2x faster)
s := strconv.Itoa(42)
```

---

## Debugging Tips

### Print Debugging with slog

```go
import "log/slog"

// Structured logging
slog.Info("processing user",
    "user_id", userID,
    "action", "update",
)

slog.Error("failed to process",
    "error", err,
    "user_id", userID,
)
```

### Using Delve Debugger

```bash
# Start debugger
dlv debug ./cmd/server

# Set breakpoint
(dlv) break main.main
(dlv) break handler.go:42

# Run
(dlv) continue

# Inspect variables
(dlv) print user
(dlv) print user.Email

# Step through
(dlv) next
(dlv) step
(dlv) stepout
```

### Race Detection

```bash
# Run with race detector
go run -race ./cmd/server

# Test with race detector
go test -race ./...
```

---

## Further Reading

**Core Knowledge Base:**
- `../go-proverbs.md` - Philosophy and principles
- `../modern-backend-development.md` - Complete guide
- `../100-go-mistakes.md` - Common pitfalls
- `../uber-go-style-guide.md` - Style guide

**External Resources:**
- [Effective Go](https://go.dev/doc/effective_go)
- [Go by Example](https://gobyexample.com/)
- [Go Documentation](https://go.dev/doc/)

---

**Document Purpose:** Day-to-day Go development quick reference
**Target Audience:** Go Developers (all levels)
**Last Updated:** November 2025
