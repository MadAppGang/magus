# Plugin Systems

## Introduction

Plugin systems enable extensibility while maintaining process isolation and API stability. This document showcases production plugin architectures using gRPC and HTTP.

---

## Example 1: gRPC Plugin Architecture (Terraform)

**Project:** Terraform
**File:** `internal/plugin/grpc_provider.go`
**Link:** https://github.com/hashicorp/terraform/blob/main/internal/plugin/grpc_provider.go

**Pattern:** gRPC-based plugin system with process isolation.

```go
type GRPCProvider struct {
    PluginClient *plugin.Client
    TestServer   *grpc.Server
    Addr         addrs.Provider
    client       proto.ProviderClient
    ctx          context.Context
    mu           sync.Mutex
    schema       providers.GetProviderSchemaResponse
}

type GRPCProviderPlugin struct {
    GRPCProvider func() proto.ProviderServer
    Opts         []grpc.ServerOption
}

// Server-side: Register provider
func (p *GRPCProviderPlugin) GRPCServer(broker *plugin.GRPCBroker,
    s *grpc.Server) error {
    proto.RegisterProviderServer(s, p.GRPCProvider())
    return nil
}

// Client-side: Create client
func (p *GRPCProviderPlugin) GRPCClient(ctx context.Context,
    broker *plugin.GRPCBroker, c *grpc.ClientConn) (interface{}, error) {
    return &GRPCProvider{
        client: proto.NewProviderClient(c),
        ctx:    ctx,
    }, nil
}

// Schema caching
func (p *GRPCProvider) GetProviderSchema() providers.GetProviderSchemaResponse {
    p.mu.Lock()
    defer p.mu.Unlock()

    // Check cache
    if !p.Addr.IsZero() {
        if resp, ok := providers.SchemaCache.Get(p.Addr); ok {
            return resp
        }
    }

    // Fetch from provider
    resp := p.getProviderSchemaFromPlugin()

    // Cache result
    if !p.Addr.IsZero() {
        providers.SchemaCache.Set(p.Addr, resp)
    }

    return resp
}
```

**Why this is excellent:**
- Process isolation via gRPC
- Schema caching reduces RPC calls
- Protocol buffer serialization
- Bidirectional client/server support
- Clean plugin lifecycle

---

## Example 2: HTTP Plugin Client (Docker/Moby)

**Project:** Docker/Moby
**File:** `pkg/plugins/client.go`
**Link:** https://github.com/moby/moby/blob/master/pkg/plugins/client.go

**Pattern:** HTTP-over-Unix-socket plugin communication.

```go
type Client struct {
    http            *http.Client
    requestFactory  requestFactory
}

type requestFactory interface {
    NewRequest(path string, data io.Reader) (*http.Request, error)
}

func NewClient(addr string, tlsConfig *tlsconfig.Options) (*Client, error) {
    return NewClientWithTimeout(addr, tlsConfig, 0)
}

func NewClientWithTimeout(addr string, tlsConfig *tlsconfig.Options,
    timeout time.Duration) (*Client, error) {

    tr, err := newTransport(addr, tlsConfig)
    if err != nil {
        return nil, err
    }

    return &Client{
        http: &http.Client{
            Transport: tr,
            Timeout:   timeout,
        },
        requestFactory: newRequestFactory(addr),
    }, nil
}

// Call: RPC-style request-response
func (c *Client) Call(serviceMethod string, args, ret interface{}) error {
    body, err := json.Marshal(args)
    if err != nil {
        return err
    }

    req, err := c.requestFactory.NewRequest(serviceMethod, bytes.NewReader(body))
    if err != nil {
        return err
    }

    resp, err := c.http.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    return json.NewDecoder(resp.Body).Decode(ret)
}

// Stream: Returns raw response body
func (c *Client) Stream(serviceMethod string, args interface{}) (io.ReadCloser, error) {
    // Similar to Call but returns response body
}

// SendFile: Passes through IO stream
func (c *Client) SendFile(serviceMethod string, data io.Reader, ret interface{}) error {
    // Streams file to plugin
}
```

**Why this is excellent:**
- Simple HTTP-based protocol
- Unix socket for local plugins
- Multiple communication patterns (RPC, streaming, file transfer)
- Retry logic with exponential backoff
- Transport abstraction enables testing

---

## When to Use

- **gRPC plugins** - For high-performance, strongly-typed plugin interfaces
- **HTTP plugins** - For simpler plugins with JSON payloads
- **Process isolation** - Run plugins in separate processes for crash isolation
- **Schema caching** - Cache plugin metadata to reduce RPC overhead
- **Unix sockets** - For local plugin communication (lower overhead than TCP)
- **Bidirectional streaming** - When plugins need to communicate with the host

**Source Projects:**
- Terraform: https://github.com/hashicorp/terraform
- Docker/Moby: https://github.com/moby/moby
