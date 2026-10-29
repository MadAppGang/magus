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

The plugin's `.mcp.json` declares no `env` entries, on purpose. The server inherits
Claude Code's environment, so an exported key reaches it without one. A
`"OPENROUTER_API_KEY": "${OPENROUTER_API_KEY}"` entry made Claude Code refuse to
start the server for every user who keeps keys outside the environment.

## What it provides

Tools exposed via the `claudish` MCP server:

- **Low-level**: `run_prompt`, `list_models`, `search_models`
- **Agentic**: `team`, `preflight`, `report_error`
- **Session**: `create_session`, `send_input`, `get_output`, `get_diagnostics`,
  `capture_session`, `cancel_session`, `list_sessions`
- **Debug**: `compare_models`, for claudish's own developers

Tool gating via `CLAUDISH_MCP_TOOLS` env var: `all` (default), `low-level`,
`agentic`, `session`, `debug`. The plugin sets none, so every tool is exposed.

`run_prompt` is one completion straight to one model's API: no tools, no session, so it is
never subagent work. Work goes through `create_session`, a panel through `team`.

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

## Monitoring sessions

claudish pushes nothing into the conversation; `list_sessions` is the live view. Each row
carries `state`, `activity`, `idle_seconds`, and on a failed or timed-out row
`reason_detail`, the provider's error message in at most 160 characters. A live row also
carries `recent`, the current turn's last 20 steps (`{at, kind, tool, summary}`), so a poll
shows what happened since the last one. Polling about every 10 seconds is enough.

## Live run status

Measured on Claude Code 2.1.286, 2.1.292 and 2.1.296 (see **Older Claude Code** below). While a `team(mode="run")`
run or a `create_session` session that this Claude Code session started is going, a band
above the prompt shows it, one line per model:

```
◆ claudish  review · 2 running · 1 done · 1 earlier run
  01  RUN  1m12s  gpt-6.1-sol  OpenRouter   ↑12.7k ↓780   ƒ 4  ↻ 1  $0.42  ▰▱▱▱▱     Read   [ Stop ] [ Show ]
  02  RUN    58s  glm-5.3      Z.ai          ↑9.1k ↓2.2k  ƒ 6  ↻ 2  $0.08  ▰▰▰▱▱ 1m  Bash   [ Stop ] [ Hide ]
  03  END  2m40s  haiku        Anthropic    ↑31.0k ↓4.1k  ƒ 9  ↻ 1    SUB                   [ Show ]
```

The band shows the run started most recently, plus any older run that is still going.
Older finished runs are counted in the header (`1 earlier run`), not listed.

Each line starts with the status: a three-letter code on a coloured badge, then how long the
slot has run, in the same colour.

- `RUN` and `NEW` are blue, and `END` is green.
- `ASK` (the slot needs you: input or a permission) is amber.
- `ERR`, `TMO`, `NIL` and `LST` (it failed) are red, and `STP` (stopped) is grey.
- `FMT` means the model answered but missed the format the run required (`shape_mismatch`).
  Its answer is still on disk, so it is gold, not red.

Then come:

- the model, as a coloured badge with its provider (the model is the one column that never drops);
- the tokens badge, sent (`↑`) and received (`↓`);
- tool calls (`ƒ`) and loops (`↻`);
- what the slot cost, or `SUB` when it runs on a subscription (claudish reports no charge, or it is
  a native Claude model); `—` when claudish reports nothing;
- the stale-meter;
- what the model is doing now.

The colours are madbench's, in a light and a dark set. Inside tmux the set follows the theme
of the tmux window showing the session (the same answer Claude Code's `/theme auto` gets);
otherwise `TERM_THEME=light|dark`; otherwise dark. Claude Code's shared `theme` setting is not
read, so changing `/theme` in one session never repaints another.

The Stop and Show buttons sit at the right edge of the line. The stale-meter fills one cell at
10, 30, 60, 90 and 120 seconds without activity: green, then amber from one minute, red from
two. From 30 seconds it also prints the time. On a narrow terminal the least important columns
drop first; a line never wraps.

- **Stop** cancels that one slot and nothing else. Press it twice: the first press turns
  the button into `[ Stop? ]`, and a second press within four seconds sends the cancel.
  Cancelling is not a read, so Claude Code then asks its own permission question before
  anything stops.
- **Show** opens a tab for that slot, titled by its model: the model's live screen,
  read-only, in the model's own colours, with its prompt on the tab's bottom edge.
  - The tabs sit in a panel beside the conversation when Claude Code runs fullscreen at 110
    columns or wider, and above the prompt otherwise. If Claude Code cannot draw a tab, a
    toast says why.
  - Tabs belong to the runs the band shows: once a newer run replaces an older one, the older
    run's tabs close.
- **Hide** puts the panel away and keeps its tabs. While a tab is open, its line reads
  `[ Hide ]`; the next Show on any line brings the panel back with every tab it had. Escape
  closes the tab you are in.
- **Wake-up.** When a model in a run this session started finishes, fails or is stopped —
  or a `create_session` session starts waiting for input or a permission — an idle
  session wakes on its own: Claude gets a short notice naming the slot and how to fetch
  its result, and you see a toast. Runs another session started never wake this one.

**One turn per change.** A run that settles, or a `create_session` session that starts
waiting, is named in exactly one prompt, as soon as the band sees it. A slot of a `team` run
that ends while other slots still run gets its own notice; the next arrives as the next slot
ends. While Claude is in the middle of a turn, notices wait for that turn to end and then go
together in one prompt.

**What it does not show.** A `team(mode="run-and-judge")` call answers only once the run and
its judging have finished, so the band first sees it settled and does not show it, and it
cannot be stopped from the band. Runs started before the plugin loaded, or by anything other
than this session's own claudish tool calls, are not shown either.

**Read-only calls do not prompt.** The plugin allows claudish's read-only calls — listing
runs, a run's status, a slot's screen, listing sessions, a session's screen, and the
account-pool report (`allowance_status`) — before
Claude Code's permission check, so they never ask you and never wait behind another open
question, such as Stop's own. It does so for claudish installed through this plugin and for
a `claudish` server you registered yourself, and it matches each tool by its exact name. This
applies to Claude's own calls of those tools too. Starting a run, cancelling one, and every
other claudish call still ask as usual.

Your own permission rules still win: Claude Code applies a matching `deny` rule (the call is
blocked) and a matching `ask` rule (you are asked) whatever the plugin answers. To be asked
again for these calls, add an `ask` rule for them; the band's refresh then asks too.

**What it needs.** The band comes from the claudish CLI's status answers, which exist from
claudish **10.4.0** (mod contract version 1). With an older claudish the band never
appears and nothing else changes; run `claudish update` (or reinstall it) to get it.

**Where it stays off.** The band is a Claude Code mod, so it is inert wherever Claude Code
refuses mods: `--bare`, safe mode, `disableAllHooks`, and a folder you have not trusted.
claudish's tools keep working in all of these.

**Older Claude Code.** The band needs Claude Code 2.1.286 or later. On 2.1.250 and 2.1.284
Claude Code shows a one-line notice at startup (`claudish: hooks module did not load: … is not
an event`) and runs without the band; on 2.1.223 nothing is shown. claudish's MCP tools, the
read-only allow and the dependency check work on every one of these versions. Update Claude
Code to get the band.

**On Claude Desktop**, the band and the tabs work in the Code tab, but a wake-up's turn
stays invisible until you type something
([anthropics/claude-code#96336](https://github.com/anthropics/claude-code/issues/96336)).
The toast is the visible signal there.

## Allowance

When claudish pools several Codex accounts, a one-row band above the prompt shows how the pool
is doing, and `[ Show ]` opens a forecast panel. Everything comes from claudish's read-only
`allowance_status` report; the plugin computes no forecast of its own, and a part claudish does
not send is simply not drawn.

```
 1  wk▮▮▮▮ █▆▄▂▁▂▄▆█ 1.4M/h now━━1h━━6h━━━━1d━━━━━┈┈┈┈3d┈┈2−86%┈2━━6d [ Show ]
```

The band, left to right:

- the account in use, by its number in `claudish account list` order, and its 5-hour and weekly
  minis;
- the pace gauge: nine bars, the middle three green at the safe pace; left is under-use
  (amber), right is too fast (yellow to red);
- your speed per hour, in the colour of the gauge's tip;
- a ruler from now to six days ahead: an account's number where it takes over, `┈` for the
  window it may take over in, a red `╳` where no account has allowance left, and a number with
  `−NN%` where that much of an account's week would go unused before it refills.

The panel, top to bottom:

- **Next switch.** Which account hands over to which, each account's 5-hour and weekly
  allowance left with time to refill, the likely window in hours, the speed gauge with the safe
  pace, and the hour-by-hour likelihood of the switch up to its latest time (soonest, usual,
  latest).
- **The week strip.** Which account is in use each hour, real and predicted; the switch
  windows; each account's refills and unused allowance; and, when claudish sends it, the same
  plan at the lower use claudish names (`slower`, for example `⅓ less busy`), with `→ no gap`
  or `→ gap`. The slower plan is drawn as claudish sends it: it can switch earlier, not only
  later.
- **Speed**, **left now** per account, and a legend for the marks drawn.

Speeds are claudish's compute units per hour (`cu/h`). "safe" is the fastest pace at which
claudish forecasts no hour with every account empty.

**How often.** The band asks claudish once a minute (every five minutes while claudish has too
little history to forecast). It asks for the forecast every five minutes, and every minute
while the panel is open.

**What it needs.** claudish **14.5.0** or later for the band; **14.8.0** for the switch
likelihood. With an older claudish the band stays off, and nothing else changes.

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
