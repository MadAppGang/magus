---
name: watch
description: Start a long-running process in a terminal session, monitor for readiness or failure, and report status. Use for dev servers, test watchers, log tailing, and build processes.
allowed-tools: mcp__ht__ht_create_session, mcp__ht__ht_execute_command, mcp__ht__ht_send_keys, mcp__ht__ht_take_snapshot, mcp__ht__ht_close_session, mcp__ht__ht_list_sessions
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

1. **Creates** an isolated ht-mcp terminal session
2. **Executes** the given command
3. **Polls** the terminal with repeated snapshots, looking for:
   - **Ready signals**: `listening on`, `ready`, `started`, `Local:`, `compiled`, `watching for`
   - **Error signals**: `error`, `EADDRINUSE`, `failed`, `cannot`, `not found`
   - **Test result signals**: `passed`, `failed`, `✓`, `×`
4. **Reports** the status: ready, errored, or still starting
5. **Keeps the session alive** — reports the session ID for later use with `/terminal:observe`

## Polling Strategy

Poll `mcp__ht__ht_take_snapshot` up to 30 times. Each snapshot naturally adds a small delay. Look for these patterns in each snapshot:

### Dev Server Ready Signals
```
"listening on", "ready on", "started", "Local:", "localhost:",
"Server running", "compiled successfully", "watching for changes"
```

### Test Watcher Ready Signals
```
"Watching for file changes", "press q to quit", "waiting for changes",
"Tests:", "passed", "failed"
```

### Error Signals
```
"EADDRINUSE", "address already in use", "Error:", "FATAL",
"Cannot find module", "command not found", "permission denied"
```

### When Polling Finishes
- **Ready detected**: Report success, show relevant output, provide session ID
- **Error detected**: Report error, show error output, close session
- **Timeout (30 polls, no signal)**: Report status as "still starting", provide session ID

## Lifecycle

Unlike `/terminal:run`, this command does NOT auto-close the session. The process keeps running. The user can:
- Use `/terminal:observe {sessionId}` to check on it later
- Use `/terminal:send {sessionId} key:^c` to stop it
- Use `/terminal:session close {sessionId}` to close it

## Error Handling

- **Port conflict**: If `EADDRINUSE` detected, report the conflict and suggest alternatives
- **Command not found**: Report and close session
- **Crash loop**: If process exits and restarts repeatedly, report the pattern

## Notes

- Best for processes that produce ongoing output (servers, watchers, log tailers)
- For one-shot commands, use `/terminal:run` instead
- The 40-line snapshot limit applies — only the last 40 lines of output are visible
- Session IDs are ephemeral — if context is compacted, use `/terminal:observe` to rediscover sessions
