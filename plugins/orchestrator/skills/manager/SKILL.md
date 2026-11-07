---
name: manager
description: Runs this session as the manager of one ticket, the middle of three levels. It reads the ticket, starts the matching dev workflow, owns the work to release, and runs child sessions for other repos. Use when a window opens with /orchestrator:manager.
disable-model-invocation: true
argument-hint: "<ticket-id> <ticket-url> — <title>"
---

# Manager session

Arguments: `$ARGUMENTS` (the ticket id, its URL and its title).

## Step 0: read the shared rules

Read `${CLAUDE_PLUGIN_ROOT}/references/three-levels.md` now, before anything else. If that
read is skipped, the standing rules below still hold.

## Step 1: read the ticket

Find the tracker and read the ticket as the "Tracker" section of `three-levels.md` says:
the product repo's `CLAUDE.md` first, then the ticket reference through
`bun "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-ref.ts"`. If neither settles it, ask the user once
and store the answer as that section says. Read the ticket's first section before planning:
triage puts overlap notes there.

## Step 2: start the workflow

Get the colour from the script with the ticket's labels:

```
bun "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-ref.ts" <ticket-id> --dir <this worktree> \
    --labels "<labels, comma-separated>"
```

Start the matching workflow with the Skill tool, passing the ticket id, URL and title:

| `colour` | Skill |
|---|---|
| `red` | `dev:fix` |
| `green`, `blue` | `dev:dev` |
| `null` | ask the user once which kind it is, and add a label of that kind through the tracker |

## Standing rules for the whole run

These hold from now until the final report, including every phase of the workflow above.

1. **One ticket, one branch, one worktree, this session.** A ticket added mid-way gets its
   own commit on the same branch. Never open a second branch or worktree in this repo, and
   never `cd` into another checkout.
2. **Work in another repo goes to a child**, started in a visible terminal slot of this
   window (below). Never edit another repo from this worktree.
3. **Tickets belong to triage.** Set your own ticket in progress and add progress notes to
   it (commits, PRs, what is open) through the tracker's actions; send every other finding,
   and your children's ticket needs, to triage with what you read or ran. Never file one
   yourself.
4. **The progress table** is shown to the user here after every progress update or change,
   and on request. Never send it to triage. Keep the format and numbering. Steps in the
   order they run; done lines stay, marked done; never drop a line.

   | # | Step | Who | State |
   |---|------|-----|-------|
   | 1 | Bump the app to the new SDK, merge with no tag | app child | Done |
   | 2 | Restart the test server on that merge | server child | In progress |
   | 3 | Final browser run on the released build | this session | Waiting on 2 |

   Below it, short notes: work alongside that does not hold the order, each child's part,
   and what will need the user.

## Starting a child

A child runs in a visible slot of the terminal plugin's `mux` server, in this window. Every
step below goes through `mux` tools (`mcp__plugin_terminal_mux__<tool>`). Never send raw
`tmux` commands into a slot pane: they bypass the slot registry.

**Name**: your ticket's slug plus 2 to 4 words for the child's part, from the script:

```
bun "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-ref.ts" <ticket-id> --dir <this worktree> --words "<w1> <w2>"
```

**Colour** by kind of work: bug red, feature green, improvement blue.

**The line**, from the launcher. It opens nothing and only checks the other repo's main
checkout:

```
bun "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-window.ts" --print-line \
    --dir <other repo's main checkout> --name <name> --colour <colour>
```

It prints `{dir, branch, name, colour, line}`; type `line` exactly as printed. Exit 2: that
checkout is off its default branch; report the branch, never switch it, ask the user. Exit 3:
the worktree exists, so that part is probably running already. Exit 1: report the message.
The line takes no lock, so start one child at a time per repo.

**The prompt** is one line with no line breaks: `/orchestrator:child <id> <url> — ` and then:

1. The workflow: `dev:fix` for a bug, `dev:dev` for a feature or improvement, `dev:debug`
   when the cause is unknown.
2. Exactly which part this child does, and what it must leave alone.
3. Every setup answer the workflow would ask: depth, automation, workspace, validation.
4. The exact checks that prove the part is done, and whether it may tag, release or deploy
   (default no).
5. "Questions come to `<this session's name>` by SendMessage. When it is done and merged
   or released, report back the same way: PR, version or tag, what changed, what you
   checked, what is left."

## Running children

Read a slot with `capture-pane {slot: N}`. Use `watch-pane` only to wait for a pattern, with
`mode: "quick"` and a timeout of 60 seconds or less; never to read a screen, never with
`mode: "screen"`. Send one key per `send-keys` call and read the screen before and after
it: a menu that changed is never answered blind.

1. **Slot.** Call `list-slots` and take the lowest visible slot number not in use.
2. **Soft limit 10.** With 10 child slots open, do not open an 11th. Tell the user once that
   each pane is then small and every child needs watching, and wait for a child to close,
   unless the user says go.
3. **Open** with `open-pane {slot: N, layout: "agent-grid"}`. A response with no `layout`
   field means the installed tmux-mcp has no layout mode; carry on with its placement.
   `layoutApplied: false` comes with a `layoutDetail` sentence saying why; the slot is open
   either way.
4. **Start** with `send-keys {slot: N, keys: <line>, enter: true}`. If it returns an error,
   read the slot with `capture-pane` first: the line may have run anyway. Retype it only if
   it still sits unrun at the shell prompt.
5. **Wait for Claude Code** with `watch-pane` on slot N, `mode: "quick"`, `timeout: 60` and
   these triggers:

   ```
   pattern:Session color set,pattern:Workspace trust not yet accepted,exit
   ```

   Then read with `capture-pane`, whatever event came back. On `timeout`, watch again; after 10 minutes
   with no Claude Code, report what the screen shows.
6. **Trust refused** (`Workspace trust not yet accepted`). Only for a repo the product
   `CLAUDE.md` or the user named for children: type `claude` with `enter: true`, read the
   dialog (`❯ No, exit` / `Yes, I trust this folder`), send `Down`, read, send `Enter`, read
   for the input box, type `/quit`, send `Enter`, then type the line again. Any other repo:
   ask the user, because trusting a folder is a security decision.
7. **Prompt.** `send-keys {slot: N, keys: <prompt>}` (literal, no `enter`), then a separate
   `send-keys {slot: N, keys: "Enter", literal: false}`. A read straight after `Enter` often
   still shows the text in the input box although it went through, so read again after a
   short `watch-pane` (`triggers: "idle:2"`, `mode: "quick"`, `timeout: 10`). Send one more
   `Enter` only if both reads show the prompt in the input box. Never type the prompt twice.
8. **Drive the start.** Read until the workflow runs. Answer setup questions and menus from
   the ticket and the code with named keys (`Up`, `Down`, `Enter`, a digit), one per call,
   reading after each.
9. **Watch.** Subscribe to each child with `SendMessage` and `notify_when_idle: true`; the
   child's address is the `<name>` its start line passed to `-n`, as `ListAgents` shows it.
   Read each child's slot between your own steps. A stuck child is your job, not triage's;
   unblock what you can.
10. **Close**, only after the child has reported and its work is merged or released.
    First prove it merged: the PR's state is `MERGED`, or
    `git -C <checkout> branch --merged origin/<default>` lists `worktree-<name>`, shown as
    `+ worktree-<name>` while its worktree exists (a squash
    merge fails this second test, so the PR state comes first). A branch with no commits
    passes the second test too: treat it as merged only when the child reported that it had
    nothing to commit. Then: `send-keys "/quit"`, `Enter`; wait for the menu with
    `watch-pane` (`pattern:Keep worktree`, `mode: "quick"`, `timeout: 30`) and read it for
    `1. Keep worktree` / `2. Remove worktree`. Never send a second `Enter` after `/quit`: on
    the menu it picks Keep. `Down`, read, `Enter`; straight away `watch-pane` with
    `pattern:Worktree removed,shell` (`mode: "quick"`, `timeout: 30`), because the line
    shows only briefly before the screen clears. Confirm with `git -C <checkout> worktree
    list` that the worktree is gone, then `close-pane {slot: N}`.
    **Not proven merged:** choose Keep (`Enter` on option 1), close the pane, and keep the
    worktree, branch and last commit for the final report. Menu text not as expected:
    `Escape`, keep the worktree, report.

Also:

- **Pass up only what is the user's:** a product or scope decision, money, a production
  deploy, anything destructive or outward-facing, or what the ticket and code cannot
  settle. Put it to the user here, in full.
- **Order the work** and show it in the table. Parallel release PRs collide on version
  files, so agree the order first.
- **Link each child's PR** on the ticket with a progress note.

## Releasing and finishing

- Release with `/dev:release` unless `CLAUDE.md` names another procedure. Follow the merge
  rule in `CLAUDE.md`; without one, merge only when every check has passed, and never with
  `gh pr merge --auto`, which merges at once where no check is required.
- A release ships this session's work. Never adopt another session's unreleased version.
- A release is done when the artifact exists and has run, not when the tag is pushed.
- Tell triage what others were waiting on: tag, version, and anything still unproven.

**Final report**, to the user and triage: what shipped (PRs, versions, tags), what is proven
and how, what is not and where it was recorded, and which child slots are closed. For every
child worktree, say whether it was removed (merged proven, and how) or kept; name each kept
one with its worktree path, branch and last commit, and why it was kept. Removing a kept
worktree needs the user's yes.
