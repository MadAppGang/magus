# Modular monolith

One deploy unit, hard internal boundaries. **This is usually the correct answer when
someone proposes microservices**, and it is the least fashionable and most useful entry in
this directory.

## The force

Layering (`layered.md`) cuts the app horizontally: all routes together, all services
together, all repositories together. That answers "what may call what" but not "who owns
what". After a year, `services/` holds 60 files from nine unrelated features and every
change risks every feature.

Modular monolith cuts **vertically first, horizontally second**.

```
horizontal only (layered)          vertical first (modular monolith)
├── routes/     (60 files)         ├── modules/
├── services/   (60 files)         │   ├── billing/    routes services domain repo
└── repositories/ (60 files)       │   ├── catalog/    routes services domain repo
                                   │   └── identity/   routes services domain repo
                                   └── shared/         genuinely cross-cutting only
```

## The rules that make it a module and not a folder

A directory named `billing/` is not a boundary. These four things are:

1. **One public entry point per module.** `modules/billing/index.ts` exports the module's
   API. Nothing outside imports anything deeper.
   ```ts
   // modules/billing/index.ts — the ONLY legal import target for other modules
   export { chargeCustomer, refund } from "./use-cases";
   export type { Invoice } from "./domain/invoice";
   ```
2. **No cross-module table access.** `billing` may not `SELECT` from `identity`'s tables,
   even in the same database. It calls `identity`'s API or reads its events.
3. **Cross-module calls go through the entry point, or through events.** Synchronous for
   "I need an answer now", events for "this happened, react if you care".
4. **The rule is enforced by a tool, not by a wiki page.** Boundaries that are not checked
   are boundaries that are already broken.

```json
// Enforce rule 1 mechanically. Without this, the design decays in weeks.
// eslint: "no-restricted-imports"
{ "patterns": [{
    "group": ["**/modules/*/!(index)", "**/modules/*/!(index)/**"],
    "message": "Import a module only through its index.ts. Deep imports break the boundary."
}]}
```

## Why this before microservices

Microservices force correct boundaries by making violations impossible (you physically
cannot import another service's class). That is a real benefit bought at a very high price:
network calls, partial failure, distributed transactions, per-service deploy and observe.

The modular monolith buys **most of the boundary benefit for almost none of the operational
cost**, and it leaves the exit open: a module with a clean entry point and its own tables is
the unit you extract *later*, once you know which one actually needs independent scaling.

**Getting boundaries wrong is normal and cheap here, and expensive in microservices.**
Moving a class between modules is a refactor. Moving it between services is a migration.

| | Modular monolith | Microservices |
|---|---|---|
| Boundary violation | caught by lint, fixed in an hour | impossible |
| Cost of a wrong boundary | a refactor | a migration with downtime |
| Deploy | one unit | per service |
| Cross-module call | a function call | a network hop that can fail |
| Independent scaling | no | yes |
| Needs service discovery, tracing, per-service CI | no | yes |

## Trade-offs

| Gain | Cost |
|---|---|
| Feature work touches one directory | Requires real discipline plus tooling; without lint rules it degrades to folders |
| Refactoring boundaries stays cheap | One deploy: a bad release takes down every module |
| Clear extraction path to services later | Shared runtime means one module's memory leak or event-loop block hurts all |
| No distributed-systems tax | Scaling is all-or-nothing |

## The failure mode to watch for

**The `shared/` landfill.** Every module needs something from another, so it goes in
`shared/`, and within a year `shared/` is the biggest module and everything depends on it.
The boundary is gone and the lint rule still passes.

Keep `shared/` to things with no business meaning: `Result`, `Money`, logging, the clock.
**If it has a domain concept in it, it belongs to a module.** When two modules need the same
domain concept, one of them owns it and the other asks.

**Distributed monolith by anticipation.** Splitting into modules that all read each other's
tables is code-roast's UNI-13 in advance. If the tables are shared, the modules are not.

## When NOT to use this

- **Genuinely small apps.** Three features do not need module boundaries; you will spend
  more time on the lint config than the features.
- **When independent deploy or independent scaling is a hard requirement now**, not a
  someday. Then read `microservices.md` and pay knowingly.
- **When teams cannot merge into one repo or one release train** for organizational
  reasons. Conway's law wins these arguments.

## Relation to other styles

Inside each module, use `layered.md` or `hexagonal.md`. The two cuts compose: vertical for
ownership, horizontal for dependency direction. Cross-module communication is where
`event-driven.md` applies without any of the network cost, because the bus is in-process.

Related failure inventory: code-roast `UNI-11` (distributed monolith) and `UNI-13` (shared
database) describe what this style exists to prevent.
