# Phase 5: Code Review Loop

**Objective:** Multi-model code review with iteration until pass

**Iteration limit:** Read from ${SESSION_PATH}/iteration-config.json (default: 3)

## Steps

### Step 5.1: Announce the phase
Say, in one line: **Phase 5 — starting.**

### Step 5.2: Read iteration config
```bash
code_review_limit=$(cat ${SESSION_PATH}/iteration-config.json | jq -r '.innerLoops.codeReview')
```

### Step 5.3: Prepare code diff

Read `repoPath` and `baselineCommit` from `session-meta.json` and capture with the
plugin's script. **Do not `cd`** — `SESSION_PATH` is relative to the main worktree,
so changing directory sends both the read and the write somewhere else.

```bash
REPO=$(jq -r '.repoPath // empty' "${SESSION_PATH}/session-meta.json")
BASELINE=$(jq -r '.baselineCommit // empty' "${SESSION_PATH}/session-meta.json")
if [ -z "$REPO" ] || [ -z "$BASELINE" ]; then
  echo "STOP: session-meta.json is missing or lacks repoPath/baselineCommit — Phase 0 Step 0.4 did not run" >&2
  exit 1
fi

bun "${CLAUDE_PLUGIN_ROOT}/scripts/capture-review-surfaces.ts" \
  --repo "$REPO" --baseline "$BASELINE" > "${SESSION_PATH}/code-changes.diff"
capture_status=$?
```

**If the `-z` guard fires: STOP.** Do not call the script with what you have. The
script itself also refuses an empty `--repo` or `--baseline` (exit 2) rather than
dropping into branch mode, so the guard is the earlier, better-worded stop, not
the only one — it names the step that did not run. A missing `session-meta.json`
makes `jq` exit 2 with empty output, which is exactly that case.

`capture_status` is 3 when git itself failed, which is NOT the same as an empty
capture — `>` truncates the file before git runs, so testing for an empty file
alone conflates the two.

**If `capture_status` is non-zero: STOP.** Report the git failure. Do not review.

**If `code-changes.diff` is empty: STOP.** Do not launch reviewers, do not write
`reviews/code-review/consolidated.md`, and do not emit `PASS`, `FAIL` or
`CONDITIONAL`. Report that the capture found nothing and name the baseline and repo
path it used. An empty capture usually means the baseline is wrong, not that the
work is clean.

### Step 5.4: Resolve MODELS (P1b — NO RE-ASKING)

Read model selection from ${SESSION_PATH}/iteration-config.json:
```bash
selected_models=$(cat ${SESSION_PATH}/iteration-config.json | jq '.selectedModels')
```

Use the same models as Phase 3 (already configured in Step 1f). Never re-ask.

Pick the route once for this phase: read
`${CLAUDE_PLUGIN_ROOT}/skills/core/team-gate/cli-sessions.md`, "the review-session
routes", §1. Presence is the `mcp__plugin_claudish_claudish__team` tool being registered
in this session — never the binary on PATH, and never whether the `multimodel` plugin is
installed.

- **claudish**, `selectedModels.models` non-empty → `MODELS: <the ids, comma-separated>`.
  Display: "Code review using same models as plan review: {model list}".
- **cli-sessions** → each `selectedModels` id goes to the CLI of its family with that
  exact id (§4.1 of that file); an id no installed CLI carries is skipped and logged
  there. `MODELS:` lists the ids that will run.
- **nested** → `MODELS: none`; the external panel is skipped and logged by that file.
- **stop** → stop the phase as that file says. Never fall back to a subagent.
- No ids to run → `MODELS: none` on every route, the internal reviewer alone; this gate
  never takes `cli-sessions.md`'s default panel, which is `/dev:fix`'s. The internal
  reviewer runs regardless; it is never optional. Append nothing here: an empty list got the gate's one skip line when Step 1f
  stored it (`dev.md`, "Complete the run record"), and a stored id no CLI carries got its
  slot line from `cli-sessions.md` §4.1. The completion message
  repeats `gates.log` (`${CLAUDE_PLUGIN_ROOT}/skills/core/team-gate/SKILL.md`, steps 6-7).

### Step 5.5: Launch the reviews

The internal reviewer always runs, in a session of its own, with the contract lines, its
loadout from `context.json`, and nothing else. It owns its own checklist, severity scale
and thresholds; this phase does not restate them. The loadout is repo knowledge to review
*against* — `security-audit.md`, the stack's own patterns, an architecture leaf for a
`refactor` or `new_subsystem` — chosen for this task by the detector; it is not review rules.

Each pass through this step is iteration `<n>` (1 on the first, +1 on each Step 5.8
re-run) and gets a fresh gate directory, so no earlier iteration's file can satisfy this
one. Delete the fixed internal path first:
```bash
GATE_DIR="${SESSION_PATH}/reviews/code-review/iter-<n>"
mkdir -p "$GATE_DIR"
rm -f "${SESSION_PATH}/reviews/code-review/claude-internal.md"
```

Write the brief to `${GATE_DIR}/prompt.md` **always**, whatever MODELS is —
`input_file` names that path, so the file must exist before the call:
```
TARGET: ${SESSION_PATH}/code-changes.diff
FOCUS: code
MODELS: none

**YOUR LOADOUT** (from context.agent_loadouts.reviewer.read in
${SESSION_PATH}/context.json — at most 5, chosen for this agent and this task;
read them before the diff, mandatory first):
{for each path in context.agent_loadouts.reviewer.read}
- {path}{if path in context.agent_loadouts.reviewer.mandatory} ← MANDATORY{end}
{end}
{if context.agent_loadouts.reviewer.note}
Note: {context.agent_loadouts.reviewer.note}
{end}

Return the full report as your answer.
```
`MODELS: none` and no `OUTPUT:` line: every slot is a reviewer, and a reviewer neither
launches reviewers nor persists anywhere but its own slot file. An `OUTPUT:` line would
make it return a summary, which fails `min_output_bytes`.

`TARGET:` names the capture file, so the reviewer runs in CAPTURE mode: it states which
surfaces were present and the baseline they were resolved against, and it emits no
verdict over an empty file. Step 5.3 already stopped on an empty capture; this is the
second lock on the same door.

**claudish route** — the internal reviewer is the `internal` slot of the one panel call;
with no externals the call still runs, as `models=["internal"]`:

```
claudish team(mode="run", path=${GATE_DIR},
  models=["internal", ...selectedModels.models],
  agent="dev:reviewer",
  input_file=${GATE_DIR}/prompt.md,
  require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)",
  min_output_bytes=400)
```

**cli-sessions or nested route** — run the same brief by
`${CLAUDE_PLUGIN_ROOT}/skills/core/team-gate/cli-sessions.md`, with `${GATE_DIR}` as the
gate directory, `agent="dev:reviewer"`, the `require_pattern` and `min_output_bytes`
above, and `${SESSION_PATH}/reviews/code-review/claude-internal.md` as the internal path.

`require_pattern` is the line the reviewer's report format mandates, so a slot that
exited 0 with a shapeless response is reported FAILED rather than joining the consensus
count as a reviewer that found nothing. `min_output_bytes` floors the rest: 400 bytes is
well below any real review and catches a stub.

Pass `input_file` ONLY — never `input` beside it. The pair is rejected with
`Pass input_file or input, not both`; on that exact error retry once with `input_file`
alone. Any other error is a panel with 0 ballots.

This gate is **code-review**, `MIN_BALLOTS` = 2 when N ≥ 3, otherwise N, with N and
ballots over external slots only, on every route
(`${CLAUDE_PLUGIN_ROOT}/skills/core/team-gate/SKILL.md`). **Ballots below `MIN_BALLOTS`
is GATE NOT MET**: append the `gate not met:` line to `${SESSION_PATH}/gates.log`, skip
Step 5.6, and stop with the skill's three options.

**claudish route — `run` does not wait, and `started` is not a result.** Follow the
skill's steps 2-5 before consolidating: poll `claudish team(mode="status", path=${GATE_DIR})`
until no slot in `models` has `state === "RUNNING"` (bounded; `idle_seconds_by_slot` with
`activity_by_slot` tells a slow test suite apart from a wedged slot), then read every
`response-<slot>.md` and count ballots. A backgrounded call is unknown until polled.
Requires claudish >= 8.0.0. Then, on the claudish route, copy the internal review by the
skill's "The internal slot": only a `COMPLETED` `response-<slots.internal>.md` that
matched `require_pattern` becomes `${SESSION_PATH}/reviews/code-review/claude-internal.md`.

**cli-sessions route** — there is no `team` tool to poll. `cli-sessions.md` §4.7 decides
each session by its OUTPUT file, `${GATE_DIR}/response-<slot>.md`, and §4.2 writes the
slots map to `${GATE_DIR}/cli-slots.json`; the same copy and ballot rules apply over
those files, with `cli-slots.json` as the slots map.

**nested route** — the Agent writes `claude-internal.md` directly; there is no slots map
and no external panel, so there is nothing to poll, copy or count.

A failed internal reviewer, on any route, is re-run once, alone; a second failure is GATE
NOT MET (`gate not met: code-review — internal reviewer failed twice: <reason>`). A FAILED
`launch` on the bypass warning is not retried — the skill's "The internal slot" says why
and what the report leads with.

### Step 5.6: Consolidate

`consolidated.md` is a required artifact of this phase. Count the reviews that
completed first.

**One review** (MODELS was none, the nested route, or every external slot failed) — do not dispatch
`dev:aggregator`; aggregating one review can only subtract from it. Copy
`claude-internal.md` to `consolidated.md` unchanged, then append a blank line and
`VERDICT: <word>`, the word being the review's own `**Verdict**:` checked against the
reviewer's thresholds (read them from `${CLAUDE_PLUGIN_ROOT}/agents/reviewer.md`, Phase
5). If externals were launched, list each external slot that did not complete, and why,
directly above the `VERDICT:` line. The internal slot's own `response-<slot>.md` is the
same review as `claude-internal.md`, never a second one.

**Two or more reviews** — consolidation is `dev:aggregator`'s job: never done inline by
the orchestrator, never by a reviewer. It merges them with consensus levels.

```
Agent(
  subagent_type: "dev:aggregator",
  run_in_background: false,
  description: "Consolidate code reviews",
  prompt: "REVIEWS: ${SESSION_PATH}/reviews/code-review/claude-internal.md
           ${GATE_DIR}/response-<slot>.md   (one line per external slot that completed, this iteration only — never slots.internal)
           THRESHOLDS: <the three lines under 'Apply verdict thresholds' in
                        ${CLAUDE_PLUGIN_ROOT}/agents/reviewer.md, Phase 5, quoted verbatim>
           OUTPUT: ${SESSION_PATH}/reviews/code-review/consolidated.md
           Compute the verdict line from your counts against THRESHOLDS.
           You are given reviews, never code. Do not review."
)
```

Quote the thresholds from the reviewer's file when you build this prompt — read them,
do not recall them. They live in exactly one place so that the reviewer and the phase
that judges its verdict cannot drift apart.

Either way `consolidated.md` ends in `VERDICT: PASS|CONDITIONAL|FAIL`.

### Step 5.7: Read the verdict

Read the `VERDICT:` line from `${SESSION_PATH}/reviews/code-review/consolidated.md`.
It is PASS, CONDITIONAL or FAIL, computed against the reviewer's thresholds. This phase
applies the verdict; it does not recompute it.

### Step 5.8: Review loop
Review Loop (max code_review_limit iterations):

If CONDITIONAL or FAIL:
  a. Delegate fixes to developer agent
  b. Re-run the Step 5.3 capture verbatim — the same script, the same baseline,
     and the SAME two STOP conditions. A regeneration that quietly falls back to
     a bare `git diff` reintroduces the bug this loop is fixing.
  c. Re-run Step 5.5 — the reviews, as iteration n+1 in a fresh `iter-<n+1>/`
  d. Re-run Step 5.6 — the consolidation
  e. Re-read the verdict (Step 5.7)
  f. Iteration counter++

If PASS:
  a. Exit loop

If max iterations reached and still FAIL:
  a. Escalate to user (AskUserQuestion):
     "Code review has reached maximum iterations ({limit}).

      Remaining Issues:
      - CRITICAL: {count}
      - HIGH: {count}

      Options:
      1. Continue anyway (accept current state)
      2. Allow {limit} more iterations
      3. Cancel feature development
      4. Take manual control"

### Step 5.9: Announce the phase complete
Say, in one line: **Phase 5 — complete**, naming the artifacts you wrote.
Do this only once those files exist. The Stop hook checks for them and reports a
phase started and left half done — it does not block the turn, so a missing artifact
is yours to notice and produce; nothing will hold you to it.

## Quality Gate
Review verdict PASS or CONDITIONAL with user approval.
Required artifacts:
- ${SESSION_PATH}/reviews/code-review/consolidated.md (with verdict)
- ${SESSION_PATH}/reviews/code-review/claude-internal.md
- ${SESSION_PATH}/code-changes.diff (non-empty)

All three are enforced by `phase-completion-validator`. The internal review is listed
because step 5.5 writes it — the copy of the internal slot, made only when that slot
completed with a verdict line — and a phase must not pass on the consolidation alone. The
capture is listed because a PASS written over a 0-byte capture used to satisfy the gate.
The per-iteration `iter-<n>/` directories hold the raw slot files behind them.
