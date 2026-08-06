# Observability

Three signals, and they answer different questions. Most services over-invest in the first and
skip the third.

| Signal | Answers | Cost |
|---|---|---|
| **Metrics** | is something wrong, and how wrong | cheap, aggregated, low cardinality |
| **Logs** | what happened to *this* request | expensive at volume |
| **Traces** | where did the time go across services | moderate; sample them |

## The four metrics that matter

Per endpoint: **rate, errors, duration, saturation.**

```
http_requests_total{route, method, status}       counter
http_request_duration_seconds{route, method}     histogram
```

**Label with the route TEMPLATE, never the resolved path.** `/users/:id` is one label value;
`/users/12345` is one per user, which is a cardinality explosion that will take down your metrics
backend before it takes down your service. The same applies to user ids, request ids and
timestamps — none of them belong in a label.

**Use histograms, not averages.** An average latency of 200 ms is consistent with everyone getting
200 ms and with 95% getting 50 ms while 5% get 3 s. Only the second is an incident, and only
percentiles show it. Alert on p99, look at p50 for capacity.

Also track saturation — the thing that predicts failure before it happens: connection pool
utilisation, queue depth, event loop lag. `Bun.nanoseconds()` around a `setTimeout(…, 0)` gives you
loop lag cheaply, and MEASURED, a single `JSON.parse` of a 1.81 MiB payload blocks the loop for
**76 ms**, so lag is a real signal in a JSON-heavy service.

## What to alert on

**Alert on symptoms users feel, not on causes.** "CPU is at 80%" is not an incident; "checkout p99
is 8 s" is. Cause-based alerts page you for conditions that are fine and stay silent for novel
failures.

A workable starting set:

| Alert | Why |
|---|---|
| error rate > X% for 5 min | users are seeing failures |
| p99 latency > SLO for 10 min | users are waiting |
| readiness failing on > 1 replica | capacity is going |
| circuit breaker `closed → open` | a dependency died |
| saturation (pool, queue) > 80% sustained | failure is approaching |

Every alert must be **actionable** and have a runbook link. An alert nobody acts on trains the team
to ignore the channel, which is worse than not having it — the next real page is ignored too.

Long windows over short ones: a 30-second blip that self-heals should not wake anyone.

## Log levels, and using them consistently

| Level | Meaning | Wakes someone |
|---|---|---|
| `debug` | development detail | no — off in production |
| `info` | notable lifecycle events: started, shut down, migration ran | no |
| `warn` | **operational** errors — bad input, upstream 503, rate limited | no, but trended |
| `error` | **programmer** errors — the process is of unknown correctness | yes |

This maps exactly onto the operational/programmer distinction in the `errors` skill, and that is
the point: `AppError.isOperational()` decides the level, so it is never a per-call-site judgement.
A 404 logged at `error` is how alert fatigue starts.

## Correlation

One id, threaded through everything. The shipped `withRequestId` middleware (in the `http-service`
skill) puts it in `AsyncLocalStorage` so `child({ requestId })` works from anywhere without passing
a parameter, and echoes it on the response so a user can quote it in a support ticket.

Propagate it to upstreams as a header, and accept an inbound one so a trace survives across
services. The middleware caps inbound length — it lands in logs, and an unbounded attacker-supplied
string is both a log-injection and a log-cost problem.

## Sampling

At scale, logging every request is the largest line on the observability bill and mostly stores
identical successful requests.

- **Always keep** errors, slow requests (over p99), and anything with a business-critical marker.
- **Sample** ordinary successes at 1–10%.
- **Tail-based sampling** for traces — decide after the request finishes, so you keep the slow and
  failed ones rather than a random 1% that mostly contains healthy traffic.

Head-based sampling (decide at the start) is simpler and keeps the wrong traces.

## Tracing

Worth the setup as soon as a request touches more than two services — it is the only signal that
answers "which hop is slow" without correlating timestamps by hand.

Instrument the boundaries first: inbound handler, outbound HTTP, database calls. That covers nearly
all real latency. Deep in-process spans add cost and rarely change a conclusion.

OpenTelemetry works in Bun via the node-compatible SDK; verify your exporter actually runs under
Bun before relying on it in an incident.

## Dashboards

One overview dashboard per service, readable in ten seconds during an incident: request rate,
error rate, p50/p99 latency, saturation, and the state of each dependency. Everything else goes on
a second, deeper dashboard.

The test is whether someone who did not build the service can answer "is it healthy?" from the
overview alone.

## What not to do

- **Do not log to files in a container.** The platform collects stdout; files are a disk-full
  incident and are lost when the pod is replaced.
- **Do not log secrets.** Redact by key name before serialisation — the `security` skill ships
  `redact()`, and the access-log middleware deliberately logs `url.pathname` only, since query
  strings carry tokens and emails.
- **Do not put unbounded values in metric labels.** Restated because it is the single most common
  way to take down a metrics backend.
- **Do not alert on every error.** Operational errors are normal traffic; alert on their *rate*.
