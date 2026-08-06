---
name: security
description: Harden or review a Bun/TypeScript service — secrets, password and token handling, SQL injection, authn/authz, rate limiting, CORS and security headers, dependency audit. Ships tested guards with measured Bun crypto behaviour.
disable-model-invocation: true
---

# Security for Bun services

Bun ships strong primitives natively — argon2id via `Bun.password`, an OS-keychain API in
`Bun.secrets`, `bun audit`, `Bun.escapeHTML`, full `node:crypto`. The bugs are almost never in
those primitives. They are in the policy around them: comparing a token with `===`, hashing an API
key with argon2, a rate limiter keyed on a header the attacker controls, a CORS policy that
reflects any origin.

This skill ships that policy as tested code (**51 tests, `tsc --noEmit` clean, Bun 1.3.10**).

## Copy the guards in

```bash
SKILL="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/security}"; SKILL="${SKILL:-PASTE_THE_DIR_THIS_SKILL_MD_WAS_READ_FROM}"  # that var is UNSET in a Bash tool (MEASURED) — so paste it. `:?` would ABORT the block and copy nothing
mkdir -p src; if [ -d "$SKILL/assets" ]; then cp -r "$SKILL/assets/security" src/security   # credentials + guards + 2 test files
else echo "SKILL is still the placeholder — paste the real dir above and re-run"; fi
```

| Export | Purpose |
|---|---|
| `hashPassword` / `verifyPassword` / `needsRehash` | argon2id with the right cost, plus in-place migration |
| `generateToken` / `hashToken` / `verifyToken` | CSPRNG tokens, fast hashing, constant-time verify |
| `safeEqual` | constant-time compare that survives length mismatch |
| `authenticate` | login with **no user-enumeration timing oracle** |
| `redact` | strip secrets before anything reaches a log |
| `RateLimiter` / `rateLimitHeaders` / `clientKey` | limiting that cannot be bypassed by a forged header |
| `securityHeaders` / `corsHeaders` | strict defaults, no wildcard origin possible |

## Two hashing costs, and using the wrong one is the bug

| Secret | Entropy | Hash with | Why |
|---|---|---|---|
| user password | low | **argon2id** (`Bun.password`) | slow hashing is the only defence against offline brute force |
| session id, API key | 256-bit random | **SHA-256** | cannot be brute-forced; argon2 here taxes every request for nothing |

MEASURED: `Bun.password.hash` defaults to `$argon2id$v=19$m=65536,t=2,p=1` and takes **~96 ms**.
That cost *is* the control — do not tune it down to make login feel fast; rate-limit login instead.
Conversely, argon2 on a session token would add 96 ms to every authenticated request.

`Bun.password.verify` **auto-detects the algorithm from the hash prefix** (MEASURED: a bcrypt hash
verified with no options passed). That is what makes migration a non-event: keep verifying old
hashes, call `needsRehash` after a successful login, and re-hash the plaintext you already hold.

## Constant-time comparison, and why hashing first matters

`a === b` short-circuits at the first differing byte, leaking how many leading characters were
correct — enough to reconstruct a token byte by byte over the network.

MEASURED: `node:crypto.timingSafeEqual` **throws** `Input buffers must have the same byte length`.
So `safeEqual` hashes both sides to 32 bytes first, which fixes the throw *and* removes the length
leak — every comparison now costs the same regardless of input.

## User enumeration is a timing bug, not a message bug

Everyone remembers to return "invalid email or password" for both cases. Almost nobody notices
that `if (!user) return null` returns in microseconds while a real user costs ~96 ms of argon2.
That difference is trivially measurable and turns login into an account-existence oracle, which
feeds credential stuffing.

`authenticate()` verifies against a dummy hash when the user is absent so both paths cost the same.
Two tests guard it: one asserts the ratio holds, and a **negative control** proves the naive
implementation really is orders of magnitude faster — so the first test cannot be vacuously green.

## SQL injection — and the silent-empty-result trap next door

```ts
db.query(`SELECT * FROM u WHERE name = '${name}'`).all();  // MEASURED: "' OR 1=1 --" returns ALL rows
db.query("SELECT * FROM u WHERE name = ?").all(name);      // MEASURED: same input returns []
```

Parameter binding is not string escaping — the value never becomes part of the statement.

The adjacent trap is worse because it is silent. MEASURED on `bun:sqlite` with a **fresh**
`Database` and `prepare()` (no query cache):

| Default `new Database(path)` | Result |
|---|---|
| `$n` + `{ $n: "alice" }` | row ✅ |
| `$n` + `{ n: "alice" }` (no sigil) | **`[]` — no throw** |
| `$n` + `{ $typo: "alice" }` | **`[]` — no throw** |
| `$n` + no arguments at all | **`[]` — no throw** |

A misspelled parameter binds nothing and returns an empty result set. An authorisation check
written as "does a row exist granting access?" **fails open or closed at random** depending on
which way you phrase it.

**`new Database(path, { strict: true })` is the fix**: it makes a typo throw `Missing parameter "n"`
and inverts the convention so bare `{ n: … }` is correct. Decide once, at construction.

Identifiers (table and column names) cannot be parameterised. If one must be dynamic, validate it
against an allow-list — never interpolate user input into that position.

## Rate limiting: the key is the whole problem

```ts
const key = clientKey(req, server.requestIP(req)?.address, TRUST_PROXY_HOPS);
```

`x-forwarded-for` is **client-controlled** unless a proxy you own overwrites it. Reading it
unconditionally lets an attacker send a different forged IP per request and bypass the limiter
completely — the limiter still reports healthy numbers while doing nothing.

`clientKey` defaults to **ignoring the header** and steps in from the right by the number of hops
your own infrastructure appended. A test asserts that a forged prefix cannot displace the trusted
entry.

The shipped limiter is in-process and therefore **per-instance**: with N replicas the effective
limit is N × limit. Fine for coarse abuse protection; not fine as a billing or security control —
those need a shared store. Also call `sweep()` on an `unref()`'d interval, or the map grows once
per distinct key forever, which is an attacker-driven memory leak.

## CORS and headers

Two rules the shipped `corsHeaders` enforces structurally:

1. **Never reflect an arbitrary `Origin`.** Echoing what the client sent is functionally identical
   to `*` while looking deliberate — any site can then read authenticated responses.
2. **`*` with credentials is rejected by browsers**, which is what pushes people into rule 1.

`Vary: Origin` is always set; without it a shared cache serves one origin's CORS headers to another.

`securityHeaders()` defaults to `default-src 'none'; frame-ancestors 'none'` — correct for a JSON
API, which serves no scripts or frames. A test asserts no default contains `unsafe-inline`, since
that disables the XSS protection CSP exists to provide.

## Secrets

`Bun.env === process.env` (MEASURED — the same object). Bun auto-loads `.env` files, which is
convenient and is exactly why `.env` must be in `.gitignore` and never in a Docker image layer.

- **Never commit secrets.** A committed secret is compromised even after the commit is removed —
  rotate it, do not just delete it.
- **`Bun.secrets`** (`get`/`set`/`delete`) stores in the OS keychain — for local developer
  credentials, not for server runtime config.
- **Redact before logging.** `redact()` masks by key name (`password`, `token`, `api_key`,
  `authorization`, `cookie`, …), because you cannot reliably recognise a secret by its shape.
- **`--compile` autoloads `.env` by default** (MEASURED). If you ship a compiled binary, either
  disable that with `--no-compile-autoload-dotenv` or be certain no `.env` sits beside it in production.

## Acceptance — before reporting done

1. `bun test` and `tsc --noEmit` clean, and **`bun audit`** reports no vulnerabilities.
2. Grep the diff for the classic five:
   ```bash
   grep -rnE '\$\{[^}]*\}' src/ | grep -iE 'select|insert|update|delete|where'  # SQL interpolation
   grep -rn 'Math.random' src/ | grep -iE 'token|secret|id|key|nonce|salt'      # non-CSPRNG secret
   grep -rnE '(token|secret|key|password)[a-zA-Z]* ===' src/                     # non-constant-time compare
   grep -rn 'eval(\|new Function(' src/                                          # arbitrary execution
   grep -rn "allow-origin.*\*\|Origin')" src/                                    # reflected/wildcard CORS
   ```
3. `new Database(...)` passes `{ strict: true }` everywhere.
4. `maxRequestBodySize` is set on `Bun.serve` (MEASURED: over-limit yields an automatic 413).
5. Authorisation is checked **per resource**, not only per route. "Is this user logged in?" is not
   "may this user read invoice 42?" — that gap is the most common real-world API vulnerability.
6. `bun.lock` is committed and CI installs with `--frozen-lockfile`.

## References

| File | Read it when |
|---|---|
| `references/authn-authz.md` | sessions vs JWT, cookie flags, authorisation models, token lifecycle, OAuth pitfalls |
| `references/injection-and-input.md` | SQL/command/path/prototype injection, SSRF, XSS, upload handling, deserialisation |
| `references/supply-chain.md` | `bun audit`, lockfiles, install scripts, dependency review, CI hardening |
