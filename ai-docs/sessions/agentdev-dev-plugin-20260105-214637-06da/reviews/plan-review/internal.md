# Internal Design Review: Dev Plugin

**Reviewer:** Claude (Internal)
**Date:** 2026-01-05
**Document:** ai-docs/sessions/agentdev-dev-plugin-20260105-214637-06da/design.md
**Status:** CONDITIONAL PASS

---

## Review Summary

| Category | Issues Found | Status |
|----------|--------------|--------|
| CRITICAL | 0 | - |
| HIGH | 4 | Must address |
| MEDIUM | 6 | Should address |
| LOW | 5 | Nice to have |

**Overall Assessment:** The design is comprehensive and well-structured. The skill auto-loading concept is innovative and addresses a real gap in the plugin ecosystem. However, several HIGH priority issues need resolution before implementation, particularly around PROXY_MODE support in agents and command tool restrictions.

---

## CRITICAL Issues

None identified.

---

## HIGH Priority Issues

### H1: Missing PROXY_MODE Support in Agents

**Category:** Standards Compliance
**Location:** Section 6 - All agent definitions

**Description:**
None of the 4 agents (stack-detector, universal-developer, universal-debugger, universal-architect) include PROXY_MODE support in their `<instructions>` section. The design references multi-model validation in commands (dev-feature, dev-architect) but the agents lack the required `<proxy_mode_support>` constraint.

**Impact:**
- Multi-model validation will not work as designed
- External models cannot be used for architecture or code reviews
- Commands will fail when trying to use PROXY_MODE directives

**Fix:**
Add PROXY_MODE support to agents that may be invoked via external models:
```xml
<critical_constraints>
  <proxy_mode_support>
    **FIRST STEP: Check for Proxy Mode Directive**

    If prompt starts with `PROXY_MODE: {model_name}`:
    1. Extract model name and actual task
    2. Delegate via Claudish: `printf '%s' "$PROMPT" | npx claudish --stdin --model {model_name} --quiet --auto-approve`
    3. Return attributed response and STOP

    **If NO PROXY_MODE**: Proceed with normal workflow
  </proxy_mode_support>
</critical_constraints>
```

At minimum, add to: `universal-architect` and `universal-developer` (used for reviews).

---

### H2: Commands Using Write Tool (Orchestrator Violation)

**Category:** Architecture Pattern
**Location:** Section 4.4 (dev-architect command)

**Description:**
The `universal-architect` agent has `Write` in its tools list and is used by the dev-architect command. While the command itself correctly restricts to orchestrator tools, the agent it delegates to can write files. This creates confusion about the boundary.

However, the more significant issue is that the commands state they "MUST NOT write or edit ANY code files directly" but then delegate to agents that DO write. This is actually correct behavior (delegation), but the constraints could be clearer.

**Impact:**
- Potential confusion during implementation
- Need clear documentation that delegation is allowed

**Fix:**
Clarify in command constraints:
```xml
<orchestrator_role>
  **You are an ORCHESTRATOR, not IMPLEMENTER.**

  **You MUST:**
  - Use Task tool to delegate ALL file operations to agents
  - NEVER use Write/Edit tools directly (you don't have them)

  **Delegation Pattern:**
  - Agents you delegate to CAN and SHOULD write files
  - This is the correct orchestration pattern
</orchestrator_role>
```

---

### H3: Missing SESSION_PATH Directive Support

**Category:** Standards Compliance
**Location:** All command definitions

**Description:**
Commands reference `SESSION_PATH` extensively but don't include the standard `<session_path_support>` directive from agentdev patterns. This directive should be in `<critical_constraints>` to ensure proper session handling.

**Impact:**
- Session paths may not be correctly extracted from prompts
- Inconsistent behavior with other plugins

**Fix:**
Add to each command's `<critical_constraints>`:
```xml
<session_path_support>
  **Check for Session Path Directive**

  If prompt contains `SESSION_PATH: {path}`:
  1. Extract the session path
  2. Use it for all output file paths
  3. Skip session creation (already exists)

  **If NO SESSION_PATH**: Create new session directory
</session_path_support>
```

---

### H4: Skill Reference Format Inconsistency

**Category:** YAML Syntax
**Location:** Command frontmatter (all commands)

**Description:**
The skill references in command frontmatter use `dev:context-detection` format, but the skills defined in plugin.json use directory paths like `./skills/context-detection`. Claude Code plugin system expects consistent naming.

**Example (from dev-implement):**
```yaml
skills: dev:context-detection, dev:universal-patterns, orchestration:todowrite-orchestration
```

**But plugin.json has:**
```json
"skills": [
  "./skills/context-detection",
  "./skills/core/universal-patterns"
]
```

**Impact:**
- Skills may not load correctly
- Plugin validation may fail

**Fix:**
Ensure skill naming consistency. Either:
1. Use directory-relative paths in frontmatter: `skills: context-detection, core/universal-patterns`
2. Or use plugin-prefixed names consistently: `skills: dev:context-detection, dev:core/universal-patterns`

Recommend option 1 for plugin-internal skills, keeping `orchestration:` prefix only for external dependencies.

---

## MEDIUM Priority Issues

### M1: Missing help Command Definition

**Category:** Completeness
**Location:** Section 4

**Description:**
The help command (`./commands/help.md`) is listed in plugin.json but not defined in Section 4.

**Fix:**
Add Section 4.5 with help command definition that lists all commands and their purposes.

---

### M2: Detection Algorithm Missing Implementation Details

**Category:** Completeness
**Location:** Section 3.3

**Description:**
The detection algorithm pseudocode uses bash-like syntax but doesn't specify:
- How to parse JSON from package.json to check React/Vue dependencies
- Priority handling when multiple stacks detected (e.g., React + Go fullstack)
- Caching of detection results within session

**Fix:**
Add concrete implementation examples:
```bash
# Parse package.json for React
has_react=$(jq -r '.dependencies.react // .devDependencies.react // empty' package.json 2>/dev/null)
if [ -n "$has_react" ]; then
  detected_skills+=("react-typescript")
fi
```

---

### M3: Quality Checks Hardcoded

**Category:** Maintainability
**Location:** Sections 4.1-4.3 (`<quality_checks_by_stack>`)

**Description:**
Quality checks are duplicated across multiple commands with the same stack definitions. This violates DRY principle.

**Fix:**
Create a dedicated skill `dev:quality-checks` that commands reference:
```yaml
---
name: quality-checks
description: Stack-specific quality check commands
---
```

Then reference in commands:
```yaml
skills: dev:context-detection, dev:quality-checks
```

---

### M4: Agent Color Scheme Review

**Category:** UX Consistency
**Location:** Section 6 (all agents)

**Description:**
Agent colors don't fully align with documented patterns:
- `stack-detector` uses blue (utility) - OK
- `universal-developer` uses green (implementer) - OK
- `universal-debugger` uses orange (tester) - Should be cyan (reviewer/analysis)
- `universal-architect` uses purple (planner) - OK

**Fix:**
Consider changing `universal-debugger` to cyan since debugging is closer to analysis/review than testing.

---

### M5: Missing Error Recovery Patterns

**Category:** Robustness
**Location:** All commands

**Description:**
Commands mention "max 2 iterations" for failures but don't reference the `orchestration:error-recovery` skill consistently. Only dev-debug lists it in skills.

**Fix:**
Add `orchestration:error-recovery` to all commands that have retry logic.

---

### M6: Plugin Manifest Missing mcp-servers

**Category:** Completeness
**Location:** Section 1 (plugin.json)

**Description:**
The plugin.json doesn't include `mcp-servers` field even as empty array. While optional, including it makes the structure consistent with other plugins.

**Fix:**
Add `"mcp-servers": []` to plugin.json.

---

## LOW Priority Issues

### L1: Inconsistent Phase Numbering

**Category:** Documentation
**Location:** Section 4.3 (dev-feature)

**Description:**
Phase 1.5 (Architecture Review) breaks the sequential numbering pattern. While optional phases are valid, consider renaming to "Phase 1b" or making it a sub-phase.

---

### L2: Missing Skill Content Outlines

**Category:** Completeness
**Location:** Section 5

**Description:**
While skill frontmatter is provided, the actual content structure for each skill is sparse. Compare to detailed content in existing plugins like frontend.

**Fix:**
Add content outline for each skill showing what patterns/templates will be included.

---

### L3: Example Names Too Generic

**Category:** Documentation
**Location:** Command examples

**Description:**
Example names like "React Component", "Go API Endpoint" could be more descriptive.

**Fix:**
Use specific names like "UserProfile Avatar Component", "Get User by ID Endpoint".

---

### L4: Missing Tool Descriptions

**Category:** Documentation
**Location:** Section 6 (agents)

**Description:**
Agent `tools` field lists tools without explaining why each is needed. This is optional but helpful for maintainers.

---

### L5: Week Estimates May Be Optimistic

**Category:** Project Planning
**Location:** Section 7 (Implementation Phases)

**Description:**
7 weeks for 16+ skills and 4 commands may be optimistic given the complexity of cross-stack support. Consider buffer time.

---

## Positive Observations

1. **Innovative Concept:** The skill auto-loading mechanism is a genuinely useful innovation that addresses real developer pain points.

2. **Comprehensive Coverage:** All 4 commands have detailed workflow phases with quality gates.

3. **Multi-Model Integration:** Proper integration with orchestration plugin for multi-model validation.

4. **Session Management:** Consistent session-based workspace pattern throughout.

5. **Extensible Design:** Easy to add new stacks by creating new skills without modifying commands.

6. **Clear Delegation:** Commands properly delegate to agents, maintaining orchestrator pattern.

7. **Quality Gate Enforcement:** Each phase has explicit quality gates.

---

## Recommendations

### Before Implementation

1. **Add PROXY_MODE support** to `universal-architect` and `universal-developer` agents (H1)
2. **Fix skill reference format** for consistency (H4)
3. **Add SESSION_PATH directive** to all commands (H3)
4. **Create help command definition** (M1)

### During Implementation

1. **Create quality-checks skill** to avoid duplication (M3)
2. **Add error-recovery skill** to all commands with retry logic (M5)
3. **Flesh out detection algorithm** with concrete implementation (M2)

### Nice to Have

1. Consider renaming Phase 1.5 to Phase 1b
2. Add more detailed skill content outlines
3. Adjust timeline with buffer

---

## Approval Decision

**Status:** CONDITIONAL PASS

**Rationale:**
- 0 CRITICAL issues
- 4 HIGH issues that are fixable before implementation
- Core concept and architecture are sound
- Comprehensive coverage of use cases

**Conditions:**
1. Address all HIGH priority issues (H1-H4) before proceeding to implementation
2. Address M1 (help command) as part of Phase 1
3. Review and incorporate MEDIUM issues during relevant implementation phases

**Next Steps:**
1. Review and accept/reject this feedback
2. Update design document with HIGH issue fixes
3. Proceed to implementation with Phase 1

---

*Review completed by: Claude (Internal Reviewer)*
*Timestamp: 2026-01-05*
