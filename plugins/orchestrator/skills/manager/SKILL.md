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

Read the ticket from the tracker named in the product repo's `CLAUDE.md`. If none is named,
ask the user once which tracker it is, and store the answer as `three-levels.md` says. Read
the ticket's first section before planning: triage puts overlap notes there.

## Step 2: start the workflow

Pick it from the ticket's label and start it with the Skill tool, passing the ticket id,
URL and title:

| Label | Skill |
|---|---|
| Bugfix | `dev:fix` |
| Feature, Improvement | `dev:dev` |
| none of these | ask the user once which it is |

## Standing rules for the whole run

These hold from now until the final report, including every phase of the workflow above.

1. **One ticket, one branch, one worktree, this session.** A ticket added mid-way gets its
   own commit on the same branch. Never open a second branch or worktree in this repo, and
   never `cd` into another checkout.
2. **Work in another repo goes to a child**, started in a pane of this window (below).
   Never edit another repo from this worktree.
3. **Tickets belong to triage.** Set your own ticket's state and link your PRs; send every
   other finding, and your children's ticket needs, to triage with what you read or ran.
   Never file one yourself.
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

```
bun "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-window.ts" --split "$TMUX_PANE" \
    --dir <other repo's main checkout> --name <ticket-id>-<area> --colour <colour> \
    --prompt "/orchestrator:child <ID> <url> — <what this child does>"
```

Colour by kind of work: bug red, feature green, improvement blue. One start at a time per
repo. After `—`, the prompt states:

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

- **Drive the start.** Watch the pane (`tmux capture-pane -p -t <pane> -S -40`) until the
  workflow runs. Answer what you can from the ticket and the code.
- **Watch for a stuck child; that is your job, not triage's.** Subscribe to each child with
  `SendMessage` and `notify_when_idle: true`, and look at each child's pane between your
  own steps. Unblock what you can.
- **Pass up only what is the user's:** a product or scope decision, money, a production
  deploy, anything destructive or outward-facing, or what the ticket and code cannot
  settle. Put it to the user here, in full.
- **Order the work** and show it in the table. Parallel release PRs collide on version
  files, so agree the order first.
- **Close up.** Link each child's PR in the ticket, and close its pane once it has
  reported.

## Releasing and finishing

- Release with `/dev:release` unless `CLAUDE.md` names another procedure. Follow the merge
  rule in `CLAUDE.md`; without one, merge only when every check has passed, and never with
  `gh pr merge --auto`, which merges at once where no check is required.
- A release ships this session's work. Never adopt another session's unreleased version.
- A release is done when the artifact exists and has run, not when the tag is pushed.
- Tell triage what others were waiting on: tag, version, and anything still unproven.

**Final report**, to the user and triage: what shipped (PRs, versions, tags), what is proven
and how, what is not and where it was recorded, and that children are closed and every
worktree and branch in every repo is merged or removed. Name anything that cannot be
removed; removing a worktree needs the user's yes.
