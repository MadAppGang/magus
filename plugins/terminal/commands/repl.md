---
name: repl
description: Opens a REPL or database shell in an isolated slot, runs queries against its prompt, and closes the slot. Use for psql, mongosh, redis-cli, python3, node, and other interactive shells.
allowed-tools: mcp__plugin_terminal_mux__start-and-watch, mcp__plugin_terminal_mux__run-in-repl, mcp__plugin_terminal_mux__pane-state, mcp__plugin_terminal_mux__capture-pane, mcp__plugin_terminal_mux__close-pane, mcp__plugin_terminal_mux__list-slots
---

# /terminal:repl

Opens an interactive REPL or database shell, executes queries or expressions, and closes it when done.

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
```

**Language REPLs**:
```
/terminal:repl python3
/terminal:repl node
/terminal:repl "bun repl"
```

## What It Does

1. **Opens** the REPL in an isolated slot and blocks until its prompt appears:
   ```
   mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "python3", pattern: ">>>" })
   → { "slot": 2, "created": true, "event": "pattern:>>>", "detail": "Ready — matched: >>>", "elapsed": 0.51, "output": "…", "paneState": { "foregroundCmd": "Python", "isAlive": true, "waitingForInput": true } }
   ```
2. **Executes** each query with `run-in-repl`, which returns the output between the input and the next prompt:
   ```
   mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "1+1", promptPattern: ">>>", timeout: 10 })
   → { "slot": 2, "created": false, "output": "1+1\n2", "exited": false }
   ```
3. **Closes** the slot. `close-pane` interrupts the REPL, so no exit command is needed:
   ```
   mcp__plugin_terminal_mux__close-pane({ slot: 2 }) → [{ "slot": 2, "action": "killed" }]
   ```

Use slot 2 unless `mcp__plugin_terminal_mux__list-slots` shows it is taken; then pick the next free number. `isolated: true` needs an explicit slot on `start-and-watch`.

## Prompt Patterns

| Application | `pattern` / `promptPattern` |
|-------------|----------------------------|
| psql | `"=#"` |
| mongosh | `">"` |
| redis-cli | `"127\\.0\\.0\\.1:\\d+>"` |
| python3 | `">>>"` |
| node / bun | `"> "` |
| irb | `"irb>"` |
| turso shell | `">"` |

## Multi-Query Sessions

Each query is one `run-in-repl` call; `output` holds the full response, however long:

```
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "SELECT count(*) FROM users;", promptPattern: "=#" })
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "SELECT * FROM settings LIMIT 5;", promptPattern: "=#" })
```

`exited: true` means the REPL process ended during the call (for example a fatal error); reopen it with `start-and-watch` before the next query.

## Safety

- **Never send passwords**: if `mcp__plugin_terminal_mux__pane-state({ slot: 2 })` shows `waitingForInput: true` and the output mentions "password", stop and report to the user.
- **Confirm destructive operations**: `DROP TABLE`, `DELETE`, `TRUNCATE` always need the user's go-ahead first.

## Notes

- The slot stays open between queries; close it when the session is finished.
- For one-shot commands, use `/terminal:run` instead.
- For TUI navigation (vim, lazygit), use `/terminal:tui` instead.
