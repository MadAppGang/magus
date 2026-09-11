---
name: tui-navigation-patterns
description: Provides key sequences and navigation patterns for common TUI apps. Use when navigating vim, nano, htop, less, psql, lazygit, k9s, tig, btop, or sending keystrokes to a database shell.
user-invocable: false
---

# TUI Navigation Patterns

Key sequences and navigation patterns for common TUI applications. Use with
`mcp__plugin_terminal_mux__send-keys`.

## Slot convention

Every tool addresses a pane by **slot**, an integer 1–64. The same number returns the same
pane on every call; a slot is never the agent's own pane.

- **Slot 1** is the visible helper pane beside the user. Use it when the user asked to see
  the app, or when the app needs a fixed screen size (isolated panes have no window and no
  fixed size — a layout-sensitive TUI belongs on slot 1).
- **Slot 2 or higher with `isolated: true`** runs the app where nobody can see it. That is
  the default for every example below: a REPL or editor the user did not ask to watch
  should not appear beside them.
- `isolated: true` needs an explicit slot on every tool. Omitting it produces:
  `isolated needs a slot number, because a pane you cannot see must be addressable later`.
- A slot's kind is fixed at creation. Reusing slot 2 without `isolated` after it was opened
  isolated errors with `slot 2 is an isolated pane; close it or use another slot`.
- Finish with `mcp__plugin_terminal_mux__close-pane({ slot: 2 })` →
  `[{"slot":2,"action":"killed"}]`. Call `mcp__plugin_terminal_mux__list-slots` first when
  you may already hold slots (after compaction); it returns a bare array, `[]` when empty.

The lifecycle every TUI or REPL session below follows:

```
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command, pattern, timeout })
  → { slot: 2, created: true, event: "pattern:…", detail, elapsed, output, paneState }
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys, literal })      // or run-in-repl for REPLs
mcp__plugin_terminal_mux__capture-pane({ slot: 2 })                  // read the screen
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
```

---

## send-keys Parameter Guide

`mcp__plugin_terminal_mux__send-keys` takes a single `keys` string (not an array). The
`literal` flag controls interpretation:

```
mcp__plugin_terminal_mux__send-keys({ slot, keys, literal, enter })

  literal: true  (default) — text sent byte-for-byte; special chars NOT interpreted
           Use for: typing commands, text to insert, query strings

  literal: false — text interpreted as a named key
           Use for: control sequences, navigation keys, any non-printable key

  enter: true — append an Enter keystroke after the keys (default false)

Examples:
  mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "Escape", literal: false })
  mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: ":wq", literal: true })
  mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "Enter", literal: false })
  mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "C-c", literal: false })
```

Every call returns `{ slot, created }`; `created: true` means the slot was opened by this
call, `false` means the pane already existed.

**To type text then press Enter**, one call with `enter: true`:
```
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "ls -la", enter: true })
```

**Named keys** (`literal: false`). This is the whole vocabulary the contract guarantees:

| What you want | Keys string | literal |
|--------------|-------------|---------|
| Enter / Return | `"Enter"` | `false` |
| Escape | `"Escape"` | `false` |
| Tab | `"Tab"` | `false` |
| Space | `"Space"` | `false` |
| Backspace | `"BSpace"` | `false` |
| Arrow Up / Down / Left / Right | `"Up"`, `"Down"`, `"Left"`, `"Right"` | `false` |
| Page Up / Page Down | `"PageUp"`, `"PageDown"` | `false` |
| Home / End | `"Home"`, `"End"` | `false` |
| F1–F12 | `"F1"`, `"F2"`, ..., `"F12"` | `false` |
| Ctrl+x (any letter) | `"C-x"` — e.g. `"C-c"`, `"C-d"`, `"C-l"`, `"C-z"` | `false` |
| Alt+x (any letter) | `"M-x"` | `false` |
| Type plain text | `"my text here"` | `true` (default) |

Any other name passes through to tmux unmapped and is not portable.

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
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "C-c", literal: false })   // interrupt a stuck process
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
// Launch vim in an isolated slot
mcp__plugin_terminal_mux__start-and-watch({
  slot: 2,
  isolated: true,
  command: "vim myfile.ts",
  pattern: "~",          // vim blank line tildes indicate loaded
  timeout: 10
}) → WatchResult

mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "G", literal: true })        // end of file
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "o", literal: true })        // insert on new line below
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "// Added by Claude", literal: true })
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "Escape", literal: false })  // back to normal mode
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: ":wq", enter: true })        // save and quit
// Wait for shell prompt to return
mcp__plugin_terminal_mux__watch-pane({ slot: 2, triggers: "shell,idle:2", timeout: 10 }) → WatchResult
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "nano myfile.txt", pattern: "GNU nano", timeout: 10 })
// Type some content
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "Hello from Claude", literal: true })
// Save: Ctrl+O
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "C-o", literal: false })
// Confirm filename with Enter
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "Enter", literal: false })
// Exit: Ctrl+X
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "C-x", literal: false })
mcp__plugin_terminal_mux__watch-pane({ slot: 2, triggers: "shell,idle:2", timeout: 10 })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
```

---

## htop / btop

System monitors. Read-only — never send destructive keys unless the user approved them (in person on the main thread; in the dispatching prompt for a subagent).

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
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "htop", pattern: "CPU\\[", timeout: 10 })  // pattern: CPU bar header
mcp__plugin_terminal_mux__capture-pane({ slot: 2 })  // read CPU/memory
// Quit cleanly
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "q", literal: true })
mcp__plugin_terminal_mux__watch-pane({ slot: 2, triggers: "shell,idle:2", timeout: 5 })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "man curl", pattern: "CURL", timeout: 10 })
// Search for "timeout"
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "/timeout", enter: true })
mcp__plugin_terminal_mux__capture-pane({ slot: 2 })
// Quit
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "q", literal: true })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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

Prefer `run-in-repl` for psql interactions — it handles prompt detection and returns clean
output. `exited` is always present in its response: `true` means the REPL process ended.

```
// Connect and run queries using run-in-repl
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "psql $DATABASE_URL", pattern: "=#", timeout: 15 })
  → WatchResult

// Run query — output returned directly, no screen scraping
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "SELECT id, email FROM users ORDER BY id LIMIT 10;", promptPattern: "=#", timeout: 10 })
  → { slot: 2, created: false, output: "...", exited: false }

// Quit cleanly
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "\\q", promptPattern: "\\$", timeout: 5 })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "mongosh $MONGO_URI", pattern: ">", timeout: 15 })
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "db.users.find({}).limit(5)", promptPattern: ">", timeout: 10 })
  → { slot: 2, created: false, output: "...", exited: false }
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: ".exit", promptPattern: "\\$", timeout: 5 })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "redis-cli", pattern: "127\\.0\\.0\\.1:\\d+>", timeout: 10 })
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "INFO server", promptPattern: "127\\.0\\.0\\.1:\\d+>", timeout: 10 })
  → { slot: 2, created: false, output: "...", exited: false }
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "quit", promptPattern: "\\$", timeout: 5 })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "turso db shell mydb", pattern: ">", timeout: 15 })
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "SELECT * FROM users LIMIT 5;", promptPattern: ">", timeout: 10 })
  → { slot: 2, created: false, output: "...", exited: false }
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: ".quit", promptPattern: "\\$", timeout: 5 })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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
// Launch lazygit in an isolated slot
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "lazygit", pattern: "Commit list|Files|Branches", timeout: 10 })

// Stage and commit changes
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "a", literal: true })   // stage all
mcp__plugin_terminal_mux__capture-pane({ slot: 2 })  // verify staged
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "c", literal: true })   // open commit dialog
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "fix: update auth flow", enter: true })
mcp__plugin_terminal_mux__capture-pane({ slot: 2 })  // verify commit created
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "q", literal: true })   // quit
mcp__plugin_terminal_mux__watch-pane({ slot: 2, triggers: "shell,idle:2", timeout: 10 })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "docker logs -f myapp", pattern: "started|ready|listening", triggers: "error,exit", timeout: 30 })
// Read latest log lines via scrollback
mcp__plugin_terminal_mux__capture-pane({ slot: 2, lines: 50 })
// Stop following
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "C-c", literal: false })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "node", pattern: "> ", timeout: 10 })
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "1 + 1", promptPattern: "> ", timeout: 5 })
  → { slot: 2, created: false, output: "1 + 1\n2", exited: false }
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: ".exit", promptPattern: "\\$", timeout: 5 })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
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

Observed round trip:

```
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "python3", pattern: ">>>" })
  → { slot: 2, created: true, event: "pattern:>>>", detail: "Ready — matched: >>>", elapsed: 0.51,
      output: "…", paneState: { foregroundCmd: "Python", isAlive: true, waitingForInput: true, … } }
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "1+1", promptPattern: ">>>" })
  → { slot: 2, created: false, output: "1+1\n2", exited: false }
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
  → [{ slot: 2, action: "killed" }]
```

---

## irb (Ruby REPL)

| Action | Method |
|--------|--------|
| Quit | `exit` + Enter or `C-d` |
| Execute expression | Type expression + Enter |

---

## Application Detection Quick Reference

Use this table to detect what application is running from a `capture-pane` snapshot, or
from the `foregroundCmd` field of `pane-state` / `list-slots`:

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

Use `start-and-watch` with a `pattern` matching the app's ready state. For REPLs, then use
`run-in-repl` for subsequent interactions — it handles prompt detection automatically.

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

**For TUI apps**: After `start-and-watch` confirms the app is loaded, use `capture-pane`
(fast, optimistic read) or `watch-pane` with `user_input` or `idle:N` trigger to wait for
the app to settle before each subsequent keystroke.
