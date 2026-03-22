---
name: workspace-setup
description: Tmux workspace orchestration — session construction, dashboard layouts, ambient monitoring, and multi-host pane sync. Use when setting up project workspaces, creating multi-pane dashboards, running watch/entr monitors, or synchronizing commands across panes. Trigger on "workspace", "dashboard", "layout", "setup session", "project session", "monitor", "watch", "entr", "side by side dashboard", "multi-pane", "synchronize panes".
version: 1.0.0
tags: [terminal, tmux, workspace, dashboard, layout, monitoring, watch, entr, session-management]
keywords: [workspace, tmux session, dashboard, layout, monitor, watch, entr, project setup, multi-pane, synchronize, sync panes, named session, window, archetype]
plugin: terminal
---

# Workspace Setup

Tmux workspace orchestration: session construction, dashboard archetypes, ambient monitoring, and multi-host pane synchronization.

---

## 1. Session Workspace Construction

One tmux session per project, named windows per concern. This pattern covers session creation, window setup, and hand-off to the user.

### Session Construction Tool Sequence

```
1. Bash: tmux display-message -p '#{session_name}'          → check current session
2. mcp__tmux__find-session({ name: "project" })             → check if session exists
3. [if not found] mcp__tmux__create-session({ name: "project" })
4. mcp__tmux__create-window({ sessionId: "project" })       → window "server"
5. mcp__tmux__create-window({ sessionId: "project" })       → window "tests"
6. mcp__tmux__create-window({ sessionId: "project" })       → window "git"
7. mcp__tmux__send-keys for each window: cd to project root, start process
8. Report: "Workspace ready. Switch with: tmux switch-client -t project"
```

### Four Hand-Off Patterns

Choose based on user context:

| Pattern | When to use | How |
|---------|-------------|-----|
| A: Leave detached | Long background job | Create session -d, give attach command |
| B: Non-destructive inspect | User already in a session | `capture-pane` without touching anything |
| C: Background build | User wants to keep working | `tmux new-session -d -s "build-job" "make all"` |
| D: New window | User wants to stay in current session | `create-window` in user's session |

### Session Startup Script Artifact

Generate this script and leave it for the user to re-run. Replace `myproject` and the path with the actual project values.

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

- `tmux list-sessions` — one line per session
- `tmux list-windows -a` — reveals window names across all sessions
- `#{session_name}` format string in `display-message` — confirm current session
- `tmux has-session -t {name}` exits 0 if session exists, non-zero if not

---

## 2. Dashboard Archetypes

Four named archetypes derived from real developer tmux sessions. Users can request by archetype name. Apply layout presets with `tmux select-layout` after creating panes (Bash tool required — tmux-mcp does not expose `select-layout`).

For the TDD archetype's full state machine, see `terminal:tdd-workflow`.

### Archetype A: Web Dev Cockpit

3 panes, main-vertical layout.

```
┌──────────────────┬──────────────┐
│                  │  test watch  │
│   dev server     │  (vitest -w) │
│                  ├──────────────┤
│                  │    logs      │
└──────────────────┴──────────────┘
```

Construction:

```
1. Bash: PANE=$(tmux display-message -p '#{pane_id}')
2. mcp__tmux__split-pane({ paneId: PANE, direction: "horizontal", size: "40%" }) → right
3. mcp__tmux__split-pane({ paneId: right, direction: "vertical" })               → log
4. mcp__tmux__send-keys({ paneId: PANE, keys: "bun run dev\nEnter" })
5. mcp__tmux__send-keys({ paneId: right, keys: "bun test --watch\nEnter" })
6. mcp__tmux__send-keys({ paneId: log, keys: "tail -f logs/app.log\nEnter" })
7. Bash: tmux select-layout -t {window} main-vertical
8. Bash: tmux set-option pane-border-status top
9. Bash: tmux select-pane -t {PANE} -T "Server" (and right="Tests", log="Logs")
```

### Archetype B: Data Pipeline Monitor

3 panes, even-horizontal layout.

```
┌──────────────┬──────────────┬──────────────┐
│  ingestion   │  transform   │  DB monitor  │
└──────────────┴──────────────┴──────────────┘
```

Construction:

```
1. Bash: PANE=$(tmux display-message -p '#{pane_id}')
2. mcp__tmux__split-pane({ paneId: PANE, direction: "horizontal" })  → mid
3. mcp__tmux__split-pane({ paneId: mid, direction: "horizontal" })   → right
4. mcp__tmux__send-keys for each pane: ingestion / transform / DB monitor commands
5. Bash: tmux select-layout -t {window} even-horizontal
6. Bash: tmux set-option pane-border-status top
7. Bash: tmux select-pane -t {PANE} -T "Ingestion", mid="Transform", right="DB Monitor"
```

### Archetype C: DevOps Pod Dashboard

4 panes, tiled layout.

```
┌────────────────┬────────────────┐
│   k9s pods     │  pod logs      │
├────────────────┼────────────────┤
│  metrics watch │  deploy output │
└────────────────┴────────────────┘
```

Construction:

```
1. Bash: PANE=$(tmux display-message -p '#{pane_id}')
2. mcp__tmux__split-pane({ paneId: PANE, direction: "horizontal" })       → top-right
3. mcp__tmux__split-pane({ paneId: PANE, direction: "vertical" })         → bottom-left
4. mcp__tmux__split-pane({ paneId: top-right, direction: "vertical" })    → bottom-right
5. mcp__tmux__send-keys({ paneId: PANE, keys: "k9s\nEnter" })
6. mcp__tmux__send-keys({ paneId: top-right, keys: "kubectl logs -f {pod}\nEnter" })
7. mcp__tmux__send-keys({ paneId: bottom-left, keys: "watch -n2 kubectl top pods\nEnter" })
8. mcp__tmux__send-keys({ paneId: bottom-right, keys: "tail -f deploy.log\nEnter" })
9. Bash: tmux select-layout -t {window} tiled
10. Bash: tmux set-option pane-border-status top
11. Bash: tmux select-pane labels: "k9s Pods", "Pod Logs", "Metrics", "Deploy"
```

### Archetype D: TDD Red-Green Loop

3 panes, main-horizontal layout.

```
┌────────────────────────────────────┐
│    editor / code (Bash)            │
├──────────────────────┬─────────────┤
│   test watcher       │  coverage   │
└──────────────────────┴─────────────┘
```

Construction:

```
1. Bash: PANE=$(tmux display-message -p '#{pane_id}')
2. mcp__tmux__split-pane({ paneId: PANE, direction: "vertical", size: "30%" })    → watcher
3. mcp__tmux__split-pane({ paneId: watcher, direction: "horizontal", size: "40%" }) → coverage
4. mcp__tmux__send-keys({ paneId: watcher, keys: "bun test --watch\nEnter" })
5. mcp__tmux__send-keys({ paneId: coverage, keys: "bun test --coverage\nEnter" })
6. Bash: tmux select-layout -t {window} main-horizontal
7. Bash: tmux set-option pane-border-status top
8. Bash: tmux select-pane labels: "Editor", "Test Watcher", "Coverage"
9. Focus returns to PANE (editor position)
```

### Dashboard Read Mode

Periodic multi-pane status synthesis — read all panes and summarize:

```
mcp__tmux__capture-pane({ paneId: server_pane })  → parse server status
mcp__tmux__capture-pane({ paneId: test_pane })    → parse test results
mcp__tmux__capture-pane({ paneId: log_pane })     → scan for errors
→ Synthesize: "Server: running :3000. Tests: 47 passed. Logs: no errors."
```

---

## 3. Ambient Monitoring

Two sub-patterns: `watch` for polling status monitors, `entr` for file-change-triggered reruns.

### watch Setup / Read / Teardown

```
SETUP:    mcp__tmux__split-pane → send 'watch -n2 kubectl get pods' + Enter → label "claude-monitor"
READ:     mcp__tmux__capture-pane (non-disruptive — watch keeps running)
TEARDOWN: send-keys Ctrl+C → mcp__tmux__kill-pane
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

- **CI/Deploy monitoring** (Fly.io, Vercel, Railway rollback protocol) is planned for a future `terminal:ci-deploy` skill. Deferred pending live verification of platform output strings.
- **pane-border-status** uses 1 line per pane and may conflict with Catppuccin or other tmux themes. Check `tmux show-options -g pane-border-status` before enabling; ask the user if they have a custom theme.
