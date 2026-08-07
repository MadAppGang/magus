# Visitor

**Intent:** separate an algorithm from the object structure it operates on, so new
operations can be added without modifying the element classes.

The hardest pattern in the catalog to justify, and the one with the cleanest TypeScript
alternative.

## The force

A stable set of node types, and a growing set of operations over them. Adding each operation
edits every class:

```ts
// Adding export-to-XML means touching all nine node classes. Again.
class Circle { area() {} render() {} toJson() {} toXml() {} validate() {} /* … */ }
class Square { area() {} render() {} toJson() {} toXml() {} validate() {} /* … */ }
```

## The expression problem

This is the concept worth taking away, because it tells you when Visitor is right:

| | Add a new **type** | Add a new **operation** |
|---|---|---|
| **Methods on classes** | easy: one new class | hard: edit every class |
| **Visitor** | **hard: edit every visitor** | easy: one new visitor |

**Visitor trades one for the other.** It is correct only when node types are stable and
operations churn. Applied to a hierarchy that grows new node types, it is strictly worse
than methods. Compilers and AST tooling are the canonical fit: the language grammar is
fixed, and the passes over it are many.

## Structure

```ts
interface Visitor<R> {
  visitCircle(c: Circle): R;
  visitSquare(s: Square): R;
}

interface Shape { accept<R>(v: Visitor<R>): R }

class Circle implements Shape {
  constructor(public radius: number) {}
  accept<R>(v: Visitor<R>): R { return v.visitCircle(this) }   // double dispatch
}

class AreaVisitor implements Visitor<number> {
  visitCircle(c: Circle) { return Math.PI * c.radius ** 2 }
  visitSquare(s: Square) { return s.side ** 2 }
}

shapes.map(s => s.accept(new AreaVisitor()));   // new operation = new visitor, no class edits
```

**`accept` exists for double dispatch:** the correct `visitX` is selected by the runtime type
of the node *and* the visitor. Languages without multiple dispatch need this dance.

## Does TypeScript already do this

**Yes, and better: a discriminated union plus `switch`.** No `accept`, no visitor interface,
and the compiler enforces exhaustiveness:

```ts
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return Math.PI * s.radius ** 2;
    case "square": return s.side ** 2;
    default: return assertNever(s);   // adding a shape = COMPILE ERROR in every function
  }
}
```

This keeps Visitor's benefit (a new operation is a new function, touching no node types) and
removes its main cost: `assertNever` makes adding a node type a compile error at every site
that must handle it, rather than a runtime surprise. The classic Visitor gives you no such
guarantee unless every visitor is also updated.

**Use the class form only when** nodes come from a library you cannot change into a union, or
when visitors need substantial state carried across the traversal.

## Trade-offs

| Gain | Cost |
|---|---|
| New operations without touching node classes | New node types require editing every visitor |
| Related behaviour lives together in one visitor | `accept` boilerplate in every node |
| Visitors accumulate state across a traversal | Visitors need access to node internals, which weakens encapsulation |

## When NOT to use this

- **Node types change more often than operations.** You have the expression problem backwards
  and are paying the cost for none of the benefit.
- **You are writing TypeScript and control the types.** Use a discriminated union.
- **There are two operations and they are stable.** Methods on the classes are simpler.
- **Nodes would need public accessors purely to serve visitors.** That trades encapsulation
  for extensibility you may not need.

## Relations

- **Composite** (`composite.md`) is what Visitor almost always operates on; a visitor
  traverses the tree and accumulates a result.
- **Iterator** (`iterator.md`) provides the traversal; Visitor provides the type-specific
  operation. They compose.
- **Strategy** (`strategy.md`) also encapsulates an algorithm, but for one type; Visitor
  dispatches across a whole hierarchy.
