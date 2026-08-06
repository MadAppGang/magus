---
name: http-service
description: "Build, review or debug a Bun HTTP service. Loads the http-service skill, then works the task through its workflow."
argument-hint: "[what to build, review or debug]"
---

<user_request>$ARGUMENTS</user_request>

1. **Read `skills/http-service/SKILL.md` in full first**, resolved against this plugin's own
   directory (the tree this command was loaded from). It is the router: it names which files in
   `skills/http-service/references/` your task actually needs. Read those too before writing code.

Use this for any Bun HTTP server, JSON API, route handler, middleware or response-shape work.

2. **Copy `skills/http-service/assets/http/` into the project** rather than retyping middleware.
   Four measured routing behaviours will otherwise bite you — in particular a method map does
   **not** produce a 405, and `server.reload()` **replaces** the whole route table.
3. **Before reporting done:** `bun test` and `tsc --noEmit` clean, every route has an explicit
   method allow-list, `maxRequestBodySize` is set, and no hand-built `new Response(JSON.stringify(…))`
   bypasses the response helpers.
