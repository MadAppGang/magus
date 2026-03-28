---
name: observe
description: Observe running terminal sessions without modifying them. List active sessions, capture pane content, check on dev servers or test watchers started earlier.
allowed-tools: mcp__tmux__capture-pane, mcp__tmux__watch-pane, mcp__tmux__pane-state, mcp__tmux__list-sessions, mcp__tmux__list-windows, mcp__tmux__list-panes
---

# /terminal:observe

Read-only observation of running terminal sessions. List what's active, capture pane content, and check on processes without modifying anything.

## Usage

```
/terminal:observe
/terminal:observe {paneId}
/terminal:observe {paneId} --watch
```

Pane IDs use the format `%N` (e.g., `%3`) or `headless:%N` (e.g., `headless:%0`).

## What It Does

- **No arguments**: Lists all tmux sessions/panes, captures the most active pane
- **With pane ID** (`%N` or `headless:%N`): Captures the specified pane content
- **With --watch flag**: Uses `watch-pane` to monitor until a change event fires

This is strictly **read-only** — it never sends keystrokes, kills sessions, or modifies state.

## Examples

**Check what's running**:
```
/terminal:observe
```
Lists all active sessions and shows a snapshot of the most recent pane.

**Check on a dev server started earlier**:
```
/terminal:observe %3
```
Captures the pane to see current server output.

**Read a developer's tmux pane**:
```
/terminal:observe %5
```
Captures the content of a specific pane in the developer's tmux environment.

**Monitor a pane until something changes**:
```
/terminal:observe %3 --watch
```
Blocks via `watch-pane` until an error, exit, or 30s of idle activity.

## Workflow: Check on a /terminal:watch Process

After starting a process with `/terminal:watch`, use `/terminal:observe` later to check its status:

```
1. /terminal:watch "bun run dev"     → Reports ready; paneId: %3
2. ... work on other things ...
3. /terminal:observe %3              → Shows current server output
```

## Read Existing tmux Environment

To read the developer's running terminals:

```
1. /terminal:observe              → Lists all tmux sessions and panes
2. /terminal:observe %5           → Reads specific pane by ID
```

**Safety**: Never kill or modify the developer's tmux sessions. This command is observe-only.

## Implementation

1. If no argument: call `list-sessions`, `list-windows`, `list-panes`; capture the active pane
2. If pane ID: call `capture-pane({ paneId, lines: 50 })` with that pane ID
3. If `--watch`: call `watch-pane({ paneId, triggers: "exit,error,idle:30", timeout: 120 })`
4. To check process state: call `pane-state({ paneId })` — returns OS-level process info

## Notes

- `capture-pane` supports scrollback via the `lines` parameter (e.g., `lines: 200` for 200 lines of history)
- Use `pane-state` to check whether a process is blocked, waiting for input, or dead — no screen scraping needed
- Use this to rediscover pane IDs lost to context compaction
- This command never modifies any session — it only reads
