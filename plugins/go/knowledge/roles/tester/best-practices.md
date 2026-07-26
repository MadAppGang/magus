# Go Tester Knowledge Base

**Role Focus:** Testing strategies, quality assurance, test patterns, and comprehensive testing

**Purpose:** Guide for writing effective tests and ensuring code quality

---

## Testing Philosophy

### Testing Pyramid

```
       /\
      /  \     E2E Tests (Few)
     /----\
    /      \   Integration Tests (Some)
   /--------\
  /          \ Unit Tests (Many)
 /____________\
```

**Distribution:**
- **70%** Unit Tests - Fast, isolated, many
- **20%** Integration Tests - Real dependencies, moderate
- **10%** E2E Tests - Full system, slow, few

### Core Principles

1. **Fast Feedback** - Tests should run quickly
2. **Reliable** - No flaky tests
3. **Maintainable** - Easy to understand and update
4. **Comprehensive** - Cover edge cases and error paths
5. **Isolated** - Tests don't depend on each other

---

## Unit Testing

### Table-Driven Tests (The Standard Pattern)

**Why Table-Driven?**
- Reduces code duplication
- Easy to add new test cases
- Clear test documentation
- Facilitates parallel testing

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
        {
            name:    "only @ symbol",
            email:   "@",
            want:    false,
            wantErr: true,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()  // Run subtests in parallel

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

**Test Table Conventions:**
- Slice named `tests`
- Each test case: `tt`
- Input values: `give` or descriptive name
- Output values: `want` or `wantX`
- Error expectations: `wantErr`

**Reference:** `../uber-go-style-guide.md` § Test Tables

---

### Testing Error Cases

**Always test error paths:**

```go
func TestProcessData(t *testing.T) {
    tests := []struct {
        name    string
        input   Data
        wantErr error
    }{
        {
            name:    "valid data",
            input:   Data{Value: 42},
            wantErr: nil,
        },
        {
            name:    "negative value",
            input:   Data{Value: -1},
            wantErr: ErrInvalidValue,
        },
        {
            name:    "zero value",
            input:   Data{Value: 0},
            wantErr: ErrEmptyValue,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ProcessData(tt.input)

            if tt.wantErr != nil {
                if !errors.Is(err, tt.wantErr) {
                    t.Errorf("ProcessData() error = %v, want %v", err, tt.wantErr)
                }
            } else if err != nil {
                t.Errorf("ProcessData() unexpected error = %v", err)
            }
        })
    }
}
```

---

### Mocking Interfaces

**Using testify/mock:**

```go
// Mock implementation
type MockUserRepository struct {
    mock.Mock
}

func (m *MockUserRepository) GetByID(ctx context.Context, id string) (*User, error) {
    args := m.Called(ctx, id)
    if args.Get(0) == nil {
        return nil, args.Error(1)
    }
    return args.Get(0).(*User), args.Error(1)
}

// Test with mock
func TestUserService_GetUser(t *testing.T) {
    mockRepo := new(MockUserRepository)
    service := NewUserService(mockRepo)

    expectedUser := &User{ID: "123", Name: "John"}
    mockRepo.On("GetByID", mock.Anything, "123").Return(expectedUser, nil)

    user, err := service.GetUser(context.Background(), "123")

    require.NoError(t, err)
    require.Equal(t, expectedUser, user)
    mockRepo.AssertExpectations(t)
}
```

**Manual Mocks (Alternative):**

```go
type mockUserRepository struct {
    getByIDFunc func(ctx context.Context, id string) (*User, error)
}

func (m *mockUserRepository) GetByID(ctx context.Context, id string) (*User, error) {
    if m.getByIDFunc != nil {
        return m.getByIDFunc(ctx, id)
    }
    return nil, nil
}

// Test
func TestUserService_GetUser_NotFound(t *testing.T) {
    repo := &mockUserRepository{
        getByIDFunc: func(ctx context.Context, id string) (*User, error) {
            return nil, ErrNotFound
        },
    }
    service := NewUserService(repo)

    _, err := service.GetUser(context.Background(), "123")

    require.ErrorIs(t, err, ErrNotFound)
}
```

**Reference:** `../modern-backend-development.md` § Testing

---

### Testing HTTP Handlers

**Using httptest:**

```go
func TestUserHandler_Get(t *testing.T) {
    tests := []struct {
        name           string
        userID         string
        mockUser       *User
        mockErr        error
        wantStatusCode int
    }{
        {
            name:           "success",
            userID:         "123",
            mockUser:       &User{ID: "123", Name: "John"},
            mockErr:        nil,
            wantStatusCode: http.StatusOK,
        },
        {
            name:           "not found",
            userID:         "999",
            mockUser:       nil,
            mockErr:        domain.ErrNotFound,
            wantStatusCode: http.StatusNotFound,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // Setup mock
            mockService := new(MockUserService)
            mockService.On("GetUser", mock.Anything, tt.userID).
                Return(tt.mockUser, tt.mockErr)

            handler := NewUserHandler(mockService)

            // Create request
            req := httptest.NewRequest("GET", "/users/"+tt.userID, nil)
            rr := httptest.NewRecorder()

            // Setup Chi router
            r := chi.NewRouter()
            r.Get("/users/{userID}", handler.Get)

            // Serve
            r.ServeHTTP(rr, req)

            // Assert
            if rr.Code != tt.wantStatusCode {
                t.Errorf("status = %v, want %v", rr.Code, tt.wantStatusCode)
            }

            if tt.wantStatusCode == http.StatusOK {
                var response User
                err := json.Unmarshal(rr.Body.Bytes(), &response)
                require.NoError(t, err)
                require.Equal(t, tt.mockUser.ID, response.ID)
            }
        })
    }
}
```

**Helper for Chi URL params:**

```go
func withURLParams(r *http.Request, params map[string]string) *http.Request {
    rctx := chi.NewRouteContext()
    for key, value := range params {
        rctx.URLParams.Add(key, value)
    }
    return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// Usage
req := httptest.NewRequest("GET", "/users/123", nil)
req = withURLParams(req, map[string]string{"userID": "123"})
handler.Get(rr, req)
```

---

## Integration Testing

### Database Testing with testcontainers

**Setup:**

```go
//go:build integration

package integration_test

import (
    "context"
    "testing"
    "github.com/testcontainers/testcontainers-go"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

func TestUserRepository_Integration(t *testing.T) {
    ctx := context.Background()

    // Start PostgreSQL container
    postgresContainer, err := postgres.RunContainer(ctx,
        testcontainers.WithImage("postgres:15"),
        postgres.WithDatabase("testdb"),
        postgres.WithUsername("testuser"),
        postgres.WithPassword("testpass"),
    )
    if err != nil {
        t.Fatal(err)
    }
    defer postgresContainer.Terminate(ctx)

    // Get connection string
    connStr, err := postgresContainer.ConnectionString(ctx)
    if err != nil {
        t.Fatal(err)
    }

    // Create connection pool
    pool, err := pgxpool.New(ctx, connStr)
    if err != nil {
        t.Fatal(err)
    }
    defer pool.Close()

    // Run migrations
    if err := runMigrations(pool); err != nil {
        t.Fatal(err)
    }

    // Create repository
    repo := postgres.NewUserRepository(pool)

    // Run test
    user := &User{
        ID:    "test-123",
        Email: "test@example.com",
        Name:  "Test User",
    }

    err = repo.Create(ctx, user)
    require.NoError(t, err)

    retrieved, err := repo.GetByID(ctx, user.ID)
    require.NoError(t, err)
    require.Equal(t, user.Email, retrieved.Email)
}
```

**Build tags for integration tests:**

```go
//go:build integration

package integration_test

// This file only compiles when -tags=integration is specified
```

**Running integration tests:**

```bash
# Run only unit tests (default)
go test ./...

# Run only integration tests
go test -tags=integration ./...

# Run all tests
go test -tags=integration ./...
```

**Reference:** `../modern-backend-development.md` § Integration Testing

---

### Testing Transactions

```go
//go:build integration

func TestUserService_CreateWithProfile_Transaction(t *testing.T) {
    pool := setupTestDB(t)
    defer pool.Close()

    service := NewUserService(pool)

    t.Run("success - both created", func(t *testing.T) {
        req := CreateRequest{
            Email: "test@example.com",
            Name:  "Test User",
            Bio:   "Test bio",
        }

        err := service.CreateWithProfile(context.Background(), req)
        require.NoError(t, err)

        // Verify both user and profile exist
        // ...
    })

    t.Run("rollback - profile creation fails", func(t *testing.T) {
        req := CreateRequest{
            Email: "test2@example.com",
            Name:  "Test User 2",
            Bio:   strings.Repeat("x", 10000), // Too long, will fail
        }

        err := service.CreateWithProfile(context.Background(), req)
        require.Error(t, err)

        // Verify neither user nor profile exist (transaction rolled back)
        users, _ := getUserByEmail(pool, req.Email)
        require.Nil(t, users)
    })
}
```

---

### MongoDB Integration Testing

```go
//go:build integration

func TestUserRepository_MongoDB(t *testing.T) {
    ctx := context.Background()

    // Start MongoDB container
    mongoContainer, err := mongodb.RunContainer(ctx,
        testcontainers.WithImage("mongo:7"),
    )
    if err != nil {
        t.Fatal(err)
    }
    defer mongoContainer.Terminate(ctx)

    // Get connection string
    connStr, err := mongoContainer.ConnectionString(ctx)
    if err != nil {
        t.Fatal(err)
    }

    // Create client
    client, err := mongo.Connect(ctx, options.Client().ApplyURI(connStr))
    if err != nil {
        t.Fatal(err)
    }
    defer client.Disconnect(ctx)

    // Create repository
    repo := NewUserRepository(client.Database("testdb"))

    // Run tests
    user := &User{
        ID:    "test-123",
        Email: "test@example.com",
        Name:  "Test User",
    }

    err = repo.Create(ctx, user)
    require.NoError(t, err)

    retrieved, err := repo.GetByID(ctx, user.ID)
    require.NoError(t, err)
    require.Equal(t, user.Email, retrieved.Email)
}
```

---

## Concurrency Testing

### Race Detection

**Always run tests with `-race` flag:**

```bash
# Run tests with race detector
go test -race ./...

# Run specific test with race detector
go test -race -run TestConcurrent

# Run in CI
go test -race -v ./...
```

**Example race test:**

```go
func TestCache_Concurrent(t *testing.T) {
    cache := NewCache()

    // Run concurrent operations
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(2)

        // Concurrent writes
        go func(n int) {
            defer wg.Done()
            cache.Set(fmt.Sprintf("key-%d", n), n)
        }(i)

        // Concurrent reads
        go func(n int) {
            defer wg.Done()
            _, _ = cache.Get(fmt.Sprintf("key-%d", n))
        }(i)
    }

    wg.Wait()
}
```

---

### Testing Goroutine Cleanup

```go
func TestWorker_Shutdown(t *testing.T) {
    worker := NewWorker()
    worker.Start()

    // Let it run briefly
    time.Sleep(100 * time.Millisecond)

    // Shutdown
    done := make(chan struct{})
    go func() {
        worker.Shutdown()
        close(done)
    }()

    // Should complete within reasonable time
    select {
    case <-done:
        // Success
    case <-time.After(5 * time.Second):
        t.Fatal("Shutdown timed out")
    }

    // Verify goroutine stopped (use goleak)
}
```

---

### Goroutine Leak Detection (goleak)

```bash
go get go.uber.org/goleak
```

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}

func TestWorker_NoLeaks(t *testing.T) {
    defer goleak.VerifyNone(t)

    worker := NewWorker()
    worker.Start()
    worker.Shutdown()

    // If any goroutines leaked, test fails
}
```

**Reference:** `../100-go-mistakes.md` § Concurrency

---

## Testing Best Practices

### 1. Avoid time.Sleep

**❌ BAD: Flaky tests with sleep**

```go
func TestAsync(t *testing.T) {
    go asyncOperation()
    time.Sleep(100 * time.Millisecond)  // Flaky!
    // assert result
}
```

**✅ GOOD: Channel synchronization**

```go
func TestAsync(t *testing.T) {
    done := make(chan struct{})
    go func() {
        asyncOperation()
        close(done)
    }()

    select {
    case <-done:
        // Success
    case <-time.After(5 * time.Second):
        t.Fatal("Timeout")
    }
}
```

**✅ GOOD: Polling with timeout**

```go
func TestAsync(t *testing.T) {
    go asyncOperation()

    timeout := time.After(5 * time.Second)
    tick := time.NewTicker(10 * time.Millisecond)
    defer tick.Stop()

    for {
        select {
        case <-timeout:
            t.Fatal("Timeout waiting for condition")
        case <-tick.C:
            if checkCondition() {
                return
            }
        }
    }
}
```

**Reference:** `../100-go-mistakes.md` § Testing

---

### 2. Use Test Helpers

```go
// Helper function marked with tb.Helper()
func assertEqual(tb testing.TB, got, want interface{}) {
    tb.Helper()  // Marks this as helper, reports caller line
    if !reflect.DeepEqual(got, want) {
        tb.Errorf("got %v; want %v", got, want)
    }
}

func assertNoError(tb testing.TB, err error) {
    tb.Helper()
    if err != nil {
        tb.Fatalf("unexpected error: %v", err)
    }
}

// Usage in test
func TestSomething(t *testing.T) {
    result := doSomething()
    assertEqual(t, result, expected)  // Error reports test line, not helper line
}
```

---

### 3. Parallel Tests

```go
func TestParallel(t *testing.T) {
    tests := []struct {
        name string
        // ...
    }{
        // test cases
    }

    for _, tt := range tests {
        tt := tt  // Capture range variable
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()  // Run in parallel

            // Test logic
        })
    }
}
```

**When to use `t.Parallel()`:**
- Tests are independent
- No shared state
- No order dependencies
- Speeds up test suite

**When NOT to use:**
- Tests modify global state
- Tests use same external resource
- Integration tests with shared database

---

### 4. Subtests for Setup/Teardown

```go
func TestDatabase(t *testing.T) {
    // Setup once for all subtests
    db := setupTestDB(t)
    defer db.Close()

    t.Run("Create", func(t *testing.T) {
        // Test create
    })

    t.Run("Read", func(t *testing.T) {
        // Test read
    })

    t.Run("Update", func(t *testing.T) {
        // Test update
    })

    t.Run("Delete", func(t *testing.T) {
        // Test delete
    })
}
```

---

## Benchmark Testing

### Writing Benchmarks

```go
func BenchmarkProcessData(b *testing.B) {
    // Setup (not timed)
    data := setupLargeDataset()

    b.ResetTimer()  // Reset timer after setup

    // Benchmark loop
    var result Result
    for i := 0; i < b.N; i++ {
        result = ProcessData(data)
    }

    _ = result  // Prevent compiler optimization
}
```

### Benchmarking with Different Inputs

```go
func BenchmarkProcessData(b *testing.B) {
    benchmarks := []struct {
        name string
        size int
    }{
        {"Small", 100},
        {"Medium", 1000},
        {"Large", 10000},
    }

    for _, bm := range benchmarks {
        b.Run(bm.name, func(b *testing.B) {
            data := generateData(bm.size)
            b.ResetTimer()

            for i := 0; i < b.N; i++ {
                ProcessData(data)
            }
        })
    }
}
```

### Running Benchmarks

```bash
# Run all benchmarks
go test -bench=.

# Run specific benchmark
go test -bench=BenchmarkProcessData

# With memory stats
go test -bench=. -benchmem

# Multiple runs for accuracy
go test -bench=. -count=5

# Compare results
go test -bench=. -count=10 | tee old.txt
# Make changes
go test -bench=. -count=10 | tee new.txt
benchstat old.txt new.txt
```

**Reference:** `../100-go-mistakes.md` § Testing

---

## Test Coverage

### Generating Coverage Reports

```bash
# Generate coverage
go test -coverprofile=coverage.out ./...

# View coverage report
go tool cover -html=coverage.out

# Coverage per package
go test -cover ./...

# Detailed coverage
go test -coverprofile=coverage.out ./...
go tool cover -func=coverage.out
```

### Coverage Guidelines

**Target Coverage:**
- **80%+** overall code coverage
- **100%** critical business logic
- **100%** error handling paths
- **Lower OK** for trivial code (getters/setters)

**Don't chase 100%:**
- Diminishing returns
- Can lead to meaningless tests
- Focus on meaningful coverage

**What to cover:**
- ✅ Business logic
- ✅ Error paths
- ✅ Edge cases
- ✅ Boundary conditions

**What's OK to skip:**
- Simple getters/setters
- Generated code
- Main function (test separately)

---

## Test Organization

### File Structure

```
myproject/
├── internal/
│   ├── service/
│   │   ├── user.go
│   │   ├── user_test.go          # Unit tests
│   │   └── user_integration_test.go  # Integration tests
│   └── handler/
│       ├── user.go
│       └── user_test.go
└── test/
    ├── integration/               # Shared integration tests
    │   └── api_test.go
    ├── e2e/                      # E2E tests
    │   └── user_flow_test.go
    └── fixtures/                 # Test data
        └── users.json
```

### Test Package Naming

**Same package (whitebox testing):**
```go
package service

// Access unexported functions
func TestInternalFunction(t *testing.T) {
    result := internalFunction()
    // ...
}
```

**Separate package (blackbox testing):**
```go
package service_test

import "myproject/internal/service"

// Only test exported API
func TestUserService_GetUser(t *testing.T) {
    svc := service.NewUserService(...)
    // ...
}
```

**When to use each:**
- **Same package:** Testing implementation details, internal logic
- **Separate package:** Testing public API, integration points

---

## Testing Checklist

### Before Submitting Code

- [ ] All tests pass locally
- [ ] Tests pass with `-race` flag
- [ ] New code has tests (unit and integration)
- [ ] Error paths tested
- [ ] Edge cases covered
- [ ] No `time.Sleep` in tests
- [ ] Tests are deterministic (no random failures)
- [ ] Coverage meets project standards (80%+)
- [ ] Integration tests added for database/external services
- [ ] Benchmarks added for performance-critical code

### Test Quality Checks

- [ ] Tests have clear names describing what they test
- [ ] Table-driven tests used for multiple scenarios
- [ ] Tests are independent (can run in any order)
- [ ] Tests clean up after themselves
- [ ] Mocks used appropriately (not over-mocked)
- [ ] Tests are fast (unit tests < 100ms each)
- [ ] No flaky tests (run 10 times to verify)

---

## Common Testing Mistakes

### 1. Testing Implementation, Not Behavior

**❌ BAD:**
```go
func TestCache_InternalState(t *testing.T) {
    cache := NewCache()
    cache.Set("key", "value")

    // Testing internal implementation
    if len(cache.items) != 1 {
        t.Error("expected 1 item in internal map")
    }
}
```

**✅ GOOD:**
```go
func TestCache_SetAndGet(t *testing.T) {
    cache := NewCache()
    cache.Set("key", "value")

    // Testing behavior
    got, ok := cache.Get("key")
    if !ok {
        t.Error("expected key to exist")
    }
    if got != "value" {
        t.Errorf("got %v, want %v", got, "value")
    }
}
```

### 2. Over-Mocking

**❌ BAD:**
```go
// Mocking everything, even simple types
mockTime := new(MockTime)
mockLogger := new(MockLogger)
mockConfig := new(MockConfig)
mockValidator := new(MockValidator)

service := NewService(mockTime, mockLogger, mockConfig, mockValidator)
```

**✅ GOOD:**
```go
// Only mock external dependencies
mockRepo := new(MockRepository)
service := NewService(mockRepo, realLogger, realConfig)
```

### 3. Not Testing Error Cases

**❌ BAD:**
```go
func TestProcessData(t *testing.T) {
    result := ProcessData(validInput)
    // Only tests happy path
}
```

**✅ GOOD:**
```go
func TestProcessData(t *testing.T) {
    tests := []struct {
        name    string
        input   Data
        wantErr error
    }{
        {"valid input", validData, nil},
        {"invalid input", invalidData, ErrInvalid},
        {"empty input", emptyData, ErrEmpty},
        {"nil input", nil, ErrNil},
    }
    // Tests all paths
}
```

---

## Advanced Testing Patterns

### Testing Context Cancellation

```go
func TestOperation_Cancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())

    resultCh := make(chan error, 1)
    go func() {
        resultCh <- longRunningOperation(ctx)
    }()

    // Cancel immediately
    cancel()

    select {
    case err := <-resultCh:
        if !errors.Is(err, context.Canceled) {
            t.Errorf("expected context.Canceled, got %v", err)
        }
    case <-time.After(5 * time.Second):
        t.Fatal("operation didn't respond to cancellation")
    }
}
```

### Testing Timeouts

```go
func TestOperation_Timeout(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()

    err := operationThatShouldTimeout(ctx)

    if !errors.Is(err, context.DeadlineExceeded) {
        t.Errorf("expected DeadlineExceeded, got %v", err)
    }
}
```

### Testing Retry Logic

```go
func TestRetryOperation(t *testing.T) {
    attempts := 0
    operation := func() error {
        attempts++
        if attempts < 3 {
            return errors.New("temporary error")
        }
        return nil
    }

    err := RetryOperation(operation, 5, 10*time.Millisecond)

    require.NoError(t, err)
    require.Equal(t, 3, attempts, "should retry until success")
}
```

---

## Test Data Management

### Fixtures

```go
// test/fixtures/users.go
package fixtures

func ValidUser() *User {
    return &User{
        ID:    "test-user-1",
        Email: "test@example.com",
        Name:  "Test User",
    }
}

func InvalidUser() *User {
    return &User{
        ID:    "",
        Email: "invalid",
        Name:  "",
    }
}

// Usage in tests
func TestUserService(t *testing.T) {
    user := fixtures.ValidUser()
    // ...
}
```

### Golden Files

```go
func TestRenderHTML(t *testing.T) {
    result := RenderHTML(testData)

    goldenFile := "testdata/expected.html"

    // Update golden file if -update flag
    if *update {
        os.WriteFile(goldenFile, result, 0644)
        return
    }

    // Compare with golden file
    expected, err := os.ReadFile(goldenFile)
    require.NoError(t, err)

    if !bytes.Equal(result, expected) {
        t.Errorf("output doesn't match golden file")
    }
}
```

---

## Further Reading

**Core Knowledge Base:**
- `../modern-backend-development.md` § Testing Strategy
- `../100-go-mistakes.md` § Testing
- `../uber-go-style-guide.md` § Test Tables

**External Resources:**
- [Go Testing Documentation](https://pkg.go.dev/testing)
- [testify Documentation](https://github.com/stretchr/testify)
- [testcontainers-go](https://golang.testcontainers.org/)
- [goleak](https://github.com/uber-go/goleak)

---

**Document Purpose:** Comprehensive testing guide for Go
**Target Audience:** QA Engineers, Developers, Test Automation Engineers
**Last Updated:** November 2025
