---
name: tui
description: Launch and navigate TUI (terminal user interface) applications like vim, lazygit, htop, k9s, tig. Delegates to the tui-navigator agent for multi-step interaction.
allowed-tools: mcp__ht__ht_create_session, mcp__ht__ht_execute_command, mcp__ht__ht_send_keys, mcp__ht__ht_take_snapshot, mcp__ht__ht_close_session, mcp__ht__ht_list_sessions
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

1. **Creates** an ht-mcp session
2. **Launches** the TUI application
3. **Takes a snapshot** to confirm the app loaded
4. **Navigates** the application using the correct key sequences
5. **Reports** what it found or accomplished
6. **Exits** the application cleanly
7. **Closes** the session

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

The command uses application-specific key sequences from the `tui-navigation-patterns` skill:

### General pattern
```
1. Take snapshot to detect current state (which app, which mode)
2. Send keys for desired action
3. Take snapshot to verify result
4. Repeat until task is complete
5. Exit application cleanly (q, :wq, ^x, etc.)
```

### Application detection
Detect which app is running from snapshot content:
- `~` column with status bar → vim
- `GNU nano` in top bar → nano
- Commit list with branch panel → lazygit
- CPU bars and process list → htop
- Kubernetes resource table → k9s

## Error Handling

| Situation | Recovery |
|-----------|----------|
| App not installed | Report error, suggest install command |
| TUI stuck/unresponsive | Try `q`, `Escape`, then `^c` |
| Wrong mode (vim) | Send `Escape` to return to normal mode |
| Confirmation dialog | Pause and ask user before confirming |
| Password prompt | STOP — never send credentials |

## Notes

- TUI apps need render time between keystrokes — always take a snapshot after sending keys to verify the screen updated
- For simple commands (not full-screen TUI), use `/terminal:run` instead
- For database REPLs, use `/terminal:repl` instead (better prompt detection)
- For long-running processes, use `/terminal:watch` instead
- The 120x40 snapshot captures exactly what a human would see on screen
