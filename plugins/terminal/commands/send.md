---
name: send
description: Send keystrokes or text to an active terminal session.
allowed-tools: mcp__tmux__send-keys, mcp__tmux__capture-pane, mcp__tmux__pane-state, mcp__tmux__list-sessions
---

# /terminal:send

> **Advanced command** — For most tasks, use `/terminal:run` (one-shot commands), `/terminal:repl` (database/REPL queries), or `/terminal:tui` (TUI navigation) instead. Use this command only when you need to send raw keystrokes manually.

Send keystrokes or text input to an active terminal pane and see the result.

## Usage

```
/terminal:send {paneId} {text or keys}
/terminal:send {paneId} key:{KeyName}
```

Pane IDs use the format `%N` (e.g., `%3`) or `headless:%N` (e.g., `headless:%0`).

## send-keys Parameter Reference

```
mcp__tmux__send-keys({ paneId: "%66", keys: "...", literal: ? })

  literal: true  (default) — text is sent byte-for-byte; special characters are NOT
                             interpreted as key sequences. Use for typing commands.
  literal: false           — text is interpreted as tmux key names. Use for:
                             - Control sequences: "C-c", "C-d", "Escape", "Enter"
                             - Arrow keys: "Up", "Down", "Left", "Right"
                             - Function keys: "F1" through "F12"

To type text AND execute (press Enter):
  mcp__tmux__send-keys({ paneId, keys: "bun test --watch", literal: true })
  mcp__tmux__send-keys({ paneId, keys: "Enter", literal: false })
```

## What It Does

Injects text or named keystrokes into an active terminal pane, then takes a `capture-pane` snapshot to show the result.

## How to Use

### Send plain text

Send a command or text string to be typed in the terminal:

```
/terminal:send %3 ls -la src/
/terminal:send headless:%0 SELECT count(*) FROM users LIMIT 1;
```

The text will be sent as-is with `literal: true` — it does NOT automatically add Enter at the end.

### Send named keys

Use `key:` prefix for special keys (sent with `literal: false`):

```
/terminal:send %3 key:Enter
/terminal:send %3 key:Escape
/terminal:send %3 key:Tab
/terminal:send %3 key:C-c
```

### Send text + Enter (run a command)

To send text and execute it — two separate calls:

```
/terminal:send %3 "ls -la"       ← literal: true
/terminal:send %3 key:Enter      ← literal: false
```

### Navigate TUI applications

```
// In vim: enter insert mode
/terminal:send headless:%0 key:i

// In vim: save and quit
/terminal:send headless:%0 ":wq"
/terminal:send headless:%0 key:Enter

// In htop: quit
/terminal:send headless:%0 key:q

// In lazygit: stage all, then commit
/terminal:send headless:%0 key:a
/terminal:send headless:%0 key:c
```

## Special Key Reference

| Key | tmux Name |
|-----|-----------|
| Enter | `Enter` |
| Escape | `Escape` |
| Tab | `Tab` |
| Space | `Space` |
| Ctrl+C | `C-c` |
| Ctrl+D | `C-d` |
| Ctrl+L | `C-l` |
| Up arrow | `Up` |
| Down arrow | `Down` |
| Left arrow | `Left` |
| Right arrow | `Right` |
| Page Up | `PageUp` |
| Page Down | `PageDown` |
| F1–F12 | `F1` through `F12` |

## Examples

**Run a command in an open shell pane**:
```
/terminal:send %3 "bun test --watch"
/terminal:send %3 key:Enter
```

**Navigate vim to save changes**:
```
/terminal:send headless:%0 key:Escape
/terminal:send headless:%0 ":w"
/terminal:send headless:%0 key:Enter
```

**Exit a REPL cleanly**:
```
/terminal:send headless:%0 "\\q"        // psql
/terminal:send headless:%0 key:Enter
/terminal:send headless:%0 ".exit"      // Node.js
/terminal:send headless:%0 key:Enter
/terminal:send headless:%0 key:C-d      // Python / shell
```

**Interrupt a stuck process**:
```
/terminal:send %3 key:C-c
```

## Notes

- After sending keys, take a `capture-pane` snapshot to show the current pane state.
- For TUI applications, there may be a brief render delay between sending a key and the screen updating. Use `watch-pane` with `idle:2` if you need to wait for the TUI to settle.
- Find active pane IDs with `/terminal:session list`.
