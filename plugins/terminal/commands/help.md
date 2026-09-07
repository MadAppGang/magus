---
name: help
description: Shows every terminal plugin command organized by use case, with guidance on which one to reach for and how slots work.
---

# /terminal:help

## Display the following help text:

```
Terminal Plugin Commands
========================

Every command works in numbered slots the server places and owns. Slot 1 is
the visible helper beside you; higher slots may be isolated. Never your own pane.

INTENT COMMANDS (use these for most tasks):

  /terminal:run {cmd}            Run a command in an ephemeral isolated pane, return output
                                  Examples: run npm test, run go build ./...

  /terminal:watch {cmd}          Start a long-running process, report "running in slot N"
                                  Examples: watch "bun run dev", watch "npm test --watch" --isolated

  /terminal:observe [slot]       Read a slot without touching it (default: list, then slot 1)
                                  Examples: observe, observe 1, observe 2 --watch

  /terminal:repl {app}           Open a REPL or database shell in an isolated slot
                                  Examples: repl psql $DATABASE_URL, repl python3

  /terminal:tui {app}            Navigate a TUI app (isolated by default, --beside for slot 1)
                                  Examples: tui lazygit, tui vim src/index.ts --beside

ADVANCED COMMANDS (manual control):

  /terminal:slots                List the slots you hold; close N; close all
  /terminal:snapshot [slot]      Raw capture of a slot (--lines N, --visual)
  /terminal:send [slot]          Send text or key:Name to a slot (default slot 1)

QUICK GUIDE — Which command should I use?

  "Run my tests"                    → /terminal:run npm test
  "Start the dev server"            → /terminal:watch "bun run dev"
  "Check on the server"             → /terminal:observe 1
  "Query the database"              → /terminal:repl psql $DATABASE_URL
  "Open lazygit to commit"          → /terminal:tui lazygit --beside
  "What did I leave running?"       → /terminal:slots
  "Stop the server"                 → /terminal:slots close 1

WHEN TO USE /terminal:run vs Bash:

  Bash tool       → Simple non-interactive commands (most things)
  /terminal:run   → Commands needing a TTY, interactive prompts, or TUI output
  /terminal:watch → Long-running processes (servers, watchers, log tailing)
```

## Notes

- This command has no tools; it only displays help text.
- Slots are integers 1 to 64; the same number addresses the same pane until closed, and `/terminal:slots` finds them again after compaction.
