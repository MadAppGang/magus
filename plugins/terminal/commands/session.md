---
name: session
description: Manage terminal sessions -- create, list, or close tmux and headless sessions.
allowed-tools: mcp__tmux__create-session, mcp__tmux__create-headless, mcp__tmux__list-sessions, mcp__tmux__kill-session, mcp__tmux__kill-headless-server, mcp__tmux__rename-session
---

# /terminal:session

> **Advanced command** — For most tasks, use `/terminal:run`, `/terminal:watch`, or `/terminal:repl` instead. They handle session lifecycle automatically. Use this command only when you need manual control over sessions.

Create, list, and manage terminal sessions using tmux-mcp.

## Usage

```
/terminal:session list
/terminal:session tmux list
/terminal:session tmux create {name}
/terminal:session headless create
/terminal:session headless close {paneId}
/terminal:session headless close-all
```

## Subcommands

### list — Show all active sessions

```
/terminal:session list
```

Lists all active tmux sessions (both regular and headless) with their pane IDs and metadata.

Use this to:
- Find a pane ID when you've forgotten it
- Check for orphaned headless sessions to clean up
- Verify a session was closed successfully

### tmux list — List tmux sessions

```
/terminal:session tmux list
```

Lists all active tmux sessions with their windows and panes. This shows the developer's existing tmux environment — do not kill these sessions.

### tmux create — Create a tmux session

```
/terminal:session tmux create myproject
```

Creates a new named tmux session. tmux sessions are visible to the user and can be attached to from their terminal.

### headless create — Create a headless session

```
/terminal:session headless create
```

Creates an isolated headless session for running a command invisibly.

```
mcp__tmux__create-headless({ name: "my-task" }) → { paneId: "headless:%0" }
```

### headless close — Close a headless session

```
/terminal:session headless close headless:%0
```

Kills a specific headless session and releases its resources.

```
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

Always close sessions when you are done with them.

### headless close-all — Close all headless sessions

```
/terminal:session headless close-all
```

Terminates all headless sessions at once.

```
mcp__tmux__kill-headless-server()
```

Useful for bulk cleanup after a long workflow.

## Session Lifecycle

### Headless sessions

- Invisible to the user's `tmux ls` (use `mcp__tmux__list-sessions` to see them)
- Persist until explicitly killed or `kill-headless-server` is called
- IDs are prefixed with `headless:` — use this prefix in all subsequent tool calls
- Not affected by Claude context compaction (they live in the tmux socket, not memory)
- Auto-destroyed when using `mcp__tmux__execute-command` with `headless: true`

### Regular tmux sessions

- Visible to the user; can be attached to from their terminal
- Persist until explicitly killed or the system reboots
- Never kill the developer's existing tmux sessions

## Examples

**Check what sessions are running**:
```
/terminal:session list
```

**Create an isolated session for a task**:
```
/terminal:session headless create
→ { paneId: "headless:%0" }
```

**Clean up a specific headless session**:
```
/terminal:session headless close headless:%0
```

**Clean up all headless sessions after a workflow**:
```
/terminal:session headless close-all
```

**See the developer's tmux environment**:
```
/terminal:session tmux list
```
Then use `/terminal:snapshot` with the pane ID to read any pane's content.

## Notes

- Pane IDs use the format `%N` for tmux panes, `headless:%N` for headless sessions
- For interactive multi-step workflows, prefer delegating to the `terminal:tui-navigator` agent
- Headless sessions created by `/terminal:run` and `/terminal:repl` are managed automatically
