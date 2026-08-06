# `bun:test` API — MEASURED on Bun 1.3.10

Everything below was confirmed by running it (`13 pass / 1 skip / 1 todo`), not recalled from
jest documentation. Where Bun differs from jest, it is called out.

## Exports

```
afterAll afterEach beforeAll beforeEach describe expect expectTypeOf it jest mock
onTestFinished setDefaultTimeout setSystemTime spyOn test vi xdescribe xit xtest
```

`jest` and `vi` are both present as compatibility namespaces — `jest.fn`, `jest.spyOn`,
`jest.useFakeTimers`, `jest.restoreAllMocks` all exist. Prefer the direct exports; the
namespaces are there so ported suites run unchanged.

## Lifecycle

Measured execution order for two tests in one `describe`:

```
beforeAll > a > afterEach > b        (afterEach runs between them, as expected)
```

`beforeEach`/`afterEach` nest with `describe`: outer hooks wrap inner ones. A hook that throws
fails the tests it guards rather than silently skipping them.

`onTestFinished(fn)` registers cleanup from *inside* a test body — useful when the resource is
created conditionally and an `afterEach` would not know whether to clean up.

## Control flow

| Form | Behaviour |
|---|---|
| `test.skip` / `xtest` / `xit` | not run, reported as skipped |
| `test.todo("name")` | reported as todo; run them with `--todo` |
| `test.failing(fn)` | **passes when the body fails** — for a known bug, fails loudly once fixed |
| `test.if(cond)` | runs only when `cond` |
| `test.skipIf(cond)` | inverse of the above |
| `test.only` / `describe.only` | run just this — CI should reject it (see below) |
| `test.each([[a,b,sum]])("%i + %i", fn)` | table-driven; `%i`/`%s`/`%p` interpolate into the name |

`test.failing` is the honest way to land a failing regression test: it documents the bug, keeps
CI green, and **fails the build the moment someone fixes it** so the test gets flipped. Far better
than `test.skip`, which is invisible forever.

Guard against a committed `.only`:

```bash
grep -rnE '\b(test|describe|it)\.only\(' test/ src/ && echo "committed .only" && exit 1
```

## Matchers

All confirmed present. Beyond the jest core (`toBe`, `toEqual`, `toStrictEqual`, `toMatchObject`,
`toThrow`, `toContain`, `toBeCloseTo`, `toHaveBeenCalledWith`, `toBeInstanceOf`, `toMatchSnapshot`,
`toMatchInlineSnapshot`), Bun ships **jest-extended built in**:

```
toSatisfy  toBeArrayOfSize  toBeEmpty  toInclude
```

Asymmetric matchers work inside `toEqual`:

```ts
expect(user).toEqual({ id: expect.any(String), email: expect.stringContaining("@") });
```

`expect.extend` and `expect.unreachable` both exist. `expect.unreachable("should have thrown")` is
the guard that makes a `try/catch` assertion honest — without it, a body that stops throwing runs
zero assertions and the test passes.

`expectTypeOf` gives compile-time type assertions, which is how you test that a generic actually
narrows.

### `toBe` vs `toEqual` vs `toStrictEqual`

```ts
expect({ a: 1 }).toBe({ a: 1 });          // ✗ different references
expect({ a: 1 }).toEqual({ a: 1 });        // ✓ structural
expect({ a: 1, b: undefined }).toEqual({ a: 1 });        // ✓ undefined keys ignored
expect({ a: 1, b: undefined }).toStrictEqual({ a: 1 });  // ✗ they are not ignored
```

`toEqual` ignoring `undefined` keys is usually what you want for API responses and usually *not*
what you want when asserting that a field was deliberately cleared.

## Doubles

```ts
const fn = mock((a: number) => a * 2);
fn(3);
fn.mock.calls;                 // [[3]]
fn.mock.results[0];            // { type: "return", value: 6 }
fn.mockClear();                // clear calls, keep implementation
fn.mockReset();                // clear calls AND implementation
fn.mockRestore();              // restore the original (spies)
fn.mockResolvedValue(x);       // present
fn.mockImplementationOnce(f);  // present
```

**`spyOn` passes through by default.** MEASURED: after `spyOn(obj, "greet")`, calling
`obj.greet("bob")` still returned `"hi bob"`. It is an observer until you add
`.mockImplementation()`. This differs from `jest.fn()` and is the single most surprising
behaviour in the runner — a spy on `mailer.send` really sends mail.

Always `mockRestore()` (or `jest.restoreAllMocks()` in `afterEach`); a spy left installed leaks
into every later test in the file.

`mock.module("./path", factory)` replaces a module **globally for the rest of the file**, and it
cannot be undone mid-file. An incomplete stub therefore surfaces as a failure in an unrelated
test far from its cause. Prefer a fake HTTP upstream or dependency injection; reach for
`mock.module` only for things you genuinely cannot inject, like a third-party SDK singleton.

## Time

`setSystemTime(new Date("2020-01-02T03:04:05Z"))` freezes `Date` globally; `setSystemTime()` with
no argument restores it. MEASURED to work.

It is global to the file, so an unrestored call bleeds into later tests. Where the code under test
accepts an injected clock, inject one instead — `fakeClock()` in `assets/testing/harness.ts`.

## CLI flags

```
--coverage                     generate a coverage profile
--coverage-reporter=text|lcov  text for humans, lcov for CI upload
--coverage-dir=<dir>           default "coverage"
--bail[=N]                     stop after N failures (default 1)
--timeout=<ms>                 per-test timeout, default 5000
--rerun-each=N                 run each file N times — the flake hunter
--reporter=junit --reporter-outfile=<f>   JUnit XML for CI test reporting
--dots                         compact progress output
--todo                         include test.todo bodies
-t <pattern>                   filter by test name
--watch                        re-run on change
```

`--rerun-each` is the flag most people never find and most need. `bun test --rerun-each=20 path/to/file`
is how you prove a suspected flake is fixed; a single green run proves nothing.

## `bunfig.toml`

```toml
[test]
coverage = true
coverageThreshold = { lines = 0.8, functions = 0.8, statements = 0.8 }
coverageSkipTestFiles = true
preload = ["./test/setup.ts"]
```

**The threshold keys are plural.** MEASURED: `{ line = 0.99 }`, `{ function = 0.99 }` and
`{ statement = 0.99 }` are silently ignored — no error, no warning, exit code 0 against 33% actual
coverage. A bare scalar (`coverageThreshold = 0.99`) also works and gates correctly. Full table in
SKILL.md.

`preload` runs before any test file — the place for global `expect.extend` registrations or a
shared DB container. Keep it small; every test file pays for it.

## Test discovery

Files matching `*.test.{ts,tsx,js,jsx}`, `*_test.*`, `*.spec.*` or `*_spec.*`, plus anything under
a `__tests__` directory. `bun test <filter>` treats the argument as a path substring, not a glob —
`bun test user` runs every file whose path contains `user`.
