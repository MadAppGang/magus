# Injection and untrusted input

Every entry in this file is the same bug: **data crossed into a position where it is interpreted as
instructions.** The fix is always to keep them separate structurally, never to escape more cleverly.

## SQL

```ts
db.query(`SELECT * FROM u WHERE name = '${name}'`).all();  // MEASURED: "' OR 1=1 --" → ALL rows
db.query("SELECT * FROM u WHERE name = ?").all(name);      // MEASURED: same input → []
```

Binding is not escaping — the value never becomes part of the parsed statement, so no quoting trick
can escape it.

Use `{ strict: true }` on every `bun:sqlite` `Database`. MEASURED: without it, a misspelled named
parameter binds nothing and **silently returns `[]`** rather than throwing. An authorisation check
phrased as "does a row exist granting access?" then fails open or closed at random.

**Identifiers cannot be parameterised.** For a dynamic column or table, validate against an
allow-list:

```ts
const SORTABLE = new Set(["created_at", "name", "amount"]);
if (!SORTABLE.has(sort)) throw new BadRequest("invalid sort field");
db.query(`SELECT * FROM invoices ORDER BY ${sort} ${dir === "desc" ? "DESC" : "ASC"}`);
```

An ORM does not make you safe: `.raw()`, `.whereRaw()` and template-built fragments all reopen the
hole. Grep for them.

## Command execution

```ts
await $`convert ${userFile} out.png`;                 // ✓ Bun.$ interpolation is escaped
await $`sh -c ${"convert " + userFile + " out.png"}`; // ✗ back to a shell string
Bun.spawn(["convert", userFile, "out.png"]);          // ✓ argv array, no shell at all
```

`Bun.$` escapes interpolated values, which covers the common case. The safest form remains
`Bun.spawn` with an **argv array** — there is no shell to interpret anything.

The residual risk once quoting is handled is **argument injection**: a filename beginning with `-`
becomes a flag. Prefix relative paths with `./`, or pass `--` before user-controlled arguments.

Never build a command string from user input. If you find yourself needing `sh -c`, the design is
wrong.

## Path traversal

```ts
const file = Bun.file(`./uploads/${req.params.name}`);   // ✗ "../../etc/passwd"
```

`..` segments, absolute paths, URL-encoded `%2e%2e`, and on some filesystems unicode
normalisation all defeat naive filtering. Resolve and then **verify containment**:

```ts
import { resolve, sep } from "node:path";

const ROOT = resolve("./uploads");
function safePath(name: string): string {
  const full = resolve(ROOT, name);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) throw new BadRequest("invalid path");
  return full;
}
```

The `+ sep` matters: `startsWith(ROOT)` alone accepts `/srv/uploads-evil`.

Best of all, **do not use client-supplied names as paths.** Generate an id, store the original name
as metadata.

## SSRF

A URL from a user, fetched by your server, reaches everything your server can reach — cloud
metadata endpoints (`169.254.169.254`), internal admin panels, databases on the private network.

```ts
const url = new URL(userSupplied);
if (!["https:"].includes(url.protocol)) throw new BadRequest("https only");
if (!ALLOWED_HOSTS.has(url.hostname)) throw new BadRequest("host not allowed");
const res = await fetch(url, { redirect: "manual" });   // a redirect can point anywhere
```

An **allow-list of hosts** is the only robust control. Blocklists lose: `127.0.0.1`, `localhost`,
`0.0.0.0`, `[::1]`, `2130706433` (decimal), `127.1`, a DNS name that resolves to a private IP, and
DNS rebinding all bypass them.

`redirect: "manual"` is essential — an allowed host that 302s to `169.254.169.254` defeats a check
performed only on the initial URL.

## XSS

If you render HTML, escape at the point of output. `Bun.escapeHTML` handles `< > " & '`
(MEASURED). Framework auto-escaping covers the normal path; the holes are the deliberate bypasses —
`dangerouslySetInnerHTML`, `v-html`, `innerHTML`.

Escaping is **context-dependent**: HTML-escaping a value that lands inside a `<script>` block, a
URL attribute (`javascript:`), or a CSS expression does not make it safe. Never place untrusted
data in those positions at all.

For a JSON API the relevant defences are `content-type: application/json` plus
`x-content-type-options: nosniff` — without them a browser may sniff a reflected payload as HTML
and execute it. Both are in `securityHeaders()`.

## Prototype pollution

```ts
Object.assign(target, JSON.parse(userInput));   // ✗ "__proto__" in the payload
```

A payload containing `__proto__`, `constructor` or `prototype` can add properties to
`Object.prototype`, changing behaviour application-wide — often escalating to RCE via a template
engine or a config lookup.

Fixes, in order of preference: parse with a schema that strips unknown keys (a `zod` object is
strip-by-default); use `Map` instead of a plain object for user-keyed data; or
`Object.create(null)` for a prototype-less bag. Never deep-merge untrusted input.

## Deserialisation and dynamic execution

`eval`, `new Function`, and dynamic `import()` of a user-controlled specifier are arbitrary code
execution. There is no safe way to run untrusted code in-process — if you genuinely need it, that
is a separate sandboxed process with a resource limit, not a `try/catch`.

`JSON.parse` is safe from execution but not from resource exhaustion: deeply nested arrays cost
memory and CPU. Cap body size (`maxRequestBodySize`) — MEASURED, an over-limit request gets an
automatic 413.

## Regular expressions (ReDoS)

`/(a+)+$/` against a long non-matching string backtracks exponentially and pins a core. Nested
quantifiers over overlapping character classes are the tell.

Cap input length before matching, prefer explicit parsing to a clever pattern, and never build a
regex from user input — `new RegExp(userInput)` is both ReDoS and a logic bypass.

## File uploads

- Cap size at the server (`maxRequestBodySize`) **and** verify `content-length` before consuming.
- **Never trust the declared MIME type or the extension** — sniff the magic bytes.
- Store outside the web root, with a **generated** name; serve through a handler that sets
  `content-type` and `content-disposition: attachment`.
- Scan if you accept documents. An uploaded file served back with a guessable URL is a
  malware-distribution endpoint with your domain's reputation.

## The rule

**Untrusted input never reaches an interpreter as syntax.** Parameterise (SQL), pass argv arrays
(shell), resolve-and-verify (paths), allow-list (URLs, identifiers, hosts), schema-parse (JSON).
Escaping is the fallback for when structural separation is genuinely impossible — which, for
everything above, it is not.
