# Design Plan Review: /dev:research Command

**Reviewer**: Claude Haiku 4.5 (local analysis)
**Files Reviewed**:
- `ai-docs/sessions/agentdev-researcher-20260106-091810-53a5/design.md`
- `ai-docs/sessions/agentdev-researcher-20260106-091810-53a5/research-findings.md`

**Date**: 2026-01-06
**Status**: PASS with Recommendations

---

## Executive Summary

The `/dev:research` command design is well-structured with clear orchestration patterns, sound convergence logic, and thoughtful error recovery strategies. The design appropriately separates orchestrator and agent responsibilities, implements sophisticated file-based communication, and includes practical fallback strategies. **Overall Score: 8.2/10**

---

## Focus Area Reviews

### 1. Orchestrator vs Agent Responsibility Boundaries

**Score: 8.5/10**

**Strengths:**
- Clear delineation: Orchestrator manages state/coordination, agents perform research
- Appropriate tool restrictions: Orchestrator forbidden from Write/Edit (agents own these)
- Task delegation explicit: All research delegated via Task tool
- File-based async pattern prevents context bloat

**Issues Found:**
- **[MEDIUM]** Phase 0 has orchestrator creating directories and config files with Bash
  - This crosses into "implementation detail" that arguably belongs to agents
  - Recommendation: Consider if agents should initialize their own session state

- **[LOW]** Unclear whether agents validate $SESSION_PATH before writing
  - Design assumes agents receive correct path in prompt
  - Recommend: Add validation step in agent instructions

**Specific Examples:**
```xml
✓ Correct (Orchestrator Role):
  <step>Launch Planner agent: (delegates via Task)</step>
  <step>Mark PHASE X as in_progress (TodoWrite)</step>
  <step>Present approval gate (AskUserQuestion)</step>

✗ Questionable (Orchestrator Creating Config):
  <step>Detect model strategy via Bash, write to config.env</step>
  → Better: Pass detected strategy to agents as environment variable
```

**Recommendation**: Move session initialization concerns into a pre-flight agent or have orchestrator pass detected config without file creation.

---

### 2. File-Based Communication Patterns

**Score: 9.0/10**

**Strengths:**
- Excellent isolation: Each explorer writes to unique file (explorer-{N}.md)
- Clear directory structure: findings/, synthesis/ folders organize outputs
- Session-based: Each research gets unique SESSION_ID preventing cross-contamination
- Audit trail: All artifacts preserved for reproducibility
- Parallel-safe: No file lock contention (each agent writes to unique file)

**Examples (Well Done):**
```
✓ Each Explorer → Unique Output:
  explorer-1.md
  explorer-2.md
  explorer-3.md
  (No conflicts, safe parallel execution)

✓ Multi-Iteration History:
  synthesis/iteration-1.md
  synthesis/iteration-2.md
  synthesis/iteration-3.md
  (Full convergence history preserved)

✓ Session Isolation:
  ai-docs/sessions/dev-research-{topic}-{timestamp}-{hash}/
  (No collision risk, easy cleanup)
```

**Minor Issue:**
- **[LOW]** search-queries.md is not iterated during refinement
  - Currently: Write once in Phase 2
  - For iterative query refinement: Should append new queries to preserve history
  - Impact: Minimal (convergence check can identify new queries needed)

**Recommendation**: Consider versioning search-queries as search-queries-iteration-{N}.md for complete audit trail during iterative refinement.

---

### 3. Error Recovery Strategies

**Score: 8.0/10**

**Strengths:**
- Comprehensive error scenarios covered (agent failure, web unavailable, no convergence, rate limits)
- Graceful degradation: Switch model strategies without aborting
- Partial success handling: Minimum 1 successful explorer allows continuation
- Recovery actions specific: Each scenario has concrete recovery steps
- User escalation: Options provided at limits (accept/extend/cancel)

**Well-Designed Recovery Example:**
```xml
<strategy scenario="Explorer agent fails">
  1. Log failure (creates audit trail)
  2. If minimum met (≥1 success): Proceed with available findings
  3. If all failed: Escalate to user
  4. Offer: Retry / Skip / Cancel
```

**Issues Found:**

- **[HIGH]** Model fallback sequence has potential issue:
  ```
  Primary: GOOGLE_API_KEY → google/gemini-3-flash-preview
  Secondary: OPENROUTER_API_KEY → or/google/gemini-2.5-flash
  Fallback: Native → haiku
  ```
  Problem: Code mentions "or/google/gemini-2.5-flash" but research findings suggest `google/gemini-3-pro-preview` is available. Model ID inconsistency.

  Recommendation: Verify exact model IDs with `claudish --top-models` before finalizing.

- **[MEDIUM]** Rate limit recovery (wait 60s + retry) may be too aggressive
  - 60 second wait blocks entire research pipeline
  - Better: Allow user to pause and resume mid-session (already noted in "cancel" recovery)
  - Current checkpoint system could support this

- **[LOW]** No recovery strategy for "Synthesis agent fails"
  - Explorer agents have recovery (Phase 3 can continue)
  - But if Synthesizer crashes, entire pipeline stalls
  - Recommendation: Add specific recovery (retry synthesis, checkpoint previous synthesis)

**Recommended Addition:**
```xml
<strategy scenario="Synthesis fails">
  1. If previous synthesis exists (iteration N-1):
     Use it as fallback, continue to convergence check
  2. If first synthesis:
     Escalate to user: "Unable to synthesize findings. Options:
     a) Re-run synthesis
     b) Present raw findings
     c) Cancel research"
</strategy>
```

---

### 4. Phase Transition Logic

**Score: 8.5/10**

**Strengths:**
- Clear phase sequence: 7 phases with explicit objectives
- Transition rules well-defined: Each phase has quality_gate exit criterion
- State management: TodoWrite marks phase in_progress/completed
- Iteration tracking: Metadata updated with counts
- Loop-back support: PHASE 5 can return to PHASE 3 for refinement

**Well-Designed Transitions:**
```xml
PHASE 1 (Planning) → Quality Gate: "Research plan approved by user"
PHASE 2 (Questions) → Quality Gate: "Search queries generated"
PHASE 3 (Exploration) → Quality Gate: "At least 1 Explorer completed"
PHASE 4 (Synthesis) → Quality Gate: "Synthesis document created"
PHASE 5 (Convergence) → Decision: Proceed to Phase 6 OR Loop to Phase 3
PHASE 6 (Finalization) → Quality Gate: "Final report generated"
```

**Logic Issues Found:**

- **[HIGH]** Phase 5 convergence check uses k=3 but doesn't specify window clearly:
  ```
  Criterion 1: "If same 80%+ of key findings for 3 consecutive attempts"

  Problem: What if only 2 synthesis iterations completed?
  Design says: "if len(syntheses) < 3: return False"

  This means research ALWAYS requires 3 iterations minimum before convergence possible.
  If findings converge on iteration 1 and 2, must wait for iteration 3 to confirm.
  ```

  This is actually correct behavior (need k=3 baseline) but could be clearer.

- **[MEDIUM]** PHASE 5 has dual decision point:
  ```
  IF converged AND coverage met:
    → PHASE 6 (Finalization)

  ELSE IF within iteration limits:
    → Return to PHASE 3

  ELSE IF limit reached:
    → Ask user: accept/extend/narrow
  ```

  Problem: After user chooses "extend", what happens?
  - Design says "Allow 3 more exploration rounds"
  - Implementation: Re-enter PHASE 3 loop
  - But iteration counter: Does +3 mean new limit (old+3) or add to existing?

  Recommendation: Clarify: "Reset exploration limit to current_iteration + 3"

- **[MEDIUM]** PHASE 1 refinement loop (up to 2 planning iterations):
  ```
  Step 3: "If refinement requested: Re-launch Planner with feedback"
  Step 4: Mark PHASE 1 as completed

  Problem: If re-launch happens, where's the second iteration tracking?
  ```

  Recommendation: Update to:
  ```xml
  <step>Loop: While iteration < 2 AND user wants refinement:
    Re-launch Planner with feedback (increment counter)
  </step>
  ```

**Recommended Clarifications:**
1. Document the k=3 window: "Requires 3 sequential synthesis iterations before convergence possible"
2. Clarify iteration extension: "Re-enter loop with limit = current_iteration + 3"
3. Add iteration counter to PHASE 1 refinement steps

---

### 5. Quality Metrics Completeness

**Score: 7.5/10**

**Strengths:**
- 5 quality metrics defined: Structure, Factual Integrity, Precision, Recall, Agreement
- Source quality classification: High/Medium/Low with examples
- Convergence metrics specific: k=3 window, 80% threshold, saturation <10% new info
- Source count thresholds: 5 for basic, 10+ for comprehensive

**Metrics Defined:**
| Metric | Threshold | Completeness |
|--------|-----------|--------------|
| Structure Control | Plan exists and followed | ✓ Good |
| Factual Integrity | 90%+ claims sourced | ✓ Good |
| Knowledge Precision | Cross-verified claims | ? Vague |
| Knowledge Recall | All sub-questions addressed | ✓ Good |
| Agreement Score | 60%+ multi-source support | ✓ Good |

**Issues Found:**

- **[HIGH]** Missing explicit quality checks in the phases:
  - Metrics defined in `<knowledge>` section
  - But phases don't *enforce* them
  - No step like "VERIFY: Factual Integrity = 90%+ sourced"
  - Recommendation: Add quality gate in PHASE 4 (Synthesis) to check metrics

- **[MEDIUM]** "Factual Integrity: 90%+ claims sourced" is mentioned but never measured:
  - How does orchestrator verify this?
  - Does Synthesizer agent report this?
  - No explicit check in phases
  - Recommendation: Add to PHASE 4 synthesis output format:
    ```markdown
    ## Quality Metrics (This Synthesis)
    - Factual Integrity: 95% claims sourced
    - Agreement Score: 72% (multi-source support)
    - Structure: 100% (followed research plan)
    ```

- **[MEDIUM]** Knowledge Precision metric ("cross-verified claims") lacks methodology:
  - How is cross-verification performed?
  - What's a "verified" vs "unverified" claim?
  - Recommendation: Add cross-verification algorithm or examples

- **[MEDIUM]** PHASE 5 Convergence Criterion 2 uses "10% new information" but metrics say "Agreement Score" is separate:
  - Saturation check (10% new) ≠ Agreement check (60% multi-source)
  - These could conflict: Converged by saturation but low agreement
  - Recommendation: Clarify resolution: "Require BOTH convergence AND agreement >60%"

**Missing Quality Gates:**
```xml
✗ Not Defined:
- Minimum Agreement Score for convergence (60% assumed, not enforced)
- Minimum Factual Integrity (90% mentioned, not checked)
- Source distribution (how many high vs medium vs low?)

✓ Should Add:
<phase number="4" name="Quality Check">
  <steps>
    <step>Verify Factual Integrity >= 90%</step>
    <step>Verify Agreement Score >= 60%</step>
    <step>Verify Source distribution: ≥50% high quality</step>
  </steps>
</phase>
```

**Recommendation**: Add PHASE 4.5 "Quality Gate" to enforce metrics before accepting synthesis.

---

## Critical Findings

### Finding 1: Model ID Inconsistency [HIGH]

**Issue**: Design mentions conflicting Gemini model IDs.

**In design.md:**
- Line 133: `google/gemini-3-flash-preview`
- Line 154: `or/google/gemini-2.5-flash`

**In research-findings.md:**
- Line 128: `google/gemini-exp-1206`
- Line 129: `google/gemini-2.5-flash` (via claudish)

**Problem**: Model names don't match current OpenRouter offerings.

**Resolution**: Run `claudish --top-models` to verify current available models before implementation. Update design with actual model IDs.

---

### Finding 2: Convergence Logic Assumes Multiple Iterations [MEDIUM]

**Issue**: k=3 convergence criterion requires minimum 3 synthesis iterations.

**Current Logic:**
```python
if len(syntheses) < 3:
    return False
```

**Implication**: Even if findings converge on iteration 2, research continues to iteration 3 to confirm.

**Question**: Is this desired?
- **Pro**: Better confidence (k=3 window proven stable)
- **Con**: Potentially wasteful if findings clearly converged

**Recommendation**: Document as intentional design choice: "Minimum 3 iterations required for convergence confidence."

---

### Finding 3: Missing Quality Gate Between Phases [MEDIUM]

**Issue**: Quality metrics defined but not enforced in workflow.

**Current State:**
- Metrics listed in `<knowledge>` section (informational)
- Phases don't check metrics before proceeding

**Problem**: Synthesis could be generated with 50% claims unsourced, and workflow continues.

**Recommendation**: Add quality validation:
```xml
<phase number="4.5" name="Quality Validation">
  <objective>Verify synthesis meets quality thresholds</objective>
  <steps>
    <step>Measure Factual Integrity (% claims sourced)</step>
    <step>Measure Agreement Score (% multi-source support)</step>
    <step>If metrics < thresholds: flag in report but proceed</step>
    <step>If severe failures: escalate to user</step>
  </steps>
</phase>
```

---

### Finding 4: Unclear Iteration Extension Behavior [MEDIUM]

**Issue**: PHASE 5 allows user to "extend with 3 more rounds" but doesn't specify iteration tracking.

**Current Logic:**
```xml
ELSE IF iteration limit reached:
  → Ask user: accept/extend/narrow

  User chooses: extend
  → "Allow 3 more exploration rounds"
```

**Problem**: What's the new limit?
- Option A: `new_limit = current_iteration + 3`
- Option B: `new_limit = 5 + 3 = 8` (reset)
- Option C: `new_limit = config.max_iterations` (ignore extension)

**Recommendation**: Clarify in design:
```xml
<step>
  If user extends:
    new_limit = current_iteration + 3
    Update session metadata: maxExploration = new_limit
    Return to PHASE 3 (Web Exploration)
</step>
```

---

## Recommendations by Priority

### CRITICAL (Must Fix Before Implementation)

1. **Model ID Verification**
   - [ ] Run `claudish --top-models` to get current Gemini models
   - [ ] Update design.md with actual model IDs
   - [ ] Test model detection logic against real API
   - Impact: Model fallback will fail with wrong IDs

### HIGH (Should Fix)

2. **Add Quality Validation Phase**
   - [ ] Insert PHASE 4.5 or add quality checks to PHASE 4 synthesis step
   - [ ] Measure and report Factual Integrity, Agreement Score
   - [ ] Define failure thresholds (minimum acceptable quality)
   - Impact: Ensures research quality standards met

3. **Clarify Iteration Extension Behavior**
   - [ ] Specify: new_limit = current_iteration + 3
   - [ ] Add to session metadata tracking
   - [ ] Document in error recovery section
   - Impact: Prevents confusion during user interaction

### MEDIUM (Should Consider)

4. **Add Synthesis Failure Recovery**
   - [ ] Specific recovery steps if Synthesizer agent crashes
   - [ ] Option to use previous synthesis iteration as fallback
   - Impact: Prevents pipeline stall on synthesis failures

5. **Clarify k=3 Convergence Window**
   - [ ] Document: "Minimum 3 iterations required for convergence"
   - [ ] Explain rationale: Confidence in stability
   - Impact: Sets user expectations for research duration

6. **Version Search Queries Across Iterations**
   - [ ] Change search-queries.md to search-queries-iteration-{N}.md
   - [ ] Track query evolution through research iterations
   - Impact: Complete audit trail, helps debug poor results

### LOW (Nice to Have)

7. **Cross-Verification Methodology**
   - [ ] Define what "cross-verified claims" means
   - [ ] Provide examples of verification algorithm
   - Impact: Clarifies Knowledge Precision metric

8. **Move Session Initialization to Agent**
   - [ ] Consider having initial agent create session state
   - [ ] Or clearly document that orchestrator owns this responsibility
   - Impact: Cleaner separation of concerns

---

## Scoring Breakdown

| Area | Score | Comments |
|------|-------|----------|
| **Orchestrator Boundaries** | 8.5/10 | Clear delegation, minor concerns about Bash usage |
| **File Communication** | 9.0/10 | Excellent isolation, minor versioning suggestion |
| **Error Recovery** | 8.0/10 | Comprehensive, but model ID issue and synthesis failure gap |
| **Phase Transitions** | 8.5/10 | Clear sequence, some iteration logic could be clearer |
| **Quality Metrics** | 7.5/10 | Defined but not enforced in phases, missing explicit gates |
| **Overall Design** | 8.2/10 | Well-structured, practical, needs refinement before implementation |

---

## Questions for Clarification

1. **Convergence Minimum Iterations**: Is k=3 requirement intentional to avoid false convergence positives?

2. **Quality Metrics Enforcement**: Should synthesis fail if Factual Integrity < 90%, or just flag in report?

3. **Iteration Extension**: When user chooses "extend 3 more rounds", is this cumulative or absolute limit?

4. **Session Cleanup**: After research completes, should orchestrator delete $SESSION_DIR or preserve for audit?

5. **Agent Parallelism**: Maximum 3 explorers simultaneously—is this a hard limit or configurable?

6. **Local Investigation**: In PHASE 3, does local investigation (Glob/Grep) count toward explorer agents, or is it separate?

---

## Conclusion

The `/dev:research` command design demonstrates excellent understanding of orchestration patterns, file-based communication, and error recovery. The 4-stage research pipeline is well-motivated by research literature, and the convergence criteria are sophisticated.

The main gaps are:
1. **Model IDs need verification** (critical before implementation)
2. **Quality metrics defined but not enforced** (gap between theory and practice)
3. **Some iteration logic unclear** (minor ambiguities in phase transitions)

With the recommended changes, this design will produce a robust, production-ready deep research orchestrator.

**Status**: PASS with MEDIUM-priority recommendations before implementation.

---

## Sign-Off

**Reviewer**: Claude Haiku 4.5
**Date**: 2026-01-06
**Confidence**: High (design well-documented, issues clearly identified, solutions specific)

**Ready for**: Agent implementation (researcher.md, synthesizer.md) with critical fixes applied.
