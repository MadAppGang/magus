# Async pitfalls

## Measured Bun behaviour

Run in Bun 1.3.10 (`scratchpad/bunprobe/probe-signals.ts`):

- **An unhandled rejection fires `process.on("unhandledRejection")` and does NOT terminate the process.**
  Bun keeps serving. Node's `--unhandled-rejections=throw` default does not apply here.
- A `throw` inside a `Bun.serve` route handler is caught by the `error()` hook and returns your response —
  it never becomes an unhandled rejection. Routes are the *one* place throwing freely is safe.
- `process.exit()` immediately after `await server.stop()` kills pending microtasks. The drain completes;
  anything you queued alongside it may not.

The first point is why `installProcessHandlers` exists. A rejection that reaches the process handler
escaped every boundary you built — the promise chain is in an unknown state, and Bun's decision to keep
running is the dangerous default this skill overrides.

## Floating promises

```ts
sendWelcomeEmail(user);        // ✗ returns a promise nobody awaits
await sendWelcomeEmail(user);  // ✓ failures propagate
void sendWelcomeEmail(user).catch(reportError); // ✓ deliberately fire-and-forget, still reported
```

A floating promise that rejects becomes an unhandled rejection — which, per the measurement above, Bun
does not act on. The work silently did not happen.

Catch these at compile time rather than by discipline. `@typescript-eslint/no-floating-promises` is the
rule; it requires type information, so point it at your tsconfig:

```js
// eslint.config.js
rules: { "@typescript-eslint/no-floating-promises": "error" }
```

`void` is the explicit opt-out and reads as intent — but `void` alone still discards the rejection, so
pair it with `.catch()` as above.

## `forEach` does not await

```ts
users.forEach(async (u) => { await save(u); });   // ✗ returns immediately, saves nothing yet
console.log("done");                               // prints before any save completes
```

`forEach` ignores the returned promise entirely. There is no version of this that works.

```ts
for (const u of users) await save(u);              // ✓ sequential, ordered, stops on first failure
await Promise.all(users.map((u) => save(u)));      // ✓ concurrent, fails fast
```

Sequential when order matters or the target rate-limits; concurrent when it does not. Unbounded
`Promise.all` over 50,000 rows opens 50,000 connections — see *Bounded concurrency* below.

## `Promise.all` vs `allSettled` vs `any`

| | Rejects when | Use for |
|---|---|---|
| `all` | **any** input rejects, immediately | steps that are all required — a missing one makes the result meaningless |
| `allSettled` | never | independent work where partial success is useful (fan-out notifications, per-item imports) |
| `any` | **all** inputs reject (`AggregateError`) | racing redundant sources; first success wins |
| `race` | first settles, pass or fail | timeouts — though prefer `withTimeout`, which also aborts |

The `all` trap: rejection is fast, but the other promises **keep running**. They are not cancelled, and
if one of them later rejects it becomes an unhandled rejection with no obvious origin.

```ts
const results = await Promise.allSettled(items.map(process));
const failed = results.filter((r) => r.status === "rejected");
if (failed.length) reportPartialFailure(failed);   // decide explicitly — never ignore
```

`allSettled` never rejecting is the hazard: it makes ignoring failures the path of least resistance.

## Bounded concurrency

```ts
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;                       // ++ is atomic here — single-threaded loop
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;                                   // order preserved: index, not push
}
```

Results are written by index, so output order matches input order even though completion order does not.
`push` would scramble them.

## `async` in places that discard the promise

```ts
class Service {
  constructor() { this.init(); }               // ✗ rejection is unobservable; object looks ready
}
```

Constructors cannot be async and cannot await. Use a static factory:

```ts
class Service {
  private constructor(private readonly db: Database) {}
  static async create(url: string) { return new Service(await connect(url)); }
}
```

The same applies to array callbacks that expect a sync return — `filter`, `map` used for its boolean,
`sort` comparators. An `async` function there returns a `Promise`, and a `Promise` is always truthy:

```ts
const active = users.filter(async (u) => await isActive(u));  // ✗ keeps EVERY user
const flags  = await Promise.all(users.map(isActive));         // ✓
const active2 = users.filter((_, i) => flags[i]);
```

## `try/finally` and the returned promise

```ts
async function withConn<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.acquire();
  try {
    return await fn(conn);   // the `await` matters
  } finally {
    conn.release();
  }
}
```

Without `await` on `fn(conn)`, `finally` runs when the promise is *created*, not when it settles — the
connection is released while still in use. `return await` inside `try` is one of the few places the
"redundant await" lint is wrong.

## Preserve the cause

```ts
catch (err) { throw new Error(err.message); }              // ✗ stack and cause both destroyed
catch (err) { throw new UpstreamFailure("stripe", { cause: err }); }  // ✓
```

`AppError` forwards `cause` to the real `Error` option, so `error.cause` and `AppError.chain()` both work,
and `toLog()` flattens the chain. The shipped test asserts a three-deep chain and a cycle-safe walk.

## Timers keep the loop alive

An uncleared `setTimeout` holds the process open for its full duration — a 30-second timeout on a script
that finished in 200 ms makes it hang for 30 seconds. `withTimeout` clears in `finally`; a shipped test
asserts the call returns in under 200 ms despite a 5000 ms budget.

For a timer that genuinely should not block exit, `timer.unref()` works in Bun via node compat.
