# bunjs

Bun and TypeScript toolkit for Claude Code. Install from the `magus` marketplace.

Eight skills, split by **the problem you are in**, not by book chapter — so an agent loads the one
that matches the moment, and nothing else.

| Skill | Command | Load it when |
|---|---|---|
| **`project-setup`** | `/bunjs:project-setup` | starting or restructuring a project — folder layout, strict tsconfig, typed env config, workspaces, tooling |
| **`http-service`** | `/bunjs:http-service` | building or reviewing an HTTP server — `Bun.serve` routes, middleware, request context, response conventions, streaming |
| **`errors`** | `/bunjs:errors` | error handling and resilience — operational vs programmer errors, validation boundaries, timeout/retry/circuit breaker |
| **`testing`** | `/bunjs:testing` | writing, fixing or reviewing tests — `bun:test`, component tests, doubles, coverage gating, flake control |
| **`security`** | `/bunjs:security` | hardening or reviewing — passwords, tokens, injection, rate limiting, CORS, headers, supply chain |
| **`production`** | `/bunjs:production` | shipping — graceful shutdown, structured logging, health checks, Docker, signals, CI |
| **`performance`** | `/bunjs:performance` | something is slow, or you are benchmarking — profiling, the optimisation order, measured fast paths |
| **`tui`** | `/bunjs:tui` | building or reviewing a terminal UI — OpenTUI, Yoga flexbox, gradient meters, colour-accurate screenshots |

Every skill carries `disable-model-invocation: true`, so **the commands above are how they get
found**. That is deliberate: Claude Code's skill listing is capped at 8,000 characters
marketplace-wide, and this plugin spends none of it.

## Why these claims are trustworthy

Every non-obvious statement in these skills was produced by **running it against Bun 1.3.10**, not
recalled. Where a measurement contradicted the folklore, the measurement won and is reported as
such — including a case where `Bun.file()` was *not* faster than `node:fs`.

The traps that measurement surfaced, each documented where it bites:

| Trap | Consequence |
|---|---|
| `coverageThreshold = { line = 0.9 }` in `bunfig.toml` | **silently ignored** — the keys are plural. CI goes green with the gate dead |
| `bun:sqlite` without `{ strict: true }` | a misspelled parameter binds nothing and returns `[]` — **no throw** |
| A `{ GET, POST }` route map receiving a `PUT` | falls through to `fetch()`; **no automatic 405** |
| `server.reload({ routes })` | **replaces** the whole route table — omitted routes start 404ing |
| `"/files/*"` wildcard | matches, but `req.params` is `{}` — it captures nothing |
| An unhandled rejection | fires the event and **does not terminate the process** |
| `spyOn(obj, "method")` | **calls through to the original** by default — it is an observer, not a stub |
| `JSON.stringify(new Error("x"))` | `{}` — name, message and stack are all non-enumerable |

## Copyable, tested code

Seven skills ship `assets/` you copy into your project rather than retype. **362 tests across the
plugin pass, with `tsc --noEmit` clean in every skill package.**

| Skill | Ships | Tests |
|---|---|---|
| `tui` | theme tokens, colour maths, widgets, shutdown handler | 119 |
| `errors` | `AppError` hierarchy, centralized handler, `withTimeout`/`retry`/`CircuitBreaker` | 53 |
| `security` | password/token handling, enumeration-safe login, rate limiter, CORS and headers | 51 |
| `http-service` | middleware chain, request context, access log, 405, response helpers, ETag, streaming | 38 |
| `testing` | component-test harness, controllable fake upstream, builders, fake clock | 30 |
| `production` | JSON logger, error serialisation, health checks, shutdown ordering, Dockerfile | 29 |
| `project-setup` | typed env config parser | 24 |
| `performance` | benchmark harness with calibration and honest comparison | 18 |

Each skill package is self-contained: `cd plugins/bunjs/skills/<name> && bun install && bun test`.

## Reference

These skills lean on the community's accumulated Node.js practice, adapted to Bun and verified
against it:

**[goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices)** — the
Node.js Best Practices repository. Its eight chapters map onto these skills as follows:

| nodebestpractices chapter | Skill |
|---|---|
| 1. Project Architecture Practices | `project-setup` |
| 2. Error Handling Practices | `errors` |
| 3. Code Patterns And Style Practices | `project-setup` |
| 4. Testing And Overall Quality Practices | `testing` |
| 5. Going To Production Practices | `production` |
| 6. Security Best Practices | `security` |
| 7. Performance Best Practices | `performance` |
| 8. Docker Best Practices | `production` |

Where Bun's behaviour differs from Node's — signal handling, unhandled rejections, the install
layout, the native API surface — these skills document the **measured Bun** behaviour rather than
the Node assumption.

## Scope

Only Bun is tested. Node and Deno at your own risk.
