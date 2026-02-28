# Phase 3: Multi-Model Planning

**Objective:** Design architecture with multi-model validation

**Iteration limit:** Read from ${SESSION_PATH}/iteration-config.json (default: 2)

## Steps

### Step 3.1: Mark phase as in_progress
TaskUpdate(taskId: {phase3_task_id}, status: "in_progress")

### Step 3.2: Read iteration config
```bash
plan_revision_limit=$(cat ${SESSION_PATH}/iteration-config.json | jq -r '.innerLoops.planRevision')
```

### Step 3.3: Check for outer loop feedback
If outer_iteration > 1:
  Read previous validation feedback from ${SESSION_PATH}/validation/feedback-iteration-{N-1}.md
  Include in architect prompt: "Previous validation failed: {feedback}"

### Step 3.4: Launch stack-detector agent
Prompt: "SESSION_PATH: ${SESSION_PATH}

         Detect ALL technology stacks AND discover real project skills.

         1. Detect stacks from config files (package.json, go.mod, etc.)
         2. **DISCOVER REAL SKILLS** in:
            - .claude/skills/**/SKILL.md
            - Enabled plugins from .claude/settings.json
            - .claude-plugin/*/skills/**/SKILL.md

         3. Auto-load skills matching feature keywords:
            - Parse ${SESSION_PATH}/requirements.md for keywords
            - Match to discovered skill categories

         Save to ${SESSION_PATH}/context.json with:
         - detected_stack
         - discovered_skills (name, description, path, source, categories)
         - bundled_skill_paths"
Output: ${SESSION_PATH}/context.json

### Step 3.5: Read context and display discovered skills
Read ${SESSION_PATH}/context.json and identify auto-loaded skills.
Display to orchestrator:
```
Discovered Skills ({count}):
{for each skill}
- {name} ({source}) - {description}
  Auto-loaded: {if matches feature keywords}
{end}
```

### Step 3.6: Launch architect agent
Prompt: "SESSION_PATH: ${SESSION_PATH}

         Read requirements: ${SESSION_PATH}/requirements.md
         Read research: ${SESSION_PATH}/research.md (if exists)
         Read context: ${SESSION_PATH}/context.json
         Read validation criteria: ${SESSION_PATH}/validation-criteria.md

         **DISCOVERED PROJECT SKILLS** (read these first - project-specific patterns):
         {for each skill in context.discovered_skills where auto_loaded == true}
         - {skill.path} ({skill.name} - {skill.description})
         {end}

         **BUNDLED SKILLS** (fallback patterns):
         {for each path in context.bundled_skill_paths}
         - {path}
         {end}

         {If outer_iteration > 1}
         PREVIOUS VALIDATION FAILED:
         {feedback from previous iteration}

         Fix the issues identified above.
         {/If}

         Design architecture for this feature.
         **Priority**: Follow discovered skill patterns first, then bundled skills.

         Include: component structure, data flow, API contracts,
         database schema (if applicable), testing strategy, implementation phases.

         Write to ${SESSION_PATH}/architecture.md
         Return brief summary (max 3 lines)"

### Step 3.7: Multi-model plan review (P1b — READ FROM CONFIG, NO RE-ASKING)

Read model selection from ${SESSION_PATH}/iteration-config.json:
```bash
selected_models=$(cat ${SESSION_PATH}/iteration-config.json | jq '.selectedModels')
```

If selectedModels.configured = true and selectedModels.models is non-empty:
  Display: "Using pre-configured models: {model list}"

  a. Write plan review prompt to ${SESSION_PATH}/reviews/plan-review/prompt.md

  b. Launch PARALLEL plan reviews (SINGLE message, multiple Tasks):

     Task: architect
       Prompt: "Review ${SESSION_PATH}/architecture.md for issues.
                Write review to ${SESSION_PATH}/reviews/plan-review/claude-internal.md
                Return brief summary"
     ---
     Bash: claudish --model {model1} --stdin --quiet < ${SESSION_PATH}/reviews/plan-review/prompt.md > ${SESSION_PATH}/reviews/plan-review/{model1-slug}.md
     ---
     Bash: claudish --model {model2} --stdin --quiet < ${SESSION_PATH}/reviews/plan-review/prompt.md > ${SESSION_PATH}/reviews/plan-review/{model2-slug}.md
     ---
     ... (for each configured model)

  c. Wait for all reviews to complete

  d. Consolidate reviews with blinded voting:
     - Read all review files
     - Apply consensus analysis (unanimous, strong, majority, divergent)
     - Prioritize issues by consensus and severity
     - Write ${SESSION_PATH}/reviews/plan-review/consolidated.md

  e. If CRITICAL issues found:
     - Launch architect to revise plan
     - Re-review (max plan_revision_limit iterations total)
     - If still critical after limit: Escalate to user

If selectedModels.configured = false OR models is empty:
  Show warning: "No external models configured. Review will use internal Claude only."
  Launch architect for internal review only:
  Task: architect
    Prompt: "Review ${SESSION_PATH}/architecture.md for issues.
             Write review to ${SESSION_PATH}/reviews/plan-review/claude-internal.md
             Also write to ${SESSION_PATH}/reviews/plan-review/consolidated.md
             Return brief summary"

### Step 3.8: User Approval Gate
Use AskUserQuestion to present architecture summary with consensus analysis (if multi-model).
Options:
1. Approve plan and proceed
2. Request specific changes
3. Cancel feature development

### Step 3.9: Mark phase as completed
TaskUpdate(taskId: {phase3_task_id}, status: "completed")

## Quality Gate
Plan approved by consensus AND user.
Required artifacts:
- ${SESSION_PATH}/architecture.md
- ${SESSION_PATH}/reviews/plan-review/consolidated.md
- ${SESSION_PATH}/reviews/plan-review/claude-internal.md
