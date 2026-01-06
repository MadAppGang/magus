# Review: /dev:interview Command Design

## PROXY_MODE Failed

**Requested Model:** google/gemini-2.5-flash
**Detected Backend:** Gemini Direct API (due to `google/` prefix collision)
**Error:** Missing GEMINI_API_KEY environment variable

**Possible Causes:**
- Missing API key for Gemini Direct backend
- Prefix collision: `google/` routes to Gemini Direct instead of OpenRouter
- Try using a different model without the `google/` prefix

**Task NOT Completed via External Model.**

---

## Fallback: Internal Review by Claude Opus 4.5

Since the external model request failed, here is an internal review of the design document.

**Status**: CONDITIONAL
**Reviewer**: claude-opus-4.5 (fallback)

### Issue Summary
- CRITICAL: 0
- HIGH: 3
- MEDIUM: 4
- LOW: 3

---

### HIGH Priority Issues

#### Issue 1: Write Tool Listed as Forbidden but May Be Needed
- **Category**: Tool Configuration
- **Description**: The design explicitly forbids Write and Edit tools, but the orchestrator needs to create multiple files: `interview-log.md`, `focus-areas.md`, `assets.md`, `spec.md`, `tasks.md`, and `session-meta.json`. Without Write tool, these cannot be created.
- **Impact**: The command cannot execute its core workflow - creating the interview log and specification documents.
- **Fix**: Either:
  1. Add Write tool to allowed-tools (recommended), OR
  2. Delegate ALL file writing to a separate agent via Task tool (adds complexity)
- **Location**: Command Frontmatter, allowed-tools section

#### Issue 2: stack-detector Agent Not Defined
- **Category**: Integration
- **Description**: Phase 1 delegates to "stack-detector agent" but this agent is not defined in the dev plugin. The existing agent is `dev:assistant` which has context detection skills, but no dedicated stack-detector agent exists.
- **Impact**: The command will fail in Phase 1 when trying to launch a non-existent agent.
- **Fix**: Either:
  1. Use `dev:assistant` with stack detection prompt, OR
  2. Create a new `stack-detector` agent, OR
  3. Handle stack detection inline using Glob/Grep/Read tools
- **Location**: Workflow Phase 1, step 2

#### Issue 3: Ultrathink/Extended Thinking Not Available in Commands
- **Category**: Capability
- **Description**: The design references "ultrathink (extended thinking)" for tech stack recommendations. However, Claude Code commands do not have access to extended thinking mode - this is a model capability that requires specific API parameters not available in the command context.
- **Impact**: Tech stack recommendations may be less thorough than expected.
- **Fix**: Remove ultrathink references and replace with:
  1. "Use thorough analysis" or "Consider carefully", OR
  2. Delegate to an agent with opus model (which may have better reasoning)
- **Location**: Critical Constraints, Phase 3

---

### MEDIUM Priority Issues

#### Issue 4: Session Path Variable Inconsistency
- **Category**: Implementation Detail
- **Description**: The document uses `${SESSION_PATH}` in templates but the bash code creates `SESSION_PATH` without export. This may cause issues when the variable is needed in subprocesses or agents.
- **Impact**: Agents launched via Task may not receive the SESSION_PATH.
- **Fix**: Add `export SESSION_PATH` after creation, or pass it explicitly in Task prompts.
- **Location**: Workflow Phase 0

#### Issue 5: Coverage Percentage Tracking Mechanism Unclear
- **Category**: Completeness
- **Description**: The design mentions "70% coverage" threshold and tracking coverage percentages per category, but does not specify HOW to calculate or track these percentages. Is it based on questions answered? Topics covered? User satisfaction?
- **Impact**: Implementation may be inconsistent without clear metrics.
- **Fix**: Add a section defining:
  - How coverage is measured (e.g., checklist of key topics per category)
  - What constitutes 100% for each category
  - How to update percentages after each round
- **Location**: Knowledge Section or new section

#### Issue 6: AskUserQuestion Batching Not Detailed
- **Category**: UX Design
- **Description**: The design says "3-5 questions per round (batched)" but AskUserQuestion tool works best with single questions or structured multi-select. Presenting 5 open-ended questions in one call may be awkward.
- **Impact**: User experience may suffer with too many questions at once.
- **Fix**: Specify the exact AskUserQuestion format:
  - One main question with numbered sub-questions in the text?
  - Multiple sequential AskUserQuestion calls?
  - Multi-select for structured choices?
- **Location**: Workflow Phase 2, Interview Loop

#### Issue 7: No Timeout or Session Recovery
- **Category**: Error Recovery
- **Description**: The error recovery section handles user behavior but not system/session issues:
  - What if user closes terminal mid-interview?
  - What if session files are corrupted?
  - How to resume an interrupted interview?
- **Impact**: Lost work if session is interrupted.
- **Fix**: Add:
  1. Session state checkpointing
  2. Resume capability (detect existing session, offer to continue)
  3. Session timeout handling
- **Location**: Error Recovery section

---

### LOW Priority Issues

#### Issue 8: Example Missing Category Coverage Details
- **Category**: Examples
- **Description**: Examples show round counts but not which categories were covered in each round. This makes it harder to understand how the category-based progression works in practice.
- **Impact**: Implementer may not fully understand category rotation.
- **Fix**: Add category tags to example rounds: "Round 1 (Non-Functional): ..."
- **Location**: Examples section

#### Issue 9: Proactive Trigger Keywords May Be Too Broad
- **Category**: Interview Design
- **Description**: Some keyword triggers like "api" or "performance" are very common words. The trigger `style|colors|theme` might fire when discussing code style vs visual style.
- **Impact**: May trigger asset collection questions when not relevant.
- **Fix**: Add context qualifiers or use more specific patterns. Consider:
  - "visual style" vs "code style"
  - "API endpoint" vs "API (in general discussion)"
- **Location**: Proactive Detection section

#### Issue 10: Missing Version/Compatibility Note for Skills
- **Category**: Documentation
- **Description**: Skills referenced (`dev:context-detection`, `dev:universal-patterns`, etc.) should note minimum versions or compatibility requirements.
- **Impact**: May cause confusion if skill APIs change.
- **Fix**: Add version notes: "Requires dev plugin v1.2.0+"
- **Location**: Command Frontmatter, skills field

---

### Strengths

1. **Comprehensive Question Framework**: The 7 question categories with non-obvious questions and 5 Whys integration is well-thought-out and truly goes beyond basic requirements gathering.

2. **Progressive Deepening Strategy**: The approach of starting broad and narrowing down, with explicit iteration limits and user consent for extension, respects user time while ensuring thoroughness.

3. **Asset Collection Integration**: Proactive triggers for collecting API specs, Figma designs, and design system preferences is valuable for creating actionable specifications.

4. **Error Recovery Coverage**: The 6 error recovery strategies cover the most common interview challenges (short answers, contradictions, scope creep, early exit).

5. **Session-Based Architecture**: Using unique session directories with full audit trail (interview-log.md) is excellent for traceability and potential resume capability.

6. **Integration with Dev Plugin**: Clear mapping to follow-on commands (/dev:feature, /dev:create-style, etc.) creates a coherent workflow.

7. **Quality Gates Per Phase**: Each phase has explicit completion criteria, preventing premature advancement.

8. **Spec Document Structure**: The comprehensive spec.md template covers all essential areas including trade-offs and open questions.

---

### Approval Decision

**Status**: CONDITIONAL

**Rationale**:
The design is comprehensive and well-structured with excellent interview methodology. However, there are 3 HIGH priority issues that must be addressed before implementation:

1. **Write tool is required** - The command cannot create its output files without it
2. **stack-detector agent does not exist** - Must use existing agent or create new one
3. **Ultrathink is not available** - Must adjust expectations or delegate to opus model

Once these 3 issues are resolved, the design is ready for implementation. The MEDIUM and LOW issues can be addressed during implementation or in a future iteration.

**Recommended Actions:**
1. Add `Write` to allowed-tools in frontmatter
2. Replace stack-detector reference with `dev:assistant` using context-detection skill
3. Remove ultrathink references and use "thorough analysis" language instead
4. Consider adding session resume capability as a v1.1 feature
