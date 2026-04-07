---
name: repl
description: Open an interactive REPL or database shell session. Handles prompt detection, query execution, and clean exit for psql, mongosh, redis-cli, python3, node, and other REPLs.
allowed-tools: mcp__tmux__create-headless, mcp__tmux__start-and-watch, mcp__tmux__run-in-repl, mcp__tmux__pane-state, mcp__tmux__kill-session
---

# /terminal:repl

Open an interactive REPL or database shell, execute queries/expressions, and manage the session lifecycle.

## Usage

```
/terminal:repl {application} [query]
```

## Examples

**Database shells**:
```
/terminal:repl psql $DATABASE_URL
/terminal:repl "psql -d myapp" "SELECT count(*) FROM users"
/terminal:repl mongosh $MONGO_URI
/terminal:repl redis-cli
/terminal:repl "turso db shell mydb"
```

**Language REPLs**:
```
/terminal:repl python3
/terminal:repl node
/terminal:repl "bun repl"
/terminal:repl irb
```

## What It Does

1. **Creates** a headless session: `create-headless({ name: "repl" })` → `{ paneId }`
2. **Opens** the REPL application with `start-and-watch`, blocking until the prompt appears:
   `start-and-watch({ paneId, command: app, pattern: <prompt_pattern>, timeout: 15 })`
3. **Executes** each query with `run-in-repl`:
   `run-in-repl({ paneId, input: query, promptPattern: <pattern>, timeout: 10 })`
   → returns `{ output }` directly (no snapshot needed)
4. **Exits** the REPL with `run-in-repl({ input: exit_command, promptPattern: "\\$" })`
5. **Closes** the session with `kill-session`

## Prompt Patterns for run-in-repl

| Application | `promptPattern` |
|-------------|----------------|
| psql | `"=#"` |
| mongosh | `">"` |
| redis-cli | `"127\\.0\\.0\\.1:\\d+>"` |
| python3 | `">>> "` |
| node / bun | `"> "` |
| irb | `"irb>"` |
| turso shell | `">"` |
| bash/zsh shell | `"\\$\\s*$"` |

## REPL Exit Commands

| Application | Exit Command |
|-------------|-------------|
| psql | `\q` |
| mongosh | `.exit` or Ctrl+D |
| redis-cli | `quit` or Ctrl+D |
| python3 | `exit()` or Ctrl+D |
| node / bun | `.exit` or Ctrl+D |
| irb | `exit` or Ctrl+D |
| turso shell | `.quit` |

## Multi-Query Sessions

Each query is one `run-in-repl` call — output is returned directly, no screen scraping needed:

```
result1 = run-in-repl({ input: "SELECT count(*) FROM users;", promptPattern: "=#" })
result2 = run-in-repl({ input: "SELECT * FROM settings LIMIT 5;", promptPattern: "=#" })
// output fields contain the full query results
```

`run-in-repl` captures output between the sent input and the next prompt appearance — the full response, regardless of length. No row limits needed for readability.

## Safety

- **Never send passwords**: If `mcp__tmux__pane-state` shows `waitingForInput == true` and output contains "password", STOP and report to the user
- **Confirm destructive operations**: `DROP TABLE`, `DELETE`, `TRUNCATE` — always ask first

## Notes

- REPL sessions are inherently multi-turn — the session stays open until explicitly exited
- For one-shot commands (not interactive), use `/terminal:run` instead
- For TUI navigation (vim, lazygit), use `/terminal:tui` instead
