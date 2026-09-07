---
name: tui
description: Launches a TUI application such as vim, lazygit, htop, k9s, or tig in a slot and navigates it with keystrokes and screen reads. Delegates multi-step interaction to the tui-navigator agent.
allowed-tools: mcp__plugin_terminal_mux__open-pane, mcp__plugin_terminal_mux__start-and-watch, mcp__plugin_terminal_mux__watch-pane, mcp__plugin_terminal_mux__send-keys, mcp__plugin_terminal_mux__capture-pane, mcp__plugin_terminal_mux__screenshot-pane, mcp__plugin_terminal_mux__pane-state, mcp__plugin_terminal_mux__close-pane, mcp__plugin_terminal_mux__list-slots
---

# /terminal:tui

Launches a full-screen terminal application and drives it interactively: send keys, read the screen, repeat until the task is done, then quit and close the slot.

## Usage

```
/terminal:tui {application} [arguments]
/terminal:tui {application} [arguments] --beside
```

- **Default**: an isolated slot (2 or higher) the user does not see.
- **`--beside`**: slot 1, the visible helper pane beside the user, so they can watch.

## Examples

```
/terminal:tui vim src/index.ts
/terminal:tui lazygit --beside
/terminal:tui htop
/terminal:tui k9s
/terminal:tui "nano config.yaml"
```

## What It Does

1. **Picks a slot**: `mcp__plugin_terminal_mux__list-slots` when slots may already be held, then the first free number from 2 (or slot 1 with `--beside`).
2. **Launches** the app and blocks until it has drawn:
   ```
   mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "vim src/index.ts", pattern: "~" })
   ```
3. **Navigates** with `mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "…", literal: false })` for named keys, `literal: true` for typed text.
4. **Reads** after each action: `capture-pane({ slot: 2 })` for a quick read, `screenshot-pane({ slot: 2 })` when layout matters, or `watch-pane({ slot: 2, triggers: "user_input,idle:2", timeout: 5 })` to wait for the app to settle.
5. **Reports** findings.
6. **Quits** with the app's own quit sequence, then `mcp__plugin_terminal_mux__close-pane({ slot: 2 })`.

## Supported Applications

| Application | Category | Load `pattern` |
|-------------|----------|----------------|
| vim / neovim | Text editor | `"~"` |
| nano | Text editor | `"GNU nano"` |
| lazygit | Git TUI | `"Commit list\|Files\|Branches"` |
| tig | Git browser | `"main\|master"` |
| htop / btop | System monitor | `"CPU\|Mem"` |
| k9s | Kubernetes TUI | `"Pods\|Deployments\|Nodes"` |
| less / man | Pagers | `":"` |

### Application detection from `capture-pane`

- `~` column with a status bar: vim
- `GNU nano` in the top bar: nano
- Commit list with a branch panel: lazygit
- CPU bars and a process list: htop
- Kubernetes resource table: k9s

## Error Handling

| Situation | Recovery |
|-----------|----------|
| App not installed | `event: "error"` or `"exit"`; report and suggest the install command |
| TUI unresponsive (`watch-pane` fires `idle:N`) | Send `q`, then `Escape`, then `C-c` with `literal: false` |
| Wrong mode (vim) | Send `Escape` with `literal: false` |
| Confirmation dialog | Pause and ask the user before confirming |
| Password prompt (`pane-state.waitingForInput: true`) | Stop; never send credentials |

## Notes

- Isolated panes have no fixed terminal size. An app that needs a specific width or height belongs in the visible pane: use `--beside` (slot 1).
- A slot's kind is fixed when opened; `slot 2 is an isolated pane; close it or use another slot` means close it or pick a different number.
- For multi-step tasks, delegate to the `terminal:tui-navigator` agent, which preloads the navigation patterns.
- For simple commands, `/terminal:run`; for database REPLs, `/terminal:repl`; for long-running processes, `/terminal:watch`.
