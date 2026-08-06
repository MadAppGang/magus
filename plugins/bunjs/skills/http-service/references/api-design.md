# API design decisions

Framework-independent conventions. Pick them once; the cost of not deciding is a codebase where
each endpoint answers differently and clients special-case every one.

## Status codes that carry information

| Code | Means | Common misuse |
|---|---|---|
| 200 | here is the result | returning 200 with `{ error: … }` — clients cannot detect failure |
| 201 | created; **`Location` header required** | 200 for a creation |
| 202 | accepted, not yet done | 200, implying the work finished |
| 204 | done, nothing to say | 200 with `null` |
| 400 | malformed — cannot parse | using it for semantic failures |
| 401 | **we do not know who you are** | used when the user is known but unauthorised |
| 403 | we know you, you may not | used for "not found" on a resource they may not see |
| 404 | no such resource | used for a wrong HTTP verb (that is 405) |
| 405 | resource exists, verb wrong | Bun's default fall-through gives 404 — see SKILL.md |
| 409 | conflicts with current state | 400 for a duplicate |
| 422 | parsed fine, semantically rejected | 400, losing the distinction |
| 429 | slow down; **`Retry-After` required** | 503 |
| 502/503/504 | upstream failed / we are down / we gave up | 500 for everything |

**`{"status": 200, "error": "not found"}` is the worst pattern in this list.** Every client must
now parse the body to know whether the call worked, so error handling, retries and monitoring all
break. Use the status line — it is the one part of HTTP every layer understands.

401 vs 403 is worth getting right: 401 invites the client to authenticate (and a browser will
prompt); 403 says do not bother. Returning 403 for an expired token sends clients into a loop.

## The `404` vs `403` privacy decision

Returning 403 for a resource that exists but the caller cannot see confirms it exists. For
sensitive resources — user accounts, private repos — return **404** for both "does not exist" and
"you may not see it". This is a deliberate trade of debuggability for non-enumerability; make it
consciously and document it.

## Pagination

**Cursor, not offset**, for anything that grows:

```
GET /events?limit=50                       → { items, nextCursor: "eyJpZCI6MTAwfQ" }
GET /events?limit=50&cursor=eyJpZCI6MTAwfQ
```

`OFFSET 10000` makes the database scan and discard 10,000 rows — it gets slower the deeper you
page. Worse, offset pagination **skips and duplicates rows** when the underlying set changes
between requests, which is silent data loss in an export job.

The cursor should be opaque (base64 of a keyset) so it can change shape without breaking clients.
Always return the envelope object — a bare top-level array cannot carry `nextCursor`, so adding
pagination later is a breaking change.

Cap `limit` server-side. An uncapped `?limit=1000000` is a denial-of-service you built yourself.

`total` only when it is cheap. A `COUNT(*)` on every page of a large table costs more than the page.

## Versioning

Version when you must break; avoid breaking. Additive changes — new optional field, new endpoint —
need no version.

`/v1/users` in the path is the least sophisticated and the most operable option: visible in logs,
trivially routable at the proxy, obvious in a bug report. Header-based versioning is cleaner in
theory and worse in practice, because a caching layer that ignores `Vary` will happily serve v2 to
a v1 client.

The genuinely breaking changes: removing a field, renaming one, tightening validation, changing a
type, changing a status code's meaning. **Adding a required request field is breaking** even though
it feels additive.

## Idempotency

`GET`, `PUT`, `DELETE` are idempotent by definition; `POST` is not. For a `POST` that moves money
or creates a resource, accept an `Idempotency-Key` header and store key → response, so a client
retry after a lost response replays instead of re-executing.

Do the insert-and-execute in **one transaction**; two statements race, and the race window is
exactly when retries arrive. Full treatment in the `errors` skill's `resilience-patterns.md`.

## Field naming and shape

Pick `snake_case` or `camelCase` and never mix — mixed casing means every client writes a mapping
layer. Match your ecosystem's default rather than your database's.

- **Timestamps: RFC 3339 / ISO 8601 in UTC**, always with an offset (`2026-08-06T14:30:00Z`).
  A timestamp without an offset is ambiguous and will be misread.
- **Money: integer minor units** (`{"amount": 1050, "currency": "AUD"}`), never a float. `0.1 + 0.2`
  is not `0.3`, and that arithmetic eventually runs on a customer's balance.
- **Enums as strings**, not integers. `"status": "pending"` survives reordering; `"status": 2` does not.
- **Omit or `null`, consistently.** Decide whether an absent value is missing-key or explicit-null,
  and apply it everywhere — clients branch on this.
- **Do not return internal ids you did not mean to expose.** Sequential integer ids leak volume and
  allow enumeration; prefix random ids (`usr_a1b2c3`) are self-describing in logs.

## Errors

One envelope, everywhere — the `errors` skill ships it:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "requestId": "…", "issues": [ … ] } }
```

`code` is the stable contract; `message` is human text that may change. Clients must switch on
`code`, never parse `message`. `requestId` is what turns a support ticket into a log query.

**5xx messages must be generic.** Internal messages carry table names, file paths and upstream URLs.

## Content negotiation and CORS

Accept and return `application/json` unless you have a reason not to. Honour `Accept-Encoding` at
the proxy rather than in the app.

CORS: enumerate allowed origins. `Access-Control-Allow-Origin: *` combined with
`Allow-Credentials: true` is **rejected by browsers**, and reflecting an arbitrary `Origin` header
back is equivalent to `*` while looking careful. Details in the `security` skill.

## Health endpoints are not one endpoint

- **Liveness** — "is this process wedged?" Checks nothing external. Restarting fixes it or nothing does.
- **Readiness** — "should traffic come here?" Checks only dependencies you cannot serve *any*
  request without.

A liveness probe that checks the database will restart a healthy process during a database blip,
turning a partial outage into a total one. See the `production` skill.
