---
name: send
description: Sends text or a named key to a slot and shows the result. Use for raw keystrokes when /terminal:run, /terminal:repl, or /terminal:tui do not fit.
allowed-tools: mcp__plugin_terminal_mux__send-keys, mcp__plugin_terminal_mux__capture-pane, mcp__plugin_terminal_mux__pane-state, mcp__plugin_terminal_mux__list-slots
---

# /terminal:send

> **Advanced command** — for most tasks, use `/terminal:run` (one-shot commands), `/terminal:repl` (database and REPL queries), or `/terminal:tui` (TUI navigation) instead. Use this command only to send raw keystrokes by hand.

Types text or a named key into a slot, then captures the pane to show what happened.

## Usage

```
/terminal:send [slot] {text}
/terminal:send [slot] key:{Name}
```

`slot` defaults to 1, the visible helper pane beside the user. Slot 1 is never the user's own pane.

## send-keys Parameter Reference

```
mcp__plugin_terminal_mux__send-keys({ slot: 1, keys: "...", literal: true, enter: false })

  literal: true  (default)  text is typed byte for byte; nothing is interpreted
  literal: false            keys is a named key from the vocabulary below
  enter: true               press Enter after the text (one call, not two)
```

`send-keys` is a creating tool: if the slot is not open yet, it opens it and returns `created: true`.

```
mcp__plugin_terminal_mux__send-keys({ slot: 1, keys: "bun test --watch", enter: true })
→ { "slot": 1, "created": true }
```

## How to Use

### Send plain text

```
/terminal:send ls -la src/
/terminal:send 2 SELECT count(*) FROM users LIMIT 1;
```

Sent with `literal: true`. Enter is not added; use `key:Enter` or `enter: true`.

### Send a named key

`key:` maps to `literal: false`:

```
/terminal:send key:Enter
/terminal:send 2 key:Escape
/terminal:send 2 key:C-c
```

### Run a command (text, then Enter)

```
/terminal:send "bun test --watch"
/terminal:send key:Enter
```

Or one call: `mcp__plugin_terminal_mux__send-keys({ slot: 1, keys: "bun test --watch", enter: true })`.

## Named Key Vocabulary

These are the names the contract guarantees with `literal: false`. Anything else passes through to the tmux backend unmapped and is not portable.

| Key | Name |
|-----|------|
| Enter, Escape, Tab, Space, Backspace | `Enter`, `Escape`, `Tab`, `Space`, `BSpace` |
| Arrows | `Up`, `Down`, `Left`, `Right` |
| Paging | `PageUp`, `PageDown`, `Home`, `End` |
| Function keys | `F1` through `F12` |
| Ctrl + x | `C-x` (for example `C-c`, `C-d`, `C-l`) |
| Alt + x | `M-x` |

## Examples

**Navigate vim in slot 2 to save changes**:
```
/terminal:send 2 key:Escape
/terminal:send 2 ":w"
/terminal:send 2 key:Enter
```

**Exit a REPL cleanly**:
```
/terminal:send 2 "\\q"          psql
/terminal:send 2 key:Enter
/terminal:send 2 ".exit"        Node.js
/terminal:send 2 key:Enter
/terminal:send 2 key:C-d        Python or shell
```

**Interrupt a stuck process in slot 1**:
```
/terminal:send key:C-c
```

## Notes

- After sending, `mcp__plugin_terminal_mux__capture-pane({ slot })` shows the new pane state.
- TUI apps redraw with a short delay; `watch-pane({ slot, triggers: "idle:2" })` waits for the screen to settle.
- `mcp__plugin_terminal_mux__pane-state({ slot })` reports `waitingForInput`; if the prompt asks for a password, stop and tell the user.
- `/terminal:slots` lists the slots you hold when the number is lost.
