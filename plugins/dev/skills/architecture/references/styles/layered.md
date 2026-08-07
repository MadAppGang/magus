# Layered architecture

The default. If nobody has argued for something else, this is what you should build, and
the burden of proof is on the alternative.

## The force

Code that mixes HTTP parsing, business rules, and SQL in one function cannot be tested,
reused, or changed safely, because every change touches every concern. Layering answers
one question: **what is allowed to call what.**

## Structure

```
┌─────────────────────────────┐
│  Presentation               │  HTTP handlers, CLI, jobs
├─────────────────────────────┤
│  Application / services     │  use cases, orchestration, transactions
├─────────────────────────────┤
│  Domain                     │  entities, business rules, invariants
├─────────────────────────────┤
│  Infrastructure             │  DB, cache, queues, third-party APIs
└─────────────────────────────┘
```

**The one rule: calls go downward only.** A repository never imports a handler. A domain
entity never imports the ORM. If you need an upward call, you need an event or a callback,
not an import.

```
src/
├── routes/          # presentation: parse, authorize, delegate, serialize
├── services/        # application: one file per use case
├── domain/          # entities + rules; zero imports from anywhere below
└── repositories/    # infrastructure: the only place SQL exists
```

## What each layer may not do

| Layer | Forbidden |
|---|---|
| Presentation | business decisions, SQL, direct repository calls |
| Application | knowing it was called over HTTP, building HTTP responses |
| Domain | importing anything from the other three layers |
| Infrastructure | business rules, deciding what an error means to a user |

The most-violated row is the last one. A repository that returns `null` for "not found" is
fine; a repository that decides that means HTTP 404 has taken a business decision.

## Worked shape

```ts
// routes/users.ts — presentation. Parses, delegates, serializes. No decisions.
export async function createUser(req: Request): Promise<Response> {
  const input = parseCreateUser(await req.json());   // validation at the boundary
  const user = await userService.create(input);      // delegate
  return Response.json(toUserDto(user), { status: 201 });
}

// services/user-service.ts — application. Orchestrates, owns the transaction.
export async function create(input: CreateUserInput): Promise<User> {
  if (await users.findByEmail(input.email)) throw new Conflict("email already registered");
  const user = User.create(input);                   // domain decides validity
  await users.insert(user);
  await events.publish("user.created", { id: user.id });
  return user;
}

// domain/user.ts — pure. No DB, no HTTP, no framework. Testable with zero setup.
export class User {
  static create(input: CreateUserInput): User {
    if (!input.email.includes("@")) throw new ValidationFailed(["email is malformed"]);
    return new User(crypto.randomUUID(), input.email, Date.now());
  }
}
```

## Trade-offs

| Gain | Cost |
|---|---|
| Every developer knows where a given kind of code goes | Simple changes touch 3-4 files |
| Domain logic is testable with no infrastructure | Layers can become anaemic pass-through boilerplate |
| Infrastructure is swappable in principle | Only in principle, unless you also invert the dependency (see `hexagonal.md`) |

## The failure mode to watch for

**The anaemic layer.** A service method that only calls the repository method of the same
name is not a layer, it is a tax:

```ts
// This service earns nothing. Delete it or give it a real job.
async function getUser(id: string) { return users.findById(id); }
```

Layers justify themselves when they hold a decision. If a layer holds none for a given
operation, let the caller skip it for that operation rather than adding a file per verb.

**Leakage upward through types.** If `routes/` imports an ORM row type, the layering is
decorative. The compiler is the enforcement mechanism: domain types in, DTOs out.

## When NOT to use this

- **A script, a lambda, a one-file tool.** Four directories for 200 lines is cosplay.
- **When the real requirement is swappable infrastructure.** Layering points the domain
  *down* at infrastructure. That is an import from domain to infrastructure, and it is why
  "we are layered so we can swap the database" is usually false. Read `hexagonal.md`, which
  inverts that arrow, which is the whole difference.
- **When reads and writes have diverged badly.** Read `cqrs-event-sourcing.md`.

## Relation to other styles

Hexagonal and clean are both layered with the bottom arrow reversed. Modular monolith is
layering applied *inside* each module rather than across the whole app, which is usually
the better move once the app has more than a handful of features.
