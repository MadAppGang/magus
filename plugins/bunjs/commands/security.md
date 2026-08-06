---
name: security
description: "Harden or security-review a Bun/TypeScript service. Loads the security skill, then works the task through its workflow."
argument-hint: "[what to harden or review]"
---

<user_request>$ARGUMENTS</user_request>

1. **Read `skills/security/SKILL.md` in full first**, resolved against this plugin's own
   directory (the tree this command was loaded from). It is the router: it names which files in
   `skills/security/references/` your task actually needs. Read those too before writing code.

Use this for auth, passwords, tokens, injection, rate limiting, CORS, security headers,
secrets handling, or a general security review.

2. **Copy `skills/security/assets/security/` into the project.** The policy is where the bugs
   live: two different hashing costs (argon2 for passwords, SHA-256 for tokens), constant-time
   comparison that survives length mismatch, and a rate-limit key that cannot be forged.
3. **Two measured traps:** `bun:sqlite` without `{ strict: true }` returns `[]` for a misspelled
   parameter instead of throwing; and an unguarded login leaks user existence through timing.
4. **Before reporting done:** `bun audit` clean, the five greps in the skill's Acceptance section
   return nothing, and authorisation is checked **per resource**, not just per route.
