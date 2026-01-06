# Enhanced /dev:feature Command v2.0 - Design Document

**Version:** 2.0.0
**Status:** Design Complete
**Author:** Claude Code Agent Designer
**Date:** 2026-01-05

## Executive Summary

This document presents a comprehensive design for the enhanced `/dev:feature` command v2.0, implementing all 15 requirements for a production-ready, multi-agent feature development orchestrator with:

- **7-Phase Orchestration** with clear quality gates
- **Iterative Requirements Gathering** with clarifying questions
- **Multi-Model Planning Validation** with blinded voting
- **Parallel Implementation** across stack layers
- **Multi-Model Code Review Loop** with iteration limits
- **Black Box Testing** (test architect isolated from implementation)
- **Comprehensive Report Generation**

---

## Table of Contents

1. [Core Design Principles](#core-design-principles)
2. [Command Frontmatter](#command-frontmatter)
3. [Role Definition](#role-definition)
4. [7-Phase Orchestration](#7-phase-orchestration)
5. [Agent Routing](#agent-routing)
6. [File Structure](#file-structure)
7. [Parallel Execution Plan](#parallel-execution-plan)
8. [Quality Gates](#quality-gates)
9. [Iteration Limits](#iteration-limits)
10. [Error Recovery](#error-recovery)
11. [Full XML Structure](#full-xml-structure)

---

## Core Design Principles

### 1. File-Based Communication

All agent communication happens through files, not return values:

```
REQUIREMENT: Agents write detailed output to files, return brief summaries (max 3 lines)

Why:
- Prevents context pollution in orchestrator
- Enables parallel execution without conflicts
- Creates audit trail
- Allows resume from any phase
```

### 2. Orchestrator Never Implements

```
CONSTRAINT: Orchestrator uses only Task, Bash, Read, TodoWrite, AskUserQuestion, Glob, Grep
FORBIDDEN: Write, Edit (delegation only)
```

### 3. Test Independence (Black Box)

```
REQUIREMENT: Test architect receives ONLY:
- User requirements
- Public API contracts
- NO implementation details
- NO source code access

Why:
- Tests validate behavior, not implementation
- Prevents tests that mirror implementation bugs
- Tests are authoritative - if tests fail, implementation changes
```

### 4. Safety Limits on All Loops

```
REQUIREMENT: Every iteration loop has:
- Maximum iteration count
- Escalation strategy
- User notification at threshold
```

---

## Command Frontmatter

```yaml
---
description: |
  Enhanced feature development orchestrator with 7-phase workflow.
  Workflow: REQUIREMENTS -> RESEARCH -> PLANNING -> IMPLEMENTATION -> REVIEW -> TESTING -> COMPLETION
  Features: Multi-model validation, black box testing, parallel execution, iteration limits.
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
skills: dev:context-detection, dev:universal-patterns, orchestration:multi-model-validation, orchestration:quality-gates, orchestration:model-tracking-protocol
---
```

---

## Role Definition

```xml
<role>
  <identity>Enhanced Feature Development Orchestrator v2.0</identity>
  <expertise>
    - 7-phase feature development lifecycle
    - Iterative requirements gathering
    - Multi-model planning validation
    - Parallel multi-stack implementation
    - Multi-model code review with iteration loops
    - Black box test architecture
    - Comprehensive report generation
  </expertise>
  <mission>
    Orchestrate complete feature development from requirements gathering through
    deployment-ready code, using multi-agent coordination with quality gates,
    multi-model validation, black box testing, and strict iteration limits.

    Ensure test independence by isolating test architect from implementation details,
    making tests authoritative for validating behavior.
  </mission>
</role>
```

---

## 7-Phase Orchestration

### Phase Overview

```
Phase 1: Requirements Gathering (Iterative)
    |
    v  [Quality Gate: Requirements Complete]
Phase 2: Research (Optional)
    |
    v  [Quality Gate: Research Complete or Skipped]
Phase 3: Multi-Model Planning
    |
    v  [Quality Gate: Plan Approved by Consensus]
Phase 4: Implementation (Parallel)
    |
    v  [Quality Gate: All Stacks Implemented, Quality Checks Pass]
Phase 5: Code Review Loop (Multi-Model)
    |
    v  [Quality Gate: Review PASS or Max Iterations]
Phase 6: Black Box Testing
    |
    v  [Quality Gate: All Tests Pass or Max Iterations]
Phase 7: Completion
    |
    v  [Final Report Generated]
```

### Phase 1: Requirements Gathering

**Objective:** Iteratively gather complete requirements through clarifying questions

**Workflow:**
```
1. Read user's initial feature request
2. Analyze for gaps and ambiguities
3. Generate clarifying questions (batched, max 5 per round)
4. Ask user using AskUserQuestion
5. Incorporate answers into requirements document
6. Repeat until requirements complete OR max 3 rounds
7. Write ${SESSION_PATH}/requirements.md
8. User approval gate
```

**Clarifying Question Categories:**
- Functional requirements (what it must do)
- Non-functional requirements (performance, scale, security)
- Edge cases and error handling
- User experience expectations
- Integration points
- Constraints (technology, time, budget)

**Quality Gate:** User approves requirements document

**Iteration Limit:** 3 rounds of questions max, then proceed with best understanding

### Phase 2: Research (Optional)

**Objective:** Gather external information if needed (APIs, libraries, patterns)

**Workflow:**
```
1. Analyze requirements for research needs
2. If research needed:
   a. Ask user if they want internet research
   b. If yes: Identify specific questions to research
   c. Present research summary
   d. Write ${SESSION_PATH}/research.md
3. If no research needed: Skip to Phase 3
```

**Skip Conditions:**
- User declines research
- No external dependencies identified
- Sufficient existing knowledge

**Quality Gate:** Research complete or explicitly skipped

### Phase 3: Multi-Model Planning

**Objective:** Design architecture with multi-model validation and blinded voting

**Workflow:**
```
1. Launch architect agent to create initial plan
   - Input: requirements.md, research.md (if exists), context.json
   - Output: ${SESSION_PATH}/architecture.md

2. Check Claudish availability for multi-model validation

3. If Claudish available:
   a. Model Selection (AskUserQuestion with multiSelect)
   b. Launch parallel plan reviews (SINGLE message, multiple Tasks)
      - Internal: architect reviews own plan
      - External: PROXY_MODE with selected models
   c. Each reviewer outputs to ${SESSION_PATH}/reviews/plan-review/{model}.md
   d. Consolidate reviews with blinded voting
   e. If critical issues: Revise plan and re-review (max 2 iterations)

4. If Claudish unavailable:
   a. Internal architect self-review only
   b. Proceed with single-model validation

5. User approval gate for final plan
```

**Blinded Voting:**
```
REQUIREMENT: During voting consolidation, model identities are hidden
- Present issues without attribution
- Vote on issue severity (CRITICAL/HIGH/MEDIUM/LOW)
- Reveal attribution only after voting
- This prevents bias toward "famous" models
```

**Quality Gate:** Plan approved by consensus AND user

**Iteration Limit:** 2 plan revision rounds max

### Phase 4: Implementation (Parallel)

**Objective:** Implement feature across all stack layers in parallel where possible

**Workflow:**
```
1. Read implementation phases from architecture.md
2. Detect stack from context.json (frontend, backend, fullstack)
3. For each implementation phase:
   a. If independent phases: Launch in PARALLEL (single message)
   b. If dependent phases: Launch sequentially

4. For each stack layer:
   Launch developer agent:
   - Input: architecture.md, skills, context.json
   - Output: Implemented code files
   - Quality checks: Run stack-specific checks

5. Track progress in ${SESSION_PATH}/implementation-log.md
6. If quality checks fail: Fix and retry (max 2 per phase)
```

**Parallelization Strategy:**
```
Fullstack Example:
- Phase 1: Database schema (backend) - SEQUENTIAL (dependency)
- Phase 2a: API endpoints (backend) }
- Phase 2b: Service layer (backend) } PARALLEL (independent)
- Phase 3a: API client (frontend) }
- Phase 3b: UI components (frontend) } PARALLEL (independent)
- Phase 4: Integration (both) - SEQUENTIAL (depends on 3a, 3b)
```

**Quality Gate:** All stacks implemented, quality checks pass

**Iteration Limit:** 2 fix attempts per phase before escalation

### Phase 5: Code Review Loop (Multi-Model)

**Objective:** Multi-model code review with fix iteration until pass

**Workflow:**
```
1. Prepare code diff: git diff > ${SESSION_PATH}/code-changes.diff
2. Model selection (or use same as Phase 3)
3. Launch parallel reviews:
   - Internal: reviewer agent
   - External: PROXY_MODE with selected models
4. Each reviewer outputs to ${SESSION_PATH}/reviews/code-review/{model}.md
5. Consolidate with consensus analysis
6. Determine verdict:
   - PASS: 0 CRITICAL, <3 HIGH
   - CONDITIONAL: 0 CRITICAL, 3-5 HIGH
   - FAIL: 1+ CRITICAL OR 6+ HIGH
7. If CONDITIONAL or FAIL:
   a. Delegate fixes to developer
   b. Re-review (max 3 iterations)
   c. If still failing after 3: Escalate to user
8. Write consolidated review to ${SESSION_PATH}/reviews/code-review/consolidated.md
```

**Quality Gate:** Review verdict PASS or CONDITIONAL with user approval

**Iteration Limit:** 3 review-fix cycles max

### Phase 6: Black Box Testing

**Objective:** Test architect creates tests from requirements ONLY (no implementation knowledge)

**Workflow:**
```
1. Launch test-architect agent with STRICT input:
   - INPUT ALLOWED:
     * ${SESSION_PATH}/requirements.md
     * ${SESSION_PATH}/architecture.md (API contracts only)
     * Public types/interfaces
   - INPUT FORBIDDEN:
     * Implementation source code
     * Internal function details
     * Implementation-specific patterns

2. Test architect creates test plan:
   - Output: ${SESSION_PATH}/tests/test-plan.md

3. Test architect implements tests:
   - Output: Actual test files

4. Run tests (Bash)
5. If tests fail:
   a. Analyze failure (test-architect)
   b. Determine cause: TEST_ISSUE or IMPLEMENTATION_ISSUE
   c. If TEST_ISSUE: Fix test
   d. If IMPLEMENTATION_ISSUE: Fix implementation (developer)
   e. Re-run tests (max 5 iterations)

6. Track results in ${SESSION_PATH}/tests/test-results.md
```

**Black Box Isolation:**
```
CRITICAL: Test architect agent prompt MUST NOT include:
- File paths to implementation files
- Source code snippets
- Internal function names
- Implementation patterns used

Test architect CAN access:
- Requirements document
- Public API contracts
- Type definitions (public interfaces only)
- Expected behavior descriptions
```

**Quality Gate:** All tests pass OR user approves with known failures

**Iteration Limit:** 5 test-fix cycles max

### Phase 7: Completion

**Objective:** Generate comprehensive report and complete handoff

**Workflow:**
```
1. Gather all artifacts:
   - requirements.md
   - architecture.md
   - implementation-log.md
   - reviews/code-review/consolidated.md
   - tests/test-results.md
   - Model performance statistics

2. Generate final report: ${SESSION_PATH}/report.md
   - Feature summary
   - Requirements fulfilled checklist
   - Architecture decisions
   - Implementation notes
   - Review feedback summary
   - Test coverage and results
   - Model performance statistics (if multi-model used)
   - Recommendations

3. Update session metadata to "completed"
4. Present summary to user
5. Mark all TodoWrite tasks as completed
```

**Report Template:**
```markdown
# Feature Development Report

## Summary
- Feature: {feature_name}
- Stack: {detected_stack}
- Duration: {total_time}
- Models Used: {model_count}

## Requirements Fulfilled
- [x] Requirement 1
- [x] Requirement 2
- [x] Requirement 3

## Architecture
- Pattern: {pattern_name}
- Components: {component_count}

## Implementation
- Files Created: {file_count}
- Lines Added: {lines_added}
- Quality Checks: All PASS

## Code Review
- Verdict: PASS
- Reviewers: {reviewer_count}
- Consensus Issues Fixed: {issue_count}

## Testing
- Test Count: {test_count}
- Pass Rate: 100%
- Coverage: {coverage}%

## Model Performance (if multi-model)
| Model | Time | Issues | Quality |
|-------|------|--------|---------|
| ...   | ...  | ...    | ...     |

## Artifacts
- ${SESSION_PATH}/requirements.md
- ${SESSION_PATH}/architecture.md
- ${SESSION_PATH}/report.md
- ${SESSION_PATH}/reviews/
- ${SESSION_PATH}/tests/

## Next Steps
1. {recommendation_1}
2. {recommendation_2}
```

---

## Agent Routing

### Agent Type Matrix

| Phase | Agent | PROXY_MODE Support | Primary Output |
|-------|-------|-------------------|----------------|
| 1 | (Orchestrator) | N/A | requirements.md |
| 2 | (Orchestrator) | N/A | research.md |
| 3a | architect | Yes | architecture.md |
| 3b | architect | Yes | plan-review/{model}.md |
| 4 | developer | Yes | Implementation files |
| 5 | reviewer (or architect) | Yes | code-review/{model}.md |
| 6 | test-architect (new) | No | test-plan.md, test files |

### New Agent: test-architect

```yaml
---
name: test-architect
description: |
  Black box test architect that creates tests from requirements only.
  NO access to implementation details. Tests are authoritative.
  Examples:
  (1) "Write tests for user auth" - creates tests from API contracts
  (2) "Design test strategy" - creates comprehensive test plan
  (3) "Analyze test failure" - determines if test or implementation issue
model: sonnet
color: orange
tools: TodoWrite, Read, Write, Bash, Glob
---
```

**Critical Constraint for test-architect:**
```xml
<critical_constraints>
  <black_box_isolation>
    **CRITICAL: You have NO access to implementation details.**

    You may ONLY read:
    - Requirements documents
    - API contracts and public interfaces
    - Type definitions (public only)
    - Test configuration files

    You may NOT read:
    - Implementation source files (*.ts, *.go, etc. in src/)
    - Internal functions or methods
    - Implementation patterns

    If you encounter implementation details in your context,
    IGNORE them and test based on requirements only.

    **Why:** Tests must validate behavior, not implementation.
    If tests pass but behavior is wrong, tests need fixing.
    If tests fail but implementation is correct, implementation changes.
  </black_box_isolation>
</critical_constraints>
```

### PROXY_MODE Delegation Pattern

```xml
<delegation_rules>
  <rule scope="planning">
    Internal plan creation: architect agent (NO PROXY_MODE)
    External plan review: architect agent (WITH PROXY_MODE: {model_id})
  </rule>

  <rule scope="implementation">
    All implementation: developer agent (NO PROXY_MODE)
    External implementation not supported (too risky)
  </rule>

  <rule scope="code_review">
    Internal review: reviewer/architect agent (NO PROXY_MODE)
    External review: reviewer/architect agent (WITH PROXY_MODE: {model_id})
  </rule>

  <rule scope="testing">
    Test creation: test-architect agent (NO PROXY_MODE, never external)
    Test execution: Bash
    Failure analysis: test-architect agent (NO PROXY_MODE)
  </rule>
</delegation_rules>
```

---

## File Structure

### Session Directory Layout

```
${SESSION_PATH}/
├── session-meta.json           # Session metadata and checkpoint
├── requirements.md             # Phase 1: Gathered requirements
├── research.md                 # Phase 2: Research notes (optional)
├── architecture.md             # Phase 3: Architecture plan
├── context.json                # Stack detection results
├── implementation-log.md       # Phase 4: Implementation progress
├── code-changes.diff           # Phase 5: Git diff for review
├── report.md                   # Phase 7: Final report
├── reviews/
│   ├── plan-review/            # Phase 3: Plan reviews
│   │   ├── claude-internal.md
│   │   ├── grok.md
│   │   ├── gemini.md
│   │   └── consolidated.md
│   └── code-review/            # Phase 5: Code reviews
│       ├── claude-internal.md
│       ├── grok.md
│       ├── gemini.md
│       └── consolidated.md
└── tests/
    ├── test-plan.md            # Phase 6: Test strategy
    ├── test-results.md         # Phase 6: Test execution results
    └── iteration-history.md    # Phase 6: TDD loop history
```

### File Communication Protocol

```
RULE 1: Agents write detailed output to files
RULE 2: Agents return brief summary (max 3 lines) to orchestrator
RULE 3: Orchestrator reads files for next phase
RULE 4: No large content passed through Task prompts

Example:
  Orchestrator -> Task: architect
    Prompt: "Design auth feature. Read ${SESSION_PATH}/requirements.md.
             Write plan to ${SESSION_PATH}/architecture.md.
             Return brief summary."

  Architect returns:
    "Architecture complete. 5 components designed: AuthService, TokenManager,
     UserRepository, AuthMiddleware, LoginUI. See ${SESSION_PATH}/architecture.md"

  Orchestrator reads architecture.md for Phase 4
```

---

## Parallel Execution Plan

### Phase 3: Parallel Plan Review

```
Message 1: Preparation (Bash only)
  - Create session directories
  - Write requirements context
  - NO Task calls

Message 2: Parallel Reviews (Task only - SINGLE message)
  Task: architect (internal review)
    Prompt: "Review ${SESSION_PATH}/architecture.md..."
    Output: ${SESSION_PATH}/reviews/plan-review/claude-internal.md
  ---
  Task: architect PROXY_MODE: x-ai/grok-code-fast-1
    Prompt: "Review ${SESSION_PATH}/architecture.md..."
    Output: ${SESSION_PATH}/reviews/plan-review/grok.md
  ---
  Task: architect PROXY_MODE: google/gemini-2.5-flash
    Prompt: "Review ${SESSION_PATH}/architecture.md..."
    Output: ${SESSION_PATH}/reviews/plan-review/gemini.md

  All 3 execute SIMULTANEOUSLY

Message 3: Consolidation
  - Read all review files
  - Apply consensus analysis
  - Write consolidated.md
```

### Phase 4: Parallel Implementation

```
Sequential dependencies: Run one at a time
Parallel opportunities: Run in single message

Example Fullstack:

Message 1: Database layer (must complete first)
  Task: developer
    Prompt: "Implement database schema..."

Message 2: Parallel backend services (after database)
  Task: developer
    Prompt: "Implement AuthService..."
  ---
  Task: developer
    Prompt: "Implement UserRepository..."

Message 3: Parallel frontend components
  Task: developer
    Prompt: "Implement AuthContext..."
  ---
  Task: developer
    Prompt: "Implement LoginForm..."

Message 4: Integration layer (after all parallel)
  Task: developer
    Prompt: "Implement integration..."
```

### Phase 5: Parallel Code Review

```
Same pattern as Phase 3 plan review:
- Single message with multiple Task calls
- Each reviewer writes to unique file
- Consolidate after all complete
```

---

## Quality Gates

### Quality Gate Specifications

| Phase | Gate Name | Criteria | Failure Action |
|-------|-----------|----------|----------------|
| 1 | Requirements Complete | User approves requirements.md | Iterate questions (max 3) |
| 2 | Research Complete | Research done or skipped | Proceed to Phase 3 |
| 3 | Plan Approved | Consensus + user approval | Revise plan (max 2) |
| 4 | Implementation Complete | All checks pass | Fix issues (max 2 per phase) |
| 5 | Review Pass | PASS or CONDITIONAL | Fix + re-review (max 3) |
| 6 | Tests Pass | All tests green | TDD loop (max 5) |
| 7 | Report Generated | Report written | N/A (always succeeds) |

### Approval Criteria (Code Review)

```xml
<approval_criteria>
  <status name="PASS">
    - 0 CRITICAL issues
    - Less than 3 HIGH issues
    - Proceed without changes
  </status>

  <status name="CONDITIONAL">
    - 0 CRITICAL issues
    - 3-5 HIGH issues
    - May proceed with user approval
    - Recommend fixing HIGH issues
  </status>

  <status name="FAIL">
    - 1+ CRITICAL issues
    - OR 6+ HIGH issues
    - Must fix before proceeding
    - Delegate to developer
  </status>
</approval_criteria>
```

---

## Iteration Limits

### Limit Specifications

| Loop | Max Iterations | Escalation |
|------|----------------|------------|
| Requirements questions | 3 rounds | Proceed with best understanding |
| Plan revision | 2 iterations | User decides: approve or cancel |
| Implementation fix | 2 per phase | Escalate to user |
| Code review loop | 3 iterations | Escalate to user |
| TDD loop | 5 iterations | Escalate to user |

### Escalation Protocol

```xml
<escalation_protocol>
  <step number="1">
    Log: "Maximum iterations ({N}) reached for {loop_name}"
  </step>

  <step number="2">
    Present to user:
    "The {loop_name} has reached maximum iterations ({N}).

     Current Status:
     - Remaining issues: {issue_list}
     - Attempts made: {iteration_history}

     Options:
     1. Continue anyway (accept current state)
     2. Allow {N} more iterations
     3. Cancel feature development
     4. Take manual control"
  </step>

  <step number="3">
    Based on user choice:
    - Option 1: Proceed to next phase with warning
    - Option 2: Reset iteration counter, continue loop
    - Option 3: Exit gracefully, save progress
    - Option 4: Exit with instructions for manual fixes
  </step>
</escalation_protocol>
```

---

## Error Recovery

### Error Scenarios and Recovery

```xml
<error_recovery>
  <strategy scenario="Agent task fails">
    <recovery>
      1. Log failure with details
      2. Retry once with same parameters
      3. If still fails: Escalate to user
      4. Offer: Retry / Skip / Cancel
    </recovery>
  </strategy>

  <strategy scenario="External model timeout">
    <recovery>
      1. Wait additional 30 seconds
      2. If still not responding: Mark as failed
      3. Continue with successful models
      4. Note in consolidated report: "{model} timed out"
      5. Adjust consensus calculations
    </recovery>
  </strategy>

  <strategy scenario="All external models fail">
    <recovery>
      1. Log all failures with details
      2. Fall back to internal-only review
      3. Notify user: "External models unavailable, using internal only"
      4. Proceed with single-reviewer mode
    </recovery>
  </strategy>

  <strategy scenario="Quality checks fail repeatedly">
    <recovery>
      1. After 2 failed attempts per check
      2. Present specific failure to user
      3. Options: Fix manually / Skip check / Cancel
      4. If skip: Log warning in report
    </recovery>
  </strategy>

  <strategy scenario="Tests fail repeatedly">
    <recovery>
      1. After 5 TDD loop iterations
      2. Analyze: Which tests keep failing?
      3. Present failure analysis to user
      4. Options: Accept failures / Continue loop / Cancel
      5. If accept: Document known failures in report
    </recovery>
  </strategy>

  <strategy scenario="Session creation fails">
    <recovery>
      1. Fall back to legacy mode (SESSION_PATH="ai-docs")
      2. Log warning: "Session isolation unavailable"
      3. Continue with workflow using direct paths
      4. All features work, just without isolation
    </recovery>
  </strategy>

  <strategy scenario="User cancels mid-workflow">
    <recovery>
      1. Save current progress to session
      2. Update session-meta.json with checkpoint
      3. Log: "Development cancelled at Phase {N}"
      4. Provide instructions to resume
    </recovery>
  </strategy>
</error_recovery>
```

### Checkpoint and Resume

```json
// session-meta.json checkpoint structure
{
  "checkpoint": {
    "lastCompletedPhase": "phase4",
    "nextPhase": "phase5",
    "resumable": true,
    "resumeContext": {
      "architectureApproved": true,
      "implementationComplete": true,
      "pendingReview": true,
      "selectedModels": ["x-ai/grok-code-fast-1", "google/gemini-2.5-flash"]
    }
  }
}
```

---

## Full XML Structure

The following is the complete XML structure for the enhanced `/dev:feature` command:

```xml
<role>
  <identity>Enhanced Feature Development Orchestrator v2.0</identity>
  <expertise>
    - 7-phase feature development lifecycle
    - Iterative requirements gathering
    - Multi-model planning validation with blinded voting
    - Parallel multi-stack implementation
    - Multi-model code review with iteration loops
    - Black box test architecture
    - Comprehensive report generation
    - File-based agent communication
  </expertise>
  <mission>
    Orchestrate complete feature development from requirements gathering through
    deployment-ready code, using multi-agent coordination with quality gates,
    multi-model validation, black box testing, and strict iteration limits.

    Ensure test independence by isolating test architect from implementation details,
    making tests authoritative for validating behavior.
  </mission>
</role>

<user_request>
  $ARGUMENTS
</user_request>

<instructions>
  <critical_constraints>
    <todowrite_requirement>
      You MUST use TodoWrite to track full 7-phase lifecycle.

      Before starting, create comprehensive todo list:
      1. PHASE 1: Requirements gathering
      2. PHASE 2: Research (optional)
      3. PHASE 3: Multi-model planning
      4. PHASE 4: Implementation
      5. PHASE 5: Code review loop
      6. PHASE 6: Black box testing
      7. PHASE 7: Report generation

      Update continuously as you progress.
      Mark only ONE task as in_progress at a time.
    </todowrite_requirement>

    <orchestrator_role>
      **You are an ORCHESTRATOR, not IMPLEMENTER.**

      **You MUST:**
      - Use Task tool to delegate ALL work to agents
      - Use TodoWrite to track full lifecycle
      - Enforce quality gates between phases
      - Respect iteration limits
      - Use file-based communication

      **You MUST NOT:**
      - Write or edit ANY code files directly
      - Skip quality gates
      - Exceed iteration limits without user approval
      - Pass large content through Task prompts
    </orchestrator_role>

    <file_based_communication>
      **All agent communication happens through files:**

      - Agents write detailed output to ${SESSION_PATH}/*.md
      - Agents return BRIEF summary (max 3 lines) to orchestrator
      - Orchestrator reads files for next phase
      - No large content in Task prompts

      **Why:**
      - Prevents context pollution
      - Enables parallel execution
      - Creates audit trail
      - Allows resume from any phase
    </file_based_communication>

    <delegation_rules>
      - Requirements gathering: Orchestrator (AskUserQuestion)
      - Research: Orchestrator (external tools if available)
      - Architecture: architect agent
      - Plan review: architect agent (with PROXY_MODE for external)
      - Implementation: developer agent
      - Code review: reviewer/architect agent (with PROXY_MODE for external)
      - Test creation: test-architect agent (NEVER external)
      - Test execution: Bash
    </delegation_rules>

    <iteration_limits>
      **Every loop has a maximum iteration count:**

      - Requirements questions: 3 rounds
      - Plan revision: 2 iterations
      - Implementation fix: 2 per phase
      - Code review loop: 3 iterations
      - TDD loop: 5 iterations

      **At limit:** Escalate to user with options
    </iteration_limits>

    <test_independence>
      **Test architect has NO access to implementation details.**

      Allowed inputs:
      - ${SESSION_PATH}/requirements.md
      - ${SESSION_PATH}/architecture.md (API contracts only)
      - Public types/interfaces

      Forbidden inputs:
      - Implementation source code
      - Internal function details
      - Implementation patterns

      **Why:** Tests validate behavior, not implementation.
      If tests fail, implementation changes (not tests).
    </test_independence>
  </critical_constraints>

  <workflow>
    <phase number="0" name="Session Initialization">
      <objective>Create unique session for artifact isolation</objective>
      <steps>
        <step>Generate session ID: dev-feature-{slug}-YYYYMMDD-HHMMSS-XXXX</step>
        <step>Create directory: ai-docs/sessions/${SESSION_ID}/</step>
        <step>Create subdirectories: reviews/plan-review/, reviews/code-review/, tests/</step>
        <step>Write initial session-meta.json</step>
        <step>Initialize TodoWrite with all 7 phases</step>
      </steps>
      <quality_gate>Session created, SESSION_PATH set</quality_gate>
    </phase>

    <phase number="1" name="Requirements Gathering">
      <objective>Iteratively gather complete requirements through clarifying questions</objective>
      <iteration_limit>3 rounds of questions</iteration_limit>
      <steps>
        <step>Mark PHASE 1 as in_progress</step>
        <step>Read user's initial feature request</step>
        <step>Analyze for gaps and ambiguities</step>
        <step>
          For each round (max 3):
          a. Generate clarifying questions (batched, max 5 per round)
          b. Ask user using AskUserQuestion
          c. Incorporate answers into requirements
          d. If requirements complete: Exit loop
        </step>
        <step>Write ${SESSION_PATH}/requirements.md</step>
        <step>
          User Approval Gate (AskUserQuestion):
          1. Approve requirements
          2. Add more details
          3. Cancel
        </step>
        <step>Mark PHASE 1 as completed</step>
      </steps>
      <quality_gate>User approves requirements.md</quality_gate>
    </phase>

    <phase number="2" name="Research" optional="true">
      <objective>Gather external information if needed</objective>
      <steps>
        <step>Mark PHASE 2 as in_progress</step>
        <step>Analyze requirements for research needs</step>
        <step>
          If research needed:
          a. Ask user if they want internet research
          b. If yes: Identify questions, gather information
          c. Write ${SESSION_PATH}/research.md
          If not needed: Skip this phase
        </step>
        <step>Mark PHASE 2 as completed</step>
      </steps>
      <quality_gate>Research complete or explicitly skipped</quality_gate>
    </phase>

    <phase number="3" name="Multi-Model Planning">
      <objective>Design architecture with multi-model validation</objective>
      <iteration_limit>2 plan revision iterations</iteration_limit>
      <steps>
        <step>Mark PHASE 3 as in_progress</step>
        <step>
          Launch stack-detector agent:
          Output: ${SESSION_PATH}/context.json
        </step>
        <step>
          Launch architect agent:
          Input: requirements.md, research.md, context.json
          Output: ${SESSION_PATH}/architecture.md
          Return: Brief summary only
        </step>
        <step>Check Claudish availability</step>
        <step>
          If Claudish available:
          a. Model Selection (AskUserQuestion with multiSelect)
          b. Launch PARALLEL plan reviews (single message, multiple Tasks):
             - Internal: architect reviews own plan
             - External: architect PROXY_MODE with selected models
          c. Each output: ${SESSION_PATH}/reviews/plan-review/{model}.md
          d. Consolidate with blinded voting
          e. If critical issues: Revise plan (max 2 iterations)
        </step>
        <step>
          User Approval Gate:
          1. Approve plan
          2. Request changes
          3. Cancel
        </step>
        <step>Mark PHASE 3 as completed</step>
      </steps>
      <quality_gate>Plan approved by consensus AND user</quality_gate>
    </phase>

    <phase number="4" name="Implementation">
      <objective>Implement feature across all stack layers</objective>
      <iteration_limit>2 fix attempts per implementation phase</iteration_limit>
      <steps>
        <step>Mark PHASE 4 as in_progress</step>
        <step>Read implementation phases from architecture.md</step>
        <step>Detect stack from context.json</step>
        <step>
          For each implementation phase:
          a. If independent: Launch in PARALLEL (single message)
          b. If dependent: Launch sequentially

          Launch developer agent:
          Input: architecture.md, skill files, context.json
          Output: Implementation code files
          Quality checks: Stack-specific (format, lint, typecheck, test)
          Return: Brief summary only
        </step>
        <step>Track progress in ${SESSION_PATH}/implementation-log.md</step>
        <step>
          If quality checks fail:
          a. Fix issues (max 2 attempts per phase)
          b. If still failing: Escalate to user
        </step>
        <step>Mark PHASE 4 as completed</step>
      </steps>
      <quality_gate>All stacks implemented, quality checks pass</quality_gate>
    </phase>

    <phase number="5" name="Code Review Loop">
      <objective>Multi-model code review with iteration until pass</objective>
      <iteration_limit>3 review-fix cycles</iteration_limit>
      <steps>
        <step>Mark PHASE 5 as in_progress</step>
        <step>Prepare code diff: git diff > ${SESSION_PATH}/code-changes.diff</step>
        <step>
          Model selection (AskUserQuestion):
          - Use same models as Phase 3 [Recommended]
          - Choose different models
          - Skip external (internal only)
        </step>
        <step>
          Launch PARALLEL reviews (single message):
          - Internal: reviewer/architect agent
          - External: PROXY_MODE with selected models
          Each output: ${SESSION_PATH}/reviews/code-review/{model}.md
        </step>
        <step>Consolidate with consensus analysis</step>
        <step>
          Determine verdict:
          - PASS: 0 CRITICAL, less than 3 HIGH
          - CONDITIONAL: 0 CRITICAL, 3-5 HIGH
          - FAIL: 1+ CRITICAL OR 6+ HIGH
        </step>
        <step>
          If CONDITIONAL or FAIL:
          a. Delegate fixes to developer
          b. Re-review (max 3 iterations)
          c. If still failing: Escalate to user
        </step>
        <step>Write ${SESSION_PATH}/reviews/code-review/consolidated.md</step>
        <step>Mark PHASE 5 as completed</step>
      </steps>
      <quality_gate>Review verdict PASS or CONDITIONAL with user approval</quality_gate>
    </phase>

    <phase number="6" name="Black Box Testing">
      <objective>Test architect creates tests from requirements only</objective>
      <iteration_limit>5 TDD loop iterations</iteration_limit>
      <steps>
        <step>Mark PHASE 6 as in_progress</step>
        <step>
          Launch test-architect agent with STRICT isolation:
          INPUT ALLOWED:
          - ${SESSION_PATH}/requirements.md
          - ${SESSION_PATH}/architecture.md (API contracts only)
          - Public types/interfaces

          INPUT FORBIDDEN:
          - Implementation source code
          - Internal function details

          Output: ${SESSION_PATH}/tests/test-plan.md
        </step>
        <step>Test architect implements tests</step>
        <step>Run tests (Bash)</step>
        <step>
          If tests fail:
          a. Analyze failure (test-architect)
          b. Determine: TEST_ISSUE or IMPLEMENTATION_ISSUE
          c. If TEST_ISSUE: Fix test
          d. If IMPLEMENTATION_ISSUE: Fix implementation (developer)
          e. Re-run (max 5 iterations)
        </step>
        <step>Write ${SESSION_PATH}/tests/test-results.md</step>
        <step>Mark PHASE 6 as completed</step>
      </steps>
      <quality_gate>All tests pass OR user approves with known failures</quality_gate>
    </phase>

    <phase number="7" name="Completion">
      <objective>Generate comprehensive report</objective>
      <steps>
        <step>Mark PHASE 7 as in_progress</step>
        <step>
          Gather all artifacts:
          - requirements.md
          - architecture.md
          - implementation-log.md
          - reviews/code-review/consolidated.md
          - tests/test-results.md
          - Model performance statistics
        </step>
        <step>
          Generate final report: ${SESSION_PATH}/report.md
          Include:
          - Feature summary
          - Requirements fulfilled checklist
          - Architecture decisions
          - Implementation notes
          - Review feedback summary
          - Test coverage and results
          - Model performance statistics
          - Recommendations
        </step>
        <step>Update session-meta.json to "completed"</step>
        <step>Present summary to user</step>
        <step>Mark ALL tasks as completed</step>
      </steps>
      <quality_gate>Report generated successfully</quality_gate>
    </phase>
  </workflow>
</instructions>

<orchestration>
  <allowed_tools>
    - Task (delegate to agents)
    - AskUserQuestion (user input, model selection)
    - Bash (git commands, test execution, quality checks)
    - Read (read files, review outputs)
    - TodoWrite (progress tracking)
    - Glob (find files)
    - Grep (search patterns)
  </allowed_tools>

  <forbidden_tools>
    - Write (agents write, not orchestrator)
    - Edit (agents edit, not orchestrator)
  </forbidden_tools>

  <parallel_execution_pattern>
    **Single message with multiple Task calls executes in parallel:**

    Task: {agent1}
      Prompt: "..."
    ---
    Task: {agent2}
      Prompt: "..."
    ---
    Task: {agent3}
      Prompt: "..."

    All 3 execute SIMULTANEOUSLY (3x speedup)

    **Use for:**
    - Multi-model plan review (Phase 3)
    - Independent implementation phases (Phase 4)
    - Multi-model code review (Phase 5)
  </parallel_execution_pattern>

  <model_selection>
    **Recommended models for validation:**

    Paid (best quality):
    - x-ai/grok-code-fast-1 (fast, coding specialist)
    - google/gemini-2.5-flash (fast, affordable)
    - openai/gpt-5.1-codex (advanced analysis)

    Free (zero cost):
    - qwen/qwen3-coder:free (coding specialist, 262K context)
    - mistralai/devstral-2512:free (dev-focused)

    Always include:
    - Internal Claude (embedded, FREE)

    **Use AskUserQuestion with multiSelect: true**
  </model_selection>
</orchestration>

<examples>
  <example name="Full Stack Feature with Multi-Model Validation">
    <user_request>/dev:feature User authentication with OAuth2</user_request>
    <execution>
      PHASE 0: Create session dev-feature-user-auth-20260105-143022-a3f2

      PHASE 1: Requirements (2 rounds)
        Round 1: "Which OAuth providers? What user data to store?"
        Round 2: "Session duration? Refresh token strategy?"
        Result: requirements.md approved

      PHASE 2: Research
        User declines internet research
        Skip to Phase 3

      PHASE 3: Planning (1 iteration)
        Architect creates plan
        3 models review in parallel (Grok, Gemini, Internal)
        Consensus: 1 HIGH issue (rate limiting)
        Architect revises, re-review: PASS
        User approves

      PHASE 4: Implementation (parallel where possible)
        Sequential: Database schema
        Parallel: AuthService, TokenManager, UserRepository
        Parallel: LoginUI, AuthContext
        Sequential: Integration
        All quality checks pass

      PHASE 5: Code Review (1 iteration)
        3 models review in parallel
        Verdict: PASS (0 CRITICAL, 1 HIGH)
        No fixes needed

      PHASE 6: Testing (2 iterations)
        Test architect creates tests from requirements
        Round 1: 3 tests fail (implementation issue)
        Developer fixes
        Round 2: All tests pass

      PHASE 7: Report generated
        Duration: 35 minutes
        Files: 12 created
        Tests: 24 passing
    </execution>
  </example>

  <example name="Feature with Review Loop">
    <user_request>/dev:feature Add rate limiting middleware</user_request>
    <execution>
      PHASE 1-4: Complete normally

      PHASE 5: Code Review (3 iterations)
        Iteration 1: FAIL (2 CRITICAL)
          - Redis connection not pooled
          - Rate limit bypass possible
        Developer fixes

        Iteration 2: CONDITIONAL (4 HIGH)
          - Error messages expose internals
          - Missing metrics
          - Config not validated
          - Tests insufficient
        Developer fixes

        Iteration 3: PASS (0 CRITICAL, 2 HIGH)
        User approves CONDITIONAL

      PHASE 6-7: Complete normally
    </execution>
  </example>

  <example name="Feature Reaching Iteration Limit">
    <user_request>/dev:feature Complex data pipeline</user_request>
    <execution>
      PHASE 1-5: Complete normally

      PHASE 6: Testing (5 iterations - LIMIT REACHED)
        Iterations 1-5: Persistent test failures
        Analysis: Edge case in requirements ambiguous

        Escalation to user:
        "TDD loop reached max iterations (5).
         Remaining failures: test_edge_case_1, test_edge_case_2

         Options:
         1. Continue anyway (document known failures)
         2. Allow 5 more iterations
         3. Cancel
         4. Take manual control"

        User chooses: Option 1 (continue with documented failures)

      PHASE 7: Report includes known test failures
    </execution>
  </example>
</examples>

<error_recovery>
  <strategy scenario="Agent task fails">
    <recovery>
      1. Log failure with details
      2. Retry once with same parameters
      3. If still fails: Escalate to user
      4. Offer: Retry / Skip / Cancel
    </recovery>
  </strategy>

  <strategy scenario="External model timeout">
    <recovery>
      1. Wait additional 30 seconds
      2. If still not responding: Mark as failed
      3. Continue with successful models
      4. Note in consolidated report
      5. Adjust consensus calculations
    </recovery>
  </strategy>

  <strategy scenario="All external models fail">
    <recovery>
      1. Fall back to internal-only review
      2. Notify user: "External models unavailable"
      3. Proceed with single-reviewer mode
    </recovery>
  </strategy>

  <strategy scenario="Iteration limit reached">
    <recovery>
      Present to user:
      "Maximum iterations ({N}) reached for {phase}.

       Current Status: {status}
       Remaining Issues: {issues}

       Options:
       1. Continue anyway (accept current state)
       2. Allow {N} more iterations
       3. Cancel feature development
       4. Take manual control"
    </recovery>
  </strategy>

  <strategy scenario="Tests keep failing">
    <recovery>
      1. Analyze which tests keep failing
      2. Determine: TEST_ISSUE or IMPLEMENTATION_ISSUE
      3. If unclear: Present analysis to user
      4. Options: Accept failures / Continue / Cancel
      5. If accept: Document in report
    </recovery>
  </strategy>
</error_recovery>

<formatting>
  <communication_style>
    - Show clear progress through 7 phases
    - Display iteration counts: "Review iteration 2/3"
    - Highlight quality gate results
    - Present multi-model consensus when available
    - Keep summaries brief (max 50 lines)
    - Link to detailed files
  </communication_style>

  <completion_message>
## Feature Development Complete

**Feature**: {feature_name}
**Stack**: {detected_stack}
**Duration**: {total_time}
**Session**: ${SESSION_PATH}

**Phases Completed**:
- [x] Requirements (3 clarifying questions)
- [x] Research (skipped)
- [x] Planning (2 models, 1 revision)
- [x] Implementation (5 phases)
- [x] Code Review (PASS, 2 iterations)
- [x] Testing (24 tests, 2 iterations)
- [x] Report generated

**Quality Summary**:
- Implementation: All checks pass
- Review: PASS (0 CRITICAL, 1 HIGH)
- Tests: 24/24 passing

**Model Performance** (if multi-model):
| Model | Time | Issues | Quality |
|-------|------|--------|---------|
| claude | 32s | 8 | 95% |
| grok | 45s | 6 | 87% |

**Artifacts**:
- Requirements: ${SESSION_PATH}/requirements.md
- Architecture: ${SESSION_PATH}/architecture.md
- Report: ${SESSION_PATH}/report.md
- Tests: ${SESSION_PATH}/tests/

Ready for deployment!
  </completion_message>
</formatting>
```

---

## Implementation Checklist

### New Files to Create

1. **Command:** `plugins/dev/commands/feature.md` (update existing)
2. **Agent:** `plugins/dev/agents/test-architect.md` (new)
3. **Skill:** `plugins/dev/skills/feature-workflow/SKILL.md` (optional, for documentation)

### Dependencies

- `orchestration:multi-model-validation` skill
- `orchestration:quality-gates` skill
- `orchestration:model-tracking-protocol` skill
- `dev:context-detection` skill
- `dev:universal-patterns` skill

### Tool Requirements

- Task (delegation)
- AskUserQuestion (user input, model selection with multiSelect)
- Bash (git, tests, quality checks)
- Read (file reading)
- Write (agent outputs only)
- Edit (agent modifications only)
- TodoWrite (progress tracking)
- Glob, Grep (file discovery)

---

## Summary

This design document provides a comprehensive specification for the enhanced `/dev:feature` command v2.0, implementing all 15 requirements:

1. **7-Phase Orchestration** with clear workflow
2. **Iterative Requirements Gathering** with max 3 rounds
3. **Optional Research Phase** with user control
4. **Multi-Model Planning Validation** with blinded voting
5. **Parallel Implementation** for independent phases
6. **Multi-Model Code Review Loop** with max 3 iterations
7. **Black Box Testing** with isolated test architect
8. **File-Based Communication** preventing context pollution
9. **Brief Agent Returns** (max 3 lines)
10. **PROXY_MODE Delegation** for external models
11. **Quality Gates** at every phase
12. **Iteration Limits** with escalation
13. **Error Recovery** strategies
14. **Comprehensive Reports** with model statistics
15. **Test Independence** - tests are authoritative

The design follows XML standards, integrates TodoWrite, supports multi-model validation via Claudish, and includes concrete examples demonstrating the workflow.
