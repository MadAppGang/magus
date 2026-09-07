---
name: terminal-interaction
description: Slot-addressed tool patterns for interactive terminal access. Use when running interactive commands, starting dev servers, watching tests, querying databases, or working beside the user.
user-invocable: false
---

# Terminal Interaction Skill

This skill teaches Claude how to use `tmux-mcp` for interactive terminal access: screen reading, keystroke injection, process monitoring, and TUI application navigation.

## 1. Tool selection

Every pane is addressed by a **slot** — an integer 1–64 — and by nothing else. You never hold a pane id; the server keeps the slot→pane map and places panes itself.

**The slot convention, obeyed by every command in this plugin:**

- **Slot 1 is the visible helper beside the user**, in the window they are looking at. Omit `slot` and you get slot 1.
- **Private work takes `isolated: true` on slot 2 or higher** — a pane nobody can see, on a private terminal server with no window.
- **Call `list-slots` before choosing a number when you may already hold slots** (after compaction, or when resuming). Reusing a number reuses its pane.

| Scenario | Tool | Kind |
|---|---|---|
| One-shot command, nobody needs to watch | `execute-command` with `isolated: true`, no slot | creating (ephemeral) |
| One-shot command beside the user | `execute-command` | creating |
| Start a process, block until it is ready | `start-and-watch` | creating |
| Type into a pane (commands, keys) | `send-keys` | creating |
| Multi-step REPL session | `run-in-repl` | creating |
| Show text to the user in a pane | `write-to-display` | creating |
| Get a pane now, run something later | `open-pane` | creating |
| Read the text of a slot | `capture-pane` | reading |
| Render a slot as an image (colors, TUI layout) | `screenshot-pane` | reading |
| Is the process alive / waiting for input | `pane-state` | reading |
| Block until a slot changes, exits, or goes idle | `watch-pane` | reading |
| Which slots do I hold | `list-slots` | registry |
| Finish with a slot, or with all of them | `close-pane` | registry |
| Transient message to the user (not a query) | `notify` | none |

**Decision rule**: if the task involves waiting — for readiness, for output to change, for a REPL to respond — use `start-and-watch`, `watch-pane` or `run-in-repl`. For structural operations (get a pane, send a keystroke, read current state) use the rest.

## 1b. Creating tools return `created`; reading tools never do

The six **creating** tools (`send-keys`, `run-in-repl`, `execute-command`, `start-and-watch`, `write-to-display`, `open-pane`) open the slot if it is empty and answer with `created` **on every call** — `true` when the slot is new, `false` when the pane was reused:

```
mcp__plugin_terminal_mux__send-keys({ keys: "npm run dev", enter: true })
→ { "slot": 1, "created": true }
```

`created: true` on a slot you were already using means the user closed that pane and your process went with it. An agent that ignores the field keeps reporting a server that stopped ten minutes ago. It is also `true` when the server adopted an idle pane instead of making one — read it as "new to this slot", not "I made a pane".

The four **reading** tools (`capture-pane`, `screenshot-pane`, `pane-state`, `watch-pane`) never return `created` and **error on a slot that was never opened** — they do not create one. Per spec: `slot 2 does not exist; open it with open-pane or by running something in it`. Open the slot with a creating tool first, or use `start-and-watch` to open and watch in one call.

## 1c. Isolated slots

`isolated: true` opens the pane where nobody can see it. Only creating tools accept it.

- **It needs an explicit slot** on every tool except `execute-command`. Observed: `isolated needs a slot number, because a pane you cannot see must be addressable later`.
- **`execute-command` with `isolated: true` and no slot is ephemeral**: the pane is created, the command runs, the pane is destroyed, and the answer is `{ output, exitCode, timedOut }` with no slot to track.
- **A slot's kind is fixed at creation.** Asking for a visible pane on a slot holding an isolated one is an error, observed as `slot 2 is an isolated pane; close it or use another slot`. Close it first, or pick another number.
- **`close-pane` does not take `isolated`.** Observed: `isolated is not accepted here; close-pane closes whichever kind of pane the slot holds, and slot: "all" closes both kinds`.
- **Outside tmux there is no window for a visible pane.** Per spec the call fails with `no window to place a pane in: this server is not running inside tmux — use isolated: true`. Do not invent a pane; use an isolated slot.

## 1d. What a slot guarantees, and what it does not

**A slot is never your own pane.** The server enforces this, so no call can feed keystrokes into your own session.

**A visible slot may be a pane the user was using.** When no helper exists, the server may *adopt* an idle pane the user left open — same user, shell in the foreground. `list-slots` reports it as `origin: "adopted"`. This is deliberate and cannot be turned off. Two consequences follow, and neither is hypothetical:

- **Unsubmitted input concatenates with your command.** tmux cannot see the shell's line buffer. If the user typed `rm -rf /data/` and never pressed Enter, the pane looks perfectly idle, and your command joins onto the end of theirs. No slot number avoids this — adoption sits ahead of creation for every visible slot.
- **The environment is the user's.** A shell inside a virtualenv, a container exec session, or one with `AWS_PROFILE=production` exported passes every check. Your commands then run in that context.

If you need a pane with no inherited context, `isolated: true` is the only guarantee.

**You cannot read a pane the user is using.** No tool takes a pane id, so a pane that is not one of your slots is unreachable. Run the process in a slot instead, or read the log file it writes.

**Ids are rejected, not ignored.** Any argument naming a pane, window or session fails the call — the observed answer is that the argument `is not accepted; address the pane by slot`. No response ever returns one either.

## 1e. The rest of this plugin

Two skills carry the bulk of this plugin's reference material and are **not** in your skill listing — they cost nothing until you open them. They are files to **read**, not skills to invoke: the Skill tool does not fire for them.

| Read this file | When the task involves |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}/skills/framework-signals/SKILL.md` | Deciding whether a test run, build or deploy passed — the pass/fail/running/idle markers for jest, vitest, pytest, cargo, go test, webpack, vite, and the deploy platforms |
| `${CLAUDE_PLUGIN_ROOT}/skills/workspace-setup/SKILL.md` | Building a multi-pane dashboard, a `watch`/`entr` monitor, or a synchronised multi-host session |

Two more are in your listing and you will be offered them normally: `tdd-workflow` (the Red-Green-Refactor state machine) and `tui-navigation-patterns` (key sequences for vim, htop, lazygit, psql, k9s and friends).

## 2. Tool naming

The server key in `.mcp.json` is `mux`, so every tool is `mcp__plugin_terminal_mux__<tool>`: `mcp__plugin_terminal_mux__start-and-watch`, `mcp__plugin_terminal_mux__capture-pane`, `mcp__plugin_terminal_mux__close-pane`, and so on. Prose may name a tool bare; a call never omits the prefix.

## 3. Monitoring tools — start-and-watch and watch-pane

Both are **synchronous and blocking**. The call returns when a readiness pattern matches, a named trigger fires, or the timeout expires — with the pane's state in the result. There is no task id, no progress stream, and no polling loop to write.

- **`start-and-watch`** (creating) — start a command and block until it signals readiness. With no `slot` it uses slot 1, in the window the user is looking at.
- **`watch-pane`** (reading) — monitor a slot that already exists. Triggers: `idle:N`, `pattern:REGEX`, `exit`, `error`, `user_input`, `bell`, `shell`. A slot that was never opened is an error.

> **Pair the success pattern with the failure paths.** A `pattern` that matches only the happy path stays silent through a crash, and silence is indistinguishable from "still running". Add `exit,error` to `triggers`, or an `Error|Traceback|FAILED` pattern.

**WatchResult**, observed from `start-and-watch({ slot: 2, isolated: true, command: "python3", pattern: ">>>" })`; `watch-pane` returns the same shape without `created`:

```json
{
  "slot": 2, "created": true,
  "event": "pattern:>>>", "detail": "Ready — matched: >>>", "elapsed": 0.51,
  "output": " python3\nPython 3.14.5 …\n>>>",
  "paneState": { "panePid": 17134, "foregroundPid": 17146, "foregroundCmd": "Python",
                 "isAlive": true, "waitingForInput": true }
}
```

| event value | Meaning | Next action |
|---|---|---|
| `"pattern:<regex>"` | Readiness pattern matched | Report ready; keep the slot number for later calls |
| `"exit"` | Process exited | Check with `pane-state` |
| `"error"` | Error output detected | Report error; show `output` |
| `"idle:N"` | No new output for N seconds | Process may be waiting; use `pane-state` |
| `"shell"` | Shell prompt returned | Confirmed completion |
| `"timeout"` | No trigger fired in `timeout` | Report; watch the same slot again |

**Never start a REPL with `execute-command`.** It waits for the command to exit, and REPLs do not exit — the call hangs. Start it with `start-and-watch` and a prompt pattern, then drive it with `run-in-repl` (Example E).

## 4. Tool reference (13 tools)

| Tool | Kind | Arguments (required in bold) | Response |
|---|---|---|---|
| `send-keys` | creating | **keys**, literal (default true), enter (default false), slot, isolated | `{ slot, created }` |
| `run-in-repl` | creating | **input**, **promptPattern**, timeout (default 10), slot, isolated | `{ slot, created, output, exited }` |
| `execute-command` | creating | **command**, timeoutSeconds, slot, isolated | `{ slot, created, output, exitCode, timedOut }`; `isolated: true` with no slot: `{ output, exitCode, timedOut }` |
| `start-and-watch` | creating | **command**, **pattern**, triggers (default `exit,error`), mode (default quick), timeout (default 60), slot, isolated | WatchResult (§3) |
| `write-to-display` | creating | **text**, clear, slot, isolated | `{ slot, created }` |
| `open-pane` | creating | slot, isolated | `{ slot, created, isolated }` |
| `capture-pane` | reading | lines, colors, slot | pane text; structuredContent `{ slot }` |
| `screenshot-pane` | reading | output (browser/html), theme (dark/light), slot | image or html; `{ slot }` |
| `pane-state` | reading | slot | `{ slot, panePid, foregroundPid, foregroundCmd, isAlive, waitingForInput }` |
| `watch-pane` | reading | triggers (default `exit,user_input,error`), mode (default medium), timeout (default 60), slot | WatchResult without `created` |
| `close-pane` | registry | slot (integer or `"all"`, default 1) | array of `{ slot, action, detail? }` |
| `list-slots` | registry | none | array of `{ slot, isolated, origin, foregroundCmd, isAlive }` |
| `notify` | none | **message**, duration (default 3) | one-way; not a query |

- **`exited` and `timedOut` are always present**, so test the value, never the presence.
- **`close-pane`** kills panes the server created and only interrupts (`C-c`) panes it adopted from the user. Closing a slot that was never opened is not an error.
- **`list-slots`** shows what *this agent* holds — not the user's panes, not another agent's.
- **`notify`** tells you nothing about panes. To ask about the terminal, use `pane-state`, `list-slots` or `capture-pane`.
- **`capture-pane`** — `lines: N` reaches into scrollback beyond the visible viewport.

## 5. send-keys keys and `literal`

`literal: true` (default) sends text byte-for-byte. `literal: false` interprets **named keys**: `Enter`, `Escape`, `Tab`, `Space`, `BSpace`, `Up`, `Down`, `Left`, `Right`, `PageUp`, `PageDown`, `Home`, `End`, `F1`–`F12`, `C-<x>` (control: `C-c` interrupt, `C-d` EOF, `C-l` clear, `C-z` suspend) and `M-<x>` (meta). Any other name passes through to tmux unmapped and is not part of the contract.

`enter: true` appends Enter to literal text, so one call replaces the type-then-Enter pair:

```
mcp__plugin_terminal_mux__send-keys({ slot: 1, keys: "bun test --watch", enter: true })
→ { "slot": 1, "created": true }
mcp__plugin_terminal_mux__send-keys({ slot: 1, keys: "C-c", literal: false })
```

## 6. Slot lifecycle

```
// Open, or get back, a pane. Same number → same pane (created: false the second time).
mcp__plugin_terminal_mux__open-pane({ slot: 2 })
→ { "slot": 2, "created": true, "isolated": false }

// What do I hold? (here: an isolated python3 on slot 2)
mcp__plugin_terminal_mux__list-slots()
→ [ { "slot": 2, "isolated": true, "origin": "created", "foregroundCmd": "Python", "isAlive": true } ]

// Finish with one slot…
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
→ [ { "slot": 2, "action": "killed" } ]

// …or with all of them, visible and isolated alike.
mcp__plugin_terminal_mux__close-pane({ slot: "all" })
mcp__plugin_terminal_mux__list-slots()
→ []
```

- **After compaction, call `list-slots` before choosing a number.** Your memory of which slots are open is gone; the server's is not.
- **The server decides placement.** Slot 2 stacks under slot 1, slot 3 goes bottom-left. You never pass a direction or a size. Panes are titled so the user can see whose they are.
- **Cleanup is a courtesy, not a required step.** Panes outlive the session otherwise; offer `close-pane({ slot: "all" })` at the end.

## 7. Capturing full output

```
mcp__plugin_terminal_mux__capture-pane({ slot: 2 })              → visible viewport
mcp__plugin_terminal_mux__capture-pane({ slot: 2, lines: 200 })  → last 200 lines of scrollback
```

For very long output (build logs, test suites with hundreds of cases), tee to a file and read that:

```
mcp__plugin_terminal_mux__execute-command({ command: "npm test 2>&1 | tee /tmp/claude-output.log", isolated: true })
Read({ file_path: "/tmp/claude-output.log" })  → full output, unlimited lines
```

**Output is plain text** — ANSI codes are stripped unless `colors: true`. Look for `✓` / `✗` / `PASS` / `FAIL` / `error:` / a spinner glyph (`⠋ ⠙ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`), never "is this line red?". A spinner or progress bar means still running, not a result. `$` or `%` at the end of the last line means the shell prompt is back.

## 8. Timing and race conditions

**TUI apps need render time.** After sending keys to a TUI application, use `watch-pane` with a `user_input` or `idle:N` trigger to wait for the redraw before reading state.

**`start-and-watch` snapshots its diff baseline *after* sending the command.** An instantaneous command (`echo done`) can finish before that snapshot, so its output never counts as "new" — the pattern never matches and you get a `timeout`. Make the output arrive *during* monitoring (`sleep 0.3 && echo done`), or watch a longer-lived process.

**A repainting shell prompt breaks output diffing.** If the prompt redraws every second (powerlevel10k with a clock), `watch-pane` sees "new output" on every poll — `idle:N` never fires and pattern matching gets noisy. Watch a slot with a static prompt, or an isolated slot, which has a plain one.

For framework-specific pass/fail/running/idle markers, **read** `${CLAUDE_PLUGIN_ROOT}/skills/framework-signals/SKILL.md`.

## 9. Workflow examples

### Example A: one-shot command (ephemeral)

```
mcp__plugin_terminal_mux__execute-command({ command: "npm test", isolated: true })
→ { output, exitCode, timedOut }   // no slot: the pane is gone already
```

### Example B: vim in an isolated slot

```
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "vim myfile.ts", pattern: "~", timeout: 10 })
→ WatchResult { slot: 2, created: true, event: "pattern:~", … }
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "i", literal: false })
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "hello world" })
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: "Escape", literal: false })
mcp__plugin_terminal_mux__send-keys({ slot: 2, keys: ":wq", enter: true })
mcp__plugin_terminal_mux__watch-pane({ slot: 2, triggers: "shell,idle:2", timeout: 10 })
→ WatchResult (event: "shell" = vim exited, shell regained)
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
```

### Example C: dev server in slot 1, beside the user

```
mcp__plugin_terminal_mux__start-and-watch({ command: "bun run dev", pattern: "Local:.*http|listening on|ready in", triggers: "exit,error", timeout: 60 })
→ WatchResult { slot: 1, created: true, event: "pattern:…", … }
Report: "Server running in slot 1."
// Later: mcp__plugin_terminal_mux__watch-pane({ slot: 1, triggers: "error,idle:30" })
```

### Example E: database REPL in an isolated slot

```
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "psql $DATABASE_URL", pattern: "=#", timeout: 15 })
→ WatchResult { slot: 2, created: true, event: "pattern:=#", paneState: { foregroundCmd: "psql", waitingForInput: true, … } }
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "SELECT count(*) FROM users;", promptPattern: "=#", timeout: 10 })
→ { "slot": 2, "created": false, "output": "…\n count\n-------\n 1247", "exited": false }
mcp__plugin_terminal_mux__run-in-repl({ slot: 2, input: "\\q", promptPattern: "\\$", timeout: 5 })
mcp__plugin_terminal_mux__close-pane({ slot: 2 })
→ [ { "slot": 2, "action": "killed" } ]
```

### Example F: run something beside the user

**Use when**: the user says "run it here", "beside me", "in this window", "show alongside".

```
// Start it. No slot needed: slot 1 is the pane beside the user.
mcp__plugin_terminal_mux__send-keys({ keys: "bun test --watch", enter: true })
→ { "slot": 1, "created": true }

// Read it back — a snapshot, or block until something happens.
mcp__plugin_terminal_mux__capture-pane({ slot: 1 })
mcp__plugin_terminal_mux__watch-pane({ slot: 1, triggers: "idle:3,pattern:PASS|FAIL" })
→ { slot: 1, event: "pattern:PASS|FAIL", detail: "…", paneState: {…} }

// Let go of it when the task is done.
mcp__plugin_terminal_mux__close-pane({ slot: 1 })
```

**Key rules:** name no pane, only a slot; check `created` on every creating response; pass no direction; the pane may be one the user left open (§1d) — no slot number avoids that, only `isolated: true` does.

### Example G: tell the user a long command finished

```
mcp__plugin_terminal_mux__start-and-watch({ slot: 2, isolated: true, command: "npm run build", pattern: "built in|compiled successfully", triggers: "exit,error", timeout: 600 })
mcp__plugin_terminal_mux__notify({ message: "Build complete" })
```

`notify` is one-way. It cannot tell you whether the build passed — read the WatchResult for that.

## 10. Error handling

**Process stuck / command hangs**: `pane-state({ slot: 2 })` → `{ slot: 2, isAlive: true, waitingForInput: true, foregroundCmd: "psql", … }`. Recover with `send-keys({ slot: 2, keys: "C-c", literal: false })`, then `capture-pane({ slot: 2 })` to verify the prompt returned.

**Port already in use**: `start-and-watch` returns `event: "error"` or output containing `EADDRINUSE`. Free the port (`execute-command({ command: "lsof -ti:3000 | xargs kill", isolated: true })`), try another port, or report to the user.

**TUI app stuck**: `watch-pane` fires `idle:N`, or `pane-state` shows `isAlive: true` but nothing draws. Try `C-c` (`literal: false`), then `q`, then `close-pane({ slot })`.

**Password prompt**: `pane-state` shows `waitingForInput: true` and `capture-pane` output contains "password" → **STOP**. Never send credentials through `send-keys`; report to the user and let them authenticate.

**Slot not found**: a reading tool on a slot you never opened is an error, not an empty pane. `list-slots` shows what you hold; reopen with a creating tool. After compaction this is the common case.

**Long-running process (SSH, migration, deploy)**: migrations — always confirm with the user first. SSH — detect the password prompt with `pane-state` and stop. Deployments — `start-and-watch` with deploy-specific patterns; read `${CLAUDE_PLUGIN_ROOT}/skills/framework-signals/SKILL.md`.

## 11. Safety guidelines

1. **Never store credentials**: do not send passwords or API keys through `send-keys`. Use `pane-state` to detect password prompts and stop.
2. **Confirm destructive operations**: database migrations, `DROP TABLE`, production deployments — always confirm with the user.
3. **You cannot read a pane the user is using.** No tool takes a pane id. Run the process in a slot, or read its log file. Adopting an *idle* user shell into a slot is the one way user panes enter your reach, and the server does that, not you.
4. **Close what you opened**: `close-pane({ slot })` or `close-pane({ slot: "all" })`. It only ever interrupts an adopted pane, never kills it.
5. **Slots are the only address.** A slot can never be your own pane, and the server refuses any id you might pass. Check `pane-state.foregroundCmd` before sending into a slot you have not used this turn — after adoption or a user's intervention it may hold a REPL or an editor, and `send-keys` feeds whatever is in the foreground.

## 11b. Approval gate for destructive commands

Before running any command that cannot be undone, Claude must **stop and confirm** with the user.

**RPGAO loop** (for any terminal action):
```
READ    → capture-pane to see current state
PROPOSE → "I plan to run: {command}. Reason: {explanation}"
GATE    → "Shall I proceed?" (ALWAYS for destructive; optional for safe commands)
ACT     → send-keys or execute-command on user confirmation
OBSERVE → start-and-watch or watch-pane for the completion signal
→ Repeat from READ on failure
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

The GATE step is always required for any pattern in the table above. For safe, reversible commands, PROPOSE + ACT is sufficient.
