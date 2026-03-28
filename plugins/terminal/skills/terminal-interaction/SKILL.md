---
name: terminal-interaction
description: tmux-mcp tool API patterns for interactive terminal access. Use when running commands interactively, starting dev servers, watching test output, querying databases, navigating TUI apps, splitting panes to show apps side-by-side, or observing terminal output. Trigger keywords - "run tests", "watch mode", "dev server", "database query", "terminal", "TUI", "interactive", "REPL", "split", "side", "panel", "alongside", "beside".
version: 3.0.0
tags: [terminal, tui, pty, interactive, tmux, testing-workflow, dev-server, database, monitoring, repl]
keywords: [terminal, tui, pty, interactive, session, capture, send-keys, vim, htop, lazygit, run tests, watch mode, test watcher, dev server, start server, database query, psql, redis, mongo, mongosh, docker logs, tail logs, process monitor, bun test, npm run dev, go test, REPL, interactive shell, run command, execute script, long-running process, split, side, panel, alongside, beside, side by side, split pane, side panel, open on a side, show beside]
plugin: terminal
updated: 2026-03-25
---

# Terminal Interaction Skill

This skill teaches Claude how to use `tmux-mcp` for interactive terminal access: screen reading, keystroke injection, process monitoring, and TUI application navigation.

**Analogy**: `chrome-devtools-mcp` gives Claude eyes and hands in the browser. `tmux-mcp` gives Claude eyes and hands in the terminal.

---

## 1. Tool Selection Guide — Layer 1 vs Layer 2

The Go tmux-mcp binary provides two layers of tools. Choose based on whether your task involves waiting for a condition.

| Scenario | Primary Tool | Notes |
|----------|-------------|-------|
| Start command, wait for ready pattern | `start-and-watch` | Single call, no loop |
| Watch existing pane for change/exit | `watch-pane` | Single call, no loop |
| Multi-step REPL session | `run-in-repl` | Synchronous, prompt-aware |
| Check if process is alive/blocked | `pane-state` | Kernel-level, no screen scraping |
| One-shot command (non-interactive) | `execute-command headless:true` | Sync, auto-cleanup |
| Long interactive session | `create-headless` + `start-and-watch` | Manual lifecycle |
| Split pane side-by-side | `split-pane` + `send-keys` | Layout unchanged |
| Observe existing session | `capture-pane` | Read-only, no change |

**Layer 2 (agentic) tools**: `start-and-watch`, `watch-pane`, `run-in-repl`, `pane-state`, `write-to-display`
**Layer 1 (primitive) tools**: `execute-command`, `create-headless`, `capture-pane`, `send-keys`, `create-session`, `split-pane`, etc.

**Decision rule**: If the task involves waiting — for a process to be ready, for output to change, for a REPL to respond — use a Layer 2 tool. For structural operations (create pane, send keystroke, read current state), use Layer 1.

---

## 1b. Current Pane Detection (CRITICAL — Do This First)

**Before splitting or creating anything**, find your actual current pane using the environment variable:

```bash
echo "$TMUX_PANE"
```

This returns the pane ID (e.g., `%57`) where the Bash tool is actually running. `$TMUX_PANE` is set by tmux at shell creation, is stable for the pane's lifetime, and is correctly inherited by subprocesses — it never queries mutable server state, so it cannot race with user focus changes.

### Why other detection methods fail

| Method | Reliability | Problem |
|--------|-------------|---------|
| `$TMUX_PANE` env var | **Always correct** | Set at shell creation, stable, no server round-trip |
| `tmux display-message -t "$TMUX_PANE" -p '#{pane_id}'` | **Always correct** | Equivalent but unnecessary round-trip |
| `tmux display-message -p` (no `-t`) | **Unreliable — NEVER use** | Returns whichever pane has focus. If the user switches tmux windows during agent spin-up delay, this returns the wrong pane. |
| `list-windows` active flag | **Unreliable — NEVER use** | "active" means most recently selected window in the session, NOT the one the user is looking at. Same class of race condition. |

Two real failures: (1) The agent listed sessions, saw window @30 marked `active: true`, split a pane there — but the user was in window @50. (2) A subagent ran `tmux display-message -p '#{pane_id}'` during its 2-5 second spin-up delay — the user had switched windows, so the split appeared in the wrong window. `$TMUX_PANE` is immune to both.

**If `$TMUX_PANE` is set**: You're in tmux. Use it directly for splits.
**If it's empty or unset**: Use `execute-command` with `headless: true` for isolated tasks, or `create-session` for a new tmux session.

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
1. Bash: echo "$TMUX_PANE"                                          → "%57"
2. Bash: tmux list-panes -F '#{pane_id} #{pane_title}' | grep claude-helper
   → If found "%66 claude-helper": reuse %66, skip to step 5
3. mcp__tmux__split-pane({ paneId: "%57", direction: "horizontal" }) → new pane "%66"
4. Bash: tmux select-pane -t %66 -T "claude-helper"                 → label it
5. mcp__tmux__send-keys({ paneId: "%66", keys: "bun test --watch", literal: true })
   mcp__tmux__send-keys({ paneId: "%66", keys: "Enter", literal: false })
```

**Never call `list-sessions`/`list-windows`/`list-panes` just to find your own pane.** Detection + reuse check + split is 2-4 Bash calls at most.

**Common mistake**: Creating a new tmux session (`create-session`) when the user says "here" or "in this window." If you're in tmux, always split — never create a detached session.

---

## 2. Tool Naming Convention

The server key in `.mcp.json` is `tmux`. This produces tool name prefix `mcp__tmux__`:

- `mcp__tmux__start-and-watch`, `mcp__tmux__watch-pane`, `mcp__tmux__run-in-repl`
- `mcp__tmux__execute-command`, `mcp__tmux__create-headless`, `mcp__tmux__capture-pane`
- `mcp__tmux__send-keys`, `mcp__tmux__list-sessions`, `mcp__tmux__kill-session`, etc.

---

## 3. MCP Task Tools — start-and-watch and watch-pane

`start-and-watch` and `watch-pane` are MCP Task tools. They behave differently from regular tools:

1. The tool call returns immediately with a task ID (non-blocking at the protocol level).
2. While running, the tool sends `notifications/progress` messages. Each contains `progress` (elapsed seconds), `total` (timeout), and `message` (e.g., `"[5% +2s] 12 new lines"`).
3. When a trigger fires (pattern matched, exit, error, timeout), the tool sends a final notification with `progress=-1, total=-1` as sentinel values. The `message` field contains the full WatchResult JSON.
4. The task result also contains the WatchResult via `WithModelImmediateResponse`.

**From the skill author's perspective**: The tool call blocks until a trigger fires — equivalent to a synchronous call with real-time streaming side effects. No manual polling loop is needed.

### WatchResult Structure

```json
{
  "paneId": "%6",
  "event": "pattern:listening on",
  "detail": "Ready — matched: Listening on port 3000",
  "elapsed": 2.14,
  "output": "Listening on port 3000\n...",
  "paneState": {
    "panePid": 12345,
    "foregroundPid": 12347,
    "foregroundCmd": "node",
    "isAlive": true,
    "waitingForInput": false
  }
}
```

### WatchResult event values

| event value | Meaning | Next action |
|-------------|---------|-------------|
| `"pattern:<regex>"` | Readiness pattern matched | Report ready; save paneId for later calls |
| `"exit"` | Process exited | Check exitCode via pane-state |
| `"error"` | Error output detected | Report error; show WatchResult.output |
| `"idle:N"` | No new output for N seconds | Process may be waiting; use pane-state |
| `"shell"` | Shell prompt returned (process exited to shell) | Confirmed completion |
| `"timeout"` | No trigger fired in timeout_secs | Report; save paneId for continued monitoring |

### MCP Task Tool Limitation (Claude Code MCP Client)

**Known limitation (as of March 2026)**: Claude Code's MCP client does not yet support the MCP Tasks API.
Calling `start-and-watch` or `watch-pane` returns error `-32601: requires task augmentation`.
This will be resolved when Claude Code implements `tasks/create` per the MCP specification.
Until then, use `execute-command` (synchronous) for one-shot commands, or `send-keys` + `capture-pane`
for monitoring. These tools ARE registered and WILL work once the client adds Tasks support.

### REPL Startup — create-headless vs execute-command

**REPL startup**: Do NOT use `execute-command` to start REPLs (python3, psql, node, etc.). `execute-command` is synchronous — it waits for the command to exit, and REPLs never exit on their own. This causes an indefinite hang.

Instead, use `create-headless` with the REPL as the session's initial command, then `run-in-repl` for interactions:

```
// WRONG — hangs forever:
mcp__tmux__execute-command({ command: "python3", headless: true })

// CORRECT — python3 starts as the session's shell:
mcp__tmux__create-headless({ name: "python-session", command: "python3" })
→ { paneId: "headless:%0", sessionId: "headless:$0" }
// python3 is now waiting at its REPL prompt in that pane
mcp__tmux__run-in-repl({ paneId: "headless:%0", input: "1 + 1", promptPattern: ">>>" })
→ { output: "2" }
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## 4. tmux-mcp Complete API (20 Tools)

### Layer 2 Agentic Tools

| Tool | Type | Primary Use |
|------|------|-------------|
| `mcp__tmux__start-and-watch` | MCP Task (async) | Start command, wait for readiness pattern |
| `mcp__tmux__watch-pane` | MCP Task (async) | Monitor existing pane for change/exit |
| `mcp__tmux__run-in-repl` | Sync | Send input to REPL, get structured output |
| `mcp__tmux__pane-state` | Sync | OS-level process info (pid, alive, waiting) |
| `mcp__tmux__write-to-display` | Sync | Write status message to Claude's pane |
| `mcp__tmux__display-message` | Sync | Show message in tmux status bar |

### Layer 1 Primitive Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `mcp__tmux__execute-command` | `command` (string), `headless` (bool), `paneId` (string) | Run command synchronously; returns `{ output, exitCode }` |
| `mcp__tmux__create-headless` | `name` (string, optional) | Create isolated headless session; returns `{ paneId, sessionId }` |
| `mcp__tmux__list-sessions` | none | List all sessions (regular + headless) |
| `mcp__tmux__list-windows` | `sessionId` (string) | List windows in session |
| `mcp__tmux__list-panes` | `windowId` (string) | List panes in window |
| `mcp__tmux__capture-pane` | `paneId` (string), `lines` (int, optional), `colors` (bool, optional) | Read screen content of pane |
| `mcp__tmux__send-keys` | `paneId` (string), `keys` (string), `literal` (bool, default true) | Send keystrokes to pane |
| `mcp__tmux__create-session` | `name` (string, optional) | Create new visible tmux session |
| `mcp__tmux__create-window` | `sessionId` (string) | Create new window |
| `mcp__tmux__split-pane` | `paneId` (string), `direction` (optional), `size` (optional) | Split pane |
| `mcp__tmux__kill-session` | `sessionId` (string) | Terminate session |
| `mcp__tmux__kill-headless-server` | none | Terminate all headless sessions at once |
| `mcp__tmux__kill-window` | `windowId` (string) | Close window |
| `mcp__tmux__kill-pane` | `paneId` (string) | Close pane |
| `mcp__tmux__resize-pane` | `paneId` (string), dimensions | Resize pane |
| `mcp__tmux__rename-session` | `sessionId` (string), `name` (string) | Rename session |

**Note on `send-keys`**:
- `literal: true` (default) — text is sent byte-for-byte; plain text typing.
- `literal: false` — text is interpreted as tmux key names. Required for control sequences.

**Note on `capture-pane`**: Use `lines` parameter to retrieve scrollback history beyond the visible viewport. Example: `capture-pane({ paneId: "%3", lines: 200 })` returns the last 200 lines.

**Note on `execute-command`**: When `headless: true` is set, the command runs in an auto-created isolated session that is destroyed after completion. Output and exit code are returned synchronously in the same call. No session tracking needed.

**Removed tools** (do not use — not in Go binary):
- `find-session` → replaced by `list-sessions` + client-side name filtering
- `get-command-result` → `execute-command` is now synchronous; no polling needed

---

## 5. send-keys Parameter Guide

```
mcp__tmux__send-keys({ paneId, keys, literal })

  literal: true  (default) — text is sent byte-for-byte; special characters are NOT
                             interpreted as key sequences. Use for typing commands.
  literal: false           — text is interpreted as tmux key names. Use for:
                             - Control sequences: "C-c", "C-d", "Escape", "Enter"
                             - Arrow keys: "Up", "Down", "Left", "Right"
                             - Function keys: "F1" through "F12"

To type text AND execute (press Enter):
  mcp__tmux__send-keys({ paneId, keys: "bun test --watch", literal: true })
  mcp__tmux__send-keys({ paneId, keys: "Enter", literal: false })
  OR (single call):
  mcp__tmux__send-keys({ paneId, keys: "bun test --watch\n", literal: false })

Control key reference (all require literal: false):
  Interrupt:   keys: "C-c"
  EOF/exit:    keys: "C-d"
  Clear:       keys: "C-l"
  Suspend:     keys: "C-z"
  Escape:      keys: "Escape"
  Enter:       keys: "Enter"
  Arrow keys:  keys: "Up", "Down", "Left", "Right"
```

| What you want | Keys string | literal |
|--------------|-------------|---------|
| Type command text | `"ls -la src/"` | `true` (default) |
| Press Enter | `"Enter"` | `false` |
| Ctrl+C (interrupt) | `"C-c"` | `false` |
| Ctrl+D (EOF / exit) | `"C-d"` | `false` |
| Escape | `"Escape"` | `false` |
| Arrow Up | `"Up"` | `false` |
| Arrow Down | `"Down"` | `false` |
| F1–F12 | `"F1"` … `"F12"` | `false` |

---

## 6. Session Lifecycle

### Headless Sessions (for isolated/ephemeral tasks)

```
QUICK (auto-lifecycle):
  mcp__tmux__execute-command({ command, headless: true })
  → auto-creates session, runs command, returns { output, exitCode }, auto-destroys
  No session ID to track. No cleanup needed.

MANUAL (for processes that outlive a single command):
  mcp__tmux__create-headless({ name: "task-name" })
  → { paneId: "headless:%0", sessionId: "headless:$0" }
  → save paneId for subsequent tool calls
  → cleanup: mcp__tmux__kill-session({ sessionId: "headless:$0" })
             OR mcp__tmux__kill-headless-server()  ← clears all headless sessions
```

Headless sessions are isolated on a separate tmux socket (`mcp-headless`). They do not appear in the user's `tmux ls`. They persist until explicitly killed or `kill-headless-server` is called.

### Visible Sessions (for user-facing work)

```
mcp__tmux__create-session({ name: "project" })
→ returns { sessionId: "$N" }
→ user can attach with: tmux attach -t project
→ cleanup: mcp__tmux__kill-session({ sessionId: "$N" })
```

**Never kill sessions you did not create.** When observing the user's existing sessions, use `capture-pane` only.

---

## 7. Capturing Full Output

`capture-pane` has access to tmux scrollback history:

```
mcp__tmux__capture-pane({ paneId: "%3" })          → visible viewport
mcp__tmux__capture-pane({ paneId: "%3", lines: 200 }) → last 200 lines of scrollback
```

For very long output (build logs, test suites with hundreds of cases):

```
mcp__tmux__execute-command({
  command: "npm test 2>&1 | tee /tmp/claude-output.log",
  headless: true
})
Read({ file_path: "/tmp/claude-output.log" })  → full output, unlimited lines
```

---

## 7b. Output Parsing Rules

`tmux capture-pane` returns **plain text** — ANSI escape codes are stripped by tmux before Claude sees them. Color is never available.

```
CORRECT: look for ✓ / ✗ / PASS / FAIL / error: / warning: / ⠋ (spinner active)
WRONG:   "is this line red?" — ANSI color is stripped; color state is unavailable
```

**Spinner Unicode characters** indicate a process is still running: `⠋ ⠙ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`

**Progress bar** `[=====>   ]` indicates an in-progress build. Neither the spinner nor progress bar is the final result — wait for the idle/completion marker.

**Prompt detection**: `$` or `%` at the end of a line indicates the command has returned to the shell prompt.

---

## 8. Timing and Race Conditions

**TUI apps need render time.** After sending keys to a TUI application, use `watch-pane` with a `user_input` or `idle:N` trigger to wait for the application to process input and redraw before reading state.

For long-running processes, `start-and-watch` or `watch-pane` replace polling loops — they block until a trigger condition fires, streaming progress notifications as output arrives.

For comprehensive framework-specific pass/fail/running/idle markers, see `terminal:framework-signals`.

---

## 9. Workflow Examples

### Example A: Simple Command Execution

```
mcp__tmux__execute-command({ command: "npm test", headless: true })
→ returns { output, exitCode } synchronously
Parse output for pass/fail. Done.
```

### Example B: vim File Editing

```
1. mcp__tmux__create-headless({ name: "vim-edit" }) → { paneId: "headless:%0" }
2. mcp__tmux__start-and-watch({
     paneId: "headless:%0",
     command: "vim myfile.ts",
     pattern: "~",           // vim blank line tilde indicates loaded
     timeout: 10
   }) → WatchResult
3. // vim is now open; use send-keys for navigation
4. mcp__tmux__send-keys({ paneId: "headless:%0", keys: "i", literal: false })
5. mcp__tmux__send-keys({ paneId: "headless:%0", keys: "hello world", literal: true })
6. mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Escape", literal: false })
7. mcp__tmux__send-keys({ paneId: "headless:%0", keys: ":wq", literal: true })
8. mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Enter", literal: false })
9. // watch-pane: wait for shell prompt to return
10. mcp__tmux__watch-pane({
      paneId: "headless:%0",
      triggers: "shell,idle:2",
      timeout: 10
    }) → WatchResult (event: "shell" = vim exited, shell regained)
11. mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

### Example C: Server Startup (was a polling loop)

```
1. mcp__tmux__start-and-watch({
     command: "bun run dev",
     pattern: "Local:.*http|listening on|ready in",
     mode: "quick",
     timeout: 60
   })
   // paneId omitted → auto-creates session; headless=false → visible session
   → WatchResult { event: "pattern:...", output: "...", paneId: "%N" }
2. Save the returned paneId for later observation
3. Report: "Server ready. Pane: %N"
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
1. mcp__tmux__create-headless({ name: "psql-session" }) → { paneId: "headless:%0" }
2. mcp__tmux__start-and-watch({
     paneId: "headless:%0",
     command: "psql $DATABASE_URL",
     pattern: "=#",
     timeout: 15
   }) → WatchResult (event confirms psql is ready)
3. mcp__tmux__run-in-repl({
     paneId: "headless:%0",
     input: "SELECT count(*) FROM users LIMIT 10;",
     promptPattern: "=#",
     timeout: 10
   }) → { output: " count\n-------\n 1247" }
4. Parse output directly (no screen scraping needed)
5. mcp__tmux__run-in-repl({
     paneId: "headless:%0",
     input: "\\q",
     promptPattern: "\\$",
     timeout: 5
   })
6. mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

### Example F: Split Current Window (Side-by-Side)

**Use when**: User says "run it here", "split pane", "beside me", "in this window", "show alongside".

```
// Step 1: Detect current pane (CRITICAL — never skip, never use list-windows or display-message without -t)
Bash: echo "$TMUX_PANE"                                       → "%57"

// Step 2: Check for existing helper pane to reuse
Bash: tmux list-panes -F '#{pane_id} #{pane_title}' | grep claude-helper
// → If found (e.g., "%66 claude-helper"): skip to Step 5

// Step 3: Split the current pane (first split = vertical divider, helper on RIGHT)
mcp__tmux__split-pane({ paneId: "%57", direction: "horizontal" })
                                                               → new pane "%66"

// Step 4: Label the new pane so we can find it later
Bash: tmux select-pane -t %66 -T "claude-helper"

// Step 5: Launch process in the helper pane
mcp__tmux__send-keys({ paneId: "%66", keys: "bun test --watch", literal: true })
mcp__tmux__send-keys({ paneId: "%66", keys: "Enter", literal: false })

// Step 6: Monitor via capture-pane or event-driven watch-pane
mcp__tmux__capture-pane({ paneId: "%66" })                    → current screen

// Cleanup: when done, close only the pane you created
mcp__tmux__kill-pane({ paneId: "%66" })
```

**Key rules:**
- Always detect pane with `echo "$TMUX_PANE"`, never `display-message -p` without `-t` or `list-windows` active flag
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

---

## 10. Error Handling Patterns

### Process Stuck / Command Hangs

```
// Detect using pane-state — kernel-level, no screen scraping needed
mcp__tmux__pane-state({ paneId })
→ { isAlive: true, waitingForInput: true, foregroundCmd: "psql" }

// Or detect via watch-pane idle trigger:
// start-and-watch / watch-pane fires event: "timeout" when nothing happens in timeout_secs

// Recovery: send Ctrl+C
mcp__tmux__send-keys({ paneId, keys: "C-c", literal: false })
mcp__tmux__capture-pane({ paneId })  // verify prompt returned
```

### Port Already in Use

```
// Detect: start-and-watch output contains "EADDRINUSE" or "address already in use"
// WatchResult.event will be "error" or "pattern:EADDRINUSE"
// Recovery options:
// 1. Find and kill the occupying process: execute-command({ command: "lsof -ti:3000 | xargs kill", headless: true })
// 2. Try a different port
// 3. Report to user for manual resolution
```

### TUI App Stuck

```
// Detection: watch-pane fires idle:N event (no new output for N seconds)
// OR: pane-state shows waitingForInput: false but isAlive: true (spinning but not drawing)
// Recovery sequence:
mcp__tmux__send-keys({ paneId, keys: "C-c", literal: false })  // try interrupt first
// If still stuck:
mcp__tmux__send-keys({ paneId, keys: "q", literal: true })     // try quit command
// If still stuck:
mcp__tmux__kill-session({ sessionId })                          // force close session
```

### Password Prompt Detection

```
// Use pane-state to detect waiting + check output for "password":
result = mcp__tmux__pane-state({ paneId })
if result.waitingForInput and "password" in capture-pane output:
  STOP — never send credentials through send-keys
  Report to user, ask them to handle authentication
```

### Long-Running Process (SSH, Migration, Deploy)

```
// For database migrations: ALWAYS confirm with user before proceeding
// For SSH: use pane-state to detect password prompt → stop and report
// For deployments: use start-and-watch with deploy-specific patterns from terminal:framework-signals
```

---

## 11. Safety Guidelines

1. **Never store credentials**: Do not send passwords or API keys through `send-keys`. Use `pane-state` to detect password prompts and stop.
2. **Confirm destructive operations**: Database migrations, `DROP TABLE`, production deployments — always confirm with user.
3. **Never kill user's tmux sessions**: When using tmux-mcp to observe existing sessions, use `capture-pane` only. Do NOT call `kill-session` on sessions you did not create.
4. **Clean up headless sessions**: Use `kill-session` or `kill-headless-server` when done. Headless sessions persist until explicitly killed.

---

## 11b. Approval Gate for Destructive Commands

Before running any command that cannot be undone, Claude must **stop and confirm** with the user. This mirrors Warp AI's mandatory human-confirmation model.

**RPGAO loop** (universal protocol for any terminal action):
```
READ    → capture-pane to see current state
PROPOSE → "I plan to run: {command}. Reason: {explanation}"
GATE    → "Shall I proceed?" (ALWAYS for destructive; optional for safe commands)
ACT     → send-keys or execute-command on user confirmation
OBSERVE → use start-and-watch or watch-pane for completion signal
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

The GATE step is always required for any pattern in the table above. For safe, reversible commands, PROPOSE + ACT is sufficient (no explicit GATE pause needed).
