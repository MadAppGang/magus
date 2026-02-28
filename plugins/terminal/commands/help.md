---
name: help
description: Show all available terminal plugin commands organized by use case, with guidance on which command to use when.
---

# /terminal:help

Show all available terminal plugin commands and guidance on when to use each one.

## Display the following help text:

```
Terminal Plugin Commands
========================

INTENT COMMANDS (use these for most tasks):

  /terminal:run {cmd}        Run a command, capture output, auto-cleanup
                              Examples: run npm test, run go build ./...

  /terminal:watch {cmd}      Start long-running process, monitor for readiness
                              Examples: watch "bun run dev", watch "npm test --watch"

  /terminal:observe [id]     Check on running sessions (read-only)
                              Examples: observe, observe abc-1234, observe tmux:dev:0.0

  /terminal:repl {app}       Open interactive REPL or database shell
                              Examples: repl psql $DATABASE_URL, repl python3

  /terminal:tui {app}        Navigate TUI applications interactively
                              Examples: tui lazygit, tui vim src/index.ts, tui htop

ADVANCED COMMANDS (power-user, manual lifecycle):

  /terminal:session          Create, list, close terminal sessions manually
  /terminal:snapshot         Take a raw screenshot of a session
  /terminal:send             Send raw keystrokes to a session

QUICK GUIDE — Which command should I use?

  "Run my tests"                    → /terminal:run npm test
  "Start the dev server"            → /terminal:watch "bun run dev"
  "Check on the server"             → /terminal:observe
  "Query the database"              → /terminal:repl psql $DATABASE_URL
  "Open lazygit to commit"          → /terminal:tui lazygit
  "Check system resources"          → /terminal:tui htop
  "Edit a file in vim"              → /terminal:tui vim myfile.ts

WHEN TO USE /terminal:run vs Bash:

  Bash tool       → Simple non-interactive commands (most things)
  /terminal:run   → Commands needing TTY, interactive prompts, or TUI output
  /terminal:watch → Long-running processes (servers, watchers, log tailing)
```

## Notes

- This command has no tools — it just displays help text
- For detailed documentation on each command, use the specific command with no arguments
