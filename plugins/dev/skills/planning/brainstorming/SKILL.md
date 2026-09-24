---
name: brainstorming
description: "Explores solution approaches in parallel across models through claudish, then has an external panel review the chosen plan. Use when the direction is open, or the user asks to brainstorm or compare approaches."
user-invocable: false
disable-model-invocation: true
---

# Brainstorming: multi-model approach exploration

Turn an open problem into a chosen, reviewed plan. Several models propose approaches
independently, you compare what they proposed, the user picks, and the written plan goes
to an external review panel before anyone builds it.

Done means: the user chose an approach with its trade-offs in front of them, and the plan
going forward has been through the external review, or the report says why it was not.

## Who runs this

The main session runs it. `/dev:architect` routes here in Brainstorm mode. The workflow
needs two things only the main session has:

- **AskUserQuestion**, for the user's decisions.
- **The claudish MCP tools**: `list_models` and `search_models` to pick the panel, and
  `team` to run it.

External models never run through the Agent tool. Its `model` parameter accepts only
Claude tier aliases, so a catalog ID passed there fails. Every model that isn't the host
runs through claudish, and so does the host itself when it sits on the panel: the
native name `internal` in a `team` panel is covered by `require_pattern` like any other
panel member.

**If you are a subagent** (a loadout handed this file to the architect or spec-writer
agent), you have neither tool. Do the exploration yourself. Write approaches that use
genuinely different mechanisms, in the per-approach shape from step 2, and return them
to the orchestrator. It presents them to the user and runs any panel.

## Session directory

Use `${SESSION_PATH}/brainstorm/` when the caller passes a session path. Otherwise create
`ai-docs/sessions/dev-brainstorm-<YYYYMMDD-HHMMSS>-<4 random hex bytes>/`. It must sit
inside the working directory, because `team` rejects a `path` outside it. Everything the
run writes goes here: `problem.md`, `explore/`, `approaches.md`, `plan.md`, `review/`,
`gates.log`.

## 1. Pin down the problem

Read the code the topic touches before you ask anything. The questions worth the user's
time are the ones whose answers would change which approach wins: scale and load,
latency or consistency needs, dependencies the approach must keep, what is out of scope,
and what "done" looks like. Skip anything the prompt or the repo already answers.

Ask with AskUserQuestion, offering the answers the code suggests as options. Its
free-text answer covers everything else. Write `problem.md` (constraints, success
criteria, scope in and out) and confirm it with the user before going on. A panel run on
the wrong problem is the most expensive mistake this workflow can make.

## 2. Explore in parallel

**Choose the panel.** Call `list_models`, and call `search_models` for any family the
user named. The rules, from `claudish:claudish-usage` → "Model Alias Resolution", that
matter here:

- Never name a model from memory. Training data carries dead IDs.
- A version the user names is a hard constraint. If the catalog does not list it, say so
  and show the live alternatives. Never substitute the nearest-sounding version.
- Pass the catalog's bare `id`. That means no `vendor/` slug, and no `provider@` prefix
  unless the user named that exact address.
- If `.claude/multimodel-team.json` exists, check every ID in it against the catalog,
  drop the dead ones, and say which you dropped.

Aim for disagreement. Models from different vendors diverge more usefully than two
models from one family. Include `internal` so the host's own view is one panel member
among the others. Once the panel is chosen, write `run.json` in the session directory
as team-gate describes under "The run record", with `"command": "brainstorming"`.

**Write the brief** to `explore/input.md`:

```markdown
# Explore approaches: <topic>

## Problem
<problem.md, verbatim>

## Codebase context
<stack; the modules and paths an approach must fit; conventions it must respect>

## Task
Propose the approaches you would seriously consider for this problem, each a different
mechanism rather than a variation of another. Read the code named above as needed.
Answer in your response. Do not create or edit files.

For each approach, under `### <name>`:
- How it works: components and data flow
- Fits when, and wrong when, tied to the constraints above
- Costs: complexity, operational burden, migration from the current code
- Risks and open unknowns

Then say which one you would choose under these constraints, and what would change
your mind.

Include a fenced block tagged `approaches`: one line per approach, then
`recommend: <name>`.
```

Don't ask for a confidence number. Self-reported confidence is not calibrated across
vendors, so averaging it measures nothing. "What would change your mind" tells you more.

**Run it:**

````
team(mode="run", path=<dir>/explore, models=[...resolved...],
     input_file=<dir>/explore/input.md, require_pattern="```approaches",
     min_output_bytes=400, agent="dev:architect")
````

`dev:architect` gives every panel member the architecture catalog and read access to
the repo. Read `${CLAUDE_PLUGIN_ROOT}/skills/core/team-gate/SKILL.md` and follow its
steps 1–4 for the lifecycle. The `run` call only starts the panel; poll `status` until
it settles, then read every `response-<slot>.md` named in the `slots` map.

Exploration is not a vote, so it has no ballot minimum:

- **Two or more usable responses**: compare them.
- **One**: present it as a single model's view.
- **None**: report each slot's `error.reason` and stop. Offer the user four choices:
  retry, choose other models, explore host-only, or cancel. Never substitute a model
  silently.

A panel member can write to the repo despite the brief, so check `git status` once the
panel has settled.

**Without claudish** (no `team` tool in your tool list), tell the user, write the
approaches yourself, and label the comparison single-model. With one source there is
no agreement signal.

## 3. Compare

This step is judgment, not arithmetic. Slot IDs are anonymised, so read the responses
before you look at the model mapping. That way you weigh the argument, not the vendor.

- **Group by mechanism, not by name.** Two approaches with different names can be the
  same mechanism, and one name can cover two different mechanisms.
- **For each group, record** who proposed it (a count of models, not a score), the
  strongest case for and against it, and the conditions under which it is wrong.
- **Treat agreement as weak evidence.** Several models landing on one approach shows
  it is conventional. It does not show it fits these constraints. Weigh every approach
  against `problem.md`.
- **Keep lone proposals visible.** An approach only one model raised is often the most
  useful thing the panel produced. Do not rank it out of sight.
- **Read the panel's overall shape.** Wide divergence means the problem is new or
  underspecified. It is not a failed panel. Near-total agreement means the problem is
  well understood. Say which of the two it was.

Write `approaches.md`. Start with a table: approach, proposed by, fits when, main risk.
Follow it with a short section per approach, then your recommendation and its reasons,
tied to the constraints.

## 4. User chooses

Show `approaches.md`, then ask with AskUserQuestion. The widget holds only a few
options, so put the leading candidates in them. Each option's label is the approach
name, and its description says when it fits and what it risks. The free-text answer
covers two other choices: combining approaches, and exploring further.

- **Combine**: in the plan, record what comes from each approach and where they
  conflict.
- **Explore further**: add what the user said to the brief and repeat step 2 in a new
  directory (`explore-2/`).

## 5. Write the plan

Write the chosen approach into `plan.md`. Cover:

- components and their responsibilities
- data flow
- the existing code it touches, by path
- decisions still open
- assumptions, and what would falsify each one
- risks with mitigations
- how success is measured, taken from `problem.md`
- a build order

Don't attach confidence percentages. The review in step 6 and the user's approval in
step 7 are the gates.

## 6. External review of the plan

The plan goes to an external panel before it moves on. This gate is `plan-review` in
team-gate's table: `MIN_BALLOTS` is 2 when N ≥ 3, otherwise N. Reuse the exploration
panel. A model whose approach was not chosen makes a sharp critic.

Write `review/prompt.md`: the plan, `problem.md`, and this ask:

```markdown
Review this plan against the problem's constraints and success criteria. Find what
will break, what is missing, and what conflicts with the stated constraints.
Grade each finding:
- CRITICAL: the plan cannot meet a stated constraint or success criterion, or will force a redesign
- HIGH: a boundary, contract or data-flow decision that will produce wrong behaviour or a rewrite
- MEDIUM: a gap implementation will have to resolve on its own
- LOW: naming, structure, presentation
For each: the plan section, the problem, why it matters, a suggestion.
Open with `**Verdict**: PASS|CONDITIONAL|FAIL` (FAIL: any CRITICAL; CONDITIONAL: any HIGH;
PASS: otherwise). This is read-only analysis; do not create or edit files.
```

Run it with `path=<dir>/review`, `input_file=<dir>/review/prompt.md`,
`require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)"`, `min_output_bytes=400` and
`agent="dev:architect"`. Then follow team-gate steps 2–7. Its step 5 decides what
happens when ballots fall below the minimum, and its step 6 decides what to log when
the panel is skipped, for example when claudish is absent or the user declines the
review. `gates.log` lives in the session directory.

Read every ballot. For each CRITICAL and HIGH finding, decide whether it holds against
the plan and the constraints. Reviewers misread plans too, and one wrong CRITICAL should
not sink a sound plan. Revise `plan.md` for the findings that hold. List the ones you
reject, each with its reason. If a revision changes the approach itself rather than its
details, offer the user another review round.

## 7. Approval and hand-off

Ask with AskUserQuestion: approve, revise a named section, or start over from step 1.
When the user approves, return this report to the caller:

- **Problem**: one line, with the path to `problem.md`
- **Panel**: the models used, the result of the catalog check (how many saved IDs were
  live, and which were dropped), and any slot that failed with its `error.reason`
- **Approaches**: the table from `approaches.md`
- **Chosen**: the approach, and the user's reason if they gave one
- **Review**: ballots against N, each verdict, the findings acted on, and the findings
  rejected with reasons
- **Gates**: the lines of `gates.log` verbatim, or `no gate skipped, no gate below minimum`
- **Files**: the paths to `approaches.md` and `plan.md`

`/dev:architect` can then carry `plan.md` into Architecture design mode.

## Failure handling

- **A slot fails**: name the slot and its `error.reason` in the report, and carry on
  with the slots that succeeded. Never retry automatically or swap in another model.
  Routing belongs to claudish. A model that will not route is a `report_error` call,
  and only with the user's consent.
- **Slots still running at the poll ceiling**: report them as still running and let
  the user decide. Do not cancel them automatically.
