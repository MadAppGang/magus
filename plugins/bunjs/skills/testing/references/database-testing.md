# Testing against a real database

Mocking the database is the most expensive false economy in a test suite: the mock cannot reproduce
a unique constraint, a foreign key, a transaction rollback, a `NOT NULL`, or the exact shape a
driver returns for a `NULL` column — which are the things that actually break. Use a real database
and make it fast instead.

## `bun:sqlite` in-memory: free isolation

For anything whose SQL is portable, `:memory:` gives you a fresh, real database per test file at
essentially zero cost.

```ts
import { Database } from "bun:sqlite";

function freshDb() {
  const db = new Database(":memory:", { strict: true });
  db.run(await Bun.file("./migrations/001_init.sql").text());
  return db;
}
```

Each `:memory:` database is private to its connection, so parallel test files cannot collide.

**Always pass `{ strict: true }`.** MEASURED on Bun 1.3.10 — the default is a silent-failure trap:

| default `new Database(":memory:")` | result |
|---|---|
| `$n` + `{ $n: "alice" }` | row ✅ |
| `$n` + `{ n: "alice" }` (no sigil) | **`[]`, no throw** ❌ |
| `$n` + `{ $typo: "alice" }` | **`[]`, no throw** ❌ |
| `$n` + no arguments at all | **`[]`, no throw** ❌ |

A misspelled parameter binds nothing and returns an empty result set. In a test that asserts
"returns 404 for a missing user", that passes — for entirely the wrong reason.

`{ strict: true }` inverts the convention (bare `{ n: … }` is now correct) and **throws
`Missing parameter "n"`** on a typo. It is a one-time decision at `new Database`, not per query.

## Isolation strategies, cheapest first

| Strategy | Speed | Fidelity | Use when |
|---|---|---|---|
| Fresh `:memory:` per file | fastest | SQLite only | logic is portable SQL |
| Transaction per test, rolled back | fast | full | Postgres/MySQL, most cases |
| Truncate tables between tests | medium | full | code under test manages its own transactions |
| Fresh schema/database per file | slow | full | migration tests, heavy DDL |

### Transaction rollback

```ts
beforeEach(async () => { await db.query("BEGIN"); });
afterEach(async () => { await db.query("ROLLBACK"); });
```

Fast and perfectly isolated — but it breaks the moment the code under test issues its own
`BEGIN`/`COMMIT`, because the commit ends *your* wrapping transaction. If your service uses
transactions (it should), use truncation instead:

```ts
afterEach(async () => {
  await db.query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
});
```

`RESTART IDENTITY` matters — without it, sequence values leak across tests and any assertion on a
generated id becomes order-dependent.

## Never share a database between parallel files

Bun runs test files in parallel. Two files truncating the same tables will delete each other's
rows, producing failures that move around on every run. Give each file its own database name, or
its own schema:

```ts
const schema = `test_${process.env.BUN_WORKER_ID ?? crypto.randomUUID().slice(0, 8)}`;
```

## Clean-up: after-all is usually right, after-each is stricter

Two viable strategies, and the trade is real.

| Strategy | Speed | Isolation |
|---|---|---|
| **after-all** — truncate once per file | fast | relies on tests not colliding |
| **after-each** — truncate between tests | slower | a test cannot see another's rows |

**Prefer after-all**, and make it safe by ensuring **each test acts on its own records**.
Unique data per test — `builderFor`'s sequence counter, `seededRandom` for unique emails —
removes the collisions after-each exists to prevent, and does it without paying truncation
on every test.

Switch to after-each when tests genuinely share records (a "list all users" endpoint is the
classic), or when a failure leaves state that would confuse the next test. Diagnosing a
cross-test leak costs more than the truncation ever did, so if you are unsure, start with
after-each and relax it once the suite is stable.

**Pre-seed only metadata and context** — countries, plans, feature flags, the fixed
reference data every test assumes. Never pre-seed the records a test acts on: a shared
`user_1` couples every test to a row none of them own, and the first test to modify it
breaks the rest in a way that looks like flakiness.

## Assert against the database, not only the response

A `201` proves the handler answered, not that anything persisted. The valuable assertion reads
back through a different path than the one that wrote:

```ts
const res = await server.json("/users", { method: "POST", body: json({ email: "a@b.c" }) });
expect(res.status).toBe(201);

const row = db.query("SELECT email, created_at FROM users WHERE id = $id").get({ id: res.body.id });
expect(row?.email).toBe("a@b.c");
expect(row?.created_at).not.toBeNull();     // catches a missing DEFAULT
```

This is what catches the class of bug where the handler builds the response from its input instead
of from what was stored.

### Reading back: public API or direct query?

Two defensible positions, and it is worth choosing deliberately rather than mixing.

- **Read back through the public API** (`GET /users/:id`). Keeps the test decoupled from
  schema, so a column rename does not touch it. Blind spot: if read and write share the
  same bug, the test agrees with itself.
- **Query the database directly**. Catches the class this skill cares about most — a
  handler that builds its response from its *input* rather than from what was stored, so
  the API reports success over a write that never happened.

**Use the API for the common case and a direct query when the write itself is the risk** —
anything involving money, permissions, or a field with a `DEFAULT` you depend on. The
direct query is the stricter check; it is also the one that breaks on a schema change, so
spend it where it earns its keep.

## Test the constraints you rely on

If your code assumes the database enforces uniqueness, prove it does — otherwise a missing index in
a later migration silently converts a `Conflict` into duplicate rows:

```ts
test("email uniqueness is enforced by the database, not only by the check above it", () => {
  db.run("INSERT INTO users (email) VALUES ($e)", { e: "dupe@example.test" });
  expect(() => db.run("INSERT INTO users (email) VALUES ($e)", { e: "dupe@example.test" })).toThrow(/UNIQUE/);
});
```

The application-level "does this email exist?" check is a race, not a guarantee. The constraint is
the guarantee, and this test is what keeps it.

## Transactions roll back on throw — verify it

MEASURED on `bun:sqlite`: `db.transaction(fn)` returns a callable, and a throw inside it rolls the
whole thing back (verified: 0 rows after a throwing transaction). The callable also carries
`.deferred`, `.immediate` and `.exclusive` variants.

```ts
const transfer = db.transaction((from: string, to: string, amount: number) => {
  db.run("UPDATE accounts SET balance = balance - $amt WHERE id = $id", { amt: amount, id: from });
  db.run("UPDATE accounts SET balance = balance + $amt WHERE id = $id", { amt: amount, id: to });
  if (balanceOf(from) < 0) throw new Conflict("insufficient funds");   // rolls BOTH updates back
});
```

Test the failure path explicitly. A transaction that silently does not roll back is invisible until
it corrupts production data.

## Infrastructure

Run the **real** database engine you run in production; a different engine is a different
set of constraints, types and failure modes. Docker Compose is the usual way — bring it up
in a global setup so the cost is paid once for the whole suite, not per file.

Two details that matter more than they look:

- **Leave it running locally, tear it down only in CI.** A developer re-running one test
  should not wait for a container to boot; a CI runner must not leak one.
- **Put the data directory on a RAM disk** (`tmpfs`) and disable durability
  (`fsync=off`, `synchronous_commit=off` for Postgres). Test databases do not need to
  survive a power cut, and disk sync is most of the wall time.

For anything with portable SQL, `bun:sqlite` at `:memory:` skips all of this — a fresh
real database per file, zero setup, no container. Use it where the SQL allows and keep
Docker for the cases that need engine fidelity.

## Migrations

Run them from scratch in CI, on an empty database — that is the only way to catch a migration that
depends on data or on a column a later migration drops. Then test the **forward** migration against
a seeded snapshot of production-shaped data, because migrations that work on an empty schema and
fail on real rows are the common case.

## Seed through the public API where you can

```ts
const user = await createUser({ email: "a@b.c" });          // ✓ real defaults, real hooks
db.run("INSERT INTO users (id, email) VALUES (…)");          // ✗ drifts as columns are added
```

Direct inserts silently skip defaults, hashing and side effects, so the row is not shaped like a
real one. Use raw inserts only to construct states the API cannot produce — a legacy row, a
corrupted record, a state you are writing a repair for.
