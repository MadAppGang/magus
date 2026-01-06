# Conductor Plugin: Skill-to-Command Conversion Design

**Session:** agentdev-conductor-commands-20260106-101125-a2c3
**Date:** 2026-01-06
**Status:** Design Document

---

## Executive Summary

This document provides a comprehensive design for converting the Conductor plugin's 6 skills into proper commands. The conversion will enable `/conductor:` autocomplete functionality in Claude Code.

### Skills to Convert

| Skill | Size | Purpose | Command Name |
|-------|------|---------|--------------|
| `setup` | 8202 bytes | Initialize Conductor for project | `/conductor:setup` |
| `new-track` | 7712 bytes | Plan new features/tracks | `/conductor:new-track` |
| `implement` | 14149 bytes | Execute planned tracks | `/conductor:implement` |
| `status` | 5132 bytes | Check track status | `/conductor:status` |
| `revert` | 7456 bytes | Revert to previous state | `/conductor:revert` |
| `help` | 3260 bytes | Show help information | `/conductor:help` |

---

## Plugin.json Updates Required

### Current Structure
```json
{
  "name": "conductor",
  "version": "1.1.0",
  "skills": [
    "setup",
    "new-track",
    "implement",
    "status",
    "revert",
    "help"
  ]
}
```

### Target Structure
```json
{
  "name": "conductor",
  "version": "2.0.0",
  "commands": [
    "setup",
    "new-track",
    "implement",
    "status",
    "revert",
    "help"
  ],
  "skills": [],
  "dependencies": []
}
```

---

## Command Format Standards

### YAML Frontmatter Schema (Commands)

```yaml
---
description: |
  Multi-line description of what this command does.
  Include workflow overview: PHASE 1 -> PHASE 2 -> PHASE 3
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
skills: skill1, skill2  # Optional: referenced skills
---
```

### Key Differences from Skills

| Aspect | Skill | Command |
|--------|-------|---------|
| Frontmatter | `name`, `description`, `version`, `tags`, `keywords` | `description`, `allowed-tools`, `skills` |
| Location | `skills/{name}/SKILL.md` | `commands/{name}.md` |
| Invocation | Referenced by agents | User-invoked via `/plugin:command` |
| Tools | Depends on agent | Declared in `allowed-tools` |

---

## Command Designs

### 1. /conductor:setup

**File:** `commands/setup.md`

```yaml
---
description: |
  Initialize Conductor for your project through interactive Q&A.
  Workflow: VALIDATE -> PROJECT TYPE -> PRODUCT CONTEXT -> TECH CONTEXT -> GUIDELINES -> FINALIZE
  Creates conductor/ directory with product.md, tech-stack.md, workflow.md, and styleguides.
  Supports resume capability and both Greenfield/Brownfield projects.
allowed-tools: AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
---
```

**Role:**
```xml
<role>
  <identity>Project Context Architect</identity>
  <expertise>
    - Project initialization and context gathering
    - Interactive Q&A for requirements elicitation
    - State management and resume capability
    - Greenfield vs Brownfield project handling
  </expertise>
  <mission>
    Guide users through structured project initialization, creating
    comprehensive context artifacts that serve as the foundation for
    all future development work.
  </mission>
</role>
```

**Critical Constraints:**
- TodoWrite REQUIRED for tracking 6 setup phases
- Single question flow (never ask multiple questions at once)
- State persistence (save progress after each answer)
- Resume capability (check setup_state.json first)
- Validation first (check existing conductor/ before proceeding)

**Workflow Phases:**
1. **Validation** - Check existing conductor/, resume state
2. **Project Type Detection** - Greenfield vs Brownfield
3. **Product Context** - Project goals, audience, requirements
4. **Technical Context** - Languages, frameworks, databases
5. **Guidelines** - Coding conventions, testing requirements
6. **Finalization** - Create workflow.md, tracks.md

**Tools Needed:**
- `AskUserQuestion` - Interactive Q&A
- `Read` - Check existing files
- `Write` - Create artifacts
- `Bash` - Check directory structure
- `TodoWrite` - Track progress
- `Glob`, `Grep` - Scan existing code (Brownfield)

---

### 2. /conductor:new-track

**File:** `commands/new-track.md`

```yaml
---
description: |
  Create a new development track with spec and plan.
  Workflow: VALIDATE CONDUCTOR -> LOAD CONTEXT -> DETERMINE TYPE -> GENERATE SPEC -> GENERATE PLAN -> FINALIZE
  Supports Feature, Bugfix, Refactor, and Task types with hierarchical plans (phases -> tasks -> subtasks).
allowed-tools: AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
---
```

**Role:**
```xml
<role>
  <identity>Development Planner & Spec Writer</identity>
  <expertise>
    - Requirements elicitation and specification
    - Hierarchical plan creation (phases/tasks/subtasks)
    - Track lifecycle management
    - Context-aware planning (reads product.md, tech-stack.md)
  </expertise>
  <mission>
    Transform user requirements into structured, actionable development
    plans with clear phases, tasks, and subtasks that enable systematic
    implementation.
  </mission>
</role>
```

**Critical Constraints:**
- MUST validate conductor/ exists with required files FIRST
- Context awareness - ALWAYS read product.md, tech-stack.md before planning
- Spec before plan - Create spec.md BEFORE plan.md
- Hierarchical plans: 2-6 phases, 2-5 tasks per phase, 0-3 subtasks
- Track ID format: `{type}_{shortname}_{YYYYMMDD}`

**Workflow Phases:**
1. **Validation** - Check conductor/ exists
2. **Context Loading** - Read product.md, tech-stack.md, tracks.md
3. **Track Type** - Ask type (Feature/Bugfix/Refactor/Task)
4. **Spec Generation** - Q&A for goals, criteria, constraints
5. **Plan Generation** - Propose phases, generate tasks
6. **Finalization** - Create metadata.json, update tracks.md

**Tools Needed:**
- `AskUserQuestion` - Interactive Q&A
- `Read` - Load context files
- `Write` - Create spec.md, plan.md, metadata.json
- `Bash` - Directory operations
- `TodoWrite` - Track progress
- `Glob`, `Grep` - Scan existing tracks

---

### 3. /conductor:implement

**File:** `commands/implement.md`

```yaml
---
description: |
  Execute tasks from a track's plan.md with TDD workflow.
  Workflow: VALIDATE -> SELECT TASK -> TDD (RED/GREEN/REFACTOR) -> QUALITY & COMMIT -> PHASE CHECK
  Updates task status: [ ] pending -> [~] in progress -> [x] complete.
  Creates git commits linked to track/phase/task with git notes.
allowed-tools: AskUserQuestion, Bash, Read, Write, Edit, TodoWrite, Glob, Grep
---
```

**Role:**
```xml
<role>
  <identity>Implementation Guide & Progress Tracker</identity>
  <expertise>
    - Task execution and status management
    - TDD workflow (Red/Green/Refactor)
    - Git commit integration with track references
    - Git Notes for audit trail
    - Workflow.md procedure following
    - Phase Completion Verification Protocol
    - Progress tracking and reporting
  </expertise>
  <mission>
    Guide systematic implementation of track tasks using TDD methodology,
    maintaining clear status visibility, creating traceable git commits
    with notes, following established workflow procedures, and executing
    the Phase Completion Protocol at phase boundaries.
  </mission>
</role>
```

**Critical Constraints:**
- Status progression: `[ ]` -> `[~]` -> `[x]` (only ONE `[~]` at a time)
- TDD workflow mandatory: Red (failing tests) -> Green (pass) -> Refactor
- Git commit protocol: Proper type, message format, git notes
- Workflow adherence: Follow conductor/workflow.md procedures
- Human approval gates: Before new phase, when blocked, before marking complete
- Phase Completion Protocol: 10-step verification at phase boundaries

**TDD Workflow:**
```
Red Phase:
1. Create test file for the feature
2. Write tests defining expected behavior
3. Run tests - confirm they FAIL
4. Do NOT proceed until tests fail

Green Phase:
1. Write MINIMUM code to pass tests
2. Run tests - confirm they PASS
3. No refactoring yet

Refactor Phase:
1. Improve code clarity and performance
2. Remove duplication
3. Run tests - confirm they still PASS
```

**Git Commit Protocol:**
```
<type>(<scope>): <description>

- Detail 1
- Detail 2

Task: {phase}.{task}
```

**Git Notes Format:**
```
Task: {phase}.{task} - {task_title}

Summary: {what was accomplished}

Files Changed:
- {file1}: {description}
- {file2}: {description}

Why: {business reason for this change}
```

**Phase Completion Protocol (10 Steps):**
1. Announce Protocol Start
2. Ensure Test Coverage
3. Execute Automated Tests
4. Propose Manual Verification Plan
5. Await User Confirmation (PAUSE)
6. Create Checkpoint Commit
7. Attach Verification Report (git notes)
8. Update Plan with Checkpoint
9. Commit Plan Update
10. Announce Completion

**Tools Needed:**
- `AskUserQuestion` - Approval gates
- `Read` - Load plan.md, spec.md, workflow.md
- `Write` - Update plan.md, metadata.json
- `Edit` - Modify existing files
- `Bash` - Git commands, run tests
- `TodoWrite` - Mirror plan.md tasks
- `Glob`, `Grep` - Find files

---

### 4. /conductor:status

**File:** `commands/status.md`

```yaml
---
description: |
  Show Conductor status - active tracks, progress, current task, blockers.
  Read-only command that parses tracks.md and all plan.md files.
  Provides actionable "Next Action" recommendation.
allowed-tools: Bash, Read, Glob, Grep
---
```

**Role:**
```xml
<role>
  <identity>Progress Reporter & Status Analyzer</identity>
  <expertise>
    - Plan.md parsing and analysis
    - Progress calculation and visualization
    - Blocker identification
    - Multi-track overview
  </expertise>
  <mission>
    Provide clear, actionable status reports that help users understand
    their project progress, identify next actions, and spot blockers.
  </mission>
</role>
```

**Critical Constraints:**
- **NO TodoWrite** - This is a read-only skill
- **Read Only** - Does NOT modify any files
- Comprehensive scan - Parse ALL tracks.md and plan.md files
- Actionable output - Always end with "Next Action" recommendation
- Blocker visibility - Prominently display blocked tasks

**Workflow Phases:**
1. **Data Collection** - Check conductor/, read tracks.md, load all plan.md
2. **Analysis** - Count by status, calculate completion %, find blockers
3. **Presentation** - Display overview, per-track details, recommend next action

**Status Display Priority:**
1. BLOCKED tasks (need attention)
2. IN_PROGRESS tasks (current work)
3. Active tracks summary
4. Completed tracks (brief)

**Output Format:**
```markdown
## Conductor Status

### Overview
- Active Tracks: {N}
- Total Progress: {X}% ({completed}/{total} tasks)
- Blockers: {N}

### BLOCKERS
- **{track_id}** Task {task_id}: "{blocker_description}"

### Active Tracks
**{track_id}** - {title}
- Progress: [{progress_bar}] {percent}% ({completed}/{total})
- Phase: {current_phase}/{total_phases} - {phase_name}
- Current: {current_task_id} {current_task_title}

### Next Action
{recommendation}
```

**Tools Needed:**
- `Read` - Load conductor files
- `Bash` - Check directory structure
- `Glob` - Find all plan.md files
- `Grep` - Search for patterns

---

### 5. /conductor:revert

**File:** `commands/revert.md`

```yaml
---
description: |
  Git-aware logical undo for Conductor tracks.
  Workflow: SCOPE SELECTION -> IMPACT ANALYSIS -> USER CONFIRMATION -> EXECUTION -> VALIDATION
  Revert at Track, Phase, or Task level (not commit-by-commit).
  Creates revert commits and updates plan.md status.
allowed-tools: AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
---
```

**Role:**
```xml
<role>
  <identity>Safe Revert Specialist</identity>
  <expertise>
    - Git history analysis and reversal
    - Logical grouping of commits by track/phase/task
    - State validation after reversal
    - Safe rollback with confirmation gates
  </expertise>
  <mission>
    Enable safe, logical rollback of development work at meaningful
    granularity (track/phase/task) while maintaining git history integrity
    and project consistency.
  </mission>
</role>
```

**Critical Constraints:**
- TodoWrite REQUIRED for 5-phase workflow
- Confirmation REQUIRED before any revert
- Non-destructive default (create revert commits, not force-push)
- State validation after revert
- Logical grouping (revert by track/phase/task, not raw commits)
- Preview before action (show exactly what will be reverted)

**Revert Levels:**
- **Task Level:** Reverts single task's commits, updates status to `[ ]`
- **Phase Level:** Reverts all tasks in phase, preserves other phases
- **Track Level:** Reverts entire track, optionally deletes track files

**Workflow Phases:**
1. **Scope Selection** - Ask what to revert (Track/Phase/Task)
2. **Impact Analysis** - Find commits, files, status changes
3. **User Confirmation** - Present impact, get explicit approval
4. **Execution** - Create revert commits, update plan.md
5. **Validation** - Verify consistency, run quality checks

**Impact Preview Template:**
```markdown
## Revert Impact Analysis

**Scope:** {Task/Phase/Track} {identifier}

**Commits to Revert:** {N}
- {short_sha}: {message}

**Files Affected:** {N}
- {filepath}

**Status Changes in plan.md:**
- {task_id}: [x] -> [ ]

**WARNING:** This action will create {N} revert commits.
Git history will be preserved.

Proceed with revert? [Yes/No]
```

**Tools Needed:**
- `AskUserQuestion` - Confirmation gates
- `Read` - Load metadata.json, plan.md
- `Write` - Update plan.md
- `Bash` - Git commands (revert, notes)
- `TodoWrite` - Track progress
- `Glob`, `Grep` - Find commits

---

### 6. /conductor:help

**File:** `commands/help.md`

```yaml
---
description: |
  Display Conductor help, philosophy, available commands, and quick start guide.
  Shows directory structure and troubleshooting tips.
allowed-tools: Read, Glob
---
```

**Role:**
```xml
<role>
  <identity>Conductor Help Guide</identity>
  <expertise>
    - Conductor philosophy and methodology
    - Command documentation
    - Best practices guidance
    - Troubleshooting support
  </expertise>
  <mission>
    Provide clear, comprehensive help information that enables users
    to effectively use Conductor for Context-Driven Development.
  </mission>
</role>
```

**Critical Constraints:**
- **NO TodoWrite** - Simple informational command
- Read-only (no modifications)
- Minimal tools (just Read, Glob)

**Output Format:**
```markdown
# Conductor Help

Conductor implements Context-Driven Development for Claude Code.

## Philosophy

**Context as a Managed Artifact:**
Your project context (goals, tech stack, workflow) is documented and
maintained alongside your code. This context guides all development work.

**Pre-Implementation Planning:**
Before coding, create a spec (WHAT) and plan (HOW). This ensures clear
direction and traceable progress.

**Safe Iteration:**
Human approval gates at key points. Git-linked commits for traceability.
Easy rollback when needed.

## Available Commands

| Command | Description |
|---------|-------------|
| `/conductor:setup` | Initialize Conductor for your project |
| `/conductor:new-track` | Create a new development track |
| `/conductor:implement` | Execute tasks from your plan |
| `/conductor:status` | View project progress |
| `/conductor:revert` | Git-aware logical undo |
| `/conductor:help` | Show this help |

## Quick Start

1. **Initialize:** Run `/conductor:setup` to create context files
2. **Plan:** Run `/conductor:new-track` to create your first track
3. **Implement:** Run `/conductor:implement` to start working
4. **Check:** Run `/conductor:status` to see progress
5. **Undo:** Run `/conductor:revert` if you need to roll back

## Directory Structure

conductor/
|-- product.md          # Project vision and goals
|-- tech-stack.md       # Technical preferences
|-- workflow.md         # Development procedures
|-- tracks.md           # Index of all tracks
|-- code_styleguides/   # Coding style guides
    |-- general.md
    |-- typescript.md   # (if applicable)
    |-- python.md       # (if applicable)
|-- tracks/
    |-- {track_id}/
        |-- spec.md     # Requirements specification
        |-- plan.md     # Hierarchical task plan
        |-- metadata.json

## Best Practices

1. **Keep Context Updated:** Review product.md and tech-stack.md periodically
2. **One Task at a Time:** Focus on completing tasks fully before moving on
3. **Commit Often:** Each task should result in at least one commit
4. **Use Blockers:** Mark tasks as [!] blocked rather than skipping silently
5. **Review Before Proceeding:** Use phase gates to verify quality

## Troubleshooting

**"Conductor not initialized"**
Run `/conductor:setup` to initialize the conductor/ directory.

**"Track not found"**
Check tracks.md for available tracks. Track IDs are case-sensitive.

**"Revert failed"**
Check for uncommitted changes. Commit or stash before reverting.
```

---

## Directory Structure Changes

### Before (Skills)
```
plugins/conductor/
|-- plugin.json
|-- skills/
    |-- setup/
    |   |-- SKILL.md
    |-- new-track/
    |   |-- SKILL.md
    |-- implement/
    |   |-- SKILL.md
    |-- status/
    |   |-- SKILL.md
    |-- revert/
    |   |-- SKILL.md
    |-- help/
        |-- SKILL.md
```

### After (Commands)
```
plugins/conductor/
|-- plugin.json
|-- commands/
    |-- setup.md
    |-- new-track.md
    |-- implement.md
    |-- status.md
    |-- revert.md
    |-- help.md
```

---

## Implementation Checklist

### Phase 1: Create Commands Directory
- [ ] Create `plugins/conductor/commands/` directory
- [ ] Verify directory structure

### Phase 2: Convert Each Skill
- [ ] Convert `setup` skill to `commands/setup.md`
- [ ] Convert `new-track` skill to `commands/new-track.md`
- [ ] Convert `implement` skill to `commands/implement.md`
- [ ] Convert `status` skill to `commands/status.md`
- [ ] Convert `revert` skill to `commands/revert.md`
- [ ] Convert `help` skill to `commands/help.md`

### Phase 3: Update Plugin Manifest
- [ ] Update `plugin.json` to declare `commands` instead of `skills`
- [ ] Bump version to 2.0.0 (breaking change)

### Phase 4: Clean Up
- [ ] Remove `skills/` directory (after verification)
- [ ] Update any documentation references

### Phase 5: Test
- [ ] Verify `/conductor:` autocomplete works
- [ ] Test each command:
  - [ ] `/conductor:setup`
  - [ ] `/conductor:new-track`
  - [ ] `/conductor:implement`
  - [ ] `/conductor:status`
  - [ ] `/conductor:revert`
  - [ ] `/conductor:help`

---

## Tool Recommendations by Command

| Command | TodoWrite | AskUserQuestion | Write/Edit | Bash | Read | Glob/Grep |
|---------|-----------|-----------------|------------|------|------|-----------|
| setup | YES | YES | YES | YES | YES | YES |
| new-track | YES | YES | YES | YES | YES | YES |
| implement | YES | YES | YES | YES | YES | YES |
| status | NO | NO | NO | YES | YES | YES |
| revert | YES | YES | YES | YES | YES | YES |
| help | NO | NO | NO | NO | YES | YES |

---

## Key Design Decisions

### 1. TodoWrite Usage

- **Required for:** setup, new-track, implement, revert (multi-phase workflows)
- **Not required for:** status, help (simple, single-operation commands)

### 2. Interactive Q&A Pattern

Commands using `AskUserQuestion`:
- `setup` - Project type, product questions, tech questions
- `new-track` - Track type, spec questions, plan confirmation
- `implement` - Approval gates at phase boundaries
- `revert` - Confirmation before destructive operations

### 3. Write/Edit Permissions

- `setup`, `new-track` - Creates new files (Write only)
- `implement` - Creates and modifies files (Write + Edit)
- `revert` - Updates plan.md status (Write)
- `status`, `help` - Read-only

### 4. Git Integration (implement, revert)

- Commit messages follow conventional format
- Git notes for audit trail
- Track/phase/task references in all commits
- Revert creates new commits (non-destructive)

---

## Migration Notes

### Breaking Changes (v2.0.0)

1. Skills no longer available by name (e.g., `conductor:setup`)
2. Commands now invoked via `/conductor:setup`
3. No automatic skill loading by agents

### User Impact

- Users must use `/conductor:` prefix for commands
- Autocomplete now works for all commands
- Same functionality, improved discoverability

### Backward Compatibility

None. This is a clean conversion from skill-based to command-based architecture.

---

## Appendix: Complete Command Templates

### Template: Command with TodoWrite (Multi-Phase)

```markdown
---
description: |
  Description of the command with workflow overview.
  Workflow: PHASE 1 -> PHASE 2 -> PHASE 3 -> PHASE 4
allowed-tools: AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
---

<role>
  <identity>Role Name</identity>
  <expertise>
    - Expertise 1
    - Expertise 2
  </expertise>
  <mission>
    Clear mission statement.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <critical_constraints>
    <todowrite_requirement>
      You MUST use TodoWrite to track workflow.

      Before starting, create todo list with all phases:
      1. Phase 1 description
      2. Phase 2 description
      3. Phase 3 description
      4. Phase 4 description

      Update continuously as you progress.
    </todowrite_requirement>

    <other_constraint>
      Description of constraint.
    </other_constraint>
  </critical_constraints>

  <workflow>
    <phase number="1" name="Phase Name">
      <objective>What this phase achieves</objective>
      <steps>
        <step>Mark PHASE 1 as in_progress</step>
        <step>Step description</step>
        <step>Mark PHASE 1 as completed</step>
      </steps>
      <quality_gate>Exit criteria</quality_gate>
    </phase>

    <phase number="2" name="Phase Name">
      <!-- Similar structure -->
    </phase>
  </workflow>
</instructions>

<knowledge>
  <section_name>
    Domain knowledge and best practices.
  </section_name>
</knowledge>

<examples>
  <example name="Example Name">
    <user_request>What user asks</user_request>
    <correct_approach>
      1. Step one
      2. Step two
      3. Step three
    </correct_approach>
  </example>
</examples>

<formatting>
  <completion_template>
## Command Complete

**Summary information here**

**Next Steps:**
1. Step 1
2. Step 2
  </completion_template>
</formatting>
```

### Template: Simple Read-Only Command

```markdown
---
description: |
  Simple description of read-only command.
allowed-tools: Read, Glob, Grep
---

<role>
  <identity>Role Name</identity>
  <expertise>
    - Expertise 1
  </expertise>
  <mission>
    Provide information.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <workflow>
    <phase number="1" name="Gather Data">
      <step>Read necessary files</step>
    </phase>
    <phase number="2" name="Present Results">
      <step>Format and display output</step>
    </phase>
  </workflow>
</instructions>

<output_format>
## Output Title

Content here...
</output_format>
```

---

**Document Version:** 1.0.0
**Author:** Agent Designer
**Date:** 2026-01-06
