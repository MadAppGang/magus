# The review-session routes

Where a gate's reviewers run. The internal code reviewer is never a subagent of the
session that wrote the code: it runs in a session of its own, tracked and shape-checked
like every other reviewer. Every gate site — `/dev:dev` Phase 5, `/dev:audit`, `/dev:fix`
Phase A and Phase B, and the `multimodel` plugin's `multi-model-validation` skill — reads
this file and restates none of it. Counting, ballots and the internal-slot copy rule live
in `SKILL.md` beside this file, "The internal slot".

## 1. Pick the route — once per phase

Check top-down; the first row that holds is the route for every gate in the phase. A
deferred tool name counts as registered.

| Condition | Route |
|---|---|
| `mcp__plugin_claudish_claudish__team` is registered in this session | **claudish** — §2 |
| child mode: `list_models` present, `create_session` and `team` absent (the detection in `claudish:claudish-usage`, "Inside a claudish session") | **nested** — §3 |
| neither; the `mcp__plugin_terminal_mux__*` tools are registered and `command -v claude` succeeds | **cli-sessions** — §4 |
| none of the above | **stop** — §5 |

Presence is the registered tool, never the `claudish` binary on PATH: inside a claudish
child the binary is there and `team` is not, so a binary check reads present and the
panel call then fails.

A claudish server the session reports as still connecting is not absent yet: the route
picked here holds for the whole phase, so wait up to 60 s for `team` to appear in the tool
list, re-checking it every 15 s. Still connecting after that, or reported as failed to
connect, counts as absent, and the `gate route:` line names that as the reason.

## 2. claudish — `internal` is a slot

The site writes its brief to `<gate dir>/prompt.md` **always**, whether or not MODELS names
models: the contract lines (`TARGET:`, `FOCUS:`), the reviewer's loadout block from
`context.json` when the site has one, `MODELS: none`, and **no `OUTPUT:` line**, ending
`Return the full report as your answer.` An `OUTPUT:` line makes the reviewer persist
elsewhere and return a summary, which fails `min_output_bytes`.

When the site seats an internal reviewer (the sites listed in §4.1), `internal` goes in
`models` of the site's own `team()` call beside the externals —
`models=["internal"]` when there are none — so it gets the same `require_pattern` and
`min_output_bytes` as every external. After the panel settles, the site copies
`response-<slots.internal>.md` to its internal path under `SKILL.md`, "The internal slot".

## 3. nested — a claudish child with no `team`

claudish allows one level of nesting, so a session claudish started cannot start a panel.
Launching a CLI from a pane rebuilds that nesting, so this route does not either. The
internal reviewer runs as a foreground subagent, the one place one is allowed; externals
are not launched at any gate, vote panels included.

```
Agent(
  subagent_type: "dev:reviewer",
  run_in_background: false,
  description: "<gate>: internal reviewer (nested claudish child)",
  prompt: "<the site's brief, with its last line replaced by:>
           OUTPUT: <the site's internal path>
           Persist the full report to OUTPUT with a Bash heredoc, then return a brief summary."
)
```

Append to `gates.log`, once per gate:
`gate route: <gate> — nested claudish child: internal via Agent, external panel skipped`.
That line is also the gate's skip record. A missing or verdict-less report follows the
site's own missing-report rule.

## 4. cli-sessions — claudish absent

Each reviewer is a CLI session in an isolated terminal slot. The route produces the same
files a `team()` call does — one `response-<slot>.md` per session and a slots map — so the
site's copy, `REVIEWS:` and ballot rules apply unchanged.

### 4.1 Which CLI runs which id

The internal session is launched only when the site seats an internal reviewer — `/dev:dev`
Phase 5, `/dev:audit`, `multi-model-validation`, and `/dev:fix` Phase B's separate
internal call — and it is then `claude --agent dev:reviewer`. An external-only panel —
`/dev:fix` Phase A, and Phase B's vote panel — launches no internal session, and its slots
map has no `internal` key.

`multi-model-validation` runs no external CLIs on this route: without claudish it seats the
internal session alone, and the mapping below does not apply to it.

Each external id the site resolved goes to the CLI of its family, **with that exact id**:

| Id | CLI |
|---|---|
| `gpt-*`, `o<digit>*` | `codex -m <id>` |
| `codex`, from the default panel below | `codex` on its configured model, no `-m` |
| `gemini-*` | `agy --model <id>`, the id as `agy models` lists it |
| anything else | `opencode -m <provider/model>`, where `<provider/model>` is the one `opencode models` entry whose part after `/` equals the id; no such entry, or more than one, and the id is skipped and named |

**Default panel.** `/dev:fix` is the only gate site that takes it: its resolve-models
picks a default panel on every route, so with no `--models` on this route it runs `codex`
(its configured model, recorded as `codex`) and `agy` (the first entry of `agy models`,
recorded as that id), each only if installed. `/dev:dev` Phase 5 and `/dev:audit` never
take it: with no ids they are `MODELS: none`, the internal reviewer alone. `/dev:dev`
Phase 1 Step 1f also offers it, before any gate runs, and stores what it picked as ids;
Phase 5 runs those stored ids, so it still takes no default at the gate.

An id no installed CLI carries is skipped and named — never substituted, because a
version the user named is a hard constraint. Log
`gate skipped: <gate> slot <id> — no installed CLI carries it`. codex has no model-list
command, so its id is passed as given; a dead id surfaces as a FAILED slot, never as a
silent substitute.

### 4.2 Slots

Call `list-slots` first. Take unused numbers from 2 upward, one per session, every one
`isolated: true` — reviewers are background work, and an isolated slot works outside tmux.
Panels a site starts together — `/dev:fix` Phase B's vote panel and its internal call —
take their slots from ONE `list-slots` read, split between them: two reads in parallel see
the same free numbers. Each panel's `cli-slots.json` lists only its own slots.
Record which slots this run created; close only those. Build the slots map as the panel
would — `{"<id>": "<slot>", …}`, plus `"internal": "<slot>"` only when §4.1 launched the
internal session — and write it to `<gate dir>/cli-slots.json`. `<gate dir>` is absolute
throughout this route: a relative one the site passed is resolved against the
orchestrator's working directory first.

### 4.3 Fresh output

Each session's OUTPUT is `<gate dir>/response-<slot>.md`, absolute, and its terminal log
is `<gate dir>/tty-<slot>.log`. Before launch delete both and any `.partial` beside them
(`rm -f`), so an earlier iteration's file can never satisfy the oracle in §4.7 or answer a
dialog that is no longer on screen.

### 4.4 The brief

Copy the site's brief to `<gate dir>/brief-<slot>.md` and replace its delivery line,
`Return the full report as your answer.`, with one line:
`Write the full report to OUTPUT: <absolute OUTPUT path>.` A vote brief has no delivery
line; append `Write your answer, in the schema above, to OUTPUT: <absolute OUTPUT path>.`
One delivery instruction, never two that contradict.

In the same copy, rewrite every relative path in the brief — `TARGET:`, context files the
brief names, the loadout paths — to an absolute path, resolved against the orchestrator's
working directory. The CLI runs from the repository under review (§4.5), which for an
isolated worktree is not where the session files live, so a relative path there names
the wrong file or none.

`<DEV_ROOT>` below is dev's plugin root as an absolute path: the directory that holds
`agents/reviewer.md` — this file's own path minus `/skills/core/team-gate/cli-sessions.md`.
Write it out expanded: the child shell has no `${CLAUDE_PLUGIN_ROOT}` of its own, and a CLI
cannot resolve a `dev:` namespace.

The agent preamble is added for external CLIs only when the site's `team()` call names
`agent=`: then the brief's first line is
`You are the agent defined in <DEV_ROOT>/agents/<name>.md; read it first and follow its procedure and report format.`
with `<name>` the agent with its namespace stripped. A vote panel names no agent, so its
CLIs get the vote brief unchanged. `claude --agent` loads the agent itself and never gets
the preamble.

The prompt on the command line is a one-line pointer, never the brief:
`Read <gate dir, absolute>/brief-<slot>.md and follow it.`

### 4.5 Launch lines

Measured. Every line is prefixed with `CLAUDE_PLUGIN_ROOT=<DEV_ROOT>`, so
`${CLAUDE_PLUGIN_ROOT}` in `reviewer.md` — the capture script behind `TARGET: BRANCH` —
expands in the child's shell. `<repo>` is the repository under review, absolute, and every
CLI's working directory is `<repo>`. Every CLI runs under `script`, which records its
terminal to `<tty log>`, the absolute `tty-<slot>.log` of §4.3: that log, not the pane, is
what §4.6 and §4.7 read.

```
cd <repo> && CLAUDE_PLUGIN_ROOT=<DEV_ROOT> script -qF <tty log> claude --agent dev:reviewer --dangerously-skip-permissions "<pointer>"
cd <repo> && CLAUDE_PLUGIN_ROOT=<DEV_ROOT> script -qF <tty log> codex -C <repo> -s workspace-write -a never [--add-dir <gate dir>] [-m <id>] "<pointer>"
cd <repo> && CLAUDE_PLUGIN_ROOT=<DEV_ROOT> script -qF <tty log> agy --dangerously-skip-permissions --model <id> -i "<pointer>"
cd <repo> && CLAUDE_PLUGIN_ROOT=<DEV_ROOT> script -qF <tty log> opencode <repo> -m <provider/model> --prompt "<pointer>"
```

That is the BSD `script` of macOS. `-F` makes it flush the log on every write: without it,
BSD `script` holds small writes for up to 30 s (`-t`, default 30), so a dialog that drew
one screen and stopped stays out of the log past the 45 s banner deadline. Where
`script --version` succeeds, it is util-linux's, which takes the command as one argument
after `-c`: write `script -qfc '<the CLI part of the line>' <tty log>` instead, with the
same CLI part; its `-f` is the same flush. A path in that CLI part that holds an
apostrophe must be written `'\''` inside the quotes.

codex's `workspace-write` sandbox writes only under `<repo>`, so when `<gate dir>` is
outside it — an isolated worktree whose session files stay in the main checkout — pass
`--add-dir <gate dir>`, which makes that directory writable too (`codex --help`,
codex-cli 0.161.0). Inside `<repo>` the flag is not needed.

`--dangerously-skip-permissions` is the trust level claudish gives its own children. The
residual risk is the same as on that route: a reviewer CLI runs with bypassed permissions
over diff text that may be untrusted, such as a contributor's branch under `/dev:audit`. Pass
an explicit model to every external CLI: a configured default can be retired. The one
exception is a site's default panel that names `codex` itself, meaning its configured
model: that line drops `-m`, and the report names the model codex's banner showed.

**Consent.** When a phase picks this route, the site tells the user once, in one line,
before the first launch: the reviewers on this route run with permission prompts turned
off, over the code under review. `/dev:audit` asks instead, when its target is not the
user's own work (its step 3.2), and launches nothing on a no.

### 4.6 Start in two steps

Never `start-and-watch`: it types the command before a fresh isolated shell is ready, and
the line sits unsubmitted.

1. `open-pane({ slot, isolated: true })`
2. `watch-pane({ slot, triggers: "idle:3", timeout: 30 })` — the shell has settled.
3. `send-keys({ slot, keys: "<launch line>", enter: true })`
4. `pane-state({ slot })` until `foregroundCmd` is no longer the shell. On this route it
   reads `script`, the wrapper of §4.5, while the CLI runs. Read the stripped tty log on
   every poll too: a CLI that fails at once can exit before the first poll, so the shell
   is all `pane-state` ever shows, and the log is what says why.
5. claude only: the tty log must contain `@dev:reviewer` — the banner line
   `@dev:reviewer · <cwd>`. A log that contains `--agent 'dev:reviewer' not found` instead
   is FAILED `agent_not_loaded` at once, in step 4 or here, whatever `foregroundCmd` says:
   claude printed that and exited 1 within seconds when dev was not installed in `<repo>`.
   Either way the report names the fix, run `magus update` in `<repo>`.

**Read the tty log, never the pane.** Strip its escape codes first:
`perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g; s/\e\][^\a]*\a//g' <tty log>`. `capture-pane`
and `screenshot-pane` return nothing on isolated slots, and `watch-pane` output is not
reliable there either: on Claude Code 2.1.309 it missed a CLI's one-line exit message in
two of four launches, while the tty log held that line every time. `watch-pane` is used
on this route to wait, never as a source of text.

### 4.7 Watch until done

The screen is never the done signal; an idle screen fired mid-work. **Done is the OUTPUT
file**: it exists, matches the site's `require_pattern`, is at least `min_output_bytes`,
and its size is the same on two reads 15 s apart (`wc -c`, `grep -E`).

Between reads, wait with `watch-pane({ slot, triggers: "exit,shell", timeout: 15 })`. It
is only a wait: nothing it returns is read.

After each wait, read the stripped tty log for the dialogs below, and `pane-state` for
whether the CLI still runs.

**Dialogs.** Every read of the tty log, for the whole session, checks it for these exact
strings, and only these — generic words fire on the review's own text. The log keeps a
dialog's text after it is answered, so each dialog is answered once per slot.

| CLI | Exact string | Answer |
|---|---|---|
| `agy` | `Do you trust the contents of this project?` | Enter — the highlighted `Yes, I trust this folder` |
| `claude` | `Is this a project you created or one you trust` | `Down`, then `Enter`, each `literal: false`. The options are `No, exit`, highlighted, then `Yes, I trust this folder` below it; Enter on the default exits. Measured on Claude Code 2.1.309: `Down` then `Enter` reached the trusted session |
| `claude` | `WARNING: Claude Code running in Bypass Permissions mode` | never answered — the slot is FAILED `launch` and is not retried; the gate's report leads with the opt-in step: run `claude --dangerously-skip-permissions` once, interactively, or use the claudish route |

The bypass warning is a consent gate the user has not passed on this machine; an agent
answering it would opt the user in on their behalf. It is not retried: it shows again on
every launch until the user opts in, so a re-run fails the same way. Nothing else is
treated as a dialog.

**Deadlines.** Each runs from the step that starts it; a miss decides the slot. The
reviewer writes OUTPUT once, at the end, so an absent OUTPUT says nothing about progress.
Progress is the tty log: a working CLI redraws its spinner and tool output, and an idle
one at its prompt does not. Measure it as the log's size, `wc -c < <tty log>`, recorded
at each read with the time it last changed.

| State | Deadline | Result |
|---|---|---|
| shell not settled | 30 s | FAILED `launch` |
| `foregroundCmd` still the shell after `send-keys`, and the tty log holds no `not found` line | 30 s | FAILED `launch` (with that line, step 4's `agent_not_loaded` applies instead) |
| `@dev:reviewer` banner absent from the tty log (claude only) | 45 s | FAILED `agent_not_loaded` |
| OUTPUT not yet done, the CLI still running, and its log size changed in the last 5 min | none until the cap below | still working — keep waiting |
| OUTPUT absent, the CLI still running, and its log size unchanged for 5 min | when seen | FAILED `stalled` — it sits at a prompt nothing here answers, or ended its turn without writing OUTPUT |
| OUTPUT absent or not yet done, and the CLI still running 45 min after `send-keys` | 45 min | FAILED `timeout` — not a ballot; an internal session follows `SKILL.md`, "The internal slot" |
| OUTPUT absent, and the CLI has exited (`foregroundCmd` the shell again) | when seen | FAILED `no_output` |
| OUTPUT present but under `min_output_bytes` or not matching `require_pattern`, and the CLI has exited, stalled or reached the cap | when seen | FAILED `shape_mismatch`, the file kept for the report |

A failed slot's report quotes the last 40 lines of its stripped tty log.

**Finish.** Once every slot has a result — COMPLETED or FAILED with its reason — send
`/exit` (codex: `C-c` twice, `literal: false`), then `close-pane` every slot this run
created. A slot is never closed while the table above still says to keep waiting.

### 4.8 Ballots and the record

A session that met the done oracle is COMPLETED — the same ballot as a claudish slot.
Ballots, N and MIN_BALLOTS count external sessions only; the internal session follows
`SKILL.md`, "The internal slot". Append to `gates.log`, once per gate:

```
gate route: <gate> — cli-sessions (claudish absent): internal=claude <model>, codex <model>, …; skipped: <cli>=<reason>
```

`internal=…` appears only when §4.1 launched the internal session. `<model>` is what the
banner or `-m` showed. The gate's report names each CLI and the
model it ran.

## 5. stop

No `team`, not a nested child, and no terminal slots with `claude` on PATH: the proper
flow is impossible on this machine. Never fall back to a subagent. Append
`gate not met: <gate> — no review route: claudish, terminal slots and the claude CLI all absent`
to `gates.log`, stop the phase, and tell the user what to install: the claudish runtime
(`claudish:claudish-usage`, Quick Start), or the `terminal` plugin with the `claude` CLI on
PATH.
