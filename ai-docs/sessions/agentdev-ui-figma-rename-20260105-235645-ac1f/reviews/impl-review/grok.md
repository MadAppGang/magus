# Review: ui Agent

**Status**: PASS
**Reviewer**: x-ai/grok-code-fast-1 (via PROXY_MODE)
**File**: /Users/jack/mag/claude-code/plugins/dev/agents/ui.md
**Date**: 2026-01-06

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 3 |
| LOW | 2 |

## Issues

### CRITICAL

None found.

### HIGH

#### Issue 1: MCP Tools Not Listed in Frontmatter

- **Category**: Tools/Completeness
- **Description**: The agent references Figma MCP tools (`mcp__figma__get_file`, `mcp__figma__get_file_nodes`, `mcp__figma__get_images`) extensively in the knowledge section and workflow, but these are not declared in the `tools` frontmatter field.
- **Impact**: While MCP tools may be dynamically available at runtime, not listing them in the frontmatter creates a discrepancy between declared and actual tool usage. This could confuse users inspecting the agent definition or cause issues with tools validation.
- **Location**: Line 13 (tools field) vs Lines 434-490 (knowledge section)
- **Fix**: Either:
  1. Add a comment in the frontmatter explaining MCP tools are detected at runtime, OR
  2. Document in the description that Figma MCP tools are used when available, OR
  3. Add the MCP tools to the tools list if the system supports dynamic tool declarations

### MEDIUM

#### Issue 2: Workflow Phase Numbering Mismatch with TodoWrite Requirement

- **Category**: Completeness
- **Description**: The `<todowrite_requirement>` constraint lists 8 phases (lines 191-199), but the actual workflow has only 7 phases (Phase 1-7). The TodoWrite requirement lists "Feedback Loop" as phase 7 and "Results Presentation" as phase 8, but the workflow has "Feedback Loop" as phase 6 and "Results Presentation" as phase 7.
- **Impact**: Minor confusion for the agent when initializing TodoWrite - the phase names and numbers in the requirement don't exactly match the workflow phases.
- **Location**: Lines 191-199 vs Lines 336-429
- **Fix**: Align the TodoWrite requirement phase list with the actual workflow phases:
  ```xml
  <todowrite_requirement>
    You MUST use TodoWrite to track design review workflow:
    1. Input Validation and Figma Detection
    2. Design Source Setup
    3. Visual Analysis
    4. Design Principles Application
    5. Report Generation
    6. Feedback Loop
    7. Results Presentation
  </todowrite_requirement>
  ```

#### Issue 3: Description Example Count vs Actual

- **Category**: Documentation
- **Description**: The description mentions 6 examples but the opening statement says "Examples:" suggesting the numbered items are examples. This is fine, but there is ambiguity between "review" examples and "implementation assistance" examples in the description.
- **Impact**: Minor - users may be unsure if the agent is primarily for review or also for implementation.
- **Location**: Lines 4-10
- **Fix**: Clarify in the description that this agent handles both review AND implementation assistance:
  ```yaml
  description: |
    Use this agent for UI design review and implementation assistance. Covers usability analysis, accessibility checks, design validation, and implementation guidance. Examples:
  ```

#### Issue 4: Gemini Model Selection Logic Incomplete

- **Category**: Implementation Detail
- **Description**: The `<design_source_selection>` section shows checking `GEMINI_API_KEY` then `OPENROUTER_API_KEY`, but the bash examples show setting `GEMINI_MODEL` without a clear fallback chain when neither key is available.
- **Impact**: The error case (Priority 4) exists but the bash examples don't show complete conditional logic.
- **Location**: Lines 260-294
- **Fix**: Add a complete bash example showing the full fallback chain:
  ```bash
  if [[ -n "$GEMINI_API_KEY" ]]; then
    GEMINI_MODEL="g/gemini-3-pro-preview"
  elif [[ -n "$OPENROUTER_API_KEY" ]]; then
    GEMINI_MODEL="or/google/gemini-3-pro-preview"
  else
    echo "ERROR: No API key available for Gemini access"
    exit 1
  fi
  ```

### LOW

#### Issue 5: Minor Typo in Knowledge Section

- **Category**: Polish
- **Description**: The knowledge section `<design_principles_reference>` header says "DO NOT reimplement these. Reference by name and principle number." This is clear but could be more grammatically polished.
- **Impact**: Negligible - the intent is clear.
- **Location**: Line 493
- **Fix**: Consider: "Reference these by name and principle number. Do not reimplement."

#### Issue 6: Inconsistent Date Format in Feedback Loop

- **Category**: Polish
- **Description**: The feedback loop example shows date format `2026-01-05` but no guidance on date format consistency.
- **Impact**: Negligible - any consistent format would work.
- **Location**: Lines 239, 245
- **Fix**: Add a note about using ISO date format (YYYY-MM-DD) for consistency.

## Scores

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 9/10 | Valid syntax, all required fields, good examples |
| XML Structure | 10/10 | All tags properly nested and closed |
| Figma MCP Detection | 9/10 | Comprehensive implementation with fallback |
| TodoWrite Integration | 9/10 | Present in constraints and workflow, minor numbering mismatch |
| Example Quality | 10/10 | 6 excellent examples covering all scenarios |
| Tools Configuration | 8/10 | Missing MCP tools declaration |
| Security | 10/10 | No unsafe patterns, proper credential handling |
| **Total** | **9.2/10** | |

## Strengths

1. **Excellent Figma MCP Integration**: The agent includes comprehensive Figma URL detection patterns, MCP tool usage examples, and a clear decision tree for MCP vs fallback scenarios.

2. **Robust PROXY_MODE Support**: Full implementation including error handling and prefix collision awareness matching the agentdev patterns.

3. **Strong Example Coverage**: 6 concrete examples covering:
   - Figma MCP available
   - Figma MCP unavailable (fallback)
   - Screenshot review (no Figma)
   - Accessibility audit
   - PROXY_MODE usage
   - SESSION_PATH usage

4. **Well-Structured Knowledge Section**: Includes Figma MCP tool reference, design principles, style integration, Gemini prompt templates, and severity definitions.

5. **Feedback Loop Implementation**: Novel single-session pattern learning feature that can suggest style file updates based on recurring issues.

6. **Design Principle Grounding**: All feedback is grounded in Nielsen's heuristics, WCAG criteria, or Gestalt principles - not subjective opinions.

## Recommendation

**APPROVE** - The ui agent is well-implemented and production-ready. The single HIGH issue (MCP tools not in frontmatter) is a documentation/clarity concern rather than a functional problem since MCP tools are detected at runtime. The MEDIUM and LOW issues are minor polish items.

**Priority Fixes (if time permits):**
1. Align TodoWrite requirement phase numbering with workflow phases
2. Add a note about MCP tools being runtime-detected

**This agent demonstrates excellent implementation of:**
- Figma MCP detection and integration
- PROXY_MODE support with error handling
- SESSION_PATH artifact isolation
- TodoWrite workflow tracking
- Design principle-based feedback

---
*Generated by: x-ai/grok-code-fast-1 via PROXY_MODE delegation*
