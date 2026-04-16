# Terminal Plugin v3.0.1

Claude gets eyes and hands in the terminal. Screen reading, keystroke injection, TUI navigation, and tmux workspace orchestration — via `tmux-mcp`.

Think of it this way: `chrome-devtools-mcp` gives Claude eyes and hands in the browser. This plugin gives Claude the same in the terminal.

---

## Quick start

### 1. Install dependencies

```bash
# tmux-mcp — Go binary that connects to tmux sessions (requires tmux)
# See https://github.com/MadAppGang/tmux-mcp for install instructions
brew install tmux
```

### 2. Enable the plugin

Add to `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "terminal@magus": true
  }
}
```

### 3. Try it

```
/terminal:run npm test
/terminal:watch "bun run dev"
/terminal:repl psql $DATABASE_URL
/terminal:tui lazygit
```

---

## What Claude can do with this plugin

- **Run commands with a real TTY** — tests, builds, docker-compose, anything that needs interactive output
- **Start dev servers and poll for readiness** — launch `bun run dev`, wait for "listening on port", report the URL
- **Navigate full-screen TUI apps** — vim, nano, lazygit, htop, btop, k9s, tig, less
- **Query database shells** — psql, mongosh, redis-cli, turso with proper prompt detection and LIMIT safety
- **Observe running tmux sessions** — read any pane without disrupting it
- **Run TDD loops** — split a pane for a test watcher, iterate red-green-refactor, read results with `capture-pane`
- **Build multi-pane dashboards** — dev server + test watcher + logs side by side
- **Synchronize multi-host deploys** — send one command to N panes simultaneously

---

## Commands

### Intent commands (use these)

| Command | When to use |
|---------|-------------|
| `/terminal:run {cmd}` | One-shot commands that need TTY, interactive prompts, or rendered output |
| `/terminal:watch {cmd}` | Long-running processes — dev servers, test watchers, log tailing |
| `/terminal:observe [id]` | Check on a running session without touching it |
| `/terminal:repl {app}` | Interactive database shells and language REPLs |
| `/terminal:tui {app}` | Full-screen TUI applications (vim, lazygit, htop, k9s) |

### Advanced commands (manual control)

| Command | When to use |
|---------|-------------|
| `/terminal:session` | Create, list, or close sessions manually |
| `/terminal:snapshot` | Take a raw screenshot of a session |
| `/terminal:send` | Inject raw keystrokes into a session |
| `/terminal:help` | Show all commands with quick examples |

### Which command should I use?

```
"Run my tests"                  → /terminal:run npm test
"Start the dev server"          → /terminal:watch "bun run dev"
"Check on the server"           → /terminal:observe
"Query the database"            → /terminal:repl psql $DATABASE_URL
"Open lazygit to commit"        → /terminal:tui lazygit
"Check CPU/memory"              → /terminal:tui htop
"Edit a file in vim"            → /terminal:tui vim src/index.ts
"Split terminal, run beside me" → just ask Claude — it splits your tmux pane
```

---

## Command details

### `/terminal:run`

Runs a command in an isolated headless terminal, captures output, closes the session automatically.

```
/terminal:run go test ./...
/terminal:run "docker-compose up --build"
/terminal:run "curl -s https://api.example.com/health | jq"
```

Use this instead of the Bash tool when the command needs a TTY, shows progress bars, or produces terminal-rendered output. For simple non-interactive commands, the Bash tool is faster.

### `/terminal:watch`

Starts a long-running process and polls for readiness or failure. The session stays alive for later inspection with `/terminal:observe`.

```
/terminal:watch "bun run dev"
/terminal:watch "bun test --watch"
/terminal:watch "docker-compose up"
```

Reports one of three outcomes: ready (with the URL or success marker), errored (with the error), or still starting (with a session ID to check later).

### `/terminal:observe`

Read-only observation. No keystrokes, no kills, no modifications.

```
/terminal:observe                    # list all active sessions
/terminal:observe tmux:dev:0.0       # read a pane from the dev tmux session
```

Use this to check on a process started earlier, or to read a developer's running tmux environment.

### `/terminal:repl`

Opens an interactive shell, waits for the prompt, runs queries, and exits cleanly.

```
/terminal:repl psql $DATABASE_URL
/terminal:repl "psql -d myapp" "SELECT count(*) FROM users"
/terminal:repl mongosh $MONGO_URI
/terminal:repl python3
/terminal:repl "turso db shell mydb"
```

Handles prompt detection for psql (`=#`), mongosh (`>`), redis-cli (`127.0.0.1:6379>`), python3 (`>>>`), node (`>`), and others. Always adds `LIMIT` safety to database queries to fit within the 40-line snapshot window.

### `/terminal:tui`

Launches a full-screen TUI application and navigates it interactively.

```
/terminal:tui lazygit
/terminal:tui vim src/api/handler.ts
/terminal:tui htop
/terminal:tui k9s
/terminal:tui tig
```

Supported applications:

| Application | Category |
|-------------|----------|
| vim / neovim, nano | Text editors |
| lazygit, tig | Git TUIs |
| htop, btop | System monitors |
| k9s | Kubernetes TUI |
| less, man | Pagers |

---

## Backend: tmux-mcp

All terminal operations run through `tmux-mcp` (a Go binary from [github.com/MadAppGang/tmux-mcp](https://github.com/MadAppGang/tmux-mcp)). It creates isolated agentic tmux sessions for fresh tasks and attaches to the developer's live tmux session when `$TMUX_PANE` is set.

| Scenario | How tmux-mcp handles it |
|----------|-------------------------|
| Fresh isolated task — create, run, destroy | New agentic-scope tmux session |
| Already inside tmux — split panes, side panels | Splits in the current session |
| Read scrollback history | `capture-pane` with history range |
| Monitor a developer's live session | Attach read-only to existing pane |
| Multi-pane dashboard layouts | Native tmux layout commands |

**Snapshot rule**: Pane snapshots show what a human sees on screen. For longer output, Claude uses `| tail -N`, `LIMIT` in SQL, tee-to-file, or `capture-pane` with an explicit history range.

---

## Skills

Five skills teach Claude the full terminal interaction protocol.

### `terminal:terminal-interaction`

The core reference. Covers the complete tmux-mcp tool API, pane detection and splitting, the tee-to-file pattern for long output, desktop notifications for long builds, approval gates for destructive commands, and parallel multi-session patterns.

### `terminal:tui-navigation-patterns`

Key sequences for 15+ TUI applications: vim (modes, navigation, editing), nano, htop/btop, less/man, psql, mongosh, redis-cli, turso, lazygit, tig, k9s, Docker logs, Node/Bun/Python/Ruby REPLs. Includes prompt detection patterns for knowing when each app is ready.

### `terminal:framework-signals`

Pass/fail/running/idle output markers for 15+ frameworks. Claude reads these from terminal snapshots to know when commands complete and whether they succeeded.

Covers: Jest, Vitest, Cargo watch, pytest-watch, Go test, Bun test, RSpec, Cargo build, Gradle, Webpack, Vite, Make, Fly.io, Vercel, Railway, act, docker-compose.

### `terminal:tdd-workflow`

Red-green-refactor state machine for TDD with a running test watcher. Defines the 5-state loop (RED → WAITING → GREEN → COMPILE_ERROR → IDLE), timing rules (never read results until the "change detected" signal appears), failure extraction regexes for Jest/Vitest/Cargo/pytest, and watcher lifecycle (one watcher per project, never restart it mid-session).

### `terminal:workspace-setup`

Tmux workspace orchestration. Four named dashboard archetypes:

| Archetype | Layout |
|-----------|--------|
| **Web Dev Cockpit** | Dev server left, test watcher + logs right (main-vertical) |
| **Data Pipeline Monitor** | Ingestion / transform / DB monitor side by side (even-horizontal) |
| **DevOps Pod Dashboard** | k9s + pod logs + metrics + deploy output (2×2 tiled) |
| **TDD Red-Green Loop** | Code editor top, watcher + coverage bottom (main-horizontal) |

Also covers ambient monitoring with `watch` and `entr`, session startup scripts, and multi-host synchronize-panes for deploying to N hosts simultaneously.

---

## Agent

**`terminal:tui-navigator`** handles multi-step interactive terminal workflows. Delegate to this agent when a task requires stateful screen-read-then-keystroke cycles: navigating TUI apps, multi-query REPL sessions, server lifecycle management, deployment monitoring, parallel test sessions, or splitting the current tmux pane to show something beside the user's workspace.

```
# Claude delegates automatically when you say things like:
"Open lazygit and commit everything"
"Start the dev server and watch tests in a split pane"
"Query the production database for the last 5 failed payments"
"Monitor the Fly.io deployment until it goes live"
```

---

## Prerequisites

| Requirement | Install |
|-------------|---------|
| tmux | `brew install tmux` (macOS) · `apt-get install tmux` (Debian/Ubuntu) |
| tmux-mcp (Go binary) | See [github.com/MadAppGang/tmux-mcp](https://github.com/MadAppGang/tmux-mcp) |

With tmux and tmux-mcp installed, Claude can create isolated agentic sessions, split your existing pane, observe your running processes, and build multi-pane dashboards.

---

## Troubleshooting

### Commands hang with no output

The tmux-mcp session may not have started. Check:

```bash
# Verify tmux-mcp is installed and on PATH
which tmux-mcp

# Verify the MCP server is registered
claude mcp list
```

If `tmux` is not listed, re-install the `tmux-mcp` binary (see [github.com/MadAppGang/tmux-mcp](https://github.com/MadAppGang/tmux-mcp)) and restart Claude Code.

### Pane splits appear in the wrong window

Claude uses `$TMUX_PANE` to detect the current pane, which is always correct — it's set by tmux at shell creation and never changes. If a split appeared in an unexpected window, the shell running Claude Code may not be inside tmux. Verify with `echo $TMUX_PANE` — if empty, you are not in a tmux pane and Claude will create a new agentic-scope tmux session instead.

### Database queries return partial results

Pane snapshots show only the visible screen. For large result sets, Claude adds `LIMIT` automatically via `/terminal:repl`. For queries you run manually, add `LIMIT` explicitly or use `capture-pane` with a history range to read scrollback.

### `watch` command not found on macOS

macOS does not ship `watch` by default. Install via Homebrew:

```bash
brew install watch
```

### Port already in use when starting a dev server

`/terminal:watch` detects `EADDRINUSE` and reports it. Find the occupying process:

```bash
lsof -ti:3000 | xargs kill
```

Then retry `/terminal:watch "bun run dev"`.

### Mouse/scroll stops working in iTerm2 after using terminal plugin

TUI apps (htop, lazygit, vim) and tmux-mcp sessions enable mouse reporting via escape sequences. If a session exits without cleaning up, iTerm2 shows a banner asking "should I stop mouse reporting?" — choosing "Yes" silently disables mouse reporting for that tab (and all future tabs via `NoSyncTurnOffMouseReportingOnHostChange`).

**Symptoms**: Scrolling moves the entire iTerm2 buffer instead of scrolling inside tmux. Mouse clicks don't register in tmux panes. New tabs work fine.

**Quick fix** — re-enable mouse reporting in the affected tab:

```bash
printf '\e[?1000h\e[?1002h\e[?1006h'
```

**Permanent fix** — prevent iTerm2 from silently disabling mouse reporting:

```bash
defaults write com.googlecode.iterm2 NoSyncTurnOffMouseReportingOnHostChange -bool false
defaults write com.googlecode.iterm2 NoSyncTurnOffFocusReportingOnHostChange -bool false
defaults write com.googlecode.iterm2 NoSyncNeverAskAboutMouseReportingFrustration -bool false
```

After running these, restart iTerm2. Next time a TUI app exits uncleanly, iTerm2 will ask instead of silently disabling — choose "Keep" to preserve mouse reporting.

---

**Terminal Plugin** · v3.0.1 · MIT License
[MadAppGang](https://madappgang.com) · [Jack Rudenko](mailto:i@madappgang.com)
