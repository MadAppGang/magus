# UI Designer Design Plan Review

**Reviewer**: Claude Opus 4.5 (Internal)
**Date**: 2026-01-05
**Design Document**: ai-docs/sessions/agentdev-ui-designer-20260105-210820-8287/design.md
**Status**: CONDITIONAL PASS

---

## Executive Summary

The UI Designer design document is comprehensive and well-structured, covering an agent, skill, and command for the orchestration plugin. The design demonstrates strong understanding of the agent development patterns and multi-model validation workflows. However, there are several issues that should be addressed before implementation.

**Issue Summary**:
- CRITICAL: 1
- HIGH: 4
- MEDIUM: 5
- LOW: 3

---

## CRITICAL Issues

### Issue 1: Agent Cannot Write Files But Design Requires It

**Category**: Design Inconsistency
**Severity**: CRITICAL

**Description**: The agent is defined as a "Reviewer" type with cyan color, and the `<reviewer_rules>` section explicitly states:
```
- NEVER use Write or Edit tools (you don't modify files)
```

However, the workflow requires the agent to write review documents:
- Phase 5 states: "Write report to session path or return inline"
- The `<gemini_model_selection>` section shows the agent running bash to detect API keys
- The completion template references `${SESSION_PATH}/reviews/design-review/{model}.md`

**Impact**: The agent cannot fulfill its purpose - it cannot write the review document it generates.

**Fix**: Either:
1. Change agent type to "Implementer" (green color) with Write tool, OR
2. Have the orchestrator (/ui-design command) pass a file path and the agent returns content for the orchestrator to write, OR
3. Add Write tool to the agent's tool list and clarify it only writes review documents (not implementation files)

**Location**: Agent frontmatter (line 78) vs workflow phase 5 (lines 289-294)

---

## HIGH Priority Issues

### Issue 2: Missing Write Tool in Agent Frontmatter

**Category**: Tool Configuration
**Severity**: HIGH

**Description**: The agent's frontmatter specifies:
```yaml
tools: TodoWrite, Read, Bash, Glob, Grep
```

But the agent needs to write review documents to the session path. The Write tool is missing.

**Impact**: Agent cannot create the review document files it's designed to produce.

**Fix**: Add Write tool to frontmatter:
```yaml
tools: TodoWrite, Read, Write, Bash, Glob, Grep
```

**Location**: Line 78

---

### Issue 3: Skill Frontmatter Missing Required Fields

**Category**: YAML Structure
**Severity**: HIGH

**Description**: The skill frontmatter (lines 523-529) is missing the `path` field that's required for skills. According to the schemas skill, skill frontmatter should be simpler:

```yaml
---
name: ui-design-review
version: 1.0.0
description: |
  ...
---
```

However, skills are referenced by directory path, not frontmatter. The skill content itself is good, but the implementation note should clarify the file structure.

**Impact**: Minor confusion about skill structure, but skill will still load correctly since Claude Code uses directory-based skill loading.

**Fix**: Clarify in the implementation checklist that skills are loaded from `skills/{name}/SKILL.md` and the frontmatter shown is for documentation purposes.

**Location**: Lines 512-529

---

### Issue 4: Command Frontmatter Format Issue

**Category**: YAML Structure
**Severity**: HIGH

**Description**: The command frontmatter at lines 796-806 is valid YAML but separates the YAML block from the XML system prompt with triple backticks:

```yaml
---
description: |
...
---
```

```xml
<role>
...
```

Commands in Claude Code should have the frontmatter immediately followed by the system prompt without code fence separation. The design shows them as separate code blocks which may cause confusion during implementation.

**Impact**: Implementer may incorrectly create the command file with code fences between frontmatter and prompt.

**Fix**: In the design document, clarify that the command file should be:
```markdown
---
frontmatter here
---

<role>
system prompt here
</role>
```

Without code fences between them.

**Location**: Lines 796-808

---

### Issue 5: Session Path Variable Inconsistency

**Category**: Variable Usage
**Severity**: HIGH

**Description**: The design uses `${SESSION_PATH}` in templates but the session initialization creates `SESSION_PATH` without the dollar sign. Additionally, in some places it's used as `${SESSION_PATH}` and others as just a placeholder `{path}`.

The command creates:
```bash
SESSION_PATH="ai-docs/sessions/${SESSION_BASE}"
```

But templates reference:
```
${SESSION_PATH}/reviews/design-review/{model}.md
```

The `{model}` part is a template placeholder while `${SESSION_PATH}` is a shell variable - this mixing could confuse implementers.

**Impact**: Potential path errors during implementation.

**Fix**: Standardize variable usage:
- Shell variables: `${SESSION_PATH}`
- Template placeholders: `{model}`, `{target}`, etc.
- Document the distinction clearly

**Location**: Throughout, especially lines 500, 885-909, 1236-1239

---

## MEDIUM Priority Issues

### Issue 6: TodoWrite Items Mismatch Between Agent and Command

**Category**: Workflow Consistency
**Severity**: MEDIUM

**Description**: The agent's TodoWrite workflow (lines 176-183) lists 6 phases:
1. Validate inputs
2. Determine Gemini access method
3. Analyze design reference
4. Apply design principles
5. Generate structured feedback
6. Present results

But the agent's actual `<workflow>` section has 6 phases with different names:
1. Input Validation
2. Gemini Setup
3. Visual Analysis
4. Design Principles Application
5. Report Generation
6. Results Presentation

These should align for clarity.

**Impact**: Confusion during implementation about what to track in TodoWrite.

**Fix**: Align the TodoWrite items with the workflow phase names.

**Location**: Lines 176-183 vs 243-301

---

### Issue 7: Missing Claudish Installation Check in Agent

**Category**: Error Handling
**Severity**: MEDIUM

**Description**: The command includes a Claudish availability check in Phase 2 (line 1004-1007):
```bash
npx claudish --version 2>/dev/null || echo "Claudish not found"
```

But the agent doesn't include this check before attempting to use Claudish. If Claudish isn't available, the agent will fail with an unclear error.

**Impact**: Poor error messages if Claudish is missing.

**Fix**: Add Claudish availability check to agent's Phase 2 (Gemini Setup).

**Location**: Lines 259-264 (agent Phase 2)

---

### Issue 8: Skill References Non-Existent Skill

**Category**: Dependency
**Severity**: MEDIUM

**Description**: The command frontmatter references:
```yaml
skills: orchestration:ui-design-review, orchestration:session-isolation, orchestration:multi-model-validation
```

The `orchestration:session-isolation` skill doesn't exist in the current orchestration plugin. The design doesn't include a definition for this skill.

**Impact**: Command will fail to load if skill doesn't exist.

**Fix**: Either:
1. Remove the `orchestration:session-isolation` skill reference, OR
2. Add a session-isolation skill design to this document, OR
3. Note that session-isolation is an existing/planned skill to be implemented separately

**Location**: Line 805

---

### Issue 9: Model Prefix Logic Could Be Clearer

**Category**: Documentation
**Severity**: MEDIUM

**Description**: The model routing logic is spread across multiple sections (Overview lines 44-52, Agent lines 199-211, Skill lines 549-575). While correct, consolidating the logic in one canonical location would improve maintainability.

Additionally, the skill shows:
```bash
elif [[ -n "$OPENROUTER_API_KEY" ]]; then
  echo "or/google/gemini-3-pro-preview"
else
  echo "ERROR: No API key available"
```

But the agent shows:
```bash
if [[ -n "$GEMINI_API_KEY" ]]; then
  GEMINI_MODEL="g/gemini-3-pro-preview"
else
  GEMINI_MODEL="or/google/gemini-3-pro-preview"
```

The agent version doesn't check for OPENROUTER_API_KEY before falling back.

**Impact**: Agent might try OpenRouter without checking if key exists.

**Fix**: Align the model selection logic between agent and skill. The skill version is more complete.

**Location**: Lines 199-211 (agent) vs 549-563 (skill)

---

### Issue 10: Review Document Template Has Inconsistent Placeholders

**Category**: Template Quality
**Severity**: MEDIUM

**Description**: The review document template (lines 434-486) mixes placeholder styles:
- `{target}` - curly braces
- `{X}/10` - curly braces with literal
- `{usability|accessibility|consistency|comprehensive}` - options in curly braces
- `{issues or "None found"}` - logic expression in curly braces

This inconsistency makes it unclear how to fill in the template programmatically.

**Impact**: Implementer confusion about template rendering.

**Fix**: Standardize placeholder format and document how each should be filled:
- Simple substitution: `{{target}}`
- Conditional: `{{#if issues}}...{{else}}None found{{/if}}`
- Or just use consistent format and document clearly

**Location**: Lines 434-486

---

## LOW Priority Issues

### Issue 11: Missing Version in Agent Frontmatter

**Category**: Frontmatter Completeness
**Severity**: LOW

**Description**: The agent frontmatter doesn't include a version field. While not required by the schema, it's helpful for tracking changes.

**Impact**: Minor - harder to track agent version separately from plugin version.

**Fix**: Consider adding `version: 1.0.0` to agent frontmatter.

**Location**: Lines 66-81

---

### Issue 12: Example Names Could Be More Descriptive

**Category**: Documentation Quality
**Severity**: LOW

**Description**: The command examples (lines 1188-1222) have good content but generic names:
- "Screenshot Usability Review"
- "Accessibility Audit"
- "No API Key Graceful Degradation"

More descriptive names would help implementers understand the scenario at a glance.

**Impact**: Minor clarity improvement.

**Fix**: Consider names like:
- "Happy Path: Dashboard Screenshot Review"
- "Happy Path: Login Form WCAG Audit"
- "Error Handling: No API Keys Available"

**Location**: Lines 1189, 1201, 1213

---

### Issue 13: Gestalt Principles List Incomplete

**Category**: Knowledge Completeness
**Severity**: LOW

**Description**: The knowledge section lists Gestalt principles as:
```
- Proximity, Similarity, Continuity, Closure, Figure-Ground
```

This is missing common Gestalt principles like:
- Common Fate
- Common Region
- Symmetry

**Impact**: Minor - agent may not cite all relevant principles.

**Fix**: Expand Gestalt principles list or note "including but not limited to".

**Location**: Lines 327-328

---

## Positive Observations

### Strengths

1. **Comprehensive PROXY_MODE Support**: The design correctly implements PROXY_MODE with error handling and prefix collision awareness (lines 109-162). This follows the pattern from `agentdev:patterns` skill precisely.

2. **Excellent Gemini Routing Logic**: The `or/` prefix usage for OpenRouter is correctly documented to avoid prefix collisions with `google/` (lines 44-52, 565-575).

3. **Strong Error Recovery Section**: The command includes well-thought-out error recovery strategies for four distinct failure scenarios (lines 1154-1186).

4. **Good Knowledge Section**: The design principles reference (Nielsen's heuristics, WCAG, Gestalt) provides excellent grounding for review feedback (lines 304-333).

5. **Clear Workflow Phases**: Both agent and command have well-defined phases with quality gates, following orchestration patterns correctly.

6. **Session Isolation**: The command creates unique session directories with proper structure, following the session-based workspace pattern from multi-model-validation skill.

7. **Graceful Degradation**: The design handles missing API keys gracefully with clear user guidance (lines 1010-1035, 1155-1160).

---

## Recommendations Summary

### Must Fix Before Implementation (CRITICAL + HIGH)

1. **Resolve Write tool contradiction** - Agent needs Write tool to write review documents
2. **Add Write to agent tools** - Update frontmatter
3. **Clarify command file format** - No code fences between frontmatter and prompt
4. **Standardize session path variables** - Distinguish shell variables from template placeholders
5. **Verify skill references exist** - Remove or add `orchestration:session-isolation`

### Should Fix (MEDIUM)

6. Align TodoWrite items with workflow phases
7. Add Claudish check to agent
8. Consolidate model routing logic
9. Standardize template placeholder format

### Nice to Have (LOW)

10. Add version to agent frontmatter
11. More descriptive example names
12. Expand Gestalt principles list

---

## Approval Decision

**Status**: CONDITIONAL PASS

**Rationale**: The design is comprehensive and demonstrates strong understanding of the agent development patterns. The core architecture (agent + skill + command) is sound. However, the CRITICAL issue with Write tool contradiction must be resolved before implementation, along with the HIGH priority issues around frontmatter format and variable consistency.

**Conditions for Full Approval**:
1. Resolve the Write tool contradiction (Issue 1)
2. Fix agent tool list (Issue 2)
3. Clarify command file format (Issue 4)
4. Verify or remove session-isolation skill reference (Issue 8)

Once these are addressed, the design is ready for implementation.

---

*Generated by Claude Opus 4.5 (Internal Reviewer)*
