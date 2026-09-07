# Terminal Plugin Dependencies

This plugin requires one MCP server to be installed and available on your system.

---

## Required: tmux-mcp v2.0.0

**What it does**: tmux MCP server (Go binary). Gives Claude numbered helper slots — panes beside you in your tmux window, or isolated panes on a private server nobody sees — and runs commands, REPLs and TUI apps in them, captures their output, and closes them. Claude addresses every slot by number and never holds a pane id. The plugin's `.mcp.json` declares:

```json
{
  "mux": {
    "command": "tmux-mcp",
    "args": ["-shell-type", "zsh"]
  }
}
```

**Source**: [github.com/MadAppGang/tmux-mcp](https://github.com/MadAppGang/tmux-mcp)
**Platform**: macOS and Linux (requires tmux to be installed)

### Install

```bash
# tmux (macOS)
brew install tmux

# tmux (Ubuntu/Debian)
sudo apt-get install tmux

# tmux-mcp, the exact version this plugin is pinned to
go install github.com/MadAppGang/tmux-mcp/v2@v2.0.0
```

### Verify

```bash
which tmux-mcp
tmux-mcp --version   # v2.0.0
```

---

## Verify It's Working

After installation, confirm the MCP server is registered with Claude Code with `claude mcp list`. You should see `mux` in the list. Then start a Claude Code session and run `/terminal:slots list` — an empty list means the server is up and Claude holds no slots yet.

---

## No Custom Code

This plugin contains no custom code — it is a thin wrapper of skills, agents, and commands that teach Claude how to use tmux-mcp. Slot placement, pane capture, and keystroke injection are handled entirely by the tmux-mcp Go binary.
