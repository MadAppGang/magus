# Orchestrator

Runs parallel ticket work as three levels of Claude Code sessions, each in its own tmux
window or herdr tab and git worktree:

| Level | How many | What it does |
|---|---|---|
| **Triage** | One per product, at the main checkout | Owns every ticket: files, places and links them, keeps the plan and the status, checks overlaps between running work, and starts ticket windows. Writes no code. |
| **Manager** | One per ticket, in its own window or tab and worktree | Reads the ticket, starts the matching dev workflow (`/dev:fix` for a bug, `/dev:dev` for a feature or improvement), owns the work through release, and runs child sessions for parts in other repos. |
| **Child** | As many as a ticket needs, each in a visible terminal slot of its manager's window | Does one named part, usually in another repo, and reports only to its manager. |

Messages go child → manager → triage and back the same way. The shared rules all three
levels follow are in `references/three-levels.md`.

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

`magus update` runs in the new window only when `magus` is installed; without it the step
is skipped.

## Start

1. Open a Claude Code session at the product repo's main checkout, on its default branch,
   and type `/orchestrator:triage`. That session is triage from then on.
2. Ask triage to start a ticket, or run `/orchestrator:start-ticket <ref>` yourself. It
   reads the ticket, picks the window colour from its labels (bug red, feature green,
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
`CLAUDE.md` names one, else an `in progress` label (created when missing) plus assigning the
issue to you.

`scripts/ticket-ref.ts` turns a reference into the tracker, the slug, the colour and the
window name, so every level agrees on them:

```
bun scripts/ticket-ref.ts <ref> [--labels <comma-separated>] [--words "<w1 w2 …>"] [--dir <checkout>]
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
CLAUDE_WT_NAME=<name> CLAUDE_WT_COLOUR=<colour> claude -w <name> -n <name> [--model M] [--effort E] '/color <colour>'
```

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
| `--dir <checkout>` | Start at another repo's main checkout instead of the current one |
| `--session <name>` | The tmux session to open the window in. tmux only |
| `--model <id>`, `--effort <level>` | Passed to Claude Code |
| `--launch <command>` | Your own launch command, as above |
| `--print-line` | Check the checkout and print the child line as JSON `{dir, branch, name, colour, line}`, where `line` is `cd '<checkout>' && git pull --ff-only && <launch>`. Opens nothing, takes no lock, needs no multiplexer. Not combinable with `--prompt`, `--session`, `--no-wait` or `--dry-run` |
| `--no-wait` | Return without waiting for a busy lock |
| `--dry-run` | Print what it would do, including the commands, without opening anything |
| `ORCHESTRATOR_MULTIPLEXER` | `tmux` or `herdr` forces the backend, for tmux inside herdr; any other value is an error |
| `ORCHESTRATOR_STATE_DIR` | Where the log and locks live (an absolute path) |

The JSON a start prints names the `multiplexer`, the tmux `session` and `window` or the
herdr `tab`, the `pane`, the `dir`, whether it typed the line, and the `log`.

| Exit | Meaning |
|---|---|
| `0` | Opened, would open (`--dry-run`), or line printed (`--print-line`) |
| `1` | Bad input, not inside tmux or herdr, `--session` under herdr, or a tmux, herdr or git error |
| `2` | The main checkout is off its default branch |
| `3` | The worktree already exists |
| `6` | Another start in the same checkout still holds the lock |

### State

The launcher keeps its log and locks in `ORCHESTRATOR_STATE_DIR` when set, else in
`~/.claude/orchestrator/`:

| Path | Contents |
|---|---|
| `ticket-window.log` | One line per start from the second stage: `SENT`, `READY`, `TIMEOUT`, `GONE`, `UNTRUSTED`, or one of the outcomes below |
| `locks/<checkout>` | The per-checkout start lock. A lock whose holder died, or older than 16 minutes, clears itself |

`SENT` means Claude Code took the prompt (herdr reports the agent working; under tmux the
screen shows it). The other prompt outcomes:

- `SENT (retyped once: the first copy was dropped)`: the first copy never reached the screen, so it was typed once more.
- `SENT (unconfirmed)`: the prompt is on screen but Claude Code was not seen starting on it; look at the pane before acting.
- `NOT_SENT`: the retyped copy did not land either, and it is never typed a third time; send the prompt by hand.

## First-run questions

The plugin keeps no per-product settings file. What it needs about a product — the
tracker, the status script, the release steps, the merge rule, which repos take a child —
it reads from the product repo's `CLAUDE.md`. When something is missing, the session asks
you once and stores the answer by its content:

| The answer | Stored in |
|---|---|
| Anything naming a client | Claude Code memory, never a repo |
| Team procedure: tracker, status script, release steps, merge rule | The product repo's `CLAUDE.md` |
| A mixed answer | Split sentence by sentence, each part to its own place |

Triage never commits on the main checkout. It sends a `CLAUDE.md` answer to a running
manager, which commits it on its own branch with its work.

## Known issues

- **A repo Claude Code has never opened.** Claude Code asks whether to trust a folder the
  first time, and `claude -w` refuses outright in an untrusted one. The launcher logs
  `UNTRUSTED` with the fix and releases the checkout's lock at once. Run `claude` once in
  that checkout, accept the trust dialog, and start again. A manager accepts the dialog for
  a child itself only in repos the product `CLAUDE.md` or you named for children; for any
  other repo it asks you.
- **A prompt logged `SENT` twice.** The log has shown one prompt `SENT` to two panes about
  90 seconds apart, and the cause is not known. Before acting on a `SENT` line, look at the
  pane it names; if a prompt ran twice, stop the duplicate session.
