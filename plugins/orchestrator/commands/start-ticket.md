---
description: Opens a ticket in its own tmux window or herdr tab and worktree, with a manager session started on it, then sets the ticket in progress. Use when triage starts a ticket, or the user asks to start or open a ticket.
argument-hint: "<ticket-ref>"
---

# /orchestrator:start-ticket

Start ticket **$ARGUMENTS** in a new tmux window or herdr tab. Do every step yourself, and
never run `git pull`, a plugin update or a worktree command in your own Bash: the window runs
them.

**Only triage runs this.** Triage alone starts ticket sessions; in a manager or child session
the hook refuses it and names triage as the route.

**One ticket at a time.** The window's `git pull`, plugin update and worktree creation all
work on one main checkout, so two starts together race. With several tickets, finish steps
1 to 7 for the first before beginning the next. Never run two launcher calls in parallel,
not as two Bash calls in one message and not as background jobs. The launcher also holds a
lock per checkout, so a start from another session waits for the one before it.

The tracker, its four actions and the script below are specified in the "Tracker" section of
`${CLAUDE_PLUGIN_ROOT}/references/three-levels.md`. Read that section before step 1.

1. **Find the tracker.** Use the one the product repo's `CLAUDE.md` names. Otherwise run

   ```
   bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-ref.ts" '<ticket-ref>' --dir <the repo's main checkout>
   ```

   with the reference single-quoted: unquoted, `#123` starts a shell comment.

   and take the tracker from its `tracker` field as the Tracker section says. A bare key with
   no single Linear MCP server, or exit 1 (a reference it does not recognise): ask the user
   once and store the answer as that section says.

2. **Read the ticket** through the tracker: title, URL, state, labels. Done or Canceled in
   Linear, or `CLOSED` on GitHub: stop and say so.

3. **Get the colour and name** from the script, with the ticket's labels and 2 to 4 words
   from the title that say what the ticket is:

   ```
   bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-ref.ts" '<ticket-ref>' --dir <main checkout> \
       --labels "<labels, comma-separated>" --words "<w1> <w2> <w3>"
   ```

   Use its `colour` and `name` as printed. For example, issue `#229` "a slot that writes its
   answer to a file is reported empty", labelled `bug`, gives `red` and
   `gh-229-slot-file-answer`. A `null` colour: ask once (red = bug fix, green = feature,
   blue = improvement), add a label of that kind through the tracker, and run the script
   again. Exit 1 on the words: choose fewer or shorter ones.

4. **Build the prompt:** `/orchestrator:manager <id> <url> — <title>`, with the script's `id`
   and the ticket's real URL. The manager picks the workflow from the same colour.

5. **Open the window** with one foreground Bash call and `timeout: 600000`:

   ```
   bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-window.ts" --name <name> --colour <colour> \
       --ticket '<id>' --ticket-url '<url>' \
       --prompt "/orchestrator:manager <id> <url> — <title>"
   ```

   `--ticket` and `--ticket-url` go into the launch claim, so the new session starts as this
   ticket's manager in your family and the status band lists it at once. Single-quote both.

   Inside tmux it opens a window in the current session; inside herdr, a tab in the current
   workspace that does not take focus. Either way it sits at the main checkout of the current
   repo; pass `--dir <main checkout>` when the ticket's repo is another one. `--session` is
   tmux only. When both are in play (herdr inside tmux, or tmux with herdr installed) the
   launcher follows the answer triage stored. Set `ORCHESTRATOR_MULTIPLEXER=tmux` (or `herdr`)
   only when the user asks for the other one.

   The window runs `git pull --ff-only`, then `magus update` when magus is installed, then
   starts Claude Code in a new worktree. The call first waits, up to 16 minutes, while another
   start in the same checkout holds the lock, and returns once the window is open. A detached
   second stage waits for Claude Code to come up, releases the lock, types the prompt, and
   logs `SENT`, `TIMEOUT`, `GONE` or `UNTRUSTED` to the launcher's log in its state directory
   (`$ORCHESTRATOR_STATE_DIR`, else `~/.claude/orchestrator/`).

   Pass `--model <id>` or `--effort <level>` only when the user asks for one for this
   ticket.

   | Exit | Meaning | Do |
   |---|---|---|
   | 0 | Window or tab open; the launch is typed | Continue |
   | 1 | Bad input, not inside tmux or herdr, `--session` under herdr, or a tmux, herdr or git error | Report the message |
   | 2 | The main checkout is not on its default branch, so the worktree would start from that branch | Report the branch. Never switch it: it may hold uncommitted work. Ask the user |
   | 3 | The worktree already exists | Report its path: the ticket is probably running in another window |
   | 6 | Another start in this checkout still holds the lock and the wait ran out | Report it. Never retry in a loop or open the window by hand. Read the log; a lock whose holder died, or older than 16 minutes, clears itself |

   An `UNTRUSTED` line in the log means Claude Code was never trusted in that checkout. The
   lock is already free. Tell the user to run `claude` once there and accept the trust
   dialog, then start again; trusting a folder is their decision.

6. **Set the ticket in progress** through the tracker's "set in progress" action, the start's
   part of it in the Tracker section. On GitHub that is where the `in progress` label is
   added, created first when the repo lacks it, because a manager changes no labels; the
   manager assigns itself. If the ticket has no estimate, say so in the report; do not
   invent one.

7. **Report in four lines:** the multiplexer and the window or tab name, the colour and the
   label it came from, the prompt that will be typed, and the ticket's new state. The
   session in that window is the user's to drive: do not poll it.
