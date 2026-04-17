---
name: revert
description: "Performs git-aware logical undo of development work at track, phase, or task granularity with impact preview and confirmation gates. Creates revert commits while preserving history, then validates plan.md consistency. Use when the user asks to undo, roll back, or revert completed work from a Conductor track, phase, or task."
version: 1.0.0
tags: [conductor, revert, undo, git, rollback]
user-invocable: false
---

## Workflow

Track the revert using these 5 phases. Mark each "in_progress" when starting, "completed" when done. Only one phase active at a time.

### Phase 1 — Scope Selection

- Ask what to revert: Track, Phase, or Task
- Narrow down: which track, which phase, or which task

### Phase 2 — Impact Analysis

- Read metadata.json to find related commits
- List all commits, affected files, and plan.md status changes

### Phase 3 — User Confirmation

- Present the impact preview (see template below)
- Require explicit approval before proceeding
- If declined, abort with no changes

### Phase 4 — Execution

- Create revert commits for each original commit
- Update plan.md statuses back to `[ ]`
- Update metadata.json to reflect the revert

### Phase 5 — Validation

- Verify plan.md matches git state
- Verify metadata.json is consistent
- Run project quality checks and report results

## Critical Constraints

- **Confirmation required**: Always get explicit user confirmation before reverting commits, modifying plan.md, or deleting track files. Show exactly what will change first.
- **Non-destructive default**: Create revert commits, not force pushes. Preserve git history unless the user explicitly requests otherwise.
- **Graceful degradation**: If full revert fails, offer partial revert options. Never leave the project in an inconsistent state.
- **Logical grouping**: Revert by logical units (track/phase/task), not raw commits. A task may have multiple commits — revert them together.

## Revert Levels

**Task** — Reverts a single task's commits. Updates that task to `[ ]`. Preserves other tasks in the phase.

**Phase** — Reverts all tasks in a phase. Resets all their statuses to `[ ]`. Preserves other phases.

**Track** — Reverts the entire track. Optionally deletes track files. Updates tracks.md index.

## Commit Identification

Find commits for a task using:
1. `metadata.json` commit array
2. Git log searching for `[{track_id}]` pattern
3. Git notes with task references

## Revert Strategies

**Safe revert (default)** — Creates revert commits. Preserves full history. Can be undone.

**Hard reset (requires explicit request)** — Resets branch to before commits. Loses history unless pushed. Cannot be easily undone.

## Examples

**Revert single task** — User says "Undo task 2.3":
1. Identify the track containing task 2.3
2. Find commits from metadata.json
3. Show impact: "Will revert 2 commits: abc123 Implement login form, def456 Add login validation. Files: src/login.tsx, src/auth.ts"
4. Get confirmation, create revert commits
5. Update plan.md (2.3 `[x]` → `[ ]`) and metadata.json, then validate

**Revert entire phase** — User says "Roll back Phase 2 of auth feature":
1. Find all Phase 2 tasks and their commits
2. Show impact: "Will revert 8 commits across 5 tasks affecting 12 files"
3. Get confirmation, create revert commits in reverse order
4. Reset all Phase 2 statuses to `[ ]`, update metadata.json, validate

## Impact Preview Template

```
## Revert Impact Analysis

**Scope:** {Task/Phase/Track} {identifier}
**Commits to Revert:** {N}
- {short_sha}: {message}

**Files Affected:** {N}
- {filepath}

**Status Changes in plan.md:**
- {task_id}: [x] -> [ ]

**WARNING:** This will create {N} revert commits. Git history will be preserved.

Proceed with revert? [Yes/No]
```

## Completion Template

```
## Revert Complete

**Reverted:** {scope} {identifier}
**Commits Created:** {N} revert commits
**Tasks Reset:** {N} tasks now pending

**Validation:**
- Plan.md: Consistent
- Git State: Clean
- Quality Checks: PASS
```
