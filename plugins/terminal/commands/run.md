---
name: run
description: Run a command in an isolated terminal session, capture output, and auto-cleanup. Use instead of Bash when you need TTY, interactive prompts, or screen-rendered output.
allowed-tools: mcp__ht__ht_create_session, mcp__ht__ht_execute_command, mcp__ht__ht_send_keys, mcp__ht__ht_take_snapshot, mcp__ht__ht_close_session, mcp__ht__ht_list_sessions
---

# /terminal:run

Run a command in an isolated headless terminal, capture its output, and automatically clean up the session. This is the primary command for most terminal tasks.

## Usage

```
/terminal:run {command}
```

## Examples

```
/terminal:run npm test
/terminal:run bun test src/auth/
/terminal:run go test ./... -v
/terminal:run python3 -m pytest tests/
/terminal:run docker-compose up --build
/terminal:run "curl -s https://api.example.com/health | jq"
```

## What It Does

1. **Creates** an isolated ht-mcp terminal session
2. **Executes** the given command
3. **Captures** the terminal output (120x40 visible screen)
4. **Reports** the results to the user
5. **Closes** the session automatically

The user never needs to manage session IDs or lifecycle.

## When to Use /terminal:run vs Bash

| Scenario | Use |
|----------|-----|
| Simple non-interactive command | Bash tool |
| Command with colored/formatted output | `/terminal:run` |
| Command with interactive prompts | `/terminal:run` |
| TUI-rendered output (progress bars, tables) | `/terminal:run` |
| Commands needing a real TTY | `/terminal:run` |
| Long-running continuous process | `/terminal:watch` instead |
| Multi-step REPL session | `/terminal:repl` instead |

## Behavior

### For quick commands (< 10 seconds)
Use `mcp__ht__ht_execute_command` which sends the command and waits for output. Take a snapshot to capture the result. Close the session.

### For longer commands (> 10 seconds)
Use `mcp__ht__ht_send_keys` to type the command + Enter, then poll with `mcp__ht__ht_take_snapshot` until you detect completion markers:
- Shell prompt returns (e.g., `$`, `%`, `#`)
- Known completion patterns: `passed`, `failed`, `done in`, `built in`, `error`
- Exit code patterns

### Output handling (40-line rule)
If the command is expected to produce more than 40 lines of output, append `| tail -40` or `| head -40` to capture the most relevant portion. The ht-mcp terminal is 120 columns x 40 lines — only the visible screen is captured, no scrollback.

## Error Handling

- If the command hangs (no prompt return after many polls), send `^c` to interrupt
- If the session is lost, check `mcp__ht__ht_list_sessions` for orphans
- Always close the session, even on error

## Notes

- This command auto-manages the full session lifecycle — create, use, close
- Session IDs are ephemeral and not exposed to the user
- For watching long-running processes, use `/terminal:watch` instead
- For interactive REPL sessions, use `/terminal:repl` instead
- For TUI app navigation (vim, lazygit), use `/terminal:tui` instead
