---
name: send
description: Send keystrokes or text to an active terminal session.
allowed-tools: mcp__ht__ht_send_keys, mcp__ht__ht_take_snapshot, mcp__ht__ht_list_sessions, mcp__tmux__send-keys, mcp__tmux__capture-pane
---

# /terminal:send

> **Advanced command** — For most tasks, use `/terminal:run` (one-shot commands), `/terminal:repl` (database/REPL queries), or `/terminal:tui` (TUI navigation) instead. Use this command only when you need to send raw keystrokes manually.

Send keystrokes or text input to an active terminal session and see the result.

## Usage

```
/terminal:send {sessionId} {text or keys}
/terminal:send {sessionId} key:{KeyName}
```

## What It Does

Injects text or named keystrokes into an active terminal session, then takes a snapshot to show the result. This is the primary way to interact with TUI applications (vim, htop, lazygit, psql) after they have been started.

## How to Use

### Send plain text

Send a command or text string to be typed in the terminal:

```
/terminal:send abc-1234 ls -la src/
/terminal:send abc-1234 SELECT count(*) FROM users LIMIT 1;
```

The text will be sent as-is — it does NOT automatically add Enter at the end unless you include it explicitly.

### Send named keys

Use `key:` prefix for special keys:

```
/terminal:send abc-1234 key:Enter
/terminal:send abc-1234 key:Escape
/terminal:send abc-1234 key:Tab
/terminal:send abc-1234 key:^c
```

### Send text + Enter (run a command)

To send text and execute it:

```
/terminal:send abc-1234 "ls -la" key:Enter
```

### Navigate TUI applications

```
// In vim: enter insert mode
/terminal:send abc-1234 key:i

// In vim: save and quit
/terminal:send abc-1234 ":wq" key:Enter

// In htop: quit
/terminal:send abc-1234 key:q

// In lazygit: stage all, then commit
/terminal:send abc-1234 key:a
/terminal:send abc-1234 key:c
```

## Special Key Reference

| Key | Usage |
|-----|-------|
| `Enter` | Confirm / run command |
| `Escape` | Cancel / exit mode (vim) |
| `Tab` | Autocomplete / next field |
| `Space` | Select / toggle |
| `^c` | Interrupt (Ctrl+C) |
| `^d` | EOF / exit |
| `^l` | Clear screen |
| `Up`, `Down`, `Left`, `Right` | Arrow keys |
| `PageUp`, `PageDown` | Scroll |
| `F1` through `F12` | Function keys |

## Examples

**Run a command in an open shell session**:
```
/terminal:send abc-1234 "bun test --watch" key:Enter
```

**Navigate vim to save changes**:
```
/terminal:send abc-1234 key:Escape
/terminal:send abc-1234 ":w" key:Enter
```

**Exit a REPL cleanly**:
```
/terminal:send abc-1234 "\q" key:Enter   // psql
/terminal:send abc-1234 ".exit" key:Enter // Node.js
/terminal:send abc-1234 key:^d           // Python / shell
```

**Interrupt a stuck process**:
```
/terminal:send abc-1234 key:^c
```

## Notes

- After sending keys, a snapshot is automatically taken to show you the current screen state.
- For TUI applications, there may be a brief render delay between sending a key and the screen updating.
- Always take a snapshot to confirm the application responded as expected before sending the next keystroke.
- Session IDs can be found with `/terminal:session list`.
