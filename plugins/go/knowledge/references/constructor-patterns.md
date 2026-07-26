# Constructor Patterns

## Introduction

Go doesn't have traditional constructors, but the community has developed several elegant patterns for initializing complex objects. This document showcases production-tested constructor patterns that handle configuration, resource management, and circular dependencies.

---

## Example 1: Factory Functions with Options (Docker Client)

**Project:** Docker/Moby
**File:** `client/client.go`
**Link:** https://github.com/moby/moby/blob/master/client/client.go

**Pattern:** Functional options pattern for flexible initialization.

```go
func New(ops ...Opt) (*Client, error) {
    hostURL, err := ParseHostURL(DefaultDockerHost)
    if err != nil {
        return nil, err
    }

    client, err := defaultHTTPClient(hostURL)
    if err != nil {
        return nil, err
    }

    c := &Client{
        clientConfig: clientConfig{
            host:    DefaultDockerHost,
            version: MaxAPIVersion,
            client:  client,
            proto:   hostURL.Scheme,
            addr:    hostURL.Host,
        },
    }

    // Apply functional options
    for _, op := range ops {
        if err := op(&c.clientConfig); err != nil {
            return nil, err
        }
    }

    return c, nil
}

// Usage
cli, err := client.New(
    client.FromEnv,
    client.WithAPIVersionNegotiation(),
)
```

**Why this is excellent:**
- Backward compatible (adding options doesn't break API)
- Self-documenting through option names
- Sensible defaults with opt-in customization
- Composable configuration

---

## Example 2: Simple Factory with Resource Management (database/sql)

**Project:** Go Standard Library
**File:** `src/database/sql/sql.go`
**Link:** https://github.com/golang/go/blob/master/src/database/sql/sql.go

**Pattern:** Constructor launches background goroutine for connection pool management.

```go
func OpenDB(c driver.Connector) *DB {
    ctx, cancel := context.WithCancel(context.Background())
    db := &DB{
        connector: c,
        openerCh:  make(chan struct{}, connectionRequestQueueSize),
        lastPut:   make(map[*driverConn]string),
        stop:      cancel,
    }
    go db.connectionOpener(ctx)
    return db
}

func Open(driverName, dataSourceName string) (*DB, error) {
    driversMu.RLock()
    driveri, ok := drivers[driverName]
    driversMu.RUnlock()

    if !ok {
        return nil, fmt.Errorf("sql: unknown driver %q", driverName)
    }

    // Create connector and initialize
    // ...
    return OpenDB(connector), nil
}
```

**Why this is excellent:**
- Encapsulates background resource management
- Clear ownership of goroutines (stopped via context)
- Separation between connector creation and DB initialization
- Error handling at appropriate layer

---

## Example 3: Multi-Stage Initialization (Hugo)

**Project:** Hugo
**File:** `hugolib/site.go`
**Link:** https://github.com/gohugoio/hugo/blob/master/hugolib/site.go

**Pattern:** Constructor with deferred initialization for circular dependencies.

```go
type Site struct {
    state siteState
    conf *allconfig.Config
    language *langs.Language
    store *hstore.Scratch
    siteWrapped page.Site
    h *HugoSites
    *deps.Deps
    *siteLanguageVersionRole
    relatedDocsHandler *page.RelatedDocsHandler
    publisher publisher.Publisher
    frontmatterHandler pagemeta.FrontMatterHandler
}

// NewHugoSites creates the HugoSites container
func NewHugoSites(cfg deps.DepsCfg) (*HugoSites, error) {
    // 1. Create logger and dependencies
    logger := // ... setup logger
    memCache := // ... setup cache

    // 2. Build individual Site structs for each language
    sites := make([]*Site, len(languages))
    for i, lang := range languages {
        sites[i] = &Site{
            language: lang,
            conf: cfg,
            // ... partial initialization
        }
    }

    // 3. Create container
    h := &HugoSites{
        Sites: sites,
        // ...
    }

    // 4. Back-reference container in sites
    for _, s := range sites {
        s.h = h
    }

    // 5. Complete initialization (templates, etc.)
    // This handles circular dependencies

    return h, nil
}
```

**Why this is excellent:**
- Handles circular dependencies cleanly
- Phases are explicit and ordered
- Partial initialization enables setting up relationships
- Deferred compilation happens after structure is complete

---

## Example 4: Plugin Client Constructor (Docker/Moby)

**Project:** Docker/Moby
**File:** `pkg/plugins/client.go`
**Link:** https://github.com/moby/moby/blob/master/pkg/plugins/client.go

**Pattern:** Constructor with transport abstraction and timeout control.

```go
type Client struct {
    http            *http.Client
    requestFactory  requestFactory
}

type requestFactory interface {
    NewRequest(path string, data io.Reader) (*http.Request, error)
}

// Basic constructor
func NewClient(addr string, tlsConfig *tlsconfig.Options) (*Client, error) {
    return NewClientWithTimeout(addr, tlsConfig, 0)
}

// Constructor with timeout control
func NewClientWithTimeout(addr string, tlsConfig *tlsconfig.Options,
    timeout time.Duration) (*Client, error) {

    // Create transport based on address scheme
    tr, err := newTransport(addr, tlsConfig)
    if err != nil {
        return nil, err
    }

    // Build HTTP client with timeout
    httpClient := &http.Client{
        Transport: tr,
        Timeout: timeout,
    }

    // Create request factory for the protocol
    requestFactory := newRequestFactory(addr)

    return &Client{
        http: httpClient,
        requestFactory: requestFactory,
    }, nil
}
```

**Why this is excellent:**
- Transport abstraction (Unix sockets, TCP, etc.)
- Timeout configuration at constructor level
- Interface-based request factory enables testing
- Simple variant delegates to complex variant

---

## Example 5: Buffer Pool Factory (Docker/Moby)

**Project:** Docker/Moby
**File:** `pkg/pools/pools.go`
**Link:** https://github.com/moby/moby/blob/master/pkg/pools/pools.go

**Pattern:** Factory function for object pools.

```go
type BufioReaderPool struct {
    pool sync.Pool
}

func newBufioReaderPoolWithSize(size int) *BufioReaderPool {
    return &BufioReaderPool{
        pool: sync.Pool{
            New: func() any {
                return bufio.NewReaderSize(nil, size)
            },
        },
    }
}

// Pre-configured pool instances
var (
    BufioReader32KPool = newBufioReaderPoolWithSize(32 * 1024)
)

// Usage pattern
func (bufPool *BufioReaderPool) Get(r io.Reader) *bufio.Reader {
    buf := bufPool.pool.Get().(*bufio.Reader)
    buf.Reset(r)
    return buf
}

func (bufPool *BufioReaderPool) Put(b *bufio.Reader) {
    b.Reset(nil)
    bufPool.pool.Put(b)
}
```

**Why this is excellent:**
- Encapsulates sync.Pool complexity
- Type-safe Get/Put methods
- Pre-configured instances for common sizes
- Reset pattern prevents data leakage

---

## When to Use

- **Functional options** - When you have many optional configuration parameters
- **Factory functions** - Always prefer `NewX()` over exported struct literals
- **Multi-stage initialization** - For complex objects with circular dependencies
- **Resource management** - Launch goroutines and register cleanup in constructors
- **Object pooling** - Use factory functions to create pre-configured pools

**Source Projects:**
- Docker/Moby: https://github.com/moby/moby
- Go Standard Library: https://github.com/golang/go
- Hugo: https://github.com/gohugoio/hugo
