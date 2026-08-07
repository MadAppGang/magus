# Behavioral patterns

**The family's question: how is responsibility and control flow divided between objects?**

The largest family (10 of the 22). They are about communication: who asks whom, who decides
what, and how much any participant needs to know about the others.

| Pattern | Divides | Read |
|---|---|---|
| **Chain of Responsibility** | pass a request along handlers until one takes it | `patterns/chain-of-responsibility.md` |
| **Command** | turn a request into an object you can queue, log, undo | `patterns/command.md` |
| **Iterator** | traverse a collection without exposing its internals | `patterns/iterator.md` |
| **Mediator** | route N-to-N communication through one hub | `patterns/mediator.md` |
| **Memento** | capture and restore state without breaking encapsulation | `patterns/memento.md` |
| **Observer** | notify many dependents when one thing changes | `patterns/observer.md` |
| **State** | let an object change behaviour when its state changes | `patterns/state.md` |
| **Strategy** | swap one interchangeable algorithm for another | `patterns/strategy.md` |
| **Template Method** | fix the skeleton, let subclasses fill steps | `patterns/template-method.md` |
| **Visitor** | add operations to a type hierarchy without editing it | `patterns/visitor.md` |

## The pairs that get confused

**Strategy vs State.** Structurally identical: an object delegating to a swappable
implementation. The difference is *who swaps it and why*.

| | Strategy | State |
|---|---|---|
| Who chooses | the client, from outside | the object itself, from inside |
| Do implementations know each other | no, they are independent | yes, each knows its successors |
| Models | interchangeable algorithms | a state machine |
| Example | `sortBy(comparator)`, hashing algorithm | `Draft → Published → Archived` |

If the alternatives never transition between themselves, it is Strategy. If `Draft` decides
the next thing is `Published`, it is State.

**Strategy vs Template Method.** Same goal (vary part of an algorithm), different mechanism:
Template Method uses inheritance and fixes the variation at compile time; Strategy uses
composition and can change at runtime. Prefer Strategy: one class can hold several
strategies, but it can only have one parent.

**Observer vs Mediator.** Observer is one-to-many broadcast where the subject does not know
its listeners. Mediator is many-to-many routing where colleagues know only the mediator.
Reach for Mediator when the *communication itself* has become the complexity.

**Command vs Strategy.** Both wrap behaviour in an object. Strategy answers "*how* do I do
this step"; Command answers "*what* was requested", and it is the one that gets queued,
logged, retried, and undone.

## Choosing inside the family

```
A growing if/else or switch on a type or mode?
    ├─ branches are independent alternatives        → Strategy
    └─ branches also determine what happens next    → State
"Undo", an audit trail, a job queue?                → Command (+ Memento for snapshots)
One change must notify many, unknown, listeners?    → Observer   (across processes: styles/event-driven.md)
N objects all talking to each other?                → Mediator
A request that several handlers might process?      → Chain of Responsibility
Adding a new operation means editing every class?   → Visitor
Same skeleton, differing steps?                     → Template Method (prefer Strategy)
Traversal without exposing internals?               → Iterator (in TS: Symbol.iterator)
```

## Does TypeScript already do this

More of this family collapses into functions than any other, because a behavioural pattern
is usually "an object with one method", and TypeScript has those natively.

| Instead of | TypeScript gives you |
|---|---|
| `interface Strategy { execute() }` + N classes | a function type: `type Compare<T> = (a: T, b: T) => number` |
| `interface Command { execute() }` | a closure that captures its arguments |
| Iterator class with `hasNext`/`next` | `Symbol.iterator`, generators, `for...of` |
| Observer with `attach`/`detach`/`notify` | `EventTarget`, an `EventEmitter`, or a `Set<(e: E) => void>` |
| Template Method subclassing | a function taking the varying steps as callbacks |

**Take the function form by default and the class form only when the pattern needs state or
several related methods.** A Strategy with one method is a function; a Strategy that also
needs `name`, `validate()`, and configuration is legitimately an object.

## The family's characteristic failure

**Applying the pattern before the force exists.** Two entries in `dev:code-roast`'s
`sin-registry.md` bracket the judgement, and they appear to contradict each other:

- **`UNI-02` Type Switch Sprawl** — a switch with 5+ type checks. Fix hint: use polymorphism
  or Strategy.
- **`UNI-09` Strategy Overkill** — Strategy with 1-2 implementations and no polymorphism
  benefit. *"You brought the entire GoF book to a fork() call."*

**The resolution is the count, and it is not written down in either entry.** One or two
stable branches: use `if`/`switch`. Three or more, *or* a set that outsiders extend, or
branches that keep being added: extract the Strategy. `selection.md` covers this
threshold and the general form of the judgement.

Also here: **`UNI-07` Observer Memory Leaks** — subscribe without unsubscribe. The single
most common real bug produced by this family.

## Relations to the other families

- Command objects are frequently created by a factory (`creational.md`) and stored in a
  Composite (`structural.md`) to make macro commands.
- Visitor and Iterator are how you operate on the Composite trees from `structural.md`.
- Memento is almost always used with Command, to make undo possible.
- Observer scales up into `styles/event-driven.md`; Mediator scales up into a message
  broker. Both are the same idea one altitude higher, with the delivery guarantees that
  crossing a process boundary forces on you.
