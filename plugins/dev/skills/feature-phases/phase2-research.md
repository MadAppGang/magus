# Phase 2: Research (Optional)

**Objective:** Gather external information if needed

## Steps

### Step 2.1: Mark phase as in_progress
TaskUpdate(taskId: {phase2_task_id}, status: "in_progress")

### Step 2.2: Analyze requirements for research needs
- External APIs or libraries
- Design patterns for similar features
- Performance benchmarks
- Security best practices
- Technology compatibility

### Step 2.3: Research (conditional)

If research needed:
  a. Ask user (AskUserQuestion): "Would you like me to research [topics]?"
  b. If yes: Identify specific questions to research
  c. Gather information (via available tools)
  d. Write ${SESSION_PATH}/research.md with findings

If not needed:
  a. Skip this phase
  b. Log: "Research phase skipped - no external dependencies"

### Step 2.4: Mark phase as completed
TaskUpdate(taskId: {phase2_task_id}, status: "completed")

## Quality Gate
Research complete or explicitly skipped
