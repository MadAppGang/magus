# UI Designer Design Review

**Reviewer**: Gemini 3 Pro (via OpenRouter)
**Date**: 2026-01-05
**Document**: ai-docs/sessions/agentdev-ui-designer-20260105-210820-8287/design.md

---

## Executive Summary

**Status**: CONDITIONAL PASS
**Overall Quality**: 8/10

The design is comprehensive and well-structured, demonstrating strong understanding of the multi-agent architecture, XML standards, and Gemini multimodal capabilities. The document is production-ready with minor adjustments needed.

**Issue Summary**:
- CRITICAL: 0
- HIGH: 2
- MEDIUM: 4
- LOW: 3

---

## Issues by Severity

### HIGH Priority Issues

#### Issue 1: Agent Tool List Missing Write Tool for Report Generation

- **Category**: Completeness
- **Location**: Agent frontmatter, line 78
- **Description**: The agent's tool list is `tools: TodoWrite, Read, Bash, Glob, Grep` but the workflow specifies the agent should write review documents to files (Phase 5: "Write report to session path or return inline"). The `<reviewer_rules>` section explicitly says "NEVER use Write or Edit tools" but then the workflow contradicts this.
- **Impact**: The agent cannot fulfill its documented workflow. Either the reviewer cannot write files (limiting output options) or the tool list is incomplete.
- **Fix**:
  - **Option A (Preferred)**: Add `Write` to tools and update `<reviewer_rules>` to allow writing review reports only to the SESSION_PATH directory. This is consistent with other reviewer agents in the codebase that write review documents.
  - **Option B**: Remove file writing from workflow and only return inline results. This limits functionality but maintains strict reviewer rules.

  Recommended fix (Option A):
  ```yaml
  tools: TodoWrite, Read, Write, Bash, Glob, Grep
  ```
  And update reviewer_rules:
  ```xml
  <reviewer_rules>
    - You are a REVIEWER, not an IMPLEMENTER
    - You MAY use Write to create review documents at ${SESSION_PATH}
    - You MUST NOT use Write or Edit on user's source files
    - Provide specific, actionable feedback with severity levels
  </reviewer_rules>
  ```

#### Issue 2: Gemini Image Input Method Unclear

- **Category**: Technical Completeness
- **Location**: Phase 3 - Visual Analysis (lines 266-278)
- **Description**: The design shows running Claudish with a prompt but does not explain HOW to pass image data to Gemini. Claudish supports image input, but the design doesn't specify the mechanism (file path, base64, URL attachment).
- **Impact**: Implementers will not know how to correctly invoke Gemini with multimodal input, leading to failed image analysis.
- **Fix**: Add explicit image input pattern to the skill and agent:
  ```markdown
  ### Image Input Methods for Claudish

  **Option 1: File Path (Recommended)**
  ```bash
  # Claudish can read local images when path is in prompt
  PROMPT="Analyze this UI: file:///path/to/screenshot.png

  Describe the visual hierarchy..."
  printf '%s' "$PROMPT" | npx claudish --stdin --model "$GEMINI_MODEL" --quiet --auto-approve
  ```

  **Option 2: Base64 Inline** (for programmatic use)
  ```bash
  IMAGE_B64=$(base64 -i screenshot.png)
  PROMPT="[Image data: data:image/png;base64,$IMAGE_B64]

  Analyze this UI..."
  ```

  **Note**: Verify Claudish supports your chosen method with `claudish --help`
  ```

---

### MEDIUM Priority Issues

#### Issue 3: Missing Error Handling for Gemini Vision Limitations

- **Category**: Error Handling
- **Location**: Agent instructions and skill
- **Description**: Gemini 3 Pro has specific limitations for vision analysis (max image size, supported formats, rate limits). The design doesn't document these or provide handling strategies.
- **Impact**: Users may encounter cryptic errors when submitting oversized images or unsupported formats.
- **Fix**: Add to knowledge section:
  ```xml
  <gemini_vision_limits>
    **Image Requirements:**
    - Max size: 20MB per image
    - Supported formats: PNG, JPEG, WEBP, GIF
    - Max images per request: 16

    **If image too large:**
    1. Suggest resizing to max 2048x2048 for optimal performance
    2. Use: `convert input.png -resize 2048x2048\> output.png`

    **If format unsupported:**
    1. Convert to PNG: `convert input.heic output.png`
  </gemini_vision_limits>
  ```

#### Issue 4: Session Path Directive Case Sensitivity

- **Category**: Standards Compliance
- **Location**: Lines 165-172
- **Description**: The design uses `SESSION_PATH: {path}` but the orchestration:multi-model-validation skill uses `SESSION_DIR`. This inconsistency could cause integration issues.
- **Impact**: Agents may not correctly parse session paths when integrated with multi-model validation workflows.
- **Fix**: Standardize on one variable name. Since `SESSION_PATH` is more descriptive and already used in this design:
  - Update the skill documentation to note: "This agent uses SESSION_PATH (equivalent to SESSION_DIR in multi-model-validation)"
  - Or adopt SESSION_DIR for consistency with existing skill

#### Issue 5: Command Missing Model Statistics Tracking

- **Category**: Integration
- **Location**: /ui-design command Phase 5
- **Description**: The multi-model-validation skill emphasizes statistics collection (Pattern 7-8), but the /ui-design command doesn't include timing or performance tracking for the Gemini calls.
- **Impact**: Cannot integrate UI design reviews into performance analytics, missing data for model optimization.
- **Fix**: Add to Phase 4:
  ```xml
  <step>Record execution start time: REVIEW_START=$(date +%s)</step>
  ```
  Add to Phase 5:
  ```xml
  <step>Record execution time and track performance:
    ```bash
    REVIEW_END=$(date +%s)
    DURATION=$((REVIEW_END - REVIEW_START))
    track_model_performance "$GEMINI_MODEL" "success" "$DURATION" "$ISSUE_COUNT" "" 0
    ```
  </step>
  ```

#### Issue 6: AskUserQuestion Tool Not Fully Utilized

- **Category**: UX Enhancement
- **Location**: Command Phase 1-3
- **Description**: The command shows plain text prompts for user input but doesn't leverage AskUserQuestion's structured features (multiSelect, options array, header).
- **Impact**: Suboptimal user experience compared to other commands that use structured input.
- **Fix**: Convert text prompts to structured AskUserQuestion calls:
  ```typescript
  AskUserQuestion({
    questions: [{
      question: "What type of review would you like?",
      header: "Review Type",
      options: [
        { label: "Quick usability check (5 min)", description: "Top-level usability issues only" },
        { label: "Accessibility audit (WCAG AA)", description: "Full WCAG 2.1 AA compliance check" },
        { label: "Design system consistency", description: "Compare against your design tokens" },
        { label: "Comprehensive review", description: "All of the above (15-20 min)" },
        { label: "Compare to design reference", description: "Implementation vs mockup fidelity" }
      ]
    }]
  })
  ```

---

### LOW Priority Issues

#### Issue 7: Model Fallback Priority Unclear

- **Category**: Clarity
- **Location**: Overview section, lines 45-52
- **Description**: The design shows checking GEMINI_API_KEY first, then falling back to OpenRouter. However, it doesn't explain the rationale (latency vs cost vs reliability) to help users make informed decisions.
- **Impact**: Users may not understand trade-offs when configuring their environment.
- **Fix**: Add brief explanation:
  ```markdown
  **Why Gemini Direct First:**
  - Lower latency (direct API, no proxy)
  - More reliable rate limits
  - Slightly lower cost

  **OpenRouter Advantages:**
  - Single API key for multiple providers
  - May have free tier availability
  ```

#### Issue 8: Missing Skill Version Requirement

- **Category**: Versioning
- **Location**: Skill frontmatter, line 524
- **Description**: The skill shows `version: 1.0.0` but doesn't specify minimum Claudish version required for multimodal support.
- **Impact**: Users with older Claudish versions may encounter failures.
- **Fix**: Add to skill:
  ```yaml
  requirements:
    claudish: ">=2.0.0"  # Multimodal support added in 2.0
  ```

#### Issue 9: Example Paths Use Generic Names

- **Category**: Documentation Quality
- **Location**: Examples sections
- **Description**: Examples use generic paths like `screenshots/dashboard.png` without noting these are illustrative examples, not actual test files.
- **Impact**: Minor confusion for implementers running tests.
- **Fix**: Add note to examples:
  ```xml
  <examples>
    <!-- Note: Paths are illustrative. Use actual file paths from your project. -->
    <example name="Screenshot Usability Review">
    ...
  ```

---

## Gemini 3 Pro Compatibility Assessment

### What Will Work Well

1. **Structured XML Prompts**: The XML-heavy prompt structure aligns well with Gemini's instruction-following capabilities. The `<role>`, `<instructions>`, `<knowledge>` structure will be parsed effectively.

2. **Checklist-Based Analysis**: The Nielsen's heuristics and WCAG checklists provide clear, structured evaluation criteria that Gemini can systematically apply.

3. **Multimodal Integration**: Gemini 3 Pro excels at visual analysis. The prompting patterns in the skill (Pattern 1-4) are well-designed for extracting specific design information.

4. **Severity Classification**: The severity guidelines table provides clear decision criteria that Gemini can apply consistently.

### Potential Challenges

1. **Contrast Ratio Estimation**: The design asks Gemini to "estimate" contrast ratios from visual inspection. While Gemini can approximate, it cannot measure precise ratios without pixel data. Consider adding:
   ```xml
   <principle name="Contrast Estimation Caveat" priority="medium">
     When estimating contrast ratios from images, note these are approximate.
     For precise WCAG compliance, recommend automated tools like axe or Lighthouse.
   </principle>
   ```

2. **Long-Form Output**: The review template is extensive. Gemini may truncate if output exceeds token limits. Consider:
   - Breaking into multiple focused prompts if needed
   - Adding instruction: "If output would exceed limits, prioritize CRITICAL and HIGH issues"

3. **Design System Token Matching**: Comparing exact color hex values requires precise vision. Gemini may not reliably distinguish `#2563EB` from `#3B82F6` in screenshots. Add caveat or recommend design system comparison via code inspection.

---

## TodoWrite Integration Assessment

**Status**: PASS

The design correctly integrates TodoWrite:
- Agent has `<todowrite_requirement>` with clear phases
- Command has `<todowrite_requirement>` with 6 phases
- Workflow steps reference TodoWrite updates
- Examples show TodoWrite-aligned execution

**Minor Suggestion**: Add explicit "Mark phase X in_progress/completed" steps in workflow for consistency with other agents.

---

## Proxy Mode Support Assessment

**Status**: PASS

The design fully implements PROXY_MODE:
- `<proxy_mode_support>` section is complete
- Error handling for failed proxy is documented
- Prefix collision awareness is included
- Multi-model validation integration is shown in skill

**Note**: The agent itself is the TARGET of proxy calls (other orchestrators proxy TO it), which is correctly handled. The agent also supports RECEIVING proxy directives when called with `PROXY_MODE: {model}` prefix.

---

## Strengths

1. **Comprehensive Coverage**: The design covers agent, skill, and command with consistent patterns across all three.

2. **Graceful Degradation**: Excellent handling of API unavailability with clear user guidance.

3. **Design Principles Grounding**: Strong emphasis on citing established principles (Nielsen, WCAG, Gestalt) rather than subjective opinions.

4. **Multi-Model Ready**: Proper PROXY_MODE support enables multi-perspective design reviews.

5. **Session Isolation**: Correct use of session-based paths for artifact management.

6. **Clear Examples**: Each component has concrete examples showing expected behavior.

---

## Recommendations Summary

### Must Fix Before Implementation (HIGH)

1. Resolve Write tool contradiction (add Write to tools OR remove file output from workflow)
2. Document Gemini image input method explicitly

### Should Fix (MEDIUM)

3. Add Gemini vision limits and error handling
4. Standardize SESSION_PATH vs SESSION_DIR naming
5. Add performance statistics tracking
6. Use structured AskUserQuestion options

### Nice to Have (LOW)

7. Explain Gemini Direct vs OpenRouter trade-offs
8. Add Claudish version requirement
9. Clarify example paths are illustrative

---

## Approval Decision

**Status**: CONDITIONAL PASS

**Rationale**: The design is well-structured and production-ready with two high-priority issues that need resolution before implementation. The core architecture is sound, XML structure is valid, and Gemini integration patterns are appropriate for multimodal design analysis.

**Conditions for PASS**:
1. Resolve the Write tool / reviewer_rules contradiction (Issue 1)
2. Add explicit Gemini image input documentation (Issue 2)

Once these two issues are addressed, the design is ready for implementation.

---

*Generated by: or/google/gemini-3-pro-preview via Claudish*
*Review completed: 2026-01-05*
