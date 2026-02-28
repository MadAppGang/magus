# Terminal Plugin Dependencies

This plugin requires two MCP servers to be installed and available on your system.

---

## Required: ht-mcp

**What it does**: Headless Terminal MCP server. Creates isolated PTY sessions that Claude can control: send keystrokes, read screen state (120x40 snapshot), and manage the full session lifecycle.

**Version**: v0.1.3 or later
**Platform**: macOS and Linux only (ht-core is Unix-only — no Windows support)

### Install

```bash
brew tap memextech/tap
brew install ht-mcp
```

### Verify

```bash
which ht-mcp
```

### Register with Claude Code

```bash
claude mcp add ht-mcp ht-mcp
```

**Why required**: ht-mcp provides PTY-level terminal control for isolated task sessions. Without it, Claude cannot create headless terminal sessions, launch TUI applications, or inject keystrokes.

---

## Required: tmux-mcp

**What it does**: tmux MCP server. Connects Claude to existing tmux sessions — list sessions, capture pane content, send keys, and create split-pane layouts.

**Version**: 0.2.2 or later
**Platform**: macOS and Linux (requires tmux to be installed)

### Install

```bash
# Install tmux-mcp via npx (no global install needed)
npx -y tmux-mcp --version

# Install tmux if not already installed (macOS)
brew install tmux

# Install tmux (Ubuntu/Debian)
sudo apt-get install tmux
```

### Register with Claude Code

```bash
claude mcp add tmux -- npx -y tmux-mcp
```

**Why required**: tmux-mcp provides access to the developer's existing live terminal environment — read scrollback history beyond 40 lines, observe running processes, and create multi-pane layouts. It complements ht-mcp's isolated sessions.

---

## Verify Both Are Working

After installation, confirm both MCP servers are registered:

```bash
claude mcp list
```

You should see both `ht-mcp` and `tmux` in the list.

To test ht-mcp is functional, start a Claude Code session and try:
```
/terminal:session create
```

To test tmux-mcp (requires tmux to be running):
```
/terminal:session tmux list
```

---

## No Custom Code

This plugin contains no custom code — it is a thin wrapper that adds skills, agents, and commands to teach Claude how to use ht-mcp and tmux-mcp effectively. The heavy lifting (PTY management, VT100 emulation, session management) is handled entirely by the MCP servers.
