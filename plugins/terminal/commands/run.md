---
name: run
description: Runs a command in an isolated terminal pane, returns its output and exit code, and closes the pane. Use instead of Bash when the command needs a TTY, answers interactive prompts, or renders screen output.
allowed-tools: mcp__plugin_terminal_mux__execute-command, mcp__plugin_terminal_mux__start-and-watch, mcp__plugin_terminal_mux__capture-pane, mcp__plugin_terminal_mux__pane-state, mcp__plugin_terminal_mux__close-pane, mcp__plugin_terminal_mux__send-keys
---

# /terminal:run

Runs one command in an isolated pane the user never sees, returns the output and exit code, and leaves nothing open. This is the default terminal command for one-shot work.

## Usage

```
/terminal:run {command}
```

## Examples

```
/terminal:run npm test
/terminal:run go test ./... -v
/terminal:run "curl -s https://api.example.com/health | jq"
```

## When to Use /terminal:run vs Bash

| Scenario | Use |
|----------|-----|
| Simple non-interactive command | Bash tool |
| Command with colored or formatted output | `/terminal:run` |
| Command with interactive prompts | `/terminal:run` |
| TUI-rendered output (progress bars, tables) | `/terminal:run` |
| Long-running continuous process | `/terminal:watch` instead |
| Multi-step REPL session | `/terminal:repl` instead |

## Behavior

### One-shot commands (the default path)

```
mcp__plugin_terminal_mux__execute-command({ command: "<user_command>", isolated: true })
→ { output, exitCode, timedOut }
```

With `isolated: true` and no `slot`, the pane is ephemeral: it opens, runs the command, and closes on its own. No slot number is held, so nothing needs cleaning up. Pass `timeoutSeconds` for commands that run longer than the default.

### Commands that need streaming status

When the output should be watched as it arrives (a build with progress stages, a script that may hang), open an isolated slot and close it afterwards:

```
mcp__plugin_terminal_mux__start-and-watch({
  slot: 2, isolated: true,
  command: "<user_command>",
  pattern: "\\$ $",
  triggers: "exit,error",
  timeout: 120
}) → { slot: 2, created: true, event, detail, elapsed, output, paneState }

mcp__plugin_terminal_mux__close-pane({ slot: 2 }) → [{ "slot": 2, "action": "killed" }]
```

`event` distinguishes success (`pattern:…`, `exit`) from `error` and `timeout`; `output` holds the transcript. Always close the slot, on every outcome.

## Error Handling

- Command appears hung: `mcp__plugin_terminal_mux__pane-state({ slot: 2 })` reports `waitingForInput`. If it is waiting on a password prompt, stop and tell the user.
- `event == "timeout"`: report the partial output, then `close-pane({ slot: 2 })`.
- Stuck process: `mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "C-c", literal: false })`, then close the slot.

## Notes

- Slot 1 is the visible helper pane beside the user; this command never uses it.
- Long-running processes: `/terminal:watch`. REPL sessions: `/terminal:repl`. TUI apps: `/terminal:tui`.
