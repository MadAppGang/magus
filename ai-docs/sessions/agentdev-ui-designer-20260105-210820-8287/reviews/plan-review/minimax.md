# UI Designer Design Review

**Reviewer**: minimax/m2.1
**Date**: 2026-01-05
**Design Document**: `ai-docs/sessions/agentdev-ui-designer-20260105-210820-8287/design.md`

---

## Executive Summary

The design document is **comprehensive and well-structured** with clear separation of agent, skill, and command components. However, several issues require attention before implementation.

| Category | Status |
|----------|--------|
| Design Completeness | ✅ Good |
| XML/YAML Structure | ⚠️ Needs fixes |
| TodoWrite Integration | ✅ Well implemented |
| Proxy Mode Support | ⚠️ Incomplete |
| Example Quality | ✅ Strong |
| Model Routing Logic | ✅ Correct |
| Error Handling | ⚠️ Gaps exist |

---

## 1. Design Completeness

### 1.1 Component Coverage ✅

All three components (agent, skill, command) are fully defined with:
- File locations specified
- YAML frontmatter included
- XML system prompts with role/expertise/mission
- Workflow phases clearly documented
- Examples provided

### 1.2 Missing Elements

**CRITICAL**: No CLAUDE.md integration section
- The design doesn't specify what rules should be added to CLAUDE.md for developers
- No mention of claudemem enforcement for review output truncation

**Recommendation**: Add a section documenting CLAUDE.md rules:

```markdown
### CLAUDE.md Updates

Add to project CLAUDE.md:

```markdown
## UI Design Review

** Claudemem Enforcement **: When using ui-designer agent:
- DO NOT use head, tail, awk, or sed on review output
- Use --tokens, --page-size, or --max-depth for pagination
- Preserve full severity information in review documents
```
```

---

## 2. XML/YAML Structure Validity

### 2.1 YAML Frontmatter Issues

**HIGH**: Malformed YAML in agent frontmatter (line 66-81)

```yaml
model: sonnet
```

Should be quoted for consistency with other plugins:
```yaml
model: "sonnet"
```

**LOW**: Color value is valid but unconventional
- "cyan" is valid but the codebase typically uses hex or standard color names
- Consider using `#00FFFF` or standardizing with other reviewer agents

### 2.2 XML Structure Issues

**MEDIUM**: Malformed XML at end of agent (line 507-508)

```xml
</formatting>
```
```

The closing tag has an extra backtick. Should be:
```xml
</formatting>
```

**MEDIUM**: Unclosed XML tag in skill (line 782)

```markdown
## Best Practices
...
```
```

The skill content ends with an unclosed code block at line 782. The triple backticks are not properly closed.

---

## 3. TodoWrite Integration

### 3.1 Agent TodoWrite ✅

The agent correctly specifies TodoWrite in tools and provides detailed workflow tracking:

```yaml
tools: TodoWrite, Read, Bash, Glob, Grep
```

The workflow phases align with TodoWrite tracking (lines 243-301).

**GOOD**: Each phase has clear steps that map to TodoWrite items.

### 3.2 Command TodoWrite ✅

The command properly uses TodoWrite:

```yaml
todowrite_requirement>
  You MUST use TodoWrite to track orchestration workflow:
  1. Initialize session
  2. Gather design references from user
  3. Check API key availability
  4. Configure review type
  5. Execute Gemini analysis
  6. Present results
</todowrite_requirement>
```

**✅ VERDICT**: TodoWrite integration is properly implemented in both agent and command.

---

## 4. Proxy Mode Support

### 4.1 Agent Proxy Mode Implementation

**MEDIUM**: PROXY_MODE directive pattern is inconsistent

The design specifies `PROXY_MODE: {model_name}` (line 112) but the standard pattern in this codebase uses `PROXY_MODE:{model_id}` (no space).

**Recommended fix** at line 112:
```xml
If prompt starts with `PROXY_MODE:{model_id}`:
```

### 4.2 Command Proxy Mode Usage

**MEDIUM**: Multi-model validation example uses wrong syntax (line 1314-1323)

```yaml
Task: ui-designer PROXY_MODE: or/google/gemini-3-pro-preview
```

Should be:
```yaml
Task: ui-designer
PROXY_MODE: or/google/gemini-3-pro-preview
```

The directive should be on its own line, not inline with the agent name.

### 4.3 Missing: SubagentStop Hook

**HIGH**: No SubagentStop hook integration for model performance tracking

When PROXY_MODE is used, the agent should report performance statistics. The design doesn't mention tracking:
- Execution time
- Token usage
- Success/failure rates

**Recommendation**: Add to `<error_handling>` section:

```xml
<subagent_performance>
  After PROXY_MODE execution completes:
  - Record execution time
  - Note any performance issues
  - Report to tracking if configured
</subagent_performance>
```

---

## 5. Example Quality

### 5.1 Examples Overview ✅

Excellent examples provided for:
- Screenshot usability review
- Accessibility audit
- Design comparison
- No API key graceful degradation

### 5.2 Example Improvements

**LOW**: Example variable inconsistency (lines 1191-1198)

```markdown
**PHASE 0**: Create session ui-design-20260105-143022-a3f2
**PHASE 1**: User provides screenshots/dashboard.png
```

The session ID format uses hyphens inconsistently with the design (which uses `ui-design-${SESSION_DATE}-${SESSION_TIME}-${SESSION_RAND}`).

**LOW**: Missing multi-model validation example

The design mentions multi-model workflows (lines 1308-1324) but doesn't include an example showing parallel execution.

---

## 6. Model Routing Logic for Gemini

### 6.1 Routing Logic ✅

The model routing is correctly implemented:

| Condition | Model | Purpose |
|-----------|-------|---------|
| `GEMINI_API_KEY` exists | `g/gemini-3-pro-preview` | Direct Gemini (lower latency) |
| Otherwise | `or/google/gemini-3-pro-preview` | OpenRouter routing |

**✅ VERDICT**: Routing logic is sound and well-documented.

### 6.2 Prefix Collision Awareness ✅

Excellent documentation of prefix collisions (lines 149-162):

- `google/` → Gemini Direct
- `g/` → Gemini Direct
- `or/google/` → OpenRouter

This prevents a common source of errors.

---

## 7. Error Handling Coverage

### 7.1 Agent Error Handling ✅

**GOOD**: Comprehensive PROXY_MODE error handling (lines 119-146):

```xml
<error_handling>
  **CRITICAL: Never Silently Substitute Models**

  When PROXY_MODE execution fails:
  1. **DO NOT** fall back to another model silently
  2. **DO NOT** use internal Claude to complete the task
  3. **DO** report the failure with details
  4. **DO** return to orchestrator for decision
</error_handling>
```

### 7.2 Command Error Handling ✅

**GOOD**: Error recovery strategies defined (lines 1154-1186):

| Scenario | Strategy |
|----------|----------|
| No API keys | Graceful degradation, setup instructions |
| Image file not found | Error with path, search suggestions |
| Gemini API error | Rate limit wait, auth verify, content policy |
| Claudish not installed | Install instructions |

### 7.3 Missing Error Cases

**MEDIUM**: No handling for:
- Invalid image format (corrupted PNG, non-image files)
- Image too large for API limits
- Network timeout during Claudish execution
- Permission denied on session directory

**Recommendation**: Add to command error_recovery section:

```xml
<strategy scenario="Invalid image file">
  <recovery>
    Show error: "Cannot read image. Verify it's a valid PNG/JPG."
    Suggest: "Try converting to PNG with: convert input.jpg output.png"
    Offer: "Provide a different image path"
  </recovery>
</strategy>

<strategy scenario="Image too large">
  <recovery>
    Show: "Image exceeds API limit (~20MB)"
    Suggest: "Compress with: optipng -o7 image.png"
    Or: "Resize: convert image.png -resize 50% small.png"
  </recovery>
</strategy>
```

---

## 8. Additional Issues

### 8.1 Skill Version Mismatch

**LOW**: Skill version is 1.0.0 (line 525) but orchestration plugin is v0.8.0

Consider aligning versioning or documenting why this is independent.

### 8.2 plugin.json Version Inconsistency

**MEDIUM**: Design says v0.9.0 but orchestration plugin is currently v0.8.0

The release checklist correctly shows v0.9.0, but this should be validated against current plugin.json.

### 8.3 Missing: Review File Permission Issue

**HIGH**: Command writes reviews but doesn't check file permissions

In Phase 4 (line 1091), the design assumes write access to `${SESSION_PATH}/reviews/design-review/gemini.md`. Should validate write permissions first.

**Add to Phase 4 steps:**
```bash
# Verify write access
touch "${SESSION_PATH}/reviews/design-review/test.md" 2>/dev/null && rm test.md || echo "Permission denied"
```

---

## Summary of Required Changes

| Severity | Issue | Location | Fix |
|----------|-------|----------|-----|
| CRITICAL | No CLAUDE.md integration | Design document | Add CLAUDE.md rules section |
| HIGH | Malformed XML closing tag | Line 507-508 | Remove extra backtick |
| HIGH | Missing SubagentStop hook | PROXY_MODE section | Add performance tracking |
| HIGH | File permission validation | Phase 4 | Add write access check |
| MEDIUM | YAML quoting inconsistency | Line 76 | Quote model value |
| MEDIUM | Unclosed code block | Skill line 782 | Close triple backticks |
| MEDIUM | PROXY_MODE syntax | Lines 112, 1314-1323 | Fix directive format |
| MEDIUM | Missing error cases | error_recovery | Add image validation |
| LOW | Example session ID format | Lines 1191-1198 | Align with design |
| LOW | Missing multi-model example | Examples section | Add parallel example |
| LOW | Skill version alignment | Line 525 | Document versioning |
| LOW | Color value consistency | Line 77 | Consider hex standardization |

---

## Recommendation

**APPROVED WITH CONDITIONS**

The design is solid and ready for implementation **after** addressing:
1. CRITICAL: Add CLAUDE.md integration section
2. HIGH: Fix malformed XML and add file permission validation
3. HIGH: Add SubagentStop hook for PROXY_MODE tracking

Once these are addressed, the implementation can proceed with high confidence.