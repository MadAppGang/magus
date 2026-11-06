# multimodel: step by step

Two commands. Two different reasons to bring in a model other than the one you're talking to.

| Command | Shape | Use it when |
|---|---|---|
| `/multimodel:team` | Several models, same task, under a task type | You want independent answers to compare, a verdict you can trust, or several attempts to pick from |
| `/multimodel:delegate` | One model, whole task, full session | You want the work done somewhere else |

Both run on the claudish MCP server. What each command calls is on the
[multimodel plugin page](../plugins/magus/multimodel.md).

---

## `/multimodel:team` — one task, several models

### Step 1. Ask, and say what kind of task it is

```
/multimodel:team Review the auth implementation
/multimodel:team --type research How do sessions expire?
/multimodel:team Implement token revocation
```

Every run has one task type. It decides what each model is asked to produce and what you get
back.

| Type | Each model | You get | Changes files? |
|---|---|---|---|
| `judge` | Reviews blind and votes APPROVE, REJECT or ABSTAIN | One verdict against a threshold | No |
| `research` | Reports findings, each with a source | Agreements, conflicts, single-model findings | No |
| `plan` | Proposes the one approach it would build | The proposals side by side; no consensus is claimed | No |
| `debug` | States one root-cause hypothesis and its evidence | Hypotheses ranked by how many models hold them | No |
| `brainstorm` | Lists ideas | Ideas with who proposed, supported and challenged each | No |
| `implement` | Builds it in its own git worktree | Each diff with its test result; you pick one or none | Only the diff you pick |
| `test` | Writes tests from a spec and a public contract, in a sandbox without the implementation | Each test set with its result and a blindness check; you pick one or none | Only the tests you pick |
| `collaborate` | Takes a turn in your folder, continuing the previous model's work | The edits, uncommitted, with a printed undo | Yes, directly |

The type comes from `--type`, else from the task's words ("Review…" is `judge`,
"Implement…" is `implement`), else the command asks you. It asks rather than guesses when
the words fit more than one type, because a wrong writing type starts several long sessions.

The rest of this section walks through `judge`, the blind vote. The other types share
Step 2; their results are described under "Other task types".

### Step 2. Say which models, or don't

You are talking to an agent, so ask for what you want in words:

```
/multimodel:team use grok and gemini — review the auth implementation
/multimodel:team ask the top tier models whether this migration is safe
/multimodel:team get three different providers to check this API for security holes
```

| What you say | What you get |
|---|---|
| Name models — "use grok and gemini" | Those, resolved to their current IDs |
| "top tier" | The most capable available, at the highest cost |
| "three different providers" | A spread, so agreement means something |
| Nothing about models | A team composed for the question, from the live catalog |

It remembers. The team you settle on is saved for that task type, so the next run needs no
instruction at all. A `judge` team becomes your default; any other type's team is saved for
that type only, so a review panel never ends up running hour-long implementation sessions.
Say "don't remember this one" for a one-off.

**Which models exist right now:** <https://models.madappgang.com/recommended>

Left alone, it builds a team for the type from the live catalog:

| Type | It picks |
|---|---|
| `judge` | flagships from three different providers |
| `research` | large context plus reasoning |
| `plan` | the most capable available |
| `debug` | reasoning-capable models, mixed providers |
| `brainstorm` | mixed providers |
| `implement`, `test`, `collaborate` | fast models that can use tools |

### Step 3. Say how much agreement you need (judge)

Also just words:

```
/multimodel:team they all have to agree — is this migration safe?
```

| What you say | Needs |
|---|---|
| nothing | 50% — a simple majority |
| "strong agreement", "supermajority" | 67% |
| "they all have to agree", "unanimous" | 100% |

Raise it when being wrong is expensive. Unanimous on a schema migration is cheap insurance;
unanimous on a naming question just buys you a SPLIT.

### Step 4. It runs them, blind

The diagram is the `judge` flow.

![Flow diagram of a judge run: one question fans out to external models and an internal subagent, their independent votes are collected, and the approval share is compared against a threshold to give one of four verdicts](./images/multimodel-team-flow.svg)

Every model gets the task and nothing else. Not your opinion, not the other models' answers,
not even the fact that it's one of several. It's told to assume no prior context.

That's the whole point of the command.

Three models that reach the same answer on their own is evidence. Three models that saw each
other's work is one answer, repeated.

#### This is the Delphi method

People have used it on hard forecasting problems since the 1950s: ask several experts
separately, keep them from hearing each other, then aggregate. It works because it removes
the two things that wreck a group decision — the loudest voice, and the first answer that
everyone else anchors to.

One difference worth knowing. Classic Delphi runs several rounds, showing each expert an
anonymous summary and letting them revise. A `judge` run is **one round**. You get the spread
as it actually was, and a SPLIT is a finding rather than a step on the way to consensus.

`research`, `plan`, `debug` and `brainstorm` can run the classic way with
`--workspace shared`: two rounds, where round 2 shows every model all the usable round 1
answers, which may include its own, word for word. Only a model naming itself ("I am …",
"speaking as …") is replaced with `[participant]`; a factual mention of a model, such as a
configured model in a file, stays as written. `brainstorm` runs shared by default. Agreement after round 2 is
labelled "after discussion", next to the round 1 positions, because it is no longer
independent.

#### Every model gets its own folder

Each run creates a directory named for that run:

```
ai-docs/sessions/team-20260811-142233/
  internal-result.md     the internal reviewer's full analysis
  verdict.md             the aggregated result
  …                      each external model's working area and response
```

Models work inside that folder and cannot read each other's files. That is what makes
"blind" true in practice rather than only in the prompt — being unable to peek beats being
asked not to.

It also means the reasoning outlives the conversation. When the table says a model REJECTED
and you want to know why, its full answer is on disk instead of scrolled away.

These folders are scratch: gitignored, and safe to delete. If a run produced something worth
keeping, move it somewhere real.

### Step 5. Read the verdict (judge)

Each model ends with a vote block:

```
VERDICT: APPROVE | REJECT | ABSTAIN
CONFIDENCE: 1-10
SUMMARY: one sentence
KEY_ISSUES: comma-separated, or None
```

The arithmetic is `APPROVE ÷ (APPROVE + REJECT)`. **`ABSTAIN` is left out of the bottom of
that fraction.** It isn't counted against you.

| Result | What it means |
|---|---|
| **APPROVED** | At or above your threshold |
| **REJECTED** | Below `100 − threshold` |
| **SPLIT** | Between the two. They genuinely disagree, and you get told that instead of a rounded answer |
| **INCONCLUSIVE** | Fewer than two real votes. This is why abstaining gets its own result rather than quietly becoming a rejection |

A model that fails shows as FAILED and the run carries on without it. No retry, no
swapping in a different model. A verdict from a team you didn't choose isn't the verdict you
asked for.

### Other task types

Every result opens with the type, how many models produced a usable answer, and a status.
Two or more usable answers is OK; fewer is INCONCLUSIVE, and the report says what it cannot
claim rather than presenting one model's answer as agreement.

- **`research`, `plan`, `debug`, `brainstorm`** change no file. In an isolated run the models
  still share your checkout, so their independence comes from the prompt; the report says so.
- **`implement`** gives each model its own git worktree from your current commit. The
  command runs your tests in every worktree itself, never trusting a model's own claim, and
  then asks which diff to apply, with "None" as the first option. Nothing is applied or
  committed without your pick. Uncommitted changes in your folder are not in the worktrees.
- **`test`** needs `--spec` and `--contract`. Each model writes tests in a sandbox holding
  only the spec, the contract and a list of file names, then the command runs those tests
  against the real implementation. The command reads each model's file-tool calls and the
  text of its shell commands: one that names a path outside its sandbox is marked SUSPECT
  and is not offered. A path a shell command only builds while it runs is not seen.
- **`collaborate`** runs one model at a time in your folder. Each turn sees the earlier turns'
  changes and messages. Your staged state is put back after every turn, a commit by a model
  is caught and offered for undo, and the final report prints the commands that undo the
  whole run. Changes to files git ignores cannot be undone.

### If you want to be exact

Words are the normal way in. Flags are there for when you want no ambiguity — in a script,
or when a model name reads like part of the question.

| Flag | What it changes |
|---|---|
| `--type` | One of the eight task types; skips the choice from your wording |
| `--workspace` | `isolated` or `shared`, for the types that allow both |
| `--models a,b,c` | Overrides everything else |
| `--threshold` | `judge` only: `majority` (50%), `supermajority` (67%), `unanimous` (100%), or a percentage from 1 to 100 such as `75` or `75%` |
| `--effort` | One effort level for every model: `low`, `medium`, `high`, `xhigh` or `max` |
| `--spec`, `--contract` | `test` only: the spec file and the public contract files |
| `--test-cmd` | `implement`, `test`, `collaborate`: the test command to run on each result |
| `--test-dir` | `test` only: the folder the tests go to |
| `--no-memory` | Doesn't save this team |

```
/multimodel:team --models grok,gemini --threshold unanimous Review the auth implementation
```

### The preferences file

`.claude/multimodel-team.json`. Most people write one line in it:

```json
{ "defaultModels": ["internal", "grok"] }
```

That's it. Now every `judge` run uses that pair unless you say otherwise. The other types
read only their own entry under `contextPreferences`.

`internal` isn't a real model. It means the one you're already talking to, and that vote is
cast by a `dev` subagent through a separate call.

Everything else is optional:

| Want | Add |
|---|---|
| A stricter default than 50% | `"defaultThreshold": "supermajority"` |
| A different team for one task type | `"contextPreferences": { "review": ["model-a", "model-b"] }` |
| A specific subagent for one task type | `"agentPreferences": { "review": "dev:reviewer" }` |
| Flags passed to every external session | `"claudeFlags": "--effort high"` |
| A longer or shorter limit for each writing session | `"sessionTimeoutSeconds": 1800` (default 3600) |

The keys under `contextPreferences` and `agentPreferences` are, by type: `judge` → `review`,
`research` → `research`, `plan` → `architecture`, `debug` → `debug`, `brainstorm` →
`brainstorm`, `implement` and `collaborate` → `coding`, `test` → `testing`.

### A note on model names

Every name is resolved against the live catalog, on every run. Nothing is read from a
committed list of model IDs.

That matters because model IDs turn over fast, and a dead one doesn't announce itself — a
request to a model that no longer exists looks a lot like a slow request.

Your own aliases still win, but they're checked against the catalog and flagged when they
stop resolving. If you name a version and it isn't there, you get an error and the real
alternatives — never a quiet downgrade to something with a similar name.

---

## `/multimodel:delegate` — hand the whole task to one model

Not a question. A session. The other model runs a full Claude Code session with your plugins
and skills loaded, and does the work itself.

### Step 1. Say who, and what

```
/multimodel:delegate grok implement authentication
```

Arguments are read left to right:

| Token | Read as |
|---|---|
| First bare word | The model |
| Anything like `/dev:architect` | A command to run inside that session |
| Everything else | The task |

So all three of these work:

```
/multimodel:delegate grok implement authentication
/multimodel:delegate gemini /dev:architect design the payment service
/multimodel:delegate /dev:research rate limiting patterns
```

Leave the model out and it uses your saved default.

### Step 2. Answer its questions

![Flow diagram: the task is parsed and the model resolved, a full external session starts, and its polled session state either asks the user a question, returns output, or reports a failure and stops](./images/multimodel-delegate-flow.svg)

When the model asks something, you get asked. It's never answered on your behalf.

### Step 3. Read the result

Up to 50 lines comes back inline. Longer than that and you get the first 50 plus the session
ID, so you can pull the rest.

### Three rules worth knowing before you use it

**It doesn't retry.** If the model fails, you get the error as-is and it stops. No second
attempt, no substituting a different model.

**It doesn't read your project first.** The external model investigates the codebase itself.
Otherwise you'd be grading your own homework.

**It doesn't answer for you.** Every question comes back.

---

## When neither one is right

Both cost time and tokens. For a quick sanity check on something small, just ask.

What you're paying for here is independence. That's only worth the money when being wrong
would be expensive.
