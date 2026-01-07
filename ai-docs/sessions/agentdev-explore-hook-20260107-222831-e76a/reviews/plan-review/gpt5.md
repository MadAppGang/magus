# Design Review: Hook to Replace Built-in Explore Agent

**Reviewer**: GPT-5.2 (via PROXY_MODE)
**Date**: 2026-01-07
**Design Document**: design.md
**Status**: **CONDITIONAL PASS**

---

## Executive Summary

The design proposes intercepting the built-in `Explore` subagent via PreToolUse hooks on the Task tool, redirecting users to `code-analysis:detective` for AST-based structural analysis. The approach is architecturally sound and follows existing hook patterns in the codebase. However, several edge cases, TypeScript implementation details, and safety considerations require attention before implementation.

**Issue Summary**:
- CRITICAL: 0
- HIGH: 3
- MEDIUM: 5
- LOW: 3

---

## 1. Design Completeness

### Strengths

1. **Clear Problem Statement**: The design correctly identifies the gap where `Explore` bypasses AST analysis hooks.

2. **Consistent with Existing Patterns**: The proposed `handleTaskIntercept` function follows the same structure as `handleGrepIntercept`, `handleBashIntercept`, etc.

3. **Graceful Degradation**: The not-indexed fallback behavior (allow + suggest) is well thought out.

4. **Alternative Approaches Documented**: Good analysis of why other approaches were rejected.

### Gaps

| ID | Severity | Issue | Recommendation |
|----|----------|-------|----------------|
| C1 | HIGH | Missing behavior for `run_in_background: true` Tasks | Document handling for background Task calls |
| C2 | MEDIUM | No handling for empty `prompt` AND empty `description` | Add fallback behavior when no searchable context exists |
| C3 | MEDIUM | No rate limiting / caching for `claudemem map` calls | Consider caching or debouncing repeated queries |

---

## 2. Edge Cases and Safety

### 2.1 Task Tool Input Variations

The Task tool supports multiple input shapes. The design assumes:

```typescript
{ subagent_type?: string; prompt?: string; description?: string; }
```

**Issue (HIGH)**: Task tool also supports:
- `run_in_background: boolean` - Background tasks may behave differently
- `dangerously_skip_permissions: boolean` - Security-sensitive flag
- Additional agent-specific parameters

**Recommendation**: Explicitly document that background Tasks are still intercepted (they use the same PreToolUse flow), and verify behavior in testing.

### 2.2 Case Sensitivity Edge Cases

The design uses `toLowerCase()` for case-insensitive matching:

```typescript
if (!subagentType || subagentType.toLowerCase() !== "explore") {
```

**Covered cases**:
- `"Explore"`, `"explore"`, `"EXPLORE"`

**Uncovered edge case (LOW)**: Unicode/whitespace variations
- `" Explore"` (leading space)
- `"Explore "` (trailing space)
- `"explore\n"` (newline)

**Recommendation**: Add `.trim()` before comparison:
```typescript
if (!subagentType || subagentType.trim().toLowerCase() !== "explore") {
```

### 2.3 Null vs Undefined Handling

The design checks:
```typescript
if (!toolInput) return null;
```

**Issue (LOW)**: JavaScript/TypeScript distinguishes `null`, `undefined`, and empty object `{}`.

**Current behavior**:
- `tool_input: undefined` -> returns null (correct)
- `tool_input: null` -> returns null (correct)
- `tool_input: {}` -> proceeds (correct, subagentType will be undefined)

This is actually handled correctly by the design.

### 2.4 Concurrent Hook Execution

**Issue (MEDIUM)**: Multiple PreToolUse hooks can fire concurrently. The design doesn't address:
- What happens if claudemem is being reindexed during interception?
- Race conditions between `isIndexed()` check and `runCommand("claudemem", ["map", ...])`

**Recommendation**: Add try-catch around `runCommand` in `handleTaskIntercept` to handle cases where claudemem becomes unavailable mid-execution.

### 2.5 Explore Agent Name Future-Proofing

**Issue (MEDIUM)**: The design only intercepts `"Explore"` exactly. If Claude Code introduces:
- `"ExploreV2"`
- `"Explore-Fast"`
- `"explore-code"`

These would bypass the hook.

**Recommendation**: Consider documenting this limitation and potentially using a prefix match:
```typescript
const normalized = subagentType.trim().toLowerCase();
if (normalized === "explore" || normalized.startsWith("explore-")) {
```

However, this could cause false positives. The current exact-match approach is safer.

---

## 3. TypeScript Implementation Quality

### 3.1 Type Safety

**Issue (HIGH)**: The design casts `tool_input` without validation:

```typescript
const toolInput = input.tool_input as {
  subagent_type?: string;
  prompt?: string;
  description?: string;
} | undefined;
```

**Problem**: This cast assumes `tool_input` is the expected shape. If Claude Code changes the Task tool schema, the code will fail silently.

**Recommendation**: Use type guards or Zod validation:

```typescript
function isTaskInput(input: unknown): input is {
  subagent_type?: string;
  prompt?: string;
  description?: string
} {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  return (
    (obj.subagent_type === undefined || typeof obj.subagent_type === 'string') &&
    (obj.prompt === undefined || typeof obj.prompt === 'string') &&
    (obj.description === undefined || typeof obj.description === 'string')
  );
}

// Usage:
if (!isTaskInput(input.tool_input)) return null;
```

### 3.2 Helper Function Quality

#### `extractSearchKeywords`

**Strengths**:
- Handles common stop words
- Falls back to first 5 words
- Validates minimum length

**Issue (LOW)**:
```typescript
const cleaned = text
  .toLowerCase()
  .replace(/\b(find|search|look|locate|where|what|how|is|are|the|a|an|in|for|all|any)\b/g, " ")
```

The word boundary `\b` may not work correctly with some Unicode characters. For this use case (English prompts), it's acceptable.

#### `escapeForTemplate`

**Issue**: The function escapes for template literals but the output is used in markdown:

```typescript
**How to use code-analysis:detective:**

\`\`\`typescript
Task({
  subagent_type: "code-analysis:detective",
  prompt: "${escapeForTemplate(searchContext || "your search query")}",
  ...
})
\`\`\`
```

**Problem**: Escaping `$` and backticks is correct for TypeScript template literals displayed in markdown. However, if the prompt contains quotes, they're not escaped:

```typescript
prompt: "Find "user auth" handlers"  // Broken string
```

**Recommendation**: Also escape double quotes:
```typescript
function escapeForTemplate(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/"/g, '\\"')  // Add this
    .substring(0, 200);
}
```

### 3.3 Error Handling

The design doesn't explicitly address errors from:
1. `isIndexed()` failing (claudemem not responding)
2. `runCommand()` timing out
3. Invalid JSON in claudemem output

**Current behavior** (from existing handler.ts): `runCommand` returns `null` on failure, which is handled. This is acceptable.

### 3.4 Code Organization

**Strength**: The design follows the existing pattern in handler.ts:
- Section headers with `// ===` comments
- Async functions returning `Promise<HookOutput | null>`
- Consistent parameter naming

**Minor suggestion**: The design places the new function "after `handleReadIntercept` (around line 360)". This is correct placement. Consider also adding an index comment at the top of the file listing all handlers.

---

## 4. Potential Issues

### 4.1 Performance

**Issue (MEDIUM)**: The hook runs `claudemem --agent map` synchronously for every intercepted Explore call.

```typescript
if (keywords) {
  mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
}
```

The existing `runCommand` has a 10-second timeout. This could slow down the hook response.

**Recommendation**: Consider making the structural overview optional or async:
```typescript
// Option 1: Skip map results for faster response
const structuralOverview = ""; // Remove map call

// Option 2: Make it conditional on prompt length
if (keywords && keywords.length > 10) {
  mapResults = runCommand(...);
}
```

### 4.2 User Experience

**Issue**: When Explore is denied, the user sees:

```
**Explore agent intercepted** - Use `code-analysis:detective` instead.
```

This is informative but may frustrate users who don't understand why their tool was blocked.

**Recommendation**: Add a brief explanation of the benefit:
```
**Explore agent redirected** - `code-analysis:detective` provides better results.

The detective uses AST structural analysis and PageRank ranking, which finds
code by meaning rather than text matching. This is more accurate for:
- Finding implementations (not just references)
- Understanding call hierarchies
- Tracing dependencies
```

### 4.3 Circular Dependency Risk

**Issue (LOW)**: If `code-analysis:detective` internally uses the Task tool to spawn Explore (unlikely but possible), an infinite loop could occur.

**Current mitigation**: The design only blocks `subagent_type: "Explore"`, not `"code-analysis:detective"`. This is correct.

**Recommendation**: Document this assumption in the implementation.

---

## 5. Testing Strategy Gaps

The design includes testing scenarios but misses:

| Gap | Recommended Test |
|-----|------------------|
| Background Tasks | `Task({ subagent_type: "Explore", run_in_background: true, ... })` |
| Empty prompt AND description | `Task({ subagent_type: "Explore" })` with no prompt/description |
| Very long prompts | `Task({ subagent_type: "Explore", prompt: "..." /* 10K chars */ })` |
| Special characters in prompt | `Task({ subagent_type: "Explore", prompt: "Find ${var}" })` |
| Claudemem crash during hook | Kill claudemem process, then trigger Explore |

---

## 6. Security Considerations

### 6.1 Command Injection

The design passes user input to `runCommand`:

```typescript
mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
```

**Analysis**: This is **safe** because:
1. `runCommand` uses `spawnSync` with an array (not shell string)
2. Arguments are passed directly, not interpolated into a shell command

### 6.2 Information Disclosure

The hook reveals claudemem installation status:

```
**Explore agent bypassing AST analysis** - claudemem not indexed.
```

**Risk**: Low. This only confirms whether claudemem is installed, which is not sensitive.

---

## 7. Recommendations Summary

### Must Fix (Before Implementation)

1. **Add `.trim()` to subagent type check** - Prevent whitespace edge cases
2. **Escape double quotes in `escapeForTemplate`** - Prevent broken markdown
3. **Add type guard for `tool_input`** - Improve type safety

### Should Fix (Before Release)

4. **Add background Task test case** - Verify behavior
5. **Consider performance of sync `claudemem map` call** - May slow down hook
6. **Improve denial message UX** - Explain the benefit to users

### Nice to Have

7. **Add race condition handling** - Try-catch around claudemem calls
8. **Document Explore name future-proofing limitation**
9. **Add handler index comment at file top**

---

## Approval Decision

**Status: CONDITIONAL PASS**

**Rationale**: The design is architecturally sound and follows established patterns. The core functionality is correct. However, three issues should be addressed before implementation:

1. Add `.trim()` to subagent type comparison (LOW effort, prevents edge case)
2. Fix quote escaping in template output (LOW effort, prevents broken markdown)
3. Add basic type guard for tool_input (MEDIUM effort, improves robustness)

Once these three items are addressed, the design is ready for implementation.

---

*Review generated by: GPT-5.2 via PROXY_MODE*
*Session: agentdev-explore-hook-20260107-222831-e76a*
