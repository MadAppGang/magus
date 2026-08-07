# Creational patterns

**The family's question: who decides what concrete thing gets made, and when?**

Every one of these exists because `new ConcreteThing()` hard-codes a decision at the place
that can least afford to make it. They differ in *what* they let you defer.

| Pattern | Defers | Read |
|---|---|---|
| **Factory Method** | *which subclass* to instantiate, to a subclass | `patterns/factory-method.md` |
| **Abstract Factory** | *which whole family* of related objects, to one chosen factory | `patterns/abstract-factory.md` |
| **Builder** | *how much* of a complex object to configure, step by step | `patterns/builder.md` |
| **Prototype** | construction entirely: copy an existing configured instance | `patterns/prototype.md` |
| **Singleton** | *how many* exist: exactly one, globally reachable | `patterns/singleton.md` |

## Choosing inside the family

```
Is the problem "too many constructor arguments / optional config"?
    └─ yes → Builder
Is the problem "I don't know the concrete type until runtime"?
    ├─ one product          → Factory Method
    └─ several that must match (all-Postgres or all-SQLite, never mixed) → Abstract Factory
Is the problem "constructing this is expensive but I have a good instance already"?
    └─ yes → Prototype
Is the problem "there must be exactly one"?
    └─ probably not a pattern problem. Read patterns/singleton.md before agreeing.
```

## Does TypeScript already do this

This family is where the language most often has the answer, because JavaScript has
first-class functions and object literals and 1994 C++ did not.

| Instead of | TypeScript often gives you |
|---|---|
| Factory Method subclass hierarchy | a function returning the interface, or a `Record<Kind, () => Product>` lookup |
| Builder with 8 `withX()` methods | a single options object with optional fields and defaults |
| Prototype `clone()` | `structuredClone(obj)`, or a spread for shallow copies |
| Singleton class with `getInstance()` | a module-level `const` — ES modules are cached, so it is already one instance |

**The options object is the highest-value substitution here.** Most "we need a Builder"
situations in TypeScript are solved by:

```ts
type ServerOptions = { port?: number; host?: string; tls?: TlsConfig };
function createServer(opts: ServerOptions = {}) {
  const { port = 3000, host = "0.0.0.0", tls } = opts;   // defaults, named args, done
}
```

Reach for a real Builder when construction is **stepwise and validated between steps**, or
when the same steps must produce different representations. Not merely because there are
several parameters.

## The family's characteristic failure

Creational patterns are the easiest to add prophylactically and the hardest to justify
later. Two are tracked in `dev:code-roast`'s `sin-registry.md`:

- **`UNI-10` Factory Overkill** — a factory that always returns the same class, wrapping
  `new` in a function that adds a name and no decision. If there is no polymorphism, there
  is no factory; there is a rename.
- **`UNI-06` Singleton Abuse** — `getInstance()` plus mutable static state. Global variables
  with extra steps, and the reason the whole family has a reputation problem.

The rule that prevents both: **a creational pattern must be absorbing a decision that
genuinely varies.** If you can name only one concrete product and no plausible second, you
are adding indirection, not flexibility.

## Relations to the other families

Creational patterns often supply the objects that structural and behavioral patterns then
compose:

- Abstract Factory is frequently implemented **as** a set of Factory Methods, and its
  concrete factories are often Singletons (see `patterns/singleton.md` for why that is
  usually a module constant instead).
- Builder and Prototype are alternatives: build it up, or copy one already built.
- A `Record<Kind, () => Product>` registry is the flat TypeScript form of Factory Method and
  composes directly with **Strategy** (`patterns/strategy.md`), which is the same lookup
  applied to behaviour rather than construction.
