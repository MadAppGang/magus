# Composite

**Intent:** compose objects into tree structures, and let clients treat individual objects
and compositions of objects uniformly.

## The force

Client code that must ask "is this one thing or a group?" before every operation:

```ts
// This branching spreads to every operation and every call site.
function totalPrice(item: Product | Box): number {
  if (item instanceof Box) return item.contents.reduce((s, c) => s + totalPrice(c), 0);
  return item.price;
}
```

Composite removes the question by giving leaves and containers the **same interface**.

## Structure

```ts
interface Component { price(): number; name(): string }

class Product implements Component {                    // leaf
  constructor(private label: string, private cost: number) {}
  price() { return this.cost }
  name()  { return this.label }
}

class Box implements Component {                        // composite
  private children: Component[] = [];
  constructor(private label: string, private packaging = 200) {}

  add(c: Component): this { this.children.push(c); return this }

  price() {                                             // recurses without knowing types
    return this.packaging + this.children.reduce((sum, c) => sum + c.price(), 0);
  }
  name() { return this.label }
}

const order: Component = new Box("order")
  .add(new Product("phone", 79900))
  .add(new Box("accessories").add(new Product("case", 2900)));

order.price();   // the client calls one method. No instanceof anywhere.
```

**The recursion lives in the composite, once.** That is the payoff: every new operation is
written once per class instead of once per call site with a type check.

## The design tension: where do `add` and `remove` go?

| Placement | Effect |
|---|---|
| On `Component` (GoF's preference) | Maximum uniformity; leaves must implement child operations that make no sense and fail at runtime |
| On `Composite` only (shown above) | Type-safe; the client must sometimes know it holds a composite to build the tree |

**In TypeScript, put them on the composite.** The compiler is a better guard than a runtime
throw, and building a tree is usually separate from operating on it. Use a discriminated
union when clients genuinely need to tell them apart:

```ts
type Node = { kind: "leaf"; price: number } | { kind: "box"; children: Node[] };
```

## Does TypeScript already do this

A discriminated union plus a recursive function is the idiomatic functional form, and it is
often better: exhaustiveness is compiler-checked, and adding an operation does not touch the
node types at all (which is the problem `visitor.md` exists to solve for the class form).

Prefer classes when nodes carry behaviour and identity; prefer the union when nodes are data.

## Trade-offs

| Gain | Cost |
|---|---|
| Clients treat one and many identically; no `instanceof` | The common interface drifts toward the lowest common denominator |
| New node types need no client changes | Over-general interfaces let you compile nonsense trees |
| Recursion written once | Deep trees can blow the stack; large trees need care |

## When NOT to use this

- **The structure is not a tree.** Composite is for part/whole hierarchies, not any collection.
- **Leaves and containers have genuinely different APIs.** Forcing one interface produces
  methods that throw, which is worse than an honest type check.
- **The tree is one level deep.** An array is enough.

## Relations

- **Iterator** (`iterator.md`) traverses the tree; **Visitor** (`visitor.md`) adds operations
  to it without editing node classes. This trio is the standard combination.
- **Decorator** (`decorator.md`) has the same recursive shape but one child instead of many,
  and its purpose is adding behaviour rather than modelling structure.
- **Builder** (`builder.md`) is the usual way to construct a composite tree stepwise.
