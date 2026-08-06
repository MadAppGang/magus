---
name: errors
description: Error handling and resilience for Bun/TypeScript — operational vs programmer errors, AppError hierarchy, centralized handler, boundary validation, timeout/retry/circuit breaker. Copyable, tested.
disable-model-invocation: true
---

# Errors and resilience

Error handling is where most Node/Bun services rot, and it rots in a specific way: every `catch` block
makes its own decision. One returns `null`, one logs and continues, one re-throws a `new Error(String(e))`
that destroys the stack, one 500s on a validation failure. The result is a service that cannot tell you
whether it is healthy, because *nothing knows what an error means*.

This skill installs one distinction and builds everything on it.

## The one distinction: operational vs programmer

| | Operational | Programmer |
|---|---|---|
| Examples | bad email, payment declined, upstream 503, rate limit, 404 | `undefined is not a function`, violated invariant, bad migration |
| Who was wrong | the caller, the network, the world | **you** |
| Did you anticipate it | yes — you wrote the throw | no |
| Correct response | answer the caller, log at `warn`, keep serving | log at `error` with stack, **let the process die and restart** |
| Process state after | healthy | **unknown** |

**The last row is the reason this matters.** After a programmer error the process holds state nobody
reasoned about — a half-applied transaction, a module that threw during init, a connection pool with a
poisoned entry. Continuing is not resilience, it is serving unknown-correctness responses. The famous
advice "never swallow errors" is really this: never let a *programmer* error be swallowed into the
operational path.

Everything else in this skill follows mechanically. `AppError.isOperational()` is the classifier; it
returns `false` for anything that is not an `AppError`, because **an unrecognised error is a bug until
proven otherwise**.

## Copy the module in; never retype it

The subtle parts — the `cause` chain walk that is cycle-safe, the 5xx message replacement, the
re-entrancy guard on shutdown, full-jitter backoff — degrade silently when retyped from memory.
**53 tests ship with this code and pass** (`bun test`, `tsc --noEmit` clean, Bun 1.3.10).

```bash
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/errors}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"  # that var is UNSET in a Bash tool (MEASURED) — so paste it. `:?` would ABORT the block and copy nothing
mkdir -p src; if [ -d "$SKILL/assets" ]; then cp -r "$SKILL/assets/errors" src/errors   # app-error, catalog, handler, resilience + 3 test files
else echo "SKILL is still the placeholder — paste the real dir above and re-run"; fi
```

Four files, and they import each other by relative path — **leave those imports alone**; in `src/errors/`
they resolve untouched. `catalog` imports `./app-error`; `handler` imports both; `resilience` imports
`./catalog` and `./app-error`.

| File | What it is for |
|---|---|
| `app-error.ts` | the base class, `isOperational`, `chain()`, `toLog()` |
| `catalog.ts` | `BadRequest` `Unauthenticated` `Forbidden` `NotFound` `Conflict` `ValidationFailed` `RateLimited` `Timeout` `UpstreamFailure` `Bug` `assertNever` |
| `handler.ts` | `toResponse()` for the transport boundary, `installProcessHandlers()` for last resort |
| `resilience.ts` | `withTimeout` `retry` `CircuitBreaker` |

## Throw a type, not a status code

```ts
import { NotFound, Conflict, ValidationFailed, Bug } from "./errors/catalog";

if (!user) throw new NotFound("user", id);
if (existing) throw new Conflict("email already registered");
if (issues.length) throw new ValidationFailed(issues);
if (!KNOWN_STATES.has(row.state)) throw new Bug(`unreachable state ${row.state}`); // 500 + restart
```

A route handler's job ends at the throw. It does not pick a status, does not log, does not build a body —
**one** place does all three, so all three stay consistent. That place is `toResponse()`.

## Wire it once, at the boundary

`Bun.serve`'s `error()` hook catches anything a route throws (MEASURED: a `throw` inside a route reaches
`error()` and never becomes an unhandled rejection).

```ts
import { toResponse, installProcessHandlers } from "./errors/handler";

const server = Bun.serve({
  routes: { "/users/:id": (req) => getUser(req.params.id) }, // throws NotFound freely
  error(err) {
    return toResponse(err, { requestId: currentRequestId() });
  },
});

installProcessHandlers({ onFatal: () => server.stop() }); // last resort; drains, then exits 1
```

**5xx messages are replaced before they reach the client** — internal messages routinely carry table
names, file paths and upstream URLs, and a stack trace in a response body is a free map of your system.
The real message still reaches the log, keyed by `requestId` so support can join the two. Verified by a
test that asserts `SELECT` and `/srv/app` never appear in the body while remaining in the report.

### Why `installProcessHandlers` treats a rejection as fatal

MEASURED (Bun 1.3.10): an unhandled rejection **fires the event and does NOT terminate the process** —
Bun keeps serving with a promise chain in an unknown state. That silence is exactly the danger described
above, so the handler makes the call Bun declines to: non-operational escape → drain → `exit(1)`. It is
guarded against re-entrancy, races `onFatal` against a deadline (default 5 s), and still exits if the
drain itself throws. An *operational* error arriving here is a boundary bug, not a reason to die: it is
logged loudly and the process continues.

## Resilience: the ordering people get wrong

**The timeout goes INSIDE the retry, per attempt.** A retry wrapped in one outer timeout gives you a
budget that the first slow attempt consumes entirely, so the retries never happen — the shape that looks
right and silently does nothing.

```ts
await retry(() => withTimeout("charge", 2000, (signal) => fetch(url, { signal })), { attempts: 3 });
```

Pass the `AbortSignal` **in**. A timeout that only stops *waiting* leaves the socket open and the upstream
still doing work you no longer want.

Three more rules the code encodes:
- **Never retry a 4xx.** The same bad request fails identically. `defaultIsRetryable` retries 5xx and
  429 only — 429 because the server explicitly said "later".
- **Jitter is not a nicety.** Without it every client that failed during an outage retries at the same
  instants and re-flattens the upstream the moment it recovers. Full jitter (`random() * cappedDelay`)
  spreads them uniformly.
- **Retry without a circuit breaker makes an outage worse** — it multiplies load on the thing already
  failing. `CircuitBreaker` is what makes retry safe: after N consecutive failures it rejects
  *without calling through*, then allows exactly one probe after `resetMs`.

## Acceptance — before reporting done

1. `bun test` and `tsc --noEmit` both clean.
2. **Grep your diff for the four swallow patterns.** Each one silently converts a programmer error into
   a wrong answer:
   ```bash
   grep -rnE 'catch \{ *\}|catch \([a-z]+\) \{ *\}' src/          # empty catch
   grep -rn 'catch' src/ | grep -v 'throw\|toResponse\|reject'     # catch that neither rethrows nor reports
   grep -rnE 'new Error\(String\(|new Error\(.*\.message\)' src/   # stack destroyed, cause dropped
   grep -rnE '^\s*[a-zA-Z_$][\w.]*\([^)]*\)\.then\(' src/          # floating promise, no await/catch
   ```
3. **`catch (e) { throw new Error(e.message) }` is the single most damaging line** — it throws away the
   stack *and* the cause. Use `{ cause: e }`, which `AppError` passes through to the real `Error` option.
4. Every `fetch` or DB call on a request path is wrapped in `withTimeout`. An un-timed network call is an
   unbounded one; under load it is how a service hangs instead of failing.

## References

Read the one your task needs — do not read all four.

| File | Read it when |
|---|---|
| `references/validation-boundaries.md` | deciding *where* to validate, schema libraries, parse-don't-validate, trusting `req.json()` |
| `references/async-pitfalls.md` | floating promises, `Promise.all` vs `allSettled`, async in constructors/loops, measured Bun rejection behaviour |
| `references/resilience-patterns.md` | idempotency keys, timeout budgets, bulkheads, what to do when a retry is unsafe |
| `references/testing-error-paths.md` | asserting on thrown types, fault injection, why untested error paths are the ones that break |
