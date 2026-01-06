# UI Design Agent Design Plan Review

**Reviewer**: GPT-5.2 (via Grok proxy due to OpenAI API routing issue)
**Date**: 2026-01-05
**Target**: ai-docs/sessions/agentdev-ui-designer-20260105-210820-8287/design.md

---

## Executive Summary

**Overall Assessment**: CONDITIONAL PASS

The design is comprehensive with solid architectural foundations, but contains several technical issues that must be resolved before implementation can proceed safely.

| Category | Rating | Status |
|----------|--------|--------|
| Design Completeness | 8/10 | GOOD |
| XML/YAML Structure | 6/10 | NEEDS WORK |
| TodoWrite Integration | 7/10 | ADEQUATE |
| Proxy Mode Support | 8/10 | GOOD |
| Example Quality | 8/10 | GOOD |
| Gemini Model Routing | 5/10 | CRITICAL ISSUES |
| Error Handling | 7/10 | ADEQUATE |

**Issue Summary**:
- CRITICAL: 2
- HIGH: 3
- MEDIUM: 4
- LOW: 2

---

## Detailed Findings

### 1. Design Completeness

**Rating**: GOOD (8/10)

**Strengths**:
- Comprehensive three-component architecture (Agent/Skill/Command)
- Strong session management with artifact isolation
- Extensive workflow documentation with quality gates
- Good multi-modal validation integration patterns
- Clear implementation checklist

**Gaps**:

#### [MEDIUM] M1: Missing Testing Strategy
**Description**: No unit test or integration test requirements outlined
**Impact**: Implementation may lack test coverage
**Fix**: Add testing requirements to Implementation Checklist:
```markdown
### Phase 3.5: Testing
- [ ] Unit test Gemini model selection logic
- [ ] Integration test with mock Claudish responses
- [ ] E2E test with real images (manual)
```

#### [MEDIUM] M2: Missing Performance Considerations
**Description**: No discussion of Gemini API latency, rate limits, or image size limits
**Impact**: Users may encounter unexpected delays or failures
**Fix**: Add to skill's knowledge section:
```markdown
## Performance Considerations

- **Gemini Latency**: 2-5s for image analysis (expect higher for complex images)
- **Rate Limits**: Gemini Direct: 60 RPM, OpenRouter: varies by tier
- **Image Size**: Max 20MB, recommend <5MB for faster processing
- **Timeout**: Set 30s timeout for Claudish calls
```

---

### 2. XML/YAML Structure Validity

**Rating**: NEEDS WORK (6/10)

#### [CRITICAL] C1: Unclosed XML Block in Agent System Prompt
**Description**: The agent system prompt XML block (lines 85-508) has an unclosed code block marker
**Location**: Line 508 shows closing ``` but the XML tags are inside the code block
**Impact**: Agent will fail to load - Claude Code cannot parse malformed markdown
**Fix**: The system prompt should NOT be wrapped in a code block. Change:
```markdown
### System Prompt

```xml       <-- REMOVE THIS
<role>
...
</role>
```           <-- REMOVE THIS
```

To:
```markdown
### System Prompt

<role>
...
</role>
```

#### [HIGH] H1: Command XML Also Wrapped in Code Block
**Description**: Similar issue at lines 809-1243
**Location**: Command content wrapped in ```xml code fence
**Impact**: Command will fail to load
**Fix**: Remove the code fence wrapping, present raw XML

#### [HIGH] H2: Skill Content in Code Block
**Description**: Skill content (lines 522-782) wrapped in markdown code block
**Location**: ```markdown at line 522
**Impact**: Skill metadata won't be parsed correctly
**Fix**: Remove code fence, present raw content

#### [MEDIUM] M3: YAML Frontmatter Inside Code Block
**Description**: The YAML frontmatter for each component is shown inside code blocks
**Impact**: This is documentation, but could confuse implementers
**Fix**: Clarify that code blocks are for illustration; actual files should have raw frontmatter

---

### 3. TodoWrite Integration

**Rating**: ADEQUATE (7/10)

**Strengths**:
- Agent workflow tracks 6-phase analysis
- Command orchestration has 5-phase user workflow
- Proper completion marking patterns documented

**Issues**:

#### [MEDIUM] M4: Inconsistent Todo State Descriptions
**Description**: todowrite_requirement shows workflow steps but doesn't specify activeForm for each
**Location**: Lines 175-183 (agent), lines 850-858 (command)
**Impact**: Developer may implement incorrect activeForm values
**Fix**: Add explicit activeForm examples:
```xml
<todowrite_requirement>
  Example TodoWrite call:
  {
    "todos": [
      {"content": "Validate inputs", "status": "in_progress", "activeForm": "Validating inputs"},
      {"content": "Determine Gemini access method", "status": "pending", "activeForm": "Determining Gemini access method"},
      ...
    ]
  }
</todowrite_requirement>
```

#### [LOW] L1: Missing Error/Blocked States
**Description**: No guidance for handling failed or blocked todo items
**Impact**: Unclear how to represent failures in TodoWrite
**Fix**: Add note about keeping failed items as in_progress with error context in comments

---

### 4. Proxy Mode Support

**Rating**: GOOD (8/10)

**Strengths**:
- Prefix collision awareness well documented
- Comprehensive error reporting format
- Session path handling included
- Clear distinction between GEMINI_API_KEY and OPENROUTER_API_KEY routing

**Issues**:

#### [HIGH] H3: Incorrect Claudish Flag
**Description**: Document references `--auto-approve` flag which doesn't exist
**Location**: Lines 115, 274
**Impact**: Claudish invocations will fail with "unknown option" error
**Fix**: Remove `--auto-approve` flag. Claudish auto-approves by default; use `--no-auto-approve` to disable.
```bash
# INCORRECT
printf '%s' "$PROMPT" | npx claudish --stdin --model {model_name} --quiet --auto-approve

# CORRECT
printf '%s' "$PROMPT" | npx claudish --stdin --model {model_name} --quiet
```

---

### 5. Example Quality

**Rating**: GOOD (8/10)

**Strengths**:
- Covers major scenarios (usability, accessibility, comparison)
- Includes error cases (no API key graceful degradation)
- Clear step-by-step execution flow
- Examples in both agent and command sections

**Issues**:

#### [LOW] L2: Missing Task Tool Invocation Syntax
**Description**: Examples show conceptual flow but not actual Task tool syntax
**Impact**: Implementers may not know exact Task tool format
**Fix**: Add one concrete Task tool example:
```markdown
<example name="Concrete Task Invocation">
  ```
  Task({
    subagent_type: "orchestration:ui-designer",
    description: "Design review via Gemini",
    prompt: `SESSION_PATH: ${SESSION_PATH}

    Review the design at: screenshots/dashboard.png
    Review Type: Usability
    Model: g/gemini-3-pro-preview

    Write review to: ${SESSION_PATH}/reviews/design-review/gemini.md`
  })
  ```
</example>
```

---

### 6. Gemini Model Routing Logic

**Rating**: CRITICAL ISSUES (5/10)

#### [CRITICAL] C2: Incorrect or/ Prefix Usage
**Description**: The design states `or/google/gemini-3-pro-preview` for OpenRouter routing, but this is incorrect for Claudish v1.3.0+
**Location**: Lines 49, 205, 567-573
**Impact**: API calls will fail with "model not found" error

**Analysis**:
The design correctly identifies the prefix collision problem but applies the wrong solution.

Current Claudish routing:
| Model ID | Routes To | API Key Required |
|----------|-----------|------------------|
| `google/gemini-*` | **Gemini Direct** | GEMINI_API_KEY |
| `g/gemini-*` | **Gemini Direct** | GEMINI_API_KEY |
| `or/google/gemini-*` | **Invalid** | N/A |

The `or/` prefix forces OpenRouter routing, but then `google/` is passed to OpenRouter which doesn't recognize it as a prefix - it's the literal model ID on OpenRouter.

**Correct Routing**:
```bash
# Gemini Direct (when GEMINI_API_KEY available)
GEMINI_MODEL="g/gemini-3-pro-preview"

# OpenRouter (when only OPENROUTER_API_KEY available)
GEMINI_MODEL="google/gemini-3-pro-preview"  # NO or/ prefix needed!
```

**Why This Works**:
- When OPENROUTER_API_KEY is set but GEMINI_API_KEY is NOT set, Claudish won't try Gemini Direct
- The `google/` prefix on OpenRouter is the actual model ID, not a routing directive
- Only use `or/` prefix when you have BOTH keys set and want to force OpenRouter

**Fix**: Update model routing logic throughout document:
```bash
determine_gemini_model() {
  if [[ -n "$GEMINI_API_KEY" ]]; then
    echo "g/gemini-3-pro-preview"  # Explicit Gemini Direct
  elif [[ -n "$OPENROUTER_API_KEY" ]]; then
    echo "google/gemini-3-pro-preview"  # OpenRouter model ID (no or/ prefix)
  else
    echo "ERROR: No API key available"
    return 1
  fi
}
```

**Additional Consideration**: If user has BOTH keys, which to prefer? Current design doesn't address this. Add priority rule:
```markdown
**Priority**: GEMINI_API_KEY > OPENROUTER_API_KEY
**Rationale**: Gemini Direct has lower latency and no markup
```

---

### 7. Error Handling Coverage

**Rating**: ADEQUATE (7/10)

**Strengths**:
- API errors, file not found, Claudish installation errors covered
- Clear recovery instructions for each scenario
- Graceful degradation when APIs unavailable

**Issues**:

#### [MEDIUM] M5: Missing Session Path Validation
**Description**: No validation of SESSION_PATH against path traversal attacks
**Location**: Session path is used directly from directive without sanitization
**Impact**: Potential security issue if malicious SESSION_PATH provided
**Fix**: Add validation step:
```bash
# Validate SESSION_PATH
validate_session_path() {
  local path="$1"

  # Reject path traversal
  if [[ "$path" == *".."* ]]; then
    echo "ERROR: Invalid session path (contains ..)"
    return 1
  fi

  # Ensure within allowed directories
  if [[ "$path" != ai-docs/* && "$path" != /tmp/* ]]; then
    echo "ERROR: Session path must be in ai-docs/ or /tmp/"
    return 1
  fi

  return 0
}
```

---

## Priority Remediation Plan

### CRITICAL (Must Fix Before Implementation)

1. **C1**: Remove code block wrapping from agent system prompt XML
2. **C2**: Fix Gemini model routing logic - remove incorrect `or/` prefix usage

### HIGH Priority (Fix in First Iteration)

3. **H1**: Remove code block wrapping from command XML
4. **H2**: Remove code block wrapping from skill content
5. **H3**: Remove non-existent `--auto-approve` flag from Claudish commands

### MEDIUM Priority (Fix Before Release)

6. **M1**: Add testing strategy to implementation checklist
7. **M2**: Add performance considerations section
8. **M3**: Clarify that code blocks in design doc are for illustration
9. **M4**: Add explicit activeForm examples for TodoWrite
10. **M5**: Add session path validation

### LOW Priority (Nice to Have)

11. **L1**: Document how to handle blocked/failed todo states
12. **L2**: Add concrete Task tool invocation example

---

## Conclusion

This design demonstrates strong architectural thinking and comprehensive coverage of the UI design review workflow. The three-component structure (Agent/Skill/Command) is well-conceived, and the integration with existing orchestration patterns (session isolation, multi-model validation) is thoughtful.

However, **two critical issues must be resolved before implementation**:

1. The XML content is wrapped in code blocks which will prevent Claude Code from parsing the agents/commands/skills
2. The Gemini model routing logic uses an incorrect `or/` prefix that will cause API failures

Once these critical issues are addressed, the design is ready for implementation. The remaining HIGH and MEDIUM issues can be addressed during implementation or before release.

**Recommendation**: CONDITIONAL PASS - Proceed with implementation after fixing C1 and C2.

---

*Review generated via x-ai/grok-code-fast-1 (GPT-5.2 unavailable due to OpenRouter API routing issue)*
*Session: agentdev-ui-designer-20260105-210820-8287*
