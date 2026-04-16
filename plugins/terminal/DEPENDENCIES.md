# Terminal Plugin Dependencies

This plugin requires one MCP server to be installed and available on your system.

---

## Required: tmux-mcp

**What it does**: tmux MCP server (Go binary). Connects Claude to tmux sessions — list sessions, capture pane content, send keys, create split-pane layouts, and manage isolated agentic terminal workspaces. The plugin's `.mcp.json` declares:

```json
{
  "tmux": {
    "command": "tmux-mcp",
    "args": ["-shell-type", "zsh", "-scope", "agentic"]
  }
}
```

**Source**: [github.com/MadAppGang/tmux-mcp](https://github.com/MadAppGang/tmux-mcp)
**Platform**: macOS and Linux (requires tmux to be installed)

### Install

Install the `tmux-mcp` Go binary from the MadAppGang repository (see release instructions at [github.com/MadAppGang/tmux-mcp](https://github.com/MadAppGang/tmux-mcp)). A typical flow:

```bash
# Install tmux if not already installed (macOS)
brew install tmux

# Install tmux (Ubuntu/Debian)
sudo apt-get install tmux

# Install the tmux-mcp Go binary — follow the upstream repo's install guide
# (e.g. `go install github.com/MadAppGang/tmux-mcp@latest` or download a release)
```

### Verify

```bash
which tmux-mcp
tmux-mcp --version
```

**Why required**: tmux-mcp provides the full terminal interaction surface — it creates isolated agentic tmux sessions (`-scope agentic`), reads scrollback history, observes running processes, injects keystrokes into TUI applications, and builds multi-pane layouts. All terminal plugin commands route through these MCP tools.

---

## Verify It's Working

After installation, confirm the MCP server is registered with Claude Code:

```bash
claude mcp list
```

You should see `tmux` in the list.

To test it's functional, start a Claude Code session and try:

```
/terminal:session create
/terminal:session tmux list
```

---

## No Custom Code

This plugin contains no custom code — it is a thin wrapper that adds skills, agents, and commands to teach Claude how to use tmux-mcp effectively. The heavy lifting (tmux session management, pane capture, keystroke injection) is handled entirely by the tmux-mcp Go binary.
