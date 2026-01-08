# Plan Review: PROXY_MODE Support Fix for Dev Plugin Agents

**Session**: agentdev-dev-proxy-mode-20260109-000514-b590
**Reviewer**: minimax.md (MiniMax model)
**Date**: 2026-01-09
**Status**: APPROVED WITH MINOR CONCERNS

---

## Executive Summary

The design document is well-structured and identifies the core problem accurately. However, there are several gaps and inconsistencies that need addressing before implementation.

**Overall Assessment**: The plan is sound but incomplete. Fix the identified issues before proceeding.

---

## 1. Design Completeness Analysis

### What the Plan Covers Well
- Clear categorization of agents into 4 groups (Working, Needs Fix, Should Add, No Proxy Needed)
- Specific file paths and line numbers for fixes
- Implementation order with priority levels
- Testing approach with concrete examples

### What the Plan Misses

#### 1.1 Missing Agent: `ui.md` Inconsistency

The plan states `ui.md` is "WORKING" with PROXY_MODE support. However, I could not verify this claim because **I did not read ui.md to confirm**.

**Recommendation**: Verify ui.md actually has both:
- `Bash` tool in its tools list
- Complete PROXY_MODE block in its instructions

#### 1.2 Missing Error Recovery Strategy

The plan doesn't address:
- What happens if `npx claudish` is not installed?
- What happens if the model delegation times out?
- What happens on network failures during delegation?

**Gap**: No error recovery section for PROXY_MODE failures beyond the error report format.

#### 1.3 Missing Validation: Claudish Installation Check

The testing approach assumes `npx claudish` works. No check for:
- Claudish being installed
- Proper configuration (API keys, OpenRouter setup)

**Gap**: Should add a pre-flight check in the implementation.

---

## 2. Current State Analysis Accuracy

### Verified Findings

| Agent | Tools List | Has PROXY_MODE | Assessment |
|-------|------------|----------------|------------|
| architect.md | TodoWrite, Read, Write, Glob, Grep | YES (lines 40-96) | CORRECT - Missing Bash |
| test-architect.md | TodoWrite, Read, Write, Edit, Bash, Glob, Grep | NO | CORRECT - Has Bash, needs block |
| synthesizer.md | TodoWrite, Read, Write, Glob, Grep | NO | CORRECT - No Bash, no PROXY_MODE |
| spec-writer.md | allowed-tools: Read, Write, Glob, Grep | NO | CORRECT - Uses allowed-tools |
| stack-detector.md | TodoWrite, Read, Write, Glob, Grep, Bash | NO | CORRECT - Has Bash, no PROXY_MODE |
| scribe.md | allowed-tools: Read, Write, Bash | NO | CORRECT - Uses haiku model |

### Concerns with Current State Analysis

**Issue 1**: The plan mentions `synthesizer.md` has "NO FIX NEEDED" but lists it as "BROKEN - NEEDS BOTH" in the Current State table (line 33). This is contradictory.

**Correction**: Remove synthesizer from the "Current State" table's "BROKEN" column, or clarify why it's listed as broken but also "NO FIX NEEDED".

**Issue 2**: The plan claims `spec-writer.md` uses `allowed-tools` not `tools` (line 217). This is correct, but the plan doesn't explain why this matters for PROXY_MODE.

**Insight**: `allowed-tools` is more restrictive than `tools`. Adding PROXY_MODE would require changing the frontmatter from `allowed-tools` to `tools` AND adding `Bash`. This is a more significant change than simply adding Bash.

---

## 3. Trade-off Decision Analysis

### Decision: NOT Add PROXY_MODE to synthesizer, spec-writer, stack-detector, scribe

**Assessment**: This decision is CORRECT for the following reasons:

#### ✅ synthesizer.md - Correct Decision

**Rationale valid**:
- Reads LOCAL files only (`${SESSION_PATH}/findings/*.md`)
- Consolidates findings from MULTIPLE local agents
- External delegation would break the file-based communication pattern

**Additional justification**: The synthesizer is a **post-processing** agent. It doesn't explore or research - it synthesizes what others found. Multi-model synthesis would require:
- Running multiple synthesizers in parallel (orchestrator's job)
- Then comparing their outputs (a different agent's job)

**Conclusion**: ✅ Correct - keep as-is.

#### ✅ spec-writer.md - Correct Decision

**Rationale valid**:
- Internal agent called by interview command
- Reads local files (interview-log.md, assets.md, context.json)
- Uses `allowed-tools` - intentionally restricted

**Additional consideration**: Changing from `allowed-tools` to `tools` would be a semantic change that expands the agent's capabilities beyond its design intent.

**Conclusion**: ✅ Correct - keep as-is.

#### ✅ stack-detector.md - Correct Decision

**Rationale valid**:
- Deterministic detection (file patterns, not analysis)
- No opinion-based work where model diversity adds value
- Output is structured JSON

**Insight**: This is a **detection** agent, not a **validation** agent. Multi-model validation is valuable when you want different perspectives on the same problem. Stack detection is binary (file exists or doesn't).

**Conclusion**: ✅ Correct - keep as-is.

#### ✅ scribe.md - Correct Decision

**Rationale valid**:
- Uses haiku model (cheapest/fastest)
- Simple append/write operations
- Speed critical for interview flow

**Additional consideration**: The scribe is a **utility** agent, not a **decision-making** agent. It doesn't analyze or synthesize - it formats and writes. Multi-model value = 0.

**Conclusion**: ✅ Correct - keep as-is.

### Overall Trade-off Assessment

**Rating**: 4/5 - The decisions are well-reasoned and correct.

**Minor concern**: The plan could better explain the **philosophical distinction** between:
- **Validation agents** (where multi-model provides different perspectives)
- **Processing agents** (where multi-model adds no value)
- **Utility agents** (where speed/cost outweigh any benefit)

---

## 4. Implementation Approach Validity

### Fix 1: architect.md - Add Bash Tool

**Approach**: ✅ VALID

**Analysis**:
- Line 6: `tools: TodoWrite, Read, Write, Glob, Grep`
- Change to: `tools: TodoWrite, Read, Write, Bash, Glob, Grep`

**Risk**: LOW
- Adding a tool doesn't change behavior unless the agent uses it
- The PROXY_MODE block already exists (lines 40-96)
- This is truly a one-line fix

**Recommendation**: ✅ Proceed

### Fix 2: test-architect.md - Add PROXY_MODE Block

**Approach**: ✅ VALID but incomplete specification

**Analysis**:
- Agent has Bash (line 6)
- Agent needs PROXY_MODE block added

**Missing**: The plan doesn't specify WHERE in the file to add the PROXY_MODE block.

**Current structure** (lines 1-74):
```yaml
---
name: test-architect
description: ...
model: sonnet
color: orange
tools: TodoWrite, Read, Write, Edit, Bash, Glob, Grep
---

<role>...</role>

<instructions>
  <critical_constraints>
    <black_box_isolation>...</black_box_isolation>
    <todowrite_requirement>...</todowrite_requirement>
    <test_authority>...</test_authority>  <!-- Line 66-73 -->
  </critical_constraints>
```

**Issue**: The plan says "Add after `<todowrite_requirement>` section, before `<test_authority>` section" (line 122). But `<test_authority>` is INSIDE `<critical_constraints>`.

**Recommendation**: Add PROXY_MODE as a sibling constraint inside `<critical_constraints>`, after `<todowrite_requirement>` and before `<test_authority>`.

**Risk**: MEDIUM
- Need to ensure XML structure remains valid
- Should verify the block doesn't conflict with existing instructions

**Recommendation**: ✅ Proceed with clarification on placement

---

## 5. Risk Assessment

### Risk Categories

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| architect.md fails to delegate | LOW | LOW | Test after adding Bash |
| test-architect PROXY_MODE block malformed | MEDIUM | LOW | Validate XML structure |
| Claudish not installed | MEDIUM | MEDIUM | Add installation check to testing |
| Model not available on OpenRouter | LOW | MEDIUM | Error handling already specified |
| Prefix collision causes routing error | LOW | MEDIUM | Prefix awareness section exists |
| File-based communication broken | N/A | N/A | Not modifying synthesizer/spec-writer |

### Missing Risk: Bash Tool Scope Creep

**Concern**: Adding `Bash` to `architect.md` allows more than just claudish delegation.

**Potential misuse**:
```bash
# Architect could now run arbitrary commands
rm -rf /important/files
curl malicious-website.com
```

**Mitigation**: The agent's instructions should constrain Bash usage. The current PROXY_MODE block only specifies the claudish command. This is implicit trust, not explicit restriction.

**Recommendation**: Add a `<bash_constraints>` section that explicitly limits Bash to the claudish delegation command only.

---

## 6. Additional Recommendations

### 6.1 Add Pre-flight Checklist

Before implementing, verify:
```markdown
## Pre-flight Checklist

- [ ] architect.md has PROXY_MODE block (lines 40-96) - CONFIRMED
- [ ] test-architect.md has Bash in tools - CONFIRMED
- [ ] npx claudish is installed - TEST
- [ ] Claudish can reach OpenRouter - TEST
- [ ] Test models are available - TEST
```

### 6.2 Add Rollback Plan

If changes break existing functionality:
1. Remove Bash from architect.md tools list
2. Remove PROXY_MODE block from test-architect.md
3. Test normal mode still works

### 6.3 Clarify "Category 4" Status

The plan says "NO FIX NEEDED" but for different reasons:

| Agent | Reason | Should Change |
|-------|--------|---------------|
| synthesizer.md | Internal synthesis | NO - correct |
| spec-writer.md | Uses allowed-tools | NO - correct |
| stack-detector.md | Deterministic | NO - correct |
| scribe.md | Haiku model | NO - correct |

**Recommendation**: Document these as "INTENTIONALLY NO PROXY_MODE" to clarify it's by design, not oversight.

---

## 7. Minor Issues

### Typos and Formatting

- Line 33: "BROKEN - NEEDS BOTH" but synthesizer is in Category 4 "NO FIX NEEDED" - **contradiction**
- Line 186: The PROXY_MODE block for test-architect is truncated (ends mid-block)
- Line 242: "Minimal Version (researcher, developer, debugger, devops)" - **missing ui.md** if it's supposed to be "working"

### Inconsistent Agent Names

- Some references use `.md` extension (architect.md)
- Some don't (researcher, developer)
- **Fix**: Be consistent - always use `.md` extension

---

## 8. Summary

| Category | Rating | Notes |
|----------|--------|-------|
| Design Completeness | 3/5 | Missing error recovery, validation checks |
| Current State Analysis | 4/5 | Verified accurate, minor contradiction on synthesizer |
| Trade-off Decisions | 4/5 | Correct but could explain philosophy better |
| Implementation Approach | 4/5 | Valid but need clarification on test-architect placement |
| Risk Assessment | 3/5 | Missing scope creep risk and pre-flight checks |

**Final Verdict**: APPROVED WITH REQUIRED CHANGES

### Required Changes Before Implementation:

1. **Fix contradiction**: Remove synthesizer from "BROKEN" column in Current State table
2. **Verify ui.md**: Confirm it actually has Bash and PROXY_MODE block
3. **Clarify placement**: Specify exact XML structure for test-architect PROXY_MODE block
4. **Add pre-flight**: Include Claudish installation verification
5. **Add rollback**: Document how to revert if something breaks

### Recommended Changes (Not Blocking):

1. Add Bash scope constraint to prevent misuse
2. Document "INTENTIONALLY NO PROXY_MODE" philosophy
3. Fix truncated PROXY_MODE block in Fix 2 specification
4. Standardize agent name format (always use .md extension)
5. Add installation check to testing approach

---

*Review completed by minimax.md*
*Ready for implementation once required changes are addressed*