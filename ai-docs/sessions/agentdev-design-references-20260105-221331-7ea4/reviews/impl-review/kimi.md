# Implementation Review: Design References System

**Status**: PASS
**Reviewer**: moonshotai/kimi-k2-thinking (via PROXY_MODE)
**Date**: 2026-01-05
**Files Reviewed**:
- plugins/orchestration/skills/design-references/SKILL.md
- plugins/orchestration/commands/create-style.md
- plugins/orchestration/agents/ui-designer.md

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 3 |
| LOW | 2 |

---

## Scores

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 9/10 | All files have valid YAML; skill uses best practice format |
| XML Structure | 9/10 | Properly nested, all tags closed |
| Style Detection | 9/10 | Excellent hierarchical detection with fallback chain |
| Feedback Loop | 8/10 | Well-designed single-session pattern; minor gaps |
| TodoWrite Integration | 9/10 | Present in constraints, workflow, and examples |
| Completeness | 9/10 | Comprehensive coverage with examples |
| **Overall** | **8.8/10** | Production-ready with minor improvements suggested |

---

## Issues

### HIGH

#### Issue 1: Edit Tool Not Listed in ui-designer Agent Tools

- **Category**: Tool Configuration
- **Location**: `ui-designer.md`, line 12, frontmatter `tools` field
- **Description**: The agent's `<feedback_loop>` section (lines 193-204) instructs the agent to "use Edit tool to update .claude/design-style.md", but the `Edit` tool is NOT listed in the frontmatter tools. The current tools are: `TodoWrite, Read, Write, Bash, Glob, Grep`.
- **Impact**: The agent cannot fulfill its documented capability to append rules to the style file. Either the feedback loop fails silently or the agent attempts to use a tool it doesn't have access to.
- **Fix**: Add `Edit` to the tools list:
  ```yaml
  tools: TodoWrite, Read, Write, Edit, Bash, Glob, Grep
  ```
- **Severity Justification**: HIGH because this is a functional gap between documented behavior and actual capability.

---

### MEDIUM

#### Issue 2: Missing Error Handling for Style File Parsing

- **Category**: Error Recovery
- **Location**: `ui-designer.md`, `<style_integration>` knowledge section (lines 381-410)
- **Description**: The style integration section describes parsing `.claude/design-style.md` but provides no guidance on handling malformed files, missing sections, or unexpected formats. If a user manually edits the style file and introduces errors, the agent has no defined recovery path.
- **Impact**: Agent may fail unexpectedly or produce inconsistent behavior with corrupted style files.
- **Fix**: Add error handling guidance:
  ```xml
  <error_handling>
    If style file parsing fails:
    1. Log warning: "Style file malformed, using base reference only"
    2. Fall back to explicit reference or auto-detect
    3. Suggest running /create-style to regenerate
  </error_handling>
  ```

#### Issue 3: create-style Command Missing Validation for Color Hex Values

- **Category**: Input Validation
- **Location**: `create-style.md`, Phase 3 Brand Colors (lines 97-126)
- **Description**: The command accepts hex color values from users but the workflow does not specify validation logic for ensuring valid hex format (#RRGGBB or #RGB). The error template at line 530 suggests validation exists, but the workflow steps don't explicitly call for it.
- **Impact**: Users might enter invalid color values that produce a malformed style file.
- **Fix**: Add explicit validation step in Phase 3:
  ```xml
  <step>Validate hex format (must match #[0-9A-Fa-f]{3,6})</step>
  <step>If invalid, show error_templates.invalid_color and re-prompt</step>
  ```

#### Issue 4: design-references Skill Lacks Version Update Guidance

- **Category**: Maintainability
- **Location**: `SKILL.md`, header section (lines 1-8)
- **Description**: The skill documents design system references (Material Design 3, Apple HIG, etc.) with specific values that may become outdated. There is no guidance on how to update these references when upstream design systems evolve.
- **Impact**: Style values may drift from actual design system specs over time.
- **Fix**: Add a maintenance section:
  ```markdown
  ## Maintenance

  Design systems evolve. Review and update this skill quarterly:
  - Material Design: Check https://m3.material.io/ changelog
  - Apple HIG: Check WWDC announcements
  - Tailwind: Check https://tailwindcss.com/docs release notes
  ```

---

### LOW

#### Issue 5: Inconsistent Phase Numbering in ui-designer Workflow

- **Category**: Documentation Consistency
- **Location**: `ui-designer.md`, workflow phases (lines 268-346)
- **Description**: The workflow defines 7 phases (Input Validation, Gemini Setup, Visual Analysis, Design Principles Application, Report Generation, Feedback Loop, Results Presentation), but the `<todowrite_requirement>` (lines 148-158) lists 8 items including "Style Detection" as item 2. These don't align perfectly.
- **Impact**: Minor confusion for implementers; functional behavior unaffected.
- **Fix**: Align the TodoWrite list with actual workflow phases, or incorporate "Style Detection" explicitly into Phase 1.

#### Issue 6: Gemini Model Selection Could Be More Robust

- **Category**: Resilience
- **Location**: `ui-designer.md`, `<gemini_model_selection>` (lines 217-237)
- **Description**: The model selection logic checks `GEMINI_API_KEY` then `OPENROUTER_API_KEY`, but doesn't handle the case where the key exists but is invalid/expired. A network test or simple validation call could improve reliability.
- **Impact**: Agent may fail mid-workflow if API key is invalid rather than at startup.
- **Fix**: Consider adding a lightweight validation step:
  ```bash
  # Optional: Test API key validity
  if ! npx claudish --model "$GEMINI_MODEL" --test-connection 2>/dev/null; then
    echo "WARNING: API key may be invalid, proceeding anyway"
  fi
  ```
  (Note: This depends on claudish supporting such a flag, otherwise document the limitation)

---

## Strengths

### Excellent Style Detection Architecture

The hierarchical style detection pattern in `ui-designer.md` (lines 41-80) is exceptionally well-designed:

1. **Project Style File** (highest priority) - Respects user customization
2. **Explicit Reference** (from prompt) - Allows per-review overrides
3. **Auto-detect** (pattern recognition) - Smart fallback
4. **Generic Best Practices** (final fallback) - Always works

This 4-tier approach ensures the agent always has a valid reference while respecting user preferences. The "Combine When Both Present" logic (lines 76-79) is particularly thoughtful.

### Comprehensive Design System References

The `SKILL.md` file provides detailed, actionable references for 5 major design systems:
- Material Design 3 with complete type scale (13 roles)
- Apple HIG with platform-specific guidance
- Tailwind UI with exact spacing scale
- Ant Design with enterprise patterns
- Shadcn/ui with CSS variable definitions

Each reference includes review checklists, making them immediately actionable.

### Well-Structured Feedback Loop

The feedback loop (lines 161-205 in ui-designer.md) is pragmatically designed:
- **Single-session scope** avoids persistence complexity
- **3+ occurrence threshold** prevents over-learning from noise
- **User approval required** before modifying style file
- **Style History tracking** for audit trail

The explicit note about "no persistence layer" (line 168-171) is refreshingly honest about scope limitations.

### Strong TodoWrite Integration

All three files demonstrate proper TodoWrite integration:
- `create-style.md`: 8-phase wizard tracking (line 53-61)
- `ui-designer.md`: 8-step review workflow (lines 148-158)
- Both include TodoWrite in constraints AND workflow phases

### PROXY_MODE Support

The ui-designer agent includes complete PROXY_MODE support (lines 82-136) with:
- Error handling that prevents silent fallback
- Prefix collision awareness for google/ and openai/ routes
- Proper attribution in responses

---

## Recommendations

### Immediate Actions (Before Production Use)

1. **Add Edit tool to ui-designer** - Required for feedback loop functionality
2. **Add style file parsing error handling** - Prevents silent failures

### Future Improvements

1. **Add color validation to create-style** - Better user experience
2. **Add maintenance guidance to SKILL.md** - Long-term accuracy
3. **Consider optional API key validation** - Earlier failure detection

---

## Verdict

**PASS** - The implementation is production-ready with one HIGH issue that should be addressed (missing Edit tool). The style detection architecture is exemplary, the feedback loop is well-scoped, and TodoWrite integration is thorough. The design reference content is comprehensive and actionable.

The single HIGH issue is a straightforward fix (adding one tool to frontmatter). Once addressed, this system provides a solid foundation for design-aware UI reviews.

---

*Generated by: agentdev:reviewer via moonshotai/kimi-k2-thinking*
