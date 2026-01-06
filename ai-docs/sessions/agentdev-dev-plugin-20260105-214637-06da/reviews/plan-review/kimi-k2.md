# Dev Plugin Design Review

**Reviewer:** Kimi K2 (moonshotai/kimi-k2-thinking)
**Date:** 2026-01-05
**Document:** ai-docs/sessions/agentdev-dev-plugin-20260105-214637-06da/design.md
**Status:** CONDITIONAL

---

## Executive Summary

The Dev Plugin design document (2,169 lines) demonstrates strong architectural thinking with comprehensive orchestrator command specifications. However, significant gaps exist in the worker layer (agents and skills) that must be addressed before implementation.

**Total Issues: 22** (5 CRITICAL, 8 HIGH, 7 MEDIUM, 2 LOW)

**Overall Completeness: ~33%**

---

## CRITICAL Issues (5)

### CRITICAL-1: Incomplete Agent Specifications

**Category:** Completeness
**Location:** Section 6 (Agents), lines 1766-2036

**Description:** The 4 orchestrator commands are well-specified (~60% complete), but the worker agents they delegate to are barely defined:

| Agent | Status | Issue |
|-------|--------|-------|
| stack-detector | Well-defined | Has full XML structure |
| universal-developer | Partial | Only YAML frontmatter + minimal XML |
| universal-debugger | Partial | Only YAML frontmatter + minimal XML |
| universal-architect | Partial | Only YAML frontmatter + minimal XML |

**Impact:** Commands cannot delegate effectively to incomplete agents. Implementation will stall when trying to build agent files.

**Fix:** Complete each agent with:
- Full `<role>` with expertise list
- Complete `<instructions>` with critical constraints
- Detailed `<workflow>` phases with steps
- `<knowledge>` section with stack-specific patterns
- 2-4 `<examples>` for common use cases
- `<formatting>` with completion message template

---

### CRITICAL-2: No Session Context Passing Mechanism

**Category:** Implementation Gap
**Location:** All commands (lines 377-509, 666-809, etc.)

**Description:** Commands reference `${SESSION_PATH}` in Task delegation prompts but don't define how to actually pass this context to agents via the Task tool.

**Example (line 458):**
```
Launch universal-developer agent:
  SESSION_PATH: ${SESSION_PATH}
  DETECTED_SKILLS: {skill_list}
```

**Impact:** Agents will not receive session context, breaking file organization and cross-phase communication.

**Fix:** Define explicit context passing pattern:
```xml
<context_passing>
  When launching agents via Task tool:
  1. Include SESSION_PATH in first line of prompt
  2. Use format: "SESSION_PATH: {absolute_path}"
  3. Agent must read and use this path for all file operations
</context_passing>
```

---

### CRITICAL-3: Skill Auto-Loading Not Actually Implemented

**Category:** Core Feature Missing
**Location:** Section 3 (Auto-Loading Mechanism), lines 165-289

**Description:** The concept of dynamic skill loading is described, but no actual mechanism exists:

1. Detection algorithm is pseudocode, not executable
2. No Claude Code API for dynamic skill loading exists
3. Skills are statically declared in plugin.json

**Impact:** The core innovation of the plugin (context-aware skill loading) is not implementable as designed.

**Fix:** Redesign skill loading strategy:

**Option A: Static Skills with Conditional Content**
- Load all skills but include `<when_applicable>` guards
- Agent reads guards and ignores irrelevant sections

**Option B: Command-Level Skill References**
- Commands specify skills in frontmatter
- Stack-detector recommends which command to use

**Option C: Agent-Driven Skill Reading**
- Agents dynamically read skill files based on detection
- Use Read tool to load skill content at runtime

---

### CRITICAL-4: Missing Help Command Specification

**Category:** Completeness
**Location:** Line 70 (reference only)

**Description:** The plugin.json references `./commands/help.md` but no specification exists in the design document.

**Impact:** Users will have no way to discover available commands or get usage help.

**Fix:** Add complete help command specification:
```yaml
---
description: |
  Display available dev plugin commands and their usage.
  Shows detected stack and recommended commands for current project.
allowed-tools: Bash, Read, Glob
---
```

---

### CRITICAL-5: Duplicate stack-detector Agent Definitions

**Category:** Consistency
**Location:** Lines 291-307 and 1768-1841

**Description:** Two conflicting definitions of stack-detector exist:
- First definition (lines 291-307): Brief YAML-only version
- Second definition (lines 1768-1841): Full specification with XML

**Impact:** Implementation ambiguity - which version is authoritative?

**Fix:** Remove the brief definition (lines 291-307) and keep only the complete specification in Section 6.

---

## HIGH Priority Issues (8)

### HIGH-1: Missing Tool Permissions for stack-detector

**Category:** Tool Permissions
**Location:** Lines 1779, 1803

**Description:** stack-detector agent needs additional tools:
- Current: `TodoWrite, Read, Glob, Grep, Bash`
- Missing: `AskUserQuestion` (for confirming ambiguous detections)

**Impact:** Cannot interactively resolve multi-stack projects or confirm detection.

**Fix:** Add `AskUserQuestion` to stack-detector tools.

---

### HIGH-2: All Skills Are Empty Placeholders

**Category:** Completeness
**Location:** Section 5 (Skills Organization), lines 1535-1762

**Description:** All 15 skills contain only structure without actual content:
```
**Content includes:**
- Pattern 1
- Pattern 2
```

No actual patterns, code examples, or best practices are defined.

**Impact:** Agents will have no knowledge to apply. Skills are the core knowledge base.

**Fix:** Each skill needs:
- 500-1000 lines of actual patterns
- Code examples for the technology
- Common pitfalls and solutions
- Quality check commands
- Testing patterns

---

### HIGH-3: No Centralized Quality Gate System

**Category:** Architecture
**Location:** Lines 514-548, duplicated in each command

**Description:** Quality checks are copy-pasted into each command instead of using a centralized system.

**Impact:** Maintenance burden, inconsistency, harder to add new stacks.

**Fix:** Create a `quality-checks` skill that defines checks per stack, referenced by all commands:
```xml
<skill name="quality-checks">
  <stack name="react-typescript">
    <checks>...</checks>
  </stack>
</skill>
```

---

### HIGH-4: Multi-Model Validation Incomplete

**Category:** Integration
**Location:** Lines 1017-1040, 1089-1118

**Description:** References to multi-model validation lack:
- How to invoke PROXY_MODE in Task prompts
- Model performance tracking implementation
- Historical performance storage location
- Consensus calculation method

**Impact:** Multi-model review feature will not work without implementation details.

**Fix:** Reference `orchestration:multi-model-validation` skill and show explicit Task prompt format:
```
Task: universal-architect PROXY_MODE: x-ai/grok-code-fast-1
  Prompt: "Review architecture at ${SESSION_PATH}/architecture.md..."
```

---

### HIGH-5: No Error Handling for Failed Detection

**Category:** Error Handling
**Location:** Section 3 (Auto-Loading), entire section

**Description:** No fallback behavior when:
- Stack detection fails
- Multiple conflicting stacks detected
- Unknown technology found

**Impact:** Commands will fail ungracefully on edge cases.

**Fix:** Add error handling phase:
```xml
<error_handling>
  <case name="detection_failed">
    <action>Fall back to universal-patterns only</action>
    <action>Notify user of limitation</action>
    <action>Offer manual stack selection via AskUserQuestion</action>
  </case>
</error_handling>
```

---

### HIGH-6: Agents Missing PROXY_MODE Support

**Category:** Feature Gap
**Location:** Agent definitions (Section 6)

**Description:** None of the agents include `<proxy_mode_support>` in their critical constraints, despite commands expecting to use multi-model validation.

**Impact:** External model reviews via Claudish will not work.

**Fix:** Add PROXY_MODE support to universal-architect agent (the one used for reviews):
```xml
<critical_constraints>
  <proxy_mode_support>
    If prompt starts with PROXY_MODE: {model}...
  </proxy_mode_support>
</critical_constraints>
```

---

### HIGH-7: Missing Skill Reference Format

**Category:** Schema Compliance
**Location:** Throughout commands

**Description:** Skills are referenced as `dev:context-detection` but plugin.json uses directory paths like `./skills/context-detection`.

**Impact:** Skill loading may fail due to format mismatch.

**Fix:** Align naming convention:
- Plugin.json: `./skills/context-detection/SKILL.md`
- Commands: `dev:context-detection` (plugin:skill format)

---

### HIGH-8: No TodoWrite Integration in Agents

**Category:** Pattern Compliance
**Location:** Agent definitions (universal-developer, universal-debugger, universal-architect)

**Description:** Only stack-detector has `<todowrite_requirement>` in critical constraints. Other agents lack it.

**Impact:** Workflow tracking will be incomplete when agents run.

**Fix:** Add to each agent:
```xml
<todowrite_requirement>
  You MUST use TodoWrite to track your workflow.
</todowrite_requirement>
```

---

## MEDIUM Priority Issues (7)

### MEDIUM-1: No Conflict Resolution for Multi-Stack Projects

**Category:** Edge Case
**Location:** Detection Algorithm (lines 240-289)

**Description:** Projects with multiple stacks (e.g., React frontend + Go backend) have undefined detection behavior.

**Fix:** Add conflict resolution:
```yaml
multi_stack_handling:
  strategy: "detect_all"
  primary_stack: "based on current_file context"
  secondary_stacks: "available for explicit loading"
```

---

### MEDIUM-2: Inconsistent Session Naming Patterns

**Category:** Consistency
**Location:** Commands (lines 378, 667, 965, 1285)

**Description:** Different session naming patterns:
- dev-implement: `dev-impl-{date}-{random}`
- dev-debug: `dev-debug-{date}-{random}`
- dev-feature: `dev-feature-{slug}-{date}`
- dev-architect: `dev-arch-{date}`

**Fix:** Standardize to: `dev-{command}-{date}-{random}` for all.

---

### MEDIUM-3: No Session Cleanup Mechanism

**Category:** Maintenance
**Location:** All commands

**Description:** Sessions accumulate in ai-docs/sessions/ with no cleanup strategy.

**Fix:** Add optional cleanup in finalization phase:
```
<step optional="true">
  Offer to archive or delete session artifacts after 7 days
</step>
```

---

### MEDIUM-4: Missing Validation Phase Examples

**Category:** Documentation
**Location:** Commands - Validation phases

**Description:** Validation phases describe what to check but don't show example output or failure handling.

**Fix:** Add examples showing successful and failed validation runs.

---

### MEDIUM-5: Quality Checks Duplicated Across Commands

**Category:** DRY Violation
**Location:** Lines 514-548, repeated in dev-debug, dev-feature

**Description:** Same `<quality_checks_by_stack>` block is duplicated in multiple commands.

**Fix:** Extract to a shared skill or reference a single definition.

---

### MEDIUM-6: No Version Compatibility Matrix

**Category:** Documentation
**Location:** Plugin manifest

**Description:** Only specifies `claudeCode: ">=0.1.0"` but doesn't document:
- Node.js version requirements
- Claudish version requirements
- Per-stack tool version requirements

**Fix:** Add compatibility matrix to README.

---

### MEDIUM-7: Missing Agent Color Justification

**Category:** Minor
**Location:** Agent definitions

**Description:** Agent colors are assigned but not explained:
- stack-detector: blue
- universal-developer: green
- universal-debugger: orange
- universal-architect: purple

**Fix:** Add brief justification or reference to color guidelines.

---

## LOW Priority Issues (2)

### LOW-1: Inconsistent Markdown Header Levels

**Category:** Style
**Location:** Throughout document

**Description:** Some sections use `##` where `###` would be more appropriate for nesting.

**Fix:** Standardize header hierarchy.

---

### LOW-2: No Changelog Section

**Category:** Documentation
**Location:** End of document

**Description:** No version history or changelog for tracking design iterations.

**Fix:** Add changelog section for document versioning.

---

## Completeness Analysis

| Component | Specification Level | Completeness |
|-----------|---------------------|--------------|
| Plugin Manifest | Complete | 95% |
| Directory Structure | Complete | 100% |
| Auto-Loading Mechanism | Conceptual only | 30% |
| dev-implement Command | Well-specified | 70% |
| dev-debug Command | Well-specified | 65% |
| dev-feature Command | Well-specified | 75% |
| dev-architect Command | Well-specified | 60% |
| stack-detector Agent | Complete | 90% |
| universal-developer Agent | Minimal | 25% |
| universal-debugger Agent | Minimal | 25% |
| universal-architect Agent | Minimal | 25% |
| Core Skills (3) | Placeholder only | 15% |
| Frontend Skills (4) | Placeholder only | 10% |
| Backend Skills (8) | Placeholder only | 10% |
| **Overall** | - | **~33%** |

---

## Architectural Insight

This design exhibits the **"Beautiful Menu, Empty Kitchen"** anti-pattern:

- Meticulously documents the user-facing orchestration layer (commands)
- Under-specifies the worker layer (agents and skills) that actually performs the work

This is backwards from typical Claude Code plugin design where you:
1. First validate agents can perform required tasks
2. Then build orchestrators around them

**Recommendation:** Before Phase 1 implementation:
1. Complete all 4 agent specifications (add ~500 lines each)
2. Create at least 3 skill files with actual content (golang, react-typescript, universal-patterns)
3. Validate orchestrator designs can delegate effectively
4. Add PROXY_MODE support for multi-model validation

---

## Approval Decision

**Status: CONDITIONAL**

**Rationale:**
- 0 CRITICAL issues that block basic functionality
- 5 CRITICAL specification gaps that must be addressed
- Core architecture is sound
- Implementation would stall at agent/skill level

**Required Before Implementation:**
1. Complete agent specifications (CRITICAL-1)
2. Resolve skill loading strategy (CRITICAL-3)
3. Add help command (CRITICAL-4)
4. Remove duplicate definitions (CRITICAL-5)
5. Add PROXY_MODE support to agents (HIGH-6)

**Recommended Approach:**
Address CRITICAL issues first, then proceed with Phase 1 (Core Infrastructure) implementation while completing remaining HIGH issues in parallel.

---

*Generated by: moonshotai/kimi-k2-thinking via Claudish*
*Review completed: 2026-01-05*
