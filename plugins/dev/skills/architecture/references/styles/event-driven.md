# Event-driven architecture

Producers announce that something happened. They do not know who reacts, or whether anyone
does.

## The force

`registerUser` starts as three lines. Then it sends a welcome email. Then it provisions a
workspace, notifies sales, seeds analytics, starts a trial. Now one function knows about six
subsystems, its test needs six fakes, and adding a seventh reaction means editing it again.

Event-driven inverts the direction of knowledge:

```
before: registerUser ──calls──▶ email, billing, analytics, crm     (producer knows all)
after:  registerUser ──emits──▶ "user.registered"                  (producer knows none)
                                        │
                        ┌───────────────┼───────────────┐
                     email          billing         analytics      (consumers know the event)
```

**Adding a reaction becomes adding a file, not editing one.** That is the entire benefit,
and everything below is the cost of it.

## Events vs commands: get this right first

They look identical on the wire and mean opposite things.

| | Event | Command |
|---|---|---|
| Says | `user.registered` — this happened | `SendWelcomeEmail` — do this |
| Tense | past | imperative |
| Recipients | zero to many, unknown | exactly one, known |
| May be ignored | yes, legitimately | no; ignoring it is a failure |
| Producer knows the consumer | no | yes |
| If nobody handles it | fine | bug |

Naming a command as an event (`user.send_email`) gives you the coupling of a command with
the delivery guarantees of an event, which is the worst of both.

## Delivery reality

The three facts that decide whether your design survives production:

1. **Delivery is at-least-once.** Duplicates will happen. **Every consumer must be
   idempotent** (running it twice has the same effect as running it once). Usually: key the
   work on the event ID and skip work already recorded.
   ```ts
   async function onUserRegistered(e: Event<UserRegistered>) {
     if (await processed.has(e.id)) return;          // idempotency guard, not optional
     await sendWelcomeEmail(e.data.email);
     await processed.add(e.id);
   }
   ```
2. **Ordering is not guaranteed** across partitions. If a consumer needs order, it needs a
   partition key (usually the aggregate ID) or a version number it can check.
3. **Consumers fail.** You need a retry policy and a dead letter queue, plus somebody who
   looks at the dead letter queue. An unmonitored DLQ is a silent data-loss channel.

## The dual-write problem, and the outbox

The single most common correctness bug in this style:

```ts
await db.insert(user);                       // committed
await broker.publish("user.registered", …);  // process dies here: event lost forever
```

Two systems, no shared transaction. The fix is the **outbox pattern**: write the event to a
table in the *same transaction* as the data, then a relay publishes it.

```ts
await db.transaction(async (tx) => {
  await tx.insert(users, user);
  await tx.insert(outbox, { topic: "user.registered", payload, id: crypto.randomUUID() });
});  // both commit or neither does; a relay polls outbox and publishes at-least-once
```

## What an event should carry

```ts
type Event<T> = {
  id: string;            // idempotency key
  type: string;          // "user.registered"
  occurredAt: string;    // when it happened, not when it was delivered
  version: number;       // schema version; consumers outlive producers
  data: T;
};
```

**Thin vs fat is a real decision.** A thin event (`{ userId }`) forces every consumer to call
back for details, which reintroduces coupling and load. A fat event (the whole user) is
self-contained but freezes a snapshot of your schema into every consumer. Default to
carrying what consumers need to act, and version it.

## Trade-offs

| Gain | Cost |
|---|---|
| Add reactions without touching the producer | No single place shows what happens on registration; the flow lives in the broker |
| Consumers fail independently; the producer stays up | Debugging spans processes and needs correlation IDs |
| Natural load levelling and retry | At-least-once forces idempotency into every consumer |
| Fits service boundaries without synchronous coupling | Eventual consistency becomes visible to users |

## The failure mode to watch for

**Nobody can answer "what happens when a user registers?"** The producer lists nothing and
the answer is spread across twelve subscribers. Mitigate with an event catalog kept in the
repo, and by naming events after business facts rather than technical triggers.

**Event-driven as a distributed `goto`.** Chains where A emits, B reacts and emits, C reacts
and emits back into A, produce cycles nobody designed. Events describe facts; if you are
using them to sequence a workflow, you want an explicit saga with a visible state machine.

**Observer memory leaks** (code-roast `UNI-07`) are the in-process version: subscriptions
without unsubscription. See `../patterns/observer.md`.

## When NOT to use this

- **The reaction must be synchronous and the caller needs the result.** Emitting an event
  and hoping is not a substitute for a return value.
- **Strong consistency is required.** "The balance must be right the instant the response
  returns" is not an eventual-consistency workload.
- **Two consumers, stable, no growth expected.** Direct calls are simpler and greppable.
- **No operational capacity for a broker**, DLQ monitoring, and replay.

## Relation to other styles

In-process, this is `../patterns/observer.md` (and `../patterns/mediator.md` for the bus). Across
services, this is the default communication mode in `microservices.md`, and events are also
the transport that makes `cqrs-event-sourcing.md` practical. In a `modular-monolith.md` you
get most of the decoupling with an in-process bus and none of the delivery cost, because
publish and handle share a transaction.
