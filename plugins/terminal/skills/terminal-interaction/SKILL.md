---
name: terminal-interaction
description: Provides tmux-mcp tool API patterns for interactive terminal access. Use when running interactive commands, starting dev servers, watching test output, querying databases, or splitting panes.
user-invocable: false
---

# Terminal Interaction Skill

This skill teaches Claude how to use `tmux-mcp` for interactive terminal access: screen reading, keystroke injection, process monitoring, and TUI application navigation.

**Analogy**: `chrome-devtools-mcp` gives Claude eyes and hands in the browser. `tmux-mcp` gives Claude eyes and hands in the terminal.

---

## 1. Tool Selection Guide — Layer 1 vs Layer 2

The Go tmux-mcp binary provides two layers of tools. Choose based on whether your task involves waiting for a condition.

| Scenario | Primary Tool | Notes |
|----------|-------------|-------|
| Start command, wait for ready pattern | `start-and-watch` | Single call, no loop |
| Watch existing pane for change/exit | `watch-pane` | Single call, no loop |
| Multi-step REPL session | `run-in-repl` | Synchronous, prompt-aware |
| Check if process is alive/blocked | `pane-state` | Kernel-level, no screen scraping |
| One-shot command (non-interactive) | `execute-command headless:true` | Sync, auto-cleanup |
| Long interactive session | `create-headless` + `start-and-watch` | Manual lifecycle |
| Run something beside the user | `send-keys` with no pane | Server places it — §1b |
| Observe existing session | `capture-pane` | Read-only, no change |

**Layer 2 (agentic) tools**: `start-and-watch`, `watch-pane`, `run-in-repl`, `pane-state`, `write-to-display`
**Layer 1 (primitive) tools**: `execute-command`, `create-headless`, `capture-pane`, `send-keys`, `create-session`, `split-pane`, etc.

**Decision rule**: If the task involves waiting — for a process to be ready, for output to change, for a REPL to respond — use a Layer 2 tool. For structural operations (create pane, send keystroke, read current state), use Layer 1.

---

## 1b. Run something beside the user

You do not manage panes. Say what you want to run; the server places it.

```
mcp__tmux__send-keys({ keys: "npm run dev", enter: true })
→ { "paneId": "%81", "slot": 1, "created": true }
```

No pane id, no split, no detection. The server resolves **the helper pane** — slot 1, beside
you in the user's window — creating it if it is not already there.

Every pane-taking tool resolves the same way: an explicit `paneId` wins verbatim, then `slot`,
then with neither, **slot 1**.

### Read `created` — it is how you find out your process died

`created: true` means the pane is new *to that slot*. If you started a dev server in the helper
pane and a later call comes back `created: true`, the user closed that pane and your process
went with it. An agent that ignores this field keeps reporting a server that stopped ten
minutes ago.

It is also `true` when the server adopted an idle pane instead of making one — so read it as
"new to this slot", not "I made a pane".

**On reuse the field is absent, not `false`.** A reused pane answers `{ "paneId": "%81",
"slot": 1 }`. Test for `created === true`, never for `created === false`.

### More than one pane

Ask for a numbered slot. Integers 1–64. You choose the number, and that is what lets you
address the same pane again on the next call.

```
mcp__tmux__send-keys({ slot: 2, keys: "bun test --watch", enter: true })
mcp__tmux__capture-pane({ slot: 2 })
```

The server decides placement — slot 2 stacks under slot 1, slot 3 goes bottom-left. You never
pass a direction. Panes are titled `agent`, `agent:2` and so on, so the user can see whose they
are.

### Cleanup

`close-pane({ slot: 2 })` when a task is finished, or `close-pane({ slot: "all" })` at the end
of a session. It kills panes the server created and only interrupts panes it adopted from the
user. Offer it as a courtesy — panes outlive the session otherwise — not as a required step.

`kill-pane` still exists and still requires an explicit `paneId`. It is the blunt instrument;
prefer `close-pane`.

### When there is no tmux

The call fails and names the alternative: `headless: true` for an isolated one-shot, or
`create-headless` for a session you will drive over several calls. Do not invent a pane.

`slot` together with `headless: true` is an error — a headless pane lives on a separate tmux
socket with no relation to the user's window.

---

## 1c. What the helper pane guarantees, and what it does not

**A slot is never your own pane.** The server enforces this, so a call that names no pane
cannot feed your keystrokes into your own session. This is the reason to prefer the no-pane
form over an explicit `paneId`.

**A slot may be a pane the user was using.** When no helper exists, the server may *adopt* an
idle pane the user left open — same user, shell in the foreground. This is deliberate and
cannot be turned off. Two consequences follow, and neither is hypothetical:

- **Unsubmitted input concatenates with your command.** tmux cannot see the shell's line
  buffer. If the user typed `rm -rf /data/` and never pressed Enter, the pane looks perfectly
  idle, and your command joins onto the end of theirs. **No slot number avoids this** —
  adoption sits ahead of creation in every slot's resolution, so a high slot number is exactly
  as likely to adopt as slot 1.
- **The environment is the user's.** A shell inside a virtualenv, a container exec session, or
  one with `AWS_PROFILE=production` exported passes every check — right user, at a prompt,
  doing nothing. Your commands then run in that context.

If you need a pane with no inherited context, the only guarantees are `headless: true` or a
`paneId` you already trust.

### Explicit `paneId` bypasses all of it

`mcp__tmux__send-keys` and `mcp__tmux__kill-pane` have **no occupancy guard** on that path —
they write to, or kill, exactly the pane you name. Before targeting a pane you did not get from
slot resolution:

```
mcp__tmux__pane-state({ paneId: "%66" })
→ { foregroundCmd: "zsh", isAlive: true }
```

Proceed only if `foregroundCmd` is a bare shell (`zsh`, `bash`, `fish`, `sh`, `dash`).

| `foregroundCmd` | Action |
|---|---|
| `zsh` / `bash` / `fish` / `sh` / `dash` | ✅ Safe — a shell prompt is waiting |
| `claude` | 🛑 **OFF-LIMITS** — another agent session. Your keystrokes become its prompt; killing it ends its turn |
| `vim` / `nvim` / `less` / `htop` / `psql` / `python` / `node` / any REPL or TUI | 🛑 STOP — keystrokes go to that program, not a shell |

The raw-`tmux` path is guarded by this plugin's PreToolUse:Bash hook, which refuses a non-shell
target. The MCP path is not. That asymmetry is why the no-pane form is the default.

### Two mistakes worth naming

- **Do not call `list-sessions`/`list-windows`/`list-panes` to locate your own pane.** You never
  need your own pane — that is the server's job now. Those tools are for inspecting *other*
  sessions.
- **`display-message` is not a query.** It is a status-bar notification (`message`, `duration`),
  unrelated to `tmux display-message -p`. Reaching for it to read pane state is a dead end.

---

## 1d. The rest of this plugin

Two skills carry the bulk of this plugin's reference material and are **not** in your skill
listing — they cost nothing until you open them. They are files to **read**, not skills to
invoke: the Skill tool does not fire for them.

| Read this file | When the task involves |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}/skills/framework-signals/SKILL.md` | Deciding whether a test run, build or deploy passed — the pass/fail/running/idle markers for jest, vitest, pytest, cargo, go test, webpack, vite, and the deploy platforms |
| `${CLAUDE_PLUGIN_ROOT}/skills/workspace-setup/SKILL.md` | Building a multi-pane dashboard, a `watch`/`entr` monitor, or a synchronised multi-host session |

Two more are in your listing and you will be offered them normally: `tdd-workflow` (the
Red-Green-Refactor state machine) and `tui-navigation-patterns` (key sequences for vim,
htop, lazygit, psql, k9s and friends).

---

## 2. Tool Naming Convention

The server key in `.mcp.json` is `tmux`. This produces tool name prefix `mcp__tmux__`:

- `mcp__tmux__start-and-watch`, `mcp__tmux__watch-pane`, `mcp__tmux__run-in-repl`
- `mcp__tmux__execute-command`, `mcp__tmux__create-headless`, `mcp__tmux__capture-pane`
- `mcp__tmux__send-keys`, `mcp__tmux__list-sessions`, `mcp__tmux__kill-session`, etc.

---

## 3. Monitoring tools — start-and-watch and watch-pane

Both are **synchronous and blocking**. The call returns when a readiness pattern matches, a
named trigger fires, or the timeout expires — with the pane's state in the result. There is no
task id, no progress stream to subscribe to, and no polling loop to write.

```
mcp__tmux__start-and-watch({ command: "npm run dev", pattern: "listening on|ready in" })
→ { event: "pattern:listening on", elapsed: 2.0, output: "…", paneState: {…} }

mcp__tmux__watch-pane({ slot: 1, triggers: "idle:3,pattern:PASS|FAIL" })
→ { event: "idle:3", detail: "No new output for 3s", elapsed: 3.0, paneState: {…} }
```

- **`start-and-watch`** — start a command and block until it signals readiness. With no
  `paneId` or `slot` it uses slot 1, in the window the user is looking at.
- **`watch-pane`** — monitor a pane that already exists. Triggers: `idle:N`, `pattern:REGEX`,
  `exit`, `error`, `user_input`, `bell`, `shell`.

> **Pair the success pattern with the failure paths.** A `pattern` that matches only the happy
> path stays silent through a crash, and silence is indistinguishable from "still running".
> Add `exit,error` to `triggers`, or an `Error|Traceback|FAILED` pattern.

### WatchResult Structure

```json
{
  "paneId": "%6",
  "event": "pattern:listening on",
  "detail": "Ready — matched: Listening on port 3000",
  "elapsed": 2.14,
  "output": "Listening on port 3000\n...",
  "paneState": {
    "panePid": 12345,
    "foregroundPid": 12347,
    "foregroundCmd": "node",
    "isAlive": true,
    "waitingForInput": false
  }
}
```

### WatchResult event values

| event value | Meaning | Next action |
|-------------|---------|-------------|
| `"pattern:<regex>"` | Readiness pattern matched | Report ready; save paneId for later calls |
| `"exit"` | Process exited | Check exitCode via pane-state |
| `"error"` | Error output detected | Report error; show WatchResult.output |
| `"idle:N"` | No new output for N seconds | Process may be waiting; use pane-state |
| `"shell"` | Shell prompt returned (process exited to shell) | Confirmed completion |
| `"timeout"` | No trigger fired in timeout_secs | Report; save paneId for continued monitoring |

### REPL Startup — create-headless vs execute-command

**REPL startup**: Do NOT use `execute-command` to start REPLs (python3, psql, node, etc.). `execute-command` is synchronous — it waits for the command to exit, and REPLs never exit on their own. This causes an indefinite hang.

Instead, use `create-headless` with the REPL as the session's initial command, then `run-in-repl` for interactions:

```
// WRONG — hangs forever:
mcp__tmux__execute-command({ command: "python3", headless: true })

// CORRECT — python3 starts as the session's shell:
mcp__tmux__create-headless({ name: "python-session", command: "python3" })
→ { paneId: "headless:%0", sessionId: "headless:$0" }
// python3 is now waiting at its REPL prompt in that pane
mcp__tmux__run-in-repl({ paneId: "headless:%0", input: "1 + 1", promptPattern: ">>>" })
→ { output: "2" }
mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

---

## 4. Tool reference (20 tools, `-scope agentic`)

This is the shipped scope. The structural primitives — `create-window`, `kill-window`,
`resize-pane`, `rename-session` — exist in the binary but are **deliberately hidden** here. If
you find yourself wanting one, that is a signal you are managing tmux layout instead of
expressing intent.

**Eleven tools accept `paneId` (verbatim) or `slot` (resolved), and default to slot 1 when
given neither:** `send-keys`, `run-in-repl`, `execute-command`, `split-pane`, `capture-pane`,
`screenshot-pane`, `pane-state`, `watch-pane`, `start-and-watch`, `write-to-display`,
`close-pane`. `slot` is an integer 1–64 and cannot be combined with `headless: true`.

The two exceptions are deliberate: `display-message` targets no pane at all (it writes to the
status bar), and `kill-pane` still **requires** an explicit `paneId` — there must exist no
argument-less call that destroys something.

| Do this | Tools |
|---|---|
| Run / drive a pane | `send-keys` · `run-in-repl` · `execute-command` · `split-pane` |
| Observe a pane | `capture-pane` · `screenshot-pane` · `pane-state` · `watch-pane` · `start-and-watch` |
| Show something to the user | `write-to-display` · `display-message` *(status-bar notice — not a query)* |
| Finish with a pane | `close-pane` *(owner-aware)* · `kill-pane` *(blunt, explicit `paneId` only)* |
| Sessions and inspection | `list-sessions` · `list-windows` · `list-panes` · `create-session` · `kill-session` · `create-headless` · `kill-headless-server` |

**Notes that change what you do:**

- **`send-keys`** — `literal: true` (default) sends text byte-for-byte; `literal: false`
  interprets tmux key names (`C-c`, `Enter`, `Escape`, `Up`). `enter: true` appends Enter, so
  one call replaces the old type-then-Enter pair.
- **`execute-command`** — synchronous; returns `{ output, exitCode }`. With `headless: true` it
  runs in an isolated auto-created session that is destroyed afterwards. **Never use it to
  start a REPL** — it waits for exit, and REPLs do not exit.
- **`capture-pane`** — `lines: N` reaches into scrollback beyond the visible viewport.
- **`list-panes`/`list-windows`/`list-sessions`** — for inspecting *other* sessions. Not for
  locating yourself; you never need to.
- **`kill-session`** — never kill a session you did not create.

**Removed** (not in the Go binary): `find-session` → use `list-sessions` plus client-side
filtering. `get-command-result` → `execute-command` is synchronous.

## 5. send-keys Parameter Guide

```
mcp__tmux__send-keys({ paneId, keys, literal })

  literal: true  (default) — text is sent byte-for-byte; special characters are NOT
                             interpreted as key sequences. Use for typing commands.
  literal: false           — text is interpreted as tmux key names. Use for:
                             - Control sequences: "C-c", "C-d", "Escape", "Enter"
                             - Arrow keys: "Up", "Down", "Left", "Right"
                             - Function keys: "F1" through "F12"

To type text AND execute (press Enter):
  mcp__tmux__send-keys({ paneId, keys: "bun test --watch", literal: true })
  mcp__tmux__send-keys({ paneId, keys: "Enter", literal: false })
  OR (single call):
  mcp__tmux__send-keys({ paneId, keys: "bun test --watch\n", literal: false })

Control key reference (all require literal: false):
  Interrupt:   keys: "C-c"
  EOF/exit:    keys: "C-d"
  Clear:       keys: "C-l"
  Suspend:     keys: "C-z"
  Escape:      keys: "Escape"
  Enter:       keys: "Enter"
  Arrow keys:  keys: "Up", "Down", "Left", "Right"
```

| What you want | Keys string | literal |
|--------------|-------------|---------|
| Type command text | `"ls -la src/"` | `true` (default) |
| Press Enter | `"Enter"` | `false` |
| Ctrl+C (interrupt) | `"C-c"` | `false` |
| Ctrl+D (EOF / exit) | `"C-d"` | `false` |
| Escape | `"Escape"` | `false` |
| Arrow Up | `"Up"` | `false` |
| Arrow Down | `"Down"` | `false` |
| F1–F12 | `"F1"` … `"F12"` | `false` |

---

## 6. Session Lifecycle

### Headless Sessions (for isolated/ephemeral tasks)

```
QUICK (auto-lifecycle):
  mcp__tmux__execute-command({ command, headless: true })
  → auto-creates session, runs command, returns { output, exitCode }, auto-destroys
  No session ID to track. No cleanup needed.

MANUAL (for processes that outlive a single command):
  mcp__tmux__create-headless({ name: "task-name" })
  → { paneId: "headless:%0", sessionId: "headless:$0" }
  → save paneId for subsequent tool calls
  → cleanup: mcp__tmux__kill-session({ sessionId: "headless:$0" })
             OR mcp__tmux__kill-headless-server()  ← clears all headless sessions
```

Headless sessions are isolated on a separate tmux socket (`mcp-headless`). They do not appear in the user's `tmux ls`. They persist until explicitly killed or `kill-headless-server` is called.

### Visible Sessions (for user-facing work)

```
mcp__tmux__create-session({ name: "project" })
→ returns { sessionId: "$N" }
→ user can attach with: tmux attach -t project
→ cleanup: mcp__tmux__kill-session({ sessionId: "$N" })
```

**Never kill sessions you did not create.** When observing the user's existing sessions, use `capture-pane` only.

---

## 7. Capturing Full Output

`capture-pane` has access to tmux scrollback history:

```
mcp__tmux__capture-pane({ paneId: "%3" })          → visible viewport
mcp__tmux__capture-pane({ paneId: "%3", lines: 200 }) → last 200 lines of scrollback
```

For very long output (build logs, test suites with hundreds of cases):

```
mcp__tmux__execute-command({
  command: "npm test 2>&1 | tee /tmp/claude-output.log",
  headless: true
})
Read({ file_path: "/tmp/claude-output.log" })  → full output, unlimited lines
```

---

## 7b. Output Parsing Rules

`tmux capture-pane` returns **plain text** — ANSI escape codes are stripped by tmux before Claude sees them. Color is never available.

```
CORRECT: look for ✓ / ✗ / PASS / FAIL / error: / warning: / ⠋ (spinner active)
WRONG:   "is this line red?" — ANSI color is stripped; color state is unavailable
```

**Spinner Unicode characters** indicate a process is still running: `⠋ ⠙ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`

**Progress bar** `[=====>   ]` indicates an in-progress build. Neither the spinner nor progress bar is the final result — wait for the idle/completion marker.

**Prompt detection**: `$` or `%` at the end of a line indicates the command has returned to the shell prompt.

---

## 8. Timing and Race Conditions

**TUI apps need render time.** After sending keys to a TUI application, use `watch-pane` with a `user_input` or `idle:N` trigger to wait for the application to process input and redraw before reading state.

For long-running processes, `start-and-watch` or `watch-pane` replace polling loops — they block until a trigger condition fires, streaming progress notifications as output arrives.

**`start-and-watch` snapshots its diff baseline *after* sending the command.** An **instantaneous** command (`echo done`) can finish *before* that baseline snapshot, so its output lands in the baseline and never counts as "new" — the pattern never matches and you get a `timeout`. When watching a fast command, make the output arrive *during* monitoring: `sleep 0.3 && echo done`, or watch a longer-lived process.

**A repainting shell prompt breaks output diffing.** If the prompt redraws every second (e.g. powerlevel10k with a right-aligned clock), `watch-pane`/`start-and-watch` see "new output" on every poll — `idle:N` triggers never fire and pattern matching gets noisy. For deterministic monitoring, watch panes with a static prompt (or watch a headless pane, which has a plain prompt).

For comprehensive framework-specific pass/fail/running/idle markers, **read**
`${CLAUDE_PLUGIN_ROOT}/skills/framework-signals/SKILL.md`.

---

## 9. Workflow Examples

### Example A: Simple Command Execution

```
mcp__tmux__execute-command({ command: "npm test", headless: true })
→ returns { output, exitCode } synchronously
Parse output for pass/fail. Done.
```

### Example B: vim File Editing

```
1. mcp__tmux__create-headless({ name: "vim-edit" }) → { paneId: "headless:%0" }
2. mcp__tmux__start-and-watch({
     paneId: "headless:%0",
     command: "vim myfile.ts",
     pattern: "~",           // vim blank line tilde indicates loaded
     timeout: 10
   }) → WatchResult
3. // vim is now open; use send-keys for navigation
4. mcp__tmux__send-keys({ paneId: "headless:%0", keys: "i", literal: false })
5. mcp__tmux__send-keys({ paneId: "headless:%0", keys: "hello world", literal: true })
6. mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Escape", literal: false })
7. mcp__tmux__send-keys({ paneId: "headless:%0", keys: ":wq", literal: true })
8. mcp__tmux__send-keys({ paneId: "headless:%0", keys: "Enter", literal: false })
9. // watch-pane: wait for shell prompt to return
10. mcp__tmux__watch-pane({
      paneId: "headless:%0",
      triggers: "shell,idle:2",
      timeout: 10
    }) → WatchResult (event: "shell" = vim exited, shell regained)
11. mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

### Example C: Server Startup (was a polling loop)

```
1. mcp__tmux__start-and-watch({
     command: "bun run dev",
     pattern: "Local:.*http|listening on|ready in",
     mode: "quick",
     timeout: 60
   })
   // paneId omitted → auto-creates session; headless=false → visible session
   → WatchResult { event: "pattern:...", output: "...", paneId: "%N" }
2. Save the returned paneId for later observation
3. Report: "Server ready. Pane: %N"
```

### Example D: Read Existing tmux Session

```
1. mcp__tmux__list-sessions()                              → find "dev" session
2. mcp__tmux__list-windows({ sessionId: "dev" })          → list windows
3. mcp__tmux__list-panes({ windowId: "dev:0" })           → list panes
4. mcp__tmux__capture-pane({ paneId: "dev:0.0" })         → read terminal content
5. Analyze output, report findings
// Do NOT kill user's session — only observe
```

### Example E: Database REPL Query

```
1. mcp__tmux__create-headless({ name: "psql-session" }) → { paneId: "headless:%0" }
2. mcp__tmux__start-and-watch({
     paneId: "headless:%0",
     command: "psql $DATABASE_URL",
     pattern: "=#",
     timeout: 15
   }) → WatchResult (event confirms psql is ready)
3. mcp__tmux__run-in-repl({
     paneId: "headless:%0",
     input: "SELECT count(*) FROM users LIMIT 10;",
     promptPattern: "=#",
     timeout: 10
   }) → { output: " count\n-------\n 1247" }
4. Parse output directly (no screen scraping needed)
5. mcp__tmux__run-in-repl({
     paneId: "headless:%0",
     input: "\\q",
     promptPattern: "\\$",
     timeout: 5
   })
6. mcp__tmux__kill-session({ sessionId: "headless:$0" })
```

### Example F: Run something beside the user

**Use when**: the user says "run it here", "beside me", "in this window", "show alongside".

```
// Start it. No pane id, no split, no detection.
mcp__tmux__send-keys({ keys: "bun test --watch", enter: true })
→ { paneId: "%89", slot: 1, created: true }

// Read it back — either a snapshot…
mcp__tmux__capture-pane({ slot: 1 })

// …or block until something happens.
mcp__tmux__watch-pane({ slot: 1, triggers: "idle:3,pattern:PASS|FAIL" })
→ { event: "pattern:PASS|FAIL", detail: "…", paneState: {…} }

// Let go of it when the task is done.
mcp__tmux__close-pane({ slot: 1 })
```

If instead you want to *start a process and know when it is ready*, one call does the whole
thing — it opens the pane, runs the command, and blocks until the pattern matches:

```
mcp__tmux__start-and-watch({ command: "npm run dev", pattern: "listening on|ready in",
                             triggers: "exit,error" })
→ { event: "pattern:listening on", elapsed: 2.1, paneState: {…} }
```

**Key rules:**

- **Name no pane.** That is what makes the call safe — slot resolution can never return your own
  session's pane.
- **Check `created` on every response.** `created: true` on a slot you were already using means
  the user closed that pane and your process died with it (§1b).
- **Pass no direction.** Placement is the server's job. Slot 2 stacks under slot 1, slot 3 goes
  bottom-left.
- **`close-pane`, not `kill-pane`.** `close-pane` kills panes the server made and merely
  interrupts panes it borrowed from the user. `kill-pane` cannot tell the difference.
- **The pane may be one the user left open** — see §1c for what that means for unsubmitted input
  and inherited environment. It is not avoidable by choosing a different slot.

### Example G: Desktop Notification on Long Command Completion

**Use when**: A long-running build, test suite, or migration should alert the user when done, regardless of whether they are watching the terminal.

```bash
# Append to any long-running command:
npm run build 2>&1 | tee /tmp/build.log && \
  osascript -e 'display notification "Build complete" with title "Claude"' || \
  osascript -e 'display notification "Build FAILED" with title "Claude" sound name "Basso"'
```

**Cross-platform `notify()` function** (paste into the session before the long command):
```bash
notify() {
  MSG="$1"
  if command -v osascript &>/dev/null; then
    osascript -e "display notification \"$MSG\" with title \"Claude\""
  elif command -v notify-send &>/dev/null; then
    notify-send "Claude" "$MSG"
  elif [ -n "$TMUX" ]; then
    tmux display-message "$MSG"
  else
    printf '\a'
  fi
}
```

Then use it: `npm run build && notify "Build complete" || notify "Build FAILED"`

---

## 10. Error Handling Patterns

### Process Stuck / Command Hangs

```
// Detect using pane-state — kernel-level, no screen scraping needed
mcp__tmux__pane-state({ paneId })
→ { isAlive: true, waitingForInput: true, foregroundCmd: "psql" }

// Or detect via watch-pane idle trigger:
// start-and-watch / watch-pane fires event: "timeout" when nothing happens in timeout_secs

// Recovery: send Ctrl+C
mcp__tmux__send-keys({ paneId, keys: "C-c", literal: false })
mcp__tmux__capture-pane({ paneId })  // verify prompt returned
```

### Port Already in Use

```
// Detect: start-and-watch output contains "EADDRINUSE" or "address already in use"
// WatchResult.event will be "error" or "pattern:EADDRINUSE"
// Recovery options:
// 1. Find and kill the occupying process: execute-command({ command: "lsof -ti:3000 | xargs kill", headless: true })
// 2. Try a different port
// 3. Report to user for manual resolution
```

### TUI App Stuck

```
// Detection: watch-pane fires idle:N event (no new output for N seconds)
// OR: pane-state shows waitingForInput: false but isAlive: true (spinning but not drawing)
// Recovery sequence:
mcp__tmux__send-keys({ paneId, keys: "C-c", literal: false })  // try interrupt first
// If still stuck:
mcp__tmux__send-keys({ paneId, keys: "q", literal: true })     // try quit command
// If still stuck:
mcp__tmux__kill-session({ sessionId })                          // force close session
```

### Password Prompt Detection

```
// Use pane-state to detect waiting + check output for "password":
result = mcp__tmux__pane-state({ paneId })
if result.waitingForInput and "password" in capture-pane output:
  STOP — never send credentials through send-keys
  Report to user, ask them to handle authentication
```

### Long-Running Process (SSH, Migration, Deploy)

```
// For database migrations: ALWAYS confirm with user before proceeding
// For SSH: use pane-state to detect password prompt → stop and report
// For deployments: use start-and-watch with deploy-specific patterns — read
// ${CLAUDE_PLUGIN_ROOT}/skills/framework-signals/SKILL.md
```

---

## 11. Safety Guidelines

1. **Never store credentials**: Do not send passwords or API keys through `send-keys`. Use `pane-state` to detect password prompts and stop.
2. **Confirm destructive operations**: Database migrations, `DROP TABLE`, production deployments — always confirm with user.
3. **Never kill user's tmux sessions**: When using tmux-mcp to observe existing sessions, use `capture-pane` only. Do NOT call `kill-session` on sessions you did not create.
4. **Clean up headless sessions**: Use `kill-session` or `kill-headless-server` when done. Headless sessions persist until explicitly killed.
5. **Never send to / kill a pane you named yourself without checking it**: Slot-resolved panes are safe and need no check. But before `send-keys`/`run-in-repl`/`kill-pane` on a pane you reached by explicit `paneId`, check `pane-state.foregroundCmd` and act only on a bare shell (`zsh`/`bash`/`fish`/`sh`/`dash`). `send-keys` feeds the pane's foreground process — if that is `claude` or a REPL, your command becomes input to it. A pane whose foreground is `claude` is a sibling agent: off-limits to send to or kill. See §1c.

---

## 11b. Approval Gate for Destructive Commands

Before running any command that cannot be undone, Claude must **stop and confirm** with the user. This mirrors Warp AI's mandatory human-confirmation model.

**RPGAO loop** (universal protocol for any terminal action):
```
READ    → capture-pane to see current state
PROPOSE → "I plan to run: {command}. Reason: {explanation}"
GATE    → "Shall I proceed?" (ALWAYS for destructive; optional for safe commands)
ACT     → send-keys or execute-command on user confirmation
OBSERVE → use start-and-watch or watch-pane for completion signal
→ Repeat from READ if failure
```

**Detect these patterns before running — STOP and confirm**:

| Pattern | Regex |
|---------|-------|
| Recursive force delete | `\brm\s+(-[rRf]+\s+\|--recursive\|--force\s+)*[/~]` |
| Git force push | `\bgit\s+push.*(-f\b\|--force)` |
| Git reset hard / clean | `\bgit\s+(reset\s+--hard\|clean\s+-[fd])` |
| DROP TABLE / DATABASE / TRUNCATE | `\b(DROP\s+TABLE\|DROP\s+DATABASE\|TRUNCATE)\b` |
| kubectl delete | `\bkubectl\s+delete\b` |
| Curl pipe to bash | `\bcurl\s+.*\|\s*bash\b` |
| dd overwrite | `\bdd\s+.*\bof=` |

The GATE step is always required for any pattern in the table above. For safe, reversible commands, PROPOSE + ACT is sufficient (no explicit GATE pause needed).
