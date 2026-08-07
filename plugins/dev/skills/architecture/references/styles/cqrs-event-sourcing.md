# CQRS and event sourcing

Two separate ideas that are constantly conflated. **You can do either without the other**,
and CQRS alone is by far the more common correct choice.

## First: CQS is not CQRS

The repo's `universal-patterns` skill teaches **CQS**. That is a different, much smaller
idea, and confusing them makes teams believe they already have CQRS.

| | CQS | CQRS |
|---|---|---|
| Scope | one method | the whole application |
| Rule | a method either changes state or returns data, never both | reads and writes use **separate models**, often separate stores |
| Cost | free, it is a coding habit | high: two models, synchronization, eventual consistency |
| Example | `getUser()` returns; `updateUser()` mutates | `OrderWriteModel` enforces rules; `OrderSummaryView` is a denormalized read table |

**Do CQS always.** Do CQRS when you can name the pressure below.

## The force behind CQRS

One model serving both sides gets pulled in opposite directions:

- **Writes** need invariants, normalization, and a small consistent transaction boundary.
- **Reads** need denormalization, joins already resolved, and shapes that match screens.

Serving a dashboard from a normalized write model means eight joins per page load. Shaping
the write model for the dashboard means the invariants get harder to enforce. CQRS stops
the tug of war by letting each side have its own model.

```
        ┌──────────────┐  commands   ┌────────────────┐
 client │              │────────────▶│  Write model   │  invariants, normalized
        │              │             └───────┬────────┘
        │              │                     │ events / projection
        │              │  queries    ┌───────▼────────┐
        │              │◀────────────│  Read model(s) │  denormalized, per screen
        └──────────────┘             └────────────────┘
```

**The moment the read model is separate, it is stale.** How stale, and what the user sees in
that window, is a product decision you must make explicitly. The classic symptom: a user
saves, gets redirected to a list, and does not see their own change.

Common mitigation: after a command, return enough for the client to render optimistically,
or read the user's own writes from the write model.

## CQRS without event sourcing

The version most teams should build. One database, one write model, plus materialized read
models updated by projection.

```ts
// Write side: enforces rules. Small, normalized, transactional.
async function placeOrder(cmd: PlaceOrder): Promise<void> {
  const order = Order.place(cmd);          // invariants live here
  await db.transaction(async (tx) => {
    await tx.insert(orders, order.toRow());
    await tx.insert(outbox, orderPlacedEvent(order));   // see event-driven.md
  });
}

// Read side: whatever shape the screen wants. No rules, no joins at query time.
async function orderSummary(id: string): Promise<OrderSummaryView | null> {
  return db.selectFrom("order_summary_view").where("id", "=", id).first();
}
```

This is a real, contained step. You can apply it to **one** aggregate that hurts, and leave
the rest of the app alone. CQRS is not an all-or-nothing architecture.

## Event sourcing

A separate decision: **store the sequence of events as the source of truth, and derive
current state by replaying them**, instead of storing current state and overwriting it.

```
state-oriented:   balance = 120                  (history lost on every update)
event-sourced:    Deposited 100
                  Deposited  50   ──replay──▶  balance = 120   (history IS the data)
                  Withdrew   30
```

**Take it when history is a business requirement**, not because it pairs well with CQRS:
audit and compliance, "how did this get into this state", temporal queries, or the ability
to build a new read model over past data by replaying.

What it costs, and none of these are optional:

| Concern | What you must build |
|---|---|
| Schema change | events are immutable and forever; you need **event versioning and upcasters** |
| Replay time grows | **snapshots** every N events |
| No `UPDATE`, no `DELETE` | corrections are compensating events; GDPR erasure needs crypto-shredding or a redaction design |
| Querying current state | impossible directly; you *must* have projections, which is why CQRS comes along |
| Debugging | reasoning about a stream, not reading a row |

## Trade-offs

| | Gain | Cost |
|---|---|---|
| **CQRS** | each side optimized independently; reads scale separately | two models to keep in sync; stale reads become a UX problem |
| **Event sourcing** | complete history; new projections over old data; audit for free | highest complexity in this directory; schema evolution is permanent |

## The failure mode to watch for

**Adopting both, everywhere, on day one.** This is the classic way to lose a year. Both are
tools for *specific aggregates under specific pressure*. Greg Young, who named CQRS, has
spent years telling people it is not a top-level architecture.

**Eventual consistency discovered by users first.** If nobody decided what the post-save
screen shows, the answer is "sometimes the old value", and it will be reported as a data
loss bug.

**Event sourcing with no versioning plan.** The first schema change after go-live is when
teams find out that events are immutable, and by then there are millions of them.

## When NOT to use this

- **CRUD with matching read and write shapes.** The overwhelming majority of features.
  One model is correct and two is waste.
- **Reads and writes have similar load and shape.** The pressure CQRS relieves is not there.
- **You need history but not replay.** An append-only audit log beside a normal table gives
  you most of the value for a fraction of the cost. Try this first.
- **The team has not shipped event-driven work before.** Read `event-driven.md`; event
  sourcing is that, with permanence.

## Relation to other styles

Projections are fed by events, so `event-driven.md` and its outbox are prerequisites in
practice. CQRS sits naturally inside one module of a `modular-monolith.md` or one service of
`microservices.md`, which is the granularity to apply it at. The write model is where
`hexagonal.md` pays off most, because invariants are exactly the logic worth isolating from
infrastructure.
