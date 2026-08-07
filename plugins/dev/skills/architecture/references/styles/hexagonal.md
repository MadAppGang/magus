# Hexagonal architecture (ports and adapters)

Alistair Cockburn's name for one idea: **the application defines the interfaces; the
outside world implements them.** Everything else follows.

## The force

In plain layered code the domain imports the repository, so the domain depends on the
database. That makes "swap Postgres for an in-memory fake in tests" a lie, and it makes the
domain untestable without infrastructure running.

Hexagonal fixes it by **inverting that one arrow**.

```
   layered:     domain  ──imports──▶  repository (Postgres)
   hexagonal:   domain  ──defines──▶  UserRepository (interface)
                                              ▲
                                              │ implements
                                    PostgresUserRepository
```

The domain now depends on nothing. The database depends on the domain.

## Ports and adapters

A **port** is an interface owned by the application. An **adapter** is an implementation
owned by the outside.

| Kind | Who calls whom | Examples |
|---|---|---|
| **Driving** (primary, left side) | outside calls in | HTTP handler, CLI, cron job, test harness |
| **Driven** (secondary, right side) | app calls out | database, email sender, payment gateway, clock |

The hexagon shape in the diagrams means nothing structural. It is drawn with six sides only
to suggest "many ports on many edges", not two layers.

```
src/
├── domain/              # entities, rules. Zero imports outward.
├── application/
│   ├── ports/           # interfaces the app OWNS
│   │   ├── user-repository.ts
│   │   └── email-sender.ts
│   └── use-cases/       # the app's actual behaviour, depends only on ports
└── adapters/
    ├── driving/http/    # calls into use-cases
    └── driven/
        ├── postgres/    # implements user-repository
        └── smtp/        # implements email-sender
```

## Worked shape

```ts
// application/ports/user-repository.ts — the APP owns this interface.
// Note it speaks in domain terms (User), never in SQL or driver terms.
export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  insert(user: User): Promise<void>;
}

// application/use-cases/register-user.ts — depends on the port, never on Postgres.
export function makeRegisterUser(users: UserRepository, email: EmailSender) {
  return async function registerUser(input: RegisterInput): Promise<User> {
    if (await users.findByEmail(input.email)) throw new Conflict("email already registered");
    const user = User.create(input);
    await users.insert(user);
    await email.send(user.email, "welcome");
    return user;
  };
}

// adapters/driven/postgres/user-repository.ts — the OUTSIDE implements it.
export class PostgresUserRepository implements UserRepository { /* SQL lives only here */ }

// The test needs no database and no SMTP server.
const users = new InMemoryUserRepository();
const registerUser = makeRegisterUser(users, new FakeEmailSender());
```

**The port is defined next to the use case, not next to Postgres.** That placement *is* the
dependency inversion. Putting the interface in `adapters/postgres/` and importing it from
the use case looks similar and inverts nothing.

## Trade-offs

| Gain | Cost |
|---|---|
| Business logic testable with zero infrastructure, in milliseconds | One interface + one wiring site per external dependency |
| Infrastructure genuinely swappable, not just nominally | Indirection: "go to definition" lands on an interface |
| Delivery mechanism is a detail; HTTP and CLI reuse one use case | Over-applied, you get an interface with exactly one implementation forever |

## The failure mode to watch for

**Ports that leak the adapter.** The moment a port method returns `QueryResult`, takes a
`WHERE` clause, or exposes `limit`/`offset` verbatim, the domain knows about SQL again and
the inversion is undone. A port speaks the application's language:

```ts
// LEAKY: this is the database's vocabulary wearing an interface.
interface UserRepository { query(sql: string, params: unknown[]): Promise<Row[]>; }

// CLEAN: the application's vocabulary. Postgres is one way to satisfy it.
interface UserRepository { findActiveSince(date: Date): Promise<User[]>; }
```

**Interface-per-class reflex.** Hexagonal asks for interfaces at the *boundary of the
application*, not between every pair of internal classes. An interface for an internal
helper with one implementation adds a hop and buys nothing.

## When NOT to use this

- **The infrastructure will never be swapped and the domain is thin.** A CRUD service whose
  business logic is "validate and save" gets the cost of ports with none of the benefit.
- **Prototypes and spikes.** You do not know the boundaries yet; ports harden boundaries.
- **When the real problem is module coupling, not infrastructure coupling.** Read
  `modular-monolith.md`.

## Relation to other styles

**Clean architecture** is hexagonal plus a prescribed inner structure (entities, then use
cases) and a named Dependency Rule. Onion architecture is the same idea again with
different diagrams. If you have read `hexagonal.md` you have the concept; `clean.md` adds
the layout opinion.

The pattern that makes this work at class level is **dependency injection**, and the port is
an application of the **Strategy** shape at architectural scale: one interface, swappable
implementations chosen at composition time.
