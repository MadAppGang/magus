---
name: observe
description: Reads a slot without modifying it. Lists the slots you hold, captures a slot's recent output, or blocks until it exits, errors, or goes idle. Use to check on a dev server or test watcher started earlier.
allowed-tools: mcp__plugin_terminal_mux__capture-pane, mcp__plugin_terminal_mux__watch-pane, mcp__plugin_terminal_mux__pane-state, mcp__plugin_terminal_mux__list-slots
---

# /terminal:observe

Read-only observation of the slots this session holds. Lists what is open, captures a slot's content, and checks on processes without sending anything.

## Usage

```
/terminal:observe
/terminal:observe {slot}
/terminal:observe {slot} --watch
```

## What It Does

- **No arguments**: `mcp__plugin_terminal_mux__list-slots` shows every slot, then `capture-pane` reads slot 1.
- **With a slot number**: captures that slot's last 50 lines.
- **With `--watch`**: blocks in `watch-pane` until the process exits, prints an error, or goes idle for 30 seconds.

This command never sends keystrokes or closes a slot. It can only read slots this session opened; a slot that was never opened is an error, not a new pane.

## Examples

**See what is running**:
```
/terminal:observe
→ [{ "slot": 1, "isolated": false, "origin": "created", "foregroundCmd": "node", "isAlive": true }]
```

**Check on a dev server started with `/terminal:watch`**:
```
/terminal:observe 1
```

**Wait for a test watcher in an isolated slot to settle**:
```
/terminal:observe 2 --watch
```

## Workflow: Check on a /terminal:watch Process

```
1. /terminal:watch "bun run dev"     → running in slot 1
2. ... work on other things ...
3. /terminal:observe 1               → current server output
```

Lost the slot number to context compaction? `/terminal:observe` with no argument lists them again.

## Implementation

1. No argument: `mcp__plugin_terminal_mux__list-slots()`, then `mcp__plugin_terminal_mux__capture-pane({ slot: 1, lines: 50 })`.
2. Slot given: `mcp__plugin_terminal_mux__capture-pane({ slot, lines: 50 })`.
3. `--watch`: `mcp__plugin_terminal_mux__watch-pane({ slot, triggers: "exit,error,idle:30", timeout: 120 })`.
4. To check process state: `mcp__plugin_terminal_mux__pane-state({ slot })` returns `{ slot, panePid, foregroundPid, foregroundCmd, isAlive, waitingForInput }`.

## Notes

- `lines: 200` reads further back into scrollback.
- `pane-state` says whether a process is blocked, waiting for input, or dead without reading the screen.
- A pane the user is working in is not a slot and cannot be read. Run the process in a slot, or read its log file.
