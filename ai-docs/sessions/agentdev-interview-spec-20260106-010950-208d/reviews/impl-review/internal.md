# Implementation Review: interview.md

**Status**: PASS
**Reviewer**: Claude Opus 4.5 (internal)
**File**: /Users/jack/mag/claude-code/plugins/dev/commands/interview.md
**Date**: 2026-01-06

---

## Summary

- **CRITICAL**: 0
- **HIGH**: 1
- **MEDIUM**: 4
- **LOW**: 3

---

## Issues

### HIGH Priority Issues

#### 1. Missing `name` field in YAML frontmatter

- **Category**: YAML Schema
- **Description**: Commands should have a `name` field in the frontmatter for proper identification. The schema shows `allowed-tools` which is correct for commands, but no `name` is present.
- **Impact**: Plugin systems may not correctly identify this command.
- **Fix**: Add `name: interview` to the frontmatter.
- **Location**: Lines 1-10

---

### MEDIUM Priority Issues

#### 1. HTML entities used instead of actual characters in some XML

- **Category**: XML Structure
- **Description**: The XML uses `&amp;` (line 244, 539, 621, 753, etc.) and `&gt;`/`&lt;` (lines 347, 711, 835) which is technically correct for XML parsing but inconsistent with other parts of the file that use raw characters.
- **Impact**: May cause confusion during maintenance. Some parts use `>` directly in condition text.
- **Fix**: Choose one approach consistently. Since this is markdown with XML tags, raw characters are fine outside of attribute values.
- **Location**: Lines 244, 347, 539, 621, 711, 753, 790, 835, 1147

#### 2. Missing skills field validation for referenced agents

- **Category**: Completeness
- **Description**: The command references agents (`scribe`, `stack-detector`, `spec-writer`) but doesn't list them in a skills or agents dependency field. If these agents don't exist in the plugin, the command will fail.
- **Impact**: Runtime failures if referenced agents are missing.
- **Fix**: Either add an `agents` field to the frontmatter listing required agents, or ensure documentation mentions these agents must exist.
- **Location**: Throughout PHASE 0-5 in Task delegations

#### 3. Extended thinking instruction lacks specificity

- **Category**: Clarity
- **Description**: References to "ultrathink" and "extended thinking" (lines 59, 401, 825, 937, 1028, 1089) assume the orchestrator understands how to trigger extended thinking mode. No explicit instructions on how to request this capability.
- **Impact**: May not trigger extended thinking correctly.
- **Fix**: Add a `<extended_thinking>` section in `<knowledge>` explaining how to invoke ultrathink mode via prompt patterns or model parameters.
- **Location**: Lines 59, 401, 825, 937

#### 4. Coverage calculation references min_questions but values not always defined

- **Category**: Completeness
- **Description**: The `<coverage_calculation>` section references `min_questions_per_category` but only some categories in `<question_categories>` have `min_questions` attributes defined. The "Technical Preferences" category has `min_questions="2"` while others have `min_questions="3"`.
- **Impact**: Coverage calculation may be inconsistent if some categories lack explicit min_questions.
- **Fix**: Ensure all categories have explicit `min_questions` attributes defined for consistency.
- **Location**: Lines 693-827 (question_categories), 829-848 (coverage_calculation)

---

### LOW Priority Issues

#### 1. Inconsistent code block language annotations

- **Category**: Formatting
- **Description**: Some code blocks use ` ```bash` while others use ` ```json` or just ` ``` ` without language. Consistency would improve readability.
- **Impact**: Minor - affects syntax highlighting in some editors.
- **Fix**: Add language annotations to all code blocks.
- **Location**: Various locations throughout

#### 2. Proactive trigger threshold documentation could be clearer

- **Category**: Clarity
- **Description**: The `<trigger>` elements in `<proactive_detection>` use a `threshold` attribute but don't explicitly explain that this is a count of keyword occurrences in the interview transcript.
- **Impact**: Minor - may cause confusion about what threshold means.
- **Fix**: Add a brief explanation before the triggers: "Threshold = number of keyword mentions that trigger the action."
- **Location**: Lines 893-962

#### 3. Missing explicit TODO state transitions in examples

- **Category**: Completeness
- **Description**: The examples show execution flow but don't explicitly show TodoWrite state transitions (marking phases as in_progress/completed). Since TodoWrite is a critical constraint, examples should demonstrate this.
- **Impact**: Minor - examples are otherwise comprehensive.
- **Fix**: Add TodoWrite state annotations to examples, e.g., "[TodoWrite: Mark PHASE 2 as in_progress]"
- **Location**: Lines 964-1055

---

## Positive Observations

### Strengths

1. **Comprehensive 6-phase workflow**: All phases are well-defined with clear objectives, steps, and quality gates. The progression from initialization through synthesis to task breakdown is logical.

2. **Excellent 5 Whys technique integration**: The `<five_whys_technique>` section (lines 850-875) provides clear guidance on when to apply the technique, how to use it, and when to stop. The example chain is particularly helpful.

3. **Non-obvious questions are genuinely non-obvious**: The question categories contain thoughtful, counter-intuitive questions like "What feature request would you refuse, even if users asked for it?" and "Which is worse: slow and correct, or fast and occasionally wrong?" These go beyond surface-level requirements gathering.

4. **Proactive triggers with thresholds**: Each trigger in `<proactive_detection>` has a defined threshold (e.g., 2+ mentions of "api" to trigger OpenAPI collection). This prevents over-eager asset collection while ensuring important topics are captured.

5. **Session resume capability**: The `--resume SESSION_ID` pattern is well-designed with checkpoint storage in session-meta.json, enabling users to pause long interviews and continue later.

6. **SESSION_PATH requirement is explicit**: The `<session_path_requirement>` constraint clearly mandates that all Task delegations start with SESSION_PATH prefix, ensuring consistent session directory usage.

7. **Error recovery strategies are comprehensive**: Seven distinct recovery strategies (lines 1057-1122) cover common interview challenges from short answers to contradictions to pause requests.

8. **TodoWrite integration is prominent**: The `<todowrite_requirement>` is the first critical constraint, and the workflow explicitly calls out marking phases as in_progress/completed.

---

## Scores

| Area | Score | Notes |
|------|-------|-------|
| YAML Frontmatter | 8/10 | Valid syntax, good description, missing `name` field |
| XML Structure | 9/10 | All tags properly closed, good nesting, minor entity inconsistency |
| Workflow Completeness | 10/10 | All 6 phases present with quality gates |
| Interview Design | 10/10 | Non-obvious questions, 5 Whys, proactive triggers |
| Examples | 9/10 | 3 solid examples covering main scenarios |
| TodoWrite Integration | 9/10 | Present in constraints and workflow, less explicit in examples |
| Tools & Skills | 8/10 | Appropriate tools, referenced agents not declared |
| Error Recovery | 10/10 | Comprehensive 7-strategy coverage |
| **Total** | **9.1/10** | |

---

## Recommendation

**APPROVE**

This is a high-quality interview orchestrator command. The implementation demonstrates strong requirements engineering principles with thoughtful question design, progressive deepening, and comprehensive error recovery.

**Before production use:**

1. **Add `name: interview` to frontmatter** (HIGH priority)
2. Verify that `scribe`, `stack-detector`, and `spec-writer` agents exist in the plugin
3. Consider adding explicit ultrathink invocation instructions

The non-obvious questions are genuinely insightful - questions like "What would make a user recommend this feature to a colleague?" and "What error should we let users fix themselves vs call support?" demonstrate deep understanding of requirements elicitation beyond surface-level questioning.

---

*Review generated by Claude Opus 4.5*
*Session: agentdev-interview-spec-20260106-010950-208d*
