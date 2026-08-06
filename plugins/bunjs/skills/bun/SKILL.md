---
name: bun
description: Router for the eight Bun/TypeScript skills — setup, HTTP, errors, testing, security, production, performance, TUI. Says which to read for a task, without loading them. Any Bun or TS work.
---

# Bun skill index — bunjs v0.2.2

You are holding the **index**, not the content. Its whole job is to tell you which one or
two files to open, so you pay for the guidance a task needs and nothing else.

**Read only what the task calls for.** Opening all eight is ~4,000 lines and defeats the
point of an index. Two is normal. Five means the task should be split.

## The eight

Paths resolve against **this plugin's own directory** — the tree this file was loaded from.

| Read this | When the task is about | Ships |
|---|---|---|
| `skills/project-setup/SKILL.md` | starting or restructuring a project, folder layout, strict tsconfig, typed env config, workspaces, linting | env parser + 24 tests |
| `skills/http-service/SKILL.md` | an HTTP server or JSON API — `Bun.serve` routes, middleware, request context, response shape, streaming | middleware + 38 tests |
| `skills/errors/SKILL.md` | error handling, validation boundaries, retry, timeout, circuit breaker, "make it fail gracefully" | AppError + 53 tests |
| `skills/testing/SKILL.md` | writing or fixing tests, `bun:test`, doubles, coverage gating, flaky tests | harness + 30 tests |
| `skills/security/SKILL.md` | auth, passwords, tokens, injection, rate limiting, CORS, headers, secrets, security review | guards + 51 tests |
| `skills/production/SKILL.md` | shipping — graceful shutdown, structured logging, health checks, Docker, signals, CI | logger + 29 tests |
| `skills/performance/SKILL.md` | something is slow, benchmarking, event-loop blocking, profiling | bench harness + 18 tests |
| `skills/tui/SKILL.md` | a terminal UI — OpenTUI, dashboards, full-screen CLI | theme + 119 tests |

## Routing

Match on **what the task will make you write**, not on the words the user used. Someone
who says "add login" is asking for `security`; someone who says "it's slow" is asking for
`performance` even though neither said the skill's name.

Most real tasks need a short ordered chain. Build code first, then harden it:

| Task | Read, in this order |
|---|---|
| new service or app from scratch | `project-setup` → `http-service` → `errors` |
| "add auth / login / signup" | `security` → `errors` |
| "build an API endpoint" | `http-service` → `errors` |
| "write tests" / "fix this flaky test" | `testing` |
| "get it deployed" / "the deploy drops requests" | `production` |
| "it's slow" | `performance` |
| a terminal UI or dashboard | `tui` |
| "review this for security" | `security` → `errors` |

Chains stop where the task stops. *"Create a todo app"* is
`project-setup` → `http-service` → `errors`; add `testing` only once there is something to
test, `security` only once it has users, `production` only when it is being shipped.
Reading all six upfront buys nothing you can act on yet.

## Two rules that come from the skills themselves

**Copy the shipped `assets/`, never retype them.** Six of the eight ship tested code —
error hierarchy, security guards, logger, test harness, env parser, benchmark harness.
Each skill has the exact `cp` line. Retyped versions drop the subtle parts: the
enumeration-timing burn, the full-jitter backoff, the cycle-safe cause walk.

**Every skill has an Acceptance section. It is the definition of done**, and it is the part
most likely to be skipped. `bun test` and `tsc --noEmit` are the floor in all eight — `bun run`
strips types without checking them, so a type error never surfaces at runtime.

## Scope

Only Bun is tested. Node and Deno at your own risk.

If the task is not Bun or TypeScript, say so and stop — none of these eight apply, and
guessing from them produces confident advice about the wrong runtime.
