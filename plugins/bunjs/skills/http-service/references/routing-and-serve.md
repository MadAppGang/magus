# `Bun.serve` routing — MEASURED on 1.3.10

Everything here was confirmed against a live ephemeral-port server, not recalled from docs.

## Route precedence

Declared in this order, with these requests:

```ts
routes: {
  "/a/:id":    () => new Response("param"),
  "/a/static": () => new Response("static"),
  "/a/*":      () => new Response("wildcard"),
  "/b/*":      () => new Response("b-wildcard"),
  "/b/deep/x": () => new Response("b-exact"),
}
```

| Request | Matched | Shows |
|---|---|---|
| `/a/static` | **static** | an exact segment beats `:param` |
| `/a/123` | **param** | `:param` beats `*` |
| `/a/x/y` | **wildcard** | `:param` is **one segment only**; deeper paths fall to `*` |
| `/b/deep/x` | **b-exact** | an exact route beats `*` regardless of declaration order |
| `/b/other` | b-wildcard | `*` catches the rest |

**Precedence is `exact > :param > *`, and it is independent of declaration order** — you cannot
shadow a route by declaring it first. That is the opposite of Express, where order decides.

## Params

```ts
"/things/:a/:b": (req) => Response.json({ params: req.params })   // { a: "x", b: "y" }
```

`req.params` is typed from the route string — `req.params.id` autocompletes and a typo is a
compile error. This typing is the main reason to keep `routes` instead of hand-rolling dispatch.

**The wildcard captures nothing.** MEASURED: `"/wild/*"` on `/wild/a/b/c` matched, but
`req.params` was `{}`. To read the tail:

```ts
"/files/*": (req) => {
  const path = new URL(req.url).pathname.slice("/files/".length);
  …
}
```

## Method maps do not 405

```ts
"/things": { GET: list, POST: create }
```

MEASURED: a `PUT` to `/things` **falls through to `fetch()`** — no automatic 405. Whatever your
fallback returns (usually 404) is what the client sees, which misreports "the verb is wrong" as
"the resource does not exist". Use `allowMethods()` from `assets/http/middleware.ts`.

## Static `Response` values

```ts
"/health": new Response("ok")
```

MEASURED reusable — repeat requests all return 200 `ok`; the body is not consumed. This is the
cheapest possible health endpoint: no handler invocation, no allocation per hit.

It is evaluated **once at startup**, so it cannot reflect changing state. A readiness endpoint that
must report live status needs a real handler.

## `reload()` replaces the whole table

MEASURED: after `server.reload({ routes: { "/health": … } })`, a previously-registered
`/users/:id` returned **404**. `reload` is a *replacement*, not a merge.

```ts
server.reload({ routes: { ...allRoutes, ...changedRoutes } });   // always spread the full table
```

This matters for hot reload in development, where a partial reload silently deletes most of your API.

## `stop()` semantics

| Call | Behaviour |
|---|---|
| `server.stop()` | Promise resolving **after in-flight requests finish** — the graceful drain |
| `server.stop(true)` | force-closes active connections immediately |

MEASURED: a 300 ms request, signalled at t+80 ms, drained in **226 ms** — the server waited.

Note `Object.keys(server)` is `""`; everything (`stop`, `reload`, `requestIP`, `timeout`,
`pendingRequests`) lives on the prototype, so logging the server object shows nothing useful.

## Hardening options

```ts
Bun.serve({
  maxRequestBodySize: 1024 * 1024,  // MEASURED: over-limit → automatic 413, empty body
  idleTimeout: 30,                   // SECONDS
  reusePort: true,                   // SO_REUSEPORT: several processes share one port
})
```

`maxRequestBodySize` is not readable back off the server object. `idleTimeout` covers a stalled
connection, not a slow handler.

## Cookies

MEASURED: `req.cookies` on a routes handler is a **`CookieMap`** — `req.cookies.get("sid")`
returned the value from the request header directly. `Bun.CookieMap` and `Bun.Cookie` exist as
globals; **`Bun.cookie` does not**.

Set cookies on the way out via the `set-cookie` header, or mutate `req.cookies` — Bun serialises
changed entries onto the response.

## Per-request server access

```ts
"/ip": (req, server) => Response.json({ ip: server.requestIP(req) })
// MEASURED → { address: "::1", family: "IPv6", port: 56528 }
```

Behind a load balancer this is the balancer's address. Trust `x-forwarded-for` only when you
control the proxy **and** it overwrites the header rather than appending — otherwise a client can
forge the left-most entry, which is exactly what naive IP rate limiting reads.

## Error hook

```ts
error(err) { return toResponse(err); }
```

MEASURED: a `throw` inside a route handler reaches `error()` and returns your response (500 with
your body). It never becomes an unhandled rejection. Routes are the one place throwing freely is safe.

## TLS and unix sockets

```ts
Bun.serve({ tls: { cert: Bun.file("./cert.pem"), key: Bun.file("./key.pem") } });
Bun.serve({ unix: "/tmp/app.sock" });   // no port; server.port is undefined
```

A unix-socket server has no `port`, which is why anything deriving a base URL from `server.port`
must handle `undefined` rather than building `localhost:undefined`.

## Default response headers

MEASURED on a `Response.json(...)`: `content-length, content-type, date`. Bun adds no `server`
header and no security headers — those are yours to set (see the `security` skill).
