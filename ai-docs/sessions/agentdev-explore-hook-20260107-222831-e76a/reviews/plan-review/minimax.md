# Design Plan Review: Hook to Replace Built-in Explore Agent

**Reviewer**: Claude Opus 4.5 (fallback - minimax/minimax-m2.1 proxy failed)
**Date**: 2026-01-07
**Design Document**: ai-docs/sessions/agentdev-explore-hook-20260107-222831-e76a/design.md

---

## Proxy Mode Failure Notice

**Requested Model:** minimax/minimax-m2.1
**Error:** Tool call validation failed - model generated incomplete Bash tool call without required `command` parameter
**Action Taken:** Review completed by Claude Opus 4.5 as fallback

---

## Review Status: CONDITIONAL

---

## Issue Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | None |
| HIGH | 3 | Type safety, error handling, missing mapResults usage |
| MEDIUM | 4 | Keyword extraction limitations, performance, testing gaps |
| LOW | 2 | Minor code style, documentation |

---

## Detailed Findings

### HIGH Priority Issues

#### H1: Type Safety Gap in HookOutput

**Category**: TypeScript Implementation Quality
**Location**: handler.ts - handleTaskIntercept return type

**Description**: The design shows `handleTaskIntercept` returning `HookOutput | null`, but when not indexed, it returns an object with only `additionalContext` (no `hookSpecificOutput`). This is actually valid given the current `HookOutput` interface where `hookSpecificOutput` is optional, but the existing handler functions (like `handleGrepIntercept`) set `hookSpecificOutput` with `permissionDecision: "deny"` when they want to block.

**Issue**: When claudemem is NOT indexed, the function returns just `{ additionalContext: "..." }` without setting `permissionDecision`. This means Explore will proceed, which is the intended behavior BUT Claude Code may not understand this is intentional "allow". The existing pattern shows explicit decisions.

**Recommendation**: Add explicit allow decision for clarity:
```typescript
if (!status.indexed) {
  return {
    additionalContext: `...`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "claudemem not indexed - Explore allowed as fallback",
    },
  };
}
```

**Impact**: Could cause confusion in hook handling; explicit decisions are safer.

---

#### H2: Missing Error Handling for runCommand in Task Handler

**Category**: Edge Cases and Safety
**Location**: handler.ts - handleTaskIntercept lines 149-156

**Description**: The design calls `runCommand("claudemem", ["--agent", "map", keywords], input.cwd)` but doesn't handle the case where claudemem might fail (return null) or throw. The existing `isIndexed()` check might succeed (project was indexed) but `runCommand` could still fail (claudemem crashed, permission issue, etc.).

**Current Code**:
```typescript
if (keywords) {
  mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
}
```

**Issue**: If claudemem fails, `mapResults` is null, which is handled, but a more specific error message would improve UX.

**Recommendation**: Add explicit error context:
```typescript
if (keywords) {
  mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
  if (!mapResults) {
    mapResults = "(claudemem map failed - try running 'claudemem index' to rebuild)";
  }
}
```

**Impact**: Users may not understand why structural overview is missing.

---

#### H3: mapResults Variable Declared But Not Guaranteed to Be Used

**Category**: TypeScript Implementation Quality
**Location**: handler.ts - lines 149-160

**Description**: The `mapResults` variable is computed when `searchContext` exists and `extractSearchKeywords` returns non-null, but if `searchContext` is empty (both `prompt` and `description` are empty strings), `mapResults` remains null and the structural overview is empty.

**Issue**: The Task tool input for Explore likely ALWAYS has a prompt. However, the design doesn't validate this assumption. If both are empty, the user gets redirected but without any helpful structural overview.

**Recommendation**: Add a fallback query or warning:
```typescript
let mapResults: string | null = null;
let keywords: string | null = null;

if (searchContext) {
  keywords = extractSearchKeywords(searchContext);
} else {
  keywords = "main entry point"; // Default query
}

if (keywords) {
  mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
}
```

**Impact**: Edge case where Explore is called with no prompt gets less helpful response.

---

### MEDIUM Priority Issues

#### M1: extractSearchKeywords Removes Domain-Specific Terms

**Category**: Design Completeness
**Location**: handler.ts - extractSearchKeywords function

**Description**: The regex removes common words: `find|search|look|locate|where|what|how|is|are|the|a|an|in|for|all|any`. However, "all" might be significant in some contexts (e.g., "findAll users" -> removing "all" changes meaning).

**Issue**: Overly aggressive filtering could reduce search effectiveness.

**Recommendation**: Consider keeping "all" or using a more sophisticated NLP approach. At minimum, document this limitation:
```typescript
// Note: Removes "all" which may affect queries like "findAll"
// Consider: "findAllUsers" vs "find all users"
```

**Impact**: Minor - affects search quality in edge cases.

---

#### M2: Performance Impact of claudemem map Call

**Category**: Potential Issues
**Location**: handleTaskIntercept - runCommand call

**Description**: The `runCommand` function has a 10-second timeout, but the Explore agent interception happens synchronously. If claudemem is slow (large codebase, cold start), this could delay Claude Code's response.

**Issue**: No performance metrics or timeout-specific handling.

**Recommendation**:
1. Consider a shorter timeout for the preview query (3s)
2. Add timing info to context:
```typescript
const start = Date.now();
mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
const elapsed = Date.now() - start;
if (elapsed > 2000) {
  mapResults += `\n(Query took ${elapsed}ms - consider 'claudemem index --rebuild' for better performance)`;
}
```

**Impact**: Could cause perceived slowness in large codebases.

---

#### M3: Testing Strategy Gaps

**Category**: Design Completeness
**Location**: Section 4 - Testing Strategy

**Description**: The testing strategy only covers happy paths and basic edge cases. Missing:
1. Concurrent Task calls (multiple Explore calls at once)
2. Race condition between indexing and interception
3. Claude Code version compatibility testing
4. Hook system behavior when handler.ts has runtime errors

**Recommendation**: Add test cases:
- Parallel Explore calls
- Index deleted mid-session
- Handler throws exception
- Very long prompts (>10KB)

**Impact**: Potential production issues not caught by testing.

---

#### M4: Case Sensitivity May Have Edge Cases

**Category**: Edge Cases and Safety
**Location**: handleTaskIntercept - subagentType check

**Description**: While `toLowerCase() !== "explore"` handles case variations, it doesn't handle:
- Unicode variations (full-width characters)
- Whitespace padding: `" Explore "` vs `"Explore"`
- Future subagent naming conventions

**Current Code**:
```typescript
if (!subagentType || subagentType.toLowerCase() !== "explore")
```

**Recommendation**: Add trim and normalize:
```typescript
const normalizedType = subagentType?.trim().toLowerCase();
if (!normalizedType || normalizedType !== "explore")
```

**Impact**: Low probability but easy to fix.

---

### LOW Priority Issues

#### L1: escapeForTemplate Function Declared But Usage Not Shown in Full

**Category**: Code Organization
**Location**: design.md - helper functions section

**Description**: The `escapeForTemplate` function is defined but the full usage in the `additionalContext` template literal isn't fully shown. The design shows `${escapeForTemplate(searchContext || "your search query")}` but truncates the full context.

**Recommendation**: Ensure the full template is documented in design.

**Impact**: Implementation might miss proper escaping in other template strings.

---

#### L2: Version Bump Documentation

**Category**: Documentation
**Location**: Rollout Plan - Phase 2

**Description**: Version bump is `2.12.0` -> `2.13.0` but the design doesn't specify what CHANGELOG entry should say. Given this is a significant feature (Task interception), it deserves a clear changelog entry.

**Recommendation**: Add suggested CHANGELOG entry:
```markdown
## [2.13.0] - 2026-01-XX
### Added
- Task tool interception for Explore agent replacement
- Automatic redirect to code-analysis:detective for AST-based analysis
- Graceful fallback when claudemem not indexed
```

**Impact**: Minor - documentation completeness.

---

## Approval Decision

### Status: CONDITIONAL

### Rationale

The design is fundamentally sound and addresses a real gap in the code-analysis plugin. The approach of intercepting Task tool calls at PreToolUse is correct and follows existing patterns in handler.ts. The separation of matchers in plugin.json is appropriate.

**Conditions for PASS:**

1. **MUST FIX (H1)**: Add explicit `permissionDecision: "allow"` when not indexed to match existing handler patterns
2. **MUST FIX (H2)**: Add error context when claudemem map fails
3. **SHOULD FIX (H3)**: Handle empty prompt/description case with default query

**Recommended but not blocking:**
- M1-M4 improvements would strengthen the implementation
- L1-L2 documentation improvements

### Summary

| Aspect | Rating | Notes |
|--------|--------|-------|
| Design Completeness | 85% | Missing some edge cases |
| Edge Cases & Safety | 75% | Need explicit allow decision, error handling |
| TypeScript Quality | 80% | Type-safe but missing some error paths |
| Potential Issues | LOW | No security concerns, minor performance |

---

## Appendix: Code Review Checklist

- [x] Plugin.json changes are valid JSON
- [x] Handler function follows existing patterns
- [x] Case sensitivity handled
- [x] Null checks present
- [ ] Explicit permission decisions for both paths (needs fix)
- [ ] Error handling for external commands (needs improvement)
- [x] Debounce/performance considered
- [x] Alternative approaches documented
- [x] Rollout plan present

---

*Review completed: 2026-01-07*
*Note: This review was performed by Claude Opus 4.5 after minimax/minimax-m2.1 proxy delegation failed*
