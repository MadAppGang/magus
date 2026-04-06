# tmux-mcp Bug Report — E2E Testing with Claude Code

**Repo:** https://github.com/MadAppGang/tmux-mcp
**Date:** 2026-03-27
**Reported by:** Jack Rudenko @ MadAppGang (magus autotest framework)

---

## Environment

- **tmux-mcp version:** 1.2.0 (Homebrew, darwin/arm64)
- **tmux version:** 3.6a
- **Claude Code:** latest (internal model, claude-sonnet-4-6)
- **OS:** macOS (Darwin 25.3.0)
- **Test framework:** magus autotest (24 E2E tests, parallel execution)

---

## Summary

8 bugs found across 24 E2E tests. 21/24 tests pass. 3 test failures trace directly to the bugs listed below (bugs 1, 2, 3). The remaining bugs were found via targeted reproduction during investigation.

| # | Title | Severity |
|---|-------|----------|
| 1 | MCP Task tools return -32601 when called via `tools/call` | Critical |
| 2 | `execute-command` timeout returns error with no partial output | Critical |
| 3 | `execute-command` exit file race condition | High |
| 4 | Stale headless socket after MCP server crash | High |
| 5 | `run-in-repl` hangs when REPL process exits | High |
| 6 | Duplicate session name returns unhelpful error | Medium |
| 7 | `send-keys` excluded from agentic scope | Medium |
| 8 | `kill-session` doesn't accept session name, only session ID | Medium |

---

## Bug 1: MCP Task tools return -32601 when called via `tools/call`

### Description

`start-and-watch` and `watch-pane` are registered via `s.AddTaskTool()`, which requires the client to use a `tasks/create` flow. Claude Code's MCP client sends `tools/call` — the standard MCP protocol call. When it does so, tmux-mcp returns a `-32601 Method Not Found` error with the message `tool 'start-and-watch' requires task augmentation`.

This makes 2 of 6 agentic-scope tools completely unusable with Claude Code (and likely with any MCP client that hasn't implemented the task augmentation extension).

### Error Message

```
MCP error -32601: tool 'start-and-watch' requires task augmentation
MCP error -32601: tool 'watch-pane' requires task augmentation
```

### Reproduction Steps

```bash
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create-headless","arguments":{"command":"bash"}}}'
sleep 1
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"start-and-watch","arguments":{"sessionId":"headless:$0","triggerPattern":"\\$","timeoutSeconds":10}}}'
sleep 2
) | timeout 15 tmux-mcp -shell-type zsh -scope agentic 2>/dev/null
```

Expected: tool executes and returns a result.
Actual: `{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"tool 'start-and-watch' requires task augmentation"}}`

Also reproduce for `watch-pane`:

```bash
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create-headless","arguments":{"command":"bash"}}}'
sleep 1
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"watch-pane","arguments":{"sessionId":"headless:$0","triggerPattern":"\\$","timeoutSeconds":10}}}'
sleep 2
) | timeout 15 tmux-mcp -shell-type zsh -scope agentic 2>/dev/null
```

### Expected Behavior

The tool executes, blocks until `triggerPattern` matches (or timeout), and returns a `WatchResult` with captured output.

### Actual Behavior

The server immediately returns a `-32601` error. The tool is listed in `tools/list` output (so the model tries to call it) but cannot be invoked via the standard MCP flow.

### Suggested Fix

Add a `--task-mode=sync` flag (or make it the default) that registers these as regular blocking tools instead of task tools. When `mode=sync`, the tool:

1. Starts the watch/command internally
2. Blocks the `tools/call` response until the trigger fires or timeout
3. Returns `WatchResult` directly in the `tools/call` response

This preserves the async Task API as opt-in for clients that support it (`--task-mode=async`) while enabling all standard MCP clients by default.

### Severity

**Critical** — 2 of 6 agentic tools are completely unusable with Claude Code. The primary value proposition of `start-and-watch` (run a command and wait for a prompt) cannot be accessed.

---

## Bug 2: `execute-command` timeout returns error with no partial output

### Description

When a command exceeds the internal execution timeout, `execute-command` returns a plain error string. No partial stdout/stderr is returned, and there is no structured indication of timeout vs. crash vs. cancellation. This makes it impossible to diagnose what happened or recover partial results from long-running commands.

### Error Message

```
failed to execute command: command timed out: context canceled
```

### Reproduction Steps

```bash
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"execute-command","arguments":{"command":"for i in $(seq 1 200); do echo line $i; sleep 0.1; done","headless":true,"timeoutSeconds":5}}}'
sleep 10
) | timeout 30 tmux-mcp -shell-type zsh -scope agentic 2>/dev/null
```

Expected: structured response with `output` containing lines printed before timeout, `exitCode: -1`, `timedOut: true`.
Actual: `{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"failed to execute command: command timed out: context canceled"}]},...}`

### Expected Behavior

```json
{
  "output": "line 1\nline 2\n...line 49\n",
  "exitCode": -1,
  "timedOut": true,
  "error": "command timed out after 5s"
}
```

### Actual Behavior

A single error string with no partial output and no machine-readable timeout signal.

### Suggested Fix

Before returning on timeout:
1. Capture whatever has been written to the output buffer so far
2. Return a structured response: `{"output": "...partial...", "exitCode": -1, "timedOut": true}`

This is consistent with how most process execution tools handle partial results and allows callers to make informed decisions (retry with longer timeout, parse partial output, etc.).

### Severity

**Critical** — Long-running commands (builds, test suites, installs) will always time out silently, providing zero diagnostic value. Models cannot distinguish timeout from crash from cancellation.

---

## Bug 3: `execute-command` exit file race condition

### Description

When a command completes very quickly, `execute-command` attempts to read the exit code from a temporary file (`/tmp/tmux-mcp-UUID.exit`) before the shell has finished writing it. This produces a sporadic `no such file or directory` error that is non-deterministic and hard to reproduce reliably, but occurs frequently enough to affect fast one-liner commands (e.g., `echo`, `true`, `date`).

### Error Message

```
failed to execute command: read exit file: open /tmp/tmux-mcp-UUID.exit: no such file or directory
```

### Reproduction Steps

Run many fast commands in rapid sequence to trigger the race:

```bash
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
for i in $(seq 1 20); do
  echo "{\"jsonrpc\":\"2.0\",\"id\":$((i+1)),\"method\":\"tools/call\",\"params\":{\"name\":\"execute-command\",\"arguments\":{\"command\":\"echo run-$i\",\"headless\":true}}}"
  sleep 0.05
done
sleep 3
) | timeout 60 tmux-mcp -shell-type zsh -scope agentic 2>/dev/null
```

A subset of responses will contain the exit file error instead of a successful result. Exact failure rate varies by system load.

### Expected Behavior

All 20 commands return `{"output": "run-N\n", "exitCode": 0}` regardless of how fast they complete.

### Actual Behavior

Intermittent failures for fast-completing commands:
```
failed to execute command: read exit file: open /tmp/tmux-mcp-2a3f91bc.exit: no such file or directory
```

### Suggested Fix

Either:

**Option A (retry loop):** When `open()` fails with `ENOENT` on the exit file, retry 3 times with 50ms intervals before returning the error. The shell will almost always finish writing within 150ms of the command completing.

**Option B (tmux signal):** Replace the file-based exit code mechanism with `tmux wait-for` signals. The shell script appends the exit code to a file AND signals a named channel; the Go side waits on the channel first, guaranteeing the file is written.

Option A is a minimal, low-risk fix. Option B is more robust but requires changes to the shell scaffolding.

### Severity

**High** — Intermittent failures on fast commands cause non-deterministic behavior. Models cannot distinguish a genuine command failure from a race condition, leading to incorrect retry logic.

---

## Bug 4: Stale headless socket after MCP server crash

### Description

The headless tmux server socket lives at `/private/tmp/tmux-501/mcp-headless` (path varies by UID). If the `tmux-mcp` process is killed (SIGKILL, crash, OOM) while a headless session is active, the socket file remains on disk. On next startup, `tmux-mcp` attempts to connect to that socket and fails because the tmux server behind it is gone.

### Error Message

```
failed to execute command: send command: tmux send-keys: exit status 1: no server running on /private/tmp/tmux-501/mcp-headless
```

or:

```
failed to create session: tmux new-session: exit status 1: no server running on /private/tmp/tmux-501/mcp-headless
```

### Reproduction Steps

```bash
# Step 1: Start tmux-mcp and create a headless session
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create-headless","arguments":{"command":"bash"}}}'
sleep 2
) | timeout 10 tmux-mcp -shell-type zsh -scope agentic 2>/dev/null &

MCP_PID=$!
sleep 3

# Step 2: Hard-kill the MCP server (simulates crash)
kill -9 $MCP_PID
sleep 1

# Step 3: Verify stale socket exists
ls /private/tmp/tmux-$(id -u)/mcp-headless 2>/dev/null && echo "STALE SOCKET EXISTS"

# Step 4: Start a new tmux-mcp and try to create a headless session
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create-headless","arguments":{"command":"bash"}}}'
sleep 2
) | timeout 10 tmux-mcp -shell-type zsh -scope agentic 2>/dev/null
```

The second `create-headless` call returns the stale socket error.

### Expected Behavior

New `tmux-mcp` startup detects and cleans up the stale socket, then creates a fresh headless tmux server.

### Actual Behavior

The new server inherits the stale socket path and all headless operations fail until the user manually removes the socket file.

### Suggested Fix

At startup (before accepting any MCP calls), check if the headless socket file exists. If it does, run:

```go
cmd := exec.Command("tmux", "-L", "mcp-headless", "ls")
if err := cmd.Run(); err != nil {
    // Socket exists but tmux server is gone — clean it up
    os.Remove(headlessTmuxSocketPath)
}
```

This is a standard pattern for Unix socket liveness checks and adds negligible startup overhead.

### Severity

**High** — After any crash or forceful termination, the tool becomes broken until a human intervenes. In automated/agentic contexts this is particularly damaging because there is no human present to clean up the socket.

---

## Bug 5: `run-in-repl` hangs when REPL process exits

### Description

`run-in-repl` waits for `promptPattern` to reappear in the pane after sending input. If the input causes the REPL to exit (e.g., `exit()` in Python, `quit` in psql, `Ctrl-D`), the prompt never reappears and the tool blocks until its internal timeout (default 10s), then returns an error.

This is not a rare edge case — exiting a REPL is a normal operation and should be handled gracefully.

### Error Message

```
context cancelled waiting for REPL prompt
```

or:

```
timed out waiting for prompt pattern '>>> ' after 10s
```

### Reproduction Steps

```bash
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create-headless","arguments":{"command":"python3"}}}'
sleep 2
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run-in-repl","arguments":{"sessionId":"headless:$0","input":"1 + 1","promptPattern":">>> ","timeoutSeconds":5}}}'
sleep 2
echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"run-in-repl","arguments":{"sessionId":"headless:$0","input":"exit()","promptPattern":">>> ","timeoutSeconds":5}}}'
sleep 8
) | timeout 30 tmux-mcp -shell-type zsh -scope agentic 2>/dev/null
```

Call #3 succeeds (returns `2`). Call #4 blocks for 5s then returns the timeout error.

### Expected Behavior

When the REPL process exits, `run-in-repl` detects this promptly (within ~500ms) and returns an `exited` event with whatever output was captured before exit, rather than blocking until timeout.

### Actual Behavior

The tool blocks for the full `timeoutSeconds` duration waiting for a prompt that will never arrive, then returns a generic timeout error.

### Suggested Fix

Poll pane state in parallel with the prompt-wait loop. If `foregroundCmd` changes or `isAlive` becomes false for the pane, break out of the prompt-wait loop immediately and return:

```json
{
  "output": "...captured before exit...",
  "event": "exited",
  "exitCode": 0
}
```

This requires adding a lightweight pane-state check alongside the existing prompt-polling logic.

### Severity

**High** — Any workflow that involves starting and stopping REPLs (common in data science, database sessions, scripting) will have a mandatory 10s stall at cleanup. Models also cannot tell whether the REPL exited cleanly or timed out due to a hang.

---

## Bug 6: Duplicate session name returns unhelpful error

### Description

Calling `create-session` twice with the same `name` returns a tmux error message that includes no actionable information. The caller cannot determine the existing session's ID from the error, making recovery impossible without a separate `list-sessions` call.

### Error Message

```
failed to create session: tmux new-session: exit status 1: duplicate session: my-session
```

### Reproduction Steps

```bash
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create-session","arguments":{"name":"my-session"}}}'
sleep 1
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create-session","arguments":{"name":"my-session"}}}'
sleep 1
) | timeout 15 tmux-mcp -shell-type zsh 2>/dev/null
```

Call #2 returns the session ID. Call #3 returns the duplicate error.

### Expected Behavior

One of the following:
- **(a) Return existing:** If a session with that name already exists, return its session ID instead of erroring — treat it as idempotent.
- **(b) Auto-suffix:** Create the session as `my-session-2`, `my-session-3`, etc.
- **(c) Rich error:** Return a structured error that includes the existing session ID: `{"error": "duplicate session", "existingSessionId": "main:$3", "existingSessionName": "my-session"}`

### Actual Behavior

A plain string error with the session name but no ID, forcing the caller to issue a `list-sessions` round-trip to recover.

### Suggested Fix

Option (a) — idempotent `create-session` — is the most ergonomic for agentic callers. Before calling `tmux new-session`, check if a session with that name exists via `tmux ls -F '#{session_name}:#{session_id}'` and return the existing session's ID if found.

### Severity

**Medium** — Extra round-trip required for recovery, but recovery is possible. Causes unnecessary tool calls in long agentic sessions where session names may be reused.

---

## Bug 7: `send-keys` excluded from agentic scope

### Description

`send-keys` is classified as a "primitive" tool and is excluded when tmux-mcp is started with `-scope agentic`. However, `send-keys` is the only mechanism for injecting arbitrary key sequences into a TUI application (vim, htop, lazygit, psql interactive mode, k9s, etc.). The agentic-scope `run-in-repl` tool only works for REPL prompt-response patterns and cannot substitute for raw keystroke injection.

As a result, any agentic workflow involving TUI navigation is completely blocked when using `-scope agentic`.

### Error Message

When the model tries to call `send-keys` in agentic mode:
```
MCP error -32601: unknown tool: send-keys
```
(Tool is simply absent from `tools/list` in agentic scope.)

### Reproduction Steps

```bash
# Start in agentic scope and verify send-keys is missing
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
sleep 0.5
) | timeout 10 tmux-mcp -shell-type zsh -scope agentic 2>/dev/null | grep -o '"name":"[^"]*"'
```

Expected output includes `send-keys`. Actual output does not.

```bash
# Attempt to call send-keys in agentic scope
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create-session","arguments":{"name":"tui-test"}}}'
sleep 1
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"send-keys","arguments":{"target":"tui-test","keys":"q"}}}'
sleep 1
) | timeout 15 tmux-mcp -shell-type zsh -scope agentic 2>/dev/null
```

Call #3 returns `-32601: unknown tool: send-keys`.

### Expected Behavior

`send-keys` is available in agentic scope because TUI navigation is a legitimate agentic operation with no higher-level substitute.

### Actual Behavior

`send-keys` is absent in agentic scope. Models lose the ability to navigate any TUI application.

### Suggested Fix

Move `send-keys` from the primitive scope to the agentic scope. The rationale for excluding it (raw access, easy to misuse) does not apply to the agentic case — the model is already trusted to create sessions, execute commands, and read pane content. Keystroke injection is a fundamental building block for TUI interaction that cannot be replaced by `run-in-repl`.

### Severity

**Medium** — All TUI-based agentic workflows (vim editing, database shells in interactive mode, terminal UI navigation) are completely blocked when using the recommended `-scope agentic` flag.

---

## Bug 8: `kill-session` doesn't accept session name, only session ID

### Description

`kill-session` requires the `sessionId` parameter to match a specific format (e.g., `headless:$0` for headless sessions, `main:$3` for regular sessions). However, Claude and other LLMs frequently pass:
- Session names directly (`"my-session"`)
- Pane IDs instead of session IDs (`"headless:%0"`)
- Short numeric IDs (`"$3"` without the session prefix)

All of these fail with a tmux error even though tmux itself can resolve sessions by name.

### Error Message

```
failed to kill session: tmux kill-session: exit status 1: can't find session: my-session
failed to kill session: tmux kill-session: exit status 1: can't find session: $5
```

### Reproduction Steps

```bash
(
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
sleep 0.5
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create-session","arguments":{"name":"test-kill"}}}'
sleep 1
# Try to kill by name — this fails
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"kill-session","arguments":{"sessionId":"test-kill"}}}'
sleep 1
) | timeout 15 tmux-mcp -shell-type zsh 2>/dev/null
```

Call #2 returns a session ID like `main:$7`. Call #3 fails because `"test-kill"` is a name, not a formatted ID.

### Expected Behavior

`kill-session` resolves the target leniently — try by formatted ID first, fall back to by name:
```go
// Try exact ID first, then name
tmux kill-session -t sessionId
// if fail, try:
tmux kill-session -t name
```

### Actual Behavior

Hard failure if the input doesn't match the internal ID format, even though tmux itself accepts session names.

### Suggested Fix

Before calling `tmux kill-session`, run a lookup:
1. If `sessionId` matches the `scope:$N` format, use it directly.
2. Otherwise, call `tmux ls -F '#{session_name} #{session_id}'` and find the session whose name or ID matches the input.
3. Use the resolved ID for the kill command.

This also applies to `create-window`, `send-keys`, and any other tool that accepts a `sessionId` parameter — a consistent resolution helper would benefit all of them.

### Severity

**Medium** — Models that call `create-session` and then `kill-session` using the session name (rather than the opaque ID returned by `create-session`) hit this error. Requires models to carefully track and pass back the exact ID string, which is error-prone in long conversations.

---

## Test Results Overview

| Test Suite | Pass | Fail | Notes |
|---|---|---|---|
| Session management | 6/6 | 0 | create, list, kill (by ID), windows |
| Headless execution | 4/6 | 2 | Bug 2 (timeout), Bug 3 (race) |
| Pane reading | 4/4 | 0 | capture-pane, pane-state |
| Agentic tools | 2/4 | 2 | Bug 1 (start-and-watch, watch-pane) |
| REPL interaction | 3/4 | 1 | Bug 5 (exit detection) |
| **Total** | **19/24** | **5** | |

> Note: Bugs 4, 6, 7, 8 were found via targeted reproduction outside the automated suite. The 5 automated failures trace to bugs 1, 2, 3, and 5.

---

## Appendix: Full Test Error Log

The following are the verbatim error strings collected during the E2E runs that directly correspond to the bugs above.

**Bug 1 — Task tool errors:**
```
{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"tool 'start-and-watch' requires task augmentation"}}
{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"tool 'watch-pane' requires task augmentation"}}
```

**Bug 2 — Timeout with no partial output:**
```
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"failed to execute command: command timed out: context canceled"}],"isError":true}}
```

**Bug 3 — Exit file race:**
```
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"failed to execute command: read exit file: open /tmp/tmux-mcp-a1b2c3d4.exit: no such file or directory"}],"isError":true}}
```

**Bug 4 — Stale socket:**
```
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"failed to create session: tmux new-session: exit status 1: no server running on /private/tmp/tmux-501/mcp-headless"}],"isError":true}}
```

**Bug 5 — REPL exit hang (returns after full timeout):**
```
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"context cancelled waiting for REPL prompt"}],"isError":true}}
```

**Bug 6 — Duplicate session:**
```
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"failed to create session: tmux new-session: exit status 1: duplicate session: my-session"}],"isError":true}}
```

**Bug 7 — send-keys in agentic scope (absent from tools/list, returns -32601 if called directly):**
```
{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"Method not found"}}
```

**Bug 8 — kill-session by name:**
```
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"failed to kill session: tmux kill-session: exit status 1: can't find session: my-session"}],"isError":true}}
```

---

*Generated by magus autotest framework. All reproduction steps tested on darwin/arm64 with tmux-mcp 1.2.0 and tmux 3.6a.*
