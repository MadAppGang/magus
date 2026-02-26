---
name: terminal-interaction
description: ht-mcp and tmux-mcp tool API patterns for interactive terminal access. Use when interacting with TUI applications, running interactive CLI tools, or observing terminal output. Trigger keywords - "terminal", "TUI", "interactive", "ht-mcp", "tmux", "vim", "htop", "session".
version: 1.0.0
tags: [terminal, tui, pty, interactive, ht, tmux]
keywords: [terminal, tui, pty, interactive, session, snapshot, send-keys, vim, htop, lazygit]
plugin: terminal
updated: 2026-02-26
---

# Terminal Interaction Skill

This skill teaches Claude how to use `ht-mcp` and `tmux-mcp` for interactive terminal access: screen reading, keystroke injection, and TUI application navigation.

**Analogy**: `chrome-devtools-mcp` gives Claude eyes and hands in the browser. `ht-mcp` + `tmux-mcp` give Claude eyes and hands in the terminal.

---

## 1. When to Use ht-mcp vs tmux-mcp

| Scenario | Use ht-mcp | Use tmux-mcp |
|----------|-----------|-------------|
| Isolated task terminal (create, use, destroy) | Yes | No |
| Interact with already-running terminal | No | Yes |
| TUI app navigation (vim, htop, lazygit) | Yes | Yes |
| Read scrollback history (>40 lines) | No | Yes |
| Zero external dependencies | Yes | No (requires tmux) |
| Monitor long-running process output | No (40-line limit) | Yes |
| Web preview of terminal | Yes (`enableWebServer`) | No |
| Attach to developer's live session | No | Yes |
| Multi-pane split layouts | No | Yes |

**Decision rule**: Default to ht-mcp for new isolated tasks. Switch to tmux-mcp when you need to observe existing running processes, read historical output, or the user explicitly has a tmux environment running.

---

## 2. Tool Naming Convention

Server keys in `mcp-config.json` are `ht` and `tmux`. This produces tool name prefixes:

- **ht-mcp tools**: `mcp__ht__ht_create_session`, `mcp__ht__ht_send_keys`, etc.
- **tmux-mcp tools**: `mcp__tmux__list-sessions`, `mcp__tmux__capture-pane`, etc.

---

## 3. ht-mcp Complete API (6 Tools)

### `mcp__ht__ht_create_session`
```
Parameters:
  command:         string[]  (optional, default: ["bash"])
  enableWebServer: boolean   (optional, default: false)
Returns: session ID (UUID) + optional web preview URL (http://127.0.0.1:3618-3999)
```

Use `command` to launch a specific program instead of bash:
```
mcp__ht__ht_create_session({ command: ["vim", "myfile.ts"] })
mcp__ht__ht_create_session({ command: ["python3"] })
mcp__ht__ht_create_session({ enableWebServer: true })   // for web preview
```

### `mcp__ht__ht_send_keys`
```
Parameters:
  sessionId: string   (required)
  keys:      string[] (required) — plain text or named keys
Returns: confirmation
```

Keys are an array of strings. Each element is either:
- Plain text: `"hello world"` (typed literally)
- Named key: `"Enter"`, `"Escape"`, `"Tab"`, `"^c"` (see Section 5 for full reference)

```
// Type text then press Enter
mcp__ht__ht_send_keys({ sessionId, keys: ["ls -la", "Enter"] })

// Navigate vim: press Escape then type :wq then Enter
mcp__ht__ht_send_keys({ sessionId, keys: ["Escape"] })
mcp__ht__ht_send_keys({ sessionId, keys: [":wq", "Enter"] })
```

### `mcp__ht__ht_take_snapshot`
```
Parameters:
  sessionId: string (required)
Returns: rendered terminal text — what a human would see (120x40 grid)
```

Returns the **visible screen** as plain text. This is a 120-column by 40-line grid — the equivalent of what a human would see looking at the terminal. **No scrollback.** Only the current viewport.

### `mcp__ht__ht_execute_command`
```
Parameters:
  sessionId: string (required)
  command:   string (required)
Returns: snapshot after command execution
```

Convenience tool: sends the command string as keystrokes + `Enter`, then waits for and returns the resulting snapshot. Use this for simple commands that complete quickly. For TUI applications, use `ht_send_keys` + manual `ht_take_snapshot` instead (TUIs need render time).

```
// Good for simple commands
mcp__ht__ht_execute_command({ sessionId, command: "echo hello" })
mcp__ht__ht_execute_command({ sessionId, command: "ls -la src/" })

// For TUI apps, prefer send_keys + take_snapshot
mcp__ht__ht_send_keys({ sessionId, keys: ["vim myfile.ts", "Enter"] })
// ... wait ...
mcp__ht__ht_take_snapshot({ sessionId })
```

### `mcp__ht__ht_list_sessions`
```
Parameters: none
Returns: list of active session IDs with metadata
```

Use to find existing sessions (e.g., orphaned sessions from a previous task). Always check for orphans at the start of a new workflow.

### `mcp__ht__ht_close_session`
```
Parameters:
  sessionId: string (required)
Returns: confirmation
```

**Always close sessions when done.** Sessions are in-memory and live in the MCP server process. Orphaned sessions waste resources. Sessions do NOT survive context compaction — always save session IDs to variables before any multi-step workflow.

---

## 4. tmux-mcp Complete API (13 Tools)

| Tool (full name) | Parameters | Description |
|------|-----------|-------------|
| `mcp__tmux__list-sessions` | none | List all tmux sessions |
| `mcp__tmux__find-session` | `name` (string) | Find session by name |
| `mcp__tmux__list-windows` | `sessionId` (string) | List windows in session |
| `mcp__tmux__list-panes` | `windowId` (string) | List panes in window |
| `mcp__tmux__capture-pane` | `paneId` (string) | Read screen content of pane (text) |
| `mcp__tmux__execute-command` | `sessionId` (string), `command` (string) | Run command in session |
| `mcp__tmux__send-keys` | `paneId` (string), `keys` (string) | Send keystrokes to pane |
| `mcp__tmux__create-session` | `name` (string, optional) | Create new tmux session |
| `mcp__tmux__create-window` | `sessionId` (string) | Create new window |
| `mcp__tmux__split-pane` | `windowId` (string) | Split pane |
| `mcp__tmux__kill-session` | `sessionId` (string) | Terminate session |
| `mcp__tmux__kill-window` | `windowId` (string) | Close window |
| `mcp__tmux__kill-pane` | `paneId` (string) | Close pane |

tmux-mcp also exposes MCP resources: `tmux://sessions`, `tmux://pane/{paneId}`, `tmux://command/{commandId}/result`.

**Note on `send-keys`**: tmux-mcp `send-keys` takes a `keys` string (not array like ht-mcp). Use tmux key syntax: `C-c` for Ctrl+C, `Enter` for Enter.

---

## 5. Key Name Reference (ht_send_keys)

| Category | Key Names |
|----------|-----------|
| Navigation | `Enter`, `Space`, `Escape`, `Tab`, `Left`, `Right`, `Up`, `Down`, `Home`, `End`, `PageUp`, `PageDown` |
| Function keys | `F1` through `F12` |
| Ctrl (caret notation preferred) | `^c`, `^d`, `^l`, `^z`, `^x`, `^o`, `^w`, `^k`, `^u` |
| Ctrl (C- notation) | `C-c`, `C-d`, `C-l`, `C-z` |
| Shift | `S-F6`, `S-Left`, `S-Right`, `S-Up`, `S-Down` |
| Alt | `A-x`, `A-Home`, `A-End` |
| Combined | `S-A-Up` (Shift+Alt+Up), `C-S-Left` (Ctrl+Shift+Left) |

**Prefer caret notation** (`^c`) over `C-c` for reliability. Use named keys (`Escape`) not escape sequences (`\e`).

---

## 6. Session Lifecycle

The correct pattern for ALL ht-mcp workflows:

```
1. CREATE:  mcp__ht__ht_create_session()               → save sessionId
2. USE:     mcp__ht__ht_execute_command() / ht_send_keys() / ht_take_snapshot()
3. CLEANUP: mcp__ht__ht_close_session(sessionId)       → ALWAYS close
```

**Save the session ID immediately** after creation. If the ID is lost (e.g., context compaction), use `mcp__ht__ht_list_sessions` to find it.

```
// Full lifecycle example
const { sessionId } = await mcp__ht__ht_create_session()
try {
  const result = await mcp__ht__ht_execute_command({ sessionId, command: "npm test" })
  // ... use result ...
} finally {
  await mcp__ht__ht_close_session({ sessionId })  // always runs
}
```

---

## 7. The 40-Line Rule

**Critical limitation**: `ht_take_snapshot` returns ONLY the visible terminal — a 120x40 grid. There is no scrollback.

This means:
- Commands producing more than 40 lines will only show the last 40 visible lines
- TUI apps with more than 40 rows will be truncated

**Workarounds**:

| Problem | Workaround |
|---------|-----------|
| Long command output (e.g., `seq 1 100`) | Pipe through `\| tail -40` or `\| head -40` |
| Query results (psql, mongosh) | Add `LIMIT 40` to the query |
| Log files | Use `tail -f` (shows last N lines) |
| Long directory listings | Use `ls -la \| head -40` |
| Test output | Use `\| tail -40` or check summary lines |
| Need full output | Switch to tmux-mcp (`capture-pane` can read scrollback) |

**Best practice for long output**: Design commands to return <40 lines. Use `| head -40`, `| tail -40`, `LIMIT`, or `-n` flags proactively.

---

## 8. Race Conditions and Timing

**TUI apps need render time**. After sending keys to a TUI application, wait before taking a snapshot. The application needs time to process input and redraw the screen.

```
// WRONG: snapshot immediately after send_keys (may see stale screen)
mcp__ht__ht_send_keys({ sessionId, keys: ["i"] })
mcp__ht__ht_take_snapshot({ sessionId })   // screen may not have updated yet

// RIGHT: use ht_execute_command for commands, or accept slight delay for TUI
// For TUI interactive apps, taking a snapshot is usually fast enough in practice
// but be prepared to take a second snapshot if the first looks stale
```

**For long-running processes** (server startup, build, migration), poll with repeated snapshots:

```
// Polling pattern for server startup
let ready = false
for (let i = 0; i < 30; i++) {
  const snap = await mcp__ht__ht_take_snapshot({ sessionId })
  if (snap.includes("listening on") || snap.includes("ready") || snap.includes("started")) {
    ready = true
    break
  }
  // slight pause between polls (ht_take_snapshot itself takes a moment)
}
```

---

## 9. Workflow Examples

### Example A: Simple Command Execution

```
1. mcp__ht__ht_create_session()                           → sessionId
2. mcp__ht__ht_execute_command(sessionId, "npm test")     → output snapshot
3. Parse snapshot for pass/fail indicators
4. mcp__ht__ht_close_session(sessionId)
```

### Example B: vim File Editing

```
1. mcp__ht__ht_create_session()
2. mcp__ht__ht_execute_command(sessionId, "vim myfile.ts")  → vim opens
3. mcp__ht__ht_send_keys(sessionId, ["i"])                  → insert mode
4. mcp__ht__ht_send_keys(sessionId, ["hello world"])        → type text
5. mcp__ht__ht_send_keys(sessionId, ["Escape"])             → normal mode
6. mcp__ht__ht_send_keys(sessionId, [":wq", "Enter"])       → save and quit
7. mcp__ht__ht_take_snapshot(sessionId)                     → verify shell prompt returned
8. mcp__ht__ht_close_session(sessionId)
```

### Example C: Interactive Application with Monitoring

```
1. mcp__ht__ht_create_session()
2. mcp__ht__ht_execute_command(sessionId, "bun run dev")    → start server
3. POLL: mcp__ht__ht_take_snapshot until "listening on port"
4. Report: "Server ready on port 3000. Session: {id}"
5. // Leave session running; close when user is done
6. mcp__ht__ht_close_session(sessionId)
```

### Example D: Read Existing tmux Session

```
1. mcp__tmux__list-sessions()                              → find "dev" session
2. mcp__tmux__list-windows({ sessionId: "dev" })          → list windows
3. mcp__tmux__list-panes({ windowId: "dev:0" })           → list panes
4. mcp__tmux__capture-pane({ paneId: "dev:0.0" })         → read terminal content
5. Analyze output, report findings
// Do NOT kill user's session — only observe
```

### Example E: Database REPL Query

```
1. mcp__ht__ht_create_session()
2. mcp__ht__ht_execute_command(sessionId, "psql $DATABASE_URL")
3. POLL snapshot for "=#" or "=#" prompt pattern (psql ready)
4. mcp__ht__ht_send_keys(sessionId, ["SELECT count(*) FROM users LIMIT 1;", "Enter"])
5. mcp__ht__ht_take_snapshot(sessionId)                    → see results
6. mcp__ht__ht_send_keys(sessionId, ["\\q", "Enter"])      → graceful exit
7. mcp__ht__ht_close_session(sessionId)
```

---

## 10. Error Handling Patterns

### Session Not Found
```
// If sessionId is lost or stale
const sessions = await mcp__ht__ht_list_sessions()
// Pick matching session or create new one
```

### Command Hangs (No Prompt Return)
```
// Detect: snapshot still shows running command, no shell prompt returned
// Recovery: send Ctrl+C
mcp__ht__ht_send_keys({ sessionId, keys: ["^c"] })
mcp__ht__ht_take_snapshot({ sessionId })   // verify prompt returned
```

### Port Already in Use
```
// Detect: snapshot contains "EADDRINUSE" or "address already in use"
// Recovery options:
// 1. Find and kill the occupying process: lsof -ti:3000 | xargs kill
// 2. Try a different port
// 3. Report to user for manual resolution
```

### TUI App Stuck
```
// Detection: snapshot unchanged after multiple polls
// Recovery sequence:
mcp__ht__ht_send_keys({ sessionId, keys: ["^c"] })    // try interrupt first
// If still stuck:
mcp__ht__ht_send_keys({ sessionId, keys: ["q"] })      // try quit command
// If still stuck:
mcp__ht__ht_close_session({ sessionId })               // force close session
```

### Long-Running Process (SSH, Migration, Deploy)
```
// For database migrations: ALWAYS confirm with user before proceeding
// For SSH: detect password prompts → stop and report (never pass passwords)
// For deployments: poll for completion markers, set max poll count (e.g., 60 iterations)
```

---

## 11. Safety Guidelines

1. **Never store credentials**: Do not send passwords or API keys through `ht_send_keys`. Detect password prompts and stop.
2. **Confirm destructive operations**: Database migrations, `DROP TABLE`, production deployments — always confirm with user.
3. **Never kill user's tmux sessions**: When using tmux-mcp to observe existing sessions, use `capture-pane` only. Do NOT call `kill-session` on sessions you did not create.
4. **Memory limits**: Close sessions after use. Long-running sessions with heavy output can grow in memory (ht-mcp known issue #39).
5. **Session IDs are ephemeral**: Save session IDs to variables immediately. They do not survive context compaction.

---

## 12. Multi-Session Pattern (Parallel Tasks)

Run multiple sessions concurrently for parallel work:

```
// Launch unit tests and integration tests in parallel
const [session1, session2] = await Promise.all([
  mcp__ht__ht_create_session(),
  mcp__ht__ht_create_session()
])

// Start both in parallel
await Promise.all([
  mcp__ht__ht_execute_command({ sessionId: session1.sessionId, command: "bun test src/" }),
  mcp__ht__ht_execute_command({ sessionId: session2.sessionId, command: "bun test tests/" })
])

// Read results
const [snap1, snap2] = await Promise.all([
  mcp__ht__ht_take_snapshot({ sessionId: session1.sessionId }),
  mcp__ht__ht_take_snapshot({ sessionId: session2.sessionId })
])

// Cleanup both
await Promise.all([
  mcp__ht__ht_close_session({ sessionId: session1.sessionId }),
  mcp__ht__ht_close_session({ sessionId: session2.sessionId })
])
```
