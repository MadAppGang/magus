---
name: bun
description: "Route a Bun/TypeScript task to the right bunjs skills. Loads the index, reads only what the task needs, then does the work."
argument-hint: "[what you want to build, fix or review]"
---

<user_request>$ARGUMENTS</user_request>

1. **Read `skills/bun/SKILL.md`** — resolved against this plugin's own directory (the tree
   this command was loaded from). It is the index: eight skills, what each is for, and the
   routing table for common tasks.

2. **Pick the one or two the request actually needs, and read only those.** Match on what
   the task will make you write, not on the words used — "add login" is `security`, "it's
   slow" is `performance`. Chains stop where the task stops: a fresh app is
   `project-setup` → `http-service` → `errors`; `testing` waits until there is something to
   test, `production` until it is being shipped. Reading all eight is ~4,000 lines and
   defeats the point of the index.

3. **Copy the shipped `assets/` rather than retyping them.** Six of the eight ship tested
   code and each names its exact `cp` line. Retyped versions silently lose the parts that
   matter — the enumeration-timing burn, full-jitter backoff, the cycle-safe cause walk.

4. **Before reporting done:** satisfy the Acceptance section of every skill you read. `bun test`
   and `tsc --noEmit` are the floor in all eight — `bun run` strips types without checking
   them, so a type error never surfaces at runtime.

If the request is not Bun or TypeScript, say so and stop rather than guessing from these skills.
