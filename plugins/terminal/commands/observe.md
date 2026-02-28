---
name: observe
description: Observe running terminal sessions without modifying them. List active sessions, take snapshots, check on dev servers or test watchers started earlier.
allowed-tools: mcp__ht__ht_take_snapshot, mcp__ht__ht_list_sessions, mcp__tmux__capture-pane, mcp__tmux__list-sessions, mcp__tmux__list-windows, mcp__tmux__list-panes
---

# /terminal:observe

Read-only observation of running terminal sessions. List what's active, take snapshots, and check on processes without modifying anything.

## Usage

```
/terminal:observe
/terminal:observe {sessionId}
/terminal:observe tmux:{paneId}
```

## What It Does

- **No arguments**: Lists all active ht-mcp sessions AND tmux sessions/panes, then takes a snapshot of the first available session
- **With session ID**: Takes a snapshot of the specified ht-mcp session
- **With tmux pane**: Captures the specified tmux pane content

This is strictly **read-only** — it never sends keystrokes, kills sessions, or modifies state.

## Examples

**Check what's running**:
```
/terminal:observe
```
Lists all active sessions with their IDs and shows a snapshot of the most recent one.

**Check on a dev server started earlier**:
```
/terminal:observe abc-1234-uuid
```
Takes a snapshot to see current server output.

**Read a developer's tmux pane**:
```
/terminal:observe tmux:dev:0.0
```
Captures the content of the `dev` session, window 0, pane 0.

## Workflow: Check on a /terminal:watch Process

After starting a process with `/terminal:watch`, use `/terminal:observe` later to check its status:

```
1. /terminal:watch "bun run dev"     → Reports session ID: abc-1234
2. ... work on other things ...
3. /terminal:observe abc-1234         → Shows current server output
```

## Read Existing tmux Environment

To read the developer's running terminals:

```
1. /terminal:observe                  → Lists all tmux sessions
2. /terminal:observe tmux:dev:0.0     → Reads specific pane
```

**Safety**: Never kill or modify the developer's tmux sessions. This command is observe-only.

## Implementation

1. If no argument: call `mcp__ht__ht_list_sessions` AND `mcp__tmux__list-sessions`
2. If ht-mcp session ID: call `mcp__ht__ht_take_snapshot` with that ID
3. If tmux pane ID: call `mcp__tmux__capture-pane` with that pane ID
4. If tmux session ID without pane: call `mcp__tmux__list-windows` then `mcp__tmux__list-panes` to enumerate, then capture the active pane

## Notes

- Snapshots are 120x40 for ht-mcp (no scrollback)
- tmux `capture-pane` may include more history depending on tmux settings
- Use this to rediscover session IDs lost to context compaction
- This command never modifies any session — it only reads
