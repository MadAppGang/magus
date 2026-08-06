# Resilience patterns beyond retry

`resilience.ts` ships `withTimeout`, `retry` and `CircuitBreaker`. This file covers the decisions
those primitives cannot make for you.

## When a retry is unsafe

Retry assumes the operation is **idempotent** — doing it twice equals doing it once. Reads always are.
Writes usually are not.

```
GET /orders/42           idempotent
PUT /orders/42 {…}       idempotent (full replacement)
DELETE /orders/42        idempotent (second delete is a no-op 404)
POST /orders {…}         NOT idempotent — retry creates a second order
POST /charges {…}        NOT idempotent — retry charges the customer twice
```

The dangerous case is a request that **succeeded** but whose response was lost — a timeout on the client
side after the server committed. The retry is indistinguishable from a fresh request. This is how double
charges happen, and no amount of backoff prevents it.

### Idempotency keys

The caller generates a key per logical operation and resends it on retry. The server records the key with
the result and replays that result instead of re-executing.

```ts
const key = crypto.randomUUID(); // once per logical op — NOT per attempt
await retry(() =>
  withTimeout("charge", 3000, (signal) =>
    fetch("/charges", { method: "POST", headers: { "idempotency-key": key }, body, signal })));
```

Server side, in one transaction: insert the key, do the work, store the response. A duplicate key hits a
unique-constraint violation → return the stored response. Doing this in *one* transaction is the whole
point; two statements race, and the race window is exactly when retries arrive.

If you cannot add idempotency keys, set `isRetryable` to reject the unsafe verbs rather than hoping:

```ts
retry(fn, { isRetryable: (e) => e instanceof AppError && e.status >= 500 && method !== "POST" });
```

## Timeout budgets

A request that fans out to three services, each with a 3-second timeout and 3 attempts, has a worst case
of 27 seconds — long after the user's browser gave up and well past your load balancer's own timeout.
The retries after the caller left are pure waste, and they land on a service that is already struggling.

Give the *whole request* a budget and pass the remainder down:

```ts
class Budget {
  constructor(private readonly deadline: number) {}
  static of(ms: number, now = Date.now()) { return new Budget(now + ms); }
  remaining(now = Date.now()) { return Math.max(0, this.deadline - now); }
  expired(now = Date.now()) { return this.remaining(now) === 0; }
}

async function callWithBudget<T>(name: string, budget: Budget, fn: (s: AbortSignal) => Promise<T>) {
  if (budget.expired()) throw new Timeout(name, 0);
  return withTimeout(name, Math.min(2000, budget.remaining()), fn);
}
```

Rule of thumb: **each layer's timeout must be shorter than its caller's.** If your handler has 10 s and
your DB call has 30 s, the DB timeout never fires — the caller gives up first and you learn nothing.

## Bulkheads

One slow dependency should not consume every connection and take down the endpoints that do not use it.
Give each dependency its own bounded pool, so exhaustion is contained:

```ts
const pools = {
  payments: new Semaphore(10),
  search:   new Semaphore(50),   // slow and non-critical — cannot starve payments
};
```

Without this, a search upstream that starts taking 30 s will hold every worker, and `/health` starts
timing out too. The ship-partition metaphor is the right one: the compartment floods, the ship does not.

## What to do while the breaker is open

An open breaker is a decision point, not just an error. Ranked by preference:

1. **Serve stale** — a cached value with an "as of" timestamp beats an error page for most reads.
2. **Degrade** — hide the recommendations panel; keep checkout working.
3. **Queue** — accept the write, return `202`, reconcile later. Only if the caller can tolerate async.
4. **Fail fast** — a clean 503 with `Retry-After`. Still better than a 30-second hang.

Hanging is always the worst option: it consumes a connection on every layer between you and the user.

## Health checks must not cascade

A `/health` endpoint that checks every dependency will report your service unhealthy when a *non-critical*
dependency is down — and the orchestrator will then kill a process that was serving fine.

- **Liveness** — "is this process wedged?" Check nothing external. Restarting fixes it or nothing does.
- **Readiness** — "should traffic come here?" Check only dependencies you cannot serve *any* request
  without.

Details and a copyable implementation are in the `production` skill.

## Do not retry inside a retry

Layered retries multiply: an HTTP client with 3 built-in attempts inside your `retry(attempts: 3)` is
9 requests, and each layer thinks it did something reasonable. Pick one layer — usually the outermost,
which is the only one that knows the caller's budget — and disable the others explicitly.

## Observability

Every one of these patterns is invisible until it misfires. At minimum, count:

- retries by operation and outcome — a rising retry rate is the earliest warning you get
- breaker state transitions — `closed→open` is a page-worthy event
- timeouts by operation, separately from upstream errors: "we gave up" and "they said no" have different fixes

`retry`'s `onRetry` callback and `CircuitBreaker.currentState` exist for exactly this.
