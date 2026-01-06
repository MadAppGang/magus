# Review: Conductor Plugin Commands

**Status**: PASS
**Reviewer**: minimax/minimax-m2.1
**Files Reviewed**:
- `/Users/jack/mag/claude-code/plugins/conductor/commands/setup.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/new-track.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/implement.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/status.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/revert.md`
- `/Users/jack/mag/claude-code/plugins/conductor/commands/help.md`

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 5 |
| LOW | 3 |

---

## Command-by-Command Analysis

### 1. setup.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Initialize Conductor for your project through interactive Q&A.
  Workflow: VALIDATE -> PROJECT TYPE -> PRODUCT CONTEXT -> TECH CONTEXT -> GUIDELINES -> FINALIZE
  Creates conductor/ directory with product.md, tech-stack.md, workflow.md, and styleguides.
  Supports resume capability and both Greenfield/Brownfield projects.
allowed-tools: AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
```

**XML Structure**: COMPLETE
- `<role>`: Present with identity, expertise, mission
- `<user_request>`: Present
- `<instructions>`: Present with critical_constraints, core_principles, workflow
- `<knowledge>`: Present with greenfield_vs_brownfield, question_types, state_file_schema
- `<examples>`: Present (2 examples)
- `<formatting>`: Present with communication_style, completion_template

**Tool Requirements**: APPROPRIATE
- `AskUserQuestion`: Required for Q&A flow
- `Bash`: Required for file operations
- `Read`, `Write`: Required for artifact creation
- `TodoWrite`: Required per schema
- `Glob`, `Grep`: Helpful for Brownfield detection

**Issues**: None

**Score**: 10/10

---

### 2. new-track.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Create a new development track with spec and plan.
  Workflow: VALIDATE CONDUCTOR -> LOAD CONTEXT -> DETERMINE TYPE -> GENERATE SPEC -> GENERATE PLAN -> FINALIZE
  Supports Feature, Bugfix, Refactor, and Task types with hierarchical plans (phases -> tasks -> subtasks).
allowed-tools: AskUserQuestion, Bash, Read, Write, TodoWrite, Glob, Grep
```

**XML Structure**: COMPLETE
- `<role>`: Present with identity, expertise, mission
- `<user_request>`: Present
- `<instructions>`: Present with critical_constraints (todowrite_requirement, conductor_required, context_awareness, track_id_format), core_principles, workflow
- `<knowledge>`: Present with track_types, plan_structure, spec_template
- `<examples>`: Present (2 examples)
- `<formatting>`: Present with completion_template

**Tool Requirements**: APPROPRIATE

**Issues**: None

**Score**: 10/10

---

### 3. implement.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Execute tasks from a track's plan.md with TDD workflow.
  Workflow: VALIDATE -> SELECT TASK -> TDD (RED/GREEN/REFACTOR) -> QUALITY & COMMIT -> PHASE CHECK
  Updates task status: [ ] pending -> [~] in progress -> [x] complete.
  Creates git commits linked to track/phase/task with git notes.
allowed-tools: AskUserQuestion, Bash, Read, Write, Edit, TodoWrite, Glob, Grep
```

**XML Structure**: COMPLETE
- `<role>`: Present with identity, expertise, mission
- `<user_request>`: Present
- `<instructions>`: Present with critical_constraints (todowrite_requirement, status_progression, tdd_workflow, git_commit_protocol, commit_types, workflow_adherence, human_approval_gates), core_principles, workflow, phase_completion_protocol
- `<knowledge>`: Present with status_symbols, commit_message_format, git_notes_format, blocker_handling, deviation_protocol
- `<examples>`: Present (3 examples - excellent coverage)
- `<formatting>`: Present with progress_display, task_completion_template, phase_completion_template

**Tool Requirements**: APPROPRIATE
- Includes `Edit` tool which is necessary for plan.md status updates

**Issues**: None

**Score**: 10/10

---

### 4. status.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Show Conductor status - active tracks, progress, current task, blockers.
  Read-only command that parses tracks.md and all plan.md files.
  Provides actionable "Next Action" recommendation.
allowed-tools: Bash, Read, Glob, Grep
```

**XML Structure**: COMPLETE
- `<role>`: Present with identity, expertise, mission
- `<user_request>`: Present
- `<instructions>`: Present with critical_constraints (no_todowrite justified, read_only, comprehensive_scan), core_principles, workflow
- `<knowledge>`: Present with progress_calculation, status_priority
- `<examples>`: Present (2 examples)
- `<formatting>`: Present with status_template

**Tool Requirements**: APPROPRIATE
- Read-only tools only (no Write/Edit)
- TodoWrite explicitly not required with justification

**Issues**:
- [MEDIUM] Missing TodoWrite is correctly justified but could be more explicit about why it's a read-only operation

**Score**: 9/10

---

### 5. revert.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Git-aware logical undo for Conductor tracks.
  Workflow: SCOPE SELECTION -> IMPACT ANALYSIS -> USER CONFIRMATION -> EXECUTION -> VALIDATION
  Revert at Track, Phase, or Task level (not commit-by-commit).
  Creates revert commits and updates plan.md status.
allowed-tools: AskUserQuestion, Bash, Read, Write, Edit, TodoWrite, Glob, Grep
```

**XML Structure**: COMPLETE
- `<role>`: Present with identity, expertise, mission
- `<user_request>`: Present
- `<instructions>`: Present with critical_constraints (todowrite_requirement with detailed phases, confirmation_required, non_destructive_default, state_validation), core_principles, workflow
- `<knowledge>`: Present with revert_levels, commit_identification, revert_strategies
- `<examples>`: Present (2 examples)
- `<formatting>`: Present with impact_preview_template, completion_template

**Tool Requirements**: APPROPRIATE

**Issues**: None

**Score**: 10/10

---

### 6. help.md

**YAML Frontmatter**: VALID
```yaml
description: |
  Display Conductor help, philosophy, available commands, and quick start guide.
  Shows directory structure and troubleshooting tips.
allowed-tools: Read, Glob
```

**XML Structure**: MOSTLY COMPLETE
- `<role>`: Present with identity, expertise, mission
- `<user_request>`: Present
- `<instructions>`: Present with critical_constraints (no_todowrite, read_only, minimal_tools), workflow
- `<output_format>`: Present (non-standard tag name, but content is comprehensive help text)
- `<examples>`: Present (1 example)

**Tool Requirements**: APPROPRIATE
- Minimal tools for informational command

**Issues**:
- [MEDIUM] Uses `<output_format>` instead of standard `<formatting>` tag
- [LOW] Only 1 example provided (schema recommends 2-4)
- [LOW] Missing `<knowledge>` section (though less critical for help command)

**Score**: 8/10

---

## Cross-Cutting Issues

### HIGH Priority

1. **[HIGH] Inconsistent TodoWrite Documentation Across Commands**
   - **Description**: Commands `status.md` and `help.md` explicitly state they don't need TodoWrite (correct for read-only), but the justification format varies
   - **Location**: status.md lines 29-33, help.md lines 27-31
   - **Impact**: Minor confusion for future maintainers
   - **Fix**: Standardize the `<no_todowrite>` constraint format with consistent reasoning

### MEDIUM Priority

2. **[MEDIUM] Non-Standard Tag in help.md**
   - **Description**: Uses `<output_format>` instead of `<formatting>`
   - **Location**: help.md line 55
   - **Impact**: Inconsistent with XML standards schema
   - **Fix**: Rename to `<formatting>` or add as child of `<formatting>`

3. **[MEDIUM] Missing Core Principles in help.md**
   - **Description**: No `<core_principles>` section in instructions
   - **Location**: help.md instructions section
   - **Impact**: Incomplete per schema
   - **Fix**: Add at least one core principle (e.g., "Clear Communication")

4. **[MEDIUM] Status.md Workflow Could Be Streamlined**
   - **Description**: Workflow has 3 phases but could be a single atomic read operation
   - **Location**: status.md lines 61-80
   - **Impact**: Overly complex for a read-only command
   - **Fix**: Consider simplifying to a single-phase workflow

5. **[MEDIUM] Help.md Missing Knowledge Section**
   - **Description**: No `<knowledge>` tag present
   - **Location**: help.md
   - **Impact**: While less critical for a help command, it could include troubleshooting knowledge or command usage patterns
   - **Fix**: Add basic `<knowledge>` section with common issues or command relationships

### LOW Priority

6. **[LOW] help.md Has Only 1 Example**
   - **Description**: Schema recommends 2-4 examples
   - **Location**: help.md examples section
   - **Impact**: Could add example for specific help topic query
   - **Fix**: Add example like "Show help for /conductor:implement specifically"

7. **[LOW] Verbose Code Blocks in implement.md**
   - **Description**: The `phase_completion_protocol` section has extensive bash code blocks that could be externalized to a skill
   - **Location**: implement.md lines 199-254
   - **Impact**: Makes command file long; could be a skill reference
   - **Fix**: Consider extracting to a conductor skill for reuse

8. **[LOW] No Version/Last Updated in Commands**
   - **Description**: Commands don't include version metadata
   - **Location**: All command files
   - **Impact**: Harder to track command evolution
   - **Fix**: Add version in YAML frontmatter (optional enhancement)

---

## Scores by Area

| Command | YAML | XML | Completeness | Examples | Tools | Total |
|---------|------|-----|--------------|----------|-------|-------|
| setup.md | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 | **10/10** |
| new-track.md | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 | **10/10** |
| implement.md | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 | **10/10** |
| status.md | 10/10 | 10/10 | 9/10 | 10/10 | 10/10 | **9.8/10** |
| revert.md | 10/10 | 10/10 | 10/10 | 10/10 | 10/10 | **10/10** |
| help.md | 10/10 | 8/10 | 7/10 | 7/10 | 10/10 | **8.4/10** |

**Overall Average**: 9.7/10

---

## Recommendation

**PASS** - All commands are well-implemented and ready for production use.

**Key Strengths**:
1. Excellent YAML frontmatter consistency across all commands
2. Comprehensive workflow definitions with clear phases
3. Strong TodoWrite integration in commands that need it
4. Appropriate tool selection for each command's purpose
5. Good example coverage (especially implement.md with 3 examples)
6. Clear completion templates for user feedback

**Suggested Improvements (Optional)**:
1. Standardize the `<no_todowrite>` constraint format across read-only commands
2. Rename `<output_format>` to `<formatting>` in help.md
3. Add 1-2 more examples to help.md
4. Consider extracting phase_completion_protocol to a skill for reuse

The Conductor plugin commands demonstrate solid adherence to XML standards and command schema requirements. The implement.md command is particularly well-designed with its comprehensive TDD workflow and phase completion protocol.
