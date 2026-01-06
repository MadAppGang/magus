# Review: ui Agent

**Status**: PASS
**Reviewer**: claude-opus-4-5 (internal)
**File**: /Users/jack/mag/claude-code/plugins/dev/agents/ui.md

## Summary

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 2
- LOW: 3

## Overall Assessment

The `ui` agent is well-implemented with comprehensive Figma MCP detection, proper PROXY_MODE support, and thorough TodoWrite integration. The rename from `ui-designer` to `ui` has been successfully completed with no stale references. The agent follows XML standards and includes excellent examples covering various scenarios.

---

## YAML Frontmatter Validation

**Score: 9/10**

### Fields Present
| Field | Present | Valid | Notes |
|-------|---------|-------|-------|
| `name` | Yes | Yes | `ui` - lowercase, correct format |
| `description` | Yes | Yes | Multi-line with 6 examples |
| `model` | Yes | Yes | `sonnet` - valid model |
| `color` | Yes | Yes | `cyan` - appropriate for reviewer/design role |
| `tools` | Yes | Yes | Comma-separated with spaces |
| `skills` | Yes | Yes | References 2 skills |

### Examples in Description
The description includes 6 clear usage examples:
1. "Review this wireframe for usability" - wireframe analysis
2. "Check this screenshot against design guidelines" - heuristic validation
3. "Analyze the accessibility of this UI" - WCAG compliance
4. "Compare my implementation to this Figma design" - visual comparison (Figma MCP)
5. "Suggest improvements for this landing page" - design recommendations
6. "Help me implement this Figma component" - implementation guidance

**Verdict**: Exceeds minimum (3 examples required, 6 provided)

### Issues Found

**[MEDIUM] Skill Reference Path Inconsistency**
- **Location**: Lines 15-16
- **Issue**: Skills referenced as `dev:ui-design-review` and `dev:design-references` but the actual skill paths in plugin.json are `./skills/design/ui-design-review` and `./skills/design/design-references`
- **Impact**: May cause skill loading issues if the namespace resolution does not match
- **Fix**: Verify skill namespace resolution or update to match the actual path structure (`dev:design/ui-design-review`)

---

## XML Structure Validation

**Score: 10/10**

### Core Tags Present
| Tag | Present | Properly Closed |
|-----|---------|-----------------|
| `<role>` | Yes | Yes |
| `<instructions>` | Yes | Yes |
| `<knowledge>` | Yes | Yes |
| `<examples>` | Yes | Yes |
| `<formatting>` | Yes | Yes |

### Role Section
- `<identity>`: "Senior UI/UX Specialist" - appropriate for design review
- `<expertise>`: 9 items covering visual design, accessibility, Figma MCP, and implementation guidance
- `<mission>`: Clear statement referencing Gemini vision and Figma MCP

### Instructions Section
- `<critical_constraints>`: Contains 7 specialized constraint blocks
  - `<figma_mcp_detection>`: Well-documented with URL patterns and decision tree
  - `<style_detection>`: 4-level priority cascade
  - `<proxy_mode_support>`: Full implementation with error handling
  - `<session_path_support>`: Correct implementation
  - `<todowrite_requirement>`: 8 workflow phases defined
  - `<feedback_loop>`: Single-session pattern tracking
  - `<reviewer_rules>`: Appropriate for reviewer role
  - `<design_source_selection>`: Priority order for design access methods

- `<core_principles>`: 5 principles with correct priority attributes
- `<workflow>`: 7 phases with appropriate steps

### Specialized Tags
The agent uses appropriate tags for its role:
- `<figma_mcp_integration>` in knowledge
- `<design_principles_reference>` in knowledge
- `<style_integration>` in knowledge
- `<gemini_prompt_templates>` in knowledge
- `<severity_definitions>` in knowledge

**Verdict**: All XML tags properly structured and closed

---

## Figma MCP Detection Implementation

**Score: 10/10**

### Detection Logic
Located in `<figma_mcp_detection>` (lines 45-81):

1. **URL Pattern Recognition**: Comprehensive regex pattern supporting:
   - `figma.com/design/{fileKey}/{fileName}`
   - `figma.com/file/{fileKey}/{fileName}`
   - With optional `?node-id={nodeId}` parameter
   - Both `www.` and non-www variants

2. **MCP Availability Check**: Clear instruction to check for MCP tools

3. **Decision Tree**: Well-documented fallback logic:
   - If Figma URL + MCP available -> Use MCP tools
   - If Figma URL + MCP unavailable -> Fall back to Gemini with notification
   - No Figma URL -> Normal image/screenshot workflow

### MCP Tool Documentation
Located in `<figma_mcp_integration>` (lines 434-490):

| Tool | Purpose | Documentation |
|------|---------|---------------|
| `mcp__figma__get_file` | File structure | Complete |
| `mcp__figma__get_file_nodes` | Component data | Complete |
| `mcp__figma__get_images` | Screenshot export | Complete |

### Design Token Extraction
Clear documentation for extracting:
- Colors (fill/stroke styles)
- Typography (font family, size, weight, line height)
- Spacing (padding, gaps, margins from auto-layout)
- Effects (shadows, blur)

**Verdict**: Figma MCP implementation is comprehensive and well-documented

---

## TodoWrite Integration

**Score: 9/10**

### Constraint Block (lines 190-200)
```xml
<todowrite_requirement>
  You MUST use TodoWrite to track design review workflow:
  1. Input Validation (including Figma URL detection)
  2. Style Detection
  3. Design Source Setup (Figma MCP or Gemini)
  4. Visual Analysis
  5. Design Principles Application
  6. Report Generation
  7. Feedback Loop
  8. Results Presentation
</todowrite_requirement>
```

### Workflow Phases
The 7 workflow phases (lines 335-429) align well with TodoWrite items:
1. Input Validation and Figma Detection
2. Design Source Setup
3. Visual Analysis
4. Design Principles Application
5. Report Generation
6. Feedback Loop
7. Results Presentation

### Issues Found

**[LOW] TodoWrite not shown in examples**
- **Location**: Examples section (lines 642-735)
- **Issue**: None of the 6 examples explicitly show TodoWrite usage
- **Impact**: Users may not understand how to integrate TodoWrite in practice
- **Fix**: Add TodoWrite initialization step to at least one example

---

## Example Quality

**Score: 9/10**

### Examples Present (6 total)

| Example | Scenario | Quality |
|---------|----------|---------|
| 1 | Figma URL with MCP Available | Excellent - 7 steps, shows token extraction |
| 2 | Figma URL with MCP Unavailable | Excellent - Shows fallback path |
| 3 | Screenshot Usability Review | Good - Shows Nielsen heuristics |
| 4 | Accessibility Audit | Good - Shows WCAG criteria |
| 5 | PROXY_MODE External Model | Excellent - Complete flow |
| 6 | SESSION_PATH with Artifact Isolation | Good - Shows path handling |

### Strengths
- Covers both Figma MCP and non-Figma workflows
- Shows fallback scenarios (MCP unavailable)
- Includes PROXY_MODE and SESSION_PATH examples
- Cites specific design principles (Nielsen #N, WCAG X.Y.Z)

### Issues Found

**[LOW] Example output location inconsistency**
- **Location**: Example 5, line 707
- **Issue**: Uses `ai-docs/sessions/review-001/reviews/design-review/gemini.md` but should align with session path format
- **Impact**: Minor confusion about path structure
- **Fix**: Standardize to `${SESSION_PATH}/reviews/design-review/{model}.md`

---

## Reference Updates (ui-designer -> ui)

**Score: 10/10**

### Verification
- **Grep search**: No matches for "ui-designer" in the file
- **Agent name**: Correctly set to `ui` (line 2)
- **plugin.json**: References `./agents/ui.md` (line 35)
- **Self-references**: All internal references use "ui agent" or "ui"

**Verdict**: Rename completed successfully with no stale references

---

## Tools Configuration

**Score: 9/10**

### Tools Listed
```yaml
tools: TodoWrite, Read, Write, Edit, Bash, Glob, Grep
```

### Analysis
| Tool | Appropriate | Rationale |
|------|-------------|-----------|
| TodoWrite | Yes | Required for workflow tracking |
| Read | Yes | Read designs, style files, existing code |
| Write | Yes | Create review documents |
| Edit | Yes | Update style files (feedback loop) |
| Bash | Yes | Run Claudish for Gemini analysis |
| Glob | Yes | Find files for review |
| Grep | Yes | Search for patterns in codebase |

### Issues Found

**[MEDIUM] Missing MCP tools reference**
- **Location**: YAML frontmatter, line 13
- **Issue**: The agent heavily uses Figma MCP tools (`mcp__figma__get_file`, etc.) but these are not listed in the tools field
- **Impact**: May cause confusion about available tools, though MCP tools are typically available separately
- **Note**: This may be by design if MCP tools are implicitly available when MCP is configured

**[LOW] Edit tool usage for style file only**
- **Location**: `<reviewer_rules>` (line 255) says "MUST NOT modify user's source files"
- **Issue**: Having Edit tool while being a "reviewer" could be confusing
- **Impact**: Minor - the feedback loop clearly limits Edit to `.claude/design-style.md`
- **Recommendation**: Document Edit restriction more prominently or remove if not needed

---

## Security Review

**Score: 10/10**

- No credential exposure in examples
- Environment variable checks use proper patterns (checking existence, not logging values)
- PROXY_MODE error handling does not expose sensitive data
- File paths use relative or session-based paths, no hardcoded absolute paths

---

## Scores Summary

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 9/10 | Minor skill path concern |
| XML Structure | 10/10 | All tags present and correct |
| Figma MCP | 10/10 | Comprehensive implementation |
| TodoWrite | 9/10 | Good constraint, missing in examples |
| Examples | 9/10 | 6 quality examples |
| References | 10/10 | Clean rename |
| Tools | 9/10 | MCP tools not in list |
| Security | 10/10 | No issues |
| **Total** | **9.5/10** | |

---

## Issues Summary

### CRITICAL
None found

### HIGH
None found

### MEDIUM
1. **Skill Reference Path**: Skills referenced as `dev:ui-design-review` may not match actual paths
2. **Missing MCP Tools Reference**: Figma MCP tools not listed in tools field

### LOW
1. **TodoWrite Not in Examples**: No explicit TodoWrite usage shown in examples
2. **Example Output Path**: Minor inconsistency in example 5 path format
3. **Edit Tool Clarity**: Could be clearer that Edit is only for style file

---

## Recommendation

**APPROVE** - The agent is production-ready with minor improvements recommended:

1. Verify skill namespace resolution works correctly with current references
2. Consider adding a brief TodoWrite initialization to one example
3. Optionally document MCP tools availability in a comment or separate section

The implementation is comprehensive, well-documented, and follows all XML standards. The Figma MCP detection is particularly well-implemented with proper fallback handling. The rename from `ui-designer` to `ui` has been completed cleanly.

---

*Review generated by claude-opus-4-5 (internal reviewer)*
*Date: 2026-01-06*
