# Strategy

**Intent:** define a family of interchangeable algorithms, encapsulate each one, and make
them swappable at runtime.

The most useful pattern in the catalog in TypeScript, and the one most often written as a
class when a function would do.

## The force

A conditional that selects behaviour, and keeps growing:

```ts
function route(order: Order, method: string) {
  if (method === "standard") { /* 20 lines */ }
  else if (method === "express") { /* 25 lines */ }
  else if (method === "freight") { /* 30 lines */ }
  // every new method edits this function and risks the others
}
```

Each branch is independent. They do not share state, do not call each other, and change for
different reasons. That independence is the signal for Strategy.

## Structure

```ts
type ShippingStrategy = (order: Order) => number;      // the "interface" is a function type

const standard: ShippingStrategy = (o) => o.weightKg * 1.5;
const express:  ShippingStrategy = (o) => o.weightKg * 4 + 10;
const freight:  ShippingStrategy = (o) => Math.max(80, o.weightKg * 0.8);

const strategies: Record<string, ShippingStrategy> = { standard, express, freight };

function quote(order: Order, method: string): number {
  const strategy = strategies[method];
  if (!strategy) throw new BadRequest(`unknown shipping method: ${method}`);
  return strategy(order);                              // no conditional, ever again
}
```

Adding a method is adding an entry. Nothing existing is edited, which is the Open/Closed
principle in its most concrete form.

## Does TypeScript already do this

**Yes. A one-method interface is a function type.** Prefer the function form:

```ts
// This is a Strategy. Array.prototype.sort has taken one since 1997.
[3, 1, 2].sort((a, b) => a - b);
```

Use the object or class form when a strategy needs **more than one method, its own state, or
metadata**:

```ts
interface HashStrategy {
  readonly name: string;                       // metadata: which one hashed this password
  hash(plain: string): Promise<string>;
  verify(plain: string, stored: string): Promise<boolean>;   // second method
}
```

That is a genuine object. A single `execute()` method is not.

## Trade-offs

| Gain | Cost |
|---|---|
| New algorithms need no edit to existing code | Callers must know which strategy to pick, or something must map input to strategy |
| Each algorithm is independently testable | Indirection: the behaviour is not at the call site |
| The conditional disappears | Overkill for one or two stable branches |

## When NOT to use this

**This is where the two sin-registry entries collide, so the threshold matters.**

- **`UNI-09` Strategy Overkill** (`dev:code-roast`): 1-2 implementations with no polymorphism
  benefit. *"You brought the entire GoF book to a fork() call."* Use an `if`.
- **`UNI-02` Type Switch Sprawl**: 5+ type checks in a switch. Extract the Strategy.

Between 3 and 4, judge by whether the set is still growing. And extract at **any** count if
the alternatives are supplied by other teams or plugins, because then the real cost is that
adding one edits your file. See `../selection.md` for the full rule.

Also skip it when:
- **The branches share state or fall through to each other.** They are not independent, so
  they are not strategies. If a branch decides which branch runs next, read `state.md`.
- **The set is genuinely closed** (the four suits). A `switch` with `assertNever` is safer,
  because adding a case becomes a compile error.

## Relations

- **State** (`state.md`) is structurally identical. Strategy is chosen from outside and the
  implementations are unaware of each other; State is chosen from inside and states know
  their successors.
- **Template Method** (`template-method.md`) solves the same problem with inheritance, fixed
  at compile time. Prefer Strategy: a class can hold many strategies but have one parent.
- **Bridge** (`bridge.md`) is the same composition scaled up, where *both* sides are
  hierarchies.
- **Command** (`command.md`) also wraps behaviour in an object, but to record a request for
  queueing or undo, not to vary a step.
