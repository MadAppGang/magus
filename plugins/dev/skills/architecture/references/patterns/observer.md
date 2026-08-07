# Observer

**Intent:** define a one-to-many dependency so that when one object changes state, all its
dependents are notified automatically.

## The force

One event, a growing list of reactions, and a publisher that should not know any of them:

```ts
async function registerUser(input: Input) {
  const user = await users.insert(input);
  await sendWelcomeEmail(user);      // each new reaction edits this function
  await provisionWorkspace(user);
  await notifySales(user);
  await seedAnalytics(user);
}
```

Four subsystems imported into one function. The test needs four fakes. The fifth reaction
edits it again.

## Structure

```ts
type Listener<E> = (event: E) => void | Promise<void>;

class Subject<E> {
  #listeners = new Set<Listener<E>>();

  subscribe(fn: Listener<E>): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);      // return the unsubscribe. Always.
  }

  async notify(event: E): Promise<void> {
    // Copy before iterating: a listener may unsubscribe during notification.
    for (const fn of [...this.#listeners]) {
      try { await fn(event) }
      catch (err) { log.error({ err }, "listener failed") }   // one failure must not stop the rest
    }
  }
}
```

Three details in that small block are the ones that get omitted and then hurt:

1. **`subscribe` returns the unsubscribe function.** Making cleanup the return value is what
   makes it hard to forget.
2. **Iterate a copy.** A listener that unsubscribes itself mutates the set mid-iteration.
3. **Isolate listener failures.** One throwing subscriber must not prevent the others from
   running, and must not surface as a failure of the publisher's own operation.

## Does TypeScript already do this

Several native options, all preferable to hand-rolling in most cases:

```ts
const target = new EventTarget();                     // DOM and Node and Bun
target.addEventListener("user.registered", handler, { signal });  // AbortSignal = auto-cleanup
```

**`AbortSignal` is the best answer to the leak problem**: one `controller.abort()` removes
every listener registered with that signal, so cleanup cannot be partially forgotten.

In frameworks, this pattern is usually already provided and you should use theirs: React's
`useEffect` cleanup, signals/reactivity systems, RxJS `Observable` for streams with
operators and backpressure.

## Trade-offs

| Gain | Cost |
|---|---|
| Publisher does not know its subscribers; reactions are added without editing it | No single place shows what happens on an event |
| Subscribers are independently testable | Debugging follows dynamic subscription, not static calls |
| Reactions can be added and removed at runtime | Notification order is usually unspecified; depending on it is a latent bug |

## The failure mode

**`UNI-07` Observer Memory Leaks** in `dev:code-roast`'s `sin-registry.md`: subscribe
without unsubscribe. The subject holds a strong reference to every listener, and through the
closure, to everything the listener captured. Long-lived subject plus short-lived
subscribers equals a leak that grows with uptime and is invisible until memory does.

Prevention: return the unsubscribe from `subscribe`, use `AbortSignal`, and tie subscription
lifetime to an owner's lifetime rather than to a manual call.

**Sync notification inside a transaction** is the second common bug: a listener that throws
can roll back the publisher's write, coupling exactly what the pattern was meant to
decouple. Publish after commit, or use the outbox in `../styles/event-driven.md`.

## When NOT to use this

- **Exactly one reaction, and it will stay one.** Call it directly; it is greppable.
- **The publisher needs the result.** Observers return nothing useful by design.
- **Ordering between listeners matters.** You want an explicit pipeline.
- **The reaction must survive a crash.** In-memory listeners do not. That needs a durable
  broker: `../styles/event-driven.md`.

## Relations

- **Mediator** (`mediator.md`) also decouples communication; Observer is one-to-many
  broadcast, Mediator is many-to-many routing.
- Across processes this becomes `../styles/event-driven.md`, where at-least-once delivery
  forces idempotency on every consumer.
- **Command** (`command.md`) objects are often what gets dispatched to listeners.
