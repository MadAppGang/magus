# Review: Conductor Plugin Commands

**Status**: PASS
**Reviewer**: google/gemini-3-pro-preview
**Date**: 2026-01-06
**Files Reviewed**:
- /Users/jack/mag/claude-code/plugins/conductor/commands/setup.md
- /Users/jack/mag/claude-code/plugins/conductor/commands/new-track.md
- /Users/jack/mag/claude-code/plugins/conductor/commands/implement.md
- /Users/jack/mag/claude-code/plugins/conductor/commands/status.md
- /Users/jack/mag/claude-code/plugins/conductor/commands/revert.md
- /Users/jack/mag/claude-code/plugins/conductor/commands/help.md

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 4 |
| LOW | 3 |

## Issues

### HIGH

#### 1. [HIGH] Missing TodoWrite in status.md
- **Category**: Completeness
- **Description**: The `status.md` command explicitly states `<no_todowrite>` and does not use TodoWrite. While justified as a "read-only" command, this deviates from the standard pattern where ALL commands/agents should track workflow with TodoWrite. The workflow still has 3 phases that could benefit from tracking.
- **Impact**: Inconsistency with other commands. If status parsing takes time, user has no visibility into progress.
- **Fix**: Consider adding TodoWrite for complex status calculations, or document clearly why it's exempt.
- **Location**: `status.md` lines 29-33

### MEDIUM

#### 2. [MEDIUM] Missing TodoWrite in help.md
- **Category**: Completeness
- **Description**: Similar to status.md, help.md explicitly disables TodoWrite. While understandable for a simple help display, it creates pattern inconsistency.
- **Impact**: Minor - help is a very simple command
- **Fix**: Document exemption reason or add minimal tracking
- **Location**: `help.md` lines 27-30

#### 3. [MEDIUM] Large Phase Completion Protocol in implement.md
- **Category**: Maintainability
- **Description**: The `<phase_completion_protocol>` section (lines 199-254) is very detailed with 10 steps including bash scripts. While comprehensive, this could be extracted to a separate skill for reusability.
- **Impact**: Makes the command file longer and harder to maintain
- **Fix**: Consider extracting to a `conductor:phase-completion` skill
- **Location**: `implement.md` lines 199-254

#### 4. [MEDIUM] Inconsistent Tool List for Orchestrator Commands
- **Category**: Schema Compliance
- **Description**: Per `agentdev:schemas`, orchestrator commands should have `Task` in allowed-tools. None of these commands include `Task` because they are not multi-agent orchestrators. This is technically correct but could be clearer.
- **Impact**: Potential confusion about command classification
- **Fix**: Document that these are single-agent commands, not orchestrators
- **Location**: All command frontmatter

#### 5. [MEDIUM] Missing Explicit Error Recovery Section
- **Category**: Completeness
- **Description**: Most commands lack explicit `<error_recovery>` tags. The implement.md has blocker handling but not structured error recovery.
- **Impact**: Unclear how to handle failures gracefully
- **Fix**: Add `<error_recovery>` sections to setup.md, new-track.md, implement.md, revert.md
- **Location**: All command files

### LOW

#### 6. [LOW] Inconsistent Template Syntax
- **Category**: Formatting
- **Description**: Templates use Handlebars-like syntax (`{#if}`, `{#each}`) in some places (status.md) and simple placeholders (`{track_id}`) in others. Should be consistent.
- **Impact**: Minor readability issue
- **Fix**: Standardize on one template syntax
- **Location**: status.md lines 161-185, other completion templates

#### 7. [LOW] Missing skills Reference in Frontmatter
- **Category**: Completeness
- **Description**: None of the commands reference skills in their frontmatter, even though they could benefit from skills like `orchestration:quality-gates` or `orchestration:todowrite-orchestration`.
- **Impact**: Commands don't leverage shared skill patterns
- **Fix**: Add `skills:` field to frontmatter for relevant skills
- **Location**: All command frontmatter

#### 8. [LOW] JSON in Markdown Code Blocks
- **Category**: Formatting
- **Description**: JSON schema examples in knowledge sections use triple backticks but don't always specify `json` language hint.
- **Impact**: Syntax highlighting may not work
- **Fix**: Ensure all code blocks have language specifiers
- **Location**: setup.md line 164, implement.md various

---

## Command-by-Command Analysis

### setup.md

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 10/10 | Valid, all required fields |
| XML Structure | 9/10 | All tags properly closed and nested |
| Completeness | 9/10 | Comprehensive Q&A workflow |
| Examples | 10/10 | 2 good examples (new project, resume) |
| TodoWrite | 10/10 | Properly integrated |
| Tools | 10/10 | Appropriate for Q&A setup flow |

**Strengths**: Excellent resume capability, state persistence, clear workflow phases.

### new-track.md

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 10/10 | Valid |
| XML Structure | 9/10 | Well structured |
| Completeness | 9/10 | Good spec/plan templates |
| Examples | 10/10 | 2 examples (feature, bugfix) |
| TodoWrite | 10/10 | Properly integrated |
| Tools | 10/10 | Appropriate for planning |

**Strengths**: Clear spec-before-plan principle, hierarchical plan structure.

### implement.md

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 10/10 | Valid, includes Edit tool |
| XML Structure | 8/10 | Complex but valid |
| Completeness | 10/10 | Most comprehensive command |
| Examples | 10/10 | 3 excellent examples |
| TodoWrite | 10/10 | Deeply integrated |
| Tools | 10/10 | Full implementation toolset |

**Strengths**: Full TDD workflow, git notes integration, phase completion protocol, blocker handling.

### status.md

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 10/10 | Valid, read-only tools |
| XML Structure | 9/10 | Clean and simple |
| Completeness | 8/10 | Missing error handling |
| Examples | 10/10 | 2 good examples |
| TodoWrite | 6/10 | Explicitly disabled |
| Tools | 10/10 | Correctly read-only |

**Strengths**: Clear progress visualization, actionable recommendations.
**Weakness**: TodoWrite exemption breaks consistency.

### revert.md

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 10/10 | Valid |
| XML Structure | 9/10 | Well organized |
| Completeness | 9/10 | Good safety gates |
| Examples | 10/10 | 2 examples (task, phase) |
| TodoWrite | 10/10 | Properly integrated |
| Tools | 10/10 | Appropriate for revert |

**Strengths**: Explicit confirmation gates, non-destructive default, logical grouping concept.

### help.md

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 10/10 | Valid, minimal tools |
| XML Structure | 9/10 | Simple structure |
| Completeness | 8/10 | Complete help content |
| Examples | 8/10 | Only 1 example |
| TodoWrite | 6/10 | Explicitly disabled |
| Tools | 10/10 | Correctly minimal |

**Strengths**: Comprehensive output_format with philosophy, commands, quick start.
**Weakness**: Only 1 example, TodoWrite exemption.

---

## Overall Scores

| Area | Weight | Score |
|------|--------|-------|
| YAML Frontmatter | 20% | 10/10 |
| XML Structure | 20% | 9/10 |
| Completeness | 15% | 9/10 |
| Examples | 15% | 9/10 |
| TodoWrite | 10% | 8/10 |
| Tools | 10% | 10/10 |
| Security | 10% | 10/10 |
| **Weighted Total** | 100% | **9.2/10** |

---

## Security Review

**No security issues found.**

- Commands use safe git operations (revert commits, not force push by default)
- No credential exposure patterns
- Explicit user confirmation before destructive operations
- Read-only commands have appropriately restricted tool access

---

## Recommendation

**PASS** - Approve for production use.

The Conductor plugin commands are well-implemented with:
- Valid YAML frontmatter across all files
- Proper XML structure with correct nesting
- Comprehensive workflows with clear phases
- Good examples demonstrating usage patterns
- Strong safety mechanisms (confirmation gates, non-destructive defaults)
- Excellent git integration with notes and traceability

**Minor improvements suggested:**
1. Reconsider TodoWrite exemptions for consistency
2. Add `<error_recovery>` sections
3. Consider extracting phase completion protocol to a skill
4. Add `skills:` references in frontmatter

These are minor polish items and do not block production use.
