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

Read model selection from ${SESSION_PATH}/iteration-config.json and check for the
claudish runtime:
```bash
selected_models=$(cat ${SESSION_PATH}/iteration-config.json | jq '.selectedModels')
which claudish >/dev/null 2>&1; claudish_present=$?
```

Use the same models as Phase 3 (already configured in Step 1f). Never re-ask.

- `selectedModels.models` non-empty AND `claudish_present` is 0 →
  `MODELS: <the ids, comma-separated>`. Display: "Code review using same models as
  plan review: {model list}".
- Otherwise → `MODELS: none`. If models were configured but claudish is absent, say so
  once. The internal reviewer runs regardless; it is never optional.

Presence is the claudish runtime — `which claudish`, or the
`mcp__plugin_claudish_claudish__team` tool being registered in this session — never
whether the `multimodel` plugin is installed.

### Step 5.5: Launch the reviews

The internal reviewer always runs, foreground, with the contract lines and nothing
else. It owns its own checklist, severity scale and thresholds; this phase does not
restate them.

```
Agent(
  subagent_type: "dev:reviewer",
  run_in_background: false,
  description: "Review Phase 4 code changes",
  prompt: "TARGET: ${SESSION_PATH}/code-changes.diff
           FOCUS: code
           OUTPUT: ${SESSION_PATH}/reviews/code-review/claude-internal.md
           MODELS: {ids from Step 5.4, or none}
           Persist the full report to OUTPUT with a Bash heredoc — you have Bash, not
           Write — then return a brief summary."
)
```

`TARGET:` names the capture file, so the reviewer runs in CAPTURE mode: it states which
surfaces were present and the baseline they were resolved against, and it emits no
verdict over an empty file. Step 5.3 already stopped on an empty capture; this is the
second lock on the same door.

**If `MODELS:` is not `none`**, the externals run beside it. First write the same brief
to `${SESSION_PATH}/reviews/code-review/prompt.md` — `input_file` names that path, so
the file must exist before the call — with `MODELS: none` and no `OUTPUT:` line: each
slot is a reviewer, and a reviewer neither launches reviewers nor persists anywhere but
its own slot file. Then, in the SAME message as the Agent call above:

```
claudish team(mode="run", path=${SESSION_PATH}/reviews/code-review,
  models=[...selectedModels.models],
  agent="dev:reviewer",
  input_file=${SESSION_PATH}/reviews/code-review/prompt.md,
  require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)",
  min_output_bytes=400)
```

`require_pattern` is the line the reviewer's report format mandates, so a slot that
exited 0 with a shapeless response is reported FAILED rather than joining the consensus
count as a reviewer that found nothing. `min_output_bytes` floors the rest: 400 bytes is
well below any real review and catches a stub.

**`run` does not wait.** Before consolidating, poll
`claudish team(mode="status", path=${SESSION_PATH}/reviews/code-review)` until no slot in
`models` has `state === "RUNNING"`. Bound the loop and report anything still running;
`idle_seconds_by_slot` with `activity_by_slot` tells a slow test suite apart from a wedged
slot. Full procedure: `claudish:claudish-usage` → "The three-step lifecycle". Requires
claudish >= 8.0.0.

### Step 5.6: Consolidate — dispatch the synthesizer

Consolidation is `dev:synthesizer`'s job: never done inline by the orchestrator, never
by a reviewer. One review or five, the same dispatch — `consolidated.md` is a required
artifact of this phase either way, and the synthesizer is the only thing that writes it.
With one review it passes that review through unchanged and appends the `VERDICT:`
line; with several it merges them with consensus levels.

```
Agent(
  subagent_type: "dev:synthesizer",
  run_in_background: false,
  description: "Consolidate code reviews",
  prompt: "REVIEWS: ${SESSION_PATH}/reviews/code-review/claude-internal.md
           ${SESSION_PATH}/reviews/code-review/response-<slot>.md   (one line per slot that completed; none when MODELS was none)
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

The synthesizer writes `consolidated.md` ending in `VERDICT: PASS|CONDITIONAL|FAIL`.

### Step 5.7: Read the verdict

Read the `VERDICT:` line from `${SESSION_PATH}/reviews/code-review/consolidated.md`.
It is PASS, CONDITIONAL or FAIL, computed by the synthesizer against the reviewer's
thresholds. This phase applies the verdict; it does not recompute it.

### Step 5.8: Review loop
Review Loop (max code_review_limit iterations):

If CONDITIONAL or FAIL:
  a. Delegate fixes to developer agent
  b. Re-run the Step 5.3 capture verbatim — the same script, the same baseline,
     and the SAME two STOP conditions. A regeneration that quietly falls back to
     a bare `git diff` reintroduces the bug this loop is fixing.
  c. Re-run Step 5.5 — the reviews
  d. Re-run Step 5.6 — the synthesizer
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
because step 5.5 writes it and nothing used to check it: a `dev:reviewer` that returned
without persisting anything left the phase passing on the consolidation alone. The
capture is listed because a PASS written over a 0-byte capture used to satisfy the gate.
