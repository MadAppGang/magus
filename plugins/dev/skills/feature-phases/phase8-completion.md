# Phase 8: Completion

**Objective:** Generate comprehensive report (only after Phase 7 passes)

## Steps

### Step 8.1: Mark phase as in_progress
TaskUpdate(taskId: {phase8_task_id}, status: "in_progress")

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
- Known issues (if any)
- Recommendations for next steps

### Step 8.5: Update session-meta.json
Update ${SESSION_PATH}/session-meta.json:
- Set status: "completed"
- Add completion timestamp
- Record outer loop iterations used
- Update checkpoint to final phase

### Step 8.6: Display model performance (if multi-model)
If multi-model validation was used:
- Display model performance statistics table
- Show historical performance (from ai-docs/llm-performance.json)
- Provide recommendations for future sessions

### Step 8.7: Worktree cleanup (if applicable)
If worktree was created (WORKTREE_PATH is set):
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

### Step 8.8: Present final summary
Present comprehensive summary to user (see completion_message template in feature.md).

### Step 8.9: Mark all tasks as completed
Mark ALL task items as completed.

## Quality Gate
Report generated with validation evidence.
Required artifact: ${SESSION_PATH}/report.md
