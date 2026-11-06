# Orchestrator

Runs parallel ticket work as three levels of Claude Code sessions, each in its own tmux
window and git worktree:

| Level | How many | What it does |
|---|---|---|
| **Triage** | One per product, at the main checkout | Owns every ticket: files, places and links them, keeps the plan and the status, checks overlaps between running work, and starts ticket windows. Writes no code. |
| **Manager** | One per ticket, in its own window and worktree | Reads the ticket, starts the matching dev workflow (`/dev:fix` for a bug, `/dev:dev` for a feature or improvement), owns the work through release, and runs child sessions for parts in other repos. |
| **Child** | As many as a ticket needs, in a pane of its manager's window | Does one named part, usually in another repo, and reports only to its manager. |

Messages go child → manager → triage and back the same way. The shared rules all three
levels follow are in `references/three-levels.md`.

## Requirements

- `bun`, `tmux`, `git` and the `claude` CLI on `PATH`.
- Claude Code running inside tmux.
- A bash or zsh shell in new tmux panes. The launcher types a POSIX shell line into the new
  pane; with another shell (fish, for example) set `ORCHESTRATOR_LAUNCH` to a command that
  shell can run.
- The `dev` plugin, for the workflows a manager starts.

`magus update` runs in the new window only when `magus` is installed; without it the step
is skipped.

## Start

1. Open a Claude Code session at the product repo's main checkout, on its default branch,
   and type `/orchestrator:triage`. That session is triage from then on.
2. Ask triage to start a ticket, or run `/orchestrator:start-ticket <ID>` yourself. It reads
   the ticket, picks the window colour from its label (Bugfix red, Feature green,
   Improvement blue), opens a new tmux window with a worktree, types
   `/orchestrator:manager <ID> <url> — <title>` into the new Claude Code session there, and
   sets the ticket In Progress.
3. When a ticket needs work in another repo, its manager opens a child pane beside itself
   with `/orchestrator:child`. You do not start children yourself.

Starts are one at a time per checkout: the window runs `git pull --ff-only`, the optional
`magus update` and the worktree creation on the same main checkout. The launcher holds a
lock per checkout, so a second start waits for the first.

## The launcher

`scripts/ticket-window.ts` opens the window or pane and types one line into its shell:

```
git pull --ff-only && { magus update, when magus is installed } && <launch>
```

By default `<launch>` starts Claude Code in a new worktree named after the ticket:

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

Exit codes: `0` opened, `1` bad input, not inside tmux, or a tmux or git error, `2` the main
checkout is off its default branch, `3` the worktree already exists, `6` another start in
the same checkout still holds the lock. Run it with `--dry-run` to see what it would do
without opening anything.

### State

The launcher keeps its log and locks in `ORCHESTRATOR_STATE_DIR` when set (an absolute
path), else in `~/.claude/orchestrator/`:

| Path | Contents |
|---|---|
| `ticket-window.log` | One line per start from the second stage: `SENT`, `READY`, `TIMEOUT` or `GONE` |
| `locks/<checkout>` | The per-checkout start lock. A lock whose holder died, or older than 16 minutes, clears itself |

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

- **Run `claude` once in a new repo before the first start there.** Claude Code asks whether
  to trust a folder the first time it opens it. The launcher cannot answer that dialog, so
  the start logs `TIMEOUT` and holds the checkout's lock for up to 16 minutes, during which
  every other start in that checkout waits.
- **A prompt logged `SENT` twice.** The log has shown one prompt `SENT` to two panes about
  90 seconds apart, and the cause is not known. Before acting on a `SENT` line, look at the
  pane it names; if a prompt ran twice, stop the duplicate session.
