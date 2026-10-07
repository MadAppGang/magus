# Claudish Plugin

Provides the **Claudish MCP runtime** for the Magus marketplace. Claudish is an
external-model proxy that exposes tools (`team`, `create_session`, `list_models`,
etc.) for orchestrating multi-model workflows from Claude Code.

This plugin is a **runtime dependency**. Other plugins (`code-search`, `dev`,
`multimodel`, `designer`) declare it via the `dependencies`
field in their `plugin.json` and consume its tools through standard MCP.

## Why this plugin exists

Before this plugin, multiple Magus plugins each declared an identical Claudish
MCP server entry in their own `.mcp.json`. Claude Code's plugin loader
deduplicates by endpoint (`command + args`), so only the first plugin's
registration survived; others were silently suppressed. This worked **by
accident** as long as all declarations remained byte-identical.

Extracting the runtime into a dedicated plugin makes the dependency explicit,
follows Anthropic's documented `dependencies`-field pattern (Claude Code
v2.1.110+), and removes the silent-suppression footgun.

See: [Anthropic plugin dependencies docs](https://code.claude.com/docs/en/plugin-dependencies)

## Requirements

- The `claudish` CLI tool must be on `$PATH`. Install via npm:
  ```bash
  npm install -g claudish
  ```
- Provider credentials, which claudish resolves itself: from the environment, its
  own config, the macOS Keychain, or 1Password. `claudish --help` lists the
  credential commands.
- For the session progress monitor: claudish 10.4.0 or later, and `bun` on `$PATH`.

The plugin's `.mcp.json` declares no `env` entries, on purpose. The server inherits
Claude Code's environment, so an exported key reaches it without one. A
`"OPENROUTER_API_KEY": "${OPENROUTER_API_KEY}"` entry made Claude Code refuse to
start the server for every user who keeps keys outside the environment.

## What it provides

Tools exposed via the `claudish` MCP server:

- **Low-level**: `run_prompt`, `list_models`, `search_models`, `compare_models`
- **Agentic**: `team`, `report_error`
- **Channel**: `create_session`, `send_input`, `get_output`, `cancel_session`,
  `list_sessions`

Tool gating via `CLAUDISH_MCP_TOOLS` env var: `all` (default), `low-level`,
`agentic`, `channel`.

Plus one plugin monitor, `claudish-sessions`, which reports the progress of the
`create_session` and `team` runs this Claude Code session started. See
[Session progress monitor](#session-progress-monitor).

## Skills

| Skill | Covers |
|---|---|
| `claudish:claudish-usage` | Which MCP tool fits which task, model alias resolution against the live catalog, identity versus routing address, and the preferences-file trust rules |

Read it before any claudish work. It is the single place the resolution procedure
lives — every consumer plugin points here rather than restating it, because a second
copy of claudish's routing rules guarantees two versions of the truth and no way to
tell which one is stale.

**Models are run through the MCP tools, never the CLI.** The skill teaches `team`,
`create_session` and `run_prompt`; the binary's only remaining role is as the runtime
the MCP server launches, plus three read-only diagnostics (`--help`, `--version`,
`--models`) for investigating that runtime. No workflow shells out.

The skill lives here rather than in `multimodel` because it documents the claudish
runtime: a consumer that depends on claudish alone must find the resolution
procedure installed beside it, without also installing `multimodel`.

## Session progress monitor

`monitors/monitors.json` declares one Claude Code plugin monitor, `claudish-sessions`.
Claude Code starts it with every interactive session, with no launch flag. Apart from the
two notices below, it stays silent until that session starts claudish work. From then on it
prints one line per state change of:

- every `create_session` session this Claude Code session started;
- every `team(mode:"run")` run this Claude Code session started.

Each line reaches the model as a notification, so a caller acts on the end line instead of
polling `list_sessions` or `team(mode:"status")`. It does not end its turn relying on that
line alone: a plugin monitor's line woke an idle session in the two live sessions measured, and
two sessions are not a rate (see [Limits](#limits)), so a caller starts a bounded background
wait before it ends a turn with a run in flight. The `claudish:claudish-usage` skill, "Waiting for a run to end", gives the
wait.

### What it reports

Every line starts with `claudish-monitor:`. The monitor writes nothing else to stdout.

| Line | Meaning | Next action |
|---|---|---|
| `session ID started` | the session exists | note the id |
| `session ID running` | still running; at most one every 5 minutes | nothing |
| `session ID needs-input … next: send_input ID` | it finished a turn and waits for input | `send_input(ID, answer)` |
| `session ID needs-input … waited=…` | a wait that was already answered when the monitor read it | nothing |
| `session ID completed … next: get_output ID` | finished | `get_output(ID)` |
| `session ID failed` / `timeout … next: get_diagnostics ID` | ended badly | `get_diagnostics(ID)` |
| `session ID cancelled` | cancelled | nothing |
| `team ID started … path=P` | the panel exists | note the path |
| `team ID running …` | still running; at most one every 5 minutes | nothing |
| `team ID completed` / `failed` / `cancelled` `… next: team-status` | the run settled | `team(mode:"status", path=P)` |
| `notice claudish-too-old: …` | a claudish server in this session is older than 10.4.0; runs started through it are not reported | upgrade claudish, restart Claude Code |
| `notice no-session-identity: …` | the monitor cannot tell which runs are this session's | none; it exits |

`needs-input` is reported once per wait, and only interactive sessions wait (no `prompt`, or
after a `send_input`). A session started with a `prompt` never needs input. A wait still open
when its session ends is not reported; the end line is. A writer that dies before recording
an end is reported as `failed reason=no-terminal-record`.

Line grammar:

```
line          = "claudish-monitor:" SP ( session-line / team-line / notice-line )
session-line  = "session" SP id SP s-state *( SP field ) [ SP "next:" SP s-hint ]
s-state       = "started" / "running" / "needs-input" / "completed" / "failed" / "timeout" / "cancelled"
s-hint        = ( "get_output" / "get_diagnostics" / "send_input" ) SP id
team-line     = "team" SP id SP t-state *( SP field ) [ SP "next:" SP "team-status" ]
t-state       = "started" / "running" / "completed" / "failed" / "cancelled"
field         = key "=" value
key           = "model" / "elapsed" / "turns" / "replies" / "tools" / "cost" / "reason"
              / "exit" / "waited" / "slots" / "ok" / "failed" / "cancelled" / "running" / "path"
value         = 1*200( safe )         ; printable ASCII without space " & < = >
                                      ; only path reaches 200; every other value stops at 80
notice-line   = "notice" SP ( "claudish-too-old" / "no-session-identity" ) ":" SP text
id            = 1*64( ALPHA / DIGIT / "-" / "_" / "." )
```

Fields, in this order, each omitted when unknown:

| Line | Fields |
|---|---|
| session `started` | `model` |
| session `running` | `model elapsed replies tools cost` |
| session `needs-input` | `model elapsed turns` (+ `waited` once answered) |
| session `completed`, `cancelled` | `model elapsed turns tools cost` |
| session `failed`, `timeout` | `model elapsed turns tools cost reason exit` |
| team `started` | `slots path` |
| team `running` | `elapsed slots ok failed cancelled running path` |
| team `completed`, `failed`, `cancelled` | `elapsed slots ok failed cancelled reason path` |

- `elapsed` and `waited`: `7m41s` below one hour, `1h05m` from one hour.
- `turns` is claudish's completed-turn count; `replies` counts distinct assistant messages in
  the event log. They measure different things and are named apart on purpose.
- `cost`: `$0.00` for an exact zero, two decimals from one cent, up to four below it.
- `running` on a team `running` line counts every slot not yet finished, including one not
  yet started, so `ok + failed + cancelled + running` is `slots`. A slot counts as cancelled
  or failed the same way on both lines.
- `reason` on failure lines only: claudish's own reason, or the monitor's verdict
  `no-terminal-record`, `terminal-record-unreadable` or `unrecognised-status`.
- `path` is the team directory, relative to the project when inside it, and
  **percent-encoded** (decode it before passing it to `team`). A path over 200 characters
  keeps its last part after a `...`; the full path is `teamPath` in
  `<sessionsDir>/<id>/spawn.json`.
- `next: team-status` means: call `team(mode:"status", path=<the decoded path>)`.

Examples (`MODEL_ID` stands for whatever model the run used):

```
claudish-monitor: session 1a2b3c4d started model=MODEL_ID
claudish-monitor: session 9f8e7d6c needs-input model=MODEL_ID elapsed=1m12s turns=1 next: send_input 9f8e7d6c
claudish-monitor: session 1a2b3c4d completed model=MODEL_ID elapsed=7m41s turns=5 tools=22 cost=$0.09 next: get_output 1a2b3c4d
claudish-monitor: team team-5e6f7a8b completed elapsed=12m03s slots=4 ok=3 failed=1 cancelled=0 path=ai-docs/sessions/RUN/reviews/panel next: team-status
```

### How it knows which runs are yours

claudish 10.4.0 and later writes `<sessionsDir>/<id>/spawn.json` before each run starts.
`sessionsDir` is `$CLAUDISH_SESSIONS_DIR` when set and not empty, else
`$HOME/.claudish/sessions`, falling back to the OS account home only when `HOME` is unset or
empty. claudish and the monitor apply this one rule, so a sandbox or launcher that changes
`HOME` moves both together. Each applies it to its own environment, and the monitor's is
Claude Code's: set `CLAUDISH_SESSIONS_DIR` where Claude Code starts. Set only in the claudish
server's `env` block, it moves the writer and not the monitor, and no run is reported. The
record names the
Claude Code process that launched the claudish MCP server (`hostPid`). The monitor reports a
record only when that pid is its own window's Claude Code process (`CLAUDE_PID`), so two
windows never see each other's runs, even when they share a conversation. Runs that ended
before the monitor started are never reported.

### Limits

- **Needs claudish 10.4.0 or later.** An older claudish records no `spawn.json`, so its runs
  are not reported. The monitor prints one `claudish-too-old` notice when it reads a version
  below 10.4.0 from one of this session's claudish servers; when no version can be read, it
  prints none.
- **Waking an idle session: measured twice, not a rate.** A plugin monitor's line reaches the
  model as a notification (PMON-3), and in two live interactive sessions (Claude Code 2.1.290
  and 2.1.292) every end line arrived after the turn had ended and started a new one. Two
  sessions are not a rate, and under `claude -p` no monitor runs, so the shipped instructions
  never rely on it alone.
- **Needs `bun` on `PATH`.** Without it Claude Code reports `script failed (exit 127)` once
  per session.
- Not under `claude -p`, which starts no monitors. Not on Bedrock, Vertex or Foundry, nor
  with `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set.
- claudish must be launched directly by Claude Code, as this plugin's `.mcp.json` does. A
  wrapper process in between hides which window started a run, and its runs are not reported.
- A monitor that fails at start is not restarted until Claude Code restarts.
- One Bun process per Claude Code session, roughly 30-40 MB.
- Without `ps` there is no too-old notice and no check for a reused writer pid, and a run
  already in flight when the monitor starts is not picked up, not even when it ends.
- The too-old notice needs an npm or bun install of claudish whose path holds no space. A
  Homebrew or standalone binary gets none, because its version is not read without running
  it; neither does an install under a path with a space (such as `Application Support`),
  because a `ps` line cannot be split on it.
- After upgrading claudish, restart Claude Code: the old server keeps running, and its runs are
  not reported.
- **`run_prompt` writes no session record and is not reported.** Neither are `run-and-judge`
  and `judge`, although both start child processes: they hold the tool call open until the
  run ends and return the verdict in its result. `status` and `cancel` start nothing.
- A run still in flight when the monitor starts is picked up only when its record directory
  changed in the 62 minutes before: claudish's longest session timeout, 60 minutes, plus two.
  No session runs longer than that; a team run that has is not reported.
- claudish stops appending to a session's `waits.jsonl` once it holds 1 MiB, about 5,000
  waits. Waits after that are not reported.
- A team run whose end record cannot be written (a full disk, lost permissions, the record
  directory removed mid-run) is reported `running` until the window closes, and the wait in
  the `claudish:claudish-usage` skill runs to its ceiling.
- **`/clear` and an in-session `/resume`: measured once, survives both.** In one live session
  (Claude Code 2.1.290) the monitor process stayed the same across `/clear` and `/resume`, and
  a run started after each delivered its start and end lines.

### Monitor and channel mode

They are independent. The monitor is on by default, needs no flag, and reports state changes
only. Channel mode (below) is opt-in and pushes claudish's own event stream, including
per-tool progress. With both enabled you get both; neither reads the other.

## Channel notifications (optional)

Claudish emits `notifications/claude/channel` events during long-running model
sessions. To enable them in Claude Code:

```bash
claude --dangerously-load-development-channels plugin:claudish@magus
```

See the [Channels reference](https://code.claude.com/docs/en/channels-reference)
for what channels do, and Claudish's own `CLAUDE.md` "Channel Mode" section
for implementation details.

Requirements:
- Claude Code v2.1.80 or later
- Anthropic auth via claude.ai or Console API key (not Bedrock/Vertex/Foundry)
- Interactive mode (channels do not register in `-p` mode)

## Used by

This is a runtime dependency of:

- `code-search` — semantic code search via mnemex; uses Claudish for
  multi-model team review
- `dev` — universal development assistant; uses Claudish for `/dev:research`,
  `/team`, model orchestration
- `multimodel` — `/team` and `/delegate` slash commands
- `designer` — UI review with multi-model validation

If you are installing Magus, this plugin is auto-installed when any of the
above is enabled.
