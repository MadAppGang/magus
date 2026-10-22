---
name: team-gate
description: "Runs a multi-model review gate to a verdict: start the claudish team panel with input_file only, poll until settled, read every ballot, apply the minimum ballot count, log every skip. Use at any plan-review, code-review, verify or fix gate."
disable-model-invocation: true
---

# Team gate: a gate is passed when its ballots have been read

The 2026-09-12 transcript audit (`ai-docs/dev-workflow-gate-audit-2026-09-12.md`) found
that `team(mode="run")` returning `{"started": true}` was being treated as the gate
passing, that panels which came back `partial` (`1/4`, `2/5` succeeded) were treated as
complete, and that gates were skipped without a word. This procedure closes all three.
Every gate site in `/dev:dev`, `/dev:fix` and `/dev:audit` follows it; none restates it.

## The minimum ballot table

`N` is the number of external slots the gate launched. A **ballot** is an external slot
whose `status` state is `COMPLETED` and whose `response-<slot>.md` matched
`require_pattern`. FAILED, EMPTY, still-RUNNING at the poll ceiling, and never-started
slots are not ballots. Count both by slot identity: walk the slots map, leave out the id
`slots.internal`, and count the rest — never derive either from the summary's `succeeded`,
which includes the internal slot when it completed and omits it when it failed.

| Gate | Where | `MIN_BALLOTS` |
|---|---|---|
| plan-review | `/dev:dev` Phase 3 Step 3.10 | 2 when N ≥ 3, otherwise N |
| code-review | `/dev:dev` Phase 5 Step 5.5, `/dev:audit` reviewer rows | 2 when N ≥ 3, otherwise N |
| verify | any verification panel (`verify*` session dirs) | 1 |
| fix-gate | `/dev:fix` Phase A and Phase B | N (every launched slot) |

The internal voters still dispatched through the Agent tool — `dev:architect` at Phase 3,
`dev:debugger` at `/dev:fix` Phase A — are never a ballot in this count: each is always
required, is not covered by `require_pattern`, and the phase's own rule says what a
missing internal report means.

## The internal slot

The internal code reviewer runs in a session of its own — the `internal` slot of the
gate's `team()` call, a CLI session, or, in a nested claudish child only, a foreground
subagent. Which one is decided once per phase by
`${CLAUDE_PLUGIN_ROOT}/skills/core/team-gate/cli-sessions.md`, "the review-session routes";
read it before the first gate of a phase.

- **Copy on COMPLETED only.** Copy `response-<slots.internal>.md` to the site's internal
  path only when that slot is `COMPLETED` and matched `require_pattern`. Delete the
  internal path before the panel starts, so an earlier iteration's copy never stands in.
- **A failed internal slot is re-run once**, alone: `team(models=["internal"], …)` in a
  fresh sub-path `<gate dir>/internal-retry/`, or one CLI session. A second failure at a
  code-review gate is **GATE NOT MET** — append
  `gate not met: <gate> — internal reviewer failed twice: <reason>` and stop with the
  options in step 5. `/dev:fix` Phase B instead maps the missing report to ABSTAIN, as
  its tally step says.
- **A FAILED `launch` on the bypass warning is not retried.** It is Claude Code's
  bypass-permissions consent screen (`cli-sessions.md` §4.7), and it shows on every launch
  until the user opts in, so it counts as that second failure at once. The gate's report
  leads with the opt-in step: run `claude --dangerously-skip-permissions` once,
  interactively, or use claudish.
- **Never twice on `REVIEWS:`.** The internal path stands for the internal review; list
  `response-<slot>.md` for each external slot that completed and never
  `response-<slots.internal>.md`. "One review" and "two or more reviews" count distinct
  reviewers.

## The procedure

**1. Start with `input_file` only.** Write the brief to `<path>/prompt.md` (or the gate's
named input file) and call:

```
team(mode="run", path=<gate dir>, models=[...], input_file=<gate dir>/prompt.md,
     require_pattern=<the line the brief mandates>, min_output_bytes=400, agent=<if any>)
```

Never pass `input` beside `input_file`. The tool rejects the pair with
`Pass input_file or input, not both`, and the audit counted 32 gate calls lost to exactly
that. If the tool_result carries `is_error` with that text, retry ONCE with `input_file`
alone and nothing else changed. Any other error, or a second failure: the panel has
0 ballots. Record the error text and go to step 5.

**2. `started` is not a result.** The `run` response holds a `slots` map and nothing
else. Keep the map; it addresses the files in step 4.

**3. If Claude Code backgrounds the call** (the tool_result says the call exceeded the
120-second limit and was moved to a task), wait for the task notification. A notification
that carries a `TEAM_RESULT` block is a settled-status shortcut; one that carries none
tells you nothing. In both cases still run steps 4 and 5. Backgrounded is unknown until
polled.

**4. Poll, then read.** Call `team(mode="status", path=<gate dir>)` until no entry in
`models` has `state === "RUNNING"`. Bound the loop by wall clock (10 minutes is the
default ceiling for a review panel; a gate may state its own). Use `idle_seconds_by_slot`
with `activity_by_slot` to tell a slot running tests from a wedged one; cancel a wedged
slot with `team(mode="cancel", path, slot)` rather than waiting on it. When settled, read
every `response-<slot>.md` named by the `slots` map. A ballot is read from that file, never
from the `run` response and never from memory of what a model usually says.

**5. Count ballots against `MIN_BALLOTS`.**

- **ballots ≥ MIN_BALLOTS, all slots succeeded** — gate met. Proceed.
- **ballots ≥ MIN_BALLOTS, some slots failed** — gate met on a partial panel. Proceed, but
  list every failed slot and its `error.reason` in the gate's report and directly above
  the `VERDICT:` line of `consolidated.md`. A partial panel is never reported as a full one.
- **ballots < MIN_BALLOTS** — **GATE NOT MET.** Do not consolidate, do not compute a
  verdict, do not continue to the next phase. Append to `${SESSION_PATH}/gates.log`:

  ```
  gate not met: <gate> — <ballots>/<N> ballots, minimum <MIN_BALLOTS>; failed: <slot>=<reason>, ...
  ```

  then stop and ask (AskUserQuestion) with exactly these options: re-run the failed
  slots; proceed on the ballots in hand (the choice is recorded in `gates.log` as
  `gate override: <gate> — user accepted <ballots>/<N>`); stop the run. Under
  `automation: autonomous` or a preset with no answer for this widget, the run stops
  with GATE NOT MET as the reason; a gate is the one thing autonomy does not skip.

**6. Skipping is written down.** Whenever a gate does not run its external panel — MODELS
is `none`, claudish is absent at a gate with no CLI route (plan-review), `--no-review`, a
downgrade offer accepted, internal-only by preset — append one line to `${SESSION_PATH}/gates.log` at the moment the decision is made:

```
gate skipped: <gate> — <reason>
```

One line per gate, with one reason. Reasons are short and literal: `MODELS none`, `claudish absent` (plan-review only),
`--no-review`, `downgrade accepted`, `preset review_models empty`. A gate that runs but
drops one id writes the same line with the slot named, one per id:
`gate skipped: <gate> slot <id> — <reason>` (`cli-sessions.md` §4.1). The internal reviewer still runs, as the `internal` slot or
a CLI session; only the external panel is skipped, and the line says so by naming the
gate. Which route ran is its own line, `gate route: …`, written by `cli-sessions.md`.

**7. The final report repeats `gates.log`.** Every completion message of a command that
owns gates carries a `**Gates**:` section with the file's lines verbatim, or the single
line `no gate skipped, no gate below minimum`. Silence about a gate is a defect.

## The run record

Commands that choose a depth or a panel write `${SESSION_PATH}/run.json` when the choice
is made, and print one transcript line so an audit can attribute every gate call to a run:

```json
{ "command": "/dev:dev", "depth": "full", "automation": "guided",
  "models": ["<id>", "<id>"], "started_at": "<ISO 8601>" }
```

```
Run: depth=full automation=guided models=<id>,<id>
```

`/dev:fix` writes the same file with `"depth": "production-grade"`, its parsed flags, and
`models` from `config.json`. When models are resolved after the file was first written
(`/dev:dev` resolves them in Phase 1 Step 1f), rewrite `models` and print the line again.
Session scratch, git-ignored, never cited.
