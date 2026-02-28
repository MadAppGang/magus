# Phase 4: Implementation

**Objective:** Implement feature across all stack layers

**Iteration limit:** 2 fix attempts per implementation phase

## Steps

### Step 4.1: Mark phase as in_progress
TaskUpdate(taskId: {phase4_task_id}, status: "in_progress")

### Step 4.2: Read architecture
Read implementation phases from ${SESSION_PATH}/architecture.md

### Step 4.3: Read detected stack
Read detected stack from ${SESSION_PATH}/context.json

### Step 4.4: Check for outer loop feedback
If outer_iteration > 1:
  Read previous validation feedback from ${SESSION_PATH}/validation/feedback-iteration-{N-1}.md
  Focus implementation on fixing identified issues

### Step 4.5: Implement all phases

For each implementation phase in architecture:

a. Determine if phases are independent or dependent:
   - Independent: Can run in parallel (different components/layers)
   - Dependent: Must run sequentially (one depends on another)

b. If independent phases:
   Launch in PARALLEL (single message, multiple Tasks):

   Task: developer
     Prompt: "SESSION_PATH: ${SESSION_PATH}

              Read architecture: ${SESSION_PATH}/architecture.md
              Read context: ${SESSION_PATH}/context.json

              **DISCOVERED PROJECT SKILLS** (read first - project patterns):
              {for each skill in context.discovered_skills where auto_loaded == true}
              - {skill.path} ({skill.name})
              {end}

              **BUNDLED SKILLS** (fallback):
              {for each path in context.bundled_skill_paths}
              - {path}
              {end}

              **FULL SKILL CATALOG** (invoke as needed):
              Available: {context.discovered_skills.names}
              Use Skill tool to load on-demand.

              {If outer_iteration > 1}
              PREVIOUS VALIDATION FAILED:
              {feedback from previous iteration}
              Focus on fixing these specific issues.
              {/If}

              Implement phase: {phase_name}
              PRIORITY: Follow discovered project patterns first.
              Run quality checks before completing.

              Log progress to ${SESSION_PATH}/implementation-log.md
              Return brief summary (max 3 lines)"
   ---
   Task: developer
     ... (for each parallel phase)

c. If dependent phases:
   Launch sequentially, waiting for each to complete

d. After each phase:
   - Verify quality checks passed
   - If failed: Delegate fix (max 2 attempts)
   - If still failing: Escalate to user

### Step 4.6: Track implementation progress
Track all progress in ${SESSION_PATH}/implementation-log.md:
- Phase name
- Start/end time
- Files created/modified
- Quality check results
- Issues encountered
- Outer loop iteration number

### Step 4.7: Mark phase as completed
TaskUpdate(taskId: {phase4_task_id}, status: "completed")

## Quality Gate
All stacks implemented, quality checks pass
