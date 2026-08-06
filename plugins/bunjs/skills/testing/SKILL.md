---
name: testing
description: Write and fix Bun tests — bun:test surface, component tests over HTTP, doubles, coverage gating, flake control. Ships a tested harness, fake upstream and builders. Includes a measured silent-coverage-gate trap.
disable-model-invocation: true
---

# Testing in Bun

`bun:test` is jest-compatible and fast enough that the usual excuses for a thin suite do not
apply — a full server start, request and shutdown cycle runs in well under 50 ms (MEASURED,
asserted by a shipped test). The interesting decisions are therefore not "which runner" but
**what to test, at what level, and how to keep it from lying to you.**

Two things in this skill are measured behaviour you cannot guess:

1. **`coverageThreshold` keys are silently ignored when singular** — your CI gate may be dead right now.
2. **`spyOn` calls through to the original by default** — unlike `jest.fn()`, it is an observer, not a stub.

Both are below, with the measurements.

## Test at the component level by default

The single highest-leverage choice. A component (API) test drives your real server over real HTTP:

```
✗ unit-mocking     call handler(req) directly, mock the service, mock the repo
✓ component        start the real server, POST /users, assert the response and the DB row
```

Calling a handler as a function skips routing, method matching, body parsing, header handling,
the `error()` hook and the status your framework actually produces. Every one of those has
shipped a bug. Worse, a suite built from mocks asserts that *your mocks* agree with each other —
it goes green while the real wiring is broken, which is the failure mode that erodes trust in a
suite until nobody reads it.

Reserve isolated unit tests for genuinely algorithmic code: pricing rules, parsers, state
machines, backoff policy. Those have many input combinations and no I/O, which is exactly when
isolation pays.

## Copy the harness in

**30 tests ship with this code and pass** (`bun test`, `tsc --noEmit` clean, Bun 1.3.10).

```bash
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/testing}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"  # that var is UNSET in a Bash tool (MEASURED) — so paste it. `:?` would ABORT the block and copy nothing
mkdir -p test; if [ -d "$SKILL/assets" ]; then cp -r "$SKILL/assets/testing" test/support   # harness + builders + 2 test files
else echo "SKILL is still the placeholder — paste the real dir above and re-run"; fi
```

| Export | What it gives you |
|---|---|
| `startTestServer(opts)` | your real `Bun.serve` config on an **ephemeral port**, with `.fetch()`, `.json()`, idempotent `.close()` |
| `startFakeUpstream()` | a controllable dependency: `failNext(n)`, `hangNext(ms)`, `enqueue(res)`, and a `requests[]` log |
| `fakeClock()` | injectable `now`/`sleep` that records delays instead of waiting |
| `builderFor<T>()` | complete valid objects; tests state only their deviation |
| `seededRandom(seed)` | reproducible pseudo-random data |
| `waitFor(cond)` | poll until true, instead of guessing a sleep duration |

**Pass the same config object your production entrypoint passes.** Export a `makeServerOptions()`
from your app and feed it to both; if the test builds a different config, it is testing a
different server. `port: 0` is forced on top so parallel files never collide — a hardcoded port
is a guaranteed flake under `--shard`.

## The coverage gate that silently does nothing

MEASURED on Bun 1.3.10 against a file with **50.00% function / 33.33% line** coverage and a
threshold of `0.99`. `exit=0` means the gate never fired:

| `bunfig.toml` → `[test] coverageThreshold =` | exit |
|---|---|
| `0.99` | **1** ✅ |
| `{ lines = 0.99 }` | **1** ✅ |
| `{ functions = 0.99 }` | **1** ✅ |
| `{ statements = 0.99 }` | **1** ✅ |
| `{ line = 0.99 }` | **0** ❌ |
| `{ function = 0.99 }` | **0** ❌ |
| `{ line = 0.99, function = 0.99, statement = 0.99 }` | **0** ❌ |

**The keys are plural only.** Singular spellings produce no error and no warning — the coverage
table still prints, the run still passes, and CI reports green with the gate dead. The singular
form is the one most people guess, which is what makes this worth knowing.

```toml
# bunfig.toml — verified to actually fail the run
[test]
coverage = true
coverageThreshold = { lines = 0.8, functions = 0.8, statements = 0.8 }
coverageSkipTestFiles = true
```

Verify yours rather than trusting it: **lower a threshold to `0.99` and confirm `bun test` exits
1.** A gate you have never seen fail is not a gate.

Coverage is a floor, not a goal. It tells you which `catch` blocks never ran — treat an uncovered
error branch as untested, because it is. It cannot tell you whether the assertions mean anything.

## Doubles: `spyOn` observes, `mock` replaces

MEASURED: `spyOn(obj, "greet")` recorded the call **and still returned `"hi bob"`** from the real
implementation. This differs from `jest.fn()` and from most people's expectation.

```ts
const spy = spyOn(mailer, "send");        // still really sends — observation only
spy.mockImplementation(async () => {});   // NOW it is a stub
spy.mockRestore();                        // always restore, or you leak into the next test
```

Prefer the fake upstream over module mocking. `mock.module()` is global and persists for the rest
of the file, so an incomplete stub leaks into unrelated tests as a confusing failure far from its
cause. A fake HTTP server has none of that coupling and exercises your real client:

```ts
const upstream = startFakeUpstream();
upstream.failNext(2, 503);                          // two failures, then success
const result = await chargeCustomer({ baseUrl: upstream.url });
expect(upstream.requests).toHaveLength(3);          // the retry policy, proven
```

Assert on **what you sent**, not only what came back — `requests[0].headers.get("idempotency-key")`
is the assertion that catches a broken retry.

## Naming: what, under what conditions, expecting what

```ts
test("returns 409 when the email is already registered", …)   // ✓
test("createUser works", …)                                    // ✗ tells a failing CI nothing
```

The name is read at 3am from a CI log with no code in front of you. It should say what broke.
Structure the body as arrange / act / assert with blank lines — three visual blocks, no comments
needed.

## Flake control

Flakes are worse than failures: they train the team to hit rerun, and then a real regression gets
rerun too. The three sources, in order of frequency:

1. **Real time.** `await Bun.sleep(500)` is too short on a loaded CI runner and wasted everywhere
   else. Use `waitFor(cond)` to poll, and `fakeClock()` where the code accepts an injected clock.
2. **Shared state.** A hardcoded port, a fixed row id, a module-level cache. Ephemeral ports and
   `builderFor`'s sequence counter remove two of the three.
3. **Unseeded randomness.** `Math.random()` gives a suite that fails once a week and passes on
   rerun. `seededRandom(seed)` makes any failure replayable — print the seed on failure.

Hunt them with the flag built for it: `bun test --rerun-each=20` runs each file 20 times. Run it
on anything you suspect before declaring it fixed; a flake that "went away" after one green run
did not.

`bun:test` also ships `setSystemTime()` for freezing `Date` globally (MEASURED to work in 1.3.10),
but prefer an injected clock — global time travel leaks across tests in the same file and
interacts badly with timers.

## Acceptance — before reporting done

1. `bun test` green **and** `tsc --noEmit` clean. Type errors in tests are real bugs; test files
   are the easiest place for an `any` to hide a broken contract.
2. **Every `expect(...).rejects` is awaited.** Without the outer `await` the assertion passes
   unconditionally — the test finishes before the promise settles. This is the most common
   silently-passing test in an async suite:
   ```bash
   grep -rn 'expect(' test/ src/ | grep 'rejects' | grep -v 'await expect'
   ```
3. **No bare `try/catch` used as an assertion** without `expect.unreachable()` — if the code stops
   throwing, zero assertions run and the test still passes.
4. Confirm the coverage gate fires (lower a threshold, see it exit 1), then restore it.
5. New error paths have tests. They run precisely when something is already wrong, so an untested
   `catch` is a second failure waiting to compound the first.

## References

| File | Read it when |
|---|---|
| `references/bun-test-api.md` | you need the exact surface — matchers, lifecycle, `test.each/if/failing`, CLI flags, all MEASURED on 1.3.10 |
| `references/test-strategy.md` | deciding what to test at which level, test doubles policy, what not to test, mutation testing |
| `references/database-testing.md` | tests that touch a real database: isolation, transactions, migrations, `bun:sqlite` in-memory |
