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

`.claude-plugin/plugin.json` declares everything this plugin needs in `requires`:
Bun (its hooks), tmux, zsh (the shell `.mcp.json` starts panes with) and tmux-mcp,
pinned to a GitHub release with one sha256 per platform. A session start reports any
that are missing, with the command for each; one command installs them all:

```bash
magus doctor --fix
```

No magus-cli yet? `bun add -g magus-cli`, then `magus doctor --fix`. tmux-mcp lands in
`~/.local/bin`, which must be on the PATH Claude Code starts with.

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
