# Design Plan Review: Explore Agent Hook

**Reviewer**: google/gemini-3-pro-preview
**Date**: 2026-01-07
**Design**: ai-docs/sessions/agentdev-explore-hook-20260107-222831-e76a/design.md

---

## Review Status: CONDITIONAL

The design is conceptually sound and aligns with the goal of enforcing `claudemem` usage, but the provided code contains a logic gap where expensive data is fetched but not used.

---

## Issues Found

### CRITICAL Issues (1)

#### 1. Unused Data Fetching

**Category**: Implementation Logic
**Severity**: CRITICAL

In `handleTaskIntercept`, the code executes `runCommand` to get `mapResults` and defines `escapeForTemplate`, but **never uses them** in the returned object.

**Impact**:
- The `claudemem` map query is run (which costs time/resources)
- The result `mapResults` is stored in a variable
- The `return` statement sends a static string in `additionalContext` and `permissionDecisionReason`
- The gathered context is lost, meaning the redirect does not help the agent "warm start" the detective task

**Location**: Lines 149-195 in design.md (handleTaskIntercept function)

**Fix**: Update the return statement to actually include the `mapResults` in the `additionalContext`. This gives the model a "preview" of the data, incentivizing it to follow the redirect.

---

### HIGH Priority Issues (1)

#### 2. Blocking Synchronous Execution

**Category**: Performance
**Severity**: HIGH

The `runCommand` appears to be a blocking call inside a hook.

**Impact**:
- If `claudemem` takes >2-3 seconds to initialize or search, it may trigger the hook timeout or cause noticeable UI lag for the user
- **Risk**: Hooks must be fast. Heavy operations should be avoided in PreToolUse unless absolutely necessary

**Location**: Line 155 in design.md

**Fix**:
- Ensure `runCommand` has a strict, short timeout (e.g., 2000ms)
- If it times out, proceed with the intercept without the map context (fail open for the context, but still deny usage)

---

### MEDIUM Priority Issues (1)

#### 3. Aggressive Keyword Cleaning

**Category**: Edge Case Handling
**Severity**: MEDIUM

The `extractSearchKeywords` function is too aggressive in removing common words.

**Impact**:
- It removes "search", "find", "where"
- **Edge Case**: If a user wants to find code related to search functionality (`grep "search"`), this function reduces the query to an empty string or fallback
- **Result**: The map query might be irrelevant or empty

**Location**: Lines 199-218 in design.md (extractSearchKeywords function)

**Fix**:
- Only strip stop words if the remaining string is long enough
- If the user query is *only* "search", keep it

---

### LOW Priority Issues (1)

#### 4. Type Safety on `tool_input`

**Category**: TypeScript Safety
**Severity**: LOW

The cast `toolInput as { ... }` is weak.

**Impact**:
- `tool_input` can be a string (JSON) or an object depending on the SDK version and runtime state
- While the safeguard `if (!toolInput) return null` exists, accessing property `subagent_type` on a potential string would throw
- Safe practice involves checking `typeof toolInput === 'object'`

**Location**: Lines 110-114 in design.md

**Fix**: Add explicit type check:
```typescript
if (!toolInput || typeof toolInput !== 'object') return null;
```

---

## Issue Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1     |
| HIGH     | 1     |
| MEDIUM   | 1     |
| LOW      | 1     |

---

## Specific Recommendations

### 1. Inject the Map Results

Update the return statement to actually include the `mapResults` in the `additionalContext`. This gives the model a "preview" of the data, incentivizing it to follow the redirect.

### 2. Optimize Command Execution

- Ensure `runCommand` has a strict, short timeout (e.g., 2000ms)
- If it times out, proceed with the intercept without the map context (fail open for the context, but still deny usage)

### 3. Refine Keyword Extraction

- Only strip stop words if the remaining string is long enough
- If the user query is *only* "search", keep it

### 4. Fix Variable Usage

Use the `escapeForTemplate` helper to safely sanitize `mapResults` before injecting it into the context string.

---

## Revised Code Snippet

Here is the corrected logic for the `return` block:

```typescript
// ... inside handleTaskIntercept ...

// [CORRECTION] Limit timeout for hook performance
// Ensure runCommand has a timeout mechanism or wrapper
if (searchContext) {
  const keywords = extractSearchKeywords(searchContext);
  if (keywords) {
    try {
      mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
    } catch (e) {
      // Silently fail on command error to avoid breaking the hook
      console.error("claudemem map failed during intercept", e);
    }
  }
}

// [CORRECTION] Actually use the results
const contextPreview = mapResults
  ? `\n\nPreliminary AST Map Data:\n${escapeForTemplate(mapResults)}`
  : "";

return {
  // Provide the map data so the model has context immediately
  additionalContext: `**Explore agent blocked** - Please use 'code-analysis:detective' for deep analysis.${contextPreview}`,

  // Explicitly deny the original action
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "The 'Explore' agent behaves poorly on large codebases. You must use the 'code-analysis:detective' agent (Task tool) which uses the claudemem AST index.",
  },
};
```

---

## Approval Decision

**Status**: CONDITIONAL

**Rationale**: The design is well-structured and addresses a real problem (Explore agent bypassing AST analysis). However, the CRITICAL issue of unused data fetching must be addressed before implementation. The code fetches `mapResults` but never includes it in the output, wasting resources and missing an opportunity to provide helpful context.

**Required for Approval**:
1. Fix the unused `mapResults` issue (CRITICAL)
2. Add timeout handling for `runCommand` (HIGH)

**Recommended Improvements**:
- Refine keyword extraction logic
- Add explicit type checking for `tool_input`

---

*Generated by: google/gemini-3-pro-preview via Claudish*
