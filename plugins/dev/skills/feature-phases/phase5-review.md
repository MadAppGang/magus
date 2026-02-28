# Phase 5: Code Review Loop

**Objective:** Multi-model code review with iteration until pass

**Iteration limit:** Read from ${SESSION_PATH}/iteration-config.json (default: 3)

## Steps

### Step 5.1: Mark phase as in_progress
TaskUpdate(taskId: {phase5_task_id}, status: "in_progress")

### Step 5.2: Read iteration config
```bash
code_review_limit=$(cat ${SESSION_PATH}/iteration-config.json | jq -r '.innerLoops.codeReview')
```

### Step 5.3: Prepare code diff
```bash
git diff > ${SESSION_PATH}/code-changes.diff
```

### Step 5.4: Read model selection from config (P1b — NO RE-ASKING)

Read model selection from ${SESSION_PATH}/iteration-config.json:
```bash
selected_models=$(cat ${SESSION_PATH}/iteration-config.json | jq '.selectedModels')
```

Use same models as Phase 3 (already configured in Step 1f).
Display: "Code review using same models as plan review: {model list}"

If selectedModels.models is empty: internal Claude only (no external models).

### Step 5.5: Launch parallel reviews
Launch PARALLEL reviews (single message, multiple Tasks):

Task: reviewer
  Prompt: "Review code changes in ${SESSION_PATH}/code-changes.diff
           Focus on: security, performance, code quality, best practices
           Write review to ${SESSION_PATH}/reviews/code-review/claude-internal.md
           Return brief summary"
---
Bash: claudish --model {model1} --stdin --quiet < ${SESSION_PATH}/reviews/code-review/prompt.md > ${SESSION_PATH}/reviews/code-review/{model1-slug}.md
---
... (for each configured model from selectedModels.models)

### Step 5.6: Consolidate reviews
Consolidate reviews with consensus analysis:
- Read all review files
- Apply consensus (unanimous, strong, majority, divergent)
- Prioritize by consensus level and severity
- Write ${SESSION_PATH}/reviews/code-review/consolidated.md

### Step 5.7: Determine verdict
- PASS: 0 CRITICAL, less than 3 HIGH
- CONDITIONAL: 0 CRITICAL, 3-5 HIGH
- FAIL: 1+ CRITICAL OR 6+ HIGH

### Step 5.8: Review loop
Review Loop (max code_review_limit iterations):

If CONDITIONAL or FAIL:
  a. Delegate fixes to developer agent
  b. Re-generate git diff
  c. Re-launch parallel reviews
  d. Re-consolidate
  e. Re-check verdict
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

### Step 5.9: Mark phase as completed
TaskUpdate(taskId: {phase5_task_id}, status: "completed")

## Quality Gate
Review verdict PASS or CONDITIONAL with user approval.
Required artifact: ${SESSION_PATH}/reviews/code-review/consolidated.md (with verdict)
