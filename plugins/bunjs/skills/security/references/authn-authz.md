# Authentication and authorisation

## Sessions vs JWT

The decision is **revocation**, not scale.

| | Server sessions | JWT |
|---|---|---|
| Revoke immediately | yes — delete the row | **no** — valid until expiry |
| Storage | a lookup per request | none |
| Payload can go stale | no | yes — roles are frozen at issue time |
| Good for | anything with logout, bans, or role changes | short-lived service-to-service tokens |

**Default to server sessions.** The "stateless" selling point is usually mis-sold: you still need a
database on nearly every request, and the price is that you cannot log anyone out. A user changes
their password because they were compromised, and the attacker's token keeps working for the rest
of its lifetime.

If you use JWTs, keep access tokens **short** (5–15 min) with a revocable refresh token, and accept
that "revocation" means "within one access-token lifetime".

### JWT specifics that are security bugs

- **Pin the algorithm.** Never trust the token's `alg` header. `alg: none` and RS256→HS256
  confusion (verifying with the public key *as* an HMAC secret) are both classic full bypasses.
- **Verify `exp`, `iss` and `aud`.** A token issued by your staging environment, or for a different
  service, must not validate here.
- **A JWT is signed, not encrypted.** Anyone can read the payload. No PII, no internal ids you did
  not mean to expose.

## Session tokens

```ts
const token = generateToken();          // 256-bit CSPRNG, base64url
await db.insert({ id: hashToken(token), userId, expiresAt });   // store the HASH
setCookie("sid", token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
```

Store the **hash**, never the token — a database leak then hands over nothing usable. SHA-256 is
correct here (the token is already 256 bits of entropy); argon2 would add ~96 ms to every request.

Cookie flags, and what each one actually prevents:

| Flag | Prevents |
|---|---|
| `httpOnly` | JavaScript reading the cookie — turns an XSS into a smaller problem |
| `secure` | transmission over plain HTTP |
| `sameSite: "Lax"` | most CSRF; `"Strict"` breaks inbound links, `"None"` requires `secure` |
| `path` / `maxAge` | scope and lifetime |

`sameSite: "Lax"` is not complete CSRF protection: it still allows top-level `GET` navigation, so
**never mutate state on a GET**.

### Rotate on privilege change

Issue a **new** session id on login and on any privilege elevation, and delete the old one.
Otherwise an attacker who can set a victim's cookie before login (session fixation) holds a session
that becomes authenticated when the victim signs in.

## Authorisation: the gap that ships

Authentication is "who are you". Authorisation is "may you do this **to this object**". The most
common real-world API vulnerability is checking the first and assuming the second:

```ts
// ✗ authenticated, but any logged-in user can read any invoice (IDOR)
"/invoices/:id": requireAuth(async (req) => ok(await db.getInvoice(req.params.id)))

// ✓ ownership is part of the query, not a separate check that can be forgotten
"/invoices/:id": requireAuth(async (req) => {
  const invoice = await db.getInvoiceForUser(req.params.id, currentContext()!.user!.id);
  if (!invoice) throw new NotFound("invoice", req.params.id);   // 404, not 403 — see below
  return ok(invoice);
})
```

**Push the ownership predicate into the query.** A separate `if (invoice.userId !== user.id)` is a
line someone will forget in the next handler; a repository method that cannot return another user's
row is structural.

Return **404 rather than 403** for a resource the caller may not see — a 403 confirms it exists,
which lets an attacker enumerate your id space.

### Models

- **RBAC** — roles carry permissions. Enough for most systems. Check the *permission*
  (`invoice:read`), never the role name, or you will be editing every call site when roles change.
- **ABAC / ownership** — decisions depend on the object (owner, tenant, state). This is what most
  "RBAC" systems actually need, and where the IDOR above lives.
- **Multi-tenancy** — the tenant id belongs in **every** query. A single missing `WHERE tenant_id`
  is a cross-tenant data breach. Enforce it at the repository layer or with row-level security, not
  by remembering.

**Deny by default.** A new route with no explicit policy must fail closed. If your framework lets a
handler be registered without an auth decision, that is a design flaw — make the policy a required
argument.

## Login endpoint hardening

1. **Rate limit per account AND per IP.** Per-IP alone misses distributed credential stuffing;
   per-account alone lets one IP spray many accounts.
2. **Uniform response and uniform timing** — see `authenticate()` in `assets/security/credentials.ts`.
3. **Never log the password**, including on validation failure. `redact()` before logging a body.
4. **Check against a breached-password list** on signup and change. Far more effective than
   composition rules, which mostly produce `Password1!`.
5. **Generic failure message**: "invalid email or password", never "no such user".

## Password reset

The reset flow is routinely weaker than the login it protects.

- Token: CSPRNG, **single-use**, short-lived (15–60 min), stored hashed.
- Deleting the token must be part of the same transaction that changes the password, or a race
  allows two resets from one token.
- **Invalidate all existing sessions** on reset — otherwise the attacker you are locking out keeps
  their session.
- The "if that address exists we sent a link" response must be identical either way, and sent with
  the same latency (queue the send, do not await it only in the found branch).

## Service-to-service

mTLS or short-lived signed tokens; never a shared static API key that lives forever in an env var
of twelve services. If you must use API keys, store them hashed, prefix them so they are
identifiable in a leak scan (`svc_live_…`), and scope each to one caller so you can revoke one
without rotating all.
