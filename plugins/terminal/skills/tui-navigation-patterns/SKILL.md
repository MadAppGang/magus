---
name: tui-navigation-patterns
description: Key sequences and navigation patterns for common TUI applications. Use when navigating vim, nano, htop, less, psql, lazygit, k9s, tig, btop, or other terminal user interfaces. Also triggers on database shell navigation, git TUI operations, and system monitoring.
version: 3.0.0
tags: [terminal, tui, navigation, keys, vim, nano, htop, git-tui, database-shell, system-monitor]
keywords: [vim, nano, htop, btop, less, psql, lazygit, tig, k9s, docker, mongosh, redis-cli, turso, key sequence, navigation, escape, git tui, stage commit, database shell, system monitor, process manager, file editor, terminal editor]
plugin: terminal
updated: 2026-03-25
user-invocable: false
---

# TUI Navigation Patterns

Key sequences and navigation patterns for common TUI applications. Use with `mcp__tmux__send-keys`.

---

## send-keys Parameter Guide

`mcp__tmux__send-keys` takes a single `keys` string (not an array). The `literal` flag controls interpretation:

```
mcp__tmux__send-keys({ paneId, keys, literal })

  literal: true  (default) — text sent byte-for-byte; special chars NOT interpreted
           Use for: typing commands, text to insert, query strings

  literal: false — text interpreted as tmux key names
           Use for: control sequences, navigation keys, any non-printable key

Examples:
  mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Escape", literal: false })
  mcp__tmux__send-keys({ paneId: "headless:%0", keys: ":wq", literal: true })
  mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Enter", literal: false })
  mcp__tmux__send-keys({ paneId: "headless:%0", keys: "C-c", literal: false })
```

**To type text then press Enter** (two options):
```
// Option A: two calls
mcp__tmux__send-keys({ paneId, keys: "ls -la", literal: true })
mcp__tmux__send-keys({ paneId, keys: "Enter", literal: false })

// Option B: one call with \n (literal: false allows newline interpretation)
mcp__tmux__send-keys({ paneId, keys: "ls -la\n", literal: false })
```

**Key name notation**: Go tmux-mcp uses tmux key names (not caret notation):

| What you want | Keys string | literal |
|--------------|-------------|---------|
| Enter / Return | `"Enter"` | `false` |
| Escape | `"Escape"` | `false` |
| Space | `"Space"` | `false` |
| Tab | `"Tab"` | `false` |
| Arrow Up | `"Up"` | `false` |
| Arrow Down | `"Down"` | `false` |
| Arrow Left | `"Left"` | `false` |
| Arrow Right | `"Right"` | `false` |
| Page Up | `"PageUp"` | `false` |
| Page Down | `"PageDown"` | `false` |
| Home | `"Home"` | `false` |
| End | `"End"` | `false` |
| F1–F12 | `"F1"`, `"F2"`, ..., `"F12"` | `false` |
| Ctrl+C (interrupt) | `"C-c"` | `false` |
| Ctrl+D (EOF / exit) | `"C-d"` | `false` |
| Ctrl+L (clear screen) | `"C-l"` | `false` |
| Ctrl+Z (suspend) | `"C-z"` | `false` |
| Ctrl+X | `"C-x"` | `false` |
| Ctrl+O | `"C-o"` | `false` |
| Ctrl+W | `"C-w"` | `false` |
| Ctrl+K | `"C-k"` | `false` |
| Ctrl+U | `"C-u"` | `false` |
| Ctrl+R | `"C-r"` | `false` |
| Shift+F6 | `"S-F6"` | `false` |
| Alt+x | `"M-x"` | `false` |
| Type plain text | `"my text here"` | `true` (default) |

---

## General Terminal Controls

These work in almost any terminal context:

| Action | Keys | literal |
|--------|------|---------|
| Interrupt running process | `"C-c"` | `false` |
| Send EOF / exit shell | `"C-d"` | `false` |
| Suspend process (move to background) | `"C-z"` | `false` |
| Clear screen (redraw) | `"C-l"` | `false` |
| Kill current line (clear input) | `"C-u"` | `false` |
| Delete word before cursor | `"C-w"` | `false` |

```
// Interrupt a stuck process
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "C-c", literal: false })

// Exit a shell or REPL
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "C-d", literal: false })
```

---

## vim

**Modes**: Normal mode (default), Insert mode (`i`), Visual mode (`v`), Command mode (`:`)

### Essential Navigation

| Action | Keys | Context |
|--------|------|---------|
| Enter insert mode | `i` | Normal mode |
| Enter insert mode at end of line | `A` | Normal mode |
| Return to normal mode | `Escape` | Any mode |
| Save and quit | `:wq` + `Enter` | Normal mode |
| Save without quitting | `:w` + `Enter` | Normal mode |
| Quit without saving | `:q!` + `Enter` | Normal mode |
| Open file | `:e {filename}` + `Enter` | Normal mode |
| Move to start of file | `gg` | Normal mode |
| Move to end of file | `G` | Normal mode |
| Move to line N | `:{N}` + `Enter` | Normal mode |
| Delete current line | `dd` | Normal mode |
| Copy (yank) current line | `yy` | Normal mode |
| Paste | `p` | Normal mode |
| Undo | `u` | Normal mode |
| Redo | `C-r` (literal: false) | Normal mode |
| Search forward | `/pattern` + `Enter` | Normal mode |
| Search backward | `?pattern` + `Enter` | Normal mode |
| Next search result | `n` | Normal mode |
| Previous search result | `N` | Normal mode |
| Page down | `C-f` (literal: false) | Normal mode |
| Page up | `C-b` (literal: false) | Normal mode |

### vim Workflow Example

```
// Launch vim in headless session
mcp__tmux__create-headless({ name: "vim-edit" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "vim myfile.ts",
  pattern: "~",          // vim blank line tildes indicate loaded
  timeout: 10
}) → WatchResult

// Go to end of file
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "G", literal: false })
// Enter insert mode on new line below
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "o", literal: false })
// Type content
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "// Added by Claude", literal: true })
// Return to normal mode
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Escape", literal: false })
// Save and quit
mcp__tmux__send-keys({ paneId: "headless:%0", keys: ":wq", literal: true })
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Enter", literal: false })
// Wait for shell prompt to return
mcp__tmux__watch-pane({
  paneId: "headless:%0",
  triggers: "shell,idle:2",
  timeout: 10
}) → WatchResult
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## nano

nano is simpler than vim — no mode switching. Ctrl shortcuts are shown in the bottom bar.

| Action | Keys | literal |
|--------|------|---------|
| Save file | `"C-o"` then `"Enter"` | `false` |
| Exit | `"C-x"` | `false` |
| Search | `"C-w"` then type pattern + `"Enter"` | `false` / `true` / `false` |
| Cut current line | `"C-k"` | `false` |
| Paste cut line | `"C-u"` | `false` |
| Page down | `"C-v"` | `false` |
| Page up | `"C-y"` | `false` |

```
// Edit a file in nano, save, and exit
mcp__tmux__create-headless({ name: "nano-edit" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "nano myfile.txt",
  pattern: "GNU nano",
  timeout: 10
}) → WatchResult
// Type some content
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Hello from Claude", literal: true })
// Save: Ctrl+O
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "C-o", literal: false })
// Confirm filename with Enter
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Enter", literal: false })
// Exit: Ctrl+X
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "C-x", literal: false })
mcp__tmux__watch-pane({ paneId: "headless:%0", triggers: "shell,idle:2", timeout: 10 })
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## htop / btop

System monitors. Read-only — never send destructive keys without user confirmation.

### htop

| Action | Keys | literal |
|--------|------|---------|
| Quit | `"q"` | `true` |
| Sort by column | `"F6"` | `false` |
| Kill selected process | `"F9"` (requires user confirmation) | `false` |
| Toggle tree view | `"F5"` | `false` |
| Search processes | `"F3"` | `false` |
| Filter processes | `"F4"` | `false` |
| Help | `"F1"` | `false` |
| Navigate processes | `"Up"`, `"Down"` | `false` |
| Scroll right | `"Right"` | `false` |

### btop

| Action | Keys | literal |
|--------|------|---------|
| Quit | `"q"` | `true` |
| Navigate between panels | `"Tab"` | `false` |
| Kill selected process | `"k"` | `true` |
| Sort options | `"f"` | `true` |
| Toggle CPU core graph | `"1"` | `true` |
| Help | `"h"` | `true` |

```
// Read system stats from htop
mcp__tmux__create-headless({ name: "htop" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "htop",
  pattern: "CPU\\[",   // htop CPU bar header
  timeout: 10
}) → WatchResult
mcp__tmux__capture-pane({ paneId: "headless:%0" })  // read CPU/memory
// Quit cleanly
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "q", literal: true })
mcp__tmux__watch-pane({ paneId: "headless:%0", triggers: "shell,idle:2", timeout: 5 })
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## less / man (Pagers)

| Action | Keys | literal |
|--------|------|---------|
| Quit | `"q"` | `true` |
| Page down | `"Space"` | `false` |
| Page up | `"b"` | `true` |
| Go to end | `"G"` | `true` |
| Go to start | `"g"` | `true` |
| Search forward | `"/pattern"` then `"Enter"` | `true` / `false` |
| Search backward | `"?pattern"` then `"Enter"` | `true` / `false` |
| Next search result | `"n"` | `true` |
| Previous search result | `"N"` | `true` |

```
// Read a man page
mcp__tmux__create-headless({ name: "man-curl" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "man curl",
  pattern: "CURL",
  timeout: 10
}) → WatchResult
// Search for "timeout"
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "/timeout", literal: true })
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Enter", literal: false })
mcp__tmux__capture-pane({ paneId: "headless:%0" })
// Quit
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "q", literal: true })
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## psql (PostgreSQL CLI)

psql prompts: `=#` (normal), `-#` (command continuation)

| Action | Keys / Command |
|--------|---------------|
| Quit | `\q` + Enter |
| List databases | `\l` + Enter |
| List tables | `\dt` + Enter |
| Describe table | `\d tablename` + Enter |
| List schemas | `\dn` + Enter |
| Show current database | `SELECT current_database();` + Enter |
| Cancel query | `C-c` (literal: false) |

Prefer `run-in-repl` for psql interactions — it handles prompt detection and returns clean output:

```
// Connect and run queries using run-in-repl
mcp__tmux__create-headless({ name: "psql" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "psql $DATABASE_URL",
  pattern: "=#",
  timeout: 15
}) → WatchResult

// Run query — output returned directly, no screen scraping
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: "SELECT id, email FROM users ORDER BY id LIMIT 10;",
  promptPattern: "=#",
  timeout: 10
}) → { output: "..." }

// Quit cleanly
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: "\\q",
  promptPattern: "\\$",
  timeout: 5
})
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## mongosh (MongoDB Shell)

| Action | Command |
|--------|---------|
| Quit | `.exit` + Enter or `C-d` |
| List databases | `show dbs` + Enter |
| Use database | `use mydb` + Enter |
| List collections | `show collections` + Enter |
| Find documents | `db.collection.find({}).limit(10)` + Enter |
| Cancel | `C-c` (literal: false) |

```
mcp__tmux__create-headless({ name: "mongosh" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "mongosh $MONGO_URI",
  pattern: ">",
  timeout: 15
}) → WatchResult
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: "db.users.find({}).limit(5)",
  promptPattern: ">",
  timeout: 10
}) → { output: "..." }
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: ".exit",
  promptPattern: "\\$",
  timeout: 5
})
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## redis-cli

| Action | Command |
|--------|---------|
| Quit | `quit` + Enter or `C-d` |
| List all keys | `KEYS *` + Enter (careful in production) |
| Get value | `GET keyname` + Enter |
| Set value | `SET keyname value` + Enter |
| Delete key | `DEL keyname` + Enter |
| Server info | `INFO` + Enter |
| Select database | `SELECT 0` + Enter (0-15) |
| Flush current db | `FLUSHDB` + Enter (destructive — confirm first) |

```
mcp__tmux__create-headless({ name: "redis" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "redis-cli",
  pattern: "127\\.0\\.0\\.1:\\d+>",
  timeout: 10
}) → WatchResult
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: "INFO server",
  promptPattern: "127\\.0\\.0\\.1:\\d+>",
  timeout: 10
}) → { output: "..." }
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: "quit",
  promptPattern: "\\$",
  timeout: 5
})
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## turso (Turso DB Shell)

| Action | Command |
|--------|---------|
| Quit | `.quit` + Enter |
| List tables | `.tables` + Enter |
| Describe table | `.schema tablename` + Enter |
| Run SQL | Type SQL query + Enter |

```
mcp__tmux__create-headless({ name: "turso" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "turso db shell mydb",
  pattern: ">",
  timeout: 15
}) → WatchResult
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: "SELECT * FROM users LIMIT 5;",
  promptPattern: ">",
  timeout: 10
}) → { output: "..." }
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: ".quit",
  promptPattern: "\\$",
  timeout: 5
})
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## lazygit

lazygit is a popular TUI for git. It uses a panel-based layout.

| Action | Keys | literal |
|--------|------|---------|
| Quit | `"q"` | `true` |
| Navigate panels | Arrow keys (`"Up"`, `"Down"`) | `false` |
| Select / confirm | `"Enter"` | `false` |
| Stage/unstage file | `"Space"` | `false` |
| Stage all | `"a"` | `true` |
| Commit | `"c"` | `true` |
| Push | `"P"` (capital P) | `true` |
| Pull | `"p"` (lowercase p) | `true` |
| Create branch | `"n"` | `true` |
| Open file in editor | `"e"` | `true` |
| View diff | `"d"` | `true` |
| View log | `"l"` | `true` |
| Help | `"?"` | `true` |
| Switch panel | `"Tab"` | `false` |

```
// Launch lazygit in headless session
mcp__tmux__create-headless({ name: "lazygit" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "lazygit",
  pattern: "Commit list|Files|Branches",  // lazygit panel headers
  timeout: 10
}) → WatchResult

// Stage and commit changes
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "a", literal: true })   // stage all
mcp__tmux__capture-pane({ paneId: "headless:%0" })  // verify staged
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "c", literal: true })   // open commit dialog
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "fix: update auth flow", literal: true })
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Enter", literal: false })
mcp__tmux__capture-pane({ paneId: "headless:%0" })  // verify commit created
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "q", literal: true })   // quit
mcp__tmux__watch-pane({ paneId: "headless:%0", triggers: "shell,idle:2", timeout: 10 })
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## tig (Text-mode Interface for Git)

tig is an ncurses-based git repository browser.

| Action | Keys | literal |
|--------|------|---------|
| Quit | `"q"` | `true` |
| Navigate entries | `"Up"`, `"Down"` | `false` |
| Open / enter | `"Enter"` | `false` |
| Go back | `"Escape"` | `false` |
| Toggle diff | `"d"` | `true` |
| Toggle blame | `"b"` | `true` |
| Search | `"/"` | `true` |
| Refresh | `"F5"` | `false` |
| Help | `"h"` | `true` |

---

## k9s (Kubernetes TUI)

| Action | Keys | literal |
|--------|------|---------|
| Quit | `"q"` | `true` |
| Navigate resources | Arrow keys | `false` |
| Select resource | `"Enter"` | `false` |
| Delete resource | `"C-d"` | `false` |
| Describe resource | `"D"` | `true` |
| View logs | `"l"` | `true` |
| Shell into pod | `"s"` | `true` |
| Switch namespace | `":ns"` then `"Enter"` | `true` / `false` |
| Filter | `"/"` | `true` |

---

## Docker (docker logs follow mode)

| Action | Method |
|--------|--------|
| Stop following logs | `"C-c"` with `literal: false` |
| Start following | `docker logs -f {container}` |
| Show last N lines | `docker logs --tail=50 {container}` |

```
// Follow container logs
mcp__tmux__create-headless({ name: "docker-logs" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "docker logs -f myapp",
  pattern: "started|ready|listening",
  triggers: "error,exit",
  timeout: 30
}) → WatchResult
// Read latest log lines via scrollback
mcp__tmux__capture-pane({ paneId: "headless:%0", lines: 50 })
// Stop following
mcp__tmux__send-keys({ paneId: "headless:%0", keys: "C-c", literal: false })
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## Node.js / Bun REPL

| Action | Method |
|--------|--------|
| Quit | `.exit` + Enter or `C-d` |
| Execute expression | Type expression + Enter |
| Multi-line input | Start with `{` and press Enter to continue |
| Tab completion | `"Tab"` (literal: false) |
| Clear screen | `"C-l"` (literal: false) |

```
mcp__tmux__create-headless({ name: "node-repl" }) → { paneId: "headless:%0" }
mcp__tmux__start-and-watch({
  paneId: "headless:%0",
  command: "node",
  pattern: "> ",
  timeout: 10
}) → WatchResult
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: "1 + 1",
  promptPattern: "> ",
  timeout: 5
}) → { output: "2" }
mcp__tmux__run-in-repl({
  paneId: "headless:%0",
  input: ".exit",
  promptPattern: "\\$",
  timeout: 5
})
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## Python REPL

| Action | Method |
|--------|--------|
| Quit | `quit()` + Enter or `C-d` |
| Execute expression | Type expression + Enter |
| Multi-line input | Indent with spaces, blank line to execute |
| Tab completion | `"Tab"` (literal: false) |
| Help on object | `help(obj)` + Enter |

---

## irb (Ruby REPL)

| Action | Method |
|--------|--------|
| Quit | `exit` + Enter or `C-d` |
| Execute expression | Type expression + Enter |

---

## Application Detection Quick Reference

Use this table to detect what application is running from a `capture-pane` snapshot:

| Prompt / Visual Pattern | Application |
|------------------------|-------------|
| `=#` or `=#` | psql |
| `>` after MongoDB URI | mongosh |
| `127.0.0.1:6379>` | redis-cli |
| Turso shell header | turso shell |
| `>` with node prompt | Node.js REPL |
| `>>>` | Python REPL |
| `irb>` or `irb(main)` | Ruby irb |
| `~` column-based UI with status bar | vim |
| `GNU nano` in top bar | nano |
| `htop` header with CPU bars | htop |
| `btop` header | btop |
| Commit list with branch panel | lazygit |
| Commit graph with author columns | tig |
| Kubernetes resource table | k9s |
| `(END)` at bottom | less pager |
| `Manual page` header | man page |

---

## Prompt Detection (when waiting for app to be ready)

Use `start-and-watch` with a `pattern` matching the app's ready state. For REPLs, then use `run-in-repl` for subsequent interactions — it handles prompt detection automatically.

| Application | `start-and-watch` pattern | `run-in-repl` promptPattern |
|-------------|--------------------------|---------------------------|
| psql | `"=#"` | `"=#"` |
| mongosh | `">"` | `">"` |
| redis-cli | `"127\\.0\\.0\\.1:\\d+>"` | `"127\\.0\\.0\\.1:\\d+>"` |
| Node REPL | `"> "` | `"> "` |
| Python REPL | `">>> "` | `">>> "` |
| irb | `"irb>"` | `"irb>"` |
| turso shell | `">"` | `">"` |
| vim | `"~"` (tilde on blank line) | N/A — use send-keys |
| htop | `"CPU\\["` | N/A — use send-keys |
| lazygit | `"Commit list\|Files\|Branches"` | N/A — use send-keys |
| Server startup | `"listening on\|ready on\|started\|Local:"` | N/A |
| Build complete | `"done in\|built in\|compiled"` | N/A |
| Test complete | `"passed\|failed\|✓\|×"` | N/A |

**For TUI apps**: After `start-and-watch` confirms the app is loaded, use `capture-pane` (fast, optimistic read) or `watch-pane` with `user_input` or `idle:N` trigger to wait for the app to settle before each subsequent keystroke.
