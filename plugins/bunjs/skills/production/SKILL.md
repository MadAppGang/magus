---
name: production
description: Ship a Bun service — graceful shutdown ordering, structured logging, liveness vs readiness, multi-stage Docker, signals and PID 1, frozen lockfiles, CI. Ships tested logger, shutdown and health code plus a Dockerfile.
disable-model-invocation: true
---

# Going to production

The gap between "it runs" and "it runs unattended" is a short list of specific behaviours. Most of
them are invisible until a deploy drops requests or a restart loop starts at 2am.

**29 tests ship with this code and pass** (`bun test`, `tsc --noEmit` clean, Bun 1.3.10).

```bash
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/production}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"  # that var is UNSET in a Bash tool (MEASURED) — so paste it. `:?` would ABORT the block and copy nothing
mkdir -p src; if [ -d "$SKILL/assets" ]; then cp -r "$SKILL/assets/production" src/runtime   # logger + shutdown + tests + Dockerfile + dockerignore.example
else echo "SKILL is still the placeholder — paste the real dir above and re-run"; fi
```

The `Dockerfile` and `dockerignore.example` are copied alongside the code — move them to the repo
root (`.dockerignore`) rather than leaving them under `src/`.

## Shutdown: the ordering is the whole thing

When an orchestrator removes a pod it does two things roughly at once — sends `SIGTERM`, and tells
the load balancer to stop routing. **Those propagate at different speeds**, so for a second or two
after SIGTERM traffic is still arriving. Stopping the listener first (the obvious implementation)
drops exactly those requests, which is why deploys "occasionally" 502.

```
1. flip readiness to NOT ready     → the LB removes us on its next probe
2. wait drainDelayMs (default 5s)  → let in-flight routing decisions land
3. server.stop()                   → stop accepting; MEASURED to wait for in-flight requests
4. close resources (DB, queues)    → only now, when nothing can still need them
5. exit 0
```

MEASURED (Bun 1.3.10): `server.stop()` with **no argument** resolves only after in-flight requests
finish — a 300 ms request signalled at t+80 ms drained in 226 ms. `stop(true)` force-closes and is
the deadline fallback. A shipped test asserts the sequence order and that `stop` is called without
`force` on the happy path.

`timeoutMs` must be **shorter than your orchestrator's grace period** (Kubernetes defaults to 30 s).
Exiting cleanly just before being SIGKILLed is strictly better than being killed mid-write.

## PID 1 will ignore your SIGTERM

In a container your process is PID 1, and **PID 1 has no default signal handlers** — `SIGTERM` is
ignored unless you explicitly handle it. Two consequences:

- Use the **exec form** of `CMD`: `CMD ["bun", "run", "dist/index.js"]`. The shell form
  (`CMD bun run …`) puts `/bin/sh` at PID 1, and it does not forward signals to its child.
- Use an init (`tini`) as `ENTRYPOINT`. It also reaps zombies, which a long-lived process spawning
  subprocesses will otherwise accumulate.

Get this wrong and every deploy waits out the full grace period before a SIGKILL — which looks
like "deploys are slow" rather than "shutdown is broken".

## Health: two endpoints, not one

| | Question | Checks | On failure |
|---|---|---|---|
| **liveness** `/health/live` | is this process wedged? | **nothing external** | restart the container |
| **readiness** `/health/ready` | should traffic come here? | only what you cannot serve *any* request without | remove from the LB |

**A liveness probe that checks the database will restart a healthy process during a database blip**,
turning a partial outage into a total one — and the restart storm then makes recovery slower.

`runHealthChecks` supports `critical: false` for dependencies that degrade rather than disable the
service (a cache, a recommendations API). A shipped test asserts a failing non-critical check
yields `degraded`, not `unhealthy`. It also runs checks **concurrently** and times each one out —
a hanging dependency must not hang the probe.

```ts
const ready = readinessFlag();
Bun.serve({
  routes: {
    "/health/live": new Response("ok"),        // static: no allocation, no dependencies
    "/health/ready": async () => {
      if (!ready.isReady) return new Response("draining", { status: 503 });
      const report = await runHealthChecks(checks);
      return Response.json(report, { status: report.status === "unhealthy" ? 503 : 200 });
    },
  },
  …
});
ready.markReady();
installShutdown(server, { onNotReady: ready.markNotReady, resources: [{ name: "db", close: () => db.close() }] });
```

## Logging: JSON lines, or it is not queryable

`console.log("user " + id + " failed")` cannot answer "how many failures for this user in the last
hour" without a regex that breaks when someone edits the message. One JSON object per line makes
every field a dimension.

The trap the shipped logger closes: **`JSON.stringify(new Error("x"))` is `{}`** — `name`,
`message` and `stack` are all non-enumerable. A test demonstrates that directly, then asserts
`serializeError` recovers them plus any custom fields and the whole `cause` chain.

Three more properties that matter, each tested:
- **A filtered-out line costs nothing** — 10,000 `debug` calls under `level: "error"` never touch
  the payload. That is what makes leaving debug logging in the code affordable.
- **It never throws.** Circular objects and `BigInt` both make `JSON.stringify` throw; a logger
  that can crash the app is worse than no logger.
- **`child()`** binds request-scoped fields, so every line in a request carries its `requestId`
  without threading a parameter.

Log to **stdout**, one line each. Do not write files, do not rotate — the platform collects stdout,
and a file-writing process in a container is a disk-full incident waiting to happen.

## Docker

The shipped `Dockerfile` is multi-stage with the manifest-copy-first ordering, so an ordinary
source edit skips dependency installation entirely. Key points, all in the comments there:

- **Pin the image** (`oven/bun:1.3.10-alpine`, never `latest`) — otherwise a runtime upgrade
  reaches production without a code change and cannot be bisected.
- `bun install --frozen-lockfile` so the image holds exactly what was reviewed.
- Typecheck **and test inside the build**. `bun run` strips types without checking them, so the
  build is the only place a type error gets caught.
- Run as the non-root `bun` user the base image already provides.
- `.dockerignore` is a **separate list from `.gitignore`** and people update only one. A stray
  `.env` copied by `COPY . .` ships credentials *inside the image*, and deleting it in a later
  layer does not remove it.

MEASURED on `bun build --compile`: the binary is **58 MB**, and `--bytecode --minify` does not
shrink it — the Bun runtime dominates. Compile for single-file distribution (a CLI), not to make a
container smaller. Note it also **autoloads `.env` by default**; pass
`--no-compile-autoload-dotenv` if that is not what you want.

## Configuration and secrets

Parse config at boot and crash on anything invalid — an orchestrator will not shift traffic to a
container that never became ready, so a bad config becomes a failed deploy rather than an incident
an hour later. The tested parser is in the `project-setup` skill.

Secrets come from the platform's secret store as environment variables, never from a file in the
image and never from the repository. `Bun.env === process.env` (MEASURED — the same object).

## Acceptance — before reporting done

1. `bun run typecheck`, `bun test`, `bun audit` all clean; CI installs with `--frozen-lockfile`.
2. **Prove shutdown works** rather than assuming: start it, send `SIGTERM` mid-request, confirm
   the in-flight request completes and the exit code is 0.
   ```bash
   bun run dist/index.js & PID=$!; sleep 1; curl -s localhost:3000/slow & sleep 0.1
   kill -TERM $PID; wait $PID; echo "exit=$?"     # expect 0, and the slow request answered
   ```
3. `/health/live` touches **no** external dependency. Grep it and check.
4. Every log line is JSON on stdout; no `console.log` of bare strings in `src/`:
   ```bash
   grep -rn 'console\.log(' src/ | grep -v 'JSON.stringify' | grep -v 'src/runtime/'
   ```
5. Image runs as non-root, `CMD` is exec-form, image tag is pinned.
6. `.dockerignore` exists and excludes `.env` — check both lists, not one.

## References

| File | Read it when |
|---|---|
| `references/deployment.md` | orchestrator settings, probes, rollouts, replicas, resource limits, migrations |
| `references/observability.md` | metrics, tracing, what to alert on, log levels and sampling, correlation |
