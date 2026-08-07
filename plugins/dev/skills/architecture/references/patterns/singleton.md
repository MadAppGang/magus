# Singleton

**Intent:** ensure a class has exactly one instance, and provide a global point of access
to it.

**Read the objection section before implementing this.** It is the most-used and
most-regretted pattern in the catalog, and in TypeScript the classic form is almost never
the right answer.

## The force

Some resources should genuinely exist once per process: a connection pool, a metrics
registry, an application config. Creating a second one is either wasteful or incorrect.

## The classic structure

```ts
class Config {
  static #instance: Config | null = null;
  private constructor(public readonly values: Record<string, string>) {}

  static getInstance(): Config {
    Config.#instance ??= new Config(loadFromEnv());
    return Config.#instance;
  }
}
```

Note what this does beyond "one instance": it also makes the instance **globally reachable
from anywhere**, without being declared as a dependency. That second property is the one
that causes the damage, and it is not the property anyone actually wants.

## Does TypeScript already do this

**Yes, and this is the important entry in this file.** ES modules are evaluated once and
cached, so a module-level binding *is* a singleton, with no class and no `getInstance`:

```ts
// config.ts — evaluated once, no matter how many modules import it.
export const config = Object.freeze(loadFromEnv());
```

If laziness is needed, keep it lazy without the ceremony:

```ts
let pool: Pool | undefined;
export function getPool(): Pool {
  return (pool ??= createPool(config.databaseUrl));
}
```

**A caveat that bites in tests and monorepos:** "once" means once *per module registry*.
Two copies of a package in `node_modules`, or a bundler that duplicates a module, gives you
two instances. If uniqueness must hold absolutely, key it on `globalThis` explicitly rather
than assuming module caching.

## The real objection

Singleton is `UNI-06` in `dev:code-roast`'s `sin-registry.md`, severity FELONY:
*"You've reinvented global variables but made them harder to grep for."*

The concrete costs:

| Problem | Why it hurts |
|---|---|
| **Hidden dependency** | `Config.getInstance()` inside a function means the signature lies about what it needs |
| **Untestable** | No seam to substitute a fake; tests mutate global state and leak into each other |
| **Test order dependence** | Shared mutable state makes tests pass alone and fail in suite |
| **Concurrency** | Mutable global state in a shared runtime is a data race waiting for load |
| **Violates SRP** | The class manages both its job and its own lifecycle |

**The fix in almost every case is dependency injection.** Create one instance at the
composition root and pass it in:

```ts
// Instead of reaching for a global inside, declare the need in the signature.
export function makeUserService(db: Database, config: Config) {
  return { /* … */ };   // tests pass fakes; nothing is hidden
}
```

You still have exactly one instance. You have simply stopped making it globally reachable,
which keeps the useful half of Singleton and drops the harmful half.

## Trade-offs

| Gain | Cost |
|---|---|
| Guaranteed single instance; lazy initialization | Global access hides dependencies from every signature |
| Convenient: no wiring, reachable anywhere | That convenience is exactly what makes it untestable |

## When NOT to use this

- **Whenever dependency injection is available**, which in application code is always.
- **When the object holds mutable business state.** That is a global variable with an
  access method.
- **When tests need to substitute it.** They will, sooner than you expect.

Legitimate remaining uses are narrow: stateless utilities, immutable frozen config, and
process-wide infrastructure registries where a second instance is genuinely a bug. Even
then, prefer `export const` over a class with `getInstance()`.

## Relations

- **Abstract Factory** (`abstract-factory.md`) concrete factories are often singletons;
  a module `const` serves the same purpose without the drawbacks.
- **Facade** (`facade.md`) objects are frequently made singletons, and usually should not
  be, for the reasons above.
- **Monostate** is the variant where all instances share state; it has the same testing
  problems with less visibility, so it is not an improvement.
