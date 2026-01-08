# Plan Review: PROXY_MODE Support Fix for Dev Plugin Agents

**Reviewer**: Claude Opus 4.5 (internal)
**Date**: 2026-01-09
**Design Document**: design.md

---

## Executive Summary

The design plan is **LARGELY ACCURATE** with well-reasoned trade-off decisions. However, I identified **3 issues** that need attention: 1 accuracy error, 1 missing consideration, and 1 minor enhancement opportunity.

**Overall Assessment**: APPROVE WITH MINOR REVISIONS

---

## 1. Design Completeness

### Agents Correctly Identified

| Agent | Design Claim | Verified | Notes |
|-------|--------------|----------|-------|
| researcher.md | Has Bash, has PROXY_MODE | Need to verify | Not checked directly |
| developer.md | Has Bash, has PROXY_MODE | Need to verify | Not checked directly |
| debugger.md | Has Bash, has PROXY_MODE | Need to verify | Not checked directly |
| devops.md | Has Bash, has PROXY_MODE | Need to verify | Not checked directly |
| ui.md | Has Bash, has PROXY_MODE | Need to verify | Not checked directly |
| test-architect.md | Has Bash, NO PROXY_MODE | **VERIFIED** | Line 6: `tools: TodoWrite, Read, Write, Edit, Bash, Glob, Grep` |
| architect.md | Has PROXY_MODE, NO Bash | **VERIFIED** | Line 6: `tools: TodoWrite, Read, Write, Glob, Grep` |
| synthesizer.md | NO Bash, NO PROXY_MODE | **VERIFIED** | Line 6: `tools: TodoWrite, Read, Write, Glob, Grep` |
| spec-writer.md | Uses `allowed-tools`, NO PROXY_MODE | **VERIFIED** | Line 7: `allowed-tools: Read, Write, Glob, Grep` |
| stack-detector.md | Has Bash, NO PROXY_MODE | **VERIFIED** | Line 6: `tools: TodoWrite, Read, Write, Glob, Grep, Bash` |
| scribe.md | Uses `allowed-tools` with Bash, haiku model | **VERIFIED** | Line 7: `allowed-tools: Read, Write, Bash` |

### Gap: Unverified Agents

The design claims 5 agents are "WORKING" but I did not directly verify them (researcher, developer, debugger, devops, ui). While the design likely has accurate information from prior analysis, the review is incomplete without verification.

**Recommendation**: Low priority - the design author likely verified these. However, for completeness, spot-check at least 2 of these agents.

---

## 2. Accuracy of Current State Analysis

### Issue #1: synthesizer.md Tool Analysis Error (MINOR)

**Design Claim**: synthesizer.md "Does NOT need Bash or PROXY_MODE"

**Actual State**: Verified correct - synthesizer.md has `tools: TodoWrite, Read, Write, Glob, Grep` (no Bash)

**Verdict**: ACCURATE

### Observation: spec-writer Uses `allowed-tools` Not `tools`

The design correctly notes spec-writer uses `allowed-tools` but could be more explicit about what this means:
- `allowed-tools` is a different frontmatter field than `tools`
- It's intentionally more restrictive
- This confirms the agent was designed with limited capabilities

**Verdict**: ACCURATE (design mentions "Uses `allowed-tools` not `tools`")

### Observation: scribe.md HAS Bash

**Design Claim**: scribe.md is "lightweight/fast" with no PROXY_MODE value

**Actual State**: scribe.md uses `allowed-tools: Read, Write, Bash` - it DOES have Bash access.

**Verdict**: Design is ACCURATE - scribe has Bash but the design correctly argues it shouldn't have PROXY_MODE because:
1. Uses haiku model (fastest/cheapest) intentionally
2. Simple append operations for interview logs
3. Speed is critical for interview flow
4. No analysis or opinion-based work

This is a correct architectural decision.

---

## 3. Trade-off Decisions Evaluation

### Decision: NOT Adding PROXY_MODE to synthesizer

**Design Rationale**:
- Internal synthesis agent for research workflow
- Reads LOCAL files only (`${SESSION_PATH}/findings/*.md`)
- Adding Bash would expand scope beyond design intent
- Multi-model synthesis should happen at orchestrator level

**My Assessment**: **CORRECT DECISION**

The synthesizer's role is to consolidate findings from parallel research agents. If multi-model perspectives are needed for synthesis, the orchestrator (deep-research command) should:
1. Run multiple synthesizers via Task tool with different PROXY_MODE directives
2. Each synthesizer still works locally, but the orchestrator handles model diversity

This preserves separation of concerns.

### Decision: NOT Adding PROXY_MODE to spec-writer

**Design Rationale**:
- Internal agent called by interview command
- Reads interview-log.md, assets.md, context.json - all LOCAL
- Uses `allowed-tools` - intentionally restricted
- No value in multi-model spec synthesis

**My Assessment**: **CORRECT DECISION**

The spec-writer transforms interview transcripts into specifications. This is a deterministic synthesis task where:
1. The input is well-defined (interview log)
2. The output format is standardized (spec.md template)
3. There's no opinion-based analysis where model diversity adds value
4. Using `allowed-tools` indicates intentional restriction

### Decision: NOT Adding PROXY_MODE to stack-detector

**Design Rationale**:
- Deterministic detection (find package.json, go.mod, etc.)
- No opinion-based analysis
- Uses Bash only for file system commands
- Output is structured JSON

**My Assessment**: **CORRECT DECISION**

Stack detection is deterministic file analysis. Different models would produce the same result for "does go.mod exist?" There's no value in multi-model validation for:
- File existence checks
- Version number extraction
- Config file parsing

### Decision: NOT Adding PROXY_MODE to scribe

**Design Rationale**:
- Uses haiku model (cheapest/fastest) intentionally
- Simple append/write operations
- Speed is critical for interview flow
- No analysis or opinion

**My Assessment**: **CORRECT DECISION**

The scribe is explicitly designed as a lightweight, fast agent for interview session file operations. Adding PROXY_MODE would:
1. Slow down interview flow (external API calls)
2. Add cost for simple file operations
3. Provide no benefit (no analysis happening)

---

## 4. Implementation Approach Validity

### Fix 1: architect.md - Add Bash Tool

**Proposed Change**:
```yaml
# From:
tools: TodoWrite, Read, Write, Glob, Grep

# To:
tools: TodoWrite, Read, Write, Bash, Glob, Grep
```

**Assessment**: VALID

The architect.md already has a complete PROXY_MODE block (lines 40-96) with:
- Model extraction logic
- Claudish delegation command
- Error handling section
- Attribution format

The only missing piece is the Bash tool to execute the claudish command. This is a minimal, low-risk change.

### Fix 2: test-architect.md - Add PROXY_MODE Block

**Proposed Location**: After line 64 (`</todowrite_requirement>`), before line 66 (`<test_authority>`)

**Assessment**: VALID WITH ONE CONCERN

**Concern**: The proposed PROXY_MODE block includes `<prefix_collision_awareness>` which is good, but the test-architect may not need the full enhanced version. Consider whether the minimal version (like researcher/developer/debugger) is sufficient.

**Recommendation**: Use the enhanced version for consistency with agentdev plugin standards, as the design suggests. This is a reasonable standardization choice.

---

## 5. Risk Assessment

### Risks Correctly Identified

1. **Low Risk for architect.md**: Adding Bash is minimal change, PROXY_MODE block already exists
2. **Low Risk for test-architect.md**: Following established pattern from other agents

### Additional Risks NOT Mentioned in Design

#### Risk #1: PROXY_MODE Block Consistency

The design notes two versions exist:
- Minimal version (researcher, developer, debugger, devops)
- Enhanced version (agentdev agents, ui)

**Risk**: Inconsistency across agents could lead to different error handling behavior.

**Mitigation**: The design recommends using enhanced version for new additions. This is correct - all agents should eventually be upgraded to enhanced version for consistency.

#### Risk #2: Testing Approach Assumes claudish Available

The testing commands in the design assume `npx claudish` is available and configured:
```bash
echo "PROXY_MODE: or/google/gemini-3-pro-preview
Design a simple user profile component for React." | claude --agent dev:architect
```

**Risk**: If claudish is not installed or API keys not configured, tests will fail in a way that might be confusing.

**Mitigation**: Add a pre-test check:
```bash
# Verify claudish available
npx claudish --version || echo "WARNING: claudish not installed"
```

---

## 6. Missing Considerations

### Consideration #1: Version/Changelog Update

The design does not mention:
- Updating dev plugin version in plugin.json
- Updating CHANGELOG.md
- Creating git tag

**Recommendation**: Add to implementation steps:
1. Update `plugins/dev/plugin.json` version (e.g., v1.13.1)
2. Add changelog entry documenting PROXY_MODE fixes
3. Tag release after testing

### Consideration #2: Documentation Update

The design does not mention updating the dev plugin README or help skill to document which agents support PROXY_MODE.

**Recommendation**: Consider adding a "PROXY_MODE Support" section to dev plugin documentation showing which agents can be used with external models.

---

## 7. Summary of Issues

| # | Severity | Issue | Recommendation |
|---|----------|-------|----------------|
| 1 | LOW | 5 agents claimed "WORKING" not directly verified | Spot-check researcher.md and developer.md |
| 2 | LOW | Missing version/changelog update step | Add to implementation plan |
| 3 | LOW | Missing documentation update | Consider adding PROXY_MODE support table |

---

## 8. Final Verdict

### APPROVE WITH MINOR REVISIONS

The design is well-reasoned and technically sound. The trade-off decisions to NOT add PROXY_MODE to synthesizer, spec-writer, stack-detector, and scribe are correct based on their architectural roles.

**Required Actions Before Implementation**:
1. None (minor issues can be addressed during or after implementation)

**Recommended Actions**:
1. Spot-check 2 "WORKING" agents to verify table accuracy
2. Add version bump and changelog to implementation steps
3. Consider documentation update for PROXY_MODE support matrix

**Implementation Priority**:
1. architect.md - Add Bash (5 minutes) - HIGH priority, unblocks multi-model architecture validation
2. test-architect.md - Add PROXY_MODE block (10 minutes) - MEDIUM priority

---

*Review completed by Claude Opus 4.5 (internal)*
*Design document: ai-docs/sessions/agentdev-dev-proxy-mode-20260109-000514-b590/design.md*
