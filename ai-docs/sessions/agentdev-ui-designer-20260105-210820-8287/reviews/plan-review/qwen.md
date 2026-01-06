# UI Designer Design Plan Review

**Reviewer**: Qwen3-VL-235B (Vision-Language Model)
**Model ID**: qwen/qwen3-vl-235b-a22b-thinking
**Review Date**: 2026-01-05
**Design Document**: ai-docs/sessions/agentdev-ui-designer-20260105-210820-8287/design.md

---

## Executive Summary

**Overall Assessment**: CONDITIONAL PASS

The design document is comprehensive and well-structured, demonstrating strong understanding of multimodal AI workflows, proper XML/YAML standards adherence, and thoughtful error handling. However, several issues require attention before implementation.

**Issue Summary**:
- CRITICAL: 1
- HIGH: 4
- MEDIUM: 5
- LOW: 3

---

## 1. Design Completeness

**Status**: GOOD with gaps

### Strengths

1. **Comprehensive three-component structure**: Agent, Skill, and Command are all designed with clear separation of concerns
2. **Model routing logic well documented**: The `g/` vs `or/` prefix decision tree is clearly explained
3. **Implementation checklist provided**: Five-phase implementation roadmap with concrete tasks
4. **Plugin integration details included**: plugin.json updates, directory structure, and dependency requirements

### Gaps

| Gap | Impact | Severity |
|-----|--------|----------|
| No multimodal prompt construction examples with actual image references | Implementation ambiguity | HIGH |
| Missing Claudish command syntax for passing images | Agents cannot process images | CRITICAL |
| No fallback for non-Gemini vision models | Limited flexibility | MEDIUM |

---

## 2. XML/YAML Structure Validity

**Status**: GOOD with minor issues

### YAML Frontmatter Validation

**Agent Frontmatter** (lines 66-80):
```yaml
name: ui-designer                    # Valid: lowercase-with-hyphens
description: |                       # Valid: multi-line with examples
model: sonnet                        # Valid: uses Claude for orchestration
color: cyan                          # Valid: reviewer type
tools: TodoWrite, Read, Bash, Glob, Grep  # Issue: Missing Write for reviews?
skills: orchestration:ui-design-review    # Valid
```

**Issue**: Agent tools list excludes `Write`, but the design states reviews are written to `${SESSION_PATH}/reviews/design-review/gemini.md`. The agent needs `Write` to create review files, OR the command must do this via Task delegation with explicit write instructions.

**Severity**: HIGH

**Command Frontmatter** (lines 796-806):
```yaml
description: |                       # Valid
allowed-tools: Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep  # Valid: excludes Write/Edit
skills: orchestration:ui-design-review, orchestration:session-isolation, orchestration:multi-model-validation
```

**Issue**: References `orchestration:session-isolation` skill which does not exist in the current orchestration plugin. This will cause a skill load error.

**Severity**: HIGH

### XML Structure Validation

The XML structure follows Anthropic best practices:

- `<role>` with `<identity>`, `<expertise>`, `<mission>` - Correct
- `<instructions>` with `<critical_constraints>`, `<core_principles>`, `<workflow>` - Correct
- `<knowledge>` with domain-specific content - Correct
- `<examples>` with 3 examples - Correct (meets 2-4 requirement)
- `<formatting>` with templates - Correct

**Minor Issue**: The agent system prompt has an unclosed triple-backtick at line 508 (`\`\`\``) that should close the XML block but appears orphaned.

**Severity**: LOW

---

## 3. TodoWrite Integration

**Status**: GOOD

### Agent TodoWrite

The agent correctly specifies TodoWrite requirement (lines 175-183):
```xml
<todowrite_requirement>
  You MUST use TodoWrite to track design review workflow:
  1. Validate inputs (images, URLs)
  2. Determine Gemini access method
  3. Analyze design reference
  4. Apply design principles
  5. Generate structured feedback
  6. Present results
</todowrite_requirement>
```

### Command TodoWrite

The command also specifies TodoWrite requirement (lines 850-858):
```xml
<todowrite_requirement>
  You MUST use TodoWrite to track orchestration workflow:
  1. Initialize session
  2. Gather design references from user
  3. Check API key availability
  4. Configure review type
  5. Execute Gemini analysis
  6. Present results
</todowrite_requirement>
```

### Recommendation

Both components have TodoWrite integration. No issues found.

---

## 4. Proxy Mode Support

**Status**: GOOD with clarity improvement needed

### Strengths

1. **Full PROXY_MODE directive support** (lines 109-162): Complete implementation with error handling
2. **Prefix collision awareness** documented explicitly
3. **Error report format** follows the standard template

### Issues

| Issue | Description | Severity |
|-------|-------------|----------|
| Circular PROXY_MODE potential | Agent uses PROXY_MODE to call Gemini, but what if someone calls the agent WITH PROXY_MODE? | MEDIUM |
| Model ID hardcoding in agent | Agent hardcodes `g/gemini-3-pro-preview` selection logic but PROXY_MODE could override this | LOW |

### Recommendation

Clarify the interaction between:
1. Agent being called with PROXY_MODE (external model runs the agent logic)
2. Agent calling Gemini via Claudish (agent delegates to Gemini)

These are two different scenarios and the design should explicitly state that PROXY_MODE takes precedence and the agent should NOT internally call Claudish when operating under PROXY_MODE.

---

## 5. Example Quality

**Status**: GOOD

### Agent Examples (3 examples)

1. **Screenshot Usability Review**: Good step-by-step approach
2. **Accessibility Audit**: Properly cites WCAG criteria
3. **Design Comparison**: Shows comparative analysis workflow

### Command Examples (3 examples)

1. **Screenshot Usability Review**: Clear phase execution flow
2. **Accessibility Audit**: Shows auto-detection of review type from request
3. **No API Key Graceful Degradation**: Important edge case covered

### Recommendation

Add one more example showing **multi-model validation workflow** where the command orchestrates multiple ui-designer agents in parallel with different PROXY_MODE models. This would demonstrate the integration with `orchestration:multi-model-validation` skill.

**Severity**: MEDIUM

---

## 6. Multimodal Prompting Patterns

**Status**: NEEDS IMPROVEMENT

As a vision-language model reviewer, I can provide specific feedback on the multimodal aspects:

### Strengths

1. **Structured prompt templates** (lines 335-373): Good separation of analysis types
2. **Specific output format requests**: Helps ensure consistent responses
3. **Measurement specificity**: Requests "specific with measurements and color values"

### Critical Issue: Image Passing Mechanism

**CRITICAL**: The design does not specify HOW images are passed to Gemini via Claudish.

Claudish supports multimodal input, but the syntax is not documented in the design:

```bash
# The design shows this pattern:
printf '%s' "$ANALYSIS_PROMPT" | npx claudish --stdin --model "$GEMINI_MODEL" --quiet --auto-approve

# But how is the image included? Options:
# 1. Base64 inline in prompt
# 2. File path reference (does Claudish resolve this?)
# 3. URL reference
# 4. Claudish-specific image flag
```

**Impact**: Without this specification, implementers will not know how to construct working multimodal prompts.

**Fix Required**: Document the exact Claudish syntax for image inclusion. Check Claudish documentation or test with:
```bash
npx claudish --help
```

### Prompt Pattern Improvements

**Current Pattern** (line 337-347):
```
Analyze this UI screenshot. For each element, describe:
1. Visual hierarchy and layout
...
```

**Improved Pattern** (vision-language model best practice):

```
[Image attached: {filename}]

You are analyzing a UI screenshot. The image shows {brief context if known}.

**Analysis Task**: Evaluate this interface for usability.

**Structured Output Required**:

1. **Visual Hierarchy Assessment**
   - Primary focal point: [describe]
   - Secondary elements: [list]
   - Hierarchy issues: [if any]

2. **Color and Contrast**
   - Dominant colors: [list hex values if visible]
   - Estimated contrast ratios: [text/background pairs]
   - Accessibility concerns: [specific elements]

3. **Typography Analysis**
   - Font sizes observed: [list in approximate px]
   - Readability issues: [specific locations]

4. **Spacing and Alignment**
   - Grid/alignment system: [observed or absent]
   - Inconsistencies: [specific elements]

5. **Interactive Elements**
   - Buttons/links identified: [count and location]
   - Affordance clarity: [clear/unclear for each]

6. **Overall Assessment**
   - Strengths: [2-3 points]
   - Primary issues: [ranked by severity]
```

**Why this is better**:
1. Explicit image reference at start anchors the model's attention
2. Structured output sections prevent rambling
3. Specific measurement requests (hex values, px sizes) increase precision
4. Severity ranking requested explicitly

**Severity**: HIGH

### Comparative Analysis Pattern

For design comparison (Pattern 4, lines 678-710), the pattern should explicitly structure the two-image comparison:

**Improved Pattern**:
```
[Image 1: Design Reference - {figma_export.png}]
[Image 2: Implementation - {screenshot.png}]

Compare these two images systematically:

**Side-by-Side Element Analysis**:

| Element | Design (Image 1) | Implementation (Image 2) | Match? |
|---------|------------------|--------------------------|--------|
| Header height | ~64px | ~[your estimate]px | Y/N |
| Primary button | #[hex] | #[hex] | Y/N |
| Body font size | ~[size]px | ~[size]px | Y/N |

**Deviation Inventory**:
List ALL visual differences, even minor ones.
```

---

## 7. Error Handling Coverage

**Status**: GOOD

### Covered Scenarios

1. **No API keys** (lines 1010-1032): Clear setup instructions, graceful exit
2. **Image file not found** (lines 1166-1171): Path verification, search suggestions
3. **Gemini API error** (lines 1172-1178): Rate limit, auth, content policy handling
4. **Claudish not installed** (lines 1179-1185): Installation instructions

### Missing Scenarios

| Scenario | Impact | Severity |
|----------|--------|----------|
| Image format unsupported | User confusion | MEDIUM |
| Image too large (token limit) | API failure | MEDIUM |
| Partial Gemini response (timeout mid-stream) | Incomplete review | LOW |
| Session directory creation failure | Workflow blocked | LOW |

### Recommendation

Add error handling for:
1. Unsupported image formats (only PNG, JPG, WEBP supported by most vision APIs)
2. Image size limits (recommend max 4MB or 2048x2048px guidance)

---

## Detailed Findings

### CRITICAL Issues (1)

#### C1: Missing Image Passing Mechanism for Claudish

**Category**: Implementation Blocker
**Location**: Agent workflow Phase 3, lines 266-278
**Description**: The design describes running Gemini analysis via Claudish but does not document how images are passed to the model.
**Impact**: Implementers cannot create working multimodal prompts without this specification.
**Fix**:
1. Document Claudish multimodal syntax
2. Show example command with image path or base64
3. Add validation for supported image formats

---

### HIGH Priority Issues (4)

#### H1: Agent Missing Write Tool

**Category**: YAML Schema
**Location**: Agent frontmatter, line 78
**Description**: Agent tools list is `TodoWrite, Read, Bash, Glob, Grep` but the agent is expected to write review files.
**Impact**: Agent cannot create review documents.
**Fix**: Either:
- Add `Write` to agent tools, OR
- Update design to have command handle all file writing via Task delegation with explicit write instructions

#### H2: Non-Existent Skill Reference

**Category**: YAML Schema
**Location**: Command frontmatter, line 805
**Description**: References `orchestration:session-isolation` skill which does not exist.
**Impact**: Skill load error at runtime.
**Fix**: Either:
- Remove the reference, OR
- Create the missing skill, OR
- Reference an existing session management pattern

#### H3: Improved Multimodal Prompt Patterns Needed

**Category**: Multimodal Design
**Location**: Knowledge section, lines 335-373
**Description**: Current prompts lack explicit image references and structured output enforcement.
**Impact**: Inconsistent or verbose Gemini responses.
**Fix**: Update prompt templates with explicit `[Image: {path}]` anchors and table-based output formats.

#### H4: PROXY_MODE Interaction Undefined

**Category**: Design Clarity
**Location**: Agent PROXY_MODE section, lines 109-162
**Description**: When agent is called WITH PROXY_MODE, should it still internally call Claudish for Gemini? This creates potential infinite delegation.
**Impact**: Confusing behavior, potential loops.
**Fix**: Add explicit statement: "When operating under PROXY_MODE, skip internal Gemini delegation - the external model IS the reviewer."

---

### MEDIUM Priority Issues (5)

#### M1: Missing Multi-Model Design Review Example

**Category**: Example Coverage
**Location**: Examples section
**Description**: No example shows the `/ui-design` command orchestrating multiple models in parallel.
**Impact**: Users may not understand how to use multi-model validation for design reviews.
**Fix**: Add example showing parallel execution with different vision models.

#### M2: No Image Size/Format Validation

**Category**: Error Handling
**Location**: Phase 1 workflow, lines 243-257
**Description**: Input validation checks file existence but not format or size.
**Impact**: Unclear errors when unsupported formats are provided.
**Fix**: Add validation step for supported formats (PNG, JPG, WEBP) and size limits.

#### M3: Model Selection Logic Duplicated

**Category**: DRY Principle
**Location**: Agent (lines 196-211) and Skill (lines 548-563)
**Description**: Gemini model selection logic is duplicated between agent and skill.
**Impact**: Maintenance burden, potential for drift.
**Fix**: Define once in skill, reference from agent.

#### M4: Review Output Path Inconsistency

**Category**: Design Clarity
**Location**: Multiple locations
**Description**: Agent shows `${SESSION_PATH}/reviews/design-review/{model}.md` but command shows `gemini.md` specifically.
**Impact**: Ambiguity about filename convention.
**Fix**: Standardize on `{model-name}.md` pattern and document clearly.

#### M5: No Cost Estimation for Gemini API

**Category**: Feature Gap
**Location**: Command workflow
**Description**: Unlike code review commands that estimate costs, design review has no cost estimation before Gemini calls.
**Impact**: Users cannot make informed decisions about API usage.
**Fix**: Add cost estimation phase similar to `orchestration:multi-model-validation` Pattern 4.

---

### LOW Priority Issues (3)

#### L1: Orphaned Backticks in System Prompt

**Category**: Formatting
**Location**: Line 508
**Description**: Triple backticks appear to close nothing, creating potential parsing issues.
**Impact**: Cosmetic, but may confuse parsers.
**Fix**: Remove or properly close the code block.

#### L2: Hardcoded Model IDs

**Category**: Maintainability
**Location**: Multiple (lines 35, 46-49, 197, 203, etc.)
**Description**: `gemini-3-pro-preview` is hardcoded throughout.
**Impact**: Requires updates when Gemini releases new versions.
**Fix**: Consider environment variable or config-based model selection.

#### L3: Missing Session Cleanup Guidance

**Category**: Operations
**Location**: Session management section
**Description**: Sessions are created in `ai-docs/sessions/` but no cleanup/retention policy is documented.
**Impact**: Session directories may accumulate.
**Fix**: Add note about cleanup (manual or automated) and retention recommendations.

---

## Multimodal-Specific Recommendations

As a vision-language model, I offer these specific recommendations for multimodal design:

### 1. Image Reference Anchoring

Always start prompts with explicit image references:
```
[Image 1: {filename}]
[Image 2: {filename}] (if comparative)

{Analysis instructions follow}
```

This ensures the model's attention is properly anchored to the visual content.

### 2. Structured Output Enforcement

Request table-based outputs for comparative analyses:
```
| Element | Observation | Issue | Severity |
|---------|-------------|-------|----------|
```

Tables constrain the model's output format and make parsing easier.

### 3. Measurement Specificity

Explicitly request estimates:
```
Estimate pixel values, hex colors, and contrast ratios where visible.
Use "~" prefix for estimates (e.g., ~16px, ~#3B82F6).
```

### 4. Multi-Pass Analysis

For comprehensive reviews, consider a multi-pass approach:
- Pass 1: Layout and hierarchy
- Pass 2: Color and accessibility
- Pass 3: Typography and spacing
- Pass 4: Interactive elements

This prevents cognitive overload and improves accuracy.

### 5. Confidence Calibration

Request confidence levels:
```
For each observation, rate your confidence (HIGH/MEDIUM/LOW) based on image clarity.
```

---

## Approval Decision

**Status**: CONDITIONAL PASS

**Rationale**:
- Design is comprehensive and well-structured
- XML/YAML follows standards with minor issues
- TodoWrite and PROXY_MODE properly integrated
- Error handling covers most scenarios

**Blocking Issues** (must fix before implementation):
1. [C1] Document Claudish multimodal image passing syntax
2. [H1] Resolve agent Write tool requirement
3. [H2] Fix non-existent skill reference

**Recommended Fixes** (should fix):
1. [H3] Improve multimodal prompt patterns
2. [H4] Clarify PROXY_MODE interaction
3. [M1] Add multi-model design review example

---

## Summary

This is a thoughtful design for a UI design review capability that properly leverages multimodal AI. The primary gap is the lack of specificity around how images are actually passed through Claudish to Gemini - this is a critical implementation detail that must be resolved.

The design shows good understanding of:
- Separation of concerns (agent vs command vs skill)
- Error handling and graceful degradation
- Design principle citations (Nielsen, WCAG, Gestalt)
- Session isolation patterns

Once the critical and high-priority issues are addressed, this design is ready for implementation.

---

*Review generated by: qwen/qwen3-vl-235b-a22b-thinking via PROXY_MODE*
