---
name: run
description: Run a command in an isolated terminal session, capture output, and auto-cleanup. Use instead of Bash when you need TTY, interactive prompts, or screen-rendered output.
allowed-tools: mcp__tmux__execute-command, mcp__tmux__start-and-watch, mcp__tmux__capture-pane, mcp__tmux__pane-state, mcp__tmux__kill-session, mcp__tmux__send-keys
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

1. **Executes** the given command in an isolated headless session
2. **Captures** the full output (no line limit — uses tee + file internally)
3. **Reports** the results including exit code
4. **Auto-cleans** the session on completion

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

### For all one-shot commands

```
mcp__tmux__execute-command({ command: "<user_command>", headless: true })
```

Returns `{ output, exitCode }` synchronously. Session is auto-destroyed. No session management needed.

### For commands with complex output or streaming status

```
mcp__tmux__start-and-watch({
  command: "<user_command>",
  pattern: "\\$",
  triggers: "exit,error",
  mode: "medium",
  headless: true,
  timeout: 120
})
```

Use `WatchResult.output` for the results and `WatchResult.event` to distinguish success from error.

`execute-command` returns full output — no line limit since it captures via tee to a temp file rather than a fixed-size viewport.

## Error Handling

- If the command hangs, use `mcp__tmux__pane-state` to check if it is waiting for input
- If `WatchResult.event == "timeout"`, the command did not complete within the timeout — report and kill the session
- For stuck processes, send `C-c` via `mcp__tmux__send-keys` with `literal: false`

## Notes

- This command auto-manages the full session lifecycle — execute, capture, auto-cleanup
- For watching long-running processes, use `/terminal:watch` instead
- For interactive REPL sessions, use `/terminal:repl` instead
- For TUI app navigation (vim, lazygit), use `/terminal:tui` instead
