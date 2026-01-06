# Plan Review: ui Agent Design (Figma MCP Enhancement)

## PROXY_MODE Failed

**Requested Model:** google/gemini-2.5-flash
**Detected Backend:** Gemini Direct API (due to `google/` prefix)
**Error:** Missing GEMINI_API_KEY environment variable

**Possible Causes:**
- Missing API key for Gemini Direct backend
- Prefix collision: `google/` routes to Gemini Direct API, not OpenRouter
- The model ID `google/gemini-2.5-flash` exists on both OpenRouter and Gemini Direct

**Prefix Collision Detected:**
The model ID `google/gemini-2.5-flash` starts with `google/` which routes to Gemini Direct API (requires GEMINI_API_KEY). To use this model via OpenRouter instead, the claudish CLI would need a different routing mechanism.

**Task NOT Completed via External Model.**

---

## Fallback: Internal Claude Review

Since PROXY_MODE failed and no alternative model was specified, proceeding with internal Claude analysis of the design plan.

---

# Design Plan Review: ui Agent (Renamed from ui-designer)

**Reviewer:** Claude (internal, fallback)
**Date:** 2026-01-06
**Document:** ai-docs/sessions/agentdev-ui-figma-rename-20260105-235645-ac1f/design.md

## Overall Assessment

**Status:** CONDITIONAL
**Recommendation:** Approve with minor improvements

## Issue Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 3 |
| LOW | 2 |

---

## Detailed Findings

### 1. Design Completeness

**Score:** 9/10 - Excellent

**Strengths:**
- All major sections are present and complete (role, instructions, knowledge, examples, formatting)
- Comprehensive file change list with specific line numbers
- Clear before/after comparison for changes
- Detailed implementation notes section

**Findings:**
- [LOW] Line numbers in "Files to Update" section (Lines 925-959) are estimates and may drift as the document is edited. Consider using section references instead.

**Verdict:** The design is comprehensive and ready for implementation.

---

### 2. Figma MCP Detection Logic

**Score:** 8/10 - Good with minor issues

**URL Regex Pattern Analysis:**
```regex
https://(?:www\.)?figma\.com/(?:design|file)/([a-zA-Z0-9]+)/([^?]+)(?:\?.*node-id=([0-9:-]+))?
```

**Findings:**

- [MEDIUM] **Node ID Pattern Incomplete**: The regex `[0-9:-]+` for node-id doesn't account for URL-encoded colons. Figma URLs sometimes have `node-id=136%3A5051` (URL-encoded) instead of `136:5051` or `136-5051`.
  - **Fix:** Change to `[0-9:%-]+` or decode URL before matching.

- [LOW] **File name capture is greedy**: The pattern `([^?]+)` captures everything up to `?` but may include URL path segments. Consider: `([^/?]+)` to stop at both `?` and `/`.

**MCP Tool Names:**
The document correctly uses Claude's MCP naming convention:
- `mcp__figma__get_file`
- `mcp__figma__get_file_nodes`
- `mcp__figma__get_images`

**Decision Tree Logic:**
The decision tree (Lines 123-134) is well-structured and follows a sensible priority order.

---

### 3. Fallback Behavior

**Score:** 9/10 - Well specified

**Strengths:**
- Clear priority order for design access methods (Figma MCP -> Gemini Direct -> OpenRouter -> Error)
- User notification requirement when MCP unavailable
- Specific model prefixes documented (`g/` for Gemini, `or/` for OpenRouter)

**Findings:**

- [MEDIUM] **Missing timeout handling**: The design doesn't specify what happens if Figma MCP calls time out. Should there be a fallback to Gemini after MCP timeout?
  - **Recommendation:** Add timeout handling: "If Figma MCP call takes >30 seconds, fall back to Gemini screenshot analysis"

- [MEDIUM] **Screenshot request flow unclear**: When falling back from Figma MCP, the design says "Ask user for screenshot of the Figma design" but doesn't specify:
  - How to request (AskUserQuestion tool?)
  - What format is acceptable
  - What if user can't provide screenshot
  - **Recommendation:** Add explicit screenshot request workflow with format requirements.

---

### 4. File Rename Strategy

**Score:** 10/10 - Comprehensive

**Files Documented:**

| File | Documented | Action |
|------|------------|--------|
| `plugins/dev/agents/ui-designer.md` -> `ui.md` | Yes | Rename + enhance |
| `plugins/dev/plugin.json` | Yes | Update reference |
| `plugins/dev/commands/ui-design.md` | Yes | Update references |
| `plugins/dev/commands/create-style.md` | Yes | Update references |
| `plugins/dev/skills/design/ui-design-review/SKILL.md` | Yes | Update references |
| `plugins/dev/skills/design/design-references/SKILL.md` | Yes | Update references |

**Verdict:** All files requiring updates are documented with specific line numbers and changes.

---

### 5. Example Quality

**Score:** 9/10 - Excellent coverage

**Scenarios Covered:**

| Scenario | Present | Quality |
|----------|---------|---------|
| Figma URL with MCP available | Yes | Good - shows token extraction |
| Figma URL with MCP unavailable (fallback) | Yes | Good - shows graceful degradation |
| No Figma URL (normal flow) | Yes | Good - standard screenshot review |
| PROXY_MODE usage | Yes | Good - complete workflow |
| SESSION_PATH usage | Yes | Good - artifact isolation |
| Accessibility audit | Yes | Good - WCAG-focused |

**Findings:**

- [HIGH] **Example inconsistency**: The PROXY_MODE example (Lines 775-792) shows executing via Claudish but the actual agent is a reviewer that doesn't run Bash commands for proxy mode. The proxy mode pattern should be handled at the Task delegation level, not within the agent's workflow.
  - **Issue:** The example shows the agent itself running `npx claudish` but reviewers typically use PROXY_MODE directive in the Task prompt, not direct Claudish execution.
  - **Recommendation:** Clarify whether:
    a) The agent detects PROXY_MODE and delegates externally (current design), OR
    b) The orchestrator handles PROXY_MODE before agent launch

---

## Additional Observations

### Positive Highlights

1. **Style Detection Integration**: The design preserves the sophisticated style detection workflow from the original agent.

2. **Feedback Loop**: The in-session pattern learning (3+ occurrences triggers style suggestion) is practical and doesn't require persistence.

3. **Tool Recommendations Table**: Clear distinction between required tools and MCP tools available conditionally.

4. **Design Token Extraction**: Good addition to include extracted tokens in review output when using Figma MCP.

### Minor Suggestions

1. Consider adding a section on **error messages** - what specific errors to show users when:
   - Figma MCP is not configured
   - GEMINI_API_KEY is missing
   - Image file doesn't exist

2. The **completion template** could include a "Design Access Method" field to help users understand which path was taken.

---

## Recommendations Summary

### Must Fix Before Implementation

1. **Clarify PROXY_MODE handling** (HIGH): Determine if proxy mode is agent-internal or orchestrator-level.

### Should Fix

2. **Enhance node-id regex** (MEDIUM): Handle URL-encoded colons in Figma node IDs.

3. **Add MCP timeout handling** (MEDIUM): Specify fallback behavior on MCP timeout.

4. **Document screenshot request flow** (MEDIUM): Add explicit workflow for requesting screenshots.

### Nice to Have

5. **Use section references** (LOW): Replace line numbers with section names for durability.

6. **Tighten filename regex** (LOW): Prevent capturing path segments in filename.

---

## Approval Decision

**Status:** CONDITIONAL PASS

**Rationale:** The design is comprehensive and well-structured with excellent coverage of Figma MCP integration. The single HIGH issue (PROXY_MODE example inconsistency) is a documentation clarity issue, not a functional problem. The design can proceed to implementation with the understanding that the PROXY_MODE handling follows the standard Task-level directive pattern.

**Required Actions:**
- Clarify PROXY_MODE example to match actual delegation pattern

**Recommended Actions:**
- Address MEDIUM issues for robustness
- Consider adding error message specifications

---

*Review generated by Claude (internal fallback) after PROXY_MODE: google/gemini-2.5-flash failed due to prefix collision (missing GEMINI_API_KEY)*
