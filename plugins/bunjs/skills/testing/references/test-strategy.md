# What to test, at what level

## The shape

Forget the pyramid's exact ratios; the useful question is **what does a failure tell you?**

| Level | Scope | Good for | Cost of a failure |
|---|---|---|---|
| Unit | one pure function | algorithms, parsers, pricing, state machines, backoff | pinpoints the line |
| **Component** | your whole service, real HTTP, fake externals | **the default — routing, status codes, validation, auth, serialisation** | names the endpoint |
| Integration | your service + a real DB/queue | queries, migrations, transactions, constraints | names the boundary |
| E2E | several deployed services | a handful of critical journeys | tells you *something* broke |

**Component is the default** because it has the best ratio of confidence to maintenance. It
exercises the wiring — the part that actually breaks during refactors — while staying fast and
deterministic, and it survives internal restructuring because it asserts on the public contract
rather than on call sequences.

The trap at the top is E2E: slow, flaky, and when one fails you still have to go find out why.
Keep a handful for the journeys that lose money if broken (signup, checkout), not a suite.

## Cover features, not functions

Aim a test at a thing a user can do, not at a thing you happened to extract.

```
✗ "createUser() returns a user"          tracks your file layout
✓ "signing up with a taken email is rejected with 409"   tracks the product
```

Function-shaped tests have to be rewritten every time you rename or split a function,
which is why suites rot during refactors — the tests were coupled to structure rather than
behaviour. Feature-shaped tests survive the refactor and fail only when behaviour changes,
which is the entire point.

The practical tell: if renaming an internal function breaks tests without changing what
the service does, those tests are coupled to the wrong thing.

## Write the tests during, not after

"After" reliably becomes "never" — the feature works, the pressure is off, the next ticket
is open. Worse, tests written afterwards are shaped by the implementation you just wrote,
so they assert what the code *does* rather than what it *should*, and pass over bugs that
are baked into both.

You do not need strict TDD to get the benefit. Writing the component test alongside the
handler is enough: it forces the API to be usable before it is finished, and every seam
you needed for testability gets built in rather than retrofitted.

The one place strict test-first genuinely pays is **bug fixes** — see the end of this file.

## Test doubles: prefer the real thing, then a fake, then a mock

1. **Real** — pure logic, `bun:sqlite` in-memory, your own modules. Free fidelity.
2. **Fake** — a working stand-in with real behaviour: a fake HTTP upstream, an in-memory repo.
   `startFakeUpstream()` is this.
3. **Mock** — records calls and returns canned values. Last resort.

The cost of a mock is *coupling to how* the code works. Assert that `repo.save` was called with
exact arguments and any refactor that changes the call shape breaks the test even though behaviour
is identical. Those tests get deleted rather than fixed, and coverage quietly drops.

Mock only at the true edges — a payment SDK singleton, a clock, a random source — and even then
prefer injection over `mock.module()`, which is global for the rest of the file.

### Assert on outcomes, not interactions

```ts
expect(mailer.send).toHaveBeenCalledWith({ to: "a@b.c", template: "welcome" });  // ✗ brittle
expect(await outbox.pending()).toContainEqual({ to: "a@b.c", type: "welcome" }); // ✓ durable
```

The second survives switching mail providers, because it asserts what the *system did*, not which
function was poked. Interaction assertions are legitimate when the interaction **is** the
requirement — "we must not charge the card twice" is a call-count assertion, correctly.

## What not to test

- **Framework and library behaviour.** You are not testing that `Bun.serve` routes, or that zod
  rejects a bad email. Test *your* schema's rules.
- **Getters, setters, trivial pass-throughs.** They inflate coverage and assert nothing.
- **Private functions directly.** If a private function needs its own test it probably wants to be
  a real module with a public contract. Otherwise test it through the surface that uses it.
- **Implementation constants.** `expect(RETRY_LIMIT).toBe(3)` fails when someone tunes a knob and
  proves nothing. Test the *behaviour* — three attempts then a throw.

## Naming and structure

```ts
test("returns 409 when the email is already registered", async () => {
  const existing = await seedUser({ email: "taken@example.test" });   // arrange

  const res = await server.json("/users", { method: "POST", body: json({ email: existing.email }) });  // act

  expect(res.status).toBe(409);                                        // assert
  expect(res.body.error.code).toBe("CONFLICT");
});
```

Three blank-line-separated blocks; no `// arrange` comments needed once the shape is habitual.
The name states **condition → expectation**, because it will be read from a CI log with no code
in front of you.

`describe` blocks name the unit under test, not the file. Nesting deeper than two levels usually
means the describe names are carrying information the test names should.

## One logical assertion per test

Not literally one `expect` — one *reason to fail*. Asserting status, body and headers of the same
response is one reason. Asserting that creation works *and* that deletion works is two, and when
it fails you cannot tell which from the name.

The tell: an `and` in the test name.

## Deterministic by construction

Every flake traces to one of three things, all avoidable:

| Source | Fix |
|---|---|
| real time | `waitFor(cond)` instead of `sleep(guess)`; injected clock instead of `Date.now()` |
| shared state | ephemeral ports, unique ids per test (`builderFor`'s sequence), fresh DB per file |
| unseeded randomness | `seededRandom(seed)`; print the seed on failure so it replays |

Also: **do not depend on test execution order.** Bun may run files in parallel. A test that passes
only after another test seeded a row is a landmine — seed inside the test that needs it.

## Mutation testing, when coverage stops being informative

Coverage says a line ran. It cannot say an assertion would have caught a change. Mutation testing
answers that directly: flip `>` to `>=`, delete a line, negate a condition — if the suite still
passes, that test is decorative.

You do not need a tool to start. Take your most safety-critical function, manually break it three
ways, and run the suite. Anything that stays green tells you where the real gap is. This is the
highest-signal ten minutes available to a suite that has high coverage and low trust.

## When you find a bug

Write the failing test **first**, watch it fail for the right reason, then fix. Two things fall
out: proof the fix works, and a permanent guard against the regression.

`test.failing` is the honest way to land the test before the fix — it passes while the bug exists
and **fails the build the moment someone fixes it**, prompting the flip. `test.skip` is invisible
forever.
