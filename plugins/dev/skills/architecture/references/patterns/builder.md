# Builder

**Intent:** construct a complex object step by step, so the same construction process can
produce different representations.

## The force

Two related pains. The first is the telescoping constructor:

```ts
new Pizza("large", true, false, true, false, true, "thin", 2);  // what is argument 5?
```

The second, and the one that actually justifies the pattern, is **construction that has
steps with rules between them**: validation partway, order that matters, or a build that
produces different outputs from the same sequence.

## Structure

```ts
class QueryBuilder {
  #table?: string;
  #wheres: string[] = [];
  #limit?: number;

  from(table: string): this { this.#table = table; return this }
  where(clause: string): this { this.#wheres.push(clause); return this }
  limit(n: number): this {
    if (n <= 0) throw new RangeError("limit must be positive");   // validate at the step
    this.#limit = n; return this;
  }

  build(): string {
    if (!this.#table) throw new Error("from() is required");      // validate completeness
    const where = this.#wheres.length ? ` WHERE ${this.#wheres.join(" AND ")}` : "";
    return `SELECT * FROM ${this.#table}${where}${this.#limit ? ` LIMIT ${this.#limit}` : ""}`;
  }
}

new QueryBuilder().from("users").where("active = true").limit(10).build();
```

`return this` is what gives the fluent chain. `build()` is where the object becomes valid,
which is why a half-built builder is never mistakable for a finished product.

## Does TypeScript already do this

**For plain configuration, an options object is better.** It gives named arguments,
defaults, and compiler-checked required fields with no class at all:

```ts
type PizzaOptions = { size: "small" | "large"; cheese?: boolean; crust?: "thin" | "thick" };

function makePizza({ size, cheese = true, crust = "thin" }: PizzaOptions) { /* … */ }
makePizza({ size: "large", crust: "thick" });   // readable, no builder needed
```

**Reach for a real Builder only when one of these is true:**

1. Steps must be validated or ordered between calls, not just at the end.
2. The same sequence must produce **different representations** (the same steps building
   either SQL or a query plan). This is the original GoF motivation and the strongest case.
3. Construction is genuinely incremental across code that does not share a call site.

A builder that is only a fluent setter for an options object is ceremony. Prefer the object.

## Trade-offs

| Gain | Cost |
|---|---|
| Call sites are self-documenting; no positional-argument guessing | A whole class per constructed type |
| Invalid intermediate states are unrepresentable outside `build()` | Nothing forces `build()` to be called; a forgotten call is silent |
| Same process, different representations | Overkill for anything an options object handles |

**A typed refinement worth knowing:** a plain builder cannot make "required step omitted" a
compile error. If that matters, encode progress in the type by returning a different type
per step, so `build()` only exists once the requirements are met.

## When NOT to use this

- **Optional parameters are the only problem.** Use an options object.
- **Fewer than about four fields, all required.** A constructor is clearer.
- **The object is immutable and simple.** A factory function returning a literal wins.

## Relations

- **Prototype** (`prototype.md`) is the alternative: copy a configured instance instead of
  rebuilding it stepwise.
- **Abstract Factory** (`abstract-factory.md`) returns products immediately; Builder returns
  one after a sequence. Use Abstract Factory for families, Builder for complexity.
- **Composite** (`composite.md`) trees are a classic Builder output, since building a tree
  is inherently stepwise and recursive.
