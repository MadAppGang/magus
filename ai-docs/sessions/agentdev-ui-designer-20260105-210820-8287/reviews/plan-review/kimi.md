# UI Designer Design Review

**Reviewer**: moonshotai/kimi-k2-thinking via Claudish
**Date**: 2026-01-05
**Design Document**: ai-docs/sessions/agentdev-ui-designer-20260105-210820-8287/design.md

---

## Executive Summary

**Overall Assessment**: The design is comprehensive and well-structured, with excellent coverage of agent architecture, skill patterns, and command orchestration. The Gemini model routing logic is particularly thorough.

**Critical Issues**: 1
**High Priority Issues**: 3
**Medium Priority Issues**: 5
**Low Priority Issues**: 3

---

## 1. Design Completeness

### Strengths
- **Excellent coverage**: All three components (agent, skill, command) are thoroughly designed
- **Real-world workflow**: 6-phase workflow captures actual design review process accurately
- **Session architecture**: Well-designed artifact isolation with unique session paths
- **Multi-model ready**: PROXY_MODE integration enables consensus workflows

### Issues

**CRITICAL - Missing Component Specification**
The command is marked as `orchestrator` in the XML comment (line 807), but there's no explicit `command_type` field defined in the frontmatter. According to the orchestration plugin's patterns, commands should have:
```yaml
---
command_type: orchestrator  # or wizard, simple
# ... existing fields
---
```
This could cause the command to be incorrectly categorized or fail validation.

**HIGH - Missing Asset Management**
While the design mentions Figma exports and screenshots, there's no explicit handling for:
- Temporary file cleanup after session completion
- Asset size limits (large images cause API failures)
- Supported image formats validation (PNG, JPG, WebP, etc.)

**MEDIUM - Session Cleanup Strategy**
The design creates `ai-docs/sessions/*` directories but doesn't specify:
- When sessions are archived vs deleted
- Session retention policy
- Cleanup mechanism to prevent disk bloat

**MEDIUM - Output Format Duplication**
The review document template (lines 434-486) and completion template (lines 488-506) have significant overlap. This creates maintenance burden and risks drift between formats.

**LOW - Missing Progress Indicators**
No specification for incremental progress updates during long-running Gemini analysis, which can take 30+ seconds.

---

## 2. XML/YAML Structure Validity

### Strengths
- **Valid YAML frontmatter**: All three components have proper YAML structure
- **Namespaced skill reference**: Correctly uses `orchestration:ui-design-review` format
- **XML structure**: Well-formed with proper closing tags and logical hierarchy

### Issues

**HIGH - XML Syntax Error in Agent**
Agent system prompt (lines 85-508) has an unclosed `<xml>` tag on line 508. The opening tag is on line 85 but should close with `</xml>` not backticks.

```xml
<!-- Current (line 508) -->
</formatting>
```

```xml
<!-- Should be -->
</formatting>
</xml>
```

**MEDIUM - YAML Multiline Inconsistency**
The agent's YAML description uses `|` (pipe) for multiline, which preserves newlines. However, the command's description on line 798-801 uses no explicit multiline indicator, making the formatting ambiguous:

```yaml
description: |
  Interactive UI design review orchestrator. Analyzes screenshots, wireframes, and
  Figma exports for usability, accessibility, and design consistency using Gemini 3 Pro
  multimodal capabilities.
```

This should either use `|` consistently or be a single-line description.

**MEDIUM - XML Tag Hierarchy**
The XML structure has `</knowledge>` on line 384 followed by `<examples>` on line 386, but the closing `</examples>` is on line 431, making `examples` a sibling of `knowledge`. This is unusual structure - typically examples would be nested under knowledge or instructions.

**LOW - Schema Mismatch**
The agent frontmatter specifies `tools: TodoWrite, Read, Bash, Glob, Grep` but the system prompt forbids Write/Edit, creating a potential validation warning during plugin loading.

---

## 3. TodoWrite Integration

### Strengths
- **Excellent coverage**: TodoWrite used in all major workflow phases
- **Clear phase tracking**: Each phase has specific TodoWrite tasks
- **Completion gates**: Quality gates tied to TodoWrite completion

### Issues

**HIGH - Missing TodoWrite Initialization Details**
The command shows TodoWrite initialization on line 934 but doesn't specify the exact todo items. For a 5-phase workflow, this should be explicit:

```markdown
TodoWrite: [
  "Phase 1: Gather design reference input",
  "Phase 2: Check API availability and configure model",
  "Phase 3: Configure review type and scope",
  "Phase 4: Execute design analysis",
  "Phase 5: Present results"
]
```

**MEDIUM - No Sub-task Tracking**
The agent workflow (lines 243-301) has detailed sub-steps (input validation, Gemini setup, visual analysis, etc.) but these aren't reflected in TodoWrite. Users won't see granular progress during long-running analysis.

**MEDIUM - Session Metadata vs TodoWrite Duplication**
Both session-meta.json and TodoWrite track workflow status. This creates two sources of truth and potential synchronization issues.

**LOW - No Error State Todos**
When errors occur (no API keys, image not found), there's no mechanism to mark todos as "blocked" or "failed" vs "completed".

---

## 4. PROXY_MODE Support

### Strengths
- **Comprehensive specification**: Detailed PROXY_MODE handling throughout
- **Error handling**: Explicit "never silently substitute" policy
- **Prefix collision awareness**: Documents the `or/` prefix issue clearly
- **Multi-model examples**: Shows parallel execution patterns

### Issues

**HIGH - Prefix Detection Logic Flaw**
The agent's PROXY_MODE parsing (lines 112-115) assumes the directive is at the start of the prompt:
```bash
printf '%s' "$PROMPT" | npx claudish --stdin --model {model_name}
```

But the example (line 1315) shows:
```
Task: ui-designer PROXY_MODE: or/google/gemini-3-pro-preview
SESSION_PATH: ...
```

The parsing logic needs to extract `PROXY_MODE: [model]` from anywhere in the prompt, not just the beginning.

**MEDIUM - Missing METRICS_MODE Integration**
The orchestration plugin has `orchestration:model-tracking-protocol` skill for multi-model validation statistics. The design doesn't integrate with this, missing an opportunity for performance tracking.

**MEDIUM - No Fallback Chain**
When PROXY_MODE fails, the design correctly reports error but doesn't offer:
- Retry with different model
- Fallback to direct mode (if applicable)
- Descriptive error codes for programmatic handling

**LOW - Claudish Path Assumption**
Assumes `npx claudish` availability but doesn't handle global install (`claudish` without npx) or local project installs.

---

## 5. Example Quality

### Strengths
- **Realistic scenarios**: Screenshot review, accessibility audit, design comparison
- **Edge case coverage**: No API key graceful degradation
- **Command examples**: Show full workflow progression

### Issues

**HIGH - No Multi-Image Example**
The agent mentions multiple images in design type identification (line 252) but no example shows how to handle:
```
"Compare reference.png to implementation.png"
```
The command phase 1 asks for "Multiple images for comparison" (line 950) but the agent has no example of processing multiple images.

**MEDIUM - Example Command Lacks Verbosity**
The example command (line 1189) shows `/ui-design` with no arguments, but the skill shows rich prompting patterns. An example with arguments would better demonstrate the natural language parsing:

```
/user wants: "/ui-design review login form for accessibility"
```

**MEDIUM - No Error Recovery Example**
While error_recovery section exists, there's no complete example showing the user experience when Gemini API fails mid-review.

**LOW - Session Path Example Inconsistency**
The command example uses `${SESSION_PATH}` but the actual examples show hardcoded paths like `ai-docs/sessions/design-review-001`. This creates confusion about variable substitution.

---

## 6. Model Routing Logic for Gemini

### Strengths
- **Thorough environmental detection**: Checks both GEMINI_API_KEY and OPENROUTER_API_KEY
- **Collision awareness**: Documents `or/` prefix requirement clearly
- **Performance optimization**: Prefers direct Gemini when available
- **Multiple skill references**: Consistent logic across agent, skill, and command

### Issues

**HIGH - Environment Variable Order**
The design checks GEMINI_API_KEY first, which is correct. However, the examples in the skill (lines 551-562) and command (lines 984-1001) have subtle differences. Standardize on:

```bash
if [[ -n "$GEMINI_API_KEY" ]]; then
  # Direct Gemini
elif [[ -n "$OPENROUTER_API_KEY" ]]; then
  # OpenRouter
else
  # Error
fi
```

**MEDIUM - No API Key Validation**
Checking that environment variables exist doesn't validate they're valid API keys. Should attempt a test API call or provide validation pattern (format, length checks).

**MEDIUM - Missing OPENROUTER_MODEL Specification**
The design uses `or/google/gemini-3-pro-preview` but doesn't document if this should be configurable. What if users want Gemini 3.5 or different model versions?

**LOW - No Cost/Latency Trade-off Communication**
The design mentions "lower latency" for direct Gemini but doesn't inform users about:
- Cost differences between direct and OpenRouter
- Rate limit implications
- Geographic performance variations

---

## 7. Error Handling Coverage

### Strengths
- **Comprehensive strategy**: Covers 4 major failure scenarios
- **Graceful degradation**: Clear fallback path when APIs unavailable
- **User-friendly messages**: Explains errors in plain language with actionable steps
- **Recovery suggestions**: Specific retry strategies for each scenario

### Issues

**HIGH - Missing Validation Errors**
No handling for:
- Invalid image formats (GIF, SVG with embedded scripts)
- Image size too large (Gemini has 20MB limit)
- Corrupted image files
- URL access failures (404, auth required)

**MEDIUM - Claudish-Specific Errors**
The design lumps all Claudish errors together, but should differentiate:
- Claudish not installed (different from not in PATH)
- Version incompatibility
- Configuration errors
- Network timeouts to Claudish service

**MEDIUM - No Partial Failure Handling**
For multi-image comparisons, what if one image loads but the other fails? The design doesn't specify whether to proceed with partial analysis or fail completely.

**MEDIUM - Session Corruption**
If the workflow fails mid-session (e.g., after Phase 3 but before Phase 4), there's no cleanup mechanism, leaving orphaned session directories.

**LOW - Gemini Content Policy**
No handling for Gemini content policy violations (violence, adult content, etc.), which returns specific error codes that should be caught and explained.

---

## Specific Actionable Recommendations

### Must Fix (Critical + High)

1. **Add command_type to command frontmatter** (CRITICAL)
   ```yaml
   ---
   command_type: orchestrator
   description: ...
   ---
   ```

2. **Fix XML closing tag** (HIGH)
   ```xml
   </formatting>
   </xml>
   ```

3. **Standardize model detection logic** (HIGH)
   Create a shared function referenced across agent, skill, and command

4. **Add multi-image example** (HIGH)
   Show how to process `<image1>, <image2>` pattern

5. **Add input validation** (HIGH)
   Implement format, size, and integrity checks for images

### Should Fix (Medium)

6. **Extract shared templates** to reduce duplication
7. **Add sub-task TodoWrite items** for granular progress
8. **Integrate with model-tracking-protocol** for metrics
9. **Add session cleanup/archival strategy**
10. **Handle partial failures** in multi-image workflows

### Could Fix (Low)

11. **Add progress indicators** for long-running analysis
12. **Document cost/latency trade-offs**
13. **Improve error messages** with error codes
14. **Add content policy violation handling**

---

## Overall Assessment

| Criteria | Score |
|----------|-------|
| Design Completeness | 8.5/10 |
| Architecture Quality | 9/10 |
| Error Handling | 7.5/10 |
| Documentation Quality | 8/10 |
| Implementation Readiness | 9/10 |

**Summary**: Comprehensive and production-ready with minor gaps. Ready to implement after addressing the critical issues.

---

## Key Insights

The design demonstrates sophisticated understanding of Claude Code's orchestration patterns, particularly the separation of concerns between orchestrator (command), reviewer (agent), and knowledge base (skill). The 6-phase workflow maps directly to the 4-Message Pattern's Progress -> Result -> Validation -> Approval flow.

The GEMINI_API_KEY vs OPENROUTER_API_KEY routing logic embodies the "progressive enhancement" principle - prefer the direct, performant path when available, but gracefully fall back to the universal alternative. This pattern should be abstracted into a shared utility across all multimodal agents.

---

*Generated by: moonshotai/kimi-k2-thinking via Claudish*
