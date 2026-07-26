---
name: new-track
description: "Creates a new development track with a requirements spec and hierarchical implementation plan through interactive Q&A. Reads project context from product.md and tech-stack.md to generate actionable phases, tasks, and subtasks. Use when the user asks to plan a new feature, create a bugfix track, start a refactoring effort, or set up a new development workstream."
version: 1.0.0
tags: [conductor, track, planning, spec, phases]
user-invocable: false
---

# New Track

Create a structured development track by gathering requirements through interactive Q&A, then generating a spec and hierarchical plan.

## Prerequisites

Before starting, verify `conductor/` directory exists with required files: `product.md`, `tech-stack.md`, `workflow.md`. If missing, halt and guide the user to run `conductor:setup` first.

## Context Loading

Always read before planning:
- `conductor/product.md` — project goals
- `conductor/tech-stack.md` — technical constraints
- `conductor/tracks.md` — existing tracks

## Workflow

### Phase 1: Track Type

1. Ask: What type of work? (Feature, Bugfix, Refactor, Task)
2. Ask: Short name for this track? (3-10 chars, lowercase)
3. Generate track ID: `{type}_{shortname}_{YYYYMMDD}` (e.g. `feature_auth_20260105`)

### Phase 2: Spec Generation

1. Ask: What is the goal? (1-2 sentences)
2. Ask: Acceptance criteria? (3-5 items)
3. Ask: Technical constraints or dependencies?
4. Ask: Edge cases or error scenarios?
5. Generate `conductor/tracks/{track_id}/spec.md`

### Phase 3: Plan Generation

1. Based on spec, propose 2-6 phases
2. Ask user to confirm or modify phases
3. For each phase, generate 2-5 tasks with optional subtasks (0-3 per task)
4. Generate `conductor/tracks/{track_id}/plan.md`

### Phase 4: Finalization

1. Create `conductor/tracks/{track_id}/metadata.json`
2. Update `conductor/tracks.md` with the new track
3. Present completion summary

## Core Principles

- **Spec before plan**: Create spec.md first (defines WHAT), then plan.md (defines HOW)
- **Hierarchical plans**: 2-6 phases, 2-5 tasks per phase, 0-3 subtasks per task
- **Actionable tasks**: Each task must be specific (clear outcome), estimable (1-4 hours), and independent (minimal dependencies)

## Track Types

| Type | Scope | Typical Phases | Notes |
|------|-------|----------------|-------|
| Feature | Large | 4-6 | Includes testing and documentation phases |
| Bugfix | Small | 2-3 | Includes reproduction and verification phases |
| Refactor | Medium | 3-4 | Includes before/after comparison phase |
| Task | Variable | Flexible | General work item |

## Spec Template

```markdown
# Spec: {Track Title}

Track ID: {track_id}
Type: {Feature/Bugfix/Refactor/Task}
Created: {YYYY-MM-DD}

## Goal
{1-2 sentence description of what this achieves}

## Background
{Context from product.md relevant to this work}

## Acceptance Criteria
- [ ] {Criterion 1}
- [ ] {Criterion 2}
- [ ] {Criterion 3}

## Technical Constraints
- {Constraint from tech-stack.md}

## Edge Cases
- {Edge case 1}

## Out of Scope
- {What this track does NOT include}
```

## Plan Template

```markdown
# Plan: {Track Title}

Track ID: {track_id}
Type: {Feature/Bugfix/Refactor/Task}
Created: {YYYY-MM-DD}
Status: Active

## Phase 1: {Phase Name}
- [ ] 1.1 {Task description}
- [ ] 1.2 {Task description}
  - [ ] 1.2.1 {Subtask}
  - [ ] 1.2.2 {Subtask}
- [ ] 1.3 {Task description}

## Phase 2: {Phase Name}
- [ ] 2.1 {Task description}
- [ ] 2.2 {Task description}
```

## Examples

**Feature track** — User says "I want to add user authentication":
1. Track type: Feature, short name: "auth", ID: `feature_auth_20260105`
2. Gather spec (goal, criteria, constraints) → generate spec.md
3. Propose phases: Database, Core Auth, Sessions, Testing → generate plan.md
4. Update tracks.md index

**Bugfix track** — User says "Login page keeps redirecting in a loop":
1. Track type: Bugfix, short name: "login-loop", ID: `bugfix_login-loop_20260105`
2. Spec: reproduction steps, root cause, fix approach
3. Plan phases: Reproduce → Fix → Verify
4. Generate files and update index

## Completion Template

```
## Track Created Successfully

**Track ID:** {track_id}
**Type:** {type}

**Files Created:**
- conductor/tracks/{track_id}/spec.md
- conductor/tracks/{track_id}/plan.md
- conductor/tracks/{track_id}/metadata.json

**Plan Summary:**
- Phase 1: {name} ({N} tasks)
- Phase 2: {name} ({N} tasks)
- Total: {X} phases, {Y} tasks

**Next Steps:**
1. Review spec.md and plan.md
2. Adjust if needed
3. Run `conductor:implement` to start executing
```
