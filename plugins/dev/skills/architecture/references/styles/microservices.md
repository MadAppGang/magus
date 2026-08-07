# Microservices

Independently deployable services, each owning its data. **The cost is a distributed
system.** Read `modular-monolith.md` first and be able to say why it is not enough.

## The force

One deploy unit means one release train: an urgent billing fix waits for whatever is
half-finished in catalog. One runtime means one scaling decision: the image-processing path
needs 16 GB and the login path needs 200 MB, and both get 16 GB.

Microservices answer exactly two needs: **independent deploy** and **independent scale**.
If neither is a live pain, you are buying a distributed system for its aesthetics.

## The rules

1. **A service owns its data. Exclusively.** No other service touches its tables. This is
   the defining rule; break it and you have a distributed monolith (code-roast `UNI-13`).
2. **Boundaries follow the business, not the layers.** `billing`, `catalog`, `identity`.
   Never `database-service`, `validation-service`, `controller-service`.
3. **Communication is over the network, and the network fails.** Every call needs a timeout,
   a retry policy, and a decision about what to do when it stays down.
4. **Each service is independently deployable.** If shipping A requires shipping B at the
   same time, they are one service wearing two hats.

## What you must build that a monolith gave you free

This list is the actual price, and it is the part that gets left out of the proposal.

| Was free | Now you build it |
|---|---|
| A function call | timeout, retry with jitter, circuit breaker, fallback |
| A stack trace | distributed tracing with propagated correlation IDs |
| A database transaction | saga or outbox; there is no cross-service ACID |
| `console.log` in one place | log aggregation, or you grep 12 services by hand |
| "is it up" | per-service health, readiness, liveness (`UNI-14`) |
| One CI pipeline | per-service build, test, deploy, version, rollback |
| Refactoring a boundary | a data migration and a coordinated release |
| Running it locally | docker-compose, or stubs, or you cannot run it locally |

**A consistency note that decides designs.** Once data is split across services you cannot
have a transaction across them. You get eventual consistency and you must answer, per
workflow: what does the user see in the window before it converges, and what happens if
step 3 of 5 fails permanently? "We will use a saga" is the start of that answer, not the
end of it.

## Communication shapes

```
Synchronous (HTTP/gRPC)          Asynchronous (events)
caller waits for an answer       caller publishes and moves on
couples availability:            decouples availability:
  B down  ->  A degraded           B down  ->  B catches up later
use for: queries needing         use for: "this happened", fan-out,
  a fresh answer now               work that may be retried
```

Default to asynchronous between services and synchronous only where a fresh answer is
genuinely required. Chains of synchronous calls multiply failure: five services at 99.9%
in series give 99.5%, and the latencies add (`UNI-12`).

## Trade-offs

| Gain | Cost |
|---|---|
| Independent deploy; a team ships without coordinating | Every call can fail, time out, or arrive twice |
| Independent scale; pay for capacity where it is needed | No cross-service transactions; eventual consistency becomes a product decision |
| Fault isolation, if boundaries are right | Debugging spans services; you need tracing before you need it |
| Technology choice per service | Operational surface multiplies: CI, secrets, monitoring, on-call, per service |

## The failure mode to watch for

**The distributed monolith** (`UNI-11`): services that share a database, deploy together,
or call each other synchronously in long chains. You have paid the entire cost of
distribution and kept every constraint of a monolith. This is the most common outcome of a
microservices migration, not a rare one.

**Splitting by layer instead of by domain.** A `validation-service` that every request must
call is a network hop added to a function. Boundaries must cut where the *data* and the
*change reasons* separate.

**Nanoservices** (`UNI-15`): so fine-grained that a single user action fans out to a dozen
services. The coordination cost exceeds anything the split bought.

## When NOT to use this

- **You cannot name the boundaries yet.** Then you cannot get them right, and here they are
  expensive to change. Build `modular-monolith.md` until the seams are obvious.
- **One team.** Microservices solve a coordination problem you do not have; you get the
  operational cost with no organizational benefit.
- **No operational maturity.** Without tracing, aggregated logs, and per-service CI already
  in place, an outage becomes a search across services with no map.
- **Deploy and scale are both fine today.** That is the whole value proposition.

## Relation to other styles

Inside each service, use `hexagonal.md` or `layered.md`. Between services, `event-driven.md`
is the default and `cqrs-event-sourcing.md` becomes attractive because the read model can
be built from events that already cross service boundaries.

The honest migration order is: `layered` → `modular-monolith` → extract the one module that
demonstrably needs independent deploy or scale. Extracting one service is a normal quarter.
Rewriting into twelve at once is how the distributed monolith gets built.
