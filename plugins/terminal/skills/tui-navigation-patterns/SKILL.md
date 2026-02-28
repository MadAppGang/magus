---
name: tui-navigation-patterns
description: Key sequences and navigation patterns for common TUI applications. Use when navigating vim, nano, htop, less, psql, lazygit, k9s, tig, btop, or other terminal user interfaces. Also triggers on database shell navigation, git TUI operations, and system monitoring.
version: 2.0.0
tags: [terminal, tui, navigation, keys, vim, nano, htop, git-tui, database-shell, system-monitor]
keywords: [vim, nano, htop, btop, less, psql, lazygit, tig, k9s, docker, mongosh, redis-cli, turso, key sequence, navigation, escape, git tui, stage commit, database shell, system monitor, process manager, file editor, terminal editor]
plugin: terminal
updated: 2026-02-28
---

# TUI Navigation Patterns

Key sequences and navigation patterns for common TUI applications. Use with `mcp__ht__ht_send_keys` or `mcp__tmux__send-keys`.

---

## Key Name Quick Reference

When using `mcp__ht__ht_send_keys`, keys are sent as an array of strings:

```
mcp__ht__ht_send_keys({ sessionId, keys: ["Escape"] })
mcp__ht__ht_send_keys({ sessionId, keys: [":wq", "Enter"] })
mcp__ht__ht_send_keys({ sessionId, keys: ["^c"] })
```

| What you want | Key string to use |
|--------------|-------------------|
| Enter / Return | `"Enter"` |
| Escape | `"Escape"` |
| Space | `"Space"` |
| Tab | `"Tab"` |
| Arrow Up | `"Up"` |
| Arrow Down | `"Down"` |
| Arrow Left | `"Left"` |
| Arrow Right | `"Right"` |
| Page Up | `"PageUp"` |
| Page Down | `"PageDown"` |
| Home | `"Home"` |
| End | `"End"` |
| F1–F12 | `"F1"`, `"F2"`, ..., `"F12"` |
| Ctrl+C (interrupt) | `"^c"` or `"C-c"` |
| Ctrl+D (EOF / exit) | `"^d"` or `"C-d"` |
| Ctrl+L (clear screen) | `"^l"` or `"C-l"` |
| Ctrl+Z (suspend) | `"^z"` or `"C-z"` |
| Ctrl+X | `"^x"` or `"C-x"` |
| Ctrl+O | `"^o"` or `"C-o"` |
| Ctrl+W | `"^w"` or `"C-w"` |
| Ctrl+K | `"^k"` or `"C-k"` |
| Ctrl+U | `"^u"` or `"C-u"` |
| Shift+F6 | `"S-F6"` |
| Alt+x | `"A-x"` |

**Prefer caret notation** (`^c`) over C- notation for reliability on ht-mcp.

---

## General Terminal Controls

These work in almost any terminal context:

| Action | Keys |
|--------|------|
| Interrupt running process | `^c` |
| Send EOF / exit shell | `^d` |
| Suspend process (move to background) | `^z` |
| Clear screen (redraw) | `^l` |
| Kill current line (clear input) | `^u` |
| Delete word before cursor | `^w` |

```
// Interrupt a stuck process
mcp__ht__ht_send_keys({ sessionId, keys: ["^c"] })

// Exit a shell or REPL
mcp__ht__ht_send_keys({ sessionId, keys: ["^d"] })
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
| Redo | `^r` | Normal mode |
| Search forward | `/pattern` + `Enter` | Normal mode |
| Search backward | `?pattern` + `Enter` | Normal mode |
| Next search result | `n` | Normal mode |
| Previous search result | `N` | Normal mode |
| Page down | `^f` | Normal mode |
| Page up | `^b` | Normal mode |

### vim Workflow Example

```
// Open a file, add a line at the end, save and quit
mcp__ht__ht_execute_command({ sessionId, command: "vim myfile.ts" })
// Take snapshot to confirm vim is open
mcp__ht__ht_take_snapshot({ sessionId })
// Go to end of file
mcp__ht__ht_send_keys({ sessionId, keys: ["G"] })
// Enter insert mode on new line below
mcp__ht__ht_send_keys({ sessionId, keys: ["o"] })
// Type content
mcp__ht__ht_send_keys({ sessionId, keys: ["// Added by Claude"] })
// Return to normal mode
mcp__ht__ht_send_keys({ sessionId, keys: ["Escape"] })
// Save and quit
mcp__ht__ht_send_keys({ sessionId, keys: [":wq", "Enter"] })
```

---

## nano

nano is simpler than vim — no mode switching. Ctrl shortcuts are shown in the bottom bar.

| Action | Keys |
|--------|------|
| Save file | `^o` then `Enter` (confirm filename) |
| Exit | `^x` |
| Search | `^w` then type pattern + `Enter` |
| Search and replace | `^\` |
| Cut current line | `^k` |
| Paste cut line | `^u` |
| Go to line N | `^_` (Ctrl+Underscore) |
| Page down | `^v` |
| Page up | `^y` |

```
// Edit a file in nano, save, and exit
mcp__ht__ht_execute_command({ sessionId, command: "nano myfile.txt" })
// Type some content
mcp__ht__ht_send_keys({ sessionId, keys: ["Hello from Claude"] })
// Save: Ctrl+O
mcp__ht__ht_send_keys({ sessionId, keys: ["^o"] })
// Confirm filename with Enter
mcp__ht__ht_send_keys({ sessionId, keys: ["Enter"] })
// Exit: Ctrl+X
mcp__ht__ht_send_keys({ sessionId, keys: ["^x"] })
```

---

## htop / btop

System monitors. Read-only — never send destructive keys without user confirmation.

### htop

| Action | Keys |
|--------|------|
| Quit | `q` |
| Sort by column | `F6` |
| Kill selected process | `F9` (requires user confirmation) |
| Toggle tree view | `F5` |
| Search processes | `F3` |
| Filter processes | `F4` |
| Help | `F1` |
| Navigate processes | `Up`, `Down` |
| Scroll right (long process names) | `Right` |

### btop

| Action | Keys |
|--------|------|
| Quit | `q` |
| Navigate between panels | `Tab` |
| Kill selected process | `k` |
| Sort options | `f` |
| Toggle CPU core graph | `1` |
| Help | `h` |

```
// Read system stats from htop
mcp__ht__ht_execute_command({ sessionId, command: "htop" })
mcp__ht__ht_take_snapshot({ sessionId })  // read CPU/memory from snapshot
// Quit cleanly
mcp__ht__ht_send_keys({ sessionId, keys: ["q"] })
```

---

## less / man (Pagers)

| Action | Keys |
|--------|------|
| Quit | `q` |
| Page down | `f` or `Space` |
| Page up | `b` |
| Go to end | `G` |
| Go to start | `g` |
| Search forward | `/pattern` + `Enter` |
| Search backward | `?pattern` + `Enter` |
| Next search result | `n` |
| Previous search result | `N` |
| Toggle line numbers | `-N` |

```
// Read a man page
mcp__ht__ht_execute_command({ sessionId, command: "man curl" })
// Search for "timeout"
mcp__ht__ht_send_keys({ sessionId, keys: ["/timeout", "Enter"] })
mcp__ht__ht_take_snapshot({ sessionId })
// Quit
mcp__ht__ht_send_keys({ sessionId, keys: ["q"] })
```

---

## psql (PostgreSQL CLI)

psql prompts: `=#` (normal), `=#` (superuser), `-#` (command continuation), `=#` (in a multi-line query)

| Action | Keys / Command |
|--------|---------------|
| Quit | `\q` + `Enter` |
| List databases | `\l` + `Enter` |
| List tables | `\dt` + `Enter` |
| Describe table | `\d tablename` + `Enter` |
| List schemas | `\dn` + `Enter` |
| Show current database | `SELECT current_database();` + `Enter` |
| Cancel query | `^c` |

```
// Connect and run a query
mcp__ht__ht_execute_command({ sessionId, command: "psql $DATABASE_URL" })
// Wait for psql prompt (look for "=#" in snapshot)
mcp__ht__ht_take_snapshot({ sessionId })
// Run query (add LIMIT to stay within 40-line rule)
mcp__ht__ht_send_keys({ sessionId, keys: ["SELECT id, email FROM users ORDER BY id LIMIT 10;", "Enter"] })
mcp__ht__ht_take_snapshot({ sessionId })
// Quit cleanly
mcp__ht__ht_send_keys({ sessionId, keys: ["\\q", "Enter"] })
```

**40-Line Rule for psql**: Always add `LIMIT 40` or fewer to queries. Results beyond 40 rows will scroll off-screen and be lost.

---

## mongosh (MongoDB Shell)

| Action | Command |
|--------|---------|
| Quit | `.exit` + `Enter` or `^d` |
| List databases | `show dbs` + `Enter` |
| Use database | `use mydb` + `Enter` |
| List collections | `show collections` + `Enter` |
| Find documents | `db.collection.find({}).limit(10)` + `Enter` |
| Cancel | `^c` |

```
// Query MongoDB
mcp__ht__ht_execute_command({ sessionId, command: "mongosh $MONGO_URI" })
// Wait for ">" prompt in snapshot
mcp__ht__ht_take_snapshot({ sessionId })
mcp__ht__ht_send_keys({ sessionId, keys: ["db.users.find({}).limit(5).pretty()", "Enter"] })
mcp__ht__ht_take_snapshot({ sessionId })
mcp__ht__ht_send_keys({ sessionId, keys: [".exit", "Enter"] })
```

---

## redis-cli

| Action | Command |
|--------|---------|
| Quit | `quit` + `Enter` or `^d` |
| List all keys | `KEYS *` + `Enter` (careful in production) |
| Get value | `GET keyname` + `Enter` |
| Set value | `SET keyname value` + `Enter` |
| Delete key | `DEL keyname` + `Enter` |
| Server info | `INFO` + `Enter` |
| Select database | `SELECT 0` + `Enter` (0-15) |
| Flush current db | `FLUSHDB` + `Enter` (destructive — confirm first) |

```
// Check Redis
mcp__ht__ht_execute_command({ sessionId, command: "redis-cli" })
mcp__ht__ht_take_snapshot({ sessionId })  // should see 127.0.0.1:6379> prompt
mcp__ht__ht_send_keys({ sessionId, keys: ["INFO server", "Enter"] })
mcp__ht__ht_take_snapshot({ sessionId })
mcp__ht__ht_send_keys({ sessionId, keys: ["quit", "Enter"] })
```

---

## turso (Turso DB Shell)

| Action | Command |
|--------|---------|
| Quit | `.quit` + `Enter` |
| List tables | `.tables` + `Enter` |
| Describe table | `.schema tablename` + `Enter` |
| Run SQL | Type SQL query + `Enter` |

```
mcp__ht__ht_execute_command({ sessionId, command: "turso db shell mydb" })
mcp__ht__ht_take_snapshot({ sessionId })
mcp__ht__ht_send_keys({ sessionId, keys: ["SELECT * FROM users LIMIT 5;", "Enter"] })
mcp__ht__ht_take_snapshot({ sessionId })
mcp__ht__ht_send_keys({ sessionId, keys: [".quit", "Enter"] })
```

---

## lazygit

lazygit is a popular TUI for git. It uses a panel-based layout.

| Action | Keys |
|--------|------|
| Quit | `q` |
| Navigate panels | Arrow keys |
| Select / confirm | `Enter` |
| Stage/unstage file | `Space` |
| Stage all | `a` |
| Commit | `c` |
| Push | `P` (capital P) |
| Pull | `p` (lowercase p) |
| Create branch | `n` |
| Checkout branch | `Space` on branch list |
| Force push | `shift+P` |
| Open file in editor | `e` |
| View diff | `d` |
| View log | `l` |
| Help | `?` |
| Switch panel | `Tab` (or `[` / `]`) |

```
// Stage and commit changes
mcp__ht__ht_execute_command({ sessionId, command: "lazygit" })
mcp__ht__ht_take_snapshot({ sessionId })  // see current state
// Navigate to Files panel (usually already selected)
mcp__ht__ht_send_keys({ sessionId, keys: ["a"] })  // stage all files
mcp__ht__ht_take_snapshot({ sessionId })  // verify staged
mcp__ht__ht_send_keys({ sessionId, keys: ["c"] })  // open commit dialog
// Type commit message
mcp__ht__ht_send_keys({ sessionId, keys: ["fix: update auth flow"] })
mcp__ht__ht_send_keys({ sessionId, keys: ["Enter"] })  // confirm commit
mcp__ht__ht_take_snapshot({ sessionId })  // verify commit created
mcp__ht__ht_send_keys({ sessionId, keys: ["q"] })  // quit lazygit
```

---

## tig (Text-mode Interface for Git)

tig is an ncurses-based git repository browser.

| Action | Keys |
|--------|------|
| Quit | `q` |
| Navigate entries | `Up`, `Down` |
| Open / enter | `Enter` |
| Go back | `Escape` |
| Toggle diff | `d` |
| Toggle blame | `b` |
| Search | `/` |
| Refresh | `F5` |
| Help | `h` |

---

## k9s (Kubernetes TUI)

| Action | Keys |
|--------|------|
| Quit | `q` or `Ctrl+C` |
| Navigate resources | Arrow keys |
| Select resource | `Enter` |
| Delete resource | `Ctrl+D` |
| Describe resource | `D` |
| View logs | `l` |
| Shell into pod | `s` |
| Switch namespace | `:ns` + `Enter` |
| Filter | `/pattern` |
| Sort | `Shift+{col_key}` |

---

## Docker (docker logs follow mode)

| Action | Method |
|--------|--------|
| Stop following logs | `^c` (Ctrl+C) |
| Start following | `docker logs -f {container}` |
| Show last N lines | `docker logs --tail=40 {container}` |

**40-Line Rule**: `docker logs --tail=40 {container}` limits output to fit within ht-mcp snapshot.

```
// Follow container logs
mcp__ht__ht_execute_command({ sessionId, command: "docker logs -f myapp" })
// Take snapshot to read latest log lines
mcp__ht__ht_take_snapshot({ sessionId })
// Stop following
mcp__ht__ht_send_keys({ sessionId, keys: ["^c"] })
```

---

## Node.js / Bun REPL

| Action | Method |
|--------|--------|
| Quit | `.exit` + `Enter` or `^d` |
| Execute expression | Type expression + `Enter` |
| Multi-line input | Start with `{` and press `Enter` to continue |
| Tab completion | `Tab` |
| Clear screen | `^l` |

---

## Python REPL

| Action | Method |
|--------|--------|
| Quit | `quit()` + `Enter` or `^d` |
| Execute expression | Type expression + `Enter` |
| Multi-line input | Indent with spaces, blank line to execute |
| Tab completion | `Tab` |
| Help on object | `help(obj)` + `Enter` |

---

## irb (Ruby REPL)

| Action | Method |
|--------|--------|
| Quit | `exit` + `Enter` or `^d` |
| Execute expression | Type expression + `Enter` |

---

## Application Detection Quick Reference

Use this table to detect what application is running from a snapshot:

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

After launching a TUI or REPL, poll `ht_take_snapshot` and check for these patterns before interacting:

| Application | Ready Signal |
|-------------|-------------|
| psql | `=#` at end of line |
| mongosh | `>` at end of line after connection |
| redis-cli | `127.0.0.1:6379>` |
| Node REPL | `>` at end of line |
| Python REPL | `>>>` at end of line |
| vim | Visible tildes `~` on blank lines |
| Server startup | `listening on`, `ready on`, `started`, `Local:` |
| Build complete | `done in`, `built in`, `compiled` |
| Test complete | `passed`, `failed`, `✓`, `×` |
