# Structure and layering

## Dependency direction

Inside a component, dependencies point one way and never back:

```
routes.ts  →  service.ts  →  repository.ts
   HTTP        business        data
```

Each arrow is a narrowing of knowledge:

- **routes** knows HTTP. Parses input, checks authorisation, calls the service, formats the
  response. Contains no business rules — if a route has an `if` that encodes a policy, it is in
  the wrong file.
- **service** knows the domain. Takes and returns plain values. **Never sees a `Request`.** This is
  the constraint that pays: a service taking plain values is callable from a queue consumer, a CLI
  and a test without a fake HTTP layer.
- **repository** knows storage. SQL lives here and only here. Returns domain objects, not driver
  rows — so swapping SQLite for Postgres, or adding a cache, touches one file.

A backward call — a repository importing a service, a service importing routes — is the signal that
a responsibility landed in the wrong layer. It also creates import cycles, which Bun tolerates at
runtime in ways that produce confusing `undefined` exports.

## Component boundaries

```
src/orders/index.ts       ← the ONLY file other components may import from
```

Everything else in `src/orders/` is private by convention. A deep import
(`import { orderRepo } from "../orders/repository"`) couples billing to orders' *internals*, so
refactoring orders breaks billing — the exact coupling the layout was meant to prevent.

Enforce it with a grep in CI rather than a discussion in review:

```bash
grep -rnE "from ['\"]\.\./[a-z-]+/(service|repository|routes)" src/ && exit 1
```

### When components must talk

1. **Direct call through `index.ts`** — simplest. Fine when the dependency is acyclic and stable.
2. **Events** — when the caller should not care who listens. `orders` emits `order.placed`;
   `billing` and `notifications` subscribe. Decouples, but makes the flow harder to trace, so use
   it where fan-out is real, not everywhere.
3. **Shared kernel** — a `shared/` module both depend on. Keep it small and stable; a growing
   `shared/` is coupling with a friendlier name.

**Cycles between components are a design error, not a tooling problem.** If orders needs billing
and billing needs orders, either one concept belongs in the other, or a third concept is missing.

## Where "shared" belongs

`shared/` holds code with no domain meaning: the error classes, the logger, the HTTP helpers, the
config parser. The test is simple — **if it mentions a domain noun, it is not shared.**
`shared/invoice-formatting.ts` belongs in `billing/`.

When something in `shared/` is used by exactly one component, move it there. Utilities accumulate
by default; the only counter-pressure is a habit of pushing them back down.

## Naming

- **Directories: plural domain nouns** — `orders/`, `users/`. Not `order-management/`.
- **Files: what they are** — `service.ts`, `repository.ts`, `routes.ts`. Repeated across components
  by design: `orders/service.ts` and `billing/service.ts` read fine, and `orderService.ts` inside
  `orders/` stutters.
- **Tests beside the code** — `orders/orders.test.ts`. A parallel `test/` tree drifts, because
  moving code does not move its test.

## When to split into a package

Stay single-package until one of these is actually true:

- Two deployables need the same code (a service and a CLI).
- A genuinely independent release cycle.
- A build boundary that meaningfully speeds up CI.

"It feels cleaner" is not a reason. A monorepo adds real cost — version coordination, cross-package
type resolution, a slower cold install — and directories give you most of the modularity for free.
Bun's isolated install layout (MEASURED: no hoisting, symlinks per member) means that when you do
split, undeclared imports fail immediately rather than working by accident.

## Entrypoint

Keep `src/index.ts` thin and make the order explicit:

```ts
import { config } from "./config/env";          // 1. parse config — throws at boot if wrong
import { makeServerOptions } from "./server";   // 2. build the server config
import { installShutdown } from "./runtime/shutdown";

const server = Bun.serve(makeServerOptions(config));
installShutdown(server);
```

Exporting `makeServerOptions()` rather than calling `Bun.serve` inline is what lets a component
test start the **same** server config on an ephemeral port. If the test builds its own config, it
is testing a different server (see the `testing` skill).

## Migrating an existing layer-based tree

Do not big-bang it. Move one component at a time, most-cohesive first:

1. `mkdir src/orders`, move the order files in, fix imports.
2. Add `src/orders/index.ts` exporting only what others use.
3. Fix the deep imports that break — each one is a coupling you just discovered.
4. Repeat. `utils/` shrinks as things find their home; whatever remains is genuinely shared.

The first component is the slow one because it flushes out the hidden coupling. The rest go quickly.
