# Review: interview.md

**Status**: PASS
**Reviewer**: minimax/minimax-m2.1
**File**: /Users/jack/mag/claude-code/plugins/dev/commands/interview.md

## Summary
- CRITICAL: 0
- HIGH: 1
- MEDIUM: 3
- LOW: 2

## Issues

### CRITICAL
None.

### HIGH

#### H1: Missing Agents Definition
- **Category**: Completeness
- **Description**: The command delegates to `scribe`, `stack-detector`, and `spec-writer` agents but these agents are not defined in the document and must exist in the dev plugin's agents directory.
- **Impact**: If agents don't exist, Tasks will fail at runtime.
- **Fix**: Verify these agents exist in `plugins/dev/agents/` or create them.
- **Location**: Lines 157-180, 211-217, 463-594

### MEDIUM

#### M1: XML Entity Encoding
- **Category**: XML Structure
- **Description**: Uses `&amp;` and `&gt;` correctly in most places, but `<` is used directly in coverage calculation section (line 843: `< 70%`).
- **Impact**: May cause XML parsing issues in strict parsers.
- **Fix**: Replace `<` with `&lt;` in text nodes: `&lt; 70%`.
- **Location**: Line 843

#### M2: Inconsistent Task Prompt Format
- **Category**: Consistency
- **Description**: Some Task prompts use code blocks for JSON/markdown content, others use inline formatting. Should be consistent.
- **Impact**: Minor readability issue, no functional impact.
- **Fix**: Standardize on code blocks for multi-line content in Task prompts.
- **Location**: Throughout workflow phases

#### M3: Missing Explicit Model Specification in Frontmatter
- **Category**: Schema Compliance
- **Description**: Command frontmatter doesn't specify a model, relying on default. While valid, explicit model specification is recommended for clarity.
- **Impact**: None functionally, but less explicit than agents.
- **Fix**: Consider adding `model: sonnet` or similar if a specific model is preferred.
- **Location**: Lines 1-10

### LOW

#### L1: Long Lines in Examples
- **Category**: Formatting
- **Description**: Some example lines exceed 100 characters, reducing readability.
- **Impact**: Minor readability issue.
- **Fix**: Consider wrapping long lines.
- **Location**: Examples section (lines 964-1055)

#### L2: Completion Message Template Indentation
- **Category**: Formatting
- **Description**: The completion_message template has inconsistent indentation with conditional blocks.
- **Impact**: Minor visual inconsistency.
- **Fix**: Align conditional blocks with surrounding content.
- **Location**: Lines 1135-1179

## Scores

| Area | Score |
|------|-------|
| YAML Frontmatter | 9/10 |
| XML Structure | 9/10 |
| Completeness | 8/10 |
| Workflow Design | 10/10 |
| Interview Design | 10/10 |
| Examples | 9/10 |
| TodoWrite Integration | 10/10 |
| Error Recovery | 10/10 |
| Security | 10/10 |
| **Total** | **9.4/10** |

## Detailed Analysis

### YAML Frontmatter (9/10)
- Valid YAML syntax
- Comprehensive description with workflow outline
- Appropriate tools listed (Task, AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep)
- Skills properly referenced (dev:context-detection, dev:universal-patterns, dev:api-design, dev:design-references, orchestration:quality-gates, orchestration:todowrite-orchestration)
- Missing explicit model specification (minor)

### XML Structure (9/10)
- All tags properly opened and closed
- Correct hierarchical nesting
- Appropriate use of semantic attributes (number, name, priority)
- Minor entity encoding issue with `<` character

### Workflow Completeness (10/10)
**All 6 phases present with quality gates:**
1. PHASE 0: Session Initialization - Resume support, session creation
2. PHASE 1: Context Gathering - Stack detection, asset scanning
3. PHASE 2: Deep Interview Loop - 10 rounds max, 3 min, coverage tracking
4. PHASE 3: Asset Collection - Proactive triggers, ultrathink tech recommendations
5. PHASE 4: Spec Synthesis - User validation, amendment rounds
6. PHASE 5: Task Breakdown - Implementation planning, next steps

### Interview Design (10/10)
**Question Categories (7 categories):**
- Functional Requirements (high priority, 3+ questions)
- Non-Functional Requirements (high priority, 3+ questions)
- User Experience (medium priority, 3+ questions)
- Edge Cases & Errors (high priority, 3+ questions)
- Integration Points (medium priority, 3+ questions)
- Constraints & Trade-offs (high priority, 3+ questions)
- Technical Preferences (low priority, 2+ questions)

**5 Whys Technique:**
- Clear "when to use" criteria
- Step-by-step application guide
- Example chain demonstrating technique
- "When to stop" criteria defined

**Proactive Triggers (7 triggers):**
- API/backend/endpoint (threshold: 2)
- Figma (threshold: 1)
- UI/design/mockup (threshold: 2)
- Style/colors/theme (threshold: 1)
- Tech stack uncertainty (threshold: 1)
- Integration/third-party (threshold: 2)
- Scale/performance (threshold: 1)

### Supporting Features (10/10)
**Resume Support:**
- `--resume SESSION_ID` flag handling
- Session state persistence via session-meta.json
- Checkpoint restoration logic
- Clear resume command in output

**SESSION_PATH:**
- Explicit constraint requiring SESSION_PATH prefix on all Task delegations
- Consistent session directory structure
- Unique session ID generation

**TodoWrite Integration:**
- Required in critical_constraints
- 6-phase todo list defined
- Update instructions for continuous tracking
- One task in_progress rule

**Error Recovery (7 strategies):**
- Short answers
- Skip category
- Contradictory information
- Mid-interview recommendation request
- Circular interview
- Early end request
- Pause/continue later

### Security (10/10)
- No credential exposure patterns
- No unsafe shell operations
- Session data stored in project-local ai-docs/
- No external data exfiltration risks

## Strengths

1. **Comprehensive interview methodology** - The 7-category question framework with priority levels and minimum question counts ensures thorough requirements gathering.

2. **Proactive asset collection** - Trigger-based detection for API specs, Figma, design systems automatically prompts for relevant assets.

3. **5 Whys technique integration** - Clear guidance on when and how to apply deep questioning for root cause discovery.

4. **Robust session management** - Resume support with checkpointing allows long interviews to be paused and continued.

5. **Quality gates on every phase** - Each phase has explicit exit criteria ensuring proper completion before progression.

6. **Extensive error recovery** - 7 documented recovery strategies cover common interview challenges.

7. **Ultrathink integration** - Extended thinking for tech stack recommendations adds value.

## Recommendation

**APPROVE**

This is an exceptionally well-designed interview command with comprehensive coverage of requirements elicitation best practices. The single HIGH issue (missing agent definitions) should be verified - if the agents exist in the plugin, this is a PASS with no blockers.

Minor improvements:
1. Verify `scribe`, `stack-detector`, and `spec-writer` agents exist in the dev plugin
2. Fix XML entity encoding for `<` character in coverage calculation section
3. Consider adding explicit model specification to frontmatter

The interview design with question categories, 5 Whys technique, proactive triggers, and error recovery strategies represents best-in-class requirements gathering methodology.

---

*Generated by: minimax/minimax-m2.1 via Quality Review*
*Review Date: 2026-01-06*
