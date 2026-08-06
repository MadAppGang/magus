---
name: errors
description: "Add or review error handling and resilience in a Bun/TypeScript service. Loads the errors skill, then works the task through its workflow."
argument-hint: "[what to harden or review]"
---

<user_request>$ARGUMENTS</user_request>

1. **Read `skills/errors/SKILL.md` in full first**, resolved against this plugin's own
   directory (the tree this command was loaded from). It is the router: it names which files in
   `skills/errors/references/` your task actually needs. Read those too before writing code.

Use this for error handling, custom error types, validation boundaries, retries, timeouts,
circuit breakers, or any "this should fail more gracefully" task.

2. **Copy `skills/errors/assets/errors/` into the project** rather than retyping the hierarchy.
   The operational-vs-programmer distinction is the whole design; `AppError.isOperational()`
   returns false for anything unrecognised, which is the safe default.
3. **Before reporting done:** grep the diff for the four swallow patterns in the skill's
   Acceptance section, and confirm every `fetch`/DB call on a request path is wrapped in
   `withTimeout`. `catch (e) { throw new Error(e.message) }` destroys the stack AND the cause.
