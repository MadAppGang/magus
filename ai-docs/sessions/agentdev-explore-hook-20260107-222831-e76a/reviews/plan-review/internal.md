# Plan Review: Hook to Replace Built-in Explore Agent

**Reviewer**: Claude (Internal)
**Date**: 2026-01-07
**Session**: agentdev-explore-hook-20260107-222831-e76a
**Status**: CONDITIONAL PASS

---

## Summary

The design plan is **well-structured and technically sound** with a clear problem statement, solution approach, and implementation details. However, there are **several issues** ranging from a **CRITICAL agent naming bug** to medium-priority improvements that should be addressed before implementation.

---

## Issue Summary

| Severity | Count | Categories |
|----------|-------|------------|
| CRITICAL | 1 | Agent naming mismatch |
| HIGH | 2 | Missing timeout handling, hook chain consideration |
| MEDIUM | 4 | Code quality, edge cases |
| LOW | 2 | Documentation, style |

---

## CRITICAL Issues

### Issue 1: Agent Name Mismatch

**Category**: Correctness
**Location**: Design document sections 2.1, Testing Strategy

**Description**: The design consistently references `code-analysis:detective` as the redirect target, but the actual agent is named `detective` in the frontmatter (not `code-analysis:detective`).

**Evidence from codebase**:
```yaml
# plugins/code-analysis/agents/codebase-detective.md
---
name: detective
description: Use this agent when you need to investigate...
```

**Impact**: The redirect instructions will be wrong. Users following the suggested Task call will get an error because `code-analysis:detective` doesn't exist - the correct subagent_type is `code-analysis:detective` (using plugin prefix with frontmatter name).

**Verification needed**: Check how Claude Code resolves agent names. The pattern should be `{plugin}:{agent-name}` where `agent-name` comes from the frontmatter `name` field. Given `name: detective` in the frontmatter, the correct reference is `code-analysis:detective`.

**Resolution**: Verify the correct subagent_type format is used throughout. If my analysis is correct, the design is fine. If the format differs, update all references.

**Status**: NEEDS VERIFICATION - This could be a non-issue if the naming convention is correct.

---

## HIGH Priority Issues

### Issue 2: Missing Timeout Handling for claudemem Commands

**Category**: Reliability
**Location**: Design document section 2.1, lines 149-155

**Description**: The design calls `runCommand("claudemem", ["--agent", "map", keywords], input.cwd)` but doesn't handle the case where claudemem hangs or takes too long. The existing `runCommand` has a 10-second timeout, but for complex codebases, `claudemem map` can take longer.

**Evidence from handler.ts**:
```typescript
function runCommand(cmd: string, args: string[], cwd?: string): string | null {
  try {
    const result = spawnSync(cmd, args, {
      cwd,
      encoding: "utf-8",
      timeout: 10000, // 10 second timeout
    });
```

**Impact**: For large codebases, `claudemem --agent map` might timeout, causing the hook to return null results silently. This would make the redirect less helpful.

**Recommendation**:
1. Either increase timeout specifically for this use case
2. Or handle timeout gracefully with appropriate user messaging
3. Or remove the map preview feature (simplify to just deny + redirect instructions)

---

### Issue 3: Hook Chain Behavior Not Considered

**Category**: Architecture
**Location**: Design document section 1, plugin.json changes

**Description**: Adding a second matcher block creates TWO separate hook entries. It's unclear if Claude Code will run BOTH hooks when a Task call is made (since Task doesn't match `Grep|Bash|Glob|Read`), or if matchers are evaluated exclusively.

**Current design**:
```json
"PreToolUse": [
  {
    "matcher": "Grep|Bash|Glob|Read",  // Entry 1
    "hooks": [...]
  },
  {
    "matcher": "Task",  // Entry 2
    "hooks": [...]
  }
]
```

**Impact**: If hook behavior isn't as expected, the Task interception might not work at all.

**Recommendation**: Test the hook chain behavior explicitly, or combine into single matcher: `"matcher": "Grep|Bash|Glob|Read|Task"` which is simpler and guaranteed to work with the existing dispatcher logic.

---

## MEDIUM Priority Issues

### Issue 4: Missing Error Handling in extractSearchKeywords

**Category**: Code Quality
**Location**: Design document section 2.1, lines 199-218

**Description**: The `extractSearchKeywords` function can return short or meaningless strings.

```typescript
function extractSearchKeywords(text: string): string | null {
  // ...
  const cleaned = text
    .toLowerCase()
    .replace(/\b(find|search|look|locate|where|what|how|is|are|the|a|an|in|for|all|any)\b/g, " ")
    // ...

  // Could return "x y" if original was "Find the x y in the code"
  if (cleaned.length > 2) {
    return cleaned;
  }
  // ...
}
```

**Impact**: Single words or very short strings might cause poor claudemem results.

**Recommendation**: Add minimum word count check (e.g., at least 2 words) in addition to length check.

---

### Issue 5: Race Condition with isIndexed Check

**Category**: Edge Case
**Location**: Design document section 2.1, lines 127-141

**Description**: The design checks `isIndexed(input.cwd)` at the start, but by the time the response is returned, the index state could have changed (e.g., user manually deleted `.claudemem/` or index is in progress).

**Impact**: Minor - unlikely to cause real issues in practice, but could lead to confusing behavior in edge cases.

**Recommendation**: Document this limitation. No code change needed - the fallback behavior (suggesting indexing) is appropriate.

---

### Issue 6: Potential XSS/Injection in escapeForTemplate

**Category**: Security
**Location**: Design document section 2.1, lines 221-227

**Description**: The `escapeForTemplate` function only handles backticks and dollar signs, but the output is embedded in markdown which could have other escape needs.

```typescript
function escapeForTemplate(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .substring(0, 200);
}
```

**Impact**: Low risk since this is displaying in Claude's context, not a web browser. But unusual characters in prompts could break the markdown formatting.

**Recommendation**: Consider using JSON.stringify for the inner prompt content to ensure all special characters are properly escaped.

---

### Issue 7: No Handling for "Explore" Subagent with Different Casing

**Category**: Edge Case
**Location**: Design document section 3.1

**Description**: The design mentions case-insensitive handling:

```typescript
if (!subagentType || subagentType.toLowerCase() !== "explore") {
```

But what about edge cases like:
- `"explore "` (trailing space)
- `" Explore"` (leading space)
- `"explore-codebase"` (similar but different agent)

**Impact**: Trailing/leading spaces could cause unexpected pass-through.

**Recommendation**: Trim the input before comparison:

```typescript
if (!subagentType || subagentType.trim().toLowerCase() !== "explore") {
```

---

## LOW Priority Issues

### Issue 8: Missing Model/Color in Design Summary

**Category**: Documentation
**Location**: Throughout design document

**Description**: The design doesn't specify which model the detective agent uses or its color. This is useful for consistency documentation.

**From codebase**:
```yaml
# codebase-detective.md
color: blue
# model not specified - uses default
```

**Recommendation**: Add to design summary for completeness.

---

### Issue 9: Inconsistent Comment Style

**Category**: Code Style
**Location**: Design document section 2.1

**Description**: The design uses both `// Comment` and `/** ... */` JSDoc styles inconsistently. The existing handler.ts uses section separators with `// ===...===`.

**Recommendation**: Follow existing handler.ts style with section separators for consistency.

---

## Evaluation Criteria Assessment

### 1. Design Completeness - GOOD

- Problem statement is clear and well-defined
- Solution approach is technically sound
- Implementation details are thorough
- Testing strategy covers key scenarios
- Rollout plan is reasonable

**Gap**: Missing documentation of expected hook chain behavior and agent naming verification.

### 2. Hook System Correctness - NEEDS VERIFICATION

The design assumes PreToolUse on Task will work, which is a reasonable assumption, but:

- No evidence that Task tool interception has been tested
- Hook chain behavior with multiple matchers is unclear
- The `tool_input` structure for Task containing `subagent_type` needs verification

**Recommendation**: Add a verification step before implementation to confirm Task tool hook behavior.

### 3. Edge Cases - MOSTLY COVERED

Good coverage of:
- Not indexed fallback
- Case sensitivity
- Empty/null inputs
- Other agents pass through

Missing:
- Timeout handling
- Whitespace in agent names
- Race conditions with index state

### 4. TypeScript Code Quality - GOOD

- Type safety with explicit casting
- Defensive null checks
- Helper functions are well-structured
- Follows existing handler.ts patterns

**Issues**:
- extractSearchKeywords could be more robust
- escapeForTemplate could use JSON.stringify

### 5. Integration with handler.ts - EXCELLENT

The design correctly:
- Follows existing function naming pattern (`handle*Intercept`)
- Uses existing utility functions (`isIndexed`, `runCommand`)
- Maintains dispatcher switch statement structure
- Places new code in appropriate location (after handleReadIntercept)

---

## Recommendations Summary

### Before Implementation

1. **VERIFY** agent naming convention - confirm `code-analysis:detective` is correct
2. **TEST** Task tool hook behavior in isolation
3. **DECIDE** on single vs multiple matcher approach for plugin.json

### During Implementation

4. **ADD** `.trim()` to subagent_type comparison
5. **CONSIDER** removing claudemem map preview (simplifies, avoids timeout issues)
6. **FOLLOW** existing handler.ts section separator style

### After Implementation

7. **ADD** integration test for hook chain behavior
8. **DOCUMENT** known limitations (race conditions, timeout behavior)

---

## Approval Decision

**Status**: CONDITIONAL PASS

**Rationale**: The design is well-thought-out and follows established patterns. However, the CRITICAL agent naming issue must be verified, and the HIGH-priority timeout/hook-chain concerns should be addressed before or during implementation.

**Required Actions**:
1. Verify `code-analysis:detective` is the correct subagent_type format
2. Test Task tool hook interception works as expected
3. Address timeout handling (either fix or simplify)

**Optional Improvements**:
- Add .trim() to subagent_type comparison
- Consider single matcher approach for simplicity
- Use JSON.stringify in escapeForTemplate

---

## Files Reviewed

| File | Purpose | Location |
|------|---------|----------|
| design.md | Design plan | ai-docs/sessions/agentdev-explore-hook-20260107-222831-e76a/ |
| handler.ts | Existing hook handler | plugins/code-analysis/hooks/ |
| plugin.json | Plugin manifest | plugins/code-analysis/ |
| codebase-detective.md | Detective agent | plugins/code-analysis/agents/ |

---

*Review completed by Claude (Internal) on 2026-01-07*
