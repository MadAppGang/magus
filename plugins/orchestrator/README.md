# Orchestrator

Runs parallel ticket work as three levels of Claude Code sessions, each in its own tmux
window or herdr tab and git worktree:

| Level | How many | What it does |
|---|---|---|
| **Triage** | One per product, at the main checkout | The only session that starts ticket sessions, files tickets or changes their scope. Places what managers find, keeps the plan, the status and the product's workbook, and checks overlaps between running work. Writes no code. |
| **Manager** | One per ticket, in its own window or tab and worktree | Reads the ticket, starts the matching dev workflow (`/dev:fix` for a bug, `/dev:dev` for a feature or improvement), owns the work through release, and runs child sessions for parts in other repos. |
| **Child** | As many as a ticket needs, each in a visible terminal slot of its manager's window | Does one named part, usually in another repo, and reports only to its manager. |

Messages go child → manager → triage and back the same way. The shared rules all three
levels follow are in `references/three-levels.md`.

**Related work goes into one ticket**, not a new ticket each time. Sessions working the
same area collide, and every ticket run costs setup, cleanup and a switch of your
attention, the costliest of the three. So triage packs related work into one ticket, and
its manager runs the whole list, across one or several repos and worktrees through its
children, while your attention stays in one place.

## Requirements

- `bun`, `git` and the `claude` CLI on `PATH`.
- Claude Code running inside **tmux** or **herdr**.
- The `terminal` plugin, whose `mux` server opens, drives, reads and closes the child slots.
  It must carry a tmux-mcp whose `capture-pane` returns the screen text:
  terminal 5.6.1 or later, which carries tmux-mcp 2.2.0.
- The `dev` plugin, for the workflows a manager starts.
- `gh`, signed in, for GitHub Issues; a Linear MCP server for Linear.
- A bash or zsh shell in new panes. The launcher types a POSIX shell line into the new
  pane; with another shell (fish, for example) set `ORCHESTRATOR_LAUNCH` to a command that
  shell can run.
- Claude Code with function-hooks modules, for the status band only. An engine without them
  refuses the module and loads the rest of the plugin.

`magus update` runs in the new window only when `magus` is installed; without it the step
is skipped.

## Start

1. Open a Claude Code session at the product repo's main checkout, on its default branch,
   and type `/orchestrator:triage`. That session is triage from then on.
2. Ask triage to start a ticket, or run `/orchestrator:start-ticket <ref>` yourself in the
   triage session. It reads the ticket, picks the window colour from its labels (bug red, feature green,
   improvement blue), opens a new tmux window or herdr tab with a worktree, types
   `/orchestrator:manager <id> <url> — <title>` into the new Claude Code session there, and
   sets the ticket in progress.
3. When a ticket needs work in another repo, its manager opens a child in a visible slot of
   its own window with `/orchestrator:child`. You do not start children yourself.

Starts are one at a time per checkout: the window runs `git pull --ff-only`, the optional
`magus update` and the worktree creation on the same main checkout. The launcher holds a
lock per checkout, so a second start waits for the first.

## Trackers

Every session works a ticket through four actions: read it, set it in progress, add a
progress note, and (triage only) create or update one. Which tracker serves them is decided
in this order:

1. The product repo's `CLAUDE.md` names a tracker and how to do the four actions. Any
   tracker works this way.
2. Otherwise the ticket reference decides:

   | Reference | Tracker |
   |---|---|
   | `#123`, `owner/repo#123`, `https://github.com/<owner>/<repo>/issues/123` | GitHub Issues, through `gh` |
   | `https://linear.app/<workspace>/issue/ABC-123` | Linear, through its MCP server |
   | `ABC-123` | Linear when exactly one Linear MCP server is connected; otherwise step 3 |

3. Otherwise the session asks you once and stores the answer in `CLAUDE.md`.

GitHub has no In Progress state, so "in progress" there is the repo's own convention when
`CLAUDE.md` names one, else an `in progress` label (created when missing), added by the
start, plus the manager assigning the issue to itself.

`scripts/ticket-ref.ts` turns a reference into the tracker, the slug, the colour and the
window name, so every level agrees on them:

```
bun scripts/ticket-ref.ts '<ref>' [--labels <comma-separated>] [--words "<w1 w2 …>"] [--dir <checkout>]
```

It prints `{tracker, id, slug, repo, number, colour, name}`; `colour` and `name` are `null`
until `--labels` and `--words` give what they need. Names are the slug (`abc-123`, `gh-123`
for this repo's issue, `<repo>-123` for another repo's) plus 2 to 4 title words, at most 48
characters. Colour comes from the labels by word, any case: bug, bugfix, fix or defect →
red; feature, enhancement or feat → green; improvement, chore, refactor or perf → blue; red
wins over green, green over blue. Exit `0` resolved, `1` bad input or a reference it does
not recognise.

## Children in slots

A manager runs each child in a visible slot of the terminal plugin, in its own window. It
takes the lowest free slot, opens it with `layout: "agent-grid"`, types the child's launch
line, waits for Claude Code, types the prompt, and answers the child's setup questions and
menus one key at a time, reading the screen with `capture-pane` before and after each key.

With the grid layout the manager's pane stays full height on the left, and the children
share the right side:

| Children | Manager width | Right side |
|---|---|---|
| 0 | 100 % | — |
| 1 | 50 % | one pane |
| 2–3 | 40 % | one column |
| 4–6 | 30 % | 2 rows, up to 3 across |
| 7–10 | 25 % | 2 rows, up to 5 across |
| 11+ | 25 % | 3 rows |

The layout is re-applied on every slot open and close. A tmux-mcp without the layout mode
ignores the argument and places slots as it always has. More than 10 children at once need
your word: the manager stops at 10 and tells you.

A child closes only after it has reported and its work is proven merged (the PR is
`MERGED`, or its branch is in the default branch). The manager then types `/quit`, chooses
**Remove worktree**, which also deletes the branch, checks the shell came back, and closes
the slot. Work that is not proven merged keeps its worktree; the manager's final report
names it with its branch and last commit.

A child's own terminal slots are isolated, so they never split panes inside its manager's
window.

## The launcher

`scripts/ticket-window.ts` opens the window or tab and types one line into its shell:

```
git pull --ff-only && { magus update, when magus is installed } && <launch>
```

Inside tmux it opens a window in the current session; inside herdr, a tab in the current
workspace that does not take focus. herdr inside tmux counts as herdr. By default `<launch>`
starts Claude Code in a new worktree named after the ticket:

```
ORCHESTRATOR_CLAIM='l-<id>' CLAUDE_WT_NAME=<name> CLAUDE_WT_COLOUR=<colour> claude -w <name> -n <name> [--model M] [--effort E] '/color <colour>'
```

**The launch claim.** Before it types or prints a line, the launcher writes a one-shot claim
under a fresh launch id: the new session's role (manager for a window, child for
`--print-line`), its name, its ticket, its parent (the launching session's own record) and
the product. The line carries only `ORCHESTRATOR_CLAIM='l-<id>'`, plus
`ORCHESTRATOR_STATE_DIR` when that is set. The first Claude Code session that starts with
that id binds itself to the claim and becomes that role in the family. A session nested
inside it (a `claude -p`, a claudish panel) inherits the variable, finds the claim taken,
and stays a plain session: no role, no record, no band row.

To use your own launch command instead, set `ORCHESTRATOR_LAUNCH` or pass `--launch`. It is
called as:

```
<launch> <name> <colour> [-- <claude flags>]
```

The flags after `--` are the `--model` and `--effort` the start asked for, if any. The
command must start Claude Code in a worktree named `<name>`, and must type no prompt itself:
the launcher's second stage waits for Claude Code to come up and types the prompt.

| Flag or variable | Does |
|---|---|
| `--name <name>`, `--colour <colour>` | The window, worktree and branch name, and its colour. Required |
| `--prompt "<text>"` | The prompt typed once Claude Code is up |
| `--ticket '<id>'`, `--ticket-url '<url>'` | The ticket the new session works, recorded in its claim. Single-quote them: an unquoted `#123` starts a shell comment. A bare number becomes `owner/repo#N` from the checkout's origin. A child started by a manager carries the manager's own ticket, whichever repo it runs in; a `--ticket` naming another ticket is refused |
| `--dir <checkout>` | Start at another repo's main checkout instead of the current one |
| `--session <name>` | The tmux session to open the window in. tmux only |
| `--model <id>`, `--effort <level>` | Passed to Claude Code |
| `--launch <command>` | Your own launch command, as above |
| `--print-line` | Check the checkout, write the child's claim, and print the child line as JSON `{dir, branch, name, colour, line, claim}`, where `line` is `cd '<checkout>' && git pull --ff-only && <launch>`. Opens nothing, takes no lock, needs no multiplexer. Not combinable with `--prompt`, `--session`, `--no-wait` or `--dry-run` |
| `--no-wait` | Return without waiting for a busy lock |
| `--dry-run` | Print what it would do, including the commands, without opening anything or writing a claim (the line shows `ORCHESTRATOR_CLAIM='l-dry-run'`) |

The environment variables it reads are in "Environment variables" below.

The JSON a start prints names the `multiplexer`, the tmux `session` and `window` or the
herdr `tab`, the `pane`, the `dir`, whether it typed the line, and the `log`.

| Exit | Meaning |
|---|---|
| `0` | Opened, would open (`--dry-run`), or line printed (`--print-line`) |
| `1` | Bad input, not inside tmux or herdr, `--session` under herdr, a tmux, herdr or git error, or the claim could not be written (nothing is typed or printed then) |
| `2` | The main checkout is off its default branch |
| `3` | The worktree already exists |
| `6` | Another start in the same checkout still holds the lock |

### State

The launcher, the hooks and `orch-state` keep their files in `ORCHESTRATOR_STATE_DIR` when
set, else in `~/.claude/orchestrator/`:

| Path | Contents |
|---|---|
| `ticket-window.log` | One line per start from the second stage: `SENT`, `READY`, `TIMEOUT`, `GONE`, `UNTRUSTED`, or one of the outcomes below |
| `locks/<checkout>` | The per-checkout start lock. A lock whose holder died, or older than 16 minutes, clears itself |
| `claims/<launch id>.json` | A launch claim, written once by the launcher; deleted by `orch-state prune` after 24 hours |
| `sessions/<key>.json` | A session's identity: role, name, ticket, parent, product, its session id and process. Written only when the session binds |
| `progress/<key>.json` | A session's progress: tasks, dependencies, a block, holds, done. Written only by that session's own `orch-state` calls |
| `by-session/<session id>` | The key a session id belongs to, so a resumed session finds its record |

`<key>` is the session's family key, which survives `/clear`, a resume and, for triage, a
restart: `l-<id>` for a launched manager or child, `t-<hash>` for a product's triage,
`s-<session id>` for a manager or child registered by hand. Each file has one writer, and
every write goes to a temporary file that is renamed over the old one, so a reader always
sees a whole file.

`SENT` means Claude Code took the prompt (herdr reports the agent working; under tmux the
screen shows it). The other prompt outcomes:

- `SENT (retyped once: the first copy was dropped)`: the first copy never reached the screen, so it was typed once more.
- `SENT (unconfirmed)`: the prompt is on screen but Claude Code was not seen starting on it; look at the pane before acting.
- `NOT_SENT`: the retyped copy did not land either, and it is never typed a third time; send the prompt by hand.

## The status band

A band above the prompt lists the sessions of this session's family, one row each:

| Column | Shows |
|---|---|
| Name | the session's name, else its ticket id |
| Level | triage, manager or child |
| Ticket | the ticket it works |
| Status | `working`, `idle`, `waiting` (on you, or on a recorded dependency), `blocked` (it needs you), `done`, or `gone` (its process ended) |
| Progress | tasks done over total, from the manager's progress table |
| Waits on | what it waits for or is blocked by, and for how long |

Triage sees its whole family, plus any session of the same product registered by hand,
marked `(no parent)`. A manager sees triage, itself and its children; a child sees triage,
its manager and itself. When the rows do not fit, a `More` button opens the full list.

Each row has four actions:

| Action | Does |
|---|---|
| **Jump** | focuses that session's tmux window and pane, or its herdr tab and pane |
| **Show** | its live screen, read-only, with its task list and dependencies, in a panel beside the chat when the terminal is fullscreen and at least 110 columns wide, else above the prompt |
| **Open** | its ticket URL in the browser |
| **Msg** | prefills a message to that session in your prompt |

The band comes from a function-hooks module that loads with the plugin. In a session that
is not part of an orchestrated family it draws nothing and does nothing beyond one file check
every few seconds. Status, what a session waits on, its name and its pane come from Claude
Code's own session files; the plugin's record adds only what those lack. A session whose
process has ended shows as `done` or `gone`, never as working.

## The status record and `orch-state`

`scripts/orch-state.ts` records what the band cannot see for itself. The role skills call
it; you rarely need to.

```
bun scripts/orch-state.ts <verb> [flags]
```

| Verb | Does | Called by |
|---|---|---|
| `register --role triage\|manager\|child [--name N] [--ticket '<id>'] [--ticket-url '<url>']` | binds this session to its record, or creates one | each role skill, as it loads |
| `tasks` | replaces the task list with the markdown table on stdin (`\| # \| Step \| Who \| State \|`) and prints it back, normalised | the manager, in the same step that updates its progress table |
| `dep add <kind>:<ref> [--note T]`, `dep done`, `dep drop` | a dependency on a session (`session:<name>`), a pull request (`pr:<full URL>`) or a release (`release:"<artifact> <version>"`) | any level, when it starts waiting and when that arrives |
| `block "<reason>"`, `unblock` | the session needs you | any level |
| `hold "<what>"`, `release "<what>"` | the session holds a shared environment, such as a test server | any level |
| `done` | the session finished, after its final report | manager, child |
| `show [--table]` | prints the record, or its task table | anyone |
| `prune [--days 7]` | deletes records of sessions gone that long, claims older than 24 hours, and stale temporary files | anyone |

The session is `CLAUDE_CODE_SESSION_ID`, so the CLI runs from inside a Claude Code session.
It prints one JSON line (`tasks` and `show --table` print the table on stdout and the JSON
on stderr).

| Exit | Meaning |
|---|---|
| `0` | Done |
| `1` | Bad input: an unknown verb or flag, a bad dependency kind, a `pr:` that is not a full URL, a table with no rows, a role change, or another live triage owning the product |
| `2` | `CLAUDE_CODE_SESSION_ID` is not set |
| `3` | This session owns no record; run its role skill, or `register --role <role>`. Also: another live process of the same session holds the record, or the command cannot find the Claude Code process it runs under while the record's holder is live; it then writes nothing |
| `4` | The write failed; the message names the path |

**How a session gets its role.** A launched manager or child binds to its launch claim as it
starts. Each role skill also runs `register` as it loads, so triage (which no launcher
starts) and a manager or child you started by hand get a record too. That runs through a
`` !`…` `` line in the skill, which Claude Code runs without asking in auto mode and asks
about once in default mode; when it does not run, the skill's Step 0 has the same command
for the session to run. A `/clear` keeps the record (it is matched by the process), and a
resumed session finds it through its session id.

## Triage is the gatekeeper

Only triage starts a ticket session, creates a ticket, or changes a ticket's scope.
Managers and children send findings and scope changes to triage, and triage replies `taken`
with where each went. A `PreToolUse` hook enforces it, reading the role from the session's
own record:

| Session | Refused | Allowed |
|---|---|---|
| **Manager** | `/orchestrator:start-ticket`; the launcher in ticket mode; creating, deleting or transferring a ticket; editing a title or description; every label change; any write to another ticket; any `gh issue` write without `-R <owner/repo>`, or with `GH_REPO` set | On its own ticket: state, assignee, comments, and attached links or files. The launcher with `--print-line` or `--dry-run`, to start a child |
| **Child** | Every tracker write, comments included, and every launcher call | Reads |
| **Triage**, or a session with no record | Nothing | Everything |

A refusal names triage as the route, and the field, flag or tool that decided it. Progress
goes into comments on the session's own ticket, because a hook cannot tell a progress edit
of the description from a scope edit.

**Bash is judged by an allow-list.** A command that names `gh` together with `issue`,
`label`, `api`, `project` or `alias`, or names the launcher, is refused in a manager or
child session when it holds a command or process substitution anywhere (`$(…)`, a
backtick, `<(…)`, `>(…)`, in an assignment, a redirection or an unquoted `<<EOF` heredoc
body), or anything that runs text it is given (`sh`, `bash`, `eval`, `xargs`, `env -S`, a
`bun` or `node` with `--eval`, `--print`, `--preload`, `--require`, `--import` or `--loader`,
or with no script). To pass a comment body, write it to a file and use `--body-file <file>`,
or `--body-file - <<'EOF'`: a quoted delimiter keeps the body as text.

Each part of the line that names `gh` or the launcher must then be a plain command in an
allowed form: `gh issue view|list|status`, `gh label list|view`, any `gh pr` command,
`gh api` as a GET (no `-X` other than GET, no `-f`, `-F` or `--input`), and for a manager
also `gh issue comment|edit|close|reopen` on its own ticket with `-R <owner/repo>` (comment:
`--body`, `--body-file`, `--attach`; edit: the assignee flags only; close and reopen:
`--comment`, and `--reason completed` or `not planned`), and the launcher with
`--print-line` or a `--dry-run`. A loop, a condition, a group, a variable as the command, a
pager or editor variable in front, or a wrapper such as `env`, `time` or `timeout` is
refused unread. The other parts of the line pass, so `cd ../app && gh issue view 7` and
`gh issue view 7 | head` work. A heredoc under a quoted delimiter that only feeds a command
data (`orch-state tasks`, `gh … --body-file -`, `git commit -F -`, `cat > file`) is not read
as commands; one fed to a shell is. When such a heredoc is the only place the line names
`gh` or the launcher, the line is refused if any of its commands runs a file or text: a
shell, `source` or `.`, `bun` or `node`, a path such as `./x.sh`, or a name the line writes
as a file, so `cat > x.sh <<'EOF' … EOF` followed by `bash x.sh` in the same call is
refused. A command that only mentions `gh` or the launcher
passes: `grep`, `rg`, `cat`, `less`, `echo`, `sed -n <range>p`, `bun test`,
`git add|commit|status|diff|log|show` with no flag that runs a pager, a diff driver or a
configuration value, and `orch-state`. Every other command is not touched.

Tracker MCP servers are recognised by name: every write of a Linear, Jira, YouTrack,
Shortcut, ClickUp or Asana server, and the issue, label, project and milestone writes of a
GitHub, GitLab or Atlassian server. A manager may edit or delete no comment; a new comment
or a reply on its own ticket, an attachment on it and the file upload that precedes one, a
workflow transition of it, and a state change whose reason is not `duplicate`, pass.

**It fails open.** A session that never ran an orchestrator role skill, and was not
launched by the orchestrator, owns no record, so the hook allows everything after one file
check. A hook error, or a check slower than 3 seconds, allows too.

### What the guard does not stop

The guard stops a cooperative model that drifts out of its role and reaches the tracker with
ordinary forms: `gh` in a command line, a substitution, a heredoc, a wrapper, a runtime flag,
a tracker MCP tool. It is not a sandbox against a model that sets out to evade it, and it
does not try to become one by matching more patterns. Known limits:

- Command words built at runtime: a variable set in an earlier call and run in a later one,
  `gh iss${U}ue`, ANSI-C quoting such as `$'\x69ssue'`, a glob such as `ticket-win*.ts`.
- Other HTTP clients reaching the tracker API: `curl`, `wget`, or a tracker API key used
  directly.
- Interpreters reaching it on their own, with no `gh` word or launcher on the line:
  `python -c`, `node -e`, `perl -e`.
- A script file written in one Bash call and run in a later call (written and run in the
  same call is refused), a `gh` alias defined before the session, and a tracker MCP server
  under a name the list above does not hold.

**Other gaps.**

- A GitHub MCP comment on a pull request number is judged as an issue comment and refused;
  use `gh pr comment`, which the hook does not touch.
- `/orchestrator:start-ticket` typed by you in a manager session never passes through the
  Skill tool, but its launcher call is still refused.
- `orch-state register --role triage` in a plain session makes it triage, by design. A
  session that already has a role cannot change it.

## The herdr sidebar

Under herdr, each orchestrated session also publishes its state to herdr's own sidebar
with `herdr pane report-metadata --source orchestrator`: a title (`<role> · <ticket or
name>`, plus `· blocked` when it needs you) and a label for each state herdr shows, for
example `idle=<ticket> 3/5 · waits <PR URL>`. Only the session that owns the record publishes,
after each `orch-state` write and when it starts; when it ends, the title and labels are
cleared. Detection is automatic: herdr when `HERDR_ENV` and `HERDR_PANE_ID` are set and
`ORCHESTRATOR_MULTIPLEXER` is not `tmux`. A failed publish never fails the command.

## The workbook

What the sessions need about a product, apart from the tracker, lives in one committed file
in the product repo: `.claude/orchestrator/workbook.md`. Triage owns it: it asks you once
when something is missing, and writes your answer there so no session asks again. A pointer
line in the product's `CLAUDE.md` makes every session find it.

```markdown
# Orchestration workbook

## Rules                your standing rules, quoted
## Release              release branch, release procedure, merge rule, scope check
## Status script        where it lives, how to run it
## Repos for children   which repos take a child, trust already granted
## Shared environments  names that need a hold
## Areas                which parts collide (feeds the packing rule and overlap checks)
## Decisions            your words, quoted, and where each was recorded
```

Answers are stored by their content:

| The answer | Stored in |
|---|---|
| Anything naming a client | Claude Code memory, never a repo |
| Which tracker, and how to do its four actions | The product repo's `CLAUDE.md` |
| Any other procedure, rule or decision | The workbook |
| A mixed answer | Split sentence by sentence, each part to its own place |

Triage never commits on the main checkout. It sends the workbook text to a running manager,
which commits it on its own branch with its work.

Before a release, the releasing session lists what it ships with
`git log --first-parent <release branch>..<default branch>`, the release branch taken from
the workbook (for example `prod..main`), and says whether anything in it is unproven.

## Environment variables

| Variable | Read by | Does |
|---|---|---|
| `ORCHESTRATOR_STATE_DIR` | launcher, hooks, `orch-state`, band | Where the log, locks, claims and records live (an absolute path). Default `~/.claude/orchestrator/`. The launcher passes it on to the sessions it starts |
| `ORCHESTRATOR_LAUNCH` | launcher | Your own launch command, as `--launch` |
| `ORCHESTRATOR_MULTIPLEXER` | launcher, `orch-state`, band | `tmux` or `herdr` forces the backend, for tmux inside herdr; any other value is an error in the launcher |
| `ORCHESTRATOR_CLAIM` | hooks, `orch-state` | Set by the launcher on the line it types: the launch claim the new session binds to. Never set it yourself |
| `HERDR_ENV`, `HERDR_PANE_ID` | launcher, hooks, `orch-state`, band | herdr detection and the pane to publish to |
| `CLAUDE_CODE_SESSION_ID` | `orch-state`, hooks | The session a call belongs to, set by Claude Code |
| `CLAUDE_CONFIG_DIR` | `orch-state`, hooks, band | Where Claude Code's session files are. Default `~/.claude` |

## Resuming a session in another folder

`claude --resume` lists only the current folder's sessions. To resume a manager or child,
`cd` into its worktree first, then resume: it finds its record and its row returns to the
band.

## Known issues

- **A repo Claude Code has never opened.** Claude Code asks whether to trust a folder the
  first time, and `claude -w` refuses outright in an untrusted one. The launcher logs
  `UNTRUSTED` with the fix and releases the checkout's lock at once. Run `claude` once in
  that checkout, accept the trust dialog, and start again. A manager accepts the dialog for
  a child itself only in repos the workbook or you named for children; for any other repo it
  asks you.
- **A prompt logged `SENT` twice.** The log has shown one prompt `SENT` to two panes about
  90 seconds apart, and the cause is not known. Before acting on a `SENT` line, look at the
  pane it names; if a prompt ran twice, stop the duplicate session.
