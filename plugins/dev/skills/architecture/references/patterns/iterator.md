# Iterator

**Intent:** traverse the elements of a collection without exposing its underlying
representation.

**In TypeScript this pattern is a language feature.** Read the native section and stop
there unless you are writing a custom collection.

## The force

Client code that loops must know how the collection is stored. Change from array to tree and
every loop breaks. The GoF form hides that behind `hasNext()` / `next()`.

## Does TypeScript already do this

Yes, completely. **Implement `Symbol.iterator` and you get `for...of`, spread,
destructuring, `Array.from`, and every other consumer of the iteration protocol for free.**

```ts
class BinaryTree<T> {
  constructor(public value: T, public left?: BinaryTree<T>, public right?: BinaryTree<T>) {}

  // A generator is the whole pattern. In-order traversal, lazy, no state machine by hand.
  *[Symbol.iterator](): Iterator<T> {
    if (this.left)  yield* this.left;
    yield this.value;
    if (this.right) yield* this.right;
  }
}

const tree = new BinaryTree(2, new BinaryTree(1), new BinaryTree(3));
[...tree];                       // [1, 2, 3]
for (const v of tree) { /* … */ }
```

**Multiple traversals** are separate generator methods, which is cleaner than the GoF
"separate iterator class per order":

```ts
class Tree<T> {
  *inOrder(): Generator<T>   { /* … */ }
  *preOrder(): Generator<T>  { /* … */ }
  [Symbol.iterator]() { return this.inOrder() }    // the default
}

for (const v of tree.preOrder()) { /* … */ }
```

**Async iteration** for streams and paginated APIs:

```ts
async function* pages(url: string): AsyncGenerator<Item> {
  let next: string | null = url;
  while (next) {
    const res = await fetch(next).then(r => r.json());
    yield* res.items;                                  // consumer sees a flat stream
    next = res.nextUrl;
  }
}

for await (const item of pages("/api/items")) { /* pagination is invisible here */ }
```

That last example is the strongest everyday case: **laziness**. Generators produce values on
demand, so an infinite or expensive sequence costs only what is consumed.

## Trade-offs

| Gain | Cost |
|---|---|
| Traversal is decoupled from storage | Hand-written iterator classes are pure boilerplate in TS |
| Several traversal orders coexist | Generators are slower than a plain `for` loop over an array |
| Lazy evaluation; infinite sequences are expressible | Iterators are single-use: consuming one exhausts it |

**The single-use property surprises people.** A generator's result cannot be iterated twice.
If callers need to re-traverse, return a fresh iterable each time, which is why
`Symbol.iterator` is a *method*.

## When NOT to use this

- **You have an array.** Use array methods. Wrapping it adds nothing.
- **Callers need random access, length, or slicing.** Iteration is sequential and one-shot.
- **The hot path is performance-critical.** A `for (let i = 0; …)` loop over an array beats
  generator overhead when it matters, and only when it measurably matters.
- **Writing a hand-rolled `hasNext`/`next` class.** In TypeScript that is the pattern
  reimplemented against the language.

## Relations

- **Composite** (`composite.md`) trees are the classic thing to iterate; the generator's
  `yield*` recursion handles them naturally.
- **Visitor** (`visitor.md`) also traverses a structure, but to run type-specific operations;
  Iterator just yields elements.
- **Factory Method** (`factory-method.md`): `[Symbol.iterator]()` is one, returning the
  traversal strategy for the collection.
