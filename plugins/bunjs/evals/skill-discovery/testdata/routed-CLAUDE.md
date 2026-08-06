# Project Context

A Bun/TypeScript authentication service.

## Skill Routing

| Need | Invoke Skill | When |
|---|---|---|
| Bun/TS security — passwords, tokens, injection, rate limiting, CORS, headers, audit | `security` | Any auth, secrets, or security-review task |

The `security` skill carries `disable-model-invocation`, so it never appears in the
model's skill listing. **This row is the only way it gets found on a plain request** —
invoke it with the Skill tool before writing any auth code.
