# tmux-setup

Complete tmux environment for Claude Code power users. One-command install of 14 TPM plugins, 3 MadAppGang custom plugins, kill-server protection, and Claude Code session persistence.

## What gets installed

### TPM Plugins (14)

| Plugin | Purpose | Key binding |
|--------|---------|-------------|
| tpm | Plugin manager | `prefix + I` to install |
| tmux-sensible | Sane defaults (escape-time, history-limit) | — |
| tmux-yank | System clipboard integration | `y` in copy mode |
| tmux-resurrect | Save/restore sessions across restarts | `prefix + Ctrl-s` / `prefix + Ctrl-r` |
| tmux-continuum | Auto-save every 15 min, auto-restore on start | — |
| tmux-fingers | Quick-select patterns on screen | `prefix + F` |
| tmux-open | Open URLs/files from copy mode | `o` in copy mode |
| tmux-jump | Easymotion-style jump to char | `prefix + j` |
| tmux-pain-control | Pane resize bindings | `prefix + Shift+arrows` |
| tmux-fzf | Fuzzy finder for sessions/windows/panes | `prefix + f` |
| tmux-fzf-url | Fuzzy-find URLs in pane | `prefix + u` |
| vim-tmux-navigator | Seamless vim/tmux pane navigation | `Ctrl-h/j/k/l` |
| catppuccin/tmux | Mocha theme with status bar modules | — |

### MadAppGang Plugins (3)

| Plugin | Repo | Purpose |
|--------|------|---------|
| tmux-claude-continuity | `MadAppGang/tmux-claude-continuity` | Resume Claude Code sessions after tmux-resurrect restore |
| tmux-copy-image (rpaster) | `MadAppGang/tmux-copy-image` | Paste clipboard images over SSH (`prefix + V`) |
| tmux-guard | (this repo) | Block `tmux kill-server` without confirmation |

### Claude Code Integration

| Component | Description |
|-----------|-------------|
| SessionStart hook | Saves Claude session ID per pane for auto-resume |
| Stop hook | Updates session ID when `/title` changes |
| PreToolUse hook | Blocks `tmux kill-server` from Claude Code Bash tool |
| Statusline passthrough | Claude Code statusline renders inside tmux status bar |

### Custom Scripts

| Script | Location | Purpose |
|--------|----------|---------|
| host-status.sh | `~/.tmux/scripts/` | Purple hostname (local) or red (SSH) in status bar |
| tmux-guard | `~/bin/tmux` | Binary wrapper blocking kill-server |

## Install

```bash
# Full setup (interactive — prompts before overwriting)
./install.sh

# Non-interactive (for automation)
./install.sh --yes

# Components only
./install.sh --guard-only     # Just tmux-guard
./install.sh --hooks-only     # Just Claude Code hooks
./install.sh --conf-only      # Just tmux.conf
```

## What install.sh does

1. **Installs TPM** if `~/.tmux/plugins/tpm` is missing
2. **Deploys tmux.conf** to `~/.tmux.conf` (backs up existing)
3. **Installs tmux-guard** at `~/bin/tmux` (symlink to `bin/tmux-guard`)
4. **Deploys host-status.sh** to `~/.tmux/scripts/`
5. **Installs rpaster** via Homebrew (if on macOS)
6. **Configures Claude Code hooks** for tmux-claude-continuity in `~/.claude/settings.json`
7. **Runs TPM install** to fetch all plugins

## Key bindings

Prefix is `Ctrl-a` (not the default `Ctrl-b`).

| Binding | Action |
|---------|--------|
| `prefix + \|` | Split pane horizontally |
| `prefix + -` | Split pane vertically |
| `prefix + c` | New window (in current path) |
| `Ctrl-h/j/k/l` | Navigate panes (vim-style) |
| `Alt-1..5` | Switch to window 1-5 |
| `prefix + .` | Swap window to target index |
| `prefix + b` | Toggle status bar |
| `prefix + F` | Fingers (quick-select) |
| `prefix + j` | Jump to character |
| `prefix + f` | Fuzzy finder |
| `Alt-c` | Enter copy mode |
| `Alt-v` | Paste buffer |
| `prefix + V` | Paste clipboard image (rpaster) |

## tmux-guard

Blocks `tmux kill-server` from accidental or automated execution.

**Three override methods:**
```bash
# Interactive: prompted to type 'kill' + sees session count
tmux kill-server

# Env var override
TMUX_ALLOW_KILL=1 tmux kill-server

# Flag override
tmux kill-server --i-mean-it
```

**Audit log:** `$TMPDIR/tmux-guard.log` — records every blocked attempt with caller PID and process name.

## Uninstall

```bash
# Remove tmux-guard
rm ~/bin/tmux

# Remove Claude Code hooks (edit manually)
# Remove the SessionStart and Stop hooks from ~/.claude/settings.json

# Remove tmux.conf (restore backup)
mv ~/.tmux.conf.backup ~/.tmux.conf
```
