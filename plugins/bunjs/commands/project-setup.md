---
name: project-setup
description: "Start or restructure a Bun/TypeScript project. Loads the project-setup skill, then works the task through its workflow."
argument-hint: "[what to set up or restructure]"
---

<user_request>$ARGUMENTS</user_request>

1. **Read `skills/project-setup/SKILL.md` in full first**, resolved against this plugin's own
   directory (the tree this command was loaded from). It is the router: it names which files in
   `skills/project-setup/references/` your task actually needs. Read those too before writing code.

Use this when starting a new Bun/TypeScript project, restructuring an existing one, or fixing
its configuration, tsconfig, workspaces or tooling.

2. **Copy `skills/project-setup/assets/config/` into the project** rather than hand-rolling an env
   parser. `Boolean("false")` is `true` and `Number("")` is `0` — both traps are already closed
   and tested there.
3. **Before reporting done:** `bun run check` (typecheck + lint + test) passes, `process.env`
   appears in exactly one file, and `.env` is in **both** `.gitignore` and `.dockerignore`.
