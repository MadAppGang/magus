# Testing against other services and queues

Exit doors 3 and 4. A component test is only isolated if the service under test **cannot**
reach the world — and only useful if you assert on what it tried to send.

## Deny by default

Stubbing each dependency as you discover it **fails open**: the call you forgot is exactly
the one nobody stubbed, and it reaches a real API from CI.

```ts
import { denyOutgoing, startFakeUpstream } from "./support/harness";

const upstream = startFakeUpstream();
const restore = denyOutgoing({ allow: [upstream.url] });   // everything else throws
afterAll(restore);
```

Anything not allow-listed throws with the URL named, so an unexpected dependency shows up
the first time it appears. A shipped test proves a `Request` object cannot slip past the
allow-list — the naive implementation only inspects strings, and that gap is silent.

This also makes a **negative** requirement testable. "Cancelling an order must not charge
the card" is not an assertion about your code's structure; it is an assertion that door 3
stayed shut.

## Assert what you sent, not only what came back

```ts
expect(upstream.requests).toHaveLength(1);
expect(upstream.requests[0]?.headers.get("idempotency-key")).toBe(key);
expect(JSON.parse(upstream.requests[0]!.body)).toEqual({ amount: 1050, currency: "AUD" });
```

The response is the easy half. The **request** is where the bugs are: a missing
idempotency key, an amount in dollars where the API wants cents, a retry that re-sent a
`POST` it should not have.

Assert **the number of calls** too. "Charged once" is a count assertion and one of the few
places where asserting on an interaction is exactly right — it *is* the requirement.

## Corner cases over a happy default

Set a happy default once, override per test. The shipped `startFakeUpstream` does this:
`enqueue` for a specific reply, `failNext(n, status)` for failures, `hangNext(ms)` for a
socket that never answers, and `reset()` for a clean slate between tests.

```ts
upstream.failNext(2, 503);          // exercise the retry policy
upstream.hangNext(30_000);          // exercise the timeout, without waiting 30s
```

`hangNext` is the one people skip, and timeouts are the least-tested and most
production-relevant path — an un-timed call is how a service hangs instead of failing.

### Simulate the chaos that actually happens

Slow responses, connection resets mid-body, malformed JSON, a 200 with an empty body, an
HTML error page where JSON was promised. Each has a different failure mode in your client,
and "the upstream returned 500" exercises none of them.

## Prefer a fake server over an HTTP interceptor

Interceptor libraries (nock and friends) patch the HTTP layer. A **real server on an
ephemeral port** is closer to production: real sockets, real status codes, real timeouts,
real header handling — and it exercises *your* client rather than a patched stand-in.

It also survives a client-library swap. An interceptor is coupled to the HTTP
implementation it patches; a fake server is coupled only to HTTP.

## Contracts

A fake you wrote encodes **your belief** about the provider's API. When they change it,
your tests stay green and production breaks. Two defences:

- **Validate outgoing requests against the provider's schema** in the fake, so a request
  they would reject fails locally instead of at 3am.
- **Record real responses periodically** and diff them against your fake's. A drift is a
  scheduled job's job, not a code review's.

Consumer-driven contract testing is the full version. Even without the tooling, writing
down the assumed shape and checking it against live responses on a schedule catches most
of the value.

## Message queues — exit door 4

Same shape as HTTP, different failure modes.

**Use a fake queue for most tests.** A real broker makes the suite slow and order-
dependent. Assert that the right message was published with the right payload:

```ts
expect(queue.published).toContainEqual({ topic: "order.placed", body: { orderId: "o_1" } });
```

**Await, never poll.** A test that sleeps 500 ms hoping the consumer ran is slow when it
passes and flaky when the runner is loaded. Resolve a promise from the handler, or use
`waitFor(...)` from the harness.

**Test acknowledgement, not just delivery.** The interesting cases are the ones that lose
or duplicate messages:

- handler throws → message is **nacked** and redelivered, not silently dropped
- the same message arrives twice → the consumer is **idempotent** (see the `errors` skill)
- poison message → it lands in a dead-letter queue rather than blocking the partition
- ordering, if you depend on it — and be sure you actually do

**Reserve a real broker** for a handful of integration tests covering broker-specific
behaviour: prefetch, redelivery timing, DLQ routing. Those cannot be faked honestly.

## Faking time

Retry and backoff tests must never sleep for real. `fakeClock()` records the delays and
advances a virtual clock, so a policy of "100 ms, 200 ms, 400 ms, capped at 500" is
asserted exactly, in milliseconds of wall clock. Full worked example in the `errors`
skill's `testing-error-paths.md`.
