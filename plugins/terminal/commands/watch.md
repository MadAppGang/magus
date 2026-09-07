---
name: watch
description: Starts a long-running process in a numbered slot, waits for readiness or failure, and reports the slot to check on later. Use for dev servers, test watchers, log tailing, and builds.
allowed-tools: mcp__plugin_terminal_mux__start-and-watch, mcp__plugin_terminal_mux__watch-pane, mcp__plugin_terminal_mux__capture-pane, mcp__plugin_terminal_mux__pane-state, mcp__plugin_terminal_mux__close-pane, mcp__plugin_terminal_mux__list-slots
---

# /terminal:watch

Starts a long-running process, blocks until it is ready or fails, and reports which slot it runs in. The slot stays open for later observation.

## Usage

```
/terminal:watch {command}
/terminal:watch {command} --isolated
```

## Examples

```
/terminal:watch "bun run dev"
/terminal:watch "npm test -- --watch"
/terminal:watch "docker-compose up"
/terminal:watch "go run ./cmd/server" --isolated
```

## Slot Choice

- **Default: slot 1**, the visible helper pane beside the user. They can see the server log as it scrolls.
- **`--isolated`: slot 2 or higher with `isolated: true`**, a pane the user does not see. Call `mcp__plugin_terminal_mux__list-slots` first when you may already hold slots (after context compaction) and pick a number not in the array.

Report the result as **"running in slot N"** and remind the user to remember the slot number: `/terminal:observe N` and `/terminal:slots close N` address it later.

## What It Does

One blocking call starts the process and waits for a readiness signal; no polling loop.

```
mcp__plugin_terminal_mux__start-and-watch({
  slot: 1,
  command: "<user_command>",
  pattern: "<readiness_regex>",
  triggers: "exit,error",
  mode: "quick",
  timeout: 60
}) → { slot: 1, created: true, event, detail, elapsed, output, paneState }
```

With `--isolated`, add `isolated: true` and use slot 2 or higher. `created: false` means the slot already existed and the command ran in it.

### Pattern Selection by Command Type

| Command type | Pattern |
|-------------|---------|
| Bun/Node dev server | `"Local:.*http\|listening on\|ready in"` |
| Go server | `"listening on\|started on\|server running"` |
| Test watcher (Vitest/Jest) | `"press a to rerun\|Waiting for file changes"` |
| Bun test watcher | `"watch mode\|watching"` |
| docker-compose up | `"healthy\|started"` |
| Log tail | any line, then `watch-pane({ slot, triggers: "idle:5" })` |

### Reading the Result

| `event` | Meaning | Next action |
|---------|---------|-------------|
| `"pattern:…"` | Readiness pattern matched | Report "running in slot N" |
| `"error"` | Error output detected | Report the error with `output` |
| `"exit"` | Process exited | Check `paneState.isAlive`; report exit |
| `"timeout"` | No signal within `timeout` | Report "still starting in slot N" |

## Error Handling

- **Port conflict**: `EADDRINUSE` in `output` — report the conflict and suggest alternatives.
- **Command not found**: arrives as `"error"` — report, then `mcp__plugin_terminal_mux__close-pane({ slot: N })`.
- **Process hangs**: on `"timeout"`, `mcp__plugin_terminal_mux__pane-state({ slot: N })` shows whether it is alive or waiting for input.

## Notes

- Unlike `/terminal:run`, the slot is not closed on success; `/terminal:slots close N` closes it.
- `/terminal:observe N` captures the slot later; `/terminal:slots` lists every slot you hold. One-shot commands: `/terminal:run`.
