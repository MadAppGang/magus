# Database schema conventions

The schema outlives every other decision in the project, so these are the choices worth making
once, on purpose. They apply whatever the client is — `bun:sqlite`, `Bun.sql` for Postgres, or an
ORM. The repository is the only layer that sees any of it (`structure-and-layering.md`).

## Primary keys

- **Use a UUID for any id that leaves the service.** A sequential integer in a URL tells a caller
  how many rows exist and invites walking them (`/orders/1041`, `/orders/1042`). Authorisation must
  still stop that walk; an opaque id just stops it from being free.
- **Prefer UUIDv7 over v4.** v7 is time-ordered, so new rows land at the end of the index instead
  of at random pages, which keeps inserts fast as the table grows. Bun generates it natively:
  `Bun.randomUUIDv7()`.
- An internal join table that is never addressed from outside can use a composite key of its two
  foreign keys instead of an id of its own.

## Timestamps

Every table that holds business rows gets `createdAt` and `updatedAt`, stored in UTC. Add event
timestamps (`verifiedAt`, `lastLoginAt`) only when something reads them — each one is a column
that must be kept correct on every write path.

**Soft delete (`deletedAt`) is a cost, not a default.** Every query must then filter it, every
unique index must account for it, and "deleted" data stays subject to retention and privacy rules.
Use it when restore or audit is a real requirement; otherwise delete, and keep history in an audit
table if you need one.

## Relations and constraints

Declare foreign keys in the schema. Code that "always checks" drifts; a constraint does not.

**`bun:sqlite` ignores foreign keys unless you turn them on, per connection:**

```ts
import { Database } from "bun:sqlite";

const db = new Database("app.db");
db.run("PRAGMA foreign_keys = ON"); // without this, REFERENCES is decoration
```

Verified: without the pragma, inserting a child row that references a missing parent succeeds.
`testing/references/database-testing.md` covers asserting that a constraint actually fires.

Many-to-many relations get an explicit join table, so the relationship can later carry its own
columns (`addedAt`, `role`) without a migration of both sides.

## Indexes

- Index what a query **filters, joins or sorts on**, starting with every foreign key column. A
  unique constraint already creates an index; do not add a second one on the same column.
- A compound index serves queries that use its **leading** columns. `(tenantId, createdAt)` serves
  "this tenant's rows, newest first" and "this tenant's rows"; it does not serve "all rows by
  `createdAt`".
- Each index slows every write. Add one for a measured slow query (`performance`), not for a query
  that might exist.

## Constrained values

A column with a fixed set of values gets a constraint the database enforces: a Postgres enum or a
`CHECK (status IN ('pending','paid','refunded'))`. Validating in TypeScript alone lets any other
writer — a script, a migration, a second service — store a value the code cannot handle.

## Naming

Pick one convention and keep it. The trade-off is real:

- **snake_case columns** are the SQL default. Postgres folds unquoted identifiers to lower case, so
  a camelCase column must be double-quoted in every raw query (`"createdAt"`), and a missed quote
  fails at runtime as "column does not exist".
- **camelCase columns** match the TypeScript types one to one, which removes a mapping step.

Either is fine. Mixing them is not. Whichever you choose, the repository converts between storage
names and domain objects, so no other layer depends on the choice.

## Migrations

Schema changes ship as versioned migration files, applied by a step that runs **once per deploy**,
never at every replica's startup (`production/references/deployment.md`). Write each migration so
the old and the new code can both run against it, because during a rolling deploy they do.
