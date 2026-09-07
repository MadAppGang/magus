---
name: snapshot
description: Captures the current screen of a slot as text, with optional scrollback, or renders it as an image. Use to read raw pane content from a slot this session opened.
allowed-tools: mcp__plugin_terminal_mux__capture-pane, mcp__plugin_terminal_mux__screenshot-pane, mcp__plugin_terminal_mux__list-slots
---

# /terminal:snapshot

> **Advanced command** — for most tasks, use `/terminal:observe` instead; it lists slots and captures them in one step. Use this command for raw capture control.

Reads the current screen content of a slot exactly as a person would see it in that terminal.

## Usage

```
/terminal:snapshot [slot] [--lines N] [--visual]
```

- `slot` defaults to 1.
- `--lines N` includes the last N lines of scrollback above the viewport.
- `--visual` returns a rendered image of the pane instead of text.

## How to Use

### Snapshot a slot

```
/terminal:snapshot 2
→ mcp__plugin_terminal_mux__capture-pane({ slot: 2 })
→ text content; structuredContent { "slot": 2 }
```

### Snapshot with scrollback

```
/terminal:snapshot 1 --lines 200
→ mcp__plugin_terminal_mux__capture-pane({ slot: 1, lines: 200 })
```

### Visual snapshot

```
/terminal:snapshot 2 --visual
→ mcp__plugin_terminal_mux__screenshot-pane({ slot: 2 })
```

Renders the pane as an image, useful for TUI layouts where text capture loses structure.

## Errors

A slot that was never opened is an error (`slot 2 does not exist; open it with open-pane or by running something in it`, per spec). `capture-pane` is a reading tool: it never creates a pane. `mcp__plugin_terminal_mux__list-slots` shows which slots exist.

## Notes

- For output longer than the viewport, `--lines 200`, or pipe the command's output to a file and `Read` it.
- For monitoring that waits for a change, use `/terminal:observe {slot} --watch` instead.
