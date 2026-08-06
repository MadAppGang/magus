---
name: opentui-tui
description: "Build, review or debug an OpenTUI terminal UI. Loads the opentui-tui skill, then works the task through its workflow."
argument-hint: "[what to build, review or debug]"
---

<user_request>$ARGUMENTS</user_request>

Use this for any Bun/TypeScript terminal UI — an OpenTUI app, a dashboard, a full-screen CLI, a log
or metrics viewer — and for reviewing or debugging one. It also covers "make my TUI look good".

1. **Read `skills/opentui-tui/SKILL.md` in full first**, resolved against this plugin's own
   directory (the tree this command was loaded from). It is the router: it names which of the
   eight files in `skills/opentui-tui/references/` your task actually needs. Read those too
   before writing code — the aesthetic contract and the version/build matrix both live there.
2. **Copy `skills/opentui-tui/assets/theme/` and `assets/runtime/` into the project** rather
   than retyping colour maths, cell-width maths or a shutdown handler. SKILL.md has the recipe.
3. **Before reporting done:** `bun test`, `tsc --noEmit`, and for anything visual a colour
   screenshot you have actually looked at. A single-colour bar or bare numbers on that first
   screenshot means the aesthetic contract was skipped — go back, do not report done.
