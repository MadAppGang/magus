# Prototype

**Intent:** create new objects by copying an existing instance, rather than constructing
from scratch.

## The force

Two situations where `new` is the wrong tool:

1. **Construction is expensive** and you already have a correctly built instance: a parsed
   config, a compiled template, a warmed object graph.
2. **You do not know the concrete class.** You hold an object through an interface and need
   another like it. `new` requires a class name; `clone()` does not.

```ts
function duplicate(shape: Shape): Shape {
  // We only have the interface. There is no class name to write here.
  return shape.clone();
}
```

## Structure

```ts
interface Prototype<T> { clone(): T }

class Document implements Prototype<Document> {
  constructor(
    public title: string,
    public tags: string[],
    public meta: Record<string, unknown>,
  ) {}

  clone(): Document {
    // Deep-copy the parts that are references, or the copy shares them with the original.
    return new Document(this.title, [...this.tags], structuredClone(this.meta));
  }
}
```

**The whole difficulty of this pattern is one question: how deep is the copy?** A shallow
copy shares nested objects, so mutating the clone mutates the original. That bug is quiet,
appears far from the `clone()` call, and is the reason most Prototype implementations are
wrong.

## Does TypeScript already do this

Mostly, yes. Prefer the built-ins and reserve a hand-written `clone()` for objects that need
identity-aware copying (new IDs, reset timestamps, dropped subscriptions).

```ts
const shallow = { ...original };            // one level; nested objects still shared
const deep    = structuredClone(original);  // structured clone, no class identity
```

**`structuredClone` caveats that matter:** it handles cycles, `Map`, `Set`, `Date`,
`TypedArray`, and `ArrayBuffer`, but it **throws on functions and `Symbol`**, and it returns
a plain object, **losing the prototype chain**. A class instance cloned this way is no
longer an instance of its class.

```ts
class User { constructor(public name: string) {} greet() { return `hi ${this.name}` } }
const clone = structuredClone(new User("ada"));
clone instanceof User;   // false
clone.greet();           // TypeError: clone.greet is not a function
```

So: `structuredClone` for plain data, a real `clone()` method for class instances.

## Trade-offs

| Gain | Cost |
|---|---|
| Copy without knowing the concrete class | Every clonable type must implement copying correctly |
| Skips expensive construction | Deep-vs-shallow bugs are silent and hard to trace |
| Configured instances become templates, replacing a subclass hierarchy | Circular references need care unless you use `structuredClone` |

## When NOT to use this

- **Objects are cheap to construct.** `new` is clearer than a registry of prototypes.
- **Objects are immutable.** Sharing is safe, so copying buys nothing.
- **The object owns non-copyable resources** — open sockets, file handles, timers. Copying
  the reference gives two owners of one resource, which is worse than the construction cost.

## Relations

- **Builder** (`builder.md`) is the alternative: assemble stepwise instead of copying.
- Replaces **Factory Method** (`factory-method.md`) when the variation is *configuration*
  rather than *class*: keep configured prototypes in a registry and clone on demand.
- **Memento** (`memento.md`) also captures state, but to restore the same object later,
  not to produce an independent new one.
