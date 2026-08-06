---
name: production
description: "Prepare a Bun service for production. Loads the production skill, then works the task through its workflow."
argument-hint: "[what to ship or harden]"
---

<user_request>$ARGUMENTS</user_request>

1. **Read `skills/production/SKILL.md` in full first**, resolved against this plugin's own
   directory (the tree this command was loaded from). It is the router: it names which files in
   `skills/production/references/` your task actually needs. Read those too before writing code.

Use this for deployment readiness: graceful shutdown, structured logging, health checks,
Dockerfiles, signals, CI, or "why did that deploy drop requests".

2. **Copy `skills/production/assets/production/` into the project** — logger, shutdown, Dockerfile
   and dockerignore.example. Move the Dockerfile and `.dockerignore` to the repo root.
3. **Shutdown ordering is the whole thing:** readiness off → drain delay → `server.stop()` →
   close resources → exit. Stopping the listener first drops the requests the load balancer is
   still sending.
4. **Before reporting done:** prove shutdown works by sending SIGTERM mid-request and confirming
   the in-flight request completes with exit code 0. `/health/live` must touch nothing external.
