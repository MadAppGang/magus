---
name: tui
description: Launch and navigate TUI (terminal user interface) applications like vim, lazygit, htop, k9s, tig. Delegates to the tui-navigator agent for multi-step interaction.
allowed-tools: mcp__tmux__create-headless, mcp__tmux__start-and-watch, mcp__tmux__watch-pane, mcp__tmux__send-keys, mcp__tmux__capture-pane, mcp__tmux__pane-state, mcp__tmux__kill-session, mcp__tmux__resize-pane
---

# /terminal:tui

Launch a TUI (terminal user interface) application and navigate it interactively. This command handles screen-based applications that require multi-step keystroke interaction.

## Usage

```
/terminal:tui {application} [arguments]
```

## Examples

```
/terminal:tui vim src/index.ts
/terminal:tui lazygit
/terminal:tui htop
/terminal:tui k9s
/terminal:tui tig
/terminal:tui "nano config.yaml"
/terminal:tui btop
```

## What It Does

1. **Creates** a headless session with `create-headless`
2. **Launches** and monitors TUI app load with `start-and-watch` using an app-specific load pattern
3. **Navigates** using `send-keys` (tmux key syntax, `literal: false` for special keys)
4. **After each navigation action**: either `capture-pane` (quick read) or `watch-pane` with
   `user_input` or `idle:N` trigger (wait for TUI to settle before next keystroke)
5. **Reports** findings
6. **Exits** cleanly using app-specific quit sequence
7. **Kills** the headless session with `kill-session`

## Supported Applications

| Application | Category | Key Features |
|-------------|----------|-------------|
| vim / neovim | Text Editor | Modes (normal/insert/visual), file editing |
| nano | Text Editor | Simple editing, Ctrl shortcuts |
| lazygit | Git TUI | Stage, commit, push, branch management |
| tig | Git Browser | Log browsing, diff viewing |
| htop / btop | System Monitor | CPU/memory monitoring, process management |
| k9s | Kubernetes TUI | Pod management, logs, shell |
| less / man | Pagers | Page navigation, search |

## Navigation Strategy

```
1. capture-pane to detect current state (which app, which mode)
2. Send keys for desired action (send-keys with literal: false for special keys)
3. Wait for TUI to update — one of:
   a. capture-pane (fast, optimistic — works if TUI redraws quickly)
   b. watch-pane({ triggers: "user_input,idle:2", timeout: 5 }) — wait for
      app to be waiting for user input again before sending next keystroke
4. Repeat until task complete
5. Exit using app-specific quit sequence
6. kill-session to clean up
```

### Application detection
Detect which app is running from `capture-pane` content:
- `~` column with status bar → vim
- `GNU nano` in top bar → nano
- Commit list with branch panel → lazygit
- CPU bars and process list → htop
- Kubernetes resource table → k9s

### App Load Patterns for start-and-watch

| Application | `pattern` |
|-------------|-----------|
| vim | `"~"` (blank line tilde indicates loaded) |
| lazygit | `"Commit list\|Files\|Branches"` |
| htop / btop | `"CPU\|Mem"` |
| k9s | `"Pods\|Deployments\|Nodes"` |
| nano | `"GNU nano"` |

## Error Handling

| Situation | Recovery |
|-----------|----------|
| App not installed | Report error, suggest install command |
| TUI stuck/unresponsive (`watch-pane` fires `idle:N`) | Try `q`, `Escape`, then `C-c` via `send-keys` with `literal: false` |
| Wrong mode (vim) | Send `Escape` with `literal: false` to return to normal mode |
| Confirmation dialog | Pause and ask user before confirming |
| Password prompt (`pane-state.waitingForInput == true`) | STOP — never send credentials |

## Notes

- Headless sessions have no fixed terminal size — use `resize-pane` if the app requires a specific size
- For simple commands (not full-screen TUI), use `/terminal:run` instead
- For database REPLs, use `/terminal:repl` instead (better prompt detection)
- For long-running processes, use `/terminal:watch` instead
