# Deployment

## Probe configuration

The numbers matter as much as the endpoints. These are the ones that cause incidents when wrong:

```yaml
readinessProbe:
  httpGet: { path: /health/ready, port: 3000 }
  periodSeconds: 5
  failureThreshold: 2        # remove from the LB quickly — a bad pod should stop getting traffic
livenessProbe:
  httpGet: { path: /health/live, port: 3000 }
  periodSeconds: 10
  failureThreshold: 6        # SLOW to restart — restarting rarely fixes anything
  initialDelaySeconds: 15
startupProbe:
  httpGet: { path: /health/live, port: 3000 }
  periodSeconds: 5
  failureThreshold: 30       # 150s budget for a slow first boot
```

**Readiness fails fast, liveness fails slow.** Removing a pod from the load balancer is cheap and
reversible; restarting it throws away in-flight work and warm caches. A liveness probe as twitchy as
a readiness probe produces restart storms during exactly the load spikes you needed capacity for.

Use a **startup probe** for anything with a slow boot (migrations, cache warming) instead of a long
`initialDelaySeconds` on liveness — otherwise you are choosing between a slow restart response
forever and a crash loop at startup.

## Grace period must exceed your shutdown budget

```yaml
terminationGracePeriodSeconds: 30
```

Your shutdown `timeoutMs` (default 25 s in the shipped code) must be **under** this. If shutdown
takes longer, Kubernetes SIGKILLs mid-write — the exact scenario graceful shutdown existed to
prevent.

The arithmetic to keep straight:

```
drainDelayMs (5s) + longest in-flight request + resource close < timeoutMs (25s) < grace period (30s)
```

If your slowest endpoint takes 20 s, this does not fit. Either shorten the endpoint or raise both
the timeout and the grace period together.

## Rollouts

```yaml
strategy:
  rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
```

`maxUnavailable: 0` means capacity never drops during a deploy. With `maxSurge: 1` the rollout is
sequential and safe; raise surge to go faster at the cost of peak resource usage.

**A rolling deploy runs two versions simultaneously.** Everything must be backward compatible for
the duration:

- **Database migrations must be expand/contract.** Add a nullable column, deploy code that writes
  both old and new, backfill, deploy code that reads new, *then* drop the old column in a later
  release. A migration that renames a column in one step breaks whichever version is not yet
  replaced — which is 50% of your traffic mid-rollout.
- **Never make a migration part of container startup.** With N replicas you get N concurrent
  migration attempts. Run them as a separate job that completes before the rollout begins.
- **API changes must be additive** for at least one release.

## Resource limits

```yaml
resources:
  requests: { memory: "256Mi", cpu: "100m" }
  limits:   { memory: "512Mi" }        # note: no CPU limit
```

Set a **memory limit** — without one, a leak takes down the node rather than one pod. Exceeding it
is an OOMKill, which is abrupt but contained.

**Consider omitting the CPU limit.** CPU is compressible: a limit causes throttling, which appears
as mysterious latency spikes at percentiles you care about while the node has idle cores. Requests
handle scheduling; limits mostly cause the problem they look like they prevent. Set one only when
you must protect noisy neighbours.

Bun's `--smol` flag reduces memory at the cost of more frequent GC — reach for it in a
memory-constrained sidecar, not in your main service.

## Replicas and statelessness

Run **at least 2 replicas**. One replica means every deploy and every node drain is a full outage,
regardless of how good your shutdown code is.

Stateless means: no session state in memory, no uploaded files on local disk, no in-process
scheduler assuming it is the only one. The specific trap is the in-process rate limiter shipped in
the `security` skill — it is **per-instance**, so N replicas means N × limit. Fine for coarse abuse
protection, not fine as a billing control.

`reusePort: true` on `Bun.serve` lets multiple processes share one port on the same host, which is
how you use more than one core without a reverse proxy in front.

## Zero-downtime checklist

1. ≥2 replicas, `maxUnavailable: 0`.
2. Readiness endpoint that actually flips on shutdown (wired to `installShutdown`'s `onNotReady`).
3. Grace period > shutdown timeout > drain delay + slowest request.
4. Migrations expand/contract, run as a separate job.
5. Exec-form `CMD` and an init as PID 1 — otherwise SIGTERM is ignored entirely.
6. A deploy verified by watching for 5xx during the rollout, not by the pods going green.

## Rollback

The fastest rollback is a redeploy of the previous image tag, which is why **immutable, uniquely
tagged images** matter — `:latest` cannot be rolled back to a specific build.

Rolling *back* is harder than rolling forward when a migration has run. This is the second reason
for expand/contract: each step is independently reversible, so the previous version still works
against the new schema.

## Environment parity

Staging should differ from production in **data and scale only** — not in runtime version, not in
configuration mechanism, not in topology. Pin the Bun version identically in both; a bug that
appears only in production because it runs a different Bun is the most expensive kind to find.

## Secrets

From the platform's secret store, injected as environment variables, parsed at boot (see
`project-setup`). Never in the image, never in the repo, never in a `ConfigMap`. Rotating a secret
should be a config change and a restart, not a rebuild.
