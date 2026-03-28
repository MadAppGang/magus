---
name: task-management
description: "Use when orchestrating multi-phase workflows to manage Claude Code Tasks with optional GTD plugin integration for cross-session persistence. Covers phase tracking, stale task cleanup, and GTD-aware workflow patterns."
keywords: [task-management, tasks, gtd, workflow, phase-tracking, persistence, cross-session, cleanup]
created: 2026-03-21
updated: 2026-03-21
plugin: dev
type: discipline
user-invocable: false
---

# Task Management

**Purpose:** Manage Claude Code Tasks in multi-phase workflows, with optional GTD plugin integration for cross-session persistence.

## When to Use

Apply this skill whenever you run an orchestrator command that tracks workflow phases:
- `/dev:architect` — architecture design phases
- `/dev:dev` — feature implementation phases
- `/dev:debug` — debugging investigation phases
- `/dev:research` — research and synthesis phases
- `/dev:interview` — requirements elicitation phases
- `/dev:doc` — documentation workflow phases

## GTD Detection

Before creating phase tasks, check if the GTD plugin is installed:

```bash
[ -f ".claude/gtd/tasks.json" ] && echo "GTD_ACTIVE" || echo "GTD_INACTIVE"
```

Route to the appropriate workflow section based on the result.

---

## GTD-Aware Workflow (when GTD is active)

### At Workflow Start

The GTD plugin hooks intercept all TaskCreate calls and auto-sync tasks to `.claude/gtd/tasks.json`. When there is an active GTD task (set via `/gtd:work <task-id>`), every phase task you create is automatically linked as a subtask — no manual metadata needed.

**Recommended opening sequence:**

1. Check for an existing active GTD task by reading the session context or asking the user.
2. If no active task is set, suggest: "Run `/gtd:work <topic>` to link these phase tasks as subtasks of a GTD project. This makes them persist across sessions."
3. If the user already has an active GTD task, inform them: "Phase tasks will auto-link as subtasks of your active GTD task. The hooks handle sync automatically."

**Note:** You do not need to set `gtdParent` metadata manually. The `PreToolUse(TaskCreate)` hook injects it when an active task exists.

### During Workflow

- Create and update phase tasks normally using TaskCreate/TaskUpdate/TaskList/TaskGet.
- The hooks sync status changes (completed, deleted, in_progress) back to the GTD store automatically.
- Tasks with a GTD parent go to the `next` list; tasks without one go to `inbox`.

### At Workflow End

Offer to capture outcomes as GTD next actions:
- "Want me to capture next steps as GTD tasks? Run `/gtd:capture` to add follow-up actions."
- If the architecture/design produced actionable items, suggest creating them via `/gtd:capture`.

### Cross-Session Resume

When resuming a session, the GTD `SessionStart` hook displays the active task and its subtask state. You do not need `CLAUDE_CODE_TASK_LIST_ID` or any environment variable — the GTD file store handles persistence.

---

## Fallback Workflow (when GTD is not installed)

Use native TaskCreate/TaskUpdate for session-scoped phase tracking. Tasks are ephemeral and exist only for the current session.

**Best practices without GTD:**

- Follow the Phase Task Patterns section below for creating and updating tasks.
- Refer to `multimodel:task-orchestration` patterns for multi-agent coordination.
- Suggest to the user at workflow end: "Install the GTD plugin (`/plugin marketplace add MadAppGang/magus` then enable `gtd@magus`) for persistent cross-session task tracking."

---

## Session Hygiene

Before creating phase tasks for the current workflow, check for stale tasks from previous workflows:

```
TaskList → review any pending or in_progress tasks
```

**If stale tasks exist** (pending or in_progress but clearly from a different workflow):

1. Inform the user: "Found stale tasks from a previous workflow: [list subjects]. Clean them up?"
2. If confirmed, delete stale tasks with `TaskUpdate { status: "deleted" }`.
3. Then create fresh phase tasks for the current workflow.

**Heuristic for identifying stale tasks:** Tasks whose subjects reference a different feature, system, or topic than the current request are likely stale. When in doubt, ask the user.

---

## Phase Task Patterns

### Creation Rules

- Create ALL phase tasks upfront before starting work on any phase.
- Use descriptive subjects in imperative form: `"PHASE {N}: {action verb} {object}"`
  - Examples: `"PHASE 0: Triage complexity"`, `"PHASE 3: Analyze trade-offs"`
- Set `activeForm` for the spinner: `"{action}ing {object}"`
  - Examples: `"Triaging complexity"`, `"Analyzing trade-offs"`
- Mark exactly ONE task `in_progress` at a time.
- Mark tasks `completed` immediately after finishing each phase — do not batch.

### Parallel Work Exception

When running parallel sub-agents (e.g., multi-model review in Phase 6 of architect), multiple tasks may be `in_progress` simultaneously. This is the intended exception to the one-in-progress rule.

### Standard Phase Subjects

For `/dev:architect`:
```
PHASE 0: Triage complexity
PHASE 1: Initialize session
PHASE 2: Plan mode reasoning      (conditional: moderate/complex only)
PHASE 3: Analyze requirements
PHASE 4: Generate alternatives
PHASE 5: Analyze trade-offs
PHASE 6: Create detailed design
PHASE 7: Validate architecture    (optional)
PHASE 8: Finalize documentation
```

Adapt phase names to match the actual workflow being executed.

### Update Lifecycle

```
pending → in_progress → completed
```

- Set `in_progress` BEFORE starting any work on a phase.
- Set `completed` AFTER all steps in a phase are done.
- Use `deleted` for phases that are skipped or no longer applicable (e.g., Plan Mode phase for a simple problem).

---

## Quick Reference

| Situation | Action |
|-----------|--------|
| Starting workflow, GTD active, no active task | Suggest `/gtd:work <topic>` |
| Starting workflow, GTD active, active task set | Inform: subtasks will auto-link |
| Starting workflow, GTD inactive | Use native tasks; suggest GTD install |
| Stale tasks found in TaskList | Offer to delete; create fresh ones |
| Phase complete | Immediately mark `completed` |
| Parallel agents running | Allow multiple `in_progress` |
| Workflow complete, GTD active | Offer `/gtd:capture` for next actions |

## Integration with Other Skills

- **agent-coordination-discipline:** Multi-agent phases may have simultaneous in_progress tasks.
- **worktree-lifecycle:** Worktree creation and teardown are discrete phases; track each as a task.
- **verification-before-completion:** The final phase task should not be marked completed until all verification gates pass.
