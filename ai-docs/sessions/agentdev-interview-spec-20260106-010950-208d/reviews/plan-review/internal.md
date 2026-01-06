# Design Review: /dev:interview Command

**Reviewer**: Internal Claude (Opus 4.5)
**Design Document**: ai-docs/sessions/agentdev-interview-spec-20260106-010950-208d/design.md
**Review Date**: 2026-01-06
**Status**: CONDITIONAL

---

## Summary

| Category | Issues |
|----------|--------|
| CRITICAL | 1 |
| HIGH | 3 |
| MEDIUM | 5 |
| LOW | 3 |

**Verdict**: CONDITIONAL - Needs 1 CRITICAL and 3 HIGH issues addressed before implementation.

---

## 1. Design Completeness

### CRITICAL Issues

#### ISSUE C1: Write Tool Forbidden but Required for Spec Synthesis
- **Category**: Design Inconsistency
- **Location**: Tool Recommendations section (line 1052-1068) vs Phase 4 Spec Synthesis
- **Description**: The design explicitly lists Write as a "Forbidden Tool" but Phase 4 (Spec Synthesis) requires writing `spec.md`, `tasks.md`, and other artifacts. The orchestrator cannot delegate spec writing because it's synthesizing information from the interview session itself.
- **Impact**: Command will be unable to produce core deliverables. The orchestrator MUST either write files directly or have a dedicated synthesis agent.
- **Fix Options**:
  1. Add Write to allowed-tools (break orchestrator pattern)
  2. Create a `spec-writer` agent that receives interview log and produces spec (recommended)
  3. Delegate to existing `architect` agent for spec synthesis

### HIGH Priority Issues

#### ISSUE H1: Missing Agent for Interview Log Writing
- **Category**: Delegation Gap
- **Location**: Phase 2 workflow, step (d)
- **Description**: Design specifies "Record answers in interview log" but orchestrator cannot Write. The interview log is mentioned but no agent is delegated to maintain it.
- **Impact**: Interview history won't be persisted, breaking audit trail and spec synthesis.
- **Fix**: Either allow orchestrator to Write interview log OR create a lightweight `scribe` agent that receives Q&A and appends to log file.

#### ISSUE H2: Stack-Detector Agent Launch Missing SESSION_PATH Usage
- **Category**: Implementation Specification
- **Location**: Phase 1, step 2
- **Description**: The prompt to stack-detector says "Save to: ${SESSION_PATH}/context.json" but doesn't explicitly include SESSION_PATH in the delegation. Compare to `/dev:feature` which includes "SESSION_PATH: ${SESSION_PATH}" prefix in all agent prompts.
- **Impact**: Agent may not know where to save output, causing file not found errors in later phases.
- **Fix**: Add explicit SESSION_PATH passing pattern consistent with `/dev:feature`:
  ```
  Prompt: "SESSION_PATH: ${SESSION_PATH}
           Detect ALL technology stacks in this project.
           Save to: ${SESSION_PATH}/context.json"
  ```

#### ISSUE H3: No Resume Capability Documented
- **Category**: Missing Feature
- **Location**: Entire workflow section
- **Description**: Unlike `/dev:feature` which mentions `--resume {SESSION_ID}`, the interview command has no resume capability documented despite having session-meta.json with checkpoint structure.
- **Impact**: Long interviews (10+ rounds) could be lost if interrupted. Users may abandon feature due to risk.
- **Fix**: Add resume handling in Phase 0 that checks for existing session and offers to resume.

### MEDIUM Priority Issues

#### ISSUE M1: Ultrathink Not Explicitly Invokable
- **Category**: Implementation Ambiguity
- **Location**: Phase 3 (Asset Collection), step 3; Knowledge section
- **Description**: Design mentions "Use extended thinking (ultrathink)" but doesn't specify HOW to invoke it. Claude Code doesn't have explicit ultrathink API - it's triggered by prompt patterns or model configuration.
- **Impact**: Implementer won't know how to enable extended thinking.
- **Fix**: Either:
  1. Remove ultrathink references and use standard reasoning
  2. Specify prompt patterns that trigger extended thinking (e.g., "Think step by step...")
  3. Note that this requires opus model or specific prompt engineering

#### ISSUE M2: Category Coverage Tracking Mechanics Unclear
- **Category**: Implementation Specification
- **Location**: Phase 2, step (e); Phase 1 step 5
- **Description**: Focus-areas.md mentions "% complete" for each category but no algorithm is provided for calculating coverage. How does "70% coverage" get determined?
- **Impact**: Implementer will have to invent coverage calculation, leading to inconsistent behavior.
- **Fix**: Define coverage calculation:
  ```
  Coverage = (answered_questions / expected_questions_in_category) * 100
  Expected questions per category: 3-5 minimum
  Category complete when: Key questions answered AND user confirms no more needs
  ```

#### ISSUE M3: AskUserQuestion Format Not Specified for Asset Collection
- **Category**: Implementation Specification
- **Location**: Phase 3, step 2
- **Description**: Design shows a multi-part asset collection question with mixed formats (text input, selection, etc.) but doesn't specify if this should be single AskUserQuestion with multiSelect or multiple sequential questions.
- **Impact**: UX inconsistency - implementer may create awkward multi-modal questions.
- **Fix**: Split into separate AskUserQuestion calls:
  1. API spec (text input with default 'none')
  2. Design assets (text input with default 'none')
  3. Design system (multiSelect from predefined options)
  4. Inspiration apps (text input with default 'none')

#### ISSUE M4: Interview Log Format Missing Structure for Follow-up Triggers
- **Category**: Incomplete Specification
- **Location**: Phase 0, step 5; Phase 2, step (d)
- **Description**: Design mentions "Follow-up triggers identified" in interview log but doesn't specify the format or what constitutes a trigger.
- **Impact**: Follow-up triggers may not be captured consistently.
- **Fix**: Add trigger format:
  ```markdown
  ## Round N

  ### Questions
  1. Q: ...
     A: ...
     Triggers: [API_SPEC_NEEDED, DESIGN_SYSTEM_TBD]
  ```

#### ISSUE M5: Existing Spec Gap Analysis Algorithm Not Defined
- **Category**: Implementation Specification
- **Location**: Phase 1, step 4
- **Description**: Design says "Analyze for gaps" but doesn't specify how to systematically identify gaps in an existing spec.
- **Impact**: Gap detection will be ad-hoc, potentially missing important areas.
- **Fix**: Add gap detection checklist:
  ```
  For each category (Functional, Non-Functional, etc.):
  - Does spec explicitly address this category?
  - Are acceptance criteria testable?
  - Are constraints quantified (not just "fast" but "< 200ms")?
  - Are edge cases documented?
  ```

### LOW Priority Issues

#### ISSUE L1: Completion Message Template Missing Interview Duration
- **Category**: Minor Omission
- **Location**: Formatting section, completion_message
- **Description**: Template shows "Duration: {time}" but Phase 0 doesn't record start time.
- **Impact**: Duration won't be available in completion message.
- **Fix**: Add `startedAt` timestamp to session-meta.json in Phase 0.

#### ISSUE L2: Maximum Amendment Rounds Mentioned But Not Tracked
- **Category**: Minor Inconsistency
- **Location**: Phase 4, step 4
- **Description**: "(Max 2 amendment rounds)" mentioned but no tracking mechanism specified.
- **Impact**: Could exceed amendment limit without warning.
- **Fix**: Add amendment counter to session state or TodoWrite tracking.

#### ISSUE L3: Example 3 References Non-Existent "Ultrathink Trigger"
- **Category**: Documentation Inconsistency
- **Location**: Examples section, Example 3
- **Description**: Example shows "Trigger ultrathink analysis" but the trigger mechanism isn't defined in the proactive_detection section.
- **Impact**: Confusing for implementer.
- **Fix**: Add ultrathink to proactive_detection triggers or clarify in example that this is manual detection.

---

## 2. YAML Frontmatter Structure

### Assessment: PASS with Notes

**Current Structure:**
```yaml
---
description: |
  Comprehensive specification interview orchestrator with intelligent questioning.
  Workflow: INIT -> CONTEXT -> INTERVIEW LOOP -> ASSETS -> SYNTHESIS -> TASKS
  Features: 5 Whys technique, context-aware questions, ultrathink tech suggestions,
  proactive asset collection (API specs, Figma, design refs), task breakdown.
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
skills: dev:context-detection, dev:universal-patterns, dev:api-design, dev:design-references
---
```

**Strengths:**
- Description includes workflow overview
- Key features mentioned
- Appropriate orchestrator tools (no Write/Edit)
- Relevant skills referenced

**Suggestions:**
1. Add `orchestration:quality-gates` skill (used implicitly for iteration limits)
2. Consider adding `orchestration:todowrite-orchestration` for consistency with `/dev:feature`
3. Workflow naming could match phase names: INIT -> CONTEXT -> INTERVIEW -> ASSETS -> SYNTHESIS -> TASKS

---

## 3. XML Structure Quality

### Assessment: PASS

**Strengths:**
- Proper `<role>` definition with identity, expertise, mission
- Clear `<critical_constraints>` section
- Well-structured `<workflow>` with numbered phases
- Quality gates defined for each phase
- Comprehensive `<knowledge>` section with categories
- Good `<examples>` covering common scenarios
- Complete `<error_recovery>` strategies
- Professional `<formatting>` with completion template

**XML Standards Compliance:**
- Proper nesting
- Semantic attributes used (number, name, priority)
- Code blocks properly formatted within tags

**Minor Note:**
- The `<question_categories>` use `priority="high|medium|low"` which aligns with standards

---

## 4. Interview Design Quality

### Question Categories: EXCELLENT

The 7 question categories are well-designed:
1. Functional Requirements - Core coverage
2. Non-Functional Requirements - Often overlooked, good inclusion
3. User Experience - Human-centered design awareness
4. Edge Cases & Errors - Critical for robust specs
5. Integration Points - External dependencies captured
6. Constraints & Trade-offs - Business reality included
7. Technical Preferences - Tech stack alignment

### 5 Whys Technique: WELL INTEGRATED

The technique is properly documented with:
- Clear "when to use" triggers
- Step-by-step application guide
- Concrete example chain showing depth progression
- Stopping criteria (business justification, regulatory, user clarity)

### Non-Obvious Questions: GOOD

The questions are genuinely non-obvious:
- "What would make users choose this over the current solution?" (competitive differentiation)
- "Walk me through the most complex user journey" (boundary exploration)
- "What would cause this project to be considered a failure?" (success criteria inversion)
- "At what point would users most likely give up?" (friction identification)

**Improvement Opportunity:**
Add more domain-specific non-obvious questions based on detected stack (e.g., for React projects, ask about state management boundaries).

### Proactive Triggers: USEFUL

The keyword-based triggers for asset collection are practical:
- API keywords -> OpenAPI spec request
- UI keywords -> Figma/design request
- Scale keywords -> Non-functional deep-dive

**Gap:** No trigger for security-sensitive keywords (authentication, payment, PII).

---

## 5. Integration Quality

### Integration with Dev Plugin Commands: GOOD

| Command | When Proposed | Condition | Assessment |
|---------|---------------|-----------|------------|
| `/dev:feature` | Always | Primary next step | Correct |
| `/dev:create-style` | If design refs collected | Design system chosen | Correct |
| `/dev:architect` | If complex architecture | Large/uncertain tech | Correct |
| `/dev:ui-design` | If Figma provided | Has design assets | Correct |
| `/dev:implement` | For smaller features | Simple implementation | Correct |

**Alignment with Existing Commands:**

The interview command correctly positions itself as the FIRST step in the workflow, feeding into `/dev:feature`. This aligns with the existing command hierarchy.

**Session Path Consistency:**

Uses same SESSION_PATH pattern as `/dev:feature`:
```
ai-docs/sessions/dev-interview-{slug}-{timestamp}-{hash}/
```

### Skill Usage: APPROPRIATE

| Skill | Usage | Assessment |
|-------|-------|------------|
| `dev:context-detection` | Stack detection in Phase 1 | Correct |
| `dev:api-design` | Reference for API discussions | Correct |
| `dev:design-references` | Design system options | Correct |
| `dev:universal-patterns` | Tech recommendations | Correct |

**Missing Skill:**
Consider adding `orchestration:model-tracking-protocol` if ultrathink/external model recommendations are kept.

### Asset Collection: COMPREHENSIVE

Covers the key asset types:
- OpenAPI/Swagger specs
- Figma designs
- Design system preferences
- Inspiration apps
- Tech stack recommendations

**Gap:** No explicit handling for:
- Database schemas (existing or required)
- CI/CD requirements
- Deployment targets

---

## 6. Potential Issues

### Unrealistic Expectations

1. **Coverage Percentage**: The 70% coverage threshold is arbitrary and hard to measure objectively. Consider qualitative assessment instead: "All critical questions answered" rather than percentage.

2. **10 Interview Rounds**: For simple features, 10 rounds is excessive. For complex systems, it may be insufficient. Consider adaptive limits based on scope detection.

### Missing Error Recovery

1. **User Gives Conflicting Answers**: Only addressed in error_recovery but not with specific resolution steps.

2. **User Wants to Change Earlier Answer**: No mechanism to update previous answers in the interview log and propagate changes.

3. **Session Timeout/Disconnection**: Long interviews may span multiple sessions. No persistence strategy beyond session-meta.json.

### Design Gaps

1. **Multi-User Interviews**: What if multiple stakeholders need to provide input? Design assumes single user.

2. **Interview Prioritization**: If user has limited time, no guidance on which questions to prioritize.

3. **Partial Spec Generation**: If user ends early, can we still generate a partial spec? Currently unclear.

---

## Recommendations

### Must Fix Before Implementation

1. **Resolve Write tool contradiction** (C1) - Either add Write or delegate spec synthesis
2. **Add interview log writing mechanism** (H1) - Create scribe agent or allow orchestrator Write
3. **Fix SESSION_PATH passing to agents** (H2) - Consistent with /dev:feature pattern
4. **Add resume capability** (H3) - Long interviews need protection

### Should Fix

1. **Define coverage calculation** (M2) - Quantifiable metric or qualitative assessment
2. **Split asset collection questions** (M3) - Better UX with separate questions
3. **Clarify ultrathink mechanism** (M1) - Either remove or specify how to invoke

### Nice to Have

1. Add security keyword triggers
2. Add database schema asset collection
3. Define interview prioritization for time-limited users

---

## Approval Decision

**Status**: CONDITIONAL

**Rationale**: The design is comprehensive and well-structured, but has one critical issue (Write tool contradiction) and three high-priority issues that would prevent successful implementation. Once these are addressed, the design is ready for implementation.

**Required Changes:**
1. Fix C1: Resolve Write tool contradiction
2. Fix H1: Add interview log writing mechanism
3. Fix H2: Add consistent SESSION_PATH passing
4. Fix H3: Document resume capability

**Recommended Next Steps:**
1. Address CRITICAL and HIGH issues
2. Run another plan review (optional, can be internal-only)
3. Proceed to implementation with `agentdev:developer`

---

*Review completed by Internal Claude (Opus 4.5)*
*Session: agentdev-interview-spec-20260106-010950-208d*
