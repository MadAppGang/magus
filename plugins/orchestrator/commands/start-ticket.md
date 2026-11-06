---
description: Opens a ticket in its own tmux window and worktree, with a manager session started on it, then sets the ticket In Progress. Use when triage starts a ticket, or the user asks to start or open a ticket.
argument-hint: "<ticket-id>"
---

# /orchestrator:start-ticket

Start ticket **$ARGUMENTS** in a new tmux window. Do every step yourself, and never run
`git pull`, a plugin update or a worktree command in your own Bash: the window runs them.

**One ticket at a time.** The window's `git pull`, plugin update and worktree creation all
work on one main checkout, so two starts together race. With several tickets, finish steps
1 to 7 for the first before beginning the next. Never run two launcher calls in parallel,
not as two Bash calls in one message and not as background jobs. The launcher also holds a
lock per checkout, so a start from another session waits for the one before it.

1. **Read the ticket** from the tracker named in the product repo's `CLAUDE.md` (for
   example Linear): title, labels, project, state, URL. If no tracker is named, ask the user
   once and store the answer as `${CLAUDE_PLUGIN_ROOT}/references/three-levels.md` says. If
   the ticket is Done or Canceled, stop and say so.

2. **Pick the colour from its labels.** Bugfix wins over Feature, Feature over Improvement:

   | Label | Colour |
   |---|---|
   | Bugfix | `red` |
   | Feature | `green` |
   | Improvement | `blue` |

   If none of the three is on the ticket, ask once (red = bugfix, green = feature,
   blue = improvement) and add the chosen label to the ticket.

3. **Build the name:** the lower-case ticket id, then 2 to 4 words from the title that say
   what the ticket is, joined by hyphens. Only `a-z 0-9 . _ -`, at most 48 characters. For
   example, ticket `ABC-229` "a slot that writes its answer to a file is reported empty"
   becomes `abc-229-slot-file-answer`.

4. **Build the prompt:** `/orchestrator:manager <ID> <url> — <title>`, with the ticket's
   real URL field. The manager picks the workflow from the label itself.

5. **Open the window** with one foreground Bash call and `timeout: 600000`:

   ```
   bun "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-window.ts" --name <name> --colour <colour> \
       --prompt "/orchestrator:manager <ID> <url> — <title>"
   ```

   It opens the window in the current tmux session at the main checkout of the current
   repo; pass `--dir <main checkout>` when the ticket's repo is another one. The window runs
   `git pull --ff-only`, then `magus update` when magus is installed, then starts Claude
   Code in a new worktree. The call first waits, up to 16 minutes, while another start in
   the same checkout holds the lock, and returns once the window is open. A detached second
   stage waits for Claude Code to come up, releases the lock, types the prompt, and logs
   `SENT`, `TIMEOUT` or `GONE` to the launcher's log in its state directory
   (`$ORCHESTRATOR_STATE_DIR`, else `~/.claude/orchestrator/`).

   Pass `--model <id>` or `--effort <level>` only when the user asks for one for this
   ticket.

   | Exit | Meaning | Do |
   |---|---|---|
   | 0 | Window open; the launch is typed | Continue |
   | 1 | Bad input, not inside tmux, or a tmux or git error | Report the message |
   | 2 | The main checkout is not on its default branch, so the worktree would start from that branch | Report the branch. Never switch it: it may hold uncommitted work. Ask the user |
   | 3 | The worktree already exists | Report its path: the ticket is probably running in another window |
   | 6 | Another start in this checkout still holds the lock and the wait ran out | Report it. Never retry in a loop or open the window by hand. Read the log; a lock whose holder died, or older than 16 minutes, clears itself |

6. **Set the ticket In Progress** in the tracker. If it has no estimate, say so in the
   report; do not invent one.

7. **Report in four lines:** the tmux session and window name, the colour and why, the
   prompt that will be typed, and the ticket's new state. The session in that window is the
   user's to drive: do not poll it.
