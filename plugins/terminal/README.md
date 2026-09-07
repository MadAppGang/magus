# Terminal Plugin

Claude gets eyes and hands in the terminal. Screen reading, keystroke injection, TUI navigation, and tmux workspace orchestration — via `tmux-mcp`.

Think of it this way: `chrome-devtools-mcp` gives Claude eyes and hands in the browser. This plugin gives Claude the same in the terminal.

Every terminal operation is addressed by a **slot** — a small integer naming a helper pane the server places and owns. Slot 1 is the pane beside you; `isolated: true` opens a slot nobody can see. Claude never holds a pane id and never targets your own pane.

---

## Quick start

### 1. Install dependencies

```bash
brew install tmux
go install github.com/MadAppGang/tmux-mcp/v2@v2.0.0
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
- **List and read your own slots** — see what is running in each helper pane and capture its output
- **Run TDD loops** — a test watcher in slot 1, iterate red-green-refactor, read results with `capture-pane`
- **Build multi-pane dashboards** — dev server + test watcher + logs side by side
- **Synchronize multi-host deploys** — send one command to N panes simultaneously

---

## Commands

### Intent commands (use these)

| Command | When to use | Where it runs |
|---------|-------------|---------------|
| `/terminal:run {cmd}` | One-shot commands that need TTY, interactive prompts, or rendered output | Ephemeral isolated pane; nothing to close |
| `/terminal:watch {cmd} [--isolated]` | Long-running processes — dev servers, test watchers, log tailing | Slot 1 beside you; `--isolated` → slot 2+ out of view |
| `/terminal:observe [slot] [--watch]` | Check on a slot without touching it — read-only, no keystrokes, no closing | Lists your slots, then reads slot 1 or the one named |
| `/terminal:repl {app} [query]` | Interactive database shells and language REPLs, with prompt detection and `LIMIT` safety | Isolated slot, closed when done |
| `/terminal:tui {app} [--beside]` | Full-screen TUI applications (vim, lazygit, htop, k9s, tig, less) | Isolated slot; `--beside` → slot 1 |

### Advanced commands (manual control)

| Command | When to use |
|---------|-------------|
| `/terminal:slots [list \| close N \| close all]` | List the slots Claude holds, or close one or all of them |
| `/terminal:snapshot [slot] [--lines N] [--visual]` | Raw text (or rendered PNG) snapshot of a slot |
| `/terminal:send [slot] {text or key:Name}` | Inject raw keystrokes into a slot |
| `/terminal:help` | Show all commands with quick examples |

### Which command should I use?

```
"Run my tests"                  → /terminal:run npm test
"Start the dev server"          → /terminal:watch "bun run dev"
"Check on the server"           → /terminal:observe
"Query the database"            → /terminal:repl psql $DATABASE_URL
"Open lazygit to commit"        → /terminal:tui lazygit
"Check CPU/memory"              → /terminal:tui htop --beside
"Edit a file in vim"            → /terminal:tui vim src/index.ts
"Run it beside me"              → just ask Claude — it uses slot 1, the pane beside you
"What do you have open?"        → /terminal:slots list
```

Use `/terminal:run` instead of the Bash tool when the command needs a TTY, shows progress bars, or produces terminal-rendered output; for plain non-interactive commands, Bash is faster. `/terminal:watch` reports ready (with the URL or success marker), errored (with the error), or still starting (with the slot number to check later via `/terminal:observe`).

---

## Backend: tmux-mcp

All terminal operations run through `tmux-mcp` v2 (a Go binary from [github.com/MadAppGang/tmux-mcp](https://github.com/MadAppGang/tmux-mcp)), registered as the MCP server `mux`. It exposes 13 tools, every one addressed by `slot`:

| Kind | Tools | Behaviour |
|------|-------|-----------|
| Creating | `send-keys`, `run-in-repl`, `execute-command`, `start-and-watch`, `write-to-display`, `open-pane` | Open the slot on first use, reuse it after; always answer `created: true/false`; accept `isolated` |
| Reading | `capture-pane`, `screenshot-pane`, `pane-state`, `watch-pane` | Read a slot that exists; error on one that was never opened |
| Registry | `list-slots`, `close-pane` | What Claude holds; close one slot or `"all"` |
| Notification | `notify` | One-way message to you |

| Scenario | How tmux-mcp handles it |
|----------|-------------------------|
| Work beside you | Slot 1 is opened in your current tmux window, or adopted from an idle shell you left open |
| Work out of view | `isolated: true` on slot 2+ opens a pane on a private tmux server with no window |
| One-shot command | `execute-command` with `isolated: true` and no slot is ephemeral — no slot to close |
| Not inside tmux | Only isolated slots are available; a visible call is an error that says so |
| Read scrollback history | `capture-pane` with a `lines` count |
| Multi-pane dashboard layouts | Slots 1, 2, 3 … placed by the server; layout commands via Bash |

A slot's kind is fixed until it is closed, so an isolated slot stays isolated and a visible one stays visible.

**Snapshot rule**: Pane snapshots show what a human sees on screen. For longer output, Claude uses `| tail -N`, `LIMIT` in SQL, tee-to-file, or `capture-pane` with a `lines` count.

---

## Skills

Five skills teach Claude the full terminal interaction protocol.

- **`terminal:terminal-interaction`** — the core reference: the 13-tool API, the slot convention, isolated slots, the tee-to-file pattern for long output, notifications for long builds, approval gates for destructive commands, and parallel multi-slot patterns.
- **`terminal:tui-navigation-patterns`** — key sequences for 15+ TUI applications (vim, nano, htop/btop, less/man, psql, mongosh, redis-cli, turso, lazygit, tig, k9s, Docker logs, Node/Bun/Python/Ruby REPLs) with prompt detection patterns.
- **`terminal:framework-signals`** — pass/fail/running/idle output markers for 15+ frameworks (Jest, Vitest, Cargo, pytest, Go test, Bun test, RSpec, Gradle, Webpack, Vite, Make, Fly.io, Vercel, Railway, act, docker-compose).
- **`terminal:tdd-workflow`** — red-green-refactor state machine for TDD with a running test watcher: the 5-state loop, timing rules, failure extraction regexes, and watcher lifecycle.
- **`terminal:workspace-setup`** — tmux workspace orchestration: four dashboard archetypes (Web Dev Cockpit, Data Pipeline Monitor, DevOps Pod Dashboard, TDD Red-Green Loop), ambient monitoring with `watch` and `entr`, startup scripts, and multi-host synchronize-panes.

---

## Agent

**`terminal:tui-navigator`** handles multi-step interactive terminal workflows. Delegate to this agent when a task requires stateful screen-read-then-keystroke cycles: navigating TUI apps, multi-query REPL sessions, server lifecycle management, deployment monitoring, parallel test runs, or running something in the pane beside you.

```
# Claude delegates automatically when you say things like:
"Open lazygit and commit everything"
"Start the dev server and watch tests beside me"
"Query the production database for the last 5 failed payments"
"Monitor the Fly.io deployment until it goes live"
```

---

## Prerequisites

| Requirement | Install |
|-------------|---------|
| tmux | `brew install tmux` (macOS) · `apt-get install tmux` (Debian/Ubuntu) |
| tmux-mcp v2.0.0 (Go binary) | `go install github.com/MadAppGang/tmux-mcp/v2@v2.0.0` — see [DEPENDENCIES.md](./DEPENDENCIES.md) |

---

## Troubleshooting

### Commands hang with no output

The MCP server may not have started. Check `which tmux-mcp` and `claude mcp list`. If `mux` is not listed, re-install the `tmux-mcp` binary (see [DEPENDENCIES.md](./DEPENDENCIES.md)) and restart Claude Code.

### Nothing appears beside me

Slot 1 is opened in the tmux window tmux-mcp was launched in, which it reads at startup. If nothing appeared, the shell running Claude Code is probably not inside tmux. Verify with `echo $TMUX_PANE` — if it is empty, you are not in a tmux pane, and only isolated panes are available: Claude runs the work out of view and reports the output.

A helper pane may be one you left open and idle rather than a fresh split. Claude will not kill such a pane when it finishes — `close-pane` interrupts the command and releases the pane where it found it.

### Claude cannot see a pane I am using

That is by design. Claude can only read slots it holds, so a pane you are typing in is never readable or writable. Ask Claude to run the process in a slot, or to read its log file.

### Database queries return partial results

Pane snapshots show only the visible screen. For large result sets, Claude adds `LIMIT` automatically via `/terminal:repl`. For queries you run manually, add `LIMIT` explicitly or ask for `capture-pane` with a larger `lines` count.

### `watch` command not found on macOS

macOS does not ship `watch` by default: `brew install watch`.

### Port already in use when starting a dev server

`/terminal:watch` detects `EADDRINUSE` and reports it. Find the occupying process with `lsof -ti:3000 | xargs kill`, then retry.

### Mouse/scroll stops working in iTerm2 after using terminal plugin

TUI apps (htop, lazygit, vim) enable mouse reporting via escape sequences. If one exits without cleaning up, iTerm2 asks "should I stop mouse reporting?" — choosing "Yes" silently disables mouse reporting for that tab and all future tabs.

Quick fix for the affected tab: `printf '\e[?1000h\e[?1002h\e[?1006h'`. Permanent fix — stop iTerm2 from silently disabling it, then restart iTerm2 and choose "Keep" next time it asks:

```bash
defaults write com.googlecode.iterm2 NoSyncTurnOffMouseReportingOnHostChange -bool false
defaults write com.googlecode.iterm2 NoSyncTurnOffFocusReportingOnHostChange -bool false
defaults write com.googlecode.iterm2 NoSyncNeverAskAboutMouseReportingFrustration -bool false
```

---

**Terminal Plugin** · MIT License
[MadAppGang](https://madappgang.com) · [Jack Rudenko](mailto:i@madappgang.com)
