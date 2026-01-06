# Plan Review: ui Agent Enhancement (ui-designer → ui)

**Model:** grok
**Date:** 2026-01-06

## Executive Summary

The design plan is comprehensive and well-structured. Figma MCP integration is properly designed with correct patterns and fallback behavior. File references are thoroughly catalogued. Example coverage is excellent. The plan correctly implements a rename from `ui-designer` to `ui` to reflect expanded scope beyond pure design critique.

## Detailed Evaluation

### 1. Design Completeness ✅ EXCELLENT

**ALL changes documented** across agent frontmatter, role definition, instructions, knowledge, examples, formatting, and file modifications. The plan includes:
- Complete file rename matrix
- Frontmatter updates (name, description, color)
- Expanded role from "Senior UI/UX Design Reviewer" to "Senior UI/UX Specialist"
- Added Figma MCP detection logic
- Enhanced workflow with Design Source Setup phase
- Comprehensive Figma MCP tools reference
- Implementation guidance with design tokens
- Multiple PROXY_MODE examples
- 4+ distinct example scenarios

**Key Enhancement:** Added example #6 for implementation assistance using Figma MCP, significantly expanding scope from design review to dev support.

### 2. Figma MCP Detection Logic ✅ CORRECT

**Pattern Analysis:**
```regex
https://(?:www\.)?figma\.com/(?:design|file)/([a-zA-Z0-9]+)/([^?]+)(?:\?.*node-id=([0-9:-]+))?
```

This pattern correctly captures:
- `https://` + optional `www.`
- Either `/design/` or `/file/` paths
- fileKey capture group (alphanumeric)
- fileName capture group (everything before `?`)
- Optional node-id extraction

**Example Parsing:**
- Input: `https://figma.com/design/ABC123/MyProject?node-id=136-5051`
- Correctly extracts: fileKey=`ABC123`, fileName=`MyProject`, nodeId=`136-5051`

### 3. Fallback Behavior ✅ PROPERLY SPECIFIED

**Decision Tree Logic:**
```
IF Figma URL detected:
  IF Figma MCP available:
    → Use mcp__figma__get_file or get_file_nodes
  ELSE:
    → Fall back to Gemini screenshot analysis
    → Notify user: "Figma MCP not available, using screenshot analysis"
```

**Implementation Details:**
- Priority order defined: Figma MCP (#1) → Gemini Direct (#2) → OpenRouter (#3)
- Graceful notification when MCP unavailable
- User education about analysis method differences
- Environmental variable checks for API access

### 4. File Rename Strategy ✅ COMPREHENSIVE

**All References Updated:**
| File | Changes |
|------|---------|
| `plugins/dev/agents/ui-designer.md` | → `ui.md` (full rename) |
| `plugin.json` | Agent reference updated |
| `commands/ui-design.md` | ALL 8 references updated (lines 40,49,115,278-299) |
| `create-style.md` | 4 references updated (lines 4,25,248,513) |
| `ui-design-review/SKILL.md` | PROXY_MODE references (lines 262,265) |
| `design-references/SKILL.md` | Agent references (lines 14,394,404,418) |

**Quality Check:** Line-specific references ensure no missed updates.

### 5. Example Quality ✅ EXCELLENT COVERAGE

**Comprehensive Scenario Testing:**

1. **Figma URL with MCP Available** - Full MCP workflow including token extraction
2. **Figma URL MCP Unavailable (Fallback)** - Gemini fallback notification and image request
3. **Screenshot Usability Review** - Pure image analysis (no URL)
4. **Accessibility Audit** - Focused WCAG AA compliance
5. **PROXY_MODE External Review** - Claudish delegation with proper attribution
6. **SESSION_PATH Isolation** - Artifact management with session-based output

**Key Coverage:** All major code paths represented with realistic prompts and expected agent behavior.

## Strengths

- **Seamless Fallback:** MCP failure handled gracefully with user communication
- **Security Conscious:** PROXY_MODE forbids model substitution, direct error reporting
- **Implementation Pragmatic:** Uses `TodoWrite` tracking, proper tool usage
- **Future-Proof:** Session isolation with SESSION_PATH for artifact management

## Areas for Clarification

### MINOR: MCP Detection Method

**Current Implementation:**
```bash
# Check if Figma MCP tools are available
# If tools exist, MCP is available
```

**Issue:** Tool availability checked by bash `which` or similar? This could misfire if tools exist but are non-functional.

**Recommendation:** Consider MCP health check call, but current approach acceptable for initial implementation.

### SUGGESTION: MCP Documentation

**Addition Needed:** Include MCP setup/installation instructions in design document for teams wanting Figma integration.

## Overall Assessment

**SCORE: 9.5/10**

This is an excellent, production-ready design that properly evolves the agent from specialized design reviewer to comprehensive UI specialist supporting both review and implementation. Figma integration is well-architected with appropriate fallbacks, and all file migrations are meticulously documented.