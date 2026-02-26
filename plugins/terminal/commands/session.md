---
name: session
description: Manage terminal sessions -- create, list, or close ht-mcp sessions; list or create tmux sessions.
allowed-tools: mcp__ht__ht_create_session, mcp__ht__ht_list_sessions, mcp__ht__ht_close_session, mcp__tmux__create-session, mcp__tmux__list-sessions, mcp__tmux__kill-session
---

# /terminal:session

Create, list, and manage terminal sessions using ht-mcp and tmux-mcp.

## Usage

```
/terminal:session list
/terminal:session create
/terminal:session create {command}
/terminal:session close {sessionId}
/terminal:session tmux list
/terminal:session tmux create {name}
```

## Subcommands

### list — Show all active sessions

```
/terminal:session list
```

Lists all active ht-mcp sessions with their IDs and any available metadata. Also shows active tmux sessions if tmux is running.

Use this to:
- Find a session ID when you've forgotten it
- Check for orphaned sessions to clean up
- Verify a session was closed successfully

### create — Create a new ht-mcp session

```
/terminal:session create
```

Creates a new isolated terminal session running bash. Returns the session ID which you can use with `/terminal:send` and `/terminal:snapshot`.

**Create a session running a specific program**:
```
/terminal:session create vim
/terminal:session create python3
/terminal:session create "bun run dev"
```

**Create with web preview** (useful for visual terminal debugging):
```
/terminal:session create --web
```

After creation, a snapshot of the initial screen is shown to confirm the session is ready.

### close — Close an ht-mcp session

```
/terminal:session close abc-1234-uuid
```

Closes a specific session and releases its resources. Always close sessions when you are done with them.

**Close all orphaned sessions**:
```
/terminal:session close all
```

This lists all sessions and closes them one by one — useful for cleaning up after a workflow.

### tmux list — List tmux sessions

```
/terminal:session tmux list
```

Lists all active tmux sessions with their windows and panes. This shows the developer's existing tmux environment — do not kill these sessions.

### tmux create — Create a tmux session

```
/terminal:session tmux create myproject
```

Creates a new named tmux session. Unlike ht-mcp sessions, tmux sessions persist and can be attached to from the terminal.

## Examples

**Start a TDD watch loop**:
```
/terminal:session create "bun test --watch"
```
Then use `/terminal:snapshot {id}` periodically to check test results.

**Open a database REPL**:
```
/terminal:session create "psql $DATABASE_URL"
```
Then use `/terminal:send` for queries and `/terminal:snapshot` to read results.

**Check what sessions are running**:
```
/terminal:session list
```

**Clean up after a workflow**:
```
/terminal:session close abc-1234-uuid
```

**See what's in the developer's tmux environment**:
```
/terminal:session tmux list
```
Then use `/terminal:snapshot` with the pane ID to read any pane's content.

## Session Lifecycle

ht-mcp sessions are **ephemeral**:
- They live only in the MCP server process memory
- They do NOT survive MCP server restarts or context compaction
- Always save the session ID to a variable immediately after creation
- Always close sessions when done (they do not auto-expire)

tmux sessions are **persistent**:
- They persist until explicitly killed or the system reboots
- They can be attached to from any terminal
- Never kill the developer's existing tmux sessions

## Notes

- Session IDs are UUIDs like `3b9a1f2e-...` for ht-mcp sessions
- tmux pane IDs use the format `session:window.pane` (e.g., `dev:0.0`)
- For interactive multi-step workflows, prefer delegating to the `terminal:tui-navigator` agent
- The 40-line snapshot limit applies to all ht-mcp sessions (120x40 fixed terminal size)
