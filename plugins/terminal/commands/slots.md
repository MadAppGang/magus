---
name: slots
description: Lists the slots this session holds and closes one or all of them. Use to find a slot number after compaction, or to clean up panes left open by /terminal:watch, /terminal:repl, or /terminal:tui.
allowed-tools: mcp__plugin_terminal_mux__list-slots, mcp__plugin_terminal_mux__close-pane
---

# /terminal:slots

> **Advanced command** — `/terminal:run` and `/terminal:repl` close their own slots. Use this command to see what is still open and to close what `/terminal:watch` and `/terminal:tui` leave running.

A slot is a numbered pane (1 to 64) the server places and owns. Slot 1 is the visible helper beside the user; higher slots may be visible or isolated. This command is a front for `list-slots` and `close-pane`.

## Usage

```
/terminal:slots
/terminal:slots list
/terminal:slots close {N}
/terminal:slots close all
```

## Subcommands

### list — show every slot this session holds

```
mcp__plugin_terminal_mux__list-slots()
→ [{ "slot": 2, "isolated": true, "origin": "created", "foregroundCmd": "Python", "isAlive": true }]
```

An empty array means nothing is open:

```
→ []
```

Use it to recover a slot number after context compaction, to pick a free number before `isolated: true`, and to confirm a close succeeded.

### close N — close one slot

```
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
→ [{ "slot": 2, "action": "killed" }]
```

Closing interrupts whatever runs in the pane; no exit command is needed first. `close-pane` closes whichever kind of pane the slot holds and does not accept `isolated`.

### close all — close every slot

```
mcp__plugin_terminal_mux__close-pane({ slot: "all" })
→ [{ "slot": 1, "action": "killed" }, { "slot": 2, "action": "killed" }]
```

Closes visible and isolated slots alike. Useful after a long workflow.

## Examples

```
/terminal:slots              What is still open?
/terminal:slots close 1      Stop the dev server running in slot 1
/terminal:slots close all    Clean up everything
```

## Notes

- Slots live in the server, not in context: they survive compaction, and `list` is how you find them again.
- A slot's kind (visible or isolated) is fixed when it is opened; to change it, close the slot and reopen it.
- Slots are never the user's own pane. There is nothing here that lists or closes the user's tmux sessions.
