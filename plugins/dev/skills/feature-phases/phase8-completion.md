# Phase 8: Completion

**Objective:** Generate comprehensive report (only after Phase 7 passes)

## Steps

### Step 8.1: Announce the phase
Say, in one line: **Phase 8 — starting.**

### Step 8.2: Verify Phase 7 passed
- Read ${SESSION_PATH}/validation/result-iteration-{latest}.md
- Confirm Status: PASS
- If not PASS: Error - should not reach Phase 8

### Step 8.3: Gather all artifacts
- ${SESSION_PATH}/requirements.md
- ${SESSION_PATH}/validation-criteria.md
- ${SESSION_PATH}/iteration-config.json
- ${SESSION_PATH}/architecture.md
- ${SESSION_PATH}/implementation-log.md
- ${SESSION_PATH}/reviews/code-review/consolidated.md
- ${SESSION_PATH}/tests/test-results.md
- ${SESSION_PATH}/validation/result-iteration-{latest}.md
- ${SESSION_PATH}/validation/screenshot-*.png
- ${SESSION_PATH}/gates.log
- Model performance statistics (if multi-model used)

### Step 8.4: Generate final report
Generate final report at ${SESSION_PATH}/report.md:

Include:
- Feature summary
- Requirements fulfilled checklist
- Architecture decisions
- Implementation notes (files created, lines added)
- Review feedback summary (consensus analysis if multi-model)
- Test coverage and results
- **REAL VALIDATION RESULTS** (with screenshots)
- Outer loop iterations used
- Model performance statistics (if applicable)
- Known issues (if any), including the skip and override lines in gates.log
- Decisions that changed during the run, and why (the "Decisions changed" sections of architecture.md and implementation-log.md)
- Recommendations for next steps

### Step 8.5: Update session-meta.json
Update ${SESSION_PATH}/session-meta.json:
- Set status: "completed"
- Add completion timestamp
- Record outer loop iterations used
- Update checkpoint to final phase

### Step 8.6: Prepare model performance (if multi-model)
If multi-model validation was used, prepare — do not print yet:
- Model performance statistics table
- Historical performance (from ai-docs/llm-performance.json)
- Recommendations for future sessions

They print in Step 8.7, below the four-part report, never ahead of it.

### Step 8.7: Present final summary
Present the summary to the user FIRST, using the `<completion_message>` template in
`commands/dev.md`: its four-part block opens it — **Done**, **How it was checked**,
**Issues**, **Decisions that changed**. Fill the parts from the artifacts gathered in
Step 8.3: the commands and results from `tests/test-results.md` and the validation result,
the skip and override lines from `${SESSION_PATH}/gates.log`, and the "Decisions changed"
sections of `architecture.md` (Phase 3) and `implementation-log.md` (Phase 4 onward).
The model performance from Step 8.6, if any, goes below the four-part block.

Print it as text in this same turn, BEFORE any AskUserQuestion call. AskUserQuestion stops
the turn, so the user must already be reading the report when the question appears under
it. Any question comes after the report, through AskUserQuestion where a step names one.

### Step 8.8: Worktree cleanup (if applicable)
Right after the summary, in the same turn. If worktree was created (WORKTREE_PATH is set),
CALL the AskUserQuestion tool with the four options below. Never ask it as a question in
the text instead: a question in prose gives the user no options to pick, and the cleanup
below runs on the option chosen.
  Use AskUserQuestion:
    question: "Feature complete. What should I do with the worktree?"
    header: "Cleanup"
    options:
      - label: "Create PR from worktree branch"
        description: "Push branch, create PR, keep worktree until merged"
      - label: "Merge locally and clean up"
        description: "Merge to current branch, remove worktree"
      - label: "Keep worktree for now"
        description: "Leave worktree and branch as-is"
      - label: "Discard everything"
        description: "Delete branch and worktree (requires confirmation)"

  Execute chosen option following dev:worktree-lifecycle Phase 6.

### Step 8.9: Announce the phase complete
Say in one line: **Phase 8 — complete**, naming `report.md`. There are no task-list tools;
the session files are the record.

## Quality Gate
Report generated with validation evidence.
Required artifact: ${SESSION_PATH}/report.md
