# Terminal Plugin Build Reference

Complete build guide for the `plugins/terminal/` Claude Code plugin. This plugin gives Claude interactive terminal access -- screen reading, keystroke injection, TUI navigation -- using two complementary MCP backends.

**Analogy**: `chrome-devtools-mcp` gives Claude eyes+hands in the browser. `ht-mcp` + `tmux-mcp` gives Claude eyes+hands in the terminal.

---

## 1. What Already Works (Tested on This Machine)

Both MCP servers are installed, registered, and confirmed working:

| Backend | Version | Install Method | Registration |
|---------|---------|---------------|-------------|
| ht-mcp | v0.1.3 | `brew tap memextech/tap && brew install ht-mcp` | `claude mcp add ht-mcp ht-mcp` |
| tmux-mcp | 0.2.2 | `npx -y tmux-mcp` | `claude mcp add tmux -- npx -y tmux-mcp` |

**Confirmed ht-mcp behavior**: Session creation works, returns UUID session IDs. Sessions are in-memory (live in the MCP server process). JSON-RPC `tools/list` returns all 6 tools.

**Confirmed tmux-mcp behavior**: Listed all 11 tmux sessions, listed windows/panes, captured live terminal content from a running Claude Code session. Saw another Claude instance running typecheck, tests, builds. JSON-RPC `tools/list` returns all 13 tools.

---

## 2. ht-mcp Complete API (6 Tools)

### ht_create_session
```
Parameters:
  command:         string[]  (optional, default: ["bash"])
  enableWebServer: boolean   (optional, default: false)
Returns: session ID (UUID) + optional web preview URL (http://127.0.0.1:3618-3999)
```

### ht_send_keys
```
Parameters:
  sessionId: string   (required)
  keys:      string[] (required) — plain text or named keys
Returns: confirmation
```

**Key name reference**:

| Category | Keys |
|----------|------|
| Navigation | `Enter`, `Space`, `Escape`, `Tab`, `Left`, `Right`, `Up`, `Down`, `Home`, `End`, `PageUp`, `PageDown` |
| Function | `F1` through `F12` |
| Ctrl | `^c` or `C-c` (caret notation preferred for reliability) |
| Shift | `S-F6`, `S-Left`, `S-Right`, etc. |
| Alt | `A-x`, `A-Home`, etc. |
| Combined | `S-A-Up` (Shift+Alt+Up), `C-S-Left` (Ctrl+Shift+Left) |

### ht_take_snapshot
```
Parameters:
  sessionId: string (required)
Returns: rendered terminal text — what a human would see (120x40 grid)
```

### ht_execute_command
```
Parameters:
  sessionId: string (required)
  command:   string (required)
Returns: snapshot after command execution (convenience: send_keys + Enter + snapshot)
```

### ht_list_sessions
```
Parameters: none
Returns: list of active session IDs with metadata
```

### ht_close_session
```
Parameters:
  sessionId: string (required)
Returns: confirmation
```

### Workflow Example (vim)
```
1. ht_create_session()                                    → sessionId: "abc123"
2. ht_execute_command(sessionId, "vim myfile.ts")         → see vim screen
3. ht_send_keys(sessionId, ["i"])                         → insert mode
4. ht_send_keys(sessionId, ["hello world"])               → type text
5. ht_send_keys(sessionId, ["Escape"])                    → normal mode
6. ht_send_keys(sessionId, [":wq", "Enter"])              → save and quit
7. ht_close_session(sessionId)                            → cleanup
```

---

## 3. tmux-mcp Complete API (13 Tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list-sessions` | none | List all tmux sessions |
| `find-session` | `name` (string) | Find session by name |
| `list-windows` | `sessionId` (string) | List windows in session |
| `list-panes` | `windowId` (string) | List panes in window |
| `capture-pane` | `paneId` (string) | Read screen content of pane (text) |
| `execute-command` | `sessionId` (string), `command` (string) | Run command in session |
| `send-keys` | `paneId` (string), `keys` (string) | Send keystrokes to pane |
| `create-session` | `name` (string, optional) | Create new tmux session |
| `create-window` | `sessionId` (string) | Create new window |
| `split-pane` | `windowId` (string) | Split pane |
| `kill-session` | `sessionId` (string) | Terminate session |
| `kill-window` | `windowId` (string) | Close window |
| `kill-pane` | `paneId` (string) | Close pane |

tmux-mcp also exposes MCP resources: `tmux://sessions`, `tmux://pane/{paneId}`, `tmux://command/{commandId}/result`.

---

## 4. When to Use Which Backend

| Scenario | Use ht-mcp | Use tmux-mcp |
|----------|-----------|-------------|
| Isolated task terminal (create, use, destroy) | Yes | No |
| Interact with already-running terminal | No | Yes |
| TUI app navigation (vim, htop, lazygit) | Yes | Yes |
| Read scrollback history (>40 lines) | No | Yes |
| Zero external dependencies | Yes | No (requires tmux) |
| Monitor long-running process output | No (40-line limit) | Yes |
| Web preview of terminal | Yes (enableWebServer) | No |

---

## 5. Known Limitations and Workarounds

### ht-mcp Limitations

| Issue | Severity | Workaround |
|-------|----------|-----------|
| 40-line snapshot truncation, no scrollback (#20) | High | Pipe through `less` and navigate; use `\| head -40`; design commands to return <40 lines |
| Fixed 120x40 terminal, no resize (#26) | Medium | Create new session; 120x40 is adequate for most TUI apps |
| Control key inconsistency (#11) | Medium | Prefer `^c` caret notation; avoid complex Emacs chord sequences |
| Memory growth in long sessions (#39) | Medium | Close and recreate sessions for long workflows |
| Scrolling issues in paginated TUI apps (#15) | High | Navigate with keystrokes rather than scroll events |
| No Windows support (ht-core is Unix-only) | N/A | macOS + Linux only |
| Sessions do not survive context compaction | Medium | Save session IDs to files before compaction |

### tmux-mcp Limitations

| Issue | Severity | Workaround |
|-------|----------|-----------|
| Requires tmux installed and running | Medium | Use ht-mcp as primary; tmux as complement |
| ANSI colors lost by default | Low | Use `-e` flag in raw tmux; accept text-only in MCP |
| Polling-based (no push on screen changes) | Low | Add short delays between send-keys and capture-pane |

---

## 6. Competitive Landscape (Why This Matters)

All VS Code AI tools (Cursor, Windsurf, Cline, Continue) are blocked by VS Code's `TerminalShellIntegration` API -- text output capture only, no PTY write path, no screen reading, no keystroke injection. "Interactive terminal support" is Cline's #1 feature request (100+ reactions).

Claude Code is a CLI tool -- no VS Code constraint. It can drive PTY sessions and tmux directly. This is a structural competitive advantage no IDE-embedded competitor can replicate.

---

## 7. Plugin Architecture -- Exact Files to Create

### 7.1 Directory Structure

```
plugins/terminal/
├── plugin.json
├── DEPENDENCIES.md
├── mcp-servers/
│   └── mcp-config.json
├── skills/
│   ├── terminal-interaction/
│   │   └── SKILL.md
│   └── tui-navigation-patterns/
│       └── SKILL.md
├── agents/
│   └── tui-navigator.md
└── commands/
    ├── snapshot.md
    ├── send.md
    └── session.md
```

### 7.2 plugin.json (complete, ready to use)

```json
{
  "name": "terminal",
  "version": "1.0.0",
  "description": "Interactive terminal integration for Claude Code. Enables Claude to interact with TUI applications, run commands, and observe real terminal output using ht-mcp and tmux-mcp.",
  "author": {
    "name": "Jack Rudenko",
    "email": "i@madappgang.com",
    "company": "MadAppGang"
  },
  "license": "MIT",
  "keywords": ["terminal", "pty", "tui", "interactive", "ht", "tmux", "headless"],
  "category": "development",
  "agents": [
    "./agents/tui-navigator.md"
  ],
  "commands": [
    "./commands/snapshot.md",
    "./commands/send.md",
    "./commands/session.md"
  ],
  "skills": [
    "./skills/terminal-interaction",
    "./skills/tui-navigation-patterns"
  ],
  "mcpServers": "./mcp-servers/mcp-config.json"
}
```

### 7.3 mcp-servers/mcp-config.json (complete)

```json
{
  "ht": {
    "command": "ht-mcp",
    "args": []
  },
  "tmux": {
    "command": "npx",
    "args": ["-y", "tmux-mcp"]
  }
}
```

### 7.4 MCP Tool Naming Convention

Tools follow the `mcp__{server-key}__{tool-name}` pattern where `server-key` matches the key in `mcp-config.json`:

**ht tools** (server key: `ht`):
- `mcp__ht__ht_create_session`
- `mcp__ht__ht_send_keys`
- `mcp__ht__ht_take_snapshot`
- `mcp__ht__ht_execute_command`
- `mcp__ht__ht_list_sessions`
- `mcp__ht__ht_close_session`

**tmux tools** (server key: `tmux`):
- `mcp__tmux__list-sessions`
- `mcp__tmux__find-session`
- `mcp__tmux__list-windows`
- `mcp__tmux__list-panes`
- `mcp__tmux__capture-pane`
- `mcp__tmux__execute-command`
- `mcp__tmux__send-keys`
- `mcp__tmux__create-session`
- `mcp__tmux__create-window`
- `mcp__tmux__split-pane`
- `mcp__tmux__kill-session`
- `mcp__tmux__kill-window`
- `mcp__tmux__kill-pane`

### 7.5 Agent Frontmatter Pattern

Based on `plugins/dev/agents/researcher.md`:

```markdown
---
name: tui-navigator
description: Use this agent for multi-step interactive terminal workflows -- navigating TUI apps (vim, htop, lazygit, psql), running interactive CLI tools, or observing terminal output from running processes. This agent creates isolated ht-mcp sessions for tasks or connects to existing tmux sessions. It handles the full terminal lifecycle: create session, send keystrokes, read screen state, interpret output, and clean up. Delegate to this agent whenever a task requires interactive terminal control beyond what the Bash tool provides.
model: sonnet
color: green
tools: mcp__ht__ht_create_session, mcp__ht__ht_send_keys, mcp__ht__ht_take_snapshot, mcp__ht__ht_execute_command, mcp__ht__ht_list_sessions, mcp__ht__ht_close_session, mcp__tmux__list-sessions, mcp__tmux__capture-pane, mcp__tmux__execute-command, mcp__tmux__send-keys, Bash
skills: terminal:terminal-interaction, terminal:tui-navigation-patterns
---
```

### 7.6 Skill Frontmatter Pattern

Based on `plugins/dev/skills/mcp-standards/SKILL.md`:

```markdown
---
name: terminal-interaction
description: ht-mcp and tmux-mcp tool API patterns for interactive terminal access. Use when interacting with TUI applications, running interactive CLI tools, or observing terminal output. Trigger keywords - "terminal", "TUI", "interactive", "ht-mcp", "tmux", "vim", "htop", "session".
version: 1.0.0
tags: [terminal, tui, pty, interactive, ht, tmux]
keywords: [terminal, tui, pty, interactive, session, snapshot, send-keys, vim, htop, lazygit]
plugin: terminal
updated: 2026-02-26
---
```

```markdown
---
name: tui-navigation-patterns
description: Key sequences and navigation patterns for common TUI applications. Use when navigating vim, nano, htop, less, psql, lazygit, or other terminal user interfaces via ht-mcp or tmux-mcp. Trigger keywords - "vim keys", "TUI navigation", "terminal keys", "key sequence".
version: 1.0.0
tags: [terminal, tui, navigation, keys, vim, nano, htop]
keywords: [vim, nano, htop, less, psql, lazygit, docker, key sequence, navigation, escape]
plugin: terminal
updated: 2026-02-26
---
```

### 7.7 Command Frontmatter Pattern

Based on production commands in `plugins/dev/commands/`:

```markdown
---
name: snapshot
description: Take a snapshot of a terminal session to see its current screen content.
allowed-tools: mcp__ht__ht_take_snapshot, mcp__ht__ht_list_sessions, mcp__tmux__capture-pane, mcp__tmux__list-sessions, mcp__tmux__list-panes
---
```

```markdown
---
name: send
description: Send keystrokes or text to an active terminal session.
allowed-tools: mcp__ht__ht_send_keys, mcp__ht__ht_take_snapshot, mcp__ht__ht_list_sessions, mcp__tmux__send-keys, mcp__tmux__capture-pane
---
```

```markdown
---
name: session
description: Manage terminal sessions -- create, list, or close ht-mcp sessions; list or create tmux sessions.
allowed-tools: mcp__ht__ht_create_session, mcp__ht__ht_list_sessions, mcp__ht__ht_close_session, mcp__tmux__create-session, mcp__tmux__list-sessions, mcp__tmux__kill-session
---
```

---

## 8. Skill Content Guidance

### terminal-interaction SKILL.md should cover:

1. **When to use ht-mcp vs tmux-mcp** (decision table from Section 4 above)
2. **Session lifecycle**: create -> use -> snapshot -> close. Always close sessions on task completion.
3. **Command completion detection**: Use `ht_execute_command` for simple commands (handles wait internally). For TUI apps, send keys then take snapshot after a brief pause.
4. **Cleanup pattern**: Always call `ht_close_session` when done. List sessions with `ht_list_sessions` to find orphans.
5. **The 40-line rule**: Snapshot shows only visible terminal (120x40). For long output, pipe through `less` or use `| head -n 40`.
6. **Race conditions**: After `ht_send_keys`, wait before `ht_take_snapshot`. TUI apps need render time.
7. **Complete tool API reference** (copy from Section 2 and 3 above)

### tui-navigation-patterns SKILL.md should cover:

| Application | Key Patterns |
|-------------|-------------|
| **vim** | `i` (insert), `Escape` (normal), `:wq` + `Enter` (save+quit), `:q!` + `Enter` (force quit), `dd` (delete line), `/pattern` + `Enter` (search) |
| **nano** | `^X` (exit), `^O` (save), `^W` (search), `^K` (cut line), `^U` (paste) |
| **htop** | `q` (quit), `F6` (sort by), `F9` (kill), `F5` (tree view), `F3` (search) |
| **less** | `q` (quit), `f`/`Space` (page down), `b` (page up), `G` (end), `g` (start), `/pattern` (search) |
| **psql** | `\q` (quit), `\dt` (list tables), `\d tablename` (describe), `\l` (list databases) |
| **lazygit** | `q` (quit), arrow keys + `Enter` (navigate), `Space` (stage), `c` (commit), `p` (push) |
| **docker logs** | `^c` (Ctrl+C to exit follow mode) |
| **General** | `^c` (interrupt), `^z` (suspend), `^d` (EOF/exit), `^l` (clear screen) |

---

## 9. Design Decisions

**Why both ht-mcp AND tmux-mcp**: They are complementary. ht-mcp creates isolated sessions per task (no external deps). tmux-mcp connects to existing terminals (read scrollback, monitor running processes). Together they cover all use cases.

**Why thin wrapper (1-2 days) over custom node-pty server (2-4 weeks)**: ht-mcp and tmux-mcp already solve the hard problem (PTY management, VT100 emulation). The plugin adds discoverability (skills, agents, commands) -- no custom code needed.

**Why chrome-devtools-mcp is the exact structural analog**: In `plugins/frontend/`, chrome-devtools-mcp is a pre-built external MCP server invoked via its binary name in `mcp-config.json`, with no custom code in the plugin. Skills and agents teach Claude how to use it. This terminal plugin follows the identical pattern.

**Why skills matter**: Claude needs to know HOW to use terminal tools effectively. Without skills, it will make common mistakes: forgetting to close sessions, not waiting for TUI apps to render, sending wrong key sequences for vim, not knowing the 40-line snapshot limit.

---

## 10. Alternative Tools (For Reference Only)

| Tool | Stars | Why Not Primary |
|------|-------|----------------|
| wcgw | 644 | Python + GNU Screen dependency; shell-focused, not screen-state-focused |
| pilotty | 78 | CLI-only (no MCP server); requires Bash tool indirection |
| mcp-server-terminal | ? | Only 1 month old; unverified stability |
| DesktopCommanderMCP | 5537 | No PTY, no screen reading -- fundamentally different paradigm (stdin/stdout only) |

---

## 11. Test Plan

After creating all plugin files, validate with these tests:

### Test 1: Simple command (ht-mcp)
```
Create ht session -> ht_execute_command "echo hello" -> snapshot should contain "hello" -> close session
```

### Test 2: TUI navigation (ht-mcp)
```
Create session -> ht_execute_command "vim /tmp/test-terminal.txt"
-> send_keys ["i"] -> send_keys ["test content"] -> send_keys ["Escape"]
-> send_keys [":wq", "Enter"] -> snapshot should show shell prompt
-> ht_execute_command "cat /tmp/test-terminal.txt" -> should contain "test content"
-> close session
```

### Test 3: Long output truncation (ht-mcp)
```
Create session -> ht_execute_command "seq 1 100" -> snapshot should show only last ~40 lines
-> close session
```

### Test 4: tmux capture
```
list-sessions -> pick an existing session -> list-windows -> list-panes
-> capture-pane on an active pane -> should return readable terminal text
```

### Test 5: Multi-session (ht-mcp)
```
Create session A -> Create session B -> execute "echo A" in A -> execute "echo B" in B
-> snapshot A (should contain "A") -> snapshot B (should contain "B")
-> close A -> close B
```

### Test 6: Cleanup
```
Create session -> list_sessions (should show 1) -> close_session -> list_sessions (should show 0)
```
