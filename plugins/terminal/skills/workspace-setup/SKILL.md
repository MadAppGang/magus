---
name: workspace-setup
description: Orchestrates tmux workspaces — dashboards, watch/entr monitors, one command on many hosts — on numbered helper slots. Use for a multi-pane dashboard, an ambient monitor, a command across hosts, or a startup script for the user.
user-invocable: false
disable-model-invocation: true
---

# Workspace Setup

Tmux workspace orchestration: startup scripts, dashboard archetypes, ambient monitoring, and one command across many hosts. Every tmux-mcp call addresses a **numbered helper slot** — a pane beside you in the user's window; the same number returns the same pane every time, and slot 1 is never your own pane. Windows and whole tmux sessions are not in this contract; where they are needed the step is marked `[Bash]`.

---

## 1. Project Startup Script

One tmux session per project, named windows per concern. Windows and sessions are not in this contract, so the deliverable is a **startup script** the user runs and re-runs themselves — not a sequence of tool calls.

```
1. [Bash] tmux has-session -t myproject 2>/dev/null     → exit 0 means it already exists
2. [if missing] generate the script below and hand it over
3. Report: "Workspace ready. Switch with: tmux switch-client -t myproject"
```

`has-session` is the only detection signal you need. `mcp__plugin_terminal_mux__list-slots()` lists the helper panes *this agent* has open — never the user's windows or panes, which this contract does not enumerate.

### Four Hand-Off Patterns

| Pattern | When to use | How |
|---------|-------------|-----|
| A: Leave detached | Long background job | `[Bash] tmux new-session -d -s "<name>" "<cmd>"`, give the attach command |
| B: Non-destructive inspect | User already in a workspace | `capture-pane` on a helper slot you opened; never their pane |
| C: Background build | User wants to keep working | `[Bash] tmux new-session -d -s "build-job" "make all"` |
| D: Extra pane here | User wants to stay where they are | A numbered slot — §2 |

### Startup Script Artifact

Generate this and leave it for the user to re-run. Replace `myproject` and the path. Use named variables only — no positional arguments.

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

---

## 2. Dashboard Archetypes

Four archetypes derived from real developer sessions. Users can ask for one by name.

**Build dashboards with numbered slots.** Each slot is a distinct pane, created on first use
and returned unchanged after that. You do not split, pass a direction, or order the calls
defensively — slot 2 is never slot 1, by construction. Panes are titled `agent`, `agent:2` …
automatically. Placement: 1 is beside you, 2 stacks under 1, 3 goes bottom-left, 4 and up
subdivide the largest pane the server owns. For a specific arrangement beyond that, apply a
tmux layout preset afterwards (below) — the one part of this the MCP surface does not cover.

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
1. mcp__plugin_terminal_mux__send-keys({ slot: 1, keys: "bun run dev", enter: true })
2. mcp__plugin_terminal_mux__start-and-watch({
     slot: 2,
     command: "bun test --watch",
     pattern: "press a to rerun|Waiting for file changes|Waiting\\.\\.\\.",
     triggers: "exit,error",
     timeout: 30
   })                                          → confirms the watcher came up
3. mcp__plugin_terminal_mux__send-keys({ slot: 3, keys: "tail -f logs/app.log", enter: true })
```

### Archetype B: Data Pipeline Monitor

```
┌──────────────┬──────────────┬──────────────┐
│  ingestion   │  transform   │  DB monitor  │
└──────────────┴──────────────┴──────────────┘
```

```
1. mcp__plugin_terminal_mux__send-keys({ slot: 1, keys: "<ingestion command>", enter: true })
2. mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "<transform command>", enter: true })
3. mcp__plugin_terminal_mux__send-keys({ slot: 3, keys: "<db monitor command>", enter: true })
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
1. mcp__plugin_terminal_mux__send-keys({ slot: 1, keys: "k9s", enter: true })
2. mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "kubectl logs -f {pod}", enter: true })
3. mcp__plugin_terminal_mux__send-keys({ slot: 3, keys: "watch -n2 kubectl top pods", enter: true })
4. mcp__plugin_terminal_mux__send-keys({ slot: 4, keys: "tail -f deploy.log", enter: true })
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
1. mcp__plugin_terminal_mux__start-and-watch({
     slot: 1,
     command: "bun test --watch",
     pattern: "press a to rerun|Waiting for file changes|Waiting\\.\\.\\.",
     triggers: "exit,error",
     timeout: 30
   })
2. mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "bun test --coverage", enter: true })
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
mcp__plugin_terminal_mux__capture-pane({ slot: 1, lines: 50 })   → parse server status
mcp__plugin_terminal_mux__capture-pane({ slot: 2, lines: 50 })   → parse test results
mcp__plugin_terminal_mux__capture-pane({ slot: 3, lines: 50 })   → scan for errors
→ "Server: running :3000. Tests: 47 passed. Logs: no errors."
```

For event-driven monitoring, block until something interesting happens:

```
mcp__plugin_terminal_mux__watch-pane({ slot: 1, triggers: "error,exit,idle:30", timeout: 120 })
```

### Tearing a dashboard down

```
mcp__plugin_terminal_mux__close-pane({ slot: "all" })
```

Kills the panes the server created and merely interrupts any it adopted from the user.

---

## 3. Ambient Monitoring

Two sub-patterns: `watch` for polling status monitors, `entr` for file-change-triggered reruns.

```
SETUP:    mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "watch -n2 kubectl get pods", enter: true })
READ:     mcp__plugin_terminal_mux__capture-pane({ slot: 2 })   (non-disruptive — watch keeps running)
TEARDOWN: mcp__plugin_terminal_mux__close-pane({ slot: 2 })     (interrupts, then releases or kills)
```

### Common watch Patterns

```bash
watch -n1 kubectl get pods            # k8s pod status
watch -n5 df -h                       # disk usage
watch -n2 'git log --oneline -5'      # recent commits
watch -n1 'curl -s localhost:3000/health'  # health probe
watch -n3 'docker stats --no-stream'  # container resources
```

macOS ships `watch` only with Homebrew: `which watch || which gwatch || echo "unavailable — use /terminal:watch poll loop"`.

### entr File-Change-Triggered Reruns

```bash
ls *.go | entr -r go run .                   # Go server restart
find src -name "*.ts" | entr -r npm test     # TypeScript tests
find . -name "*.py" | entr python main.py    # Python script
ls src/**/*.rs | entr -r cargo test          # Rust tests
```

Flags: `-r` restarts the child (kill and rerun) on each change, `-c` clears the screen first,
`-d` also watches for new files in the piped listing. Availability:
`which entr 2>/dev/null || echo "entr not found — suggest: brew install entr"`.

---

## 4. One Command on N Hosts

Run the same command on several hosts at once — a deploy across a cluster, a health check on every node. This is a **dedicated session built from Bash**, like §1, never your own window: `synchronize-panes` mirrors keystrokes into every pane of the window it is set on, your own included, so it has no place in the window you and the user share. Each pane runs the remote command as its initial process, so nothing is typed into anything after the panes exist.

```bash
# One pane per host; the command runs non-interactively over ssh.
tmux new-session -d -s deploy -n run -x 200 -y 50
tmux set-option -t deploy remain-on-exit on           # keep each pane's output after ssh exits
tmux send-keys -t deploy:run "ssh host-1 '<deploy command>'" Enter
for h in host-2 host-3; do
  tmux split-window -t deploy:run "ssh $h '<deploy command>'"
done
tmux select-layout -t deploy:run tiled
```

Then, still from Bash, wait for every pane to finish and read each one:

```bash
until [ "$(tmux list-panes -t deploy:run -F '#{pane_dead}' | grep -c 0)" -eq 0 ]; do sleep 2; done
tmux list-panes -t deploy:run -F '#{pane_index} exit=#{pane_dead_status}'
tmux capture-pane -p -t deploy:run.0     # and .1, .2 … — one per host
tmux kill-session -t deploy
```

The first pane is opened with `send-keys` on a fresh shell (a session created with a command has no shell to return to), the rest with `split-window` carrying the command directly; both are raw `tmux` verbs the safety hook permits because their target is a bare shell or a new pane. A deploy that **prompts** on each host is not a job for mirroring at all: run it one host at a time in an isolated slot with `start-and-watch({ slot: 2, isolated: true, command: "ssh host-k", pattern: "\\$ " })` and `run-in-repl`, and read each answer before the next host.

---

## Notes

<!-- doc-refs: off -->
- **CI/Deploy monitoring** (Fly.io, Vercel, Railway rollback protocol) is planned for a future `terminal:ci-deploy` skill. Deferred pending live verification of platform output strings.
<!-- doc-refs: on -->

- **pane-border-status** uses 1 line per pane and may conflict with Catppuccin or other tmux themes. Check `tmux show-options -g pane-border-status` before enabling; ask the user if they have a custom theme.
