# Terminal Plugin E2E Test Suite

Tests whether Claude accomplishes real developer tasks using the terminal plugin's
`mcp__tmux__*` tools from the Go tmux-mcp binary (v4.0.0).

## What Changed in v4.0.0

The terminal plugin was completely rewritten:

- **ht-mcp is gone** — no more `mcp__ht__*` tools
- **Single Go binary** — `tmux-mcp` replaces both `ht-mcp` and the old npm tmux-mcp
- **New agentic tools**: `start-and-watch`, `watch-pane`, `run-in-repl`, `pane-state`
- **`execute-command` is synchronous** — returns output directly, no polling needed
- **`execute-command { headless: true }`** — auto-creates and destroys a session for one-shot commands
- **`capture-pane { lines: N }`** — retrieves scrollback history, no line limit
- **No 40-line rule** — full output returned by `execute-command` via tee-to-file

## What It Tests

24 test cases organized in 6 categories:

### Category 1: Core agentic tools (8 tests)

| ID | Description |
|----|-------------|
| `execute-headless-01` | One-shot `execute-command { headless: true }`, verify marker |
| `execute-sync-02` | Multi-line output, verify no truncation (30 lines) |
| `start-and-watch-server-03` | Start server, detect "listening" readiness pattern |
| `start-and-watch-timeout-04` | Pattern that never matches, verify timeout behavior |
| `watch-pane-pattern-05` | Create session, watch for signal with `watch-pane` |
| `run-in-repl-python-06` | Python REPL calculations, verify 385 and 1024 |
| `pane-state-running-07` | Verify running process detected, then killed |
| `pane-state-waiting-08` | Verify shell prompt shows `waitingForInput: true` |

### Category 2: Headless sessions (4 tests)

| ID | Description |
|----|-------------|
| `headless-create-execute-09` | Create headless, run command, verify, kill |
| `headless-isolation-10` | Headless sessions don't appear in `list-sessions` |
| `headless-lifecycle-11` | Full lifecycle: create → execute → capture → kill → verify |
| `headless-server-cleanup-12` | Multiple headless sessions, `kill-headless-server` cleans all |

### Category 3: No token/line limits (3 tests)

| ID | Description |
|----|-------------|
| `no-truncation-100-lines-13` | Generate 100 lines, verify NOTRUNC_LINE_100 present |
| `scrollback-200-lines-14` | Generate 200 lines, `capture-pane { lines: 200 }`, verify completeness |
| `large-output-tee-15` | Generate 500 lines, verify LARGE_LINE_500 in execute-command output |

### Category 4: Session management (3 tests)

| ID | Description |
|----|-------------|
| `session-create-list-kill-16` | Create 2 sessions, kill one, verify list updated |
| `tmux-command-workflow-17` | Create session, execute-command with marker, capture-pane, kill |
| `tmux-observe-readonly-18` | List sessions and capture pane without modifications |

### Category 5: Pane management (4 tests)

| ID | Description |
|----|-------------|
| `split-pane-horizontal-19` | Split horizontally, run command in new pane, verify |
| `split-pane-beside-20` | Natural language "run beside me" — must use split-pane |
| `split-label-reuse-21` | Split, label as claude-helper, reuse — split-pane called once |
| `send-keys-literal-22` | `literal:true` for text, `literal:false` for C-c / Enter |

### Category 6: TUI and REPL integration (2 tests)

| ID | Description |
|----|-------------|
| `vim-file-create-23` | Open vim in headless, insert text, save, verify file |
| `repl-calculation-24` | Python REPL: sum of squares of 1-10 = 385 |

## Prerequisites

- `claudish` CLI (`npm install -g claudish`), `bun`, `jq`
- Terminal plugin enabled with tmux-mcp configured
- `tmux` available on the system
- `tmux-mcp` Go binary installed (`go install github.com/MadAppGang/tmux-mcp@latest`)

## Running

```bash
./autotest/terminal/run.sh                                          # all tests
./autotest/terminal/run.sh --cases execute-headless-01             # single test
./autotest/terminal/run.sh --model google/gemini-2.5-flash         # different model
./autotest/terminal/run.sh --parallel 3                            # parallel
./autotest/terminal/run.sh --dry-run                               # preview only
./autotest/terminal/run.sh --cases no-truncation-100-lines-13 --timeout 60
```

## Check Types

| Check | Description |
|---|---|
| `has_tool_prefix` | At least one call starts with `mcp__tmux__` |
| `tools_used_include_any` | At least one full tool set from the OR list satisfied |
| `min_tool_calls` | Minimum total MCP tool calls |
| `min_tool_calls_by_name` | Minimum calls per named tool (short name) |
| `max_tool_calls_by_name` | Maximum calls per tool — used for "exactly once" checks |
| `response_contains` | Final response contains this exact string |
| `response_contains_any` | Final response contains at least one of these strings |
| `tool_arg_match` | MCP tool was called with specific argument value |
| `bash_command_contains_any` | At least one Bash tool call contains one of these strings |

Tool names are normalized: `mcp__tmux-mcp__*` = `mcp__tmux__*`.

## Results

Written to `autotest/terminal/results/run-<timestamp>/`:
- `terminal-analysis.json` — structured check results per test
- `results-summary.json` — aggregated summary
- `<model>/<case_id>/transcript.jsonl` — full conversation transcript

## Known Limitations

- **Debug log parsing**: Only works for OpenRouter-routed models. Native Anthropic and
  OpenAI Direct logs use different SSE formats. Response content checks work for all models.
- **Parallel execution**: Running with `--parallel` causes debug log cross-contamination
  (all tests share the claudish proxy). Run with `--parallel 1` for clean per-test metrics.
- **MCP Tasks API not yet supported by Claude Code** (tests 03 and 05):
  `start-and-watch` and `watch-pane` are registered as MCP Task tools in the Go binary
  (`s.AddTaskTool`). The MCP Tasks API requires the client to call `tasks/create` instead
  of `tools/call`. Claude Code's MCP client currently uses `tools/call` for all tool
  invocations, which causes the server to return:
  ```
  MCP error -32601: tool 'start-and-watch' requires task augmentation
  ```
  Tests `start-and-watch-server-03` and `watch-pane-pattern-05` will fail with this error
  until Claude Code implements `tasks/create` per the MCP specification.
  Reference: https://spec.modelcontextprotocol.io/specification/server/tasks/
