# WebSockets and streaming

## WebSockets — MEASURED on Bun 1.3.10

Upgrade from a `routes` handler; the websocket handlers are siblings of `routes` on the same
`Bun.serve` call.

```ts
const server = Bun.serve<{ user: string }, {}>({
  port: 0,
  routes: {
    // Return undefined on a successful upgrade — Bun takes over the socket.
    "/ws": (req, srv) =>
      srv.upgrade(req, { data: { user: "u1" } }) ? undefined : new Response("upgrade failed", { status: 400 }),
  },
  fetch: () => new Response(null, { status: 404 }),
  websocket: {
    open(ws)          { ws.send(`hello ${ws.data.user}`); ws.subscribe("room"); },
    message(ws, msg)  { ws.send(`echo:${msg}`); },
    close(ws, code)   { /* MEASURED: a clean client close gives code 1000 */ },
    maxPayloadLength: 1024,
    idleTimeout: 60,          // seconds
    perMessageDeflate: false,
  },
});
```

Verified in a live round trip: the client received `["hello u1", "echo:hi"]`, `ws.data` was typed
and populated from the upgrade, and a clean `ws.close()` delivered **code 1000** server-side.

### The things that actually matter

**`ws.data` is your per-connection state, and it is set at upgrade time.** That is the only place
you have the original `Request` — its cookies, headers and auth. Authenticate *there* and put the
resolved identity in `data`; you cannot recover the HTTP request later.

```ts
"/ws": (req, srv) => {
  const user = verifySession(req.cookies.get("sid"));      // the ONLY chance to do this
  if (!user) return new Response(null, { status: 401 });   // reject before upgrading
  return srv.upgrade(req, { data: { userId: user.id } }) ? undefined : new Response(null, { status: 400 });
}
```

**Set `maxPayloadLength`.** Without a cap, a single client can allocate arbitrary memory per frame.

**Pub/sub is built in and is not a toy.** `ws.subscribe(topic)` / `ws.publish(topic, msg)` /
`server.publish(topic, msg)` are implemented natively, so a broadcast does not loop in JS. Use
`server.publish` to send from outside a socket handler — a background job, an HTTP route.

Topic names are strings you choose; scope them (`room:42`, `user:u1`) so a bug cannot broadcast
across tenants.

**`ws.send()` returns a number**: bytes written, `0` if dropped, `-1` on backpressure. Ignoring the
return value is how a slow consumer turns into unbounded server memory. Under sustained
backpressure, either drop messages for that socket or close it — you cannot buffer forever.

**Browsers cannot set headers on a WebSocket handshake.** No `Authorization` header is possible;
authenticate with a cookie or a short-lived ticket in the query string. A long-lived token in the
query string ends up in access logs.

## Server-Sent Events

For server→client only, SSE beats WebSockets: it is plain HTTP, so proxies, auth headers and
compression all work normally, and browsers reconnect automatically.

```ts
"/events": () =>
  new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const event of subscribe()) {
          // The double newline terminates an event. Omitting it means nothing is ever delivered.
          controller.enqueue(encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`));
        }
      },
    }),
    { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } },
  );
```

Send `id:` on each event and honour the `Last-Event-ID` request header on reconnect, or every proxy
hiccup silently drops events. Send a comment line (`: ping\n\n`) every ~30 s — idle connections get
reaped by intermediaries otherwise.

## Streaming responses

MEASURED: `JSON.parse` of a 1.81 MiB payload took **76 ms**; `stringify` is the same order. That is
76 ms during which the event loop serves nobody, per request. Streaming keeps peak memory flat and
lets the client parse as bytes arrive. `streamJsonArray()` in `assets/http/respond.ts` does this,
with tests proving byte-identical output to a buffered `JSON.stringify`.

**The trade-off is not optional to think about:** once the first byte is sent, the status is
committed. A failure at row 40,000 cannot become a 500 — the client has already seen `200 OK`. The
shipped implementation deliberately leaves the array **unterminated** on failure so the client's
JSON parse fails, because a silently-closed `]` hands over a short list that looks complete.

Only stream what you can produce reliably. For anything that might fail partway and *must* be
all-or-nothing, buffer and pay the latency.

## Streaming uploads

`await req.json()` buffers the whole body first, so `maxRequestBodySize` is your only defence
(MEASURED: exceeding it yields an automatic **413**). To handle large uploads without buffering:

```ts
"/upload": async (req) => {
  if (!req.body) return new Response(null, { status: 400 });
  await Bun.write(`/tmp/${crypto.randomUUID()}`, req.body);   // streams straight to disk
  return new Response(null, { status: 204 });
}
```

Validate `content-length` **before** consuming, and never derive the destination path from a
client-supplied filename — that is path traversal. Generate the name yourself.

## Backpressure in the response direction

`ReadableStream` gives you backpressure automatically: `controller.enqueue` respects the consumer's
demand when you use `pull` rather than pushing everything in `start`. A `start()` that loops over a
million rows enqueuing eagerly buffers them all in memory and defeats the purpose — the shipped
helper drives from an `AsyncIterable`, which pulls naturally.

## Choosing

| Need | Use |
|---|---|
| server → client only | **SSE** — simpler, reconnects free, works through proxies |
| bidirectional, low latency | **WebSocket** |
| large response, one shot | **streamed HTTP response** |
| request/response, small | plain JSON — do not over-engineer |
