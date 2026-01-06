# Review: interview.md (Dev Plugin Command)

**Status**: PASS
**Reviewer**: gemini-3-pro-preview (via PROXY_MODE routing)
**File**: /Users/jack/mag/claude-code/plugins/dev/commands/interview.md

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 3 |
| LOW | 2 |

---

## Issues

### HIGH

#### 1. Missing `scribe` and `spec-writer` Agent Definitions

- **Category**: Completeness / Dependencies
- **Description**: The command delegates to `scribe`, `spec-writer`, and `stack-detector` agents extensively throughout PHASES 0-5. However, the existence and proper definition of these agents is assumed but not verified in this review. If these agents do not exist or lack SESSION_PATH support, the entire workflow will fail.
- **Impact**: Command will fail at runtime if dependent agents are not implemented with correct SESSION_PATH handling.
- **Fix**: Verify that `plugins/dev/agents/scribe.md`, `plugins/dev/agents/spec-writer.md`, and `plugins/dev/agents/stack-detector.md` exist and support the SESSION_PATH prefix pattern documented in this command.
- **Location**: `<orchestrator_role>` section (lines 52-67) and throughout all phases.

---

### MEDIUM

#### 2. Coverage Calculation Could Be More Specific

- **Category**: Completeness
- **Description**: The `<coverage_calculation>` section (lines 829-848) defines coverage as `(key_questions_answered / min_questions_per_category) * 100`. However, "key_questions_answered" is subjective - it states questions count "if they elicit substantive answers" without defining what "substantive" means programmatically.
- **Impact**: May lead to inconsistent coverage tracking across sessions.
- **Fix**: Add explicit criteria for what constitutes a "substantive answer" (e.g., minimum character length, presence of specific keywords, user confirmation).
- **Location**: `<knowledge><coverage_calculation>` (lines 829-848)

#### 3. XML Entity Encoding in Code Blocks

- **Category**: XML Structure / Standards
- **Description**: The document uses XML entity encoding (`&amp;`, `&gt;`, `&lt;`) within code blocks and markdown content (e.g., line 244: `Edge Cases &amp; Errors`, line 321: `Assessment: PASS ✓`, line 540: `Edge Cases &amp; Error Handling`). While this is technically correct XML, it may cause readability issues if the rendering engine doesn't decode entities properly.
- **Impact**: Minor readability issue; functionally correct.
- **Fix**: Consider using CDATA sections for code blocks with special characters, or ensure consistent encoding throughout.
- **Location**: Lines 244, 321, 347, 539, 621, 752, 790, 1147

#### 4. Missing Skill Definitions in Frontmatter

- **Category**: YAML Frontmatter
- **Description**: The frontmatter references skills `dev:context-detection`, `dev:universal-patterns`, `dev:api-design`, `dev:design-references` alongside orchestration skills. The existence and proper loading of these dev-specific skills should be verified.
- **Impact**: If skills don't exist, the command loses access to expected knowledge patterns.
- **Fix**: Verify all referenced skills exist in `plugins/dev/skills/` directory.
- **Location**: Frontmatter (line 9)

---

### LOW

#### 5. Completion Message Template Uses Undefined Conditionals

- **Category**: Formatting
- **Description**: The `<completion_message>` template (lines 1135-1179) uses pseudo-conditionals like `{if design_assets}` and `{end}` which are not standard Markdown or a defined templating language. The execution of these conditionals is ambiguous.
- **Impact**: Orchestrator must interpret these pseudo-conditionals correctly.
- **Fix**: Either document the templating syntax or use explicit inline instructions like "If design assets were collected, add: ..."
- **Location**: `<formatting><completion_message>` (lines 1171-1177)

#### 6. Long Line Count (1181 lines)

- **Category**: Maintainability
- **Description**: At 1181 lines, this command is quite extensive. While comprehensive, it may benefit from modularization into separate skills for question categories, proactive triggers, and error recovery.
- **Impact**: Minor maintainability concern.
- **Fix**: Consider extracting `<question_categories>`, `<proactive_detection>`, and `<error_recovery>` into separate skill files and referencing them.
- **Location**: Entire file

---

## Scores

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 9/10 | Valid syntax, appropriate tools, skill references present (verification pending) |
| XML Structure | 9/10 | All tags properly closed and nested, minor entity encoding inconsistency |
| Completeness | 9/10 | All 6 phases present with detailed steps and quality gates |
| Workflow Design | 10/10 | Excellent 6-phase structure with iteration limits, quality gates, and resume support |
| Interview Design | 10/10 | Exceptional question categories, 5 Whys technique, proactive triggers with thresholds |
| Examples | 10/10 | 3 concrete, comprehensive examples covering key scenarios |
| TodoWrite Integration | 10/10 | Explicit requirement in constraints, used throughout workflow |
| Error Recovery | 10/10 | 7 well-defined recovery strategies covering common interview scenarios |
| SESSION_PATH Support | 10/10 | Comprehensive support with resume capability and checkpoint management |
| **Overall** | **9.6/10** | |

---

## Strengths

1. **Comprehensive 6-Phase Workflow**: The command defines a complete interview lifecycle from initialization through task breakdown, with clear quality gates at each phase.

2. **Excellent Interview Design**: The question categories are thoughtfully designed with:
   - Non-obvious questions that probe deeper than surface-level requirements
   - Counter-intuitive questions that challenge assumptions
   - Clear triggers for 5 Whys technique
   - Coverage calculation methodology

3. **Robust Proactive Detection**: The `<proactive_detection>` section defines 7 keyword triggers with clear thresholds (e.g., "2+ mentions of api -> Ask for OpenAPI spec"). This ensures the interview captures relevant assets automatically.

4. **Strong Resume Support**: The `--resume SESSION_ID` feature with checkpoint management allows users to pause long interviews and continue later - essential for comprehensive specification work.

5. **Delegation Pattern**: Proper orchestrator behavior - delegates all file operations to `scribe` and `spec-writer` agents while maintaining SESSION_PATH context.

6. **Error Recovery**: Seven distinct recovery strategies covering common interview challenges (short answers, contradictions, circular discussions, early termination).

7. **Quality Gates**: Each phase has explicit exit criteria, and the interview loop has both minimum (3) and maximum (10, extendable) round limits.

---

## Recommendation

**APPROVE** - The implementation is production-ready with one verification step required:

**Required Before Use:**
- Verify the existence and SESSION_PATH compatibility of: `scribe`, `spec-writer`, and `stack-detector` agents

**Optional Improvements:**
- Extract large sections into separate skills for maintainability
- Add explicit "substantive answer" criteria to coverage calculation
- Standardize XML entity encoding approach

---

*Review completed: 2026-01-06*
*Reviewer: gemini-3-pro-preview via Claude Code orchestration*
