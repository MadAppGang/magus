---
name: manager
description: Runs this session as the manager of one ticket, the middle of three levels. It reads the ticket, starts the matching dev workflow, owns the work to release, and runs child sessions for other repos. Use when a window opens with /orchestrator:manager.
disable-model-invocation: true
argument-hint: "<ticket-id> <ticket-url> — <title>"
allowed-tools: Bash(bun:*)
---

# Manager session

Arguments: `$ARGUMENTS` (the ticket id, its URL and its title).

## Step 0: register, then read the shared rules

This line registers the session as this ticket's manager when the skill loads:

!`bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/orch-state.ts" register --role manager --ticket "$0" --ticket-url "$1"`

Its output is one JSON line with `"ok":true`. If you see the command text instead of that
output, or an error, run it once yourself with Bash, with the ticket id and URL from the
arguments, each single-quoted:

```
bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/orch-state.ts" register --role manager \
    --ticket '<ticket-id>' --ticket-url '<ticket-url>'
```

Exit 1 "already <role>": this session has another role; tell the user and stop. Any other
error: report it once and carry on; only the status band and the hook depend on the record.

Then read `${CLAUDE_PLUGIN_ROOT}/references/three-levels.md`, before anything else. If that
read is skipped, the standing rules below still hold.

## Step 0b: which route your children take

```
bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/orch-config.ts" multiplexer
```

Read `session.mux` in its JSON, and nothing else:

| `session.mux` | Read and follow | Skip entirely |
|---|---|---|
| `herdr` | "Children under herdr" | "Children under tmux" |
| `tmux`, or `session` holds an `error` | "Children under tmux" | "Children under herdr" |

Children open where this session runs. Never ask the user which multiplexer to use, and
never run this script with `--set` or `--claim-question`: where new ticket windows open is
triage's question, and `windows` in the JSON is triage's answer.

## Step 1: read the ticket and the workbook

Find the tracker and read the ticket as the "Tracker" section of `three-levels.md` says:
the product repo's `CLAUDE.md` first, then the ticket reference through
`bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-ref.ts" '<ticket-id>'`. If
neither settles it, ask the user once and store the answer as that section says. Read the
ticket's first section before planning: triage puts overlap notes there.

Read the product's workbook, `.claude/orchestrator/workbook.md`, through the pointer in
`CLAUDE.md`: the release branch and procedure, the merge rule, which repos take a child, the
shared environments and the areas that collide. Send triage anything that belongs in it and
is missing; triage writes it, and you commit the text it sends back.

## Step 2: start the workflow

Get the colour from the script with the ticket's labels:

```
bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-ref.ts" '<ticket-id>' --dir <this worktree> \
    --labels "<labels, comma-separated>"
```

Start the matching workflow with the Skill tool, passing the ticket id, URL and title:

| `colour` | Skill |
|---|---|
| `red` | `dev:fix` |
| `green`, `blue` | `dev:dev` |
| `null` | ask the user once which kind it is, start that workflow, and send the kind to triage by SendMessage, so triage sets the label. You change no labels |

## Standing rules for the whole run

These hold from now until the final report, including every phase of the workflow above.

1. **One ticket, one branch, one worktree, this session.** A ticket added mid-way gets its
   own commit on the same branch. Never open a second branch or worktree in this repo, and
   never `cd` into another checkout. A ticket may hold a list of related work across
   several repos: this repo's part here, every other repo's through a child, so the user's
   attention stays in one place.
2. **Work in another repo goes to a child**, started beside this session: a terminal slot
   under tmux, a herdr pane under herdr (below). Never edit another repo from this worktree.
3. **Tickets belong to triage.** A hook refuses, in this session, any ticket launch, ticket
   create, title or description edit, **every label change**, and any write to another
   ticket, naming triage as the route. On your own ticket you set its state and assignee,
   attach links, and write **progress as comments**: commits, PR URLs, what is open. A
   product `CLAUDE.md` that asks for progress in the description is followed as a comment.
   Findings, scope changes and label needs go to triage by SendMessage, with what you read
   or ran, and are placed only when triage replies `taken`; until then they stay open in
   your table. Every `gh issue` write names the ticket's repo with `-R <owner/repo>` and sets
   no `GH_REPO`: the hook refuses a `gh` write without it, because it cannot see which repo
   `gh` would pick. Run every `gh issue`, `gh label`, `gh project`, `gh api` or launcher
   command as a plain command, with no loop, `$(…)`, backtick or variable around it and
   nothing piped into a shell, and the comment body in `--body-file <file>` or in
   `--body-file - <<'EOF'` with the delimiter quoted: the hook refuses anything else unread.
4. **The progress table** is shown to the user here after every progress update or change,
   and on request. Never send it to triage. Keep the format and numbering. Steps in the
   order they run; done lines stay, marked done; never drop a line. A line leaves the plan
   only as moved (to another ticket, with its URL) or dropped by the user (with their words).

   Update it by piping the table to the status record, and show the user the table it
   prints back. One call records and renders it:

   ```
   bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/orch-state.ts" tasks <<'TABLE'
   | # | Step | Who | State |
   |---|------|-----|-------|
   | 1 | Bump the app to the new SDK, merge with no tag | app child | Done |
   | 2 | Restart the test server on that merge | server child | In progress |
   | 3 | Final browser run on the released build | this session | Waiting on 2 |
   TABLE
   ```

   It prints the table on every exit code; exit 3 means the session owns no record, so run
   Step 0's command, then this one again. Below the table, short notes: work alongside that
   does not hold the order, each child's part, and what will need the user. When progress
   also goes to the ticket, it goes as a comment.
5. **The status record** says what the table cannot. The band shows what you record; an
   unrecorded dependency is invisible to the user. Every call is
   `bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/orch-state.ts" <verb>`:

   | When | Verb |
   |---|---|
   | You start waiting on a child, a pull request or a release | `dep add session:<child name>`, `dep add pr:<full PR URL>`, `dep add release:"<artifact> <version>"` |
   | It arrives | `dep done <the same kind:ref>`; `dep drop` when it stops mattering |
   | You cannot go on without the user | `block "<what you need>"`, then `unblock` once answered |
   | You take or free a shared environment (the workbook's "Shared environments") | `hold "<what>"`, `release "<what>"` |
   | After the final report | `done` |

   Run one `orch-state` call at a time, never in the background.
6. **Tracker text names a pull request by its full URL**, never a bare `PR #N`.

## Starting a child, on either route

**Name**: your ticket's slug plus 2 to 4 words for the child's part, from the script:

```
bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-ref.ts" '<ticket-id>' --dir <this worktree> --words "<w1> <w2>"
```

**Colour** by kind of work: bug red, feature green, improvement blue.

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

## Children under tmux

A child runs in a visible slot of the terminal plugin's `mux` server, in this window. Every
step below goes through `mux` tools (`mcp__plugin_terminal_mux__<tool>`). Never send raw
`tmux` commands into a slot pane: they bypass the slot registry.

**The line**, from the launcher. It opens nothing and only checks the other repo's main
checkout:

```
bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/ticket-window.ts" --print-line \
    --dir <other repo's main checkout> --name <name> --colour <colour> \
    --ticket '<ticket-id>' --ticket-url '<ticket-url>'
```

It prints `{dir, branch, name, colour, line, claim}`; type `line` exactly as printed. The
line carries a claim, so the child joins your family in the status band as it starts.
Exit 2: that checkout is off its default branch; report the branch, never switch it, ask
the user. Exit 3: the worktree exists, so that part is probably running already. Exit 1:
report the message. The line takes no lock, so start one child at a time per repo. Once the
child runs, record that you wait on it: `orch-state dep add session:<name>`.

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
6. **Trust refused** (`Workspace trust not yet accepted`). Only for a repo the workbook's
   "Repos for children" or the user named: type `claude` with `enter: true`, read the
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
    list` that the worktree is gone, then `close-pane {slot: N}`, then
    `orch-state dep done session:<name>`.
    **Not proven merged:** choose Keep (`Enter` on option 1), close the pane, and keep the
    worktree, branch and last commit for the final report. Menu text not as expected:
    `Escape`, keep the worktree, report.

## Children under herdr

A child runs in a herdr pane of this tab. After every open and close the script lays the tab
out: you full height on the left, the children in columns of two. `child-pane` below means

```
bun --env-file=/dev/null "${CLAUDE_PLUGIN_ROOT}/scripts/child-pane.ts"
```

written out in full, as one plain command per Bash call, with no assignment in front and no
`$(…)` or backtick. Give the Bash tool `timeout: 360000` for `open`, `timeout: 420000` for `prompt`, and
`timeout: 180000` for `wait`, `close`, `layout`, `trust` and `retype`.

Never call `herdr` yourself, and never move, close or split a pane that is not your child.
Focus stays where the user left it. Every command prints one JSON document (`read` prints
text). On any command:

| Exit | Do |
|---|---|
| 5 | The pane closed, or herdr restarted under it, and nothing more was sent: `child-pane list`, `child-pane layout` if `relayout` is true, tell the user |
| 6 without `checkout-busy` | Another of your `child-pane` calls is running: one at a time |
| 9 | This session is not the record's live owner: tell the user and stop these steps |
| 10 | This session is not in herdr: use "Children under tmux" |
| 14 | Pass `layout.error` to the user: it names the pane outside the tab and the command that puts it back. Leave that to them |

**1. Open.**

```
child-pane open --dir <other repo's main checkout> --name <name> --colour <colour> \
    --ticket '<ticket-id>' --ticket-url '<ticket-url>'
```

It checks the checkout, opens the pane, lays out the tab and types the child's launch line,
which carries the claim that joins it to your family in the status band. Keep `pane` (`P`
below) and `promptDir` from its JSON. Never run `--print-line` or type the line yourself.

| Exit | Do |
|---|---|
| 0 | Go on. `layout.status` `refused`: tell the user the stderr sentence once per session, and carry on. `failed`: tell the user `error` once |
| 1 with `pane` and `typed:false` | The pane exists and is registered: `child-pane retype --pane P` once, or `child-pane close --pane P`. Never `open` this child again |
| 1 otherwise | Report the message |
| 2 | That checkout is off its default branch: report the branch, never switch it, ask the user |
| 3 | The worktree exists or a child of that name is open: that part is probably running already |
| 5 with `typed:false` | herdr restarted before the line was typed: `child-pane list`, `child-pane layout` if `relayout` is true, then `open` again |
| 6 with `checkout-busy` | Another child is still starting in that checkout; nothing was created. `wait --until up` on that child if it is yours, then `open` again |
| 12 | 10 children are open. Tell the user once that each pane is then small and every child needs watching, and wait for one to close. Add `--past-limit` only when the user says go |

**2. Wait for Claude Code.**

```
child-pane wait --pane P --until up --timeout-ms 100000
```

Exit 4: wait again, for up to 10 minutes in all, then `child-pane read --pane P` and report
what it shows. Exit 7: the checkout is untrusted; go to step 3. Exit 13 `other-agent`: the
pane runs another agent, not this child; tell the user and never prompt it.

**3. Trust refused (exit 7).** Only for a repo the workbook's "Repos for children" or the
user named; any other repo: ask the user, because trusting a folder is a security decision.
In this order, each through `child-pane`, with `--pane P`:

1. `trust`, which types a plain `claude`. Exit 13: `busy`, `read` and tell the user; `bound`, the child has started, go to step 2.
2. `wait --pattern 'Yes, I trust' --timeout-ms 30000`, then `read` for `❯ No, exit` / `Yes, I trust this folder`.
3. `send --key down`, `read`, `send --key enter`.
4. `wait --until detected --timeout-ms 30000`.
5. `send --text /quit --key enter`. Exit 13 `not-up`: repeat the wait in item 4 once and send again; a second refusal, `read` and tell the user.
6. `retype`, which waits up to 15 s for the shell. Exit 13 `busy`: `read`, run `retype` once more, then tell the user.
7. Go back to step 2.

Either `wait` here exiting 4: `read`, tell the user that a plain `claude` may still be in the
pane, and stop. Never type the child line yourself, and never `open` this child again.

**4. Prompt.** Write the prompt above, one line, with the Write tool: to your session's
scratchpad directory if your environment names one, else to `<promptDir>/<name>.txt`, never
inside a checkout. Then:

```
child-pane prompt --pane P --prompt-file <path>
```

The prompt never goes in a command's arguments. With no file, `--prompt-file - <<'PROMPT'` …
`PROMPT`, delimiter quoted, reads standard input; use it only for a prompt holding no `git`,
because a worktree guard refuses that word in a heredoc.

| Exit | Do |
|---|---|
| 0 | Run `orch-state dep add session:<name>` and go on |
| 4 | `status:"working"`: `child-pane list`, then try once more. Otherwise `read`; try once more only if the prompt is not on screen |
| 7 | Step 3 |
| 8 | **Never type the prompt again.** `inInput:true`: send one `--key enter`, then `list` (working or done means it was taken). `inInput:false`: `read` and tell the user what it shows |
| 13 | `not-up`: step 2. `blocked`: `read`, then decide. `unbound`: `read`, then tell the user. `other-agent`: tell the user |
| The Bash call timed out | The prompt may already be typed. `read` first, and never `prompt` again blind |

**5. Drive the start.** `child-pane read --pane P` until the workflow runs. Answer setup
questions and menus from the ticket and the code: `send --pane P --key <one key>`, one per
call, reading before and after. Keys: `enter`, `escape`, `up`, `down`, `left`, `right`, `tab`,
`backspace`, `space`, a digit. For text, `send --pane P --text '<text>' --key enter`.

**6. Watch.** `child-pane list` between your own steps is the first source: each child's
`status` is `idle`, `working`, `blocked` or `done`. `read` only a child that is `blocked`, or
idle at a question. `relayout: true` means a pane closed outside these steps: run
`child-pane layout`. Subscribe to each child with `SendMessage` and `notify_when_idle: true`;
its address is its `name`, as `ListAgents` shows it. A stuck child is your job, not triage's;
unblock what you can.

**7. Close**, only after the child has reported and its work is merged or released. First
prove it merged: the PR's state is `MERGED`, or
`git -C <checkout> branch --merged origin/<default>` lists `worktree-<name>`, shown as
`+ worktree-<name>` while its worktree exists (a squash merge fails this second test, so the
PR state comes first). A branch with no commits passes the second test too: treat it as
merged only when the child reported that it had nothing to commit. Then, each with `--pane P`:

1. `send --text /quit --key enter`. Never a second Enter: on the menu it picks Keep.
2. `wait --pattern 'Keep worktree' --timeout-ms 30000`, then `read` for `1. Keep worktree` / `2. Remove worktree`.
3. `send --key down`, `read`, `send --key enter`.
4. Straight away `wait --pattern 'Worktree removed' --timeout-ms 30000`: the line shows only briefly. Confirm with `git -C <checkout> worktree list` that it no longer lists the worktree.
5. `close`, then `orch-state dep done session:<name>`.

Exit 13 `busy` or `working` from `close`: `read`, and never `--force` without a reason you can
name. `other-agent`: tell the user; it is never closed.
**Not proven merged:** at the menu choose Keep (`--key enter` on option 1), `close`, and keep
the worktree, branch and last commit for the final report. Menu text not as expected:
`--key escape`, keep the worktree, report.

**8. Terminal slots.** A visible terminal slot you open under herdr sits in your tab and
joins the layout: run `child-pane layout` after opening one. A slot opened by another agent,
or by a tmux-mcp too old to record its owner, counts as foreign. `layout` exit 15 means the
layout was refused for panes the orchestrator did not open: tell the user the stderr sentence
once per session.

## Every child, on either route

- **Pass up only what is the user's:** a product or scope decision, money, a production
  deploy, anything destructive or outward-facing, or what the ticket and code cannot
  settle. Put it to the user here, in full.
- **Order the work** and show it in the table. Parallel release PRs collide on version
  files, so agree the order first.
- **Link each child's PR** on the ticket with a progress comment, by its full URL.
- **Your children's findings** go to triage through you, like your own, and stay open until
  triage replies `taken`.

## Releasing and finishing

- Release with `/dev:release` unless the workbook's "Release" names another procedure.
  Follow its merge rule; without one, merge only when every check has passed, and never
  with `gh pr merge --auto`, which merges at once where no check is required.
- **Release scope check.** Before a release, list what it ships with
  `git log --first-parent <release branch>..<default branch>`, the release branch from the
  workbook (for example `prod..main`), and say whether anything in it is unproven. With no
  release branch in the workbook, ask the user and send the answer to triage.
- A release ships this session's work. Never adopt another session's unreleased version.
- A release is done when the artifact exists and has run, not when the tag is pushed.
- Tell triage what others were waiting on: tag, version, and anything still unproven.
- Free every shared environment you hold (`orch-state release "<what>"`) before the report.

**Final report**, to the user and triage: what shipped (PR URLs, versions, tags), what is
proven and how, what is not and where it was recorded, and which child slots or panes are closed. For
every line of the progress table, say whether it is done, moved (to which ticket), or dropped
by the user. For every child worktree, say whether it was removed (merged proven, and how) or
kept; name each kept one with its worktree path, branch and last commit, and why it was kept.
Removing a kept worktree needs the user's yes. Then run `orch-state done`.
