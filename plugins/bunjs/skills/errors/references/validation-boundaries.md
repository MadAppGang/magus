# Validation boundaries — fail fast, at the edge, once

## The rule

**Validate where untrusted data enters, convert it to a trusted type there, and never re-check it again.**

The failure mode this prevents is defensive checks scattered through the call stack — `if (!user?.email)`
appearing in the route, the service and the repository, each written by someone who did not trust the
layer above. That is not safety, it is three chances to disagree about what "valid" means.

## Parse, don't validate

A *validator* answers "is this okay?" and hands the same loose type onward. A *parser* answers
"here is a value of a type that cannot be wrong" — and the compiler enforces the rest.

```ts
// validation: the boolean is thrown away, `body` is still `any` downstream
if (isValidUser(body)) { await createUser(body as User); }

// parsing: past this line `input` cannot be missing an email, ever
const input = CreateUser.parse(await req.json());
await createUser(input);
```

Once parsed, the type flows. `createUser(input: CreateUserInput)` needs no guards, because the only way
to obtain a `CreateUserInput` is to have parsed one.

## Where the boundaries actually are

Every one of these is untrusted, including the ones that feel internal:

| Boundary | Why it is untrusted |
|---|---|
| HTTP request body / query / params | obvious |
| **Environment variables** | a typo'd `PORT=` is a string `""`, and `Number("") === 0` |
| Database rows | schema drift, older writers, manual edits, nullable columns you forgot |
| Upstream API responses | their contract changed and did not tell you |
| Message queue payloads | written by an older deploy of your own service |
| `JSON.parse` of anything | returns `any`; TypeScript stops helping at that line |
| CLI arguments and files | user-controlled by definition |

The DB and queue rows surprise people. `db.query("…").all() as User[]` is a lie the compiler accepts —
it is a cast, not a check. When a nullable column arrives as `null`, the failure surfaces three layers
later as `Cannot read properties of null`, a *programmer* error caused by a *data* problem.

## Wiring a schema library

Any of zod / valibot / arktype / typebox works; nothing here depends on the choice. Convert the library's
issue format into `ValidationFailed` at the boundary so the rest of the app — and the client — sees one
error shape.

```ts
import { z } from "zod";
import { ValidationFailed } from "./errors/catalog";

const CreateUser = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
});
export type CreateUserInput = z.infer<typeof CreateUser>;   // types derive FROM the schema

export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new ValidationFailed(
    result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}
```

**Derive the type from the schema (`z.infer`), never declare both.** A hand-written `interface` beside a
schema is two sources of truth that drift, and the drift is invisible until a field silently stops being
validated.

`ValidationFailed` is a 422 whose `issues` array reaches the client — verified by a shipped test. That
array is the actionable part; a bare "Validation failed" forces the user to guess which field.

## `await req.json()` throws — and it is not your bug

Malformed JSON makes `req.json()` reject with a `SyntaxError`, which is *not* an `AppError` and therefore
classifies as a programmer error, producing a 500 for what is really a 400. Convert it at the edge:

```ts
async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch (err) {
    throw new BadRequest("body is not valid JSON", { cause: err });
  }
}
```

The same applies to `req.formData()` and to `new URL()` on a user-supplied string.

## Environment config: parse once, at boot

Env vars are the boundary people skip, and the consequences are the worst kind — a service that starts
fine and fails an hour later on the first request that touches a mistyped variable.

```ts
const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const env = Env.parse(process.env); // throws AT BOOT if anything is wrong
```

Crashing at startup is the desired behaviour: an orchestrator will not shift traffic to a container that
never became ready, so a bad config becomes a failed deploy instead of an incident. See the
`project-setup` skill for the full typed-config asset.

Note `z.coerce.number()` — every env var is a string. `PORT: z.number()` rejects `"3000"`.

## Do not validate what you already parsed

```ts
// ✗ the check is unreachable: `input.email` is a string by construction
function createUser(input: CreateUserInput) {
  if (!input.email) throw new BadRequest("email required");
```

Dead defensive code is worse than none — it implies the type is untrustworthy, so the next reader adds
their own check too. If a value genuinely can be wrong at that point, it was not parsed at the boundary;
fix the boundary.

The exception is a true *invariant* — a condition your own logic must maintain, not one the caller
supplies. Those get `Bug` or `assertNever`, because a violation means the program is wrong:

```ts
if (order.total < 0) throw new Bug("negative order total after discount", { context: { orderId } });
```
