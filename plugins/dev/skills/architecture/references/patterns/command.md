# Command

**Intent:** turn a request into a standalone object containing everything needed to perform
it, so requests can be queued, logged, parameterized, and undone.

## The force

A request that must outlive the moment of asking. If you need any of these, you need the
request to be **data**:

- undo and redo
- a job queue or retry after failure
- an audit trail of what was asked, by whom, when
- macro commands built from other commands

A direct method call cannot be stored, replayed, or reversed.

## Structure

```ts
interface Command {
  execute(): void;
  undo(): void;
}

class AddTextCommand implements Command {
  constructor(private doc: Document, private text: string, private at: number) {}
  execute() { this.doc.insert(this.at, this.text) }
  undo()    { this.doc.delete(this.at, this.text.length) }   // enough state to reverse itself
}

class History {
  #done: Command[] = [];
  run(cmd: Command) { cmd.execute(); this.#done.push(cmd) }
  undo() { this.#done.pop()?.undo() }
}
```

**The command captures its own arguments at construction.** That is what makes it storable:
by the time `undo()` runs, the original call site is long gone, so everything needed must
already be inside the object.

## Does TypeScript already do this

**A closure is a command** when you only need `execute`:

```ts
type Job = () => Promise<void>;
const queue: Job[] = [];
queue.push(() => sendEmail(user.email, "welcome"));   // arguments captured, deferred
```

Use the object form when you need more than one operation on the request (`undo`), or when
the command must be **serialized**. That last point is decisive for job queues: a closure
cannot be written to Redis or Postgres. A plain data command can:

```ts
type Command =
  | { type: "add_text"; at: number; text: string }
  | { type: "delete";   at: number; length: number };

// Serializable, versionable, replayable, inspectable in the database.
function apply(doc: Document, cmd: Command): void {
  switch (cmd.type) {
    case "add_text": return doc.insert(cmd.at, cmd.text);
    case "delete":   return doc.delete(cmd.at, cmd.length);
    default: return assertNever(cmd);
  }
}
```

This data form is what CQRS commands and event-sourced events actually are; see
`../styles/cqrs-event-sourcing.md`.

## Trade-offs

| Gain | Cost |
|---|---|
| Requests become storable, queueable, loggable, reversible | A class or variant per operation |
| Undo/redo becomes a stack, not bespoke logic | `undo()` must be genuinely correct, which is harder than it looks |
| Invoker is decoupled from receiver | Indirection between asking and doing |

**The hard part is `undo`.** Reversing requires either enough information to invert the
operation, or a snapshot of what came before. When inversion is not possible (a formatting
change that lost data), pair with `memento.md`.

## When NOT to use this

- **You do not need queueing, undo, logging, or serialization.** Then it is a method call
  wearing a class.
- **The operation is not reversible and history is not needed.** The main benefit is gone.
- **A closure suffices.** Do not add an interface for a deferred function call.

## Relations

- **Memento** (`memento.md`) supplies the previous state when `undo()` cannot compute it.
- **Composite** (`composite.md`) makes macro commands: a command containing commands, with
  the same interface.
- **Strategy** (`strategy.md`) also encapsulates behaviour; Strategy varies *how* a step
  runs, Command records *what was requested*.
- Queued commands crossing a process boundary become messages: `../styles/event-driven.md`.
  Note the distinction there — a command has exactly one handler, an event has zero or many.
