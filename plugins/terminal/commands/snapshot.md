---
name: snapshot
description: Take a snapshot of a terminal session to see its current screen content.
allowed-tools: mcp__ht__ht_take_snapshot, mcp__ht__ht_list_sessions, mcp__tmux__capture-pane, mcp__tmux__list-sessions, mcp__tmux__list-panes
---

# /terminal:snapshot

Read the current visible screen content of an active terminal session.

## Usage

```
/terminal:snapshot
/terminal:snapshot {sessionId}
```

## What It Does

Takes a snapshot of an active terminal session and returns the current screen state as text — exactly what a human would see looking at that terminal window.

- For **ht-mcp sessions**: Returns a 120x40 grid snapshot of the headless terminal
- For **tmux panes**: Captures the current pane content from any running tmux session

## How to Use

### Snapshot a specific ht-mcp session

If you know the session ID:

```
/terminal:snapshot abc-1234-uuid
```

### Snapshot without an ID (list first)

If you don't know the session ID, the command will list available sessions first:

```
/terminal:snapshot
```

This will:
1. Call `mcp__ht__ht_list_sessions` to show all active ht-mcp sessions
2. Call `mcp__tmux__list-sessions` to show all tmux sessions
3. Let you pick which session to snapshot

### Snapshot a tmux pane

To read from an existing tmux session:

```
/terminal:snapshot tmux:dev:0.0
```

This identifies a tmux pane using `session:window.pane` notation.

## Examples

**See what's running in a server session**:
After starting a dev server with `/terminal:session`, use `/terminal:snapshot {id}` to check current log output.

**Debug a TUI application**:
If you started vim, htop, or lazygit in a session, use snapshot to see the current screen state.

**Monitor test results**:
While a test watcher is running, snapshot the session periodically to see updated results.

## Notes

- ht-mcp snapshots are **120 columns wide by 40 lines tall** — the fixed terminal size. No scrollback history is available.
- tmux `capture-pane` may include more history depending on tmux scrollback buffer settings.
- If the terminal is in the middle of a long command, the snapshot shows only what currently fits on screen.
- For output longer than 40 lines, consider using tmux-mcp which has access to scrollback.
