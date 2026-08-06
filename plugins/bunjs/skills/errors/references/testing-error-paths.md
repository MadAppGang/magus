# Testing error paths

Error paths are the least-tested and most-load-bearing code in a service: they run precisely when
something is already wrong. An untested `catch` block is a second failure waiting to compound the first.

## Assert on the type, not the message

```ts
expect(() => parse("")).toThrow(ValidationFailed);           // ✓ survives message edits
expect(() => parse("")).toThrow("Validation failed");        // ✗ breaks on a copy tweak
```

Messages are UI. Types and codes are contract. When you do need the detail, reach for the structured
fields the catalog gives you:

```ts
const err = await createUser(dupe).catch((e) => e);
expect(err).toBeInstanceOf(Conflict);
expect(err.code).toBe("CONFLICT");
expect(err.context).toMatchObject({ email: "a@b.c" });
```

## `.rejects` for async

```ts
await expect(fetchUser("nope")).rejects.toThrow(NotFound);
```

Forgetting the outer `await` makes the assertion pass unconditionally — the test finishes before the
promise settles and nothing is checked. This is the most common silently-passing test in an async suite.
`await` every `expect(...).rejects`.

The `try/catch` alternative has the same trap in a nastier form:

```ts
test("throws", async () => {
  try {
    await mightThrow();
  } catch (e) {
    expect(e).toBeInstanceOf(NotFound);   // ✗ if it does NOT throw, zero assertions run and the test passes
  }
});
```

Guard it with `expect.unreachable()` (present in Bun 1.3.10, MEASURED) — or just use `.rejects`:

```ts
try {
  await mightThrow();
  expect.unreachable("should have thrown NotFound");
} catch (e) { expect(e).toBeInstanceOf(NotFound); }
```

## Test the classification, not only the throw

The operational/programmer split is the decision everything else hangs off, so assert it directly:

```ts
expect(AppError.isOperational(new NotFound("user", 1))).toBe(true);
expect(AppError.isOperational(new Bug("invariant"))).toBe(false);
expect(AppError.isOperational(new TypeError("boom"))).toBe(false);  // the safe default
```

The third line is the one worth keeping: it pins the rule that an *unrecognised* error is a bug. Someone
"helpfully" defaulting unknown errors to operational is a plausible refactor, and this test stops it.

## Assert that internal detail does not leak

A 5xx body is a security boundary, and boundaries need tests that fail loudly when someone widens them:

```ts
const res = toResponse(new AppError("SELECT * FROM users WHERE token='abc' at /srv/app/db.ts", { status: 500 }));
const body = JSON.stringify(await res.json());
expect(body).not.toContain("SELECT");
expect(body).not.toContain("/srv/app");
```

Negative assertions are weak on their own — they pass when the code does nothing at all. Pair each with a
positive one proving the information still reaches the log, which is what the shipped `handler.test.ts` does.

## Inject faults; do not wait for them

Real failures are rare and untriggerable on demand, so make the seam explicit. Every primitive in
`resilience.ts` takes injectable `sleep`, `random`, `now` and `exit` for this reason — a retry suite that
really sleeps is slow *and* flaky.

```ts
const delays: number[] = [];
await retry(failingFn, {
  attempts: 4, baseDelayMs: 100, maxDelayMs: 500,
  random: () => 1,                                  // pin jitter to isolate the cap
  sleep: async (ms) => void delays.push(ms),        // record instead of waiting
}).catch(() => {});
expect(delays).toEqual([100, 200, 400, 500]);       // doubling, then capped
```

The whole suite runs in milliseconds and asserts the *policy*, which is the part that regresses.

For the circuit breaker, inject `now` rather than sleeping past `resetMs`:

```ts
let now = 1000;
const cb = new CircuitBreaker("svc", { threshold: 1, resetMs: 500, now: () => now });
await cb.run(failing).catch(() => {});
expect(cb.currentState).toBe("open");
now += 600;                                          // travel forward, do not wait
expect(await cb.run(async () => "ok")).toBe("ok");
```

## Prove the breaker does not call through

The point of an open breaker is that the upstream is *not contacted*. Asserting only on the thrown error
would pass even if the call still happened:

```ts
const inner = mock(async () => "should not run");
await cb.run(inner).catch(() => {});
expect(inner).not.toHaveBeenCalled();                // this is the real assertion
```

## Fault injection at the transport

For component tests, make the dependency fail rather than mocking your own module:

```ts
let mode: "ok" | "500" | "hang" = "ok";
const upstream = Bun.serve({
  port: 0,
  fetch: async () => {
    if (mode === "500") return new Response("boom", { status: 500 });
    if (mode === "hang") await Bun.sleep(60_000);
    return Response.json({ ok: true });
  },
});
```

Point your client at `upstream.port` and flip `mode` per test. This exercises the real client, real
timeouts and real status handling — the parts a hand-written mock of your own HTTP wrapper quietly skips.
See the `testing` skill for the full component-test harness.

## Coverage is a floor, not a goal

`bun test --coverage` shows which `catch` blocks never ran. Treat an uncovered error branch as an
untested one, because it is.

**But verify your gate actually gates.** MEASURED (Bun 1.3.10): in `bunfig.toml`,
`coverageThreshold = { line = 0.9 }` is **silently ignored** — the keys are plural. Use
`{ lines = …, functions = …, statements = … }` or a bare scalar. Details in the `testing` skill.
