# State

**Intent:** let an object alter its behaviour when its internal state changes, so it appears
to change its class.

## The force

Behaviour that depends on a mode, checked everywhere:

```ts
class Document {
  publish() {
    if (this.status === "draft")           { this.status = "moderation"; }
    else if (this.status === "moderation") { if (this.user.isAdmin) this.status = "published"; }
    else if (this.status === "published")  { /* nothing */ }
  }
  edit()    { if (this.status === "published") throw new Error("cannot edit published") /* … */ }
  archive() { /* the same chain again */ }
}
```

Every method repeats the same branching. Adding a state edits every method, and the legal
transitions are implicit in scattered conditionals rather than stated anywhere.

## Structure

One class per state. Each state implements the full interface and decides its own successor.

```ts
interface DocState {
  publish(doc: Document): void;
  edit(doc: Document, text: string): void;
}

class Draft implements DocState {
  publish(doc: Document) { doc.setState(new Moderation()) }     // knows its successor
  edit(doc: Document, text: string) { doc.text = text }
}

class Moderation implements DocState {
  publish(doc: Document) { doc.setState(new Published()) }
  edit(doc: Document, text: string) { doc.text = text }
}

class Published implements DocState {
  publish() { /* already published: no-op, stated explicitly */ }
  edit(): never { throw new Conflict("cannot edit a published document") }
}

class Document {
  #state: DocState = new Draft();
  setState(s: DocState) { this.#state = s }
  publish() { this.#state.publish(this) }                        // no conditionals left
  edit(text: string) { this.#state.edit(this, text) }
}
```

**The transitions are now data you can read.** `Draft.publish` names `Moderation`. The state
machine is written down instead of inferred from `if` chains.

## Strategy or State?

Same structure, and the difference is the whole reason both exist:

| | Strategy | State |
|---|---|---|
| Who selects the implementation | the client, from outside | the object itself, from inside |
| Do implementations know each other | no | **yes** — each knows its successors |
| Models | interchangeable algorithms | a state machine |

**If an implementation ever assigns the next implementation, it is State.**

## Does TypeScript already do this

For simple machines, a **transition table** is often clearer than classes, and it makes the
whole machine visible in one place:

```ts
const transitions = {
  draft:      { publish: "moderation" },
  moderation: { publish: "published", reject: "draft" },
  published:  { archive: "archived" },
} as const satisfies Record<string, Partial<Record<Action, Status>>>;

function next(status: Status, action: Action): Status {
  const to = transitions[status]?.[action];
  if (!to) throw new Conflict(`cannot ${action} from ${status}`);
  return to;
}
```

Take the table when states differ only in *which transitions are legal*. Take the classes
when each state also has substantially different **behaviour** and its own data.

## Trade-offs

| Gain | Cost |
|---|---|
| Conditionals disappear; transitions become explicit | A class per state, even for states with almost no behaviour |
| Adding a state does not edit the others | Transition logic is distributed; no one file shows the whole machine (the table form fixes this) |
| Illegal operations fail in one obvious place | State objects usually need a back-reference to the context |

## When NOT to use this

- **Two states with trivial differences.** A boolean and an `if` is correct.
- **Transitions never change and the machine is small.** Use the table.
- **The alternatives never transition between themselves.** That is `strategy.md`.

## Relations

- **Strategy** (`strategy.md`) — identical structure, different control of selection.
- **Memento** (`memento.md`) pairs with State to snapshot and restore a machine's position.
- At system scale, a long-running state machine across services is a saga; see
  `../styles/event-driven.md` for why an explicit machine beats implicit event chains.
