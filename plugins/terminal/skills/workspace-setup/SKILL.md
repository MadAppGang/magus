---
name: workspace-setup
description: Orchestrates tmux workspaces — sessions, dashboard layouts, watch/entr monitors, synced panes. Use when setting up a project session, building a multi-pane dashboard, or syncing panes.
user-invocable: false
disable-model-invocation: true
---

# Workspace Setup

Tmux workspace orchestration: session construction, dashboard archetypes, ambient monitoring, and multi-host pane synchronization.

---

## 1. Session Workspace Construction

One tmux session per project, named windows per concern.

> **Windows are not in the agentic MCP scope.** `create-window`, `kill-window`,
> `resize-pane` and `rename-session` exist in the tmux-mcp binary but are hidden at
> `-scope agentic`, which is what this plugin ships. Building a multi-**window** session is
> therefore a Bash job — use the startup script below, which is what you should be handing
> the user anyway. Multi-**pane** work needs no Bash at all; see §2.

### Session Construction Tool Sequence

```
1. mcp__tmux__list-sessions()                          → scan for a session named "project"
   // find-session was removed from the Go binary; filter client-side
2. [if not found] mcp__tmux__create-session({ name: "project" })
3. Windows: generate the startup script below and let the user run it —
   window creation is not available at this scope.
4. Report: "Workspace ready. Switch with: tmux switch-client -t project"
```

### Four Hand-Off Patterns

| Pattern | When to use | How |
|---------|-------------|-----|
| A: Leave detached | Long background job | Create session, give the attach command |
| B: Non-destructive inspect | User already in a session | `capture-pane` without touching anything |
| C: Background build | User wants to keep working | `tmux new-session -d -s "build-job" "make all"` |
| D: Extra pane here | User wants to stay where they are | A numbered slot — §2 |

### Session Startup Script Artifact

Generate this and leave it for the user to re-run. Replace `myproject` and the path.

```bash
#!/bin/bash
SESSION="myproject"
ROOT="$HOME/projects/myproject"
tmux new-session -d -s "$SESSION" -n "server" -c "$ROOT"
tmux send-keys -t "$SESSION:server" "bun run dev" Enter
tmux new-window -t "$SESSION" -n "tests" -c "$ROOT"
tmux send-keys -t "$SESSION:tests" "bun test --watch" Enter
tmux new-window -t "$SESSION" -n "git" -c "$ROOT"
tmux send-keys -t "$SESSION:git" "lazygit" Enter
tmux select-window -t "$SESSION:server"
tmux attach-session -t "$SESSION"
```

### Detection Signals

- `mcp__tmux__list-sessions()` — all sessions; filter by name client-side
- `mcp__tmux__list-windows({ sessionId })` — windows in a session you already located
- `tmux has-session -t {name}` exits 0 if the session exists

---

## 2. Dashboard Archetypes

Four archetypes derived from real developer sessions. Users can ask for one by name.

**Build dashboards with numbered slots.** Each slot is a distinct pane, created on first use
and returned unchanged on every call after that. You do not split, you do not pass a
direction, and you do not order the calls defensively — slot 2 is never slot 1, by
construction. Panes are titled `agent`, `agent:2` … automatically.

> Slot placement: 1 is beside you, 2 stacks under 1, 3 goes bottom-left, 4 and up subdivide
> the largest pane the server owns. If you need a specific visual arrangement beyond that,
> apply a tmux layout preset afterwards (below) — that is the one part of this the MCP
> surface does not cover.

For the TDD archetype's full state machine, see `terminal:tdd-workflow`.

### Archetype A: Web Dev Cockpit

```
┌──────────────────┬──────────────┐
│                  │  test watch  │
│   dev server     │  (vitest -w) │
│                  ├──────────────┤
│                  │    logs      │
└──────────────────┴──────────────┘
```

```
1. mcp__tmux__send-keys({ slot: 1, keys: "bun run dev", enter: true })
2. mcp__tmux__start-and-watch({
     slot: 2,
     command: "bun test --watch",
     pattern: "press a to rerun|Waiting for file changes|Waiting\\.\\.\\.",
     triggers: "exit,error",
     timeout: 30
   })                                          → confirms the watcher came up
3. mcp__tmux__send-keys({ slot: 3, keys: "tail -f logs/app.log", enter: true })
```

### Archetype B: Data Pipeline Monitor

```
┌──────────────┬──────────────┬──────────────┐
│  ingestion   │  transform   │  DB monitor  │
└──────────────┴──────────────┴──────────────┘
```

```
1. mcp__tmux__send-keys({ slot: 1, keys: "<ingestion command>", enter: true })
2. mcp__tmux__send-keys({ slot: 2, keys: "<transform command>", enter: true })
3. mcp__tmux__send-keys({ slot: 3, keys: "<db monitor command>", enter: true })
```

### Archetype C: DevOps Pod Dashboard

```
┌────────────────┬────────────────┐
│   k9s pods     │  pod logs      │
├────────────────┼────────────────┤
│  metrics watch │  deploy output │
└────────────────┴────────────────┘
```

```
1. mcp__tmux__send-keys({ slot: 1, keys: "k9s", enter: true })
2. mcp__tmux__send-keys({ slot: 2, keys: "kubectl logs -f {pod}", enter: true })
3. mcp__tmux__send-keys({ slot: 3, keys: "watch -n2 kubectl top pods", enter: true })
4. mcp__tmux__send-keys({ slot: 4, keys: "tail -f deploy.log", enter: true })
```

### Archetype D: TDD Red-Green Loop

```
┌────────────────────────────────────┐
│    editor / code                   │
├──────────────────────┬─────────────┤
│   test watcher       │  coverage   │
└──────────────────────┴─────────────┘
```

```
1. mcp__tmux__start-and-watch({
     slot: 1,
     command: "bun test --watch",
     pattern: "press a to rerun|Waiting for file changes|Waiting\\.\\.\\.",
     triggers: "exit,error",
     timeout: 30
   })
2. mcp__tmux__send-keys({ slot: 2, keys: "bun test --coverage", enter: true })
```

### Optional: layout presets

tmux-mcp does not expose `select-layout` or `pane-border-status`, so these are Bash. They are
cosmetic — the dashboard works without them, and you should skip them if the user has a custom
tmux theme.

```bash
tmux select-layout main-vertical      # or even-horizontal, tiled, main-horizontal
tmux set-option pane-border-status top
```

Check `tmux show-options -g pane-border-status` first; if it is already set, leave it alone.

### Dashboard Read Mode

For a point-in-time snapshot:

```
mcp__tmux__capture-pane({ slot: 1, lines: 50 })   → parse server status
mcp__tmux__capture-pane({ slot: 2, lines: 50 })   → parse test results
mcp__tmux__capture-pane({ slot: 3, lines: 50 })   → scan for errors
→ "Server: running :3000. Tests: 47 passed. Logs: no errors."
```

For event-driven monitoring, block until something interesting happens:

```
mcp__tmux__watch-pane({ slot: 1, triggers: "error,exit,idle:30", timeout: 120 })
```

### Tearing a dashboard down

```
mcp__tmux__close-pane({ slot: "all" })
```

Kills the panes the server created and merely interrupts any it adopted from the user.

---

## 3. Ambient Monitoring

Two sub-patterns: `watch` for polling status monitors, `entr` for file-change-triggered reruns.

### watch Setup / Read / Teardown

```
SETUP:    mcp__tmux__send-keys({ slot: 2, keys: "watch -n2 kubectl get pods", enter: true })
READ:     mcp__tmux__capture-pane({ slot: 2 })   (non-disruptive — watch keeps running)
TEARDOWN: mcp__tmux__close-pane({ slot: 2 })     (interrupts, then releases or kills)
```

### Common watch Patterns

```bash
watch -n1 kubectl get pods            # k8s pod status
watch -n5 df -h                       # disk usage
watch -n2 'git log --oneline -5'      # recent commits
watch -n1 'curl -s localhost:3000/health'  # health probe
watch -n3 'docker stats --no-stream'  # container resources
```

### watch Availability Check

macOS ships `watch` only with Homebrew. Check before using:

```bash
which watch || which gwatch || echo "unavailable — use /terminal:watch poll loop"
```

### entr File-Change-Triggered Reruns

```bash
ls *.go | entr -r go run .                   # Go server restart
find src -name "*.ts" | entr -r npm test     # TypeScript tests
find . -name "*.py" | entr python main.py    # Python script
ls src/**/*.rs | entr -r cargo test          # Rust tests
```

### entr Flags

| Flag | Effect |
|------|--------|
| `-r` | Restart child process (kill and rerun) on each change |
| `-c` | Clear the screen before each run |
| `-d` | Watch for new files added to the piped directory listing |

### entr Availability Check

```bash
which entr 2>/dev/null && echo "entr available" || echo "entr not found — suggest: brew install entr"
```

---

## 4. Synchronize-Panes for Multi-Host DevOps

Send one command to N panes simultaneously — useful for deploying to multiple hosts or running the same command across a cluster.

**Note**: Steps 5 and 7 require the Bash tool. tmux-mcp does not expose `set-window-option`. All other steps use tmux-mcp.

### Tool Sequence

```
1. mcp__tmux__create-session({ name: "deploy-prod" })
2. Split into N panes, one per host
3. SSH into each pane individually (separate send-keys per pane)
4. Wait for all panes to show shell prompt
5. [Bash] tmux set-window-option -t deploy-prod:1 synchronize-panes on
6. ONE mcp__tmux__send-keys call → dispatches to ALL panes simultaneously
7. [Bash] tmux set-window-option -t deploy-prod:1 synchronize-panes off
8. mcp__tmux__capture-pane each pane to verify all succeeded
```

**tmux-mcp enhancement needed**: `set-window-option` would enable pure-MCP orchestration without the Bash workaround in steps 5 and 7.

---

## Notes

<!-- doc-refs: off -->
- **CI/Deploy monitoring** (Fly.io, Vercel, Railway rollback protocol) is planned for a future `terminal:ci-deploy` skill. Deferred pending live verification of platform output strings.
<!-- doc-refs: on -->

- **pane-border-status** uses 1 line per pane and may conflict with Catppuccin or other tmux themes. Check `tmux show-options -g pane-border-status` before enabling; ask the user if they have a custom theme.
