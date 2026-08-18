# bunjs

Bun and TypeScript toolkit for Claude Code. Install from the `magus` marketplace.

**Start here: `/bunjs:bun <what you want to do>`.**

```
/bunjs:bun lets create a todo app
```

That is the index skill. It knows all eight of the others and loads **none** of them — it names
the one or two a task actually needs, then reads only those. Opening all eight is ~4,000 lines,
which defeats the point.

It routes on what the task will make you write, not on the words used: *"add login"* → `security`,
*"it's slow"* → `performance`. Chains stop where the task stops — a fresh app is
`project-setup` → `http-service` → `errors`, with `testing` added once there is something to test
and `production` once it is being shipped.

The eight are split by **the problem you are in**, not by book chapter:

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

The eight carry `disable-model-invocation: true` and never appear in the model's skill listing;
**only the `bun` index is listed**, at 187 characters. That is the whole point — one findable
entry costs a fraction of nine visible ones, and it is what the discovery measurements below
pointed at. That is deliberate: Claude Code's skill listing is capped at 8,000 characters
marketplace-wide, and this plugin spends none of it.

**There are two discovery paths, and they are for different actors.**

| Path | Who uses it | Status |
|---|---|---|
| `/bunjs:<name>` command | a **human** typing it | works — the command instructs the model to read `SKILL.md` |
| A `CLAUDE.md` row naming **a file to read** | the **model**, unprompted | works — **measured** |
| A `CLAUDE.md` row saying *"invoke the Skill tool"* | the **model**, unprompted | works too — **re-measured 2026-08-18** |

**Correction.** That last row used to read *"does not work — measured"*, on the strength of
IDX-1 reporting that the Skill tool never fires for these skills. Re-measured at `--repeat 8`
on Sonnet 5 (24/24 pass, flake rate 0):

| routing row | `disable-model-invocation` | Skill tool fired |
|---|---|---|
| none | yes | **0/8** |
| *"invoke it with the Skill tool"* | yes | **8/8** |
| none | no | **8/8** |

The original finding came from madbench's `skill-used` check returning 0 — a check that at
the time **could not pass for any agent in any setup**, because it read a derived view that
never contains skill rows (fixed upstream as madbench#26). A check that cannot fire is not
evidence of absence.

What IDX-1 does establish, and this is the part worth keeping: **without a routing row the
flag hides the skill completely (0/8), and a row reaches it (8/8).** The row is what matters.
Naming a path is still the better default — it is the one phrasing that works regardless of
whether the reader can invoke the tool — but it is a preference now, not a measured
constraint.

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

## Does an agent actually reach these skills?

`benches/skill-index/` (IDX-1) in magus-src is a [madbench](https://github.com/MadAppGang/madbench) experiment that
measures it rather than assuming. Cells differ by exactly one file; a generator refuses to build
unless that is true.

Current numbers, `--repeat 8` on Sonnet 5, 24/24 pass, flake rate 0 (2026-08-18):

| Cell | Skill tool fired | `SkillReached` |
|---|---|---|
| skill unlisted, no routing row | 0/8 | 0 |
| skill unlisted, row says *"invoke the Skill tool"* | **8/8** | **1** |
| skill listed (flag removed), no row | **8/8** | **1** |

The `"invoke the Skill tool"` row previously showed **0** here. That was an artifact: madbench's
`skill-used` check read a derived view that never contains skill rows, so it could not pass for
any agent in any setup (fixed upstream as madbench#26). The row works.

Two traps it had to survive, both documented in the `benches/skill-index/` README in magus-src.
The first is that artifact — **a check that cannot fire reads exactly like a feature that does
not work**, and it stood as a measured finding for eleven days. The second is that the obvious
code fingerprints (`Bun.password`, `timingSafeEqual`) score **identically with and without the
skill**, because the model writes them from general knowledge. Both produced a confident wrong
answer; only one was caught at the time.

## Reference

These skills lean on the community's accumulated Node.js practice, adapted to Bun and verified
against it:

**[goldbergyoni/nodejs-testing-best-practices](https://github.com/goldbergyoni/nodejs-testing-best-practices)**
— the testing-specific companion. The `testing` skill takes its **five backend exit doors**
(response · state change · external calls · message queue · observability), its
deny-by-default network isolation, its data clean-up and pre-seeding rules, and its message
queue guidance. Where it and this plugin disagreed — clean-up timing, and whether to read
state back through the public API or a direct query — the skill states both positions and
the trade rather than silently picking one.

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
