---
name: terminal-interaction
description: ht-mcp and tmux-mcp tool API patterns for interactive terminal access. Use when running commands interactively, starting dev servers, watching test output, querying databases, navigating TUI apps, splitting panes to show apps side-by-side, or observing terminal output. Trigger keywords - "run tests", "watch mode", "dev server", "database query", "terminal", "TUI", "interactive", "REPL", "split", "side", "panel", "alongside", "beside".
version: 2.0.0
tags: [terminal, tui, pty, interactive, ht, tmux, testing-workflow, dev-server, database, monitoring, repl]
keywords: [terminal, tui, pty, interactive, session, snapshot, send-keys, vim, htop, lazygit, run tests, watch mode, test watcher, dev server, start server, database query, psql, redis, mongo, mongosh, docker logs, tail logs, process monitor, bun test, npm run dev, go test, REPL, interactive shell, run command, execute script, long-running process, split, side, panel, alongside, beside, side by side, split pane, side panel, open on a side, show beside]
plugin: terminal
updated: 2026-02-28
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

**Decision rule**: First check `$TMUX_PANE` — if set, you are already inside tmux and should use tmux-mcp for any pane operations (split, capture, send-keys). Only fall back to ht-mcp when you are NOT in tmux or need a fully isolated throwaway session.

---

## 1b. Current Pane Detection (CRITICAL — Do This First)

**Before splitting or creating anything**, find your actual current pane by querying tmux directly:

```bash
tmux display-message -p '#{pane_id}'
```

This returns the pane ID (e.g., `%57`) where the Bash tool is actually running. This is the only reliable method.

### Why other detection methods fail

| Method | Reliability | Problem |
|--------|-------------|---------|
| `tmux display-message -p '#{pane_id}'` | **Always correct** | None — queries live tmux state |
| `$TMUX_PANE` env var | Usually correct | Subagents may inherit stale environment |
| `list-windows` active flag | **Unreliable — NEVER use** | "active" means most recently selected window in the session, NOT the one the user is looking at. With multiple clients attached, this points to the wrong window. |

A real failure: the agent listed sessions, saw window @30 marked `active: true`, split a pane there — but the user was in window @50. The `active` flag is per-session, not per-client. `display-message` resolves from the Bash tool's actual terminal context, which is always correct.

**If `display-message` returns a pane ID**: You're in tmux. Use it directly for splits.
**If it fails (not in tmux)**: Use ht-mcp for isolated tasks, or `create-session` for a new tmux session.

### Helper Pane Reuse (check BEFORE splitting)

Before creating a new split pane, check if a helper pane already exists from a previous split. Panes we create are labeled `claude-helper` so they can be identified:

```bash
# Check for existing helper panes in the current window
tmux list-panes -F '#{pane_id} #{pane_title}' | grep claude-helper
```

- **If a helper pane exists**: Reuse it. Send the new command there instead of splitting again.
- **If it doesn't exist** (user closed it, or first time): Create a new split and label it.

### Split Ordering Strategy

When creating helper panes, follow this layout progression to keep the workspace organized:

```
Step 1 — First helper pane (split current pane with vertical divider → helper on RIGHT):
┌─────────────┬─────────────┐
│             │   helper-1  │
│    user     │  (RIGHT)    │
│             │             │
└─────────────┴─────────────┘
direction: "horizontal" on user's pane

Step 2 — Second helper (split RIGHT pane with horizontal divider → stacked right):
┌─────────────┬─────────────┐
│             │   helper-1  │
│    user     ├─────────────┤
│             │   helper-2  │
└─────────────┴─────────────┘
direction: "vertical" on helper-1's pane

Step 3 — Third helper (split LEFT pane with horizontal divider → stacked left):
┌─────────────┬─────────────┐
│    user     │   helper-1  │
├─────────────┼─────────────┤
│   helper-3  │   helper-2  │
└─────────────┴─────────────┘
direction: "vertical" on user's pane
```

The first split is always `direction: "horizontal"` (vertical divider, helper on right). Subsequent splits use `direction: "vertical"` (horizontal divider) to subdivide.

### Layout Presets and Pane Labels

After creating panes, apply a built-in tmux layout preset and label each pane for visibility:

```bash
# Apply a built-in layout preset (requires Bash tool — not yet in tmux-mcp)
Bash: tmux select-layout -t {window_id} main-vertical

# Enable visible pane borders with title bar (1 line per pane)
Bash: tmux set-option -t {window_id} pane-border-status top

# Label each pane
Bash: tmux select-pane -t {pane_id}  -T "Dev Server"
Bash: tmux select-pane -t {pane_id2} -T "Test Watcher"
Bash: tmux select-pane -t {pane_id3} -T "App Logs"
```

**Layout presets**:

| Preset | Best for |
|--------|----------|
| `even-horizontal` | 2–3 side-by-side panes of equal width |
| `even-vertical` | Log monitoring stacks (panes top-to-bottom) |
| `main-horizontal` | Editor on top, shell(s) below |
| `main-vertical` | Editor on left, side panels on right |
| `tiled` | 4-pane dashboards (2×2 grid) |

**Save and restore layout**: `tmux display-message -p '#{window_layout}'` returns the current layout string; pass that string back to `select-layout` to restore it.

**Caveat**: Enabling `pane-border-status` adds 1 line per pane and may conflict with Catppuccin or other tmux theme plugins. Check `tmux show-options -g pane-border-status` first; if it is already set, leave it alone. Ask the user before enabling if they have a custom tmux theme.

### Quick example: User says "split this window" or "run X beside me"

```
1. Bash: tmux display-message -p '#{pane_id}'                       → "%57"
2. Bash: tmux list-panes -F '#{pane_id} #{pane_title}' | grep claude-helper
   → If found "%66 claude-helper": reuse %66, skip to step 5
3. mcp__tmux__split-pane({ paneId: "%57", direction: "horizontal" }) → new pane "%66"
4. Bash: tmux select-pane -t %66 -T "claude-helper"                 → label it
5. mcp__tmux__send-keys({ paneId: "%66", keys: "bun test --watch\nEnter" })
```

**Never call `list-sessions`/`list-windows`/`list-panes` just to find your own pane.** Detection + reuse check + split is 2-4 Bash calls at most.

**Common mistake**: Creating a new tmux session (`create-session`) when the user says "here" or "in this window." If you're in tmux, always split — never create a detached session.

---

## 2. Tool Naming Convention

Server keys in `.mcp.json` are `ht` and `tmux`. This produces tool name prefixes:

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
| `mcp__tmux__split-pane` | `paneId` (string, required), `direction` (optional: "horizontal"/"vertical"), `size` (optional: 1-99%) | Split pane |
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

## 7b. Capturing Full Output with tee

When output exceeds 40 lines (large test suites, build output, migration logs), pipe through `tee` to a temp file so the full output is available via the Read tool:

```
1. mcp__ht__ht_execute_command(sessionId, 'npm test 2>&1 | tee /tmp/claude-terminal-1711930000.log')
2. # Poll ht_take_snapshot until summary line appears in last 40 visible lines
3. Read('/tmp/claude-terminal-1711930000.log')   # full output, unlimited lines
4. mcp__ht__ht_execute_command(sessionId, 'rm /tmp/claude-terminal-1711930000.log')
```

**Naming convention**: `/tmp/claude-terminal-$(date +%s).log` — avoids conflicts when running multiple terminal tasks in parallel.

**The snapshot poll is still required**: It tells you WHEN the command finishes. Poll for framework-specific completion markers (see `terminal:framework-signals`). The log file is available immediately and persists across context compaction.

**When required**:
- Test suites with >40 cases where individual failures scroll off
- Build output with warnings spanning many lines
- Deploy logs or migration output
- Any command where you need to search the full history, not just the tail

---

## 7c. Output Parsing Rules

Both `ht_take_snapshot` and `tmux capture-pane` return **plain text** — ANSI escape codes are stripped by the terminal emulator before Claude sees them. Color is never available.

```
CORRECT: look for ✓ / ✗ / PASS / FAIL / error: / warning: / ⠋ (spinner active)
WRONG:   "is this line red?" — ANSI color is stripped; color state is unavailable
```

**Spinner Unicode characters** indicate a process is still running: `⠋ ⠙ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`

**Progress bar** `[=====>   ]` indicates an in-progress build. Neither the spinner nor progress bar is the final result — wait for the idle/completion marker.

**Prompt detection**: `$` or `%` at the end of a line indicates the command has returned to the shell prompt.

**ANSI stripping regex** (for edge cases where raw output is obtained outside the MCP tools):
```javascript
text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
```

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

For comprehensive framework-specific pass/fail/running/idle markers, see the `terminal:framework-signals` skill.

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

### Example F: Split Current Window (Side-by-Side)

**Use when**: User says "run it here", "split pane", "beside me", "in this window", "show alongside".

```
// Step 1: Detect current pane (CRITICAL — never skip, never use list-windows)
Bash: tmux display-message -p '#{pane_id}'                    → "%57"

// Step 2: Check for existing helper pane to reuse
Bash: tmux list-panes -F '#{pane_id} #{pane_title}' | grep claude-helper
// → If found (e.g., "%66 claude-helper"): skip to Step 5

// Step 3: Split the current pane (first split = vertical divider, helper on RIGHT)
mcp__tmux__split-pane({ paneId: "%57", direction: "horizontal" })
                                                               → new pane "%66"

// Step 4: Label the new pane so we can find it later
Bash: tmux select-pane -t %66 -T "claude-helper"

// Step 5: Launch process in the helper pane
mcp__tmux__send-keys({ paneId: "%66", keys: "bun test --watch\nEnter" })

// Step 6: Monitor via capture-pane
mcp__tmux__capture-pane({ paneId: "%66" })                    → current screen

// Cleanup: when done, close only the pane you created
mcp__tmux__kill-pane({ paneId: "%66" })
```

**Key rules:**
- Always detect pane with `tmux display-message -p`, never `list-windows` active flag
- Always check for existing `claude-helper` pane before splitting
- First split is `direction: "horizontal"` (helper appears on right)
- Label created panes with `tmux select-pane -t <id> -T "claude-helper"`

### Example G: Desktop Notification on Long Command Completion

**Use when**: A long-running build, test suite, or migration should alert the user when done, regardless of whether they are watching the terminal.

```bash
# Append to any long-running command:
npm run build 2>&1 | tee /tmp/build.log && \
  osascript -e 'display notification "Build complete" with title "Claude"' || \
  osascript -e 'display notification "Build FAILED" with title "Claude" sound name "Basso"'
```

**Cross-platform `notify()` function** (paste into the session before the long command):
```bash
notify() {
  MSG="$1"
  if command -v osascript &>/dev/null; then
    osascript -e "display notification \"$MSG\" with title \"Claude\""
  elif command -v notify-send &>/dev/null; then
    notify-send "Claude" "$MSG"
  elif [ -n "$TMUX" ]; then
    tmux display-message "$MSG"
  else
    printf '\a'
  fi
}
```

Then use it: `npm run build && notify "Build complete" || notify "Build FAILED"`

**Availability check**: `osascript` exits 0 on success, non-zero if system notifications are denied. Verify before relying on it:
```bash
osascript -e 'display notification "test"' 2>/dev/null && echo "available" || echo "check System Settings > Notifications"
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

## 11b. Approval Gate for Destructive Commands

Before running any command that cannot be undone, Claude must **stop and confirm** with the user. This mirrors Warp AI's mandatory human-confirmation model.

**RPGAO loop** (universal protocol for any terminal action):
```
READ    → snapshot or capture-pane to see current state
PROPOSE → "I plan to run: {command}. Reason: {explanation}"
GATE    → "Shall I proceed?" (ALWAYS for destructive; optional for safe commands)
ACT     → send-keys or execute_command on user confirmation
OBSERVE → poll for completion + success/failure signal
→ Repeat from READ if failure
```

**Detect these patterns before running — STOP and confirm**:

| Pattern | Regex |
|---------|-------|
| Recursive force delete | `\brm\s+(-[rRf]+\s+\|--recursive\|--force\s+)*[/~]` |
| Git force push | `\bgit\s+push.*(-f\b\|--force)` |
| Git reset hard / clean | `\bgit\s+(reset\s+--hard\|clean\s+-[fd])` |
| DROP TABLE / DATABASE / TRUNCATE | `\b(DROP\s+TABLE\|DROP\s+DATABASE\|TRUNCATE)\b` |
| kubectl delete | `\bkubectl\s+delete\b` |
| Curl pipe to bash | `\bcurl\s+.*\|\s*bash\b` |
| dd overwrite | `\bdd\s+.*\bof=` |

**Example tool-call sequence** (destructive command path):
```
1. Claude detects command matches git_force_push pattern
2. Claude shows: "I plan to run: git push --force origin main
   This is a force push. Choose:
   A) Run it for me
   B) Show me the safe alternative first
   C) Cancel"
3. User picks A → mcp__ht__ht_execute_command(sessionId, 'git push --force origin main')
4. Poll snapshot for completion marker
```

The GATE step is always required for any pattern in the table above. For safe, reversible commands, PROPOSE + ACT is sufficient (no explicit GATE pause needed).

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
