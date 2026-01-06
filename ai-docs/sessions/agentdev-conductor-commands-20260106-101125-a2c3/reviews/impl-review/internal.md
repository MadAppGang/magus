# Review: Conductor Plugin Commands

**Status**: PASS
**Reviewer**: Claude Opus 4.5 (internal)
**Date**: 2026-01-06
**Files Reviewed**:
- `/Users/jack/mag/claude-code/plugins/conductor/commands/setup.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/new-track.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/implement.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/status.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/revert.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/help.md`
- `/Users/jack/mag/claude-code/plugins/conductor/plugin.json`

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 4 |
| LOW | 5 |

---

## Command-by-Command Analysis

### 1. setup.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Initialize Conductor for your project through interactive Q&A.
  Workflow: VALIDATE -> PROJECT TYPE -> PRODUCT CONTEXT -> TECH CONTEXT -> GUIDELINES -> FINALIZE
  ...
allowed-tools: AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
```

**Validation Results**:
- Description: Multi-line with workflow explanation
- allowed-tools: Correct for interactive orchestrator (has AskUserQuestion, TodoWrite, Write)
- All opening `---` and closing `---` present

**XML Structure**: VALID
- `<role>`: Present with identity, expertise, mission
- `<user_request>`: Present with $ARGUMENTS
- `<instructions>`: Present with critical_constraints, core_principles, workflow
- `<knowledge>`: Present with greenfield_vs_brownfield, question_types, state_file_schema
- `<examples>`: Present (2 examples - adequate)
- `<formatting>`: Present with communication_style, completion_template

**TodoWrite Integration**: PRESENT
- Listed in `<todowrite_requirement>` with 8-step workflow
- Properly integrated with phases

**Score**: 9.5/10

---

### 2. new-track.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Create a new development track with spec and plan.
  Workflow: VALIDATE CONDUCTOR -> LOAD CONTEXT -> DETERMINE TYPE -> GENERATE SPEC -> GENERATE PLAN -> FINALIZE
  ...
allowed-tools: AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
```

**Validation Results**:
- Description: Multi-line with workflow explanation
- allowed-tools: Correct for planning orchestrator
- All YAML markers present

**XML Structure**: VALID
- `<role>`: Present with identity, expertise, mission
- `<user_request>`: Present
- `<instructions>`: Present with critical_constraints, core_principles, workflow (6 phases)
- `<knowledge>`: Present with track_types, plan_structure, spec_template
- `<examples>`: Present (2 examples)
- `<formatting>`: Present with completion_template

**TodoWrite Integration**: PRESENT
- Listed in `<todowrite_requirement>` with 7-step workflow

**Score**: 9.5/10

---

### 3. implement.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Execute tasks from a track's plan.md with TDD workflow.
  Workflow: VALIDATE -> SELECT TASK -> TDD (RED/GREEN/REFACTOR) -> QUALITY & COMMIT -> PHASE CHECK
  ...
allowed-tools: AskUserQuestion, Bash, Read, Write, Edit, TodoWrite, Glob, Grep
```

**Validation Results**:
- Description: Multi-line with TDD workflow explanation
- allowed-tools: Correct for implementer (includes Edit)
- All YAML markers present

**XML Structure**: VALID
- `<role>`: Present with comprehensive expertise list
- `<user_request>`: Present
- `<instructions>`: Present with extensive critical_constraints including:
  - todowrite_requirement
  - status_progression
  - tdd_workflow (Red/Green/Refactor)
  - git_commit_protocol
  - commit_types table
  - workflow_adherence
  - human_approval_gates
- `<phase_completion_protocol>`: Present (10-step protocol) - Good specialized tag
- `<knowledge>`: Present with status_symbols, commit_message_format, git_notes_format, blocker_handling, deviation_protocol
- `<examples>`: Present (3 examples - excellent coverage)
- `<formatting>`: Present with progress_display, task_completion_template, phase_completion_template

**TodoWrite Integration**: PRESENT
- Listed in `<todowrite_requirement>`
- Mirrors plan.md tasks

**Score**: 9.8/10 (excellent completeness)

---

### 4. status.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Show Conductor status - active tracks, progress, current task, blockers.
  Read-only command that parses tracks.md and all plan.md files.
  ...
allowed-tools: Bash, Read, Glob, Grep
```

**Validation Results**:
- Description: Clear read-only purpose
- allowed-tools: Correct for read-only command (no Write, Edit, TodoWrite)
- All YAML markers present

**XML Structure**: VALID
- `<role>`: Present
- `<user_request>`: Present
- `<instructions>`: Present with critical_constraints including `<no_todowrite>` - correctly justifies why TodoWrite not needed
- `<knowledge>`: Present with progress_calculation, status_priority
- `<examples>`: Present (2 examples)
- `<formatting>`: Present with status_template

**TodoWrite Integration**: CORRECTLY ABSENT
- The command explicitly documents why TodoWrite is not needed in `<no_todowrite>` constraint
- This is a read-only, single atomic operation

**Score**: 9.5/10

---

### 5. revert.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Git-aware logical undo for Conductor tracks.
  Workflow: SCOPE SELECTION -> IMPACT ANALYSIS -> USER CONFIRMATION -> EXECUTION -> VALIDATION
  ...
allowed-tools: AskUserQuestion, Bash, Read, Write, Edit, TodoWrite, Glob, Grep
```

**Validation Results**:
- Description: Multi-line with workflow
- allowed-tools: Correct for destructive operation (full toolset)
- All YAML markers present

**XML Structure**: VALID
- `<role>`: Present
- `<user_request>`: Present
- `<instructions>`: Present with critical_constraints including:
  - todowrite_requirement (detailed 5-phase tracking)
  - confirmation_required
  - non_destructive_default
  - state_validation
- `<knowledge>`: Present with revert_levels, commit_identification, revert_strategies
- `<examples>`: Present (2 examples)
- `<formatting>`: Present with impact_preview_template, completion_template

**TodoWrite Integration**: PRESENT
- Detailed 5-phase tracking requirement

**Score**: 9.5/10

---

### 6. help.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Display Conductor help, philosophy, available commands, and quick start guide.
  Shows directory structure and troubleshooting tips.
allowed-tools: Read, Glob
```

**Validation Results**:
- Description: Clear informational purpose
- allowed-tools: Minimal (correct for info-only command)
- All YAML markers present

**XML Structure**: VALID
- `<role>`: Present
- `<user_request>`: Present
- `<instructions>`: Present with `<no_todowrite>` justification and `<read_only>` constraint
- `<output_format>`: Present with complete help documentation - good specialized tag
- `<examples>`: Present (1 example - adequate for simple help command)

**TodoWrite Integration**: CORRECTLY ABSENT
- Documented in `<no_todowrite>` constraint

**Score**: 9.0/10

---

### 7. plugin.json

**Validation Results**:
- `name`: "conductor" - valid
- `version`: "2.0.0" - valid
- `description`: Comprehensive description
- `commands`: ["setup", "new-track", "implement", "status", "revert", "help"] - All 6 commands declared
- `skills`: [] - empty, valid
- `dependencies`: [] - empty, valid
- `tags`: Appropriate tags
- `compatibility`: Specified

**Command Declaration Check**:
| Declared in plugin.json | File Exists |
|------------------------|-------------|
| setup | setup.md - YES |
| new-track | new-track.md - YES |
| implement | implement.md - YES |
| status | status.md - YES |
| revert | revert.md - YES |
| help | help.md - YES |

**Score**: 10/10

---

## Issues

### CRITICAL
None.

### HIGH
None.

### MEDIUM

#### Issue 1: help.md has only 1 example
- **Category**: Completeness
- **Description**: The help.md command has only 1 example, while standards recommend 2-4
- **Impact**: Reduced guidance for edge cases
- **Fix**: Add 1-2 more examples (e.g., "Show help for specific command", "Help when not initialized")
- **Location**: help.md `<examples>` section

#### Issue 2: status.md lacks explicit workflow phase numbering in documentation
- **Category**: Clarity
- **Description**: The workflow phases are present but the status output examples could show phase context more clearly
- **Impact**: Minor - users may not understand phase context at a glance
- **Fix**: Consider adding phase number to status output format
- **Location**: status.md `<formatting>` section

#### Issue 3: Missing skills declaration for orchestration patterns
- **Category**: Integration
- **Description**: The commands could benefit from referencing orchestration skills (todowrite-orchestration, quality-gates) in frontmatter
- **Impact**: Agents don't get enhanced skill context automatically
- **Fix**: Consider adding `skills: orchestration:todowrite-orchestration, orchestration:quality-gates` to implement.md and revert.md
- **Location**: implement.md, revert.md YAML frontmatter

#### Issue 4: No explicit error recovery patterns documented
- **Category**: Completeness
- **Description**: While workflow.md references emergency procedures, the commands themselves don't have explicit `<error_recovery>` sections
- **Impact**: Agents may not handle failures gracefully
- **Fix**: Add `<error_recovery>` sections to implement.md and revert.md
- **Location**: implement.md, revert.md

### LOW

#### Issue 5: Inconsistent code block language specifiers
- **Category**: Style
- **Description**: Some code blocks use "```markdown" while others use "```" without language
- **Impact**: Minor formatting inconsistency
- **Fix**: Add language specifiers to all code blocks
- **Location**: Various commands

#### Issue 6: status.md uses Mustache-style templating syntax
- **Category**: Style
- **Description**: Template uses `{#if blockers}`, `{#each}` which isn't standard Claude template style
- **Impact**: Could confuse implementers about expected output format
- **Fix**: Use standard markdown with placeholders or convert to explicit format
- **Location**: status.md `<status_template>`

#### Issue 7: git notes command could fail silently
- **Category**: Robustness
- **Description**: implement.md git notes commands assume HEAD exists and may fail on initial commits
- **Impact**: Edge case failure
- **Fix**: Add git log check before git notes add
- **Location**: implement.md `<git_commit_protocol>`

#### Issue 8: No versioning of plan.md format
- **Category**: Maintainability
- **Description**: Plan.md format is documented but not versioned, making future migrations harder
- **Impact**: Potential compatibility issues with format changes
- **Fix**: Add format version header to plan.md template
- **Location**: new-track.md `<plan_structure>`

#### Issue 9: Missing explicit "do not modify" constraint on status.md
- **Category**: Safety
- **Description**: While `<read_only>` exists, it could be more prominent
- **Impact**: Minor - already documented, but could be clearer
- **Fix**: Add to critical_constraints with stronger language
- **Location**: status.md

---

## Scores

| Command | YAML | XML | Completeness | Examples | TodoWrite | Total |
|---------|------|-----|--------------|----------|-----------|-------|
| setup.md | 10/10 | 10/10 | 9/10 | 10/10 | 10/10 | **9.5/10** |
| new-track.md | 10/10 | 10/10 | 9/10 | 10/10 | 10/10 | **9.5/10** |
| implement.md | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 | **9.8/10** |
| status.md | 10/10 | 10/10 | 9/10 | 10/10 | N/A (justified) | **9.5/10** |
| revert.md | 10/10 | 10/10 | 9/10 | 10/10 | 10/10 | **9.5/10** |
| help.md | 10/10 | 9/10 | 9/10 | 7/10 | N/A (justified) | **9.0/10** |
| plugin.json | 10/10 | N/A | 10/10 | N/A | N/A | **10/10** |

**Overall Score: 9.4/10**

---

## Tool Requirements Analysis

| Command | Type | Required Tools | Declared Tools | Status |
|---------|------|----------------|----------------|--------|
| setup | Interactive Orchestrator | AskUserQuestion, TodoWrite, Write | AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep | CORRECT |
| new-track | Planner | TodoWrite, Read, Write | AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep | CORRECT |
| implement | Implementer | TodoWrite, Read, Write, Edit, Bash | AskUserQuestion, Bash, Read, Write, Edit, TodoWrite, Glob, Grep | CORRECT |
| status | Read-only Query | Read, Glob, Grep | Bash, Read, Glob, Grep | CORRECT |
| revert | Destructive Operation | AskUserQuestion, TodoWrite, Bash, Write, Edit | AskUserQuestion, Bash, Read, Write, Edit, TodoWrite, Glob, Grep | CORRECT |
| help | Informational | Read, Glob | Read, Glob | CORRECT |

All tool requirements match command types appropriately.

---

## TodoWrite Integration Summary

| Command | TodoWrite Required | TodoWrite Present | Justification |
|---------|-------------------|-------------------|---------------|
| setup | YES (multi-phase) | YES | 8-step workflow tracking |
| new-track | YES (multi-phase) | YES | 7-step workflow tracking |
| implement | YES (task tracking) | YES | Mirrors plan.md tasks |
| status | NO | NO | Read-only atomic operation, documented in `<no_todowrite>` |
| revert | YES (multi-phase) | YES | 5-phase workflow tracking |
| help | NO | NO | Simple info display, documented in `<no_todowrite>` |

All commands correctly implement or justify TodoWrite usage.

---

## Plugin.json Validation

| Check | Status |
|-------|--------|
| Valid JSON syntax | PASS |
| name field present | PASS |
| version field present (semver) | PASS |
| description field present | PASS |
| commands array matches files | PASS (6/6) |
| tags array present | PASS |
| compatibility specified | PASS |

---

## Recommendation

**APPROVE** - The Conductor plugin commands are production-ready.

**Strengths**:
1. Excellent XML structure with all core tags present
2. Valid YAML frontmatter across all commands
3. TodoWrite properly integrated where needed, correctly absent where not
4. Tool requirements match command types
5. Good examples in most commands
6. implement.md is particularly well-crafted with TDD workflow and Phase Completion Protocol
7. Proper justification when TodoWrite is omitted (status.md, help.md)
8. plugin.json correctly declares all 6 commands

**Suggested Improvements** (non-blocking):
1. Add 1-2 more examples to help.md
2. Consider adding orchestration skills references to implement.md and revert.md
3. Add `<error_recovery>` sections to implement.md and revert.md
4. Standardize code block language specifiers

The implementation demonstrates strong adherence to XML tag standards and command schema requirements. The commands form a cohesive workflow system with appropriate tool permissions for each operation type.
