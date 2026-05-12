---
name: help
description: "Quick-reference for the Conductor context-driven development CLI — lists all five skills (setup, new-track, implement, status, revert), shows the conductor/ directory layout, and explains the Quick Start workflow with validation checkpoints. Use when the user asks for help with Conductor, wants to list available conductor commands, needs usage examples, or asks how the conductor workflow operates."
version: 1.0.0
tags: [conductor, help, documentation, guide]
user-invocable: false
---

# Conductor Help

Conductor is a context-driven development system for Claude Code. It stores project context (goals, tech stack, workflow) alongside code, enforces spec-before-code planning, and links every commit to a tracked task.

## Available Skills

### conductor:setup
Initialize Conductor for a project. Creates the `conductor/` directory with `product.md`, `tech-stack.md`, `workflow.md`, and code style guides through interactive Q&A. Supports resume if interrupted.

See [setup SKILL](../setup/SKILL.md) for full details.

### conductor:new-track
Create a development track (feature, bugfix, refactor). Generates `spec.md` (requirements) and `plan.md` (hierarchical phases → tasks → subtasks), then updates `tracks.md`.

See [new-track SKILL](../new-track/SKILL.md) for full details.

### conductor:implement
Execute tasks from a plan. Progresses status markers: `[ ]` → `[~]` → `[x]`. Each task produces at least one git commit tagged with the track ID. Follows `workflow.md` procedures.

### conductor:status
Show project progress — overall completion percentage, current task, blockers, and multi-track overview.

### conductor:revert
Git-aware logical undo at track, phase, or task level. Previews impact, creates revert commits (preserves history), and validates `plan.md` consistency afterward.

See [revert SKILL](../revert/SKILL.md) for full details.

## Quick Start

1. **Initialize:** `conductor:setup` → verify `conductor/` directory exists with `product.md`, `tech-stack.md`, `workflow.md`
2. **Plan:** `conductor:new-track` → verify `conductor/tracks/{track_id}/spec.md` and `plan.md` were created
3. **Implement:** `conductor:implement` → verify task status in `plan.md` changed to `[x]` and git commit exists
4. **Check:** `conductor:status` → review completion percentage and blockers
5. **Undo:** `conductor:revert` → verify reverted tasks show `[ ]` and revert commits exist

## Directory Structure

```
conductor/
├── product.md          # Project vision and goals
├── tech-stack.md       # Technical preferences
├── workflow.md         # Development procedures
├── tracks.md           # Index of all tracks
└── tracks/
    └── {track_id}/
        ├── spec.md     # Requirements specification
        ├── plan.md     # Hierarchical task plan
        └── metadata.json
```

## Best Practices

1. **Keep Context Updated:** Review `product.md` and `tech-stack.md` periodically
2. **One Task at a Time:** Complete tasks fully before moving on
3. **Commit Often:** Each task should produce at least one commit
4. **Use Blockers:** Mark tasks as `[!]` blocked rather than skipping silently
5. **Review Before Proceeding:** Use phase gates to verify quality

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Conductor not initialized" | Run `conductor:setup` to create the `conductor/` directory |
| "Track not found" | Check `tracks.md` for available tracks — IDs are case-sensitive |
| "Revert failed" | Commit or stash uncommitted changes before reverting |
