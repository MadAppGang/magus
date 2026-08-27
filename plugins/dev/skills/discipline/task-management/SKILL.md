---
name: task-management
description: Tracks phases across a multi-phase workflow in text, and explains why the task-list tools are gone. Use when orchestrating phased work.
user-invocable: false
disable-model-invocation: true
---

# Phase Tracking

**There are no task-list tools.** `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet` and
`TodoWrite` were removed from Opus 4.8, Sonnet 5, Fable 5, Mythos 5 and newer in Claude
Code 2.1.233. Verified with a control rather than taken from the changelog:

```console
$ claude -p "is a tool named TaskCreate available to you?" --model claude-sonnet-5
no
$ claude -p "is a tool named TaskCreate available to you?" --model claude-sonnet-4-6
yes
```

This file used to teach the opposite — create a task per phase, flip it to `in_progress`,
flip it to `completed`. Every one of those calls was unmakeable on the models this repo
runs, so the instruction was silently dropped along with whatever else shared the
sentence. **Do not add them back.**

## What to do instead

Report each transition in **one line of text**, and make the artifacts the record:

```
**Phase 3 — starting.**
...work...
**Phase 3 — complete.** Artifacts: architecture.md, reviews/plan-review/consolidated.md
```

Two lines per phase. No state to keep, nothing to go stale, and it reads the same to a
human watching the run.

## The artifacts ARE the task list

This is the substantive change, not a cosmetic one. A task marked `completed` was only a
claim; a file on disk is evidence. Phase state now lives in `${SESSION_PATH}`, and the
phase's required artifacts are its definition of done — see `dev:enforcement`.

| question | old answer | now |
|---|---|---|
| which phase am I in? | `TaskList` | the last `**Phase N — starting**` line you wrote |
| is phase N done? | its task status | its artifacts exist and are non-trivial |
| what enforces it? | `PreToolUse:TaskUpdate` | the `Stop` hook, which still fires |

## The gate

`hooks/phase-completion-validator.ts --stop` runs when the turn ends. It resolves the
session, and blocks the turn if any phase has **some but not all** of its artifacts — a
phase begun and abandoned:

```
BLOCKED: a /dev:dev phase was started and left incomplete.
  - Multi-Model Planning (phase3): missing reviews/plan-review/consolidated.md
Session: ai-docs/sessions/dev-feature-x
Finish the artifacts, or write a skip-reason.md saying why the phase was abandoned.
```

A phase with **none** of its artifacts was never started and is not a finding. A phase
with all of them is finished. Only a mix is a problem.

Its predecessor was a `PreToolUse` hook on `TaskUpdate`, which meant it could not fire at
all once the tool disappeared — the command text kept promising enforcement that had
stopped happening. If you change the trigger again, check the new one actually fires:
a gate that cannot fail is indistinguishable from no gate.

## Abandoning a phase on purpose

Legitimate — skipping browser validation with no browser, for instance. Write
`${SESSION_PATH}/phase{N}/skip-reason.md` saying why. The point is that the decision is
recorded, not that every phase runs.

## GTD persistence

**Currently inert.** The `gtd` plugin syncs tasks to `.claude/gtd/tasks.json` through
`PreToolUse:TaskCreate` and `PostToolUse:TaskCreate/TaskUpdate` hooks. Those matchers name
tools that no longer exist, so none of the three fires on a current model and nothing
syncs. This is a known gap in `gtd`, not something to work around from here.

## Parallel agents

When work is split across concurrent agents rather than sequential phases, read
[`references/agent-coordination.md`](./references/agent-coordination.md).
