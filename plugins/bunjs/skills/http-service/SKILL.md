---
name: http-service
description: Build or review a Bun HTTP service — Bun.serve declarative routes, middleware composition, request context, status/ETag/streaming helpers, graceful lifecycle. Ships tested middleware with measured routing gotchas.
disable-model-invocation: true
---

# HTTP services on Bun

`Bun.serve` gives you a native radix router with typed path params and no framework. What it does
**not** give you is middleware, a 405, a request id, an access log, or any response convention —
and the usual reaction is to abandon `routes` for hand-rolled dispatch inside `fetch()`, throwing
away the router and the typed params along with it.

This skill keeps `routes` and wraps handlers instead.

## Four measured routing behaviours that will bite you

All MEASURED against a live server on Bun 1.3.10:

| What you write | What actually happens |
|---|---|
| `"/things": { GET, POST }`, request is `PUT` | **No 405.** Falls through to `fetch()` → usually a 404 |
| `"/files/*": handler` | Route matches, but **`req.params` is `{}`** — the wildcard captures nothing |
| `server.reload({ routes: { "/health": … } })` | **Replaces the entire route table.** Every route missing from the payload starts 404ing |
| `"/health": new Response("ok")` | A static `Response` value is **reused** across requests, not consumed |

The 405 one matters semantically: 404 tells a client the resource does not exist, 405 tells it the
resource exists and the verb is wrong. `allowMethods()` in the shipped middleware produces a real
405 with the `Allow` header RFC 9110 requires.

To read a wildcard's captured path, use `new URL(req.url).pathname` — `req.params` will not have it.

## Copy the middleware in

**38 tests ship with this code and pass** (`bun test`, `tsc --noEmit` clean, Bun 1.3.10).

```bash
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/http-service}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"  # that var is UNSET in a Bash tool (MEASURED) — so paste it. `:?` would ABORT the block and copy nothing
mkdir -p src; if [ -d "$SKILL/assets" ]; then cp -r "$SKILL/assets/http" src/http   # middleware + respond + 2 test files
else echo "SKILL is still the placeholder — paste the real dir above and re-run"; fi
```

| Export | Purpose |
|---|---|
| `chain(...mw)` | compose middleware **left-to-right**, matching reading order |
| `withRequestId()` | assigns/propagates a request id via `AsyncLocalStorage` |
| `accessLog(write)` | one structured line per request, **including failures** |
| `allowMethods(...)` | the real 405 Bun does not give you |
| `timeout(ms)` | wall-clock cap on a handler → 504 |
| `currentRequestId()` | read the ambient id anywhere, no parameter threading |
| `ok/created/noContent/accepted/seeOther/page` | one response envelope, consistently |
| `withETag(req, body)` | conditional GET → 304 |
| `streamJsonArray(source)` | stream a large collection without buffering |

## Composing a service

```ts
import { chain, withRequestId, accessLog, allowMethods, timeout } from "./http/middleware";
import { toResponse } from "./errors/handler";   // see the `errors` skill
import { ok, created } from "./http/respond";

const base = chain(withRequestId(), accessLog(), timeout(10_000));

const server = Bun.serve({
  port: env.PORT,
  maxRequestBodySize: 1024 * 1024,   // 1 MiB — MEASURED: over-limit gets an automatic 413
  idleTimeout: 30,                    // SECONDS, not ms
  routes: {
    "/health": new Response("ok"),                                  // static, no allocation per hit
    "/users/:id": base(chain(allowMethods("GET"))(getUser)),
    "/users": base(chain(allowMethods("GET", "POST"))(listOrCreate)),
  },
  fetch: () => new Response(null, { status: 404 }),
  error: (err) => toResponse(err, { requestId: currentRequestId() }),
});
```

**Composition is per-route, not global.** More typing than `app.use()`, but reading a route tells
you exactly what runs for it — no action-at-a-distance about whether auth applied, which is the
failure mode that ships unauthenticated endpoints.

Put `withRequestId` **outermost** so everything downstream, including the error handler, can label
its output.

## Why `AsyncLocalStorage` and not a module variable

A module-level `let currentRequestId` is overwritten by the next request while the first is still
awaiting, so logs get attributed to the wrong request — a bug that only appears under concurrency.
`AsyncLocalStorage` survives `await` boundaries. A shipped test fires **24 interleaved requests
with deliberately varied delays and asserts every one still reads its own id**.

## Server hardening knobs

MEASURED behaviours worth setting deliberately:

- `maxRequestBodySize` — an over-limit POST gets an automatic **413** with an empty body. Without a
  cap, request bodies are an unbounded memory allocation an attacker controls.
- `idleTimeout` is in **seconds**. It covers a *stalled connection*, not a handler awaiting a slow
  dependency forever — that is what the `timeout()` middleware is for.
- `server.requestIP(req)` → `{ address, family, port }`. Behind a proxy this is the proxy; trust
  `x-forwarded-for` only if you control the proxy and it overwrites rather than appends.
- `req.cookies` is a `CookieMap` on routes handlers — `req.cookies.get("sid")` works directly.

## Lifecycle: `stop()` is the graceful drain

MEASURED: `server.stop()` with no argument returns a Promise that resolves **after in-flight
requests finish** (a 300 ms request signalled at t+80 ms drained in 226 ms). `stop(true)`
force-closes active connections.

```ts
process.on("SIGTERM", async () => {
  await server.stop();   // drain, do NOT pass true
  process.exit(0);
});
```

That is the whole graceful-shutdown primitive. The `production` skill covers ordering it against
readiness flips and connection draining.

## Response conventions

Pick these once; drift starts within a week otherwise.

- **Collections return an object, never a bare array.** `{ items, nextCursor }`. A top-level array
  cannot carry pagination, so adding it later is a breaking change.
- **201 carries `Location`.** It is the difference between a client that can follow the new
  resource and one that guesses the URL.
- **204 carries no body and no `content-type`.** `new Response(null, …)` — an empty string still
  produces a zero-length body.
- **`withETag` on read endpoints.** The cheapest latency win available: the body never leaves the
  server. The shipped implementation handles `*`, comma-separated lists and the `W/` weak prefix —
  naive `inm === etag` silently disables caching for any client that sends a list.

Stream when a collection is large: MEASURED, `JSON.parse` of a 1.81 MiB payload took **76 ms**, and
`stringify` is the same order — 76 ms during which the loop serves nobody. The trade-off is real
though: once the first byte is sent the status is committed, so a mid-stream failure cannot become
a 500. Only stream what you can produce reliably.

## Acceptance — before reporting done

1. `bun test` and `tsc --noEmit` clean.
2. **Every route has an explicit method allow-list.** Without it an unlisted verb silently 404s.
3. `maxRequestBodySize` is set. The default is not a security posture.
4. Every route is reachable through the error boundary — a route registered outside your `chain`
   composition has no request id and no access log line.
5. **Grep for hand-built responses** that bypass the envelope:
   ```bash
   grep -rn 'new Response(JSON.stringify' src/ | grep -v 'src/http/respond.ts'
   ```
6. No secrets in the access log. The shipped `accessLog` logs `url.pathname` only — a test asserts
   a token and an email in the query string never reach the log line.

## References

| File | Read it when |
|---|---|
| `references/routing-and-serve.md` | the full `Bun.serve` surface — route precedence, params, cookies, static responses, `reload`, TLS, unix sockets |
| `references/api-design.md` | status codes, pagination, versioning, idempotency, content negotiation, CORS |
| `references/websockets-and-streaming.md` | `Bun.serve` websockets, pub/sub, backpressure, SSE, upload streaming |
