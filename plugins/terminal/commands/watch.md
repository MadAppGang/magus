---
name: watch
description: Start a long-running process in a terminal session, monitor for readiness or failure, and report status. Use for dev servers, test watchers, log tailing, and build processes.
allowed-tools: mcp__tmux__start-and-watch, mcp__tmux__watch-pane, mcp__tmux__capture-pane, mcp__tmux__pane-state, mcp__tmux__kill-session, mcp__tmux__kill-headless-server
---

# /terminal:watch

Start a long-running process, monitor it for readiness or failure, and report the result. The session stays alive for later observation.

## Usage

```
/terminal:watch {command}
```

## Examples

```
/terminal:watch "bun run dev"
/terminal:watch "npm run dev"
/terminal:watch "bun test --watch"
/terminal:watch "npm test -- --watch"
/terminal:watch "tail -f /var/log/app.log"
/terminal:watch "docker-compose up"
/terminal:watch "go run ./cmd/server"
```

## What It Does

1. **Starts** the given command via `start-and-watch`
2. **Monitors** using a single blocking call — no polling loop required
3. **Uses start-and-watch** — a single call that blocks until a readiness trigger fires,
   sending progress notifications during the wait. No polling loop.
4. **Reports** the status: ready, errored, or still starting
5. **Keeps the session alive** — reports the pane ID for later use with `/terminal:observe`

## Agentic Watch Strategy

A single call to `start-and-watch` handles all monitoring:

```
mcp__tmux__start-and-watch({
  command: "<user_command>",
  pattern: "<readiness_regex>",
  triggers: "exit,error",
  mode: "quick",
  timeout: 60
}) → WatchResult
```

### Pattern Selection by Command Type

| Command type | Pattern |
|-------------|---------|
| Bun/Node dev server | `"Local:.*http\|listening on\|ready in"` |
| Go server | `"listening on\|started on\|server running"` |
| Test watcher (Vitest/Jest) | `"press a to rerun\|Waiting for file changes"` |
| Bun test watcher | `"watch mode\|watching"` |
| docker-compose up | `"healthy\|started"` |
| Log tail | (no pattern needed — use paneId + watch-pane instead) |

### Reading WatchResult

| event value | Meaning | Next action |
|-------------|---------|-------------|
| `"pattern:..."` | Readiness pattern matched | Report ready; save paneId |
| `"error"` | Error output detected | Report error; show WatchResult.output |
| `"exit"` | Process exited | Check exitCode in paneState |
| `"timeout"` | No signal in timeout_secs | Report "still starting"; save paneId |

### Lifecycle Difference from /terminal:run

Unlike `/terminal:run`, this command does NOT close the session on success.
The `paneId` returned in WatchResult is available for later `/terminal:observe` calls.

## Error Handling

- **Port conflict**: If `EADDRINUSE` detected in output, report the conflict and suggest alternatives
- **Command not found**: Detected via `"error"` event — report and kill session
- **Process hangs**: If `"timeout"` event fires, use `mcp__tmux__pane-state` to check process state

## Notes

- Best for processes that produce ongoing output (servers, watchers, log tailers)
- For one-shot commands, use `/terminal:run` instead
- Full output available in WatchResult — no line limit
- Save the returned paneId for later `/terminal:observe` calls
