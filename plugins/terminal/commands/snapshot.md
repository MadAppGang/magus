---
name: snapshot
description: Take a snapshot of a terminal pane to see its current screen content.
allowed-tools: mcp__tmux__capture-pane, mcp__tmux__list-sessions, mcp__tmux__list-panes
---

# /terminal:snapshot

> **Advanced command** — For most tasks, use `/terminal:observe` instead. It lists sessions and takes snapshots automatically. Use this command only when you need raw pane capture access.

Read the current screen content of an active tmux pane.

## Usage

```
/terminal:snapshot
/terminal:snapshot {paneId}
```

Pane IDs use the format `%N` (e.g., `%3`) or `headless:%N` (e.g., `headless:%0`).

## What It Does

Takes a `capture-pane` of an active tmux pane and returns the current content as text — exactly what a human would see looking at that terminal.

All sessions are tmux panes. `capture-pane` returns pane content with optional scrollback via the `lines` parameter.

## How to Use

### Snapshot a specific pane

If you know the pane ID:

```
/terminal:snapshot %3
/terminal:snapshot headless:%0
```

### Snapshot with scrollback

To get more than the visible viewport:

```
mcp__tmux__capture-pane({ paneId: "%3", lines: 200 })
```

Returns the last 200 lines of scrollback history plus the current viewport.

### Snapshot without a known ID (list first)

If you don't know the pane ID, the command will list available sessions first:

```
/terminal:snapshot
```

This will:
1. Call `mcp__tmux__list-sessions` to show all tmux sessions
2. Call `mcp__tmux__list-panes` to enumerate panes
3. Capture the most relevant pane

## Examples

**See what's running in a server pane**:
After starting a dev server with `/terminal:watch`, use `/terminal:snapshot %3` to check current log output.

**Debug a TUI application**:
If you started vim, htop, or lazygit in a headless session, use snapshot to see the current screen state.

**Monitor test results**:
While a test watcher is running, snapshot the pane periodically to see updated results.

## Notes

- `capture-pane` has access to tmux scrollback history — use `lines: N` to read more than the visible viewport.
- For output longer than the visible pane, use `lines: 200` or pipe command output to a temp file and `Read` it.
- For persistent monitoring that waits for changes, use `/terminal:observe {paneId} --watch` instead.
