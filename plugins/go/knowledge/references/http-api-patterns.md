# HTTP/API Patterns

## Introduction

Building robust HTTP clients and APIs requires careful attention to configuration, error handling, and resource management. This document showcases production patterns from Docker's client library.

---

## Example 1: Functional Options for HTTP Clients (Docker)

**Project:** Docker/Moby
**File:** `client/client.go`
**Link:** https://github.com/moby/moby/blob/master/client/client.go

**Pattern:** Composable client configuration.

```go
type Opt func(*Client) error

// Option: Set from environment
func FromEnv(c *Client) error {
    host := os.Getenv("DOCKER_HOST")
    if host != "" {
        if err := WithHost(host)(c); err != nil {
            return err
        }
    }

    version := os.Getenv("DOCKER_API_VERSION")
    if version != "" {
        c.version = version
        c.manualOverride = true
    }

    return nil
}

// Option: Set API version negotiation
func WithAPIVersionNegotiation() Opt {
    return func(c *Client) error {
        c.negotiateVersion = true
        return nil
    }
}

// Option: Set custom host
func WithHost(host string) Opt {
    return func(c *Client) error {
        hostURL, err := ParseHostURL(host)
        if err != nil {
            return err
        }
        c.host = host
        c.proto = hostURL.Scheme
        c.addr = hostURL.Host
        return nil
    }
}

// Usage
cli, err := client.New(
    client.FromEnv,
    client.WithAPIVersionNegotiation(),
)
```

**Why this is excellent:**
- Backward compatible
- Self-documenting
- Composable configuration
- Error handling per option

---

## When to Use

- **Functional options** - For HTTP client configuration with many optional parameters
- **Context-aware requests** - Always accept `context.Context` for cancellation and timeouts
- **Retry logic** - Implement exponential backoff for transient network failures
- **Connection pooling** - Use `http.Client` with appropriate `Transport` settings
- **Request/Response types** - Define clear request and response structs for API endpoints
- **Middleware pattern** - Use `http.Handler` wrapping for cross-cutting concerns (logging, auth, etc.)

**Source Projects:**
- Docker/Moby: https://github.com/moby/moby
