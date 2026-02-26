# Terminal Plugin

Interactive terminal integration for Claude Code. Gives Claude eyes and hands in the terminal — screen reading, keystroke injection, and TUI navigation — using `ht-mcp` and `tmux-mcp`.

**Analogy**: `chrome-devtools-mcp` gives Claude eyes and hands in the browser. This plugin gives Claude eyes and hands in the terminal.

---

## What It Does

Claude can now:

- **Start and monitor servers** — launch `bun run dev`, poll for readiness, report the URL
- **Navigate TUI applications** — vim, nano, htop, btop, lazygit, k9s
- **Run interactive CLI sessions** — psql, mongosh, redis-cli, python3, node REPLs
- **Observe existing terminals** — read any pane in a running tmux session without disrupting it
- **Monitor long-running processes** — tail logs, watch CI pipelines, track deployments
- **Manage parallel sessions** — run unit tests and integration tests simultaneously

No other AI coding tool can do this — VS Code-embedded tools are blocked by the `TerminalShellIntegration` API. Claude Code runs as a CLI tool with full PTY access.

---

## Quick Start

### 1. Install dependencies

```bash
# Install ht-mcp
brew tap memextech/tap && brew install ht-mcp

# Register both MCP servers
claude mcp add ht-mcp ht-mcp
claude mcp add tmux -- npx -y tmux-mcp
```

See [DEPENDENCIES.md](./DEPENDENCIES.md) for full setup instructions.

### 2. Enable the plugin

Add to your `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "terminal@magus": true
  }
}
```

### 3. Use it

```
/terminal:session create         # start a new terminal session
/terminal:snapshot {id}          # read what's on screen
/terminal:send {id} key:Enter    # send a keystroke
/terminal:session tmux list      # see your existing tmux environment
```

---

## Commands

| Command | Description |
|---------|-------------|
| `/terminal:session` | Create, list, and close terminal sessions |
| `/terminal:snapshot` | Read the current screen of any session |
| `/terminal:send` | Send keystrokes or text to a session |

---

## Agent

| Agent | Description |
|-------|-------------|
| `terminal:tui-navigator` | Handles multi-step interactive terminal workflows |

Delegate to `terminal:tui-navigator` for complex workflows: database REPL sessions, TUI app navigation, server monitoring, and deployment observation.

---

## Skills

| Skill | Description |
|-------|-------------|
| `terminal:terminal-interaction` | Complete API reference for ht-mcp and tmux-mcp tools |
| `terminal:tui-navigation-patterns` | Key sequences for vim, nano, htop, psql, lazygit, and more |

---

## Backends

| Backend | Purpose |
|---------|---------|
| **ht-mcp** | Creates isolated PTY sessions. The workhorse for most tasks. |
| **tmux-mcp** | Connects to existing tmux sessions. Observe live processes. |

---

## E2E Test Results

9 advanced scenarios tested across 3 models (27 total runs):

| Model | Pass Rate | Notes |
|-------|-----------|-------|
| Claude Sonnet 4.6 | **9/9 (100%)** | All tasks completed, 2-20 turns |
| GPT-5-mini | **9/9 (100%)** | All tasks completed, 1-40 turns |
| GPT-5.2 | **9/9 (100%)** | All tasks completed, 5-16 turns |

Tests cover: tmux session inspection, multi-session HTTP servers, vim file creation, Python REPL calculations, log monitoring with tail, tmux command workflows, process management (background jobs), environment inspection, and cross-backend (both ht-mcp + tmux) tasks.

See `autotest/terminal/` for the test suite.

---

## Phase Roadmap

- **Phase 1** (current): Foundation — 2 skills, 1 agent, 3 commands, 9 E2E tests
- **Phase 2**: Workflow skills — `run-server`, `tdd-watch`, `interactive-cli`, `monitor-logs`, `dashboard`
- **Phase 3**: Auto-detection hooks — automatically suggest terminal tool when long-running commands are detected
